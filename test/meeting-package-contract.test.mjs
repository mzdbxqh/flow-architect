import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixture } from './helpers/fixture.mjs';
import {
  computeContentHash,
  createMeetingPayload,
  decodeMeetingPayload,
  encodeMeetingPayload,
  normalizeKeys,
  validateMetadata,
  validatePayload,
  validateQuestions,
} from '../scripts/lib/meeting-package-contract.mjs';

const bpmnXml = fs.readFileSync(
  fixture('meeting-package/single-process.bpmn'), 'utf8');

function v2Draft(overrides = {}) {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process_1', name: '采购审批流程', level: 'L4', is_leaf: true,
      description: '完成采购申请的审查与决策', purpose: '形成可执行的采购决定',
      owner: 'Role-process-owner', parent_process_name: '采购管理',
      inputs: ['采购申请'], outputs: ['审批结果'],
      start: { event_id: 'StartEvent_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'EndEvent_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_Review', name: '审核采购申请',
        description: '对采购需求和材料完整性进行业务审核',
        activity_type: 'STANDARD', responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-reviewer', responsibility: 'R' }],
        sla: null, tools: ['ERP'], inputs: ['采购申请'],
        process_summary: '审核采购申请内容', outputs: ['审核结果'],
        completion_criteria: ['申请已审核'], references: [],
        main_task_id: 'Task_Review', confirmation: null, completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane_Applicant', name: '申请人', role_id: 'Role-applicant' },
        { lane_id: 'Lane_Manager', name: '经理', role_id: 'Role-manager' },
      ],
      nodes: [
        { node_id: 'StartEvent_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_Review', node_type: 'MAIN_TASK', name: '审核采购申请', lane_id: 'Lane_Applicant' },
        { node_id: 'EndEvent_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_Start_Review', source_ref: 'StartEvent_1', target_ref: 'Task_Review', condition: null },
        { flow_id: 'Flow_Review_End', source_ref: 'Task_Review', target_ref: 'EndEvent_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_Review', main_task_id: 'Task_Review', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [
      { question_id: 'Q-001', text: '采购申请是否需要经理复核？', target_paths: ['Task_Review'], status: 'OPEN', answer: '' },
    ],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
    ...overrides,
  };
}

function baseMetadata() {
  return {
    package_id: 'procurement-approval',
    process_id: 'Process_1',
    title: '采购审批流程',
    revision: 'r01',
    based_on_revision: null,
  };
}

// ===== V2 基础验证 =====

test('V2 createMeetingPayload returns complete payload with all 8 fields', () => {
  const payload = createMeetingPayload({ draft: v2Draft(), bpmnXml, metadata: baseMetadata() });
  assert.equal(payload.metadata.schema_version, '2.0.0');
  assert.equal(payload.metadata.runtime_version, '2.0.0');
  assert.ok(payload.metadata.content_hash.startsWith('sha256:'));
  assert.ok(payload.process_card);
  assert.ok(Array.isArray(payload.activities));
  assert.ok(payload.diagram);
  assert.ok(payload.bpmn_xml);
  assert.ok(Array.isArray(payload.questions));
  assert.ok(payload.provenance !== undefined);
  assert.ok(payload.source_summary);
});

test('V2 payload encoding is deterministic and reversible', () => {
  const payload = createMeetingPayload({ draft: v2Draft(), bpmnXml, metadata: baseMetadata() });
  assert.equal(encodeMeetingPayload(payload), encodeMeetingPayload(payload));
  assert.deepEqual(decodeMeetingPayload(encodeMeetingPayload(payload)), payload);
});

test('V2 payload validates against payload schema', () => {
  const payload = createMeetingPayload({ draft: v2Draft(), bpmnXml, metadata: baseMetadata() });
  assert.equal(validatePayload(payload).valid, true);
});

test('missing required draft fields fail', () => {
  const draft = v2Draft();
  delete draft.process_card;
  assert.throws(
    () => createMeetingPayload({ draft, bpmnXml, metadata: baseMetadata() }),
    /schema|payload|process_card/i,
  );
});

test('extra top-level fields in payload fail schema validation', () => {
  const payload = createMeetingPayload({ draft: v2Draft(), bpmnXml, metadata: baseMetadata() });
  payload.extra_field = 'should fail';
  assert.equal(validatePayload(payload).valid, false);
});

test('V1-style payload (no process_card etc.) fails schema validation', () => {
  const v1Payload = {
    metadata: { ...baseMetadata(), schema_version: '2.0.0', runtime_version: '2.0.0', content_hash: 'sha256:' + '0'.repeat(64) },
    bpmn_xml: bpmnXml,
    questions: [{ question_id: 'Q-001', text: 'test', target_paths: ['Task_Review'], status: 'OPEN', answer: '' }],
  };
  assert.equal(validatePayload(v1Payload).valid, false);
});

test('old signature {bpmnXml, questions, metadata} is rejected', () => {
  assert.throws(
    () => createMeetingPayload({ bpmnXml, questions: [], metadata: baseMetadata() }),
    /schema|draft|undefined|process_card/i,
  );
});

// ===== 七类业务字段分别改变 hash =====

test('changing process_card changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const modified = v2Draft({ process_card: { ...draft.process_card, name: '修改名称' } });
  const h2 = computeContentHash(
    modified.process_card, modified.activities, modified.diagram, bpmnXml,
    modified.questions, modified.provenance, modified.source_summary,
  );
  assert.notEqual(h1, h2);
});

test('changing activities changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const modified = v2Draft({ activities: [{ ...draft.activities[0], name: '新活动名' }] });
  const h2 = computeContentHash(
    modified.process_card, modified.activities, modified.diagram, bpmnXml,
    modified.questions, modified.provenance, modified.source_summary,
  );
  assert.notEqual(h1, h2);
});

test('changing diagram changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const modified = v2Draft({
    diagram: { ...draft.diagram, lanes: [...draft.diagram.lanes, { lane_id: 'Lane_New', name: '新泳道', role_id: 'Role-new' }] },
  });
  const h2 = computeContentHash(
    modified.process_card, modified.activities, modified.diagram, bpmnXml,
    modified.questions, modified.provenance, modified.source_summary,
  );
  assert.notEqual(h1, h2);
});

test('changing bpmn_xml changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const h2 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml + '<!-- modified -->',
    draft.questions, draft.provenance, draft.source_summary,
  );
  assert.notEqual(h1, h2);
});

test('changing questions changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const modified = v2Draft({
    questions: [{ ...draft.questions[0], text: '修改问题文本' }],
  });
  const h2 = computeContentHash(
    modified.process_card, modified.activities, modified.diagram, bpmnXml,
    modified.questions, modified.provenance, modified.source_summary,
  );
  assert.notEqual(h1, h2);
});

test('changing provenance changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const modified = v2Draft({
    provenance: { '/process_card/name': { certainty: 'EXPLICIT', evidence_refs: ['B-001'] } },
  });
  const h2 = computeContentHash(
    modified.process_card, modified.activities, modified.diagram, bpmnXml,
    modified.questions, modified.provenance, modified.source_summary,
  );
  assert.notEqual(h1, h2);
});

test('changing source_summary changes hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  const modified = v2Draft({
    source_summary: { total_blocks: 5, formats: ['pdf'], evidence_refs: ['B-001'] },
  });
  const h2 = computeContentHash(
    modified.process_card, modified.activities, modified.diagram, bpmnXml,
    modified.questions, modified.provenance, modified.source_summary,
  );
  assert.notEqual(h1, h2);
});

// ===== 键序不影响 hash =====

test('key order normalization: same data with different key order produces same hash', () => {
  const draft = v2Draft();
  const h1 = computeContentHash(
    draft.process_card, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );

  // Reorder process_card keys
  const reorderedCard = {};
  const cardKeys = Object.keys(draft.process_card).reverse();
  for (const k of cardKeys) reorderedCard[k] = draft.process_card[k];

  const h2 = computeContentHash(
    reorderedCard, draft.activities, draft.diagram, bpmnXml,
    draft.questions, draft.provenance, draft.source_summary,
  );
  assert.equal(h1, h2);
});

test('normalizeKeys sorts object keys recursively but preserves array order', () => {
  const obj = { b: 2, a: { d: 4, c: 3 }, arr: [{ z: 1, a: 2 }] };
  const normalized = normalizeKeys(obj);
  assert.deepEqual(Object.keys(normalized), ['a', 'arr', 'b']);
  assert.deepEqual(Object.keys(normalized.a), ['c', 'd']);
  assert.deepEqual(Object.keys(normalized.arr[0]), ['a', 'z']);
});
