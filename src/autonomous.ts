import { getTodayMemoryDir, MEMORIES_DIR, WORKSPACE_DIR, RESEARCH_SKILL_PATH } from './workspace.js';

export const AUTONOMOUS_SCHEDULE_ID = 'autonomy-pulse';

const INTERVAL_TO_RRULE: Record<string, string> = {
  '15m': 'FREQ=MINUTELY;INTERVAL=15',
  '30m': 'FREQ=MINUTELY;INTERVAL=30',
  '1h': 'FREQ=HOURLY;INTERVAL=1',
  '2h': 'FREQ=HOURLY;INTERVAL=2',
};
export const PULSE_INTERVALS = Object.keys(INTERVAL_TO_RRULE);
export const DEFAULT_PULSE_INTERVAL = '30m';

export function pulseIntervalToRrule(interval: string): string {
  return INTERVAL_TO_RRULE[interval] || INTERVAL_TO_RRULE[DEFAULT_PULSE_INTERVAL];
}

export function rruleToPulseInterval(rrule: string): string {
  for (const [key, value] of Object.entries(INTERVAL_TO_RRULE)) {
    if (rrule === value) return key;
  }
  return DEFAULT_PULSE_INTERVAL;
}

export function buildAutonomousPrompt(timezone?: string): string {
  const todayDir = getTodayMemoryDir(timezone);

  return `Autonomous pulse. Fresh session. Memory files are your only continuity.

## Bootstrap

1. Read ${todayDir}/MEMORY.md if it exists (what you've already done today).
2. Check active plans (plan_view) and ideas (ideas_view).
3. If creating research output, check ${RESEARCH_SKILL_PATH} first.

## Priority (strict order)

1. **Advance in_progress plans.** Execute the next concrete step. Use the browser, run commands, write code, whatever it takes. Keep plan_update current.
2. **Act on monitored things.** Check prices, deployments, PRs, tracking pages. Live browser checks, not assumptions. If state changed, act or notify.
3. **Follow up with the owner.** If you asked something and they answered (check journal), incorporate it. If they haven't and it's been a while, nudge on an available channel.
4. **Handle blockers.** AskUserQuestion timeout? Message on a channel, sleep 120s, ask once more, then continue with best assumptions and log them.
5. **Research or prepare.** If a plan needs info, go get it. Store findings via research_add/research_update. Check research_view first to avoid duplicating.
6. **Get to know the owner.** If USER.md is mostly empty, use the onboard skill. One concise question per pulse via AskUserQuestion.
7. **Engage the owner.** Nudge them about their plans and tasks. Remind them what's pending, what needs their input, what's blocked on them. Use media to make it stick: generate a meme (meme skill with memegen.link) or an image tied to their current work, attach with media param. Always include a concrete next step or question.
8. **Propose new ideas.** Notice something worth doing? ideas_add. Ready to act? ideas_create_plan.
9. **Create momentum.** Break large plans into smaller steps, add missing ideas, queue follow-ups for later pulses.

Do at least one meaningful action every pulse. Do not end without a concrete next action.

## After acting

- Log to ${todayDir}/MEMORY.md with timestamp.
- Real findings → research_add (not memory files). Include source links.
- Stable facts changed → update ${WORKSPACE_DIR}/MEMORY.md.
- Created/updated plans, ideas, or research → message the owner (what changed, why, suggested next action).
- Urgent → message them.

## Boundaries

Stay focused. Before declaring "nothing to act on", verify: plans checked, ideas checked, monitoring checked, follow-ups checked, new ideas considered. Log why none were actionable. "Nothing to act on" should be rare.`;
}

export function buildAutonomousCalendarItem(timezone?: string, interval?: string) {
  return {
    type: 'event' as const,
    summary: 'Autonomy pulse',
    description: 'Periodic autonomy pulse',
    dtstart: new Date().toISOString(),
    rrule: pulseIntervalToRrule(interval || DEFAULT_PULSE_INTERVAL),
    timezone,
    message: buildAutonomousPrompt(timezone),
    session: 'main' as const,
    enabled: true,
    deleteAfterRun: false,
  };
}
