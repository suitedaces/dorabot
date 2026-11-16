// sdk system events worth showing in the chat: safety stops, api retries, cli notices.
// used for live events and for history loaded from the db.

export type NoticeLevel = 'notice' | 'warning' | 'error';
export type Notice = { kind: string; level: NoticeLevel; text: string; detail?: string; key?: string; url?: string };

const secs = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`);

export function noticeFromSystem(m: any): Notice | null {
  if (!m) return null;
  // a subagent's own api retry arrives on its tool_progress heartbeat
  if (m.type === 'tool_progress' && m.subagent_retry) {
    const r = m.subagent_retry;
    return { kind: 'retry', level: 'notice', key: `subagent_retry:${m.tool_use_id}`, text: `Subagent API error${r.error_status ? ` (${r.error_status})` : ''}, retrying` };
  }
  if (m.type !== 'system') return null;
  switch (m.subtype) {
    case 'compact_boundary': {
      const c = m.compact_metadata || {};
      return { kind: 'compact', level: 'notice', text: c.trigger === 'manual' ? 'You compacted the context' : 'Context was full, so it was compacted' };
    }
    case 'code_change_published': {
      const what = m.identifier ? `${m.repo}#${m.identifier}` : m.repo || m.url;
      const verb = m.action === 'opened' || m.action === 'created' ? 'Opened' : m.action === 'merged' ? 'Merged' : 'Pushed to';
      return { kind: 'ship', level: 'notice', text: `${verb} ${what}`, url: m.url };
    }
    case 'hook_response': {
      if (m.outcome === 'success' && (m.exit_code ?? 0) === 0) return null;
      const out = [m.stderr, m.output, m.stdout].find((x: unknown) => typeof x === 'string' && x.trim());
      return { kind: 'error', level: 'warning', text: `Hook ${m.hook_name || m.hook_event} ${m.outcome === 'cancelled' ? 'was cancelled' : `failed${m.exit_code != null ? ` (exit ${m.exit_code})` : ''}`}`, detail: out };
    }
    case 'memory_recall': {
      const list = (m.memories || []) as Array<{ path: string; scope: string }>;
      if (!list.length) return null;
      return { kind: 'info', level: 'notice', text: `Recalled ${list.length} memor${list.length === 1 ? 'y' : 'ies'}`, detail: list.map(x => `${x.path} (${x.scope})`).join('\n') };
    }
    case 'files_persisted': {
      const ok = (m.files || []).length, bad = (m.failed || []) as Array<{ filename: string; error: string }>;
      if (!ok && !bad.length) return null;
      return { kind: bad.length ? 'error' : 'info', level: bad.length ? 'warning' : 'notice', text: bad.length ? `Could not save ${bad.length} file${bad.length === 1 ? '' : 's'}` : `Saved ${ok} file${ok === 1 ? '' : 's'}`, detail: bad.map(f => `${f.filename}: ${f.error}`).join('\n') || undefined };
    }
    case 'permission_denied': {
      // a denial the user clicked already shows on the tool's own row
      if (m.decision_reason_type === 'user') return null;
      return { kind: 'error', level: 'warning', text: `Not allowed: ${m.tool_name}${m.message ? ` · ${m.message}` : ''}`, detail: m.decision_reason || undefined };
    }
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
    case 'watch': {
      const last = String(m.output || '').trimEnd().split('\n').pop() || '';
      const text = m.reason === 'done' ? `${m.summary} done` : m.reason === 'expired' ? `Stopped watching ${m.summary}` : last ? `${m.summary}: ${last}` : m.summary;
      return { kind: 'watch', level: 'notice', text, detail: m.output || undefined };
    }
    case 'api_retry': {
      const what = m.no_response ? `No response from the API after ${secs(m.no_response.waited_ms)}` : `API ${m.error ? String(m.error).replace(/_/g, ' ') : 'error'}${m.error_status ? ` (${m.error_status})` : ''}`;
      return { kind: 'retry', level: 'notice', key: 'api_retry', text: `${what}, retrying` };
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
