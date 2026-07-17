/**
 * 语义对齐层单元测试（TDD：先写失败测试）
 *
 * 覆盖 goal 文档 §1 的 8 个规则，均使用真实 captured 数据结构。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/model-independent');

async function loadJson(relPath) {
  return JSON.parse(await readFile(join(fixturesDir, relPath), 'utf8'));
}

async function loadCapturedOutputs() {
  const pc = await loadJson('captured/mimo-v2.5-pro-process-card.json');
  const ac = await loadJson('captured/mimo-v2.5-pro-activity.json');
  const cf = await loadJson('captured/mimo-v2.5-pro-control-flow.json');
  return [pc.output, ac.output, cf.output];
}

// ══════════════════════════════════════════════════════════════
// 规则 1：三个同 batch 的单流程片段确定性统一到 PROCESS_CARD 的流程主键
// ══════════════════════════════════════════════════════════════

describe('规则 1: process_key 统一', () => {
  it('三个片段对齐后 process_key 统一到 PROCESS_CARD 的值', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    // 原始 process_key 分别为 procurement-request, P-procurement, procurement-request-process
    // 对齐后所有事实的 process_key 应一致
    const allFacts = aligned.flatMap(f => f.payload.facts);
    const keys = new Set(allFacts.map(f => f.process_key));
    assert.equal(keys.size, 1, `应统一到一个 process_key，实际: ${[...keys].join(',')}`);
    // 应使用 PROCESS_CARD 的 process_key
    assert.equal([...keys][0], 'procurement-request');
  });

  it('process_key 统一不得跨 batch 合并', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    // batch_id 不变
    for (const frag of aligned) {
      assert.equal(frag.batch_id, 'EB-procurement-demo');
    }
  });

  it('相同输入运行两次结果字节一致', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const r1 = alignFragments(fragments);
    const r2 = alignFragments(fragments);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2), '两次对齐应字节一致');
  });

  it('混入不同 batch_id/batch_sha256 的片段必须抛错', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();

    // 构造混合 batch：修改其中一个片段的 batch_id
    const mixedFragments = [
      fragments[0],
      { ...fragments[1], batch_id: 'DIFFERENT-BATCH-ID' },
      fragments[2],
    ];

    assert.throws(
      () => alignFragments(mixedFragments),
      (err) => {
        assert.ok(err instanceof Error, '应抛出 Error');
        assert.ok(err.message.includes('batch'),
          `错误信息应提及 batch，实际: ${err.message}`);
        return true;
      },
      '混入不同 batch_id 的片段必须抛错'
    );
  });

  it('混入不同 batch_sha256 的片段必须抛错', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();

    // 构造混合 batch：修改其中一个片段的 batch_sha256
    const mixedFragments = [
      fragments[0],
      { ...fragments[1], batch_sha256: '0000000000000000000000000000000000000000000000000000000000000000' },
      fragments[2],
    ];

    assert.throws(
      () => alignFragments(mixedFragments),
      (err) => {
        assert.ok(err instanceof Error, '应抛出 Error');
        assert.ok(err.message.includes('batch'),
          `错误信息应提及 batch，实际: ${err.message}`);
        return true;
      },
      '混入不同 batch_sha256 的片段必须抛错'
    );
  });
});

// ══════════════════════════════════════════════════════════════
// 规则 2：活动按业务语义对齐 — subject_key 统一
// ══════════════════════════════════════════════════════════════

describe('规则 2: 活动 subject_key 对齐', () => {
  it('CONTROL_FLOW 的 FLOW source/target 解析到 ACTIVITY 的 subject_key', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
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

    for (const flow of flows) {
      const src = flow.attributes.source_subject_key;
      const tgt = flow.attributes.target_subject_key;
      // 每个 source/target 应解析到已知的活动/网关/事件
      const knownKeys = new Set([...activityKeys, ...gatewayKeys, ...startKeys, ...endKeys]);
      assert.ok(knownKeys.has(src),
        `FLOW ${flow.subject_key} source "${src}" 应解析到已知节点，已知: ${[...knownKeys].join(',')}`);
      assert.ok(knownKeys.has(tgt),
        `FLOW ${flow.subject_key} target "${tgt}" 应解析到已知节点`);
    }
  });

  it('ACTIVITY subject_key 保持为结构化键（如 A-submit），不被 CONTROL_FLOW 的键替换', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const actKeys = activityFragment.payload.facts
      .filter(f => f.kind === 'ACTIVITY')
      .map(f => f.subject_key);

    // ACTIVITY 的 subject_key 应保留原始值
    // 注意：A-reject-return 已按规则 6 移除并入 END_EVENT
    assert.deepEqual(actKeys.sort(), [
      'A-approval', 'A-manager-review', 'A-procurement-review', 'A-submit',
    ]);
  });

  it('CONTROL_FLOW 的 FLOW 端点对齐到 ACTIVITY subject_key', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const flowFragment = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
    const flows = flowFragment.payload.facts.filter(f => f.kind === 'FLOW');

    // flow-2 原始: submit-purchase-request → manager-review
    // 对齐后应为: A-submit → A-manager-review
    const flow2 = flows.find(f => f.subject_key === 'flow-2');
    assert.ok(flow2, 'flow-2 应存在');
    assert.equal(flow2.attributes.source_subject_key, 'A-submit',
      'flow-2 source 应对齐到 A-submit');
    assert.equal(flow2.attributes.target_subject_key, 'A-manager-review',
      'flow-2 target 应对齐到 A-manager-review');
  });
});

// ══════════════════════════════════════════════════════════════
// 规则 3：ROLE 对齐 — 形成合法 RASCI R
// ══════════════════════════════════════════════════════════════

describe('规则 3: ROLE 对齐与 RASCI', () => {
  it('ROLE 的 subject_key 与 ACTIVITY 的 actor 形成关联', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const roles = activityFragment.payload.facts.filter(f => f.kind === 'ROLE');
    const activities = activityFragment.payload.facts.filter(f => f.kind === 'ACTIVITY');

    // ROLE 角色名应出现在 ACTIVITY 的 actor 中
    const roleNames = new Set(roles.map(r => r.label));
    for (const act of activities) {
      const actor = act.attributes?.actor;
      if (actor) {
        assert.ok(roleNames.has(actor),
          `ACTIVITY "${act.label}" actor "${actor}" 应匹配某个 ROLE label`);
      }
    }
  });

  it('无明确 actor 的活动不虚构 A/O 等职责，保留 OPEN question', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    // A-approval 无 actor 字段
    const approval = activityFragment.payload.facts.find(f => f.subject_key === 'A-approval');

    // 对齐层不应虚构 actor
    assert.equal(approval.attributes?.actor || null, null, 'A-approval 不应有虚构 actor');

    // 注意：A-reject-return 已按规则 6 移除并入 END_EVENT，不再存在
    const reject = activityFragment.payload.facts.find(f => f.subject_key === 'A-reject-return');
    assert.equal(reject, undefined, 'A-reject-return 应已移除');
  });
});

// ══════════════════════════════════════════════════════════════
// 规则 4：INPUT/OUTPUT/SLA/TOOL 等聚合到 ACTIVITY
// ══════════════════════════════════════════════════════════════

describe('规则 4: 兄弟事实聚合到 ACTIVITY', () => {
  it('SLA 从明确文本解析为 {value, unit, raw_text}', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const activities = activityFragment.payload.facts.filter(f => f.kind === 'ACTIVITY');

    // 经理初审有 SLA: "2个工作日"
    const managerReview = activities.find(f => f.subject_key === 'A-manager-review');
    assert.ok(managerReview.attributes.sla, 'A-manager-review 应有 SLA');
    assert.equal(managerReview.attributes.sla.value, 2);
    assert.equal(managerReview.attributes.sla.unit, 'WORKING_DAY', 'SLA unit 必须为 activity-catalog schema 枚举值 WORKING_DAY');
    assert.equal(managerReview.attributes.sla.raw_text, '2个工作日', 'raw_text 保留中文原文');

    // 采购复核有 SLA: "3个工作日"
    const procurementReview = activities.find(f => f.subject_key === 'A-procurement-review');
    assert.ok(procurementReview.attributes.sla, 'A-procurement-review 应有 SLA');
    assert.equal(procurementReview.attributes.sla.value, 3);
    assert.equal(procurementReview.attributes.sla.unit, 'WORKING_DAY', 'SLA unit 必须为 WORKING_DAY');
  });

  it('INPUT/OUTPUT 聚合到对应 ACTIVITY', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const activities = activityFragment.payload.facts.filter(f => f.kind === 'ACTIVITY');

    // A-submit 应有 inputs=["采购需求"] outputs=["采购申请单"]
    const submit = activities.find(f => f.subject_key === 'A-submit');
    assert.deepEqual(submit.attributes.inputs, ['采购需求']);
    assert.deepEqual(submit.attributes.outputs, ['采购申请单']);
  });

  it('CONFIRMATION_CONDITION 聚合到 completion_criteria，confirmation 保持 null', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const approval = activityFragment.payload.facts.find(f => f.subject_key === 'A-approval');

    // goal 要求：CONFIRMATION_CONDITION 不得写入字符串 confirmation
    // 应将明确三条件聚合到 completion_criteria，confirmation 保持 null
    assert.equal(approval.attributes.confirmation, null,
      'confirmation 应保持 null，不得写入字符串');

    // 检查 completion_criteria 是否包含聚合的条件
    assert.ok(Array.isArray(approval.attributes.completion_criteria),
      'completion_criteria 应为数组');
    assert.ok(approval.attributes.completion_criteria.length > 0,
      'completion_criteria 应包含聚合的 CONFIRMATION_CONDITION');

    // 检查是否包含原文中的条件
    const criteriaText = approval.attributes.completion_criteria.join(' ');
    assert.ok(criteriaText.includes('物料已入库'),
      'completion_criteria 应包含原文条件');
  });

  it('聚合后独立 SLA/INPUT/OUTPUT 事实被移除（已内化）', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const remainingKinds = new Set(activityFragment.payload.facts.map(f => f.kind));
    // SLA/INPUT/OUTPUT/RESPONSIBILITY/CONFIRMATION_CONDITION 应已聚合，不再作为独立事实存在
    assert.ok(!remainingKinds.has('SLA'), 'SLA 应已聚合到 ACTIVITY');
    assert.ok(!remainingKinds.has('INPUT'), 'INPUT 应已聚合到 ACTIVITY');
    assert.ok(!remainingKinds.has('OUTPUT'), 'OUTPUT 应已聚合到 ACTIVITY');
    assert.ok(!remainingKinds.has('RESPONSIBILITY'), 'RESPONSIBILITY 应已聚合到 ACTIVITY');
    assert.ok(!remainingKinds.has('CONFIRMATION_CONDITION'), 'CONFIRMATION_CONDITION 应已聚合');
  });

  it('未解析的 SLA 保持 null（不伪造）', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const submit = activityFragment.payload.facts.find(f => f.subject_key === 'A-submit');
    // A-submit 没有 SLA 事实
    assert.equal(submit.attributes.sla, null, '无 SLA 时应保持 null');
  });

  it('evidence_refs 合并不丢失', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const managerReview = activityFragment.payload.facts.find(f => f.subject_key === 'A-manager-review');
    // ACTIVITY 的 evidence_refs 应包含原始 ACTIVITY 和 SLA 事实的 evidence_refs
    assert.ok(managerReview.evidence_refs.length >= 2,
      'A-manager-review 应合并 ACTIVITY 和 SLA 的 evidence_refs');
  });
});

// ══════════════════════════════════════════════════════════════
// 规则 5：END_EVENT 去重与 label 规范化
// ══════════════════════════════════════════════════════════════

describe('规则 5: END_EVENT 去重与 label 规范化', () => {
  it('全角/半角"结束"后缀规范化后合并', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    // PROCESS_CARD: end-approved="采购已批准", end-rejected="退回申请人"
    // CONTROL_FLOW: end-event-approved="采购已批准（结束）", end-event-rejected="退回申请人（结束）"
    // 规范化后应合并为两个结束事件
    const controlFlow = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
    const endEvents = controlFlow.payload.facts.filter(f => f.kind === 'END_EVENT');

    // 标准化后 label 不应有"（结束）"后缀
    for (const ev of endEvents) {
      assert.ok(!ev.label.includes('（结束）'),
        `END_EVENT "${ev.label}" 不应包含"（结束）"后缀`);
    }

    // 恰好两个业务结束
    assert.equal(endEvents.length, 2, `应恰好两个 END_EVENT，实际: ${endEvents.length}`);
  });

  it('END_EVENT evidence_refs 合并来自两份片段', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    // PROCESS_CARD 的 END_EVENT evidence_refs 来自 B-004
    // CONTROL_FLOW 的 END_EVENT evidence_refs 来自各自块
    // 对齐后同一语义的 END_EVENT 应合并 evidence_refs
    const processCard = aligned.find(f => f.task_kind === 'PROCESS_CARD');
    const endEvents = processCard.payload.facts.filter(f => f.kind === 'END_EVENT');

    for (const ev of endEvents) {
      assert.ok(ev.evidence_refs.length >= 1,
        `END_EVENT "${ev.label}" 应有 evidence_refs`);
    }
  });

  it('保留"批准"和"退回/驳回"两个业务结束语义', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const processCard = aligned.find(f => f.task_kind === 'PROCESS_CARD');
    const endEvents = processCard.payload.facts.filter(f => f.kind === 'END_EVENT');
    const labels = endEvents.map(e => e.label);

    const hasApproved = labels.some(l => l.includes('批准'));
    const hasRejected = labels.some(l => l.includes('退回') || l.includes('驳回'));
    assert.ok(hasApproved, '应有"批准"结束事件');
    assert.ok(hasRejected, '应有"退回/驳回"结束事件');
  });

  it('PROCESS_CARD 与 CONTROL_FLOW 的 END_EVENT 规范化后 label 与 subject_key 完全一致', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
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
});

// ══════════════════════════════════════════════════════════════
// 规则 6：ACTIVITY 与 END_EVENT 规范化后同结果 → 别名并入
// ══════════════════════════════════════════════════════════════

describe('规则 6: ACTIVITY → END_EVENT 别名', () => {
  it('A-reject-return 无独立 IPO 时必须从 ACTIVITY 中移除', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const activityFragment = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const rejectAct = activityFragment.payload.facts.find(f =>
      f.subject_key === 'A-reject-return' && f.kind === 'ACTIVITY');

    // goal 要求：A-reject-return 必须从 ACTIVITY 中移除
    // 不能接受只打 end_event_alias 标记，因为 merge 不识别
    assert.equal(rejectAct, undefined,
      'A-reject-return 必须从 ACTIVITY 中移除，不得保留或标记 end_event_alias');
  });

  it('A-reject-return 的 evidence_refs 合入对应 END_EVENT', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
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

    // 原始 A-reject-return 的 evidence_refs 应保留在某处
    const originalFragments = await loadCapturedOutputs();
    const originalReject = originalFragments[1].payload.facts.find(f => f.subject_key === 'A-reject-return');
    for (const ref of originalReject.evidence_refs) {
      assert.ok(allRefs.has(ref),
        `evidence_ref "${ref}" 不应丢失`);
    }

    // 检查 END_EVENT 是否包含 A-reject-return 的 evidence_refs
    const controlFlow = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
    const endEvents = controlFlow.payload.facts.filter(f => f.kind === 'END_EVENT');
    const rejectEndEvent = endEvents.find(e =>
      e.label.includes('退回') || e.label.includes('驳回'));

    assert.ok(rejectEndEvent, '应存在退回/驳回 END_EVENT');
    for (const ref of originalReject.evidence_refs) {
      assert.ok(rejectEndEvent.evidence_refs.includes(ref),
        `END_EVENT 应包含 A-reject-return 的 evidence_ref "${ref}"`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 泛化验证：合成行为测试（无采购业务键）
// ══════════════════════════════════════════════════════════════

describe('泛化: 合成 subject_key 映射（无采购业务键）', () => {
  it('a) 三片段同 batch：FLOW target 解析到 ACTIVITY 的 subject_key', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');

    const batchId = 'EB-synthetic-mapping';
    const batchSha = 'a'.repeat(64);

    const fragments = [
      // PROCESS_CARD: 含 INPUT，attributes.activity 指向 ACTIVITY label
      {
        task_kind: 'PROCESS_CARD',
        batch_id: batchId,
        batch_sha256: batchSha,
        payload: {
          facts: [
            { fact_id: 'F-1', kind: 'PROCESS_NAME', subject_key: 'business-process-x', process_key: 'business-process-x', label: '合成流程', evidence_refs: ['e1'] },
            { fact_id: 'F-2', kind: 'INPUT', subject_key: 'business-step-x', process_key: 'business-process-x', label: '输入甲', attributes: { activity: '处理甲' }, evidence_refs: ['e2'] },
          ],
          uncertainties: [],
        },
      },
      // ACTIVITY: 模型自己生成的结构化键
      {
        task_kind: 'ACTIVITY_CATALOG',
        batch_id: batchId,
        batch_sha256: batchSha,
        payload: {
          facts: [
            { fact_id: 'F-3', kind: 'ACTIVITY', subject_key: 'model-step-z', process_key: 'business-process-x', label: '处理甲', attributes: {}, evidence_refs: ['e3'] },
          ],
          uncertainties: [],
        },
      },
      // CONTROL_FLOW: FLOW 使用业务键 target=business-step-x
      {
        task_kind: 'CONTROL_FLOW',
        batch_id: batchId,
        batch_sha256: batchSha,
        payload: {
          facts: [
            { fact_id: 'F-4', kind: 'START_EVENT', subject_key: 'start-1', process_key: 'business-process-x', label: '开始', evidence_refs: ['e4'] },
            { fact_id: 'F-5', kind: 'FLOW', subject_key: 'flow-1', process_key: 'business-process-x', label: '流转', attributes: { source_subject_key: 'start-1', target_subject_key: 'business-step-x' }, evidence_refs: ['e5'] },
          ],
          uncertainties: [],
        },
      },
    ];

    const aligned = alignFragments(fragments);

    // 验证 FLOW target 对齐到 ACTIVITY 的结构化键
    const controlFlow = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
    const flow = controlFlow.payload.facts.find(f => f.kind === 'FLOW');
    assert.equal(flow.attributes.target_subject_key, 'model-step-z',
      'FLOW target 应从 business-step-x 对齐到 model-step-z');

    // 验证 FLOW source（start 事件）保持不变
    assert.equal(flow.attributes.source_subject_key, 'start-1',
      'START_EVENT 的 source 应保持不变');
  });

  it('b) 结果别名：带 trigger/conditions 的 ACTIVITY 合入 END_EVENT', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');

    const batchId = 'EB-synthetic-alias';
    const batchSha = 'b'.repeat(64);

    const fragments = [
      // PROCESS_CARD: 最小结构
      {
        task_kind: 'PROCESS_CARD',
        batch_id: batchId,
        batch_sha256: batchSha,
        payload: {
          facts: [
            { fact_id: 'F-1', kind: 'PROCESS_NAME', subject_key: 'synthetic-process', process_key: 'synthetic-process', label: '合成流程', evidence_refs: ['e1'] },
          ],
          uncertainties: [],
        },
      },
      // ACTIVITY: label 与 END_EVENT 匹配，IPO 全空，但有 trigger/conditions
      {
        task_kind: 'ACTIVITY_CATALOG',
        batch_id: batchId,
        batch_sha256: batchSha,
        payload: {
          facts: [
            {
              fact_id: 'F-2', kind: 'ACTIVITY', subject_key: 'outcome-any', process_key: 'synthetic-process',
              label: '处理完毕',
              attributes: { inputs: [], outputs: [], sla: null, trigger: '完成通知', conditions: ['条件甲'] },
              evidence_refs: ['e-activity-outcome'],
            },
          ],
          uncertainties: [],
        },
      },
      // CONTROL_FLOW: END_EVENT label 带"（结束）"后缀
      {
        task_kind: 'CONTROL_FLOW',
        batch_id: batchId,
        batch_sha256: batchSha,
        payload: {
          facts: [
            { fact_id: 'F-3', kind: 'END_EVENT', subject_key: 'end-any', process_key: 'synthetic-process', label: '处理完毕（结束）', evidence_refs: ['e-end'] },
          ],
          uncertainties: [],
        },
      },
    ];

    const aligned = alignFragments(fragments);

    const activityFrag = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const controlFlow = aligned.find(f => f.task_kind === 'CONTROL_FLOW');

    // ACTIVITY outcome-any 应被移除（trigger/conditions 不阻止别名）
    const survivingAct = activityFrag.payload.facts.find(f => f.subject_key === 'outcome-any');
    assert.equal(survivingAct, undefined,
      '带 trigger/conditions 但 IPO 全空的 ACTIVITY 应被移除');

    // END_EVENT evidence_refs 应合入原 ACTIVITY 的 refs
    const endEv = controlFlow.payload.facts.find(f => f.kind === 'END_EVENT');
    assert.ok(endEv.evidence_refs.includes('e-activity-outcome'),
      'END_EVENT 应包含原 ACTIVITY 的 evidence_ref');

    // END_EVENT label 应规范化（去除"（结束）"）
    assert.ok(!endEv.label.includes('（结束）'), 'END_EVENT label 不应包含"（结束）"');
    assert.equal(endEv.label, '处理完毕', 'END_EVENT label 应为规范化后的值');
  });
});

// ══════════════════════════════════════════════════════════════
// 规则 7：原始输入不变 + 确定性 + 禁止布局字段
// ══════════════════════════════════════════════════════════════

describe('规则 7: 不变性与确定性', () => {
  it('原始输入对象字节不变', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const originalSnapshot = JSON.stringify(fragments);

    alignFragments(fragments);

    assert.equal(JSON.stringify(fragments), originalSnapshot,
      'alignFragments 不得修改原始输入');
  });

  it('递归禁止布局/XML/HTML 字段', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const forbidden = new Set([
      'x', 'y', 'width', 'height', 'bounds', 'position', 'coordinates',
      'waypoints', 'bpmn_xml', 'bpmn_di', 'xml', 'html', 'svg', 'layout', 'di',
    ]);

    function collectKeys(obj) {
      const keys = new Set();
      if (obj === null || typeof obj !== 'object') return keys;
      for (const [key, value] of Object.entries(obj)) {
        keys.add(key);
        if (typeof value === 'object' && value !== null) {
          for (const k of collectKeys(value)) keys.add(k);
        }
      }
      return keys;
    }

    for (const frag of aligned) {
      const allKeys = collectKeys(frag);
      const violations = [...allKeys].filter(k => forbidden.has(k));
      assert.deepEqual(violations, [],
        `${frag.task_kind} 不应包含禁止字段: ${violations.join(', ')}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 规则 8: question target 不得过滤删除，Activity ID → Task ID
// ══════════════════════════════════════════════════════════════

describe('规则 8: question target 映射', () => {
  it('merge 后 questions 数量不少于合并前 uncertainties 总数', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const totalUncertainties = fragments.reduce((sum, f) =>
      sum + (f.payload?.uncertainties?.length || 0), 0);

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const { process_draft } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned, focus: 'procurement-request',
    });

    assert.ok(process_draft.questions.length >= totalUncertainties,
      `问题数 ${process_draft.questions.length} 不应少于原始 uncertainties ${totalUncertainties}`);
  });

  it('question target 不含 Activity-xxx，应为 Task-xxx 或 process', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedOutputs();
    const aligned = alignFragments(fragments);

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const { process_draft } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned, focus: 'procurement-request',
    });

    // 收集所有有效 target
    const taskIds = new Set(process_draft.activities.map(a => a.main_task_id));
    taskIds.add('process');

    for (const q of process_draft.questions) {
      for (const target of q.target_paths) {
        assert.ok(taskIds.has(target) || target === 'process',
          `question target "${target}" 应为有效 Task ID 或 "process"，已知: ${[...taskIds].join(',')}`);
      }
    }
  });
});
