<div align="center">
  <img src="desktop/public/dorabot.png" width="120" />

  # dorabot

  **Turn Claude Code and Codex into your personal AI agent.**

  You already pay for these models. dorabot gives them arms and legs - messaging, browser automation, email, Mac control, scheduling, persistent memory - so they can do real work outside the IDE.

</div>

<img width="4336" height="2644" alt="image" src="https://github.com/user-attachments/assets/8ebfb9cf-0e41-45b9-9fed-26b5a9d14d5c" />

## What It Does

- **Chat anywhere** - WhatsApp, Telegram, or the desktop app. Persistent memory across all channels.
- **Browse the web** - Fill forms, click buttons, read pages, stay logged in across sessions.
- **Read and send email** - via Himalaya CLI (IMAP/SMTP, no OAuth needed).
- **Control your Mac** - Windows, apps, Spotify, Calendar, Finder, system settings via AppleScript.
- **Schedule anything** - One-shot reminders, recurring tasks, full cron expressions with timezone support.
- **Proactive goal management** - The agent proposes goals on its own, you approve via drag-and-drop Kanban board. It tracks progress, reports results, and picks up new work autonomously.
- **Work with GitHub** - PRs, issues, CI checks, code review via `gh` CLI.
- **Generate images** - Text-to-image and image editing via Gemini API.
- **Extend with skills** - Drop a `SKILL.md` in a folder, or browse and install from the [skills.sh](https://skills.sh) gallery (56k+ community skills). The agent can also create new skills on the fly.

https://github.com/user-attachments/assets/d675347a-46c0-4767-b35a-e7a1db6386f9

## Quick Start

### Prerequisites

- Node.js 22+
- **Claude** (API key or Pro/Max subscription) or **OpenAI** (API key or ChatGPT login)
- Chrome, Brave, or Edge (for browser features)

### Install

```bash
git clone https://github.com/suitedaces/dorabot.git
cd dorabot
npm install
npm run build
npm link
```

### Run

```bash
# development - gateway + desktop with HMR
npm run dev

# or run individually
npm run dev:gateway   # gateway with auto-reload
npm run dev:desktop   # electron-vite with HMR

# production
dorabot -g            # gateway mode - powers desktop app and channels
dorabot -i            # interactive terminal
dorabot -m "what's the weather in SF?"   # one-off question
```

## Desktop App

An Electron app that connects to the gateway over WebSocket. Includes:

- **Chat** - Full chat interface with tool streaming UI, model selection, and effort levels
- **Goals** - Drag-and-drop Kanban board (Proposed → Approved → In Progress → Done)
- **Channels** - Set up WhatsApp (QR code) and Telegram (bot token) from the UI
- **Skills** - Browse, create, and edit skills with eligibility checks
- **Soul** - Edit your personality (SOUL.md), profile (USER.md), and memory (MEMORY.md)
- **Automations** - Manage cron jobs, reminders, and recurring tasks
- **Settings** - Provider setup, approval modes, sandbox config, tool policies

```bash
cd desktop
npm install
npm run dev
```

## Proactive Agent

dorabot doesn't just respond - it acts on its own. A configurable heartbeat loop wakes the agent on a schedule to check `HEARTBEAT.md` for pending work, propose new goals, and execute approved tasks without being prompted.

- **Heartbeat** - Runs every N minutes (default 30m). Reads `HEARTBEAT.md`, decides if there's work to do. If nothing needs attention, it stays quiet.
- **Goal proposals** - The agent proposes goals (batch or individual). They show up as "Proposed" on the Kanban board. Drag to "Approved" and the agent picks them up.
- **Active hours** - Configurable quiet hours so it doesn't burn tokens while you sleep.
- **Skill creation** - The agent can create new skills on the fly. Ask it to "make a skill for X" and it writes the `SKILL.md`, sets up the folder, and the skill is immediately available.

```json
{
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "activeHours": { "start": "09:00", "end": "23:00", "timezone": "America/Los_Angeles" }
  }
}
```

## Multi-Provider Support

dorabot supports multiple AI providers. Pick the one you're already paying for.

| Provider | Auth | SDK |
|----------|------|-----|
| **Claude** (default) | API key or Pro/Max subscription OAuth | [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) |
| **OpenAI Codex** | API key or ChatGPT OAuth | [Codex SDK](https://www.npmjs.com/package/@openai/codex-sdk) |

Switch providers from the desktop Settings page or via gateway RPC (`provider.set`).

## Channels

### WhatsApp

```bash
dorabot --whatsapp-login    # scan the QR code
```

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN=your_token` in your environment (or save to `~/.dorabot/telegram/token`)
3. Start from the desktop app or config

Supports text, photos, videos, audio, documents, voice messages, and inline approval buttons.

### Desktop App

The desktop app connects to the gateway automatically. See [Desktop App](#desktop-app) above.

## Skills

Built-in skills:

| Skill | What it does |
|-------|-------------|
| **github** | Issues, PRs, CI runs via `gh` CLI |
| **himalaya** | Email via IMAP/SMTP CLI |
| **macos** | Window management, apps, Spotify, Calendar, Finder |
| **image-gen** | Gemini API image generation and editing |
| **meme** | Meme generation via memegen.link |
| **onboard** | Interactive setup for USER.md and SOUL.md |
| **polymarket** | Polymarket data and predictions |
| **remotion** | Video creation in React |
| **agent-swarm-orchestration** | Multi-agent task orchestration |

**Add skills:**
- **Create your own** - Drop a folder with a `SKILL.md` in `~/.dorabot/skills/your-skill/`, or ask the agent to create one for you.
- **Install from gallery** - Browse 56k+ community skills from [skills.sh](https://skills.sh) directly in the desktop app. Search, preview, and install with one click.
- **Agent-created** - Ask "make me a skill for deploying to Vercel" and the agent writes it, tests eligibility, and makes it available immediately.

## Make It Yours

Ask dorabot to onboard you, or edit the files directly:

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality and tone |
| `USER.md` | Who you are, your preferences |
| `MEMORY.md` | Persistent facts across sessions |
| `AGENTS.md` | Extra instructions |

## Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Desktop App │   │  Telegram   │   │  WhatsApp   │
│  (Electron)  │   │  (grammy)   │   │  (Baileys)  │
└──────┬───────┘   └──────┬──────┘   └──────┬──────┘
       │                  │                  │
       └──────────┬───────┴──────────────────┘
                  │
         ┌────────▼────────┐
         │  Gateway Server  │  WebSocket RPC (port 18789)
         │  (server.ts)     │  Token-authenticated
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │  Provider Layer  │  Claude / Codex
         │  (providers/)    │  Singleton + lazy init
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐  ┌─────▼─────┐  ┌───▼───┐
│ Tools │  │  Sessions  │  │  Cron │
│ (MCP) │  │  (SQLite)  │  │ Sched │
└───────┘  └───────────┘  └───────┘
```

- **Gateway** - Central hub. ~70 RPC methods for config, sessions, channels, cron, skills, goals, provider management, and tool approval.
- **Providers** - Abstract interface. Claude uses Agent SDK (subprocess), Codex uses Codex SDK. Both support session resumption.
- **Sessions** - SQLite-backed. Persistent across restarts. 4-hour idle timeout for new conversations.
- **Tools** - Built-in via `claude_code` preset (Read, Write, Bash, etc.) plus custom MCP tools (messaging, browser, screenshot, goals, cron).
- **Browser** - Playwright-based. 90+ actions. Persistent profile with authenticated sessions.

## Config

`~/.dorabot/config.json`:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "provider": {
    "name": "claude"
  },
  "channels": {
    "whatsapp": { "enabled": false },
    "telegram": { "enabled": false, "token": "" }
  },
  "heartbeat": {
    "enabled": false,
    "every": "30m"
  }
}
```

## Security

- Scoped file access (default: `~/`, `/tmp`)
- Sensitive dirs always blocked: `~/.ssh`, `~/.gnupg`, `~/.aws`
- Token-authenticated gateway (256-bit hex)
- Configurable tool approval tiers (auto-allow, notify, require-approval)
- Channel-level security policies

## License

MIT
