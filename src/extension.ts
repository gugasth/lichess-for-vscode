import * as vscode from 'vscode';
import { LichessAuth } from './auth/lichessAuth';
import { LichessApi } from './api/lichessApi';
import { SidebarProvider } from './providers/sidebarProvider';

let auth: LichessAuth;
let api: LichessApi;
let eventStream: { abort: () => void } | undefined;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;

export function activate(context: vscode.ExtensionContext) {
  auth = new LichessAuth(context);
  api = new LichessApi(() => auth.getToken());

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusBarItem.text = '$(symbol-misc) Lichess';
  statusBarItem.tooltip = 'Lichess: Daily Puzzle';
  statusBarItem.command = 'lichess.dailyPuzzle';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Sidebar (contains the full board)
  sidebarProvider = new SidebarProvider(context.extensionUri, api, auth);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lichess.openBoard', () => {
      // Focus the sidebar view
      vscode.commands.executeCommand('lichess.sidebar.focus');
    }),

    vscode.commands.registerCommand('lichess.dailyPuzzle', () => {
      vscode.commands.executeCommand('lichess.sidebar.focus');
      sidebarProvider.loadDailyPuzzle();
    }),

    vscode.commands.registerCommand('lichess.randomPuzzle', () => {
      vscode.commands.executeCommand('lichess.sidebar.focus');
      sidebarProvider.loadRandomPuzzle();
    }),

    vscode.commands.registerCommand('lichess.playAI', () => {
      sidebarProvider.promptAndPlayAI();
    }),

    vscode.commands.registerCommand('lichess.seekGame', async () => {
      const loggedIn = await auth.isLoggedIn();
      if (!loggedIn) {
        const result = await auth.login();
        if (!result) { return; }
      }

      const tc = await vscode.window.showQuickPick(
        [
          { label: '10+0 (Rapid)', time: 600, increment: 0 },
          { label: '10+5 (Rapid)', time: 600, increment: 5 },
          { label: '15+10 (Rapid)', time: 900, increment: 10 },
          { label: '30+0 (Classical)', time: 1800, increment: 0 },
        ],
        { placeHolder: 'Select time control' }
      );

      if (!tc) { return; }

      try {
        vscode.window.showInformationMessage('Seeking opponent...');
        await api.createSeek(tc.time, tc.increment);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to create seek: ${e.message}`);
      }
    }),

    vscode.commands.registerCommand('lichess.login', () => auth.login()),
    vscode.commands.registerCommand('lichess.logout', () => auth.logout()),

    vscode.commands.registerCommand('lichess.showGames', async () => {
      const loggedIn = await auth.isLoggedIn();
      if (!loggedIn) {
        vscode.window.showWarningMessage('Please login to Lichess first.');
        return;
      }

      try {
        const games = await api.getOngoingGames();
        if (games.length === 0) {
          vscode.window.showInformationMessage('No ongoing games.');
          return;
        }

        const pick = await vscode.window.showQuickPick(
          games.map((g) => ({
            label: `vs ${g.opponent.username}`,
            description: g.isMyTurn ? 'Your turn' : "Opponent's turn",
            detail: `${g.speed} - ${g.color}`,
            gameId: g.id,
          })),
          { placeHolder: 'Select a game to open' }
        );

        if (pick) {
          sidebarProvider.joinGame(pick.gameId);
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to load games: ${e.message}`);
      }
    })
  );

  // Start event stream if logged in
  startEventStream(context);
  auth.onDidChangeAuth((loggedIn) => {
    if (loggedIn) {
      startEventStream(context);
    } else {
      stopEventStream();
    }
  });
}

function startEventStream(context: vscode.ExtensionContext) {
  stopEventStream();
  auth.isLoggedIn().then((loggedIn) => {
    if (!loggedIn) { return; }

    eventStream = api.streamEvents(
      (event) => {
        switch (event.type) {
          case 'gameStart':
            vscode.window.showInformationMessage(
              `Game started vs ${event.game.opponent.username}`,
              'Open'
            ).then((choice) => {
              if (choice === 'Open') {
                sidebarProvider.joinGame(event.game.gameId);
              }
            });
            break;

          case 'challenge':
            const c = event.challenge;
            vscode.window.showInformationMessage(
              `Challenge from ${c.challenger.name} (${c.challenger.rating}) - ${c.speed}`,
              'Accept',
              'Decline'
            ).then((choice) => {
              if (choice === 'Accept') {
                api.acceptChallenge(c.id);
              } else if (choice === 'Decline') {
                api.declineChallenge(c.id);
              }
            });
            break;
        }
      },
      (error) => {
        console.error('Lichess event stream error:', error);
        setTimeout(() => startEventStream(context), 10000);
      }
    );
  });
}

function stopEventStream() {
  if (eventStream) {
    eventStream.abort();
    eventStream = undefined;
  }
}

export function deactivate() {
  stopEventStream();
  auth?.dispose();
}
