import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { registerChannelHandler } from '../../tools/messaging.js';
import { sendSlackMessage, editSlackMessage, deleteSlackMessage } from './send.js';
import type { InboundMessage } from '../types.js';

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

export type SlackMonitorOptions = {
  botToken?: string;
  appToken?: string;
  accountId?: string;
  allowFrom?: string[];
  onMessage?: (msg: InboundMessage) => Promise<void>;
  onCommand?: (cmd: string, chatId: string) => Promise<string | void>;
  onApprovalResponse?: (requestId: string, approved: boolean, reason?: string) => void;
  onQuestionResponse?: (requestId: string, selectedIndex: number, label: string) => void;
  abortSignal?: AbortSignal;
};

export type SlackMonitorHandle = {
  stop: () => Promise<void>;
  sendApprovalRequest: (req: ApprovalRequest) => Promise<void>;
  sendQuestion: (req: QuestionRequest) => Promise<void>;
};

export function resolveSlackTokens(opts?: { botToken?: string; appToken?: string }): { botToken: string; appToken: string } {
  // try provided tokens
  if (opts?.botToken && opts?.appToken) {
    return { botToken: opts.botToken, appToken: opts.appToken };
  }

  // try token files
  const slackDir = join(homedir(), '.dorabot', 'slack');
  const botTokenFile = join(slackDir, 'bot-token');
  const appTokenFile = join(slackDir, 'app-token');

  let botToken = opts?.botToken || '';
  let appToken = opts?.appToken || '';

  if (!botToken && existsSync(botTokenFile)) {
    botToken = readFileSync(botTokenFile, 'utf-8').trim();
  }
  if (!appToken && existsSync(appTokenFile)) {
    appToken = readFileSync(appTokenFile, 'utf-8').trim();
  }

  // try env vars
  if (!botToken) botToken = process.env.SLACK_BOT_TOKEN || '';
  if (!appToken) appToken = process.env.SLACK_APP_TOKEN || '';

  if (!botToken) {
    throw new Error('No Slack bot token found. Set SLACK_BOT_TOKEN env or save to ~/.dorabot/slack/bot-token');
  }
  if (!appToken) {
    throw new Error('No Slack app token found. Set SLACK_APP_TOKEN env or save to ~/.dorabot/slack/app-token');
  }

  return { botToken, appToken };
}

export function validateSlackBotToken(token: string): boolean {
  return token.startsWith('xoxb-');
}

export function validateSlackAppToken(token: string): boolean {
  return token.startsWith('xapp-');
}

export async function startSlackMonitor(opts: SlackMonitorOptions): Promise<SlackMonitorHandle> {
  const { botToken, appToken } = resolveSlackTokens(opts);

  // dynamic import to avoid requiring @slack/bolt when slack is disabled
  const { App } = await import('@slack/bolt');

  const app = new App({
    token: botToken,
    socketMode: true,
    appToken,
    // disable built-in logging noise
    logLevel: 'ERROR' as any,
  });

  let botUserId = '';

  // register channel handler for the message tool
  registerChannelHandler('slack', {
    send: async (target, message, sendOpts) => {
      return sendSlackMessage(app.client, target, message, {
        replyTo: sendOpts?.replyTo,
        media: sendOpts?.media,
      });
    },
    edit: async (messageId, message, chatId) => {
      if (!chatId) throw new Error('chatId required for Slack edit');
      await editSlackMessage(app.client, chatId, messageId, message);
    },
    delete: async (messageId, chatId) => {
      if (!chatId) throw new Error('chatId required for Slack delete');
      await deleteSlackMessage(app.client, chatId, messageId);
    },
    typing: async (_chatId) => {
      // Slack doesn't have a direct "typing" indicator API for bots
      // no-op
    },
  });

  // handle incoming DM messages
  app.message(async ({ message, client }) => {
    if (!opts.onMessage) return;

    // only handle real user messages (not bot messages, not edits, not deletes)
    const msg = message as any;
    if (msg.subtype) return; // skip edited, deleted, bot_message, etc.
    if (msg.bot_id) return; // skip bot messages

    const senderId = msg.user || '';
    const chatId = msg.channel || '';

    // DM check: Slack DMs have channel type 'im'
    // We'll handle all messages that reach here (Slack event subscriptions filter to relevant events)

    // access control
    if (opts.allowFrom && opts.allowFrom.length > 0) {
      if (!opts.allowFrom.includes(senderId)) {
        console.log(`[slack] unauthorized sender: ${senderId}`);
        return;
      }
    }

    // get sender info for display name
    let senderName = senderId;
    try {
      const userInfo = await client.users.info({ user: senderId });
      if (userInfo.user) {
        senderName = userInfo.user.real_name || userInfo.user.name || senderId;
      }
    } catch {}

    const inbound: InboundMessage = {
      id: msg.ts || '',
      channel: 'slack',
      accountId: opts.accountId || '',
      chatId,
      chatType: 'dm',
      senderId,
      senderName,
      body: msg.text || '',
      timestamp: msg.ts ? Math.floor(parseFloat(msg.ts) * 1000) : Date.now(),
      replyToId: msg.thread_ts || undefined,
      raw: msg,
    };

    // handle file attachments
    if (msg.files && msg.files.length > 0) {
      const file = msg.files[0];
      inbound.mediaType = file.mimetype || undefined;
      // Slack files need auth to download - store the URL for later
      if (file.url_private_download) {
        try {
          const mediaDir = join(homedir(), '.dorabot', 'media', 'slack');
          mkdirSync(mediaDir, { recursive: true });
          const ext = file.name?.split('.').pop() || 'bin';
          const localName = `${Date.now()}_${file.id}.${ext}`;
          const localPath = join(mediaDir, localName);

          const res = await fetch(file.url_private_download, {
            headers: { Authorization: `Bearer ${botToken}` },
          });
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            writeFileSync(localPath, buffer);
            inbound.mediaPath = localPath;
            console.log(`[slack] downloaded file: ${localPath} (${inbound.mediaType})`);
          }
        } catch (err) {
          console.error('[slack] failed to download file:', err);
        }
      }
    }

    await opts.onMessage(inbound);
  });

  // handle button actions for approvals and questions
  app.action(/^(approve|deny):/, async ({ action, ack, respond }) => {
    await ack();
    const data = (action as any).value || (action as any).action_id || '';
    const sep = data.indexOf(':');
    if (sep < 0) return;

    const actionType = data.slice(0, sep);
    const requestId = data.slice(sep + 1);
    const approved = actionType === 'approve';

    opts.onApprovalResponse?.(requestId, approved, approved ? undefined : 'denied via slack');

    try {
      const label = approved ? '\u2705 Approved' : '\u274c Denied';
      await respond({ text: label, replace_original: false });
    } catch {}
  });

  app.action(/^q:/, async ({ action, ack, respond }) => {
    await ack();
    const data = (action as any).value || (action as any).action_id || '';
    // format: q:{requestId}:{optionIndex}
    const parts = data.split(':');
    if (parts.length < 3) return;

    const requestId = parts[1];
    const optionIndex = parseInt(parts[2], 10);
    const label = (action as any).text?.text || `Option ${optionIndex + 1}`;

    opts.onQuestionResponse?.(requestId, optionIndex, label);

    try {
      await respond({ text: `\u2705 ${label}`, replace_original: false });
    } catch {}
  });

  // start the app
  await app.start();
  console.log('[slack] monitor started');

  // get bot user ID for self-message filtering
  try {
    const authResult = await app.client.auth.test();
    botUserId = authResult.user_id || '';
    console.log(`[slack] bot user ID: ${botUserId}`);
  } catch {}

  // send approval request to the owner DM
  const sendApprovalRequest = async (req: ApprovalRequest) => {
    const adminChatId = opts.allowFrom?.[0];
    if (!adminChatId) return;

    // need to find the DM channel with this user
    let dmChannel: string;
    try {
      const result = await app.client.conversations.open({ users: adminChatId });
      dmChannel = result.channel?.id || '';
    } catch {
      return;
    }
    if (!dmChannel) return;

    const detail = req.toolName === 'Bash' || req.toolName === 'bash'
      ? '`' + String(req.input.command || '') + '`'
      : '```' + JSON.stringify(req.input, null, 2).slice(0, 500) + '```';

    const text = `\u26a0\ufe0f *Approval Required*\n\nTool: *${req.toolName}*\n${detail}`;

    try {
      await app.client.chat.postMessage({
        channel: dmChannel,
        text,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '\u2705 Allow' },
                action_id: `approve:${req.requestId}`,
                value: `approve:${req.requestId}`,
                style: 'primary',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '\u274c Deny' },
                action_id: `deny:${req.requestId}`,
                value: `deny:${req.requestId}`,
                style: 'danger',
              },
            ],
          },
        ],
      });
    } catch (err) {
      console.error('[slack] failed to send approval request:', err);
    }
  };

  const sendQuestion = async (req: QuestionRequest) => {
    const elements: any[] = [];
    for (let i = 0; i < req.options.length; i++) {
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: req.options[i].label },
        action_id: `q:${req.requestId}:${i}`,
        value: `q:${req.requestId}:${i}`,
      });
    }

    const lines = [`\u2753 ${req.question}`];
    for (const opt of req.options) {
      if (opt.description) lines.push(`  \u2022 *${opt.label}* - ${opt.description}`);
    }

    try {
      await app.client.chat.postMessage({
        channel: req.chatId,
        text: lines.join('\n'),
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: lines.join('\n') },
          },
          {
            type: 'actions',
            elements,
          },
        ],
      });
    } catch (err) {
      console.error('[slack] failed to send question:', err);
    }
  };

  const stop = async () => {
    try {
      await app.stop();
    } catch {}
  };

  return { stop, sendApprovalRequest, sendQuestion };
}
