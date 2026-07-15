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
 * 4. 为 start/end 事件生成位置
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
 * @returns {object} 布局结果，包含 elements/edges/lanes/startShape/endShape
 */
export function layoutProcessGraph(draft) {
  const { elements, flows, lanes } = draft;

  // 1. 拓扑排序（含回边检测）
  const { ranks, backEdgeIds } = computeTopologicalRanks(elements, flows);

  // 2. 构建反向索引
  const incomingMap = buildIncomingMap(flows);
  const outgoingMap = buildOutgoingMap(flows);
  const backEdges = backEdgeIds;

  // 3. 计算 lane 位置
  const laneLayout = computeLanePositions(lanes, START_Y, LANE_HEIGHT);

  // 4. 按 rank 计算元素位置
  const elementLayout = computeElementPositions(
    elements, lanes, ranks, laneLayout, incomingMap, outgoingMap
  );

  // 5. 计算 start/end 事件位置
  const startShape = computeStartShape(elements, ranks, laneLayout);
  const endShape = computeEndShape(elements, ranks, laneLayout);

  // 6. 为所有 flow 生成 edge waypoints（含 start→first、last→end）
  const allEdges = computeAllEdges(
    elements, flows, ranks, elementLayout, laneLayout,
    incomingMap, outgoingMap, backEdges, startShape, endShape
  );

  return {
    elements: elementLayout,
    edges: allEdges,
    lanes: laneLayout,
    startShape,
    endShape,
  };
}

/**
 * 拓扑排序：先 DFS 识别回边，再对正向 DAG 执行 Kahn 算法
 * 回边（循环）在 detectBackEdges 中单独识别
 */
function computeTopologicalRanks(elements, flows) {
  const ranks = {};
  const elementIds = new Set(elements.map(e => e.element_id));

  // 构建邻接表（只含双向都存在的元素）
  const adjacency = new Map();
  for (const el of elements) adjacency.set(el.element_id, []);
  for (const flow of flows) {
    if (elementIds.has(flow.source_ref) && elementIds.has(flow.target_ref)) {
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

  for (const el of elements) {
    if ((visitState.get(el.element_id) ?? 0) === 0) {
      dfs(el.element_id);
    }
  }

  // 构建正向邻接表和入度（排除回边）
  const forwardAdj = new Map();
  const inDegree = new Map();
  for (const el of elements) {
    forwardAdj.set(el.element_id, []);
    inDegree.set(el.element_id, 0);
  }
  for (const flow of flows) {
    if (backEdgeIds.has(flow.flow_id)) continue;
    if (elementIds.has(flow.source_ref) && elementIds.has(flow.target_ref)) {
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
  for (const el of elements) {
    if (ranks[el.element_id] === undefined) {
      ranks[el.element_id] = 0;
    }
  }

  return { ranks, backEdgeIds };
}

function buildIncomingMap(flows) {
  const map = new Map();
  for (const flow of flows) {
    if (!map.has(flow.target_ref)) map.set(flow.target_ref, []);
    map.get(flow.target_ref).push(flow);
  }
  return map;
}

function buildOutgoingMap(flows) {
  const map = new Map();
  for (const flow of flows) {
    if (!map.has(flow.source_ref)) map.set(flow.source_ref, []);
    map.get(flow.source_ref).push(flow);
  }
  return map;
}

/**
 * 计算 lane 水平带位置
 */
function computeLanePositions(lanes, baseY, laneHeight) {
  const result = [];
  let currentY = baseY;
  for (const lane of lanes) {
    result.push({
      id: lane.lane_id,
      name: lane.name,
      x: START_X,
      y: currentY,
      width: 0, // 后续根据元素列数计算
      height: laneHeight,
    });
    currentY += laneHeight;
  }
  return result;
}

/**
 * 计算元素在网格中的位置
 * x = 基于 rank 的列
 * y = 基于 lane 的行内居中
 */
function computeElementPositions(elements, lanes, ranks, laneLayout, incomingMap, outgoingMap) {
  // 找出最大 rank
  let maxRank = 0;
  for (const el of elements) {
    const r = ranks[el.element_id] ?? 0;
    if (r > maxRank) maxRank = r;
  }

  // 按 rank 分组，每组按 lane 排序
  const rankGroups = new Map();
  for (const el of elements) {
    const r = ranks[el.element_id] ?? 0;
    if (!rankGroups.has(r)) rankGroups.set(r, []);
    rankGroups.get(r).push(el);
  }

  // 计算每列中每 lane 的元素计数（用于偏移）
  const layout = {};

  for (let rank = 0; rank <= maxRank; rank++) {
    const group = rankGroups.get(rank) || [];
    const laneCounts = new Map();
    for (const el of group) {
      const lid = el.lane_id;
      laneCounts.set(lid, (laneCounts.get(lid) || 0) + 1);
    }

    // 每个 lane 内的索引
    const laneIndices = new Map();
    for (const el of group) {
      const lid = el.lane_id;
      const idx = laneIndices.get(lid) || 0;
      laneIndices.set(lid, idx + 1);

      const lane = laneLayout.find(l => l.id === lid);
      const laneY = lane ? lane.y : START_Y;

      const width = el.kind === 'DECISION' ? GATEWAY_SIZE : TASK_WIDTH;
      const height = el.kind === 'DECISION' ? GATEWAY_SIZE : TASK_HEIGHT;

      layout[el.element_id] = {
        x: START_X + 100 + rank * RANK_GAP_X,
        y: laneY + LANE_PADDING_TOP + (LANE_HEIGHT - LANE_PADDING_TOP - height) / 2,
        width,
        height,
        rank,
      };
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
 * 计算 StartEvent 位置（在第一个 rank 的第一个 lane 内）
 */
function computeStartShape(elements, ranks, laneLayout) {
  const firstLane = laneLayout[0];
  return {
    x: START_X,
    y: firstLane ? firstLane.y + LANE_HEIGHT / 2 - EVENT_SIZE / 2 : START_Y,
    width: EVENT_SIZE,
    height: EVENT_SIZE,
  };
}

/**
 * 计算 EndEvent 位置（在最后一个 rank 的最后一个 lane 内）
 */
function computeEndShape(elements, ranks, laneLayout) {
  let maxRank = 0;
  for (const el of elements) {
    const r = ranks[el.element_id] ?? 0;
    if (r > maxRank) maxRank = r;
  }
  const lastLane = laneLayout[laneLayout.length - 1] || laneLayout[0];
  return {
    x: START_X + 100 + (maxRank + 1) * RANK_GAP_X,
    y: lastLane ? lastLane.y + LANE_HEIGHT / 2 - EVENT_SIZE / 2 : START_Y,
    width: EVENT_SIZE,
    height: EVENT_SIZE,
  };
}

/**
 * 为所有 flow 生成 edge waypoints
 * 包括：draft flows、start→根节点、叶子节点→end
 * 循环回边使用绕行路径
 */
function computeAllEdges(
  elements, flows, ranks, elementLayout, laneLayout,
  incomingMap, outgoingMap, backEdges, startShape, endShape
) {
  const edges = [];

  // 找到所有根节点（入度为零）
  const rootElements = findRootElements(elements, incomingMap);
  // 找到所有叶子节点（出度为零）
  const leafElements = findLeafElements(elements, outgoingMap);

  // Start → 根节点
  for (const root of rootElements) {
    const targetCenter = getElementCenter(root.element_id, elementLayout);
    const rootEl = elementLayout[root.element_id];
    if (targetCenter && rootEl) {
      edges.push({
        id: `Flow_start_${root.element_id}`,
        sourceRef: 'StartEvent_1',
        targetRef: root.element_id,
        waypoints: [
          { x: startShape.x + startShape.width, y: startShape.y + startShape.height / 2 },
          { x: rootEl.x, y: rootEl.y + rootEl.height / 2 },
        ],
      });
    }
  }

  // Draft flows
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

  // 叶子节点 → End
  for (const leaf of leafElements) {
    const sourceCenter = getElementCenter(leaf.element_id, elementLayout);
    const leafEl = elementLayout[leaf.element_id];
    if (sourceCenter && leafEl) {
      edges.push({
        id: `Flow_end_${leaf.element_id}`,
        sourceRef: leaf.element_id,
        targetRef: 'EndEvent_1',
        waypoints: [
          { x: leafEl.x + leafEl.width, y: leafEl.y + leafEl.height / 2 },
          { x: endShape.x, y: endShape.y + endShape.height / 2 },
        ],
      });
    }
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
    // fallback: 直线
    return [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
  }

  const srcCenterY = src.y + src.height / 2;
  const tgtCenterY = tgt.y + tgt.height / 2;
  const srcRightX = src.x + src.width;
  const tgtLeftX = tgt.x;

  if (isBackEdge) {
    // 回边绕行路径: 右出 → 下方 → 左转 → 上行 → 入口
    const bottomY = computeMaxBottomY(laneLayout);
    const midX = (srcRightX + tgtLeftX) / 2;

    return [
      { x: srcRightX, y: srcCenterY },
      { x: srcRightX + 30, y: srcCenterY },
      { x: srcRightX + 30, y: bottomY + BACK_EDGE_OFFSET_Y },
      { x: tgtLeftX - 30, y: bottomY + BACK_EDGE_OFFSET_Y },
      { x: tgtLeftX - 30, y: tgtCenterY },
      { x: tgtLeftX, y: tgtCenterY },
    ];
  }

  // 正向流: source 右侧中点 → target 左侧中点
  return [
    { x: srcRightX, y: srcCenterY },
    { x: tgtLeftX, y: tgtCenterY },
  ];
}

function getElementCenter(elementId, elementLayout) {
  const el = elementLayout[elementId];
  if (!el) return null;
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

function findFirstElement(elements, ranks) {
  let minRank = Infinity;
  let first = null;
  for (const el of elements) {
    const r = ranks[el.element_id] ?? 0;
    if (r < minRank) {
      minRank = r;
      first = el;
    }
  }
  return first;
}

/**
 * 找到所有入度为零的元素（根节点）
 */
function findRootElements(elements, incomingMap) {
  return elements.filter(el => {
    const incoming = incomingMap.get(el.element_id);
    return !incoming || incoming.length === 0;
  });
}

/**
 * 找到所有出度为零的元素（叶子节点）
 * 对于纯循环图（没有出度为零的节点），采用确定性的单一锚点策略
 */
function findLeafElements(elements, outgoingMap) {
  const leaves = elements.filter(el => {
    const outgoing = outgoingMap.get(el.element_id);
    return !outgoing || outgoing.length === 0;
  });

  // 如果有叶子节点，直接返回
  if (leaves.length > 0) {
    return leaves;
  }

  // 纯循环图：选择最后一个元素（按数组顺序）作为确定性锚点
  if (elements.length > 0) {
    return [elements[elements.length - 1]];
  }

  return [];
}

function findLastElement(elements, ranks, incomingMap) {
  let maxRank = -1;
  let last = null;
  for (const el of elements) {
    const r = ranks[el.element_id] ?? 0;
    if (r > maxRank) {
      maxRank = r;
      last = el;
    }
  }
  return last;
}

function computeMaxBottomY(laneLayout) {
  let maxY = 0;
  for (const lane of laneLayout) {
    const bottom = lane.y + lane.height;
    if (bottom > maxY) maxY = bottom;
  }
  return maxY;
}
