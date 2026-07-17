/**
 * 业务合同结构命令
 *
 * 确定性命令模块：从 DraftStore 读取快照，在克隆上修改后一次性恢复。
 * 命令不直接访问 DOM/modeler，仅操作业务合同；调用结果由自动布局事务负责提交或回滚。
 *
 * ID 分配规则：从当前已有稳定 ID 集合确定性地产生最小可用后缀。
 */

// ─── 工具函数 ────────────────────────────────────────────────

/**
 * 计算最小可用后缀 ID
 * @param {Set<string>} existingIds - 已存在的 ID 集合
 * @param {string} prefix - ID 前缀
 * @returns {string} 新的唯一 ID
 */
function nextAvailableId(existingIds, prefix) {
  let suffix = 1;
  while (existingIds.has(`${prefix}_${suffix}`)) {
    suffix++;
  }
  return `${prefix}_${suffix}`;
}

/**
 * 从当前快照生成稳定的活动 ID
 * @param {object} snapshot - 快照
 * @param {Set<string>} [usedIds] - 本次命令已分配的 ID 集合（防止同快照重复分配）
 */
function generateActivityId(snapshot, usedIds) {
  const existingIds = new Set(snapshot.activities.map(a => a.activity_id));
  if (usedIds) for (const id of usedIds) existingIds.add(id);
  const newId = nextAvailableId(existingIds, 'Activity');
  if (usedIds) usedIds.add(newId);
  return newId;
}

/**
 * 从当前快照生成稳定的节点 ID
 * @param {object} snapshot - 快照
 * @param {string} prefix - ID 前缀
 * @param {Set<string>} [usedIds] - 本次命令已分配的 ID 集合
 */
function generateNodeId(snapshot, prefix, usedIds) {
  const existingIds = new Set(snapshot.diagram.nodes.map(n => n.node_id));
  if (usedIds) for (const id of usedIds) existingIds.add(id);
  const newId = nextAvailableId(existingIds, prefix);
  if (usedIds) usedIds.add(newId);
  return newId;
}

/**
 * 从当前快照生成稳定的流 ID
 * @param {object} snapshot - 快照
 * @param {Set<string>} [usedIds] - 本次命令已分配的 ID 集合
 */
function generateFlowId(snapshot, usedIds) {
  const existingIds = new Set(snapshot.diagram.flows.map(f => f.flow_id));
  if (usedIds) for (const id of usedIds) existingIds.add(id);
  const newId = nextAvailableId(existingIds, 'Flow');
  if (usedIds) usedIds.add(newId);
  return newId;
}

function generateLaneId(snapshot) {
  return nextAvailableId(new Set(snapshot.diagram.lanes.map(l => l.lane_id)), 'Lane');
}

function bypassNodes(snapshot, nodeIds) {
  const ids = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  const incoming = snapshot.diagram.flows.filter(
    flow => ids.has(flow.target_ref) && !ids.has(flow.source_ref),
  );
  const outgoing = snapshot.diagram.flows.filter(
    flow => ids.has(flow.source_ref) && !ids.has(flow.target_ref),
  );
  const usedIds = new Set();
  snapshot.diagram.flows = snapshot.diagram.flows.filter(
    flow => !ids.has(flow.source_ref) && !ids.has(flow.target_ref),
  );
  for (const sourceFlow of incoming) {
    for (const targetFlow of outgoing) {
      if (sourceFlow.source_ref === targetFlow.target_ref) continue;
      if (snapshot.diagram.flows.some(
        flow => flow.source_ref === sourceFlow.source_ref
          && flow.target_ref === targetFlow.target_ref,
      )) continue;
      snapshot.diagram.flows.push({
        flow_id: generateFlowId(snapshot, usedIds),
        source_ref: sourceFlow.source_ref,
        target_ref: targetFlow.target_ref,
        condition: targetFlow.condition || sourceFlow.condition || null,
      });
    }
  }
}

function bypassNode(snapshot, nodeId) {
  bypassNodes(snapshot, new Set([nodeId]));
}

/**
 * 获取节点所在泳道的角色 ID
 */
function getNodeLaneRoleId(snapshot, nodeId) {
  const node = snapshot.diagram.nodes.find(n => n.node_id === nodeId);
  if (!node || !node.lane_id) return null;

  const lane = snapshot.diagram.lanes.find(l => l.lane_id === node.lane_id);
  return lane ? lane.role_id : null;
}

// ─── 结构命令 ────────────────────────────────────────────────

/**
 * 在所选节点后插入新 L5 活动
 *
 * @param {object} store - DraftStore 实例
 * @param {string} selectedNodeId - 所选节点 ID
 * @param {object} activitySeed - 活动种子数据
 * @param {string} activitySeed.activity_id - 活动 ID
 * @param {string} activitySeed.name - 活动名称
 * @returns {{ activity_id: string, task_id: string }}
 */
export function insertL5After(store, selectedNodeId, activitySeed) {
  const snapshot = store.snapshot();

  // 1. 确定角色（FA-DRAFT-ROLE-001）
  const role_id = getNodeLaneRoleId(snapshot, selectedNodeId);
  if (!role_id) {
    throw new Error('FA-DRAFT-ROLE-001: 无法确定所选节点的角色，请确保节点已分配泳道');
  }

  const lane_id = snapshot.diagram.nodes.find(n => n.node_id === selectedNodeId)?.lane_id;
  if (!lane_id) {
    throw new Error('FA-DRAFT-ROLE-001: 无法确定所选节点的泳道');
  }

  // 跟踪本命令已分配的所有 ID
  const usedIds = new Set();

  // 2. 生成稳定 ID
  const activity_id = activitySeed.activity_id || generateActivityId(snapshot, usedIds);
  const task_id = generateNodeId(snapshot, 'Task', usedIds);

  // 3. 创建活动
  const activity = {
    activity_id,
    name: activitySeed.name,
    description: '',
    activity_type: 'STANDARD',
    responsibility_model: 'RASCI',
    role_assignments: [{ role_id, responsibility: 'R' }],
    sla: null,
    tools: [],
    inputs: [],
    process_summary: '',
    outputs: [],
    completion_criteria: [],
    references: [],
    main_task_id: task_id,
    confirmation: null,
    completeness: 'NEEDS_CONFIRMATION',
  };

  // 4. 创建主 Task 节点
  const taskNode = {
    node_id: task_id,
    node_type: 'MAIN_TASK',
    name: activitySeed.name,
    lane_id,
  };

  // 5. 创建 binding
  const binding = {
    activity_id,
    main_task_id: task_id,
    confirmation_task_id: null,
  };

  // 6. 重连流：selected -> new -> oldTargets
  const oldOutgoingFlows = snapshot.diagram.flows.filter(f => f.source_ref === selectedNodeId);
  const newFlows = [];

  // selected -> new
  const flowToNew = {
    flow_id: generateFlowId(snapshot, usedIds),
    source_ref: selectedNodeId,
    target_ref: task_id,
    condition: null,
  };
  newFlows.push(flowToNew);

  // new -> oldTargets（保留旧条件）
  for (const oldFlow of oldOutgoingFlows) {
    const flowFromNew = {
      flow_id: generateFlowId(snapshot, usedIds),
      source_ref: task_id,
      target_ref: oldFlow.target_ref,
      condition: oldFlow.condition,
    };
    newFlows.push(flowFromNew);
  }

  // 7. 更新快照
  const newSnapshot = structuredClone(snapshot);
  newSnapshot.activities.push(activity);
  newSnapshot.diagram.nodes.push(taskNode);
  newSnapshot.diagram.task_bindings.push(binding);
  newSnapshot.diagram.flows = newSnapshot.diagram.flows.filter(f => f.source_ref !== selectedNodeId);
  newSnapshot.diagram.flows.push(...newFlows);

  store.restore(newSnapshot);

  return { activity_id, task_id };
}

/**
 * 在所选节点后追加网关分支
 *
 * @param {object} store - DraftStore 实例
 * @param {string} selectedNodeId - 所选节点 ID
 * @param {string} gatewayType - 网关类型（XOR/AND/OR）
 * @param {Array} branches - 分支定义数组
 * @param {string} branches[].label - 分支标签
 * @param {object} branches[].condition - 分支条件
 * @returns {{ gateway_id: string, branch_tasks: string[] }}
 */
export function appendGatewayBranch(store, selectedNodeId, gatewayType, branches) {
  const snapshot = store.snapshot();

  const lane_id = snapshot.diagram.nodes.find(n => n.node_id === selectedNodeId)?.lane_id;
  const role_id = getNodeLaneRoleId(snapshot, selectedNodeId);

  // 跟踪本命令已分配的所有 ID，防止同一快照重复分配
  const usedIds = new Set();

  // 1. 生成 ID
  const gateway_id = generateNodeId(snapshot, 'Gateway', usedIds);
  const branchTaskIds = branches.map(() => generateNodeId(snapshot, 'Task', usedIds));

  // 2. 创建网关节点（不绑定活动）
  const gatewayNodeType = {
    XOR: 'GATEWAY_XOR',
    AND: 'GATEWAY_AND',
    OR: 'GATEWAY_OR',
  }[gatewayType] || 'GATEWAY_XOR';

  const gatewayNode = {
    node_id: gateway_id,
    node_type: gatewayNodeType,
    name: `网关 ${gatewayType}`,
    lane_id: lane_id || null,
  };

  // 3. 创建分支 Task 和活动
  const branchNodes = [];
  const branchActivities = [];
  const branchBindings = [];

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const activity_id = generateActivityId(snapshot, usedIds);
    const task_id = branchTaskIds[i];

    branchNodes.push({
      node_id: task_id,
      node_type: 'MAIN_TASK',
      name: branch.label,
      lane_id: lane_id || null,
    });

    branchActivities.push({
      activity_id,
      name: branch.label,
      description: '',
      activity_type: 'STANDARD',
      responsibility_model: 'RASCI',
      role_assignments: role_id ? [{ role_id, responsibility: 'R' }] : [],
      sla: null,
      tools: [],
      inputs: [],
      process_summary: '',
      outputs: [],
      completion_criteria: [],
      references: [],
      main_task_id: task_id,
      confirmation: null,
      completeness: 'NEEDS_CONFIRMATION',
    });

    branchBindings.push({
      activity_id,
      main_task_id: task_id,
      confirmation_task_id: null,
    });
  }

  // 4. 重连流
  const oldOutgoingFlows = snapshot.diagram.flows.filter(f => f.source_ref === selectedNodeId);
  const newFlows = [];

  // selected -> gateway
  const flowToGateway = {
    flow_id: generateFlowId(snapshot, usedIds),
    source_ref: selectedNodeId,
    target_ref: gateway_id,
    condition: null,
  };
  newFlows.push(flowToGateway);

  // gateway -> branchTasks（带条件）
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const flowFromGateway = {
      flow_id: generateFlowId(snapshot, usedIds),
      source_ref: gateway_id,
      target_ref: branchTaskIds[i],
      condition: gatewayType === 'AND' ? null : (branch.condition ? { ...branch.condition, label: branch.condition.label || branch.label } : null),
    };
    newFlows.push(flowFromGateway);
  }

  // branchTasks -> oldTargets
  for (let i = 0; i < branches.length; i++) {
    const task_id = branchTaskIds[i];
    for (const oldFlow of oldOutgoingFlows) {
      const flowFromBranch = {
        flow_id: generateFlowId(snapshot, usedIds),
        source_ref: task_id,
        target_ref: oldFlow.target_ref,
        condition: oldFlow.condition,
      };
      newFlows.push(flowFromBranch);
    }
  }

  // 5. 更新快照（原子操作：新对象一次性替换）
  const newSnapshot = structuredClone(snapshot);
  newSnapshot.diagram.nodes.push(gatewayNode, ...branchNodes);
  newSnapshot.activities.push(...branchActivities);
  newSnapshot.diagram.task_bindings.push(...branchBindings);
  newSnapshot.diagram.flows = newSnapshot.diagram.flows.filter(f => f.source_ref !== selectedNodeId);
  newSnapshot.diagram.flows.push(...newFlows);

  store.restore(newSnapshot);

  return {
    gateway_id,
    branch_tasks: branchTaskIds,
  };
}

/**
 * 删除节点及相关元素
 *
 * @param {object} store - DraftStore 实例
 * @param {string} nodeId - 要删除的节点 ID
 * @returns {{ deleted: string[] }}
 */
export function deleteNode(store, nodeId) {
  const snapshot = store.snapshot();
  const node = snapshot.diagram.nodes.find(n => n.node_id === nodeId);

  if (!node) {
    throw new Error(`节点不存在：${nodeId}`);
  }

  if (node.node_type === 'START_EVENT') {
    throw new Error('开始事件由流程卡片维护，不允许删除');
  }
  if (node.node_type === 'END_EVENT'
    && snapshot.diagram.nodes.filter(item => item.node_type === 'END_EVENT').length <= 1) {
    throw new Error('流程必须保留至少一个结束事件');
  }

  const deletedIds = new Set([nodeId]);

  // 1. 如果是主 Task，删除关联的活动、binding 和 confirmation
  if (node.node_type === 'MAIN_TASK') {
    const binding = snapshot.diagram.task_bindings.find(b => b.main_task_id === nodeId);
    if (binding) {
      // 删除活动
      snapshot.activities = snapshot.activities.filter(a => a.activity_id !== binding.activity_id);
      // 删除 binding
      snapshot.diagram.task_bindings = snapshot.diagram.task_bindings.filter(
        b => b.activity_id !== binding.activity_id
      );

      // 如果有确认 Task，也删除
      if (binding.confirmation_task_id) {
        deletedIds.add(binding.confirmation_task_id);
      }
    }
  }

  // 2. 如果是确认 Task，仅取消 confirmation
  if (node.node_type === 'CONFIRMATION_TASK') {
    const binding = snapshot.diagram.task_bindings.find(b => b.confirmation_task_id === nodeId);
    if (binding) {
      // 找到关联的活动并取消 confirmation
      const activity = snapshot.activities.find(a => a.activity_id === binding.activity_id);
      if (activity) {
        activity.confirmation = null;
      }
      binding.confirmation_task_id = null;
    }
  }

  // 3. 删除前旁路重连外部前驱与后继
  bypassNodes(snapshot, deletedIds);

  // 4. 删除节点并同步流程级结束结果
  snapshot.diagram.nodes = snapshot.diagram.nodes.filter(
    item => !deletedIds.has(item.node_id),
  );
  if (node.node_type === 'END_EVENT') {
    snapshot.process_card.end_results = snapshot.process_card.end_results.filter(
      result => result.event_id !== nodeId,
    );
  }

  store.restore(snapshot);

  return { deleted: [...deletedIds] };
}

/**
 * 将活动移动到主责角色的泳道
 *
 * @param {object} store - DraftStore 实例
 * @param {string} activityId - 活动 ID
 * @returns {{ old_lane_id: string, new_lane_id: string }}
 */
export function moveActivityToAccountableLane(store, activityId) {
  const snapshot = store.snapshot();
  const activity = snapshot.activities.find(a => a.activity_id === activityId);

  if (!activity) {
    throw new Error(`活动不存在：${activityId}`);
  }

  // 1. 获取主责角色
  const accountableCode = activity.responsibility_model === 'OARP' ? 'O' : 'R';
  const accountableRoles = activity.role_assignments.filter(
    role => role.responsibility === accountableCode,
  );
  if (accountableRoles.length !== 1) {
    throw new Error(`活动必须恰有一个 ${accountableCode} 主责角色，当前 ${accountableRoles.length} 个`);
  }
  const [accountableRole] = accountableRoles;

  // 2. 查找对应泳道
  const targetLane = snapshot.diagram.lanes.find(l => l.role_id === accountableRole.role_id);
  if (!targetLane) {
    throw new Error(`没有对应泳道：${accountableRole.role_id}`);
  }

  // 3. 更新主 Task 的泳道
  const mainTask = snapshot.diagram.nodes.find(n => n.node_id === activity.main_task_id);
  if (!mainTask) {
    throw new Error(`主 Task 不存在：${activity.main_task_id}`);
  }

  const old_lane_id = mainTask.lane_id;
  mainTask.lane_id = targetLane.lane_id;

  // 4. 确认从 Task 始终留在确认角色对应的泳道
  const binding = snapshot.diagram.task_bindings.find(b => b.activity_id === activityId);
  if (binding && binding.confirmation_task_id) {
    const confirmTask = snapshot.diagram.nodes.find(n => n.node_id === binding.confirmation_task_id);
    if (confirmTask) {
      const confirmRoleId = activity.confirmation?.confirm_role_id;
      const confirmLane = snapshot.diagram.lanes.find(l => l.role_id === confirmRoleId);
      if (!confirmLane) throw new Error(`没有确认角色对应泳道：${confirmRoleId}`);
      confirmTask.lane_id = confirmLane.lane_id;
    }
  }

  store.restore(snapshot);

  return { old_lane_id, new_lane_id: targetLane.lane_id };
}

/**
 * 添加泳道
 *
 * @param {object} store - DraftStore 实例
 * @param {object} laneSeed - 泳道种子数据
 * @param {string} laneSeed.lane_id - 泳道 ID
 * @param {string} laneSeed.name - 泳道名称
 * @param {string} laneSeed.role_id - 角色 ID
 * @returns {{ lane_id: string }}
 */
export function addLane(store, laneSeed) {
  const snapshot = store.snapshot();
  const lane_id = laneSeed.lane_id || generateLaneId(snapshot);

  if (snapshot.diagram.lanes.some(lane => lane.lane_id === lane_id)) {
    throw new Error(`泳道 ID 已存在：${lane_id}`);
  }
  if (snapshot.diagram.lanes.some(lane => lane.role_id === laneSeed.role_id)) {
    throw new Error(`角色泳道已存在：${laneSeed.role_id}`);
  }

  const lane = {
    lane_id,
    name: laneSeed.name,
    role_id: laneSeed.role_id,
  };

  snapshot.diagram.lanes.push(lane);
  store.restore(snapshot);

  return { lane_id };
}

/**
 * 在所选节点后添加中间事件
 *
 * @param {object} store - DraftStore 实例
 * @param {string} selectedNodeId - 所选节点 ID
 * @param {object} eventSeed - 事件种子数据
 * @param {string} eventSeed.node_id - 节点 ID
 * @param {string} eventSeed.name - 事件名称
 * @param {string} eventSeed.event_type - 事件类型
 * @returns {{ node_id: string }}
 */
export function addIntermediateEventAfter(store, selectedNodeId, eventSeed) {
  const snapshot = store.snapshot();
  const usedIds = new Set();
  const node_id = eventSeed.node_id || generateNodeId(snapshot, 'Intermediate', usedIds);

  const lane_id = snapshot.diagram.nodes.find(n => n.node_id === selectedNodeId)?.lane_id;

  // 1. 创建中间事件节点
  const eventNode = {
    node_id,
    node_type: eventSeed.event_type,
    name: eventSeed.name,
    lane_id: lane_id || null,
  };

  // 2. 重连流
  const oldOutgoingFlows = snapshot.diagram.flows.filter(f => f.source_ref === selectedNodeId);
  const newFlows = [];

  // selected -> event
  const flowToEvent = {
    flow_id: generateFlowId(snapshot, usedIds),
    source_ref: selectedNodeId,
    target_ref: node_id,
    condition: null,
  };
  newFlows.push(flowToEvent);

  // event -> oldTargets
  for (const oldFlow of oldOutgoingFlows) {
    const flowFromEvent = {
      flow_id: generateFlowId(snapshot, usedIds),
      source_ref: node_id,
      target_ref: oldFlow.target_ref,
      condition: oldFlow.condition,
    };
    newFlows.push(flowFromEvent);
  }

  // 3. 更新快照（原子操作：新对象一次性替换）
  const newSnapshot = structuredClone(snapshot);
  newSnapshot.diagram.nodes.push(eventNode);
  newSnapshot.diagram.flows = newSnapshot.diagram.flows.filter(f => f.source_ref !== selectedNodeId);
  newSnapshot.diagram.flows.push(...newFlows);

  store.restore(newSnapshot);

  return { node_id };
}

/**
 * 在所选节点后添加结束结果
 *
 * @param {object} store - DraftStore 实例
 * @param {string} selectedNodeId - 所选节点 ID
 * @param {object} endSeed - 结束结果种子数据
 * @param {string} endSeed.event_id - 事件 ID
 * @param {string} endSeed.name - 结束结果名称
 * @returns {{ event_id: string }}
 */
export function addEndResultAfter(store, selectedNodeId, endSeed) {
  const snapshot = store.snapshot();
  const event_id = endSeed.event_id || generateNodeId(snapshot, 'End');

  const lane_id = snapshot.diagram.nodes.find(n => n.node_id === selectedNodeId)?.lane_id;

  // 1. 创建结束事件节点
  const endNode = {
    node_id: event_id,
    node_type: 'END_EVENT',
    name: endSeed.name,
    lane_id: lane_id || null,
  };

  // 2. 重连流：selected -> end
  const flowToEnd = {
    flow_id: generateFlowId(snapshot),
    source_ref: selectedNodeId,
    target_ref: event_id,
    condition: null,
  };

  // 3. 更新快照（原子操作：新对象一次性替换）
  const newSnapshot = structuredClone(snapshot);
  newSnapshot.process_card.end_results.push({
    event_id,
    name: endSeed.name,
  });
  newSnapshot.diagram.nodes.push(endNode);
  newSnapshot.diagram.flows.push(flowToEnd);

  store.restore(newSnapshot);

  return { event_id };
}

/** 同步流程卡片起点与唯一 START_EVENT。 */
export function updateStartEvent(store, start) {
  const snapshot = store.snapshot();
  const startNodes = snapshot.diagram.nodes.filter(node => node.node_type === 'START_EVENT');
  if (startNodes.length !== 1) {
    throw new Error(`FA-DRAFT-CARD-002: 流程必须恰好一个开始事件，当前 ${startNodes.length} 个`);
  }
  const startNode = startNodes[0];
  const newSnapshot = structuredClone(snapshot);
  newSnapshot.process_card.start = {
    ...structuredClone(start),
    event_id: startNode.node_id,
  };
  const target = newSnapshot.diagram.nodes.find(node => node.node_id === startNode.node_id);
  target.name = start.name;
  store.restore(newSnapshot);
  return { event_id: startNode.node_id };
}

/** 同步业务终点名称与对应 END_EVENT。 */
export function renameEndResult(store, eventId, name) {
  const snapshot = store.snapshot();
  const result = snapshot.process_card.end_results.find(item => item.event_id === eventId);
  const node = snapshot.diagram.nodes.find(
    item => item.node_id === eventId && item.node_type === 'END_EVENT',
  );
  if (!result || !node) {
    throw new Error(`FA-DRAFT-CARD-003: 业务终点与结束事件不一致：${eventId}`);
  }
  const newSnapshot = structuredClone(snapshot);
  newSnapshot.process_card.end_results.find(item => item.event_id === eventId).name = name;
  newSnapshot.diagram.nodes.find(item => item.node_id === eventId).name = name;
  store.restore(newSnapshot);
  return { event_id: eventId };
}

/**
 * 连接两个节点
 *
 * @param {object} store - DraftStore 实例
 * @param {string} sourceRef - 源节点 ID
 * @param {string} targetRef - 目标节点 ID
 * @param {object|null} condition - 流条件
 * @returns {{ flow_id: string }}
 */
export function connectNodes(store, sourceRef, targetRef, condition) {
  const snapshot = store.snapshot();

  if (!snapshot.diagram.nodes.some(node => node.node_id === sourceRef)) {
    throw new Error(`源节点不存在：${sourceRef}`);
  }
  if (!snapshot.diagram.nodes.some(node => node.node_id === targetRef)) {
    throw new Error(`目标节点不存在：${targetRef}`);
  }
  if (snapshot.diagram.flows.some(
    flow => flow.source_ref === sourceRef && flow.target_ref === targetRef,
  )) {
    throw new Error(`顺序流已存在：${sourceRef} → ${targetRef}`);
  }

  // F3: 顺序流结构门禁
  if (sourceRef === targetRef) {
    throw new Error('FA-DRAFT-FLOW-001: 不允许创建自环连接');
  }

  const sourceNode = snapshot.diagram.nodes.find(n => n.node_id === sourceRef);
  const targetNode = snapshot.diagram.nodes.find(n => n.node_id === targetRef);

  if (sourceNode.node_type === 'END_EVENT') {
    throw new Error('FA-DRAFT-FLOW-001: 不允许从结束事件出发创建连接');
  }
  if (targetNode.node_type === 'START_EVENT') {
    throw new Error('FA-DRAFT-FLOW-001: 不允许指向开始事件创建连接');
  }

  const flow_id = generateFlowId(snapshot);

  const flow = {
    flow_id,
    source_ref: sourceRef,
    target_ref: targetRef,
    condition: condition || null,
  };

  const newSnapshot = structuredClone(snapshot);
  newSnapshot.diagram.flows.push(flow);
  store.restore(newSnapshot);

  return { flow_id };
}

/**
 * 添加确认 Task
 *
 * @param {object} store - DraftStore 实例
 * @param {string} activityId - 活动 ID
 * @param {string} confirmRoleId - 确认角色 ID
 * @returns {{ confirmation_task_id: string }}
 */
export function addConfirmationTask(store, activityId, declaration) {
  const snapshot = store.snapshot();
  const activity = snapshot.activities.find(a => a.activity_id === activityId);

  if (!activity) {
    throw new Error(`活动不存在：${activityId}`);
  }

  // 1. 验证三条件（FA-DRAFT-CONFIRM-001）
  const {
    confirm_role_id: confirmRoleId,
    co_completes: coCompletes,
    confirm_bears_final_responsibility: bearsFinalResponsibility,
    no_formal_approval_meeting: noFormalApprovalMeeting,
  } = declaration || {};

  if (!confirmRoleId) {
    throw new Error('FA-DRAFT-CONFIRM-001: 确认角色不能为空');
  }
  if (coCompletes !== true || bearsFinalResponsibility !== true || noFormalApprovalMeeting !== true) {
    throw new Error('FA-DRAFT-CONFIRM-001: 确认从 Task 的三个条件必须全部满足，否则请创建独立审批 L5 活动');
  }
  if (activity.confirmation) {
    throw new Error('FA-DRAFT-CONFIRM-001: 该活动已存在确认从 Task');
  }

  // 获取主责角色
  let mainRoleId;
  if (activity.responsibility_model === 'OARP') {
    const mainRole = activity.role_assignments.find(r => r.responsibility === 'O');
    mainRoleId = mainRole?.role_id;
  } else {
    const mainRole = activity.role_assignments.find(r => r.responsibility === 'R');
    mainRoleId = mainRole?.role_id;
  }

  if (mainRoleId && confirmRoleId === mainRoleId) {
    throw new Error('FA-DRAFT-CONFIRM-001: 确认角色不能与主责角色相同');
  }

  // 2. 生成 ID
  const confirmation_task_id = generateNodeId(snapshot, 'ConfirmTask');

  // 3. 确认从 Task 放在确认角色对应的泳道
  const confirmLane = snapshot.diagram.lanes.find(l => l.role_id === confirmRoleId);
  if (!confirmLane) {
    throw new Error(`FA-DRAFT-CONFIRM-001: 没有确认角色对应泳道：${confirmRoleId}`);
  }

  // 4. 创建确认 Task 节点
  const confirmTaskNode = {
    node_id: confirmation_task_id,
    node_type: 'CONFIRMATION_TASK',
    name: `确认：${activity.name}`,
    lane_id: confirmLane.lane_id,
  };

  // 5. 更新快照（原子操作：新对象一次性替换）
  const newSnapshot = structuredClone(snapshot);
  const newActivity = newSnapshot.activities.find(a => a.activity_id === activityId);
  newActivity.confirmation = {
    confirmation_task_id,
    confirm_role_id: confirmRoleId,
    co_completes: coCompletes,
    confirm_bears_final_responsibility: bearsFinalResponsibility,
    no_formal_approval_meeting: noFormalApprovalMeeting,
  };

  // 6. 更新 binding
  const newBinding = newSnapshot.diagram.task_bindings.find(b => b.activity_id === activityId);
  if (newBinding) {
    newBinding.confirmation_task_id = confirmation_task_id;
  }

  // 7. 将确认从 Task 串行插入主 Task 之后
  const oldOutgoingFlows = newSnapshot.diagram.flows.filter(
    flow => flow.source_ref === activity.main_task_id,
  );
  const usedIds = new Set();
  newSnapshot.diagram.flows = newSnapshot.diagram.flows.filter(
    flow => flow.source_ref !== activity.main_task_id,
  );
  newSnapshot.diagram.flows.push({
    flow_id: generateFlowId(newSnapshot, usedIds),
    source_ref: activity.main_task_id,
    target_ref: confirmation_task_id,
    condition: null,
  });
  for (const oldFlow of oldOutgoingFlows) {
    newSnapshot.diagram.flows.push({
      flow_id: generateFlowId(newSnapshot, usedIds),
      source_ref: confirmation_task_id,
      target_ref: oldFlow.target_ref,
      condition: oldFlow.condition,
    });
  }

  // 8. 更新快照
  newSnapshot.diagram.nodes.push(confirmTaskNode);
  store.restore(newSnapshot);

  return { confirmation_task_id };
}

/**
 * 移除确认 Task
 *
 * @param {object} store - DraftStore 实例
 * @param {string} activityId - 活动 ID
 * @returns {{ removed: boolean }}
 */
export function removeConfirmationTask(store, activityId) {
  const snapshot = store.snapshot();
  const activity = snapshot.activities.find(a => a.activity_id === activityId);

  if (!activity) {
    throw new Error(`活动不存在：${activityId}`);
  }

  if (!activity.confirmation) {
    return { removed: false };
  }

  const confirmation_task_id = activity.confirmation.confirmation_task_id;

  // 原子操作：新对象一次性替换
  const newSnapshot = structuredClone(snapshot);

  // 1. 旁路确认 Task，恢复主 Task 到后继节点的连接
  bypassNode(newSnapshot, confirmation_task_id);

  // 2. 删除确认 Task 节点
  newSnapshot.diagram.nodes = newSnapshot.diagram.nodes.filter(
    n => n.node_id !== confirmation_task_id
  );

  // 3. 清空 confirmation
  const newActivity = newSnapshot.activities.find(a => a.activity_id === activityId);
  newActivity.confirmation = null;

  // 4. 更新 binding
  const newBinding = newSnapshot.diagram.task_bindings.find(b => b.activity_id === activityId);
  if (newBinding) {
    newBinding.confirmation_task_id = null;
  }

  store.restore(newSnapshot);

  return { removed: true };
}

/**
 * 在流程中添加新的 L5 活动（无需选中节点）
 *
 * 自动寻找插入点：将新活动插入到流程中最后一个 END_EVENT 前的
 * 最后一个 MAIN_TASK 之后。
 *
 * @param {object} store - DraftStore 实例
 * @param {object} activitySeed - 活动种子数据
 * @param {string} activitySeed.name - 活动名称
 * @param {string} [activitySeed.role_id] - 主责角色 ID
 * @returns {{ activity_id: string, task_id: string }}
 */
export function addL5Activity(store, activitySeed) {
  const snapshot = store.snapshot();

  // 1. 确定插入点：找到最后一个 END_EVENT，再找它之前的最后一个 MAIN_TASK
  const endEvents = snapshot.diagram.nodes.filter(n => n.node_type === 'END_EVENT');
  if (endEvents.length === 0) {
    throw new Error('FA-DRAFT-ROLE-001: 流程中没有结束事件，无法确定插入点');
  }

  // 找到连接到 END_EVENT 的最后一个 MAIN_TASK
  let insertAfterId = null;
  for (const endEvent of endEvents) {
    const incomingFlows = snapshot.diagram.flows.filter(f => f.target_ref === endEvent.node_id);
    for (const flow of incomingFlows) {
      const sourceNode = snapshot.diagram.nodes.find(n => n.node_id === flow.source_ref);
      if (sourceNode && sourceNode.node_type === 'MAIN_TASK') {
        insertAfterId = sourceNode.node_id;
        break;
      }
    }
    if (insertAfterId) break;
  }

  // 如果没有找到，使用 START_EVENT
  if (!insertAfterId) {
    const startEvent = snapshot.diagram.nodes.find(n => n.node_type === 'START_EVENT');
    if (startEvent) {
      insertAfterId = startEvent.node_id;
    } else {
      throw new Error('FA-DRAFT-ROLE-001: 无法确定插入点');
    }
  }

  // 2. 确定角色
  const lane_id = snapshot.diagram.nodes.find(n => n.node_id === insertAfterId)?.lane_id;
  const role_id = activitySeed.role_id || getNodeLaneRoleId(snapshot, insertAfterId);
  if (!role_id && !lane_id) {
    throw new Error('FA-DRAFT-ROLE-001: 无法确定所选节点的角色');
  }

  // 3. 委托给 insertL5After
  return insertL5After(store, insertAfterId, activitySeed);
}
