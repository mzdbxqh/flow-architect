import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('评审上下文编排', () => {
  it('Stage Task 包含必要字段', async () => {
    const { buildStageTask } = await import('../scripts/lib/material-packet-builder.mjs');

    const task = buildStageTask({
      stageId: 'review-l4',
      packetId: 'MP-001',
      rulePacket: { markdown: '# L4 Rules', ruleIds: ['FA-L4-001'], budget: { estimated_tokens: 100, status: 'BUDGET_OK' } },
      outputDir: '/tmp/output',
    });

    assert.ok(task.input_packet, '应有 input_packet');
    assert.ok(task.rule_packet, '应有 rule_packet');
    assert.ok(task.context_budget, '应有 context_budget');
    assert.ok(task.output_dir, '应有 output_dir');
    assert.equal(task.fresh_session, true, 'fresh_session 应为 true');
  });

  it('Stage Task 的 allowed_read_paths 不包含原始目录通配符', async () => {
    const { buildStageTask } = await import('../scripts/lib/material-packet-builder.mjs');

    const task = buildStageTask({
      stageId: 'review-l5',
      packetId: 'MP-002',
      rulePacket: { markdown: '# L5 Rules', ruleIds: ['FA-L5-001'], budget: { estimated_tokens: 100, status: 'BUDGET_OK' } },
      outputDir: '/tmp/output',
    });

    const paths = task.allowed_read_paths || [];
    for (const p of paths) {
      assert.ok(!p.includes('*'), `路径不应包含通配符: ${p}`);
      assert.ok(!p.endsWith('/normalized'), `不应引用 normalized 根目录: ${p}`);
    }
  });

  it('递归聚合任务的 allowed_read_paths 不包含 normalized', async () => {
    const { buildRecursiveAggregationTasks } = await import('../scripts/lib/material-packet-builder.mjs');

    const results = Array.from({ length: 5 }, (_, i) => ({
      result_id: `R-${i}`,
      content: '内容',
      source_ids: [`C-${i}`],
    }));

    const tasks = buildRecursiveAggregationTasks({
      stageId: 'aggregate-l4',
      results,
      maxTokens: 48000,
    });

    for (const task of tasks) {
      const paths = task.allowed_read_paths || [];
      assert.ok(
        !paths.some(p => p.includes('normalized')),
        '聚合任务不应引用 normalized 目录'
      );
    }
  });
});
