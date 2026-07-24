/**
 * 流程片段合并库
 *
 * 将多个语义片段合并为一个规范化的流程草稿。
 * 处理事实去重、冲突保留、问题生成和泳道分配。
 *
 * R005 语义忠实度整改（M1/M2/M3/E1）：
 *  - M1：流程卡片 name/level/inputs/outputs 优先取焦点 process_key 的显式事实
 *    （PROCESS_NAME / PROCESS_LEVEL / 流程级 INPUT·OUTPUT），不被 manifest 展示标题
 *    或硬编码 L4 覆盖；title 仅作展示标题语义使用。
 *  - M2：以片段内 subject_key 为主要关联键，把 ROLE/RESPONSIBILITY/INPUT/OUTPUT/
 *    COMPLETION_CRITERIA/SLA/TOOL/REFERENCE/CONFIRMATION_CONDITION 聚合到对应 ACTIVITY；
 *    兼容 attributes.role 但不覆盖更明确的结构化 ROLE 事实。
 *  - M3：uncertainty 的 related_fact_ids 只在其来源 fragment 内解析（避免跨片段同名局部
 *    fact_id 串联）；target_paths 去重并稳定排序；对同一业务主题做确定性语义去重
 *    （已有原子问题时丢弃覆盖同主题的组合重复问题）；out_of_scope 审计完整保留。
 *  - E1：empty-related 但文本显式引用非焦点流程编号的 uncertainty 路由至 out_of_scope。
 */

import { createHash } from 'node:crypto';
import { verifyFragmentIntegrity } from './fragment-integrity.mjs';

/** 合法的流程层级（process_card.level 的闭集枚举，与 process-card Schema 一致）。 */
const VALID_LEVELS = new Set(['L1', 'L2', 'L3', 'L4', 'L5']);

/**
 * 合并流程片段
 *
 * @param {object} params
 * @param {object} params.manifest - 输入清单
 * @param {object} params.evidence - 证据索引
 * @param {object[]} params.fragments - 语义片段数组
 * @param {string|null} params.focus - 流程焦点
 * @param {string|null} [params.runDir] - 运行目录（可选，用于完整性验证）
 * @param {Function} [params._verifyFragmentIntegrity] - 自定义验证函数（仅供测试）
 * @returns {Promise<{ process_draft: object, merge_report: object }>}
 */
export async function mergeProcessFragments({ manifest, evidence, fragments, focus, runDir = null, _verifyFragmentIntegrity = null }) {
  // 0. 如果提供了 runDir，调用共享完整性验证
  if (runDir) {
    const verifyFn = _verifyFragmentIntegrity || verifyFragmentIntegrity;
    const result = await verifyFn({ runDir });
    if (!result.valid) {
      throw new Error(`Fragment 完整性验证失败:\n${result.errors.join('\n')}`);
    }
  }

  // 1. 收集所有事实与不确定性（支持 V1 和 V2 格式），并保留来源片段上下文。
  //    fragmentFactMaps[i]：第 i 个片段内 fact_id → { subject_key, processKey } 的映射，
  //    用于在来源片段内解析 uncertainty.related_fact_ids（M3：局部 fact_id 不跨片段串联）。
  const allFacts = [];
  const fragmentFactMaps = [];
  const uncertaintyEntries = []; // { u, fragIdx }
  const fragmentRefs = [];

  let fragIdx = 0;
  for (const fragment of fragments) {
    const isV2 = Boolean(fragment.task_kind && fragment.payload);
    const facts = isV2 ? (fragment.payload.facts || []) : (fragment.facts || []);
    const uncertainties = isV2 ? (fragment.payload.uncertainties || []) : (fragment.uncertainties || []);

    const localMap = new Map();
    for (const f of facts) {
      // 附带来源 batch_id（内部临时字段），供 deduplicateFacts 选取代表事实；
      // 该字段在 deduplicateFacts 输出处剥离，不进入最终草稿。
      allFacts.push({ ...f, _sourceBatchId: fragment.batch_id || '' });
      localMap.set(f.fact_id, {
        subject_key: f.subject_key,
        processKey: machineProcessKey(f.process_key || 'default'),
      });
    }
    for (const u of uncertainties) {
      uncertaintyEntries.push({ u, fragIdx });
    }
    fragmentFactMaps.push(localMap);
    fragmentRefs.push({
      batch_id: fragment.batch_id,
      batch_sha256: fragment.batch_sha256,
    });
    fragIdx += 1;
  }

  // 2. 按 process_key 分组检测
  const processGroups = groupByProcessKey(allFacts);
  const processKeys = Object.keys(processGroups);

  // 3. 检测多流程冲突
  if (!focus && processKeys.length > 1) {
    const candidates = processKeys.map(key => ({
      process_key: key,
      fact_count: processGroups[key].length,
      sample_label: processGroups[key][0]?.label || key,
    }));

    throw new Error(
      `检测到多个流程候选，请指定 --focus:\n` +
      candidates.map(c => `  - ${c.process_key}: ${c.sample_label} (${c.fact_count} 个事实)`).join('\n')
    );
  }

  // 选择目标流程（focus 与分组键同口径规范化，避免 CM-1.4 与 CM-1-4 失配）
  const targetProcessKey = focus ? machineProcessKey(focus) : (processKeys[0] || 'default');
  const targetFacts = processGroups[targetProcessKey] || allFacts;

  // 4. 去重事实（M5：单实例 kind 按 subject_key 合并，label 不入键）
  const { facts: dedupedFacts, labelConflicts } = deduplicateFacts(targetFacts);

  // 5. 分离冲突事实
  const { normalFacts, conflictFacts } = separateConflicts(dedupedFacts);

  // 6. 按类型分类事实（支持三类 capture 的全部 kind）
  const orgUnits = normalFacts.filter(f => f.kind === 'ORG_UNIT');
  const roles = normalFacts.filter(f => f.kind === 'ROLE');
  const activityFacts = normalFacts.filter(f => f.kind === 'ACTIVITY');
  const laneFacts = normalFacts.filter(f => f.kind === 'LANE');
  const gatewayFacts = normalFacts.filter(f => f.kind === 'GATEWAY_XOR' || f.kind === 'GATEWAY_AND' || f.kind === 'GATEWAY_OR');
  const flowFacts = normalFacts.filter(f => f.kind === 'FLOW' || f.kind === 'CONTROL_FLOW');
  const conditionFacts = normalFacts.filter(f => f.kind === 'CONDITION');
  const startEvents = normalFacts.filter(f => f.kind === 'START_EVENT');
  const endEvents = findAllEndEvents(normalFacts);

  // 6.1 流程卡片字段真实性：name / level / owner / purpose 取焦点流程的明确事实。
  //     name 不得被 manifest 展示标题替代；level 不得硬编码或为过 Schema 回退 L4。
  const nameField = resolveCardField(normalFacts, 'PROCESS_NAME', 'name', '流程名称', targetProcessKey);
  const levelField = resolveProcessLevel(normalFacts, targetProcessKey);
  const ownerField = resolveCardField(normalFacts, 'PROCESS_OWNER', 'owner', '流程责任人', targetProcessKey);
  const purposeField = resolveCardField(normalFacts, 'PROCESS_PURPOSE', 'purpose', '流程目的', targetProcessKey);

  // 6.2 M2：以 subject_key 为主要关联键，聚合兄弟事实到对应 ACTIVITY。
  const { aggregates: activityAggregates, activitySubjectSet } = buildActivityAggregates(activityFacts, normalFacts);

  // 6.3 M1：流程级 INPUT/OUTPUT = subject_key 不归属任何活动的 INPUT/OUTPUT 事实。
  const { processInputs, processOutputs } = collectProcessLevelIO(normalFacts, activitySubjectSet);

  // 6.4 起止事件跨片段确定性对齐：同语义结束事件合并为唯一终点。
  const alignedEndEvents = alignEndEvents(endEvents);

  // 7. 计算末端组织候选
  const terminalOrgCandidates = computeTerminalOrgCandidates(orgUnits);
  const selectedOrgId = terminalOrgCandidates.length === 1 ? terminalOrgCandidates[0] : null;

  // 8. 创建泳道（角色 + LANE 事实）
  // 描述型 LANE 事实若与已有正式角色泳道同名（规范化后），不重复建 lane。
  const lanes = createLanes(roles, orgUnits);
  const seenLaneNames = new Set(lanes.map(l => normalizeLaneName(l.name)));
  for (const laneFact of laneFacts) {
    const laneNorm = normalizeLaneName(laneFact.label);
    if (!seenLaneNames.has(laneNorm)) {
      seenLaneNames.add(laneNorm);
      lanes.push({
        lane_id: `Lane-${stableHash(laneFact.fact_id).slice(0, 8)}`,
        name: laneFact.label,
        org_candidates: [],
      });
    }
  }

  // 8.2 uncertainty 焦点相关性分类：仅焦点相关 uncertainty 进入用户问题清单，
  //     非焦点项写入 merge_report.out_of_scope_uncertainties 保留审计（不丢弃）。
  //     related_fact_ids 只在来源片段内解析；empty-related 但文本显式引用非焦点流程编号者
  //     判为非焦点（E1：避免非焦点候选问题混入用户清单）。
  const inScopeEntries = [];
  const outOfScopeEntries = [];
  for (const entry of uncertaintyEntries) {
    if (isFocusRelevant(entry, targetProcessKey, fragmentFactMaps)) {
      inScopeEntries.push(entry);
    } else {
      outOfScopeEntries.push(entry);
    }
  }

  // 8.3 计算「有待确认问题的活动 subject_key 集合」（用于 completeness 与真实字段状态一致）。
  const activitySubjectsWithQuestions = new Set();
  for (const entry of inScopeEntries) {
    for (const sk of resolveUncertaintySubjects(entry, fragmentFactMaps)) {
      if (activitySubjectSet.has(sk)) activitySubjectsWithQuestions.add(sk);
    }
  }

  // 9. 转换活动为元素（M2：使用 subject_key 聚合结果分配泳道与 IPO/完成标准）
  const { elements, questions: activityQuestions } = convertActivitiesToElements(
    activityFacts,
    lanes,
    activityAggregates,
    activitySubjectsWithQuestions
  );

  // 9.1. 检查是否有元素使用了 Lane-unassigned，如果有则添加占位泳道
  const hasUnassignedLane = elements.some(e => e.lane_id === 'Lane-unassigned');
  if (hasUnassignedLane) {
    lanes.push({
      lane_id: 'Lane-unassigned',
      name: '未分配',
      org_candidates: [],
    });
  }

  // 10. 构建 subject_key → node_id 映射（连接控制流与活动/网关）
  const startEventId = `Start-${stableHash('start').slice(0, 8)}`;
  const startEventName = findBoundaryStart(elements, normalFacts);
  const endResults = alignedEndEvents.length > 0 ? alignedEndEvents.map(event => ({
    event_id: `End-${stableHash(event.fact_id).slice(0, 8)}`,
    name: event.label,
  })) : [{
    event_id: `End-${stableHash('end').slice(0, 8)}`,
    name: findBoundaryEnd(elements, normalFacts),
  }];

  // 结束事件 subject_key → 唯一终点 node_id：跨片段同语义终点对齐到同一节点，
  // 保证引用任一片段终点 subject_key 的 FLOW 都收敛到唯一结束事件。
  const endSubjectToNodeId = new Map();
  for (const ev of endEvents) {
    const endNorm = normalizeEndLabel(ev.label);
    const primary = alignedEndEvents.find(p => normalizeEndLabel(p.label) === endNorm) || ev;
    endSubjectToNodeId.set(ev.subject_key, `End-${stableHash(primary.fact_id).slice(0, 8)}`);
  }

  const subjectToNodeId = new Map();
  for (const element of elements) {
    const stableId = stableHash(element.fact_id || element.element_id).slice(0, 8);
    subjectToNodeId.set(element.subject_key || element.name, `Task-${stableId}`);
  }
  for (const gw of gatewayFacts) {
    subjectToNodeId.set(gw.subject_key, `Gateway-${stableHash(gw.fact_id).slice(0, 8)}`);
  }
  for (const [subjectKey, nodeId] of endSubjectToNodeId) {
    subjectToNodeId.set(subjectKey, nodeId);
  }
  // 将所有 START_EVENT subject_key 映射到同一 startEventId（FLOW 可引用任一键）
  for (const se of startEvents) {
    subjectToNodeId.set(se.subject_key, startEventId);
  }

  // 10.1 解析每个焦点 uncertainty 的目标节点（M3：来源片段内 fact_id → subject_key → 图元素，
  //      target_paths 去重并稳定排序；无法解析时回退到首个活动节点或 process 哨兵）。
  const defaultTarget = elements.length > 0
    ? `Task-${stableHash(elements[0].fact_id || elements[0].element_id).slice(0, 8)}`
    : 'process';
  const uncertaintyAnchors = inScopeEntries.map(entry =>
    resolveUncertaintyAnchor(entry, fragmentFactMaps, subjectToNodeId, activitySubjectSet, defaultTarget));

  // 11. 生成问题（卡片字段缺失/推断问题 + 活动级问题 + 焦点 uncertainty）
  // 卡片字段是流程级问题，锚定到起点事件节点（真实 BPMN 元素），
  // 避免 target_paths 使用 'process' 哨兵而引用不存在的图元素（会议包复读门禁）。
  const cardQuestions = [nameField.question, levelField.question, ownerField.question, purposeField.question]
    .filter(Boolean)
    .map(q => ({ ...q, element_ids: [startEventId] }));

  // M5：同主体单实例事实的名称真实冲突（互不为前缀）→ 生成 OPEN 待确认问题，不静默吞掉。
  const labelConflictQuestions = labelConflicts.map(lc => {
    const sortedLabels = [...lc.labels].sort();
    const cid = stableHash(`${lc.kind}:${lc.process_key}:${lc.subject_key}:${sortedLabels.join('|')}`).slice(0, 8);
    const nodeId = subjectToNodeId.get(lc.subject_key) || defaultTarget;
    return {
      question_id: `Q-label-conflict-${cid}`,
      text: `${lc.subject_key} 的名称存在冲突（候选：${sortedLabels.join(' / ')}），已按字典序选取「${lc.chosenLabel}」，请确认`,
      element_ids: [nodeId],
      status: 'OPEN',
      answer: '',
      evidence_refs: lc.evidence_refs,
    };
  });

  const questions = [
    ...cardQuestions,
    ...activityQuestions,
    ...labelConflictQuestions,
    ...generateQuestions(uncertaintyAnchors, conflictFacts, {
      selectedOrgId,
      terminalOrgCandidates,
      targetProcessKey,
      defaultTarget,
    }),
  ];

  // 12. 生成冲突记录
  const conflicts = conflictFacts.map(f => ({
    conflict_id: `C-${stableHash(f.fact_id).slice(0, 8)}`,
    description: `冲突: ${f.label}`,
    fact_ids: [f.fact_id],
    evidence_refs: f.evidence_refs,
  }));

  // 13. 构建 diagram 节点（活动 + 网关 + 开始/结束事件）
  const processCardRef = {
    start: { event_id: startEventId, name: startEventName, event_type: 'NONE' },
    end_results: endResults,
  };

  const diagramNodes = [
    {
      node_id: processCardRef.start.event_id,
      node_type: 'START_EVENT',
      name: processCardRef.start.name,
      lane_id: null,
    },
    ...elements.map(element => {
      const stableId = stableHash(element.fact_id || element.element_id).slice(0, 8);
      return {
        node_id: `Task-${stableId}`,
        node_type: 'MAIN_TASK',
        name: element.name,
        lane_id: element.lane_id,
      };
    }),
    ...gatewayFacts.map(gw => ({
      node_id: `Gateway-${stableHash(gw.fact_id).slice(0, 8)}`,
      node_type: gw.kind,
      name: gw.label,
      lane_id: null,
    })),
    ...processCardRef.end_results.map(endEvent => ({
      node_id: endEvent.event_id,
      node_type: 'END_EVENT',
      name: endEvent.name,
      lane_id: null,
    })),
  ];

  // 14. 生成流转（支持 V2 FLOW 事实的 subject_key 引用）
  const conditionBySource = new Map();
  for (const c of conditionFacts) {
    const src = c.attributes?.source_subject_key;
    if (src) {
      if (!conditionBySource.has(src)) conditionBySource.set(src, []);
      conditionBySource.get(src).push(c);
    }
  }

  const flows = [];
  const addedFlows = new Set();

  // 从 V2 FLOW 事实生成流转
  for (const flowFact of flowFacts) {
    const srcKey = flowFact.attributes?.source_subject_key || flowFact.attributes?.source;
    const tgtKey = flowFact.attributes?.target_subject_key || flowFact.attributes?.target;
    if (!srcKey || !tgtKey) continue;

    const sourceId = subjectToNodeId.get(srcKey);
    const targetId = subjectToNodeId.get(tgtKey);
    if (!sourceId || !targetId) continue;

    const flowKey = `${sourceId}->${targetId}`;
    if (addedFlows.has(flowKey)) continue;
    addedFlows.add(flowKey);

    const conditions = conditionBySource.get(srcKey) || [];
    const matchingCondition = conditions.find(c => {
      const tgt = c.attributes?.target_subject_key;
      return !tgt || tgt === tgtKey;
    });

    flows.push({
      flow_id: `Flow-${stableHash(flowFact.fact_id).slice(0, 8)}`,
      source_ref: sourceId,
      target_ref: targetId,
      condition: matchingCondition ? {
        label: matchingCondition.label,
        source_output: matchingCondition.attributes?.source_output || null,
        operator: matchingCondition.attributes?.operator || null,
        value: matchingCondition.attributes?.value || null,
      } : null,
    });
  }

  // 线性回退：无 V2 流转时使用 start→tasks→end
  if (flows.length === 0) {
    const firstTaskId = elements.length > 0 ? `Task-${stableHash(elements[0].fact_id || elements[0].element_id).slice(0, 8)}` : null;
    const lastTaskId = elements.length > 0 ? `Task-${stableHash(elements[elements.length - 1].fact_id || elements[elements.length - 1].element_id).slice(0, 8)}` : null;

    if (firstTaskId) {
      flows.push({
        flow_id: `Flow-Start-${stableHash('start-flow').slice(0, 8)}`,
        source_ref: startEventId,
        target_ref: firstTaskId,
        condition: null,
      });
    }
    for (let i = 0; i < elements.length - 1; i++) {
      const sid = stableHash(elements[i].fact_id || elements[i].element_id).slice(0, 8);
      const tid = stableHash(elements[i + 1].fact_id || elements[i + 1].element_id).slice(0, 8);
      flows.push({
        flow_id: `Flow-Seq-${stableHash(`${i}`).slice(0, 8)}`,
        source_ref: `Task-${sid}`,
        target_ref: `Task-${tid}`,
        condition: null,
      });
    }
    if (lastTaskId && endResults.length > 0) {
      flows.push({
        flow_id: `Flow-End-${stableHash('end-flow').slice(0, 8)}`,
        source_ref: lastTaskId,
        target_ref: endResults[0].event_id,
        condition: null,
      });
    }
  }

  // 15. 构建 V2 流程草稿
  // M1：name 取焦点 PROCESS_NAME 显式事实（缺失时回退展示标题，绝不按文件名/父标题编造）；
  //     level 取焦点 PROCESS_LEVEL 显式事实（缺失/非法时诚实回退 L4，绝不为过 Schema 降级真实层级）。
  // M4：is_leaf 由 levelField 派生（EXPLICIT/INFERRED L4·L5 → true；L1-L3 或缺失/非法 → false），
  //     取代硬编码 true，诚实表达未确认末端。
  const cardName = nameField.value || (typeof manifest.title === 'string' && manifest.title ? manifest.title : null);
  const cardDescription = (typeof manifest.title === 'string' && manifest.title)
    ? manifest.title
    : (cardName || '');
  const processDraft = {
    schema_version: '2.0.0',
    process_card: {
      process_id: targetProcessKey,
      name: cardName,
      level: levelField.value,
      is_leaf: levelField.isLeaf,
      description: cardDescription,
      purpose: purposeField.value,
      owner: ownerField.value,
      parent_process_name: null,
      inputs: processInputs,
      outputs: processOutputs,
      start: processCardRef.start,
      end_results: processCardRef.end_results,
      performance_indicators: [],
    },
    activities: elements.map(element => {
      const originalFact = normalFacts.find(f => f.kind === 'ACTIVITY' && f.label === element.name);
      const activityType = originalFact?.attributes?.activity_type || 'STANDARD';
      const responsibilityModel = originalFact?.attributes?.responsibility_model || 'RASCI';
      const roleAssignments = originalFact?.attributes?.role_assignments || [];

      const stableId = stableHash(element.fact_id || element.element_id).slice(0, 8);
      const activityId = `Activity-${stableId}`;
      const mainTaskId = `Task-${stableId}`;

      return {
        activity_id: activityId,
        name: element.name,
        description: element.name,
        activity_type: activityType,
        responsibility_model: responsibilityModel,
        role_assignments: roleAssignments.length > 0 ? roleAssignments : (element.lane_id ? [{
          role_id: element.lane_id,
          responsibility: responsibilityModel === 'RASCI' ? 'R' : 'O',
        }] : []),
        sla: element.sla ?? null,
        tools: element.tools || [],
        inputs: element.inputs || [],
        process_summary: originalFact?.attributes?.process_summary || '',
        outputs: element.outputs || [],
        completion_criteria: element.completion_criteria || [],
        references: element.references || [],
        main_task_id: mainTaskId,
        confirmation: originalFact?.attributes?.confirmation || null,
        completeness: element.completeness,
        evidence_refs: element.evidence_refs || [],
      };
    }),
    diagram: {
      lanes: lanes.map(lane => ({
        lane_id: lane.lane_id,
        name: lane.name,
        role_id: lane.lane_id,
      })),
      nodes: diagramNodes,
      flows,
      task_bindings: elements.map(element => {
        const stableId = stableHash(element.fact_id || element.element_id).slice(0, 8);
        return {
          activity_id: `Activity-${stableId}`,
          main_task_id: `Task-${stableId}`,
          confirmation_task_id: null,
        };
      }),
      layout_version: '2.0.0',
    },
    questions: questions.map(q => ({
      question_id: q.question_id,
      text: q.text,
      target_paths: q.element_ids || ['process'],
      status: q.status,
      answer: q.answer || '',
      evidence_refs: q.evidence_refs || [],
    })),
    provenance: buildCardProvenance(nameField, levelField, ownerField, purposeField),
    source_summary: {
      total_blocks: evidence.blocks?.length || 0,
      formats: [...new Set((evidence.blocks || []).map(b => b.source_format))].sort(),
      evidence_refs: [...new Set(allFacts.flatMap(f => f.evidence_refs))].sort(),
    },
  };

  // 16. 生成合并报告
  const mergeReport = {
    total_fragments: fragments.length,
    total_facts: allFacts.length,
    deduped_facts: dedupedFacts.length,
    conflict_facts: conflictFacts.length,
    questions_generated: questions.length,
    terminal_org_candidates: terminalOrgCandidates,
    selected_org_id: selectedOrgId,
    fragment_refs: fragmentRefs,
    fact_kinds_merged: [...new Set(dedupedFacts.map(f => f.kind))],
    // M5：同主体单实例事实的名称冲突记录（真实冲突不静默吞掉）。
    conflicts: labelConflicts.map(lc => ({
      conflict_id: `C-label-${stableHash(`${lc.kind}:${lc.process_key}:${lc.subject_key}`).slice(0, 8)}`,
      kind: lc.kind,
      subject_key: lc.subject_key,
      description: `名称冲突: ${[...lc.labels].sort().join(' / ')}`,
      chosen_label: lc.chosenLabel,
      evidence_refs: lc.evidence_refs,
    })),
    // 被排除的非焦点 uncertainty：保留审计，不丢弃。
    out_of_scope_uncertainties: outOfScopeEntries.map(({ u }) => ({
      text: u.text,
      kind: u.kind || null,
      related_fact_ids: u.related_fact_ids || [],
      evidence_refs: u.evidence_refs || [],
      reason: 'non-focus-process',
    })),
    out_of_scope_uncertainty_count: outOfScopeEntries.length,
  };

  return { process_draft: processDraft, merge_report: mergeReport };
}

/**
 * 按 process_key 分组（以机器键归组）。
 *
 * 显示编号与机器键分离：显示编号（如 CM-1.4）保留在 attributes.code，
 * 机器键确定性规范化为 CM-1-4（见 machineProcessKey）。这样同一流程的不同书写形式
 * （CM-1.4 / CM-1-4）会归入同一组，且不要求模型自行猜测格式。
 */
function groupByProcessKey(facts) {
  const groups = {};
  for (let fact of facts) {
    const rawKey = fact.process_key || 'default';
    const key = machineProcessKey(rawKey);
    // 仅在显示编号与机器键不同（如含点号）时保留显示编号，避免为普通键注入冗余 code。
    if (rawKey !== 'default' && key !== rawKey && !fact.attributes?.code) {
      fact = { ...fact, attributes: { ...(fact.attributes || {}), code: displayProcessCode(rawKey) } };
    }
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(fact);
  }
  return groups;
}

/**
 * 「每主体单实例」的流程级 kind：同 process_key + subject_key 只保留一个代表事实。
 *
 * M5：ACTIVITY / PROCESS_NAME / PROCESS_LEVEL 等流程级 kind 以 kind+process_key+subject_key
 * 为主身份键（label 不入键），同一 subject_key 的详略不同 label 合并为一个活动/字段；
 * INPUT/OUTPUT/ROLE/SLA/TOOL 等多实例 kind 保持 label 入键（同主体多条兄弟事实不误合并）。
 */
const SINGLE_INSTANCE_KINDS = new Set(['ACTIVITY', 'PROCESS_NAME', 'PROCESS_LEVEL']);

/**
 * 去重事实（M5：按 kind 分类处理去重键）。
 *
 * - 单实例 kind（ACTIVITY/PROCESS_NAME/PROCESS_LEVEL）且有 subject_key：
 *   键 = kind:process_key:subject_key（label 不入键）；同主体多条合并证据，
 *   名称按确定性规则选取（前缀取长者，真实冲突取字典序最小并记录）。
 * - 多实例 kind 或无 subject_key：键 = kind:process_key:subject_key:label（保持既有行为）。
 * - 代表事实（决定 fact_id → 节点稳定 ID）在持有代表 label 的候选中取 (batch_id, fact_id)
 *   字典序最小者，与输入顺序无关。
 * - 输出按稳定键排序，保证交换 fragment 顺序后字节一致。
 *
 * @returns {{ facts: object[], labelConflicts: object[] }}
 */
function deduplicateFacts(facts) {
  const groups = new Map(); // key → fact[]

  for (const fact of facts) {
    const isSingleInstance = SINGLE_INSTANCE_KINDS.has(fact.kind) && fact.subject_key != null;
    const key = isSingleInstance
      ? `${fact.kind}:${fact.process_key}:${fact.subject_key}`
      : `${fact.kind}:${fact.process_key}:${fact.subject_key}:${fact.label}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }

  const result = [];
  const labelConflicts = [];

  for (const [, candidates] of groups) {
    // 合并证据引用（并集去重后排序，保证字节稳定）
    const mergedEvidence = [];
    for (const c of candidates) {
      for (const ref of (c.evidence_refs || [])) {
        if (!mergedEvidence.includes(ref)) mergedEvidence.push(ref);
      }
    }
    mergedEvidence.sort();

    if (candidates.length === 1) {
      const { _sourceBatchId, ...clean } = candidates[0];
      result.push({ ...clean, evidence_refs: mergedEvidence });
      continue;
    }

    const first = candidates[0];
    const isSingleInstance = SINGLE_INSTANCE_KINDS.has(first.kind) && first.subject_key != null;

    if (!isSingleInstance) {
      // 多实例 kind 且同 label：仅合并证据，保留首个事实
      const { _sourceBatchId, ...clean } = first;
      result.push({ ...clean, evidence_refs: mergedEvidence });
    } else {
      // 单实例 kind：确定性选取代表 label 与代表事实
      const { label, isConflict, allLabels } = resolveRepresentativeLabel(candidates);
      const repFact = selectRepresentativeFact(candidates, label);
      const { _sourceBatchId, ...repClean } = repFact;
      result.push({ ...repClean, label, evidence_refs: mergedEvidence });

      if (isConflict) {
        labelConflicts.push({
          kind: first.kind,
          process_key: first.process_key,
          subject_key: first.subject_key,
          labels: allLabels,
          chosenLabel: label,
          evidence_refs: mergedEvidence,
        });
      }
    }
  }

  // 按稳定键排序，保证输出与输入顺序无关（字节稳定）
  result.sort((a, b) => {
    const ka = `${a.kind}\u0000${a.process_key || ''}\u0000${a.subject_key || ''}\u0000${a.label || ''}\u0000${a.fact_id || ''}`;
    const kb = `${b.kind}\u0000${b.process_key || ''}\u0000${b.subject_key || ''}\u0000${b.label || ''}\u0000${b.fact_id || ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // R006 修复轮 1：labelConflicts 同样按稳定键排序后再返回。
  // groups 为 Map，其迭代序 = 键首次插入序，依赖 fragment 输入顺序；若不排序，
  // 多个真实名称冲突并存时 labelConflictQuestions（进入 process_draft.questions）与
  // merge_report.conflicts 的顺序随 fragment 顺序漂移，导致 process_draft 字节不稳定。
  // 每条冲突的 (kind, process_key, subject_key) 唯一（每组至多一条），该键可全序定排。
  labelConflicts.sort((a, b) => {
    const ka = `${a.kind} ${a.process_key || ''} ${a.subject_key || ''}`;
    const kb = `${b.kind} ${b.process_key || ''} ${b.subject_key || ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { facts: result, labelConflicts };
}

/**
 * M5：从同主体单实例事实候选中确定性选取代表 label。
 *
 * 规则（与输入顺序无关、字节稳定、可解释）：
 * 1. 去空白后所有候选 label 相同 → 使用该 label；
 * 2. 候选 label 按长度升序构成前缀链（每个较短者为下一个的前缀）→ 取最长者（信息更全）；
 * 3. 否则为真实冲突 → 按字典序取最小者，标记 isConflict（由调用方生成冲突问题，不静默吞掉）。
 *
 * @returns {{ label: string, isConflict: boolean, allLabels: string[] }}
 */
function resolveRepresentativeLabel(candidates) {
  const uniqueLabels = [...new Set(candidates.map(c => String(c.label ?? '').trim()))].filter(Boolean);
  if (uniqueLabels.length <= 1) {
    return { label: uniqueLabels[0] || '', isConflict: false, allLabels: uniqueLabels };
  }
  // 按长度升序、同长按字典序排列，检验前缀链
  const sorted = [...uniqueLabels].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  let isPrefixChain = true;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (!sorted[i + 1].startsWith(sorted[i])) {
      isPrefixChain = false;
      break;
    }
  }
  if (isPrefixChain) {
    return { label: sorted[sorted.length - 1], isConflict: false, allLabels: uniqueLabels };
  }
  // 真实冲突：按字典序确定性取最小者
  const chosen = [...uniqueLabels].sort()[0];
  return { label: chosen, isConflict: true, allLabels: uniqueLabels };
}

/**
 * M5：在持有代表 label 的候选中选取代表事实（决定 fact_id → 节点稳定 ID）。
 *
 * 按 (_sourceBatchId, fact_id) 字典序最小者选取，与输入顺序无关。
 */
function selectRepresentativeFact(candidates, chosenLabel) {
  const matching = candidates.filter(c => String(c.label ?? '').trim() === chosenLabel);
  const pool = matching.length > 0 ? matching : candidates;
  return [...pool].sort((a, b) => {
    const ba = String(a._sourceBatchId || '');
    const bb = String(b._sourceBatchId || '');
    if (ba !== bb) return ba < bb ? -1 : 1;
    const fa = String(a.fact_id || '');
    const fb = String(b.fact_id || '');
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  })[0];
}

/**
 * 分离冲突事实
 */
function separateConflicts(facts) {
  const normalFacts = [];
  const conflictFacts = [];

  for (const fact of facts) {
    if (fact.certainty === 'CONFLICT') {
      conflictFacts.push(fact);
    } else {
      normalFacts.push(fact);
    }
  }

  return { normalFacts, conflictFacts };
}

/**
 * M2：以片段内 subject_key 为主要关联键，把结构化兄弟事实聚合到对应 ACTIVITY。
 *
 * 聚合的事实类型：ROLE、RESPONSIBILITY、INPUT、OUTPUT、COMPLETION_CRITERIA、SLA、TOOL、
 * REFERENCE、CONFIRMATION_CONDITION。兼容 activity.attributes 中已有的 role/inputs/outputs/
 * completion_criteria/tools/references/sla，但结构化 ROLE 事实优先于 attributes.role
 * （不覆盖更明确的结构化事实）。所有数组按首次出现顺序去重，保证字节稳定。
 *
 * @returns {{ aggregates: Map<string, object>, activitySubjectSet: Set<string> }}
 */
function buildActivityAggregates(activityFacts, normalFacts) {
  const activitySubjectSet = new Set();
  const aggregates = new Map();

  for (const activity of activityFacts) {
    if (activity.subject_key == null) continue;
    activitySubjectSet.add(activity.subject_key);
    aggregates.set(activity.subject_key, aggregateFromAttributes(activity));
  }

  // 需聚合到 ACTIVITY 的兄弟事实类型（RESPONSIBILITY 无对应输出字段，不写入活动载荷，
  // 以免违反 activity-catalog Schema 的 additionalProperties:false；其语义由 ROLE/完成标准承载）。
  const siblingKinds = new Set([
    'ROLE', 'INPUT', 'OUTPUT', 'COMPLETION_CRITERIA',
    'CONFIRMATION_CONDITION', 'SLA', 'TOOL', 'REFERENCE',
  ]);

  for (const fact of normalFacts) {
    if (!siblingKinds.has(fact.kind)) continue;
    if (fact.subject_key == null || !aggregates.has(fact.subject_key)) continue;
    const agg = aggregates.get(fact.subject_key);
    const label = fact.label;

    switch (fact.kind) {
      case 'ROLE':
        // 结构化 ROLE 事实优先于 attributes.role。
        agg.roleName = label;
        agg.roleFromSibling = true;
        break;
      case 'INPUT':
        pushUnique(agg.inputs, label);
        break;
      case 'OUTPUT':
        pushUnique(agg.outputs, label);
        break;
      case 'COMPLETION_CRITERIA':
        pushUnique(agg.completion_criteria, label);
        break;
      case 'CONFIRMATION_CONDITION':
        for (const part of String(label ?? '').split(/[、,，]/).map(s => s.trim()).filter(Boolean)) {
          pushUnique(agg.completion_criteria, part);
        }
        break;
      case 'SLA':
        if (agg.sla === null || agg.sla === undefined) {
          agg.sla = parseSla(label);
        }
        break;
      case 'TOOL':
        pushUnique(agg.tools, label);
        break;
      case 'REFERENCE':
        pushUnique(agg.references, label);
        break;
      default:
        break;
    }
  }

  return { aggregates, activitySubjectSet };
}

/**
 * 从活动自身 attributes 构建聚合初值（兼容既有 attributes.role/inputs/outputs/… 协议形态）。
 * 数组按首次出现顺序去重，保证字节稳定。结构化 ROLE 兄弟事实会在聚合阶段覆盖 attributes.role。
 */
function aggregateFromAttributes(activity) {
  const attrs = activity.attributes || {};
  return {
    inputs: dedupePreserveOrder(Array.isArray(attrs.inputs) ? attrs.inputs : []),
    outputs: dedupePreserveOrder(Array.isArray(attrs.outputs) ? attrs.outputs : []),
    completion_criteria: dedupePreserveOrder(Array.isArray(attrs.completion_criteria) ? attrs.completion_criteria : []),
    tools: dedupePreserveOrder(Array.isArray(attrs.tools) ? attrs.tools : []),
    references: dedupePreserveOrder(Array.isArray(attrs.references) ? attrs.references : []),
    sla: attrs.sla !== undefined ? attrs.sla : null,
    roleName: typeof attrs.role === 'string' && attrs.role ? attrs.role : null,
    roleFromSibling: false,
  };
}

/**
 * M1：收集流程级 INPUT/OUTPUT。
 *
 * 流程级 = subject_key 不归属任何活动的 INPUT/OUTPUT 事实；归属活动 subject_key 的
 * INPUT/OUTPUT 是活动级（已由 buildActivityAggregates 聚合到活动），不计入流程卡片。
 * 按首次出现顺序去重，字节稳定。
 */
function collectProcessLevelIO(normalFacts, activitySubjectSet) {
  const inputs = [];
  const outputs = [];
  for (const fact of normalFacts) {
    const isActivityLevel = fact.subject_key != null && activitySubjectSet.has(fact.subject_key);
    if (isActivityLevel) continue;
    if (fact.kind === 'INPUT') pushUnique(inputs, fact.label);
    else if (fact.kind === 'OUTPUT') pushUnique(outputs, fact.label);
  }
  return { processInputs: inputs, processOutputs: outputs };
}

/**
 * 计算末端组织候选
 *
 * 从 ORG_UNIT 事实中构建 parent 图，返回没有子组织的叶子节点。
 * 多候选或层级缺失时不选定并产生流程级问题。
 */
function computeTerminalOrgCandidates(orgUnits) {
  if (orgUnits.length === 0) return [];

  // 构建 parent 关系图
  const orgMap = new Map();
  const children = new Map();

  for (const org of orgUnits) {
    const name = org.label;
    const parentId = org.attributes?.parent || null;
    orgMap.set(name, { name, parentId });
    if (!children.has(name)) children.set(name, []);
    if (parentId) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(name);
    }
  }

  // 叶子节点 = 没有子节点的组织
  const leaves = [];
  for (const [name] of orgMap) {
    const kids = children.get(name) || [];
    if (kids.length === 0) {
      leaves.push(name);
    }
  }

  return [...new Set(leaves)];
}

/**
 * 创建泳道
 * 只从已有角色事实创建泳道；不静默添加默认泳道
 * 当有活动使用 Lane-unassigned 时，自动创建占位泳道
 */
function createLanes(roles) {
  const lanes = [];
  const seen = new Set();

  // 从角色创建泳道（规范化名称去重，跨片段同角色只建一条 lane）
  for (const role of roles) {
    const name = role.label;
    const norm = normalizeLaneName(name);
    if (!seen.has(norm)) {
      seen.add(norm);
      lanes.push({
        lane_id: `Lane-${stableHash(name).slice(0, 8)}`,
        name,
        org_candidates: [],
      });
    }
  }

  // 没有角色时不创建默认泳道；会在 convertActivitiesToElements 中生成问题
  return lanes;
}

/**
 * 将活动转换为元素（M2）。
 *
 * 泳道分配优先使用按 subject_key 聚合的结构化 ROLE 事实，其次兼容 attributes.role；
 * 有显式角色时不生成「缺少责任角色」问题、不静默塞入第一泳道。活动的 inputs/outputs/
 * completion_criteria/sla/tools/references 取自 subject_key 聚合结果（merge 后不为空）。
 * completeness 与真实字段状态一致（CONFLICT/INFERRED/有待确认问题 → 非 COMPLETE）。
 */
function convertActivitiesToElements(activities, lanes, aggregates, subjectsWithQuestions) {
  const elements = [];
  const questions = [];

  for (const activity of activities) {
    // 有 subject_key 的活动取聚合结果；无 subject_key（无法关联兄弟事实）时回退到其自身
    // attributes，保持与历史行为一致（直接读取 attributes.role/inputs/outputs 等）。
    const agg = (activity.subject_key != null && aggregates.get(activity.subject_key))
      || aggregateFromAttributes(activity);

    // M2：优先结构化 ROLE 事实（已聚合到 agg.roleName），兼容 attributes.role。
    const roleName = agg.roleName;
    let laneId = null;

    if (roleName) {
      const lane = lanes.find(l => l.name === roleName);
      if (lane) {
        laneId = lane.lane_id;
      }
    }

    const stableId = stableHash(activity.fact_id).slice(0, 8);

    // 角色缺失：不静默塞入第一泳道，生成问题
    if (!laneId && lanes.length > 0) {
      questions.push({
        question_id: `Q-role-${stableId}`,
        text: `活动「${activity.label}」缺少责任角色，请指定`,
        element_ids: [`Task-${stableId}`],
        status: 'OPEN',
        answer: '',
        evidence_refs: activity.evidence_refs,
      });
      // 使用第一个泳道作为占位，但问题已标记
      laneId = lanes[0].lane_id;
    }

    // 没有任何泳道时也生成问题
    if (!laneId) {
      laneId = 'Lane-unassigned';
      questions.push({
        question_id: `Q-nolane-${stableId}`,
        text: `活动「${activity.label}」无法分配泳道，缺少角色信息`,
        element_ids: [`Task-${stableId}`],
        status: 'OPEN',
        answer: '',
        evidence_refs: activity.evidence_refs,
      });
    }

    // completeness 与真实字段状态一致
    const certainty = activity.certainty || 'EXPLICIT';
    let completeness = 'COMPLETE';
    if (certainty === 'CONFLICT') {
      completeness = 'CONFLICTED';
    } else if (certainty === 'INFERRED' || subjectsWithQuestions.has(activity.subject_key)) {
      completeness = 'NEEDS_CONFIRMATION';
    }

    elements.push({
      element_id: `Activity-${stableId}`,
      fact_id: activity.fact_id,
      subject_key: activity.subject_key,
      kind: 'ACTIVITY',
      name: activity.label,
      lane_id: laneId,
      inputs: agg.inputs,
      outputs: agg.outputs,
      completion_criteria: agg.completion_criteria,
      tools: agg.tools,
      references: agg.references,
      sla: agg.sla,
      evidence_refs: activity.evidence_refs,
      certainty,
      completeness,
      question_ids: [],
    });
  }

  return { elements, questions };
}

/**
 * M3：在来源片段内解析 uncertainty.related_fact_ids 为 subject_key 集合。
 *
 * 仅在该 uncertainty 所属 fragment 的 fact_id → subject_key 映射内解析，避免不同 fragment
 * 的同名局部 fact_id（如两处 F-005）跨片段串联到错误元素。
 */
function resolveUncertaintySubjects(entry, fragmentFactMaps) {
  const localMap = fragmentFactMaps[entry.fragIdx] || new Map();
  const subjects = new Set();
  for (const factId of entry.u.related_fact_ids || []) {
    const info = localMap.get(factId);
    if (info && info.subject_key != null) subjects.add(info.subject_key);
  }
  return subjects;
}

/**
 * M3：解析 uncertainty 的目标图节点（target_paths）。
 *
 * 来源片段内 fact_id → subject_key → 活动节点（Task-id）。仅锚定到【活动】 subject_key
 * （activitySubjectSet），因为问题清单的 target_paths 约定指向活动主 Task 或 process 哨兵
 * （会议包复读与 question-target 门禁）；关联到流程级/起止事件/网关等非活动 subject 的
 * uncertainty 回退到 defaultTarget（首活动节点或 process），与历史行为一致。target_paths 去重
 * 并稳定排序，保证引用存在的图元素且不重复。
 */
function resolveUncertaintyAnchor(entry, fragmentFactMaps, subjectToNodeId, activitySubjectSet, defaultTarget) {
  const nodeIds = new Set();
  for (const sk of resolveUncertaintySubjects(entry, fragmentFactMaps)) {
    if (!activitySubjectSet.has(sk)) continue; // 仅锚定活动节点
    const nodeId = subjectToNodeId.get(sk);
    if (nodeId) nodeIds.add(nodeId);
  }
  const elementIds = nodeIds.size > 0 ? [...nodeIds].sort() : [defaultTarget];
  return { u: entry.u, elementIds };
}

/**
 * 生成问题（M3：源片段内锚定 + 确定性语义去重）。
 *
 * 去重两层：
 *  1. 精确去重：目标路径 + 问题类型 + 规范化文本相同者保留首个；
 *  2. 业务主题语义去重：若一个问题的业务主题集合被若干更原子的问题（主题集合为其真子集）
 *     完全覆盖，则丢弃该组合重复问题（审批阈值/币种口径各形成一个清晰问题）。
 * 不同业务主题不会误合并（主题按事实型后缀确定性抽取）。
 */
function generateQuestions(uncertaintyAnchors, conflictFacts, context) {
  const questions = [];

  // 1) 精确去重
  const seen = new Set();
  const items = [];
  for (const anchor of uncertaintyAnchors) {
    const u = anchor.u;
    const kind = u.kind || 'NEEDS_CONTEXT';
    const norm = normalizeSemantics(u.text);
    const dedupKey = `${anchor.elementIds.join(',')}|${kind}|${norm}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    items.push({ u, elementIds: anchor.elementIds, kind, dedupKey, topics: extractTopics(u.text) });
  }

  // 2) 业务主题语义去重（组合重复问题被原子问题完全覆盖时丢弃）
  const dropped = computeCoverageDrops(items);

  for (let i = 0; i < items.length; i++) {
    if (dropped.has(i)) continue;
    const it = items[i];
    questions.push({
      question_id: `Q-${stableHash(it.dedupKey).slice(0, 8)}`,
      text: it.u.text,
      element_ids: it.elementIds,
      status: 'OPEN',
      answer: '',
      evidence_refs: it.u.evidence_refs,
    });
  }

  // 从冲突生成问题
  for (const conflict of conflictFacts) {
    questions.push({
      question_id: `Q-${stableHash(conflict.label).slice(0, 8)}`,
      text: `冲突: ${conflict.label}`,
      element_ids: [context.defaultTarget],
      status: 'OPEN',
      answer: '',
      evidence_refs: conflict.evidence_refs,
    });
  }

  // 组织边界问题
  if (context.terminalOrgCandidates.length > 1) {
    questions.push({
      question_id: 'Q-org-boundary',
      text: `请确认流程的组织边界，候选: ${context.terminalOrgCandidates.join(', ')}`,
      element_ids: ['process'],
      status: 'OPEN',
      answer: '',
      evidence_refs: [],
    });
  }

  return questions;
}

/**
 * M3：确定性业务主题语义去重。
 *
 * 若条目 i 的业务主题集合 Ti 非空，且存在若干其它条目其主题集合均为 Ti 的真子集、
 * 且这些真子集主题的并集覆盖 Ti 的全部主题，则 i 是「组合重复问题」，丢弃之。
 * 原子问题（单主题）不会被丢弃；不同业务主题（不同事实型短语）不会误合并。
 *
 * @returns {Set<number>} 需丢弃的条目下标集合
 */
function computeCoverageDrops(items) {
  const dropped = new Set();
  for (let i = 0; i < items.length; i++) {
    const ti = items[i].topics;
    if (ti.size === 0) continue;
    const union = new Set();
    let coverers = 0;
    for (let j = 0; j < items.length; j++) {
      if (j === i) continue;
      const tj = items[j].topics;
      if (tj.size === 0) continue;
      if (isProperSubset(tj, ti)) {
        for (const t of tj) union.add(t);
        coverers += 1;
      }
    }
    if (coverers > 0 && [...ti].every(t => union.has(t))) {
      dropped.add(i);
    }
  }
  return dropped;
}

/** A 是否为 B 的真子集（A ⊊ B）。 */
function isProperSubset(a, b) {
  if (a.size >= b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

/**
 * M3：从 uncertainty 文本确定性抽取业务主题短语。
 *
 * 业务事实主题以事实型后缀（阈值/口径/标准/规则/依据/周期/粒度/范围/边界）结尾；
 * 向左取连续 CJK 修饰成分，遇到连接词/助词/标点（与、和、及、或、的、地、得、标点等）
 * 或非 CJK 字符即停止，最多 8 个修饰字符。这样「成本预测的审批阈值」与「审批阈值与币种口径」
 * 中的审批阈值都抽取为「审批阈值」，币种口径都抽取为「币种口径」，跨组合/原子问题保持一致。
 *
 * @returns {Set<string>} 业务主题短语集合
 */
function extractTopics(text) {
  const s = String(text ?? '');
  const topics = new Set();
  for (const suffix of TOPIC_SUFFIXES) {
    let idx = s.indexOf(suffix);
    while (idx !== -1) {
      let start = idx;
      let count = 0;
      while (start > 0 && count < 8) {
        const ch = s[start - 1];
        if (TOPIC_DELIMITERS.has(ch) || !isCjk(ch)) break;
        start -= 1;
        count += 1;
      }
      topics.add(s.slice(start, idx + suffix.length));
      idx = s.indexOf(suffix, idx + suffix.length);
    }
  }
  return topics;
}

/** 业务主题事实型后缀（确定性词表）。 */
const TOPIC_SUFFIXES = ['阈值', '口径', '标准', '规则', '依据', '周期', '粒度', '范围', '边界'];

/** 业务主题向左抽取的分隔符（连接词/助词/标点/空白）。 */
const TOPIC_DELIMITERS = new Set(
  '与和及或等的地得，。、；：？！「」“”‘’《》（）()<>[]{}· \t\r\n,.:;?!/'.split('')
);

function isCjk(ch) {
  // CJK 统一汉字及扩展 A / 兼容区（U+3400–U+4DBF、U+4E00–U+9FFF、U+F900–U+FAFF）。
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
}

/**
 * E1：从文本抽取显式流程编号引用（如 CM-2 / CM-1.4 / PR-1）。
 *
 * 仅匹配 2~4 个大写字母前缀 + 连字符 + 数字（可含 .数字 或 -数字 末级），
 * 避免误匹配证据块 ID（如 B-001）等单字母前缀的内部编号。
 */
function extractProcessCodeRefs(text) {
  const s = String(text ?? '');
  const re = /\b[A-Z]{2,4}-\d+(?:[.-]\d+)?\b/g;
  return [...new Set(s.match(re) || [])];
}

/**
 * 查找流程开始边界
 */
function findBoundaryStart(elements, facts) {
  const startFact = facts.find(f => f.kind === 'START_EVENT')
    || facts.find(f => f.kind === 'EVENT' && f.attributes?.type === 'start');
  if (startFact) return startFact.label;

  if (elements.length > 0) return elements[0].name;
  return '开始';
}

/**
 * 查找流程结束边界（支持多个终点）
 */
function findBoundaryEnd(elements, facts) {
  const endFacts = facts.filter(f => f.kind === 'EVENT' && f.attributes?.type === 'end');
  if (endFacts.length > 0) {
    return endFacts[0].label; // 返回第一个作为默认，多个终点在 process_card.end_results 中处理
  }

  if (elements.length > 0) return elements[elements.length - 1].name;
  return '结束';
}

/**
 * 查找所有结束事件
 */
function findAllEndEvents(facts) {
  return facts.filter(f => f.kind === 'END_EVENT')
    .concat(facts.filter(f => f.kind === 'EVENT' && f.attributes?.type === 'end'));
}

/**
 * 生成稳定哈希
 */
function stableHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * 机器流程键规范化。
 *
 * 显示编号与机器键分离：人类可读编号（如 CM-1.4）含点号，不能直接作为稳定机器键
 * （process_id 的 Schema pattern 不允许点号）。机器键确定性地把点号替换为连字符并去首尾空白，
 * 使 CM-1.4 与 CM-1-4 归一为同一键 CM-1-4，不要求模型自行猜测格式。
 * 保持大小写不变，避免改动既有键（如 procurement-request）的稳定 ID。
 *
 * @param {string} raw - 原始流程键。
 * @returns {string} 机器键；空输入返回 'default'。
 */
export function machineProcessKey(raw) {
  const text = String(raw ?? '').trim();
  if (text.length === 0) return 'default';
  return text.replace(/\./g, '-');
}

/**
 * 保留人类可读的显示编号（如 CM-1.4），用于写回 attributes.code。
 * @param {string} raw
 * @returns {string|null}
 */
export function displayProcessCode(raw) {
  const text = String(raw ?? '').trim();
  return text.length > 0 ? text : null;
}

/**
 * 规范化语义文本用于去重：去首尾空白并折叠内部空白。
 */
function normalizeSemantics(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 规范化泳道名称用于去重：移除全部空白。
 */
function normalizeLaneName(name) {
  return String(name ?? '').replace(/\s+/g, '').trim();
}

/**
 * 规范化结束事件 label 用于跨片段对齐：移除「（结束）」后缀并去空白。
 */
function normalizeEndLabel(label) {
  return String(label ?? '').replace(/（结束）$/g, '').replace(/\(结束\)$/g, '').trim();
}

/** 数组去重（保持首次出现顺序，确定性）。 */
function dedupePreserveOrder(arr) {
  const out = [];
  for (const item of arr) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** 向数组追加唯一值（保持顺序）。 */
function pushUnique(arr, value) {
  if (value == null) return;
  if (!arr.includes(value)) arr.push(value);
}

/**
 * 解析 SLA 文本为结构化对象（与语义对齐层同口径）。
 * @returns {{value: number, unit: string, raw_text: string} | null}
 */
function parseSla(text) {
  if (!text) return null;
  const patterns = [
    { regex: /(\d+)\s*个?\s*工作日/, unit: 'WORKING_DAY' },
    { regex: /(\d+)\s*个?\s*天/, unit: 'CALENDAR_DAY' },
    { regex: /(\d+)\s*个?\s*小时/, unit: 'HOUR' },
    { regex: /(\d+)\s*个?\s*分钟/, unit: 'MINUTE' },
    { regex: /(\d+)\s*个?\s*周/, unit: 'WEEK' },
    { regex: /(\d+)\s*个?\s*月/, unit: 'MONTH' },
  ];
  for (const { regex, unit } of patterns) {
    const match = String(text).match(regex);
    if (match) {
      return { value: parseInt(match[1], 10), unit, raw_text: String(text) };
    }
  }
  return null;
}

/**
 * 解析流程卡片字段（name / owner / purpose）的真实性。
 *
 * - 优先选取焦点流程的明确（EXPLICIT）事实；
 * - 推断（非 EXPLICIT）事实仍取其值，但产生 OPEN 问题与 provenance；
 * - 真正缺失时值为 null，并产生 OPEN 问题（界面可显示「待确认」，但绝不回写占位字符串）。
 *
 * @returns {{value: string|null, provenance: object|null, question: object|null}}
 */
function resolveCardField(facts, kind, fieldKey, fieldLabel, processKey) {
  const candidates = facts.filter(f => f.kind === kind);
  const explicit = candidates.find(f => (f.certainty || 'EXPLICIT') === 'EXPLICIT');
  const chosen = explicit || candidates[0] || null;

  if (!chosen) {
    return {
      value: null,
      provenance: { certainty: 'MISSING', evidence_refs: [] },
      question: {
        question_id: `Q-card-${fieldKey}`,
        text: `焦点流程 ${processKey} 的${fieldLabel}缺失，请确认`,
        element_ids: ['process'],
        status: 'OPEN',
        answer: '',
        evidence_refs: [],
      },
    };
  }

  const certainty = chosen.certainty || 'EXPLICIT';
  const evidenceRefs = (chosen.evidence_refs || []).filter(r => /^B-[A-Za-z0-9_-]+$/.test(r));
  const provenance = { certainty, evidence_refs: evidenceRefs };
  const question = certainty === 'EXPLICIT' ? null : {
    question_id: `Q-card-${fieldKey}`,
    text: `焦点流程 ${processKey} 的${fieldLabel}为推断值「${chosen.label}」，请确认`,
    element_ids: ['process'],
    status: 'OPEN',
    answer: '',
    evidence_refs: evidenceRefs,
  };

  return { value: chosen.label, provenance, question };
}

/**
 * M1 + M4：解析流程层级（level）的真实性与 is_leaf 派生。
 *
 * - 仅接受合法层级值（L1~L5）；优先 EXPLICIT；
 * - 合法但推断（INFERRED）→ 取值并产生 OPEN 问题与 provenance；
 * - 缺失或值非法（如占位文本「流程层级」）→ 不再静默：产生 OPEN 层级待确认问题，
 *   记 MISSING provenance，level 保留 L4 作为未确认工作值（Schema 闭集要求，不放宽）。
 * - is_leaf 由层级派生，取代硬编码 true：
 *   · EXPLICIT/INFERRED L4·L5 → true（合法末端）；
 *   · EXPLICIT/INFERRED L1·L2·L3 → false（非末端）；
 *   · 缺失/非法 → false（诚实表达未确认末端）。
 *
 * @returns {{value: string, provenance: object|null, isLeaf: boolean, question: object|null}}
 */
function resolveProcessLevel(facts, processKey) {
  const allLevelFacts = facts.filter(f => f.kind === 'PROCESS_LEVEL');
  const candidates = allLevelFacts.filter(f => VALID_LEVELS.has(f.label));
  const explicit = candidates.find(f => (f.certainty || 'EXPLICIT') === 'EXPLICIT');
  const chosen = explicit || candidates[0] || null;

  if (!chosen) {
    // M4：缺失或全部非法 → 产生 OPEN 问题（不再静默回退），evidence_refs 取可得证据
    const availableEvidence = [...new Set(
      allLevelFacts.flatMap(f => (f.evidence_refs || []).filter(r => /^B-[A-Za-z0-9_-]+$/.test(r)))
    )];
    return {
      value: 'L4',
      provenance: { certainty: 'MISSING', evidence_refs: [] },
      isLeaf: false,
      question: {
        question_id: 'Q-card-level',
        text: `焦点流程 ${processKey} 的流程层级缺失，请确认`,
        element_ids: ['process'],
        status: 'OPEN',
        answer: '',
        evidence_refs: availableEvidence,
      },
    };
  }

  const certainty = chosen.certainty || 'EXPLICIT';
  const evidenceRefs = (chosen.evidence_refs || []).filter(r => /^B-[A-Za-z0-9_-]+$/.test(r));
  const provenance = { certainty, evidence_refs: evidenceRefs };
  // M4：is_leaf 由合法层级值派生（L4/L5 → true，L1-L3 → false）
  const isLeaf = chosen.label === 'L4' || chosen.label === 'L5';
  const question = certainty === 'EXPLICIT' ? null : {
    question_id: 'Q-card-level',
    text: `焦点流程 ${processKey} 的流程层级为推断值「${chosen.label}」，请确认`,
    element_ids: ['process'],
    status: 'OPEN',
    answer: '',
    evidence_refs: evidenceRefs,
  };

  return { value: chosen.label, provenance, isLeaf, question };
}

/**
 * 汇总卡片字段的 provenance（name / level 仅在非 EXPLICIT 时记录；owner / purpose 恒记录）。
 * 输出值仅含 certainty 与 evidence_refs，符合 meeting-package-payload Schema。
 */
function buildCardProvenance(nameField, levelField, ownerField, purposeField) {
  const provenance = {};
  if (nameField.provenance && nameField.provenance.certainty !== 'EXPLICIT') {
    provenance['/process_card/name'] = nameField.provenance;
  }
  if (levelField.provenance && levelField.provenance.certainty !== 'EXPLICIT') {
    provenance['/process_card/level'] = levelField.provenance;
  }
  if (ownerField.provenance) provenance['/process_card/owner'] = ownerField.provenance;
  if (purposeField.provenance) provenance['/process_card/purpose'] = purposeField.provenance;
  return provenance;
}

/**
 * 判定一个 uncertainty 是否与焦点流程相关（保留来源片段上下文）。
 *
 * 规则（保守保留，避免误删焦点问题）：
 * - related_fact_ids 非空：仅在来源 fragment 内解析；
 *   · 全部无法解析 → 保留（不丢弃来源不明者）；
 *   · 只要有一个解析到焦点 process_key → 保留；
 *   · 其余（可解析但均非焦点）→ 判为非焦点，转入审计输出。
 * - related_fact_ids 为空：视为流程级；若文本显式引用非焦点流程编号（E1）→ 非焦点；否则保留。
 */
function isFocusRelevant(entry, targetProcessKey, fragmentFactMaps) {
  const u = entry.u;
  const related = u.related_fact_ids || [];
  if (related.length > 0) {
    const localMap = fragmentFactMaps[entry.fragIdx] || new Map();
    const keys = related
      .map(id => localMap.get(id)?.processKey)
      .filter(k => k !== undefined);
    if (keys.length === 0) return true;
    return keys.some(k => k === targetProcessKey);
  }
  // empty-related：检测文本是否显式引用非焦点流程编号。
  const refs = extractProcessCodeRefs(u.text);
  if (refs.length > 0) {
    return refs.some(code => machineProcessKey(code) === targetProcessKey);
  }
  return true;
}

/**
 * 跨片段确定性对齐结束事件：按规范化 label 合并同语义终点为唯一结束事件，
 * 保留首个出现者并合并 evidence_refs。不同 label 的多个业务终点保持并列。
 */
function alignEndEvents(endEvents) {
  const byLabel = new Map();
  const ordered = [];
  for (const ev of endEvents) {
    const key = normalizeEndLabel(ev.label);
    const existing = byLabel.get(key);
    if (!existing) {
      const primary = { ...ev, evidence_refs: [...(ev.evidence_refs || [])] };
      byLabel.set(key, primary);
      ordered.push(primary);
    } else {
      for (const ref of ev.evidence_refs || []) {
        if (!existing.evidence_refs.includes(ref)) existing.evidence_refs.push(ref);
      }
    }
  }
  return ordered;
}
