import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

/**
 * Read a file relative to the codex adapter root.
 * @param {string} relative - Path relative to adapters/codex/
 * @returns {Buffer}
 */
function readCodex(relative) {
  return fs.readFileSync(path.join(ROOT, 'adapters', 'codex', relative));
}

/**
 * Read a file relative to the claude adapter root.
 * @param {string} relative - Path relative to adapters/claude/
 * @returns {Buffer}
 */
function readClaude(relative) {
  return fs.readFileSync(path.join(ROOT, 'adapters', 'claude', relative));
}

/**
 * Collect shared runtime files that should be identical across adapters.
 * Shared directories: skills/, references/, scripts/
 * @returns {string[]} Array of relative paths within each adapter
 */
function sharedRuntimeFiles() {
  const sharedDirs = ['skills', 'references', 'scripts'];
  const files = [];
  for (const dir of sharedDirs) {
    const dirPath = path.join(ROOT, dir);
    if (!fs.existsSync(dirPath)) continue;
    collectRelative(dirPath, dir, files);
  }
  return files.sort();
}

/**
 * Recursively collect file paths relative to a prefix.
 */
function collectRelative(dir, prefix, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue;
    const full = path.join(dir, entry.name);
    const rel = prefix + '/' + entry.name;
    if (entry.isDirectory()) {
      collectRelative(full, rel, result);
    } else {
      result.push(rel);
    }
  }
}

// --- Test: Shared adapter files are byte-identical ---

test('sharedRuntimeFiles() returns non-empty list', () => {
  const files = sharedRuntimeFiles();
  assert.ok(files.length > 0, 'Should find shared runtime files');
  assert.ok(files.length >= 40, `Expected at least 40 shared files, got ${files.length}`);
});

for (const rel of sharedRuntimeFiles()) {
  test(`byte-identical: ${rel}`, () => {
    const codexContent = readCodex(rel);
    const claudeContent = readClaude(rel);
    assert.ok(
      codexContent.equals(claudeContent),
      `Content mismatch between codex and claude for ${rel} (codex=${codexContent.length}b, claude=${claudeContent.length}b)`
    );
  });
}

// --- Test: Skill files are identical across adapters ---

test('all 16 skills exist in both adapters', () => {
  const skillsDir = path.join(ROOT, 'skills');
  const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  for (const skillName of skillDirs) {
    const codexSkillPath = path.join(ROOT, 'adapters', 'codex', 'skills', skillName, 'SKILL.md');
    const claudeSkillPath = path.join(ROOT, 'adapters', 'claude', 'skills', skillName, 'SKILL.md');
    assert.ok(fs.existsSync(codexSkillPath), `Codex adapter missing skill: ${skillName}`);
    assert.ok(fs.existsSync(claudeSkillPath), `Claude adapter missing skill: ${skillName}`);
  }
});

test('all skill SKILL.md files are byte-identical across adapters', () => {
  const skillsDir = path.join(ROOT, 'skills');
  const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  for (const skillName of skillDirs) {
    const codexContent = readCodex(`skills/${skillName}/SKILL.md`);
    const claudeContent = readClaude(`skills/${skillName}/SKILL.md`);
    assert.ok(
      codexContent.equals(claudeContent),
      `Skill ${skillName}/SKILL.md differs between codex and claude`
    );
  }
});

// --- Test: Reference files are identical across adapters ---

test('rule-catalog.json is byte-identical across adapters', () => {
  const codex = readCodex('references/rule-catalog.json');
  const claude = readClaude('references/rule-catalog.json');
  assert.ok(codex.equals(claude), 'rule-catalog.json differs between adapters');
});

test('all schema files are byte-identical across adapters', () => {
  const schemasDir = path.join(ROOT, 'references', 'schemas');
  if (!fs.existsSync(schemasDir)) return;
  const schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.json'));
  for (const schema of schemaFiles) {
    const codex = readCodex(`references/schemas/${schema}`);
    const claude = readClaude(`references/schemas/${schema}`);
    assert.ok(codex.equals(claude), `Schema ${schema} differs between adapters`);
  }
});

// --- Test: Script files are identical across adapters ---

test('all script files are byte-identical across adapters', () => {
  const scriptsDir = path.join(ROOT, 'scripts');
  if (!fs.existsSync(scriptsDir)) return;
  const collectScripts = (dir, prefix) => {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...collectScripts(full, rel));
      } else {
        results.push(rel);
      }
    }
    return results;
  };
  const scriptFiles = collectScripts(scriptsDir, 'scripts');
  for (const rel of scriptFiles) {
    const codex = readCodex(rel);
    const claude = readClaude(rel);
    assert.ok(codex.equals(claude), `Script ${rel} differs between adapters`);
  }
});
