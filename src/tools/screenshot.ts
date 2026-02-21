import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constrainImageSize } from '../image-utils.js';
import { platformAdapter } from '../platform/index.js';

export const screenshotTool = tool(
  'screenshot',
  'Take a screenshot of the current screen and save it to a file. Returns the file path and the image inline so the agent can see it.',
  {
    filename: z.string().optional().describe('Custom filename (without extension). Defaults to screenshot-<timestamp>'),
    display: z.number().optional().describe('Display number to capture (default: main display)'),
  },
  async (args) => {
    const name = args.filename || `screenshot-${Date.now()}`;
    const outPath = join(tmpdir(), `${name}.png`);

    try {
      await platformAdapter.captureScreen({
        outputPath: outPath,
        display: args.display,
        timeoutMs: 10_000,
      });

      const raw = await readFile(outPath);
      const buffer = await constrainImageSize(raw);
      const base64 = buffer.toString('base64');

      return {
        content: [
          { type: 'text' as const, text: outPath },
          { type: 'image' as const, data: base64, mimeType: 'image/png' },
        ],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Screenshot failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);
