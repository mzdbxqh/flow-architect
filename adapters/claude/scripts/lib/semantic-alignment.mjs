/**
 * 语义对齐层
 *
 * 将多个语义片段统一到一致的 process_key、subject_key 标识空间，
 * 聚合兄弟事实到 ACTIVITY，并标准化 END_EVENT。
 *
 * 输入：来自同一 batch 的语义片段数组
 * 输出：对齐后的片段数组（原始输入不变）
 */

/**
 * 对齐流程片段
 *
 * @param {object[]} fragments - 语义片段数组（PROCESS_CARD, ACTIVITY_CATALOG, CONTROL_FLOW）
 * @returns {object[]} 对齐后的片段数组（深拷贝）
 * @throws {Error} 若片段来自不同 batch
 */
export function alignFragments(fragments) {
  // 0. 验证 batch 一致性
  validateBatchConsistency(fragments);

  // 1. 深拷贝，不修改原始输入
  const aligned = fragments.map(f => JSON.parse(JSON.stringify(f)));

  // 2. 统一 process_key 到 PROCESS_CARD 的值
  const processKey = resolveProcessKey(aligned);
  normalizeProcessKeys(aligned, processKey);

  // 3. 建立 subject_key 映射（ACTIVITY 键 → CONTROL_FLOW 键 双向）
  const keyMapping = buildSubjectKeyMapping(aligned);

  // 4. 对齐 CONTROL_FLOW 的 FLOW source/target
  alignFlowEndpoints(aligned, keyMapping);

  // 5. 聚合兄弟事实到 ACTIVITY
  aggregateSiblingsToActivities(aligned);

  // 6. 通用结果别名：移除与 END_EVENT 同名且无业务承载的 ACTIVITY，evidence_refs 合入 END_EVENT
  mergeRejectReturnToEndEvent(aligned);

  // 7. 标准化 END_EVENT label 并合并 evidence_refs
  normalizeEndEvents(aligned);

  return aligned;
}

/**
 * 验证所有片段来自同一 batch
 */
function validateBatchConsistency(fragments) {
  if (fragments.length === 0) return;

  const firstBatchId = fragments[0].batch_id;
  const firstBatchSha256 = fragments[0].batch_sha256;

  for (let i = 1; i < fragments.length; i++) {
    const frag = fragments[i];
    if (frag.batch_id !== firstBatchId) {
      throw new Error(
        `Batch 不一致：片段 0 batch_id="${firstBatchId}"，片段 ${i} batch_id="${frag.batch_id}"。` +
        `禁止混入不同 batch 的片段。`
      );
    }
    if (frag.batch_sha256 !== firstBatchSha256) {
      throw new Error(
        `Batch 不一致：片段 0 batch_sha256="${firstBatchSha256}"，片段 ${i} batch_sha256="${frag.batch_sha256}"。` +
        `禁止混入不同 batch 的片段。`
      );
    }
  }
}

/**
 * 解析统一的 process_key（使用 PROCESS_CARD 的值）
 */
function resolveProcessKey(aligned) {
  const processCard = aligned.find(f => f.task_kind === 'PROCESS_CARD');
  if (!processCard) {
    throw new Error('缺少 PROCESS_CARD 片段');
  }

  // PROCESS_CARD 中找 PROCESS_NAME 的 process_key
  const processName = processCard.payload.facts.find(f => f.kind === 'PROCESS_NAME');
  return processName ? processName.process_key : processCard.payload.facts[0]?.process_key;
}

/**
 * 将所有事实的 process_key 统一到目标值
 */
function normalizeProcessKeys(aligned, targetKey) {
  for (const frag of aligned) {
    for (const fact of frag.payload.facts) {
      fact.process_key = targetKey;
    }
  }
}

/**
 * 建立 subject_key 映射：
 * - ACTIVITY 的结构化键（如 A-submit）
 * - CONTROL_FLOW 中使用的业务键（如 submit-purchase-request）
 *
 * 映射策略：通过 label 匹配
 */
function buildSubjectKeyMapping(aligned) {
  const mapping = new Map(); // businessKey -> structuredKey
  const reverseMapping = new Map(); // structuredKey -> businessKey

  // 收集 ACTIVITY 的 subject_key 和 label
  const activityFrag = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
  const activities = activityFrag?.payload.facts.filter(f => f.kind === 'ACTIVITY') || [];

  // 收集 CONTROL_FLOW 中 FLOW 使用的键
  const controlFlowFrag = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
  const flows = controlFlowFrag?.payload.facts.filter(f => f.kind === 'FLOW') || [];
  const startEvents = controlFlowFrag?.payload.facts.filter(f => f.kind === 'START_EVENT') || [];
  const endEvents = controlFlowFrag?.payload.facts.filter(f => f.kind === 'END_EVENT') || [];
  const gateways = controlFlowFrag?.payload.facts.filter(f => f.kind.startsWith('GATEWAY')) || [];

  // 收集所有 flow 端点中出现的键
  const flowEndpointKeys = new Set();
  for (const flow of flows) {
    flowEndpointKeys.add(flow.attributes.source_subject_key);
    flowEndpointKeys.add(flow.attributes.target_subject_key);
  }

  // 非 ACTIVITY 的键（start/end/gateway）直接映射到自己
  for (const ev of [...startEvents, ...endEvents, ...gateways]) {
    mapping.set(ev.subject_key, ev.subject_key);
    reverseMapping.set(ev.subject_key, ev.subject_key);
  }

  // ACTIVITY 的 label 到 business key 映射
  // 使用业务标签匹配
  const activityLabelMap = new Map();
  for (const act of activities) {
    activityLabelMap.set(act.label, act.subject_key);
  }

  // 收集 PROCESS_CARD 的 INPUT/OUTPUT facts 的 attributes.activity
  const processCardFrag = aligned.find(f => f.task_kind === 'PROCESS_CARD');
  const processFacts = processCardFrag?.payload.facts || [];
  const activityNameByKey = new Map(); // subject_key → attributes.activity

  for (const fact of processFacts) {
    if ((fact.kind === 'INPUT' || fact.kind === 'OUTPUT') && fact.attributes?.activity) {
      activityNameByKey.set(fact.subject_key, fact.attributes.activity);
    }
  }

  // flow 使用的业务键，尝试匹配到 ACTIVITY
  // 策略：通过 PROCESS_CARD 的 attributes.activity 与 ACTIVITY label 匹配
  for (const flowKey of flowEndpointKeys) {
    if (mapping.has(flowKey)) continue; // 已映射

    // 从 PROCESS_CARD 获取活动名称
    const activityName = activityNameByKey.get(flowKey);
    if (!activityName) continue;

    // 确定性规范化：移除空格，统一大小写
    const normalizedActivityName = activityName.replace(/\s+/g, '').toLowerCase();

    // 尝试匹配 ACTIVITY label
    for (const act of activities) {
      const normalizedActLabel = act.label.replace(/\s+/g, '').toLowerCase();

      if (normalizedActivityName === normalizedActLabel) {
        mapping.set(flowKey, act.subject_key);
        reverseMapping.set(act.subject_key, flowKey);
        break;
      }
    }
  }

  return { mapping, reverseMapping };
}

/**
 * 对齐 CONTROL_FLOW 的 FLOW source/target 到 ACTIVITY 的 subject_key
 */
function alignFlowEndpoints(aligned, { mapping }) {
  const controlFlowFrag = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
  if (!controlFlowFrag) return;

  for (const fact of controlFlowFrag.payload.facts) {
    if (fact.kind === 'FLOW') {
      const src = fact.attributes.source_subject_key;
      const tgt = fact.attributes.target_subject_key;

      // 如果映射中有对应的结构化键，替换
      if (mapping.has(src)) {
        fact.attributes.source_subject_key = mapping.get(src);
      }
      if (mapping.has(tgt)) {
        fact.attributes.target_subject_key = mapping.get(tgt);
      }
    }
  }
}

/**
 * 聚合兄弟事实（INPUT, OUTPUT, SLA, RESPONSIBILITY, CONFIRMATION_CONDITION）到对应 ACTIVITY 或 ROLE
 */
function aggregateSiblingsToActivities(aligned) {
  const activityFrag = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
  if (!activityFrag) return;

  const facts = activityFrag.payload.facts;
  const activities = facts.filter(f => f.kind === 'ACTIVITY');
  const roles = facts.filter(f => f.kind === 'ROLE');
  const activityMap = new Map(activities.map(a => [a.subject_key, a]));
  const roleMap = new Map(roles.map(r => [r.subject_key, r]));

  // 需要聚合的事实类型
  const siblingKinds = new Set(['INPUT', 'OUTPUT', 'SLA', 'RESPONSIBILITY', 'CONFIRMATION_CONDITION']);

  // 收集要移除的事实索引
  const indicesToRemove = new Set();

  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i];
    if (!siblingKinds.has(fact.kind)) continue;

    // RESPONSIBILITY 聚合到 ROLE，其他聚合到 ACTIVITY
    let target = null;
    if (fact.kind === 'RESPONSIBILITY') {
      target = roleMap.get(fact.subject_key);
    } else {
      target = activityMap.get(fact.subject_key);
    }

    if (!target) continue;

    // 确保 attributes 存在
    if (!target.attributes) target.attributes = {};

    switch (fact.kind) {
      case 'INPUT':
        if (!target.attributes.inputs) target.attributes.inputs = [];
        target.attributes.inputs.push(fact.label);
        break;

      case 'OUTPUT':
        if (!target.attributes.outputs) target.attributes.outputs = [];
        target.attributes.outputs.push(fact.label);
        break;

      case 'SLA':
        target.attributes.sla = parseSla(fact.label);
        break;

      case 'RESPONSIBILITY':
        // RESPONSIBILITY 聚合到 ROLE 的 responsibilities 属性
        if (!target.attributes.responsibilities) {
          target.attributes.responsibilities = [];
        }
        target.attributes.responsibilities.push(fact.label);
        break;

      case 'CONFIRMATION_CONDITION':
        // goal 要求：不得写入字符串 confirmation，聚合到 completion_criteria
        if (!target.attributes.completion_criteria) {
          target.attributes.completion_criteria = [];
        }
        // 将条件拆分为独立条件
        const conditions = fact.label.split(/[、,，]/).map(c => c.trim()).filter(Boolean);
        target.attributes.completion_criteria.push(...conditions);
        // confirmation 保持 null
        target.attributes.confirmation = null;
        break;
    }

    // 合并 evidence_refs
    if (!target.evidence_refs) target.evidence_refs = [];
    target.evidence_refs.push(...(fact.evidence_refs || []));
    target.evidence_refs = [...new Set(target.evidence_refs)];

    indicesToRemove.add(i);
  }

  // 移除已聚合的兄弟事实（从后往前移除以保持索引）
  const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    facts.splice(idx, 1);
  }

  // 确保没有 SLA 的活动设置为 null
  for (const act of activities) {
    if (!act.attributes) act.attributes = {};
    if (act.attributes.sla === undefined) {
      act.attributes.sla = null;
    }
    if (!Array.isArray(act.attributes.inputs)) {
      act.attributes.inputs = [];
    }
    if (!Array.isArray(act.attributes.outputs)) {
      act.attributes.outputs = [];
    }
    if (!Array.isArray(act.attributes.completion_criteria)) {
      act.attributes.completion_criteria = [];
    }
    // confirmation 默认 null
    if (act.attributes.confirmation === undefined) {
      act.attributes.confirmation = null;
    }
  }
}

/**
 * 解析 SLA 文本为结构化对象
 *
 * @param {string} text - 如 "2个工作日"
 * @returns {{value: number, unit: string, raw_text: string} | null}
 */
function parseSla(text) {
  if (!text) return null;

  // 匹配中文数字和单位（注意"个"量词）
  const patterns = [
    { regex: /(\d+)\s*个?\s*工作日/, unit: 'WORKING_DAY' },
    { regex: /(\d+)\s*个?\s*天/, unit: 'CALENDAR_DAY' },
    { regex: /(\d+)\s*个?\s*小时/, unit: 'HOUR' },
    { regex: /(\d+)\s*个?\s*分钟/, unit: 'MINUTE' },
    { regex: /(\d+)\s*个?\s*周/, unit: 'WEEK' },
    { regex: /(\d+)\s*个?\s*月/, unit: 'MONTH' },
  ];

  for (const { regex, unit } of patterns) {
    const match = text.match(regex);
    if (match) {
      return {
        value: parseInt(match[1], 10),
        unit: unit,
        raw_text: text,
      };
    }
  }

  // 无法解析时返回 null（不伪造）
  return null;
}

/**
 * 通用结果别名规则：任意 ACTIVITY 的规范化 label 与任一 END_EVENT 相同，
 * 且聚合后 inputs/outputs 为空、sla=null、没有独立 TOOL/REFERENCE 等业务承载时，
 * 将其 evidence_refs 合入该 END_EVENT 并移除活动；否则保留。
 */
function mergeRejectReturnToEndEvent(aligned) {
  const activityFrag = aligned.find(f => f.task_kind === 'ACTIVITY_CATALOG');
  const controlFlowFrag = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
  if (!activityFrag || !controlFlowFrag) return;

  const endEvents = controlFlowFrag.payload.facts.filter(f => f.kind === 'END_EVENT');
  const activities = activityFrag.payload.facts.filter(f => f.kind === 'ACTIVITY');

  // 规范化函数：先去除"结束"后缀，再统一空格/大小写
  const normalize = (str) => normalizeEndEventLabel(str).replace(/\s+/g, '').toLowerCase();

  // 收集需要移除的 ACTIVITY 索引
  const indicesToRemove = new Set();

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i];
    const normalizedActLabel = normalize(act.label);

    // 查找匹配的 END_EVENT
    const matchingEndEvent = endEvents.find(e => normalize(e.label) === normalizedActLabel);
    if (!matchingEndEvent) continue;

    // 检查是否满足结果别名条件：
    // 1. inputs/outputs 为空
    const hasInputs = act.attributes?.inputs?.length > 0;
    const hasOutputs = act.attributes?.outputs?.length > 0;

    // 2. sla=null
    const hasSla = act.attributes?.sla !== null && act.attributes?.sla !== undefined;

    // 3. 独立承载检查：只检查 inputs、outputs、sla、tools、references、completion_criteria
    //    trigger/conditions 不阻止结果别名
    const hasCompletionCriteria = act.attributes?.completion_criteria?.length > 0;
    const hasTools = act.attributes?.tools?.length > 0;
    const hasReferences = act.attributes?.references?.length > 0;

    // 如果满足所有条件，则合并 evidence_refs 并移除活动
    if (!hasInputs && !hasOutputs && !hasSla && !hasCompletionCriteria && !hasTools && !hasReferences) {
      // 合并 evidence_refs 到 END_EVENT
      if (!matchingEndEvent.evidence_refs) matchingEndEvent.evidence_refs = [];
      matchingEndEvent.evidence_refs.push(...(act.evidence_refs || []));
      matchingEndEvent.evidence_refs = [...new Set(matchingEndEvent.evidence_refs)];

      // 标记为移除
      indicesToRemove.add(activityFrag.payload.facts.indexOf(act));
    }
  }

  // 移除标记的 ACTIVITY（从后往前移除以保持索引）
  const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    activityFrag.payload.facts.splice(idx, 1);
  }
}

/**
 * 标准化 END_EVENT：移除"（结束）"后缀，
 * 跨片段对齐 subject_key（以 CONTROL_FLOW 的键为 canonical），
 * 合并重复事件的 evidence_refs。
 */
function normalizeEndEvents(aligned) {
  // 第一步：标准化所有 label，移除"（结束）"后缀
  for (const frag of aligned) {
    const endEvents = frag.payload.facts.filter(f => f.kind === 'END_EVENT');
    for (const ev of endEvents) {
      ev.label = ev.label.replace(/（结束）$/g, '').replace(/\(结束\)$/g, '');
    }
  }

  // 第二步：收集 CONTROL_FLOW 的 END_EVENT canonical subject_key（按 normalized label 索引）
  const canonicalByKey = new Map(); // normalized label → CONTROL_FLOW subject_key
  const controlFlowFrag = aligned.find(f => f.task_kind === 'CONTROL_FLOW');
  if (controlFlowFrag) {
    for (const fact of controlFlowFrag.payload.facts) {
      if (fact.kind === 'END_EVENT') {
        canonicalByKey.set(normalizeEndEventLabel(fact.label), fact.subject_key);
      }
    }
  }

  // 第三步：将 PROCESS_CARD 的 END_EVENT subject_key 重写为 canonical 键
  const processCardFrag = aligned.find(f => f.task_kind === 'PROCESS_CARD');
  if (processCardFrag) {
    for (const fact of processCardFrag.payload.facts) {
      if (fact.kind === 'END_EVENT') {
        const normalizedLabel = normalizeEndEventLabel(fact.label);
        const canonicalKey = canonicalByKey.get(normalizedLabel);
        if (canonicalKey) {
          fact.subject_key = canonicalKey;
        }
      }
    }
  }

  // 第四步：按片段内部去重同名 END_EVENT（合并 evidence_refs）
  for (const frag of aligned) {
    const endEvents = frag.payload.facts.filter(f => f.kind === 'END_EVENT');

    // 合并同名 END_EVENT 的 evidence_refs
    const labelGroups = new Map();
    for (const ev of endEvents) {
      const key = normalizeEndEventLabel(ev.label);
      if (!labelGroups.has(key)) {
        labelGroups.set(key, []);
      }
      labelGroups.get(key).push(ev);
    }

    // 如果有重复，保留第一个并合并 evidence_refs
    for (const [, group] of labelGroups) {
      if (group.length <= 1) continue;

      const primary = group[0];
      for (let i = 1; i < group.length; i++) {
        primary.evidence_refs.push(...(group[i].evidence_refs || []));
        primary.evidence_refs = [...new Set(primary.evidence_refs)];
      }
    }

    // 移除重复的 END_EVENT（保留每个 label 组的第一个）
    const seen = new Set();
    frag.payload.facts = frag.payload.facts.filter(f => {
      if (f.kind !== 'END_EVENT') return true;
      const key = normalizeEndEventLabel(f.label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

/**
 * 标准化 END_EVENT label 用于去重
 */
function normalizeEndEventLabel(label) {
  return label
    .replace(/（结束）$/g, '')
    .replace(/\(结束\)$/g, '')
    .trim();
}
