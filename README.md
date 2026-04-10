# Lichess for VS Code

Play chess without leaving your editor. Solve Lichess puzzles and play games right inside VS Code.

## Features

- **Puzzles** — Daily puzzle, random puzzles, hint & solution
- **Play vs AI** — Stockfish levels 1-8, multiple time controls
- **Play online** — Find opponents, accept challenges (rapid/classical)
- **Live games** — Real-time board updates, clocks, resign/draw
- **Authentication** — OAuth2 or Personal Access Token
- **Flexible layout** — Place the board in any panel or sidebar

## Recommended Layout

Drag the Lichess tab to the **right sidebar** (secondary sidebar) for the ideal setup:

```
┌──────────┬──────────┬──────────┐
│ Explorer │  Editor  │ Lichess  │
│          │  (code)  │ (board)  │
├──────────┴──────────┴──────────┤
│           Terminal             │
└────────────────────────────────┘
```

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type "Lichess":

| Command | Description |
|---------|-------------|
| `Lichess: Daily Puzzle` | Load today's puzzle |
| `Lichess: Random Puzzle` | Load a random puzzle |
| `Lichess: Play vs AI` | Start a game against Stockfish |
| `Lichess: Find Opponent` | Seek a human opponent |
| `Lichess: Login` | Authenticate with Lichess |
| `Lichess: Logout` | Sign out |
| `Lichess: My Games` | View and join ongoing games |

## Authentication

Required for: playing games, finding opponents, personalized puzzles.

**Not required for:** daily puzzle, random puzzles.

Two options:
1. **OAuth2** — Click "Login to Lichess", authorize in browser
2. **Personal Access Token** — Generate at [lichess.org/account/oauth/token](https://lichess.org/account/oauth/token) with scopes: `board:play`, `challenge:read`, `challenge:write`, `puzzle:read`

## Contributing

```bash
git clone https://github.com/gugasth/lichess-for-vscode.git
cd lichess-for-vscode
npm install
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

## License

GPL-3.0 (required by Chessground)
