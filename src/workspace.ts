import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME_DIR = homedir();
export const DORABOT_DIR = join(homedir(), '.dorabot');
export const WORKSPACE_DIR = join(DORABOT_DIR, 'workspace');
export const MEMORIES_DIR = join(WORKSPACE_DIR, 'memories');
export const RESEARCH_DIR = join(DORABOT_DIR, 'research');
export const RESEARCH_SKILL_PATH = join(RESEARCH_DIR, 'SKILL.md');
export const PLANS_DIR = join(DORABOT_DIR, 'plans');
export const WORKTREES_DIR = join(DORABOT_DIR, 'worktrees');
export const DORABOT_DB_PATH = join(DORABOT_DIR, 'dorabot.db');
export const DORABOT_CONFIG_PATH = join(DORABOT_DIR, 'config.json');
export const GATEWAY_TOKEN_PATH = join(DORABOT_DIR, 'gateway-token');
export const OWNER_CHAT_IDS_PATH = join(DORABOT_DIR, 'owner-chat-ids.json');
export const LOGS_DIR = join(DORABOT_DIR, 'logs');
export const SESSIONS_DIR = join(DORABOT_DIR, 'sessions');
export const SKILLS_DIR = join(DORABOT_DIR, 'skills');
export const TMP_DIR = join(DORABOT_DIR, 'tmp');
export const TLS_DIR = join(DORABOT_DIR, 'tls');
export const TLS_CERT_PATH = join(TLS_DIR, 'cert.pem');
export const TLS_KEY_PATH = join(TLS_DIR, 'key.pem');
export const TELEGRAM_DIR = join(DORABOT_DIR, 'telegram');
export const TELEGRAM_TOKEN_PATH = join(TELEGRAM_DIR, 'token');
export const TELEGRAM_MEDIA_DIR = join(DORABOT_DIR, 'media', 'telegram');
export const BROWSER_PROFILE_DIR = join(DORABOT_DIR, 'browser', 'profile');
export const WHATSAPP_DIR = join(DORABOT_DIR, 'whatsapp');
export const WHATSAPP_AUTH_DIR = join(WHATSAPP_DIR, 'auth');
export const CLAUDE_KEY_PATH = join(DORABOT_DIR, '.anthropic-key');
export const CLAUDE_OAUTH_PATH = join(DORABOT_DIR, '.claude-oauth.json');
export const CODEX_OAUTH_PATH = join(DORABOT_DIR, '.codex-oauth.json');
export const OPENAI_KEY_PATH = join(DORABOT_DIR, '.openai-key');
export const LEGACY_CODEX_AUTH_PATH = join(DORABOT_DIR, 'codex-auth.json');

export function toHomeAlias(path: string): string {
  return path.startsWith(`${HOME_DIR}/`)
    ? path.replace(HOME_DIR, '~')
    : path;
}

// files loaded into system prompt (order matters)
const WORKSPACE_FILES = ['SOUL.md', 'USER.md', 'MEMORY.md'] as const;

// strip yaml frontmatter (--- ... ---) from markdown
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

export type WorkspaceFiles = Record<string, string>;

const MEMORY_MAX_LINES = 500;

export function loadWorkspaceFiles(dir?: string): WorkspaceFiles {
  const wsDir = dir || WORKSPACE_DIR;
  const files: WorkspaceFiles = {};

  for (const name of WORKSPACE_FILES) {
    const path = join(wsDir, name);
    if (existsSync(path)) {
      try {
        let raw = readFileSync(path, 'utf-8').trim();
        if (!raw) continue;
        raw = stripFrontmatter(raw);
        if (name === 'MEMORY.md') {
          const lines = raw.split('\n');
          if (lines.length > MEMORY_MAX_LINES) {
            raw = lines.slice(0, MEMORY_MAX_LINES).join('\n') + `\n\n<!-- truncated at ${MEMORY_MAX_LINES} lines (${lines.length} total). Prune stale entries to stay under the cap. -->`;
          }
        }
        files[name] = raw;
      } catch {
        // skip unreadable files
      }
    }
  }

  return files;
}

// build the workspace section for the system prompt
export function buildWorkspaceSection(files: WorkspaceFiles): string | null {
  const parts: string[] = [];

  if (files['SOUL.md']) {
    parts.push(`### Persona (SOUL.md)\n\n${files['SOUL.md']}`);
  }

  if (files['USER.md']) {
    parts.push(`### User Profile (USER.md)\n\n${files['USER.md']}`);
  }

  if (files['MEMORY.md']) {
    parts.push(`### Memory (MEMORY.md)\n\n${files['MEMORY.md']}`);
  }

  if (parts.length === 0) return null;

  return `## Project Context\n\nThese files are loaded from ~/.dorabot/workspace/ and are user-editable.\nIf SOUL.md is present, embody its persona and tone.\n\n${parts.join('\n\n')}`;
}

const DEFAULT_SOUL = `# Soul

Be genuinely helpful, not performatively helpful. Skip filler like "Great question!" — just help.

Have opinions. You're allowed to disagree, prefer, find things amusing or boring. An assistant with no personality is a search engine with extra steps.

Be resourceful before asking. Try to figure it out: read the file, check context, search. Come back with answers, not questions.

Earn trust through competence. Be careful with external actions (emails, messages, anything public). Be bold with internal ones (reading, organizing, learning).

Remember you're a guest. You have access to messages, files, maybe more. That's intimacy. Treat it with respect.

Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just good.
`;

const DEFAULT_USER = `# User Profile

- Name:
- What to call them:
- Timezone:
- Notes:

## Plans

(What are they trying to achieve? Short-term and long-term.)

## Context

(What do they care about? Projects? What annoys them? What makes them tick?)
`;

const DEFAULT_RESEARCH_SKILL = `---
name: research-formatting
description: Formatting rules for research markdown output, including images and charts.
---

# Research Formatting Instructions

Use these rules whenever you create or update research content.

## Output Format

- Return valid GitHub-flavored markdown only.
- Keep structure clear with short sections and bullet lists.
- Prefer concise wording over long prose.
- Always include a ## Sources section with clickable links.

## Recommended Structure

1. # Title
2. ## Executive Summary
3. ## Key Findings
4. ## Visuals (only when visuals add value)
5. ## Sources

## Images

- Use markdown image syntax: ![alt text](url-or-path).
- Remote images can use https:// URLs.
- Local images should use absolute paths when rendered in the desktop app.
- Add one short caption line below important images explaining relevance.

## Charts

- Prefer Mermaid for inline charts and diagrams.
- Use fenced blocks with mermaid as the info string.
- Keep labels short and readable.
- When citing numeric data in a chart, include the data source in ## Sources.

## Source and Attribution Rules

- Include the page link for every external fact that impacts conclusions.
- For third-party images, include source link and license or attribution note if available.
- Do not present generated or inferred numbers as measured facts.

## Quality Bar

- No placeholder text like TBD.
- No broken markdown syntax.
- If no trustworthy source is available, state that explicitly in ## Sources.
`;

export function ensureWorkspace(dir?: string): void {
  const wsDir = dir || WORKSPACE_DIR;
  mkdirSync(DORABOT_DIR, { recursive: true });
  mkdirSync(wsDir, { recursive: true });
  mkdirSync(MEMORIES_DIR, { recursive: true });
  mkdirSync(RESEARCH_DIR, { recursive: true });
  mkdirSync(PLANS_DIR, { recursive: true });
  mkdirSync(WORKTREES_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });
  mkdirSync(SKILLS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(TLS_DIR, { recursive: true });
  mkdirSync(TELEGRAM_DIR, { recursive: true });
  mkdirSync(TELEGRAM_MEDIA_DIR, { recursive: true });
  mkdirSync(WHATSAPP_DIR, { recursive: true });
  mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

  const soulPath = join(wsDir, 'SOUL.md');
  if (!existsSync(soulPath)) {
    writeFileSync(soulPath, DEFAULT_SOUL);
  }

  const userPath = join(wsDir, 'USER.md');
  if (!existsSync(userPath)) {
    writeFileSync(userPath, DEFAULT_USER);
  }

  if (!existsSync(RESEARCH_SKILL_PATH)) {
    writeFileSync(RESEARCH_SKILL_PATH, DEFAULT_RESEARCH_SKILL);
  }
}

// get today's memory dir path
export function getTodayMemoryDir(timezone?: string): string {
  const now = new Date();
  const dateStr = timezone
    ? now.toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
    : now.toISOString().slice(0, 10);
  return join(MEMORIES_DIR, dateStr);
}

// load recent daily memories (last N days) for context
export function loadRecentMemories(days = 3): { date: string; content: string }[] {
  if (!existsSync(MEMORIES_DIR)) return [];

  try {
    const dirs = readdirSync(MEMORIES_DIR)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .slice(-days);

    const entries: { date: string; content: string }[] = [];
    for (const dir of dirs) {
      const memPath = join(MEMORIES_DIR, dir, 'MEMORY.md');
      if (existsSync(memPath)) {
        const content = readFileSync(memPath, 'utf-8').trim();
        if (content) entries.push({ date: dir, content });
      }
    }
    return entries;
  } catch {
    return [];
  }
}
