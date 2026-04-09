import * as vscode from 'vscode';
import { LichessApi, GameFullEvent, GameStateEvent, LichessPuzzle } from '../api/lichessApi';
import { LichessAuth } from '../auth/lichessAuth';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'lichess.sidebar';
  private view?: vscode.WebviewView;

  private currentGameId: string | undefined;
  private currentGameStream: { abort: () => void } | undefined;
  private playerColor: 'white' | 'black' = 'white';
  private myUsername: string | undefined;

  constructor(
    private extensionUri: vscode.Uri,
    private api: LichessApi,
    private auth: LichessAuth
  ) {
    auth.onDidChangeAuth(() => {
      this.sendAuthState();
      this.initUsername();
    });
    this.initUsername();
  }

  private async initUsername() {
    this.myUsername = await this.auth.getUsername();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

    webviewView.onDidDispose(() => {
      this.stopGameStream();
    });
  }

  // --- Public API for commands ---

  public async loadDailyPuzzle() {
    this.revealView();
    try {
      const puzzle = await this.api.getDailyPuzzle();
      this.sendPuzzle(puzzle);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to load puzzle: ${e.message}`);
    }
  }

  public async loadRandomPuzzle() {
    this.revealView();
    try {
      const loggedIn = await this.auth.isLoggedIn();
      let puzzle: LichessPuzzle;
      if (loggedIn) {
        puzzle = await this.api.getNextPuzzle();
      } else {
        puzzle = await this.api.getDailyPuzzle();
      }
      this.sendPuzzle(puzzle);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to load puzzle: ${e.message}`);
    }
  }

  public async loadNextPuzzle() {
    this.revealView();
    try {
      // Fetch a random puzzle by generating a random ID range
      const randomId = String(Math.floor(Math.random() * 300000) + 1).padStart(5, '0');
      const puzzle = await this.api.getPuzzleById(randomId);
      this.sendPuzzle(puzzle);
    } catch {
      // If random ID fails, fall back to daily
      try {
        const puzzle = await this.api.getDailyPuzzle();
        this.sendPuzzle(puzzle);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to load puzzle: ${e.message}`);
      }
    }
  }

  public async promptAndPlayAI() {
    const loggedIn = await this.auth.isLoggedIn();
    if (!loggedIn) {
      const result = await this.auth.login();
      if (!result) { return; }
    }

    const level = await vscode.window.showQuickPick(
      Array.from({ length: 8 }, (_, i) => ({
        label: `Level ${i + 1}`,
        description: i < 3 ? 'Easy' : i < 6 ? 'Medium' : 'Hard',
        value: i + 1,
      })),
      { placeHolder: 'Select AI difficulty' }
    );
    if (!level) { return; }

    const timeControl = await vscode.window.showQuickPick(
      [
        { label: 'No clock', value: undefined },
        { label: '5+0 (Blitz)', value: { limit: 300, increment: 0 } },
        { label: '5+3 (Blitz)', value: { limit: 300, increment: 3 } },
        { label: '10+0 (Rapid)', value: { limit: 600, increment: 0 } },
        { label: '10+5 (Rapid)', value: { limit: 600, increment: 5 } },
        { label: '15+10 (Rapid)', value: { limit: 900, increment: 10 } },
        { label: '30+0 (Classical)', value: { limit: 1800, increment: 0 } },
      ],
      { placeHolder: 'Select time control' }
    );
    if (timeControl === undefined) { return; }

    const color = await vscode.window.showQuickPick(
      [
        { label: 'Random', value: 'random' },
        { label: 'White', value: 'white' },
        { label: 'Black', value: 'black' },
      ],
      { placeHolder: 'Select color' }
    );
    if (!color) { return; }

    this.revealView();
    try {
      this.postMessage({ type: 'loading', data: { message: 'Starting game vs AI...' } });
      const game = await this.api.challengeAI(level.value, timeControl.value, color.value);
      this.startGameStream(game.id);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to start game: ${e.message}`);
    }
  }

  public joinGame(gameId: string) {
    this.revealView();
    this.startGameStream(gameId);
  }

  // --- Internal ---

  private sendPuzzle(puzzle: LichessPuzzle) {
    this.stopGameStream();
    this.currentGameId = undefined;
    this.postMessage({ type: 'puzzle', data: puzzle });
  }

  private startGameStream(gameId: string) {
    this.stopGameStream();
    this.currentGameId = gameId;

    this.currentGameStream = this.api.streamGame(
      gameId,
      (event) => {
        if (event.type === 'gameFull') {
          const full = event as GameFullEvent;
          this.playerColor =
            full.white.name?.toLowerCase() === this.myUsername?.toLowerCase()
              ? 'white'
              : 'black';
          this.postMessage({
            type: 'gameFull',
            data: { ...full, playerColor: this.playerColor },
          });
        } else if (event.type === 'gameState') {
          this.postMessage({ type: 'gameState', data: event as GameStateEvent });
        } else if (event.type === 'chatLine') {
          this.postMessage({ type: 'chatLine', data: event });
        }
      },
      (error) => {
        vscode.window.showErrorMessage(`Game stream error: ${error.message}`);
      }
    );
  }

  private stopGameStream() {
    if (this.currentGameStream) {
      this.currentGameStream.abort();
      this.currentGameStream = undefined;
    }
  }

  private async handleMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        await this.sendAuthState();
        break;
      case 'move':
        if (this.currentGameId) {
          try {
            await this.api.makeMove(this.currentGameId, msg.move);
          } catch (e: any) {
            vscode.window.showErrorMessage(`Move failed: ${e.message}`);
          }
        }
        break;
      case 'resign':
        if (this.currentGameId) {
          await this.api.resignGame(this.currentGameId);
        }
        break;
      case 'abort':
        if (this.currentGameId) {
          await this.api.abortGame(this.currentGameId);
        }
        break;
      case 'draw':
        if (this.currentGameId) {
          await this.api.offerDraw(this.currentGameId, true);
        }
        break;
      case 'requestDailyPuzzle':
        await this.loadDailyPuzzle();
        break;
      case 'requestRandomPuzzle':
        await this.loadRandomPuzzle();
        break;
      case 'requestNextPuzzle':
        await this.loadNextPuzzle();
        break;
      case 'requestPlayAI':
        await this.promptAndPlayAI();
        break;
      case 'login':
        await this.auth.login();
        break;
      case 'logout':
        await this.auth.logout();
        break;
    }
  }

  private async sendAuthState() {
    const loggedIn = await this.auth.isLoggedIn();
    const username = loggedIn ? await this.auth.getUsername() : undefined;
    this.postMessage({ type: 'authState', data: { loggedIn, username } });
  }

  private postMessage(msg: any) {
    this.view?.webview.postMessage(msg);
  }

  private revealView() {
    if (this.view) {
      this.view.show?.(true);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'board.js')
    );
    const cssBase = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chessground.base.css')
    );
    const cssBrown = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chessground.brown.css')
    );
    const cssPieces = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chessground.cburnett.css')
    );
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: https:;">
  <link rel="stylesheet" href="${cssBase}">
  <link rel="stylesheet" href="${cssBrown}">
  <link rel="stylesheet" href="${cssPieces}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-panel-background, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100vh;
      overflow: hidden;
      padding: 8px;
    }

    /* --- Auth bar --- */
    .auth-bar {
      width: 100%;
      margin-bottom: 8px;
      text-align: center;
    }
    .auth-bar .user-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      font-size: 12px;
    }
    .auth-bar .user-row .name { font-weight: bold; }
    .auth-bar .user-row button {
      padding: 2px 8px;
      font-size: 11px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    /* --- Buttons --- */
    .actions {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      justify-content: center;
      width: 100%;
      margin-bottom: 8px;
    }
    .actions button {
      flex: 1;
      min-width: 0;
      padding: 6px 4px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      text-align: center;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .actions button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    /* --- Board --- */
    .board-container {
      position: relative;
      flex-shrink: 0;
    }
    .board-container .cg-wrap {
      width: 100%;
      height: 100%;
      display: block;
      position: relative;
    }

    /* --- Player bars --- */
    .player-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 3px 0;
      font-size: 12px;
    }
    .player-bar .name {
      font-weight: bold;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .player-bar .clock {
      font-family: 'Courier New', monospace;
      font-size: 14px;
      font-weight: bold;
      background: var(--vscode-input-background);
      padding: 2px 6px;
      border-radius: 3px;
      min-width: 55px;
      text-align: center;
    }
    .player-bar .clock.active {
      background: #1a3a1a;
      color: #4caf50;
    }
    .player-bar .clock.low {
      color: #f44336;
    }

    /* --- Puzzle info --- */
    .puzzle-info {
      text-align: center;
      padding: 4px 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      margin-bottom: 6px;
      width: 100%;
      font-size: 12px;
    }
    .puzzle-info .rating { font-weight: bold; font-size: 14px; }
    .puzzle-info .themes { font-size: 10px; opacity: 0.7; margin-top: 2px; }

    /* --- Status --- */
    .status-message {
      text-align: center;
      padding: 6px;
      font-size: 13px;
      font-weight: bold;
      margin-top: 4px;
      width: 100%;
    }
    .status-message.success { color: #4caf50; }
    .status-message.failure { color: #f44336; }
    .status-message.info { color: var(--vscode-textLink-foreground); }

    /* --- Game controls --- */
    .game-controls {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      width: 100%;
      justify-content: center;
    }
    .game-controls button {
      flex: 1;
      padding: 5px 8px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .game-controls button.danger {
      background: #5a1a1a;
      color: #f44336;
    }

    /* --- Move list --- */
    .move-list {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      max-height: 80px;
      overflow-y: auto;
      padding: 4px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      margin-top: 6px;
      width: 100%;
      word-wrap: break-word;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100px;
      font-size: 13px;
      opacity: 0.7;
    }

    .welcome {
      text-align: center;
      padding: 20px 8px;
    }
    .welcome h2 { margin-bottom: 8px; font-size: 16px; }
    .welcome p { margin-bottom: 12px; opacity: 0.8; font-size: 12px; line-height: 1.5; }

    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div id="auth-bar" class="auth-bar">
    <div id="login-prompt">
      <button data-action="login" class="primary" style="width:100%;padding:6px;border:none;border-radius:4px;cursor:pointer;font-size:12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);">Login to Lichess</button>
    </div>
    <div id="user-row" class="user-row hidden">
      <span class="name" id="username"></span>
      <button data-action="logout">Logout</button>
    </div>
  </div>

  <div id="welcome">
    <h2 class="welcome">Lichess</h2>
    <div class="actions">
      <button data-action="dailyPuzzle" class="primary">Daily Puzzle</button>
      <button data-action="randomPuzzle">Random</button>
      <button data-action="playAI">vs AI</button>
    </div>
  </div>

  <div id="game-view" class="hidden">
    <div class="actions">
      <button data-action="dailyPuzzle">Daily</button>
      <button data-action="randomPuzzle">Random</button>
      <button data-action="playAI" class="primary">vs AI</button>
    </div>

    <div id="puzzle-info" class="puzzle-info hidden">
      <span class="rating" id="puzzle-rating"></span>
      <span id="puzzle-status"></span>
      <div class="themes" id="puzzle-themes"></div>
    </div>

    <div id="top-player" class="player-bar hidden">
      <span class="name" id="top-name">-</span>
      <span class="clock" id="top-clock">--:--</span>
    </div>

    <div class="board-container" id="board-container"></div>

    <div id="bottom-player" class="player-bar hidden">
      <span class="name" id="bottom-name">-</span>
      <span class="clock" id="bottom-clock">--:--</span>
    </div>

    <div id="status" class="status-message hidden"></div>

    <div id="game-controls" class="game-controls hidden">
      <button data-action="draw">Draw</button>
      <button data-action="resign" class="danger">Resign</button>
    </div>

    <div id="puzzle-controls" class="game-controls hidden">
      <button data-action="hint" id="hint-btn">Hint</button>
      <button data-action="solution" id="solution-btn">Solution</button>
      <button data-action="nextPuzzle" class="primary">Next</button>
    </div>

    <div class="move-list" id="move-list"></div>
  </div>

  <div id="loading" class="loading hidden">Loading...</div>

  <script nonce="${nonce}">
    var _resizeTimer;
    function resizeBoard() {
      var el = document.getElementById('board-container');
      if (!el) return;
      var w = document.body.clientWidth - 16;
      var size = Math.floor(Math.min(w, 600));
      size = Math.max(120, size);
      if (el._lastSize === size) return;
      el._lastSize = size;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
    }
    resizeBoard();
    new ResizeObserver(function() {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(resizeBoard, 50);
    }).observe(document.body);
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
