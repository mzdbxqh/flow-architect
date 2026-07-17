import { createReviewFinding } from './lib/review-finding.mjs';

/**
 * 活动—BPMN 交叉审查
 *
 * 规则 FA-ACT-BPMN-001 ~ 009
 *
 * @param {object} params
 * @param {object} params.processCard - 流程卡片
 * @param {Array} params.activities - 活动表
 * @param {object} params.diagramModel - V2 草稿中的 diagram 对象
 * @param {string} params.artifactId - 工件标识，默认 process-draft.json
 * @returns {Array<Finding>}
 */
export function reviewActivityBpmn({
  processCard,
  activities,
  diagramModel,
  artifactId = 'process-draft.json',
}) {
  if (!processCard) throw new Error('processCard is required');
  if (!activities) throw new Error('activities is required');
  if (!diagramModel) throw new Error('diagramModel is required');

  // 缺少活动表时返回 NEEDS_INPUT
  if (!Array.isArray(activities) || activities.length === 0) {
    const finding = createReviewFinding({
      ruleId: 'NEEDS_INPUT',
      category: 'ACTIVITY_BPMN',
      severity: 'INFO',
      artifactId,
      targetRef: 'activities',
      observation: '缺少活动表，无法进行活动—BPMN 交叉审查',
      expected: '至少包含一个活动的活动表',
      actual: '活动表为空或未提供',
      recommendation: '请提供完整的活动表以启用活动—BPMN 交叉审查',
      confidence: 1,
    });
    // 添加 target_ref 兼容属性
    finding.target_ref = finding.target_refs[0];
    return [finding];
  }

  const findings = [];

  // 构建辅助数据
  const lanes = diagramModel.lanes ?? [];
  const nodes = diagramModel.nodes ?? [];
  const flows = diagramModel.flows ?? [];
  const bindings = diagramModel.task_bindings ?? [];

  const laneByRoleId = new Map(lanes.map(l => [l.role_id, l]));
  const nodeById = new Map(nodes.map(n => [n.node_id, n]));
  const bindingByActivityId = new Map(bindings.map(b => [b.activity_id, b]));

  // 收集 Link Throw/Catch 用于配对检查
  const linkThrows = nodes.filter(n => n.sub_type === 'linkThrow');
  const linkCatches = nodes.filter(n => n.sub_type === 'linkCatch');

  // ── FA-ACT-BPMN-001: 泳道不得使用个人姓名 ──
  // 保守检测：明显姓名格式（2-3个中文字或 First Last 格式）且与角色目录不一致
  for (const lane of lanes) {
    const name = lane.name || '';
    const roleId = lane.role_id || '';

    // 检测明显个人姓名格式
    const isLikelyChineseName = /^[一-龥]{2,3}$/.test(name) && !/角色|人员|部门|团队|组|申请人|审批人|采购员|经理|主管/.test(name);
    const isLikelyWesternName = /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name);

    if (isLikelyChineseName || isLikelyWesternName) {
      // 角色 ID 语义检测 - 'role_' 前缀不算语义
      const roleIdWithoutPrefix = roleId.replace(/^role_/i, '');
      const meaningfulRoleId = /agent|operator|manager|approver|reviewer|purchaser|requester|admin|staff|user/i.test(roleIdWithoutPrefix);

      // 角色 ID 与泳道名称匹配（如 role_zhangsan 对应 张三）
      const roleIdMatchesName = roleIdWithoutPrefix.toLowerCase().includes(name.toLowerCase()) ||
                                 name.toLowerCase().includes(roleIdWithoutPrefix.toLowerCase());

      // 触发条件：姓名格式 + 角色 ID 无语义 或 角色 ID 匹配姓名
      if (!meaningfulRoleId || roleIdMatchesName) {
        findings.push(createReviewFinding({
          ruleId: 'FA-ACT-BPMN-001',
          category: 'ACTIVITY_BPMN',
          severity: 'CRITICAL',
          artifactId,
          targetRef: lane.lane_id,
          locatorType: 'BPMN_LANE',
          locator: lane.lane_id,
          excerpt: name,
          observation: `泳道 "${name}" 可能使用了个人姓名而非业务角色`,
          expected: '泳道应使用业务角色名称',
          actual: `泳道名称 "${name}" 与角色 ID "${roleId}" 均不含角色语义`,
          recommendation: '将泳道名称改为业务角色，例如"申请人"、"审批人"等',
          confidence: 0.7,
        }));
      }
    }
  }

  // ── FA-ACT-BPMN-002: 每个 L5 活动恰有一个 MAIN_TASK，三方一致 ──
  for (const activity of activities) {
    const binding = bindingByActivityId.get(activity.activity_id);
    const mainTaskId = activity.main_task_id;

    // 检查是否有主 Task
    if (!mainTaskId && !binding) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-002',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 缺少主 Task 绑定`,
        expected: '每个 L5 活动应有一个 MAIN_TASK',
        actual: '无 main_task_id 和 task_binding',
        recommendation: '为活动创建 MAIN_TASK 节点并建立 binding',
        confidence: 1,
      }));
      continue;
    }

    // binding 三方一致性检查
    if (binding) {
      const bindingMainTaskId = binding.main_task_id;
      const mainTaskNode = nodeById.get(bindingMainTaskId);

      // binding.main_task_id 与 activity.main_task_id 一致
      if (mainTaskId && bindingMainTaskId !== mainTaskId) {
        findings.push(createReviewFinding({
          ruleId: 'FA-ACT-BPMN-002',
          category: 'ACTIVITY_BPMN',
          severity: 'BLOCKER',
          artifactId,
          targetRef: activity.activity_id,
          observation: `活动 "${activity.name}" 的 activity.main_task_id "${mainTaskId}" 与 binding.main_task_id "${bindingMainTaskId}" 不一致`,
          expected: '三方 ID 一致',
          actual: `activity: ${mainTaskId}, binding: ${bindingMainTaskId}`,
          recommendation: '统一 activity、binding 和节点的 main_task_id',
          confidence: 1,
        }));
      }

      // MAIN_TASK 节点类型正确
      if (mainTaskNode && mainTaskNode.node_type !== 'MAIN_TASK') {
        findings.push(createReviewFinding({
          ruleId: 'FA-ACT-BPMN-002',
          category: 'ACTIVITY_BPMN',
          severity: 'BLOCKER',
          artifactId,
          targetRef: bindingMainTaskId,
          observation: `节点 "${bindingMainTaskId}" 类型为 "${mainTaskNode.node_type}"，应为 MAIN_TASK`,
          expected: '节点类型为 MAIN_TASK',
          actual: mainTaskNode.node_type,
          recommendation: '修正节点类型为 MAIN_TASK',
          confidence: 1,
        }));
      }

      // 检查是否有多个 MAIN_TASK 绑定到同一活动
      const activityBindings = bindings.filter(b => b.activity_id === activity.activity_id);
      if (activityBindings.length > 1) {
        findings.push(createReviewFinding({
          ruleId: 'FA-ACT-BPMN-002',
          category: 'ACTIVITY_BPMN',
          severity: 'BLOCKER',
          artifactId,
          targetRef: activity.activity_id,
          observation: `活动 "${activity.name}" 有 ${activityBindings.length} 个 binding，应恰有一个`,
          expected: '每个 L5 活动恰有一个 MAIN_TASK',
          actual: `${activityBindings.length} 个 binding`,
          recommendation: '保留一个主 Task binding，删除多余的',
          confidence: 1,
        }));
      }
    }
  }

  // ── FA-ACT-BPMN-003: 主 Task 泳道与 RASCI/R 或 OARP/O 一致 ──
  for (const activity of activities) {
    const binding = bindingByActivityId.get(activity.activity_id);
    if (!binding) continue;

    const mainTaskNode = nodeById.get(binding.main_task_id);
    if (!mainTaskNode) continue;

    // 确定责任角色
    const model = activity.responsibility_model;
    const targetResp = model === 'RASCI' ? 'R' : model === 'OARP' ? 'O' : null;
    if (!targetResp) continue;

    const responsibleAssignment = activity.role_assignments.find(r => r.responsibility === targetResp);
    if (!responsibleAssignment) continue;

    const expectedLane = laneByRoleId.get(responsibleAssignment.role_id);
    if (!expectedLane) continue;

    if (mainTaskNode.lane_id !== expectedLane.lane_id) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-003',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 的主 Task 泳道 "${mainTaskNode.lane_id}" 与 ${model}/${targetResp} 角色 "${responsibleAssignment.role_id}" 对应泳道 "${expectedLane.lane_id}" 不一致`,
        expected: `主 Task 位于 ${targetResp} 角色泳道`,
        actual: `主 Task 位于 ${mainTaskNode.lane_id}`,
        recommendation: `将主 Task 移至 ${expectedLane.name} 泳道`,
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-004: 确认从 Task 三条件 ──
  for (const activity of activities) {
    if (!activity.confirmation) continue;

    const conf = activity.confirmation;

    // 三项声明必须全真
    if (!conf.co_completes || !conf.confirm_bears_final_responsibility || !conf.no_formal_approval_meeting) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-004',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 的确认从 Task 三条件不全：co_completes=${conf.co_completes}, confirm_bears_final_responsibility=${conf.confirm_bears_final_responsibility}, no_formal_approval_meeting=${conf.no_formal_approval_meeting}`,
        expected: '三项声明均为 true',
        actual: `co_completes=${conf.co_completes}, confirm_bears_final_responsibility=${conf.confirm_bears_final_responsibility}, no_formal_approval_meeting=${conf.no_formal_approval_meeting}`,
        recommendation: '确认确认从 Task 满足三项条件，或移除确认从 Task',
        confidence: 1,
      }));
    }

    // 确认角色必须存在且不同于主责角色
    const confirmRoleId = conf.confirm_role_id;
    const mainResp = activity.responsibility_model === 'RASCI' ? 'R' : 'O';
    const mainRole = activity.role_assignments.find(r => r.responsibility === mainResp);

    if (mainRole && confirmRoleId === mainRole.role_id) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-004',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 的确认角色 "${confirmRoleId}" 与主责角色相同`,
        expected: '确认角色不同于主责角色',
        actual: `确认角色和主责角色均为 ${confirmRoleId}`,
        recommendation: '指定不同于主责角色的确认角色',
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-005: 正式审批不得作为确认从 Task ──
  for (const activity of activities) {
    if (!activity.confirmation) continue;

    const isFormalApproval = activity.activity_type === 'REVIEW_MEETING' || activity.activity_type === 'DECISION_ACTIVITY';
    if (isFormalApproval) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-005',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activity.activity_id,
        observation: `${activity.activity_type} 活动 "${activity.name}" 不应使用确认从 Task，应为独立活动`,
        expected: '正式审批/评审应为独立 L5 活动',
        actual: '使用了确认从 Task',
        recommendation: '将正式审批建模为独立的 REVIEW_MEETING 或 DECISION_ACTIVITY',
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-006: XOR/OR 必须有条件或默认路径 ──
  const gateways = nodes.filter(n => n.node_type === 'GATEWAY');
  for (const gw of gateways) {
    const subType = gw.sub_type;
    if (subType !== 'exclusiveGateway' && subType !== 'inclusiveGateway') continue;

    // 找到该网关的出向流
    const outFlows = flows.filter(f => f.source_ref === gw.node_id && f.type === 'SEQUENCE_FLOW');
    if (outFlows.length <= 1) continue;

    // 检查是否有默认流或条件
    const hasDefault = outFlows.some(f => f.is_default === true);
    const hasConditions = outFlows.every(f => f.condition_expression || f.is_default === true);

    if (!hasDefault && !hasConditions) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-006',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: gw.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: gw.node_id,
        excerpt: gw.name,
        observation: `${subType === 'exclusiveGateway' ? 'XOR' : 'OR'} 网关 "${gw.name || gw.node_id}" 缺少条件表达式或默认路径`,
        expected: '每个分支有结构化条件或明确默认路径',
        actual: '无条件表达式且无默认流',
        recommendation: '为每条分支添加条件表达式，或指定一条默认流',
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-007: 结束事件必须有业务结果名称 ──
  const endEvents = nodes.filter(n => n.node_type === 'END_EVENT');
  const endResults = processCard.end_results ?? [];
  const endResultById = new Map(endResults.map(r => [r.event_id, r]));

  for (const endEvent of endEvents) {
    // 检查名称是否有意义
    if (!endEvent.name || endEvent.name.trim() === '') {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-007',
        category: 'ACTIVITY_BPMN',
        severity: 'MAJOR',
        artifactId,
        targetRef: endEvent.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: endEvent.node_id,
        observation: `结束事件 "${endEvent.node_id}" 缺少业务结果名称`,
        expected: '业务结束事件应有可区分的业务结果名称',
        actual: '名称为空',
        recommendation: '为结束事件指定业务结果名称，如"采购完成"、"申请驳回"',
        confidence: 1,
      }));
    }

    // 检查与流程卡片终点一致性
    if (!endResultById.has(endEvent.node_id)) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-007',
        category: 'ACTIVITY_BPMN',
        severity: 'MAJOR',
        artifactId,
        targetRef: endEvent.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: endEvent.node_id,
        observation: `结束事件 "${endEvent.node_id}" 未在流程卡片 end_results 中声明`,
        expected: '所有结束事件应与流程卡片终点集合一致',
        actual: '未在 end_results 中找到对应记录',
        recommendation: '在流程卡片 end_results 中添加此结束事件，或删除图中多余的结束事件',
        confidence: 1,
      }));
    }
  }

  // 检查 end_results 中有但图中没有的结束事件
  for (const result of endResults) {
    if (!endEvents.some(e => e.node_id === result.event_id)) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-007',
        category: 'ACTIVITY_BPMN',
        severity: 'MAJOR',
        artifactId,
        targetRef: result.event_id,
        observation: `流程卡片 end_results 中的 "${result.event_id}" 在图中无对应结束事件`,
        expected: '流程卡片与图的结束事件一一对应',
        actual: '图中缺少该结束事件',
        recommendation: '在图中添加对应的结束事件，或从流程卡片中移除',
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-008: Link Catch/Throw 成对 ──
  const throwNames = new Set(linkThrows.map(n => n.name));
  const catchNames = new Set(linkCatches.map(n => n.name));

  for (const throwEvent of linkThrows) {
    if (!catchNames.has(throwEvent.name)) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-008',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: throwEvent.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: throwEvent.node_id,
        excerpt: throwEvent.name,
        observation: `Link Throw "${throwEvent.name}" 没有对应的 Link Catch`,
        expected: '每个 Link Throw 应有同名的 Link Catch',
        actual: '未找到匹配的 Link Catch',
        recommendation: '添加同名的 Link Catch 事件，或删除此 Link Throw',
        confidence: 1,
      }));
    }
  }

  for (const catchEvent of linkCatches) {
    if (!throwNames.has(catchEvent.name)) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-008',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: catchEvent.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: catchEvent.node_id,
        excerpt: catchEvent.name,
        observation: `Link Catch "${catchEvent.name}" 没有对应的 Link Throw`,
        expected: '每个 Link Catch 应有同名的 Link Throw',
        actual: '未找到匹配的 Link Throw',
        recommendation: '添加同名的 Link Throw 事件，或删除此 Link Catch',
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-009: 同一 L5 不得映射并行主 Task ──
  const activityMainTasks = new Map();
  for (const binding of bindings) {
    if (!activityMainTasks.has(binding.activity_id)) {
      activityMainTasks.set(binding.activity_id, new Set());
    }
    activityMainTasks.get(binding.activity_id).add(binding.main_task_id);
  }

  for (const [activityId, mainTaskIds] of activityMainTasks) {
    if (mainTaskIds.size > 1) {
      const activity = activities.find(a => a.activity_id === activityId);
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-009',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activityId,
        observation: `活动 "${activity?.name || activityId}" 映射了 ${mainTaskIds.size} 个并行主 Task: ${[...mainTaskIds].join(', ')}`,
        expected: '同一 L5 活动最多一个主 Task',
        actual: `${mainTaskIds.size} 个主 Task`,
        recommendation: '将并行主 Task 合并为串行，或拆分为多个活动',
        confidence: 1,
      }));
    }
  }

  // 添加 target_ref 兼容属性并排序确保稳定性
  for (const finding of findings) {
    finding.target_ref = finding.target_refs[0];
  }

  findings.sort((a, b) => {
    if (a.rule_id < b.rule_id) return -1;
    if (a.rule_id > b.rule_id) return 1;
    if (a.target_ref < b.target_ref) return -1;
    if (a.target_ref > b.target_ref) return 1;
    return 0;
  });

  return findings;
}
