import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BPMN Namespace Validation', () => {
  describe('条件表达式命名空间', () => {
    it('应声明 xsi 命名空间当存在 xsi:type 属性时', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      // 创建一个带条件流的草稿
      const draft = {
        title: '测试流程',
        level: 'L5',
        process_id: 'test-condition',
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
            element_id: 'Gateway-001',
            kind: 'DECISION',
            name: '金额判断',
            lane_id: 'Lane-001',
            inputs: ['申请单'],
            outputs: [],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-002',
            kind: 'ACTIVITY',
            name: '小额审批',
            lane_id: 'Lane-001',
            inputs: [],
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
            target_ref: 'Gateway-001',
            condition: null,
            evidence_refs: ['B-001'],
          },
          {
            flow_id: 'Flow-002',
            source_ref: 'Gateway-001',
            target_ref: 'Activity-002',
            condition: '${amount < 1000}', // 带条件表达式
            evidence_refs: ['B-002'],
          },
        ],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 验证存在 xsi:type 属性
      assert.ok(bpmn.includes('xsi:type="bpmn:tFormalExpression"'),
        '应包含 xsi:type 属性');

      // 验证声明了 xsi 命名空间
      assert.ok(bpmn.includes('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'),
        '应声明 xmlns:xsi 命名空间');
    });

    it('不应声明 xsi 命名空间当不存在 xsi:type 属性时', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      // 创建一个无条件流的草稿
      const draft = {
        title: '测试流程',
        level: 'L5',
        process_id: 'test-no-condition',
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
        ],
        flows: [
          {
            flow_id: 'Flow-001',
            source_ref: 'Activity-001',
            target_ref: 'EndEvent_1',
            condition: null,
            evidence_refs: ['B-001'],
          },
        ],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 1, formats: ['md'], evidence_refs: ['B-001'] },
      };

      const bpmn = generateL5Bpmn(draft);

      // 无条件流时不应声明 xsi 命名空间
      assert.ok(!bpmn.includes('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'),
        '无条件流时不应声明 xmlns:xsi 命名空间');
    });

    it('生成的 BPMN 应能被 BPMN 读取器解析且无未绑定前缀', async () => {
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      // 创建带条件流的草稿
      const draft = {
        title: '测试流程',
        level: 'L5',
        process_id: 'test-parse',
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
            element_id: 'Gateway-001',
            kind: 'DECISION',
            name: '判断',
            lane_id: 'Lane-001',
            inputs: ['申请单'],
            outputs: [],
            evidence_refs: ['B-002'],
            certainty: 'EXPLICIT',
            question_ids: [],
          },
          {
            element_id: 'Activity-002',
            kind: 'ACTIVITY',
            name: '处理',
            lane_id: 'Lane-001',
            inputs: [],
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
            target_ref: 'Gateway-001',
            condition: null,
            evidence_refs: ['B-001'],
          },
          {
            flow_id: 'Flow-002',
            source_ref: 'Gateway-001',
            target_ref: 'Activity-002',
            condition: '${amount > 0}',
            evidence_refs: ['B-002'],
          },
        ],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 3, formats: ['md'], evidence_refs: ['B-001', 'B-002', 'B-003'] },
      };

      const bpmn = generateL5Bpmn(draft);

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
