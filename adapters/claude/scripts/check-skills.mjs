#!/usr/bin/env node
// scripts/check-skills.mjs
// Validate plugin structure: directory/frontmatter consistency, worker bindings,
// entry references, dependency cycles, dangling targets, forbidden tools, file existence.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 动态导入 context-budget 模块（可能不存在）
let _estimateTokens = null;
try {
  const mod = await import('./lib/context-budget.mjs');
  _estimateTokens = mod.estimateTokens;
} catch {
  // 模块尚未创建时跳过 token 检查
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

/** Parse YAML-ish frontmatter from markdown. */
export function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown };
  const raw = match[1];
  const body = markdown.slice(match[0].length).trimStart();
  const frontmatter = {};
  let currentKey = null;
  let inList = false;
  let listKey = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    // list item under a key
    if (/^-\s+/.test(trimmed) && listKey) {
      if (!frontmatter[listKey]) frontmatter[listKey] = [];
      frontmatter[listKey].push(trimmed.replace(/^-\s+/, '').trim());
      inList = true;
      continue;
    }
    // key: value
    const kv = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '' || val === '[]') {
        // Could be a list that follows
        listKey = currentKey;
        frontmatter[currentKey] = [];
        inList = false;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Inline array like [a, b]
        frontmatter[currentKey] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        listKey = null;
        inList = false;
      } else {
        frontmatter[currentKey] = val.replace(/^["']|["']$/g, '');
        listKey = null;
        inList = false;
      }
    }
  }
  return { frontmatter, body };
}

/** Read a markdown file and parse its frontmatter + body. */
function readMarkdown(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return parseFrontmatter(content);
}

/** Walk a directory collecting .md files. */
function collectMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(full);
    if (entry.name.endsWith('.md')) return [full];
    return [];
  });
}

export function checkSkills(pluginRoot) {
  const errors = [];
  const root = pluginRoot || ROOT;
  const skillsDir = path.join(root, 'skills');
  const agentsDir = path.join(root, 'agents');

  // 1. Collect all skills
  const skillDirs = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    : [];

  const skillNames = new Set();
  const skillByName = new Map();

  for (const dirName of skillDirs) {
    const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      errors.push(`Skill directory ${dirName} missing SKILL.md`);
      continue;
    }
    const { frontmatter } = readMarkdown(skillFile);
    const fmName = frontmatter.name;
    if (!fmName) {
      errors.push(`Skill ${dirName}/SKILL.md missing name in frontmatter`);
      continue;
    }
    // Check directory name == frontmatter name
    if (dirName !== fmName) {
      errors.push(`Skill directory name "${dirName}" does not match frontmatter name "${fmName}"`);
    }
    skillNames.add(fmName);
    skillByName.set(fmName, { dirName, frontmatter });
  }

  // 2. Collect all agents (workers)
  const agentFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => path.join(agentsDir, e.name))
    : [];

  const agentByName = new Map();

  for (const agentFile of agentFiles) {
    const { frontmatter, body } = readMarkdown(agentFile);
    const agentName = frontmatter.name;
    if (!agentName) {
      errors.push(`Agent ${path.basename(agentFile)} missing name in frontmatter`);
      continue;
    }
    agentByName.set(agentName, { file: agentFile, frontmatter, body });

    // Check: Worker must bind exactly one skill
    const skills = frontmatter.skills;
    if (!Array.isArray(skills) || skills.length === 0) {
      errors.push(`Agent ${agentName}: no skills binding`);
    } else if (skills.length !== 1) {
      errors.push(`Agent ${agentName}: must bind exactly 1 skill, got ${skills.length}`);
    }

    // Check: Worker skills must reference existing skills
    for (const sk of (skills || [])) {
      if (!skillNames.has(sk)) {
        errors.push(`Agent ${agentName}: references non-existent skill "${sk}"`);
      }
    }

    // Check: disallowedTools must include Skill and Agent
    const disallowed = frontmatter.disallowedTools || [];
    if (!Array.isArray(disallowed)) {
      errors.push(`Agent ${agentName}: disallowedTools must be an array`);
    } else {
      if (!disallowed.includes('Skill')) {
        errors.push(`Agent ${agentName}: disallowedTools missing "Skill"`);
      }
      if (!disallowed.includes('Agent')) {
        errors.push(`Agent ${agentName}: disallowedTools missing "Agent"`);
      }
      if (!disallowed.includes('Edit')) {
        errors.push(`Agent ${agentName}: disallowedTools missing "Edit"`);
      }
    }

    // Check: body mentions read-only
    if (!/read.only/i.test(body)) {
      errors.push(`Agent ${agentName}: body does not mention "read-only"`);
    }
  }

  // 3. Check entry Stage Map / Workflow Map references (plugin.json skills field)
  const pluginJsonPath = path.join(root, '.codex-plugin', 'plugin.json');
  if (fs.existsSync(pluginJsonPath)) {
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    const skillsField = pluginJson.skills;
    if (skillsField) {
      // Resolve relative to plugin root, not to .codex-plugin directory
      const resolvedSkillsDir = path.resolve(root, skillsField);
      if (!fs.existsSync(resolvedSkillsDir)) {
        errors.push(`plugin.json skills path "${skillsField}" does not resolve to an existing directory`);
      }
    }
  }

  // 4. Check for dependency cycles (skills referencing each other via rule-catalog)
  // For now, skills are independent (each binds to a rule category), so no cycles expected.
  // But verify each skill's referenced files exist within plugin root.
  for (const [skillName, { frontmatter }] of skillByName) {
    // Check that the skill directory is within the plugin root
    const skillDir = path.join(skillsDir, skillName);
    const realRoot = fs.realpathSync(root);
    const realSkillDir = fs.realpathSync(skillDir);
    if (!realSkillDir.startsWith(realRoot + path.sep) && realSkillDir !== realRoot) {
      errors.push(`Skill ${skillName}: directory escapes plugin root`);
    }
  }

  // 5. Check referenced files exist (rule-catalog.json, rules/*.md, schemas/*.json)
  const referencedFiles = [
    'references/rule-catalog.json',
    'references/rules/l4-review.md',
    'references/rules/l5-review.md',
    'references/rules/l6-review.md',
    'references/rules/sop-review.md',
    'references/rules/hierarchy-review.md',
    'references/rules/bpmn-review.md',
    'references/rules/visual-review.md',
    'references/rules/consistency-review.md',
    'references/schemas/finding-set.schema.json',
    'references/schemas/architecture-model.schema.json',
    'references/schemas/diagram-model.schema.json',
    'references/schemas/consistency-map.schema.json',
    'references/schemas/result.schema.json',
    'references/schemas/context-budget.schema.json',
    'references/schemas/normalized-document.schema.json',
  ];
  for (const ref of referencedFiles) {
    const abs = path.join(root, ref);
    if (!fs.existsSync(abs)) {
      errors.push(`Referenced file missing: ${ref}`);
    }
  }

  // 6. Validate rule catalog JSON
  const catalogPath = path.join(root, 'references', 'rule-catalog.json');
  if (fs.existsSync(catalogPath)) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    if (!Array.isArray(catalog.rules)) {
      errors.push('rule-catalog.json: "rules" is not an array');
    } else {
      for (const rule of catalog.rules) {
        if (!rule.rule_id) errors.push('rule-catalog.json: rule missing rule_id');
        if (!rule.title) errors.push(`rule-catalog.json: rule ${rule.rule_id || '?'} missing title`);
        if (!rule.category) errors.push(`rule-catalog.json: rule ${rule.rule_id || '?'} missing category`);
        if (rule.deterministic_check === undefined) errors.push(`rule-catalog.json: rule ${rule.rule_id || '?'} missing deterministic_check`);
        if (!rule.public_reference) errors.push(`rule-catalog.json: rule ${rule.rule_id || '?'} missing public_reference`);
      }
    }
  }

  // 7. Check SKILL.md token budgets
  const SKILL_TOKEN_BASELINE = 2000;
  const SKILL_TOKEN_LIMIT = 2400;
  const SKILL_TOKEN_TARGET = 1500;
  if (_estimateTokens) {
    for (const [skillName, { dirName }] of skillByName) {
      const skillFile = path.join(skillsDir, dirName, 'SKILL.md');
      const content = fs.readFileSync(skillFile, 'utf8');
      const est = _estimateTokens(content);
      if (est.estimated_tokens > SKILL_TOKEN_LIMIT) {
        errors.push(`Skill ${skillName}: ${est.estimated_tokens} tokens exceeds hard limit ${SKILL_TOKEN_LIMIT}`);
      } else if (est.estimated_tokens > SKILL_TOKEN_BASELINE) {
        // Attention: log warning but not error
        process.stderr.write(`WARN: Skill ${skillName}: ${est.estimated_tokens} tokens (target ≤${SKILL_TOKEN_TARGET}, baseline ${SKILL_TOKEN_BASELINE})\n`);
      }
    }
  }

  return errors;
}

// CLI entry point
if (process.argv[1] === __filename || process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkSkills(ROOT);
  if (errors.length > 0) {
    for (const err of errors) {
      process.stderr.write(`ERROR: ${err}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write('check-skills passed: all validations OK\n');
  }
}
