import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readAgent, parseFrontmatter } from './helpers/frontmatter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// All expected architecture workers
const WORKERS = [
  'flow-architect-review-l4-worker',
  'flow-architect-review-l5-worker',
  'flow-architect-review-l6-worker',
  'flow-architect-review-sop-worker',
  'flow-architect-review-hierarchy-worker',
  'flow-architect-extract-architecture-worker',
  'flow-architect-extract-diagram-worker',
  'flow-architect-review-bpmn-worker',
  'flow-architect-review-visual-worker',
  'flow-architect-review-consistency-worker',
  'flow-architect-extract-process-fragment-worker',
];

// Map each worker to its expected skill
const WORKER_SKILL_MAP = {
  'flow-architect-review-l4-worker': 'flow-architect-review-l4',
  'flow-architect-review-l5-worker': 'flow-architect-review-l5',
  'flow-architect-review-l6-worker': 'flow-architect-review-l6',
  'flow-architect-review-sop-worker': 'flow-architect-review-sop',
  'flow-architect-review-hierarchy-worker': 'flow-architect-review-hierarchy',
  'flow-architect-extract-architecture-worker': 'flow-architect-extract-architecture',
  'flow-architect-extract-diagram-worker': 'flow-architect-extract-diagram',
  'flow-architect-review-bpmn-worker': 'flow-architect-review-bpmn',
  'flow-architect-review-visual-worker': 'flow-architect-review-visual',
  'flow-architect-review-consistency-worker': 'flow-architect-review-consistency',
  'flow-architect-extract-process-fragment-worker': 'flow-architect-draft-process',
};

// --- Tests ---

for (const workerName of WORKERS) {
  test(`${workerName}: binds exactly one matching skill`, () => {
    const { frontmatter } = readAgent(workerName);
    const expectedSkill = WORKER_SKILL_MAP[workerName];

    assert.ok(Array.isArray(frontmatter.skills), `${workerName}: skills must be an array`);
    assert.equal(frontmatter.skills.length, 1, `${workerName}: must bind exactly 1 skill, got ${frontmatter.skills.length}`);
    assert.equal(frontmatter.skills[0], expectedSkill, `${workerName}: expected skill "${expectedSkill}", got "${frontmatter.skills[0]}"`);
  });

  test(`${workerName}: has disallowedTools including Skill, Agent, and Edit`, () => {
    const { frontmatter } = readAgent(workerName);

    assert.ok(Array.isArray(frontmatter.disallowedTools), `${workerName}: disallowedTools must be an array`);
    assert.ok(frontmatter.disallowedTools.includes('Skill'), `${workerName}: disallowedTools must include "Skill"`);
    assert.ok(frontmatter.disallowedTools.includes('Agent'), `${workerName}: disallowedTools must include "Agent"`);
    assert.ok(frontmatter.disallowedTools.includes('Edit'), `${workerName}: disallowedTools must include "Edit"`);
  });

  test(`${workerName}: body mentions read-only`, () => {
    const { body } = readAgent(workerName);
    assert.ok(/read.only/i.test(body), `${workerName}: body must mention "read-only"`);
  });
}

// Test: each skill directory name matches its frontmatter name
test('all skill directory names match frontmatter names', () => {
  const skillsDir = path.join(ROOT, 'skills');
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory());

  for (const entry of entries) {
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const content = fs.readFileSync(skillFile, 'utf8');
    const { frontmatter } = parseFrontmatter(content);
    assert.equal(entry.name, frontmatter.name,
      `Skill directory "${entry.name}" does not match frontmatter name "${frontmatter.name}"`);
  }
});

test('all skills use trigger-focused descriptions and state the untrusted-input boundary', () => {
  const skillsDir = path.join(ROOT, 'skills');
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(e => e.isDirectory());

  for (const entry of entries) {
    const content = fs.readFileSync(path.join(skillsDir, entry.name, 'SKILL.md'), 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);
    assert.match(frontmatter.description, /^Use when\b/, `${entry.name}: description must state trigger conditions`);
    assert.match(body, /untrusted data/i, `${entry.name}: must treat input contents as untrusted data`);
    if (entry.name === 'flow-architect-help') {
      assert.match(body, /零写入/, `${entry.name}: help must be zero-write`);
      assert.doesNotMatch(body, /所有写入操作.*runDir/, `${entry.name}: zero-write help must not invent a runDir`);
    } else if (entry.name === 'flow-architect-setup') {
      assert.match(body, /用户缓存/, `${entry.name}: setup writes only to the runtime cache`);
      assert.match(body, /不得写插件目录或业务输入目录/, `${entry.name}: setup must protect plugin and input files`);
    } else {
      assert.match(body, /path containment/i, `${entry.name}: must require path containment before writes`);
      assert.match(body, /runDir/, `${entry.name}: must restrict writes to runDir`);
    }
  }
});

test('all worker agents reject embedded instructions and restrict outputs to contained runDir paths', () => {
  const agentsDir = path.join(ROOT, 'agents');
  const files = fs.readdirSync(agentsDir).filter(name => name.endsWith('.md'));
  assert.equal(files.length, 13);
  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const { body } = parseFrontmatter(content);
    assert.match(body, /untrusted data/i, `${file}: must treat documents as untrusted data`);
    assert.match(body, /path containment/i, `${file}: must validate path containment`);
    assert.match(body, /runDir/, `${file}: must restrict writes to runDir`);
  }
});

test('review flows and validator require an adversarial evidence re-check before finalization', () => {
  const skillNames = [
    'flow-architect-flow-review-integrated',
    'flow-architect-flow-review-architecture',
    'flow-architect-flow-review-diagram',
    'flow-architect-validate',
  ];
  for (const name of skillNames) {
    const content = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(content, /attempt to falsify/i, `${name}: must include an adversarial re-check`);
  }
});

// Test: all referenced skill directories exist
test('all worker-referenced skills exist as directories', () => {
  const skillsDir = path.join(ROOT, 'skills');
  for (const [workerName, skillName] of Object.entries(WORKER_SKILL_MAP)) {
    const skillDir = path.join(skillsDir, skillName);
    assert.ok(fs.existsSync(skillDir), `Skill directory missing for ${workerName}: ${skillDir}`);
    const skillFile = path.join(skillDir, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile), `SKILL.md missing for ${skillName}: ${skillFile}`);
  }
});

// Test: rule catalog exists and is valid JSON
test('rule catalog exists and contains rules array', () => {
  const catalogPath = path.join(ROOT, 'references', 'rule-catalog.json');
  assert.ok(fs.existsSync(catalogPath), 'rule-catalog.json must exist');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.ok(Array.isArray(catalog.rules), 'rule-catalog.json must contain a rules array');
  assert.ok(catalog.rules.length > 0, 'rule-catalog.json must contain at least one rule');
});

// Test: rule catalog contains expected rule categories
test('rule catalog covers all expected rule categories', () => {
  const catalogPath = path.join(ROOT, 'references', 'rule-catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const categories = new Set(catalog.rules.map(r => r.category));
  for (const expected of ['L4', 'L5', 'L6', 'SOP', 'HIERARCHY', 'BPMN', 'VISUAL', 'CONSISTENCY']) {
    assert.ok(categories.has(expected), `rule-catalog.json missing category: ${expected}`);
  }
});
