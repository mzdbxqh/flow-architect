/**
 * BPMN 2.0 V2 编译器
 *
 * 将 V2 流程草稿编译为标准 BPMN 2.0 XML 和 DI。
 * 确定性生成，不依赖模型或用户输入。
 * 浏览器可打包，不依赖 Node 内置模块。
 */

import { validateDraftBusinessRules } from './process-draft-v2-rules.mjs';
import { layoutProcessGraph as sharedLayoutProcessGraph } from './deterministic-bpmn-layout.mjs';

// ─── 公开 API ───────────────────────────────────────────────

/**
 * 编译 V2 流程草稿为 BPMN 2.0 XML
 *
 * @param {object} draft - V2 流程草稿
 * @returns {{ xml: string, layout: object }}
 */
export function compileBpmn(draft) {
  if (!draft || draft.schema_version !== '2.0.0') {
    throw new Error('仅支持 schema_version 2.0.0 的流程草稿');
  }

  validateDraft(draft);

  // 执行业务规则验证
  const businessValidation = validateDraftBusinessRules(draft);
  if (!businessValidation.valid) {
    const errorMessages = businessValidation.errors.map(e => `${e.code}: ${e.message}`).join('\n');
    throw new Error(`业务规则验证失败:\n${errorMessages}`);
  }

  validateLinkPairing(draft.diagram.nodes);
  validateTaskBindings(draft.diagram.nodes, draft.diagram.task_bindings);
  validateFlowRefs(draft.diagram.nodes, draft.diagram.flows);

  const layout = sharedLayoutProcessGraph(draft);
  const xml = generateBpmnXml(draft, layout);

  return { xml, layout };
}

/**
 * 从 BPMN XML 恢复规范图模型
 *
 * @param {string} xml - BPMN 2.0 XML
 * @param {object} options
 * @param {Array} options.activities - 活动列表
 * @returns {{ diagram: object, warnings: string[] }}
 */
export function normalizeBpmnXml(xml, { activities = [] } = {}) {
  const warnings = [];
  const diagram = {
    lanes: [],
    nodes: [],
    flows: [],
    task_bindings: [],
    layout_version: '2.0.0',
  };

  // XML 解析 — 匹配所有 BPMN 流节点元素（含不支持的，用于产生警告）
  const nodeRegex = /<bpmn:(task|userTask|serviceTask|scriptTask|businessRuleTask|sendTask|receiveTask|manualTask|callActivity|subProcess|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|dataObject|dataStoreReference|textAnnotation|group)\s+id="([^"]+)"(?:\s+name="([^"]*)")?/g;
  const flowRegex = /<bpmn:sequenceFlow\s+id="([^"]+)"\s+sourceRef="([^"]+)"\s+targetRef="([^"]+)"/g;
  const laneRegex = /<bpmn:lane\s+id="([^"]+)"(?:\s+name="([^"]*)")?/g;
  const flowNodeRefRegex = /<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g;
  const laneBlockRegex = /<bpmn:lane\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn:lane>/g;

  // 解析节点
  let match;
  while ((match = nodeRegex.exec(xml)) !== null) {
    const [, type, id, name] = match;
    const nodeType = mapBpmnTypeToNodeType(type);

    // 解析 activityId 属性
    const nodeRegexFull = new RegExp(`<bpmn:${type}\\s+id="${id}"[^>]*flowArchitect:activityId="([^"]*)"`, 'g');
    const activityIdMatch = nodeRegexFull.exec(xml);
    const activityId = activityIdMatch ? activityIdMatch[1] : null;

    // 解析事件定义
    const eventDef = parseEventDefinition(xml, id, type);

    diagram.nodes.push({
      node_id: id,
      node_type: eventDef ? mapEventDefToNodeType(type, eventDef) : (nodeType || `UNSUPPORTED_${type.toUpperCase()}`),
      name: name || id,
      lane_id: null,
      activity_id: activityId,
      event_definition: eventDef,
    });
  }

  // 解析流
  while ((match = flowRegex.exec(xml)) !== null) {
    const [, id, source, target] = match;

    // 检查是否有条件表达式
    let condition = null;
    const conditionRegex = new RegExp(`<bpmn:sequenceFlow\\s+id="${id}"[^>]*>\\s*<bpmn:conditionExpression[^>]*>([^<]+)<\\/bpmn:conditionExpression>\\s*<\\/bpmn:sequenceFlow>`, 'g');
    const conditionMatch = conditionRegex.exec(xml);
    if (conditionMatch) {
      // 反转义XML
      const conditionText = conditionMatch[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();

      // 尝试解析为结构化条件（格式：source_output op "value" 或 source_output op value）
      // 注意：>=和<=必须放在>和<之前，否则会被提前匹配
      const structuredMatch = conditionText.match(/^([^\s]+)\s*(==|!=|>=|<=|>|<|contains)\s*"?([^"]*)"?$/);
      if (structuredMatch) {
        const [, sourceOutput, operator, value] = structuredMatch;
        const operatorMap = {
          '==': 'EQUALS',
          '!=': 'NOT_EQUALS',
          '>': 'GREATER_THAN',
          '<': 'LESS_THAN',
          '>=': 'GREATER_THAN_OR_EQUAL',
          '<=': 'LESS_THAN_OR_EQUAL',
          'contains': 'CONTAINS',
        };
        const unaryOperator = operator === '==' && value === 'true'
          ? 'IS_TRUE'
          : operator === '==' && value === 'false'
            ? 'IS_FALSE'
            : null;
        condition = {
          label: conditionText,
          source_output: sourceOutput,
          operator: unaryOperator || operatorMap[operator] || 'EQUALS',
          value: unaryOperator ? null : value,
        };
      } else {
        // 非结构化条件，保留原始文本
        condition = {
          label: conditionText,
          source_output: null,
          operator: null,
          value: conditionText,
        };
      }
    }

    diagram.flows.push({
      flow_id: id,
      source_ref: source,
      target_ref: target,
      condition: condition,
    });
  }

  // 解析泳道及 flowNodeRef
  while ((match = laneBlockRegex.exec(xml)) !== null) {
    const [, laneId, body] = match;
    const nameMatch = xml.match(new RegExp(`<bpmn:lane\\s+id="${laneId}"[^>]*name="([^"]*)"`));
    const name = nameMatch ? nameMatch[1] : laneId;

    // 解析 roleId 属性
    const roleIdRegex = new RegExp(`<bpmn:lane\\s+id="${laneId}"[^>]*flowArchitect:roleId="([^"]*)"`, 'g');
    const roleIdMatch = roleIdRegex.exec(xml);
    const roleId = roleIdMatch ? roleIdMatch[1] : laneId;

    diagram.lanes.push({ lane_id: laneId, name, role_id: roleId });

    // 解析该泳道的 flowNodeRef
    let refMatch;
    const refRegex = /<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g;
    while ((refMatch = refRegex.exec(body)) !== null) {
      const nodeId = refMatch[1];
      const node = diagram.nodes.find(n => n.node_id === nodeId);
      if (node) {
        node.lane_id = laneId;
      }
    }
  }

  // 检查不支持的元素
  const supportedTypes = [
    'MAIN_TASK', 'CONFIRMATION_TASK',
    'GATEWAY_XOR', 'GATEWAY_AND', 'GATEWAY_OR',
    'START_EVENT', 'END_EVENT',
    'INTERMEDIATE_MESSAGE_CATCH', 'INTERMEDIATE_MESSAGE_THROW',
    'INTERMEDIATE_TIMER_CATCH',
    'INTERMEDIATE_LINK_CATCH', 'INTERMEDIATE_LINK_THROW',
  ];

  const unsupportedNodes = diagram.nodes.filter(n => !supportedTypes.includes(n.node_type));
  if (unsupportedNodes.length > 0) {
    const errors = unsupportedNodes.map(n => `${n.node_type} (${n.node_id})`).join(', ');
    warnings.push(`不支持的节点类型: ${errors}`);
    return { diagram, layout: null, warnings, blocked: true };
  }

  // 检查重复 ID
  const seenIds = new Set();
  const duplicateIds = [];
  for (const node of diagram.nodes) {
    if (seenIds.has(node.node_id)) {
      duplicateIds.push(node.node_id);
    }
    seenIds.add(node.node_id);
  }
  if (duplicateIds.length > 0) {
    warnings.push(`重复的节点 ID: ${duplicateIds.join(', ')}`);
    return { diagram, layout: null, warnings, blocked: true };
  }

  // 检查悬空引用
  const nodeIds = new Set(diagram.nodes.map(n => n.node_id));
  const danglingFlows = [];
  for (const flow of diagram.flows) {
    if (!nodeIds.has(flow.source_ref)) {
      danglingFlows.push(`流 ${flow.flow_id} 引用不存在的源节点: ${flow.source_ref}`);
    }
    if (!nodeIds.has(flow.target_ref)) {
      danglingFlows.push(`流 ${flow.flow_id} 引用不存在的目标节点: ${flow.target_ref}`);
    }
  }
  if (danglingFlows.length > 0) {
    warnings.push(`悬空流引用:\n${danglingFlows.join('\n')}`);
    return { diagram, layout: null, warnings, blocked: true };
  }

  // 生成 task_bindings
  for (const activity of activities) {
    const mainTaskNode = diagram.nodes.find(n =>
      n.node_type === 'MAIN_TASK' && n.name === activity.name
    );
    if (mainTaskNode) {
      // 查找 confirmation task
      const confirmationTaskNode = diagram.nodes.find(n =>
        n.node_type === 'CONFIRMATION_TASK' && n.activity_id === activity.activity_id
      );

      diagram.task_bindings.push({
        activity_id: activity.activity_id,
        main_task_id: mainTaskNode.node_id,
        confirmation_task_id: confirmationTaskNode ? confirmationTaskNode.node_id : null,
      });
    }
  }

  // 检查非法绑定
  const mainTaskIds = new Set(diagram.nodes.filter(n => n.node_type === 'MAIN_TASK').map(n => n.node_id));
  const invalidBindings = [];
  for (const binding of diagram.task_bindings) {
    if (!mainTaskIds.has(binding.main_task_id)) {
      invalidBindings.push(`task_binding 引用不存在的主 Task: ${binding.main_task_id}`);
    }
  }
  if (invalidBindings.length > 0) {
    warnings.push(`非法绑定:\n${invalidBindings.join('\n')}`);
    return { diagram, layout: null, warnings, blocked: true };
  }

  // 所有校验通过后，调用共享布局器
  const layout = sharedLayoutProcessGraph({ diagram });

  return { diagram, layout, warnings };
}

// ─── V2 验证 ────────────────────────────────────────────────

function validateDraft(draft) {
  const { process_card, diagram } = draft;
  if (!process_card) throw new Error('缺少 process_card');
  if (!diagram) throw new Error('缺少 diagram');
  if (!diagram.nodes || !diagram.flows || !diagram.lanes) {
    throw new Error('diagram 缺少 nodes/flows/lanes');
  }
  if (!process_card.process_id) throw new Error('process_card 缺少 process_id');
  if (!process_card.name) throw new Error('process_card 缺少 name');
}

function validateLinkPairing(nodes) {
  const linkCatches = nodes.filter(n => n.node_type === 'INTERMEDIATE_LINK_CATCH');
  const linkThrows = nodes.filter(n => n.node_type === 'INTERMEDIATE_LINK_THROW');

  // 每个 catch 必须有同名 throw，反之亦然
  const catchNames = new Map();
  const throwNames = new Map();

  for (const n of linkCatches) {
    catchNames.set(n.name, (catchNames.get(n.name) || 0) + 1);
  }
  for (const n of linkThrows) {
    throwNames.set(n.name, (throwNames.get(n.name) || 0) + 1);
  }

  // 检查缺失配对
  for (const [name, count] of catchNames) {
    if (!throwNames.has(name)) {
      throw new Error(`Link catch "${name}" 缺少配对的 throw`);
    }
  }
  for (const [name, count] of throwNames) {
    if (!catchNames.has(name)) {
      throw new Error(`Link throw "${name}" 缺少配对的 catch`);
    }
  }

  // 检查多配
  for (const [name, count] of catchNames) {
    if (count > 1) {
      throw new Error(`Link catch "${name}" 有 ${count} 个（应只有 1 个）`);
    }
  }
  for (const [name, count] of throwNames) {
    if (count > 1) {
      throw new Error(`Link throw "${name}" 有 ${count} 个（应只有 1 个）`);
    }
  }

  // 检查方向错误：catch 名称不应该同时出现在 throw 节点的 node_type 为 catch 的
  // （上面的检查已经覆盖了缺失和多配，方向错误即类型互换导致的不匹配）
}

function validateTaskBindings(nodes, taskBindings) {
  // 每个 activity 最多一个主 Task
  const activityMainTasks = new Map();
  for (const binding of taskBindings) {
    const aid = binding.activity_id;
    if (!activityMainTasks.has(aid)) activityMainTasks.set(aid, []);
    activityMainTasks.get(aid).push(binding.main_task_id);
  }
  for (const [aid, tasks] of activityMainTasks) {
    if (tasks.length > 1) {
      throw new Error(`活动 ${aid} 有 ${tasks.length} 个主 Task: ${tasks.join(', ')}`);
    }
  }

  // 每个主 Task 只能绑定一次
  const mainTaskCounts = new Map();
  for (const binding of taskBindings) {
    const id = binding.main_task_id;
    mainTaskCounts.set(id, (mainTaskCounts.get(id) || 0) + 1);
  }
  for (const [id, count] of mainTaskCounts) {
    if (count > 1) {
      throw new Error(`主 Task ${id} 被绑定 ${count} 次`);
    }
  }
}

function validateFlowRefs(nodes, flows) {
  const nodeIds = new Set(nodes.map(n => n.node_id));
  for (const flow of flows) {
    if (!nodeIds.has(flow.source_ref)) {
      throw new Error(`流 ${flow.flow_id} 引用不存在的源节点: ${flow.source_ref}`);
    }
    if (!nodeIds.has(flow.target_ref)) {
      throw new Error(`流 ${flow.flow_id} 引用不存在的目标节点: ${flow.target_ref}`);
    }
  }
}

// ─── XML 生成 ────────────────────────────────────────────────

function generateBpmnXml(draft, layout) {
  const { process_card, diagram } = draft;
  const { nodes, flows, lanes } = diagram;
  const lines = [];

  // XML 头
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  lines.push('  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"');
  lines.push('  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"');
  lines.push('  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"');
  lines.push('  xmlns:flowArchitect="http://flow-architect.io/schema/2024/01"');

  // 条件需要 xsi 命名空间
  const needsXsi = flows.some(f => f.condition)
    || process_card.start?.event_type === 'CONDITIONAL';
  if (needsXsi) {
    lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  }

  lines.push(`  id="Definitions_${stableHash(process_card.process_id)}"`);
  lines.push('  exporter="Flow Architect" exporterVersion="2.0.0"');
  lines.push('  targetNamespace="http://bpmn.io/schema/bpmn">');

  // Collaboration + participant
  lines.push('  <bpmn:collaboration id="Collaboration_1">');
  lines.push(`    <bpmn:participant id="Participant_1" name="${escapeXml(process_card.name)}" processRef="Process_${process_card.process_id}" />`);
  lines.push('  </bpmn:collaboration>');

  // Process
  lines.push(`  <bpmn:process id="Process_${process_card.process_id}" isExecutable="false">`);

  // LaneSet
  if (lanes.length > 0) {
    lines.push('    <bpmn:laneSet id="LaneSet_1">');
    for (const lane of lanes) {
      lines.push(`      <bpmn:lane id="${lane.lane_id}" name="${escapeXml(lane.name)}" flowArchitect:roleId="${lane.role_id}">`);
      const laneNodes = nodes.filter(n => n.lane_id === lane.lane_id);
      for (const node of laneNodes) {
        lines.push(`        <bpmn:flowNodeRef>${node.node_id}</bpmn:flowNodeRef>`);
      }
      lines.push('      </bpmn:lane>');
    }
    lines.push('    </bpmn:laneSet>');
  }

  // 节点
  const activities = draft.activities || [];

  // 不生成虚拟的 start/end 流，只使用 draft 中的 flows
  const nodeIds = new Set(nodes.map(n => n.node_id));
  const incomingMap = new Map();
  for (const f of flows) {
    if (!incomingMap.has(f.target_ref)) incomingMap.set(f.target_ref, []);
    incomingMap.get(f.target_ref).push(f);
  }
  const outgoingMap = new Map();
  for (const f of flows) {
    if (!outgoingMap.has(f.source_ref)) outgoingMap.set(f.source_ref, []);
    outgoingMap.get(f.source_ref).push(f);
  }

  // 只使用 draft 中的 flows 计算 incoming/outgoing
  for (const node of nodes) {
    const nodeLines = generateNodeXml(
      node,
      flows,
      diagram.task_bindings,
      activities,
      node.node_type === 'START_EVENT' ? process_card.start?.event_type : null,
    );
    lines.push(...nodeLines);
  }

  // 流（含条件编译）
  for (const flow of flows) {
    if (flow.condition) {
      lines.push(`    <bpmn:sequenceFlow id="${flow.flow_id}" sourceRef="${flow.source_ref}" targetRef="${flow.target_ref}">`);
      lines.push(`      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${compileCondition(flow.condition)}</bpmn:conditionExpression>`);
      lines.push('    </bpmn:sequenceFlow>');
    } else {
      lines.push(`    <bpmn:sequenceFlow id="${flow.flow_id}" sourceRef="${flow.source_ref}" targetRef="${flow.target_ref}" />`);
    }
  }

  lines.push('  </bpmn:process>');

  // DI
  lines.push(...generateDiagramInterchange(draft, layout));

  lines.push('</bpmn:definitions>');

  return lines.join('\n');
}

function generateNodeXml(node, flows, taskBindings = [], activities = [], startEventType = null) {
  const lines = [];
  const tag = mapNodeTypeToBpmnTag(node.node_type);
  if (!tag) return lines;

  const incoming = flows.filter(f => f.target_ref === node.node_id);
  const outgoing = flows.filter(f => f.source_ref === node.node_id);

  // 是否需要子元素（eventDefinition）
  const eventDef = getEventDefinitionXml(node.node_type, node.name, startEventType);

  // 查找节点的 activity binding
  const binding = taskBindings.find(b => b.main_task_id === node.node_id || b.confirmation_task_id === node.node_id);
  const activityId = binding ? binding.activity_id : null;

  // 查找关联的活动以获取引用
  const activity = activityId ? activities.find(a => a.activity_id === activityId) : null;
  const refs = activity?.references || [];

  if (eventDef) {
    lines.push(`    <${tag} id="${node.node_id}" name="${escapeXml(node.name)}"${activityId ? ` flowArchitect:activityId="${activityId}"` : ''}>`);
  } else {
    lines.push(`    <${tag} id="${node.node_id}" name="${escapeXml(node.name)}"${activityId ? ` flowArchitect:activityId="${activityId}"` : ''}>`);
  }

  for (const flow of incoming) {
    lines.push(`      <bpmn:incoming>${flow.flow_id}</bpmn:incoming>`);
  }
  for (const flow of outgoing) {
    lines.push(`      <bpmn:outgoing>${flow.flow_id}</bpmn:outgoing>`);
  }

  // eventDefinition 子元素
  if (eventDef) {
    lines.push(`      ${eventDef}`);
  }

  // 证据引用文档
  if (refs.length > 0) {
    lines.push(`      <bpmn:documentation>${escapeXml(refs.join(', '))}</bpmn:documentation>`);
  }

  lines.push(`    </${tag}>`);
  return lines;
}

function getEventDefinitionXml(nodeType, name, startEventType = null) {
  if (nodeType === 'START_EVENT') {
    switch (startEventType) {
      case 'MESSAGE': return '<bpmn:messageEventDefinition />';
      case 'TIMER': return '<bpmn:timerEventDefinition />';
      case 'SIGNAL': return '<bpmn:signalEventDefinition />';
      case 'CONDITIONAL':
        return '<bpmn:conditionalEventDefinition><bpmn:condition xsi:type="bpmn:tFormalExpression">true</bpmn:condition></bpmn:conditionalEventDefinition>';
      default: return null;
    }
  }
  switch (nodeType) {
    case 'INTERMEDIATE_MESSAGE_CATCH':
    case 'INTERMEDIATE_MESSAGE_THROW':
      return '<bpmn:messageEventDefinition />';
    case 'INTERMEDIATE_TIMER_CATCH':
      return '<bpmn:timerEventDefinition />';
    case 'INTERMEDIATE_LINK_CATCH':
    case 'INTERMEDIATE_LINK_THROW':
      return `<bpmn:linkEventDefinition name="${escapeXml(name)}" />`;
    default:
      return null;
  }
}

function compileCondition(condition) {
  if (typeof condition === 'string') {
    return escapeXml(condition);
  }
  if (typeof condition === 'object' && condition !== null) {
    const { source_output, operator, value } = condition;
    const ops = {
      'EQUALS': '==',
      'NOT_EQUALS': '!=',
      'GREATER_THAN': '>',
      'LESS_THAN': '<',
      'GREATER_THAN_OR_EQUAL': '>=',
      'LESS_THAN_OR_EQUAL': '<=',
      'IS_TRUE': '== true',
      'IS_FALSE': '== false',
      'CONTAINS': 'contains',
    };
    const op = ops[operator] || '==';
    if (operator === 'IS_TRUE') return escapeXml(`${source_output} == true`);
    if (operator === 'IS_FALSE') return escapeXml(`${source_output} == false`);
    return escapeXml(`${source_output} ${op} "${value}"`);
  }
  return escapeXml(String(condition));
}

// ─── 节点类型映射 ────────────────────────────────────────────

function mapNodeTypeToBpmnTag(nodeType) {
  const mapping = {
    'MAIN_TASK': 'bpmn:task',
    'CONFIRMATION_TASK': 'bpmn:userTask',
    'GATEWAY_XOR': 'bpmn:exclusiveGateway',
    'GATEWAY_AND': 'bpmn:parallelGateway',
    'GATEWAY_OR': 'bpmn:inclusiveGateway',
    'START_EVENT': 'bpmn:startEvent',
    'END_EVENT': 'bpmn:endEvent',
    'INTERMEDIATE_MESSAGE_CATCH': 'bpmn:intermediateCatchEvent',
    'INTERMEDIATE_MESSAGE_THROW': 'bpmn:intermediateThrowEvent',
    'INTERMEDIATE_TIMER_CATCH': 'bpmn:intermediateCatchEvent',
    'INTERMEDIATE_LINK_CATCH': 'bpmn:intermediateCatchEvent',
    'INTERMEDIATE_LINK_THROW': 'bpmn:intermediateThrowEvent',
  };
  return mapping[nodeType] || null;
}

function mapBpmnTypeToNodeType(bpmnType) {
  const mapping = {
    'task': 'MAIN_TASK',
    'userTask': 'CONFIRMATION_TASK',
    'exclusiveGateway': 'GATEWAY_XOR',
    'parallelGateway': 'GATEWAY_AND',
    'inclusiveGateway': 'GATEWAY_OR',
    'startEvent': 'START_EVENT',
    'endEvent': 'END_EVENT',
    'intermediateCatchEvent': 'INTERMEDIATE_MESSAGE_CATCH',
    'intermediateThrowEvent': 'INTERMEDIATE_MESSAGE_THROW',
  };
  return mapping[bpmnType] || null;
}

// ─── DI 生成 ─────────────────────────────────────────────────

function generateDiagramInterchange(draft, layout) {
  const lines = [];
  const { diagram } = draft;
  const endResults = draft.process_card.end_results;

  lines.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1">');
  lines.push('    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">');

  // Participant shape
  if (layout.lanes.length > 0) {
    const totalHeight = layout.lanes.reduce((sum, l) => sum + l.height, 0);
    const firstLane = layout.lanes[0];
    const maxLaneWidth = Math.max(...layout.lanes.map(l => l.width), 800);
    lines.push(`      <bpmndi:BPMNShape id="Shape_Participant_1" bpmnElement="Participant_1" isHorizontal="true">`);
    lines.push(`        <dc:Bounds x="${firstLane.x - 10}" y="${firstLane.y - 10}" width="${maxLaneWidth + 20}" height="${totalHeight + 20}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // Lane shapes
  for (const lane of layout.lanes) {
    lines.push(`      <bpmndi:BPMNShape id="Shape_${lane.id}" bpmnElement="${lane.id}" isHorizontal="true">`);
    lines.push(`        <dc:Bounds x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // Node shapes
  for (const node of diagram.nodes) {
    const pos = layout.elements[node.node_id];
    if (!pos) continue;

    const nodeType = node.node_type;
    const isGateway = nodeType.startsWith('GATEWAY_');
    const isEvent = nodeType.includes('EVENT') || nodeType.includes('CATCH') || nodeType.includes('THROW');

    lines.push(`      <bpmndi:BPMNShape id="Shape_${node.node_id}" bpmnElement="${node.node_id}"${isGateway ? ' isMarkerVisible="true"' : ''}>`);
    lines.push(`        <dc:Bounds x="${pos.x}" y="${pos.y}" width="${pos.width}" height="${pos.height}" />`);
    lines.push('      </bpmndi:BPMNShape>');
  }

  // Edge waypoints
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

// ─── 工具函数 ────────────────────────────────────────────────

function computeTopologicalRanks(nodes, flows) {
  const ranks = {};
  const nodeIds = new Set(nodes.map(n => n.node_id));

  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.node_id, []);

  const inDegree = new Map();
  for (const node of nodes) inDegree.set(node.node_id, 0);

  for (const flow of flows) {
    if (nodeIds.has(flow.source_ref) && nodeIds.has(flow.target_ref)) {
      adjacency.get(flow.source_ref).push(flow.target_ref);
      inDegree.set(flow.target_ref, inDegree.get(flow.target_ref) + 1);
    }
  }

  // Kahn 算法
  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      queue.push(id);
      ranks[id] = 0;
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const neighbor of adjacency.get(current)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      const newRank = ranks[current] + 1;
      if (ranks[neighbor] === undefined || ranks[neighbor] < newRank) {
        ranks[neighbor] = newRank;
      }
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 未排名节点（环中）
  for (const node of nodes) {
    if (ranks[node.node_id] === undefined) {
      ranks[node.node_id] = 0;
    }
  }

  return ranks;
}

// ─── 工具函数 ────────────────────────────────────────────────

/**
 * 稳定哈希（纯 JS，FNV-1a 32-bit）
 */
function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

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
 * 解析节点的事件定义
 * @param {string} xml - 完整 XML
 * @param {string} nodeId - 节点 ID
 * @param {string} bpmnType - BPMN 类型
 * @returns {object|null} 事件定义
 */
function parseEventDefinition(xml, nodeId, bpmnType) {
  const nodeRegex = new RegExp(`<bpmn:${bpmnType}\\s+id="${nodeId}"[^>]*>([\\s\\S]*?)<\\/bpmn:${bpmnType}>`, 'g');
  const nodeMatch = nodeRegex.exec(xml);
  if (!nodeMatch) return null;

  const nodeContent = nodeMatch[1];

  // 解析 messageEventDefinition
  if (nodeContent.includes('<bpmn:messageEventDefinition')) {
    return { type: 'message' };
  }

  // 解析 timerEventDefinition
  if (nodeContent.includes('<bpmn:timerEventDefinition')) {
    return { type: 'timer' };
  }

  // 解析 linkEventDefinition
  const linkMatch = nodeContent.match(/<bpmn:linkEventDefinition\s+id="([^"]*)"(?:\s+name="([^"]*)")?/);
  if (linkMatch) {
    return { type: 'link', link_id: linkMatch[1], link_name: linkMatch[2] || null };
  }

  return null;
}

/**
 * 根据事件定义映射节点类型
 * @param {string} bpmnType - BPMN 类型
 * @param {object} eventDef - 事件定义
 * @returns {string} 节点类型
 */
function mapEventDefToNodeType(bpmnType, eventDef) {
  if (bpmnType === 'intermediateCatchEvent') {
    if (eventDef.type === 'message') return 'INTERMEDIATE_MESSAGE_CATCH';
    if (eventDef.type === 'timer') return 'INTERMEDIATE_TIMER_CATCH';
    if (eventDef.type === 'link') return 'INTERMEDIATE_LINK_CATCH';
  }

  if (bpmnType === 'intermediateThrowEvent') {
    if (eventDef.type === 'message') return 'INTERMEDIATE_MESSAGE_THROW';
    if (eventDef.type === 'link') return 'INTERMEDIATE_LINK_THROW';
  }

  return mapBpmnTypeToNodeType(bpmnType);
}
