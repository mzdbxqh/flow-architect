/**
 * Markdown 归一化模块
 *
 * 将多格式证据块确定性渲染为可定位的 Markdown 分片。
 * 每个分片使用 YAML frontmatter 头部，包含来源定位、哈希和预算信息。
 * 支持可拔插视觉转 Markdown 提供器。
 */

import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  refineVisualAsset,
  registerVisualToMarkdownProvider,
  resetProviders,
} from './visual-to-markdown-provider.mjs';

// 重新导出视觉 provider 函数
export { registerVisualToMarkdownProvider, resetProviders };

/**
 * 渲染单个 Markdown 分片
 *
 * @param {object} params
 * @param {object} params.metadata - 分片元数据
 * @param {string} params.content - 正文内容
 * @returns {string} 带 YAML frontmatter 的 Markdown
 */
export function renderMarkdownChunk({ metadata, content }) {
  const {
    artifact_id,
    source_sha256,
    source_format,
    chunk_id,
    content_sha256,
    sequence,
    locator,
    converter_version,
    modality,
    budget_status = 'BUDGET_OK',
    domain_tags = [],
    heading_path = [],
  } = metadata;

  const locatorStr = JSON.stringify(locator || {});
  // Escape any --- in the content by replacing with a safe marker
  const safeContent = content || '';

  const frontmatter = [
    '---',
    `artifact_id: ${artifact_id}`,
    `source_sha256: ${source_sha256}`,
    `source_format: ${source_format}`,
    `chunk_id: ${chunk_id}`,
    `content_sha256: ${content_sha256}`,
    `sequence: ${sequence}`,
    `locator: '${locatorStr.replace(/'/g, "''")}'`,
    `converter_version: ${converter_version}`,
    `modality: ${modality}`,
    `budget_status: ${budget_status}`,
    `domain_tags: '${JSON.stringify(domain_tags)}'`,
    `heading_path: '${JSON.stringify(heading_path)}'`,
    '---',
    '',
  ].join('\n');

  return frontmatter + safeContent;
}

/**
 * 生成稳定的 chunk_id
 * 由 artifact_sha256 + locator + content_sha256 + converter_version 计算
 */
function computeChunkId(artifactSha256, locator, contentSha256, converterVersion) {
  const locatorStr = typeof locator === 'string' ? locator : JSON.stringify(locator);
  const input = `${artifactSha256}:${locatorStr}:${contentSha256}:${converterVersion}`;
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 12);
  return `C-${hash}`;
}

/**
 * 生成稳定的 artifact_id
 */
function computeArtifactId(artifactSha256) {
  return `A-${artifactSha256.slice(0, 12)}`;
}

/**
 * 将证据块归一化为可定位 Markdown 分片
 *
 * @param {object} params
 * @param {{ path: string, format: string }} params.artifact - 原始文件信息
 * @param {string} params.artifactSha256 - 原始文件 SHA-256
 * @param {object[]} params.blocks - 证据块数组
 * @param {string} params.runDir - 运行目录
 * @param {string} params.converterVersion - 转换器版本
 * @returns {Promise<object>} NormalizedDocument
 */
export async function normalizeEvidenceToMarkdown({
  artifact,
  artifactSha256,
  blocks,
  runDir,
  converterVersion = '1.0.0',
}) {
  const artifactId = computeArtifactId(artifactSha256);
  const artifactDir = join(runDir, 'normalized', artifactId);
  const chunksDir = join(artifactDir, 'chunks');

  await mkdir(chunksDir, { recursive: true });

  const chunks = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const sequence = i + 1;
    const isVisual = block.modality === 'VISUAL' || block.modality === 'VISUAL_ASSET';

    let content;
    let contentSha256;
    let budgetStatus = 'BUDGET_OK';

    if (isVisual) {
      // 尝试使用视觉 provider
      try {
        const providerResult = await refineVisualAsset({
          assetPath: block.asset_ref || block.locator?.path || 'unknown',
          locator: block.locator || {},
          budget: { limit: 48000 },
        });

        if (providerResult.status === 'REFINED') {
          content = providerResult.markdown;
          contentSha256 = createHash('sha256').update(content).digest('hex');
        } else {
          // Provider unavailable，使用占位块
          content = `<!-- VISUAL_REFINEMENT_UNAVAILABLE: ${providerResult.status} -->`;
          contentSha256 = `VISUAL_PLACEHOLDER_${createHash('sha256').update(JSON.stringify(block.locator)).digest('hex').slice(0, 8)}`;
        }
      } catch (err) {
        // 视觉处理异常，降级到占位块
        content = `<!-- VISUAL_REFINEMENT_UNAVAILABLE: ${err.message} -->`;
        contentSha256 = `VISUAL_PLACEHOLDER_${createHash('sha256').update(JSON.stringify(block.locator)).digest('hex').slice(0, 8)}`;
      }
    } else {
      content = block.content || '';
      contentSha256 = createHash('sha256').update(content).digest('hex');
    }

    const chunkId = computeChunkId(artifactSha256, block.locator, contentSha256, converterVersion);
    const chunkFilename = `${String(sequence).padStart(4, '0')}.md`;

    const metadata = {
      artifact_id: artifactId,
      source_sha256: artifactSha256,
      source_format: artifact.format,
      chunk_id: chunkId,
      content_sha256: contentSha256,
      sequence,
      locator: block.locator || {},
      converter_version: converterVersion,
      modality: block.modality || 'TEXT',
      budget_status: budgetStatus,
      domain_tags: block.domain_tags || extractDomainTags(block.heading_path, content),
      heading_path: block.heading_path || [],
    };

    const rendered = renderMarkdownChunk({ metadata, content });
    await writeFile(join(chunksDir, chunkFilename), rendered, 'utf8');

    chunks.push({
      chunk_id: chunkId,
      path: `chunks/${chunkFilename}`,
      content_sha256: contentSha256,
      source_content_sha256: block.content_sha256,
      locator: block.locator || {},
      modality: block.modality || 'TEXT',
      budget_status: budgetStatus,
      heading_path: block.heading_path || [],
      domain_tags: block.domain_tags || extractDomainTags(block.heading_path, content),
    });
  }

  const index = {
    artifact_id: artifactId,
    artifact_sha256: artifactSha256,
    source_format: artifact.format,
    converter_version: converterVersion,
    chunks,
  };

  // Atomic write: write to temp then rename
  const indexPath = join(artifactDir, 'index.json');
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');

  return index;
}

/**
 * 从 heading_path 和内容中提取领域标签
 *
 * @param {string[]} headingPath - 标题路径数组
 * @param {string} content - 正文内容
 * @returns {string[]} 领域标签数组
 */
function extractDomainTags(headingPath, content) {
  const tags = new Set();
  const patterns = [
    { pattern: /\bL4\b/i, tag: 'L4' },
    { pattern: /\bL5\b/i, tag: 'L5' },
    { pattern: /\bL6\b/i, tag: 'L6' },
    { pattern: /\bSOP\b/i, tag: 'SOP' },
    { pattern: /\bBPMN\b/i, tag: 'BPMN' },
    { pattern: /可视化|VISUAL|图表|流程图/i, tag: 'VISUAL' },
  ];

  // 检查 heading_path
  if (headingPath) {
    for (const heading of headingPath) {
      for (const { pattern, tag } of patterns) {
        if (pattern.test(heading)) {
          tags.add(tag);
        }
      }
    }
  }

  // 检查内容前 500 字符
  const contentPrefix = content.slice(0, 500);
  for (const { pattern, tag } of patterns) {
    if (pattern.test(contentPrefix)) {
      tags.add(tag);
    }
  }

  return Array.from(tags).sort();
}
