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
          schema_version: '2.0.0',
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          payload: {
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
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      // 验证生成了 OPEN 问题
      const roleQuestion = result.process_draft.questions.find(q =>
        q.text.includes('角色') || q.text.includes('责任')
      );
      assert.ok(roleQuestion, '应生成角色缺失问题');
      assert.equal(roleQuestion.status, 'OPEN', '问题状态应为 OPEN');

      // 验证主任务节点使用了 Lane-unassigned
      const unassignedNodes = result.process_draft.diagram.nodes.filter(n =>
        n.node_type === 'MAIN_TASK' && n.lane_id === 'Lane-unassigned'
      );
      assert.ok(unassignedNodes.length > 0, '应有主任务节点使用 Lane-unassigned');

      // 生成 BPMN 并验证结构合法性
      const bpmn = generateL5Bpmn(result.process_draft);

      // 验证存在 Lane-unassigned 泳道
      assert.ok(bpmn.includes('id="Lane-unassigned"'),
        '应存在 Lane-unassigned 泳道');

      // 验证所有 flowNodeRef 引用已存在的节点
      const flowNodeRefs = bpmn.match(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g) || [];
      for (const ref of flowNodeRefs) {
        const nodeId = ref.match(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/)[1];
        // 检查节点是否在 diagram.nodes 中存在
        const nodeExists = result.process_draft.diagram.nodes.some(n => n.node_id === nodeId);
        assert.ok(nodeExists, `flowNodeRef ${nodeId} 应引用已存在的节点`);
      }

      // 验证所有任务节点都属于已声明的泳道（排除 start/end 事件，lane_id 为 null 是合法的）
      const declaredLanes = bpmn.match(/id="([^"]*)"/g) || [];
      const declaredLaneIds = result.process_draft.diagram.lanes.map(l => l.lane_id);
      for (const node of result.process_draft.diagram.nodes) {
        if (node.node_type !== 'MAIN_TASK') continue;
        const expectedLaneId = node.lane_id;
        assert.ok(declaredLaneIds.includes(expectedLaneId),
          `节点 ${node.node_id} 的泳道 ${expectedLaneId} 应已声明`);
      }
    });

    it('应为无角色活动生成 OPEN 问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: '测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '2.0.0',
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          payload: {
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
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      // 验证生成了角色缺失问题
      const roleQuestion = result.process_draft.questions.find(q =>
        q.text.includes('角色') || q.text.includes('责任')
      );
      assert.ok(roleQuestion, '应生成角色缺失问题');
      assert.equal(roleQuestion.status, 'OPEN', '问题状态应为 OPEN');

      // 验证主任务节点使用了第一个泳道作为占位（排除 start/end 事件）
      const node = result.process_draft.diagram.nodes.find(
        n => n.node_type === 'MAIN_TASK' && n.name === '执行任务'
      );
      assert.ok(node, '应存在主任务节点');
      assert.equal(node.lane_id, result.process_draft.diagram.lanes[0]?.lane_id,
        '应使用第一个泳道作为占位');
    });

    it('生成的 BPMN 应包含所有 flowNodeRef 引用已存在节点', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const manifest = { title: '引用完整性测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '2.0.0',
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          payload: {
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
        const nodeExists = result.process_draft.diagram.nodes.some(n => n.node_id === refId);
        assert.ok(nodeExists, `flowNodeRef ${refId} 应引用已存在的节点`);
      }

      // 验证所有主任务节点都被某个泳道引用（排除 start/end 事件）
      for (const node of result.process_draft.diagram.nodes) {
        if (node.node_type !== 'MAIN_TASK') continue;
        const isReferenced = refIds.includes(node.node_id);
        assert.ok(isReferenced, `节点 ${node.node_id} 应被某个泳道引用`);
      }
    });

    it('生成的 BPMN 应包含所有任务节点属于已声明泳道', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const { generateL5Bpmn } = await import('../scripts/lib/l5-bpmn-generator.mjs');

      const manifest = { title: '泳道完整性测试', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        {
          schema_version: '2.0.0',
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          payload: {
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
        },
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const bpmn = generateL5Bpmn(result.process_draft);

      // 获取所有已声明的泳道 ID（直接从 diagram.lanes 取）
      const declaredLaneIds = result.process_draft.diagram.lanes.map(l => l.lane_id);

      // 验证所有任务节点都属于已声明的泳道（排除 start/end 事件）
      for (const node of result.process_draft.diagram.nodes) {
        if (node.node_type !== 'MAIN_TASK') continue;
        const expectedLaneId = node.lane_id;
        assert.ok(declaredLaneIds.includes(expectedLaneId),
          `节点 ${node.node_id} 的泳道 ${expectedLaneId} 应已声明`);
      }
    });
  });
});
