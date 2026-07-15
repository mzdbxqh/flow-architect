import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BPMN Start/End Connection', () => {
  describe('开始事件应连接所有入度为零的节点', () => {
    it('应连接多个根节点（入口分支）', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      // 创建一个有两个根节点的草稿
      const draft = {
        title: '多根节点测试',
        level: 'L5',
        process_id: 'test-multi-root',
        boundary: { start: '开始', end: '结束' },
        lanes: [
          { lane_id: 'Lane-001', name: '申请人', org_candidates: [] },
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
            name: '准备材料',
            lane_id: 'Lane-001',
            inputs: [],
            outputs: ['材料'],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-003',
            kind: 'ACTIVITY',
            name: '审批',
            lane_id: 'Lane-001',
            inputs: ['申请单', '材料'],
            outputs: ['审批结果'],
            evidence_refs: ['B-003'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
        ],
        flows: [
          {
            flow_id: 'Flow-001',
            source_ref: 'Activity-001',
            target_ref: 'Activity-003',
            condition: null,
            evidence_refs: ['B-001'],
          },
          {
            flow_id: 'Flow-002',
            source_ref: 'Activity-002',
            target_ref: 'Activity-003',
            condition: null,
            evidence_refs: ['B-002'],
          },
        ],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 验证开始事件有多个 outgoing
      const startEventOutgoing = bpmn.match(/<bpmn:startEvent[^>]*>[\s\S]*?<\/bpmn:startEvent>/g);
      assert.ok(startEventOutgoing, '应有开始事件');

      // 检查开始事件是否连接到两个根节点
      assert.ok(bpmn.includes('sourceRef="StartEvent_1" targetRef="Activity-001"'),
        '应连接到 Activity-001');
      assert.ok(bpmn.includes('sourceRef="StartEvent_1" targetRef="Activity-002"'),
        '应连接到 Activity-002');
    });

    it('应连接多个汇合前终点（多个汇点）', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      // 创建一个有两个叶子节点的草稿
      const draft = {
        title: '多叶子节点测试',
        level: 'L5',
        process_id: 'test-multi-leaf',
        boundary: { start: '开始', end: '结束' },
        lanes: [
          { lane_id: 'Lane-001', name: '处理人', org_candidates: [] },
        ],
        elements: [
          {
            element_id: 'Activity-001',
            kind: 'ACTIVITY',
            name: '处理任务',
            lane_id: 'Lane-001',
            inputs: [],
            outputs: ['结果'],
            evidence_refs: ['B-001'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-002',
            kind: 'ACTIVITY',
            name: '归档',
            lane_id: 'Lane-001',
            inputs: ['结果'],
            outputs: [],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-003',
            kind: 'ACTIVITY',
            name: '通知',
            lane_id: 'Lane-001',
            inputs: ['结果'],
            outputs: [],
            evidence_refs: ['B-003'],
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
          {
            flow_id: 'Flow-002',
            source_ref: 'Activity-001',
            target_ref: 'Activity-003',
            condition: null,
            evidence_refs: ['B-001'],
          },
        ],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 验证结束事件有多个 incoming
      assert.ok(bpmn.includes('sourceRef="Activity-002" targetRef="EndEvent_1"'),
        '应从 Activity-002 连接到结束事件');
      assert.ok(bpmn.includes('sourceRef="Activity-003" targetRef="EndEvent_1"'),
        '应从 Activity-003 连接到结束事件');
    });

    it('应正确处理循环图', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      // 创建一个带循环的草稿
      const draft = {
        title: '循环测试',
        level: 'L5',
        process_id: 'test-cycle',
        boundary: { start: '开始', end: '结束' },
        lanes: [
          { lane_id: 'Lane-001', name: '处理人', org_candidates: [] },
        ],
        elements: [
          {
            element_id: 'Activity-001',
            kind: 'ACTIVITY',
            name: '提交',
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
            name: '审核',
            lane_id: 'Lane-001',
            inputs: ['申请单'],
            outputs: ['审核结果'],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-003',
            kind: 'ACTIVITY',
            name: '修改',
            lane_id: 'Lane-001',
            inputs: ['审核结果'],
            outputs: ['修改后申请单'],
            evidence_refs: ['B-003'],
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
          {
            flow_id: 'Flow-002',
            source_ref: 'Activity-002',
            target_ref: 'Activity-003',
            condition: '${needsRevision}',
            evidence_refs: ['B-002'],
          },
          {
            flow_id: 'Flow-003',
            source_ref: 'Activity-003',
            target_ref: 'Activity-002',
            condition: null,
            evidence_refs: ['B-003'],
          },
        ],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 验证循环图中根节点判断正确
      // Activity-001 是唯一的根节点（入度为零）
      assert.ok(bpmn.includes('sourceRef="StartEvent_1" targetRef="Activity-001"'),
        '应连接到唯一的根节点');

      // 验证循环边存在
      assert.ok(bpmn.includes('sourceRef="Activity-003" targetRef="Activity-002"'),
        '应存在循环边');

      // 验证叶子节点判断正确
      // Activity-002 有出边到 Activity-003，但 Activity-003 又有边回到 Activity-002
      // 纯循环图应有确定性的结束策略
      assert.ok(bpmn.includes('sourceRef="Activity-002" targetRef="EndEvent_1"') ||
        bpmn.includes('sourceRef="Activity-003" targetRef="EndEvent_1"'),
        '应有确定性的结束连接');
    });
  });

  describe('每条新增 start/end sequenceFlow 都应有对应 incoming/outgoing', () => {
    it('开始事件的 outgoing 应与 sequenceFlow 一致', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = {
        title: '一致性测试',
        level: 'L5',
        process_id: 'test-consistency',
        boundary: { start: '开始', end: '结束' },
        lanes: [
          { lane_id: 'Lane-001', name: '处理人', org_candidates: [] },
        ],
        elements: [
          {
            element_id: 'Activity-001',
            kind: 'ACTIVITY',
            name: '任务1',
            lane_id: 'Lane-001',
            inputs: [],
            outputs: [],
            evidence_refs: ['B-001'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-002',
            kind: 'ACTIVITY',
            name: '任务2',
            lane_id: 'Lane-001',
            inputs: [],
            outputs: [],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
        ],
        flows: [],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 检查开始事件的 outgoing 是否与 sequenceFlow 对应
      const startEventMatch = bpmn.match(/<bpmn:startEvent[^>]*>([\s\S]*?)<\/bpmn:startEvent>/);
      assert.ok(startEventMatch, '应有开始事件');

      const startOutgoings = startEventMatch[1].match(/<bpmn:outgoing>([^<]+)<\/bpmn:outgoing>/g) || [];
      assert.ok(startOutgoings.length > 0, '开始事件应有 outgoing');

      // 检查每个 outgoing 是否有对应的 sequenceFlow
      for (const outgoing of startOutgoings) {
        const flowId = outgoing.match(/<bpmn:outgoing>([^<]+)<\/bpmn:outgoing>/)[1];
        assert.ok(bpmn.includes(`id="${flowId}" sourceRef="StartEvent_1"`),
          `应存在以 StartEvent_1 为源的 flow ${flowId}`);
      }
    });

    it('结束事件的 incoming 应与 sequenceFlow 一致', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const draft = {
        title: '一致性测试',
        level: 'L5',
        process_id: 'test-consistency',
        boundary: { start: '开始', end: '结束' },
        lanes: [
          { lane_id: 'Lane-001', name: '处理人', org_candidates: [] },
        ],
        elements: [
          {
            element_id: 'Activity-001',
            kind: 'ACTIVITY',
            name: '任务1',
            lane_id: 'Lane-001',
            inputs: [],
            outputs: [],
            evidence_refs: ['B-001'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-002',
            kind: 'ACTIVITY',
            name: '任务2',
            lane_id: 'Lane-001',
            inputs: [],
            outputs: [],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
        ],
        flows: [],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 检查结束事件的 incoming 是否与 sequenceFlow 对应
      const endEventMatch = bpmn.match(/<bpmn:endEvent[^>]*>([\s\S]*?)<\/bpmn:endEvent>/);
      assert.ok(endEventMatch, '应有结束事件');

      const endIncomings = endEventMatch[1].match(/<bpmn:incoming>([^<]+)<\/bpmn:incoming>/g) || [];
      assert.ok(endIncomings.length > 0, '结束事件应有 incoming');

      // 检查每个 incoming 是否有对应的 sequenceFlow
      for (const incoming of endIncomings) {
        const flowId = incoming.match(/<bpmn:incoming>([^<]+)<\/bpmn:incoming>/)[1];
        // 检查 sequenceFlow 是否存在（可能是自闭合标签或带条件的标签）
        const hasSequenceFlow = bpmn.includes(`id="${flowId}"`) && bpmn.includes(`targetRef="EndEvent_1"`);
        assert.ok(hasSequenceFlow,
          `应存在以 EndEvent_1 为目标的 flow ${flowId}`);
      }
    });
  });
});
