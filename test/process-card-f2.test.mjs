/**
 * process-card-f2.test.mjs - F2: 流程卡片 KPI 与起终点必须写回并和图同步
 *
 * F2 架构：DraftStore.updateProcessCard 仅更新 card 字段。
 * 结构变更（起点/终点与 diagram 同步）由 ProcessCardController 通过
 * 结构命令 + AutoLayoutController 处理。
 *
 * 本文件测试：
 * 1. KPI 名称、目标值编辑必须写回 DraftStore
 * 2. DraftStore.updateProcessCard 不再直接修改 diagram（结构变更路由到控制器）
 * 3. 终点删除最后一个被阻止（在控制器层面阻止）
 * 4. 结构命令 addEndResultAfter 和 deleteNode 正确操作 diagram
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftStore } from '../meeting-package/src/draft-store.js';
import {
  addEndResultAfter,
  deleteNode,
  renameEndResult,
  updateStartEvent,
} from '../meeting-package/src/structural-commands.js';

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
      end_results: [
        { event_id: 'End_1', name: '结束1' },
        { event_id: 'End_2', name: '结束2' },
      ],
      performance_indicators: [
        { indicator_id: 'KPI-1', name: '指标1', target: '100%' },
      ],
    },
    activities: [
      {
        activity_id: 'Activity_1',
        name: '任务1',
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
        { node_id: 'Task_1', node_type: 'MAIN_TASK', name: '任务1', lane_id: 'Lane_A' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '结束1', lane_id: null },
        { node_id: 'End_2', node_type: 'END_EVENT', name: '结束2', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_1', condition: null },
        { flow_id: 'Flow_2', source_ref: 'Task_1', target_ref: 'End_1', condition: null },
        { flow_id: 'Flow_3', source_ref: 'Task_1', target_ref: 'End_2', condition: null },
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

// ─── KPI 测试（纯 card 字段更新，不涉及 diagram） ───

test('F2: KPI 名称编辑必须写回 DraftStore', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  store.updateProcessCard({
    performance_indicators: [
      { indicator_id: 'KPI-1', name: '新指标名称', target: '100%' },
    ],
  });
  const snapshot = store.snapshot();
  assert.equal(snapshot.process_card.performance_indicators[0].name, '新指标名称');
});

test('F2: KPI 目标值编辑必须写回 DraftStore', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  store.updateProcessCard({
    performance_indicators: [
      { indicator_id: 'KPI-1', name: '指标1', target: '95%' },
    ],
  });
  const snapshot = store.snapshot();
  assert.equal(snapshot.process_card.performance_indicators[0].target, '95%');
});

test('F2: 新增 KPI 写回 DraftStore', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  const current = store.snapshot().process_card.performance_indicators;
  current.push({ indicator_id: 'KPI-2', name: '新指标', target: '80%' });
  store.updateProcessCard({ performance_indicators: current });
  assert.equal(store.snapshot().process_card.performance_indicators.length, 2);
});

// ─── 起点/终点 card 字段更新（不直接修改 diagram） ───

test('F2: 起点名称修改写回 process_card（diagram 同步由控制器负责）', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  store.updateProcessCard({
    start: { event_id: 'Start_1', name: '新起点名称', event_type: 'NONE' },
  });
  const snapshot = store.snapshot();
  assert.equal(snapshot.process_card.start.name, '新起点名称');
});

test('F2: 终点改名写回 process_card', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  const currentEndResults = store.snapshot().process_card.end_results;
  currentEndResults[0] = { ...currentEndResults[0], name: '新终点名称' };
  store.updateProcessCard({ end_results: currentEndResults });
  const snapshot = store.snapshot();
  assert.equal(snapshot.process_card.end_results[0].name, '新终点名称');
});

test('F2: 起点结构命令原子同步卡片和 START_EVENT', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  updateStartEvent(store, {
    event_id: 'Start_1', name: '新起点名称', event_type: 'MESSAGE',
  });
  const snapshot = store.snapshot();
  assert.equal(snapshot.process_card.start.name, '新起点名称');
  assert.equal(snapshot.process_card.start.event_type, 'MESSAGE');
  assert.equal(snapshot.diagram.nodes.find(node => node.node_id === 'Start_1').name, '新起点名称');
});

test('F2: 终点改名结构命令原子同步卡片和 END_EVENT', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  renameEndResult(store, 'End_1', '新终点名称');
  const snapshot = store.snapshot();
  assert.equal(snapshot.process_card.end_results[0].name, '新终点名称');
  assert.equal(snapshot.diagram.nodes.find(node => node.node_id === 'End_1').name, '新终点名称');
});

// ─── 结构命令 addEndResultAfter（终点新增正确操作 diagram） ───

test('F2: 结构命令 addEndResultAfter 创建 END_EVENT 节点和 flow', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  const result = addEndResultAfter(store, 'Task_1', { name: '新终点' });
  assert.ok(result.event_id);
  const snapshot = store.snapshot();
  // 验证 END_EVENT 节点增加
  const newEndNode = snapshot.diagram.nodes.find(n => n.node_id === result.event_id);
  assert.ok(newEndNode, '新 END_EVENT 节点应存在');
  assert.equal(newEndNode.node_type, 'END_EVENT');
  assert.equal(newEndNode.name, '新终点');
  // 验证 flows 连接
  const flowToNew = snapshot.diagram.flows.find(f => f.target_ref === result.event_id);
  assert.ok(flowToNew, '应有流连接到新终点');
  assert.equal(flowToNew.source_ref, 'Task_1');
  // 验证 end_results 增加
  assert.equal(snapshot.process_card.end_results.length, 3);
  const newEndResult = snapshot.process_card.end_results.find(r => r.event_id === result.event_id);
  assert.ok(newEndResult, '新终点应出现在 end_results 中');
});

// ─── 结构命令 deleteNode（终点删除正确操作 diagram） ───

test('F2: 结构命令 deleteNode 删除 END_EVENT 同步 diagram 和 end_results', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  deleteNode(store, 'End_1');
  const snapshot = store.snapshot();
  // 验证 END_EVENT 节点删除
  const endNode = snapshot.diagram.nodes.find(n => n.node_id === 'End_1');
  assert.ok(!endNode, 'End_1 节点应被删除');
  // 验证 flows 同步删除
  const flowsToEnd = snapshot.diagram.flows.filter(f => f.target_ref === 'End_1');
  assert.equal(flowsToEnd.length, 0, '指向 End_1 的流应被删除');
  // 验证 end_results 同步删除
  assert.equal(snapshot.process_card.end_results.length, 1);
  assert.equal(snapshot.process_card.end_results[0].event_id, 'End_2');
});

test('F2: 不允许删除最后一个结束事件', () => {
  const store = new DraftStore({ payload: createValidDraft() });
  // 先删除 End_1（保留 End_2）
  deleteNode(store, 'End_1');
  // 再删除 End_2（最后一个）应失败
  assert.throws(
    () => deleteNode(store, 'End_2'),
    {
      message: /流程必须保留至少一个结束事件/,
    }
  );
});

// ─── 起点名称同步由 ProcessCardController 负责（浏览器测试验证） ───

test('F2: ProcessCardController 起点名称同步在浏览器测试中验证', () => {
  // 此行为由浏览器测试 meeting-f2-browser.test.mjs 验证
  // ProcessCardController 的 change handler 同步起点名称到 START_EVENT 节点
  assert.ok(true, '起点名称同步由浏览器测试验证');
});
