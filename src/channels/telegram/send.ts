import { extname } from 'node:path';
import { lookup } from 'mime-types';
import type { Api } from 'grammy';
import { InputFile } from 'grammy';
import { markdownToTelegramHtml } from './format.js';

const MSG_LIMIT = 4000; // safe margin below telegram's 4096

export function normalizeTelegramChatId(target: string): number | string {
  const trimmed = target.trim();
  // numeric chat id
  const num = Number(trimmed);
  if (!isNaN(num) && String(num) === trimmed) return num;
  // @username or channel id
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

// split long text into chunks that respect paragraph/line/sentence boundaries
// avoids splitting inside <pre> or <blockquote> tags
export function splitTelegramMessage(text: string, limit = MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitAt = -1;

    // try paragraph break
    const paraIdx = remaining.lastIndexOf('\n\n', limit);
    if (paraIdx > limit * 0.3) {
      splitAt = paraIdx;
    }

    // try line break
    if (splitAt < 0) {
      const lineIdx = remaining.lastIndexOf('\n', limit);
      if (lineIdx > limit * 0.3) {
        splitAt = lineIdx;
      }
    }

    // try sentence break
    if (splitAt < 0) {
      const sentIdx = remaining.lastIndexOf('. ', limit);
      if (sentIdx > limit * 0.3) {
        splitAt = sentIdx + 1;
      }
    }

    // hard split as last resort
    if (splitAt < 0) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendMedia(
  api: Api,
  chatId: number | string,
  mediaPath: string,
  caption?: string,
  replyTo?: number
): Promise<{ id: string; chatId: string }> {
  const mime = lookup(mediaPath) || 'application/octet-stream';
  const file = new InputFile(mediaPath);
  const replyParams = replyTo ? { message_id: replyTo } : undefined;
  const opts: any = {
    caption: caption ? markdownToTelegramHtml(caption) : undefined,
    parse_mode: 'HTML' as const,
    reply_parameters: replyParams,
  };

  let result;

  if (mime.startsWith('image/') && !mime.includes('svg')) {
    result = await api.sendPhoto(chatId, file, opts);
  } else if (mime.startsWith('video/')) {
    result = await api.sendVideo(chatId, file, opts);
  } else if (mime.startsWith('audio/')) {
    result = await api.sendAudio(chatId, file, opts);
  } else {
    result = await api.sendDocument(chatId, file, opts);
  }

  return {
    id: String(result.message_id),
    chatId: String(result.chat.id),
  };
}

export async function sendTelegramMessage(
  api: Api,
  target: string,
  text: string,
  opts?: { replyTo?: number; media?: string }
): Promise<{ id: string; chatId: string }> {
  const chatId = normalizeTelegramChatId(target);

  if (opts?.media) {
    return sendMedia(api, chatId, opts.media, text || undefined, opts.replyTo);
  }

  const html = markdownToTelegramHtml(text);
  const chunks = splitTelegramMessage(html);

  // send first chunk (with reply-to if any)
  const result = await api.sendMessage(chatId, chunks[0], {
    parse_mode: 'HTML',
    reply_parameters: opts?.replyTo ? { message_id: opts.replyTo } : undefined,
  });

  // send remaining chunks sequentially
  for (let i = 1; i < chunks.length; i++) {
    await api.sendMessage(chatId, chunks[i], { parse_mode: 'HTML' });
  }

  return {
    id: String(result.message_id),
    chatId: String(result.chat.id),
  };
}

export async function editTelegramMessage(
  api: Api,
  chatId: string,
  messageId: string,
  newText: string
): Promise<void> {
  const cid = normalizeTelegramChatId(chatId);
  const html = markdownToTelegramHtml(newText);
  const chunks = splitTelegramMessage(html);

  // edit the original message with the first chunk
  await api.editMessageText(cid, Number(messageId), chunks[0], { parse_mode: 'HTML' });

  // overflow chunks sent as new messages
  for (let i = 1; i < chunks.length; i++) {
    await api.sendMessage(cid, chunks[i], { parse_mode: 'HTML' });
  }
}

export async function deleteTelegramMessage(
  api: Api,
  chatId: string,
  messageId: string
): Promise<void> {
  const cid = normalizeTelegramChatId(chatId);
  await api.deleteMessage(cid, Number(messageId));
}
