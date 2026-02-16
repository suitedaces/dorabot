import type { Config } from '../config.js';
import { getDb, indexMessageForSearch } from '../db.js';

export type SessionMetadata = {
  channel?: string;
  chatId?: string;
  chatType?: string;
  senderName?: string;
  sdkSessionId?: string;
};

export type SessionInfo = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  path: string;
  channel?: string;
  chatId?: string;
  chatType?: string;
  senderName?: string;
  preview?: string;
};

export type MessageMetadata = {
  channel?: string;
  chatId?: string;
  chatType?: string;
  senderName?: string;
  body?: string;
  replyToId?: string;
  mediaType?: string;
  mediaPath?: string;
  tools?: string[];
  usage?: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  durationMs?: number;
};

export type SessionMessage = {
  type: 'user' | 'assistant' | 'system' | 'result';
  uuid?: string;
  timestamp: string;
  content: unknown;
  metadata?: MessageMetadata;
};

export class SessionManager {
  constructor(_config: Config) {
    // ensure db is initialized
    getDb();
  }

  setMetadata(sessionId: string, meta: Partial<SessionMetadata>): void {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;
    if (existing) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (meta.channel !== undefined) { sets.push('channel = ?'); vals.push(meta.channel); }
      if (meta.chatId !== undefined) { sets.push('chat_id = ?'); vals.push(meta.chatId); }
      if (meta.chatType !== undefined) { sets.push('chat_type = ?'); vals.push(meta.chatType); }
      if (meta.senderName !== undefined) { sets.push('sender_name = ?'); vals.push(meta.senderName); }
      if (meta.sdkSessionId !== undefined) { sets.push('sdk_session_id = ?'); vals.push(meta.sdkSessionId); }
      if (sets.length > 0) {
        sets.push('updated_at = ?');
        vals.push(new Date().toISOString());
        vals.push(sessionId);
        db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
    } else {
      db.prepare(`
        INSERT INTO sessions (id, channel, chat_id, chat_type, sender_name, sdk_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        meta.channel || null,
        meta.chatId || null,
        meta.chatType || null,
        meta.senderName || null,
        meta.sdkSessionId || null,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    }
  }

  getMetadata(sessionId: string): SessionMetadata | undefined {
    const db = getDb();
    const row = db.prepare('SELECT channel, chat_id, chat_type, sender_name, sdk_session_id FROM sessions WHERE id = ?').get(sessionId) as {
      channel: string | null;
      chat_id: string | null;
      chat_type: string | null;
      sender_name: string | null;
      sdk_session_id: string | null;
    } | undefined;
    if (!row) return undefined;
    return {
      channel: row.channel || undefined,
      chatId: row.chat_id || undefined,
      chatType: row.chat_type || undefined,
      senderName: row.sender_name || undefined,
      sdkSessionId: row.sdk_session_id || undefined,
    };
  }

  generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `session-${timestamp}-${random}`;
  }

  exists(sessionId: string): boolean {
    const db = getDb();
    return !!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
  }

  load(sessionId: string): SessionMessage[] {
    const db = getDb();
    const rows = db.prepare('SELECT type, uuid, timestamp, content, metadata FROM messages WHERE session_id = ? ORDER BY id').all(sessionId) as {
      type: string;
      uuid: string | null;
      timestamp: string;
      content: string;
      metadata: string | null;
    }[];

    return rows.map(row => ({
      type: row.type as SessionMessage['type'],
      uuid: row.uuid || undefined,
      timestamp: row.timestamp,
      content: JSON.parse(row.content),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  append(sessionId: string, message: SessionMessage): void {
    const db = getDb();
    const now = new Date().toISOString();
    const contentStr = JSON.stringify(message.content);

    (this._appendTx ??= db.transaction((sid: string, msg: SessionMessage, ts: string, content: string) => {
      db.prepare(`
        INSERT INTO sessions (id, created_at, updated_at, message_count)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(id) DO NOTHING
      `).run(sid, ts, ts);

      const result = db.prepare(`
        INSERT INTO messages (session_id, uuid, type, content, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        sid,
        msg.uuid || null,
        msg.type,
        content,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
        msg.timestamp,
      );

      // index for FTS search
      indexMessageForSearch(Number(result.lastInsertRowid), content, msg.type);

      db.prepare(`
        UPDATE sessions SET updated_at = ?, last_message_at = ?
        WHERE id = ?
      `).run(ts, Date.now(), sid);
    }))(sessionId, message, now, contentStr);
  }

  private _appendTx: ReturnType<ReturnType<typeof getDb>['transaction']> | null = null;

  save(sessionId: string, messages: SessionMessage[]): void {
    const db = getDb();
    const now = new Date().toISOString();

    const run = db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

      const insert = db.prepare(`
        INSERT INTO messages (session_id, uuid, type, content, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const msg of messages) {
        insert.run(
          sessionId,
          msg.uuid || null,
          msg.type,
          JSON.stringify(msg.content),
          msg.metadata ? JSON.stringify(msg.metadata) : null,
          msg.timestamp,
        );
      }

      db.prepare(`
        INSERT INTO sessions (id, created_at, updated_at, message_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET message_count = ?, updated_at = ?
      `).run(sessionId, now, now, messages.length, messages.length, now);
    });
    run();
  }

  list(): SessionInfo[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        s.id,
        s.channel,
        s.chat_id,
        s.chat_type,
        s.sender_name,
        s.message_count,
        s.created_at,
        s.updated_at,
        (
          SELECT m.content
          FROM messages m
          WHERE m.session_id = s.id AND m.type = 'user'
          ORDER BY m.id ASC
          LIMIT 1
        ) AS first_user_content
      FROM sessions s
      ORDER BY s.updated_at DESC
    `).all() as {
      id: string;
      channel: string | null;
      chat_id: string | null;
      chat_type: string | null;
      sender_name: string | null;
      message_count: number;
      created_at: string | null;
      updated_at: string | null;
      first_user_content: string | null;
    }[];

    return rows.map(row => ({
      id: row.id,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || new Date().toISOString(),
      messageCount: row.message_count,
      path: '', // no longer file-backed
      channel: row.channel || undefined,
      chatId: row.chat_id || undefined,
      chatType: row.chat_type || undefined,
      senderName: row.sender_name || undefined,
      preview: extractFirstUserPreview(row.first_user_content),
    }));
  }

  getLatest(): SessionInfo | null {
    const sessions = this.list();
    return sessions[0] || null;
  }

  delete(sessionId: string): boolean {
    const db = getDb();
    const result = db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      const r = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return r.changes > 0;
    })();
    return result;
  }

  getResumeId(sessionId: string): string | undefined {
    if (this.exists(sessionId)) {
      return sessionId;
    }
    return undefined;
  }
}

function extractFirstUserPreview(content: string | null): string | undefined {
  if (!content) return undefined;
  try {
    const parsed = JSON.parse(content) as any;
    const blocks = parsed?.message?.content;
    if (typeof blocks === 'string') {
      return blocks.slice(0, 140);
    }
    if (Array.isArray(blocks)) {
      const text = blocks
        .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join(' ')
        .trim();
      return text ? text.slice(0, 140) : undefined;
    }
  } catch {
    // ignore parse errors and fallback to undefined
  }
  return undefined;
}

// helper to convert SDK messages to our session format
export function sdkMessageToSession(msg: unknown): SessionMessage | null {
  const m = msg as Record<string, unknown>;
  if (!m || typeof m !== 'object') return null;

  const type = m.type as string;
  if (!['user', 'assistant', 'system', 'result'].includes(type)) {
    return null;
  }

  return {
    type: type as SessionMessage['type'],
    uuid: m.uuid as string | undefined,
    timestamp: new Date().toISOString(),
    content: m,
  };
}
