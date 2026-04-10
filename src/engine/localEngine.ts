import * as path from 'path';
import { fork, ChildProcess } from 'child_process';

export class LocalEngine {
  private child: ChildProcess | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private evalId = 0;
  private outputHandler: ((line: string) => void) | null = null;

  init(): Promise<void> {
    if (this.initPromise) { return this.initPromise; }
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private doInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'engine', 'worker.js');

      this.child = fork(workerPath, [], { silent: true });

      // Read UCI output from child's stdout (Emscripten writes to stdout, not IPC)
      let buffer = '';
      this.child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { continue; }

          if (this.outputHandler) {
            this.outputHandler(trimmed);
          }

          if (trimmed === 'uciok' && !this.initialized) {
            this.initialized = true;
            resolve();
          }
        }
      });

      // Handle IPC messages (for __ready__ signal)
      this.child.on('message', (msg: string) => {
        if (msg === '__ready__') {
          this.child!.send('uci');
        }
      });

      this.child.on('error', (err) => {
        console.error('[Engine] Worker error:', err.message);
        reject(err);
      });

      this.child.on('exit', (code) => {
        if (code !== 0) {
          console.error('[Engine] Worker exited with code:', code);
        }
        this.child = null;
      });
    });
  }

  isReady(): boolean {
    return this.initialized && this.child !== null;
  }

  async evaluate(fen: string, depth: number = 12): Promise<{ cp?: number; mate?: number; bestMove?: string; moves?: string } | null> {
    if (!this.child) {
      await this.init();
    }

    const id = ++this.evalId;

    return new Promise((resolve) => {
      let bestCp: number | undefined;
      let bestMate: number | undefined;
      let bestPv: string | undefined;

      this.outputHandler = (line: string) => {
        if (id !== this.evalId) {
          this.outputHandler = null;
          resolve(null);
          return;
        }

        if (line.startsWith('info') && line.includes(' pv ')) {
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          if (cpMatch) { bestCp = parseInt(cpMatch[1]); }
          if (mateMatch) { bestMate = parseInt(mateMatch[1]); }
          const pvMatch = line.match(/ pv (.+)/);
          if (pvMatch) { bestPv = pvMatch[1]; }
        }

        if (line.startsWith('bestmove')) {
          this.outputHandler = null;
          const bestMove = bestPv ? bestPv.split(' ')[0] : undefined;
          resolve({ cp: bestCp, mate: bestMate, bestMove, moves: bestPv });
        }
      };

      this.child!.send(`position fen ${fen}`);
      this.child!.send(`go depth ${depth}`);
    });
  }

  dispose() {
    if (this.child) {
      try {
        this.child.send('quit');
        this.child.kill();
      } catch {}
      this.child = null;
    }
    this.initPromise = null;
    this.initialized = false;
    this.outputHandler = null;
  }
}
