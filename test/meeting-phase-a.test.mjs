/**
 * Phase A 测试：浏览器打包确定性编译器
 *
 * 测试要点：
 * 1. AutoLayoutController 构造时拒绝缺失编译器
 * 2. DraftStore 必须包含 schema_version: '2.0.0'
 * 3. 编译成功后 store 的 diagram 和 bpmn_xml 被更新
 * 4. 失败时恢复完整 store、XML 和选择
 * 5. ExportController.currentPayload() 使用 compileBpmn 而不是 modeler.saveXML()
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore } from '../meeting-package/src/draft-store.js';
import { AutoLayoutController } from '../meeting-package/src/auto-layout-controller.js';
import { ExportController } from '../meeting-package/src/export-controller.js';

// Mock compileBpmn 函数
function createMockCompileBpmn(shouldFail = false) {
  return mock.fn((snapshot) => {
    if (shouldFail) {
      throw new Error('业务规则验证失败');
    }
    return {
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_${snapshot.process_card.process_id}"
  exporter="Flow Architect" exporterVersion="2.0.0"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_${snapshot.process_card.process_id}" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="开始" />
    <bpmn:endEvent id="End_1" name="结束" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`,
      layout: {
        elements: {
          Start_1: { x: 100, y: 100, width: 36, height: 36 },
          End_1: { x: 200, y: 100, width: 36, height: 36 },
        },
        edges: [
          { id: 'Flow_1', waypoints: [{ x: 136, y: 118 }, { x: 200, y: 118 }] },
        ],
        lanes: [],
      },
    };
  });
}

// Mock bpmn-js modeler
function createMockModeler() {
  const elements = new Map();
  elements.set('Start_1', { id: 'Start_1', type: 'bpmn:StartEvent', businessObject: { name: '开始' } });
  elements.set('End_1', { id: 'End_1', type: 'bpmn:EndEvent', businessObject: { name: '结束' } });

  // 默认返回的 XML
  let currentXml = '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="Process_1" isExecutable="false"><bpmn:startEvent id="Start_1" name="开始" /><bpmn:endEvent id="End_1" name="结束" /></bpmn:process></bpmn:definitions>';

  return {
    saveXML: mock.fn(() => Promise.resolve({ xml: currentXml })),
    importXML: mock.fn((xml) => {
      currentXml = xml;
      return Promise.resolve();
    }),
    get: mock.fn((name) => {
      switch (name) {
        case 'canvas':
          return { zoom: mock.fn() };
        case 'selection':
          return { get: () => [], select: mock.fn() };
        case 'elementRegistry':
          return { get: (id) => elements.get(id) || null };
        case 'modeling':
          return {
            updateLabel: mock.fn(),
            removeElements: mock.fn(),
            createShape: mock.fn(),
          };
        case 'elementFactory':
          return { createShape: mock.fn((opts) => ({ ...opts, businessObject: {} })) };
        case 'autoPlace':
          return { append: mock.fn() };
        case 'commandStack':
          return { undo: mock.fn(), redo: mock.fn() };
        default:
          return {};
      }
    }),
  };
}

describe('Phase A: 浏览器打包确定性编译器', () => {
  let store;
  let modeler;
  let compileBpmn;

  beforeEach(() => {
    // 创建符合 V2 schema 的 payload
    const payload = {
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
      activities: [],
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
          { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
        ],
        flows: [
          { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'End_1', condition: null },
        ],
        task_bindings: [],
        layout_version: '2.0.0',
      },
      questions: [],
      provenance: {},
      source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      metadata: {
        process_id: 'Process_1',
        title: '测试流程',
        revision: 'r01',
        schema_version: '2.0.0',
      },
      bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
    };

    store = new DraftStore({ payload });
    modeler = createMockModeler();
    compileBpmn = createMockCompileBpmn();
  });

  it('AutoLayoutController 构造时拒绝缺失编译器', () => {
    assert.throws(() => {
      new AutoLayoutController({ store, modeler, compileBpmn: null });
    }, /compileBpmn 必须是函数/);
  });

  it('AutoLayoutController 构造时接受有效的编译器', () => {
    assert.doesNotThrow(() => {
      new AutoLayoutController({ store, modeler, compileBpmn });
    });
  });

  it('DraftStore 必须包含 schema_version: 2.0.0', () => {
    const snapshot = store.snapshot();
    assert.equal(snapshot.schema_version, '2.0.0');
  });

  it('DraftStore 构造时拒绝缺失 schema_version', () => {
    const payload = {
      process_card: { process_id: 'Process_1', name: '测试流程' },
      activities: [],
      diagram: { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
      questions: [],
    };

    assert.throws(() => {
      new DraftStore({ payload });
    }, /schema_version 必须是 2.0.0/);
  });

  it('DraftStore 构造时拒绝非 2.0.0 schema_version', () => {
    const payload = {
      schema_version: '1.0.0',
      process_card: { process_id: 'Process_1', name: '测试流程' },
      activities: [],
      diagram: { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
      questions: [],
    };

    assert.throws(() => {
      new DraftStore({ payload });
    }, /schema_version 必须是 2.0.0/);
  });

  it('AutoLayoutController.applyStructureChange 成功后更新 store 的 bpmn_xml', async () => {
    const controller = new AutoLayoutController({ store, modeler, compileBpmn });

    const mutation = (store, modeler) => {
      // 模拟成功变更
      store.markDirty();
    };

    await controller.applyStructureChange(mutation, '测试变更');

    // 验证 compileBpmn 被调用
    assert.equal(compileBpmn.mock.callCount(), 1);

    // 验证 store 的 bpmn_xml 被更新
    const snapshot = store.snapshot();
    assert.ok(snapshot.bpmn_xml.includes('<bpmn:definitions'));
    assert.ok(snapshot.bpmn_xml.includes('Start_1'));
    assert.ok(snapshot.bpmn_xml.includes('End_1'));
  });

  it('AutoLayoutController.applyStructureChange 失败时恢复 store、XML 和选择', async () => {
    // 创建一个会失败的 compileBpmn
    const failingCompileBpmn = createMockCompileBpmn(true);
    const controller = new AutoLayoutController({ store, modeler, compileBpmn: failingCompileBpmn });

    const snapshotBefore = store.snapshot();
    const { xml: xmlBefore } = await modeler.saveXML({ format: true });

    const mutation = (store, modeler) => {
      // 模拟变更
      store.markDirty();
    };

    await assert.rejects(
      async () => {
        await controller.applyStructureChange(mutation, '测试变更');
      },
      /结构变更失败（测试变更）/
    );

    // 验证 store 被恢复
    const snapshotAfter = store.snapshot();
    assert.deepEqual(snapshotAfter, snapshotBefore);
    assert.equal(store.dirty, false, '回滚后应恢复变更前 dirty 状态');

    // 验证 bpmn-js 被恢复（importXML 被调用两次：一次失败，一次回滚）
    assert.equal(modeler.importXML.mock.callCount(), 1);
  });

  it('预快照失败时 applying 也必须复位', async () => {
    modeler.saveXML = mock.fn(() => Promise.reject(new Error('无法保存快照')));
    const controller = new AutoLayoutController({ store, modeler, compileBpmn });
    await assert.rejects(
      () => controller.applyStructureChange(() => {}, '预快照失败'),
      /FA-DRAFT-LAYOUT-001.*无法保存快照/,
    );
    assert.equal(controller.applying, false);
  });

  it('回滚导入失败时返回组合错误而不是静默继续', async () => {
    const failingCompileBpmn = createMockCompileBpmn(true);
    modeler.importXML = mock.fn(() => Promise.reject(new Error('无法恢复画布')));
    const controller = new AutoLayoutController({ store, modeler, compileBpmn: failingCompileBpmn });
    await assert.rejects(
      () => controller.applyStructureChange(() => store.markDirty(), '回滚失败'),
      /FA-DRAFT-LAYOUT-001.*业务规则验证失败.*回滚失败.*无法恢复画布/,
    );
    assert.equal(controller.applying, false);
  });

  it('同一结构变更执行两次独立运行，产生字节一致 XML/DI', async () => {
    const mutation = (store, modeler) => {
      store.markDirty();
    };

    // 第一次运行
    const controller1 = new AutoLayoutController({ store, modeler, compileBpmn });
    await controller1.applyStructureChange(mutation, '第一次变更');
    const xml1 = store.snapshot().bpmn_xml;

    // 重置 store 和 modeler
    const payload = {
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
      activities: [],
      diagram: {
        lanes: [],
        nodes: [
          { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
          { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
        ],
        flows: [
          { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'End_1', condition: null },
        ],
        task_bindings: [],
        layout_version: '2.0.0',
      },
      questions: [],
      provenance: {},
      source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      metadata: {
        process_id: 'Process_1',
        title: '测试流程',
        revision: 'r01',
        schema_version: '2.0.0',
      },
      bpmn_xml: '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="Process_1" isExecutable="false"><bpmn:startEvent id="Start_1" name="开始" /><bpmn:endEvent id="End_1" name="结束" /></bpmn:process></bpmn:definitions>',
    };
    store = new DraftStore({ payload });
    const modeler2 = createMockModeler();

    // 第二次运行
    const controller2 = new AutoLayoutController({ store, modeler: modeler2, compileBpmn });
    await controller2.applyStructureChange(mutation, '第二次变更');
    const xml2 = store.snapshot().bpmn_xml;

    // 验证两次运行产生相同的 XML
    assert.equal(xml1, xml2);
  });

  it('ExportController.currentPayload() 使用 compileBpmn 而不是 modeler.saveXML()', async () => {
    const controller = new AutoLayoutController({ store, modeler, compileBpmn });
    const exportController = new ExportController({ modeler, payload: store.snapshot(), store, compileBpmn });

    // 重置 mock 计数
    modeler.saveXML.mock.resetCalls();

    await exportController.currentPayload();

    // 验证 modeler.saveXML 没有被调用（对于 leaf L4，应该使用 compileBpmn）
    assert.equal(modeler.saveXML.mock.callCount(), 0);

    // 验证 compileBpmn 被调用
    assert.equal(compileBpmn.mock.callCount(), 1);
  });

  it('非末端流程导出保留合法空 BPMN 字符串且不调用编译器', async () => {
    const nonLeaf = store.snapshot();
    nonLeaf.process_card.level = 'L3';
    nonLeaf.process_card.is_leaf = false;
    nonLeaf.activities = [];
    nonLeaf.diagram = {
      lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0',
    };
    store.restore(nonLeaf);
    const payload = store.snapshot();
    payload.metadata = {
      schema_version: '2.0.0', package_id: 'test', process_id: 'Process_1',
      title: '测试流程', revision: 'r01', based_on_revision: null,
      runtime_version: '2.0.0', content_hash: `sha256:${'0'.repeat(64)}`,
    };
    payload.bpmn_xml = '<bpmn:definitions></bpmn:definitions>';
    const exportController = new ExportController({ modeler, payload, store, compileBpmn });
    const exported = await exportController.currentPayload();
    assert.equal(exported.bpmn_xml, payload.bpmn_xml);
    assert.equal(compileBpmn.mock.callCount(), 0);
  });
});
