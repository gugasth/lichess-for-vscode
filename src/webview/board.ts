// Webview script: runs inside the VS Code webview (browser environment)
// Communicates with the extension host via postMessage

import { Chess, Square } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, Color } from '@lichess-org/chessground/types';

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

let cg: Api | null = null;
let chess: Chess = new Chess();
let mode: 'idle' | 'puzzle' | 'game' = 'idle';
let playerColor: Color = 'white';

// Puzzle state
let puzzleSolution: string[] = [];
let puzzleMoveIndex = 0;
let puzzleFailed = false;
let puzzleComplete = false;

// Game state
let gameId: string | undefined;

// Clock state
let whiteTime = 0;
let blackTime = 0;
let activeClockColor: Color | null = null;
let clockInterval: ReturnType<typeof setInterval> | null = null;

// --- Init ---

function initBoard() {
  const container = document.getElementById('board-container');
  if (!container || cg) { return; }

  cg = Chessground(container, {
    orientation: 'white',
    movable: {
      free: false,
      color: undefined,
      events: {
        after: onUserMove,
      },
    },
    draggable: { showGhost: true },
    animation: { enabled: true, duration: 200 },
    premovable: { enabled: true },
    drawable: { enabled: true },
    highlight: { lastMove: true, check: true },
    coordinates: true,
  });
}

// --- Message handler ---

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'puzzle':
      handlePuzzle(msg.data);
      break;
    case 'gameFull':
      handleGameFull(msg.data);
      break;
    case 'gameState':
      handleGameState(msg.data);
      break;
    case 'loading':
      showLoading(msg.data.message);
      break;
    case 'authState':
      handleAuthState(msg.data);
      break;
  }
});

function handleAuthState(data: { loggedIn: boolean; username?: string }) {
  const loginPrompt = document.getElementById('login-prompt');
  const userRow = document.getElementById('user-row');
  const usernameEl = document.getElementById('username');
  if (!loginPrompt || !userRow) { return; }

  if (data.loggedIn) {
    loginPrompt.classList.add('hidden');
    userRow.classList.remove('hidden');
    if (usernameEl) { usernameEl.textContent = data.username || ''; }
  } else {
    loginPrompt.classList.remove('hidden');
    userRow.classList.add('hidden');
  }
}

// --- Puzzle mode ---

interface PuzzleData {
  game: { pgn: string };
  puzzle: {
    id: string;
    rating: number;
    solution: string[];
    themes: string[];
    initialPly: number;
  };
}

function handlePuzzle(data: PuzzleData) {
  mode = 'puzzle';
  puzzleFailed = false;
  puzzleComplete = false;
  puzzleMoveIndex = 0;
  puzzleSolution = data.puzzle.solution;
  gameId = undefined;

  showGameView();

  // Setup from PGN
  chess = new Chess();
  const moves = data.game.pgn.split(/\s+/).filter((m) => !m.match(/^\d+\./) && m.length > 0);
  for (const m of moves) {
    try { chess.move(m); } catch { break; }
  }

  // The Lichess API PGN already includes the opponent's trigger move.
  // After replaying the PGN, it's the PLAYER's turn.
  // solution[0] = player's first move, solution[1] = opponent's response, etc.
  const turnAfterPgn = chess.turn();
  playerColor = turnAfterPgn === 'w' ? 'white' : 'black';

  // Show puzzle info
  document.getElementById('puzzle-info')!.classList.remove('hidden');
  document.getElementById('puzzle-rating')!.textContent = `Rating: ${data.puzzle.rating}`;
  document.getElementById('puzzle-themes')!.textContent = data.puzzle.themes.join(', ');
  document.getElementById('puzzle-status')!.textContent = '';

  // Hide game controls, show puzzle controls
  document.getElementById('game-controls')!.classList.add('hidden');
  document.getElementById('puzzle-controls')!.classList.remove('hidden');
  document.getElementById('hint-btn')!.classList.remove('hidden');
  document.getElementById('solution-btn')!.classList.remove('hidden');

  // Hide player bars (no clocks in puzzles)
  document.getElementById('top-player')!.classList.add('hidden');
  document.getElementById('bottom-player')!.classList.add('hidden');

  updateBoard();
  setStatus('Your turn - find the best move!', 'info');
}

function playPuzzleOpponentMove() {
  if (puzzleMoveIndex >= puzzleSolution.length) {
    puzzleSuccess();
    return;
  }

  const uci = puzzleSolution[puzzleMoveIndex];
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;

  try {
    chess.move({ from, to, promotion });
  } catch {
    return;
  }

  puzzleMoveIndex++;
  updateBoard();

  // Check if puzzle is done (odd number of solution moves means it ends on opponent's move)
  if (puzzleMoveIndex >= puzzleSolution.length) {
    puzzleSuccess();
  }
}

function onPuzzleUserMove(from: string, to: string, promotion?: string) {
  if (puzzleComplete || puzzleFailed) { return; }
  if (puzzleMoveIndex >= puzzleSolution.length) { return; }

  const expectedUci = puzzleSolution[puzzleMoveIndex];
  const actualUci = from + to + (promotion || '');

  if (actualUci === expectedUci) {
    // Correct!
    puzzleMoveIndex++;
    updateBoard();

    if (puzzleMoveIndex >= puzzleSolution.length) {
      puzzleSuccess();
    } else {
      // Play opponent's next move
      setStatus('Correct! Keep going...', 'success');
      setTimeout(() => {
        playPuzzleOpponentMove();
      }, 400);
    }
  } else {
    // Wrong move - undo it
    chess.undo();
    puzzleFailed = true;
    updateBoard();
    setStatus('Incorrect. Try again or show solution.', 'failure');
    puzzleFailed = false; // Allow retry
  }
}

function puzzleSuccess() {
  puzzleComplete = true;
  setStatus('Puzzle solved!', 'success');
  document.getElementById('hint-btn')!.classList.add('hidden');
  document.getElementById('solution-btn')!.classList.add('hidden');

  // Disable moves
  cg?.set({ movable: { color: undefined } });
}

// --- Game mode ---

interface GameFullData {
  id: string;
  white: { name: string; rating: number };
  black: { name: string; rating: number };
  initialFen: string;
  state: {
    moves: string;
    wtime: number;
    btime: number;
    winc: number;
    binc: number;
    status: string;
    winner?: string;
  };
  playerColor: Color;
  clock?: { initial: number; increment: number };
  speed: string;
}

function handleGameFull(data: GameFullData) {
  mode = 'game';
  gameId = data.id;
  playerColor = data.playerColor;
  puzzleSolution = [];

  showGameView();

  // Hide puzzle UI
  document.getElementById('puzzle-info')!.classList.add('hidden');
  document.getElementById('puzzle-controls')!.classList.add('hidden');

  // Show game controls and player bars
  document.getElementById('game-controls')!.classList.remove('hidden');
  document.getElementById('top-player')!.classList.remove('hidden');
  document.getElementById('bottom-player')!.classList.remove('hidden');

  // Set player names
  const topIsOpponent = playerColor === 'white';
  const topPlayer = topIsOpponent ? data.black : data.white;
  const bottomPlayer = topIsOpponent ? data.white : data.black;

  document.getElementById('top-name')!.textContent =
    `${topPlayer.name} (${topPlayer.rating})`;
  document.getElementById('bottom-name')!.textContent =
    `${bottomPlayer.name} (${bottomPlayer.rating})`;

  // Setup board from initial FEN or start position
  chess = new Chess(data.initialFen === 'startpos' ? undefined : data.initialFen);

  // Apply existing moves
  if (data.state.moves) {
    const moves = data.state.moves.split(' ');
    for (const m of moves) {
      try {
        const from = m.slice(0, 2) as Square;
        const to = m.slice(2, 4) as Square;
        const promotion = m.length > 4 ? (m[4] as 'q' | 'r' | 'b' | 'n') : undefined;
        chess.move({ from, to, promotion });
      } catch { break; }
    }
  }

  updateBoard();
  updateClocks(data.state.wtime, data.state.btime);
  updateGameStatus(data.state);
  updateMoveList();
}

function handleGameState(data: {
  moves: string;
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  status: string;
  winner?: string;
}) {
  if (mode !== 'game') { return; }

  // Rebuild position from moves
  chess = new Chess();
  if (data.moves) {
    const moves = data.moves.split(' ');
    for (const m of moves) {
      try {
        const from = m.slice(0, 2) as Square;
        const to = m.slice(2, 4) as Square;
        const promotion = m.length > 4 ? (m[4] as 'q' | 'r' | 'b' | 'n') : undefined;
        chess.move({ from, to, promotion });
      } catch { break; }
    }
  }

  updateBoard();
  updateClocks(data.wtime, data.btime);
  updateGameStatus(data);
  updateMoveList();
}

function updateGameStatus(state: { status: string; winner?: string }) {
  if (state.status === 'started' || state.status === 'created') {
    const myTurn = (chess.turn() === 'w' && playerColor === 'white') ||
      (chess.turn() === 'b' && playerColor === 'black');
    setStatus(myTurn ? 'Your turn' : "Opponent's turn", 'info');
    return;
  }

  // Game over
  stopClock();
  document.getElementById('game-controls')!.classList.add('hidden');

  if (state.status === 'mate') {
    const won = state.winner === playerColor[0];
    setStatus(won ? 'Checkmate! You win!' : 'Checkmate. You lost.', won ? 'success' : 'failure');
  } else if (state.status === 'resign') {
    const won = state.winner === playerColor[0];
    setStatus(won ? 'Opponent resigned. You win!' : 'You resigned.', won ? 'success' : 'failure');
  } else if (state.status === 'draw' || state.status === 'stalemate') {
    setStatus('Game drawn.', 'info');
  } else if (state.status === 'aborted') {
    setStatus('Game aborted.', 'info');
  } else if (state.status === 'outoftime') {
    const won = state.winner === playerColor[0];
    setStatus(won ? 'Opponent ran out of time!' : 'You ran out of time.', won ? 'success' : 'failure');
  } else {
    setStatus(`Game over: ${state.status}`, 'info');
  }

  cg?.set({ movable: { color: undefined } });
}

// --- Board rendering ---

function updateBoard() {
  if (!cg) { initBoard(); }
  if (!cg) { return; }

  const fen = chess.fen();
  const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';
  const history = chess.history({ verbose: true });
  const lastMove = history.length > 0
    ? [history[history.length - 1].from as Key, history[history.length - 1].to as Key]
    : undefined;

  const inCheck = chess.inCheck();

  // Calculate legal moves for the current side
  const dests = new Map<Key, Key[]>();
  if (!chess.isGameOver()) {
    const moves = chess.moves({ verbose: true });
    for (const m of moves) {
      const from = m.from as Key;
      const to = m.to as Key;
      if (!dests.has(from)) {
        dests.set(from, []);
      }
      dests.get(from)!.push(to);
    }
  }

  const canMove = mode === 'game'
    ? (turnColor === playerColor)
    : (mode === 'puzzle' && !puzzleComplete && !puzzleFailed && turnColor === playerColor);

  cg.set({
    fen,
    orientation: playerColor,
    turnColor,
    lastMove,
    check: inCheck ? turnColor : undefined as any,
    movable: {
      free: false,
      color: canMove ? playerColor : undefined,
      dests: canMove ? dests : new Map(),
    },
  });
}

function onUserMove(orig: Key, dest: Key) {
  const from = orig as Square;
  const to = dest as Square;

  // Check if promotion
  const piece = chess.get(from);
  const isPromotion = piece?.type === 'p' &&
    ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

  if (isPromotion) {
    // Default to queen promotion
    const promotion = 'q';
    try {
      chess.move({ from, to, promotion });
    } catch {
      updateBoard();
      return;
    }

    if (mode === 'puzzle') {
      onPuzzleUserMove(from, to, promotion);
    } else if (mode === 'game') {
      vscode.postMessage({ type: 'move', move: `${from}${to}${promotion}` });
    }
  } else {
    try {
      chess.move({ from, to });
    } catch {
      updateBoard();
      return;
    }

    if (mode === 'puzzle') {
      onPuzzleUserMove(from, to);
    } else if (mode === 'game') {
      vscode.postMessage({ type: 'move', move: `${from}${to}` });
    }
  }

  updateBoard();
  updateMoveList();
}

// --- Clocks ---

function updateClocks(wtime: number, btime: number) {
  whiteTime = wtime;
  blackTime = btime;

  const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';
  activeClockColor = turnColor;

  renderClocks();
  startClock();
}

function startClock() {
  stopClock();
  clockInterval = setInterval(() => {
    if (activeClockColor === 'white') {
      whiteTime = Math.max(0, whiteTime - 100);
    } else if (activeClockColor === 'black') {
      blackTime = Math.max(0, blackTime - 100);
    }
    renderClocks();
  }, 100);
}

function stopClock() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
}

function renderClocks() {
  const topIsOpponent = playerColor === 'white';
  const topTime = topIsOpponent ? blackTime : whiteTime;
  const bottomTime = topIsOpponent ? whiteTime : blackTime;
  const topColor: Color = topIsOpponent ? 'black' : 'white';
  const bottomColor: Color = topIsOpponent ? 'white' : 'black';

  const topEl = document.getElementById('top-clock')!;
  const bottomEl = document.getElementById('bottom-clock')!;

  topEl.textContent = formatTime(topTime);
  bottomEl.textContent = formatTime(bottomTime);

  topEl.classList.toggle('active', activeClockColor === topColor);
  bottomEl.classList.toggle('active', activeClockColor === bottomColor);
  topEl.classList.toggle('low', topTime < 30000);
  bottomEl.classList.toggle('low', bottomTime < 30000);
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    const hours = Math.floor(min / 60);
    const mins = min % 60;
    return `${hours}:${String(mins).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${min}:${String(sec).padStart(2, '0')}`;
}

// --- Move list ---

function updateMoveList() {
  const el = document.getElementById('move-list');
  if (!el) { return; }

  const history = chess.history();
  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const white = history[i];
    const black = history[i + 1] || '';
    html += `${moveNum}. ${white} ${black}  `;
  }
  el.textContent = html;
  el.scrollTop = el.scrollHeight;
}

// --- UI helpers ---

function showGameView() {
  document.getElementById('welcome')!.classList.add('hidden');
  document.getElementById('loading')!.classList.add('hidden');
  document.getElementById('game-view')!.classList.remove('hidden');
  if (!cg) { initBoard(); }
}

function showLoading(message: string) {
  document.getElementById('welcome')!.classList.add('hidden');
  document.getElementById('game-view')!.classList.add('hidden');
  document.getElementById('loading')!.classList.remove('hidden');
  document.getElementById('loading')!.textContent = message;
}

function setStatus(text: string, type: 'success' | 'failure' | 'info') {
  const el = document.getElementById('status')!;
  el.textContent = text;
  el.className = `status-message ${type}`;
  el.classList.remove('hidden');
}

function clearStatus() {
  document.getElementById('status')!.classList.add('hidden');
}

// --- Actions ---

function doShowHint() {
  if (puzzleMoveIndex >= puzzleSolution.length) { return; }
  const nextMove = puzzleSolution[puzzleMoveIndex];
  const from = nextMove.slice(0, 2) as Key;
  cg?.setShapes([{ orig: from, brush: 'green' }]);
  setStatus(`Hint: move the piece on ${from}`, 'info');
}

function doShowSolution() {
  if (puzzleComplete) { return; }
  for (let i = puzzleMoveIndex; i < puzzleSolution.length; i++) {
    const uci = puzzleSolution[i];
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.length > 4 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined;
    try { chess.move({ from, to, promotion }); } catch { break; }
  }
  puzzleMoveIndex = puzzleSolution.length;
  puzzleComplete = true;
  updateBoard();
  updateMoveList();
  setStatus('Solution shown', 'info');
  document.getElementById('hint-btn')!.classList.add('hidden');
  document.getElementById('solution-btn')!.classList.add('hidden');
  cg?.set({ movable: { color: undefined } });
}

// --- Event delegation for all buttons ---

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target) { return; }

  switch (target.dataset.action) {
    case 'dailyPuzzle': vscode.postMessage({ type: 'requestDailyPuzzle' }); break;
    case 'randomPuzzle': vscode.postMessage({ type: 'requestRandomPuzzle' }); break;
    case 'nextPuzzle': vscode.postMessage({ type: 'requestNextPuzzle' }); break;
    case 'playAI': vscode.postMessage({ type: 'requestPlayAI' }); break;
    case 'resign': vscode.postMessage({ type: 'resign' }); break;
    case 'draw': vscode.postMessage({ type: 'draw' }); break;
    case 'hint': doShowHint(); break;
    case 'solution': doShowSolution(); break;
    case 'login': vscode.postMessage({ type: 'login' }); break;
    case 'logout': vscode.postMessage({ type: 'logout' }); break;
  }
});

// --- Init on load ---
vscode.postMessage({ type: 'ready' });
