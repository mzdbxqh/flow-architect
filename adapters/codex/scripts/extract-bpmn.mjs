import { XMLParser } from 'fast-xml-parser';

/**
 * Extract a DiagramModel from BPMN 2.0 XML.
 *
 * @param {string} xml - Raw BPMN XML string.
 * @returns {import('./types.mjs').DiagramModel} Structured diagram model.
 * @throws {Error} If XML contains DOCTYPE or ENTITY declarations (XXE attack).
 */
export function extractBpmn(xml) {
  // Security: reject any DOCTYPE or ENTITY declarations
  if (/<\s*!DOCTYPE/i.test(xml) || /<\s*!ENTITY/i.test(xml)) {
    throw new Error('BPMN input rejected: contains DOCTYPE or ENTITY declarations (XXE risk)');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    processEntities: false,
    htmlEntities: false,
  });

  const parsed = parser.parse(xml);
  const definitions = parsed['bpmn:definitions'] ?? parsed['bpmn2:definitions'] ?? parsed['definitions'];
  if (!definitions) {
    return {
      schema_version: '1.0.0',
      elements: [],
      flows: [],
      metadata: {
        parse_mode: 'STRUCTURED',
        source_format: 'bpmn',
        confidence: 0.3,
        warnings: ['No bpmn:definitions root found'],
      },
    };
  }

  const elements = [];
  const flows = [];
  const warnings = [];
  const { boundsByElement, waypointsByFlow } = extractDiagramGeometry(definitions);

  // Collect processes
  const processes = toArray(definitions['bpmn:process'] ?? definitions['bpmn2:process'] ?? definitions['process']);
  const collaboration = definitions['bpmn:collaboration'] ?? definitions['bpmn2:collaboration'] ?? definitions['collaboration'];
  const allPools = collaboration ? toArray(collaboration['bpmn:participant'] ?? collaboration['bpmn2:participant'] ?? collaboration['participant']) : [];
  const allMessageFlows = collaboration ? toArray(collaboration['bpmn:messageFlow'] ?? collaboration['bpmn2:messageFlow'] ?? collaboration['messageFlow']) : [];

  // Map processRef to pool
  const processToPool = new Map();
  for (const pool of allPools) {
    const processRef = pool['@_processRef'];
    const poolId = pool['@_id'];
    if (processRef && poolId) {
      processToPool.set(processRef, poolId);
      elements.push({
        element_id: poolId,
        type: 'POOL',
        name: pool['@_name'] ?? '',
        parent_id: null,
        lane_id: null,
        sub_type: null,
      });
    }
  }

  // Extract elements from each process
  for (const process of processes) {
    const processId = process['@_id'];
    const poolId = processToPool.get(processId) ?? null;

    // Lanes
    const laneSets = toArray(process['bpmn:laneSet'] ?? process['bpmn2:laneSet'] ?? process['laneSet']);
    for (const laneSet of laneSets) {
      const lanes = toArray(laneSet['bpmn:lane'] ?? laneSet['bpmn2:lane'] ?? laneSet['lane']);
      for (const lane of lanes) {
        const laneId = lane['@_id'];
        elements.push({
          element_id: laneId,
          type: 'LANE',
          name: lane['@_name'] ?? '',
          parent_id: poolId,
          lane_id: null,
          sub_type: null,
        });
        // flowNodeRef inside lane
        const flowNodeRefs = toArray(lane['bpmn:flowNodeRef'] ?? lane['bpmn2:flowNodeRef'] ?? lane['flowNodeRef']);
        for (const ref of flowNodeRefs) {
          const refText = typeof ref === 'string' ? ref : (ref['#text'] ?? ref);
          // We'll tag these elements with laneId when we encounter them
          if (!process._laneMap) process._laneMap = {};
          process._laneMap[refText] = laneId;
        }
      }
    }

    const laneMap = process._laneMap ?? {};

    // Tasks
    for (const [tag, type] of [
      ['bpmn:task', 'TASK'],
      ['bpmn2:task', 'TASK'],
      ['task', 'TASK'],
      ['bpmn:userTask', 'TASK'],
      ['bpmn2:userTask', 'TASK'],
      ['userTask', 'TASK'],
      ['bpmn:serviceTask', 'TASK'],
      ['bpmn2:serviceTask', 'TASK'],
      ['serviceTask', 'TASK'],
      ['bpmn:scriptTask', 'TASK'],
      ['bpmn2:scriptTask', 'TASK'],
      ['scriptTask', 'TASK'],
      ['bpmn:manualTask', 'TASK'],
      ['bpmn2:manualTask', 'TASK'],
      ['manualTask', 'TASK'],
      ['bpmn:businessRuleTask', 'TASK'],
      ['bpmn2:businessRuleTask', 'TASK'],
      ['businessRuleTask', 'TASK'],
      ['bpmn:sendTask', 'TASK'],
      ['bpmn2:sendTask', 'TASK'],
      ['sendTask', 'TASK'],
      ['bpmn:receiveTask', 'TASK'],
      ['bpmn2:receiveTask', 'TASK'],
      ['receiveTask', 'TASK'],
    ]) {
      for (const item of toArray(process[tag])) {
        const id = item['@_id'];
        const taskType = tag.includes('Task') || tag.includes('task') ? 'TASK' : type;
        elements.push({
          element_id: id,
          type: taskType,
          name: item['@_name'] ?? '',
          parent_id: poolId,
          lane_id: laneMap[id] ?? null,
          sub_type: null,
        });
      }
    }

    // Sub-processes
    for (const tag of ['bpmn:subProcess', 'bpmn2:subProcess', 'subProcess']) {
      for (const item of toArray(process[tag])) {
        elements.push({
          element_id: item['@_id'],
          type: 'SUB_PROCESS',
          name: item['@_name'] ?? '',
          parent_id: poolId,
          lane_id: laneMap[item['@_id']] ?? null,
          sub_type: null,
        });
      }
    }

    // Events
    for (const [tag, subType] of [
      ['bpmn:startEvent', 'startEvent'], ['bpmn2:startEvent', 'startEvent'], ['startEvent', 'startEvent'],
      ['bpmn:endEvent', 'endEvent'], ['bpmn2:endEvent', 'endEvent'], ['endEvent', 'endEvent'],
      ['bpmn:intermediateThrowEvent', 'intermediateEvent'], ['bpmn2:intermediateThrowEvent', 'intermediateEvent'], ['intermediateThrowEvent', 'intermediateEvent'],
      ['bpmn:intermediateCatchEvent', 'intermediateEvent'], ['bpmn2:intermediateCatchEvent', 'intermediateEvent'], ['intermediateCatchEvent', 'intermediateEvent'],
      ['bpmn:boundaryEvent', 'boundaryEvent'], ['bpmn2:boundaryEvent', 'boundaryEvent'], ['boundaryEvent', 'boundaryEvent'],
    ]) {
      for (const item of toArray(process[tag])) {
        elements.push({
          element_id: item['@_id'],
          type: 'EVENT',
          name: item['@_name'] ?? '',
          parent_id: poolId,
          lane_id: laneMap[item['@_id']] ?? null,
          sub_type: subType,
        });
      }
    }

    // Gateways
    for (const tag of [
      'bpmn:exclusiveGateway', 'bpmn2:exclusiveGateway', 'exclusiveGateway',
      'bpmn:parallelGateway', 'bpmn2:parallelGateway', 'parallelGateway',
      'bpmn:inclusiveGateway', 'bpmn2:inclusiveGateway', 'inclusiveGateway',
      'bpmn:eventBasedGateway', 'bpmn2:eventBasedGateway', 'eventBasedGateway',
    ]) {
      for (const item of toArray(process[tag])) {
        const subType = tag.replace(/bpmn[2]?:/, '');
        elements.push({
          element_id: item['@_id'],
          type: 'GATEWAY',
          name: item['@_name'] ?? '',
          parent_id: poolId,
          lane_id: laneMap[item['@_id']] ?? null,
          sub_type: subType,
        });
      }
    }

    // Data objects
    for (const tag of ['bpmn:dataObjectReference', 'bpmn2:dataObjectReference', 'dataObjectReference', 'bpmn:dataObject', 'bpmn2:dataObject', 'dataObject']) {
      for (const item of toArray(process[tag])) {
        elements.push({
          element_id: item['@_id'],
          type: 'DATA_OBJECT',
          name: item['@_name'] ?? '',
          parent_id: poolId,
          lane_id: laneMap[item['@_id']] ?? null,
          sub_type: null,
        });
      }
    }

    const defaultFlowRefs = collectDefaultFlowRefs(process);

    // Sequence flows. BPMN default semantics live on the source flow node:
    // its `default` attribute references the default sequenceFlow ID.
    for (const tag of ['bpmn:sequenceFlow', 'bpmn2:sequenceFlow', 'sequenceFlow']) {
      for (const item of toArray(process[tag])) {
        flows.push({
          flow_id: item['@_id'],
          type: 'SEQUENCE_FLOW',
          source_ref: item['@_sourceRef'] ?? '',
          target_ref: item['@_targetRef'] ?? '',
          is_default: defaultFlowRefs.has(item['@_id']),
        });
      }
    }
  }

  // Message flows from collaboration
  for (const item of allMessageFlows) {
    flows.push({
      flow_id: item['@_id'],
      type: 'MESSAGE_FLOW',
      source_ref: item['@_sourceRef'] ?? '',
      target_ref: item['@_targetRef'] ?? '',
      is_default: false,
    });
  }

  // Associations (from processes)
  for (const process of processes) {
    for (const tag of ['bpmn:association', 'bpmn2:association', 'association']) {
      for (const item of toArray(process[tag])) {
        flows.push({
          flow_id: item['@_id'],
          type: 'ASSOCIATION',
          source_ref: item['@_sourceRef'] ?? '',
          target_ref: item['@_targetRef'] ?? '',
          is_default: false,
        });
      }
    }
  }

  for (const element of elements) {
    const bounds = boundsByElement.get(element.element_id);
    if (bounds) element.geometry = { bounds };
  }
  for (const flow of flows) {
    const waypoints = waypointsByFlow.get(flow.flow_id);
    if (waypoints?.length) flow.geometry = { waypoints };
  }

  if (boundsByElement.size === 0 && waypointsByFlow.size === 0) {
    warnings.push('BPMN DI geometry evidence unavailable; visual layout review requires INSUFFICIENT_EVIDENCE');
  }

  // Check for known element IDs for dangling ref detection
  const elementIds = new Set(elements.map(e => e.element_id));
  for (const flow of flows) {
    if (flow.source_ref && !elementIds.has(flow.source_ref)) {
      warnings.push(`Flow ${flow.flow_id} references unknown source element: ${flow.source_ref}`);
    }
    if (flow.target_ref && !elementIds.has(flow.target_ref)) {
      warnings.push(`Flow ${flow.flow_id} references unknown target element: ${flow.target_ref}`);
    }
  }

  const confidence = warnings.length === 0 ? 0.95 : 0.7;

  return {
    schema_version: '1.0.0',
    elements,
    flows,
    metadata: {
      parse_mode: 'STRUCTURED',
      source_format: 'bpmn',
      confidence,
      warnings,
    },
  };
}

function toArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function collectDefaultFlowRefs(root) {
  const refs = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value['@_default'] === 'string' && value['@_default']) {
      refs.add(value['@_default']);
    }
    for (const [key, child] of Object.entries(value)) {
      if (!key.startsWith('@_')) visit(child);
    }
  };
  visit(root);
  return refs;
}

function extractDiagramGeometry(definitions) {
  const boundsByElement = new Map();
  const waypointsByFlow = new Map();
  const diagrams = toArray(
    definitions['bpmndi:BPMNDiagram'] ??
    definitions['bpmn2:BPMNDiagram'] ??
    definitions.BPMNDiagram
  );

  for (const diagram of diagrams) {
    const planes = toArray(
      diagram['bpmndi:BPMNPlane'] ?? diagram['bpmn2:BPMNPlane'] ?? diagram.BPMNPlane
    );
    for (const plane of planes) {
      const shapes = toArray(
        plane['bpmndi:BPMNShape'] ?? plane['bpmn2:BPMNShape'] ?? plane.BPMNShape
      );
      for (const shape of shapes) {
        const elementId = shape['@_bpmnElement'];
        const raw = shape['dc:Bounds'] ?? shape['bpmndi:Bounds'] ?? shape.Bounds;
        const bounds = raw && numericObject(raw, ['x', 'y', 'width', 'height']);
        if (elementId && bounds) boundsByElement.set(elementId, bounds);
      }

      const edges = toArray(
        plane['bpmndi:BPMNEdge'] ?? plane['bpmn2:BPMNEdge'] ?? plane.BPMNEdge
      );
      for (const edge of edges) {
        const flowId = edge['@_bpmnElement'];
        const rawPoints = toArray(edge['di:waypoint'] ?? edge['bpmndi:waypoint'] ?? edge.waypoint);
        const waypoints = rawPoints
          .map(point => numericObject(point, ['x', 'y']))
          .filter(Boolean);
        if (flowId && waypoints.length >= 2) waypointsByFlow.set(flowId, waypoints);
      }
    }
  }

  return { boundsByElement, waypointsByFlow };
}

function numericObject(raw, keys) {
  const result = {};
  for (const key of keys) {
    const value = Number(raw[`@_${key}`]);
    if (!Number.isFinite(value)) return null;
    result[key] = value;
  }
  return result;
}
