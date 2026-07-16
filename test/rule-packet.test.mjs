import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

describe('最小规则包', () => {
  it('应仅包含请求的规则 ID', async () => {
    const { buildRulePacket } = await import('../scripts/lib/rule-packet-builder.mjs');
    const catalog = JSON.parse(readFileSync(join(pkgRoot, 'references/rule-catalog.json'), 'utf8'));
    const ruleDocs = loadRuleDocuments();

    const packet = buildRulePacket({
      catalog,
      ruleDocuments: ruleDocs,
      ruleIds: ['FA-L4-001', 'FA-L4-002'],
    });

    // 只包含请求的规则
    assert.ok(packet.markdown.includes('FA-L4-001'), '应包含 FA-L4-001');
    assert.ok(packet.markdown.includes('FA-L4-002'), '应包含 FA-L4-002');
    assert.ok(!packet.markdown.includes('FA-BPMN-'), '不应包含 BPMN 规则');
    assert.deepEqual(packet.ruleIds, ['FA-L4-001', 'FA-L4-002']);
  });

  it('规则包预算应小于完整目录预算', async () => {
    const { buildRulePacket } = await import('../scripts/lib/rule-packet-builder.mjs');
    const catalog = JSON.parse(readFileSync(join(pkgRoot, 'references/rule-catalog.json'), 'utf8'));
    const ruleDocs = loadRuleDocuments();

    const fullPacket = buildRulePacket({
      catalog,
      ruleDocuments: ruleDocs,
      ruleIds: catalog.rules.map(r => r.rule_id),
    });
    const partialPacket = buildRulePacket({
      catalog,
      ruleDocuments: ruleDocs,
      ruleIds: ['FA-L4-001'],
    });

    assert.ok(
      partialPacket.budget.estimated_tokens < fullPacket.budget.estimated_tokens,
      '部分规则包应比完整包小'
    );
  });

  it('规则 ID 不存在时应报错', async () => {
    const { buildRulePacket } = await import('../scripts/lib/rule-packet-builder.mjs');
    const catalog = JSON.parse(readFileSync(join(pkgRoot, 'references/rule-catalog.json'), 'utf8'));
    const ruleDocs = loadRuleDocuments();

    assert.throws(
      () => buildRulePacket({
        catalog,
        ruleDocuments: ruleDocs,
        ruleIds: ['FA-NONEXISTENT-999'],
      }),
      /不存在|not found/i
    );
  });

  it('规则包包含预算报告', async () => {
    const { buildRulePacket } = await import('../scripts/lib/rule-packet-builder.mjs');
    const catalog = JSON.parse(readFileSync(join(pkgRoot, 'references/rule-catalog.json'), 'utf8'));
    const ruleDocs = loadRuleDocuments();

    const packet = buildRulePacket({
      catalog,
      ruleDocuments: ruleDocs,
      ruleIds: ['FA-L4-001'],
    });

    assert.ok(packet.budget, '应包含 budget');
    assert.ok(typeof packet.budget.estimated_tokens === 'number', 'budget 应有 estimated_tokens');
    assert.ok(packet.budget.status, 'budget 应有 status');
  });
});

function loadRuleDocuments() {
  const rulesDir = join(pkgRoot, 'references/rules');
  const files = [
    'l4-review.md', 'l5-review.md', 'l6-review.md', 'sop-review.md',
    'bpmn-review.md', 'hierarchy-review.md', 'consistency-review.md', 'visual-review.md',
  ];
  const docs = {};
  for (const f of files) {
    try {
      docs[f] = readFileSync(join(rulesDir, f), 'utf8');
    } catch { /* skip */ }
  }
  return docs;
}
