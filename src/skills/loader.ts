import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import type { Config } from '../config.js';

export type SkillMetadata = {
  requires?: {
    bins?: string[];
    env?: string[];
    config?: string[];
  };
};

export type SkillFile = {
  /** Relative path from skill directory (e.g. "references/commands.md") */
  relativePath: string;
  /** Size in bytes */
  size: number;
};

export type Skill = {
  name: string;
  description: string;
  content: string;
  path: string;
  /** The skill's root directory (parent of SKILL.md) */
  dir: string;
  userInvocable: boolean;
  metadata: SkillMetadata;
  /** All files in the skill directory except SKILL.md */
  files: SkillFile[];
};

export type SkillEligibility = {
  eligible: boolean;
  reasons: string[];
};

function checkBinaryExists(bin: string): boolean {
  if (!/^[a-zA-Z0-9_\-]+$/.test(bin)) return false;
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkEnvVar(env: string): boolean {
  return !!process.env[env];
}

export function checkSkillEligibility(skill: Skill, config: Config): SkillEligibility {
  const reasons: string[] = [];
  const requires = skill.metadata.requires;

  // check if explicitly disabled
  if (config.skills.disabled.includes(skill.name)) {
    return { eligible: false, reasons: ['Explicitly disabled in config'] };
  }

  // check enabled list (if specified, only those are allowed)
  if (config.skills.enabled.length > 0 && !config.skills.enabled.includes(skill.name)) {
    return { eligible: false, reasons: ['Not in enabled list'] };
  }

  if (!requires) {
    return { eligible: true, reasons: [] };
  }

  // check required binaries
  if (requires.bins) {
    for (const bin of requires.bins) {
      if (!checkBinaryExists(bin)) {
        reasons.push(`Missing binary: ${bin}`);
      }
    }
  }

  // check required env vars
  if (requires.env) {
    for (const env of requires.env) {
      if (!checkEnvVar(env)) {
        reasons.push(`Missing env var: ${env}`);
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

/** Recursively collect all files in a directory, returning paths relative to root */
function collectFiles(dir: string, root: string): SkillFile[] {
  if (!existsSync(dir)) return [];
  const files: SkillFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectFiles(full, root));
    } else {
      const rel = full.slice(root.length + 1); // strip root + separator
      files.push({ relativePath: rel, size: stat.size });
    }
  }
  return files;
}

export function loadSkill(skillPath: string): Skill | null {
  const isFile = skillPath.endsWith('.md');
  const skillMdPath = isFile ? skillPath : join(skillPath, 'SKILL.md');
  const skillDir = isFile ? dirname(skillPath) : skillPath;

  if (!existsSync(skillMdPath)) {
    return null;
  }

  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const { data, content: body } = matter(content);

    const name = data.name || basename(skillDir);
    const description = data.description || '';
    const userInvocable = data['user-invocable'] !== false;
    const metadata: SkillMetadata = data.metadata || {};

    // collect all files in the skill directory except SKILL.md itself
    const allFiles = isFile ? [] : collectFiles(skillDir, skillDir)
      .filter(f => f.relativePath !== 'SKILL.md');

    return {
      name,
      description,
      content: body.trim(),
      path: skillMdPath,
      dir: skillDir,
      userInvocable,
      metadata,
      files: allFiles,
    };
  } catch (err) {
    console.error(`Failed to load skill from ${skillMdPath}:`, err);
    return null;
  }
}

export function loadSkillsFromDir(dir: string): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      const skill = loadSkill(entryPath);
      if (skill) skills.push(skill);
    } else if (entry.endsWith('.md') && entry !== 'README.md') {
      const skill = loadSkill(entryPath);
      if (skill) skills.push(skill);
    }
  }

  return skills;
}

export function loadAllSkills(config: Config): Skill[] {
  const allSkills: Skill[] = [];
  const seen = new Set<string>();

  for (const dir of config.skills.dirs) {
    const skills = loadSkillsFromDir(dir);
    for (const skill of skills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        allSkills.push(skill);
      }
    }
  }

  return allSkills;
}

export function getEligibleSkills(config: Config): Skill[] {
  const allSkills = loadAllSkills(config);
  return allSkills.filter(skill => checkSkillEligibility(skill, config).eligible);
}

export function findSkillByName(name: string, config: Config): Skill | null {
  const skills = loadAllSkills(config);
  return skills.find(s => s.name === name) || null;
}

export function matchSkillToPrompt(prompt: string, skills: Skill[]): Skill | null {
  // simple keyword matching - could be enhanced with embeddings
  const promptLower = prompt.toLowerCase();

  // exact name match first
  for (const skill of skills) {
    if (promptLower.includes(skill.name.toLowerCase())) {
      return skill;
    }
  }

  // check for keywords in description
  for (const skill of skills) {
    const descWords = skill.description.toLowerCase().split(/\s+/);
    const matches = descWords.filter(w => w.length > 3 && promptLower.includes(w));
    if (matches.length >= 2) {
      return skill;
    }
  }

  return null;
}
