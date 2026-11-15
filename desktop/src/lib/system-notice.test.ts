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
});
