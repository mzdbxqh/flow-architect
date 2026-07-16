import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BPMN Namespace Validation', () => {
  describe('条件表达式命名空间', () => {
    it('应声明 xsi 命名空间当存在 xsi:type 属性时', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 创建一个带条件流的草稿
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-condition',
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
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '小额审批',
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
            { lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'Gateway-001', node_type: 'GATEWAY_XOR', name: '金额判断', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '小额审批', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            { flow_id: 'Flow-001', source_ref: 'Start-1', target_ref: 'Activity-001', condition: null },
            { flow_id: 'Flow-002', source_ref: 'Activity-001', target_ref: 'Gateway-001', condition: null },
            { flow_id: 'Flow-003', source_ref: 'Gateway-001', target_ref: 'Activity-002', condition: '${amount < 1000}' },
            { flow_id: 'Flow-004', source_ref: 'Activity-002', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 验证存在 xsi:type 属性
      assert.ok(bpmn.includes('xsi:type="bpmn:tFormalExpression"'),
        '应包含 xsi:type 属性');

      // 验证声明了 xsi 命名空间
      assert.ok(bpmn.includes('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'),
        '应声明 xmlns:xsi 命名空间');
    });

    it('不应声明 xsi 命名空间当不存在 xsi:type 属性时', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 创建一个无条件流的草稿
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-no-condition',
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
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-001',
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
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            { flow_id: 'Flow-001', source_ref: 'Start-1', target_ref: 'Activity-001', condition: null },
            { flow_id: 'Flow-002', source_ref: 'Activity-001', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 无条件流时不应声明 xsi 命名空间
      assert.ok(!bpmn.includes('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'),
        '无条件流时不应声明 xmlns:xsi 命名空间');
    });

    it('生成的 BPMN 应能被 BPMN 读取器解析且无未绑定前缀', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');

      // 创建带条件流的草稿
      const draft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'test-parse',
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
            outputs: [],
            completion_criteria: [],
            references: [],
            main_task_id: 'Activity-001',
            confirmation: null,
            completeness: 'COMPLETE',
          },
          {
            activity_id: 'Act-002',
            name: '处理',
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
            { lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' },
          ],
          nodes: [
            { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
            { node_id: 'Activity-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
            { node_id: 'Gateway-001', node_type: 'GATEWAY_XOR', name: '判断', lane_id: 'Lane-001' },
            { node_id: 'Activity-002', node_type: 'MAIN_TASK', name: '处理', lane_id: 'Lane-001' },
            { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
          ],
          flows: [
            { flow_id: 'Flow-001', source_ref: 'Start-1', target_ref: 'Activity-001', condition: null },
            { flow_id: 'Flow-002', source_ref: 'Activity-001', target_ref: 'Gateway-001', condition: null },
            { flow_id: 'Flow-003', source_ref: 'Gateway-001', target_ref: 'Activity-002', condition: '${amount > 0}' },
            { flow_id: 'Flow-004', source_ref: 'Activity-002', target_ref: 'End-1', condition: null },
          ],
          task_bindings: [
            { activity_id: 'Act-001', main_task_id: 'Activity-001', confirmation_task_id: null },
            { activity_id: 'Act-002', main_task_id: 'Activity-002', confirmation_task_id: null },
          ],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = compileBpmn(draft).xml;

      // 基本 XML 格式验证
      assert.ok(bpmn.startsWith('<?xml'), '应是有效的 XML');
      assert.ok(bpmn.includes('<bpmn:definitions'), '应有 definitions 元素');
      assert.ok(bpmn.includes('</bpmn:definitions>'), '应有闭合标签');

      // 验证所有使用的前缀都有声明
      const usedPrefixes = ['bpmn:', 'bpmndi:', 'dc:', 'di:'];
      for (const prefix of usedPrefixes) {
        assert.ok(bpmn.includes(`xmlns:${prefix.slice(0, -1)}=`),
          `前缀 ${prefix} 应有命名空间声明`);
      }
    });
  });
});
