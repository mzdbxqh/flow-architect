import { requireRuntimePackage } from './lib/runtime-loader.mjs';

let _XMLParser;
function getXMLParser() {
  if (!_XMLParser) {
    const mod = requireRuntimePackage('core', 'fast-xml-parser');
    _XMLParser = mod.XMLParser;
  }
  return _XMLParser;
}

/**
 * Extract a DiagramModel from SVG content.
 *
 * All semantic types are set to UNKNOWN_VISUAL_ELEMENT since SVGs carry
 * geometry but no BPMN/process semantics. No BPMN semantic claims are made.
 *
 * @param {string} svg - Raw SVG XML string.
 * @returns {import('./types.mjs').DiagramModel} Structured diagram model.
 */
export function extractSvg(svg) {
  const parser = new (getXMLParser())({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    htmlEntities: false,
  });

  const parsed = parser.parse(svg);
  const svgRoot = parsed.svg ?? parsed;
  const elements = [];
  const flows = [];
  const warnings = [];

  let elementCounter = 0;

  function addElement(name, subType, geometry = null) {
    elementCounter++;
    elements.push({
      element_id: `svg_elem_${elementCounter}`,
      type: 'UNKNOWN_VISUAL_ELEMENT',
      name,
      parent_id: null,
      lane_id: null,
      sub_type: subType,
      ...(geometry ? { geometry } : {}),
    });
  }

  // Extract text elements
  collectText(svgRoot, addElement);

  // Extract shapes: rect, circle, ellipse, polygon, polyline
  collectShapes(svgRoot, addElement);

  // Extract lines
  collectLines(svgRoot, addElement);

  // Extract paths (as endpoints)
  collectPaths(svgRoot, addElement);

  // Extract groups that have text labels
  collectGroups(svgRoot, addElement);

  if (elements.length === 0) {
    warnings.push('No visual elements found in SVG');
  }

  return {
    schema_version: '1.0.0',
    elements,
    flows,
    metadata: {
      parse_mode: 'SEMI_STRUCTURED',
      source_format: 'svg',
      confidence: 0.5,
      warnings,
    },
  };
}

function collectText(root, addElement) {
  const texts = toArray(root.text);
  for (const t of texts) {
    const content = extractTextContent(t);
    if (content.trim()) {
      addElement(content.trim(), 'text', coordinates(t, ['x', 'y']));
    }
  }

  // Also check for tspan within text
  for (const t of texts) {
    const tspans = toArray(t.tspan);
    for (const ts of tspans) {
      const content = extractTextContent(ts);
      if (content.trim()) {
        addElement(content.trim(), 'tspan', coordinates(ts, ['x', 'y']));
      }
    }
  }

  // Recurse into groups
  const groups = toArray(root.g);
  for (const g of groups) {
    collectText(g, addElement);
  }
}

function collectShapes(root, addElement) {
  // Rectangles
  for (const r of toArray(root.rect)) {
    const w = parseFloat(r['@_width'] ?? 0);
    const h = parseFloat(r['@_height'] ?? 0);
    if (w > 0 && h > 0) {
      addElement('', 'rect', coordinates(r, ['x', 'y', 'width', 'height']));
    }
  }

  // Circles
  for (const c of toArray(root.circle)) {
    addElement('', 'circle', coordinates(c, ['cx', 'cy', 'r']));
  }

  // Ellipses
  for (const e of toArray(root.ellipse)) {
    addElement('', 'ellipse', coordinates(e, ['cx', 'cy', 'rx', 'ry']));
  }

  // Polygons
  for (const p of toArray(root.polygon)) {
    addElement('', 'polygon', { points: p['@_points'] ?? '' });
  }

  // Polylines
  for (const p of toArray(root.polyline)) {
    addElement('', 'polyline', { points: p['@_points'] ?? '' });
  }

  // Recurse into groups
  const groups = toArray(root.g);
  for (const g of groups) {
    collectShapes(g, addElement);
    collectText(g, addElement);
    collectLines(g, addElement);
    collectPaths(g, addElement);
  }
}

function collectLines(root, addElement) {
  for (const l of toArray(root.line)) {
    addElement('', 'line', coordinates(l, ['x1', 'y1', 'x2', 'y2']));
  }

  const groups = toArray(root.g);
  for (const g of groups) {
    collectLines(g, addElement);
  }
}

function collectPaths(root, addElement) {
  for (const p of toArray(root.path)) {
    const d = p['@_d'] ?? '';
    if (d) {
      addElement(d.slice(0, 100), 'path', { d });
    }
  }

  const groups = toArray(root.g);
  for (const g of groups) {
    collectPaths(g, addElement);
  }
}

function collectGroups(root, addElement) {
  const groups = toArray(root.g);
  for (const g of groups) {
    // If a group has a direct text child, it might be a labeled shape
    const textContent = getGroupTextContent(g);
    if (textContent && !g._alreadyProcessed) {
      // Groups with text are useful semantic units
    }
    collectGroups(g, addElement);
  }
}

function getGroupTextContent(g) {
  const texts = toArray(g.text);
  const parts = [];
  for (const t of texts) {
    parts.push(extractTextContent(t));
  }
  return parts.join(' ').trim();
}

function extractTextContent(node) {
  if (typeof node === 'string') return node;
  const text = node['#text'] ?? '';
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return text.join('');
  return '';
}

function toArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function coordinates(node, keys) {
  const geometry = {};
  for (const key of keys) {
    const value = Number(node[`@_${key}`]);
    if (!Number.isFinite(value)) return null;
    geometry[key] = value;
  }
  return geometry;
}
