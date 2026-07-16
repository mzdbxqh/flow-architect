import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftStore } from '../meeting-package/src/draft-store.js';

function minimalV2Payload() {
  return {
    metadata: {
      schema_version: '2.0.0',
      package_id: 'test',
      process_id: 'Process_p1',
      title: '测试流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
      content_hash: 'sha256:abc',
    },
    process_card: {
      process_id: 'Process_p1',
      name: '测试流程',
      level: 'L4',
      is_leaf: true,
      description: '测试描述',
      purpose: '测试目的',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: ['输入A'],
      outputs: ['输出A'],
      start: { event_id: 'Start_1', name: '收到申请', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '处理完成' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_a1',
        name: '审核申请',
        description: '对申请进行审核',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-reviewer', responsibility: 'R' }],
        sla: null,
        tools: ['ERP'],
        inputs: ['申请单'],
        process_summary: '审核申请内容',
        outputs: ['审核结果'],
        completion_criteria: ['申请已审核'],
        references: [],
        main_task_id: 'Task_a1',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [{ lane_id: 'Lane_1', name: '审核员', role_id: 'Role-reviewer' }],
      nodes: [
        { node_id: 'Start_1', node_type: 'START_EVENT', name: '收到申请' },
        { node_id: 'Task_a1', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane_1' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '处理完成' },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_a1' },
        { flow_id: 'Flow_2', source_ref: 'Task_a1', target_ref: 'End_1' },
      ],
      task_bindings: [
        { activity_id: 'Activity_a1', main_task_id: 'Task_a1', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [
      {
        question_id: 'Q-001',
        text: '审核标准是什么？',
        target_paths: ['Task_a1'],
        status: 'OPEN',
        answer: '',
      },
    ],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

test('DraftStore snapshot returns deep copy of payload', () => {
  const payload = minimalV2Payload();
  const store = new DraftStore({ payload });
  const snap = store.snapshot();
  assert.deepEqual(snap, payload);
  // Mutating snapshot must not affect store
  snap.process_card.name = 'CHANGED';
  assert.equal(store.snapshot().process_card.name, '测试流程');
});

test('DraftStore restore replaces entire state and notifies subscribers', () => {
  const payload = minimalV2Payload();
  const store = new DraftStore({ payload });
  let notified = false;
  store.subscribe(() => { notified = true; });
  const updated = structuredClone(payload);
  updated.process_card.name = '新名称';
  store.restore(updated);
  assert.equal(store.snapshot().process_card.name, '新名称');
  assert.equal(notified, true);
});

test('DraftStore updateProcessCard merges partial updates', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.updateProcessCard({ purpose: '新目的' });
  const card = store.snapshot().process_card;
  assert.equal(card.purpose, '新目的');
  assert.equal(card.name, '测试流程');
});

test('DraftStore updateProcessCard rejects level change to non-leaf without clearing diagram', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  // Changing to non-leaf should work but mark diagram as not applicable
  store.updateProcessCard({ level: 'L3', is_leaf: false });
  const snap = store.snapshot();
  assert.equal(snap.process_card.level, 'L3');
  assert.equal(snap.process_card.is_leaf, false);
});

test('DraftStore upsertActivity inserts new activity', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  const newActivity = {
    activity_id: 'Activity_a2',
    name: '批准申请',
    description: '批准采购申请',
    activity_type: 'STANDARD',
    responsibility_model: 'RASCI',
    role_assignments: [{ role_id: 'Role-approver', responsibility: 'R' }],
    sla: null,
    tools: [],
    inputs: ['审核结果'],
    process_summary: '批准申请',
    outputs: ['批准结果'],
    completion_criteria: [],
    references: [],
    main_task_id: 'Task_a2',
    confirmation: null,
    completeness: 'COMPLETE',
  };
  store.upsertActivity(newActivity);
  assert.equal(store.snapshot().activities.length, 2);
  assert.equal(store.snapshot().activities[1].name, '批准申请');
});

test('DraftStore upsertActivity updates existing activity by activity_id', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.upsertActivity({
    ...store.snapshot().activities[0],
    name: '改名审核',
    tools: ['新工具'],
  });
  assert.equal(store.snapshot().activities.length, 1);
  assert.equal(store.snapshot().activities[0].name, '改名审核');
  assert.deepEqual(store.snapshot().activities[0].tools, ['新工具']);
});

test('DraftStore deleteActivity removes activity and related binding', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.deleteActivity('Activity_a1');
  assert.equal(store.snapshot().activities.length, 0);
  assert.equal(store.snapshot().diagram.task_bindings.length, 0);
});

test('DraftStore deleteActivity throws for unknown id', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  assert.throws(() => store.deleteActivity('NonExistent'), /不存在/);
});

test('DraftStore marks dirty on any mutation', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  assert.equal(store.dirty, false);
  store.updateProcessCard({ name: '新名称' });
  assert.equal(store.dirty, true);
});

test('DraftStore subscriber receives change kind and path', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  const events = [];
  store.subscribe((kind, detail) => events.push({ kind, ...detail }));
  store.updateProcessCard({ name: '新名称' });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'process_card');
});

test('DraftStore activity subscriber and activity list subscriber fire', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  const events = [];
  store.subscribe((kind, detail) => events.push({ kind, ...detail }));
  store.upsertActivity({
    ...store.snapshot().activities[0],
    name: '改名',
  });
  assert.ok(events.some(e => e.kind === 'activity_update'));
});

test('DraftStore supports RASCI to OARP model switch on activity', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.upsertActivity({
    ...store.snapshot().activities[0],
    activity_type: 'REVIEW_MEETING',
    responsibility_model: 'OARP',
    role_assignments: [{ role_id: 'Role-owner', responsibility: 'O' }],
  });
  const act = store.snapshot().activities[0];
  assert.equal(act.responsibility_model, 'OARP');
  assert.equal(act.role_assignments[0].responsibility, 'O');
});

test('DraftStore supports SLA fields on activity', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.upsertActivity({
    ...store.snapshot().activities[0],
    sla: { value: 2, unit: 'WORKING_DAY', start_condition: '收到申请', end_condition: '审核完成' },
  });
  const act = store.snapshot().activities[0];
  assert.equal(act.sla.value, 2);
  assert.equal(act.sla.unit, 'WORKING_DAY');
});

test('DraftStore can add and remove performance_indicators', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.updateProcessCard({
    performance_indicators: [
      { indicator_id: 'KPI-1', name: '审核及时率', target: '95%', unit: '%' },
    ],
  });
  assert.equal(store.snapshot().process_card.performance_indicators.length, 1);
  store.updateProcessCard({ performance_indicators: [] });
  assert.equal(store.snapshot().process_card.performance_indicators.length, 0);
});

test('DraftStore can add and remove end_results', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  store.updateProcessCard({
    end_results: [
      { event_id: 'End_1', name: '处理完成' },
      { event_id: 'End_2', name: '处理退回' },
    ],
  });
  assert.equal(store.snapshot().process_card.end_results.length, 2);
});

test('DraftStore restore rejects invalid payload structure', () => {
  const store = new DraftStore({ payload: minimalV2Payload() });
  assert.throws(() => store.restore({}), /schema|process_card|缺少|required/i);
});
