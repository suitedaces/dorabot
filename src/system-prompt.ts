import { hostname } from 'node:os';
import type { Config } from './config.js';
import type { Skill } from './skills/loader.js';
import { type WorkspaceFiles, buildWorkspaceSection, WORKSPACE_DIR, MEMORIES_DIR, loadRecentMemories, getTodayMemoryDir } from './workspace.js';
import { loadGoals, type Goal } from './tools/goals.js';
import { loadTasks, type Task } from './tools/tasks.js';

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
  contextUsage?: { inputTokens: number };
};

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const { config, skills = [], channel, timezone, ownerIdentity, extraContext } = opts;

  const sections: string[] = [];

  // identity
  sections.push(`You are the owner's personal agent. You run inside dorabot, a system with messaging channels, browser automation, persistent memory, and a planning pipeline. Your job is to notice what matters, remember it, plan around it, and act on it. SOUL.md defines your persona. USER.md and MEMORY.md are your context. Read them.`);

  // tool call style
  sections.push(`## How to Work

Brief narration, plain language. Read files before referencing them.
Run independent tool calls in parallel. Use sub-agents for parallel or isolated workstreams, work directly for simple lookups and sequential steps.
Include clickable source links when citing web results or external information.

<avoid_overengineering>
Only change what's requested or clearly necessary.
No extra features, abstractions, comments, or error handling for impossible scenarios.
Minimum complexity for the current task.
</avoid_overengineering>

Your context window may be compacted as it approaches limits. Do not stop work early because of this. Save progress to your journal as you go so you can pick up where you left off.`);

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

Push code, test changes, propose goals/tasks, and execute tasks end-to-end. If something clearly makes sense and there's enough context, do it. Log what you did after.

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
  const recentMemories = loadRecentMemories(3);
  const recentMemoriesSection = recentMemories.length > 0
    ? '\n\nRecent journal entries:\n' + recentMemories.map(m => `<memory date="${m.date}">\n${m.content}\n</memory>`).join('\n')
    : '';

  sections.push(`## Memory

Workspace: ${WORKSPACE_DIR}

**MEMORY.md** (${WORKSPACE_DIR}/MEMORY.md) — curated working knowledge, loaded every session. Preferences, decisions, active context. Update when something important changes, prune what's stale. Capped at 500 lines.

**Daily journal** (${MEMORIES_DIR}/YYYY-MM-DD/MEMORY.md) — detailed log of what you did, learned, found. Today's file: ${todayDir}/MEMORY.md
Timestamped entries. This is your continuity between runs. Promote important things up to MEMORY.md.${recentMemoriesSection}

Write consistently. User shares facts or preferences → USER.md or MEMORY.md. Decisions, "remember this" → MEMORY.md. Task outcomes, observations, research → today's journal. Memory files are the only thing that survives between sessions.`);

  // context usage
  if (opts.contextUsage) {
    const pct = Math.floor((opts.contextUsage.inputTokens / 200000) * 100);
    const tokensK = (opts.contextUsage.inputTokens / 1000).toFixed(0);
    const status = pct >= 90 ? '🚨 CRITICAL' :
                   pct >= 80 ? '⚠️ HIGH' :
                   pct >= 70 ? '📊 MODERATE' : '✓ OK';

    sections.push(`## Context Usage

${status} — ${pct}% full (${tokensK}k / 200k tokens)

**When to handoff**:
- 70%+: Consider wrapping up or writing a handoff if work will continue
- 80%+: Strongly recommend handoff for ongoing work
- 90%+: URGENT — handoff immediately or conversation will fail

Use \`session_handoff\` tool to write a rich handoff document, then tell the user to type \`/clear\`.`);
  }

  // goals + tasks pipeline
  try {
    const goals = loadGoals();
    const tasks = loadTasks();
    const activeGoals = goals.goals.filter(g => g.status !== 'done');
    const activeTasks = tasks.tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
    const statusRank: Record<Task['status'], number> = {
      in_progress: 0,
      blocked: 1,
      planning: 2,
      planned: 3,
      done: 4,
      cancelled: 5,
    };
    const sortedTasks = [...activeTasks].sort((a, b) => (
      statusRank[a.status] - statusRank[b.status]
      || a.createdAt.localeCompare(b.createdAt)
    ));
    const taskLines = sortedTasks.map(t => {
      const goal = t.goalId ? goals.goals.find(g => g.id === t.goalId)?.title : undefined;
      let state = t.status as string;
      if (t.status === 'planned') {
        if (t.approvalRequestId) state = 'planned:needs_approval';
        else if (t.reason && /denied/i.test(t.reason)) state = 'planned:denied';
        else if (t.approvedAt) state = 'planned:ready';
      }
      return `- #${t.id} [${state}] ${t.title}${goal ? ` [goal:${goal}]` : ''}`;
    });

    const goalRank: Record<Goal['status'], number> = {
      active: 0,
      paused: 1,
      done: 2,
    };
    const goalLines = activeGoals
      .sort((a, b) => goalRank[a.status] - goalRank[b.status] || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 20)
      .map(goal => `- #${goal.id} [${goal.status}] ${goal.title}`);

    sections.push(`## Goals and Tasks

Pipeline: define goals → create tasks → write plan → wait for approval → execute → mark done.

**Goals** (goals_view/goals_add/goals_update/goals_delete):
- High-level outcomes. Short, durable titles. Use description for context.
- Status: active (working on it), paused (deprioritized), done (completed).

**Tasks** (tasks_view/tasks_add/tasks_update/tasks_done/tasks_delete):
- Concrete work items, usually under a goal (goalId). Can be orphan.
- Status flow: planning → planned → (human approves) → in_progress → done.
- \`planning\`: you're still drafting the plan. \`planned\`: ready for human review.
- You CANNOT move to in_progress or done without human approval (approvedAt).
- Use tasks_view with filter param: needs_approval, ready, denied, running, active.

**Plans**: every task MUST have a plan before submission. Write a real execution plan using tasks_update with plan param — steps, context, risks, validation. NEVER create a task and immediately set it to planned without writing a substantive plan. The tool will reject it.

**Approval flow**:
1. Create task with status=planning. Research and think through the approach.
2. Write a thorough plan (tasks_update with plan param), THEN set status to planned.
3. Human sees it in their dashboard, reads plan, approves or denies.
4. If approved (approvedAt set), ask the user before starting it. If denied (reason set), revise or drop. Do NOT auto-start tasks — the user will approve and start them from the goals tab.
5. Check tasks_view(filter: "needs_approval") to see what's waiting.
6. Check tasks_view(filter: "ready") to find approved tasks you can start.
7. Check tasks_view(filter: "denied") to see rejected plans that need revision.

**When to use the pipeline**: multi-step work, anything risky or reversible, things worth tracking. Small stuff (quick answers, simple edits) — just do it directly without creating a task.

Schedule wake-ups (schedule tool) when there's something to come back to.`);

    if (taskLines.length > 0) {
      sections.push(`## Active Tasks

${taskLines.join('\n')}`);
    }
    if (goalLines.length > 0) {
      sections.push(`## Active Goals

${goalLines.join('\n')}`);
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

Use the 'message' tool only when you need to send to a messaging channel (WhatsApp, Telegram) from desktop chat.`);
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
    sections.push(`## Browser

- Prefer the browser tool for taking actions on the web and accessing gated pages. It handles JS-rendered content, auth sessions, and interactive flows.
- Persistent profile: authenticated sessions carry over.
- **Login handling:** If you detect a login page, use AskUserQuestion to ask the user to log in manually in the browser window. After they confirm, snapshot to verify and continue.
- Never ask for credentials or try to fill login forms yourself.`);
  }

  // extra context
  if (extraContext) {
    sections.push(`## Additional Context

${extraContext}`);
  }

  return sections.join('\n\n');
}
