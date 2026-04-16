import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';
import type { AgentDefinition, Config } from '../config.js';
import { CLAUDE_AGENTS_DIR } from '../workspace.js';

// built-in agent definitions
export const builtInAgents: Record<string, AgentDefinition> = {
  'code-review': {
    description: 'Reviews code for quality, security vulnerabilities, and best practices',
    tools: ['Read', 'Grep', 'Glob'],
    prompt: `You are a code reviewer. Your job is to:
- Identify potential bugs and issues
- Check for security vulnerabilities
- Suggest improvements for readability and maintainability
- Verify adherence to best practices

Be thorough but constructive. Focus on actionable feedback.`,
    model: 'sonnet',
  },

  'researcher': {
    description: 'Researches topics using web search and summarizes findings',
    tools: ['WebSearch', 'WebFetch'],
    prompt: `You are a research assistant. Your job is to:
- Search the web for relevant information
- Synthesize findings from multiple sources
- Provide accurate, well-sourced summaries
- Identify key facts and data points

Always cite your sources and note any conflicting information.`,
    model: 'haiku',
  },

  'file-organizer': {
    description: 'Organizes and restructures files and directories',
    tools: ['Read', 'Write', 'Glob', 'Bash'],
    prompt: `You are a file organization assistant. Your job is to:
- Analyze directory structures
- Suggest and implement organizational improvements
- Move, rename, and restructure files
- Create appropriate directory hierarchies

Always confirm before making destructive changes.`,
    model: 'sonnet',
  },

  'test-writer': {
    description: 'Writes tests for code based on existing implementation',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    prompt: `You are a test writing assistant. Your job is to:
- Analyze existing code to understand functionality
- Write comprehensive test cases
- Cover edge cases and error conditions
- Follow testing best practices for the language/framework

Match the existing testing style and conventions in the project.`,
    model: 'sonnet',
  },

  'doc-writer': {
    description: 'Generates documentation for code and APIs',
    tools: ['Read', 'Write', 'Edit', 'Glob'],
    prompt: `You are a documentation writer. Your job is to:
- Analyze code to understand functionality
- Write clear, comprehensive documentation
- Include examples and usage patterns
- Document parameters, return values, and exceptions

Match the existing documentation style in the project.`,
    model: 'haiku',
  },

  'refactor': {
    description: 'Refactors code to improve structure without changing behavior',
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    prompt: `You are a refactoring assistant. Your job is to:
- Identify code that can be improved
- Refactor without changing external behavior
- Improve readability and maintainability
- Extract reusable components and reduce duplication

Always run tests after refactoring to verify behavior is preserved.`,
    model: 'sonnet',
  },

  'debugger': {
    description: 'Helps debug issues by analyzing code and logs',
    tools: ['Read', 'Grep', 'Glob', 'Bash'],
    prompt: `You are a debugging assistant. Your job is to:
- Analyze error messages and stack traces
- Search for relevant code and logs
- Identify root causes of issues
- Suggest fixes with explanations

Be systematic in your approach and explain your reasoning.`,
    model: 'sonnet',
  },

  'planner': {
    description: 'Creates implementation plans for complex tasks',
    tools: ['Read', 'Glob', 'Grep'],
    prompt: `You are a planning assistant. Your job is to:
- Analyze requirements and existing code
- Break down complex tasks into steps
- Identify dependencies and risks
- Create actionable implementation plans

Focus on clarity and completeness. Flag any ambiguities.`,
    model: 'sonnet',
  },
};

const MODEL_MAP: Record<string, 'sonnet' | 'opus' | 'haiku' | 'inherit'> = {
  'claude-opus-4-7': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-opus-4-6': 'opus',
  'claude-haiku-4-5': 'haiku',
  'sonnet': 'sonnet',
  'opus': 'opus',
  'haiku': 'haiku',
};

/** Load CC-format agent definitions from a directory of .md files */
function loadCCAgentsFromDir(dir: string): Record<string, AgentDefinition> {
  if (!existsSync(dir)) return {};
  const agents: Record<string, AgentDefinition> = {};

  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stat = statSync(entryPath);

    let mdPath: string | null = null;
    let name: string;

    if (stat.isDirectory()) {
      // .claude/agents/<name>/agent.md or just the first .md file
      const agentMd = join(entryPath, 'agent.md');
      const indexMd = join(entryPath, `${entry}.md`);
      if (existsSync(agentMd)) mdPath = agentMd;
      else if (existsSync(indexMd)) mdPath = indexMd;
      else {
        // try first .md in directory
        const mds = readdirSync(entryPath).filter(f => f.endsWith('.md'));
        if (mds.length > 0) mdPath = join(entryPath, mds[0]);
      }
      name = entry;
    } else if (entry.endsWith('.md')) {
      mdPath = entryPath;
      name = basename(entry, '.md');
    } else {
      continue;
    }

    if (!mdPath || !existsSync(mdPath)) continue;

    try {
      const content = readFileSync(mdPath, 'utf-8');
      const { data, content: body } = matter(content);

      const description = data.description || '';
      const prompt = body.trim();
      if (!prompt) continue;

      const tools: string[] = [];
      if (data['allowed-tools']) {
        const raw = data['allowed-tools'];
        if (typeof raw === 'string') tools.push(...raw.split(/\s+/));
        else if (Array.isArray(raw)) tools.push(...raw);
      }

      const model = data.model ? (MODEL_MAP[data.model] || 'inherit') : undefined;

      agents[name] = { description, prompt, tools: tools.length > 0 ? tools : undefined, model };
    } catch {
      // skip malformed agent files
    }
  }

  return agents;
}

/** Load agents from all CC agent directories (personal + project) */
function loadCCAgents(cwd: string): Record<string, AgentDefinition> {
  const personal = loadCCAgentsFromDir(CLAUDE_AGENTS_DIR);
  const project = loadCCAgentsFromDir(join(cwd, '.claude', 'agents'));
  // personal takes priority over project on collision
  return { ...project, ...personal };
}

export function getBuiltInAgents(): Record<string, AgentDefinition> {
  return { ...builtInAgents };
}

export function getAllAgents(config: Config): Record<string, AgentDefinition> {
  const ccAgents = loadCCAgents(config.cwd);
  // priority: built-in > config > CC agents (built-in wins on collision)
  return {
    ...ccAgents,
    ...config.agents,
    ...builtInAgents,
  };
}

export function getAgentByName(name: string, config: Config): AgentDefinition | null {
  const all = getAllAgents(config);
  return all[name] || null;
}

export function listAgentNames(config: Config): string[] {
  return Object.keys(getAllAgents(config));
}

export function describeAgents(config: Config): string {
  const agents = getAllAgents(config);
  return Object.entries(agents)
    .map(([name, def]) => `- ${name}: ${def.description}`)
    .join('\n');
}
