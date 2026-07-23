/**
 * 最小规则包构建器
 *
 * 按规则 ID 从 catalog 和规则文档中提取精确的规则内容，
 * 生成只包含请求规则的最小规则包。
 *
 * @module rule-packet-builder
 */

import { estimateTokens, buildContextBudget } from './context-budget.mjs';

/**
 * 构建最小规则包
 *
 * @param {object} params
 * @param {object} params.catalog - rule-catalog.json 内容
 * @param {object} params.ruleDocuments - { filename: content } 规则文档映射
 * @param {string[]} params.ruleIds - 需要的规则 ID 列表
 * @returns {{ markdown: string, ruleIds: string[], budget: object }}
 */
export function buildRulePacket({ catalog, ruleDocuments, ruleIds }) {
  if (!catalog?.rules || !Array.isArray(catalog.rules)) {
    throw new Error('catalog.rules 缺失或不是数组');
  }

  // 验证所有请求的规则 ID 都存在
  const catalogMap = new Map(catalog.rules.map(r => [r.rule_id, r]));
  const missing = ruleIds.filter(id => !catalogMap.has(id));
  if (missing.length > 0) {
    throw new Error(`规则 ID 不存在: ${missing.join(', ')}`);
  }

  // 构建规则文件 → 规则 ID 的索引
  const fileRuleMap = buildFileRuleIndex(catalog);

  // 按规则 ID 提取内容
  const sections = [];
  for (const ruleId of ruleIds) {
    const rule = catalogMap.get(ruleId);
    const ref = rule.public_reference || '';
    // 从 public_reference 解析文件名和锚点
    const [filename, anchor] = parseReference(ref);
    const docContent = ruleDocuments[filename];

    if (!docContent) {
      throw new Error(`规则 ${ruleId} 的文档文件 ${filename} 不存在或无法读取`);
    }

    if (!anchor) {
      throw new Error(`规则 ${ruleId} 的 public_reference 缺少锚点: ${ref}`);
    }

    const section = extractSection(docContent, anchor, ruleId);
    if (!section) {
      throw new Error(`规则 ${ruleId} 的标题 "${anchor}" 在 ${filename} 中未找到`);
    }

    sections.push(section);
  }

  const markdown = sections.join('\n\n---\n\n');
  const { estimated_tokens } = estimateTokens(markdown);

  // 构建预算报告
  const budget = buildContextBudget({
    contentTexts: [markdown],
    fixedTexts: [],
    metadataTexts: [],
    limit: 2000, // 规则包 token 基准
    sourceIds: ruleIds,
  });

  return {
    markdown,
    ruleIds: [...ruleIds],
    budget,
  };
}

/**
 * 从 public_reference 解析文件名和锚点
 * 例如 "references/rules/l4-review.md#FA-L4-001" → ["l4-review.md", "FA-L4-001"]
 */
function parseReference(ref) {
  if (!ref) return [null, null];
  const parts = ref.split('#');
  const pathPart = parts[0] || '';
  const anchor = parts[1] || null;
  // 提取文件名（去掉路径前缀）
  const filename = pathPart.split('/').pop() || null;
  return [filename, anchor];
}

/**
 * 从规则文档中提取以锚点标记的章节
 * 锚点匹配方式：标题中包含 ruleId
 */
function extractSection(docContent, anchor, ruleId) {
  const lines = docContent.split('\n');
  let inSection = false;
  let sectionLines = [];
  let sectionLevel = 0;

  for (const line of lines) {
    // 检测标题行
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];

      if (title.includes(anchor) || title.includes(ruleId)) {
        // 找到目标章节
        inSection = true;
        sectionLevel = level;
        sectionLines = [line];
        continue;
      }

      if (inSection && level <= sectionLevel) {
        // 遇到同级或更高级标题，结束当前章节
        break;
      }
    }

    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.length > 0 ? sectionLines.join('\n').trim() : null;
}

/**
 * 构建文件名 → 规则 ID 列表的索引
 */
function buildFileRuleIndex(catalog) {
  const index = {};
  for (const rule of catalog.rules) {
    const [filename] = parseReference(rule.public_reference);
    if (filename) {
      if (!index[filename]) index[filename] = [];
      index[filename].push(rule.rule_id);
    }
  }
  return index;
}
