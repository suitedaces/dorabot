import type { Config } from '../config.js';
import type { InboundMessage, ChannelStatus } from '../channels/types.js';
import { startWhatsAppMonitor, type WhatsAppMonitorHandle } from '../channels/whatsapp/monitor.js';
import { startTelegramMonitor, type TelegramMonitorHandle } from '../channels/telegram/monitor.js';
import { startSlackMonitor, type SlackMonitorHandle } from '../channels/slack/monitor.js';

// unified request types (superset of both channels)
export type ApprovalRequest = {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  chatId?: string;
};

export type QuestionRequest = {
  requestId: string;
  chatId: string;
  question: string;
  options: { label: string; description?: string }[];
};

export type ChannelManagerOptions = {
  config: Config;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onCommand?: (channel: string, cmd: string, chatId: string) => Promise<string | void>;
  onApprovalResponse?: (requestId: string, approved: boolean, reason?: string) => void;
  onQuestionResponse?: (requestId: string, selectedIndex: number, label: string) => void;
  onStatus?: (status: ChannelStatus) => void;
};

type ChannelState = {
  id: string;
  running: boolean;
  connected: boolean;
  accountId: string;
  lastError: string | null;
  stop: (() => Promise<void>) | null;
  sendApprovalRequest?: (req: any) => Promise<void>;
  sendQuestion?: (req: QuestionRequest) => Promise<void>;
};

export class ChannelManager {
  private config: Config;
  private onMessage: (msg: InboundMessage) => Promise<void>;
  private onStatus?: (status: ChannelStatus) => void;
  private onApprovalResponse?: (requestId: string, approved: boolean, reason?: string) => void;
  private onQuestionResponse?: (requestId: string, selectedIndex: number, label: string) => void;
  private channels = new Map<string, ChannelState>();

  private onCommand?: (channel: string, cmd: string, chatId: string) => Promise<string | void>;

  constructor(opts: ChannelManagerOptions) {
    this.config = opts.config;
    this.onMessage = opts.onMessage;
    this.onCommand = opts.onCommand;
    this.onApprovalResponse = opts.onApprovalResponse;
    this.onQuestionResponse = opts.onQuestionResponse;
    this.onStatus = opts.onStatus;
  }

  async startChannel(channelId: string): Promise<void> {
    if (this.channels.get(channelId)?.running) return;

    const state: ChannelState = {
      id: channelId,
      running: false,
      connected: false,
      accountId: '',
      lastError: null,
      stop: null,
    };
    this.channels.set(channelId, state);

    try {
      if (channelId === 'whatsapp') {
        await this.startWhatsApp(state);
      } else if (channelId === 'telegram') {
        await this.startTelegram(state);
      } else if (channelId === 'slack') {
        await this.startSlack(state);
      } else {
        throw new Error(`Unknown channel: ${channelId}`);
      }
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      state.running = false;
      this.emitStatus(state);
    }
  }

  private async startWhatsApp(state: ChannelState): Promise<void> {
    const waConfig = this.config.channels?.whatsapp;
    if (!waConfig?.enabled) {
      state.lastError = 'WhatsApp not enabled in config';
      return;
    }

    state.accountId = waConfig.accountId || '';
    state.running = true;
    this.emitStatus(state);

    const result = await startWhatsAppMonitor({
      authDir: waConfig.authDir,
      accountId: waConfig.accountId,
      allowFrom: waConfig.allowFrom,
      groupPolicy: waConfig.groupPolicy,
      onMessage: async (raw) => {
        const msg = raw as InboundMessage;
        state.connected = true;
        state.lastError = null;
        await this.onMessage(msg);
      },
      onCommand: this.onCommand
        ? async (cmd, chatId) => this.onCommand!('whatsapp', cmd, chatId)
        : undefined,
      onApprovalResponse: this.onApprovalResponse,
      onQuestionResponse: this.onQuestionResponse,
    });

    state.connected = true;
    state.stop = result.stop;
    state.sendApprovalRequest = result.sendApprovalRequest;
    state.sendQuestion = result.sendQuestion;
    this.emitStatus(state);
  }

  private async startTelegram(state: ChannelState): Promise<void> {
    const tgConfig = this.config.channels?.telegram;
    if (!tgConfig?.enabled) {
      state.lastError = 'Telegram not enabled in config';
      return;
    }

    state.accountId = tgConfig.accountId || '';
    state.running = true;
    this.emitStatus(state);

    const result = await startTelegramMonitor({
      tokenFile: tgConfig.tokenFile,
      accountId: tgConfig.accountId,
      allowFrom: tgConfig.allowFrom,
      groupPolicy: tgConfig.groupPolicy,
      onMessage: async (raw) => {
        const msg = raw as InboundMessage;
        state.connected = true;
        state.lastError = null;
        await this.onMessage(msg);
      },
      onCommand: this.onCommand
        ? async (cmd, chatId) => this.onCommand!('telegram', cmd, chatId)
        : undefined,
      onApprovalResponse: this.onApprovalResponse,
      onQuestionResponse: this.onQuestionResponse,
    });

    state.connected = true;
    state.stop = result.stop;
    state.sendApprovalRequest = result.sendApprovalRequest;
    state.sendQuestion = result.sendQuestion;
    this.emitStatus(state);
  }

  private async startSlack(state: ChannelState): Promise<void> {
    const slackConfig = this.config.channels?.slack;
    if (!slackConfig?.enabled) {
      state.lastError = 'Slack not enabled in config';
      return;
    }

    state.accountId = slackConfig.accountId || '';
    state.running = true;
    this.emitStatus(state);

    const result = await startSlackMonitor({
      botToken: slackConfig.botToken,
      appToken: slackConfig.appToken,
      accountId: slackConfig.accountId,
      allowFrom: slackConfig.allowFrom,
      onMessage: async (raw) => {
        const msg = raw as InboundMessage;
        state.connected = true;
        state.lastError = null;
        await this.onMessage(msg);
      },
      onCommand: this.onCommand
        ? async (cmd, chatId) => this.onCommand!('slack', cmd, chatId)
        : undefined,
      onApprovalResponse: this.onApprovalResponse,
      onQuestionResponse: this.onQuestionResponse,
    });

    state.connected = true;
    state.stop = result.stop;
    state.sendApprovalRequest = result.sendApprovalRequest;
    state.sendQuestion = result.sendQuestion;
    this.emitStatus(state);
  }

  async stopChannel(channelId: string): Promise<void> {
    const state = this.channels.get(channelId);
    if (!state) return;

    if (state.stop) {
      try { await state.stop(); } catch {}
    }

    state.running = false;
    state.connected = false;
    state.stop = null;
    this.emitStatus(state);
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.config.channels?.whatsapp?.enabled) {
      promises.push(this.startChannel('whatsapp'));
    }
    if (this.config.channels?.telegram?.enabled) {
      promises.push(this.startChannel('telegram'));
    }
    if (this.config.channels?.slack?.enabled) {
      promises.push(this.startChannel('slack'));
    }

    await Promise.allSettled(promises);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.channels.keys()).map(id => this.stopChannel(id));
    await Promise.allSettled(promises);
  }

  async sendApprovalRequest(req: ApprovalRequest, targetChannel?: string): Promise<void> {
    if (targetChannel) {
      const ch = this.channels.get(targetChannel);
      if (ch?.connected && ch.sendApprovalRequest) {
        await ch.sendApprovalRequest(req);
        return;
      }
    }
    // fallback: send to all connected channels
    for (const ch of this.channels.values()) {
      if (ch.connected && ch.sendApprovalRequest) {
        try { await ch.sendApprovalRequest(req); } catch {}
      }
    }
  }

  async sendQuestion(req: QuestionRequest, targetChannel?: string): Promise<void> {
    if (targetChannel) {
      const ch = this.channels.get(targetChannel);
      if (ch?.connected && ch.sendQuestion) {
        await ch.sendQuestion(req);
        return;
      }
    }
    // fallback: send to first connected channel with question support
    for (const ch of this.channels.values()) {
      if (ch.connected && ch.sendQuestion) {
        await ch.sendQuestion(req);
        return;
      }
    }
  }

  getStatuses(): ChannelStatus[] {
    return Array.from(this.channels.values()).map(s => ({
      channel: s.id,
      accountId: s.accountId,
      running: s.running,
      connected: s.connected,
      lastConnectedAt: s.connected ? Date.now() : null,
      lastError: s.lastError,
    }));
  }

  private emitStatus(state: ChannelState): void {
    this.onStatus?.({
      channel: state.id,
      accountId: state.accountId,
      running: state.running,
      connected: state.connected,
      lastConnectedAt: state.connected ? Date.now() : null,
      lastError: state.lastError,
    });
  }
}
