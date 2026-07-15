/**
 * Review consistency between an architecture model and a diagram model.
 *
 * Matches architecture nodes (L4, L5) to diagram elements (SUB_PROCESS, TASK)
 * using normalized name comparison. Produces mappings and findings.
 *
 * @param {{ architectureModel: object, diagramModel: object }} params
 * @returns {{ mappings: object[], findings: object[] }}
 */
export function reviewConsistency({ architectureModel, diagramModel }) {
  if (!architectureModel) {
    throw new Error('architectureModel is required');
  }
  if (!diagramModel) {
    throw new Error('diagramModel is required');
  }

  const archNodes = architectureModel.nodes ?? [];
  const diagElements = diagramModel.elements ?? [];

  const mappings = [];
  const findings = [];
  let mappingCounter = 0;
  let findingCounter = 0;

  /** Normalize a name for fuzzy matching. */
  function normalize(name) {
    return (name ?? '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Check if two names match (exact or fuzzy). */
  function namesMatch(archName, diagName) {
    const a = normalize(archName);
    const d = normalize(diagName);
    if (!a || !d) return false;
    if (a === d) return true;
    // Check if one contains the other
    if (a.includes(d) || d.includes(a)) return true;
    // Check verb-object match: compare without common prefixes
    const aWords = a.split(' ');
    const dWords = d.split(' ');
    // If the last two words match, consider it a match
    if (aWords.length >= 2 && dWords.length >= 2) {
      const aEnd = aWords.slice(-2).join(' ');
      const dEnd = dWords.slice(-2).join(' ');
      if (aEnd === dEnd) return true;
    }
    return false;
  }

  /** Create a finding object. */
  function createFinding({ ruleId, category, severity, verdict, artifactRefs, targetRefs, evidence, expected, actual, recommendation }) {
    findingCounter++;
    return {
      finding_id: `cons-${String(findingCounter).padStart(3, '0')}`,
      rule_id: ruleId,
      category,
      severity,
      verdict,
      artifact_refs: artifactRefs,
      target_refs: targetRefs,
      evidence,
      expected,
      actual,
      recommendation,
      confidence: 0.85,
      business_confirmation_required: true,
      source_rule_refs: [],
      fingerprint: '',
    };
  }

  // Build lookup maps
  const diagByName = new Map();
  for (const elem of diagElements) {
    if (elem.type === 'TASK' || elem.type === 'SUB_PROCESS') {
      const norm = normalize(elem.name);
      if (norm) {
        if (!diagByName.has(norm)) diagByName.set(norm, []);
        diagByName.get(norm).push(elem);
      }
    }
  }

  const matchedDiagIds = new Set();
  const architectureIds = new Set(archNodes.map(node => node.node_id));
  const matchedL5Pairs = [];

  // Match L4 nodes to SUB_PROCESS elements
  const l4Nodes = archNodes.filter((n) => n.type === 'L4');
  const hasL4DiagramStructure = diagElements.some(
    element => element.type === 'SUB_PROCESS' || element.type === 'POOL'
  );
  for (const node of hasL4DiagramStructure ? l4Nodes : []) {
    let matched = false;
    for (const elem of diagElements) {
      if (elem.type !== 'SUB_PROCESS' && elem.type !== 'POOL') continue;
      if (namesMatch(node.name, elem.name)) {
        mappingCounter++;
        mappings.push({
          mapping_id: `map-${String(mappingCounter).padStart(3, '0')}`,
          architecture_node_id: node.node_id,
          diagram_element_id: elem.element_id,
          match_type: 'MATCH',
          confidence: 0.9,
          evidence: [`name match: "${node.name}" ~ "${elem.name}"`],
        });
        matchedDiagIds.add(elem.element_id);
        matched = true;
        break;
      }
    }
    if (!matched) {
      mappingCounter++;
      mappings.push({
        mapping_id: `map-${String(mappingCounter).padStart(3, '0')}`,
        architecture_node_id: node.node_id,
        diagram_element_id: '',
        match_type: 'MISSING_IN_DIAGRAM',
        confidence: 0.95,
        evidence: [`no diagram element matches L4 node "${node.name}"`],
      });
      findings.push(createFinding({
        ruleId: 'FA-CONS-001',
        category: 'CONSISTENCY',
        severity: 'BLOCKER',
        verdict: 'FAIL',
        artifactRefs: ['architecture-model', 'diagram-model'],
        targetRefs: [node.node_id],
        evidence: [{
          artifact_id: 'architecture-model',
          locator_type: 'LINE',
          locator: node.node_id,
          excerpt: node.name,
          observation: `L4 node "${node.name}" has no matching SUB_PROCESS in diagram`,
        }],
        expected: `L4 node "${node.name}" should have a corresponding SUB_PROCESS`,
        actual: 'No matching diagram element found',
        recommendation: `Add a Sub-Process element named "${node.name}" to the diagram`,
      }));
    }
  }

  // Match L5 nodes to TASK elements
  const l5Nodes = archNodes.filter(
    (n) => n.type === 'L5' && n.parent_id && architectureIds.has(n.parent_id)
  );
  for (const node of l5Nodes) {
    let matched = false;
    for (const elem of diagElements) {
      if (elem.type !== 'TASK') continue;
      if (namesMatch(node.name, elem.name)) {
        mappingCounter++;
        mappings.push({
          mapping_id: `map-${String(mappingCounter).padStart(3, '0')}`,
          architecture_node_id: node.node_id,
          diagram_element_id: elem.element_id,
          match_type: 'MATCH',
          confidence: 0.85,
          evidence: [`name match: "${node.name}" ~ "${elem.name}"`],
        });
        matchedDiagIds.add(elem.element_id);
        matchedL5Pairs.push({ node, elem });
        matched = true;
        break;
      }
    }
    if (!matched) {
      mappingCounter++;
      mappings.push({
        mapping_id: `map-${String(mappingCounter).padStart(3, '0')}`,
        architecture_node_id: node.node_id,
        diagram_element_id: '',
        match_type: 'MISSING_IN_DIAGRAM',
        confidence: 0.95,
        evidence: [`no diagram element matches L5 node "${node.name}"`],
      });
      findings.push(createFinding({
        ruleId: 'FA-CONS-002',
        category: 'CONSISTENCY',
        severity: 'CRITICAL',
        verdict: 'FAIL',
        artifactRefs: ['architecture-model', 'diagram-model'],
        targetRefs: [node.node_id],
        evidence: [{
          artifact_id: 'architecture-model',
          locator_type: 'LINE',
          locator: node.node_id,
          excerpt: node.name,
          observation: `L5 node "${node.name}" has no matching TASK in diagram`,
        }],
        expected: `L5 node "${node.name}" should have a corresponding TASK element`,
        actual: 'No matching diagram TASK element found',
        recommendation: `Add a Task element named "${node.name}" to the diagram`,
      }));
    }
  }

  // Group role-to-lane conflicts by lane so one visual container produces one
  // actionable finding even when several tasks demonstrate the same mismatch.
  const elementsById = new Map(diagElements.map(element => [element.element_id, element]));
  const conflictsByLane = new Map();
  for (const { node, elem } of matchedL5Pairs) {
    if (!elem.lane_id) continue;
    const lane = elementsById.get(elem.lane_id);
    if (!lane?.name || !node.roles?.length) continue;
    if (node.roles.some(role => namesMatch(role, lane.name))) continue;
    if (!conflictsByLane.has(lane.element_id)) conflictsByLane.set(lane.element_id, { lane, conflicts: [] });
    conflictsByLane.get(lane.element_id).conflicts.push({ node, elem });
  }
  for (const { lane, conflicts } of conflictsByLane.values()) {
    findings.push(createFinding({
      ruleId: 'FA-CONS-003',
      category: 'CONSISTENCY',
      severity: 'CRITICAL',
      verdict: 'FAIL',
      artifactRefs: ['architecture-model', 'diagram-model'],
      targetRefs: [lane.element_id],
      evidence: [{
        artifact_id: 'diagram-model',
        locator_type: 'BPMN_ELEMENT',
        locator: lane.element_id,
        excerpt: lane.name,
        observation: `Lane "${lane.name}" contains tasks whose architecture roles differ: ${conflicts.map(({ node, elem }) => `${elem.name} -> ${node.roles.join('/')}`).join('; ')}`,
      }],
      expected: 'Each mapped task is placed in a lane matching its architecture role.',
      actual: 'One or more mapped task roles conflict with the containing lane.',
      recommendation: 'Move the tasks to matching lanes or reconcile the architecture role assignments.',
    }));
  }

  // Detect unmatched diagram elements (extra elements)
  for (const elem of diagElements) {
    if (elem.type !== 'TASK' && elem.type !== 'SUB_PROCESS') continue;
    if (!matchedDiagIds.has(elem.element_id) && elem.name) {
      findings.push(createFinding({
        ruleId: 'FA-CONS-008',
        category: 'CONSISTENCY',
        severity: 'MINOR',
        verdict: 'FAIL',
        artifactRefs: ['diagram-model'],
        targetRefs: [elem.element_id],
        evidence: [{
          artifact_id: 'diagram-model',
          locator_type: 'BPMN_ELEMENT',
          locator: elem.element_id,
          excerpt: elem.name,
          observation: `Diagram element "${elem.name}" (${elem.type}) has no matching architecture node`,
        }],
        expected: 'All diagram tasks/sub-processes should map to architecture nodes',
        actual: `Diagram element "${elem.name}" is not mapped`,
        recommendation: `Verify if "${elem.name}" should be added to the architecture model or removed from the diagram`,
      }));
    }
  }

  return { mappings, findings };
}
