import { createReviewFinding } from './lib/review-finding.mjs';

export function reviewVisual({ diagramModel }) {
  if (!diagramModel) throw new Error('diagramModel is required');
  const flows = (diagramModel.flows ?? []).filter(flow => flow.geometry?.waypoints?.length >= 2);
  if (flows.length < 2) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      findings: [],
      reason: 'Visual claims require at least two flows with locatable geometry or equivalent rendered-image evidence.',
    };
  }
  const crossingsByFlow = new Map();

  for (let i = 0; i < flows.length; i++) {
    for (let j = i + 1; j < flows.length; j++) {
      const left = flows[i];
      const right = flows[j];
      if (sharesSemanticEndpoint(left, right)) continue;
      const crossing = firstInteriorCrossing(left.geometry.waypoints, right.geometry.waypoints);
      if (!crossing) continue;
      const target = left.geometry.waypoints.length >= right.geometry.waypoints.length ? left : right;
      const other = target === left ? right : left;
      if (!crossingsByFlow.has(target.flow_id)) crossingsByFlow.set(target.flow_id, []);
      crossingsByFlow.get(target.flow_id).push({ other: other.flow_id, point: crossing });
    }
  }

  const findings = [...crossingsByFlow.entries()].map(([flowId, crossings]) => {
    const { other, point } = crossings[0];
    return createReviewFinding({
      ruleId: 'FA-VIS-001', category: 'VISUAL', severity: 'MAJOR', artifactId: 'process.bpmn',
      targetRef: flowId, locatorType: 'BPMN_ELEMENT', locator: flowId,
      excerpt: `${flowId} × ${other}`,
      observation: `Retained BPMN DI segments for ${flowId} and ${other} cross at (${format(point.x)}, ${format(point.y)}).`,
      expected: 'Flow lines do not cross except at their shared semantic endpoints.',
      actual: 'Two flow paths intersect at an interior point.',
      recommendation: `Reroute ${flowId} to avoid the crossing with ${other}.`,
      confidence: 1,
    });
  });
  return { status: 'SUCCEEDED', findings, reason: null };
}

function sharesSemanticEndpoint(left, right) {
  return left.source_ref === right.source_ref || left.source_ref === right.target_ref ||
    left.target_ref === right.source_ref || left.target_ref === right.target_ref;
}

function firstInteriorCrossing(left, right) {
  for (let i = 0; i < left.length - 1; i++) {
    for (let j = 0; j < right.length - 1; j++) {
      const point = segmentIntersection(left[i], left[i + 1], right[j], right[j + 1]);
      if (point) return point;
    }
  }
  return null;
}

function segmentIntersection(a, b, c, d) {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function format(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
