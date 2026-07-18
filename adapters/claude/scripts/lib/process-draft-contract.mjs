/**
 * 流程草稿合同验证库
 *
 * 提供证据块、证据批次、语义片段和流程草稿的验证函数，
 * 以及稳定 ID 生成和规范化 JSON 输出。
 *
 * V2: 注册子 Schema 后编译顶层 Schema，不使用松散字段绕过合同。
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importRuntimePackage } from './runtime-loader.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const schemasDir = join(__dirname, '../../references/schemas');

// 缓存编译后的 validator
let _validators = null;

async function loadValidators() {
  if (_validators) return _validators;

  // 通过 runtime loader 加载，兼容 CJS/ESM 导出形态
  const Ajv2020Module = await importRuntimePackage('core', 'ajv/dist/2020.js');
  const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
  const addFormatsModule = await importRuntimePackage('core', 'ajv-formats');
  const addFormats = addFormatsModule.default ?? addFormatsModule;

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);

  // 加载子 Schema 并注册（process-draft V2 依赖它们）
  // 失败关闭：子 Schema 缺失时不跳过
  const subSchemaNames = [
    'process-card.schema.json',
    'activity-catalog.schema.json',
    'diagram-draft.schema.json',
    'field-provenance.schema.json',
  ];

  for (const name of subSchemaNames) {
    const schema = JSON.parse(await readFile(join(schemasDir, name), 'utf8'));
    ajv.addSchema(schema);
  }

  // 加载 fragment payload 子 Schema 并注册（semantic-fragment 通过 $ref 引用）
  const fragmentSchemaNames = [
    'process-card-fragment.schema.json',
    'activity-fragment.schema.json',
    'control-flow-fragment.schema.json',
  ];

  for (const name of fragmentSchemaNames) {
    const schema = JSON.parse(await readFile(join(schemasDir, name), 'utf8'));
    ajv.addSchema(schema);
  }

  const [sourceEvidence, evidenceBatch, semanticFragment, processDraft, contextBudget, normalizedDocument] = await Promise.all([
    readFile(join(schemasDir, 'source-evidence.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'evidence-batch.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'semantic-fragment.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'process-draft.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'context-budget.schema.json'), 'utf8').then(JSON.parse),
    readFile(join(schemasDir, 'normalized-document.schema.json'), 'utf8').then(JSON.parse),
  ]);

  // 获取已注册的 fragment payload 子 Schema validator
  const processCardFragmentValidator = ajv.getSchema('process-card-fragment');
  const activityFragmentValidator = ajv.getSchema('activity-fragment');
  const controlFlowFragmentValidator = ajv.getSchema('control-flow-fragment');

  _validators = {
    evidenceBlock: ajv.compile(sourceEvidence),
    evidenceBatch: ajv.compile(evidenceBatch),
    semanticFragment: ajv.compile(semanticFragment),
    processDraft: ajv.compile(processDraft),
    contextBudget: ajv.compile(contextBudget),
    normalizedDocument: ajv.compile(normalizedDocument),
    'process-card-fragment': processCardFragmentValidator,
    'activity-fragment': activityFragmentValidator,
    'control-flow-fragment': controlFlowFragmentValidator,
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
 * 验证语义片段（V2 only）
 * @param {object} fragment - 语义片段对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateSemanticFragment(fragment) {
  const validators = await loadValidators();

  // Schema 验证（V2 only：schema_version=2.0.0, task_kind, payload 必填）
  const schemaValid = validators.semanticFragment(fragment);
  if (!schemaValid) {
    return { valid: false, errors: validators.semanticFragment.errors.map(e => `${e.instancePath} ${e.message}`) };
  }

  // V2: 验证 payload 符合对应子 Schema
  const result = await validateSemanticFragmentV2(fragment);
  return result;
}

/**
 * V2 片段任务类型枚举
 */
export const FRAGMENT_TASK_KINDS = ['PROCESS_CARD', 'ACTIVITY_CATALOG', 'CONTROL_FLOW'];

/**
 * 验证 V2 语义片段（含 task_kind 和 payload）
 *
 * @param {object} fragment - V2 语义片段对象
 * @returns {Promise<{ valid: boolean, errors?: string[] }>}
 */
export async function validateSemanticFragmentV2(fragment) {
  const validators = await loadValidators();

  // 先做公共信封 Schema 验证
  const schemaValid = validators.semanticFragment(fragment);
  if (!schemaValid) {
    return { valid: false, errors: validators.semanticFragment.errors.map(e => `${e.instancePath} ${e.message}`) };
  }

  // 必须有 task_kind
  if (!fragment.task_kind) {
    return { valid: false, errors: ['V2 fragment requires task_kind'] };
  }

  // 必须有 payload
  if (!fragment.payload) {
    return { valid: false, errors: ['V2 fragment requires payload'] };
  }

  // 按 task_kind 验证 payload
  const payloadSchemaId = {
    PROCESS_CARD: 'process-card-fragment',
    ACTIVITY_CATALOG: 'activity-fragment',
    CONTROL_FLOW: 'control-flow-fragment',
  }[fragment.task_kind];

  if (!payloadSchemaId) {
    return { valid: false, errors: [`Unknown task_kind: ${fragment.task_kind}`] };
  }

  // 验证 payload 符合对应子 Schema
  const validatePayload = validators[payloadSchemaId];
  if (!validatePayload) {
    return { valid: false, errors: [`No validator for task_kind: ${fragment.task_kind}`] };
  }

  const payloadValid = validatePayload(fragment.payload);
  if (!payloadValid) {
    return { valid: false, errors: validatePayload.errors.map(e => `payload${e.instancePath} ${e.message}`) };
  }

  // 内部一致性：fact_id 唯一、dangling refs、INFERRED/uncertainty
  const { facts = [], uncertainties = [] } = fragment.payload;
  const factIds = new Set();
  for (const fact of facts) {
    if (factIds.has(fact.fact_id)) {
      return { valid: false, errors: [`Duplicate fact_id: ${fact.fact_id}`] };
    }
    factIds.add(fact.fact_id);
  }

  for (const uncertainty of uncertainties) {
    for (const relatedId of uncertainty.related_fact_ids) {
      if (!factIds.has(relatedId)) {
        return { valid: false, errors: [`Dangling related_fact_id: ${relatedId}`] };
      }
    }
  }

  const inferredFacts = facts.filter(f => f.certainty === 'INFERRED');
  for (const fact of inferredFacts) {
    const hasUncertainty = uncertainties.some(u =>
      u.kind === 'NEEDS_CONTEXT' && u.related_fact_ids.includes(fact.fact_id)
    );
    if (!hasUncertainty) {
      return { valid: false, errors: [`INFERRED fact ${fact.fact_id} missing NEEDS_CONTEXT uncertainty`] };
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
 * 验证流程草稿（V2 Schema 验证 + 基本引用一致性）
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

  // 业务规则验证：检查 flow 引用的节点是否存在
  const errors = [];
  const nodeIds = new Set(draft.diagram.nodes.map(n => n.node_id));

  for (const flow of draft.diagram.flows) {
    if (!nodeIds.has(flow.source_ref)) {
      errors.push(`Flow ${flow.flow_id} references non-existent source: ${flow.source_ref}`);
    }
    if (!nodeIds.has(flow.target_ref)) {
      errors.push(`Flow ${flow.flow_id} references non-existent target: ${flow.target_ref}`);
    }
  }

  // 检查 task_bindings 引用的活动是否存在
  const activityIds = new Set(draft.activities.map(a => a.activity_id));
  for (const binding of draft.diagram.task_bindings) {
    if (!activityIds.has(binding.activity_id)) {
      errors.push(`Task binding references non-existent activity: ${binding.activity_id}`);
    }
    if (!nodeIds.has(binding.main_task_id)) {
      errors.push(`Task binding references non-existent main_task: ${binding.main_task_id}`);
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
