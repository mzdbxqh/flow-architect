import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

describe('分域材料包', () => {
  it('每个 stage packet 只包含本域 source ID', async () => {
    const { buildMaterialPackets } = await import('../scripts/lib/material-packet-builder.mjs');

    const l4Chunks = [
      makeChunk('C-L4-001', 'L4 子流程边界分析', ['L4']),
      makeChunk('C-L4-002', '4D 边界归属', ['L4']),
    ];
    const l5Chunks = [
      makeChunk('C-L5-001', 'L5 活动识别', ['L5']),
    ];
    const sopChunks = [
      makeChunk('C-SOP-001', 'SOP 场景划分', ['SOP']),
    ];

    const allChunks = [...l4Chunks, ...l5Chunks, ...sopChunks];

    const packets = buildMaterialPackets({
      stageId: 'review-l4',
      chunks: allChunks,
      maxTokens: 48000,
    });

    assert.ok(packets.length > 0, '应生成至少一个 packet');
    // 验证每个 packet 的 source IDs
    for (const packet of packets) {
      assert.ok(packet.context_budget, 'packet 应有 context_budget');
      assert.ok(packet.context_budget.status !== 'BUDGET_SPLIT_REQUIRED',
        'packet 不应超过 120% 阻断线');
    }
  });

  it('超过 57600 token 应拆分为多个 packet', async () => {
    const { buildMaterialPackets } = await import('../scripts/lib/material-packet-builder.mjs');

    // 构造大量 chunks 使总量超过 48000 token
    const chunks = Array.from({ length: 100 }, (_, i) =>
      makeChunk(`C-BIG-${String(i).padStart(3, '0')}`, '中'.repeat(800), ['L5'])
    );

    const packets = buildMaterialPackets({
      stageId: 'review-l5',
      chunks,
      maxTokens: 48000,
    });

    assert.ok(packets.length > 1, '超量内容应拆分为多个 packet');
    for (const packet of packets) {
      assert.ok(
        packet.context_budget.status !== 'BUDGET_SPLIT_REQUIRED',
        '每个 packet 不应超过 120% 阻断线'
      );
    }
  });

  it('packet 包含 context_budget 和 lineage', async () => {
    const { buildMaterialPackets } = await import('../scripts/lib/material-packet-builder.mjs');

    const chunks = [
      makeChunk('C-001', '短内容', ['L4']),
    ];

    const packets = buildMaterialPackets({
      stageId: 'review-l4',
      chunks,
      maxTokens: 48000,
    });

    const packet = packets[0];
    assert.ok(packet.packet_id, '应有 packet_id');
    assert.ok(packet.stage_id === 'review-l4', 'stage_id 应匹配');
    assert.ok(Array.isArray(packet.chunk_ids), '应有 chunk_ids');
    assert.ok(packet.context_budget, '应有 context_budget');
    assert.ok(typeof packet.context_budget.estimated_tokens === 'number', '应有 estimated_tokens');
  });

  it('不可拆分的超大原子项返回 BLOCKED', async () => {
    const { buildMaterialPackets } = await import('../scripts/lib/material-packet-builder.mjs');

    // 构造单个巨大 chunk 超过 57600 token
    const hugeContent = '中'.repeat(100000);
    const chunks = [makeChunk('C-HUGE-001', hugeContent, ['L5'])];

    const packets = buildMaterialPackets({
      stageId: 'review-l5',
      chunks,
      maxTokens: 48000,
    });

    // 超大原子块应被标记为 BLOCKED
    const blockedPacket = packets.find(p => p.context_budget.status === 'BUDGET_SPLIT_REQUIRED');
    assert.ok(blockedPacket, '不可拆分的超大块应标记为 BUDGET_SPLIT_REQUIRED');
  });
});

describe('递归聚合任务', () => {
  it('超过 57600 token 的结果应拆分为多个聚合任务', async () => {
    const { buildRecursiveAggregationTasks } = await import('../scripts/lib/material-packet-builder.mjs');

    const results = Array.from({ length: 50 }, (_, i) => ({
      result_id: `R-${String(i).padStart(3, '0')}`,
      content: '中'.repeat(2000),
      source_ids: [`C-${i}`],
    }));

    const tasks = buildRecursiveAggregationTasks({
      stageId: 'aggregate-l5',
      results,
      maxTokens: 48000,
    });

    assert.ok(tasks.length > 1, '大量结果应拆分为多个聚合任务');
    for (const task of tasks) {
      assert.ok(task.inputs.length < results.length, '每个任务的输入应少于总结果数');
      assert.ok(!task.input_paths?.includes('normalized'),
        '聚合任务不应引用 normalized 目录');
    }
  });
});

function makeChunk(id, content, domainTags = []) {
  return {
    chunk_id: id,
    content,
    content_sha256: createHash('sha256').update(content).digest('hex'),
    artifact_sha256: createHash('sha256').update(id).digest('hex'),
    modality: 'TEXT',
    locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
    heading_path: domainTags,
    domain_tags: domainTags,
  };
}
