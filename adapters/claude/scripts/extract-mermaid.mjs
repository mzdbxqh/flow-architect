/**
 * Extract a DiagramModel from Mermaid diagram text.
 *
 * Only graph/flowchart structures are fully parsed. Other diagram types
 * (sequenceDiagram, classDiagram, etc.) return a degraded result with
 * SUCCEEDED_WITH_WARNINGS metadata.
 *
 * @param {string} text - Raw Mermaid text.
 * @returns {import('./types.mjs').DiagramModel} Structured diagram model.
 */
export function extractMermaid(text) {
  const trimmed = text.trim();
  const firstLine = trimmed.split('\n')[0].trim();

  // Check if this is a supported diagram type
  const isFlowchart = /^(graph|flowchart)\s/i.test(firstLine);
  if (!isFlowchart) {
    // Detect what type it is
    const diagramTypeMatch = firstLine.match(/^(\w+)/);
    const diagramType = diagramTypeMatch ? diagramTypeMatch[1] : 'unknown';
    return {
      schema_version: '1.0.0',
      elements: [],
      flows: [],
      metadata: {
        parse_mode: 'STRUCTURED',
        source_format: 'mermaid',
        confidence: 0.0,
        warnings: [`Unsupported diagram type: ${diagramType}. Only graph/flowchart structures are supported.`],
      },
    };
  }

  const elements = [];
  const flows = [];
  const warnings = [];
  const elementIds = new Set();
  let currentSubgraph = null;

  const lines = trimmed.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines, comments, and the first line (graph declaration)
    if (!line || line.startsWith('%%') || /^(graph|flowchart)\s/i.test(line)) {
      continue;
    }

    // Subgraph
    const subgraphMatch = line.match(/^subgraph\s+(?:"([^"]+)"|(\S+))/i);
    if (subgraphMatch) {
      const name = subgraphMatch[1] ?? subgraphMatch[2];
      currentSubgraph = name;
      const subId = 'subgraph_' + sanitizeId(name);
      if (!elementIds.has(subId)) {
        elements.push({
          element_id: subId,
          type: 'SUB_PROCESS',
          name,
          parent_id: null,
          lane_id: null,
          sub_type: 'subgraph',
        });
        elementIds.add(subId);
      }
      continue;
    }

    if (/^end$/i.test(line)) {
      currentSubgraph = null;
      continue;
    }

    // Edge definition: nodeA --> nodeB, nodeA --- nodeB, nodeA -.-> nodeB
    // Pattern: optional_node_def edge_op optional_label optional_node_def
    const edgeMatch = line.match(
      /^(\w+(?:\[.*?\]|\(.*?\)|\{.*?\})?)\s*(-->|---|-\.\.?->?)\s*(?:\|([^|]*)\|\s*)?(\w+(?:\[.*?\]|\(.*?\)|\{.*?\})?)$/
    );

    if (edgeMatch) {
      const [, srcRaw, edgeOp, label, tgtRaw] = edgeMatch;
      const srcId = ensureElement(srcRaw, elements, elementIds, currentSubgraph);
      const tgtId = ensureElement(tgtRaw, elements, elementIds, currentSubgraph);
      const flowType = edgeOp.includes('-.') ? 'ASSOCIATION' : 'SEQUENCE_FLOW';
      flows.push({
        flow_id: `flow_${flows.length + 1}`,
        type: flowType,
        source_ref: srcId,
        target_ref: tgtId,
        is_default: false,
      });
      if (label) {
        // label is informational; not stored in the flow schema
      }
      continue;
    }

    // Standalone node definition: nodeId[Label] or nodeId(Label) or nodeId{Label}
    const nodeMatch = line.match(/^(\w+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?\s*$/);
    if (nodeMatch) {
      const [, id, bracketLabel, parenLabel, braceLabel] = nodeMatch;
      const name = bracketLabel ?? parenLabel ?? braceLabel ?? id;
      if (!elementIds.has(id)) {
        elements.push({
          element_id: id,
          type: 'TASK',
          name,
          parent_id: currentSubgraph ? 'subgraph_' + sanitizeId(currentSubgraph) : null,
          lane_id: null,
          sub_type: null,
        });
        elementIds.add(id);
      }
      continue;
    }

    // If we can't parse the line, add a warning
    if (line.length > 0) {
      warnings.push(`Unparseable line ${i + 1}: ${line}`);
    }
  }

  return {
    schema_version: '1.0.0',
    elements,
    flows,
    metadata: {
      parse_mode: 'STRUCTURED',
      source_format: 'mermaid',
      confidence: warnings.length === 0 ? 0.85 : 0.6,
      warnings,
    },
  };
}

/**
 * Ensure a node element exists for a raw node reference string.
 * Returns the element_id.
 */
function ensureElement(raw, elements, elementIds, currentSubgraph) {
  // Parse node id and optional label
  const match = raw.match(/^(\w+)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?$/);
  const id = match ? match[1] : raw;
  const name = match ? (match[2] ?? match[3] ?? match[4] ?? id) : id;

  if (!elementIds.has(id)) {
    elements.push({
      element_id: id,
      type: 'TASK',
      name,
      parent_id: currentSubgraph ? 'subgraph_' + sanitizeId(currentSubgraph) : null,
      lane_id: null,
      sub_type: null,
    });
    elementIds.add(id);
  }

  return id;
}

function sanitizeId(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
