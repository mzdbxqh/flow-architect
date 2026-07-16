import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { selectRoute, Route } from '../scripts/select-route.mjs';
import { collectFindings } from '../scripts/collect-findings.mjs';
import { finalizeReview } from '../scripts/finalize-review.mjs';
import { createRun } from '../scripts/create-run.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- select-route tests ---

test('select-route: both present -> INTEGRATED', () => {
  const result = selectRoute({ architectureCount: 1, diagramCount: 1 });
  assert.equal(result.route, Route.INTEGRATED);
});

test('select-route: only architecture -> ARCHITECTURE_ONLY', () => {
  const result = selectRoute({ architectureCount: 2, diagramCount: 0 });
  assert.equal(result.route, Route.ARCHITECTURE_ONLY);
});

test('select-route: only diagram -> DIAGRAM_ONLY', () => {
  const result = selectRoute({ architectureCount: 0, diagramCount: 1 });
  assert.equal(result.route, Route.DIAGRAM_ONLY);
});

test('select-route: neither -> NEEDS_INPUT', () => {
  const result = selectRoute({ architectureCount: 0, diagramCount: 0 });
  assert.equal(result.route, Route.NEEDS_INPUT);
});

test('select-route: explicit INTEGRATED but missing diagram -> NEEDS_INPUT', () => {
  const result = selectRoute({ explicit: 'INTEGRATED', architectureCount: 1, diagramCount: 0 });
  assert.equal(result.route, Route.NEEDS_INPUT);
  assert.ok(result.reason.includes('diagram'));
});

test('select-route: explicit INTEGRATED but missing architecture -> NEEDS_INPUT', () => {
  const result = selectRoute({ explicit: 'INTEGRATED', architectureCount: 0, diagramCount: 1 });
  assert.equal(result.route, Route.NEEDS_INPUT);
  assert.ok(result.reason.includes('architecture'));
});

test('select-route: explicit ARCHITECTURE_ONLY with architecture -> ARCHITECTURE_ONLY', () => {
  const result = selectRoute({ explicit: 'ARCHITECTURE_ONLY', architectureCount: 1, diagramCount: 0 });
  assert.equal(result.route, Route.ARCHITECTURE_ONLY);
});

test('select-route: explicit DIAGRAM_ONLY with diagram -> DIAGRAM_ONLY', () => {
  const result = selectRoute({ explicit: 'DIAGRAM_ONLY', architectureCount: 0, diagramCount: 1 });
  assert.equal(result.route, Route.DIAGRAM_ONLY);
});

// --- Test 1: Explicit integrated review needs both artifact families ---

test('explicit integrated review requires both architecture and diagram artifacts', () => {
  // Both present: should route to INTEGRATED
  const both = selectRoute({ explicit: 'INTEGRATED', architectureCount: 1, diagramCount: 1 });
  assert.equal(both.route, Route.INTEGRATED, 'Should be INTEGRATED when both present');

  // Only architecture: should be NEEDS_INPUT
  const onlyArch = selectRoute({ explicit: 'INTEGRATED', architectureCount: 1, diagramCount: 0 });
  assert.equal(onlyArch.route, Route.NEEDS_INPUT, 'Should NEEDS_INPUT when diagram missing');

  // Only diagram: should be NEEDS_INPUT
  const onlyDiag = selectRoute({ explicit: 'INTEGRATED', architectureCount: 0, diagramCount: 1 });
  assert.equal(onlyDiag.route, Route.NEEDS_INPUT, 'Should NEEDS_INPUT when architecture missing');

  // Neither: should be NEEDS_INPUT
  const neither = selectRoute({ explicit: 'INTEGRATED', architectureCount: 0, diagramCount: 0 });
  assert.equal(neither.route, Route.NEEDS_INPUT, 'Should NEEDS_INPUT when both missing');
});

// --- Test 2: Same finding fingerprint emitted once ---

test('same finding fingerprint is deduplicated across stages', () => {
  const sharedFingerprint = 'abc123def456';
  const finding = {
    finding_id: 'f-001',
    rule_id: 'FA-L4-001',
    category: 'L4',
    severity: 'MAJOR',
    verdict: 'FAIL',
    artifact_refs: ['arch.json'],
    target_refs: ['node-1'],
    evidence: [
      {
        artifact_id: 'arch.json',
        locator_type: 'LINE',
        locator: 'line-10',
        excerpt: 'test',
        observation: 'obs',
      },
    ],
    expected: 'expected',
    actual: 'actual',
    recommendation: 'fix it',
    confidence: 0.9,
    business_confirmation_required: false,
    source_rule_refs: [],
    fingerprint: sharedFingerprint,
  };

  // Two stages emit the same finding (same fingerprint)
  const stageA = {
    stage_id: 'review-l4',
    status: 'SUCCEEDED',
    findings: [{ ...finding, finding_id: 'f-001' }],
  };
  const stageB = {
    stage_id: 'review-hierarchy',
    status: 'SUCCEEDED',
    findings: [{ ...finding, finding_id: 'f-002' }],
  };

  const merged = collectFindings([stageA, stageB]);
  assert.equal(merged.findings.length, 1, 'Same fingerprint should be emitted once');
  assert.equal(merged.findings[0].fingerprint, sharedFingerprint);
});

test('different fingerprints produce separate findings', () => {
  const stage = {
    stage_id: 'review-l4',
    status: 'SUCCEEDED',
    findings: [
      {
        finding_id: 'f-001',
        rule_id: 'FA-L4-001',
        category: 'L4',
        severity: 'MAJOR',
        verdict: 'FAIL',
        artifact_refs: ['arch.json'],
        target_refs: ['node-1'],
        evidence: [{ artifact_id: 'arch.json', locator_type: 'LINE', locator: 'line-1', excerpt: 'a', observation: 'b' }],
        expected: 'e', actual: 'a', recommendation: 'r',
        confidence: 0.9, business_confirmation_required: false, source_rule_refs: [],
        fingerprint: 'fp-001',
      },
      {
        finding_id: 'f-002',
        rule_id: 'FA-L4-002',
        category: 'L4',
        severity: 'MINOR',
        verdict: 'FAIL',
        artifact_refs: ['arch.json'],
        target_refs: ['node-2'],
        evidence: [{ artifact_id: 'arch.json', locator_type: 'LINE', locator: 'line-2', excerpt: 'c', observation: 'd' }],
        expected: 'e2', actual: 'a2', recommendation: 'r2',
        confidence: 0.8, business_confirmation_required: false, source_rule_refs: [],
        fingerprint: 'fp-002',
      },
    ],
  };

  const merged = collectFindings([stage]);
  assert.equal(merged.findings.length, 2, 'Different fingerprints should produce separate findings');
});

test('findings with more evidence are kept during dedup', () => {
  const fp = 'same-fp';
  const findingFewEvidence = {
    finding_id: 'f-few',
    rule_id: 'FA-L4-001',
    category: 'L4',
    severity: 'MAJOR',
    verdict: 'FAIL',
    artifact_refs: ['arch.json'],
    target_refs: ['node-1'],
    evidence: [
      { artifact_id: 'arch.json', locator_type: 'LINE', locator: 'line-1', excerpt: 'a', observation: 'b' },
    ],
    expected: 'e', actual: 'a', recommendation: 'r',
    confidence: 0.9, business_confirmation_required: false, source_rule_refs: [],
    fingerprint: fp,
  };
  const findingMoreEvidence = {
    finding_id: 'f-more',
    rule_id: 'FA-L4-001',
    category: 'L4',
    severity: 'MAJOR',
    verdict: 'FAIL',
    artifact_refs: ['arch.json'],
    target_refs: ['node-1'],
    evidence: [
      { artifact_id: 'arch.json', locator_type: 'LINE', locator: 'line-1', excerpt: 'a', observation: 'b' },
      { artifact_id: 'arch.json', locator_type: 'LINE', locator: 'line-2', excerpt: 'c', observation: 'd' },
    ],
    expected: 'e', actual: 'a', recommendation: 'r',
    confidence: 0.9, business_confirmation_required: false, source_rule_refs: [],
    fingerprint: fp,
  };

  const stage1 = { stage_id: 's1', status: 'SUCCEEDED', findings: [findingFewEvidence] };
  const stage2 = { stage_id: 's2', status: 'SUCCEEDED', findings: [findingMoreEvidence] };

  const merged = collectFindings([stage1, stage2]);
  assert.equal(merged.findings.length, 1);
  assert.equal(merged.findings[0].finding_id, 'f-more', 'Should keep the finding with more evidence');
});

test('collectFindings skips FAILED and BLOCKED stages', () => {
  const stage = {
    stage_id: 'failed-stage',
    status: 'FAILED',
    findings: [{
      finding_id: 'f-001', rule_id: 'FA-L4-001', category: 'L4', severity: 'MAJOR', verdict: 'FAIL',
      artifact_refs: [], target_refs: [],
      evidence: [{ artifact_id: 'x', locator_type: 'LINE', locator: '1', excerpt: 'x', observation: 'y' }],
      expected: 'e', actual: 'a', recommendation: 'r',
      confidence: 0.9, business_confirmation_required: false, source_rule_refs: [],
      fingerprint: 'fp-failed',
    }],
  };

  const merged = collectFindings([stage]);
  assert.equal(merged.findings.length, 0, 'FAILED stage findings should be skipped');
});

// --- Test 3: Gate execution success can still reject business quality ---

test('gate execution success can still produce FAIL verdict', () => {
  // A stage that SUCCEEDED (gate passes) but found blockers (verdict FAIL)
  const blockerStage = {
    stage_id: 'review-bpmn',
    status: 'SUCCEEDED_WITH_WARNINGS',
    decision: 'FAIL',
    findings: [
      {
        finding_id: 'blk-001',
        rule_id: 'FA-BPMN-001',
        category: 'BPMN',
        severity: 'BLOCKER',
        verdict: 'FAIL',
        artifact_refs: ['diagram.bpmn'],
        target_refs: ['process-1'],
        evidence: [
          {
            artifact_id: 'diagram.bpmn',
            locator_type: 'BPMN_ELEMENT',
            locator: 'process-1',
            excerpt: 'No start event',
            observation: 'Process has no start event',
          },
        ],
        expected: 'Process should have at least one start event',
        actual: 'No start event found',
        recommendation: 'Add a start event',
        confidence: 1.0,
        business_confirmation_required: false,
        source_rule_refs: [],
        fingerprint: 'blk-fp-001',
      },
    ],
    outputs: [{ path: 'stages/review-bpmn/finding-set.json', description: 'BPMN findings' }],
    warnings: [],
    blocking_reason: null,
    degradation: null,
    producer: { executor: 'agent', name: 'bpmn-worker', skill: 'flow-architect-review-bpmn' },
    evidence: ['stages/review-bpmn/finding-set.json'],
  };

  // All required stages for DIAGRAM_ONLY succeed
  const successStage = (id, skill) => ({
    stage_id: id,
    status: 'SUCCEEDED',
    decision: 'PASS',
    findings: [],
    outputs: [{ path: `stages/${id}/result.json`, description: 'result' }],
    warnings: [],
    blocking_reason: null,
    degradation: null,
    producer: { executor: 'agent', name: `${id}-worker`, skill },
    evidence: [`stages/${id}/result.json`],
  });

  const stageResults = [
    successStage('extract-diagram', 'flow-architect-extract-diagram'),
    blockerStage,
    successStage('review-visual', 'flow-architect-review-visual'),
  ];

  const { gate, verdict, report } = finalizeReview({
    stageResults,
    route: 'DIAGRAM_ONLY',
    runId: 'test-run-001',
    runDir: '/tmp/test-run',
  });

  // Gate should pass: all required stages completed successfully
  assert.equal(gate.passed, true, 'Gate should pass: all stages executed successfully');

  // Verdict should FAIL: BLOCKER finding present
  assert.equal(verdict.review_verdict, 'FAIL', 'Verdict should FAIL due to BLOCKER finding');

  // The gate passed but the review verdict is FAIL
  assert.notEqual(gate.passed, verdict.review_verdict === 'PASS',
    'Gate success does not imply review PASS');
});

test('gate fails when required stages are missing', () => {
  // Only some stages for INTEGRATED route
  const stageResults = [
    {
      stage_id: 'extract-architecture',
      status: 'SUCCEEDED',
      decision: null,
      findings: [],
      outputs: [],
      warnings: [],
      blocking_reason: null,
      degradation: null,
      producer: { executor: 'agent', name: 'ea', skill: 'flow-architect-extract-architecture' },
      evidence: ['stages/extract-architecture/result.json'],
    },
  ];

  const { gate, verdict } = finalizeReview({
    stageResults,
    route: 'INTEGRATED',
    runId: 'test-run-002',
    runDir: '/tmp/test-run-2',
  });

  assert.equal(gate.passed, false, 'Gate should fail when required stages are missing');
  assert.equal(verdict.review_verdict, 'INSUFFICIENT_EVIDENCE', 'Missing stages should produce INSUFFICIENT_EVIDENCE');
});

test('CONDITIONAL_PASS when only MAJOR/MINOR findings', () => {
  const stageResults = [
    {
      stage_id: 'extract-diagram',
      status: 'SUCCEEDED',
      decision: null,
      findings: [],
      outputs: [],
      warnings: [],
      blocking_reason: null,
      degradation: null,
      producer: { executor: 'agent', name: 'ed', skill: 'flow-architect-extract-diagram' },
      evidence: ['stages/extract-diagram/result.json'],
    },
    {
      stage_id: 'review-bpmn',
      status: 'SUCCEEDED',
      decision: 'WARN',
      findings: [
        {
          finding_id: 'maj-001',
          rule_id: 'FA-BPMN-003',
          category: 'BPMN',
          severity: 'MAJOR',
          verdict: 'FAIL',
          artifact_refs: ['diagram.bpmn'],
          target_refs: ['task-1'],
          evidence: [{ artifact_id: 'diagram.bpmn', locator_type: 'BPMN_ELEMENT', locator: 'task-1', excerpt: 'task', observation: 'missing label' }],
          expected: 'Task should have label', actual: 'No label', recommendation: 'Add label',
          confidence: 0.9, business_confirmation_required: false, source_rule_refs: [],
          fingerprint: 'maj-fp-001',
        },
      ],
      outputs: [],
      warnings: [],
      blocking_reason: null,
      degradation: null,
      producer: { executor: 'agent', name: 'rb', skill: 'flow-architect-review-bpmn' },
      evidence: ['stages/review-bpmn/result.json'],
    },
    {
      stage_id: 'review-visual',
      status: 'SUCCEEDED',
      decision: 'PASS',
      findings: [],
      outputs: [],
      warnings: [],
      blocking_reason: null,
      degradation: null,
      producer: { executor: 'agent', name: 'rv', skill: 'flow-architect-review-visual' },
      evidence: ['stages/review-visual/result.json'],
    },
  ];

  const { verdict } = finalizeReview({
    stageResults,
    route: 'DIAGRAM_ONLY',
    runId: 'test-run-003',
    runDir: '/tmp/test-run-3',
  });

  assert.equal(verdict.review_verdict, 'CONDITIONAL_PASS');
  assert.equal(verdict.major_count, 1);
  assert.equal(verdict.blocker_count, 0);
  assert.equal(verdict.critical_count, 0);
});

test('PASS when no findings', () => {
  const successStage = (id, skill) => ({
    stage_id: id,
    status: 'SUCCEEDED',
    decision: 'PASS',
    findings: [],
    outputs: [],
    warnings: [],
    blocking_reason: null,
    degradation: null,
    producer: { executor: 'agent', name: id, skill },
    evidence: [`stages/${id}/result.json`],
  });

  const stageResults = [
    successStage('extract-diagram', 'flow-architect-extract-diagram'),
    successStage('review-bpmn', 'flow-architect-review-bpmn'),
    successStage('review-visual', 'flow-architect-review-visual'),
  ];

  const { verdict } = finalizeReview({
    stageResults,
    route: 'DIAGRAM_ONLY',
    runId: 'test-run-004',
    runDir: '/tmp/test-run-4',
  });

  assert.equal(verdict.review_verdict, 'PASS');
  assert.equal(verdict.total_findings, 0);
});

// --- Scope limitations tests ---

test('ARCHITECTURE_ONLY scope limitations list diagram and consistency gaps', () => {
  const successStage = (id, skill) => ({
    stage_id: id, status: 'SUCCEEDED', decision: 'PASS', findings: [],
    outputs: [], warnings: [], blocking_reason: null, degradation: null,
    producer: { executor: 'agent', name: id, skill },
    evidence: [`stages/${id}/result.json`],
  });

  const stageResults = [
    successStage('extract-architecture', 'flow-architect-extract-architecture'),
    successStage('review-l4', 'flow-architect-review-l4'),
    successStage('review-l5', 'flow-architect-review-l5'),
    successStage('review-l6', 'flow-architect-review-l6'),
    successStage('review-sop', 'flow-architect-review-sop'),
    successStage('review-hierarchy', 'flow-architect-review-hierarchy'),
  ];

  const { verdict } = finalizeReview({
    stageResults,
    route: 'ARCHITECTURE_ONLY',
    runId: 'test-run-005',
    runDir: '/tmp/test-run-5',
  });

  assert.ok(verdict.scope_limitations.length > 0, 'Should have scope limitations');
  assert.ok(verdict.scope_limitations.some(s => s.includes('Consistency')), 'Should mention consistency review not performed');
  assert.ok(verdict.scope_limitations.some(s => s.includes('BPMN')), 'Should mention BPMN review not performed');
  assert.equal(verdict.review_verdict, 'PASS');
});

test('DIAGRAM_ONLY scope limitations list architecture and consistency gaps', () => {
  const successStage = (id, skill) => ({
    stage_id: id, status: 'SUCCEEDED', decision: 'PASS', findings: [],
    outputs: [], warnings: [], blocking_reason: null, degradation: null,
    producer: { executor: 'agent', name: id, skill },
    evidence: [`stages/${id}/result.json`],
  });

  const stageResults = [
    successStage('extract-diagram', 'flow-architect-extract-diagram'),
    successStage('review-bpmn', 'flow-architect-review-bpmn'),
    successStage('review-visual', 'flow-architect-review-visual'),
  ];

  const { verdict } = finalizeReview({
    stageResults,
    route: 'DIAGRAM_ONLY',
    runId: 'test-run-006',
    runDir: '/tmp/test-run-6',
  });

  assert.ok(verdict.scope_limitations.length > 0, 'Should have scope limitations');
  assert.ok(verdict.scope_limitations.some(s => s.includes('L4')), 'Should mention L4 review not performed');
  assert.ok(verdict.scope_limitations.some(s => s.includes('Consistency')), 'Should mention consistency review not performed');
});

// --- create-run tests ---

test('createRun creates expected directory structure', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-arch-test-run-'));
  try {
    const { runDir, runId } = createRun({ baseDir, runId: 'test-run-001' });

    assert.ok(fs.existsSync(runDir), 'Run directory should exist');
    assert.ok(fs.existsSync(path.join(runDir, 'input')), 'input/ should exist');
    assert.ok(fs.existsSync(path.join(runDir, 'stages')), 'stages/ should exist');
    assert.ok(fs.existsSync(path.join(runDir, 'final')), 'final/ should exist');

    const manifestPath = path.join(runDir, 'input', 'input-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'input-manifest.json should exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.schema_version, '1.0.0');
    assert.equal(manifest.run_id, runId);
    assert.deepEqual(manifest.artifacts, []);
    assert.deepEqual(manifest.warnings, []);

    assert.equal(runId, 'test-run-001');
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('createRun fails if run ID exists', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-arch-test-dup-'));
  try {
    createRun({ baseDir, runId: 'dup-run' });
    assert.throws(
      () => createRun({ baseDir, runId: 'dup-run' }),
      /already exists/,
      'Should fail when run ID already exists'
    );
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

test('createRun generates ID when not provided', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-arch-test-gen-'));
  try {
    const { runId } = createRun({ baseDir });
    assert.ok(runId, 'Run ID should be generated');
    assert.ok(runId.length > 10, 'Run ID should have reasonable length');
    // Should match the pattern YYYYMMDDTHHmmss-<hex>
    assert.ok(/^\d{8}T\d{6}-[0-9a-f]{8}$/.test(runId), `Run ID format: ${runId}`);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

// --- Verdict schema conformance ---

test('finalizeReview verdict conforms to review-verdict schema structure', () => {
  const stageResults = [
    {
      stage_id: 'extract-diagram', status: 'SUCCEEDED', decision: null, findings: [],
      outputs: [], warnings: [], blocking_reason: null, degradation: null,
      producer: { executor: 'agent', name: 'ed', skill: 'flow-architect-extract-diagram' },
      evidence: ['stages/extract-diagram/result.json'],
    },
    {
      stage_id: 'review-bpmn', status: 'SUCCEEDED', decision: 'PASS', findings: [],
      outputs: [], warnings: [], blocking_reason: null, degradation: null,
      producer: { executor: 'agent', name: 'rb', skill: 'flow-architect-review-bpmn' },
      evidence: ['stages/review-bpmn/result.json'],
    },
    {
      stage_id: 'review-visual', status: 'SUCCEEDED', decision: 'PASS', findings: [],
      outputs: [], warnings: [], blocking_reason: null, degradation: null,
      producer: { executor: 'agent', name: 'rv', skill: 'flow-architect-review-visual' },
      evidence: ['stages/review-visual/result.json'],
    },
  ];

  const { verdict } = finalizeReview({
    stageResults,
    route: 'DIAGRAM_ONLY',
    runId: 'test-run-schema',
    runDir: '/tmp/test-schema',
  });

  // Check all required fields from review-verdict schema
  assert.equal(verdict.schema_version, '1.0.0');
  assert.equal(verdict.run_id, 'test-run-schema');
  assert.equal(verdict.route, 'DIAGRAM_ONLY');
  assert.ok(['PASS', 'CONDITIONAL_PASS', 'FAIL', 'INSUFFICIENT_EVIDENCE'].includes(verdict.review_verdict));
  assert.ok(Array.isArray(verdict.scope_limitations));
  assert.ok(typeof verdict.total_findings === 'number');
  assert.ok(typeof verdict.blocker_count === 'number');
  assert.ok(typeof verdict.critical_count === 'number');
  assert.ok(typeof verdict.major_count === 'number');
  assert.ok(typeof verdict.minor_count === 'number');
  assert.ok(typeof verdict.info_count === 'number');
  assert.ok(typeof verdict.business_confirmation_required_count === 'number');
  assert.ok(typeof verdict.summary === 'string');
});

// --- Report structure tests ---

test('flow-architect 入口包含归一化和批次处理步骤', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'skills/flow-architect/SKILL.md'), 'utf8'
  );
  assert.match(content, /归一化|normaliz/i, '主入口应提到归一化');
  assert.match(content, /批次|batch/i, '主入口应提到批次');
  assert.doesNotMatch(content, /读取全部原始文件|read all raw/i, '入口不应包含直读全文指令');
});

test('flow-architect-draft-process 入口包含归一化和批次处理步骤', () => {
  const content = fs.readFileSync(
    path.join(__dirname, '..', 'skills/flow-architect-draft-process/SKILL.md'), 'utf8'
  );
  assert.match(content, /归一化|normaliz/i, '初稿入口应提到归一化');
  assert.match(content, /批次|batch/i, '初稿入口应提到批次');
  assert.doesNotMatch(content, /读取全部原始文件|read all raw/i, '入口不应包含直读全文指令');
});

test('report includes all required sections', () => {
  const stageResults = [
    {
      stage_id: 'extract-diagram', status: 'SUCCEEDED', decision: null, findings: [],
      outputs: [], warnings: [], blocking_reason: null, degradation: null,
      producer: { executor: 'agent', name: 'ed', skill: 'flow-architect-extract-diagram' },
      evidence: ['stages/extract-diagram/result.json'],
    },
    {
      stage_id: 'review-bpmn', status: 'SUCCEEDED', decision: 'PASS', findings: [],
      outputs: [], warnings: [], blocking_reason: null, degradation: null,
      producer: { executor: 'agent', name: 'rb', skill: 'flow-architect-review-bpmn' },
      evidence: ['stages/review-bpmn/result.json'],
    },
    {
      stage_id: 'review-visual', status: 'SUCCEEDED', decision: 'PASS', findings: [],
      outputs: [], warnings: [], blocking_reason: null, degradation: null,
      producer: { executor: 'agent', name: 'rv', skill: 'flow-architect-review-visual' },
      evidence: ['stages/review-visual/result.json'],
    },
  ];

  const { report } = finalizeReview({
    stageResults,
    route: 'DIAGRAM_ONLY',
    runId: 'test-run-report',
    runDir: '/tmp/test-report',
  });

  // All required sections
  assert.ok(report.scope_and_capabilities, 'Should have scope_and_capabilities');
  assert.ok(typeof report.conclusion === 'string', 'Should have conclusion');
  assert.ok(report.findings_summary, 'Should have findings_summary');
  assert.ok(Array.isArray(report.architecture_issues), 'Should have architecture_issues');
  assert.ok(Array.isArray(report.diagram_issues), 'Should have diagram_issues');
  assert.ok(Array.isArray(report.consistency_issues), 'Should have consistency_issues');
  assert.ok(Array.isArray(report.unconfirmed_items), 'Should have unconfirmed_items');
  assert.ok(Array.isArray(report.unreveiwed_objects), 'Should have unreveiwed_objects');
  assert.ok(Array.isArray(report.degradation), 'Should have degradation');
  assert.ok(Array.isArray(report.evidence_paths), 'Should have evidence_paths');
  assert.ok(Array.isArray(report.scope_limitations), 'Should have scope_limitations');
});
