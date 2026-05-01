import { hostname } from 'node:os';
import type { Config } from './config.js';
import type { Skill } from './skills/loader.js';
import { type WorkspaceFiles, buildWorkspaceSection, WORKSPACE_DIR, MEMORIES_DIR, loadRecentMemories, getTodayMemoryDir } from './workspace.js';
import { loadProjects, type Project } from './tools/projects.js';
import { loadTasks, type Task } from './tools/tasks.js';

export type BrowserTabInfo = {
  pageId: string;
  url: string;
  title: string;
  userFocused?: boolean;
  paused?: boolean;
};

export type SystemPromptOptions = {
  config: Config;
  skills?: Skill[];
  channel?: string;
  connectedChannels?: { channel: string; chatId: string }[];
  timezone?: string;
  ownerIdentity?: string;
  extraContext?: string;
  workspaceFiles?: WorkspaceFiles;
  lastPulseAt?: number;
  browserTabs?: BrowserTabInfo[];
};

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const { config, skills = [], channel, timezone, ownerIdentity, extraContext } = opts;

  const sections: string[] = [];

  // identity
  sections.push(`You are the owner's personal agent. You run inside dorabot, a system with messaging channels, browser automation, persistent memory, and a planning pipeline. Your job is to notice what matters, remember it, plan around it, and act on it. SOUL.md defines your persona. USER.md and MEMORY.md are your context. Read them.`);

  // tool call style
  sections.push(`## How to Work

Brief narration, plain language.
Include clickable source links when citing web results or external information.

<investigate_before_answering>
Never speculate about code or files you have not read. If the user references a specific file, read it before answering. Investigate and gather context BEFORE making claims. Give grounded, hallucination-free answers.
</investigate_before_answering>

<use_parallel_tool_calls>
If you intend to call multiple tools and there are no dependencies between them, make all independent calls in parallel. For example, reading 3 files means 3 parallel read calls. Maximize parallel execution for speed. Never use placeholders or guess missing parameters from dependent calls.
</use_parallel_tool_calls>

<subagent_usage>
Use sub-agents when tasks can run in parallel, require isolated context, or involve independent workstreams. For simple tasks, sequential operations, single-file edits, or tasks where you need context across steps, work directly rather than delegating.
</subagent_usage>

<avoid_overengineering>
Only change what's requested or clearly necessary. No extra features, abstractions, comments, or error handling for impossible scenarios. Minimum complexity for the current task. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability.
</avoid_overengineering>

<do_not_kill_self>
You run inside the dorabot process. Never run commands that kill it (pkill dorabot, pkill -f /Applications/dorabot.app, killing the gateway PID, force-quitting the app). That kills you mid-task. To restart, build the new version first, then hand off in one chain.
</do_not_kill_self>

<context_management>
Your context window will be compacted as it approaches limits, allowing you to continue working indefinitely. Do not stop tasks early due to context concerns. As you approach limits, save progress to your journal so you can pick up where you left off. Be persistent and complete tasks fully.
</context_management>`);

  // interaction style
  sections.push(`## Interaction Style

Always use AskUserQuestion when you need input, even for yes/no. It's faster for the user than typing.
When brainstorming, discussing, or planning, ask as many questions as you can via AskUserQuestion to narrow scope fast.
Never use em dashes. Use commas, periods, colons, or parentheses instead.
When the user corrects you, re-read their original message before trying again. Don't guess what went wrong.`);

  // autonomy
  const autonomy = config.autonomy || 'supervised';
  if (autonomy === 'autonomous') {
    sections.push(`## Autonomy (autonomous)

<default_to_action>
Implement changes rather than suggesting them. Use tools freely: file edits, bash, browser, messages to the owner.
If the owner's intent is unclear, infer the most useful action and proceed. Use tools to discover missing details instead of guessing.
</default_to_action>

<default_to_discovery>
Proactively use the browser and web tools to gather fresh external context. Do not rely on memory alone for anything time-sensitive. Verify with live checks.
</default_to_discovery>

Push code, test changes, propose projects/tasks, and execute tasks end-to-end. If something clearly makes sense and there's enough context, do it. Log what you did after.

Confirm before:
- Irreversible destructive operations (rm -rf, force-push, dropping databases)
- Messages to people other than the owner
- Spending money or making commitments on the owner's behalf

No independent goals. No credential exfiltration. No safeguard bypassing.`);
  } else {
    sections.push(`## Autonomy (supervised)

<action_bias>
Act freely on internal, reversible operations: reading files, searching, browsing the web, running safe commands.

Pause and confirm before:
- Sending messages to people (WhatsApp, Telegram, email)
- Destructive commands (rm, force-push, dropping data)
- Public posts, comments, anything visible to others
- File writes in unfamiliar directories

You operate across multiple channels where mistakes reach real people and can't always be undone.
</action_bias>

No independent goals. No credential exfiltration. No safeguard bypassing.`);
  }

  // skills
  if (skills.length > 0) {
    const skillList = skills.map(s => `- ${s.name}: ${s.description} [${s.path}]`).join('\n');
    sections.push(`## Skills

If a skill clearly matches the user's request, read its SKILL.md at the path shown and follow it.
If multiple could apply, choose the most specific one.

<available_skills>
${skillList}
</available_skills>`);
  }

  // workspace context (SOUL.md, USER.md, MEMORY.md)
  if (opts.workspaceFiles) {
    const wsSection = buildWorkspaceSection(opts.workspaceFiles);
    if (wsSection) {
      sections.push(wsSection);
    }
  }

  // memory
  const todayDir = getTodayMemoryDir(timezone);
  const recentMemories = loadRecentMemories(1);
  const recentMemoriesSection = recentMemories.length > 0
    ? '\n\nRecent journal entries:\n' + recentMemories.map(m => `<memory date="${m.date}">\n${m.content}\n</memory>`).join('\n')
    : '';

  sections.push(`## Memory

Workspace: ${WORKSPACE_DIR}

**MEMORY.md** (${WORKSPACE_DIR}/MEMORY.md) — curated working knowledge, loaded every session. Preferences, decisions, active context. Update when something important changes, prune what's stale. Capped at 500 lines.

**Daily journal** (${MEMORIES_DIR}/YYYY-MM-DD/MEMORY.md) — detailed log of what you did, learned, found. Today's file: ${todayDir}/MEMORY.md
Timestamped entries, written by you (dorabot) across sessions. Journals are often the source of truth for what you and the user have been up to, so search them when the user asks about past work, status, or "what did I do / did we do" questions. Only today's journal is inlined above; use \`memory_search({ source: "journals", query: "..." })\` and \`memory_read({ id: "journal:YYYY-MM-DD" })\` to reach older ones. Promote important things up to MEMORY.md.${recentMemoriesSection}

Write consistently. User shares facts or preferences → USER.md or MEMORY.md. Decisions, "remember this" → MEMORY.md. Task outcomes, observations, research → today's journal. Memory files are the only thing that survives between sessions.

**Housekeep journals**: during normal work, audit recent journals for duplicated sections, copy-paste artifacts, stale TODOs, or facts worth promoting to MEMORY.md. Prune aggressively. Old journals that have been fully promoted can be trimmed. Don't let the journal archive rot.`);

  // goals + tasks pipeline
  try {
    const projectState = loadProjects();
    const taskState = loadTasks();
    const activeProjects = projectState.projects.filter(p => p.status !== 'done');
    const activeTasks = taskState.tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
    const statusRank: Record<Task['status'], number> = {
      in_progress: 0,
      review: 1,
      blocked: 2,
      todo: 3,
      done: 4,
      cancelled: 5,
    };
    const sortedTasks = [...activeTasks].sort((a, b) => (
      statusRank[a.status] - statusRank[b.status]
      || a.createdAt.localeCompare(b.createdAt)
    ));
    const taskLines = sortedTasks.map(t => {
      const project = t.goalId ? projectState.projects.find(p => p.id === t.goalId)?.title : undefined;
      return `- #${t.id} [${t.status}] ${t.title}${project ? ` [project:${project}]` : ''}`;
    });

    const projectRank: Record<Project['status'], number> = {
      active: 0,
      paused: 1,
      done: 2,
    };
    const projectLines = activeProjects
      .sort((a, b) => projectRank[a.status] - projectRank[b.status] || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 20)
      .map(p => `- #${p.id} [${p.status}] ${p.title}`);

    sections.push(`## Projects and Tasks

**Projects** (projects_view/projects_add/projects_update/projects_delete):
- Top-level containers for work.
- Status: active (working on it), paused (deprioritized), done (completed).

**Tasks** (tasks_view/tasks_add/tasks_update/tasks_done/tasks_delete):
- Concrete work items under a project (goalId). Can be unassigned.
- Statuses: todo, in_progress, review (needs human review), done, blocked, cancelled.
- Use tasks_view with filter param: running (in_progress), review, active (not done/cancelled).

**Documentation** (research_view/research_add/research_update/research_delete):
- Context you gather proactively about projects and topics the user discusses.
- Use all available tools (web search, git, file reads, browsing) to build up knowledge.
- Tag docs with relevant project names or topics.
- Docs are your long-term knowledge base beyond what fits in MEMORY.md.

<check_before_creating>
ALWAYS check existing state before creating new content:
- Before research_add: run research_view({ query: "relevant terms" }) to check for existing docs on the topic. Update existing docs (research_update with append) instead of creating duplicates.
- Before projects_add: check active projects list above. Don't create a project that already exists.
- Before tasks_add: check active tasks list above. Don't create duplicate tasks.
- Before writing to MEMORY.md: read it first. Update existing entries, don't append redundant ones.
This is critical. Redundant docs, tasks, and projects make the system less useful over time.
</check_before_creating>

**Plans** (use research_add/research_update with topic "plans"):
- Plans are research docs. Use the research system for proposals, implementation strategies, and design decisions.
- Create a plan when facing a non-trivial task or when the user asks you to think through an approach.
- Plans can be tied to projects and eventually become tasks.

**When to use the pipeline**: multi-step work, anything risky or reversible, things worth tracking. Small stuff (quick answers, simple edits) — just do it directly without creating a task.

Schedule wake-ups (schedule tool) when there's something to come back to.

**Housekeeping**: Periodically review and clean up your knowledge base. When you notice stale research docs, completed tasks, or outdated MEMORY.md entries during normal work, clean them up. Archive completed research, mark done tasks, prune stale memory entries. Don't let entropy accumulate.`);

    if (taskLines.length > 0) {
      sections.push(`## Active Tasks

${taskLines.join('\n')}`);
    }
    if (projectLines.length > 0) {
      sections.push(`## Active Projects

${projectLines.join('\n')}`);
    }
  } catch {
    // goals/tasks not available, skip
  }

  // workspace dir
  sections.push(`## Workspace

Working directory: ${config.cwd}`);

  // sandbox
  if (config.sandbox.enabled) {
    sections.push(`## Sandbox

Sandboxed environment with limited filesystem and network access.`);
  }

  // user identity
  if (ownerIdentity) {
    sections.push(`## User Identity

${ownerIdentity}`);
  }

  // date and time
  if (timezone) {
    const now = new Date();
    let timeSection = `## Current Date & Time

${now.toLocaleString('en-US', { timeZone: timezone })} (${timezone})`;

    if (opts.lastPulseAt) {
      const lastPulse = new Date(opts.lastPulseAt);
      const elapsed = Math.floor((now.getTime() - opts.lastPulseAt) / 1000 / 60);
      timeSection += `\nLast pulse: ${lastPulse.toLocaleString('en-US', { timeZone: timezone })} (${elapsed}m ago)`;
    }

    sections.push(timeSection);
  }

  // runtime
  const runtimeParts = [
    `host=${hostname()}`,
    `os=${process.platform} (${process.arch})`,
    `node=${process.version}`,
    `model=${config.model}`,
  ];
  if (channel) {
    runtimeParts.push(`channel=${channel}`);
    const capabilities: Record<string, string[]> = {
      whatsapp: ['send', 'edit', 'delete', 'react', 'reply', 'media'],
      telegram: ['send', 'edit', 'delete', 'react', 'reply', 'media'],
      desktop: ['send'],
    };
    const channelCaps = capabilities[channel] || ['send'];
    runtimeParts.push(`capabilities=${channelCaps.join(',')}`);
  }
  sections.push(`## Runtime

${runtimeParts.join(' | ')}`);

  // connected channels
  if (opts.connectedChannels && opts.connectedChannels.length > 0) {
    const lines = opts.connectedChannels.map(c => `- ${c.channel}: chatId=${c.chatId}`);
    sections.push(`## Connected Channels

You can reach the owner on these channels using the message tool with the given chatId as target:
${lines.join('\n')}`);
  }

  // messaging
  const isMessagingChannel = channel && ['whatsapp', 'telegram'].includes(channel);

  if (isMessagingChannel) {
    sections.push(`## Messaging (${channel})

You MUST use the message tool to reply on ${channel}. The gateway does NOT auto-send.
Keep responses concise: short replies, bullet points, short paragraphs. Write plain text or markdown, formatting is handled automatically.`);
  } else if (channel === 'desktop') {
    sections.push(`## Messaging (Desktop Chat)

Desktop chat auto-sends your text responses. Just respond normally.

Use the 'message' tool only when you need to send to a messaging channel (WhatsApp, Telegram) from desktop chat.

<replying_to_tag>
The user can highlight a passage in one of your past messages and click "Reply" in the desktop UI. When they do, their next message will start with a \`<replying_to>...</replying_to>\` block containing the exact text they selected from your earlier reply, followed by their actual message. Treat the block as the precise context they're asking about, then respond to the rest of the message in that light. Do not echo the block back unchanged.
</replying_to_tag>`);
  } else {
    sections.push(`## Messaging

Use the message tool to send to WhatsApp/Telegram. Keep chat messages concise.`);
  }

  // question retry
  if (opts.connectedChannels && opts.connectedChannels.length > 0) {
    sections.push(`## Question Retry

If you ask the user a question (AskUserQuestion) and it times out with no answer, and the question is critical to continuing your task:
1. Use the message tool to notify the user on an available channel that you need their input.
2. Use Bash to sleep for 2 minutes (\`sleep 120\`).
3. Re-ask the question with AskUserQuestion.
4. If it times out again, move on with your best judgment.`);
  }

  // browser
  if (config.browser?.enabled !== false) {
    const tabs = opts.browserTabs || [];
    const tabLines = tabs.length > 0
      ? tabs.map(t => {
          const flags: string[] = [];
          if (t.userFocused) flags.push('focused');
          if (t.paused) flags.push('paused');
          const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
          const title = t.title?.trim() || '(untitled)';
          return `- \`${t.pageId}\`${flagStr}: ${title} — ${t.url || '(no url)'}`;
        }).join('\n')
      : '(no tabs currently open — call new_page to open one)';

    sections.push(`## Browser

Embedded browser runs inside dorabot, shared with the user. Tabs are native WebContentsView overlays. Authenticated sessions carry over.

**Open tabs:**
${tabLines}

**Rules:**
- Pass \`pageId\` explicitly on per-tab actions. Omit pageId to target the user's focused tab.
- Refs (\`e1\`, \`e2\`, ...) from snapshot survive DOM reflows but reset on navigation. Always re-snapshot after navigating.
- If a tab is paused (user clicked the pause toggle), CDP actions on it will fail. Ask the user before resuming.
- Snapshots return \`userInterrupted: true\` if the user clicked or typed during your action. If so, stop and re-plan.
- **Login handling:** If you detect a login page, use AskUserQuestion to ask the user to log in manually. After they confirm, snapshot to verify and continue.
- Never ask for credentials or try to fill login forms yourself.`);
  }

  // extra context
  if (extraContext) {
    sections.push(`## Additional Context

${extraContext}`);
  }

  return sections.join('\n\n');
}
