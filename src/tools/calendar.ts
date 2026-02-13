import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { SchedulerRunner } from '../calendar/scheduler.js';

let scheduler: SchedulerRunner | null = null;

export function setScheduler(runner: SchedulerRunner): void {
  scheduler = runner;
}

export function getScheduler(): SchedulerRunner | null {
  return scheduler;
}

export const scheduleTool = tool(
  'schedule',
  'Create a scheduled item using iCal properties. The agent writes dtstart (ISO 8601) and rrule (RFC 5545 RRULE string) directly. Examples: one-shot reminder with dtstart "2026-03-01T09:00:00", daily at 9am with rrule "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", every Mon/Fri with rrule "FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=10;BYMINUTE=0", every 2nd Tuesday with rrule "FREQ=MONTHLY;BYDAY=2TU".',
  {
    summary: z.string().describe('Short name for this item'),
    message: z.string().describe('Agent prompt to execute when triggered'),
    dtstart: z.string().describe('Start date/time in ISO 8601, e.g. "2026-03-01T09:00:00"'),
    rrule: z.string().optional().describe('RFC 5545 RRULE string for recurrence, e.g. "FREQ=DAILY;BYHOUR=9;BYMINUTE=0"'),
    type: z.enum(['event', 'todo', 'reminder']).optional().describe('Item type: event (default), todo (with due date), reminder (one-shot, auto-deleted)'),
    description: z.string().optional().describe('Longer description'),
    dtend: z.string().optional().describe('End date/time in ISO 8601 (for time-bound events)'),
    due: z.string().optional().describe('Due date for todo items in ISO 8601'),
    timezone: z.string().optional().describe('IANA timezone like "America/New_York"'),
    valarm: z.number().optional().describe('Alarm trigger in seconds relative to dtstart (negative = before, e.g. -900 for 15min before)'),
    deleteAfterRun: z.boolean().optional().describe('If true, delete after first execution (default for reminders)'),
  },
  async (args) => {
    if (!scheduler) {
      return { content: [{ type: 'text' as const, text: 'Error: Scheduler not available' }], isError: true };
    }

    try {
      const itemType = args.type || (args.deleteAfterRun !== false && !args.rrule ? 'reminder' : 'event');
      const item = scheduler.addItem({
        type: itemType,
        summary: args.summary,
        description: args.description,
        message: args.message,
        dtstart: args.dtstart,
        dtend: args.dtend,
        due: args.due,
        rrule: args.rrule,
        timezone: args.timezone,
        valarm: args.valarm,
        deleteAfterRun: args.deleteAfterRun ?? (itemType === 'reminder'),
        enabled: true,
      });

      return {
        content: [{
          type: 'text' as const,
          text: `Scheduled!\nID: ${item.id}\nType: ${item.type}\nSummary: ${item.summary}\n${item.rrule ? `Recurrence: ${item.rrule}\n` : ''}Next run: ${item.nextRunAt || 'none'}`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Failed to schedule: ${err}` }], isError: true };
    }
  }
);

export const listScheduleTool = tool(
  'list_schedule',
  'List all scheduled events, tasks, and reminders.',
  {},
  async () => {
    if (!scheduler) {
      return { content: [{ type: 'text' as const, text: 'Error: Scheduler not available' }], isError: true };
    }

    const items = scheduler.listItems();
    if (items.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No scheduled items.' }] };
    }

    const formatted = items.map(item => {
      const schedule = item.rrule ? `RRULE: ${item.rrule}` : `once at ${item.dtstart}`;
      const status = item.enabled === false ? 'disabled' : 'enabled';
      const lastRun = item.lastRunAt ? `Last: ${item.lastRunAt}` : 'Not run yet';
      const nextRun = item.nextRunAt ? `Next: ${item.nextRunAt}` : '';

      return `${item.id} - ${item.summary} [${item.type}]
  Schedule: ${schedule}
  Status: ${status}
  ${lastRun}
  ${nextRun}
  Message: ${item.message.slice(0, 100)}${item.message.length > 100 ? '...' : ''}`;
    }).join('\n\n');

    return { content: [{ type: 'text' as const, text: `Scheduled Items (${items.length}):\n\n${formatted}` }] };
  }
);

export const updateScheduleTool = tool(
  'update_schedule',
  'Update a scheduled item by ID. Only provided fields are changed.',
  {
    id: z.string().describe('The item ID to update'),
    summary: z.string().optional(),
    message: z.string().optional(),
    dtstart: z.string().optional(),
    rrule: z.string().optional(),
    dtend: z.string().optional(),
    due: z.string().optional(),
    timezone: z.string().optional(),
    valarm: z.number().optional(),
    enabled: z.boolean().optional(),
  },
  async (args) => {
    if (!scheduler) {
      return { content: [{ type: 'text' as const, text: 'Error: Scheduler not available' }], isError: true };
    }

    const { id, ...updates } = args;
    // filter out undefined values
    const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    const item = scheduler.updateItem(id, filtered);

    if (item) {
      return { content: [{ type: 'text' as const, text: `Updated: ${item.id} — ${item.summary}\nNext run: ${item.nextRunAt || 'none'}` }] };
    }
    return { content: [{ type: 'text' as const, text: `Item not found: ${id}` }], isError: true };
  }
);

export const cancelScheduleTool = tool(
  'cancel_schedule',
  'Cancel/delete a scheduled item by its ID.',
  {
    id: z.string().describe('The item ID to cancel'),
  },
  async (args) => {
    if (!scheduler) {
      return { content: [{ type: 'text' as const, text: 'Error: Scheduler not available' }], isError: true };
    }

    const removed = scheduler.removeItem(args.id);
    if (removed) {
      return { content: [{ type: 'text' as const, text: `Cancelled: ${args.id}` }] };
    }
    return { content: [{ type: 'text' as const, text: `Item not found: ${args.id}` }], isError: true };
  }
);

export const calendarTools = [
  scheduleTool,
  listScheduleTool,
  updateScheduleTool,
  cancelScheduleTool,
];