/**
 * Extract the documented Flow Architect markdown table profile into an
 * ArchitectureModel. The input is data only; prose and embedded instructions
 * are never executed or treated as reviewer directions.
 */
export function extractArchitectureMarkdown(markdown, { artifactId = 'architecture.md' } = {}) {
  if (typeof markdown !== 'string') throw new TypeError('markdown must be a string');
  const lines = markdown.split(/\r?\n/);
  const nodes = [];
  const relationships = [];
  const nodeAttributes = {};
  let sectionType = null;
  let headingParent = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const section = line.match(/^##\s+(.+)$/);
    if (section) {
      sectionType = classifySection(section[1]);
      headingParent = null;
      continue;
    }
    const subsection = line.match(/^###\s+((?:L[3-6]|SOP)-[^: ]+)/);
    if (subsection) {
      headingParent = subsection[1];
      continue;
    }
    if (!sectionType || !line.trim().startsWith('|')) continue;
    if (index + 1 >= lines.length || !isSeparatorRow(lines[index + 1])) continue;

    const headers = parseRow(line);
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      const values = parseRow(lines[index]);
      const record = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? '']));
      const node = recordToNode(record, sectionType, headingParent, artifactId, index + 1);
      if (node) {
        nodes.push(node);
        if (node.parent_id) {
          relationships.push({
            from_node_id: node.parent_id,
            to_node_id: node.node_id,
            type: 'contains',
          });
        }
        nodeAttributes[node.node_id] = extractAttributes(record, sectionType);
      }
      index++;
    }
    index--;
  }

  return {
    schema_version: '1.0.0',
    nodes,
    relationships,
    metadata: {
      source: artifactId,
      profile: 'flow-architect-markdown-tables-v1',
      node_attributes: nodeAttributes,
    },
  };
}

function classifySection(title) {
  if (/^L3\b/i.test(title)) return 'L3';
  if (/^L4\b/i.test(title)) return 'L4';
  if (/^L5\b/i.test(title)) return 'L5';
  if (/^L6\b/i.test(title)) return 'L6';
  if (/^SOP\b/i.test(title)) return 'SOP';
  return null;
}

function isSeparatorRow(line) {
  return /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
}

function parseRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function recordToNode(record, type, headingParent, artifactId, lineNumber) {
  const nodeId = record.ID || record['SOP ID'];
  if (!nodeId || !record.Name) return null;
  const parentId = type === 'L3'
    ? null
    : (record.Parent || headingParent || null);
  const roleText = record.Role || record.Owner || record.Department || '';
  return {
    node_id: nodeId,
    type,
    name: record.Name,
    parent_id: parentId,
    roles: splitValues(roleText),
    inputs: record.Input ? [{ name: record.Input, type: 'ARTIFACT' }] : [],
    outputs: record.Output ? [{ name: record.Output, type: 'ARTIFACT' }] : [],
    rasci: 'R',
    source_refs: [`${artifactId}:${lineNumber}`],
    rules_refs: [],
  };
}

function extractAttributes(record, type) {
  if (type === 'L4') {
    return {
      department: splitValues(record.Department),
      system: splitValues(record.System),
      timeframe: splitValues(record.Timeframe),
      location: splitValues(record.Location),
    };
  }
  if (type === 'SOP') {
    return { l6_references: splitValues(record['L6 Reference']) };
  }
  return {};
}

function splitValues(value = '') {
  return value
    .split(/\s*(?:,|\+|；|，)\s*/u)
    .map(item => item.trim())
    .filter(Boolean);
}
