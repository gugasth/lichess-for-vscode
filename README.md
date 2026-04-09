# Lichess for VS Code

Play chess while you vibecode. Solve Lichess puzzles and play games right inside VS Code — perfect for when Claude Code or your CI is thinking.

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
│  Terminal (Claude Code / etc)  │
└────────────────────────────────┘
```

## Install from Source

```bash
git clone https://github.com/gugasth/lichess-vibecoding.git
cd lichess-vibecoding
npm install
npm run build
```

Then in VS Code:
1. Open the `lichess-vibecoding` folder
2. Press **F5** to launch the Extension Development Host
3. The Lichess tab appears in the bottom panel — drag it wherever you want

## Install from .vsix (for friends)

```bash
# Build the package
npm install
npm run build
npx @vscode/vsce package --no-dependencies

# This creates lichess-vibecoding-0.1.0.vsix
```

Send the `.vsix` file to your friends. They install it with:

```bash
code --install-extension lichess-vibecoding-0.1.0.vsix
```

Or in VS Code: **Extensions** (Ctrl+Shift+X) > **...** menu > **Install from VSIX...**

## Commands

Open the Command Palette (Ctrl+Shift+P) and type "Lichess":

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

## Tech Stack

- [Chessground](https://github.com/lichess-org/chessground) — Board UI (from Lichess)
- [chess.js](https://github.com/jhlywa/chess.js) — Move validation
- [Lichess API](https://lichess.org/api) — Puzzles, Board API, NDJSON streaming
- [esbuild](https://esbuild.github.io/) — Bundler

## License

GPL-3.0 (required by Chessground)
