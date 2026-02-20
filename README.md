<div align="center">
  <img src="desktop/public/dorabot.png" width="120" />

  # dorabot

  **Your personal AI agent that actually does things.**

  [![GitHub stars](https://img.shields.io/github/stars/suitedaces/dorabot)](https://github.com/suitedaces/dorabot)
  [![GitHub release](https://img.shields.io/github/v/release/suitedaces/dorabot)](https://github.com/suitedaces/dorabot/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/suitedaces/dorabot/releases/latest)

  Your personal AI agent that codes, plans, researches, and runs your life. Memory, goals, scheduling, browser automation, multi-channel messaging. Runs locally on your Mac.

  [**Download for macOS**](https://github.com/suitedaces/dorabot/releases/latest) · [Website](https://dora.so)

</div>

<!-- TODO: Replace with demo GIF when ready -->
<img width="100%" alt="Desktop app" src="https://github.com/user-attachments/assets/8ebfb9cf-0e41-45b9-9fed-26b5a9d14d5c" />

## What You Get

🤖 **It works while you sleep.** Set pulse intervals and the agent wakes up on its own: monitors repos, reviews PRs, researches competitors, plans your weekend, messages you when something needs your attention.

💬 **Talk to it from anywhere.** WhatsApp, Telegram, Slack, or the desktop app. Same agent, same memory, every channel. Ask it to book a restaurant, debug your API, or check your calendar. It doesn't sit in a terminal waiting for you to come back.

🧠 **Memory that compounds.** It remembers what you discussed last week, what decisions were made, your preferences, your schedule. Full-text search across every past conversation. Context builds over time and carries across sessions.

🔒 **100% local, 100% private.** No cloud relay. Your conversations, memory, and browser sessions stay on your Mac. You own everything.

## Quick Start

### Download (recommended)

[**Download the macOS app**](https://github.com/suitedaces/dorabot/releases/latest) — open the DMG, drag to Applications, done. The onboarding flow walks you through connecting your model, channels, and personalizing the agent.

**Requirements:** macOS, Claude API key or Pro/Max subscription (or OpenAI/MiniMax key). Chrome/Brave/Edge optional for browser features.

### Build from source

```bash
git clone https://github.com/suitedaces/dorabot.git && cd dorabot
npm install && npm run build && npm link
```

```bash
npm run dev           # gateway + desktop with HMR
dorabot -g            # production gateway mode
dorabot -i            # interactive terminal
dorabot -m "message"  # one-off question
```

## How It Works

dorabot is an **agent harness**, not a model. It takes the model you already have (Claude, Codex, MiniMax) and wraps it in everything a personal AI agent needs:

<img src="public/architecture.svg" width="800" alt="Agent workspace architecture" />

The model does the thinking. dorabot gives it hands, eyes, a calendar, and a way to reach you.

## Features

<table>
<tr>
<td width="50%">

### 🖥️ Desktop App
Chat with streaming responses and inline tool use. Goals on a drag-and-drop Kanban board: the agent proposes, you approve, it executes. Plans, research, automations, and channel setup all in one place.

</td>
<td width="50%">

### 📋 Goals & Tasks
The agent proposes goals autonomously. You drag them through Proposed, Approved, In Progress, Done. Every task gets a written plan you review before execution starts. It's your agent's project manager.

</td>
</tr>
<tr>
<td width="50%">

### 📡 Channels
Connect WhatsApp (QR scan), Telegram (bot token), or Slack (app tokens). All channels share the same agent and memory. Text, photos, videos, documents, voice messages, and inline approval buttons on Telegram.

</td>
<td width="50%">

### 🌐 Browser Automation
90+ browser actions with persistent login sessions. The agent can navigate, click, fill forms, take screenshots, and extract data from any website using your existing Chrome sessions.

</td>
</tr>
<tr>
<td width="50%">

### 🧠 Memory & Research
Persistent memory across every session: daily journals, research notes, full-text search. The agent remembers what you discussed last week, what decisions were made, and what it learned.

</td>
<td width="50%">

### ⚡ Skills & MCP
9 built-in skills (GitHub, email, macOS control, image gen, memes, agent swarms). Browse and install from 56k+ community skills on [skills.sh](https://skills.sh). Connect 7,300+ MCP servers via [Smithery](https://smithery.ai).

</td>
</tr>
<tr>
<td width="50%">

### ⏰ Scheduler
Pulse check-ins at any interval, cron tasks, iCal RRULE scheduling. The agent wakes up, scans for work, proposes new goals, executes approved tasks, and reports back. Fully autonomous when you want it to be.

</td>
<td width="50%">

### 🔌 Multi-Provider
Use the model you're already paying for. Claude (API key or Pro/Max subscription), OpenAI Codex (API key or ChatGPT Plus/Pro OAuth), or MiniMax. Switch from Settings or via RPC.

</td>
</tr>
</table>

## Personalization

The onboarding flow sets up your model, channels, and profile. The `onboard` skill does a deeper interview to build:

| File | Purpose |
|------|---------|
| `SOUL.md` | How the agent talks and thinks |
| `USER.md` | Who you are, your goals, preferences |
| `MEMORY.md` | Facts that persist across every session |

All workspace files live in `~/.dorabot/workspace/`. Edit them directly or let the agent manage them.

## Security

- **Local-only.** No cloud relay, no remote servers, no telemetry.
- **Scoped file access.** Default: `~/`, `/tmp`. Sensitive dirs always blocked (`~/.ssh`, `~/.gnupg`, `~/.aws`).
- **Token-authenticated gateway.** 256-bit hex token.
- **Configurable tool approval.** Auto-allow, notify, or require-approval per tool.
- **Channel-level policies.** Different security rules per channel.
- **macOS sandbox.** Native permission management via Apple's security model.

## FAQ

<details>
<summary><strong>Do I need an API key?</strong></summary>

You need either a Claude API key, a Claude Pro/Max subscription (via the Claude Agent SDK), an OpenAI API key, or a MiniMax API key. dorabot doesn't include its own model; it wraps yours.
</details>

<details>
<summary><strong>Is my data sent anywhere?</strong></summary>

No. dorabot runs entirely on your Mac. Conversations, memory, browser sessions, and files stay on-device. The only network calls are to your chosen AI provider's API.
</details>

<details>
<summary><strong>Can I use this for work?</strong></summary>

Yes. dorabot monitors repos, reviews PRs, proposes goals, tracks tasks, sends you updates on Slack or Telegram. But it's not just for work: it plans trips, manages your calendar, researches anything, and messages you proactively when things need attention.
</details>

<details>
<summary><strong>How is this different from Claude Code / Cursor / Windsurf?</strong></summary>

Those are coding tools you use in a terminal. dorabot is a personal AI agent that lives on your Mac and reaches you on WhatsApp, Telegram, or Slack. It has persistent memory, autonomous goals, scheduling, and browser automation. It works while you sleep, not just while your terminal is open.
</details>

<details>
<summary><strong>How is this different from OpenClaw?</strong></summary>

OpenClaw is a cloud-hosted agent platform. dorabot is local-first: your data stays on your Mac, you control the model, and there's no cloud relay. It also has a native desktop app, goal/task management, and multi-channel messaging built in.
</details>

## Contributing

Contributions welcome. Open an issue or PR on [GitHub](https://github.com/suitedaces/dorabot).

## License

[MIT](LICENSE)
