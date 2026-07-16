/**
 * 流程草稿合同验证库
 *
 * 提供证据块、证据批次、语义片段和流程草稿的验证函数，
 * 以及稳定 ID 生成和规范化 JSON 输出。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const schemasDir = join(__dirname, '../../references/schemas');

// 缓存编译后的 validator
let _validators = null;

async function loadValidators() {
  if (_validators) return _validators;

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const [sourceEvidence, evidenceBatch, semanticFragment, processDraft, contextBudget, normalizedDocument] = await Promise.all([
    readFile(join(schemasDir, 'source-evidence.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'evidence-batch.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'semantic-fragment.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'process-draft.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'context-budget.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'normalized-document.schema.json'), 'utf8').then(JSON.parse),
  ]);

  _validators = {
    evidenceBlock: ajv.compile(sourceEvidence),
    evidenceBatch: ajv.compile(evidenceBatch),
    semanticFragment: ajv.compile(semanticFragment),
    processDraft: ajv.compile(processDraft),
    contextBudget: ajv.compile(contextBudget),
    normalizedDocument: ajv.compile(normalizedDocument),
  };

  return _validators;
}

/**
 * 验证单个证据块
 * @param {object} block - 证据块对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateEvidenceBlock(block) {
  const validators = await loadValidators();
  const valid = validators.evidenceBlock(block);
  return valid
    ? { valid: true }
    : { valid: false, errors: validators.evidenceBlock.errors.map(e => `${e.instancePath} ${e.message}`) };
}

/**
 * 验证证据索引（检查重复 block_id）
 * @param {object[]} blocks - 证据块数组
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateEvidenceIndex(blocks) {
  const errors = [];
  const seenIds = new Set();

  for (const block of blocks) {
    if (seenIds.has(block.block_id)) {
      errors.push(`Duplicate block_id: ${block.block_id}`);
    }
    seenIds.add(block.block_id);

    const result = await validateEvidenceBlock(block);
    if (!result.valid) {
      errors.push(...result.errors.map(e => `Block ${block.block_id}: ${e}`));
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * 验证证据批次
 * @param {object} batch - 证据批次对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateEvidenceBatch(batch) {
  const validators = await loadValidators();
  const valid = validators.evidenceBatch(batch);
  return valid
    ? { valid: true }
    : { valid: false, errors: validators.evidenceBatch.errors.map(e => `${e.instancePath} ${e.message}`) };
}

/**
 * 验证语义片段
 * @param {object} fragment - 语义片段对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateSemanticFragment(fragment) {
  const validators = await loadValidators();

  // 先做 Schema 验证
  const schemaValid = validators.semanticFragment(fragment);
  if (!schemaValid) {
    return { valid: false, errors: validators.semanticFragment.errors.map(e => `${e.instancePath} ${e.message}`) };
  }

  // 再做业务规则验证：检查 dangling related_fact_ids
  const factIds = new Set(fragment.facts.map(f => f.fact_id));
  for (const uncertainty of fragment.uncertainties) {
    for (const relatedId of uncertainty.related_fact_ids) {
      if (!factIds.has(relatedId)) {
        return { valid: false, errors: [`Dangling related_fact_id: ${relatedId}`] };
      }
    }
  }

  return { valid: true };
}

/**
 * 验证上下文预算报告
 * @param {object} budget - ContextBudget 对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateContextBudget(budget) {
  const validators = await loadValidators();
  const valid = validators.contextBudget(budget);
  return valid
    ? { valid: true }
    : { valid: false, errors: validators.contextBudget.errors.map(e => `${e.instancePath} ${e.message}`) };
}

/**
 * 验证归一化文档索引
 * @param {object} doc - NormalizedDocument 对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateNormalizedDocument(doc) {
  const validators = await loadValidators();
  const valid = validators.normalizedDocument(doc);
  return valid
    ? { valid: true }
    : { valid: false, errors: validators.normalizedDocument.errors.map(e => `${e.instancePath} ${e.message}`) };
}

/**
 * 验证流程草稿
 * @param {object} draft - 流程草稿对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateProcessDraft(draft) {
  const validators = await loadValidators();

  // 先做 Schema 验证
  const schemaValid = validators.processDraft(draft);
  if (!schemaValid) {
    return { valid: false, errors: validators.processDraft.errors.map(e => `${e.instancePath} ${e.message}`) };
  }

  // 业务规则验证
  const errors = [];
  const elementIds = new Set(draft.elements.map(e => e.element_id));

  // 检查 flow 引用的元素是否存在
  for (const flow of draft.flows) {
    if (!elementIds.has(flow.source_ref)) {
      errors.push(`Flow ${flow.flow_id} references non-existent source: ${flow.source_ref}`);
    }
    if (!elementIds.has(flow.target_ref)) {
      errors.push(`Flow ${flow.flow_id} references non-existent target: ${flow.target_ref}`);
    }
  }

  // 检查 activity 必须有 lane_id
  for (const element of draft.elements) {
    if (element.kind === 'ACTIVITY' && !element.lane_id) {
      errors.push(`Activity ${element.element_id} missing lane_id`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * 生成稳定 ID
 * 使用内容的 SHA-256 哈希的前 8 位作为后缀
 *
 * @param {string} prefix - ID 前缀（如 'Activity', 'Flow'）
 * @param {string} value - 用于生成 ID 的内容
 * @returns {string} 稳定的 ID
 */
export function stableId(prefix, value) {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return `${prefix}-${hash}`;
}

/**
 * 生成规范化 JSON
 * 确保相同语义对象产生字节一致的结果
 *
 * @param {any} value - 要序列化的值
 * @param {object} [options] - 选项
 * @param {boolean} [options.sortArrays=false] - 是否排序数组
 * @returns {string} 规范化的 JSON 字符串
 */
export function canonicalJson(value, options = {}) {
  const sorted = sortObjectKeys(value, options.sortArrays);
  return JSON.stringify(sorted);
}

function sortObjectKeys(obj, sortArrays = false) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    const mapped = obj.map(item => sortObjectKeys(item, sortArrays));
    return sortArrays ? [...mapped].sort() : mapped;
  }

  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = sortObjectKeys(obj[key], sortArrays);
  }
  return result;
}
