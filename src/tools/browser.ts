import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import {
  browserOpen,
  browserNavigatePage,
  browserSnapshot,
  browserScreenshot,
  browserClick,
  browserClickAt,
  browserDrag,
  browserType,
  browserFill,
  browserFillForm,
  browserSelect,
  browserPressKey,
  browserHover,
  browserUploadFile,
  browserHandleDialog,
  browserWaitForText,
  browserListPages,
  browserNewPage,
  browserClosePage,
  browserCookies,
  browserEvaluateScript,
  browserListConsoleMessages,
  browserGetConsoleMessage,
  browserListNetworkRequests,
  browserGetNetworkRequest,
  browserPdf,
  browserScroll,
  browserEmulate,
  browserResize,
  acquireBrowserMutex,
  browserStatus,
  browserStart,
  browserStop,
} from '../browser/actions.js';

// Kept for backwards compatibility with gateway startup wiring; no longer used
// by the tool (browser lives inside dorabot, no external config).
export type BrowserConfig = { executablePath?: string };
let _browserConfig: BrowserConfig = {};
export function setBrowserConfig(config: BrowserConfig) {
  _browserConfig = config;
}

const browserActions = [
  // Navigation
  'list_pages',
  'new_page',
  'close_page',
  'navigate',

  // Observation
  'snapshot',
  'screenshot',
  'pdf',

  // Interact
  'click',
  'click_at',
  'drag',
  'type',
  'fill',
  'fill_form',
  'select',
  'press_key',
  'hover',
  'upload_file',
  'scroll',

  // Inspection
  'evaluate_script',
  'list_console_messages',
  'get_console_message',
  'list_network_requests',
  'get_network_request',
  'cookies',
  'handle_dialog',
  'wait_for',

  // Device
  'emulate',
  'resize',

  // Legacy aliases (preserved so existing agent skills don't break)
  'open',
  'navigate_page',
  'take_snapshot',
  'take_screenshot',
  'tabs',
  'close_tab',
  'evaluate',
  'press',
  'status',
  'start',
  'stop',
] as const;

export const browserTool = tool(
  'browser',
  'Browser automation. Multi-tab, runs inside dorabot. Each per-tab action accepts pageId (omit to target user\'s focused tab). Flow: list_pages → new_page / snapshot → click/fill/type with includeSnapshot=true (returns fresh snapshot in same response). Refs (e1, e2, ...) survive reflows but reset on navigation. Use wait_for(text) for timing, not sleep.',
  {
    action: z.enum(browserActions),

    // Element refs (from snapshot)
    uid: z.string().optional().describe('Element ref from snapshot (e.g. "e5")'),
    ref: z.string().optional().describe('Alias for uid'),
    from_uid: z.string().optional().describe('Source element ref for drag'),
    from_ref: z.string().optional().describe('Alias for from_uid'),
    to_uid: z.string().optional().describe('Target element ref for drag'),
    to_ref: z.string().optional().describe('Alias for to_uid'),

    // Page scoping
    pageId: z.string().optional().describe('Tab id from list_pages. Omit to target the user\'s currently focused tab.'),

    // Navigation
    url: z.string().optional().describe('URL for new_page/navigate'),
    type: z.enum(['url', 'back', 'forward', 'reload']).optional().describe('Navigation type'),
    background: z.boolean().optional().describe('Open new tab in background'),

    // Click
    x: z.number().optional().describe('X coordinate for click_at'),
    y: z.number().optional().describe('Y coordinate for click_at'),
    dblClick: z.boolean().optional().describe('Double click when true'),

    // Input
    text: z.string().optional().describe('Text for type / wait_for'),
    value: z.string().optional().describe('Value for fill'),
    submit: z.boolean().optional().describe('Press Enter after type'),
    key: z.string().optional().describe('Key, e.g. Enter, Tab, ArrowDown'),
    values: z.array(z.string()).optional().describe('Values for select (array)'),
    elements: z
      .array(
        z.object({
          uid: z.string().optional(),
          ref: z.string().optional(),
          value: z.string(),
        }),
      )
      .optional()
      .describe('fill_form payload: [{uid|ref, value}]'),
    fields: z
      .array(z.object({ ref: z.string(), value: z.string() }))
      .optional()
      .describe('Legacy fill_form payload'),

    // Upload / dialog
    filePath: z.string().optional().describe('File path for upload_file, snapshot, screenshot, pdf'),
    dialogAction: z.enum(['accept', 'dismiss']).optional().describe('Action for handle_dialog'),
    promptText: z.string().optional().describe('Prompt text for dialog accept'),

    // Snapshot / screenshot
    interactiveOnly: z.boolean().optional().describe('Only interactive nodes in snapshot (flat list)'),
    interactive: z.boolean().optional().describe('Alias for interactiveOnly'),
    selector: z.string().optional().describe('CSS scope for snapshot'),
    format: z.enum(['png', 'jpeg']).optional().describe('Screenshot format'),
    quality: z.number().min(0).max(100).optional().describe('Screenshot quality (jpeg only)'),
    fullPage: z.boolean().optional().describe('Capture full page screenshot'),
    includeSnapshot: z.boolean().optional().describe('Include fresh snapshot in response'),

    // Scroll
    deltaX: z.number().optional().describe('Horizontal scroll px (default 0)'),
    deltaY: z.number().optional().describe('Vertical scroll px (default 300)'),

    // Wait
    timeout: z.number().optional().describe('Timeout in ms'),

    // Cookies
    cookieAction: z.enum(['get', 'set', 'clear']).optional().describe('Cookie action'),
    cookieName: z.string().optional(),
    cookieValue: z.string().optional(),
    cookieUrl: z.string().optional(),

    // Script eval
    function: z.string().optional().describe('JS function source for evaluate_script'),
    fn: z.string().optional().describe('Legacy alias for function'),
    args: z
      .array(z.object({ uid: z.string().optional(), ref: z.string().optional() }))
      .optional()
      .describe('Element refs to pass as function args'),

    // Console / network
    msgid: z.number().optional().describe('Console msgid for get_console_message'),
    reqid: z.number().optional().describe('Network reqid for get_network_request'),
    pageSize: z.number().int().positive().optional(),
    pageIdx: z.number().int().min(0).optional(),
    types: z.array(z.string()).optional().describe('Console message type filter'),
    includePreservedMessages: z.boolean().optional(),
    resourceTypes: z.array(z.string()).optional().describe('Network resource type filter'),
    includePreservedRequests: z.boolean().optional(),
    requestFilePath: z.string().optional().describe('Output file for request body'),
    responseFilePath: z.string().optional().describe('Output file for response body'),

    // Emulate
    userAgent: z.string().nullable().optional(),
    colorScheme: z.enum(['dark', 'light', 'auto']).optional(),
    networkConditions: z
      .enum(['No emulation', 'Offline', 'Slow 3G', 'Fast 3G', 'Slow 4G', 'Fast 4G'])
      .optional(),
    cpuThrottlingRate: z.number().optional(),
    geolocation: z.object({ latitude: z.number(), longitude: z.number() }).nullable().optional(),
    viewport: z
      .object({
        width: z.number(),
        height: z.number(),
        deviceScaleFactor: z.number().optional(),
        isMobile: z.boolean().optional(),
        isLandscape: z.boolean().optional(),
      })
      .nullable()
      .optional(),
    width: z.number().optional().describe('Width for resize'),
    height: z.number().optional().describe('Height for resize'),

    // Legacy paths
    path: z.string().optional().describe('Legacy alias for filePath (pdf)'),
  },
  async (args) => {
    const fail = (text: string) => ({
      content: [{ type: 'text' as const, text: `Error: ${text}` }],
      isError: true,
    });

    const ref = args.uid || args.ref;
    const fromRef = args.from_uid || args.from_ref;
    const toRef = args.to_uid || args.to_ref;
    const pageId = args.pageId;

    const release = await acquireBrowserMutex();
    try {
      let result;

      switch (args.action) {
        // Navigation
        case 'list_pages':
        case 'tabs':
          result = await browserListPages();
          break;

        case 'new_page':
          if (!args.url) return fail('url required');
          result = await browserNewPage(args.url, { background: args.background });
          break;

        case 'close_page':
        case 'close_tab':
          result = await browserClosePage(pageId);
          break;

        case 'navigate':
        case 'navigate_page':
        case 'open':
          if (args.action === 'open' || args.action === 'navigate' && !args.type) {
            if (!args.url) return fail('url required');
            result = await browserOpen(args.url, { pageId, includeSnapshot: args.includeSnapshot });
          } else {
            result = await browserNavigatePage({
              pageId,
              type: args.type,
              url: args.url,
              includeSnapshot: args.includeSnapshot,
            });
          }
          break;

        // Observation
        case 'snapshot':
        case 'take_snapshot':
          result = await browserSnapshot({
            pageId,
            selector: args.selector,
            filePath: args.filePath,
            interactiveOnly: args.interactiveOnly ?? args.interactive,
          });
          break;

        case 'screenshot':
        case 'take_screenshot':
          result = await browserScreenshot({
            pageId,
            fullPage: args.fullPage,
            ref,
            format: args.format === 'jpeg' ? 'jpeg' : 'png',
            quality: args.quality,
            filePath: args.filePath,
          });
          break;

        case 'pdf':
          result = await browserPdf({ pageId, filePath: args.path || args.filePath });
          break;

        // Interact
        case 'click':
          if (!ref) return fail('uid/ref required');
          result = await browserClick(ref, { pageId, dblClick: args.dblClick, includeSnapshot: args.includeSnapshot });
          break;

        case 'click_at':
          if (args.x === undefined || args.y === undefined) return fail('x and y required');
          result = await browserClickAt(args.x, args.y, { pageId, dblClick: args.dblClick, includeSnapshot: args.includeSnapshot });
          break;

        case 'drag':
          if (!fromRef || !toRef) return fail('from_uid and to_uid required');
          result = await browserDrag(fromRef, toRef, { pageId, includeSnapshot: args.includeSnapshot });
          break;

        case 'type': {
          const text = args.text ?? args.value;
          if (!ref || text === undefined) return fail('uid/ref and text required');
          result = await browserType(ref, text, { pageId, submit: args.submit, includeSnapshot: args.includeSnapshot });
          break;
        }

        case 'fill': {
          const value = args.value ?? args.text;
          if (!ref || value === undefined) return fail('uid/ref and value required');
          result = await browserFill(ref, value, { pageId, includeSnapshot: args.includeSnapshot });
          break;
        }

        case 'fill_form': {
          const elems = args.elements?.map((e) => ({ ref: (e.uid || e.ref)!, value: e.value }))
            ?? args.fields?.map((f) => ({ ref: f.ref, value: f.value }));
          if (!elems || elems.length === 0) return fail('elements or fields required');
          if (elems.some((e) => !e.ref)) return fail('each fill_form element must include uid/ref');
          result = await browserFillForm(elems, { pageId, includeSnapshot: args.includeSnapshot });
          break;
        }

        case 'select':
          if (!ref || !args.values || args.values.length === 0) return fail('uid/ref and values required');
          result = await browserSelect(ref, args.values, { pageId, includeSnapshot: args.includeSnapshot });
          break;

        case 'press':
        case 'press_key':
          if (!args.key) return fail('key required');
          result = await browserPressKey(args.key, { pageId, includeSnapshot: args.includeSnapshot });
          break;

        case 'hover':
          if (!ref) return fail('uid/ref required');
          result = await browserHover(ref, { pageId, includeSnapshot: args.includeSnapshot });
          break;

        case 'upload_file':
          if (!ref || !args.filePath) return fail('uid/ref and filePath required');
          result = await browserUploadFile(ref, args.filePath, { pageId, includeSnapshot: args.includeSnapshot });
          break;

        case 'scroll':
          result = await browserScroll({
            pageId,
            deltaX: args.deltaX,
            deltaY: args.deltaY,
            ref,
            includeSnapshot: args.includeSnapshot,
          });
          break;

        // Inspection
        case 'evaluate':
        case 'evaluate_script': {
          const fn = args.function || args.fn;
          if (!fn) return fail('function/fn required');
          result = await browserEvaluateScript(fn, { pageId, args: args.args });
          break;
        }

        case 'list_console_messages':
          result = await browserListConsoleMessages({
            pageId,
            pageSize: args.pageSize,
            pageIdx: args.pageIdx,
            types: args.types,
            includePreservedMessages: args.includePreservedMessages,
          });
          break;

        case 'get_console_message':
          if (args.msgid === undefined) return fail('msgid required');
          result = await browserGetConsoleMessage(args.msgid, { pageId });
          break;

        case 'list_network_requests':
          result = await browserListNetworkRequests({
            pageId,
            pageSize: args.pageSize,
            pageIdx: args.pageIdx,
            resourceTypes: args.resourceTypes,
            includePreservedRequests: args.includePreservedRequests,
          });
          break;

        case 'get_network_request':
          result = await browserGetNetworkRequest(args.reqid, {
            pageId,
            requestFilePath: args.requestFilePath,
            responseFilePath: args.responseFilePath,
          });
          break;

        case 'cookies':
          if (!args.cookieAction) return fail('cookieAction required');
          result = await browserCookies(args.cookieAction, {
            pageId,
            name: args.cookieName,
            value: args.cookieValue,
            url: args.cookieUrl,
          });
          break;

        case 'handle_dialog':
          if (!args.dialogAction) return fail('dialogAction required');
          result = await browserHandleDialog(args.dialogAction, { pageId, promptText: args.promptText });
          break;

        case 'wait_for':
          if (!args.text) return fail('text required');
          result = await browserWaitForText(args.text, { pageId, timeout: args.timeout });
          break;

        // Device
        case 'emulate':
          result = await browserEmulate({
            pageId,
            userAgent: args.userAgent,
            colorScheme: args.colorScheme,
            networkConditions: args.networkConditions,
            cpuThrottlingRate: args.cpuThrottlingRate,
            geolocation: args.geolocation,
            viewport: args.viewport,
          });
          break;

        case 'resize':
          if (args.width === undefined || args.height === undefined) return fail('width and height required');
          result = await browserResize(args.width, args.height, { pageId });
          break;

        // Legacy stubs
        case 'status':
          result = await browserStatus();
          break;

        case 'start':
          result = await browserStart();
          break;

        case 'stop':
          result = await browserStop();
          break;

        default:
          return fail(`Unknown action: ${args.action}`);
      }

      const content: any[] = [{ type: 'text' as const, text: result.text }];
      if (result.image) {
        content.push({
          type: 'image' as const,
          data: result.image,
          mimeType: result.mimeType || 'image/png',
        });
      }

      return {
        content,
        ...(result.isError ? { isError: true } : {}),
        ...(result.structured ? { structuredContent: result.structured } : {}),
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Browser error: ${e.message}` }],
        isError: true,
      };
    } finally {
      release();
    }
  },
);
