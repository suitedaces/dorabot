// test-browser-parity — build the parity suite and launch electron against it.
//
//   usage:
//     npm run test:browser-parity           # build + run
//     npm run test:browser-parity -- --no-build   # skip tsc, run last built suite
//
// exits 0 if all cases pass, 1 otherwise. full results dumped to
// /tmp/browser-parity-results.json (override via BROWSER_PARITY_RESULTS=<path>).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TEST_DIR = resolve(ROOT, 'tests/browser-parity');
const ELECTRON_BIN = resolve(ROOT, 'desktop/node_modules/.bin/electron');
const BUILT_MAIN = resolve(TEST_DIR, 'out/tests/browser-parity/src/main.js');
const RESULTS_PATH = process.env.BROWSER_PARITY_RESULTS || '/tmp/browser-parity-results.json';

const skipBuild = process.argv.includes('--no-build');

if (!existsSync(ELECTRON_BIN)) {
  console.error(`[parity] electron binary missing: ${ELECTRON_BIN}`);
  console.error('         run `cd desktop && npm install` first');
  process.exit(1);
}

if (!skipBuild) {
  console.log('[parity] building test suite...');
  const tsc = spawnSync(resolve(ROOT, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
    cwd: TEST_DIR,
    stdio: 'inherit',
  });
  if (tsc.status !== 0) {
    console.error('[parity] tsc failed');
    process.exit(tsc.status ?? 1);
  }
}

if (!existsSync(BUILT_MAIN)) {
  console.error(`[parity] built entrypoint missing: ${BUILT_MAIN}`);
  process.exit(1);
}

console.log(`[parity] launching electron against ${BUILT_MAIN}`);
const child = spawn(ELECTRON_BIN, [BUILT_MAIN], {
  cwd: TEST_DIR,
  stdio: 'inherit',
  env: { ...process.env, BROWSER_PARITY_RESULTS: RESULTS_PATH },
});

child.on('close', (code) => {
  if (existsSync(RESULTS_PATH)) {
    try {
      const json = JSON.parse(readFileSync(RESULTS_PATH, 'utf-8'));
      console.log('');
      console.log(`[parity] summary: ${json.passed}/${json.total} passed, ${json.failed} failed`);
      console.log(`[parity] results: ${RESULTS_PATH}`);
    } catch (err) {
      console.error('[parity] failed to read results:', err);
    }
  }
  process.exit(code ?? 1);
});
