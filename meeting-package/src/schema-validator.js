/**
 * Schema Validator - V2 Draft 完整 Schema 门禁
 *
 * 使用 Ajv + 真实 process-draft.schema.json 及其引用 Schema，
 * 对当前完整草稿执行与服务端构建器相同语义的 V2 Schema 校验。
 * 浏览器端校验必须来自可打包的确定性合同，不得联网，也不得复制会漂移的字段列表。
 */
import Ajv2020 from 'ajv/dist/2020.js';

// 导入所有引用 Schema（浏览器打包时由 esbuild 内联）
import processDraftSchema from '../../references/schemas/process-draft.schema.json' with { type: 'json' };
import processCardSchema from '../../references/schemas/process-card.schema.json' with { type: 'json' };
import activityCatalogSchema from '../../references/schemas/activity-catalog.schema.json' with { type: 'json' };
import diagramDraftSchema from '../../references/schemas/diagram-draft.schema.json' with { type: 'json' };
import fieldProvenanceSchema from '../../references/schemas/field-provenance.schema.json' with { type: 'json' };

/** @type {import('ajv').Ajv} */
let _validator = null;

function getValidator() {
  if (_validator) return _validator;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // 注册所有引用 Schema
  ajv.addSchema(processCardSchema, 'process-card');
  ajv.addSchema(activityCatalogSchema, 'activity-catalog');
  ajv.addSchema(diagramDraftSchema, 'diagram-draft');
  ajv.addSchema(fieldProvenanceSchema, 'field-provenance');
  _validator = ajv.compile(processDraftSchema);
  return _validator;
}

/**
 * 执行完整 V2 Schema 校验
 * @param {object} snapshot - DraftStore 快照（不含 metadata/bpmn_xml）
 * @returns {{ valid: boolean, errors: Array<{code: string, path: string, message: string}> }}
 */
export function validateV2Draft(snapshot) {
  const validate = getValidator();
  const valid = validate(snapshot);
  if (valid) return { valid: true, errors: [] };
  const errors = validate.errors.map(err => ({
    code: 'FA-DRAFT-SCHEMA-001',
    path: err.instancePath || '/',
    message: `${err.instancePath || '/'} ${err.message}${err.params ? ' ' + JSON.stringify(err.params) : ''}`.trim(),
  }));
  return { valid: false, errors };
}
