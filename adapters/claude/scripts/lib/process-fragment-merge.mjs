/**
 * 流程片段合并库
 *
 * 将多个语义片段合并为一个规范化的流程草稿。
 * 处理事实去重、冲突保留、问题生成和泳道分配。
 */

import { createHash } from 'node:crypto';
import { verifyFragmentIntegrity } from './fragment-integrity.mjs';

/**
 * 合并流程片段
 *
 * @param {object} params
 * @param {object} params.manifest - 输入清单
 * @param {object} params.evidence - 证据索引
 * @param {object[]} params.fragments - 语义片段数组
 * @param {string|null} params.focus - 流程焦点
 * @param {string} [params.runDir] - 运行目录（可选，用于完整性验证）
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

  // 1. 收集所有事实（支持 V1 和 V2 格式）
  const allFacts = [];
  const allUncertainties = [];
  const fragmentRefs = [];

  for (const fragment of fragments) {
    // V2 格式：task_kind + payload
    if (fragment.task_kind && fragment.payload) {
      allFacts.push(...(fragment.payload.facts || []));
      allUncertainties.push(...(fragment.payload.uncertainties || []));
    } else {
      // V1 格式：直接 facts 和 uncertainties
      allFacts.push(...(fragment.facts || []));
      allUncertainties.push(...(fragment.uncertainties || []));
    }
    fragmentRefs.push({
      batch_id: fragment.batch_id,
      batch_sha256: fragment.batch_sha256,
    });
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

  // 选择目标流程
  const targetProcessKey = focus || processKeys[0] || 'default';
  const targetFacts = processGroups[targetProcessKey] || allFacts;

  // 4. 去重事实
  const dedupedFacts = deduplicateFacts(targetFacts);

  // 5. 分离冲突事实
  const { normalFacts, conflictFacts } = separateConflicts(dedupedFacts);

  // 6. 收集组织和角色
  const orgUnits = normalFacts.filter(f => f.kind === 'ORG_UNIT');
  const roles = normalFacts.filter(f => f.kind === 'ROLE');

  // 7. 计算末端组织候选
  const terminalOrgCandidates = computeTerminalOrgCandidates(orgUnits);
  const selectedOrgId = terminalOrgCandidates.length === 1 ? terminalOrgCandidates[0] : null;

  // 8. 创建泳道
  const lanes = createLanes(roles, orgUnits);

  // 9. 转换活动为元素
  const { elements, questions: activityQuestions } = convertActivitiesToElements(
    normalFacts.filter(f => f.kind === 'ACTIVITY'),
    lanes,
    allUncertainties
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

  // 10. 生成流转
  const flows = generateFlows(normalFacts, elements);

  // 11. 生成问题（合并活动级问题）
  const questions = [
    ...activityQuestions,
    ...generateQuestions(allUncertainties, elements, conflictFacts, {
      selectedOrgId,
      terminalOrgCandidates,
      targetProcessKey,
    }),
  ];

  // 12. 生成冲突记录
  const conflicts = conflictFacts.map(f => ({
    conflict_id: `C-${stableHash(f.fact_id).slice(0, 8)}`,
    description: `冲突: ${f.label}`,
    fact_ids: [f.fact_id],
    evidence_refs: f.evidence_refs,
  }));

  // 13. 构建 V2 流程草稿
  const endEvents = findAllEndEvents(normalFacts);

  // 预计算 process_card（供 diagram.nodes 引用 start/end IDs）
  const startEventId = `Start-${stableHash('start').slice(0, 8)}`;
  const startEventName = findBoundaryStart(elements, normalFacts);
  const endResults = endEvents.length > 0 ? endEvents.map(event => ({
    event_id: `End-${stableHash(event.fact_id).slice(0, 8)}`,
    name: event.label,
  })) : [{
    event_id: `End-${stableHash('end').slice(0, 8)}`,
    name: findBoundaryEnd(elements, normalFacts),
  }];

  // 计算首尾活动的 task_id（用于生成 start/end 流转）
  const firstTaskId = elements.length > 0 ? `Task-${stableHash(elements[0].fact_id || elements[0].element_id).slice(0, 8)}` : null;
  const lastTaskId = elements.length > 0 ? `Task-${stableHash(elements[elements.length - 1].fact_id || elements[elements.length - 1].element_id).slice(0, 8)}` : null;

  const processCardRef = {
    start: { event_id: startEventId, name: startEventName, event_type: 'NONE' },
    end_results: endResults,
  };

  const processDraft = {
    schema_version: '2.0.0',
    process_card: {
      process_id: targetProcessKey,
      name: manifest.title,
      level: 'L4',
      is_leaf: true,
      description: manifest.title,
      purpose: '自动生成',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: processCardRef.start,
      end_results: processCardRef.end_results,
      performance_indicators: [],
    },
    activities: elements.map(element => {
      // 从原始事实中查找活动属性（通过 name 匹配）
      const originalFact = normalFacts.find(f => f.kind === 'ACTIVITY' && f.label === element.name);
      const activityType = originalFact?.attributes?.activity_type || 'STANDARD';
      const responsibilityModel = originalFact?.attributes?.responsibility_model || 'RASCI';
      const roleAssignments = originalFact?.attributes?.role_assignments || [];

      // 生成稳定的活动ID和主任务ID（使用相同的哈希）
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
        sla: originalFact?.attributes?.sla || null,
        tools: originalFact?.attributes?.tools || [],
        inputs: element.inputs || [],
        process_summary: originalFact?.attributes?.process_summary || '',
        outputs: element.outputs || [],
        completion_criteria: originalFact?.attributes?.completion_criteria || [],
        references: originalFact?.attributes?.references || [],
        main_task_id: mainTaskId,
        confirmation: originalFact?.attributes?.confirmation || null,
        completeness: 'COMPLETE',
      };
    }),
    diagram: {
      lanes: lanes.map(lane => ({
        lane_id: lane.lane_id,
        name: lane.name,
        role_id: lane.lane_id,
      })),
      nodes: [
        // 开始事件节点
        {
          node_id: processCardRef.start.event_id,
          node_type: 'START_EVENT',
          name: processCardRef.start.name,
          lane_id: null,
        },
        // 活动主任务节点
        ...elements.map(element => {
          const stableId = stableHash(element.fact_id || element.element_id).slice(0, 8);
          return {
            node_id: `Task-${stableId}`,
            node_type: 'MAIN_TASK',
            name: element.name,
            lane_id: element.lane_id,
          };
        }),
        // 结束事件节点
        ...processCardRef.end_results.map(endEvent => ({
          node_id: endEvent.event_id,
          node_type: 'END_EVENT',
          name: endEvent.name,
          lane_id: null,
        })),
      ],
      flows: [
        // 开始事件到第一个活动的流转
        ...firstTaskId ? [{
          flow_id: `Flow-Start-${stableHash('start-flow').slice(0, 8)}`,
          source_ref: processCardRef.start.event_id,
          target_ref: firstTaskId,
          condition: null,
        }] : [],
        // 活动间的流转
        ...flows.map(flow => ({
          flow_id: flow.flow_id,
          source_ref: flow.source_ref,
          target_ref: flow.target_ref,
          condition: flow.condition,
        })),
        // 最后一个活动到结束事件的流转
        ...lastTaskId ? [{
          flow_id: `Flow-End-${stableHash('end-flow').slice(0, 8)}`,
          source_ref: lastTaskId,
          target_ref: processCardRef.end_results[0].event_id,
          condition: null,
        }] : [],
      ],
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
    provenance: {},
    source_summary: {
      total_blocks: evidence.blocks?.length || 0,
      formats: [...new Set((evidence.blocks || []).map(b => b.source_format))],
      evidence_refs: [...new Set(allFacts.flatMap(f => f.evidence_refs))],
    },
  };

  // 14. 生成合并报告
  const mergeReport = {
    total_fragments: fragments.length,
    total_facts: allFacts.length,
    deduped_facts: dedupedFacts.length,
    conflict_facts: conflictFacts.length,
    questions_generated: questions.length,
    terminal_org_candidates: terminalOrgCandidates,
    selected_org_id: selectedOrgId,
    fragment_refs: fragmentRefs,
  };

  return { process_draft: processDraft, merge_report: mergeReport };
}

/**
 * 按 process_key 分组
 */
function groupByProcessKey(facts) {
  const groups = {};
  for (const fact of facts) {
    const key = fact.process_key || 'default';
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(fact);
  }
  return groups;
}

/**
 * 去重事实
 * 基于 kind + process_key + subject_key + 关键属性
 */
function deduplicateFacts(facts) {
  const seen = new Map();

  for (const fact of facts) {
    const key = `${fact.kind}:${fact.process_key}:${fact.subject_key}:${fact.label}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, { ...fact, evidence_refs: [...fact.evidence_refs] });
    } else {
      // 合并证据引用
      for (const ref of fact.evidence_refs) {
        if (!existing.evidence_refs.includes(ref)) {
          existing.evidence_refs.push(ref);
        }
      }
    }
  }

  return Array.from(seen.values());
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
  for (const [name, org] of orgMap) {
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
function createLanes(roles, orgUnits) {
  const lanes = [];
  const seen = new Set();

  // 从角色创建泳道
  for (const role of roles) {
    const name = role.label;
    if (!seen.has(name)) {
      seen.add(name);
      lanes.push({
        lane_id: `Lane-${stableHash(name).slice(0, 8)}`,
        name,
        org_candidates: [],
      });
    }
  }

  // 没有角色时不创建默认泳道；会在 convertActivitiesToElements 中生成问题
  // 注意：如果后续有活动使用 Lane-unassigned，需要在 convertActivitiesToElements 后添加
  return lanes;
}

/**
 * 将活动转换为元素
 * 责任角色缺失时不静默塞入第一泳道，而是生成 OPEN 问题
 */
function convertActivitiesToElements(activities, lanes, uncertainties) {
  const elements = [];
  const questions = [];

  for (const activity of activities) {
    // 根据 role 属性分配泳道
    const roleName = activity.attributes?.role;
    let laneId = null;

    if (roleName) {
      const lane = lanes.find(l => l.name === roleName);
      if (lane) {
        laneId = lane.lane_id;
      }
    }

    // 角色缺失：不静默塞入第一泳道，生成问题
    if (!laneId && lanes.length > 0) {
      const stableId = stableHash(activity.fact_id).slice(0, 8);
      const questionId = `Q-role-${stableId}`;
      questions.push({
        question_id: questionId,
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
      const stableId = stableHash(activity.fact_id).slice(0, 8);
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

    // 提取输入输出
    const inputs = activity.attributes?.inputs || [];
    const outputs = activity.attributes?.outputs || [];

    // 关联问题
    const relatedQuestions = [];
    for (const uncertainty of uncertainties) {
      if (uncertainty.related_fact_ids.includes(activity.fact_id)) {
        relatedQuestions.push(`Q-${stableHash(uncertainty.text).slice(0, 8)}`);
      }
    }

    elements.push({
      element_id: `Activity-${stableHash(activity.fact_id).slice(0, 8)}`,
      fact_id: activity.fact_id,
      kind: 'ACTIVITY',
      name: activity.label,
      lane_id: laneId,
      inputs,
      outputs,
      evidence_refs: activity.evidence_refs,
      certainty: activity.certainty,
      question_ids: relatedQuestions,
    });
  }

  return { elements, questions };
}

/**
 * 生成流转
 */
function generateFlows(facts, elements) {
  const flows = [];
  const flowFacts = facts.filter(f => f.kind === 'FLOW' || f.kind === 'CONTROL_FLOW');

  for (const flowFact of flowFacts) {
    const source = flowFact.attributes?.source;
    const target = flowFact.attributes?.target;

    if (source && target) {
      const sourceElement = elements.find(e => e.name === source);
      const targetElement = elements.find(e => e.name === target);

      if (sourceElement && targetElement) {
        // V2: 使用 Task-xxx 格式匹配 diagram.nodes
        const sourceId = `Task-${stableHash(sourceElement.fact_id || sourceElement.element_id).slice(0, 8)}`;
        const targetId = `Task-${stableHash(targetElement.fact_id || targetElement.element_id).slice(0, 8)}`;
        flows.push({
          flow_id: `Flow-${stableHash(`${source}-${target}`).slice(0, 8)}`,
          source_ref: sourceId,
          target_ref: targetId,
          condition: flowFact.attributes?.condition || null,
          evidence_refs: flowFact.evidence_refs,
        });
      }
    }
  }

  return flows;
}

/**
 * 生成问题
 */
function generateQuestions(uncertainties, elements, conflictFacts, context) {
  const questions = [];
  const seenTexts = new Set();

  // 从不确定性生成问题
  for (const uncertainty of uncertainties) {
    if (seenTexts.has(uncertainty.text)) continue;
    seenTexts.add(uncertainty.text);

    const relatedElements = [];
    for (const factId of uncertainty.related_fact_ids) {
      const element = elements.find(e =>
        e.evidence_refs.some(ref => ref) // 简单关联
      );
      if (element) {
        relatedElements.push(element.element_id);
      }
    }

    questions.push({
      question_id: `Q-${stableHash(uncertainty.text).slice(0, 8)}`,
      text: uncertainty.text,
      element_ids: relatedElements.length > 0 ? relatedElements : [elements[0]?.fact_id ? `Activity-${stableHash(elements[0].fact_id).slice(0, 8)}` : 'process'],
      status: 'OPEN',
      answer: '',
      evidence_refs: uncertainty.evidence_refs,
    });
  }

  // 从冲突生成问题
  for (const conflict of conflictFacts) {
    questions.push({
      question_id: `Q-${stableHash(conflict.label).slice(0, 8)}`,
      text: `冲突: ${conflict.label}`,
      element_ids: [elements[0]?.fact_id ? `Activity-${stableHash(elements[0].fact_id).slice(0, 8)}` : 'process'],
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
 * 查找流程开始边界
 */
function findBoundaryStart(elements, facts) {
  const startFact = facts.find(f => f.kind === 'EVENT' && f.attributes?.type === 'start');
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
  return facts.filter(f => f.kind === 'EVENT' && f.attributes?.type === 'end');
}

/**
 * 生成稳定哈希
 */
function stableHash(value) {
  return createHash('sha256').update(value).digest('hex');
}
