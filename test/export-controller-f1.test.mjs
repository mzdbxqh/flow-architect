/**
 * export-controller-f1.test.mjs - F1: 导出必须执行完整 V2 Schema 门禁
 *
 * 测试 ExportController.currentPayload() 必须执行 V2 Schema 校验：
 * 1. 活动名称等 Schema 必填字段被清空时，导出应阻断
 * 2. 浏览器端校验必须来自可打包的确定性合同
 * 3. 合法草稿仍能导出
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftStore } from '../meeting-package/src/draft-store.js';
import { ExportController } from '../meeting-package/src/export-controller.js';
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

function createMockPayload(draft) {
  return {
    metadata: {
      schema_version: '2.0.0',
      package_id: 'test-package',
      process_id: 'Process_1',
      title: '测试流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
      content_hash: 'sha256:placeholder',
    },
    bpmn_xml: '<bpmn:definitions>...</bpmn:definitions>',
    ...draft,
  };
}

test('F1: 合法草案应能导出', async () => {
  const draft = createValidDraft();
  const store = new DraftStore({ payload: draft });
  const payload = createMockPayload(draft);

  const controller = new ExportController({
    modeler: null,
    payload,
    store,
    compileBpmn,
  });

  const result = await controller.currentPayload();
  assert.ok(result);
  assert.ok(result.metadata.revision);
  assert.ok(result.bpmn_xml);
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].name, '活动1');
});

test('F1: 空活动名称应阻断导出', async () => {
  const draft = createValidDraft();
  draft.activities[0].name = ''; // 清空活动名称
  const store = new DraftStore({ payload: draft });
  const payload = createMockPayload(draft);

  const controller = new ExportController({
    modeler: null,
    payload,
    store,
    compileBpmn,
  });

  await assert.rejects(
    () => controller.currentPayload(),
    {
      message: /FA-DRAFT-SCHEMA-001/,
    }
  );
});

test('F1: 空流程名称应阻断导出', async () => {
  const draft = createValidDraft();
  draft.process_card.name = ''; // 清空流程名称
  const store = new DraftStore({ payload: draft });
  const payload = createMockPayload(draft);

  const controller = new ExportController({
    modeler: null,
    payload,
    store,
    compileBpmn,
  });

  await assert.rejects(
    () => controller.currentPayload(),
    {
      message: /FA-DRAFT-SCHEMA-001/,
    }
  );
});

for (const field of ['provenance', 'source_summary']) {
  test(`F1: 缺少 ${field} 必须失败关闭`, async () => {
    const draft = createValidDraft();
    const payload = createMockPayload(draft);
    const store = new DraftStore({ payload: draft });
    const broken = store.snapshot();
    delete broken[field];
    // 绕过构造器只用于证明导出门禁本身不补默认值。
    store.snapshot = () => structuredClone(broken);
    const controller = new ExportController({
      modeler: null, payload, store, compileBpmn,
    });
    await assert.rejects(() => controller.currentPayload(), /FA-DRAFT-SCHEMA-001/);
  });
}
