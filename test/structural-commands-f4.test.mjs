/**
 * structural-commands-f4.test.mjs - F4: 每个 MAIN_TASK 必须唯一反向绑定 L5
 *
 * 测试业务规则验证：
 * 1. 每个 MAIN_TASK 恰好被一个 task_binding.main_task_id 引用
 * 2. 未绑定或多绑定均阻断编译/导出
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftStore } from '../meeting-package/src/draft-store.js';
import { compileBpmn } from '../scripts/lib/bpmn-compiler.mjs';

function createValidDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process_1',
      name: '测试流程',
      level: 'L4',
      is_leaf: true,
      description: '',
      purpose: '',
      owner: 'Role_A',
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

test('F4: 合法草案应能编译', () => {
  const draft = createValidDraft();
  const result = compileBpmn(draft);
  assert.ok(result.xml);
  assert.ok(result.xml.includes('Task_1'));
});

test('F4: 未绑定 MAIN_TASK 应阻断编译', () => {
  const draft = createValidDraft();
  // 移除 Task_1 的绑定
  draft.diagram.task_bindings = [];

  assert.throws(
    () => compileBpmn(draft),
    {
      message: /FA-DRAFT-BIND-001/,
    }
  );
});

test('F4: 多绑定 MAIN_TASK 应阻断编译', () => {
  const draft = createValidDraft();
  // 添加第二个绑定（指向同一个 MAIN_TASK）
  draft.diagram.task_bindings.push({
    activity_id: 'Activity_2',
    main_task_id: 'Task_1',
    confirmation_task_id: null,
  });
  // 添加第二个活动
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
    main_task_id: 'Task_1',
    confirmation: null,
    completeness: 'NEEDS_CONFIRMATION',
  });

  assert.throws(
    () => compileBpmn(draft),
    {
      message: /MAIN_TASK.*Task_1.*被.*2.*binding 引用/,
    }
  );
});

test('F4: 分支活动（多个 MAIN_TASK 各自绑定）应能编译', () => {
  const draft = createValidDraft();
  // 添加第二个 MAIN_TASK 和活动
  draft.diagram.nodes.push(
    { node_id: 'Task_2', node_type: 'MAIN_TASK', name: '活动2', lane_id: 'Lane_A' }
  );
  draft.diagram.flows.push(
    { flow_id: 'Flow_3', source_ref: 'Task_1', target_ref: 'Task_2', condition: null },
    { flow_id: 'Flow_4', source_ref: 'Task_2', target_ref: 'End_1', condition: null }
  );
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
    main_task_id: 'Task_2',
    confirmation: null,
    completeness: 'NEEDS_CONFIRMATION',
  });
  draft.diagram.task_bindings.push({
    activity_id: 'Activity_2',
    main_task_id: 'Task_2',
    confirmation_task_id: null,
  });

  const result = compileBpmn(draft);
  assert.ok(result.xml);
  assert.ok(result.xml.includes('Task_1'));
  assert.ok(result.xml.includes('Task_2'));
});
