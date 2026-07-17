/**
 * structural-commands-f3.test.mjs - F3: 顺序流结构门禁测试
 *
 * 测试 connectNodes 必须拒绝：
 * 1. 自环（sourceRef === targetRef）
 * 2. 从 END_EVENT 出发的连接
 * 3. 指向 START_EVENT 的连接
 *
 * 验证失败不修改合同
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftStore } from '../meeting-package/src/draft-store.js';
import { connectNodes } from '../meeting-package/src/structural-commands.js';

function createMinimalDraft() {
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
    activities: [],
    diagram: {
      lanes: [{ lane_id: 'Lane_A', name: '泳道A', role_id: 'Role_A' }],
      nodes: [
        { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_1', node_type: 'MAIN_TASK', name: '任务1', lane_id: 'Lane_A' },
        { node_id: 'Task_2', node_type: 'MAIN_TASK', name: '任务2', lane_id: 'Lane_A' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_1', condition: null },
        { flow_id: 'Flow_2', source_ref: 'Task_1', target_ref: 'Task_2', condition: null },
        { flow_id: 'Flow_3', source_ref: 'Task_2', target_ref: 'End_1', condition: null },
      ],
      task_bindings: [],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

test('F3: connectNodes 拒绝自环', () => {
  const store = new DraftStore({ payload: createMinimalDraft() });
  const snapshotBefore = store.snapshot();

  assert.throws(
    () => connectNodes(store, 'Task_1', 'Task_1', null),
    {
      message: /FA-DRAFT-FLOW-001/,
    }
  );

  // 验证合同未被修改
  const snapshotAfter = store.snapshot();
  assert.deepEqual(snapshotAfter, snapshotBefore);
});

test('F3: connectNodes 拒绝从 END_EVENT 出发的连接', () => {
  const store = new DraftStore({ payload: createMinimalDraft() });
  const snapshotBefore = store.snapshot();

  assert.throws(
    () => connectNodes(store, 'End_1', 'Task_1', null),
    {
      message: /FA-DRAFT-FLOW-001/,
    }
  );

  // 验证合同未被修改
  const snapshotAfter = store.snapshot();
  assert.deepEqual(snapshotAfter, snapshotBefore);
});

test('F3: connectNodes 拒绝指向 START_EVENT 的连接', () => {
  const store = new DraftStore({ payload: createMinimalDraft() });
  const snapshotBefore = store.snapshot();

  assert.throws(
    () => connectNodes(store, 'Task_1', 'Start_1', null),
    {
      message: /FA-DRAFT-FLOW-001/,
    }
  );

  // 验证合同未被修改
  const snapshotAfter = store.snapshot();
  assert.deepEqual(snapshotAfter, snapshotBefore);
});

test('F3: connectNodes 允许合法连接', () => {
  const store = new DraftStore({ payload: createMinimalDraft() });
  const snapshotBefore = store.snapshot();

  // 应该成功添加从 Task_1 到 End_1 的连接
  const result = connectNodes(store, 'Task_1', 'End_1', null);
  assert.ok(result.flow_id);
  assert.ok(result.flow_id.startsWith('Flow_'));

  // 验证合同被正确修改
  const snapshotAfter = store.snapshot();
  assert.equal(snapshotAfter.diagram.flows.length, snapshotBefore.diagram.flows.length + 1);
});
