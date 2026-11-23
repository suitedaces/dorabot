import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { messageTool } from './messaging.js';
import { calendarTools } from './calendar.js';
import { screenshotTool } from './screenshot.js';
import { browserTool } from './browser.js';
import { projectsTools } from './projects.js';
import { tasksTools } from './tasks.js';
import { researchTools } from './research.js';
import { memoryTools } from './memory.js';
import { watchTools } from './watch.js';

export { messageTool, registerChannelHandler, getChannelHandler, type ChannelHandler } from './messaging.js';
export { setScheduler, getScheduler } from './calendar.js';
export { screenshotTool } from './screenshot.js';
export { browserTool, setBrowserConfig } from './browser.js';
export { loadProjects, saveProjects, type Project, type ProjectStatus, type ProjectsState } from './projects.js';
export {
  loadTasks,
  saveTasks,
  appendTaskLog,
  readTaskLogs,
  type Task,
  type TaskStatus,
  type TasksState,
} from './tasks.js';
export { loadResearch, saveResearch, type Research, type ResearchItem } from './research.js';

// all custom tools for this agent
export const customTools = [
  messageTool,
  screenshotTool,
  browserTool,
  ...calendarTools,
  ...projectsTools,
  ...tasksTools,
  ...researchTools,
  ...memoryTools,
  ...watchTools,
];

export function createAgentMcpServer() {
  return createSdkMcpServer({
    name: 'dorabot-tools',
    version: '1.0.0',
    tools: customTools,
  });
}

export function createStandardMcpServer() {
  const server = new McpServer({
    name: 'dorabot-tools',
    version: '1.0.0',
  });

  for (const sdkTool of customTools) {
    server.registerTool(sdkTool.name, {
      description: sdkTool.description,
      inputSchema: sdkTool.inputSchema,
      annotations: sdkTool.annotations,
    }, async (args: any, extra: any) => sdkTool.handler(args as never, extra));
  }

  return server;
}
