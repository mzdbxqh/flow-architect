/**
 * 分域材料包构建器
 *
 * 将 Markdown 分片按领域标签分组为材料包，
 * 并支持递归聚合任务生成。
 *
 * @module material-packet-builder
 */

import { createHash } from 'node:crypto';
import { estimateTokens, buildContextBudget, BUDGET_STATUS } from './context-budget.mjs';

// route 到允许领域的映射
export const ROUTE_ALLOWED_DOMAINS = {
  'review-l4': ['L4'],
  'review-l5': ['L5'],
  'review-l6': ['L6'],
  'review-sop': ['SOP'],
  'review-bpmn': ['BPMN'],
  'review-visual': ['VISUAL'],
  'review-consistency': ['L4', 'L5', 'L6', 'SOP', 'BPMN'],
  'review-hierarchy': ['L4', 'L5', 'L6'],
};

/**
 * 构建分域材料包
 *
 * @param {object} params
 * @param {string} params.stageId - 阶段 ID（如 review-l4、review-l5）
 * @param {object[]} params.chunks - 归一化后的 Markdown 分片数组
 * @param {number} [params.maxTokens=48000] - 每包最大 token 数
 * @returns {object[]} 材料包数组
 */
export function buildMaterialPackets({ stageId, chunks, maxTokens = 48000 }) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  // 获取该 stageId 允许的领域
  const allowedDomains = ROUTE_ALLOWED_DOMAINS[stageId] || [];

  // 过滤：只保留有明确领域标签且匹配的 chunks
  const filteredChunks = chunks.filter(chunk => {
    const tags = chunk.domain_tags || [];
    // 必须至少有一个标签且匹配允许列表
    return tags.length > 0 && tags.some(tag => allowedDomains.includes(tag));
  });

  // 如果没有匹配的 chunks，返回空数组
  if (filteredChunks.length === 0) {
    return [];
  }

  const blockThreshold = Math.floor(maxTokens * 1.2); // 120% 阻断线
  const packets = [];
  let currentPacket = createEmptyPacket(stageId);

  // 稳定排序：按 domain_tags、artifact_sha256、chunk_id
  const sorted = [...filteredChunks].sort((a, b) => {
    const tagA = (a.domain_tags || []).join(',');
    const tagB = (b.domain_tags || []).join(',');
    if (tagA !== tagB) return tagA.localeCompare(tagB);
    if (a.artifact_sha256 !== b.artifact_sha256) return a.artifact_sha256.localeCompare(b.artifact_sha256);
    return a.chunk_id.localeCompare(b.chunk_id);
  });

  for (const chunk of sorted) {
    const chunkTokens = estimateTokens(chunk.content || '').estimated_tokens;

    // 单块超过阻断线：标记为 BLOCKED
    if (chunkTokens > blockThreshold) {
      // 先保存当前包
      if (currentPacket.chunks.length > 0) {
        packets.push(finalizePacket(currentPacket, maxTokens));
        currentPacket = createEmptyPacket(stageId);
      }
      // 创建 BLOCKED 包
      const blockedPacket = createEmptyPacket(stageId);
      blockedPacket.chunks.push(chunk);
      blockedPacket.total_tokens += chunkTokens;
      packets.push(finalizePacket(blockedPacket, maxTokens, true));
      continue;
    }

    // 检查是否能加入当前包
    if (currentPacket.total_tokens + chunkTokens > maxTokens && currentPacket.chunks.length > 0) {
      // 当前包已满，开启新包
      packets.push(finalizePacket(currentPacket, maxTokens));
      currentPacket = createEmptyPacket(stageId);
    }

    currentPacket.chunks.push(chunk);
    currentPacket.total_tokens += chunkTokens;
  }

  // 最后一个包
  if (currentPacket.chunks.length > 0) {
    packets.push(finalizePacket(currentPacket, maxTokens));
  }

  return packets;
}

/**
 * 构建递归聚合任务
 *
 * @param {object} params
 * @param {string} params.stageId - 聚合阶段 ID
 * @param {object[]} params.results - 上层结构化结果数组
 * @param {number} [params.maxTokens=48000] - 每任务最大 token 数
 * @returns {object[]} 聚合任务数组
 */
export function buildRecursiveAggregationTasks({ stageId, results, maxTokens = 48000 }) {
  if (!results || results.length === 0) {
    return [];
  }

  const tasks = [];
  let currentInputs = [];
  let currentTokens = 0;

  for (const result of results) {
    const resultTokens = estimateTokens(result.content || '').estimated_tokens;

    // 如果单个结果就超过限制，单独创建一个 BLOCKED 任务
    if (resultTokens > maxTokens) {
      if (currentInputs.length > 0) {
        tasks.push(createAggregationTask(stageId, currentInputs, maxTokens));
        currentInputs = [];
        currentTokens = 0;
      }
      tasks.push(createAggregationTask(stageId, [result], maxTokens));
      continue;
    }

    if (currentTokens + resultTokens > maxTokens && currentInputs.length > 0) {
      tasks.push(createAggregationTask(stageId, currentInputs, maxTokens));
      currentInputs = [];
      currentTokens = 0;
    }

    currentInputs.push(result);
    currentTokens += resultTokens;
  }

  if (currentInputs.length > 0) {
    tasks.push(createAggregationTask(stageId, currentInputs, maxTokens));
  }

  return tasks;
}

/**
 * 构建 Stage Task
 *
 * @param {object} params
 * @param {string} [params.stageId] - 阶段 ID（向后兼容）
 * @param {string} [params.packetId] - 包 ID（向后兼容）
 * @param {object} [params.materialPacket] - 材料包对象（新 API）
 * @param {object} params.rulePacket - 规则包对象
 * @param {string} params.outputDir - 输出目录
 * @returns {object} Stage Task
 */
export function buildStageTask({ stageId, packetId, materialPacket, rulePacket, outputDir }) {
  // 支持新旧两种 API
  const packet = materialPacket || {
    stage_id: stageId,
    packet_id: packetId,
    status: 'RUNNABLE',
    context_budget: rulePacket?.budget || { estimated_tokens: 0, status: 'BUDGET_OK' },
  };

  const isBlocked = packet.status === 'BLOCKED' ||
    packet.context_budget?.split_required;

  return {
    stage_id: packet.stage_id,
    packet_id: packet.packet_id,
    status: isBlocked ? 'BLOCKED' : 'RUNNABLE',
    runnable: !isBlocked,
    fresh_session: !isBlocked,
    input_packet: `${packet.packet_id}.json`,
    rule_packet: {
      markdown_ref: `rule-packet-${packet.stage_id}.md`,
      rule_ids: rulePacket?.ruleIds || [],
    },
    context_budget: packet.context_budget || rulePacket?.budget || { estimated_tokens: 0, status: 'BUDGET_OK' },
    output_dir: outputDir,
    allowed_read_paths: [
      `${packet.packet_id}.json`,
      `rule-packet-${packet.stage_id}.md`,
      outputDir,
    ],
  };
}

// --- 内部辅助 ---

function createEmptyPacket(stageId) {
  return {
    stage_id: stageId,
    chunks: [],
    total_tokens: 0,
  };
}

function finalizePacket(packet, maxTokens, blocked = false) {
  const contentText = packet.chunks.map(c => c.content || '').join('\n');
  const limit = maxTokens;

  const budget = buildContextBudget({
    contentTexts: [contentText],
    fixedTexts: [],
    metadataTexts: [],
    limit,
    sourceIds: packet.chunks.map(c => c.chunk_id),
  });

  // 如果标记为 BLOCKED，强制状态
  if (blocked) {
    budget.status = BUDGET_STATUS.SPLIT_REQUIRED;
    budget.split_required = true;
  }

  // 确定 packet 状态
  const status = blocked || budget.split_required ? 'BLOCKED' : 'RUNNABLE';

  // 获取 domain_tags（从第一个 chunk，应该都相同因为已过滤）
  const domainTags = packet.chunks[0]?.domain_tags || [];

  // 计算 lineage
  const sourceArtifacts = [...new Set(packet.chunks.map(c => c.artifact_id))].sort();
  const sourceBlocks = [...new Set(packet.chunks.map(c => c.block_id))].sort();

  return {
    packet_id: generatePacketId(packet.chunks),
    stage_id: packet.stage_id,
    chunk_ids: packet.chunks.map(c => c.chunk_id),
    domain_tags: domainTags,
    status,
    lineage: {
      source_artifacts: sourceArtifacts,
      source_blocks: sourceBlocks,
    },
    markdown_refs: packet.chunks.map(c => c.markdown_ref || `normalized/${c.artifact_id}/chunks/${c.chunk_id}.md`),
    context_budget: budget,
  };
}

function createAggregationTask(stageId, inputs, maxTokens = 48000) {
  const contentText = inputs.map(i => i.content || '').join('\n');
  const budget = buildContextBudget({
    contentTexts: [contentText],
    fixedTexts: [],
    metadataTexts: [],
    limit: maxTokens,
    sourceIds: inputs.map(i => i.result_id),
  });

  // 检查是否需要阻断
  const blocked = budget.split_required;
  const status = blocked ? 'BLOCKED' : 'RUNNABLE';

  return {
    task_id: `AGG-${generateId(inputs.map(i => i.result_id).join(','))}`,
    stage_id: stageId,
    inputs: inputs.map(i => i.result_id),
    input_paths: inputs.map(i => `${i.result_id}.json`),
    allowed_read_paths: inputs.map(i => `${i.result_id}.json`),
    context_budget: budget,
    status,
    runnable: !blocked,
    fresh_session: !blocked,
  };
}

function generatePacketId(chunks) {
  const ids = chunks.map(c => c.chunk_id).sort().join(',');
  return `MP-${generateId(ids)}`;
}

function generateId(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}
