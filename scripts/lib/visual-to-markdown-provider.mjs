/**
 * 可拔插视觉转 Markdown 提供器合同
 *
 * 提供视觉资产（PNG/JPEG/SVG 等）到 Markdown 的可拔插转换。
 * 未注册提供器时返回稳定的视觉占位块。
 *
 * @module visual-to-markdown-provider
 */

import { createHash } from 'node:crypto';
import { estimateTokens, buildContextBudget } from './context-budget.mjs';

/**
 * @typedef {object} VisualMarkdownResult
 * @property {string} status - 'REFINED' | 'VISUAL_REFINEMENT_UNAVAILABLE'
 * @property {string} markdown - Markdown 正文
 * @property {object[]} regions - 区域定位数组
 * @property {number} confidence - 置信度 (0-1)
 * @property {string} source_sha256 - 源资产哈希
 * @property {string} chunk_id - 稳定 chunk ID
 * @property {object} context_budget - 预算报告
 */

/** @type {object|null} */
let _provider = null;

/**
 * 注册视觉转 Markdown 提供器
 * @param {object|null} provider - 提供器对象或 null（取消注册）
 * @param {string} provider.name - 提供器名称
 * @param {string} provider.version - 提供器版本
 * @param {function} provider.refine - 转换函数
 */
export function registerVisualToMarkdownProvider(provider) {
  // 支持 null 来取消注册
  if (provider === null) {
    _provider = null;
    return;
  }

  if (!provider?.name || !provider?.version || typeof provider.refine !== 'function') {
    throw new Error('提供器必须包含 name、version 和 refine 函数');
  }
  _provider = provider;
}

/**
 * 重置提供器注册（测试用）
 */
export function resetProviders() {
  _provider = null;
}

/**
 * 提炼视觉资产为 Markdown
 *
 * @param {object} params
 * @param {string} params.assetPath - 资产文件路径
 * @param {object} params.locator - 来源定位
 * @param {object} params.budget - 预算约束
 * @returns {Promise<VisualMarkdownResult>}
 */
export async function refineVisualAsset({ assetPath, locator, budget }) {
  const sourceSha = computeAssetHash(assetPath);
  const chunkId = `VC-${sourceSha.slice(0, 12)}`;

  // 无提供器时返回占位块
  if (!_provider) {
    return buildUnavailableResult(sourceSha, chunkId, locator);
  }

  try {
    const providerResult = await _provider.refine({ assetPath, locator, budget });

    // 验证提供器输出
    const validation = validateProviderResult(providerResult, budget);
    if (!validation.valid) {
      return buildUnavailableResult(sourceSha, chunkId, locator, validation.reason);
    }

    const contentBudget = buildContextBudget({
      contentTexts: [providerResult.markdown],
      fixedTexts: [],
      metadataTexts: [],
      limit: budget.limit || 48000,
      sourceIds: [chunkId],
    });

    // 超预算时降级
    if (contentBudget.split_required) {
      return buildUnavailableResult(sourceSha, chunkId, locator, '输出超过预算限制');
    }

    return {
      status: 'REFINED',
      markdown: providerResult.markdown,
      regions: providerResult.regions,
      confidence: providerResult.confidence,
      source_sha256: sourceSha,
      chunk_id: chunkId,
      context_budget: contentBudget,
    };
  } catch (err) {
    // 提供器异常时稳定降级
    return buildUnavailableResult(sourceSha, chunkId, locator, `提供器异常: ${err.message}`);
  }
}

// --- 内部辅助 ---

function buildUnavailableResult(sourceSha, chunkId, locator, reason) {
  const locatorStr = formatLocator(locator);
  const markdown = [
    '---',
    `chunk_id: ${chunkId}`,
    `source_sha256: ${sourceSha}`,
    `modality: VISUAL_ASSET`,
    `status: VISUAL_REFINEMENT_UNAVAILABLE`,
    '---',
    '',
    `<!-- VISUAL_REFINEMENT_UNAVAILABLE: ${reason || '未安装视觉转 Markdown 提供器'} -->`,
    '',
    `[视觉资产: ${locatorStr}]`,
  ].join('\n');

  const budget = buildContextBudget({
    contentTexts: [markdown],
    fixedTexts: [],
    metadataTexts: [],
    limit: 48000,
    sourceIds: [chunkId],
  });

  return {
    status: 'VISUAL_REFINEMENT_UNAVAILABLE',
    markdown,
    regions: [],
    confidence: 0,
    source_sha256: sourceSha,
    chunk_id: chunkId,
    context_budget: budget,
  };
}

function validateProviderResult(result, budget) {
  if (!result || typeof result.markdown !== 'string') {
    return { valid: false, reason: '提供器未返回 markdown' };
  }
  if (!Array.isArray(result.regions) || result.regions.length === 0) {
    return { valid: false, reason: '提供器未返回区域定位' };
  }
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
    return { valid: false, reason: '置信度无效' };
  }
  return { valid: true };
}

function computeAssetHash(assetPath) {
  return createHash('sha256').update(assetPath).digest('hex');
}

function formatLocator(locator) {
  if (!locator) return '未知位置';
  const parts = [];
  if (locator.page) parts.push(`页${locator.page}`);
  if (locator.slide) parts.push(`幻灯片${locator.slide}`);
  if (locator.sheet) parts.push(`Sheet ${locator.sheet}`);
  return parts.length > 0 ? parts.join(', ') : '未知位置';
}
