import { createReviewFinding } from './lib/review-finding.mjs';

export function reviewArchitecture({ architectureModel }) {
  if (!architectureModel) throw new Error('architectureModel is required');
  const nodes = architectureModel.nodes ?? [];
  const attributes = architectureModel.metadata?.node_attributes ?? {};
  const ids = new Set(nodes.map(node => node.node_id));
  const artifactId = architectureModel.metadata?.source ?? 'architecture-model';
  const findings = [];

  for (const node of nodes) {
    if (node.type === 'L4') {
      const dimensions = attributes[node.node_id] ?? {};
      const crossed = Object.entries(dimensions).filter(([, values]) => values.length > 1);
      if (crossed.length) {
        findings.push(createReviewFinding({
          ruleId: 'FA-L4-001', category: 'L4', severity: 'BLOCKER', artifactId,
          targetRef: node.node_id, locator: node.source_refs[0], excerpt: node.name,
          observation: `4D dimensions contain multiple values: ${crossed.map(([key, values]) => `${key}=[${values.join(', ')}]`).join('; ')}`,
          expected: 'Each L4 step stays within one department, system, timeframe, and location boundary.',
          actual: 'The step spans multiple values in one or more 4D dimensions.',
          recommendation: 'Split the step at each explicit boundary and document the handoff.',
          businessConfirmationRequired: true,
        }));
      }
    }

    if (node.type !== 'L3' && (!node.parent_id || !ids.has(node.parent_id))) {
      findings.push(createReviewFinding({
        ruleId: 'FA-HIER-001', category: 'HIERARCHY', severity: 'BLOCKER', artifactId,
        targetRef: node.node_id, locator: node.source_refs[0], excerpt: node.name,
        observation: `Parent reference ${JSON.stringify(node.parent_id)} does not identify an existing node.`,
        expected: 'Every non-root architecture node references an existing parent.',
        actual: 'The node is disconnected from the declared hierarchy.',
        recommendation: 'Correct the parent reference or add the missing parent node.',
      }));
    }

    if (node.type === 'L6' && looksTechnical(node.name)) {
      findings.push(createReviewFinding({
        ruleId: 'FA-L6-004', category: 'L6', severity: 'MAJOR', artifactId,
        targetRef: node.node_id, locator: node.source_refs[0], excerpt: node.name,
        observation: `The L6 name ${JSON.stringify(node.name)} uses a tool or implementation-oriented identifier.`,
        expected: 'L6 names express a business action without tool, API, table, or technical identifier leakage.',
        actual: 'The name is implementation-oriented rather than business-oriented.',
        recommendation: 'Rename the task as a verb-object business action and keep tooling in implementation metadata.',
      }));
    }

    if (node.type === 'SOP' && (attributes[node.node_id]?.l6_references?.length ?? 0) === 0) {
      findings.push(createReviewFinding({
        ruleId: 'FA-SOP-004', category: 'SOP', severity: 'CRITICAL', artifactId,
        targetRef: node.node_id, locator: node.source_refs[0], excerpt: node.name,
        observation: 'The SOP entry has no L6 reference.',
        expected: 'Every SOP entry references at least one L6 step or documents why decomposition is unnecessary.',
        actual: 'No L6 reference or explanation is present.',
        recommendation: 'Add the applicable L6 references or record a reviewable exception rationale.',
      }));
    }
  }

  return findings;
}

function looksTechnical(name) {
  return /(?:_|\b(?:SAP|API|SQL|DB|HTTP|JSON|XML)\b)/iu.test(name);
}
