// sdk system events worth showing in the chat: safety stops, api retries, cli notices.
// used for live events and for history loaded from the db.

export type NoticeLevel = 'notice' | 'warning' | 'error';
export type Notice = { kind: string; level: NoticeLevel; text: string; detail?: string; key?: string };

const secs = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`);

export function noticeFromSystem(m: any): Notice | null {
  if (!m || m.type !== 'system') return null;
  switch (m.subtype) {
    case 'model_refusal_fallback': {
      const why = [m.api_refusal_category, m.api_refusal_explanation].filter(Boolean).join(': ');
      return {
        kind: 'refusal', level: 'warning',
        text: m.content || `The safety classifier stopped ${m.original_model}; retried on ${m.fallback_model}`,
        detail: [why, m.retracted_message_uuids?.length ? 'The stopped part of the response was withdrawn.' : ''].filter(Boolean).join('\n') || undefined,
      };
    }
    case 'model_refusal_no_fallback': {
      const why = [m.api_refusal_category, m.api_refusal_explanation].filter(Boolean).join(': ');
      return { kind: 'refusal', level: 'error', text: m.content || `The safety classifier stopped ${m.original_model}'s response`, detail: why || undefined };
    }
    case 'api_retry': {
      const what = m.no_response ? `no response after ${secs(m.no_response.waited_ms)}` : `API error${m.error_status ? ` ${m.error_status}` : ''}${m.error ? ` (${String(m.error).replace(/_/g, ' ')})` : ''}`;
      return { kind: 'retry', level: 'notice', key: 'api_retry', text: `${what}: retrying, attempt ${m.attempt} of ${m.max_retries}, in ${secs(m.retry_delay_ms)}` };
    }
    case 'informational': {
      if (m.level === 'info' || !m.content) return null;
      return { kind: 'info', level: m.level === 'warning' ? 'warning' : 'notice', text: m.content, key: m.tag ? `info:${m.tag}` : undefined };
    }
    case 'notification':
      if (!m.text) return null;
      return { kind: 'info', level: m.priority === 'high' || m.priority === 'immediate' ? 'warning' : 'notice', text: m.text, key: m.key ? `notification:${m.key}` : undefined };
    case 'session_writes_lost':
      return { kind: 'error', level: 'error', text: `Could not save ${(m.lost || []).join(' and ') || 'the session'}: ${m.error_code === 'ENOSPC' ? 'the disk is full' : 'the disk quota is used up'}` };
    case 'mirror_error':
      return { kind: 'error', level: 'warning', text: `Session mirror failed: ${m.error}` };
  }
  return null;
}
