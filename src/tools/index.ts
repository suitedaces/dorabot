import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { messageTool } from './messaging.js';
import { calendarTools } from './calendar.js';
import { screenshotTool } from './screenshot.js';
import { browserTool } from './browser.js';
import { plansTools } from './plans.js';
import { ideasTools } from '../roadmap/tools.js';
import { researchTools } from './research.js';
import { memoryTools } from './memory.js';

export { messageTool, registerChannelHandler, getChannelHandler, type ChannelHandler } from './messaging.js';
export { setScheduler, getScheduler } from './calendar.js';
export { screenshotTool } from './screenshot.js';
export { browserTool, setBrowserConfig } from './browser.js';
export { loadPlans, savePlans, type Plan, type PlansState, type PlanRunState, type PlanStatus, type PlanType } from './plans.js';
export { loadRoadmap, saveRoadmap, type RoadmapItem, type RoadmapLane, type RoadmapState } from '../roadmap/tools.js';
export { loadResearch, saveResearch, type Research, type ResearchItem } from './research.js';

// all custom tools for this agent
const customTools = [
  messageTool,
  screenshotTool,
  browserTool,
  ...calendarTools,
  ...plansTools,
  ...ideasTools,
  ...researchTools,
  ...memoryTools,
];

export function createAgentMcpServer() {
  return createSdkMcpServer({
    name: 'dorabot-tools',
    version: '1.0.0',
    tools: customTools,
  });
}
