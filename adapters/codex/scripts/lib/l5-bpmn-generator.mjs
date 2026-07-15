/**
 * L5 BPMN 2.0 生成器
 *
 * 从流程草稿确定性生成 BPMN 2.0 XML 和 DI 布局。
 * 使用独立确定性布局模块计算位置和路径。
 * 不调用 LLM，完全基于草稿数据。
 */

import { createHash } from 'node:crypto';
import { layoutProcessGraph } from './deterministic-bpmn-layout.mjs';

/**
 * 生成 L5 BPMN 2.0 XML
 *
 * @param {object} draft - 流程草稿
 * @returns {string} BPMN 2.0 XML
 */
export function generateL5Bpmn(draft) {
  const layout = layoutProcessGraph(draft);
  const lines = [];

  // XML 头
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  lines.push('  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"');
  lines.push('  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"');
  lines.push('  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"');

  // 检查是否有条件表达式（需要 xsi 命名空间）
  const hasConditionExpression = draft.flows.some(f => f.condition);
  if (hasConditionExpression) {
    lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  }

  lines.push(`  id="Definitions_${stableHash(draft.process_id)}"`);
  lines.push('  targetNamespace="http://bpmn.io/schema/bpmn">');

  // 单 Collaboration + 单 participant
  lines.push('  <bpmn:collaboration id="Collaboration_1">');
  lines.push(`    <bpmn:participant id="Participant_1" name="${escapeXml(draft.title)}" processRef="Process_${draft.process_id}" />`);
  lines.push('  </bpmn:collaboration>');

  // Process
  lines.push(`  <bpmn:process id="Process_${draft.process_id}" isExecutable="false">`);

  // 单 LaneSet
  lines.push('    <bpmn:laneSet id="LaneSet_1">');
  for (const lane of draft.lanes) {
    lines.push(`      <bpmn:lane id="Lane_${lane.lane_id}" name="${escapeXml(lane.name)}">`);
    // 添加泳道中的元素引用
    const laneElements = draft.elements.filter(e => e.lane_id === lane.lane_id);
    for (const element of laneElements) {
      lines.push(`        <bpmn:flowNodeRef>${element.element_id}</bpmn:flowNodeRef>`);
    }
    lines.push('      </bpmn:lane>');
  }
  lines.push('    </bpmn:laneSet>');

  // 计算每个元素的 incoming/outgoing flows
  const incomingByTarget = new Map();
  const outgoingBySource = new Map();
  for (const flow of draft.flows) {
    if (!incomingByTarget.has(flow.target_ref)) incomingByTarget.set(flow.target_ref, []);
    incomingByTarget.get(flow.target_ref).push(flow.flow_id);
    if (!outgoingBySource.has(flow.source_ref)) outgoingBySource.set(flow.source_ref, []);
    outgoingBySource.get(flow.source_ref).push(flow.flow_id);
  }

  // 找到所有入度为零的元素（根节点）
  const rootElements = findRootElements(draft.elements, incomingByTarget);
  // 找到所有出度为零的元素（叶子节点）
  const leafElements = findLeafElements(draft.elements, outgoingBySource);

  // Start Event
  lines.push('    <bpmn:startEvent id="StartEvent_1" name="' + escapeXml(draft.boundary.start) + '">');
  for (const root of rootElements) {
    lines.push(`      <bpmn:outgoing>Flow_start_${root.element_id}</bpmn:outgoing>`);
  }
  lines.push('    </bpmn:startEvent>');

  // End Event
  lines.push('    <bpmn:endEvent id="EndEvent_1" name="' + escapeXml(draft.boundary.end) + '">');
  for (const leaf of leafElements) {
    lines.push(`      <bpmn:incoming>Flow_end_${leaf.element_id}</bpmn:incoming>`);
  }
  lines.push('    </bpmn:endEvent>');

  // Tasks
  for (const element of draft.elements) {
    if (element.kind === 'ACTIVITY') {
      lines.push(`    <bpmn:task id="${element.element_id}" name="${escapeXml(element.name)}">`);

      // Documentation: evidence refs + certainty + question_ids
      const docParts = [];
      if (element.evidence_refs.length > 0) {
        docParts.push(`Evidence: ${element.evidence_refs.join(', ')}`);
      }
      if (element.certainty && element.certainty !== 'EXPLICIT') {
        docParts.push(`Certainty: ${element.certainty}`);
      }
      if (element.question_ids && element.question_ids.length > 0) {
        docParts.push(`Questions: ${element.question_ids.join(', ')}`);
      }
      if (docParts.length > 0) {
        lines.push('      <bpmn:documentation>');
        lines.push(`        ${docParts.join('; ')}`);
        lines.push('      </bpmn:documentation>');
      }

      // incoming/outgoing from actual flows
      const incoming = incomingByTarget.get(element.element_id) || [];
      const outgoing = outgoingBySource.get(element.element_id) || [];
      // 加上 start 的隐式 flow
      if (rootElements.some(r => r.element_id === element.element_id)) {
        lines.push(`      <bpmn:incoming>Flow_start_${element.element_id}</bpmn:incoming>`);
      }
      for (const inc of incoming) {
        lines.push(`      <bpmn:incoming>${inc}</bpmn:incoming>`);
      }
      for (const out of outgoing) {
        lines.push(`      <bpmn:outgoing>${out}</bpmn:outgoing>`);
      }
      // 加上 end 的隐式 flow
      if (leafElements.some(l => l.element_id === element.element_id)) {
        lines.push(`      <bpmn:outgoing>Flow_end_${element.element_id}</bpmn:outgoing>`);
      }

      lines.push('    </bpmn:task>');
    } else if (element.kind === 'DECISION') {
      lines.push(`    <bpmn:exclusiveGateway id="${element.element_id}" name="${escapeXml(element.name)}">`);

      const docParts = [];
      if (element.certainty && element.certainty !== 'EXPLICIT') {
        docParts.push(`Certainty: ${element.certainty}`);
      }
      if (element.question_ids && element.question_ids.length > 0) {
        docParts.push(`Questions: ${element.question_ids.join(', ')}`);
      }
      if (docParts.length > 0) {
        lines.push('      <bpmn:documentation>');
        lines.push(`        ${docParts.join('; ')}`);
        lines.push('      </bpmn:documentation>');
      }

      const incoming = incomingByTarget.get(element.element_id) || [];
      const outgoing = outgoingBySource.get(element.element_id) || [];
      // 加上 start 的隐式 flow
      if (rootElements.some(r => r.element_id === element.element_id)) {
        lines.push(`      <bpmn:incoming>Flow_start_${element.element_id}</bpmn:incoming>`);
      }
      for (const inc of incoming) {
        lines.push(`      <bpmn:incoming>${inc}</bpmn:incoming>`);
      }
      for (const out of outgoing) {
        lines.push(`      <bpmn:outgoing>${out}</bpmn:outgoing>`);
      }
      // 加上 end 的隐式 flow
      if (leafElements.some(l => l.element_id === element.element_id)) {
        lines.push(`      <bpmn:outgoing>Flow_end_${element.element_id}</bpmn:outgoing>`);
      }

      lines.push('    </bpmn:exclusiveGateway>');
    }
  }

  // Sequence Flows: start→根节点
  for (const root of rootElements) {
    lines.push(`    <bpmn:sequenceFlow id="Flow_start_${root.element_id}" sourceRef="StartEvent_1" targetRef="${root.element_id}" />`);
  }

  // Draft flows
  for (const flow of draft.flows) {
    if (flow.condition) {
      lines.push(`    <bpmn:sequenceFlow id="${flow.flow_id}" sourceRef="${flow.source_ref}" targetRef="${flow.target_ref}">`);
      lines.push(`      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${escapeXml(flow.condition)}</bpmn:conditionExpression>`);
      lines.push('    </bpmn:sequenceFlow>');
    } else {
      lines.push(`    <bpmn:sequenceFlow id="${flow.flow_id}" sourceRef="${flow.source_ref}" targetRef="${flow.target_ref}" />`);
    }
  }

  // 叶子节点→end
  for (const leaf of leafElements) {
    lines.push(`    <bpmn:sequenceFlow id="Flow_end_${leaf.element_id}" sourceRef="${leaf.element_id}" targetRef="EndEvent_1" />`);
  }

  lines.push('  </bpmn:process>');

  // DI (Diagram Interchange) — 使用布局模块的完整结果
  lines.push(...generateDiagramInterchange(draft, layout));

  lines.push('</bpmn:definitions>');

  return lines.join('\n');
}

/**
 * 生成完整的 BPMN DI
 */
function generateDiagramInterchange(draft, layout) {
  const lines = [];

  lines.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1">');
  lines.push('    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">');

  // Participant shape
  const totalLaneHeight = layout.lanes.reduce((sum, l) => sum + l.height, 0);
  const firstLaneY = layout.lanes[0]?.y ?? 50;
  const maxRank = Math.max(0, ...Object.values(layout.elements).map(e => e.rank));
  const planeWidth = 160 + 100 + (maxRank + 1) * 200 + 120 + 100;
  lines.push(`      <bpmndi:BPMNShape id="Shape_Participant_1" bpmnElement="Participant_1" isHorizontal="true">`);
  lines.push(`        <dc:Bounds x="${160}" y="${firstLaneY - 30}" width="${planeWidth}" height="${totalLaneHeight + 60}" />`);
  lines.push('      </bpmndi:BPMNShape>');

  // Lane shapes
  for (const lane of layout.lanes) {
    lines.push(`      <bpmndi:BPMNShape id="Shape_Lane_${lane.id}" bpmnElement="Lane_${lane.id}" isHorizontal="true">`);
    lines.push(`        <dc:Bounds x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // Element shapes (tasks + gateways)
  for (const element of draft.elements) {
    const pos = layout.elements[element.element_id];
    if (!pos) continue;

    if (element.kind === 'DECISION') {
      lines.push(`      <bpmndi:BPMNShape id="Shape_${element.element_id}" bpmnElement="${element.element_id}" isMarkerVisible="true">`);
    } else {
      lines.push(`      <bpmndi:BPMNShape id="Shape_${element.element_id}" bpmnElement="${element.element_id}">`);
    }
    lines.push(`        <dc:Bounds x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // Start event shape
  if (layout.startShape) {
    const s = layout.startShape;
    lines.push(`      <bpmndi:BPMNShape id="Shape_StartEvent_1" bpmnElement="StartEvent_1">`);
    lines.push(`        <dc:Bounds x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // End event shape
  if (layout.endShape) {
    const e = layout.endShape;
    lines.push(`      <bpmndi:BPMNShape id="Shape_EndEvent_1" bpmnElement="EndEvent_1">`);
    lines.push(`        <dc:Bounds x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // Edge waypoints（每条 flow 都有 DI）
  for (const edge of layout.edges) {
    lines.push(`      <bpmndi:BPMNEdge id="Edge_${edge.id}" bpmnElement="${edge.id}">`);
    for (const wp of edge.waypoints) {
      lines.push(`        <di:waypoint x="${wp.x}" y="${wp.y}" />`);
    }
    lines.push('      </bpmndi:BPMNEdge>');
  }

  lines.push('    </bpmndi:BPMNPlane>');
  lines.push('  </bpmndi:BPMNDiagram>');

  return lines;
}

/**
 * 找到所有入度为零的元素（根节点）
 */
function findRootElements(elements, incomingByTarget) {
  return elements.filter(el => {
    const incoming = incomingByTarget.get(el.element_id);
    return !incoming || incoming.length === 0;
  });
}

/**
 * 找到所有出度为零的元素（叶子节点）
 * 对于纯循环图（没有出度为零的节点），采用确定性的单一锚点策略
 */
function findLeafElements(elements, outgoingBySource) {
  const leaves = elements.filter(el => {
    const outgoing = outgoingBySource.get(el.element_id);
    return !outgoing || outgoing.length === 0;
  });

  // 如果有叶子节点，直接返回
  if (leaves.length > 0) {
    return leaves;
  }

  // 纯循环图：选择最后一个元素（按数组顺序）作为确定性锚点
  // 这确保了即使在循环图中，也有一个明确的结束点
  if (elements.length > 0) {
    return [elements[elements.length - 1]];
  }

  return [];
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成稳定哈希
 */
function stableHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}
