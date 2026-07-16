/**
 * 统一 Token 预算估算与门禁模块
 *
 * 提供确定性 Token 估算公式、双阈值状态判定和上下文预算构建。
 * 估算公式：ceil(汉字数/1.5 + ASCII字符数/4 + 其他非ASCII字符数)
 * 状态：BUDGET_OK → BUDGET_ATTENTION (≥100%) → BUDGET_SPLIT_REQUIRED (>120%)
 */

export const BUDGET_STATUS = Object.freeze({
  OK: 'BUDGET_OK',
  ATTENTION: 'BUDGET_ATTENTION',
  SPLIT_REQUIRED: 'BUDGET_SPLIT_REQUIRED',
});

export const FORMULA_VERSION = '1.0.0';

/**
 * 估算文本的 Token 数，按汉字/ASCII/其他分类
 * @param {string} text
 * @returns {{ han_chars: number, ascii_chars: number, other_chars: number, estimated_tokens: number }}
 */
export function estimateTokens(text = '') {
  let han = 0;
  let ascii = 0;
  let other = 0;
  for (const ch of String(text)) {
    if (/\p{Script=Han}/u.test(ch)) han += 1;
    else if (ch.codePointAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return {
    han_chars: han,
    ascii_chars: ascii,
    other_chars: other,
    estimated_tokens: Math.ceil(han / 1.5 + ascii / 4 + other),
  };
}

/**
 * 评估预算状态
 * @param {{ used: number, limit: number }}
 * @returns {{ status: string, used: number, limit: number, ratio: number, split_required: boolean }}
 */
export function assessBudget({ used, limit }) {
  const ratio = limit > 0 ? used / limit : Infinity;
  let status;
  if (ratio > 1.2) {
    status = BUDGET_STATUS.SPLIT_REQUIRED;
  } else if (ratio >= 1.0) {
    status = BUDGET_STATUS.ATTENTION;
  } else {
    status = BUDGET_STATUS.OK;
  }
  return {
    status,
    used,
    limit,
    ratio,
    split_required: status === BUDGET_STATUS.SPLIT_REQUIRED,
  };
}

/**
 * 构建上下文预算报告
 * @param {object} params
 * @param {string[]} params.fixedTexts - 固定上下文文本
 * @param {string[]} params.contentTexts - 业务正文文本
 * @param {string[]} params.metadataTexts - 元数据文本
 * @param {number} params.limit - 预算上限（token）
 * @param {string[]} params.sourceIds - 来源 ID 列表
 * @returns {object} ContextBudget
 */
export function buildContextBudget({
  fixedTexts = [],
  contentTexts = [],
  metadataTexts = [],
  limit,
  sourceIds = [],
} = {}) {
  const fixed = sumEstimates(fixedTexts);
  const content = sumEstimates(contentTexts);
  const metadata = sumEstimates(metadataTexts);
  const totalTokens = fixed.estimated_tokens + content.estimated_tokens + metadata.estimated_tokens;

  const assessment = assessBudget({ used: totalTokens, limit });

  return {
    formula_version: FORMULA_VERSION,
    fixed,
    content,
    metadata,
    total: {
      han_chars: fixed.han_chars + content.han_chars + metadata.han_chars,
      ascii_chars: fixed.ascii_chars + content.ascii_chars + metadata.ascii_chars,
      other_chars: fixed.other_chars + content.other_chars + metadata.other_chars,
      estimated_tokens: totalTokens,
    },
    estimated_tokens: totalTokens,
    limit,
    ratio: assessment.ratio,
    status: assessment.status,
    split_required: assessment.split_required,
    source_ids: sourceIds,
  };
}

/**
 * 对多段文本分别估算后汇总
 * @param {string[]} texts
 * @returns {{ han_chars: number, ascii_chars: number, other_chars: number, estimated_tokens: number }}
 */
function sumEstimates(texts) {
  let han = 0, ascii = 0, other = 0, tokens = 0;
  for (const t of texts) {
    const e = estimateTokens(t);
    han += e.han_chars;
    ascii += e.ascii_chars;
    other += e.other_chars;
    tokens += e.estimated_tokens;
  }
  return { han_chars: han, ascii_chars: ascii, other_chars: other, estimated_tokens: tokens };
}
