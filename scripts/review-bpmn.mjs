import { createReviewFinding } from './lib/review-finding.mjs';

export function reviewBpmn({ diagramModel }) {
  if (!diagramModel) throw new Error('diagramModel is required');
  const connected = new Set();
  for (const flow of diagramModel.flows ?? []) {
    if (flow.type !== 'SEQUENCE_FLOW') continue;
    connected.add(flow.source_ref);
    connected.add(flow.target_ref);
  }
  const artifactId = 'process.bpmn';
  return (diagramModel.elements ?? [])
    .filter(element => ['TASK', 'SUB_PROCESS', 'EVENT'].includes(element.type))
    .filter(element => !connected.has(element.element_id))
    .map(element => createReviewFinding({
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
