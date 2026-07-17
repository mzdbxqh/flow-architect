/**
 * 确定性语义对齐 E2E 测试
 *
 * 使用三份真实 MiMo captured output 驱动完整闭环：
 * validate → align → merge → validate draft → compile BPMN/DI → meeting payload → HTML/extract
 *
 * 遵循 goal 文档的 9 项要求，不修改 captured、不弱化断言。
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

/**
 * 递归收集对象的所有键名
 */
function collectKeys(obj) {
  const keys = new Set();
  if (obj === null || typeof obj !== 'object') return keys;
  for (const [key, value] of Object.entries(obj)) {
    keys.add(key);
    if (typeof value === 'object' && value !== null) {
      for (const childKey of collectKeys(value)) {
        keys.add(childKey);
      }
    }
  }
  return keys;
}

// ── 加载 captured fixtures ──

async function loadCapturedFragments() {
  const pc = await loadJson('captured/mimo-v2.5-pro-process-card.json');
  const ac = await loadJson('captured/mimo-v2.5-pro-activity.json');
  const cf = await loadJson('captured/mimo-v2.5-pro-control-flow.json');
  return [pc.output, ac.output, cf.output];
}

// ── 测试 ──

describe('确定性语义对齐 E2E — MiMo captured output 驱动', () => {

  // ══════════════════════════════════════════════════════════════
  // 1. 三份 captured output 均为 V2 信封格式且通过 strict validate
  // ══════════════════════════════════════════════════════════════

  it('1.1 三份 captured output 均为 V2 信封格式', async () => {
    const fragments = await loadCapturedFragments();
    for (const frag of fragments) {
      assert.equal(frag.schema_version, '2.0.0');
      assert.ok(frag.task_kind);
      assert.ok(frag.batch_id);
      assert.ok(frag.batch_sha256);
      assert.ok(frag.payload);
      assert.ok(Array.isArray(frag.payload.facts));
      assert.ok(Array.isArray(frag.payload.uncertainties));
    }
  });

  it('1.2 三份 captured output 通过 validateSemanticFragmentV2', async () => {
    const { validateSemanticFragmentV2 } = await import('../scripts/lib/process-draft-contract.mjs');
    const fragments = await loadCapturedFragments();

    for (const frag of fragments) {
      const result = await validateSemanticFragmentV2(frag);
      assert.equal(result.valid, true,
        `${frag.task_kind} 应通过 Schema 验证: ${JSON.stringify(result.errors)}`);
    }
  });

  it('1.3 模型原始输出递归不含布局、XML、HTML', async () => {
    const fragments = await loadCapturedFragments();
    const forbidden = new Set([
      'x', 'y', 'width', 'height', 'bounds', 'position', 'coordinates',
      'waypoints', 'bpmn_xml', 'bpmn_di', 'xml', 'html', 'svg', 'layout', 'di',
    ]);

    for (const frag of fragments) {
      const allKeys = collectKeys(frag);
      const violations = [...allKeys].filter(k => forbidden.has(k));
      assert.deepEqual(violations, [],
        `${frag.task_kind} 不应包含禁止字段: ${violations.join(', ')}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 2. Oracle 固定语义投影验证
  // ══════════════════════════════════════════════════════════════

  it('2.1 Oracle 固定语义投影验证', async () => {
    const oracle = await loadJson('oracle.json');
    const fragments = await loadCapturedFragments();

    for (const frag of fragments) {
      const taskKind = frag.task_kind;
      const oracleConfig = oracle[taskKind];
      if (!oracleConfig) continue;

      const facts = frag.payload.facts;
      const kinds = new Set(facts.map(f => f.kind));

      // 验证必填 kind
      for (const reqKind of oracleConfig.required_kinds) {
        assert.ok(kinds.has(reqKind),
          `${taskKind} 缺少必填 kind: ${reqKind}`);
      }

      // 验证最少 fact 数量
      assert.ok(facts.length >= oracleConfig.min_facts,
        `${taskKind} fact 数量不足: ${facts.length} < ${oracleConfig.min_facts}`);

      // 验证 evidence_refs
      if (oracleConfig.all_facts_must_have_evidence_refs) {
        for (const fact of facts) {
          assert.ok(Array.isArray(fact.evidence_refs) && fact.evidence_refs.length > 0,
            `${taskKind} fact ${fact.fact_id} 缺少 evidence_refs`);
        }
      }

      // 验证精确数量（如果 oracle 定义了）
      if (taskKind === 'CONTROL_FLOW') {
        const startEvents = facts.filter(f => f.kind === 'START_EVENT');
        const endEvents = facts.filter(f => f.kind === 'END_EVENT');
        const xorGateways = facts.filter(f => f.kind === 'GATEWAY_XOR');
        const flows = facts.filter(f => f.kind === 'FLOW');

        assert.equal(startEvents.length, oracleConfig.expected_start_event_count,
          `应恰好 ${oracleConfig.expected_start_event_count} 个 START_EVENT`);
        assert.equal(endEvents.length, oracleConfig.expected_end_event_count,
          `应恰好 ${oracleConfig.expected_end_event_count} 个 END_EVENT`);
        assert.equal(xorGateways.length, oracleConfig.expected_gateway_xor_count,
          `应恰好 ${oracleConfig.expected_gateway_xor_count} 个 GATEWAY_XOR`);
        assert.equal(flows.length, oracleConfig.expected_flow_count,
          `应恰好 ${oracleConfig.expected_flow_count} 个 FLOW`);
      }
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 3. 调用语义对齐层
  // ══════════════════════════════════════════════════════════════

  it('3.1 调用语义对齐层，不使用手工 normalize', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedFragments();

    // 对齐
    const aligned = alignFragments(fragments);

    // 验证 process_key 统一
    const allFacts = aligned.flatMap(f => f.payload.facts);
    const keys = new Set(allFacts.map(f => f.process_key));
    assert.equal(keys.size, 1, `应统一到一个 process_key，实际: ${[...keys].join(',')}`);

    // 验证 ACTIVITY subject_key 为结构化键
    const activityFrag = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
    const actKeys = activityFrag.payload.facts
      .filter(f => f.kind === 'ACTIVITY')
      .map(f => f.subject_key);

    for (const key of actKeys) {
      assert.ok(key.startsWith('A-'),
        `ACTIVITY subject_key 应为结构化键 A-xxx，实际: ${key}`);
    }
  });

  it('3.2 确定性：两次对齐产生字节一致结果', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedFragments();

    const aligned1 = alignFragments(fragments);
    const aligned2 = alignFragments(fragments);

    assert.equal(
      JSON.stringify(aligned1),
      JSON.stringify(aligned2),
      '两次对齐应字节一致'
    );
  });

  // ══════════════════════════════════════════════════════════════
  // 4. 对齐后调用 merge，草稿通过 validateProcessDraft
  // ══════════════════════════════════════════════════════════════

  it('4.1 对齐后调用 mergeProcessFragments', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
    const aligned = alignFragments(fragments);

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const result = await mergeProcessFragments({
      manifest, evidence, fragments: aligned, focus: 'procurement-request',
    });

    assert.ok(result.process_draft, '应生成流程草稿');
    assert.equal(result.process_draft.schema_version, '2.0.0');
    assert.ok(result.process_draft.activities.length > 0, '应有活动');
  });

  it('4.2 草稿通过 validateProcessDraft', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const { validateProcessDraft } = await import('../scripts/lib/process-draft-contract.mjs');
    const fragments = await loadCapturedFragments();
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

    const result = await validateProcessDraft(process_draft);
    assert.equal(result.valid, true,
      `流程草稿应通过验证: ${JSON.stringify(result.errors)}`);
  });

  // ══════════════════════════════════════════════════════════════
  // 5. 草稿业务断言
  // ══════════════════════════════════════════════════════════════

  it('5.1 草稿 level=L4，is_leaf=true', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    // process_level 在 process_card.level 中
    assert.equal(process_draft.process_card.level, 'L4', '应为 L4 层级');
    assert.equal(process_draft.process_card.is_leaf, true, '应为叶子流程');
  });

  it('5.2 活动一览包含证据中的四个 L5 活动', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    // 证据中的四个 L5 活动：提交、初审、复核、审批
    const activityNames = process_draft.activities.map(a => a.name);
    assert.ok(activityNames.some(n => n.includes('提交')), '应有提交活动');
    assert.ok(activityNames.some(n => n.includes('初审')), '应有初审活动');
    assert.ok(activityNames.some(n => n.includes('复核')), '应有复核活动');
    assert.ok(activityNames.some(n => n.includes('审批')), '应有审批活动');
  });

  it('5.3 每个活动有唯一 main_task_id，责任模型合法', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    const taskIds = process_draft.activities.map(a => a.main_task_id);
    const uniqueTaskIds = new Set(taskIds);
    assert.equal(taskIds.length, uniqueTaskIds.size, 'main_task_id 应唯一');

    // 责任模型为 RASCI 或 OARP
    for (const act of process_draft.activities) {
      assert.ok(
        act.responsibility_model === 'RASCI' || act.responsibility_model === 'OARP',
        `${act.name} 责任模型应为 RASCI 或 OARP，实际: ${act.responsibility_model}`
      );

      // 职责字母合法
      for (const ra of act.role_assignments) {
        assert.ok(
          ['R', 'A', 'S', 'C', 'I', 'O', 'P'].includes(ra.responsibility),
          `${act.name} 角色 ${ra.role_id} 职责字母不合法: ${ra.responsibility}`
        );
      }
    }
  });

  it('5.4 SLA 按证据聚合，unit 为 WORKING_DAY', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    // 查找有 SLA 的活动
    const activitiesWithSla = process_draft.activities.filter(a => a.sla);
    assert.ok(activitiesWithSla.length > 0, '应有活动包含 SLA');

    for (const act of activitiesWithSla) {
      assert.equal(act.sla.unit, 'WORKING_DAY', `${act.name} SLA unit 应为 WORKING_DAY`);
      assert.ok(act.sla.raw_text, `${act.name} SLA 应有 raw_text`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 6. 图断言
  // ══════════════════════════════════════════════════════════════

  it('6.1 一个开始、恰好两个业务结束', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    // 开始事件在 process_card.start 中
    assert.ok(process_draft.process_card.start, '应有开始事件');
    assert.ok(process_draft.process_card.start.event_id, '开始事件应有 event_id');

    // 结束事件在 process_card.end_results 中，去重后应恰好两个
    const endResults = process_draft.process_card.end_results;
    const uniqueEndNames = new Set(endResults.map(e => e.name));
    assert.equal(uniqueEndNames.size, 2, `应恰好两个业务结束事件，实际: ${[...uniqueEndNames].join(',')}`);
    assert.ok(uniqueEndNames.has('采购已批准'), '应有"采购已批准"结束');
    assert.ok(uniqueEndNames.has('退回申请人'), '应有"退回申请人"结束');
  });

  it('6.2 至少两个泳道，节点类型精确：1 START_EVENT、2 END_EVENT、3 GATEWAY_XOR', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    // 泳道：包含 oracle 中的两条泳道（证据 B-004），merge 会额外添加 ROLE 泳道
    const laneNames = process_draft.diagram.lanes.map(l => l.name);
    assert.ok(laneNames.includes('申请泳道'), '应包含"申请泳道"');
    assert.ok(laneNames.includes('审核泳道'), '应包含"审核泳道"');
    assert.ok(laneNames.length >= 2, `应至少两个泳道，实际: ${laneNames.length}`);

    // 节点类型精确断言（使用 node_type）
    const nodes = process_draft.diagram.nodes;
    const startEvents = nodes.filter(n => n.node_type === 'START_EVENT');
    const endEvents = nodes.filter(n => n.node_type === 'END_EVENT');
    const xorGateways = nodes.filter(n => n.node_type === 'GATEWAY_XOR');

    assert.equal(startEvents.length, 1,
      `应恰好 1 个 START_EVENT，实际: ${startEvents.length}`);
    assert.equal(endEvents.length, 2,
      `应恰好 2 个 END_EVENT，实际: ${endEvents.length}`);
    assert.equal(xorGateways.length, 3,
      `应恰好 3 个 GATEWAY_XOR，实际: ${xorGateways.length}`);
  });

  it('6.3 所有 7 条来自 capture 的 FLOW 均解析，无断链', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();
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

    // 使用真实 diagram schema：node_id（非 element_id）
    const nodeIds = new Set(process_draft.diagram.nodes.map(n => n.node_id));

    // 恰好 7 条来自 capture 的 FLOW（不使用 >=7 或 >0）
    assert.equal(process_draft.diagram.flows.length, 7,
      `应恰好 7 条流转，实际: ${process_draft.diagram.flows.length}`);

    // 验证所有流转的 source_ref/target_ref 存在于 node_id
    for (const flow of process_draft.diagram.flows) {
      assert.ok(nodeIds.has(flow.source_ref),
        `流转 source_ref "${flow.source_ref}" 不存在于 diagram.nodes，已知: ${[...nodeIds].join(',')}`);
      assert.ok(nodeIds.has(flow.target_ref),
        `流转 target_ref "${flow.target_ref}" 不存在于 diagram.nodes，已知: ${[...nodeIds].join(',')}`);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 7. 确定性：两次独立全链运行
  // ══════════════════════════════════════════════════════════════

  it('7.1 两次全链运行产生字节一致的 aligned fragments', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const fragments = await loadCapturedFragments();

    const aligned1 = alignFragments(fragments);
    const aligned2 = alignFragments(fragments);

    assert.equal(
      JSON.stringify(aligned1),
      JSON.stringify(aligned2),
      '两次对齐的 fragments 应字节一致'
    );
  });

  it('7.2 两次全链运行产生字节一致的 process draft', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const fragments = await loadCapturedFragments();

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const aligned1 = alignFragments(fragments);
    const aligned2 = alignFragments(fragments);

    const { process_draft: draft1 } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned1, focus: 'procurement-request',
    });
    const { process_draft: draft2 } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned2, focus: 'procurement-request',
    });

    assert.equal(
      JSON.stringify(draft1),
      JSON.stringify(draft2),
      '两次合并的 process draft 应字节一致'
    );
  });

  it('7.3 两次全链运行产生字节一致的 BPMN XML', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
    const fragments = await loadCapturedFragments();

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const aligned1 = alignFragments(fragments);
    const aligned2 = alignFragments(fragments);

    const { process_draft: draft1 } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned1, focus: 'procurement-request',
    });
    const { process_draft: draft2 } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned2, focus: 'procurement-request',
    });

    const bpmn1 = compileBpmn(draft1);
    const bpmn2 = compileBpmn(draft2);

    assert.equal(bpmn1.xml, bpmn2.xml, '两次编译的 BPMN XML 应字节一致');
    assert.equal(
      JSON.stringify(bpmn1.layout),
      JSON.stringify(bpmn2.layout),
      '两次编译的 layout/DI 应字节一致'
    );
  });

  // ══════════════════════════════════════════════════════════════
  // 8. HTML extractor 复读验证
  // ══════════════════════════════════════════════════════════════

  it('8.1 HTML extractor 复读后 payload 一致', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
    const { buildMeetingPackageHtml, extractMeetingPackageHtml } = await import('../scripts/lib/meeting-package-html.mjs');
    const fragments = await loadCapturedFragments();

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const aligned = alignFragments(fragments);
    const { process_draft } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned, focus: 'procurement-request',
    });
    const { xml: bpmnXml } = compileBpmn(process_draft);

    // questions 不得过滤
    const allQuestions = process_draft.questions;

    const metadata = {
      schema_version: '2.0.0',
      package_id: 'pkg-procurement-request',
      process_id: 'Process_procurement-request',
      title: '采购申请流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
    };

    const draftForHtml = { ...process_draft, questions: allQuestions };
    const html = buildMeetingPackageHtml({ draft: draftForHtml, bpmnXml, metadata });

    // extractor 复读
    const extracted = extractMeetingPackageHtml(html);
    assert.ok(extracted, '应能提取 payload');
    assert.equal(extracted.bpmn_xml, bpmnXml, 'bpmn_xml 应一致');
    assert.equal(extracted.questions.length, allQuestions.length, 'questions 数量应一致');

    // 所有 target 均为 BPMN 元素或 process
    const bpmnIdRegex = /id="([^"]+)"/g;
    const bpmnIds = new Set();
    let m;
    while ((m = bpmnIdRegex.exec(bpmnXml)) !== null) bpmnIds.add(m[1]);

    for (const q of extracted.questions) {
      for (const target of q.target_paths) {
        assert.ok(
          bpmnIds.has(target) || target === 'process',
          `question target "${target}" 应为 BPMN 元素或 process`
        );
      }
    }
  });

  // ══════════════════════════════════════════════════════════════
  // 9. 确定性 HTML 生成
  // ══════════════════════════════════════════════════════════════

  it('9.1 两次生成 HTML 字节一致', async () => {
    const { alignFragments } = await import('../scripts/lib/semantic-alignment.mjs');
    const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
    const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
    const { buildMeetingPackageHtml } = await import('../scripts/lib/meeting-package-html.mjs');
    const fragments = await loadCapturedFragments();

    const manifest = { title: '采购申请流程', focus: null };
    const evidence = { blocks: [
      { block_id: 'B-001', source_format: 'text', content: '' },
      { block_id: 'B-002', source_format: 'text', content: '' },
      { block_id: 'B-003', source_format: 'text', content: '' },
      { block_id: 'B-004', source_format: 'text', content: '' },
    ] };

    const aligned = alignFragments(fragments);
    const { process_draft } = await mergeProcessFragments({
      manifest, evidence, fragments: aligned, focus: 'procurement-request',
    });
    const { xml: bpmnXml } = compileBpmn(process_draft);

    const metadata = {
      schema_version: '2.0.0',
      package_id: 'pkg-procurement-request',
      process_id: 'Process_procurement-request',
      title: '采购申请流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
    };

    const html1 = buildMeetingPackageHtml({ draft: process_draft, bpmnXml, metadata });
    const html2 = buildMeetingPackageHtml({ draft: process_draft, bpmnXml, metadata });

    assert.equal(html1, html2, '两次生成的 HTML 应字节一致');
    assert.ok(html1.includes('<!DOCTYPE html>'), '应包含 HTML 声明');
  });
});
