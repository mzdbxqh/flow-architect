import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceVisualFindingPolicy } from '../scripts/enforce-visual-policy.mjs';
import { reviewConsistency } from '../scripts/review-consistency.mjs';
import { reviewVisual } from '../scripts/review-visual.mjs';
import {
  architectureFixture,
  diagramFixtureWithoutApproveTask,
  visualOnlyFindingFixture,
  findingSet,
  validStagesWithBlocker,
} from './helpers/review-fixtures.mjs';

// --- enforce-visual-policy tests ---

test('VISUAL_ONLY caps confidence at 0.6', () => {
  const findings = visualOnlyFindingFixture();
  // Original confidence is 0.85
  assert.equal(findings[0].confidence, 0.85);

  const { findings: enforced, changed } = enforceVisualFindingPolicy({
    findings,
    parseMode: 'VISUAL_ONLY',
  });

  assert.equal(enforced[0].confidence, 0.6, 'Confidence should be capped at 0.6');
  assert.ok(changed > 0, 'At least one change should be reported');
});

test('VISUAL_ONLY changes BPMN_ELEMENT to IMAGE_REGION', () => {
  const findings = visualOnlyFindingFixture();

  const { findings: enforced } = enforceVisualFindingPolicy({
    findings,
    parseMode: 'VISUAL_ONLY',
  });

  for (const finding of enforced) {
    for (const ev of finding.evidence) {
      assert.notEqual(
        ev.locator_type,
        'BPMN_ELEMENT',
        'VISUAL_ONLY findings should not use BPMN_ELEMENT'
      );
      assert.equal(
        ev.locator_type,
        'IMAGE_REGION',
        'VISUAL_ONLY findings should use IMAGE_REGION'
      );
    }
  }
});

test('STRUCTURED parse mode does not modify findings', () => {
  const findings = visualOnlyFindingFixture();
  const originalConfidence = findings[0].confidence;
  const originalLocator = findings[0].evidence[0].locator_type;

  const { findings: enforced, changed } = enforceVisualFindingPolicy({
    findings,
    parseMode: 'STRUCTURED',
  });

  assert.equal(enforced[0].confidence, originalConfidence, 'Confidence should not be modified');
  assert.equal(enforced[0].evidence[0].locator_type, originalLocator, 'Locator type should not be modified');
  assert.equal(changed, 0, 'No changes should be reported for STRUCTURED');
});

test('VISUAL_ONLY sets business_confirmation_required for low confidence', () => {
  const findings = visualOnlyFindingFixture();

  const { findings: enforced } = enforceVisualFindingPolicy({
    findings,
    parseMode: 'VISUAL_ONLY',
  });

  assert.equal(
    enforced[0].business_confirmation_required,
    true,
    'Low confidence findings should require business confirmation'
  );
});

test('enforceVisualFindingPolicy rejects invalid inputs', () => {
  assert.throws(
    () => enforceVisualFindingPolicy({ findings: 'not-array', parseMode: 'VISUAL_ONLY' }),
    /findings must be an array/
  );
  assert.throws(
    () => enforceVisualFindingPolicy({ findings: [], parseMode: 123 }),
    /parseMode must be a string/
  );
});

test('visual review reports insufficient evidence when no locatable geometry exists', () => {
  const result = reviewVisual({
    diagramModel: {
      elements: [{ element_id: 'image-1', type: 'UNKNOWN_VISUAL_ELEMENT', name: '', parent_id: null, lane_id: null, sub_type: 'image' }],
      flows: [],
      metadata: { parse_mode: 'VISUAL_ONLY', source_format: 'png', confidence: 0.5, warnings: [] },
    },
  });
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(result.findings, []);
  assert.match(result.reason, /locatable geometry/i);
});

// --- review-consistency tests ---

test('consistency detects missing L5 task mapping (Approve Payment)', () => {
  const arch = architectureFixture();
  const diag = diagramFixtureWithoutApproveTask();

  const { mappings, findings } = reviewConsistency({
    architectureModel: arch,
    diagramModel: diag,
  });

  // Should have mappings for all architecture nodes
  assert.ok(mappings.length >= 4, `Should have at least 4 mappings, got ${mappings.length}`);

  // Find the mapping for L5-002 (Approve Payment)
  const approveMapping = mappings.find((m) => m.architecture_node_id === 'L5-002');
  assert.ok(approveMapping, 'Should have a mapping for L5-002');
  assert.equal(approveMapping.match_type, 'MISSING_IN_DIAGRAM', 'Approve Payment should be MISSING_IN_DIAGRAM');

  // Should have a finding for the missing task
  const missingFindings = findings.filter(
    (f) => f.rule_id === 'FA-CONS-002' && f.target_refs.includes('L5-002')
  );
  assert.ok(missingFindings.length > 0, 'Should have FA-CONS-002 finding for missing Approve Payment');
  assert.equal(missingFindings[0].severity, 'CRITICAL', 'Missing L5 task should be CRITICAL');
  assert.equal(missingFindings[0].verdict, 'FAIL', 'Missing L5 task verdict should be FAIL');
});

test('consistency matches L4 node to POOL element', () => {
  const arch = architectureFixture();
  const diag = diagramFixtureWithoutApproveTask();

  const { mappings } = reviewConsistency({
    architectureModel: arch,
    diagramModel: diag,
  });

  const l4Mapping = mappings.find((m) => m.architecture_node_id === 'L4-001');
  assert.ok(l4Mapping, 'Should have a mapping for L4-001');
  assert.equal(l4Mapping.match_type, 'MATCH', 'L4-001 should MATCH the POOL');
});

test('consistency matches L5 tasks by name', () => {
  const arch = architectureFixture();
  const diag = diagramFixtureWithoutApproveTask();

  const { mappings } = reviewConsistency({
    architectureModel: arch,
    diagramModel: diag,
  });

  // Process Order should match
  const processMapping = mappings.find((m) => m.architecture_node_id === 'L5-001');
  assert.ok(processMapping, 'Should have mapping for L5-001');
  assert.equal(processMapping.match_type, 'MATCH', 'Process Order should match');

  // Ship Order should match
  const shipMapping = mappings.find((m) => m.architecture_node_id === 'L5-003');
  assert.ok(shipMapping, 'Should have mapping for L5-003');
  assert.equal(shipMapping.match_type, 'MATCH', 'Ship Order should match');
});

test('consistency detects extra diagram elements', () => {
  const arch = {
    schema_version: '1.0.0',
    nodes: [
      {
        node_id: 'L5-001',
        type: 'L5',
        name: 'Process Order',
        parent_id: null,
        roles: ['Sales'],
        inputs: [],
        outputs: [],
        rasci: 'R',
        source_refs: [],
        rules_refs: [],
      },
    ],
    relationships: [],
    metadata: {},
  };
  const diag = diagramFixtureWithoutApproveTask();

  const { findings } = reviewConsistency({
    architectureModel: arch,
    diagramModel: diag,
  });

  // Ship Order in the diagram has no architecture match
  const extraFindings = findings.filter((f) => f.rule_id === 'FA-CONS-008');
  assert.ok(extraFindings.length > 0, 'Should detect extra diagram elements');
});

test('consistency reviewConsistency throws without required inputs', () => {
  assert.throws(
    () => reviewConsistency({ architectureModel: null, diagramModel: {} }),
    /architectureModel is required/
  );
  assert.throws(
    () => reviewConsistency({ architectureModel: {}, diagramModel: null }),
    /diagramModel is required/
  );
});

test('consistency handles empty models gracefully', () => {
  const { mappings, findings } = reviewConsistency({
    architectureModel: { schema_version: '1.0.0', nodes: [], relationships: [], metadata: {} },
    diagramModel: { schema_version: '1.0.0', elements: [], flows: [], metadata: {} },
  });

  assert.equal(mappings.length, 0, 'Empty models should produce no mappings');
  assert.equal(findings.length, 0, 'Empty models should produce no findings');
});

// --- fixture helper tests ---

test('architectureFixture is valid', () => {
  const arch = architectureFixture();
  assert.equal(arch.schema_version, '1.0.0');
  assert.ok(arch.nodes.length > 0, 'Should have nodes');
  assert.ok(arch.nodes.some((n) => n.type === 'L4'), 'Should have L4 node');
  assert.ok(arch.nodes.some((n) => n.type === 'L5'), 'Should have L5 nodes');
});

test('diagramFixtureWithoutApproveTask is valid', () => {
  const diag = diagramFixtureWithoutApproveTask();
  assert.equal(diag.schema_version, '1.0.0');
  assert.ok(diag.elements.length > 0, 'Should have elements');
  assert.ok(diag.flows.length > 0, 'Should have flows');
  // Verify Approve Payment is NOT in the diagram
  const taskNames = diag.elements.filter((e) => e.type === 'TASK').map((e) => e.name);
  assert.ok(!taskNames.includes('Approve Payment'), 'Should not include Approve Payment');
});

test('findingSet creates valid finding for any rule ID', () => {
  const fs = findingSet('FA-BPMN-001');
  assert.equal(fs.schema_version, '1.0.0');
  assert.equal(fs.findings[0].rule_id, 'FA-BPMN-001');
  assert.ok(fs.findings[0].evidence.length > 0, 'Should have evidence');
});

test('validStagesWithBlocker contains a BLOCKER finding', () => {
  const stages = validStagesWithBlocker();
  assert.ok(stages.length > 0, 'Should have stages');
  const blocker = stages[0].findings.find((f) => f.severity === 'BLOCKER');
  assert.ok(blocker, 'Should have a BLOCKER finding');
});

// ── Cycle 4 BPMN 口径修正测试 ──

import { reviewBpmn } from '../scripts/review-bpmn.mjs';

test('None Start/End 不触发事件类型错误', () => {
  const diagramModel = {
    elements: [
      { element_id: 'start_none', type: 'EVENT', sub_type: 'startEvent', name: '开始', parent_id: null, lane_id: null },
      { element_id: 'task_1', type: 'TASK', name: '任务1', parent_id: null, lane_id: null },
      { element_id: 'end_none', type: 'EVENT', sub_type: 'endEvent', name: '结束', parent_id: null, lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', type: 'SEQUENCE_FLOW', source_ref: 'start_none', target_ref: 'task_1' },
      { flow_id: 'f2', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'end_none' },
    ],
  };
  const findings = reviewBpmn({ diagramModel });
  // None Start/End 不应触发 FA-BPMN-003
  const typeFindings = findings.filter(f => f.rule_id === 'FA-BPMN-003');
  assert.equal(typeFindings.length, 0, `None Start/End should not trigger type error, got ${JSON.stringify(typeFindings)}`);
});

// ── V2 BPMN 口径修正测试 ──

test('V2: XOR 全部分支有条件时不触发 FA-BPMN-005', () => {
  const diagramModel = {
    nodes: [
      { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: null },
      { node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '审批分支', lane_id: null },
      { node_id: 'Task-a', node_type: 'MAIN_TASK', name: '任务A', lane_id: null },
      { node_id: 'Task-b', node_type: 'MAIN_TASK', name: '任务B', lane_id: null },
      { node_id: 'End', node_type: 'END_EVENT', name: '结束', lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', source_ref: 'Start', target_ref: 'Gw-xor', condition: null },
      { flow_id: 'f2', source_ref: 'Gw-xor', target_ref: 'Task-a', condition: { label: '条件A', source_output: 'x', operator: 'EQUALS', value: 'A' } },
      { flow_id: 'f3', source_ref: 'Gw-xor', target_ref: 'Task-b', condition: { label: '条件B', source_output: 'x', operator: 'EQUALS', value: 'B' } },
      { flow_id: 'f4', source_ref: 'Task-a', target_ref: 'End', condition: null },
      { flow_id: 'f5', source_ref: 'Task-b', target_ref: 'End', condition: null },
    ],
    task_bindings: [],
    layout_version: '2.0.0',
  };
  const findings = reviewBpmn({ diagramModel });
  const f005 = findings.filter(f => f.rule_id === 'FA-BPMN-005');
  assert.equal(f005.length, 0, `XOR 全有条件不应触发 005: ${JSON.stringify(findings)}`);
});

test('V2: XOR 无条件分支触发 FA-BPMN-005', () => {
  const diagramModel = {
    nodes: [
      { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: null },
      { node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '分支', lane_id: null },
      { node_id: 'Task-a', node_type: 'MAIN_TASK', name: '任务A', lane_id: null },
      { node_id: 'End', node_type: 'END_EVENT', name: '结束', lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', source_ref: 'Start', target_ref: 'Gw-xor', condition: null },
      { flow_id: 'f2', source_ref: 'Gw-xor', target_ref: 'Task-a', condition: null },
      { flow_id: 'f3', source_ref: 'Gw-xor', target_ref: 'End', condition: null },
      { flow_id: 'f4', source_ref: 'Task-a', target_ref: 'End', condition: null },
    ],
    task_bindings: [],
    layout_version: '2.0.0',
  };
  const findings = reviewBpmn({ diagramModel });
  const f005 = findings.filter(f => f.rule_id === 'FA-BPMN-005');
  assert.ok(f005.length >= 1, `XOR 无条件应触发 005: ${JSON.stringify(findings)}`);
  assert.equal(f005[0].target_refs[0], 'Gw-xor');
});

test('V2: 无汇合需求的 XOR 不因拆分/汇合数量不等失败', () => {
  // XOR 拆分后不再汇合（两个分支各自到 End），不应有 004
  const diagramModel = {
    nodes: [
      { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: null },
      { node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '分支', lane_id: null },
      { node_id: 'End-a', node_type: 'END_EVENT', name: '结束A', lane_id: null },
      { node_id: 'End-b', node_type: 'END_EVENT', name: '结束B', lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', source_ref: 'Start', target_ref: 'Gw-xor', condition: null },
      { flow_id: 'f2', source_ref: 'Gw-xor', target_ref: 'End-a', condition: { label: '条件A', source_output: 'x', operator: 'EQUALS', value: 'A' } },
      { flow_id: 'f3', source_ref: 'Gw-xor', target_ref: 'End-b', condition: { label: '条件B', source_output: 'x', operator: 'EQUALS', value: 'B' } },
    ],
    task_bindings: [],
    layout_version: '2.0.0',
  };
  const findings = reviewBpmn({ diagramModel });
  const f004 = findings.filter(f => f.rule_id === 'FA-BPMN-004');
  assert.equal(f004.length, 0, `XOR 不需汇合不应触发 004: ${JSON.stringify(findings)}`);
});

test('V2: AND 拆分/汇合不成对仍产生 FA-BPMN-004', () => {
  // AND split 没有对应 join
  const diagramModel = {
    nodes: [
      { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: null },
      { node_id: 'Gw-and', node_type: 'GATEWAY_AND', name: '并行拆分', lane_id: null },
      { node_id: 'Task-a', node_type: 'MAIN_TASK', name: '任务A', lane_id: null },
      { node_id: 'Task-b', node_type: 'MAIN_TASK', name: '任务B', lane_id: null },
      { node_id: 'End', node_type: 'END_EVENT', name: '结束', lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', source_ref: 'Start', target_ref: 'Gw-and', condition: null },
      { flow_id: 'f2', source_ref: 'Gw-and', target_ref: 'Task-a', condition: null },
      { flow_id: 'f3', source_ref: 'Gw-and', target_ref: 'Task-b', condition: null },
      { flow_id: 'f4', source_ref: 'Task-a', target_ref: 'End', condition: null },
      { flow_id: 'f5', source_ref: 'Task-b', target_ref: 'End', condition: null },
    ],
    task_bindings: [],
    layout_version: '2.0.0',
  };
  const findings = reviewBpmn({ diagramModel });
  const f004 = findings.filter(f => f.rule_id === 'FA-BPMN-004');
  assert.ok(f004.length >= 1, `AND 不成对应触发 004: ${JSON.stringify(findings)}`);
  assert.equal(f004[0].target_refs[0], 'Gw-and');
});

test('V2: 孤立元素仍触发 FA-BPMN-007', () => {
  const diagramModel = {
    nodes: [
      { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: null },
      { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '任务1', lane_id: null },
      { node_id: 'Task-orphan', node_type: 'MAIN_TASK', name: '孤立任务', lane_id: null },
      { node_id: 'End', node_type: 'END_EVENT', name: '结束', lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', source_ref: 'Start', target_ref: 'Task-1', condition: null },
      { flow_id: 'f2', source_ref: 'Task-1', target_ref: 'End', condition: null },
    ],
    task_bindings: [],
    layout_version: '2.0.0',
  };
  const findings = reviewBpmn({ diagramModel });
  const f007 = findings.filter(f => f.rule_id === 'FA-BPMN-007');
  assert.ok(f007.length >= 1, `孤立元素应触发 007: ${JSON.stringify(findings)}`);
  assert.equal(f007[0].target_refs[0], 'Task-orphan');
});

test('V2: None Start/End 不触发事件类型错误（V2 格式）', () => {
  const diagramModel = {
    nodes: [
      { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: null },
      { node_id: 'Task-1', node_type: 'MAIN_TASK', name: '任务1', lane_id: null },
      { node_id: 'End', node_type: 'END_EVENT', name: '结束', lane_id: null },
    ],
    flows: [
      { flow_id: 'f1', source_ref: 'Start', target_ref: 'Task-1', condition: null },
      { flow_id: 'f2', source_ref: 'Task-1', target_ref: 'End', condition: null },
    ],
    task_bindings: [],
    layout_version: '2.0.0',
  };
  const findings = reviewBpmn({ diagramModel });
  // None Start/End 不应有任何 finding
  assert.equal(findings.length, 0, `None Start/End 不应触发任何规则: ${JSON.stringify(findings)}`);
});
