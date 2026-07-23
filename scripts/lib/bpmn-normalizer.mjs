/**
 * BPMN 规范化器
 *
 * 从 BPMN XML 恢复规范图模型并触发重排。
 * 只接受有限元素，不支持复杂网关、事务、补偿等。
 */

import { normalizeBpmnXml } from './bpmn-compiler.mjs';

/**
 * 规范化 BPMN XML
 *
 * @param {string} xml - BPMN 2.0 XML
 * @param {object} options - 选项
 * @param {Array} options.activities - 活动列表
 * @returns {{ diagram: object, warnings: string[] }}
 */
export function normalizeBpmn(xml, { activities = [] } = {}) {
  // 验证 XML 不包含危险内容
  if (xml.includes('<!DOCTYPE') || xml.includes('<!ENTITY')) {
    throw new Error('BPMN 包含 DOCTYPE 或 ENTITY 声明，已拒绝');
  }

  // 调用编译器的规范化函数
  const result = normalizeBpmnXml(xml, { activities });

  // 验证规范化结果
  const warnings = result.warnings || [];
  const diagram = result.diagram;

  // 检查不支持的元素
  const supportedTypes = [
    'MAIN_TASK',
    'CONFIRMATION_TASK',
    'GATEWAY_XOR',
    'GATEWAY_AND',
    'GATEWAY_OR',
    'START_EVENT',
    'END_EVENT',
    'INTERMEDIATE_MESSAGE_CATCH',
    'INTERMEDIATE_MESSAGE_THROW',
    'INTERMEDIATE_TIMER_CATCH',
    'INTERMEDIATE_LINK_CATCH',
    'INTERMEDIATE_LINK_THROW',
  ];

  for (const node of diagram.nodes) {
    if (!supportedTypes.includes(node.node_type)) {
      warnings.push(`不支持的节点类型: ${node.node_type} (${node.node_id})`);
    }
  }

  // 检查悬空引用
  const nodeIds = new Set(diagram.nodes.map(n => n.node_id));
  for (const flow of diagram.flows) {
    if (!nodeIds.has(flow.source_ref)) {
      warnings.push(`流 ${flow.flow_id} 引用不存在的源节点: ${flow.source_ref}`);
    }
    if (!nodeIds.has(flow.target_ref)) {
      warnings.push(`流 ${flow.flow_id} 引用不存在的目标节点: ${flow.target_ref}`);
    }
  }

  // 检查重复 ID
  const seenIds = new Set();
  for (const node of diagram.nodes) {
    if (seenIds.has(node.node_id)) {
      warnings.push(`重复的节点 ID: ${node.node_id}`);
    }
    seenIds.add(node.node_id);
  }

  return { diagram, warnings };
}

/**
 * 验证规范化结果
 *
 * @param {object} diagram - 规范化后的图模型
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateNormalizedDiagram(diagram) {
  const errors = [];

  // 检查必需字段
  if (!diagram.nodes || !Array.isArray(diagram.nodes)) {
    errors.push('缺少 nodes 数组');
  }
  if (!diagram.flows || !Array.isArray(diagram.flows)) {
    errors.push('缺少 flows 数组');
  }
  if (!diagram.task_bindings || !Array.isArray(diagram.task_bindings)) {
    errors.push('缺少 task_bindings 数组');
  }

  // 检查节点类型
  const validNodeTypes = [
    'MAIN_TASK',
    'CONFIRMATION_TASK',
    'GATEWAY_XOR',
    'GATEWAY_AND',
    'GATEWAY_OR',
    'START_EVENT',
    'END_EVENT',
    'INTERMEDIATE_MESSAGE_CATCH',
    'INTERMEDIATE_MESSAGE_THROW',
    'INTERMEDIATE_TIMER_CATCH',
    'INTERMEDIATE_LINK_CATCH',
    'INTERMEDIATE_LINK_THROW',
  ];

  for (const node of diagram.nodes || []) {
    if (!validNodeTypes.includes(node.node_type)) {
      errors.push(`无效的节点类型: ${node.node_type}`);
    }
    if (!node.node_id) {
      errors.push('节点缺少 node_id');
    }
  }

  // 检查流引用
  const nodeIds = new Set((diagram.nodes || []).map(n => n.node_id));
  for (const flow of diagram.flows || []) {
    if (!flow.flow_id) {
      errors.push('流缺少 flow_id');
    }
    if (!nodeIds.has(flow.source_ref)) {
      errors.push(`流 ${flow.flow_id} 引用不存在的源节点: ${flow.source_ref}`);
    }
    if (!nodeIds.has(flow.target_ref)) {
      errors.push(`流 ${flow.flow_id} 引用不存在的目标节点: ${flow.target_ref}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
