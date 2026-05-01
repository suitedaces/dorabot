// main — electron entry for the browser parity test suite.
//
// boot:
//   1. create a hidden host window (WebContentsView tabs live as children)
//   2. install a BrowserController + fake host registry (invokeBrowserHost
//      resolves locally via handleAgentRpc -> this controller)
//   3. start the fixture http server on an ephemeral port
//   4. run each case in ./cases.ts, collecting results
//   5. write results json to /tmp/browser-parity-results.json
//   6. app.quit() — exit 0 if all passed, 1 otherwise
//
// run via:  npm run test:browser-parity
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserController } from '../../../desktop/electron/browser-controller';
import { installFakeBrowserHost } from './fake-host';
import { startFixtureServer, type HttpServerHandle } from './http-server';
import { runAll, type TestResult } from './runner';
import { CASES } from './cases';

const RESULTS_PATH = process.env.BROWSER_PARITY_RESULTS || '/tmp/browser-parity-results.json';
// tsconfig rootDir=../.. means compiled main.js lives at
// tests/browser-parity/out/tests/browser-parity/src/main.js, so __dirname is 4
// levels deep. the spawn script (scripts/test-browser-parity.ts) sets
// cwd=TEST_DIR, so process.cwd() resolves to tests/browser-parity/ cleanly.
const FIXTURES_DIR = join(process.cwd(), 'fixtures');

// electron headless tweaks
app.commandLine.appendSwitch('disable-gpu-compositing');

let hostWindow: BrowserWindow | null = null;
let controller: BrowserController | null = null;
let httpServer: HttpServerHandle | null = null;
let exitCode = 1;

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  // a hidden BrowserWindow does NOT route input events to its children even
  // when CDP Input.dispatchMouseEvent is used. confirmed via diag probe:
  // with show:false, mouseDown/mouseUp fire via debugger but no element is
  // focused/activated. with show:true, everything works. position the window
  // offscreen and make it non-focusable so stray keyboard input from the
  // user's terminal doesn't leak into our inputs. focusable:false is the
  // critical bit — without it, the offscreen window grabs keydown events
  // and they end up in whatever <input> is focused in the fixture.
  hostWindow = new BrowserWindow({
    show: true,
    x: -2000,
    y: -2000,
    width: 1280,
    height: 800,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: false,
    },
  });
  hostWindow.setMenu(null);

  controller = new BrowserController();
  controller.setHostWindow(hostWindow);
  installFakeBrowserHost(controller);

  // production renderer drives view bounds; in tests nothing does, so the
  // view stays 0x0 and CDP hit-testing fires into the void. size new views
  // to the host window's content bounds so mouse events actually land.
  controller.on('tab-created', ({ pageId }: { pageId: string }) => {
    const b = hostWindow!.getContentBounds();
    controller!.setBounds(pageId, { x: 0, y: 0, width: b.width, height: b.height });
  });

  httpServer = await startFixtureServer(FIXTURES_DIR);
  console.log(`[parity] fixtures served at ${httpServer.base}`);

  const results: TestResult[] = await runAll({
    controller,
    httpBase: httpServer.base,
    cases: CASES,
  });

  // report
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log('');
  console.log(`[parity] ${passed}/${results.length} passed`);
  for (const r of failed) {
    console.log(`  FAIL  ${r.name}`);
    if (r.error) console.log(`        ${r.error}`);
  }

  try {
    writeFileSync(
      RESULTS_PATH,
      JSON.stringify({ total: results.length, passed, failed: failed.length, results }, null, 2),
    );
  } catch (err) {
    console.error('[parity] failed to write results:', err);
  }

  exitCode = failed.length === 0 ? 0 : 1;

  // tear down and exit
  try { await httpServer?.close(); } catch {}
  try {
    for (const p of controller!.listPages()) await controller!.destroyPage(p.pageId);
  } catch {}

  app.exit(exitCode);
});

app.on('window-all-closed', () => {
  // keep process alive; we control exit via app.exit(exitCode).
});

app.on('before-quit', () => {
  try { httpServer?.close(); } catch {}
});
