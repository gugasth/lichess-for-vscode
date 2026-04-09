import * as https from 'https';

const LICHESS_HOST = 'lichess.org';

export interface LichessPuzzle {
  game: {
    id: string;
    pgn: string;
    players: Array<{ name: string; color: string }>;
  };
  puzzle: {
    id: string;
    rating: number;
    plays: number;
    solution: string[];
    themes: string[];
    initialPly: number;
  };
}

export interface LichessGame {
  id: string;
  fullId?: string;
  color: 'white' | 'black';
  fen: string;
  opponent: { username: string; rating?: number };
  isMyTurn: boolean;
  lastMove?: string;
  speed: string;
  perf: string;
}

export interface GameFullEvent {
  type: 'gameFull';
  id: string;
  rated: boolean;
  variant: { key: string };
  clock?: { initial: number; increment: number };
  speed: string;
  white: { id: string; name: string; rating: number };
  black: { id: string; name: string; rating: number };
  initialFen: string;
  state: GameStateEvent;
}

export interface GameStateEvent {
  type: 'gameState';
  moves: string;
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  status: string;
  winner?: string;
}

export interface ChallengeEvent {
  type: 'challenge';
  challenge: {
    id: string;
    url: string;
    color: string;
    challenger: { id: string; name: string; rating: number };
    destUser?: { id: string; name: string; rating: number };
    variant: { key: string };
    rated: boolean;
    speed: string;
    timeControl: { type: string; limit?: number; increment?: number };
  };
}

export type StreamEvent =
  | { type: 'gameStart'; game: { gameId: string; fullId: string; color: string; fen: string; isMyTurn: boolean; opponent: { username: string } } }
  | { type: 'gameFinish'; game: { gameId: string } }
  | ChallengeEvent
  | { type: 'challengeCanceled'; challenge: { id: string } }
  | { type: 'challengeDeclined'; challenge: { id: string } };

export class LichessApi {
  constructor(private getToken: () => Promise<string | undefined>) {}

  // --- Puzzles ---

  async getDailyPuzzle(): Promise<LichessPuzzle> {
    return this.get<LichessPuzzle>('/api/puzzle/daily');
  }

  async getPuzzleById(id: string): Promise<LichessPuzzle> {
    return this.get<LichessPuzzle>(`/api/puzzle/${id}`);
  }

  async getNextPuzzle(): Promise<LichessPuzzle> {
    return this.get<LichessPuzzle>('/api/puzzle/next', true);
  }

  // --- Games ---

  async getOngoingGames(): Promise<LichessGame[]> {
    const data = await this.get<{ nowPlaying: LichessGame[] }>('/api/account/playing', true);
    return data.nowPlaying || [];
  }

  async challengeAI(level: number, clock?: { limit: number; increment: number }, color?: string): Promise<{ id: string }> {
    const params: Record<string, string> = {
      level: String(level),
    };
    if (clock) {
      params['clock.limit'] = String(clock.limit);
      params['clock.increment'] = String(clock.increment);
    }
    if (color) {
      params.color = color;
    }
    return this.post<{ id: string }>('/api/challenge/ai', params, true);
  }

  async makeMove(gameId: string, move: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/board/game/${gameId}/move/${move}`, {}, true);
  }

  async resignGame(gameId: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/board/game/${gameId}/resign`, {}, true);
  }

  async abortGame(gameId: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/board/game/${gameId}/abort`, {}, true);
  }

  async offerDraw(gameId: string, accept: boolean): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/board/game/${gameId}/draw/${accept ? 'yes' : 'no'}`, {}, true);
  }

  async acceptChallenge(challengeId: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/challenge/${challengeId}/accept`, {}, true);
  }

  async declineChallenge(challengeId: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(`/api/challenge/${challengeId}/decline`, {}, true);
  }

  async createSeek(time: number, increment: number, rated: boolean = true): Promise<void> {
    await this.post('/api/board/seek', {
      time: String(time / 60),
      increment: String(increment),
      rated: String(rated),
    }, true);
  }

  // --- Streaming ---

  streamEvents(
    onEvent: (event: StreamEvent) => void,
    onError: (error: Error) => void
  ): { abort: () => void } {
    return this.stream('/api/stream/event', onEvent, onError, true);
  }

  streamGame(
    gameId: string,
    onEvent: (event: GameFullEvent | GameStateEvent | { type: 'chatLine'; username: string; text: string }) => void,
    onError: (error: Error) => void
  ): { abort: () => void } {
    return this.stream(`/api/board/game/stream/${gameId}`, onEvent, onError, true);
  }

  // --- HTTP helpers ---

  private async get<T>(path: string, auth: boolean = false): Promise<T> {
    const token = auth ? await this.getToken() : undefined;
    return new Promise<T>((resolve, reject) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const req = https.get({ hostname: LICHESS_HOST, path, headers }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              reject(new Error('Failed to parse JSON response'));
            }
          } else {
            reject(new Error(`Lichess API error: HTTP ${res.statusCode} - ${body}`));
          }
        });
      });
      req.on('error', reject);
    });
  }

  private async post<T>(path: string, params: Record<string, string>, auth: boolean = false): Promise<T> {
    const token = auth ? await this.getToken() : undefined;
    const body = new URLSearchParams(params).toString();

    return new Promise<T>((resolve, reject) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (body) {
        headers['Content-Length'] = String(Buffer.byteLength(body));
      }

      const req = https.request({
        hostname: LICHESS_HOST,
        path,
        method: 'POST',
        headers,
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : ({} as T));
            } catch {
              resolve({} as T);
            }
          } else {
            reject(new Error(`Lichess API error: HTTP ${res.statusCode} - ${data}`));
          }
        });
      });
      req.on('error', reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private stream<T>(
    path: string,
    onEvent: (event: T) => void,
    onError: (error: Error) => void,
    auth: boolean = false
  ): { abort: () => void } {
    let req: ReturnType<typeof https.get> | null = null;

    (async () => {
      const token = auth ? await this.getToken() : undefined;
      const headers: Record<string, string> = {
        Accept: 'application/x-ndjson',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      req = https.get({ hostname: LICHESS_HOST, path, headers }, (res) => {
        if (res.statusCode !== 200) {
          onError(new Error(`Stream error: HTTP ${res.statusCode}`));
          return;
        }

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              try {
                onEvent(JSON.parse(trimmed));
              } catch {
                // Skip malformed lines
              }
            }
          }
        });

        res.on('end', () => {
          // Stream ended (game over, etc.)
        });
      });

      req.on('error', onError);
    })();

    return {
      abort: () => {
        req?.destroy();
      },
    };
  }
}
