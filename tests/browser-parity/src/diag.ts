// diag — standalone probe for diagnosing why snapshots come back empty
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { BrowserController } from '../../../desktop/electron/browser-controller';
import { installFakeBrowserHost } from './fake-host';
import { startFixtureServer } from './http-server';
import { browserSnapshot } from '../../../src/browser/actions';

// see note in main.ts: tsconfig rootDir shifts __dirname 4 levels deep.
const FIXTURES_DIR = join(process.cwd(), 'fixtures');

app.commandLine.appendSwitch('disable-gpu-compositing');

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const hostWindow = new BrowserWindow({
    show: true,
    width: 1280,
    height: 800,
    x: -2000,
    y: -2000,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: false },
  });
  hostWindow.setMenu(null);

  const controller = new BrowserController();
  controller.setHostWindow(hostWindow);
  installFakeBrowserHost(controller);

  controller.on('tab-created', ({ pageId }: { pageId: string }) => {
    const b = hostWindow.getContentBounds();
    controller.setBounds(pageId, { x: 0, y: 0, width: b.width, height: b.height });
  });

  const server = await startFixtureServer(FIXTURES_DIR);
  console.log(`[diag] fixtures at ${server.base}`);

  const pageId = await controller.createPage({ url: `${server.base}/basic.html` });
  console.log(`[diag] created page ${pageId}`);

  // wait for readyState complete
  for (let i = 0; i < 100; i++) {
    const out = await controller.sendCdp(pageId, 'Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    }) as any;
    console.log(`[diag] attempt ${i}: readyState=${out?.result?.value}`);
    if (out?.result?.value === 'complete') break;
    await new Promise((r) => setTimeout(r, 50));
  }

  // try AX tree directly
  const ax = await controller.sendCdp(pageId, 'Accessibility.getFullAXTree', {}) as any;
  console.log(`[diag] ax tree node count: ${ax?.nodes?.length ?? 'unknown'}`);
  if (ax?.nodes?.length) {
    console.log('[diag] first few nodes:');
    for (const n of ax.nodes.slice(0, 8)) {
      console.log(`  ${JSON.stringify({ id: n.nodeId, role: n.role?.value, name: n.name?.value, backendDOMNodeId: n.backendDOMNodeId })}`);
    }
  }

  // eval body innerHTML
  const body = await controller.sendCdp(pageId, 'Runtime.evaluate', {
    expression: 'document.body?.innerHTML || "(no body)"',
    returnByValue: true,
  }) as any;
  console.log(`[diag] body innerHTML: ${String(body?.result?.value).slice(0, 200)}`);

  // now run browserSnapshot
  const snap = await browserSnapshot({ pageId });
  console.log('[diag] browserSnapshot output:');
  console.log(snap.text);

  // --- click dispatch probe ---
  // get button rect
  const rect = await controller.sendCdp(pageId, 'Runtime.evaluate', {
    expression: '(() => { const r = document.getElementById("btn").getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2, w: innerWidth, h: innerHeight}); })()',
    returnByValue: true,
  }) as any;
  console.log(`[diag] button rect+viewport: ${rect?.result?.value}`);
  const p = JSON.parse(rect.result.value);

  // dispatch mouseMoved + mousePressed + mouseReleased manually
  const probeResult = async (label: string) => {
    const out = await controller.sendCdp(pageId, 'Runtime.evaluate', {
      expression: '({ out: document.getElementById("out").textContent, active: document.activeElement?.id })',
      returnByValue: true,
    }) as any;
    console.log(`[diag] ${label}: ${JSON.stringify(out?.result?.value)}`);
  };

  await probeResult('pre-click');
  await controller.sendCdp(pageId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
  await probeResult('after mouseMoved');
  await controller.sendCdp(pageId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await probeResult('after mousePressed');
  await controller.sendCdp(pageId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await probeResult('after mouseReleased');
  await new Promise((r) => setTimeout(r, 200));
  await probeResult('after 200ms settle');

  // try Electron native sendInputEvent (bypasses CDP debugger)
  const entry = (controller as any).entries.get(pageId);
  const wc = entry.view.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y } as any);
  wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 } as any);
  wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 } as any);
  await new Promise((r) => setTimeout(r, 200));
  await probeResult('after sendInputEvent');

  // try dispatching a synthetic DOM click event via Runtime
  await controller.sendCdp(pageId, 'Runtime.evaluate', {
    expression: 'document.getElementById("btn").click()',
  });
  await probeResult('after DOM .click()');

  await controller.destroyPage(pageId);
  await server.close();
  app.exit(0);
});

app.on('window-all-closed', () => {});
