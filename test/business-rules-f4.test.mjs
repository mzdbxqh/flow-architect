/**
 * business-rules-f4.test.mjs - F4: MAIN_TASK 唯一反向绑定校验
 *
 * 业务规则必须验证 diagram 中每个 MAIN_TASK 恰好被一个 task_binding.main_task_id 引用，
 * 且该 binding 与活动三方一致；未绑定或多绑定均阻断编译/导出。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraftBusinessRules } from '../scripts/lib/process-draft-v2-rules.mjs';

function validDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process_1',
      name: '测试流程',
      level: 'L4',
      is_leaf: true,
      description: '',
      purpose: '',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_1',
        name: '活动1',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role_A', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: [],
        process_summary: '',
        outputs: [],
        completion_criteria: [],
        references: [],
        main_task_id: 'Task_1',
        confirmation: null,
        completeness: 'NEEDS_CONFIRMATION',
      },
    ],
    diagram: {
      lanes: [{ lane_id: 'Lane_A', name: '泳道A', role_id: 'Role_A' }],
      nodes: [
        { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_1', node_type: 'MAIN_TASK', name: '活动1', lane_id: 'Lane_A' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_1', condition: null },
        { flow_id: 'Flow_2', source_ref: 'Task_1', target_ref: 'End_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_1', main_task_id: 'Task_1', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

// ─── 合法草稿通过 ───

test('F4: 合法草稿（每个 MAIN_TASK 有唯一 binding）通过校验', () => {
  const draft = validDraft();
  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

// ─── 未绑定 MAIN_TASK ───

test('F4: 未绑定的 MAIN_TASK 被拒绝（FA-DRAFT-BINDING-001）', () => {
  const draft = validDraft();
  // 添加一个没有 binding 的 MAIN_TASK
  draft.diagram.nodes.push({
    node_id: 'Task_Unbound',
    node_type: 'MAIN_TASK',
    name: '未绑定任务',
    lane_id: 'Lane_A',
  });
  draft.diagram.flows.push({
    flow_id: 'Flow_Unbound',
    source_ref: 'Task_1',
    target_ref: 'Task_Unbound',
    condition: null,
  });
  // 不添加对应的 binding

  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, false);
  const unboundError = result.errors.find(e => e.code === 'FA-DRAFT-BINDING-001');
  assert.ok(unboundError, `应报告 FA-DRAFT-BINDING-001 错误: ${JSON.stringify(result.errors)}`);
  assert.ok(unboundError.message.includes('Task_Unbound'), '错误应提及未绑定的节点 ID');
});

// ─── 多绑定 MAIN_TASK ───

test('F4: 多绑定的 MAIN_TASK 被拒绝（FA-DRAFT-BINDING-002）', () => {
  const draft = validDraft();
  // 添加第二个 activity 绑定到同一个 Task_1
  draft.activities.push({
    activity_id: 'Activity_2',
    name: '活动2',
    description: '',
    activity_type: 'STANDARD',
    responsibility_model: 'RASCI',
    role_assignments: [{ role_id: 'Role_A', responsibility: 'R' }],
    sla: null,
    tools: [],
    inputs: [],
    process_summary: '',
    outputs: [],
    completion_criteria: [],
    references: [],
    main_task_id: 'Task_1', // 与 Activity_1 相同的 main_task_id
    confirmation: null,
    completeness: 'NEEDS_CONFIRMATION',
  });
  draft.diagram.task_bindings.push({
    activity_id: 'Activity_2',
    main_task_id: 'Task_1', // 多绑定
    confirmation_task_id: null,
  });

  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, false);
  const multiBindError = result.errors.find(e => e.code === 'FA-DRAFT-BINDING-002');
  assert.ok(multiBindError, `应报告 FA-DRAFT-BINDING-002 错误: ${JSON.stringify(result.errors)}`);
  assert.ok(multiBindError.message.includes('2'), '错误应报告绑定数量');
});

// ─── binding 引用不存在的 activity ───

test('F4: binding 引用不存在的 activity 被拒绝', () => {
  const draft = validDraft();
  draft.diagram.task_bindings.push({
    activity_id: 'NonExistent_Activity',
    main_task_id: 'Task_1',
    confirmation_task_id: null,
  });
  // Task_1 被多绑定，也需要报告 002
  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, false);
  const refError = result.errors.find(e => e.code === 'FA-DRAFT-BIND-002');
  assert.ok(refError, `应报告绑定一致性错误: ${JSON.stringify(result.errors)}`);
});

// ─── binding.main_task_id 与 activity.main_task_id 不一致 ───

test('F4: binding 与 activity 的 main_task_id 不一致被拒绝', () => {
  const draft = validDraft();
  // binding 指向 Task_1，但 activity.main_task_id 指向 Task_2
  draft.activities[0].main_task_id = 'Task_Wrong';
  // 不修改 binding

  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, false);
  const mismatchError = result.errors.find(e => e.code === 'FA-DRAFT-BIND-002');
  assert.ok(mismatchError, `应报告绑定一致性错误: ${JSON.stringify(result.errors)}`);
  assert.ok(mismatchError.message.includes('Task_Wrong'), '错误应提及不一致的 ID');
});

// ─── binding 指向不存在的 MAIN_TASK ───

test('F4: binding 指向不存在的 MAIN_TASK 被拒绝', () => {
  const draft = validDraft();
  // binding 指向不存在的节点
  draft.diagram.task_bindings[0].main_task_id = 'Task_Ghost';
  draft.activities[0].main_task_id = 'Task_Ghost';
  // 不在 nodes 中添加该节点

  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, false);
  const ghostError = result.errors.find(e => e.code === 'FA-DRAFT-BIND-002');
  assert.ok(ghostError, `应报告绑定一致性错误: ${JSON.stringify(result.errors)}`);
});

// ─── 合法分支活动（多个 MAIN_TASK，各自唯一绑定） ───

test('F4: 合法分支活动（网关 + 两个分支 Task）通过校验', () => {
  const draft = validDraft();
  // 添加网关
  draft.diagram.nodes.push(
    { node_id: 'Gateway_1', node_type: 'GATEWAY_XOR', name: '判断', lane_id: 'Lane_A' },
    { node_id: 'Task_Yes', node_type: 'MAIN_TASK', name: '是分支', lane_id: 'Lane_A' },
    { node_id: 'Task_No', node_type: 'MAIN_TASK', name: '否分支', lane_id: 'Lane_A' },
  );
  // 添加活动
  draft.activities.push(
    {
      activity_id: 'Activity_Yes',
      name: '是分支活动',
      description: '',
      activity_type: 'STANDARD',
      responsibility_model: 'RASCI',
      role_assignments: [{ role_id: 'Role_A', responsibility: 'R' }],
      sla: null,
      tools: [],
      inputs: [],
      process_summary: '',
      outputs: [],
      completion_criteria: [],
      references: [],
      main_task_id: 'Task_Yes',
      confirmation: null,
      completeness: 'NEEDS_CONFIRMATION',
    },
    {
      activity_id: 'Activity_No',
      name: '否分支活动',
      description: '',
      activity_type: 'STANDARD',
      responsibility_model: 'RASCI',
      role_assignments: [{ role_id: 'Role_A', responsibility: 'R' }],
      sla: null,
      tools: [],
      inputs: [],
      process_summary: '',
      outputs: [],
      completion_criteria: [],
      references: [],
      main_task_id: 'Task_No',
      confirmation: null,
      completeness: 'NEEDS_CONFIRMATION',
    },
  );
  // 添加 bindings
  draft.diagram.task_bindings.push(
    { activity_id: 'Activity_Yes', main_task_id: 'Task_Yes', confirmation_task_id: null },
    { activity_id: 'Activity_No', main_task_id: 'Task_No', confirmation_task_id: null },
  );
  // 重连流：Task_1 -> Gateway -> Yes/No -> End
  draft.diagram.flows = [
    { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_1', condition: null },
    { flow_id: 'Flow_2', source_ref: 'Task_1', target_ref: 'Gateway_1', condition: null },
    { flow_id: 'Flow_3', source_ref: 'Gateway_1', target_ref: 'Task_Yes', condition: { label: '是', source_output: '判断', operator: 'IS_TRUE' } },
    { flow_id: 'Flow_4', source_ref: 'Gateway_1', target_ref: 'Task_No', condition: { label: '否', source_output: '判断', operator: 'IS_FALSE' } },
    { flow_id: 'Flow_5', source_ref: 'Task_Yes', target_ref: 'End_1', condition: null },
    { flow_id: 'Flow_6', source_ref: 'Task_No', target_ref: 'End_1', condition: null },
  ];

  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, true, `合法分支被拒绝: ${JSON.stringify(result.errors)}`);
});

// ─── 多个错误同时报告 ───

test('F4: 多个错误同时报告', () => {
  const draft = validDraft();
  // 未绑定的 MAIN_TASK
  draft.diagram.nodes.push({
    node_id: 'Task_Unbound',
    node_type: 'MAIN_TASK',
    name: '未绑定',
    lane_id: 'Lane_A',
  });
  // 多绑定
  draft.activities.push({
    activity_id: 'Activity_Dup',
    name: '重复活动',
    description: '',
    activity_type: 'STANDARD',
    responsibility_model: 'RASCI',
    role_assignments: [{ role_id: 'Role_A', responsibility: 'R' }],
    sla: null,
    tools: [],
    inputs: [],
    process_summary: '',
    outputs: [],
    completion_criteria: [],
    references: [],
    main_task_id: 'Task_1',
    confirmation: null,
    completeness: 'NEEDS_CONFIRMATION',
  });
  draft.diagram.task_bindings.push({
    activity_id: 'Activity_Dup',
    main_task_id: 'Task_1',
    confirmation_task_id: null,
  });

  const result = validateDraftBusinessRules(draft);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2, `应报告多个错误: ${JSON.stringify(result.errors)}`);
});
