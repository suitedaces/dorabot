<div align="center">
  <img src="desktop/public/sprites/dorabot.png" width="120" style="image-rendering: pixelated;" />

  # dorabot

  **A 24/7 self-learning AI agent with a workspace that runs itself.**

  [![GitHub stars](https://img.shields.io/github/stars/suitedaces/dorabot)](https://github.com/suitedaces/dorabot)
  [![GitHub release](https://img.shields.io/github/v/release/suitedaces/dorabot)](https://github.com/suitedaces/dorabot/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Ubuntu-lightgrey)](https://github.com/suitedaces/dorabot/releases/latest)

  Works with your existing Claude Code or OpenAI Codex subscription. No extra API key needed.

  [**Download for macOS**](https://github.com/suitedaces/dorabot/releases/latest) · [Ubuntu from source](#build-from-source) · [Website](https://dora.so) · [Discord](https://discord.gg/FH99jkvMz) · [Demo](https://github.com/suitedaces/dorabot/releases/download/v0.2.3/annotated-demo-telegram.mp4)

</div>

### See it in action

The agent manages its own goals, tracks research, messages you on Telegram and WhatsApp, runs scheduled tasks, and remembers everything across sessions.

https://github.com/user-attachments/assets/2ec5dd22-7b47-4ec0-a60b-62380e560bd0

## Persistent Memory & Self-Learning

Daily journals, curated memory, personality config. The agent remembers decisions, preferences, and context across every session. Full-text search over all past conversations. It gets better the more you use it.

<img src="gifs/memory.gif" width="800" />

## Automations & Scheduling

Cron jobs, scheduled pulses, recurring tasks. The agent wakes up, does work, and messages you. iCal RRULE support, Apple Calendar sync (shows on Watch and iPhone).

<img src="gifs/automations.gif" width="800" />

## Goals & Tasks

The agent proposes goals, writes plans, and executes them. You approve from the desktop app or Telegram. Full pipeline: research, plan, review, execute, done.

<img src="gifs/goals.gif" width="800" />

## Research & Knowledge

The agent creates and maintains its own research for you. Topics tracked, categorized, and searchable. Point it at anything and it keeps the knowledge organized.

<img src="gifs/research.gif" width="800" />

## Multi-Channel Messaging

Same agent on WhatsApp, Telegram, and Slack. Send text, photos, voice, documents. It responds with full context from every past conversation.

<img src="gifs/channels.gif" width="800" />

## Skills & MCP Servers

Built-in skills for GitHub, email, desktop automation, PR review, and agent swarms. Browse 56k+ community skills. Connect 7,300+ MCP servers via Smithery.

<img src="gifs/extensions.gif" width="800" />

## Also

- **Browser automation.** 90+ actions with your real Chrome profile. Already logged in everywhere.
- **Multi-provider.** Claude, OpenAI Codex, MiniMax. Use the model you're already paying for.
- **Multimodal.** Send images, screenshots, diagrams. The agent sees them.
- **Multi-pane workspace.** Split panes (Cmd+D), parallel agents, streaming responses.
- **Auto-update.** Signed, notarized, one-click updates.
- **Local-only.** No cloud relay. Your data stays on your machine.

## Quick Start

### Download

[**Download the macOS app**](https://github.com/suitedaces/dorabot/releases/latest) -- open the DMG, drag to Applications. Onboarding walks you through setup.

**Requires:** macOS or Ubuntu + a Claude Code or OpenAI Codex subscription (or any API key: Claude, OpenAI, MiniMax).

### Build from source

One-liner (fresh clone, macOS):

```bash
git clone https://github.com/suitedaces/dorabot.git && cd dorabot && bash scripts/install.sh
```

One-liner (fresh clone, Ubuntu):

```bash
git clone https://github.com/suitedaces/dorabot.git && cd dorabot && bash scripts/install.sh
```

If you already cloned the repo:

```bash
bash scripts/install.sh
```

```bash
npm run dev           # gateway + desktop with HMR
dorabot -g            # production gateway mode
dorabot -i            # interactive terminal
dorabot -m "message"  # one-off question
```

### Ubuntu notes

- Installer script includes Ubuntu deps: `libnotify-bin`, `gnome-screenshot`
- Package desktop app: `npm -C desktop run package:linux`
- Optional desktop integrations:
  - Notifications: `notify-send`
  - Screenshots: one of `gnome-screenshot`, `grim`, `import`, `maim`, `scrot`

## Personalization

The `onboard` skill interviews you and builds:

| File | What it does |
|------|-------------|
| `SOUL.md` | How the agent talks and thinks |
| `USER.md` | Who you are, your goals, context |
| `MEMORY.md` | Facts that persist across sessions |

All files live in `~/.dorabot/workspace/`. Edit directly or let the agent manage them.

## Security

Local-only, no telemetry. Scoped file access (sensitive dirs blocked). Token-authenticated gateway. Configurable tool approval per channel. Desktop sandboxing where supported by platform/runtime.

## FAQ

<details>
<summary><strong>Do I need an API key?</strong></summary>
If you have a Claude Code or OpenAI Codex subscription, you're good to go. Otherwise, any API key works (Claude, OpenAI, MiniMax). dorabot wraps your model, it doesn't include one.
</details>

<details>
<summary><strong>Is my data sent anywhere?</strong></summary>
No. Runs on your Mac. Only network calls are to your AI provider's API.
</details>

<details>
<summary><strong>How is this different from Claude Code / Cursor?</strong></summary>
Those are coding tools. dorabot is an agent workspace: persistent memory, autonomous goals, scheduling, browser automation, multi-channel messaging. It works while you sleep.
</details>

## Contributing

Open an issue or PR on [GitHub](https://github.com/suitedaces/dorabot).

## License

[MIT](LICENSE)
