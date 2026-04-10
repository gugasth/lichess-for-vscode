const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Copy chessground CSS assets to dist/webview/
function copyCss() {
  const outDir = path.join(__dirname, 'dist', 'webview');
  fs.mkdirSync(outDir, { recursive: true });

  const cssFiles = [
    'chessground.base.css',
    'chessground.brown.css',
    'chessground.cburnett.css',
  ];

  for (const file of cssFiles) {
    const src = path.join(__dirname, 'node_modules', '@lichess-org', 'chessground', 'assets', file);
    const dest = path.join(outDir, file);
    fs.copyFileSync(src, dest);
  }
  console.log('Copied chessground CSS assets.');
}

// Copy stockfish engine files to dist/engine/
function copyStockfish() {
  const outDir = path.join(__dirname, 'dist', 'engine');
  fs.mkdirSync(outDir, { recursive: true });

  const sfBin = path.join(__dirname, 'node_modules', 'stockfish', 'bin');
  const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];
  for (const file of files) {
    fs.copyFileSync(path.join(sfBin, file), path.join(outDir, file));
  }
  // Copy worker script
  fs.copyFileSync(
    path.join(__dirname, 'src', 'engine', 'worker.js'),
    path.join(outDir, 'worker.js')
  );
  console.log('Copied Stockfish engine files.');
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/board.ts'],
  bundle: true,
  outfile: 'dist/webview/board.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
};

async function main() {
  if (watch) {
    const ctx1 = await esbuild.context(extensionConfig);
    const ctx2 = await esbuild.context(webviewConfig);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    console.log('[watch] Build started...');
  } else {
    copyCss();
    copyStockfish();
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('Build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
