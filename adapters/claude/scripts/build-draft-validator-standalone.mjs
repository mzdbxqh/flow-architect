/**
 * 构建期 Ajv 预编译（standalone）生成器
 *
 * 背景：会议包 HTML 的 CSP 为 script-src 'sha256-...'（无 unsafe-eval），
 * Ajv 在浏览器端运行时 compile 会触发 new Function，被 CSP 拦截，导致
 * 一切经过 currentPayload 的导出（新版本 HTML/BPMN/问题/完整 JSON）失败。
 *
 * 方案：构建会议包 bundle 时，在 Node 侧用同一份真实 Schema 预编译
 * Ajv 校验器，产出无 eval 的 standalone ESM 代码，由 esbuild 插件
 * 替换浏览器端的 ./schema-validator.js（Node 测试仍使用运行时编译版本）。
 *
 * 本文件是构建期脚本（build-* 约定），允许裸导入 devDependency；
 * 不得被 scripts/lib/ 下的运行时脚本导入。
 *
 * 注意：addSchema 的键名与 compile 目标必须与
 * meeting-package/src/schema-validator.js 完全一致，保证 $ref 解析一致。
 */

import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import processDraftSchema from '../references/schemas/process-draft.schema.json' with { type: 'json' };
import processCardSchema from '../references/schemas/process-card.schema.json' with { type: 'json' };
import activityCatalogSchema from '../references/schemas/activity-catalog.schema.json' with { type: 'json' };
import diagramDraftSchema from '../references/schemas/diagram-draft.schema.json' with { type: 'json' };
import fieldProvenanceSchema from '../references/schemas/field-provenance.schema.json' with { type: 'json' };

/**
 * 生成 standalone 校验器 ESM 源码（export default validate）。
 * @returns {string} ESM JavaScript 源码
 */
export function generateDraftValidatorStandalone() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true, esm: true } });
  ajv.addSchema(processCardSchema, 'process-card');
  ajv.addSchema(activityCatalogSchema, 'activity-catalog');
  ajv.addSchema(diagramDraftSchema, 'diagram-draft');
  ajv.addSchema(fieldProvenanceSchema, 'field-provenance');
  const validate = ajv.compile(processDraftSchema);
  return standaloneCode(ajv, validate);
}

/**
 * 浏览器端 schema-validator 替换模块源码。
 * 错误映射与 meeting-package/src/schema-validator.js 保持一致（FA-DRAFT-SCHEMA-001）。
 * @param {string} standaloneSpecifier - wrapper 指向 standalone 模块的相对路径
 * @returns {string} ESM JavaScript 源码
 */
export function generateBrowserSchemaValidator(standaloneSpecifier) {
  return `// 构建期生成：Ajv standalone 预编译校验器（CSP 安全，无 eval）。
// 错误映射须与 meeting-package/src/schema-validator.js 保持一致。
import validate from '${standaloneSpecifier}';

export function validateV2Draft(snapshot) {
  const valid = validate(snapshot);
  if (valid) return { valid: true, errors: [] };
  const errors = validate.errors.map(err => ({
    code: 'FA-DRAFT-SCHEMA-001',
    path: err.instancePath || '/',
    message: \`\${err.instancePath || '/'} \${err.message}\${err.params ? ' ' + JSON.stringify(err.params) : ''}\`.trim(),
  }));
  return { valid: false, errors };
}
`;
}
