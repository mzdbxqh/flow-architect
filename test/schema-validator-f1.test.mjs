/**
 * schema-validator-f1.test.mjs - F1: 完整 V2 Schema 门禁测试
 *
 * 必须复用真实 process-draft.schema.json 及其引用 Schema，通过 Ajv 校验完整草稿。
 * 测试必须覆盖手写子集未覆盖的 Schema 错误：
 * - 缺少活动必填字段
 * - 非法 enum 值
 * - additionalProperties 违规
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateV2Draft } from '../meeting-package/src/schema-validator.js';
import { validateDraftBusinessRules } from '../scripts/lib/process-draft-v2-rules.mjs';

function validDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process_1',
      name: '采购审批流程',
      level: 'L4',
      is_leaf: true,
      description: '测试描述',
      purpose: '测试目的',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: ['采购申请'],
      outputs: ['审批结果'],
      start: { event_id: 'Start_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '结束' }],
      performance_indicators: [{ indicator_id: 'KPI-1', name: '审核及时率', target: '95%', unit: '%' }],
    },
    activities: [
      {
        activity_id: 'Activity_Review',
        name: '审核采购申请',
        description: '对采购需求进行审核',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-applicant', responsibility: 'R' }],
        sla: null,
        tools: ['ERP'],
        inputs: ['采购申请'],
        process_summary: '审核采购申请',
        outputs: ['审核结果'],
        completion_criteria: ['申请已审核'],
        references: [],
        main_task_id: 'Task_Review',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane_Applicant', name: '申请人', role_id: 'Role-applicant' },
      ],
      nodes: [
        { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_Review', node_type: 'MAIN_TASK', name: '审核采购申请', lane_id: 'Lane_Applicant' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_Review', condition: null },
        { flow_id: 'Flow_2', source_ref: 'Task_Review', target_ref: 'End_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_Review', main_task_id: 'Task_Review', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

// ─── Schema 校验：合法草稿通过 ───

test('F1: 合法 V2 草稿通过 Schema 校验', () => {
  const draft = validDraft();
  const result = validateV2Draft(draft);
  assert.equal(result.valid, true, `合法草稿被拒绝: ${JSON.stringify(result.errors)}`);
  assert.equal(result.errors.length, 0);
});

// ─── Schema 校验：空活动名称（原有手写子集覆盖） ───

test('F1: 空活动名称被 Schema 校验拒绝', () => {
  const draft = validDraft();
  draft.activities[0].name = '';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0, '应有至少一个错误');
  assert.ok(
    result.errors.some(e => e.code === 'FA-DRAFT-SCHEMA-001'),
    '错误码应为 FA-DRAFT-SCHEMA-001',
  );
});

// ─── Schema 校验：缺少活动必填字段（超出手写子集） ───

test('F1: 缺少活动必填字段 activity_type 被拒绝', () => {
  const draft = validDraft();
  delete draft.activities[0].activity_type;
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('activity_type')),
    `应报 activity_type 缺失: ${JSON.stringify(result.errors)}`,
  );
});

test('F1: 缺少活动必填字段 main_task_id 被拒绝', () => {
  const draft = validDraft();
  delete draft.activities[0].main_task_id;
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('main_task_id')),
    `应报 main_task_id 缺失: ${JSON.stringify(result.errors)}`,
  );
});

// ─── Schema 校验：非法 enum 值（超出手写子集） ───

test('F1: 非法 activity_type enum 被拒绝', () => {
  const draft = validDraft();
  draft.activities[0].activity_type = 'INVALID_TYPE';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('activity_type') || e.message.includes('INVALID_TYPE')),
    `应报 activity_type enum 非法: ${JSON.stringify(result.errors)}`,
  );
});

test('F1: 非法 node_type enum 被拒绝', () => {
  const draft = validDraft();
  draft.diagram.nodes[1].node_type = 'SERVICE_TASK';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('SERVICE_TASK') || e.message.includes('node_type')),
    `应报 node_type enum 非法: ${JSON.stringify(result.errors)}`,
  );
});

test('F1: 非法 schema_version 被拒绝', () => {
  const draft = validDraft();
  draft.schema_version = '1.0.0';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('2.0.0')),
    `应报 schema_version 不匹配: ${JSON.stringify(result.errors)}`,
  );
});

// ─── Schema 校验：additionalProperties 违规（超出手写子集） ───

test('F1: 活动包含 additionalProperties 被拒绝', () => {
  const draft = validDraft();
  draft.activities[0].unknown_field = 'should not exist';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('additional') || e.message.includes('unknown_field')),
    `应报 additionalProperties 违规: ${JSON.stringify(result.errors)}`,
  );
});

test('F1: 草稿顶层包含 additionalProperties 被拒绝', () => {
  const draft = validDraft();
  draft.extra_field = 'not allowed';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
});

// ─── Schema 校验：缺少顶层必填字段 ───

test('F1: 缺少 diagram 字段被拒绝', () => {
  const draft = validDraft();
  delete draft.diagram;
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(e => e.message.includes('diagram')),
    `应报 diagram 缺失: ${JSON.stringify(result.errors)}`,
  );
});

// ─── Schema 校验：非法 responsibility enum ───

test('F1: 非法 responsibility enum 被拒绝', () => {
  const draft = validDraft();
  draft.activities[0].role_assignments[0].responsibility = 'X';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
});

// ─── Schema 校验：非法 completeness enum ───

test('F1: 非法 completeness enum 被拒绝', () => {
  const draft = validDraft();
  draft.activities[0].completeness = 'UNKNOWN';
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
});

// ─── Schema 校验：非法 question status enum ───

test('F1: 非法 question status enum 被拒绝', () => {
  const draft = validDraft();
  draft.questions = [{
    question_id: 'Q-001',
    text: '测试问题',
    target_paths: ['Task_Review'],
    status: 'INVALID_STATUS',
    answer: '',
  }];
  const result = validateV2Draft(draft);
  assert.equal(result.valid, false);
});

// ─── Business Rules 校验 ───

test('F1: 合法草稿通过业务规则校验', () => {
  const draft = validDraft();
  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, true, `合法草稿被业务规则拒绝: ${JSON.stringify(result.errors)}`);
});
