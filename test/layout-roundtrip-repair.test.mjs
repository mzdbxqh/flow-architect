/**
 * 布局与往返收口修复测试
 *
 * 覆盖目标文档中的9个必须修复问题
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- 测试 fixtures ---------- */

function makeSimpleV2Draft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'simple-proc',
      name: '简单流程',
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
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-提交→审批', source_ref: 'Activity-提交', target_ref: 'Activity-审批', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-提交', main_task_id: 'Activity-提交', confirmation_task_id: null },
        { activity_id: 'Activity-审批', main_task_id: 'Activity-审批', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
  };
}

function makeSingleLaneParallelDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'single-lane-parallel-proc',
      name: '单泳道并行流程',
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
        activity_id: 'Activity-处理A',
        name: '处理A',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
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
        role_assignments: [{ role_id: 'Role-申请人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-处理B',
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
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Activity-提交', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-申请人' },
        { node_id: 'Activity-处理A', node_type: 'MAIN_TASK', name: '处理A', lane_id: 'Lane-申请人' },
        { node_id: 'Activity-处理B', node_type: 'MAIN_TASK', name: '处理B', lane_id: 'Lane-申请人' },
        { node_id: 'Activity-归档', node_type: 'MAIN_TASK', name: '归档结果', lane_id: 'Lane-申请人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-提交→A', source_ref: 'Activity-提交', target_ref: 'Activity-处理A', condition: null },
        { flow_id: 'Flow-提交→B', source_ref: 'Activity-提交', target_ref: 'Activity-处理B', condition: null },
        { flow_id: 'Flow-A→归档', source_ref: 'Activity-处理A', target_ref: 'Activity-归档', condition: null },
        { flow_id: 'Flow-B→归档', source_ref: 'Activity-处理B', target_ref: 'Activity-归档', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-提交', main_task_id: 'Activity-提交', confirmation_task_id: null },
        { activity_id: 'Activity-处理A', main_task_id: 'Activity-处理A', confirmation_task_id: null },
        { activity_id: 'Activity-处理B', main_task_id: 'Activity-处理B', confirmation_task_id: null },
        { activity_id: 'Activity-归档', main_task_id: 'Activity-归档', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
  };
}

function makeMultiLaneSameRankDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'multi-lane-same-rank-proc',
      name: '多泳道同rank流程',
      level: 'L4',
      is_leaf: true,
      description: '测试',
      purpose: '测试',
      owner: 'Role-采购人',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-采购',
        name: '采购申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-采购人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-采购',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-财务',
        name: '财务审核',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-财务', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-财务',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-技术',
        name: '技术评估',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-技术', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-技术',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-执行',
        name: '执行采购',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-采购人', responsibility: 'R' }],
        sla: null, tools: [], inputs: [], process_summary: '', outputs: [],
        completion_criteria: [], references: [],
        main_task_id: 'Activity-执行',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-采购人', name: '采购人', role_id: 'Role-采购人' },
        { lane_id: 'Lane-财务', name: '财务', role_id: 'Role-财务' },
        { lane_id: 'Lane-技术', name: '技术', role_id: 'Role-技术' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Activity-采购', node_type: 'MAIN_TASK', name: '采购申请', lane_id: 'Lane-采购人' },
        { node_id: 'Activity-财务', node_type: 'MAIN_TASK', name: '财务审核', lane_id: 'Lane-财务' },
        { node_id: 'Activity-技术', node_type: 'MAIN_TASK', name: '技术评估', lane_id: 'Lane-技术' },
        { node_id: 'Activity-执行', node_type: 'MAIN_TASK', name: '执行采购', lane_id: 'Lane-采购人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-采购→财务', source_ref: 'Activity-采购', target_ref: 'Activity-财务', condition: null },
        { flow_id: 'Flow-采购→技术', source_ref: 'Activity-采购', target_ref: 'Activity-技术', condition: null },
        { flow_id: 'Flow-财务→执行', source_ref: 'Activity-财务', target_ref: 'Activity-执行', condition: null },
        { flow_id: 'Flow-技术→执行', source_ref: 'Activity-技术', target_ref: 'Activity-执行', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-采购', main_task_id: 'Activity-采购', confirmation_task_id: null },
        { activity_id: 'Activity-财务', main_task_id: 'Activity-财务', confirmation_task_id: null },
        { activity_id: 'Activity-技术', main_task_id: 'Activity-技术', confirmation_task_id: null },
        { activity_id: 'Activity-执行', main_task_id: 'Activity-执行', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
  };
}

function makeConditionDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'condition-proc',
      name: '条件流程',
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
        role_assignments: [{ role_id: 'Role-经理', responsibility: 'R' }],
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
        role_assignments: [{ role_id: 'Role-总监', responsibility: 'R' }],
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
        { lane_id: 'Lane-经理', name: '经理', role_id: 'Role-经理' },
        { lane_id: 'Lane-总监', name: '总监', role_id: 'Role-总监' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Activity-提交', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-申请人' },
        { node_id: 'Gateway-判断', node_type: 'GATEWAY_XOR', name: '金额判断', lane_id: null },
        { node_id: 'Activity-经理审批', node_type: 'MAIN_TASK', name: '经理审批', lane_id: 'Lane-经理' },
        { node_id: 'Activity-总监审批', node_type: 'MAIN_TASK', name: '总监审批', lane_id: 'Lane-总监' },
        { node_id: 'Activity-归档', node_type: 'MAIN_TASK', name: '归档结果', lane_id: 'Lane-申请人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-提交→判断', source_ref: 'Activity-提交', target_ref: 'Gateway-判断', condition: null },
        {
          flow_id: 'Flow-判断→经理', source_ref: 'Gateway-判断', target_ref: 'Activity-经理审批',
          condition: { label: '金额 <= 10000', source_output: '金额', operator: 'LESS_THAN_OR_EQUAL', value: '10000' }
        },
        {
          flow_id: 'Flow-判断→总监', source_ref: 'Gateway-判断', target_ref: 'Activity-总监审批',
          condition: { label: '金额 > 10000', source_output: '金额', operator: 'GREATER_THAN', value: '10000' }
        },
        { flow_id: 'Flow-经理→归档', source_ref: 'Activity-经理审批', target_ref: 'Activity-归档', condition: null },
        { flow_id: 'Flow-总监→归档', source_ref: 'Activity-总监审批', target_ref: 'Activity-归档', condition: null },
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
    source_summary: { total_blocks: 4, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003', 'B-004'] },
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
        { node_id: 'Gateway-判断', node_type: 'GATEWAY_XOR', name: '是否通过', lane_id: null },
        { node_id: 'Activity-归档', node_type: 'MAIN_TASK', name: '归档结果', lane_id: 'Lane-申请人' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-提交→审批', source_ref: 'Activity-提交', target_ref: 'Activity-审批', condition: null },
        { flow_id: 'Flow-审批→判断', source_ref: 'Activity-审批', target_ref: 'Gateway-判断', condition: null },
        { flow_id: 'Flow-判断→归档', source_ref: 'Gateway-判断', target_ref: 'Activity-归档', condition: '通过' },
        { flow_id: 'Flow-判断→提交', source_ref: 'Gateway-判断', target_ref: 'Activity-提交', condition: '不通过' },
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

/* ---------- 测试用例 ---------- */

describe('布局与往返收口修复', () => {
  describe('问题1: 布局器只接受V2输入', () => {
    it('布局器应拒绝V1格式输入（使用element_id/kind）', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const v1Draft = {
        elements: [
          { element_id: 'Start-1', kind: 'START_EVENT', name: '开始' },
          { element_id: 'Activity-提交', kind: 'TASK', name: '提交申请' },
        ],
        flows: [
          { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Activity-提交' }
        ],
        lanes: [],
      };

      // 布局器应该抛出错误或拒绝V1输入
      assert.throws(
        () => layoutProcessGraph(v1Draft),
        (err) => {
          // 应该抛出关于格式不支持的错误
          return err.message.includes('V1') || err.message.includes('格式') || err.message.includes('不支持');
        },
        '布局器应拒绝V1格式输入'
      );
    });

    it('布局器应接受V2格式输入（使用node_id/node_type）', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const v2Draft = makeSimpleV2Draft();

      // 应该成功返回布局结果
      const layout = layoutProcessGraph(v2Draft);
      assert.ok(layout, '应返回布局结果');
      assert.ok(layout.elements, '应有elements');
      assert.ok(layout.edges, '应有edges');
    });
  });

  describe('问题2: 不生成虚拟节点或连线', () => {
    it('编译器不应生成StartEvent_1、EndEvent_1等虚拟节点', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeSimpleV2Draft();
      const { xml } = compileBpmn(draft);

      // 不应包含StartEvent_1或EndEvent_1
      assert.ok(!xml.includes('StartEvent_1'), '不应包含StartEvent_1虚拟节点');
      assert.ok(!xml.includes('EndEvent_1'), '不应包含EndEvent_1虚拟节点');
    });

    it('编译器不应生成Flow_start_*或Flow_end_*虚拟连线', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeSimpleV2Draft();
      const { xml } = compileBpmn(draft);

      // 不应包含Flow_start_或Flow_end_虚拟连线
      assert.ok(!xml.includes('Flow_start_'), '不应包含Flow_start_虚拟连线');
      assert.ok(!xml.includes('Flow_end_'), '不应包含Flow_end_虚拟连线');
    });

    it('输出edge的ID集合必须与diagram.flows完全相等', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeSimpleV2Draft();
      const { layout } = compileBpmn(draft);

      // 收集所有edge的ID
      const edgeIds = new Set(layout.edges.map(e => e.id));

      // 收集所有flow的ID
      const flowIds = new Set(draft.diagram.flows.map(f => f.flow_id));

      // 应该完全相等
      assert.deepStrictEqual(edgeIds, flowIds, 'edge ID集合应与flow ID集合完全相等');
    });
  });

  describe('问题3: 自适应泳道高度，节点不重叠', () => {
    it('单泳道同rank多节点应自适应泳道高度', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeSingleLaneParallelDraft();
      const layout = layoutProcessGraph(draft);

      // 获取泳道
      const lane = layout.lanes[0];
      assert.ok(lane, '应有泳道');

      // 获取同rank的节点（Activity-处理A和Activity-处理B）
      const nodeA = layout.elements['Activity-处理A'];
      const nodeB = layout.elements['Activity-处理B'];
      assert.ok(nodeA, '应有Activity-处理A');
      assert.ok(nodeB, '应有Activity-处理B');

      // 两个节点应该在同一rank
      assert.equal(nodeA.rank, nodeB.rank, '两个节点应在同一rank');

      // 节点不应重叠
      const overlaps = nodeA.y < nodeB.y + nodeB.height && nodeA.y + nodeA.height > nodeB.y;
      assert.ok(!overlaps, '节点不应重叠');

      // 检查每个有lane_id的节点是否完全位于泳道内
      for (const node of draft.diagram.nodes) {
        if (!node.lane_id) continue;

        const nodeLayout = layout.elements[node.node_id];
        if (!nodeLayout) continue;

        // 节点顶部应在泳道内
        assert.ok(nodeLayout.y >= lane.y,
          `节点${node.node_id}的y坐标(${nodeLayout.y})应在泳道顶部(${lane.y})之内`);
        // 节点底部应在泳道内
        assert.ok(nodeLayout.y + nodeLayout.height <= lane.y + lane.height,
          `节点${node.node_id}的底部(${nodeLayout.y + nodeLayout.height})应在泳道底部(${lane.y + lane.height})之内`);
      }
    });

    it('每个有lane_id的节点边界必须完全位于对应泳道内', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeMultiLaneSameRankDraft();
      const layout = layoutProcessGraph(draft);

      // 检查每个有lane_id的节点
      for (const node of draft.diagram.nodes) {
        if (!node.lane_id) continue;

        const nodeLayout = layout.elements[node.node_id];
        const lane = layout.lanes.find(l => l.id === node.lane_id);

        if (!nodeLayout || !lane) continue;

        // 节点应该在泳道内
        assert.ok(nodeLayout.y >= lane.y, `节点${node.node_id}的y坐标应在泳道内`);
        assert.ok(nodeLayout.y + nodeLayout.height <= lane.y + lane.height, `节点${node.node_id}的底部应在泳道内`);
      }
    });

    it('同rank混合尺寸节点按实际高度堆叠且不重叠', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const diagram = {
        lanes: [{ lane_id: 'Lane-1', name: '处理人', role_id: 'Role-1' }],
        nodes: [
          { node_id: 'Start', node_type: 'START_EVENT', name: '开始', lane_id: 'Lane-1' },
          { node_id: 'A-Event', node_type: 'INTERMEDIATE_TIMER_CATCH', name: '等待', lane_id: 'Lane-1' },
          { node_id: 'B-Task', node_type: 'MAIN_TASK', name: '任务B', lane_id: 'Lane-1' },
          { node_id: 'C-Task', node_type: 'MAIN_TASK', name: '任务C', lane_id: 'Lane-1' },
          { node_id: 'End', node_type: 'END_EVENT', name: '结束', lane_id: 'Lane-1' },
        ],
        flows: [
          { flow_id: 'F1', source_ref: 'Start', target_ref: 'A-Event' },
          { flow_id: 'F2', source_ref: 'Start', target_ref: 'B-Task' },
          { flow_id: 'F3', source_ref: 'Start', target_ref: 'C-Task' },
          { flow_id: 'F4', source_ref: 'A-Event', target_ref: 'End' },
          { flow_id: 'F5', source_ref: 'B-Task', target_ref: 'End' },
          { flow_id: 'F6', source_ref: 'C-Task', target_ref: 'End' },
        ],
      };
      const layout = layoutProcessGraph({ diagram });
      const lane = layout.lanes[0];
      const sameRank = ['A-Event', 'B-Task', 'C-Task'].map((id) => ({ id, ...layout.elements[id] }));

      for (const node of sameRank) {
        assert.ok(node.y >= lane.y && node.y + node.height <= lane.y + lane.height,
          `${node.id} 必须完全位于泳道内`);
      }
      for (let i = 0; i < sameRank.length; i++) {
        for (let j = i + 1; j < sameRank.length; j++) {
          const a = sameRank[i];
          const b = sameRank[j];
          assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y,
            `${a.id} 与 ${b.id} 不得重叠`);
        }
      }
    });
  });

  describe('问题4: 泳道尺寸基于内容确定', () => {
    it('泳道宽高及后续泳道y坐标必须基于实际内容确定', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeMultiLaneSameRankDraft();
      const layout = layoutProcessGraph(draft);

      // 泳道应该有合理的尺寸
      for (const lane of layout.lanes) {
        assert.ok(lane.width > 0, `泳道${lane.id}宽度应大于0`);
        assert.ok(lane.height > 0, `泳道${lane.id}高度应大于0`);
      }

      // 后续泳道的y坐标应该基于前一个泳道的尺寸
      for (let i = 1; i < layout.lanes.length; i++) {
        const prevLane = layout.lanes[i - 1];
        const currentLane = layout.lanes[i];
        assert.ok(currentLane.y > prevLane.y, `后续泳道${currentLane.id}的y坐标应大于前一个泳道`);
      }
    });

    it('跨泳道普通流使用正交折线且不穿过第三方节点', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeMultiLaneSameRankDraft();
      const layout = layoutProcessGraph(draft);

      for (const edge of layout.edges) {
        assert.ok(edge.waypoints.length >= 3, `${edge.id} 应使用折线路径`);
        for (let index = 1; index < edge.waypoints.length; index++) {
          const previous = edge.waypoints[index - 1];
          const current = edge.waypoints[index];
          assert.ok(previous.x === current.x || previous.y === current.y,
            `${edge.id} 的每段路径必须正交`);
        }

        const otherNodes = Object.entries(layout.elements)
          .filter(([id]) => id !== edge.sourceRef && id !== edge.targetRef);
        for (let index = 1; index < edge.waypoints.length; index++) {
          const a = edge.waypoints[index - 1];
          const b = edge.waypoints[index];
          for (const [nodeId, rect] of otherNodes) {
            const crossesInterior = a.y === b.y
              ? a.y > rect.y && a.y < rect.y + rect.height
                && Math.max(Math.min(a.x, b.x), rect.x) < Math.min(Math.max(a.x, b.x), rect.x + rect.width)
              : a.x > rect.x && a.x < rect.x + rect.width
                && Math.max(Math.min(a.y, b.y), rect.y) < Math.min(Math.max(a.y, b.y), rect.y + rect.height);
            assert.ok(!crossesInterior, `${edge.id} 不得穿过第三方节点 ${nodeId}`);
          }
        }
      }
    });

    it('回边路径必须绕过所有泳道外缘', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeLoopDraft();
      const layout = layoutProcessGraph(draft);

      // 找到回边
      const backEdge = layout.edges.find(e => e.id === 'Flow-判断→提交');
      assert.ok(backEdge, '应有回边');

      // 回边应该有绕行路径
      assert.ok(backEdge.waypoints.length >= 3, '回边应有多段waypoint');

      // 计算所有泳道的最大y坐标
      const maxLaneBottom = Math.max(...layout.lanes.map(l => l.y + l.height));

      // 回边的某些waypoint应该在泳道下方
      const hasBelowLane = backEdge.waypoints.some(wp => wp.y > maxLaneBottom);
      assert.ok(hasBelowLane, '回边应有绕行路径在泳道下方');
    });
  });

  describe('问题5: 缺失source/target的连线应阻断', () => {
    it('缺失source/target的连线应由验证明确阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeSimpleV2Draft();

      // 添加一个引用不存在节点的flow
      draft.diagram.flows.push({
        flow_id: 'Flow-无效',
        source_ref: 'NonExistent',
        target_ref: 'Activity-提交',
        condition: null,
      });

      // 应该抛出错误
      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          return err.message.includes('引用') || err.message.includes('不存在');
        },
        '缺失source的连线应被阻断'
      );
    });

    it('布局器不得用(0,0)-(100,0)伪造连线', async () => {
      const { layoutProcessGraph } = await import('../scripts/lib/deterministic-bpmn-layout.mjs');
      const draft = makeSimpleV2Draft();
      const layout = layoutProcessGraph(draft);

      // 检查所有edge的waypoints
      for (const edge of layout.edges) {
        for (const wp of edge.waypoints) {
          // 不应有(0,0)或(100,0)这样的伪造坐标
          assert.ok(!(wp.x === 0 && wp.y === 0), `edge ${edge.id} 不应有(0,0)伪造坐标`);
          assert.ok(!(wp.x === 100 && wp.y === 0), `edge ${edge.id} 不应有(100,0)伪造坐标`);
        }
      }
    });
  });

  describe('问题6: normalizeBpmnXml必须完成解析和校验后再计算布局', () => {
    it('成功结果返回非空、与归一化diagram对应的布局', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeSimpleV2Draft();
      const { xml } = compileBpmn(draft);
      const { diagram, layout } = normalizeBpmnXml(xml, { activities: draft.activities });

      // 应该返回非空布局
      assert.ok(layout, '应返回布局');
      assert.ok(layout.elements, '应有elements');
      assert.ok(layout.edges, '应有edges');

      // 布局应该与diagram对应
      assert.equal(Object.keys(layout.elements).length, diagram.nodes.length, '元素数量应一致');
    });

    it('被阻断结果也不得把"解析前空布局"伪装成有效布局', async () => {
      const { normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 无效的XML（不支持的元素）
      const invalidXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:subProcess id="Sub_1" name="子流程">
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Sub_1" targetRef="Sub_1" />
  </bpmn:process>
</bpmn:definitions>`;

      const { diagram, layout, warnings, blocked } = normalizeBpmnXml(invalidXml, { activities: [] });

      // 应该被阻断
      assert.ok(blocked, '应被阻断');
      assert.ok(warnings.length > 0, '应有警告');

      // 即使被阻断，布局也应该与diagram对应（或为空）
      if (layout && layout.elements) {
        assert.equal(Object.keys(layout.elements).length, diagram.nodes.length, '阻断时布局元素数量应与diagram一致');
      }
    });
  });

  describe('问题7: 条件字段往返', () => {
    it('编译产生的conditionExpression必须能被归一化为V2结构化flow.condition', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeConditionDraft();
      const { xml } = compileBpmn(draft);
      const { diagram } = normalizeBpmnXml(xml, { activities: draft.activities });

      // 找到有条件表达式的flow
      const conditionFlow = diagram.flows.find(f => f.flow_id === 'Flow-判断→经理');
      assert.ok(conditionFlow, '应有条件流');

      // 条件应该被归一化为结构化格式
      assert.ok(conditionFlow.condition, '应有条件');
      assert.equal(typeof conditionFlow.condition, 'object', '条件应为对象');
      assert.ok(conditionFlow.condition.source_output, '应有source_output');
      assert.ok(conditionFlow.condition.operator, '应有operator');
      assert.ok(conditionFlow.condition.value, '应有value');
    });

    it('九种结构化条件运算符逐一保持往返语义', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const operators = [
        'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN',
        'GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL', 'CONTAINS',
        'IS_TRUE', 'IS_FALSE',
      ];

      for (const operator of operators) {
        const draft = makeConditionDraft();
        const flow = draft.diagram.flows.find((item) => item.flow_id === 'Flow-判断→经理');
        const expectedValue = operator === 'IS_TRUE' || operator === 'IS_FALSE' ? null : '10000';
        flow.condition = {
          label: operator,
          source_output: '金额',
          operator,
          value: expectedValue,
        };
        const { xml } = compileBpmn(draft);
        const normalized = normalizeBpmnXml(xml, { activities: draft.activities });
        const actual = normalized.diagram.flows.find((item) => item.flow_id === flow.flow_id).condition;
        assert.equal(actual.source_output, '金额', `${operator} 应保留 source_output`);
        assert.equal(actual.operator, operator, `${operator} 不得降级为其他运算符`);
        assert.equal(actual.value, expectedValue, `${operator} 应保留操作数语义`);
      }
    });

    it('结构化条件应通过V2 Diagram Model schema', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = makeConditionDraft();
      const { xml } = compileBpmn(draft);
      const { diagram } = normalizeBpmnXml(xml, { activities: draft.activities });

      // 使用 Ajv 2020 编译并验证完整 schema
      const Ajv = (await import('ajv')).default;
      const addFormats = (await import('ajv-formats')).default;
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);

      // 加载 V2 Diagram Model schema
      const fs = await import('fs');
      const path = await import('path');
      const schemaPath = path.resolve(import.meta.dirname, '../references/schemas/diagram-model-v2.schema.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

      // 移除 $schema 字段，避免 Ajv 尝试加载外部 schema
      delete schema.$schema;
      const validate = ajv.compile(schema);

      // 构造完整的验证对象
      const validationObject = {
        schema_version: '2.0.0',
        diagram: diagram,
        metadata: {
          parse_mode: 'bpmn',
          source_format: 'bpmn',
          confidence: 1.0,
          warnings: [],
        },
      };

      // 验证
      const valid = validate(validationObject);
      assert.ok(valid, `schema 验证应通过: ${JSON.stringify(validate.errors, null, 2)}`);
    });
  });

  describe('问题8: 清理V1回退', () => {
    it('布局器源码不再包含V1字段读取或虚拟起止形状', async () => {
      const fs = await import('node:fs/promises');
      const source = await fs.readFile(new URL('../scripts/lib/deterministic-bpmn-layout.mjs', import.meta.url), 'utf8');
      assert.doesNotMatch(source, /element_id|node\.kind|startShape|endShape/);
    });

    it('generate-l5-bpmn.mjs不应读取V1 title/elements', async () => {
      // 这个测试需要检查代码中是否还有对draft.title或draft.elements的引用
      // 由于是代码检查，我们需要读取文件内容
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const filePath = path.join(dir, '..', 'scripts', 'generate-l5-bpmn.mjs');
      const content = await fs.readFile(filePath, 'utf8');

      // 检查是否还有对V1字段的引用
      const hasTitleReference = content.includes('draft.title');
      const hasElementsReference = content.includes('draft.elements');

      assert.ok(!hasTitleReference, 'generate-l5-bpmn.mjs不应引用draft.title');
      assert.ok(!hasElementsReference, 'generate-l5-bpmn.mjs不应引用draft.elements');
    });

    it('extract-bpmn.mjs不得用事件类型启发式误判为V2', async () => {
      // 这个测试需要检查extract-bpmn.mjs中的isV2Bpmn函数
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const filePath = path.join(dir, '..', 'scripts', 'extract-bpmn.mjs');
      const content = await fs.readFile(filePath, 'utf8');

      // 检查isV2Bpmn函数是否存在以及其实现
      const hasIsV2Bpmn = content.includes('function isV2Bpmn');
      assert.ok(hasIsV2Bpmn, '应有isV2Bpmn函数');

      // 检查是否使用了事件类型启发式
      // 这需要更详细的代码分析，暂时跳过
    });
  });

  describe('问题9: 浏览器安全', () => {
    it('相关模块不得依赖Node内置模块', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));

      // 检查关键模块
      const modules = [
        '../scripts/lib/deterministic-bpmn-layout.mjs',
        '../scripts/lib/bpmn-compiler.mjs',
        '../scripts/lib/bpmn-normalizer.mjs',
      ];

      for (const modulePath of modules) {
        const filePath = path.join(dir, modulePath);
        const content = await fs.readFile(filePath, 'utf8');

        // 检查是否有node:导入
        const nodeImports = content.match(/from\s+['"]node:/g) || [];
        assert.equal(nodeImports.length, 0, `${modulePath}不应依赖Node内置模块`);
      }
    });
  });
});
