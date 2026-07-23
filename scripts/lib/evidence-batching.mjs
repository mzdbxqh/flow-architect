/**
 * 证据分批逻辑
 *
 * 将证据块分组成批次，满足：
 * - 每批不超过 maxChars 字符（默认 12000）
 * - 每批不超过 maxBlocks 块（默认 12）
 * - 视觉资产每批最多一个
 * - 同一 artifact 的块尽量在同一批次
 * - 单块超过 maxChars 时按自然段确定性切分并保留父 locator
 * - 生成稳定的批次 ID
 * - 每个批次包含 context_budget 和 markdown_refs
 */

import { createHash } from 'node:crypto';
import { estimateTokens, assessBudget, buildContextBudget } from './context-budget.mjs';

/**
 * 将字符限转为 token 限
 * 批次预算基准以中文字符表达（12,000 中文字符），转换为统一 token 估算：
 * 对 maxChars 个纯中文字符使用 estimateTokens 得到 token 上限
 */
function charLimitToTokenLimit(maxChars) {
  // 使用与 estimateTokens 相同的公式：ceil(汉字数/1.5)
  // maxChars 以中文字符为单位，纯中文时 = ceil(maxChars / 1.5)
  return Math.ceil(maxChars / 1.5);
}

/**
 * 构建证据批次
 *
 * @param {object} params
 * @param {object[]} params.blocks - 证据块数组
 * @param {number} [params.maxChars=12000] - 每批最大字符数
 * @param {number} [params.maxBlocks=12] - 每批最大块数
 * @returns {object[]} 批次数组
 */
export function buildEvidenceBatches({ blocks, maxChars = 12000, maxBlocks = 12 }) {
  if (!blocks || blocks.length === 0) {
    return [];
  }

  // 按 artifact 分组
  const byArtifact = groupByArtifact(blocks);

  const batches = [];
  let currentBatch = createEmptyBatch();

  // 先处理视觉资产（每批一个）
  const visualBlocks = blocks.filter(b => b.modality === 'VISUAL_ASSET');
  const nonVisualBlocks = blocks.filter(b => b.modality !== 'VISUAL_ASSET');

  // 视觉资产单独成批
  for (const block of visualBlocks) {
    const batch = createBatchFromBlocks([block], maxChars);
    batches.push(batch);
  }

  // 非视觉块按 artifact 分组处理
  const artifactGroups = Object.values(groupByArtifact(nonVisualBlocks));

  for (const group of artifactGroups) {
    // 尝试将整个组加入当前批次
    const groupChars = sumChars(group);

    if (currentBatch.blocks.length === 0) {
      // 当前批次为空，直接加入
      if (groupChars <= maxChars && group.length <= maxBlocks) {
        currentBatch.blocks.push(...group);
        currentBatch.total_chars += groupChars;
      } else {
        // 组太大，需要拆分
        const subBatches = splitLargeGroup(group, maxChars, maxBlocks);
        batches.push(...subBatches);
      }
    } else if (
      currentBatch.blocks.length + group.length <= maxBlocks &&
      currentBatch.total_chars + groupChars <= maxChars
    ) {
      // 可以加入当前批次
      currentBatch.blocks.push(...group);
      currentBatch.total_chars += groupChars;
    } else {
      // 当前批次已满，开始新批次
      if (currentBatch.blocks.length > 0) {
        batches.push(finalizeBatch(currentBatch, maxChars));
      }

      if (groupChars <= maxChars && group.length <= maxBlocks) {
        currentBatch = createEmptyBatch();
        currentBatch.blocks.push(...group);
        currentBatch.total_chars += groupChars;
      } else {
        // 组太大，需要拆分
        const subBatches = splitLargeGroup(group, maxChars, maxBlocks);
        batches.push(...subBatches);
        currentBatch = createEmptyBatch();
      }
    }
  }

  // 处理最后一个批次
  if (currentBatch.blocks.length > 0) {
    batches.push(finalizeBatch(currentBatch, maxChars));
  }

  return batches;
}

/**
 * 按 artifact 分组
 */
function groupByArtifact(blocks) {
  const groups = {};
  for (const block of blocks) {
    const key = block.artifact_sha256;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(block);
  }
  return groups;
}

/**
 * 计算块数组的总字符数
 */
function sumChars(blocks) {
  return blocks.reduce((sum, b) => sum + (b.content?.length || 0), 0);
}

/**
 * 创建空批次
 */
function createEmptyBatch() {
  return {
    blocks: [],
    total_chars: 0,
    modality_mix: [],
  };
}

/**
 * 从块数组创建批次
 */
function createBatchFromBlocks(blocks, maxChars) {
  const totalChars = sumChars(blocks);
  const modalityMix = [...new Set(blocks.map(b => b.modality))];
  const mappedBlocks = blocks.map(b => ({
    block_id: b.block_id,
    artifact_sha256: b.artifact_sha256,
    source_format: b.source_format,
    modality: b.modality,
    locator: b.locator,
    heading_path: b.heading_path,
    content: b.content,
    asset_ref: b.asset_ref,
    content_sha256: b.content_sha256,
  }));

  const contentText = mappedBlocks.map(b => b.content || '').join('\n');
  const budgetLimit = charLimitToTokenLimit(maxChars);
  const contextBudget = buildContextBudget({
    contentTexts: [contentText],
    fixedTexts: [],
    metadataTexts: [],
    limit: budgetLimit,
    sourceIds: mappedBlocks.map(b => b.block_id),
  });

  return {
    batch_id: generateBatchId(blocks),
    batch_sha256: generateBatchHash(blocks),
    blocks: mappedBlocks,
    total_chars: totalChars,
    modality_mix: modalityMix,
    status: 'PENDING',
    context_budget: contextBudget,
    markdown_refs: [],
  };
}

/**
 * 完成批次（生成 ID、哈希、context_budget 和 markdown_refs）
 * @param {object} batch
 * @param {number} maxChars - 字符限（用于转 token 限）
 */
function finalizeBatch(batch, maxChars = 12000) {
  const modalityMix = [...new Set(batch.blocks.map(b => b.modality))];
  const blocks = batch.blocks.map(b => ({
    block_id: b.block_id,
    artifact_sha256: b.artifact_sha256,
    source_format: b.source_format,
    modality: b.modality,
    locator: b.locator,
    heading_path: b.heading_path,
    content: b.content,
    asset_ref: b.asset_ref,
    content_sha256: b.content_sha256,
  }));

  // 构建 context_budget
  const contentText = blocks.map(b => b.content || '').join('\n');
  // 原始批次基准 12000 中文字符 → 转为 token 限
  const budgetLimit = charLimitToTokenLimit(maxChars);
  const contextBudget = buildContextBudget({
    contentTexts: [contentText],
    fixedTexts: [],
    metadataTexts: [],
    limit: budgetLimit,
    sourceIds: blocks.map(b => b.block_id),
  });

  // markdown_refs: 每个块对应的归一化 Markdown 分片路径（由调用方填充）
  const markdownRefs = batch.markdown_refs || [];

  return {
    batch_id: generateBatchId(batch.blocks),
    batch_sha256: generateBatchHash(batch.blocks),
    blocks,
    total_chars: batch.total_chars,
    modality_mix: modalityMix,
    status: 'PENDING',
    context_budget: contextBudget,
    markdown_refs: markdownRefs,
  };
}

/**
 * 拆分大组
 * 当单块超过 maxChars 时，按自然段确定性切分并保留父 locator
 */
function splitLargeGroup(blocks, maxChars, maxBlocks) {
  const batches = [];
  let currentBatch = createEmptyBatch();

  for (const block of blocks) {
    const blockChars = block.content?.length || 0;

    // 单块超过 maxChars 时，按自然段切分
    if (blockChars > maxChars) {
      const fragments = splitLargeBlock(block, maxChars);
      for (const frag of fragments) {
        if (currentBatch.blocks.length >= maxBlocks || currentBatch.total_chars + (frag.content?.length || 0) > maxChars) {
          if (currentBatch.blocks.length > 0) {
            batches.push(finalizeBatch(currentBatch, maxChars));
          }
          currentBatch = createEmptyBatch();
        }
        currentBatch.blocks.push(frag);
        currentBatch.total_chars += (frag.content?.length || 0);
      }
      continue;
    }

    if (currentBatch.blocks.length >= maxBlocks || currentBatch.total_chars + blockChars > maxChars) {
      if (currentBatch.blocks.length > 0) {
        batches.push(finalizeBatch(currentBatch, maxChars));
      }
      currentBatch = createEmptyBatch();
    }

    currentBatch.blocks.push(block);
    currentBatch.total_chars += blockChars;
  }

  if (currentBatch.blocks.length > 0) {
    batches.push(finalizeBatch(currentBatch, maxChars));
  }

  return batches;
}

/**
 * 按自然段切分单个大块
 * 保留父 locator 和 heading_path，子块使用偏移量生成稳定 ID
 */
function splitLargeBlock(block, maxChars) {
  const content = block.content || '';
  // 按自然段（双换行或单换行）切分
  const paragraphs = content.split(/\n{2,}/);
  const fragments = [];
  let currentContent = '';
  let offset = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentContent.length + trimmed.length + 2 > maxChars && currentContent.length > 0) {
      // 保存当前累积内容
      fragments.push(createFragmentBlock(block, currentContent.trim(), offset));
      offset += currentContent.length;
      currentContent = trimmed;
    } else {
      if (currentContent.length > 0) {
        currentContent += '\n\n' + trimmed;
      } else {
        currentContent = trimmed;
      }
    }
  }

  if (currentContent.trim().length > 0) {
    fragments.push(createFragmentBlock(block, currentContent.trim(), offset));
  }

  // 如果切分后仍有一个块超过 maxChars，按单行切分；再不行则按字符兜底
  const result = [];
  for (const frag of fragments) {
    if ((frag.content?.length || 0) > maxChars) {
      const lineSplit = splitByLines(frag, maxChars);
      for (const lf of lineSplit) {
        if ((lf.content?.length || 0) > maxChars) {
          result.push(...splitByChars(lf, maxChars));
        } else {
          result.push(lf);
        }
      }
    } else {
      result.push(frag);
    }
  }

  return result.length > 0 ? result : [block];
}

/**
 * 按行切分
 */
function splitByLines(block, maxChars) {
  const lines = (block.content || '').split('\n');
  const fragments = [];
  let currentContent = '';
  let offset = 0;

  for (const line of lines) {
    if (currentContent.length + line.length + 1 > maxChars && currentContent.length > 0) {
      fragments.push(createFragmentBlock(block, currentContent.trim(), offset));
      offset += currentContent.length;
      currentContent = line;
    } else {
      if (currentContent.length > 0) {
        currentContent += '\n' + line;
      } else {
        currentContent = line;
      }
    }
  }

  if (currentContent.trim().length > 0) {
    fragments.push(createFragmentBlock(block, currentContent.trim(), offset));
  }

  return fragments;
}

/**
 * 按字符数强制切分（最终兜底，处理无换行符的连续文本）
 */
function splitByChars(block, maxChars) {
  const content = block.content || '';
  const fragments = [];
  let offset = 0;

  while (offset < content.length) {
    const end = Math.min(offset + maxChars, content.length);
    const chunk = content.slice(offset, end);
    if (chunk.length > 0) {
      fragments.push(createFragmentBlock(block, chunk, offset));
    }
    offset = end;
  }

  return fragments.length > 0 ? fragments : [block];
}

/**
 * 创建切分后的子块，保留父 locator 和 heading_path
 */
function createFragmentBlock(parentBlock, content, offset) {
  const locatorKey = `${parentBlock.block_id}:${offset}`;
  return {
    block_id: generateBlockId(parentBlock.artifact_sha256, locatorKey),
    artifact_sha256: parentBlock.artifact_sha256,
    source_format: parentBlock.source_format,
    modality: parentBlock.modality,
    locator: { ...parentBlock.locator },
    heading_path: [...parentBlock.heading_path],
    content,
    asset_ref: parentBlock.asset_ref,
    content_sha256: contentHash(content),
  };
}

/**
 * 生成稳定的块 ID
 */
function generateBlockId(artifactSha256, locatorKey) {
  const hash = createHash('sha256')
    .update(`${artifactSha256}:${locatorKey}`)
    .digest('hex')
    .slice(0, 12);
  return `B-${hash}`;
}

/**
 * 生成内容哈希
 */
function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 生成稳定的批次 ID
 * 基于块 ID 的有序列表
 */
function generateBatchId(blocks) {
  const sortedIds = blocks.map(b => b.block_id).sort().join(',');
  const hash = createHash('sha256').update(sortedIds).digest('hex').slice(0, 12);
  return `EB-${hash}`;
}

/**
 * 生成批次内容哈希
 * 基于块的内容哈希
 */
function generateBatchHash(blocks) {
  const contentHashes = blocks.map(b => b.content_sha256).sort().join(',');
  return createHash('sha256').update(contentHashes).digest('hex');
}
