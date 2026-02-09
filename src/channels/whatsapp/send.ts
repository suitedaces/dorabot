import { readFileSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { lookup } from 'mime-types';
import type { WASocket } from './session.js';
import { markdownToWhatsApp } from './format.js';

const MSG_LIMIT = 60000; // safe margin below whatsapp's 65536

export function toWhatsAppJid(target: string): string {
  let normalized = target.replace(/[\s\-\(\)]/g, '');
  if (normalized.includes('@g.us')) return normalized;
  normalized = normalized.replace(/^whatsapp:/i, '');
  if (normalized.startsWith('+')) normalized = normalized.slice(1);
  if (!normalized.includes('@')) normalized += '@s.whatsapp.net';
  return normalized;
}

export function splitWhatsAppMessage(text: string, limit = MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitAt = -1;

    const paraIdx = remaining.lastIndexOf('\n\n', limit);
    if (paraIdx > limit * 0.3) splitAt = paraIdx;

    if (splitAt < 0) {
      const lineIdx = remaining.lastIndexOf('\n', limit);
      if (lineIdx > limit * 0.3) splitAt = lineIdx;
    }

    if (splitAt < 0) {
      const sentIdx = remaining.lastIndexOf('. ', limit);
      if (sentIdx > limit * 0.3) splitAt = sentIdx + 1;
    }

    if (splitAt < 0) splitAt = limit;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function buildMediaContent(mediaPath: string, caption?: string): Record<string, any> {
  const stat = statSync(mediaPath);
  if (stat.size > 64 * 1024 * 1024) {
    throw new Error(`File too large (${stat.size} bytes), max 64MB`);
  }

  const buffer = readFileSync(mediaPath);
  const ext = extname(mediaPath).toLowerCase();
  const mime = lookup(mediaPath) || 'application/octet-stream';

  if (mime.startsWith('image/') && !mime.includes('svg')) {
    return { image: buffer, caption };
  }
  if (mime.startsWith('video/')) {
    return { video: buffer, caption };
  }
  if (mime.startsWith('audio/')) {
    const ptt = ext === '.ogg' || ext === '.opus';
    return { audio: buffer, ptt };
  }
  return { document: buffer, mimetype: mime, fileName: basename(mediaPath), caption };
}

export async function sendWhatsAppMessage(
  sock: WASocket,
  target: string,
  text: string,
  opts?: { replyTo?: string; media?: string }
): Promise<{ id: string; chatId: string }> {
  const jid = toWhatsAppJid(target);

  // build minimal quoted message for reply-to
  const quoted = opts?.replyTo
    ? { quoted: { key: { remoteJid: jid, id: opts.replyTo, fromMe: false } } }
    : undefined;

  if (opts?.media) {
    const content = buildMediaContent(opts.media, text || undefined);
    const result = await sock.sendMessage(jid, content as any, quoted);
    return { id: result?.key?.id || `wa-${Date.now()}`, chatId: jid };
  }

  // format and chunk
  const formatted = markdownToWhatsApp(text);
  const chunks = splitWhatsAppMessage(formatted);

  // send first chunk with reply-to
  const result = await sock.sendMessage(jid, { text: chunks[0] } as any, quoted);

  // send remaining chunks sequentially
  for (let i = 1; i < chunks.length; i++) {
    await sock.sendMessage(jid, { text: chunks[i] } as any);
  }

  return { id: result?.key?.id || `wa-${Date.now()}`, chatId: jid };
}

export async function editWhatsAppMessage(
  sock: WASocket,
  messageId: string,
  newText: string,
  chatId: string
): Promise<void> {
  const jid = toWhatsAppJid(chatId);
  const formatted = markdownToWhatsApp(newText);
  await sock.sendMessage(jid, {
    text: formatted,
    edit: { remoteJid: jid, id: messageId, fromMe: true } as any,
  });
}

export async function deleteWhatsAppMessage(
  sock: WASocket,
  messageId: string,
  chatId: string
): Promise<void> {
  const jid = toWhatsAppJid(chatId);
  await sock.sendMessage(jid, {
    delete: { remoteJid: jid, id: messageId, fromMe: true } as any,
  });
}
