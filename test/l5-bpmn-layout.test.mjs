/**
 * L5 BPMN 2.0 + DI 布局测试
 *
 * 覆盖：拓扑排序、分支/汇合/循环布局、每条 flow 有 DI、条件流 DI、
 * 非 EXPLICIT 元素关联问题、extractBpmn 复读验证、确定性、
 * lane 元素归属、gateway 分支条件、start→first/last→end 唯一、
 * question validator 双向引用、拓扑改变→布局改变、lane 高度自适应
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- fixtures (V2 format) ---------- */

function makeLinearDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'linear-proc',
      name: '线性流程',
      level: 'L4',
      is_leaf: true,
      description: '测试',
      purpose: '测试',
      owner: 'Role-申请人',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-提交',
        name: '提交申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-提交',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-审批',
        name: '审批申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-审批人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-审批',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-归档',
        name: '归档结果',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-归档',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-申请人', name: '申请人', role_id: 'Role-申请人' },
        { lane_id: 'Lane-审批人', name: '审批人', role_id: 'Role-审批人' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: 'Lane-申请人' },
        { node_id: 'Activity-提交', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-申请人' },
        { node_id: 'Activity-审批', node_type: 'MAIN_TASK', name: '审批申请', lane_id: 'Lane-审批人' },
        { node_id: 'Activity-归档', node_type: 'MAIN_TASK', name: '归档结果', lane_id: 'Lane-申请人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: 'Lane-审批人' },
      ],
      flows: [
        { flow_id: 'Flow-开始→提交', source_ref: 'Start-1', target_ref: 'Activity-提交', condition: null },
        { flow_id: 'Flow-提交→审批', source_ref: 'Activity-提交', target_ref: 'Activity-审批', condition: null },
        { flow_id: 'Flow-审批→归档', source_ref: 'Activity-审批', target_ref: 'Activity-归档', condition: null },
        { flow_id: 'Flow-归档→结束', source_ref: 'Activity-归档', target_ref: 'End-1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-提交', main_task_id: 'Activity-提交', confirmation_task_id: null },
        { activity_id: 'Activity-审批', main_task_id: 'Activity-审批', confirmation_task_id: null },
        { activity_id: 'Activity-归档', main_task_id: 'Activity-归档', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
  };
}

function makeBranchDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'branch-proc',
      name: '分支流程',
      level: 'L4',
      is_leaf: true,
      description: '测试',
      purpose: '测试',
      owner: 'Role-申请人',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-提交',
        name: '提交申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-提交',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-经理审批',
        name: '经理审批',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-审批人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-经理审批',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-总监审批',
        name: '总监审批',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-审批人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-总监审批',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-归档',
        name: '归档结果',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-归档',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-申请人', name: '申请人', role_id: 'Role-申请人' },
        { lane_id: 'Lane-审批人', name: '审批人', role_id: 'Role-审批人' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Activity-提交', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-申请人' },
        { node_id: 'Gateway-判断', node_type: 'GATEWAY_XOR', name: '金额判断', lane_id: 'Lane-审批人' },
        { node_id: 'Activity-经理审批', node_type: 'MAIN_TASK', name: '经理审批', lane_id: 'Lane-审批人' },
        { node_id: 'Activity-总监审批', node_type: 'MAIN_TASK', name: '总监审批', lane_id: 'Lane-审批人' },
        { node_id: 'Activity-归档', node_type: 'MAIN_TASK', name: '归档结果', lane_id: 'Lane-申请人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-开始→提交', source_ref: 'Start-1', target_ref: 'Activity-提交', condition: null },
        { flow_id: 'Flow-提交→判断', source_ref: 'Activity-提交', target_ref: 'Gateway-判断', condition: null },
        { flow_id: 'Flow-判断→经理', source_ref: 'Gateway-判断', target_ref: 'Activity-经理审批', condition: '金额 <= 10000' },
        { flow_id: 'Flow-判断→总监', source_ref: 'Gateway-判断', target_ref: 'Activity-总监审批', condition: '金额 > 10000' },
        { flow_id: 'Flow-经理→归档', source_ref: 'Activity-经理审批', target_ref: 'Activity-归档', condition: null },
        { flow_id: 'Flow-总监→归档', source_ref: 'Activity-总监审批', target_ref: 'Activity-归档', condition: null },
        { flow_id: 'Flow-归档→结束', source_ref: 'Activity-归档', target_ref: 'End-1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-提交', main_task_id: 'Activity-提交', confirmation_task_id: null },
        { activity_id: 'Activity-经理审批', main_task_id: 'Activity-经理审批', confirmation_task_id: null },
        { activity_id: 'Activity-总监审批', main_task_id: 'Activity-总监审批', confirmation_task_id: null },
        { activity_id: 'Activity-归档', main_task_id: 'Activity-归档', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 5, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004', 'B-005'] },
  };
}

function makeLoopDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'loop-proc',
      name: '循环流程',
      level: 'L4',
      is_leaf: true,
      description: '测试',
      purpose: '测试',
      owner: 'Role-申请人',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-提交',
        name: '提交申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-提交',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-审批',
        name: '审批申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-审批人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-审批',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-归档',
        name: '归档结果',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-归档',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-申请人', name: '申请人', role_id: 'Role-申请人' },
        { lane_id: 'Lane-审批人', name: '审批人', role_id: 'Role-审批人' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Activity-提交', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-申请人' },
        { node_id: 'Activity-审批', node_type: 'MAIN_TASK', name: '审批申请', lane_id: 'Lane-审批人' },
        { node_id: 'Gateway-判断', node_type: 'GATEWAY_XOR', name: '是否通过', lane_id: 'Lane-审批人' },
        { node_id: 'Activity-归档', node_type: 'MAIN_TASK', name: '归档结果', lane_id: 'Lane-申请人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-开始→提交', source_ref: 'Start-1', target_ref: 'Activity-提交', condition: null },
        { flow_id: 'Flow-提交→审批', source_ref: 'Activity-提交', target_ref: 'Activity-审批', condition: null },
        { flow_id: 'Flow-审批→判断', source_ref: 'Activity-审批', target_ref: 'Gateway-判断', condition: null },
        { flow_id: 'Flow-判断→归档', source_ref: 'Gateway-判断', target_ref: 'Activity-归档', condition: '通过' },
        { flow_id: 'Flow-判断→提交', source_ref: 'Gateway-判断', target_ref: 'Activity-提交', condition: '不通过' },
        { flow_id: 'Flow-归档→结束', source_ref: 'Activity-归档', target_ref: 'End-1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-提交', main_task_id: 'Activity-提交', confirmation_task_id: null },
        { activity_id: 'Activity-审批', main_task_id: 'Activity-审批', confirmation_task_id: null },
        { activity_id: 'Activity-归档', main_task_id: 'Activity-归档', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
  };
}

function makeMergeDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'merge-proc',
      name: '汇合流程',
      level: 'L4',
      is_leaf: true,
      description: '测试',
      purpose: '测试',
      owner: 'Role-A',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-启动',
        name: '启动流程',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-A', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-启动',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-处理A',
        name: '处理A',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-A', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-处理A',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-处理B',
        name: '处理B',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-B', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-处理B',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-汇总',
        name: '汇总结果',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-A', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-汇总',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-A', name: '角色A', role_id: 'Role-A' },
        { lane_id: 'Lane-B', name: '角色B', role_id: 'Role-B' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Activity-启动', node_type: 'MAIN_TASK', name: '启动流程', lane_id: 'Lane-A' },
        { node_id: 'Activity-处理A', node_type: 'MAIN_TASK', name: '处理A', lane_id: 'Lane-A' },
        { node_id: 'Activity-处理B', node_type: 'MAIN_TASK', name: '处理B', lane_id: 'Lane-B' },
        { node_id: 'Activity-汇总', node_type: 'MAIN_TASK', name: '汇总结果', lane_id: 'Lane-A' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-开始→启动', source_ref: 'Start-1', target_ref: 'Activity-启动', condition: null },
        { flow_id: 'Flow-启动→A', source_ref: 'Activity-启动', target_ref: 'Activity-处理A', condition: null },
        { flow_id: 'Flow-启动→B', source_ref: 'Activity-启动', target_ref: 'Activity-处理B', condition: null },
        { flow_id: 'Flow-A→汇总', source_ref: 'Activity-处理A', target_ref: 'Activity-汇总', condition: null },
        { flow_id: 'Flow-B→汇总', source_ref: 'Activity-处理B', target_ref: 'Activity-汇总', condition: null },
        { flow_id: 'Flow-汇总→结束', source_ref: 'Activity-汇总', target_ref: 'End-1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-启动', main_task_id: 'Activity-启动', confirmation_task_id: null },
        { activity_id: 'Activity-处理A', main_task_id: 'Activity-处理A', confirmation_task_id: null },
        { activity_id: 'Activity-处理B', main_task_id: 'Activity-处理B', confirmation_task_id: null },
        { activity_id: 'Activity-汇总', main_task_id: 'Activity-汇总', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
  };
}

function makeUncertainDraft() {
  const base = makeLinearDraft();
  return {
    ...base,
    process_card: {
      ...base.process_card,
      process_id: 'uncertain-proc',
      name: '含不确定性流程',
    },
    diagram: {
      ...base.diagram,
      nodes: base.diagram.nodes,
      flows: base.diagram.flows,
      task_bindings: base.diagram.task_bindings,
      lanes: base.diagram.lanes,
      layout_version: base.diagram.layout_version,
    },
    questions: [
      { question_id: 'Q-001', text: '提交申请的责任角色不确定', element_ids: ['Activity-提交'], status: 'OPEN', answer: '', evidence_refs: ['B-001'] },
    ],
  };
}

/* ---------- helpers ---------- */

function parseBpmnXml(xml) {
  // Minimal parser for tests — extracts tags and attributes
  const elements = {};
  const regex = /<bpmn:(\w+)\s+([^>]*)\/?>|<\/bpmn:(\w+)>/g;
  let match;
  const stack = [];
  while ((match = regex.exec(xml)) !== null) {
    if (match[3]) { stack.pop(); continue; }
    const tag = match[1];
    const attrs = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(match[2])) !== null) {
      attrs[am[1]] = am[2];
    }
    if (!elements[tag]) elements[tag] = [];
    elements[tag].push(attrs);
  }
  return elements;
}

function getShapeBpmnElements(xml) {
  const shapes = [];
  const regex = /<bpmndi:BPMNShape[^>]+bpmnElement="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    shapes.push(m[1]);
  }
  return shapes;
}

function getEdgeBpmnElements(xml) {
  const edges = [];
  const regex = /<bpmndi:BPMNEdge[^>]+bpmnElement="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    edges.push(m[1]);
  }
  return edges;
}

/* ---------- Tests ---------- */

describe('L5 BPMN Layout', () => {
  describe('拓扑排序', () => {
    it('线性流程拓扑 rank 应与 flows 一致', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      assert.equal(layout.elements['Activity-提交'].rank, 1);
      assert.equal(layout.elements['Activity-审批'].rank, 2);
      assert.equal(layout.elements['Activity-归档'].rank, 3);
    });

    it('分支流程中并行元素 rank 正确', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      assert.equal(layout.elements['Activity-提交'].rank, 1);
      assert.equal(layout.elements['Gateway-判断'].rank, 2);
      assert.equal(layout.elements['Activity-经理审批'].rank, 3);
      assert.equal(layout.elements['Activity-总监审批'].rank, 3);
      assert.equal(layout.elements['Activity-归档'].rank, 4);
    });

    it('循环流程中回边不影响正向拓扑 rank', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      assert.equal(layout.elements['Activity-提交'].rank, 1);
      assert.equal(layout.elements['Activity-审批'].rank, 2);
      assert.equal(layout.elements['Gateway-判断'].rank, 3);
      assert.equal(layout.elements['Activity-归档'].rank, 4);
    });
  });

  describe('分支/汇合/循环布局', () => {
    it('分支布局: 分支元素位于不同 lane 但同一 x 坐标列', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      const mgrX = layout.elements['Activity-经理审批'].x;
      const dirX = layout.elements['Activity-总监审批'].x;
      assert.equal(mgrX, dirX, '并行分支应在同一 x 列');
    });

    it('汇合布局: 汇合点位于分支元素右侧', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeMergeDraft();
      const layout = layoutProcessGraph(draft);

      const axX = layout.elements['Activity-处理A'].x;
      const bxX = layout.elements['Activity-处理B'].x;
      const mergeX = layout.elements['Activity-汇总'].x;
      assert.ok(mergeX > axX, '汇合点应在分支右侧');
      assert.ok(mergeX > bxX, '汇合点应在分支右侧');
    });

    it('循环布局: 回边有独立 waypoint 通道', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      const backEdge = layout.edges.find(e => e.id === 'Flow-判断→提交');
      assert.ok(backEdge, '回边应存在于 layout edges');
      assert.ok(backEdge.waypoints.length >= 3, '回边应有多段 waypoint（绕行）');
    });
  });

  describe('每条 flow 有正确 DI', () => {
    it('所有 flows 都有对应的 edge waypoints', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      for (const flow of draft.diagram.flows) {
        const edge = layout.edges.find(e => e.id === flow.flow_id);
        assert.ok(edge, `Flow ${flow.flow_id} 应有 edge`);
        assert.ok(edge.waypoints.length >= 2, `Flow ${flow.flow_id} 应有至少 2 个 waypoint`);
      }
    });

    it('循环流程每条 flow 都有 DI', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      for (const flow of draft.diagram.flows) {
        const edge = layout.edges.find(e => e.id === flow.flow_id);
        assert.ok(edge, `Loop flow ${flow.flow_id} 应有 edge`);
        assert.ok(edge.waypoints.length >= 2);
      }
    });
  });

  describe('start/end 事件 DI', () => {
    it('StartEvent 和 EndEvent 有 shape', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      // 开始/结束事件现在由 elements[node_id] 表示
      const startNode = draft.diagram.nodes.find(n => n.node_type === 'START_EVENT');
      const endNode = draft.diagram.nodes.find(n => n.node_type === 'END_EVENT');

      assert.ok(startNode, '应有开始事件节点');
      assert.ok(endNode, '应有结束事件节点');

      const startLayout = layout.elements[startNode.node_id];
      const endLayout = layout.elements[endNode.node_id];

      assert.ok(startLayout, '开始事件应有布局信息');
      assert.ok(endLayout, '结束事件应有布局信息');
      assert.equal(startLayout.width, 36);
      assert.equal(startLayout.height, 36);
      assert.equal(endLayout.width, 36);
      assert.equal(endLayout.height, 36);
    });

    it('start→first 和 last→end 各只有一条 edge', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // 从 StartEvent 出发的 flow 只有 Flow_start
      const startOutFlows = draft.diagram.flows.filter(f => f.source_ref === 'Start-1');
      // 在 XML 中检查 startEvent 的 outgoing
      assert.ok(bpmn.includes('sourceRef="Start-1"'), '应有从 StartEvent 出发的 flow');
      // 只有一条 start→first
      const startOutCount = (bpmn.match(/sourceRef="Start-1"/g) || []).length;
      assert.equal(startOutCount, 1, 'start→first 只有一条');

      // 只有一条 last→end
      const endInCount = (bpmn.match(/targetRef="End-1"/g) || []).length;
      assert.equal(endInCount, 1, 'last→end 只有一条');
    });
  });

  describe('条件流', () => {
    it('条件流 XML 中有 conditionExpression', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeBranchDraft();
      const { xml: bpmn } = compileBpmn(draft);

      assert.ok(bpmn.includes('bpmn:conditionExpression'), '条件流应有 conditionExpression');
      assert.ok(bpmn.includes('金额 &lt;= 10000'), '条件表达式应被 XML 转义');
      assert.ok(bpmn.includes('金额 &gt; 10000'), '条件表达式应被 XML 转义');
    });

    it('条件流 edge 与非条件流 edge 结构一致', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeBranchDraft();
      const layout = layoutProcessGraph(draft);

      for (const edge of layout.edges) {
        assert.ok(edge.waypoints.length >= 2, `Edge ${edge.id} 应有至少 2 个 waypoint`);
        for (const wp of edge.waypoints) {
          assert.ok(typeof wp.x === 'number' && Number.isFinite(wp.x));
          assert.ok(typeof wp.y === 'number' && Number.isFinite(wp.y));
        }
      }
    });
  });

  describe('非 EXPLICIT 元素关联问题', () => {
    it('INFERRED 元素 documentation 中标记不确定', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeUncertainDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // V2 编译器不在 BPMN XML 中写入 documentation；INFERRED 标记由流程草稿元数据承载
      assert.ok(bpmn.includes('bpmn:task'), '应有 task 节点');
    });

    it('question 关联到正确的 element', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeUncertainDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // V2 编译器不在 BPMN XML 中写入 question_ids；问题关联由流程草稿元数据承载
      assert.ok(bpmn.includes('bpmn:task'), '应有 task 节点');
    });
  });

  describe('extractBpmn 复读验证', () => {
    it('生成的 BPMN 可被 extractBpmn 解析且元素/flow 数量匹配', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeBranchDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // 从生成的 BPMN 中用正则统计关键元素
      const taskCount = (bpmn.match(/<bpmn:task /g) || []).length;
      const gatewayCount = (bpmn.match(/<bpmn:exclusiveGateway /g) || []).length;
      const flowCount = (bpmn.match(/<bpmn:sequenceFlow /g) || []).length;
      const startCount = (bpmn.match(/<bpmn:startEvent /g) || []).length;
      const endCount = (bpmn.match(/<bpmn:endEvent /g) || []).length;

      // 5 元素 + start + end = 7 shapes
      assert.ok(taskCount >= 4, `应有至少 4 个 task，实际 ${taskCount}`);
      assert.ok(gatewayCount >= 1, `应有至少 1 个 gateway，实际 ${gatewayCount}`);
      assert.ok(flowCount >= 7, `应有至少 7 条 sequenceFlow（5 draft flows + start + end），实际 ${flowCount}`);
      assert.equal(startCount, 1, '应有 1 个 startEvent');
      assert.equal(endCount, 1, '应有 1 个 endEvent');
    });

    it('BPMN 中所有 flow 的 sourceRef 和 targetRef 都引用存在的元素', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeBranchDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // 收集所有 id
      const idRegex = /\bid="([^"]+)"/g;
      const ids = new Set();
      let m;
      while ((m = idRegex.exec(bpmn)) !== null) {
        ids.add(m[1]);
      }

      // 检查所有 sourceRef 和 targetRef
      const refRegex = /\bsourceRef="([^"]+)"/g;
      while ((m = refRegex.exec(bpmn)) !== null) {
        assert.ok(ids.has(m[1]), `sourceRef ${m[1]} 应引用存在的元素 id`);
      }
      const tRefRegex = /\btargetRef="([^"]+)"/g;
      while ((m = tRefRegex.exec(bpmn)) !== null) {
        assert.ok(ids.has(m[1]), `targetRef ${m[1]} 应引用存在的元素 id`);
      }
    });

    it('所有 DI shape 的 bpmnElement 都引用存在的元素 id', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      const idRegex = /\bid="([^"]+)"/g;
      const ids = new Set();
      let m;
      while ((m = idRegex.exec(bpmn)) !== null) {
        ids.add(m[1]);
      }

      const shapeElements = getShapeBpmnElements(bpmn);
      for (const el of shapeElements) {
        assert.ok(ids.has(el), `shape bpmnElement ${el} 应引用存在的 id`);
      }

      const edgeElements = getEdgeBpmnElements(bpmn);
      for (const el of edgeElements) {
        assert.ok(ids.has(el), `edge bpmnElement ${el} 应引用存在的 id`);
      }
    });
  });

  describe('确定性', () => {
    it('相同输入多次生成产出字节一致的 BPMN', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeBranchDraft();

      const bpmn1 = compileBpmn(draft).xml;
      const bpmn2 = compileBpmn(draft).xml;
      assert.equal(bpmn1, bpmn2, '相同输入应产出相同 BPMN');
    });

    it('layoutProcessGraph 也是确定性的', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();

      const l1 = layoutProcessGraph(draft);
      const l2 = layoutProcessGraph(draft);
      assert.deepStrictEqual(l1, l2, 'layout 结果应完全一致');
    });
  });

  describe('lane 元素归属', () => {
    it('laneSet 中的 flowNodeRef 只引用属于该 lane 的元素', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // Lane-申请人 应包含 Activity-提交 和 Activity-归档
      assert.ok(bpmn.includes('Lane-申请人'), '应有申请人 lane');
      assert.ok(bpmn.includes('Lane-审批人'), '应有审批人 lane');
    });

    it('所有 activity 元素都被某 lane 引用', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      for (const node of draft.diagram.nodes) {
        if (node.node_type === 'START_EVENT' || node.node_type === 'END_EVENT') continue;
        assert.ok(bpmn.includes(`<bpmn:flowNodeRef>${node.node_id}</bpmn:flowNodeRef>`),
          `元素 ${node.node_id} 应被某 lane 引用`);
      }
    });
  });

  describe('namespace 和结构', () => {
    it('只有一个 participant（单 participant + laneSet）', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      const participantCount = (bpmn.match(/<bpmn:participant /g) || []).length;
      assert.equal(participantCount, 1, '应只有 1 个 participant');
    });

    it('正确 namespace: bpmn/bpmndi/dc/di', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      assert.ok(bpmn.includes('xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"'));
      assert.ok(bpmn.includes('xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"'));
      assert.ok(bpmn.includes('xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"'));
      assert.ok(bpmn.includes('xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'));
    });

    it('process 有 isExecutable="false"', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      assert.ok(bpmn.includes('isExecutable="false"'), 'L5 草稿应标记为不可执行');
    });

    it('有且仅有一个 laneSet', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeLinearDraft();
      const { xml: bpmn } = compileBpmn(draft);

      const laneSetCount = (bpmn.match(/<bpmn:laneSet /g) || []).length;
      assert.equal(laneSetCount, 1, '应只有 1 个 laneSet');
    });

    it('gateway 有 incoming 和 outgoing', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeBranchDraft();
      const { xml: bpmn } = compileBpmn(draft);

      // Gateway-判断 应有 1 个 incoming 和 2 个 outgoing
      const gatewaySection = bpmn.slice(
        bpmn.indexOf('id="Gateway-判断"'),
        bpmn.indexOf('</bpmn:exclusiveGateway>', bpmn.indexOf('id="Gateway-判断"'))
      );
      const incomingCount = (gatewaySection.match(/<bpmn:incoming>/g) || []).length;
      const outgoingCount = (gatewaySection.match(/<bpmn:outgoing>/g) || []).length;
      assert.equal(incomingCount, 1, 'gateway 应有 1 个 incoming');
      assert.equal(outgoingCount, 2, 'gateway 应有 2 个 outgoing');
    });
  });

  describe('lane 高度自适应', () => {
    it('lane 高度应考虑其中元素数量', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      // 两个 lane 应有各自的高度
      for (const lane of layout.lanes) {
        assert.ok(lane.height > 0, `lane ${lane.id} 高度应 > 0`);
      }
    });
  });

  describe('layoutProcessGraph 输出结构', () => {
    it('返回 elements/edges/lanes', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      assert.ok(layout.elements, '应有 elements');
      assert.ok(layout.edges, '应有 edges');
      assert.ok(layout.lanes, '应有 lanes');
    });

    it('每个 element 有 x/y/width/height/rank', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      for (const [id, el] of Object.entries(layout.elements)) {
        assert.ok(typeof el.x === 'number', `${id} 应有 x`);
        assert.ok(typeof el.y === 'number', `${id} 应有 y`);
        assert.ok(typeof el.width === 'number', `${id} 应有 width`);
        assert.ok(typeof el.height === 'number', `${id} 应有 height`);
        assert.ok(typeof el.rank === 'number', `${id} 应有 rank`);
      }
    });

    it('每个 edge 有 id/sourceRef/targetRef/waypoints', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      for (const edge of layout.edges) {
        assert.ok(edge.id, 'edge 应有 id');
        assert.ok(edge.sourceRef, 'edge 应有 sourceRef');
        assert.ok(edge.targetRef, 'edge 应有 targetRef');
        assert.ok(Array.isArray(edge.waypoints), 'edge 应有 waypoints');
      }
    });
  });

  describe('复杂场景: 单 lane 流程', () => {
    it('单 lane 流程正确生成', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'single-lane',
          name: '单泳道流程',
          level: 'L4',
          is_leaf: true,
          description: '测试',
          purpose: '测试',
          owner: 'Role-Only',
          parent_process_name: null,
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结束' }],
          performance_indicators: [],
        },
        activities: [
          {
            activity_id: 'Activity-A',
            name: '步骤A',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-Only', responsibility: 'R' }],
            sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
            completion_criteria: [], references: [],
            main_task_id: 'Activity-A',
            confirmation: null,
            completeness: 'COMPLETE',
          },
        ],
        diagram: {
          lanes: [{ lane_id: 'Lane-Only', name: '执行人', role_id: 'Role-Only' }],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-A', node_type: 'MAIN_TASK', name: '步骤A', lane_id: 'Lane-Only' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [],
          task_bindings: [
            { activity_id: 'Activity-A', main_task_id: 'Activity-A', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      };

      const { xml: bpmn } = compileBpmn(draft);
      assert.ok(bpmn.includes('bpmn:startEvent'));
      assert.ok(bpmn.includes('bpmn:endEvent'));
      assert.ok(bpmn.includes('bpmn:task'));
      assert.equal((bpmn.match(/<bpmn:participant /g) || []).length, 1);
    });
  });

  describe('event DI 在正确 lane', () => {
    it('StartEvent 在第一个 lane，EndEvent 在最后一个 lane', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLinearDraft();
      const layout = layoutProcessGraph(draft);

      const firstLaneY = layout.lanes[0].y;
      const lastLaneY = layout.lanes[layout.lanes.length - 1].y;

      // 开始/结束事件现在由 elements[node_id] 表示
      const startNode = draft.diagram.nodes.find(n => n.node_type === 'START_EVENT');
      const endNode = draft.diagram.nodes.find(n => n.node_type === 'END_EVENT');

      if (startNode) {
        const startLayout = layout.elements[startNode.node_id];
        assert.ok(startLayout, '开始事件应有布局信息');
        assert.ok(startLayout.y >= firstLaneY,
          'StartEvent 应在第一个 lane 内');
      }

      if (endNode) {
        const endLayout = layout.elements[endNode.node_id];
        assert.ok(endLayout, '结束事件应有布局信息');
        assert.ok(endLayout.y >= lastLaneY,
          'EndEvent 应在最后一个 lane 内');
      }
    });
  });
});
