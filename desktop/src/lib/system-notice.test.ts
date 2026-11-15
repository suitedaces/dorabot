import { describe, expect, it } from 'vitest';
import { noticeFromSystem } from './system-notice';

// shapes copied from events in the local dorabot.db
describe('noticeFromSystem', () => {
  it('safety stop without a fallback is an error with the reason', () => {
    const n = noticeFromSystem({ type: 'system', subtype: 'model_refusal_no_fallback', original_model: 'claude-opus-5-5', request_id: 'r', api_refusal_category: 'reasoning_extraction', api_refusal_explanation: 'This request was blocked as it seems to violate the terms.', content: '' });
    expect(n?.level).toBe('error');
    expect(n?.text).toBe("The safety classifier stopped claude-opus-5-5's response");
    expect(n?.detail).toBe('reasoning_extraction: This request was blocked as it seems to violate the terms.');
  });

  it('safety stop with a fallback says which model took over and that text was withdrawn', () => {
    const n = noticeFromSystem({ type: 'system', subtype: 'model_refusal_fallback', original_model: 'claude-opus-5-5', fallback_model: 'claude-opus-4-8', content: '', retracted_message_uuids: ['a'] });
    expect(n?.text).toBe('The safety classifier stopped claude-opus-5-5; retried on claude-opus-4-8');
    expect(n?.detail).toContain('withdrawn');
  });

  it('api retries share a key so repeats collapse into one row', () => {
    const n = noticeFromSystem({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: 'overloaded' });
    expect(n?.key).toBe('api_retry');
    expect(n?.text).toBe('API error 529 (overloaded): retrying, attempt 2 of 10, in 4s');
  });

  it('informational notices show unless they are transcript-only', () => {
    expect(noticeFromSystem({ type: 'system', subtype: 'informational', level: 'notice', content: "Opus 5.5's safeguards stopped the response above · continuing once with that noted" })?.text).toContain('safeguards');
    expect(noticeFromSystem({ type: 'system', subtype: 'informational', level: 'info', content: 'x' })).toBeNull();
  });

  it('ignores bookkeeping events', () => {
    expect(noticeFromSystem({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 700 })).toBeNull();
    expect(noticeFromSystem({ type: 'system', subtype: 'task_progress' })).toBeNull();
  });

  it('compaction says how much context was dropped', () => {
    const n = noticeFromSystem({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 967665, post_tokens: 20982, duration_ms: 111057 } });
    expect(n?.text).toBe('Context was full, so it was compacted: 968k → 21k tokens · 111s');
  });

  it('shipped code links to the pull request', () => {
    const n = noticeFromSystem({ type: 'system', subtype: 'code_change_published', provider: 'github', url: 'https://github.com/suitedaces/dorabot/pull/65', repo: 'suitedaces/dorabot', identifier: '65', action: 'pushed' });
    expect(n?.text).toBe('Pushed to suitedaces/dorabot#65');
    expect(n?.url).toBe('https://github.com/suitedaces/dorabot/pull/65');
  });

  it('hooks show only when they fail', () => {
    expect(noticeFromSystem({ type: 'system', subtype: 'hook_response', hook_name: 'SessionStart:compact', outcome: 'success', exit_code: 0 })).toBeNull();
    const n = noticeFromSystem({ type: 'system', subtype: 'hook_response', hook_name: 'PreToolUse:Bash', outcome: 'error', exit_code: 2, stderr: 'blocked: rm -rf' });
    expect(n?.text).toBe('Hook PreToolUse:Bash failed (exit 2)');
    expect(n?.detail).toBe('blocked: rm -rf');
  });

  it("a denial the user clicked is left to the tool's own row", () => {
    expect(noticeFromSystem({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', decision_reason_type: 'user', message: 'x' })).toBeNull();
    expect(noticeFromSystem({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', decision_reason_type: 'rule', message: 'denied by rule Bash(rm:*)' })?.text).toBe('Not allowed: Bash · denied by rule Bash(rm:*)');
  });

  it("a subagent's api retry comes from its progress heartbeat", () => {
    const n = noticeFromSystem({ type: 'tool_progress', tool_use_id: 't1', subagent_retry: { agent_id: 'a', attempt: 1, max_retries: 10, retry_delay_ms: 2000, error_status: 529 } });
    expect(n?.key).toBe('subagent_retry:t1');
    expect(n?.text).toBe('Subagent API error 529: retrying, attempt 1 of 10, in 2s');
  });

  it('saved files and recalled memories', () => {
    expect(noticeFromSystem({ type: 'system', subtype: 'files_persisted', files: [{ filename: 'a', file_id: '1' }], failed: [] })?.text).toBe('Saved 1 file');
    expect(noticeFromSystem({ type: 'system', subtype: 'files_persisted', files: [], failed: [{ filename: 'b.png', error: 'too big' }] })?.level).toBe('warning');
    expect(noticeFromSystem({ type: 'system', subtype: 'memory_recall', mode: 'select', memories: [{ path: 'MEMORY.md', scope: 'personal' }] })?.text).toBe('Recalled 1 memory');
  });
});
