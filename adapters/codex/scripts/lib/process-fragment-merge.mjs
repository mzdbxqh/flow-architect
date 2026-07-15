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

  // 1. 收集所有事实
  const allFacts = [];
  const allUncertainties = [];
  const fragmentRefs = [];

  for (const fragment of fragments) {
    allFacts.push(...fragment.facts);
    allUncertainties.push(...fragment.uncertainties);
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

  // 13. 构建流程草稿
  const processDraft = {
    title: manifest.title,
    level: 'L5',
    process_id: targetProcessKey,
    boundary: {
      start: findBoundaryStart(elements, normalFacts),
      end: findBoundaryEnd(elements, normalFacts),
    },
    lanes,
    elements,
    flows,
    questions,
    conflicts,
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
      const questionId = `Q-role-${stableHash(activity.fact_id).slice(0, 8)}`;
      questions.push({
        question_id: questionId,
        text: `活动「${activity.label}」缺少责任角色，请指定`,
        element_ids: [`Activity-${stableHash(activity.fact_id).slice(0, 8)}`],
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
        question_id: `Q-nolane-${stableHash(activity.fact_id).slice(0, 8)}`,
        text: `活动「${activity.label}」无法分配泳道，缺少角色信息`,
        element_ids: [`Activity-${stableHash(activity.fact_id).slice(0, 8)}`],
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
  const flowFacts = facts.filter(f => f.kind === 'FLOW');

  for (const flowFact of flowFacts) {
    const source = flowFact.attributes?.source;
    const target = flowFact.attributes?.target;

    if (source && target) {
      const sourceElement = elements.find(e => e.name === source);
      const targetElement = elements.find(e => e.name === target);

      if (sourceElement && targetElement) {
        flows.push({
          flow_id: `Flow-${stableHash(`${source}-${target}`).slice(0, 8)}`,
          source_ref: sourceElement.element_id,
          target_ref: targetElement.element_id,
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
      element_ids: relatedElements.length > 0 ? relatedElements : [elements[0]?.element_id || 'process'],
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
      element_ids: [elements[0]?.element_id || 'process'],
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
 * 查找流程结束边界
 */
function findBoundaryEnd(elements, facts) {
  const endFact = facts.find(f => f.kind === 'EVENT' && f.attributes?.type === 'end');
  if (endFact) return endFact.label;

  if (elements.length > 0) return elements[elements.length - 1].name;
  return '结束';
}

/**
 * 生成稳定哈希
 */
function stableHash(value) {
  return createHash('sha256').update(value).digest('hex');
}
