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
