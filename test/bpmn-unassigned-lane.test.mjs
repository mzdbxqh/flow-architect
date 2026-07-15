import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BPMN Unassigned Lane', () => {
  describe('未分配泳道仍生成合法 BPMN', () => {
    it('应生成 Lane-unassigned 占位泳道当无 ROLE 时', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const manifest = { title: '无角色测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '1.0.0',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          facts: [
            // 只有活动，没有 ROLE 事实
            {
              fact_id: 'F-001',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'submit',
              label: '提交申请',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-001'],
            },
            {
              fact_id: 'F-002',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'review',
              label: '审核申请',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-002'],
            },
          ],
          uncertainties: [],
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      // 验证生成了 OPEN 问题
      const roleQuestion = result.process_draft.questions.find(q =>
        q.text.includes('角色') || q.text.includes('责任')
      );
      assert.ok(roleQuestion, '应生成角色缺失问题');
      assert.equal(roleQuestion.status, 'OPEN', '问题状态应为 OPEN');

      // 验证元素使用了 Lane-unassigned
      const unassignedElements = result.process_draft.elements.filter(e =>
        e.lane_id === 'Lane-unassigned'
      );
      assert.ok(unassignedElements.length > 0, '应有元素使用 Lane-unassigned');

      // 生成 BPMN 并验证结构合法性
      const bpmn = generateL5Bpmn(result.process_draft);

      // 验证存在 Lane-unassigned 泳道
      assert.ok(bpmn.includes('id="Lane_Lane-unassigned"'),
        '应存在 Lane-unassigned 泳道');

      // 验证所有 flowNodeRef 引用已存在的节点
      const flowNodeRefs = bpmn.match(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g) || [];
      for (const ref of flowNodeRefs) {
        const nodeId = ref.match(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/)[1];
        // 检查节点是否在 elements 中存在
        const elementExists = result.process_draft.elements.some(e => e.element_id === nodeId);
        assert.ok(elementExists, `flowNodeRef ${nodeId} 应引用已存在的节点`);
      }

      // 验证所有节点都属于已声明的泳道
      const declaredLanes = bpmn.match(/id="Lane_([^"]+)"/g) || [];
      const declaredLaneIds = declaredLanes.map(l => l.match(/id="Lane_([^"]+)"/)[1]);
      for (const element of result.process_draft.elements) {
        // 元素的 lane_id 格式是 "Lane-xxx"，BPMN 中的泳道 ID 格式是 "Lane_Lane-xxx"
        const expectedLaneId = element.lane_id;
        assert.ok(declaredLaneIds.includes(expectedLaneId),
          `元素 ${element.element_id} 的泳道 ${expectedLaneId} 应已声明`);
      }
    });

    it('应为无角色活动生成 OPEN 问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: '测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '1.0.0',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          facts: [
            // 有角色
            {
              fact_id: 'F-001',
              kind: 'ROLE',
              process_key: 'test',
              subject_key: 'manager',
              label: '经理',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-001'],
            },
            // 活动没有 role 属性
            {
              fact_id: 'F-002',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'act',
              label: '执行任务',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-002'],
            },
          ],
          uncertainties: [],
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      // 验证生成了角色缺失问题
      const roleQuestion = result.process_draft.questions.find(q =>
        q.text.includes('角色') || q.text.includes('责任')
      );
      assert.ok(roleQuestion, '应生成角色缺失问题');
      assert.equal(roleQuestion.status, 'OPEN', '问题状态应为 OPEN');

      // 验证元素使用了第一个泳道作为占位
      const element = result.process_draft.elements.find(e => e.name === '执行任务');
      assert.ok(element, '应存在元素');
      assert.equal(element.lane_id, result.process_draft.lanes[0]?.lane_id,
        '应使用第一个泳道作为占位');
    });

    it('生成的 BPMN 应包含所有 flowNodeRef 引用已存在节点', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const manifest = { title: '引用完整性测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '1.0.0',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          facts: [
            {
              fact_id: 'F-001',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'task1',
              label: '任务1',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-001'],
            },
            {
              fact_id: 'F-002',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'task2',
              label: '任务2',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-002'],
            },
          ],
          uncertainties: [],
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const bpmn = generateL5Bpmn(result.process_draft);

      // 提取所有 flowNodeRef
      const flowNodeRefs = bpmn.match(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g) || [];
      const refIds = flowNodeRefs.map(ref =>
        ref.match(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/)[1]
      );

      // 验证每个引用的节点都存在
      for (const refId of refIds) {
        const elementExists = result.process_draft.elements.some(e => e.element_id === refId);
        assert.ok(elementExists, `flowNodeRef ${refId} 应引用已存在的节点`);
      }

      // 验证所有元素都被某个泳道引用
      for (const element of result.process_draft.elements) {
        const isReferenced = refIds.includes(element.element_id);
        assert.ok(isReferenced, `元素 ${element.element_id} 应被某个泳道引用`);
      }
    });

    it('生成的 BPMN 应包含所有节点属于已声明泳道', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const manifest = { title: '泳道完整性测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '1.0.0',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          facts: [
            {
              fact_id: 'F-001',
              kind: 'ROLE',
              process_key: 'test',
              subject_key: 'staff',
              label: '职员',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-001'],
            },
            {
              fact_id: 'F-002',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'task1',
              label: '任务1',
              attributes: { role: '职员' },
              certainty: 'EXPLICIT',
              evidence_refs: ['B-002'],
            },
            {
              fact_id: 'F-003',
              kind: 'ACTIVITY',
              process_key: 'test',
              subject_key: 'task2',
              label: '任务2',
              attributes: {},
              certainty: 'EXPLICIT',
              evidence_refs: ['B-003'],
            },
          ],
          uncertainties: [],
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const bpmn = generateL5Bpmn(result.process_draft);

      // 提取所有已声明的泳道 ID
      const declaredLanes = bpmn.match(/id="Lane_([^"]+)"/g) || [];
      const declaredLaneIds = declaredLanes.map(l => l.match(/id="Lane_([^"]+)"/)[1]);

      // 验证所有元素都属于已声明的泳道
      for (const element of result.process_draft.elements) {
        // 元素的 lane_id 格式是 "Lane-xxx"，BPMN 中的泳道 ID 格式是 "Lane_Lane-xxx"
        const expectedLaneId = element.lane_id;
        assert.ok(declaredLaneIds.includes(expectedLaneId),
          `元素 ${element.element_id} 的泳道 ${expectedLaneId} 应已声明`);
      }
    });
  });
});
