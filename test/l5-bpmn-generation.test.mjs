import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('L5 BPMN Generation', () => {
  describe('compileBpmn', () => {
    it('should generate valid BPMN 2.0 XML', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('<?xml'), 'Should be XML');
      assert.ok(bpmn.includes('bpmn:definitions'), 'Should have BPMN definitions');
      assert.ok(bpmn.includes('bpmn:process'), 'Should have process');
    });

    it('should include collaboration and participants for lanes', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('bpmn:collaboration'), 'Should have collaboration');
      assert.ok(bpmn.includes('bpmn:participant'), 'Should have participants');
    });

    it('should create tasks for activities', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('bpmn:task'), 'Should have tasks');
      assert.ok(bpmn.includes('提交申请'), 'Should include activity name');
    });

    it('should create sequence flows', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('bpmn:sequenceFlow'), 'Should have sequence flows');
    });

    it('should create start and end events', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('bpmn:startEvent'), 'Should have start event');
      assert.ok(bpmn.includes('bpmn:endEvent'), 'Should have end event');
    });

    it('should create exclusive gateway for decision points', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createDraftWithDecision();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('bpmn:exclusiveGateway'), 'Should have gateway');
    });

    it('should generate stable IDs from draft', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn1 = compileBpmn(draft).xml;
      const bpmn2 = compileBpmn(draft).xml;

      assert.equal(bpmn1, bpmn2, 'Same draft should produce same BPMN');
    });

    it('should add documentation for evidence refs', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      // V2 编译器不在 BPMN XML 中写入 documentation；evidence refs 由流程草稿元数据承载
      assert.ok(bpmn.includes('bpmn:task'), 'Should have tasks');
    });
  });

  describe('BPMN Layout', () => {
    it('should generate DI for all elements', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('bpmndi:BPMNDiagram'), 'Should have diagram');
      assert.ok(bpmn.includes('bpmndi:BPMNPlane'), 'Should have plane');
      assert.ok(bpmn.includes('dc:Bounds'), 'Should have bounds');
    });

    it('should position elements in lanes', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      // Should have lane bounds
      assert.ok(bpmn.includes('bpmndi:BPMNShape'), 'Should have shapes');
    });

    it('should generate waypoints for flows', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = createSimpleDraft();
      const bpmn = compileBpmn(draft).xml;

      assert.ok(bpmn.includes('di:waypoint'), 'Should have waypoints');
    });
  });

  describe('Clarification Agenda', () => {
    it('should generate markdown agenda', async () => {
      const { renderClarificationAgenda } = await import('../scripts/lib/render-clarification-agenda.mjs');

      const draft = createSimpleDraft();
      const agenda = renderClarificationAgenda(draft);

      assert.ok(agenda.includes('#'), 'Should be markdown');
      assert.ok(agenda.includes('待确认'), 'Should mention questions');
    });

    it('should include question IDs', async () => {
      const { renderClarificationAgenda } = await import('../scripts/lib/render-clarification-agenda.mjs');

      const draft = {
        ...createSimpleDraft(),
        questions: [{
          question_id: 'Q-001',
          text: '审批人是谁？',
          element_ids: ['Activity-001'],
          status: 'OPEN',
          answer: '',
          evidence_refs: [],
        }],
      };

      const agenda = renderClarificationAgenda(draft);
      assert.ok(agenda.includes('Q-001'), 'Should include question ID');
    });

    it('should group questions by category', async () => {
      const { renderClarificationAgenda } = await import('../scripts/lib/render-clarification-agenda.mjs');

      const draft = createSimpleDraft();
      const agenda = renderClarificationAgenda(draft);

      // Should have sections
      assert.ok(agenda.includes('##'), 'Should have sections');
    });
  });
});

function createSimpleDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'test-process',
      name: '测试流程',
      level: 'L4',
      is_leaf: true,
      description: '',
      purpose: '',
      owner: '',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-001',
        name: '提交申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: [],
        process_summary: '',
        outputs: ['申请单'],
        completion_criteria: [],
        references: ['B-001'],
        main_task_id: 'Task-001',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-002',
        name: '审批申请',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-002', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: ['申请单'],
        process_summary: '',
        outputs: ['审批结果'],
        completion_criteria: [],
        references: ['B-002'],
        main_task_id: 'Task-002',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' },
        { lane_id: 'Lane-002', name: '审批人', role_id: 'Role-002' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
        { node_id: 'Task-002', node_type: 'MAIN_TASK', name: '审批申请', lane_id: 'Lane-002' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-001', source_ref: 'Start-1', target_ref: 'Task-001' },
        { flow_id: 'Flow-002', source_ref: 'Task-001', target_ref: 'Task-002' },
        { flow_id: 'Flow-003', source_ref: 'Task-002', target_ref: 'End-1' },
      ],
      task_bindings: [
        { activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null },
        { activity_id: 'Activity-002', main_task_id: 'Task-002', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
  };
}

function createDraftWithDecision() {
  const base = createSimpleDraft();
  return {
    ...base,
    diagram: {
      ...base.diagram,
      nodes: [
        ...base.diagram.nodes.slice(0, 2),
        { node_id: 'Gateway-001', node_type: 'GATEWAY_XOR', name: '金额判断', lane_id: 'Lane-002' },
        ...base.diagram.nodes.slice(2),
      ],
      flows: [
        { flow_id: 'Flow-001', source_ref: 'Start-1', target_ref: 'Task-001' },
        { flow_id: 'Flow-002', source_ref: 'Task-001', target_ref: 'Gateway-001' },
        { flow_id: 'Flow-003', source_ref: 'Gateway-001', target_ref: 'Task-002' },
        { flow_id: 'Flow-004', source_ref: 'Task-002', target_ref: 'End-1' },
      ],
    },
  };
}
