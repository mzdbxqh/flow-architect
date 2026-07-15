import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('L5 BPMN Generation', () => {
  describe('generateL5Bpmn', () => {
    it('should generate valid BPMN 2.0 XML', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('<?xml'), 'Should be XML');
      assert.ok(bpmn.includes('bpmn:definitions'), 'Should have BPMN definitions');
      assert.ok(bpmn.includes('bpmn:process'), 'Should have process');
    });

    it('should include collaboration and participants for lanes', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:collaboration'), 'Should have collaboration');
      assert.ok(bpmn.includes('bpmn:participant'), 'Should have participants');
    });

    it('should create tasks for activities', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:task'), 'Should have tasks');
      assert.ok(bpmn.includes('提交申请'), 'Should include activity name');
    });

    it('should create sequence flows', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:sequenceFlow'), 'Should have sequence flows');
    });

    it('should create start and end events', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:startEvent'), 'Should have start event');
      assert.ok(bpmn.includes('bpmn:endEvent'), 'Should have end event');
    });

    it('should create exclusive gateway for decision points', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createDraftWithDecision();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:exclusiveGateway'), 'Should have gateway');
    });

    it('should generate stable IDs from draft', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn1 = generateL5Bpmn(draft);
      const bpmn2 = generateL5Bpmn(draft);

      assert.equal(bpmn1, bpmn2, 'Same draft should produce same BPMN');
    });

    it('should add documentation for evidence refs', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmn:documentation'), 'Should have documentation');
    });
  });

  describe('BPMN Layout', () => {
    it('should generate DI for all elements', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      assert.ok(bpmn.includes('bpmndi:BPMNDiagram'), 'Should have diagram');
      assert.ok(bpmn.includes('bpmndi:BPMNPlane'), 'Should have plane');
      assert.ok(bpmn.includes('dc:Bounds'), 'Should have bounds');
    });

    it('should position elements in lanes', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

      // Should have lane bounds
      assert.ok(bpmn.includes('bpmndi:BPMNShape'), 'Should have shapes');
    });

    it('should generate waypoints for flows', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = createSimpleDraft();
      const bpmn = generateL5Bpmn(draft);

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
    title: '测试流程',
    level: 'L5',
    process_id: 'test-process',
    boundary: { start: '开始', end: '结束' },
    lanes: [
      { lane_id: 'Lane-001', name: '申请人', org_candidates: [] },
      { lane_id: 'Lane-002', name: '审批人', org_candidates: [] },
    ],
    elements: [
      {
        element_id: 'Activity-001',
        kind: 'ACTIVITY',
        name: '提交申请',
        lane_id: 'Lane-001',
        inputs: [],
        outputs: ['申请单'],
        evidence_refs: ['B-001'],
        certainty: 'EXPLICIT',
        question_ids: [],
      },
      {
        element_id: 'Activity-002',
        kind: 'ACTIVITY',
        name: '审批申请',
        lane_id: 'Lane-002',
        inputs: ['申请单'],
        outputs: ['审批结果'],
        evidence_refs: ['B-002'],
        certainty: 'EXPLICIT',
        question_ids: [],
      },
    ],
    flows: [
      {
        flow_id: 'Flow-001',
        source_ref: 'Activity-001',
        target_ref: 'Activity-002',
        condition: null,
        evidence_refs: ['B-001'],
      },
    ],
    questions: [],
    conflicts: [],
    source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
  };
}

function createDraftWithDecision() {
  return {
    ...createSimpleDraft(),
    elements: [
      ...createSimpleDraft().elements,
      {
        element_id: 'Gateway-001',
        kind: 'DECISION',
        name: '金额判断',
        lane_id: 'Lane-002',
        inputs: ['申请单'],
        outputs: [],
        evidence_refs: ['B-003'],
        certainty: 'EXPLICIT',
        question_ids: [],
      },
    ],
  };
}
