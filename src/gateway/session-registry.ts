import type { SessionInfo } from './types.js';
import { getDb } from '../db.js';

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private activeRuns = new Set<string>();

  constructor() {
    // ensure db is initialized
    getDb();
  }

  loadFromDisk(): void {
    try {
      const db = getDb();
      const rows = db.prepare(`
        SELECT id, channel, chat_id, chat_type, sdk_session_id, message_count, last_message_at
        FROM sessions
      `).all() as {
        id: string;
        channel: string | null;
        chat_id: string | null;
        chat_type: string | null;
        sdk_session_id: string | null;
        message_count: number;
        last_message_at: number | null;
      }[];

      for (const row of rows) {
        if (!row.channel || !row.chat_id) continue;
        const chatType = row.chat_type || 'dm';
        const key = `${row.channel}:${chatType}:${row.chat_id}`;
        this.sessions.set(key, {
          key,
          channel: row.channel,
          chatId: row.chat_id,
          chatType,
          sessionId: row.id,
          sdkSessionId: row.sdk_session_id || undefined,
          messageCount: row.message_count,
          lastMessageAt: row.last_message_at || 0,
          activeRun: false,
        });
      }
      console.log(`[registry] loaded ${this.sessions.size} sessions from db`);
    } catch (err) {
      console.error('[registry] failed to load from db:', err);
    }
  }

  saveToDisk(): void {
    // no-op — writes happen inline
  }

  makeKey(msg: { channel: string; chatType?: string; chatId: string }): string {
    const sanitizedChatId = msg.chatId.replace(/[\/\\\.]+/g, '_').replace(/^_+|_+$/g, '');
    return `${msg.channel}:${msg.chatType || 'dm'}:${sanitizedChatId}`;
  }

  getOrCreate(msg: { channel: string; chatType?: string; chatId: string; sessionId?: string }): SessionInfo {
    const key = this.makeKey(msg);
    let session = this.sessions.get(key);
    if (!session) {
      const chatType = msg.chatType || 'dm';
      const sessionId = msg.sessionId || `${msg.channel}-${chatType}-${msg.chatId}-${Date.now()}`;
      const now = new Date().toISOString();

      const db = getDb();
      db.prepare(`
        INSERT INTO sessions (id, channel, chat_id, chat_type, created_at, updated_at, message_count, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(sessionId, msg.channel, msg.chatId, chatType, now, now, Date.now());

      session = {
        key,
        channel: msg.channel,
        chatId: msg.chatId,
        chatType,
        sessionId,
        sdkSessionId: undefined,
        messageCount: 0,
        lastMessageAt: Date.now(),
        activeRun: false,
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  setSdkSessionId(key: string, sdkSessionId: string | undefined): void {
    const s = this.sessions.get(key);
    if (s) {
      s.sdkSessionId = sdkSessionId;
      const db = getDb();
      db.prepare('UPDATE sessions SET sdk_session_id = ? WHERE id = ?').run(sdkSessionId || null, s.sessionId);
    }
  }

  get(key: string): SessionInfo | undefined {
    return this.sessions.get(key);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  incrementMessages(key: string): void {
    const s = this.sessions.get(key);
    if (s) {
      s.messageCount++;
      s.lastMessageAt = Date.now();
      const db = getDb();
      db.prepare('UPDATE sessions SET message_count = message_count + 1, last_message_at = ? WHERE id = ?').run(s.lastMessageAt, s.sessionId);
    }
  }

  setActiveRun(key: string, active: boolean): void {
    const s = this.sessions.get(key);
    if (s) s.activeRun = active;
    if (active) this.activeRuns.add(key);
    else this.activeRuns.delete(key);
  }

  hasActiveRun(): boolean {
    return this.activeRuns.size > 0;
  }

  getActiveRunKeys(): string[] {
    return Array.from(this.activeRuns);
  }

  remove(key: string): boolean {
    this.activeRuns.delete(key);
    // only remove from in-memory map — old session row stays in DB so it's
    // still browsable in sessions.list and messages aren't orphaned
    return this.sessions.delete(key);
  }

  clear(): void {
    this.sessions.clear();
    this.activeRuns.clear();
  }
}
