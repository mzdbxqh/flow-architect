import { createReviewFinding } from './lib/review-finding.mjs';

/**
 * 活动—BPMN 交叉审查
 *
 * 规则 FA-ACT-BPMN-001 ~ 009
 * V2-only：使用 diagram-draft V2 节点类型和流字段。
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

  const findings = [];

  // 构建辅助数据
  const lanes = diagramModel.lanes ?? [];
  const nodes = diagramModel.nodes ?? [];
  const flows = diagramModel.flows ?? [];
  const bindings = diagramModel.task_bindings ?? [];

  const laneByRoleId = new Map(lanes.map(l => [l.role_id, l]));
  const nodeById = new Map(nodes.map(n => [n.node_id, n]));
  const bindingByActivityId = new Map(bindings.map(b => [b.activity_id, b]));

  // ── FA-ACT-BPMN-001: 泳道不得使用个人姓名 ──
  // 保守检测：只有同时出现明确个人信号时确定性报告。
  // 明确信号：person_/employee_/emp_/user_ 前缀的角色 ID；
  // 或者泳道名明显是姓名格式且角色 ID 不含合法角色语义。
  for (const lane of lanes) {
    const name = lane.name || '';
    const roleId = lane.role_id || '';

    // 检测个人标识前缀（确定性信号）
    const hasPersonalPrefix = /^person_|^employee_|^emp_|^user_/i.test(roleId);

    // 检测明显姓名格式
    const isLikelyChineseName = /^[一-龥]{2,3}$/.test(name);
    const isLikelyWesternName = /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name);

    // 合法角色关键词列表（不得误报）
    const roleKeywords = /角色|人员|部门|团队|组|申请人|审批人|采购员|经理|主管|经办人|审核人|操作人|管理员|负责人|财务|会计|出纳|秘书|助理|总监|主任|科长|处长|部长|委员|代表|顾问|分析师|设计师|工程师|架构师|测试员|开发员|运维|运营|销售|客服|前台|后勤|法务|人事|行政|质检|仓管|物流|生产|计划|采购|审计|风控|合规/;
    const hasRoleSemantic = roleKeywords.test(name);

    // 角色 ID 语义检测：排除 "Role-" 或 "role_" 这类纯前缀，只匹配有实际角色含义的词
    // 例如：approver, requester, purchaser, admin, manager 等有实际业务语义
    const roleIdWithoutPrefix = roleId.replace(/^(Role[-_]|role[-_])/i, '');
    const roleIdHasSemanticWord = /agent|operator|manager|approver|reviewer|purchaser|requester|admin|staff|owner|lead|supervisor|auditor|analyst|engineer|designer|secretary|assistant|director|commissioner/i.test(roleIdWithoutPrefix);

    let shouldReport = false;

    if (hasPersonalPrefix) {
      // 有明确个人前缀 → 确定性报告
      shouldReport = true;
    } else if ((isLikelyChineseName || isLikelyWesternName) && !hasRoleSemantic && !roleIdHasSemanticWord) {
      // 姓名格式 + 泳道名无角色关键词 + 角色 ID 无业务语义 → 报告
      shouldReport = true;
    }

    if (shouldReport) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-001',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: lane.lane_id,
        locatorType: 'BPMN_ELEMENT',
        locator: lane.lane_id,
        excerpt: name,
        observation: `泳道 "${name}" 可能使用了个人姓名而非业务角色`,
        expected: '泳道应使用业务角色名称',
        actual: `泳道名称 "${name}" 与角色 ID "${roleId}" 均不含角色语义`,
        recommendation: '将泳道名称改为业务角色，例如"申请人"、"审批人"等',
        confidence: hasPersonalPrefix ? 0.95 : 0.7,
      }));
    }
  }

  // ── FA-ACT-BPMN-002: 每个 L5 活动恰有一个 MAIN_TASK，三方一致 ──
  for (const activity of activities) {
    const binding = bindingByActivityId.get(activity.activity_id);
    const mainTaskId = activity.main_task_id;

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

    // binding 缺失但 mainTaskId 存在
    if (!binding) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-002',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 缺少 task_binding，但声明了 main_task_id "${mainTaskId}"`,
        expected: '每个 L5 活动应有 task_binding',
        actual: `activity.main_task_id="${mainTaskId}"，无 binding`,
        recommendation: '为活动创建 task_binding',
        confidence: 1,
      }));
      continue;
    }

    if (binding) {
      const bindingMainTaskId = binding.main_task_id;
      const mainTaskNode = nodeById.get(bindingMainTaskId);

      // 三方 ID 一致性
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

      // 多个 binding
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

    const model = activity.responsibility_model;
    const targetResp = model === 'RASCI' ? 'R' : model === 'OARP' ? 'O' : null;
    if (!targetResp) continue;

    const responsibleAssignment = activity.role_assignments.find(r => r.responsibility === targetResp);
    if (!responsibleAssignment) {
      // R/O 角色缺失 → 003
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-003',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 的 ${model} 缺少 ${targetResp} 角色分配`,
        expected: `${model} 应有且仅有一个 ${targetResp} 角色`,
        actual: `缺少 ${targetResp} 角色`,
        recommendation: `为活动分配 ${targetResp} 角色`,
        confidence: 1,
      }));
      continue;
    }

    const expectedLane = laneByRoleId.get(responsibleAssignment.role_id);
    if (!expectedLane) {
      // 责任角色没有对应泳道 → 003
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-003',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 的责任角色 "${responsibleAssignment.role_id}" 找不到对应泳道`,
        expected: `主 Task 位于 ${targetResp} 角色泳道`,
        actual: `角色 "${responsibleAssignment.role_id}" 无泳道`,
        recommendation: `为角色 "${responsibleAssignment.role_id}" 创建泳道`,
        confidence: 1,
      }));
    } else if (mainTaskNode.lane_id !== expectedLane.lane_id) {
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

  // ── FA-ACT-BPMN-004: 确认从 Task ──
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

    // confirm_role_id 存在于活动角色或泳道角色目录
    const confirmRoleId = conf.confirm_role_id;
    const allRoleIds = new Set([
      ...activity.role_assignments.map(r => r.role_id),
      ...lanes.map(l => l.role_id),
    ]);
    if (!allRoleIds.has(confirmRoleId)) {
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-004',
        category: 'ACTIVITY_BPMN',
        severity: 'BLOCKER',
        artifactId,
        targetRef: activity.activity_id,
        observation: `活动 "${activity.name}" 的确认角色 "${confirmRoleId}" 不存在于活动角色或泳道角色目录`,
        expected: 'confirm_role_id 应存在于角色目录',
        actual: `confirm_role_id="${confirmRoleId}" 未找到`,
        recommendation: '指定正确的确认角色',
        confidence: 1,
      }));
    }

    // 确认角色必须不同于主责角色
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

    // confirmation 三方一致性
    const binding = bindingByActivityId.get(activity.activity_id);
    const bindingConfTaskId = binding?.confirmation_task_id;

    if (bindingConfTaskId) {
      const confNode = nodeById.get(bindingConfTaskId);
      if (confNode) {
        // 确认 Task 位于确认角色泳道
        const confirmLane = laneByRoleId.get(confirmRoleId);
        if (confirmLane && confNode.lane_id !== confirmLane.lane_id) {
          findings.push(createReviewFinding({
            ruleId: 'FA-ACT-BPMN-004',
            category: 'ACTIVITY_BPMN',
            severity: 'BLOCKER',
            artifactId,
            targetRef: activity.activity_id,
            observation: `确认 Task "${bindingConfTaskId}" 位于 "${confNode.lane_id}" 而非确认角色泳道 "${confirmLane.lane_id}"`,
            expected: `确认 Task 位于确认角色泳道`,
            actual: `位于 ${confNode.lane_id}`,
            recommendation: `将确认 Task 移至 ${confirmLane.name} 泳道`,
            confidence: 1,
          }));
        }

        // 确认 Task 泳道不同于主 Task 泳道
        const mainTaskNode = nodeById.get(binding.main_task_id);
        if (mainTaskNode && confNode.lane_id === mainTaskNode.lane_id) {
          findings.push(createReviewFinding({
            ruleId: 'FA-ACT-BPMN-004',
            category: 'ACTIVITY_BPMN',
            severity: 'BLOCKER',
            artifactId,
            targetRef: activity.activity_id,
            observation: `确认 Task "${bindingConfTaskId}" 与主 Task "${binding.main_task_id}" 位于同一泳道`,
            expected: '确认 Task 位于不同于主 Task 的泳道',
            actual: `两者均位于 ${confNode.lane_id}`,
            recommendation: '将确认 Task 移至确认角色的泳道',
            confidence: 1,
          }));
        }
      }
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
  // V2: 使用 GATEWAY_XOR/GATEWAY_OR 节点类型和 V2 flow.condition
  const gatewayTypes = new Set(['GATEWAY_XOR', 'GATEWAY_OR']);
  const gateways = nodes.filter(n => gatewayTypes.has(n.node_type));
  for (const gw of gateways) {
    // 找到该网关的出向流
    const outFlows = flows.filter(f => f.source_ref === gw.node_id);
    if (outFlows.length <= 1) continue;

    // V2 条件检查：每条出向流都必须有非空结构化 condition
    const allHaveCondition = outFlows.every(f => f.condition != null && typeof f.condition === 'object' && f.condition.label);

    if (!allHaveCondition) {
      const gwType = gw.node_type === 'GATEWAY_XOR' ? 'XOR' : 'OR';
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-006',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: gw.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: gw.node_id,
        excerpt: gw.name,
        observation: `${gwType} 网关 "${gw.name || gw.node_id}" 的出向流缺少结构化条件`,
        expected: '每个分支有结构化条件或明确默认路径',
        actual: `${outFlows.filter(f => !f.condition).length} 条出向流无条件`,
        recommendation: '为每条分支添加结构化条件',
        confidence: 1,
      }));
    }
  }

  // ── FA-ACT-BPMN-007: 结束事件必须有业务结果名称 ──
  const endEvents = nodes.filter(n => n.node_type === 'END_EVENT');
  const endResults = processCard.end_results ?? [];
  const endResultById = new Map(endResults.map(r => [r.event_id, r]));

  for (const endEvent of endEvents) {
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
        recommendation: '为结束事件指定业务结果名称',
        confidence: 1,
      }));
    }

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

  // end_results 有但图中没有的结束事件
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
  // V2: 使用 INTERMEDIATE_LINK_THROW 和 INTERMEDIATE_LINK_CATCH 节点类型
  const linkThrows = nodes.filter(n => n.node_type === 'INTERMEDIATE_LINK_THROW');
  const linkCatches = nodes.filter(n => n.node_type === 'INTERMEDIATE_LINK_CATCH');
  const throwNames = new Map();
  const catchNames = new Map();

  for (const n of linkThrows) {
    throwNames.set(n.name, (throwNames.get(n.name) || 0) + 1);
  }
  for (const n of linkCatches) {
    catchNames.set(n.name, (catchNames.get(n.name) || 0) + 1);
  }

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

  // 多配检查
  for (const [name, count] of throwNames) {
    if (count > 1) {
      const event = linkThrows.find(n => n.name === name);
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-008',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: event.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: event.node_id,
        excerpt: name,
        observation: `Link Throw "${name}" 有 ${count} 个，应只有 1 个`,
        expected: 'Link Throw 和 Catch 各自最多一个同名',
        actual: `${count} 个同名 Throw`,
        recommendation: '删除多余的 Link Throw',
        confidence: 1,
      }));
    }
  }

  for (const [name, count] of catchNames) {
    if (count > 1) {
      const event = linkCatches.find(n => n.name === name);
      findings.push(createReviewFinding({
        ruleId: 'FA-ACT-BPMN-008',
        category: 'ACTIVITY_BPMN',
        severity: 'CRITICAL',
        artifactId,
        targetRef: event.node_id,
        locatorType: 'BPMN_ELEMENT',
        locator: event.node_id,
        excerpt: name,
        observation: `Link Catch "${name}" 有 ${count} 个，应只有 1 个`,
        expected: 'Link Throw 和 Catch 各自最多一个同名',
        actual: `${count} 个同名 Catch`,
        recommendation: '删除多余的 Link Catch',
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

  // 排序确保稳定性（不添加 target_ref 额外属性）
  findings.sort((a, b) => {
    if (a.rule_id < b.rule_id) return -1;
    if (a.rule_id > b.rule_id) return 1;
    if (a.target_refs[0] < b.target_refs[0]) return -1;
    if (a.target_refs[0] > b.target_refs[0]) return 1;
    return 0;
  });

  return findings;
}

/**
 * 活动—BPMN 审查 stage 判定接口
 *
 * 完整输入时调用 reviewActivityBpmn；
 * 缺少 processCard、activities 或 diagramModel 时返回 NEEDS_INPUT。
 *
 * @param {object} params
 * @param {object|null} params.processCard
 * @param {Array|null} params.activities
 * @param {object|null} params.diagramModel
 * @param {string} [params.artifactId]
 * @returns {{ status: 'NEEDS_INPUT'|'SUCCEEDED', missing: string[], findings: Array<Finding> }}
 */
export function evaluateActivityBpmnStage({
  processCard,
  activities,
  diagramModel,
  artifactId = 'process-draft.json',
}) {
  const missing = [];
  if (!processCard) missing.push('process_card');
  if (!activities || !Array.isArray(activities) || activities.length === 0) missing.push('activities');
  if (!diagramModel) missing.push('diagram_model');

  if (missing.length > 0) {
    return { status: 'NEEDS_INPUT', missing, findings: [] };
  }

  const findings = reviewActivityBpmn({ processCard, activities, diagramModel, artifactId });
  return { status: 'SUCCEEDED', missing: [], findings };
}
