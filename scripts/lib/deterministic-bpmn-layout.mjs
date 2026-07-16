/**
 * 确定性 BPMN 布局引擎
 *
 * 基于流程草稿的拓扑结构计算元素位置和流线路径。
 * 不调用 LLM 或浏览器布局引擎，完全确定性。
 *
 * 算法：
 * 1. 拓扑排序（BFS）确定每个元素的 rank
 * 2. 按 rank 列、lane 行网格排列元素
 * 3. 为每条 flow 生成 waypoints（含循环回边的绕行路径）
 * 4. 将开始、结束等显式事件与其他节点统一布局
 */

const TASK_WIDTH = 120;
const TASK_HEIGHT = 80;
const EVENT_SIZE = 36;
const GATEWAY_SIZE = 50;
const LANE_HEIGHT = 150;
const LANE_PADDING_TOP = 30;
const RANK_GAP_X = 200;
const START_X = 160;
const START_Y = 50;
const BACK_EDGE_OFFSET_Y = 40;

/**
 * 计算流程图的确定性布局
 *
 * @param {object} draft - 流程草稿
 * @returns {object} 布局结果，包含 elements/edges/lanes
 */
export function layoutProcessGraph(draft) {
  // 只支持 V2 格式
  if (!draft.diagram || !draft.diagram.nodes || !draft.diagram.flows || !draft.diagram.lanes) {
    throw new Error('布局器只支持 V2 格式输入，需要 draft.diagram 包含 nodes/flows/lanes');
  }

  // 节点必须满足 V2 的最小结构要求
  for (const node of draft.diagram.nodes) {
    if (typeof node.node_id !== 'string' || typeof node.node_type !== 'string') {
      throw new Error('布局器只支持具有 node_id/node_type 的 V2 节点');
    }
  }

  const nodes = draft.diagram.nodes;
  const flows = draft.diagram.flows;
  const lanes = draft.diagram.lanes;

  // 1. 拓扑排序（含回边检测）
  const { ranks, backEdgeIds } = computeTopologicalRanks(nodes, flows);

  // 2. 计算自适应泳道高度
  const laneRankRequirements = computeLaneRankRequirements(nodes, ranks);
  const laneLayout = computeLanePositions(lanes, START_Y, laneRankRequirements);

  // 3. 按 rank 计算元素位置
  const elementLayout = computeElementPositions(nodes, ranks, laneLayout);

  // 4. 为所有 flow 生成 edge waypoints
  const allEdges = computeAllEdges(flows, elementLayout, laneLayout, backEdgeIds);

  return {
    elements: elementLayout,
    edges: allEdges,
    lanes: laneLayout,
  };
}

/**
 * 拓扑排序：先 DFS 识别回边，再对正向 DAG 执行 Kahn 算法
 * 回边（循环）在 detectBackEdges 中单独识别
 */
function computeTopologicalRanks(nodes, flows) {
  const ranks = {};
  const nodeIds = new Set(nodes.map(n => n.node_id));

  // 构建邻接表（只含双向都存在的节点）
  const adjacency = new Map();
  for (const node of nodes) {
    const id = node.node_id;
    adjacency.set(id, []);
  }
  for (const flow of flows) {
    if (nodeIds.has(flow.source_ref) && nodeIds.has(flow.target_ref)) {
      adjacency.get(flow.source_ref).push({ target: flow.target_ref, flowId: flow.flow_id });
    }
  }

  // DFS 识别回边（状态: 0=未访问, 1=在栈中, 2=已完成）
  const visitState = new Map();
  const backEdgeIds = new Set();

  function dfs(node) {
    visitState.set(node, 1); // 入栈
    for (const edge of (adjacency.get(node) || [])) {
      const state = visitState.get(edge.target) ?? 0;
      if (state === 0) {
        dfs(edge.target);
      } else if (state === 1) {
        // 指向栈中的节点 → 回边
        backEdgeIds.add(edge.flowId);
      }
      // state === 2: 已完成，正向边
    }
    visitState.set(node, 2); // 出栈
  }

  for (const node of nodes) {
    const id = node.node_id;
    if ((visitState.get(id) ?? 0) === 0) {
      dfs(id);
    }
  }

  // 构建正向邻接表和入度（排除回边）
  const forwardAdj = new Map();
  const inDegree = new Map();
  for (const node of nodes) {
    const id = node.node_id;
    forwardAdj.set(id, []);
    inDegree.set(id, 0);
  }
  for (const flow of flows) {
    if (backEdgeIds.has(flow.flow_id)) continue;
    if (nodeIds.has(flow.source_ref) && nodeIds.has(flow.target_ref)) {
      forwardAdj.get(flow.source_ref).push(flow.target_ref);
      inDegree.set(flow.target_ref, inDegree.get(flow.target_ref) + 1);
    }
  }

  // Kahn 算法
  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      ranks[id] = 0;
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentRank = ranks[current];
    for (const neighbor of forwardAdj.get(current)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      const newRank = currentRank + 1;
      if (ranks[neighbor] === undefined || ranks[neighbor] < newRank) {
        ranks[neighbor] = newRank;
      }
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 未排名节点（理论上正向 DAG 不应有剩余）
  for (const node of nodes) {
    const id = node.node_id;
    if (ranks[id] === undefined) {
      ranks[id] = 0;
    }
  }

  return { ranks, backEdgeIds };
}

/**
 * 计算节点尺寸
 */
function getNodeDimensions(node) {
  const nodeType = node.node_type;
  if (nodeType.startsWith('GATEWAY_')) {
    return { width: GATEWAY_SIZE, height: GATEWAY_SIZE };
  } else if (nodeType.includes('EVENT') || nodeType.includes('CATCH') || nodeType.includes('THROW')) {
    return { width: EVENT_SIZE, height: EVENT_SIZE };
  } else {
    return { width: TASK_WIDTH, height: TASK_HEIGHT };
  }
}

/**
 * 计算每个泳道每个 rank 的节点堆叠需求
 * 返回 Map<lane_id, Map<rank, { count, totalNodeHeight }>>
 */
function computeLaneRankRequirements(nodes, ranks) {
  const requirements = new Map();

  for (const node of nodes) {
    const id = node.node_id;
    const laneId = node.lane_id || null;
    const rank = ranks[id] ?? 0;
    const { height } = getNodeDimensions(node);

    if (!requirements.has(laneId)) {
      requirements.set(laneId, new Map());
    }
    const laneReqs = requirements.get(laneId);

    if (!laneReqs.has(rank)) {
      laneReqs.set(rank, { count: 0, totalNodeHeight: 0 });
    }
    const rankReq = laneReqs.get(rank);
    rankReq.count++;
    rankReq.totalNodeHeight += height;
  }

  return requirements;
}

/**
 * 计算自适应泳道高度
 * 基于每个泳道每个 rank 的最大堆叠需求
 */
function computeAdaptiveLaneHeight(laneId, laneRankRequirements) {
  const laneReqs = laneRankRequirements.get(laneId);
  if (!laneReqs || laneReqs.size === 0) {
    return LANE_HEIGHT; // 默认高度
  }

  // 计算该泳道内所有 rank 的最大堆叠需求
  let maxRankHeight = 0;
  for (const req of laneReqs.values()) {
    const gapsHeight = Math.max(0, req.count - 1) * 10;
    const rankHeight = req.totalNodeHeight + gapsHeight + 2 * LANE_PADDING_TOP;
    maxRankHeight = Math.max(maxRankHeight, rankHeight);
  }

  // 确保最小高度
  return Math.max(maxRankHeight, LANE_HEIGHT);
}

/**
 * 计算 lane 水平带位置（自适应高度）
 */
function computeLanePositions(lanes, baseY, laneRankRequirements) {
  const result = [];
  let currentY = baseY;
  for (const lane of lanes) {
    const adaptiveHeight = computeAdaptiveLaneHeight(lane.lane_id, laneRankRequirements);
    result.push({
      id: lane.lane_id,
      name: lane.name,
      x: START_X,
      y: currentY,
      width: 0, // 后续根据元素列数计算
      height: adaptiveHeight,
    });
    currentY += adaptiveHeight;
  }
  return result;
}

/**
 * 计算元素在网格中的位置
 * x = 基于 rank 的列
 * y = 基于 lane 的行内居中
 */
function computeElementPositions(nodes, ranks, laneLayout) {
  // 找出最大 rank
  let maxRank = 0;
  for (const node of nodes) {
    const id = node.node_id;
    const r = ranks[id] ?? 0;
    if (r > maxRank) maxRank = r;
  }

  // 按 rank 分组，每组按 lane 和稳定 ID 排序
  const rankGroups = new Map();
  for (const node of nodes) {
    const id = node.node_id;
    const r = ranks[id] ?? 0;
    if (!rankGroups.has(r)) rankGroups.set(r, []);
    rankGroups.get(r).push(node);
  }

  // 同 rank 按 lane 和稳定 ID 排序
  for (const [rank, group] of rankGroups) {
    group.sort((a, b) => {
      const lidA = a.lane_id || '';
      const lidB = b.lane_id || '';
      if (lidA !== lidB) return lidA.localeCompare(lidB);
      const idA = a.node_id;
      const idB = b.node_id;
      return idA.localeCompare(idB);
    });
  }

  const layout = {};

  for (let rank = 0; rank <= maxRank; rank++) {
    const group = rankGroups.get(rank) || [];
    const laneGroups = new Map();
    for (const node of group) {
      const lid = node.lane_id;
      if (!laneGroups.has(lid)) laneGroups.set(lid, []);
      laneGroups.get(lid).push(node);
    }

    for (const [lid, laneNodes] of laneGroups) {
      const lane = laneLayout.find(l => l.id === lid);
      const laneY = lane ? lane.y : START_Y;
      const laneHeight = lane ? lane.height : LANE_HEIGHT;
      const dimensions = laneNodes.map(getNodeDimensions);
      const stackHeight = dimensions.reduce((sum, item) => sum + item.height, 0)
        + Math.max(0, laneNodes.length - 1) * 10;
      let currentY = laneY + (laneHeight - stackHeight) / 2;

      for (let index = 0; index < laneNodes.length; index++) {
        const node = laneNodes[index];
        const { width, height } = dimensions[index];
        layout[node.node_id] = {
          x: START_X + 100 + rank * RANK_GAP_X,
          y: currentY,
          width,
          height,
          rank,
        };
        currentY += height + 10;
      }
    }
  }

  // 更新 lane 宽度
  const totalWidth = START_X + 100 + (maxRank + 1) * RANK_GAP_X + TASK_WIDTH;
  for (const lane of laneLayout) {
    lane.width = totalWidth - START_X;
  }

  return layout;
}

/**
 * 为所有 flow 生成 edge waypoints
 * 只处理 draft 中的 flows，不生成虚拟的 start/end 连线
 * 循环回边使用绕行路径
 */
function computeAllEdges(flows, elementLayout, laneLayout, backEdges) {
  const edges = [];

  // 只处理 draft 中的 flows
  for (const flow of flows) {
    const isBackEdge = backEdges.has(flow.flow_id);
    const waypoints = computeFlowWaypoints(
      flow, elementLayout, laneLayout, isBackEdge
    );
    edges.push({
      id: flow.flow_id,
      sourceRef: flow.source_ref,
      targetRef: flow.target_ref,
      waypoints,
    });
  }

  return edges;
}

/**
 * 计算单条 flow 的 waypoints
 * 正向流: source 右侧 → target 左侧
 * 回边: source 右侧 → 下方绕行 → target 左侧
 */
function computeFlowWaypoints(flow, elementLayout, laneLayout, isBackEdge) {
  const src = elementLayout[flow.source_ref];
  const tgt = elementLayout[flow.target_ref];

  if (!src || !tgt) {
    // 对悬空引用抛出明确错误
    throw new Error(`流程 ${flow.flow_id} 引用了不存在的节点: ${!src ? flow.source_ref : ''} ${!tgt ? flow.target_ref : ''}`.trim());
  }

  const srcCenterY = src.y + src.height / 2;
  const tgtCenterY = tgt.y + tgt.height / 2;
  const srcRightX = src.x + src.width;
  const tgtLeftX = tgt.x;

  if (isBackEdge) {
    // 回边绕行路径: 右出 → 下方 → 左转 → 上行 → 入口
    const bottomY = computeMaxBottomY(laneLayout);
    return [
      { x: srcRightX, y: srcCenterY },
      { x: srcRightX + 30, y: srcCenterY },
      { x: srcRightX + 30, y: bottomY + BACK_EDGE_OFFSET_Y },
      { x: tgtLeftX - 30, y: bottomY + BACK_EDGE_OFFSET_Y },
      { x: tgtLeftX - 30, y: tgtCenterY },
      { x: tgtLeftX, y: tgtCenterY },
    ];
  }

  // 正交流: source 右侧中点 → target 左侧中点
  // 使用正交路径：水平→垂直→水平
  const midX = (srcRightX + tgtLeftX) / 2;

  return [
    { x: srcRightX, y: srcCenterY },
    { x: midX, y: srcCenterY },
    { x: midX, y: tgtCenterY },
    { x: tgtLeftX, y: tgtCenterY },
  ];
}

function computeMaxBottomY(laneLayout) {
  let maxY = 0;
  for (const lane of laneLayout) {
    const bottom = lane.y + lane.height;
    if (bottom > maxY) maxY = bottom;
  }
  return maxY;
}
