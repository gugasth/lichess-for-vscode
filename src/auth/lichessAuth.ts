import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';

const LICHESS_HOST = 'https://lichess.org';
const CLIENT_ID = 'lichess-vibecoding-vscode';
const REDIRECT_PORT = 17384;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  'board:play',
  'challenge:read',
  'challenge:write',
  'puzzle:read',
];

export class LichessAuth {
  private secrets: vscode.SecretStorage;
  private _onDidChangeAuth = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAuth = this._onDidChangeAuth.event;

  constructor(private context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async getToken(): Promise<string | undefined> {
    return this.secrets.get('lichess.token');
  }

  async isLoggedIn(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }

  async getUsername(): Promise<string | undefined> {
    return this.secrets.get('lichess.username');
  }

  async loginWithPAT(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your Lichess Personal Access Token',
      placeHolder: 'lip_...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Token cannot be empty';
        }
        return undefined;
      },
    });

    if (!token) {
      return false;
    }

    const valid = await this.validateAndStoreToken(token.trim());
    if (!valid) {
      vscode.window.showErrorMessage('Invalid Lichess token. Please check and try again.');
    }
    return valid;
  }

  async loginWithOAuth(): Promise<boolean> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = new URL(`${LICHESS_HOST}/oauth`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('state', state);

    return new Promise<boolean>((resolve) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/callback')) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');

        if (returnedState !== state || !code) {
          res.writeHead(400);
          res.end('Authentication failed: invalid state or missing code.');
          server.close();
          resolve(false);
          return;
        }

        try {
          const token = await this.exchangeCodeForToken(code, codeVerifier);
          const valid = await this.validateAndStoreToken(token);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(valid
            ? '<html><body><h2>Login successful! You can close this tab.</h2><script>window.close()</script></body></html>'
            : '<html><body><h2>Login failed. Please try again.</h2></body></html>');

          server.close();
          resolve(valid);
        } catch {
          res.writeHead(500);
          res.end('Authentication error.');
          server.close();
          resolve(false);
        }
      });

      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        resolve(false);
      }, 120_000);
    });
  }

  async login(): Promise<boolean> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(globe) Login with Lichess (OAuth)', description: 'Opens browser to authorize', value: 'oauth' },
        { label: '$(key) Personal Access Token', description: 'Paste a token from lichess.org/account/oauth/token', value: 'pat' },
      ],
      { placeHolder: 'Choose login method', ignoreFocusOut: true }
    );

    if (!choice) {
      return false;
    }

    return choice.value === 'oauth' ? this.loginWithOAuth() : this.loginWithPAT();
  }

  async logout(): Promise<void> {
    const token = await this.getToken();
    if (token) {
      // Revoke token on Lichess
      try {
        const https = await import('https');
        const req = https.request(`${LICHESS_HOST}/api/token`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        req.end();
      } catch {
        // Best effort
      }
    }

    await this.secrets.delete('lichess.token');
    await this.secrets.delete('lichess.username');
    this._onDidChangeAuth.fire(false);
    vscode.window.showInformationMessage('Logged out of Lichess.');
  }

  private async validateAndStoreToken(token: string): Promise<boolean> {
    try {
      const https = await import('https');
      const data = await new Promise<string>((resolve, reject) => {
        const req = https.get(`${LICHESS_HOST}/api/account`, {
          headers: { Authorization: `Bearer ${token}` },
        }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(body);
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        });
        req.on('error', reject);
      });

      const account = JSON.parse(data);
      await this.secrets.store('lichess.token', token);
      await this.secrets.store('lichess.username', account.username);
      this._onDidChangeAuth.fire(true);
      vscode.window.showInformationMessage(`Logged in as ${account.username} on Lichess!`);
      return true;
    } catch {
      return false;
    }
  }

  private async exchangeCodeForToken(code: string, codeVerifier: string): Promise<string> {
    const https = await import('https');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
    }).toString();

    return new Promise<string>((resolve, reject) => {
      const req = https.request(`${LICHESS_HOST}/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error('No access token in response'));
            }
          } catch {
            reject(new Error('Failed to parse token response'));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  dispose(): void {
    this._onDidChangeAuth.dispose();
  }
}
