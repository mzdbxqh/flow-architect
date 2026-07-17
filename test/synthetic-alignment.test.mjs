/**
 * 通用语义对齐层合成测试
 *
 * 验证通用映射机制，不依赖采购样本常量。
 * 使用完全不同名称/键的合成测试数据。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/model-independent');

async function loadSyntheticData() {
  const data = JSON.parse(await readFile(join(fixturesDir, 'synthetic-mapping-test.json'), 'utf8'));
  return [
    data.synthetic_process_card.output,
    data.synthetic_activity_catalog.output,
    data.synthetic_control_flow.output,
  ];
}

// ══════════════════════════════════════════════════════════════
// 通用映射机制测试
// ══════════════════════════════════════════════════════════════

describe('通用映射机制', () => {
  it('PROCESS_CARD 的 attributes.activity 与 ACTIVITY label 匹配建立映射', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    // 获取对齐后的活动 subject_keys
    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const activityKeys = new Set(
      activityFragment.payload.facts
        .filter(f => f.kind === 'ACTIVITY')
        .map(f => f.subject_key)
    );

    // 获取对齐后的 FLOW source/target
    const flowFragment = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
    const flows = flowFragment.payload.facts.filter(f => f.kind === 'FLOW');
    const gatewayKeys = new Set(
      flowFragment.payload.facts
        .filter(f => f.kind.startsWith('GATEWAY'))
        .map(f => f.subject_key)
    );
    const startKeys = new Set(
      flowFragment.payload.facts
        .filter(f => f.kind === 'START_EVENT')
        .map(f => f.subject_key)
    );
    const endKeys = new Set(
      flowFragment.payload.facts
        .filter(f => f.kind === 'END_EVENT')
        .map(f => f.subject_key)
    );

    // 验证 FLOW source/target 解析到已知节点
    for (const flow of flows) {
      const src = flow.attributes.source_subject_key;
      const tgt = flow.attributes.target_subject_key;
      const knownKeys = new Set([...activityKeys, ...gatewayKeys, ...startKeys, ...endKeys]);
      assert.ok(knownKeys.has(src),
        `FLOW ${flow.subject_key} source "${src}" 应解析到已知节点，已知: ${[...knownKeys].join(',')}`);
      assert.ok(knownKeys.has(tgt),
        `FLOW ${flow.subject_key} target "${tgt}" 应解析到已知节点`);
    }

    // 验证 business-step-x 映射到 model-step-z
    const flow1 = flows.find(f => f.subject_key === 'flow-1');
    assert.ok(flow1, 'flow-1 应存在');
    assert.equal(flow1.attributes.target_subject_key, 'model-step-z',
      'business-step-x 应映射到 model-step-z');

    // 验证 business-step-y 映射到 model-step-w
    const flow2 = flows.find(f => f.subject_key === 'flow-2');
    assert.ok(flow2, 'flow-2 应存在');
    assert.equal(flow2.attributes.source_subject_key, 'model-step-z',
      'business-step-x 应映射到 model-step-z');
    assert.equal(flow2.attributes.target_subject_key, 'model-step-w',
      'business-step-y 应映射到 model-step-w');
  });

  it('ACTIVITY subject_key 保持为结构化键（如 model-step-z），不被业务键替换', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const actKeys = activityFragment.payload.facts
      .filter(f => f.kind === 'ACTIVITY')
      .map(f => f.subject_key)
      .sort();

    // ACTIVITY 的 subject_key 应保留原始值
    // 注意：model-outcome-cancel 可能按规则 6 移除并入 END_EVENT
    assert.deepEqual(actKeys, ['model-step-w', 'model-step-z']);
  });

  it('确定性规范化：空格和大小写不影响匹配', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();

    // 修改 attributes.activity 添加空格和大小写变化
    const modifiedFragments = JSON.parse(JSON.stringify(fragments));
    const processCard = modifiedFragments.find(f => f.task_kind === 'PROCESS_CARD');
    const inputFact = processCard.payload.facts.find(f => f.kind === 'INPUT' && f.subject_key === 'business-step-x');

    // 修改为 "处理 甲"（添加空格）
    inputFact.attributes.activity = '处理 甲';

    const aligned = alignFragments(modifiedFragments);

    // 验证仍然能正确映射
    const flowFragment = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
    const flow1 = flowFragment.payload.facts.find(f => f.kind === 'FLOW' && f.subject_key === 'flow-1');
    assert.equal(flow1.attributes.target_subject_key, 'model-step-z',
      '带空格的 attributes.activity 应仍能映射到 model-step-z');
  });
});

// ══════════════════════════════════════════════════════════════
// 通用结果别名规则测试
// ══════════════════════════════════════════════════════════════

describe('通用结果别名规则', () => {
  it('ACTIVITY 与 END_EVENT 同名且无业务承载时，evidence_refs 合入 END_EVENT 并移除活动', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const controlFlowFragment = aligned.find(f => f.task_kind === 'CONTROL_FLOW');

    // 检查 model-outcome-cancel 是否被移除
    const cancelAct = activityFragment.payload.facts.find(f =>
      f.subject_key === 'model-outcome-cancel' && f.kind === 'ACTIVITY');

    // 应该被移除，因为：
    // 1. label "取消处理" 与 END_EVENT label 相同
    // 2. inputs/outputs 为空
    // 3. sla=null
    // 4. 没有 completion_criteria
    assert.equal(cancelAct, undefined,
      'model-outcome-cancel 应从 ACTIVITY 中移除');

    // 检查 END_EVENT 是否包含 model-outcome-cancel 的 evidence_refs
    const cancelEndEvent = controlFlowFragment.payload.facts.find(f =>
      f.kind === 'END_EVENT' && f.label === '取消处理');

    assert.ok(cancelEndEvent, '应存在 label="取消处理" 的 END_EVENT');
    assert.ok(cancelEndEvent.evidence_refs.includes('SB-005'),
      'END_EVENT 应包含 model-outcome-cancel 的 evidence_ref "SB-005"');
  });

  it('ACTIVITY 有业务承载时保留，不合并到 END_EVENT', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');

    // 检查 model-step-z 是否保留（有 inputs 和 outputs）
    const stepZ = activityFragment.payload.facts.find(f =>
      f.subject_key === 'model-step-z' && f.kind === 'ACTIVITY');

    assert.ok(stepZ, 'model-step-z 应保留（有 inputs 和 outputs）');
    assert.deepEqual(stepZ.attributes.inputs, ['输入数据X']);
    assert.deepEqual(stepZ.attributes.outputs, ['输出结果X']);

    // 检查 model-step-w 是否保留（有 inputs 和 outputs）
    const stepW = activityFragment.payload.facts.find(f =>
      f.subject_key === 'model-step-w' && f.kind === 'ACTIVITY');

    assert.ok(stepW, 'model-step-w 应保留（有 inputs 和 outputs）');
    assert.deepEqual(stepW.attributes.inputs, ['输入数据Y']);
    assert.deepEqual(stepW.attributes.outputs, ['输出结果Y']);
  });

  it('evidence_refs 合并不丢失', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    // 查找所有 evidence_refs
    const allRefs = new Set();
    for (const frag of aligned) {
      for (const fact of frag.payload.facts) {
        for (const ref of fact.evidence_refs || []) {
          allRefs.add(ref);
        }
      }
    }

    // 原始 model-outcome-cancel 的 evidence_refs 应保留在某处
    const originalFragments = await loadSyntheticData();
    const originalCancelAct = originalFragments[1].payload.facts.find(f =>
      f.subject_key === 'model-outcome-cancel');

    for (const ref of originalCancelAct.evidence_refs) {
      assert.ok(allRefs.has(ref),
        `evidence_ref "${ref}" 不应丢失`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// process_key 统一测试
// ══════════════════════════════════════════════════════════════

describe('process_key 统一', () => {
  it('三个片段对齐后 process_key 统一到 PROCESS_CARD 的值', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    // 原始 process_key 分别为 synthetic-process, synthetic-activity-process, synthetic-control-flow-process
    // 对齐后所有事实的 process_key 应一致
    const allFacts = aligned.flatMap(f => f.payload.facts);
    const keys = new Set(allFacts.map(f => f.process_key));
    assert.equal(keys.size, 1, `应统一到一个 process_key，实际: ${[...keys].join(',')}`);
    // 应使用 PROCESS_CARD 的 process_key
    assert.equal([...keys][0], 'synthetic-process');
  });

  it('process_key 统一不得跨 batch 合并', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    // batch_id 不变
    for (const frag of aligned) {
      assert.equal(frag.batch_id, 'synthetic-batch-001');
    }
  });

  it('相同输入运行两次结果字节一致', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const r1 = alignFragments(fragments);
    const r2 = alignFragments(fragments);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), '两次对齐应字节一致');
  });
});

// ══════════════════════════════════════════════════════════════
// END_EVENT 规范化测试
// ══════════════════════════════════════════════════════════════

describe('END_EVENT 规范化', () => {
  it('PROCESS_CARD 与 CONTROL_FLOW 的 END_EVENT 规范化后 label 与 subject_key 完全一致', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    const processCard = aligned.find(f => f.task_kind === 'PROCESS_CARD');
    const controlFlow = aligned.find(f => f.task_kind === 'CONTROL_FLOW');

    const pcEndEvents = processCard.payload.facts.filter(f => f.kind === 'END_EVENT');
    const cfEndEvents = controlFlow.payload.facts.filter(f => f.kind === 'END_EVENT');

    // 以 CONTROL_FLOW 为 canonical，PROCESS_CARD 必须一一匹配
    assert.equal(pcEndEvents.length, cfEndEvents.length,
      `END_EVENT 数量应一致：PC=${pcEndEvents.length}, CF=${cfEndEvents.length}`);

    for (const cfEv of cfEndEvents) {
      const match = pcEndEvents.find(pc => pc.label === cfEv.label);
      assert.ok(match,
        `PROCESS_CARD 应有 label="${cfEv.label}" 的 END_EVENT`);
      assert.equal(match.subject_key, cfEv.subject_key,
        `label="${cfEv.label}" 的 subject_key 应一致：PC="${match.subject_key}" vs CF="${cfEv.subject_key}"`);
    }
  });

  it('END_EVENT evidence_refs 合并来自两份片段', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadSyntheticData();
    const aligned = alignFragments(fragments);

    // PROCESS_CARD 的 END_EVENT evidence_refs 来自 B-004, B-005
    // CONTROL_FLOW 的 END_EVENT evidence_refs 来自各自块
    // 对齐后同一语义的 END_EVENT 应合并 evidence_refs
    const processCard = aligned.find(f => f.task_kind === 'PROCESS_CARD');
    const endEvents = processCard.payload.facts.filter(f => f.kind === 'END_EVENT');

    for (const ev of endEvents) {
      assert.ok(ev.evidence_refs.length >= 1,
        `END_EVENT "${ev.label}" 应有 evidence_refs`);
    }
  });
});
