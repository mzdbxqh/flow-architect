/**
 * 流程草稿 V2 确定性业务门禁
 *
 * 纯业务规则，不依赖 Node 内置模块，可被浏览器打包。
 *
 * 错误码:
 *   FA-DRAFT-LEAF-001     — 非末端 L4/L1-L3 不允许活动和图
 *   FA-DRAFT-ROLE-001     — RASCI 恰一个 R，OARP 恰一个 O
 *   FA-DRAFT-ROLE-002     — 同一角色不得在同一活动出现多个责任代码
 *   FA-DRAFT-BIND-001     — 每个活动恰有一个主 Task 绑定
 *   FA-DRAFT-BIND-002     — activity.main_task_id、binding.main_task_id 和 MAIN_TASK 节点必须一致
 *   FA-DRAFT-CONFIRM-001  — 确认从 Task 三条件缺一不可
 *   FA-DRAFT-CONFIRM-002  — confirmation 声明、binding 和 CONFIRMATION_TASK 节点三方必须一致
 *   FA-DRAFT-CONFIRM-003  — REVIEW/DECISION 活动不得把正式审批表示为 confirmation
 *   FA-DRAFT-LANE-001     — 主 Task 泳道与 R/O 一致；角色无泳道时失败关闭
 *   FA-DRAFT-LANE-002     — confirmation 节点必须位于确认角色泳道，且不同于主 Task 泳道
 *   FA-DRAFT-MODEL-001    — STANDARD 必须使用 RASCI；REVIEW_MEETING/DECISION_ACTIVITY 必须使用 OARP
 *   FA-DRAFT-PARALLEL-001 — 同一 L5 内禁止并行 Task
 *   FA-DRAFT-CARD-001     — parent_process_name 必须存在（L1 可显式为 null）
 */

/**
 * 判断是否为末端 L4
 * @param {{ level: string, is_leaf: boolean }} card
 * @returns {boolean}
 */
export function isLeafL4(card) {
  return card.level === 'L4' && card.is_leaf === true;
}

/**
 * 返回活动的责任角色：RASCI → R，OARP → O
 * @param {{ responsibility_model: string, role_assignments: Array<{role_id: string, responsibility: string}> }} activity
 * @returns {string|null}
 */
export function accountableRole(activity) {
  const model = activity.responsibility_model;
  const target = model === 'RASCI' ? 'R' : model === 'OARP' ? 'O' : null;
  if (!target) return null;
  const match = activity.role_assignments.find(r => r.responsibility === target);
  return match ? match.role_id : null;
}

/**
 * 返回指定活动的 task_binding
 * @param {object} draft
 * @param {string} activityId
 * @returns {object|null}
 */
export function bindingForActivity(draft, activityId) {
  return draft.diagram.task_bindings.find(b => b.activity_id === activityId) || null;
}

/**
 * 查找角色对应的泳道
 * @param {object} diagram
 * @param {string} roleId
 * @returns {object|null}
 */
function findLaneForRole(diagram, roleId) {
  return diagram.lanes.find(l => l.role_id === roleId) || null;
}

/**
 * 验证流程草稿 V2 业务规则
 *
 * @param {object} draft - 符合 process-draft V2 Schema 的草稿
 * @returns {{ valid: boolean, errors: Array<{ code: string, path: string, message: string }> }}
 */
export function validateDraftBusinessRules(draft) {
  const errors = [];
  const card = draft.process_card;
  const activities = draft.activities;
  const diagram = draft.diagram;

  // ── FA-DRAFT-CARD-001: parent_process_name 必填 ──
  if (!('parent_process_name' in card)) {
    errors.push({
      code: 'FA-DRAFT-CARD-001',
      path: '/process_card/parent_process_name',
      message: 'parent_process_name 必须存在（L1 可显式为 null）',
    });
  }

  // ── FA-DRAFT-LEAF-001: 非末端不允许活动和图 ──
  if (!isLeafL4(card)) {
    if (activities.length > 0) {
      errors.push({
        code: 'FA-DRAFT-LEAF-001',
        path: '/activities',
        message: '非末端 L4 或 L1-L3 流程不允许包含活动',
      });
    }
    if (diagram.task_bindings.length > 0 ||
        diagram.nodes.length > 0 ||
        diagram.flows.length > 0) {
      errors.push({
        code: 'FA-DRAFT-LEAF-001',
        path: '/diagram',
        message: '非末端 L4 或 L1-L3 流程不允许包含图',
      });
    }
  }

  // ── FA-DRAFT-LANE-003: 泳道 ID 与角色映射必须唯一 ──
  const laneIds = new Set();
  const laneRoleIds = new Set();
  for (const lane of diagram.lanes) {
    if (laneIds.has(lane.lane_id)) {
      errors.push({
        code: 'FA-DRAFT-LANE-003',
        path: '/diagram/lanes',
        message: `泳道 ID 重复：${lane.lane_id}`,
      });
    }
    if (laneRoleIds.has(lane.role_id)) {
      errors.push({
        code: 'FA-DRAFT-LANE-003',
        path: '/diagram/lanes',
        message: `同一角色只能对应一个泳道：${lane.role_id}`,
      });
    }
    laneIds.add(lane.lane_id);
    laneRoleIds.add(lane.role_id);
  }

  // ── FA-DRAFT-MODEL-001: 责任模型匹配 ──
  for (const activity of activities) {
    const type = activity.activity_type;
    const model = activity.responsibility_model;
    if (type === 'STANDARD' && model !== 'RASCI') {
      errors.push({
        code: 'FA-DRAFT-MODEL-001',
        path: `/activities/${activity.activity_id}/responsibility_model`,
        message: `STANDARD 活动 "${activity.name}" 必须使用 RASCI，当前使用 ${model}`,
      });
    } else if ((type === 'REVIEW_MEETING' || type === 'DECISION_ACTIVITY') && model !== 'OARP') {
      errors.push({
        code: 'FA-DRAFT-MODEL-001',
        path: `/activities/${activity.activity_id}/responsibility_model`,
        message: `${type} 活动 "${activity.name}" 必须使用 OARP，当前使用 ${model}`,
      });
    }
  }

  // ── FA-DRAFT-ROLE-001: RASCI 恰一个 R，OARP 恰一个 O ──
  for (const activity of activities) {
    const model = activity.responsibility_model;
    const assignments = activity.role_assignments;

    if (model === 'RASCI') {
      const rCount = assignments.filter(r => r.responsibility === 'R').length;
      if (rCount !== 1) {
        errors.push({
          code: 'FA-DRAFT-ROLE-001',
          path: `/activities/${activity.activity_id}/role_assignments`,
          message: `RASCI 活动 "${activity.name}" 必须恰有一个 R，当前 ${rCount} 个`,
        });
      }
    } else if (model === 'OARP') {
      const oCount = assignments.filter(r => r.responsibility === 'O').length;
      if (oCount !== 1) {
        errors.push({
          code: 'FA-DRAFT-ROLE-001',
          path: `/activities/${activity.activity_id}/role_assignments`,
          message: `OARP 活动 "${activity.name}" 必须恰有一个 O，当前 ${oCount} 个`,
        });
      }
    }
  }

  // ── FA-DRAFT-ROLE-002: 同一角色不得在同一活动出现多个责任代码 ──
  for (const activity of activities) {
    const roleMap = new Map();
    for (const assignment of activity.role_assignments) {
      const existing = roleMap.get(assignment.role_id);
      if (existing && !existing.includes(assignment.responsibility)) {
        existing.push(assignment.responsibility);
      } else if (!existing) {
        roleMap.set(assignment.role_id, [assignment.responsibility]);
      }
    }
    for (const [roleId, responsibilities] of roleMap) {
      if (responsibilities.length > 1) {
        errors.push({
          code: 'FA-DRAFT-ROLE-002',
          path: `/activities/${activity.activity_id}/role_assignments`,
          message: `活动 "${activity.name}" 中角色 "${roleId}" 出现多个责任代码: ${responsibilities.join(', ')}`,
        });
      }
    }
  }

  // ── FA-DRAFT-BIND-001: 每个活动恰有一个主 Task 绑定 ──
  for (const activity of activities) {
    const bindings = diagram.task_bindings.filter(b => b.activity_id === activity.activity_id);
    if (bindings.length === 0) {
      errors.push({
        code: 'FA-DRAFT-BIND-001',
        path: `/activities/${activity.activity_id}/main_task_id`,
        message: `活动 "${activity.name}" 缺少主 Task 绑定`,
      });
    } else if (bindings.length > 1) {
      errors.push({
        code: 'FA-DRAFT-BIND-001',
        path: `/activities/${activity.activity_id}/main_task_id`,
        message: `活动 "${activity.name}" 有多个主 Task 绑定，应恰有一个`,
      });
    }
  }

  // ── FA-DRAFT-BIND-002: activity.main_task_id、binding.main_task_id 和 MAIN_TASK 节点一致 ──
  for (const activity of activities) {
    const binding = bindingForActivity(draft, activity.activity_id);
    if (!binding) continue;

    // binding.main_task_id 与 activity.main_task_id 必须一致
    if (binding.main_task_id !== activity.main_task_id) {
      errors.push({
        code: 'FA-DRAFT-BIND-002',
        path: `/activities/${activity.activity_id}/main_task_id`,
        message: `活动 "${activity.name}" 的 main_task_id "${activity.main_task_id}" 与 binding "${binding.main_task_id}" 不一致`,
      });
    }

    // binding.main_task_id 对应的节点类型必须是 MAIN_TASK
    const mainTaskNode = diagram.nodes.find(n => n.node_id === binding.main_task_id);
    if (mainTaskNode && mainTaskNode.node_type !== 'MAIN_TASK') {
      errors.push({
        code: 'FA-DRAFT-BIND-002',
        path: `/diagram/nodes/${binding.main_task_id}/node_type`,
        message: `活动 "${activity.name}" 的 main_task "${binding.main_task_id}" 节点类型为 "${mainTaskNode.node_type}"，应为 MAIN_TASK`,
      });
    }
  }

  // binding 也必须反向引用存在的活动和 MAIN_TASK。
  for (const binding of diagram.task_bindings) {
    const activity = activities.find(item => item.activity_id === binding.activity_id);
    const mainTaskNode = diagram.nodes.find(item => item.node_id === binding.main_task_id);
    if (!activity) {
      errors.push({
        code: 'FA-DRAFT-BIND-002',
        path: '/diagram/task_bindings',
        message: `Task binding 引用了不存在的活动 "${binding.activity_id}"`,
      });
    }
    if (!mainTaskNode || mainTaskNode.node_type !== 'MAIN_TASK') {
      errors.push({
        code: 'FA-DRAFT-BIND-002',
        path: '/diagram/task_bindings',
        message: `Task binding 的 main_task_id "${binding.main_task_id}" 未指向有效 MAIN_TASK`,
      });
    }
  }

  // ── FA-DRAFT-CONFIRM-001: 确认从 Task 三条件缺一不可 ──
  // ── FA-DRAFT-CONFIRM-002: confirmation 三方一致性 ──
  // ── FA-DRAFT-CONFIRM-003: REVIEW/DECISION 不得有 confirmation ──
  for (const activity of activities) {
    const binding = bindingForActivity(draft, activity.activity_id);
    const bindingConfTaskId = binding?.confirmation_task_id || null;
    const hasConfirmationDecl = activity.confirmation != null;
    const isReviewOrDecision = activity.activity_type === 'REVIEW_MEETING' || activity.activity_type === 'DECISION_ACTIVITY';

    // REVIEW/DECISION 不得有 confirmation（FA-DRAFT-CONFIRM-003）
    if (isReviewOrDecision && (hasConfirmationDecl || bindingConfTaskId != null)) {
      errors.push({
        code: 'FA-DRAFT-CONFIRM-003',
        path: `/activities/${activity.activity_id}/confirmation`,
        message: `${activity.activity_type} 活动 "${activity.name}" 不得把正式审批表示为 confirmation，应为独立活动`,
      });
    }

    // 三条件检查（只有有 confirmation 声明时检查）
    if (hasConfirmationDecl) {
      const conf = activity.confirmation;
      if (!conf.co_completes || !conf.confirm_bears_final_responsibility || !conf.no_formal_approval_meeting) {
        errors.push({
          code: 'FA-DRAFT-CONFIRM-001',
          path: `/activities/${activity.activity_id}/confirmation`,
          message: `活动 "${activity.name}" 的确认从 Task 三条件不全：co_completes=${conf.co_completes}, confirm_bears_final_responsibility=${conf.confirm_bears_final_responsibility}, no_formal_approval_meeting=${conf.no_formal_approval_meeting}`,
        });
      }
    }

    // 三方一致性检查（FA-DRAFT-CONFIRM-002）
    // activity 有 confirmation → binding 必须有 confirmation_task_id
    if (hasConfirmationDecl && bindingConfTaskId == null) {
      errors.push({
        code: 'FA-DRAFT-CONFIRM-002',
        path: `/activities/${activity.activity_id}/confirmation`,
        message: `活动 "${activity.name}" 有 confirmation 声明但 binding 缺少 confirmation_task_id`,
      });
    }

    // binding 有 confirmation_task_id → activity 必须有 confirmation 声明
    if (!hasConfirmationDecl && bindingConfTaskId != null) {
      errors.push({
        code: 'FA-DRAFT-CONFIRM-002',
        path: `/activities/${activity.activity_id}/confirmation`,
        message: `活动 "${activity.name}" 的 binding 有 confirmation_task_id "${bindingConfTaskId}" 但无 confirmation 声明`,
      });
    }

    // 如果两者都有，检查 CONFIRMATION_TASK 节点存在
    if (hasConfirmationDecl && bindingConfTaskId != null) {
      const confNode = diagram.nodes.find(n => n.node_id === bindingConfTaskId);
      if (!confNode) {
        errors.push({
          code: 'FA-DRAFT-CONFIRM-002',
          path: `/diagram/nodes/${bindingConfTaskId}`,
          message: `confirmation_task_id "${bindingConfTaskId}" 对应的 CONFIRMATION_TASK 节点不存在`,
        });
      } else if (confNode.node_type !== 'CONFIRMATION_TASK') {
        errors.push({
          code: 'FA-DRAFT-CONFIRM-002',
          path: `/diagram/nodes/${bindingConfTaskId}/node_type`,
          message: `confirmation_task_id "${bindingConfTaskId}" 对应节点类型为 "${confNode.node_type}"，应为 CONFIRMATION_TASK`,
        });
      }
    }
  }

  // ── FA-DRAFT-LANE-001: 主 Task 泳道与 R/O 一致；角色无泳道时失败关闭 ──
  for (const activity of activities) {
    const responsible = accountableRole(activity);
    if (!responsible) continue;

    const binding = bindingForActivity(draft, activity.activity_id);
    if (!binding) continue;

    const mainTaskNode = diagram.nodes.find(n => n.node_id === binding.main_task_id);
    if (!mainTaskNode) continue;

    // 找到 responsible 角色对应的泳道
    const expectedLane = findLaneForRole(diagram, responsible);
    if (!expectedLane) {
      // 角色找不到唯一泳道 → 失败关闭
      errors.push({
        code: 'FA-DRAFT-LANE-001',
        path: `/diagram/lanes`,
        message: `活动 "${activity.name}" 的责任角色 "${responsible}" 找不到对应泳道`,
      });
    } else if (mainTaskNode.lane_id !== expectedLane.lane_id) {
      errors.push({
        code: 'FA-DRAFT-LANE-001',
        path: `/diagram/nodes/${mainTaskNode.node_id}/lane_id`,
        message: `活动 "${activity.name}" 的主 Task 泳道 "${mainTaskNode.lane_id}" 与责任角色 "${responsible}" 对应的泳道 "${expectedLane.lane_id}" 不一致`,
      });
    }
  }

  // ── FA-DRAFT-LANE-002: confirmation 节点泳道检查 ──
  for (const activity of activities) {
    if (!activity.confirmation) continue;
    const binding = bindingForActivity(draft, activity.activity_id);
    if (!binding || binding.confirmation_task_id == null) continue;

    const confNode = diagram.nodes.find(n => n.node_id === binding.confirmation_task_id);
    if (!confNode) continue;

    const mainTaskNode = diagram.nodes.find(n => n.node_id === binding.main_task_id);

    // 确认角色必须找到泳道
    const confirmRoleId = activity.confirmation.confirm_role_id;
    const confirmLane = findLaneForRole(diagram, confirmRoleId);
    if (!confirmLane) {
      errors.push({
        code: 'FA-DRAFT-LANE-002',
        path: `/diagram/lanes`,
        message: `活动 "${activity.name}" 的确认角色 "${confirmRoleId}" 找不到对应泳道`,
      });
      continue;
    }

    // confirmation 节点必须位于确认角色泳道
    if (confNode.lane_id !== confirmLane.lane_id) {
      errors.push({
        code: 'FA-DRAFT-LANE-002',
        path: `/diagram/nodes/${confNode.node_id}/lane_id`,
        message: `confirmation 节点 "${confNode.node_id}" 泳道 "${confNode.lane_id}" 与确认角色 "${confirmRoleId}" 对应泳道 "${confirmLane.lane_id}" 不一致`,
      });
    }

    // confirmation 泳道必须不同于主 Task 泳道
    if (mainTaskNode && confNode.lane_id === mainTaskNode.lane_id) {
      errors.push({
        code: 'FA-DRAFT-LANE-002',
        path: `/diagram/nodes/${confNode.node_id}/lane_id`,
        message: `confirmation 节点 "${confNode.node_id}" 与主 Task "${mainTaskNode.node_id}" 位于同一泳道 "${confNode.lane_id}"，确认从 Task 必须位于不同泳道`,
      });
    }
  }

  // ── FA-DRAFT-PARALLEL-001: 同一 L5 内禁止并行 Task ──
  const activityTaskCounts = new Map();
  for (const binding of diagram.task_bindings) {
    const key = binding.activity_id;
    const count = (activityTaskCounts.get(key) || 0) + 1;
    activityTaskCounts.set(key, count);
  }
  for (const [activityId, count] of activityTaskCounts) {
    // 主 Task + 可选确认从 Task = 最多 2 个 Task 节点
    // 但如果有多个 MAIN_TASK 绑定到同一个 activity，那就是并行 Task 违规
    const bindings = diagram.task_bindings.filter(b => b.activity_id === activityId);
    const mainTaskIds = bindings.map(b => b.main_task_id);
    // 检查是否有多个不同的 main_task_id
    const uniqueMainTasks = new Set(mainTaskIds);
    if (uniqueMainTasks.size > 1) {
      const activity = activities.find(a => a.activity_id === activityId);
      errors.push({
        code: 'FA-DRAFT-PARALLEL-001',
        path: `/activities/${activityId}/main_task_id`,
        message: `活动 "${activity?.name || activityId}" 有多个主 Task，同一 L5 内禁止并行 Task`,
      });
    }
  }

  // ── F4: FA-DRAFT-BINDING-001 (反向): 每个 MAIN_TASK 必须恰好被一个 binding 引用 ──
  const mainTaskNodes = diagram.nodes.filter(n => n.node_type === 'MAIN_TASK');
  for (const mt of mainTaskNodes) {
    const referencingBindings = diagram.task_bindings.filter(b => b.main_task_id === mt.node_id);
    if (referencingBindings.length === 0) {
      errors.push({
        code: 'FA-DRAFT-BINDING-001',
        path: `/diagram/nodes/${mt.node_id}`,
        message: `MAIN_TASK "${mt.node_id}" 未被任何 task_binding 引用`,
      });
    } else if (referencingBindings.length > 1) {
      errors.push({
        code: 'FA-DRAFT-BINDING-002',
        path: '/diagram/task_bindings',
        message: `MAIN_TASK "${mt.node_id}" 被 ${referencingBindings.length} 个 binding 引用，必须恰好一个`,
      });
    }
  }

  if (isLeafL4(card)) {
    // ── FA-DRAFT-CARD-002: 末端 L4 必须恰有一个开始事件 ──
    const startEventCount = diagram.nodes.filter(n => n.node_type === 'START_EVENT').length;
    if (startEventCount !== 1) {
      errors.push({
        code: 'FA-DRAFT-CARD-002',
        path: '/diagram/nodes',
        message: `末端 L4 流程必须恰好一个开始事件，当前 ${startEventCount} 个`,
      });
    } else {
      const startNode = diagram.nodes.find(n => n.node_type === 'START_EVENT');
      if (card.start?.event_id !== startNode.node_id || card.start?.name !== startNode.name) {
        errors.push({
          code: 'FA-DRAFT-CARD-004',
          path: '/process_card/start',
          message: `流程卡片起点必须与 START_EVENT 的 ID 和名称一致：卡片 ${card.start?.event_id}/${card.start?.name}，图 ${startNode.node_id}/${startNode.name}`,
        });
      }
    }

    // ── FA-DRAFT-CARD-003: 末端 L4 必须有至少一个结束事件 ──
    const hasEndEvent = diagram.nodes.some(n => n.node_type === 'END_EVENT');
    if (!hasEndEvent) {
      errors.push({
        code: 'FA-DRAFT-CARD-003',
        path: '/diagram/nodes',
        message: '末端 L4 流程必须包含至少一个结束事件',
      });
    } else {
      const endNodes = diagram.nodes.filter(n => n.node_type === 'END_EVENT');
      const endResults = card.end_results || [];
      const endNodeById = new Map(endNodes.map(node => [node.node_id, node]));
      const resultById = new Map(endResults.map(result => [result.event_id, result]));
      const inconsistent = endNodes.length !== endResults.length
        || endResults.some(result => {
          const node = endNodeById.get(result.event_id);
          return !node || node.name !== result.name;
        })
        || endNodes.some(node => !resultById.has(node.node_id));
      if (inconsistent) {
        errors.push({
          code: 'FA-DRAFT-CARD-005',
          path: '/process_card/end_results',
          message: '流程卡片业务终点必须与 END_EVENT 的 ID、名称和集合完全一致',
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
