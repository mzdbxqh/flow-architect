import { createReviewFinding } from './lib/review-finding.mjs';

/**
 * BPMN 结构审查
 *
 * 支持 V1 (elements/flows) 和 V2 (nodes/flows) 模型。
 * 规则：FA-BPMN-004, FA-BPMN-005, FA-BPMN-007
 *
 * V2 口径修正：
 * - None Start/End 不触发事件类型错误
 * - XOR 全部分支有条件时不要求默认流
 * - 无汇合需求的 XOR 不因拆分/汇合数量不等失败
 * - AND 拆分/汇合不成对仍产生 BPMN finding
 *
 * @param {object} params
 * @param {object} params.diagramModel - V1 或 V2 图模型
 * @returns {Array<Finding>}
 */
export function reviewBpmn({ diagramModel }) {
  if (!diagramModel) throw new Error('diagramModel is required');
  const findings = [];
  const artifactId = 'process.bpmn';

  // 判断 V1 还是 V2 模型
  const isV2 = Array.isArray(diagramModel.nodes);
  const nodes = isV2 ? (diagramModel.nodes ?? []) : (diagramModel.elements ?? []);
  const flows = diagramModel.flows ?? [];

  // ── FA-BPMN-007: 孤立元素检测 ──
  const connected = new Set();
  for (const flow of flows) {
    connected.add(flow.source_ref);
    connected.add(flow.target_ref);
  }

  if (isV2) {
    // V2: 检查 MAIN_TASK, CONFIRMATION_TASK, START_EVENT, END_EVENT 和中间事件
    const checkTypes = new Set([
      'MAIN_TASK', 'CONFIRMATION_TASK', 'START_EVENT', 'END_EVENT',
      'INTERMEDIATE_MESSAGE_CATCH', 'INTERMEDIATE_MESSAGE_THROW',
      'INTERMEDIATE_TIMER_CATCH', 'INTERMEDIATE_LINK_CATCH', 'INTERMEDIATE_LINK_THROW',
    ]);
    for (const node of nodes) {
      if (checkTypes.has(node.node_type) && !connected.has(node.node_id)) {
        findings.push(createReviewFinding({
          ruleId: 'FA-BPMN-007', category: 'BPMN', severity: 'CRITICAL', artifactId,
          targetRef: node.node_id, locatorType: 'BPMN_ELEMENT', locator: node.node_id,
          excerpt: node.name,
          observation: `BPMN element ${node.node_id} has no incoming or outgoing sequence flow.`,
          expected: 'Every task and event participates in at least one sequence flow.',
          actual: 'The element is isolated from the process flow.',
          recommendation: 'Connect the element to the intended path or remove it from the diagram.',
          confidence: 1,
        }));
      }
    }
  } else {
    // V1: 兼容旧格式
    for (const element of nodes) {
      if (['TASK', 'SUB_PROCESS', 'EVENT'].includes(element.type) && !connected.has(element.element_id)) {
        findings.push(createReviewFinding({
          ruleId: 'FA-BPMN-007', category: 'BPMN', severity: 'CRITICAL', artifactId,
          targetRef: element.element_id, locatorType: 'BPMN_ELEMENT', locator: element.element_id,
          excerpt: element.name,
          observation: `BPMN element ${element.element_id} has no incoming or outgoing sequence flow.`,
          expected: 'Every task, sub-process, and event participates in at least one sequence flow.',
          actual: 'The element is isolated from the process flow.',
          recommendation: 'Connect the element to the intended path or remove it from the diagram.',
          confidence: 1,
        }));
      }
    }
  }

  if (!isV2) return findings;

  // ── V2-only 规则 ──

  const gatewayTypes = new Set(['GATEWAY_XOR', 'GATEWAY_OR', 'GATEWAY_AND']);
  const outgoingBySource = new Map();
  const incomingByTarget = new Map();
  for (const flow of flows) {
    if (!outgoingBySource.has(flow.source_ref)) outgoingBySource.set(flow.source_ref, []);
    outgoingBySource.get(flow.source_ref).push(flow);
    if (!incomingByTarget.has(flow.target_ref)) incomingByTarget.set(flow.target_ref, []);
    incomingByTarget.get(flow.target_ref).push(flow);
  }

  // ── FA-BPMN-004: 网关配对检查 ──
  // AND 拆分/汇合必须成对
  const andSplits = nodes.filter(n => n.node_type === 'GATEWAY_AND' && (outgoingBySource.get(n.node_id)?.length ?? 0) > 1);
  const andJoins = nodes.filter(n => n.node_type === 'GATEWAY_AND' && (incomingByTarget.get(n.node_id)?.length ?? 0) > 1);

  for (const split of andSplits) {
    const hasMatchingJoin = andJoins.some(j => j.node_id !== split.node_id);
    if (!hasMatchingJoin) {
      findings.push(createReviewFinding({
        ruleId: 'FA-BPMN-004', category: 'BPMN', severity: 'CRITICAL', artifactId,
        targetRef: split.node_id, locatorType: 'BPMN_ELEMENT', locator: split.node_id,
        excerpt: split.name,
        observation: `AND split "${split.name || split.node_id}" has no matching AND join gateway`,
        expected: 'Every AND split should have a corresponding AND join',
        actual: 'No matching AND join found',
        recommendation: 'Add an AND join gateway to synchronize parallel branches',
        confidence: 1,
      }));
    }
  }

  for (const join of andJoins) {
    const hasMatchingSplit = andSplits.some(s => s.node_id !== join.node_id);
    if (!hasMatchingSplit) {
      findings.push(createReviewFinding({
        ruleId: 'FA-BPMN-004', category: 'BPMN', severity: 'CRITICAL', artifactId,
        targetRef: join.node_id, locatorType: 'BPMN_ELEMENT', locator: join.node_id,
        excerpt: join.name,
        observation: `AND join "${join.name || join.node_id}" has no matching AND split gateway`,
        expected: 'Every AND join should have a corresponding AND split',
        actual: 'No matching AND split found',
        recommendation: 'Add an AND split gateway or remove the orphan join',
        confidence: 1,
      }));
    }
  }

  // XOR/OR：不要求配对（不需要汇合的 XOR 不应失败）
  // 只检查 XOR/OR 拆分但有条件检查（FA-BPMN-005）

  // ── FA-BPMN-005: XOR/OR 分支条件检查 ──
  // V2 口径修正：XOR/OR 所有分支有结构化条件时不强制要求默认流
  const xorOrGateways = nodes.filter(n =>
    (n.node_type === 'GATEWAY_XOR' || n.node_type === 'GATEWAY_OR') &&
    (outgoingBySource.get(n.node_id)?.length ?? 0) > 1
  );

  for (const gw of xorOrGateways) {
    const outFlows = outgoingBySource.get(gw.node_id) ?? [];
    const allHaveCondition = outFlows.every(f => f.condition != null && typeof f.condition === 'object' && f.condition.label);

    if (!allHaveCondition) {
      const gwType = gw.node_type === 'GATEWAY_XOR' ? 'XOR' : 'OR';
      findings.push(createReviewFinding({
        ruleId: 'FA-BPMN-005', category: 'BPMN', severity: 'MAJOR', artifactId,
        targetRef: gw.node_id, locatorType: 'BPMN_ELEMENT', locator: gw.node_id,
        excerpt: gw.name,
        observation: `${gwType} gateway "${gw.name || gw.node_id}" has branches without structured conditions`,
        expected: 'All branches should have structured conditions, or one should be a default path',
        actual: `${outFlows.filter(f => !f.condition).length} branches lack conditions`,
        recommendation: 'Add structured conditions to all branches or designate a default path',
        confidence: 0.9,
      }));
    }
  }

  return findings;
}
