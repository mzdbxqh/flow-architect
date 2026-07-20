import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdapterOutputs } from '../scripts/build-adapters.mjs';

test('codex omits agents while claude includes them', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));

  // Claude adapter must contain agents
  assert.ok(
    outputs.has('adapters/claude/agents/flow-architect-review-l4-worker.md'),
    'Claude adapter should contain agents/flow-architect-review-l4-worker.md'
  );

  // Codex adapter must NOT contain agents
  assert.ok(
    !outputs.has('adapters/codex/agents/flow-architect-review-l4-worker.md'),
    'Codex adapter should NOT contain agents/flow-architect-review-l4-worker.md'
  );

  // Both adapters must have platform-specific plugin manifests
  assert.ok(
    outputs.has('adapters/codex/.codex-plugin/plugin.json'),
    'Codex adapter should have .codex-plugin/plugin.json'
  );
  assert.ok(
    outputs.has('adapters/claude/.claude-plugin/plugin.json'),
    'Claude adapter should have .claude-plugin/plugin.json'
  );
});

test('both adapters share the same skills', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));

  const codexSkills = [...outputs.keys()].filter(k => k.startsWith('adapters/codex/skills/'));
  const claudeSkills = [...outputs.keys()].filter(k => k.startsWith('adapters/claude/skills/'));

  // Normalize by removing adapter prefix
  const codexNormalized = codexSkills.map(k => k.replace('adapters/codex/', '')).sort();
  const claudeNormalized = claudeSkills.map(k => k.replace('adapters/claude/', '')).sort();

  assert.deepEqual(codexNormalized, claudeNormalized, 'Both adapters should have identical skill files');
});

test('shared files have identical content across adapters', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));

  const sharedPrefixes = ['skills/', 'references/', 'scripts/'];
  for (const [relPath, { content }] of outputs) {
    for (const prefix of sharedPrefixes) {
      const fullPrefix = `adapters/codex/${prefix}`;
      if (!relPath.startsWith(fullPrefix)) continue;

      const claudePath = relPath.replace('adapters/codex/', 'adapters/claude/');
      const claudeEntry = outputs.get(claudePath);
      assert.ok(claudeEntry, `Claude adapter should also have ${claudePath}`);
      assert.ok(
        content.equals(claudeEntry.content),
        `Content should be identical for ${relPath} and ${claudePath}`
      );
    }
  }
});

test('repository root has Claude marketplace.json', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));
  assert.ok(
    outputs.has('.claude-plugin/marketplace.json'),
    'Repository root should have .claude-plugin/marketplace.json'
  );
});

test('meeting package runtime is copied to both adapters', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));
  for (const adapter of ['codex', 'claude']) {
    assert.ok(outputs.has(`adapters/${adapter}/runtime/meeting-package/editor.bundle.js`));
    assert.ok(outputs.has(`adapters/${adapter}/skills/flow-architect-build-meeting-package/SKILL.md`));
  }
});

test('three fixed entries are projected to both hosts by the generator', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));

  // Codex discovers all three entries through skills
  for (const skill of ['flow-architect-help', 'flow-architect-setup', 'flow-architect-quickstart']) {
    assert.ok(outputs.has(`adapters/codex/skills/${skill}/SKILL.md`), `codex adapter missing ${skill}`);
    assert.ok(outputs.has(`adapters/claude/skills/${skill}/SKILL.md`), `claude adapter missing ${skill}`);
  }

  // Claude commands carry the three entries in both the adapter and root manifests
  assert.ok(outputs.has('adapters/claude/commands/help.md'));
  assert.ok(outputs.has('adapters/claude/commands/setup.md'));
  assert.ok(outputs.has('adapters/claude/commands/quickstart.md'));

  for (const manifestKey of ['adapters/claude/.claude-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    const manifest = JSON.parse(outputs.get(manifestKey).content.toString('utf8'));
    assert.deepEqual(
      manifest.commands,
      ['./commands/help.md', './commands/setup.md', './commands/quickstart.md'],
      `${manifestKey} must declare exactly the three fixed commands`
    );
    assert.equal(manifest.version, '0.4.1', `${manifestKey} must use version 0.4.1`);
  }
});

test('shared catalog, quickstart route script and schema are projected to both adapters', () => {
  const outputs = buildAdapterOutputs(new URL('..', import.meta.url));
  for (const adapter of ['codex', 'claude']) {
    assert.ok(outputs.has(`adapters/${adapter}/references/capability-catalog.json`), `${adapter} missing capability catalog`);
    assert.ok(outputs.has(`adapters/${adapter}/references/schemas/quickstart-route.schema.json`), `${adapter} missing quickstart route schema`);
    assert.ok(outputs.has(`adapters/${adapter}/scripts/quickstart-route.mjs`), `${adapter} missing quickstart route script`);
    assert.ok(outputs.has(`adapters/${adapter}/skills/flow-architect-quickstart/SKILL.md`), `${adapter} missing quickstart skill`);
  }

  // The shared files are byte-identical across adapters
  for (const rel of [
    'references/capability-catalog.json',
    'references/schemas/quickstart-route.schema.json',
    'scripts/quickstart-route.mjs',
    'skills/flow-architect-quickstart/SKILL.md',
  ]) {
    const codex = outputs.get(`adapters/codex/${rel}`);
    const claude = outputs.get(`adapters/claude/${rel}`);
    assert.ok(codex.content.equals(claude.content), `${rel} must be byte-identical across adapters`);
  }
});
