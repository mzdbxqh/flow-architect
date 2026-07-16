import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BPMN Start/End Connection', () => {
  describe('开始事件应连接所有入度为零的节点', () => {
    it('应连接多个根节点（入口分支）', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 创建一个有两个根节点的草稿（V2 格式）
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-multi-root',
          name: '多根节点测试',
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
            activity_id: 'Act-001',
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
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '准备材料',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: [],
            process_summary: '',
            outputs: ['材料'],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-002',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-003',
            name: '审批',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: ['申请单', '材料'],
            process_summary: '',
            outputs: ['审批结果'],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-003',
            confirmation: null,
            completeness: 'COMPLETE',
          },
        ],
        diagram: {
          lanes: [
            { lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '准备材料', lane_id: 'Lane-001' },
            { node_id: 'Activity-003', node_type: 'MAIN_TASK', name: '审批', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            {
              flow_id: 'Flow-start-1',
              source_ref: 'Start-1',
              target_ref: 'Activity-001',
              condition: null,
            },
            {
              flow_id: 'Flow-start-2',
              source_ref: 'Start-1',
              target_ref: 'Activity-002',
              condition: null,
            },
            {
              flow_id: 'Flow-001',
              source_ref: 'Activity-001',
              target_ref: 'Activity-003',
              condition: null,
            },
            {
              flow_id: 'Flow-002',
              source_ref: 'Activity-002',
              target_ref: 'Activity-003',
              condition: null,
            },
            {
              flow_id: 'Flow-end-1',
              source_ref: 'Activity-003',
              target_ref: 'End-1',
              condition: null,
            },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
            { activity_id: 'Act-003', main_task_id: 'Activity-003', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 验证开始事件有多个 outgoing
      const startEventOutgoing = bpmn.match(/<bpmn:startEvent[^>]*>[\s\S]*?<\/bpmn:startEvent>/g);
      assert.ok(startEventOutgoing, '应有开始事件');

      // 检查开始事件是否连接到两个根节点
      assert.ok(bpmn.includes('sourceRef="Start-1" targetRef="Activity-001"'),
        '应连接到 Activity-001');
      assert.ok(bpmn.includes('sourceRef="Start-1" targetRef="Activity-002"'),
        '应连接到 Activity-002');
    });

    it('应连接多个汇合前终点（多个汇点）', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 创建一个有两个叶子节点的草稿（V2 格式）
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-multi-leaf',
          name: '多叶子节点测试',
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
            activity_id: 'Act-001',
            name: '处理任务',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: [],
            process_summary: '',
            outputs: ['结果'],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '归档',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: ['结果'],
            process_summary: '',
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-002',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-003',
            name: '通知',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: ['结果'],
            process_summary: '',
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-003',
            confirmation: null,
            completeness: 'COMPLETE',
          },
        ],
        diagram: {
          lanes: [
            { lane_id: 'Lane-001', name: '处理人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '处理任务', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '归档', lane_id: 'Lane-001' },
            { node_id: 'Activity-003', node_type: 'MAIN_TASK', name: '通知', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            {
              flow_id: 'Flow-start-1',
              source_ref: 'Start-1',
              target_ref: 'Activity-001',
              condition: null,
            },
            {
              flow_id: 'Flow-001',
              source_ref: 'Activity-001',
              target_ref: 'Activity-002',
              condition: null,
            },
            {
              flow_id: 'Flow-002',
              source_ref: 'Activity-001',
              target_ref: 'Activity-003',
              condition: null,
            },
            {
              flow_id: 'Flow-end-1',
              source_ref: 'Activity-002',
              target_ref: 'End-1',
              condition: null,
            },
            {
              flow_id: 'Flow-end-2',
              source_ref: 'Activity-003',
              target_ref: 'End-1',
              condition: null,
            },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
            { activity_id: 'Act-003', main_task_id: 'Activity-003', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 验证结束事件有多个 incoming
      assert.ok(bpmn.includes('sourceRef="Activity-002" targetRef="End-1"'),
        '应从 Activity-002 连接到结束事件');
      assert.ok(bpmn.includes('sourceRef="Activity-003" targetRef="End-1"'),
        '应从 Activity-003 连接到结束事件');
    });

    it('应正确处理循环图', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 创建一个带循环的草稿（V2 格式）
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-cycle',
          name: '循环测试',
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
            activity_id: 'Act-001',
            name: '提交',
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
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '审核',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: ['申请单'],
            process_summary: '',
            outputs: ['审核结果'],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-002',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-003',
            name: '修改',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: ['审核结果'],
            process_summary: '',
            outputs: ['修改后申请单'],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-003',
            confirmation: null,
            completeness: 'COMPLETE',
          },
        ],
        diagram: {
          lanes: [
            { lane_id: 'Lane-001', name: '处理人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '提交', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '审核', lane_id: 'Lane-001' },
            { node_id: 'Activity-003', node_type: 'MAIN_TASK', name: '修改', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            {
              flow_id: 'Flow-start-1',
              source_ref: 'Start-1',
              target_ref: 'Activity-001',
              condition: null,
            },
            {
              flow_id: 'Flow-001',
              source_ref: 'Activity-001',
              target_ref: 'Activity-002',
              condition: null,
            },
            {
              flow_id: 'Flow-002',
              source_ref: 'Activity-002',
              target_ref: 'Activity-003',
              condition: '${needsRevision}',
            },
            {
              flow_id: 'Flow-003',
              source_ref: 'Activity-003',
              target_ref: 'Activity-002',
              condition: null,
            },
            {
              flow_id: 'Flow-end-1',
              source_ref: 'Activity-002',
              target_ref: 'End-1',
              condition: null,
            },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
            { activity_id: 'Act-003', main_task_id: 'Activity-003', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 验证循环图中根节点判断正确
      // Activity-001 是唯一的根节点（入度为零）
      assert.ok(bpmn.includes('sourceRef="Start-1" targetRef="Activity-001"'),
        '应连接到唯一的根节点');

      // 验证循环边存在
      assert.ok(bpmn.includes('sourceRef="Activity-003" targetRef="Activity-002"'),
        '应存在循环边');

      // 验证叶子节点判断正确
      // Activity-002 有出边到 Activity-003，但 Activity-003 又有边回到 Activity-002
      // 纯循环图应有确定性的结束策略
      assert.ok(bpmn.includes('sourceRef="Activity-002" targetRef="End-1"') ||
        bpmn.includes('sourceRef="Activity-003" targetRef="End-1"'),
        '应有确定性的结束连接');
    });
  });

  describe('每条新增 start/end sequenceFlow 都应有对应 incoming/outgoing', () => {
    it('开始事件的 outgoing 应与 sequenceFlow 一致', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-consistency',
          name: '一致性测试',
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
            activity_id: 'Act-001',
            name: '任务1',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: [],
            process_summary: '',
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '任务2',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: [],
            process_summary: '',
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-002',
            confirmation: null,
            completeness: 'COMPLETE',
          },
        ],
        diagram: {
          lanes: [
            { lane_id: 'Lane-001', name: '处理人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '任务1', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '任务2', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            {
              flow_id: 'Flow-start-1',
              source_ref: 'Start-1',
              target_ref: 'Activity-001',
              condition: null,
            },
            {
              flow_id: 'Flow-001',
              source_ref: 'Activity-001',
              target_ref: 'Activity-002',
              condition: null,
            },
            {
              flow_id: 'Flow-end-1',
              source_ref: 'Activity-002',
              target_ref: 'End-1',
              condition: null,
            },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 检查开始事件的 outgoing 是否与 sequenceFlow 对应
      const startEventMatch = bpmn.match(/<bpmn:startEvent[^>]*>([\s\S]*?)<\/bpmn:startEvent>/);
      assert.ok(startEventMatch, '应有开始事件');

      const startOutgoings = startEventMatch[1].match(/<bpmn:outgoing>([^<]+)<\/bpmn:outgoing>/g) || [];
      assert.ok(startOutgoings.length > 0, '开始事件应有 outgoing');

      // 检查每个 outgoing 是否有对应的 sequenceFlow
      for (const outgoing of startOutgoings) {
        const flowId = outgoing.match(/<bpmn:outgoing>([^<]+)<\/bpmn:outgoing>/)[1];
        assert.ok(bpmn.includes(`id="${flowId}" sourceRef="Start-1"`),
          `应存在以 StartEvent_1 为源的 flow ${flowId}`);
      }
    });

    it('结束事件的 incoming 应与 sequenceFlow 一致', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-consistency',
          name: '一致性测试',
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
            activity_id: 'Act-001',
            name: '任务1',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: [],
            process_summary: '',
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '任务2',
            description: '',
            activity_type: 'STANDARD',
            responsibility_model: 'RASCI',
            role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
            sla: null,
            tools: [],
            inputs: [],
            process_summary: '',
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-002',
            confirmation: null,
            completeness: 'COMPLETE',
          },
        ],
        diagram: {
          lanes: [
            { lane_id: 'Lane-001', name: '处理人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '任务1', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '任务2', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            {
              flow_id: 'Flow-start-1',
              source_ref: 'Start-1',
              target_ref: 'Activity-001',
              condition: null,
            },
            {
              flow_id: 'Flow-001',
              source_ref: 'Activity-001',
              target_ref: 'Activity-002',
              condition: null,
            },
            {
              flow_id: 'Flow-end-1',
              source_ref: 'Activity-002',
              target_ref: 'End-1',
              condition: null,
            },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 2, formats: ['md'], evidence_refs: ['B-001', 'B-002'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 检查结束事件的 incoming 是否与 sequenceFlow 对应
      const endEventMatch = bpmn.match(/<bpmn:endEvent[^>]*>([\s\S]*?)<\/bpmn:endEvent>/);
      assert.ok(endEventMatch, '应有结束事件');

      const endIncomings = endEventMatch[1].match(/<bpmn:incoming>([^<]+)<\/bpmn:incoming>/g) || [];
      assert.ok(endIncomings.length > 0, '结束事件应有 incoming');

      // 检查每个 incoming 是否有对应的 sequenceFlow
      for (const incoming of endIncomings) {
        const flowId = incoming.match(/<bpmn:incoming>([^<]+)<\/bpmn:incoming>/)[1];
        // 检查 sequenceFlow 是否存在（可能是自闭合标签或带条件的标签）
        const hasSequenceFlow = bpmn.includes(`id="${flowId}"`) && bpmn.includes(`targetRef="End-1"`);
        assert.ok(hasSequenceFlow,
          `应存在以 EndEvent_1 为目标的 flow ${flowId}`);
      }
    });
  });
});
