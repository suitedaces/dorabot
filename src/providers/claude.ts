import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

export class ClaudeProvider implements Provider {
  readonly name = 'claude';

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { ready: false, reason: 'ANTHROPIC_API_KEY not set' };
    }
    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { authenticated: false, error: 'ANTHROPIC_API_KEY not set' };
    }
    return { authenticated: true, method: 'api_key' };
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    process.env.ANTHROPIC_API_KEY = apiKey;
    return { authenticated: true, method: 'api_key' };
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const q = query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        tools: { type: 'preset', preset: 'claude_code' } as any,
        agents: opts.agents as any,
        hooks: opts.hooks as any,
        mcpServers: opts.mcpServer as any,
        resume: opts.resumeId,
        permissionMode: opts.config.permissionMode as any,
        allowDangerouslySkipPermissions: opts.config.permissionMode === 'bypassPermissions',
        sandbox: opts.sandbox as any,
        cwd: opts.cwd,
        env: opts.env,
        maxTurns: opts.maxTurns,
        includePartialMessages: true,
        canUseTool: opts.canUseTool as any,
        abortController: opts.abortController,
        stderr: (data: string) => console.error(`[claude:stderr] ${data.trimEnd()}`),
      },
    });

    let result = '';
    let sessionId = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

    for await (const msg of q) {
      yield msg as ProviderMessage;

      const m = msg as Record<string, unknown>;
      if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
        sessionId = m.session_id as string;
      }
      if (m.type === 'assistant' && m.message) {
        const content = (m.message as any)?.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === 'text') result = b.text;
          }
        }
      }
      if (m.type === 'result') {
        result = (m.result as string) || result;
        sessionId = (m.session_id as string) || sessionId;
        const u = m.usage as Record<string, number> | undefined;
        usage = {
          inputTokens: u?.input_tokens || 0,
          outputTokens: u?.output_tokens || 0,
          totalCostUsd: (m.total_cost_usd as number) || 0,
        };
      }
    }

    return { result, sessionId, usage };
  }
}
