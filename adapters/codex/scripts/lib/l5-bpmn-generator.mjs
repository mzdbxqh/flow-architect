/**
 * L5 BPMN 2.0 生成器
 *
 * 从流程草稿确定性生成 BPMN 2.0 XML 和 DI 布局。
 * 使用独立确定性布局模块计算位置和路径。
 * 不调用 LLM，完全基于草稿数据。
 */

import { compileBpmn } from './bpmn-compiler.mjs';

/**
 * 生成 L5 BPMN 2.0 XML
 *
 * @param {object} draft - 流程草稿（V2 格式）
 * @returns {string} BPMN 2.0 XML
 */
export function generateL5Bpmn(draft) {
  if (draft.schema_version !== '2.0.0') {
    throw new Error('仅支持 schema_version 2.0.0 的流程草稿');
  }

  const { xml } = compileBpmn(draft);
  return xml;
}
