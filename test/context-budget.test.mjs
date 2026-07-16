import assert from 'node:assert/strict';
import test from 'node:test';

// RED: these imports will fail until the module is created
let estimateTokens, assessBudget, buildContextBudget, BUDGET_STATUS;
try {
  const mod = await import('../scripts/lib/context-budget.mjs');
  estimateTokens = mod.estimateTokens;
  assessBudget = mod.assessBudget;
  buildContextBudget = mod.buildContextBudget;
  BUDGET_STATUS = mod.BUDGET_STATUS;
} catch {
  // Module does not exist yet — tests will fail with import error
  test('context-budget module exists', () => {
    assert.fail('scripts/lib/context-budget.mjs does not exist yet');
  });
}

// --- Token estimation formula ---

test('中文按 1.5 汉字一个 token 估算', () => {
  // '采购审批流程' = 6 han chars → ceil(6/1.5) = 4
  assert.equal(estimateTokens('采购审批流程').estimated_tokens, 4);
});

test('ASCII 按四字符一个 token 估算', () => {
  // 'abcdefghijkl' = 12 ascii chars → ceil(12/4) = 3
  assert.equal(estimateTokens('abcdefghijkl').estimated_tokens, 3);
});

test('混合内容正确分类三种字符', () => {
  // '流程abc' = 2 han + 3 ascii + 0 other
  const result = estimateTokens('流程abc');
  assert.equal(result.han_chars, 2);
  assert.equal(result.ascii_chars, 3);
  assert.equal(result.other_chars, 0);
  assert.equal(result.estimated_tokens, Math.ceil(2 / 1.5 + 3 / 4 + 0));
});

test('非 ASCII 非汉字字符逐个计费', () => {
  // '∑∫∂' = 0 han + 0 ascii + 3 other → 3 tokens
  assert.equal(estimateTokens('∑∫∂').estimated_tokens, 3);
  assert.equal(estimateTokens('∑∫∂').other_chars, 3);
});

test('空字符串返回零', () => {
  const result = estimateTokens('');
  assert.equal(result.han_chars, 0);
  assert.equal(result.ascii_chars, 0);
  assert.equal(result.other_chars, 0);
  assert.equal(result.estimated_tokens, 0);
});

// --- Budget assessment ---

test('基准至 120% 为重点关注，超过 120% 必须拆分', () => {
  assert.equal(assessBudget({ used: 100, limit: 100 }).status, 'BUDGET_ATTENTION');
  assert.equal(assessBudget({ used: 120, limit: 100 }).status, 'BUDGET_ATTENTION');
  assert.equal(assessBudget({ used: 121, limit: 100 }).status, 'BUDGET_SPLIT_REQUIRED');
  assert.equal(assessBudget({ used: 121, limit: 100 }).split_required, true);
});

test('未达到基准为 OK', () => {
  assert.equal(assessBudget({ used: 99, limit: 100 }).status, 'BUDGET_OK');
  assert.equal(assessBudget({ used: 0, limit: 100 }).status, 'BUDGET_OK');
});

test('assessBudget 包含 ratio 字段', () => {
  const result = assessBudget({ used: 110, limit: 100 });
  assert.equal(result.ratio, 1.1);
});

test('assessBudget 包含 BUDGET_STATUS 常量', () => {
  assert.equal(BUDGET_STATUS.OK, 'BUDGET_OK');
  assert.equal(BUDGET_STATUS.ATTENTION, 'BUDGET_ATTENTION');
  assert.equal(BUDGET_STATUS.SPLIT_REQUIRED, 'BUDGET_SPLIT_REQUIRED');
});

// --- buildContextBudget ---

test('元数据和固定上下文都计入总预算', () => {
  const report = buildContextBudget({
    fixedTexts: ['固定规则'],
    contentTexts: ['业务正文'],
    metadataTexts: ['来源定位'],
    limit: 100,
    sourceIds: ['chunk-001'],
  });
  assert.equal(report.total.estimated_tokens,
    report.fixed.estimated_tokens + report.content.estimated_tokens + report.metadata.estimated_tokens);
});

test('buildContextBudget 包含 formula_version', () => {
  const report = buildContextBudget({
    fixedTexts: [],
    contentTexts: [],
    metadataTexts: [],
    limit: 100,
    sourceIds: [],
  });
  assert.ok(report.formula_version);
});

test('buildContextBudget 的 status 来自总 token 与 limit 比较', () => {
  // 固定 + 内容 + 元数据 = 90, limit=100, ratio=0.9 → OK
  const report = buildContextBudget({
    fixedTexts: ['x'.repeat(100)], // ~25 tokens
    contentTexts: ['y'.repeat(200)], // ~50 tokens
    metadataTexts: ['z'.repeat(60)], // ~15 tokens
    limit: 100,
    sourceIds: ['c-1'],
  });
  // total ~90, within limit → OK
  assert.equal(report.status, 'BUDGET_OK');
});

test('buildContextBudget 超过 120% 时 split_required=true', () => {
  const report = buildContextBudget({
    fixedTexts: [],
    contentTexts: ['中'.repeat(200)], // 200/1.5 ≈ 134 tokens
    metadataTexts: [],
    limit: 100,
    sourceIds: ['c-1'],
  });
  assert.equal(report.split_required, true);
});

test('buildContextBudget 包含 source_ids', () => {
  const report = buildContextBudget({
    fixedTexts: [],
    contentTexts: [],
    metadataTexts: [],
    limit: 50,
    sourceIds: ['chunk-a', 'chunk-b'],
  });
  assert.deepEqual(report.source_ids, ['chunk-a', 'chunk-b']);
});
