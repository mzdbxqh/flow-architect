import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { extractArchitectureMarkdown } from '../scripts/extract-architecture-markdown.mjs';
import { extractBpmn } from '../scripts/extract-bpmn.mjs';
import { reviewArchitecture } from '../scripts/review-architecture.mjs';
import { reviewBpmn } from '../scripts/review-bpmn.mjs';
import { reviewConsistency } from '../scripts/review-consistency.mjs';
import { reviewVisual } from '../scripts/review-visual.mjs';
import { validateContract } from '../scripts/lib/contract-validation.mjs';

const FIXTURE_DIR = path.resolve(
  import.meta.dirname,
  './fixtures/e2e/public-procurement'
);

function runReview() {
  const architectureText = fs.readFileSync(path.join(FIXTURE_DIR, 'architecture.md'), 'utf8');
  const bpmnText = fs.readFileSync(path.join(FIXTURE_DIR, 'process.bpmn'), 'utf8');
  const expected = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'expected-findings.json'), 'utf8')
  );

  const architectureModel = extractArchitectureMarkdown(architectureText, {
    artifactId: 'architecture.md',
  });
  const diagramModel = extractBpmn(bpmnText);
  const findings = [
    ...reviewArchitecture({ architectureModel }),
    ...reviewConsistency({ architectureModel, diagramModel }).findings,
    ...reviewBpmn({ diagramModel }),
    ...reviewVisual({ diagramModel }).findings,
  ];

  return { architectureText, bpmnText, expected, architectureModel, diagramModel, findings };
}

test('public procurement fixture does not disclose its expected rule answers', () => {
  const { architectureText, bpmnText } = runReview();
  const input = `${architectureText}\n${bpmnText}`;
  assert.doesNotMatch(input, /Defect\s*:/i);
  assert.doesNotMatch(input, /Should be FA-/i);
  assert.doesNotMatch(input, /FA-(?:L4|L6|SOP|HIER|CONS|BPMN|VIS)-\d{3}/);
});

test('public procurement E2E reads both artifacts into contract-valid models', () => {
  const { architectureModel, diagramModel } = runReview();
  const architectureValidation = validateContract('architecture-model', architectureModel);
  const diagramValidation = validateContract('diagram-model', diagramModel);

  assert.equal(
    architectureValidation.valid,
    true,
    JSON.stringify(architectureValidation.errors)
  );
  assert.equal(diagramValidation.valid, true, JSON.stringify(diagramValidation.errors));
  assert.ok(architectureModel.nodes.some(node => node.node_id === 'L5-ORPHAN'));
  assert.ok(diagramModel.flows.some(flow => flow.geometry?.waypoints?.length >= 2));
});

test('public procurement E2E produces exactly the eight expected rule-target pairs', () => {
  const { expected, findings } = runReview();
  const actualPairs = findings
    .flatMap(finding => finding.target_refs.map(target => `${finding.rule_id}:${target}`))
    .sort();
  const expectedPairs = expected.defects
    .map(defect => `${defect.expected_rule_id}:${defect.target_ref}`)
    .sort();

  assert.deepEqual(actualPairs, expectedPairs);
  assert.equal(findings.length, 8, 'the real review chain must not emit extra findings');
});

test('visual crossing finding is backed by retained BPMN DI coordinates', () => {
  const { findings } = runReview();
  const finding = findings.find(item => item.rule_id === 'FA-VIS-001');
  assert.ok(finding);
  assert.equal(finding.target_refs[0], 'flow-6');
  assert.match(finding.evidence[0].observation, /\(290, 290\)/);
  assert.equal(finding.business_confirmation_required, false);
});
