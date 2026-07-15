import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateContract, schemaKinds } from '../scripts/lib/contract-validation.mjs';
import { stableFindingFingerprint } from '../scripts/lib/stable-fingerprint.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'contracts');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

// --- Fixture mapping: kind -> valid fixture filename ---
const FIXTURE_MAP = {
  result: 'result.valid.json',
  'input-manifest': 'input-manifest.valid.json',
  'architecture-model': 'architecture-model.valid.json',
  'diagram-model': 'diagram-model.valid.json',
  'finding-set': 'finding-set.valid.json',
  'consistency-map': 'consistency-map.valid.json',
  'review-verdict': 'review-verdict.valid.json',
};

// Test: all valid fixtures pass their schema
for (const [kind, fixtureFile] of Object.entries(FIXTURE_MAP)) {
  test(`valid fixture passes: ${kind}`, () => {
    const value = loadFixture(fixtureFile);
    const result = validateContract(kind, value);
    assert.equal(result.valid, true, `Expected ${kind} fixture to be valid, got errors: ${JSON.stringify(result.errors)}`);
  });
}

// Test: result keeps status separate from review verdict
test('result keeps status separate from review verdict', () => {
  // result.status is about operational execution status
  const resultSchema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'references', 'schemas', 'result.schema.json'), 'utf8')
  );
  const reviewSchema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'references', 'schemas', 'review-verdict.schema.json'), 'utf8')
  );

  // result.status enum values
  const resultStatusEnum = resultSchema.properties.status.enum;
  assert.deepEqual(resultStatusEnum, [
    'SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'BLOCKED', 'NEEDS_INPUT', 'CANCELLED'
  ]);

  // review-verdict.review_verdict enum values are different
  const reviewVerdictEnum = reviewSchema.properties.review_verdict.enum;
  assert.deepEqual(reviewVerdictEnum, ['PASS', 'CONDITIONAL_PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE']);

  // They must have no overlap
  const overlap = resultStatusEnum.filter(v => reviewVerdictEnum.includes(v));
  assert.equal(overlap.length, 0, `status and review_verdict enums must not overlap, got: ${overlap.join(', ')}`);

  // result.decision exists and is separate from both
  const decisionEnum = resultSchema.properties.decision.enum;
  assert.deepEqual(decisionEnum, ['PASS', 'WARN', 'FAIL', 'BLOCKED', null]);
});

// Test: unknown fields are rejected (additionalProperties: false)
test('unknown fields are rejected in result', () => {
  const value = loadFixture('result.valid.json');
  value.extra_field = 'should not be here';
  const result = validateContract('result', value);
  assert.equal(result.valid, false, 'Should reject unknown extra_field');
});

test('unknown fields are rejected in review-verdict', () => {
  const value = loadFixture('review-verdict.valid.json');
  value.unknown_prop = 42;
  const result = validateContract('review-verdict', value);
  assert.equal(result.valid, false, 'Should reject unknown unknown_prop');
});

test('unknown fields are rejected in architecture-model nodes', () => {
  const value = loadFixture('architecture-model.valid.json');
  value.nodes[0].bogus = true;
  const result = validateContract('architecture-model', value);
  assert.equal(result.valid, false, 'Should reject unknown field on node');
});

// Test: invalid status enum is rejected
test('invalid status enum rejected', () => {
  const value = loadFixture('result.valid.json');
  value.status = 'SUCCESS'; // not in enum
  const result = validateContract('result', value);
  assert.equal(result.valid, false, 'Should reject invalid status value SUCCESS');
});

test('invalid review_verdict enum rejected', () => {
  const value = loadFixture('review-verdict.valid.json');
  value.review_verdict = 'APPROVED'; // not in enum
  const result = validateContract('review-verdict', value);
  assert.equal(result.valid, false, 'Should reject invalid review_verdict value APPROVED');
});

test('invalid severity enum rejected', () => {
  const value = loadFixture('finding-set.valid.json');
  value.findings[0].severity = 'WARNING'; // not in enum
  const result = validateContract('finding-set', value);
  assert.equal(result.valid, false, 'Should reject invalid severity WARNING');
});

// Test: fingerprint stability across recommendation wording changes
test('fingerprint is stable when recommendation wording changes', () => {
  const finding = {
    rule_id: 'consistency-missing-step',
    artifact_refs: ['arch-doc', 'bpmn-diagram'],
    target_refs: ['node-1', 'elem-1'],
    evidence: [
      {
        artifact_id: 'arch-doc',
        locator_type: 'LINE',
        locator: 'line-42',
        excerpt: 'Step 3',
        observation: 'No matching element',
      },
    ],
    recommendation: 'Original recommendation text here',
  };

  const fp1 = stableFindingFingerprint(finding);

  // Change only the recommendation wording
  const findingModified = { ...finding, recommendation: 'Completely different recommendation wording' };
  const fp2 = stableFindingFingerprint(findingModified);

  assert.equal(fp1, fp2, 'Fingerprint should be identical when only recommendation changes');

  // But changing rule_id should change fingerprint
  const findingDifferentRule = { ...finding, rule_id: 'different-rule' };
  const fp3 = stableFindingFingerprint(findingDifferentRule);
  assert.notEqual(fp1, fp3, 'Fingerprint should differ when rule_id changes');
});

// Test: fingerprint changes when evidence locators change
test('fingerprint changes when evidence locators change', () => {
  const finding = {
    rule_id: 'test-rule',
    artifact_refs: ['doc-a'],
    target_refs: ['node-x'],
    evidence: [
      { artifact_id: 'doc-a', locator_type: 'LINE', locator: 'line-10', excerpt: 'x', observation: 'y' },
    ],
  };

  const fp1 = stableFindingFingerprint(finding);

  const findingDifferentLocator = {
    ...finding,
    evidence: [
      { artifact_id: 'doc-a', locator_type: 'LINE', locator: 'line-99', excerpt: 'x', observation: 'y' },
    ],
  };
  const fp2 = stableFindingFingerprint(findingDifferentLocator);
  assert.notEqual(fp1, fp2, 'Fingerprint should differ when evidence locator changes');
});

// Test: fingerprint is deterministic (same input always produces same output)
test('fingerprint is deterministic', () => {
  const finding = {
    rule_id: 'rule-a',
    artifact_refs: ['z-doc', 'a-doc'], // intentionally unsorted
    target_refs: ['z-node', 'a-node'],
    evidence: [
      { artifact_id: 'a-doc', locator_type: 'BPMN_ELEMENT', locator: 'bpmn-1', excerpt: '...', observation: '...' },
    ],
  };

  const results = new Set();
  for (let i = 0; i < 10; i++) {
    results.add(stableFindingFingerprint(finding));
  }
  assert.equal(results.size, 1, 'Fingerprint should be deterministic across multiple calls');
});

// Test: unknown schema kind is rejected
test('unknown schema kind returns error', () => {
  const result = validateContract('nonexistent-kind', { foo: 1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].message.includes('Unknown schema kind'));
});

// Test: schemaKinds returns all expected kinds
test('schemaKinds returns all 7 kinds', () => {
  const kinds = schemaKinds();
  assert.equal(kinds.length, 7);
  for (const expected of ['result', 'input-manifest', 'architecture-model', 'diagram-model', 'finding-set', 'consistency-map', 'review-verdict']) {
    assert.ok(kinds.includes(expected), `Expected kind '${expected}' in schemaKinds()`);
  }
});
