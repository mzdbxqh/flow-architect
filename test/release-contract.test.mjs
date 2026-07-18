import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

const PRODUCT_DESCRIPTION = /review.*draft.*meeting package/i;

test('v0.3.1 is consistent across package and every published manifest', () => {
  assert.equal(json('package.json').version, '0.3.1');

  for (const file of [
    '.codex-plugin/plugin.json',
    'adapters/codex/.codex-plugin/plugin.json',
    'adapters/claude/.claude-plugin/plugin.json',
  ]) {
    assert.equal(json(file).version, '0.3.1', `${file} version must be 0.3.1`);
  }

  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, '0.3.1');
});

test('canonical and generated plugin descriptions cover review, draft and meeting package', () => {
  const descriptions = [
    json('.codex-plugin/plugin.json').description,
    json('.codex-plugin/plugin.json').interface.longDescription,
    json('.claude-plugin/marketplace.json').description,
    json('.claude-plugin/marketplace.json').plugins[0].description,
    json('adapters/codex/.codex-plugin/plugin.json').description,
    json('adapters/codex/.codex-plugin/plugin.json').interface.longDescription,
    json('adapters/claude/.claude-plugin/plugin.json').description,
  ];

  for (const description of descriptions) {
    assert.match(description, PRODUCT_DESCRIPTION, description);
    assert.doesNotMatch(description, /read-only/i, description);
  }
});

test('canonical and generated Codex manifests declare exact Read and Write capabilities', () => {
  for (const file of [
    '.codex-plugin/plugin.json',
    'adapters/codex/.codex-plugin/plugin.json',
  ]) {
    assert.deepEqual(json(file).interface.capabilities, ['Read', 'Write'], file);
  }
});

test('runtime 2.0.0 remains compatible with v0.1.2 caches and v0.3.1 plugin', () => {
  for (const file of [
    'runtime/manifest.json',
    'adapters/codex/runtime/manifest.json',
    'adapters/claude/runtime/manifest.json',
  ]) {
    const manifest = json(file);
    assert.equal(manifest.runtime_version, '2.0.0', file);
    assert.equal(manifest.plugin_compatibility, '>=0.1.2 <0.4.0', file);
  }

  const manager = read('scripts/lib/runtime-manager.mjs');
  assert.doesNotMatch(manager, />=0\.1\.2 <0\.2\.0/);
  assert.match(manager, /plugin_compatibility:\s*'>=0\.1\.2 <0\.4\.0'/);
});

test('process draft meeting package records runtime version rather than plugin version', () => {
  const pipeline = read('scripts/lib/process-draft-pipeline.mjs');
  assert.doesNotMatch(pipeline, /runtime_version:\s*['"]0\.1\.2['"]/);
  assert.match(pipeline, /runtime_version:\s*['"]2\.0\.0['"]/);
});

test('help distinguishes read-only review from creation without contradicting itself', () => {
  for (const file of ['commands/help.md', 'skills/flow-architect-help/SKILL.md']) {
    const content = read(file);
    assert.match(content, /draft-process/);
    assert.match(content, /build-meeting-package/);
    assert.match(content, /独立运行目录创建新制品/);
    assert.match(content, /不修改原始输入/);
    assert.doesNotMatch(content, /不得把任何入口描述成建模、生成、渲染或自动修复/);
  }

  const command = read('commands/help.md');
  assert.match(command, /不得把只读评审入口描述成建模、生成、渲染或自动修复/);
  assert.match(command, /不得把创建入口描述为修改原始输入或自动修复/);
});

test('adapter generator is the version and capability source of truth', () => {
  const generator = read('scripts/build-adapters.mjs');
  assert.match(generator, /const PLUGIN_VERSION = '0\.3\.1'/);
  assert.match(generator, /capabilities:\s*\['Read', 'Write'\]/);
  assert.doesNotMatch(generator, /Read-only process architecture/i);
});
