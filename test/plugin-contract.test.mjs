import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseFrontmatter } from './helpers/frontmatter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const ENTRY_SKILLS = [
  'flow-architect',
  'flow-architect-build-meeting-package',
  'flow-architect-flow-review-integrated',
  'flow-architect-flow-review-architecture',
  'flow-architect-flow-review-diagram',
  'flow-architect-help',
  'flow-architect-setup',
  'flow-architect-quickstart',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

// --- Plugin loading tests ---

test('codex plugin.json exists and is valid JSON', () => {
  const pluginJsonPath = path.join(ROOT, '.codex-plugin', 'plugin.json');
  assert.ok(fs.existsSync(pluginJsonPath), '.codex-plugin/plugin.json must exist');
  const raw = fs.readFileSync(pluginJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.name, 'flow-architect');
  assert.ok(parsed.skills, 'plugin.json must have a skills field');
});

test('plugin.json skills path resolves to existing directory', () => {
  const pluginJsonPath = path.join(ROOT, '.codex-plugin', 'plugin.json');
  const parsed = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  const resolved = path.resolve(ROOT, parsed.skills);
  assert.ok(fs.existsSync(resolved), `skills path "${parsed.skills}" must resolve to an existing directory`);
});

test('all public plugin manifests use version 0.4.1', () => {
  const manifests = [
    '.codex-plugin/plugin.json',
    'adapters/codex/.codex-plugin/plugin.json',
    'adapters/claude/.claude-plugin/plugin.json',
  ];
  for (const manifest of manifests) {
    assert.equal(readJson(manifest).version, '0.4.1', `${manifest} must use version 0.4.1`);
  }
});

test('claude root and adapter manifests declare exactly the three fixed commands', () => {
  for (const manifest of ['.claude-plugin/plugin.json', 'adapters/claude/.claude-plugin/plugin.json']) {
    assert.deepEqual(
      readJson(manifest).commands,
      ['./commands/help.md', './commands/setup.md', './commands/quickstart.md'],
      `${manifest} commands must be exactly help/setup/quickstart`
    );
  }
});

test('codex marketplace points to the root plugin', () => {
  const marketplace = readJson('.agents/plugins/marketplace.json');
  assert.equal(marketplace.name, 'flow-architect');
  assert.equal(marketplace.interface.displayName, 'Flow Architect');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'flow-architect');
  assert.deepEqual(marketplace.plugins[0].source, { source: 'local', path: './' });
  assert.deepEqual(marketplace.plugins[0].policy, {
    installation: 'AVAILABLE',
    authentication: 'ON_INSTALL',
  });
  assert.equal(marketplace.plugins[0].category, 'Productivity');
});

test('claude marketplace points to the generated adapter', () => {
  const marketplace = readJson('.claude-plugin/marketplace.json');
  assert.equal(marketplace.name, 'flow-architect');
  assert.equal(marketplace.owner.name, 'flow-architect contributors');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'flow-architect');
  assert.equal(marketplace.plugins[0].source, './adapters/claude');
  assert.equal(marketplace.plugins[0].version, '0.4.1');
});

test('legacy Claude adapter marketplace is not published', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'adapters', 'claude', 'marketplace.json')), false);
});

test('skills directory contains at least 16 skill subdirectories', () => {
  const skillsDir = path.join(ROOT, 'skills');
  assert.ok(fs.existsSync(skillsDir), 'skills/ directory must exist');
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory());
  assert.ok(entries.length >= 16, `Expected at least 16 skill directories, got ${entries.length}`);
});

// --- Entry skill discovery tests ---

for (const skillName of ENTRY_SKILLS) {
  test(`entry skill "${skillName}" exists with SKILL.md`, () => {
    const skillFile = path.join(ROOT, 'skills', skillName, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile), `Entry skill file missing: skills/${skillName}/SKILL.md`);
  });

  test(`entry skill "${skillName}" frontmatter name matches directory name`, () => {
    const skillFile = path.join(ROOT, 'skills', skillName, 'SKILL.md');
    const content = fs.readFileSync(skillFile, 'utf8');
    const { frontmatter } = parseFrontmatter(content);
    assert.equal(frontmatter.name, skillName,
      `Frontmatter name "${frontmatter.name}" does not match directory "${skillName}"`);
  });

  test(`entry skill "${skillName}" must NOT have category in frontmatter`, () => {
    const skillFile = path.join(ROOT, 'skills', skillName, 'SKILL.md');
    const content = fs.readFileSync(skillFile, 'utf8');
    const { frontmatter } = parseFrontmatter(content);
    assert.ok(!('category' in frontmatter),
      `Entry skill "${skillName}" must NOT have a category in frontmatter`);
  });
}

// --- test:browser script contract ---

test('test:browser uses test-with-runtime.mjs for runtime bootstrap', () => {
  const pkg = readJson('package.json');
  const browserScript = pkg.scripts['test:browser'];
  assert.ok(browserScript, 'test:browser script must exist');
  assert.ok(browserScript.includes('test-with-runtime.mjs'),
    'test:browser must route through test-with-runtime.mjs for runtime bootstrap');
});

test('test:browser includes all three new browser test files', () => {
  const pkg = readJson('package.json');
  const browserScript = pkg.scripts['test:browser'];
  for (const file of [
    'test/meeting-export-downloads-browser.test.mjs',
    'test/meeting-structural-dialogs-browser.test.mjs',
    'test/meeting-usability-browser.test.mjs',
  ]) {
    assert.ok(browserScript.includes(file),
      `test:browser must include ${file}`);
  }
});

// --- Plugin adapter loading tests ---

test('codex adapter has .codex-plugin/plugin.json with valid structure', () => {
  const adapterJsonPath = path.join(ROOT, 'adapters', 'codex', '.codex-plugin', 'plugin.json');
  assert.ok(fs.existsSync(adapterJsonPath), 'Codex adapter plugin.json must exist');
  const parsed = JSON.parse(fs.readFileSync(adapterJsonPath, 'utf8'));
  assert.equal(parsed.name, 'flow-architect');
  assert.ok(parsed.skills, 'Codex adapter must have skills field');
  assert.ok(Array.isArray(parsed.interface.capabilities), 'Codex adapter must have capabilities array inside interface');
});

test('claude adapter has .claude-plugin/plugin.json with valid structure', () => {
  const adapterJsonPath = path.join(ROOT, 'adapters', 'claude', '.claude-plugin', 'plugin.json');
  assert.ok(fs.existsSync(adapterJsonPath), 'Claude adapter plugin.json must exist');
  const parsed = JSON.parse(fs.readFileSync(adapterJsonPath, 'utf8'));
  assert.equal(parsed.name, 'flow-architect');
  assert.ok(parsed.skills, 'Claude adapter must have skills field');
  assert.ok(!('agents' in parsed), 'Claude adapter must NOT have agents field');
});

test('all entry skills are discoverable in codex adapter', () => {
  const adapterSkillsDir = path.join(ROOT, 'adapters', 'codex', 'skills');
  for (const skillName of ENTRY_SKILLS) {
    const skillFile = path.join(adapterSkillsDir, skillName, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile),
      `Entry skill "${skillName}" not found in codex adapter`);
  }
});

test('all entry skills are discoverable in claude adapter', () => {
  const adapterSkillsDir = path.join(ROOT, 'adapters', 'claude', 'skills');
  for (const skillName of ENTRY_SKILLS) {
    const skillFile = path.join(adapterSkillsDir, skillName, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile),
      `Entry skill "${skillName}" not found in claude adapter`);
  }
});
