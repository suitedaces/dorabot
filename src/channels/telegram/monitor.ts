import { createTelegramBot, resolveTelegramToken } from './bot.js';
import { sendTelegramMessage, editTelegramMessage, deleteTelegramMessage } from './send.js';
import { registerChannelHandler } from '../../tools/messaging.js';
import type { InboundMessage } from '../types.js';
import { InlineKeyboard, type Bot } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';

export type ApprovalRequest = {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type QuestionRequest = {
  requestId: string;
  chatId: string;
  question: string;
  options: { label: string; description?: string }[];
};

export type TelegramMonitorOptions = {
  botToken?: string;
  tokenFile?: string;
  accountId?: string;
  allowFrom?: string[];
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  onMessage?: (msg: InboundMessage) => Promise<void>;
  onCommand?: (cmd: string, chatId: string) => Promise<string | void>;
  onApprovalResponse?: (requestId: string, approved: boolean, reason?: string) => void;
  onQuestionResponse?: (requestId: string, selectedIndex: number, label: string) => void;
  abortSignal?: AbortSignal;
};

export type TelegramMonitorHandle = {
  stop: () => Promise<void>;
  sendApprovalRequest: (req: ApprovalRequest) => Promise<void>;
  sendQuestion: (req: QuestionRequest) => Promise<void>;
};

export async function startTelegramMonitor(opts: TelegramMonitorOptions): Promise<TelegramMonitorHandle> {
  const token = resolveTelegramToken(opts.tokenFile);
  const bot: Bot = createTelegramBot({ token });

  // register channel handler for the message tool
  registerChannelHandler('telegram', {
    send: async (target, message, sendOpts) => {
      const replyTo = sendOpts?.replyTo ? Number(sendOpts.replyTo) : undefined;
      return sendTelegramMessage(bot.api, target, message, {
        replyTo,
        media: sendOpts?.media,
      });
    },
    edit: async (messageId, message, chatId) => {
      if (!chatId) throw new Error('chatId required for Telegram edit');
      await editTelegramMessage(bot.api, chatId, messageId, message);
    },
    delete: async (messageId, chatId) => {
      if (!chatId) throw new Error('chatId required for Telegram delete');
      await deleteTelegramMessage(bot.api, chatId, messageId);
    },
    typing: async (chatId) => {
      try {
        await bot.api.sendChatAction(Number(chatId), 'typing');
      } catch {}
    },
  });

  // bot commands
  if (opts.onCommand) {
    const onCmd = opts.onCommand;
    bot.command('new', async (ctx) => {
      const senderId = String(ctx.from?.id || '');
      if (opts.allowFrom && opts.allowFrom.length > 0 && !opts.allowFrom.includes(senderId)) return;
      const chatId = String(ctx.chat.id);
      const reply = await onCmd('new', chatId);
      if (reply) await ctx.reply(reply);
    });
    bot.command('status', async (ctx) => {
      const senderId = String(ctx.from?.id || '');
      if (opts.allowFrom && opts.allowFrom.length > 0 && !opts.allowFrom.includes(senderId)) return;
      const chatId = String(ctx.chat.id);
      const reply = await onCmd('status', chatId);
      if (reply) await ctx.reply(reply);
    });
  }

  // handle callback queries (approvals + questions)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const sep = data.indexOf(':');
    if (sep < 0) return;

    const action = data.slice(0, sep);

    // question response: q:{requestId}:{optionIndex}
    if (action === 'q') {
      const rest = data.slice(sep + 1);
      const sep2 = rest.indexOf(':');
      if (sep2 < 0) return;
      const requestId = rest.slice(0, sep2);
      const optionIndex = parseInt(rest.slice(sep2 + 1), 10);
      const buttonText = ctx.callbackQuery.data;
      // find the label from the inline keyboard
      const label = (ctx.callbackQuery.message as any)?.reply_markup?.inline_keyboard
        ?.flat()?.find((b: any) => b.callback_data === buttonText)?.text || `Option ${optionIndex + 1}`;
      opts.onQuestionResponse?.(requestId, optionIndex, label);
      try {
        await ctx.editMessageText(
          `${ctx.callbackQuery.message?.text || ''}\n\n\u2705 ${escapeHtml(label)}`,
          { parse_mode: 'HTML' },
        );
      } catch {}
      await ctx.answerCallbackQuery(label);
      return;
    }

    // approval response
    const requestId = data.slice(sep + 1);
    if (action !== 'approve' && action !== 'deny') return;

    const approved = action === 'approve';
    opts.onApprovalResponse?.(requestId, approved, approved ? undefined : 'denied via telegram');

    try {
      const label = approved ? '\u2705 Approved' : '\u274c Denied';
      await ctx.editMessageText(`${ctx.callbackQuery.message?.text || ''}\n\n${label}`, { parse_mode: 'HTML' });
    } catch {}
    await ctx.answerCallbackQuery(approved ? 'Approved' : 'Denied');
  });

  // handle incoming text messages
  bot.on('message:text', async (ctx) => {
    if (!opts.onMessage) return;

    const msg = ctx.message;
    const chat = msg.chat;
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';

    // group policy check
    if (isGroup && opts.groupPolicy === 'disabled') return;

    // sender auth check
    const senderId = String(msg.from?.id || '');
    if (opts.allowFrom && opts.allowFrom.length > 0) {
      if (!opts.allowFrom.includes(senderId)) {
        console.log(`[telegram] unauthorized sender: ${senderId} (${msg.from?.first_name || 'unknown'})`);
        return;
      }
    }

    const inbound: InboundMessage = {
      id: String(msg.message_id),
      channel: 'telegram',
      accountId: opts.accountId || '',
      chatId: String(chat.id),
      chatType: isGroup ? 'group' : 'dm',
      senderId: String(msg.from?.id || ''),
      senderName: msg.from?.first_name
        ? `${msg.from.first_name}${msg.from.last_name ? ` ${msg.from.last_name}` : ''}`
        : msg.from?.username,
      body: msg.text,
      timestamp: msg.date * 1000,
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      raw: msg,
    };

    await opts.onMessage(inbound);
  });

  // start long polling via runner (non-blocking)
  let runner: RunnerHandle;
  try {
    runner = run(bot);
    console.log('[telegram] monitor started');
  } catch (err) {
    console.error('[telegram] failed to start:', err);
    throw err;
  }

  // send approval request as inline keyboard to the owner
  const sendApprovalRequest = async (req: ApprovalRequest) => {
    const adminChatId = opts.allowFrom?.[0];
    if (!adminChatId) return;

    const detail = req.toolName === 'Bash' || req.toolName === 'bash'
      ? `<code>${escapeHtml(String(req.input.command || ''))}</code>`
      : `<pre>${escapeHtml(JSON.stringify(req.input, null, 2).slice(0, 500))}</pre>`;

    const text = `\u26a0\ufe0f <b>Approval Required</b>\n\nTool: <b>${escapeHtml(req.toolName)}</b>\n${detail}`;

    const keyboard = new InlineKeyboard()
      .text('\u2705 Allow', `approve:${req.requestId}`)
      .text('\u274c Deny', `deny:${req.requestId}`);

    try {
      await bot.api.sendMessage(Number(adminChatId), text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error('[telegram] failed to send approval request:', err);
    }
  };

  const sendQuestion = async (req: QuestionRequest) => {
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < req.options.length; i++) {
      keyboard.text(req.options[i].label, `q:${req.requestId}:${i}`);
      if (i % 2 === 1) keyboard.row(); // 2 buttons per row
    }

    const lines = [`\u2753 ${escapeHtml(req.question)}`];
    for (const opt of req.options) {
      if (opt.description) lines.push(`  \u2022 <b>${escapeHtml(opt.label)}</b> — ${escapeHtml(opt.description)}`);
    }

    try {
      await bot.api.sendMessage(Number(req.chatId), lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error('[telegram] failed to send question:', err);
    }
  };

  const stop = async () => {
    if (runner.isRunning()) {
      runner.stop();
    }
  };

  return { stop, sendApprovalRequest, sendQuestion };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
