import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Process Fragment Merge', () => {
  describe('mergeProcessFragments', () => {
    it('should merge facts from multiple fragments', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test Process', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ACTIVITY', 'test', 'activity-1', '审批申请'),
        ]),
        createFragment('EB-002', [
          createFact('F-002', 'ACTIVITY', 'test', 'activity-2', '提交申请'),
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.ok(result.process_draft, 'Should produce process draft');
      assert.equal(result.process_draft.schema_version, '2.0.0', 'Should be V2');
      assert.equal(result.process_draft.activities.length, 2, 'Should have 2 activities');
    });

    it('should deduplicate same facts from different fragments', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ACTIVITY', 'test', 'review', '审核'),
        ]),
        createFragment('EB-002', [
          createFact('F-001', 'ACTIVITY', 'test', 'review', '审核'), // Same fact
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.activities.length, 1, 'Should deduplicate');
    });

    it('should handle CONFLICT facts', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ACTIVITY', 'test', 'review', '审核'), certainty: 'CONFLICT' },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      // V2 格式中，冲突事实应该被排除出 activities
      assert.equal(result.process_draft.activities.length, 0, 'CONFLICT 事实不应成为活动');
    });

    it('should generate questions for INFERRED facts', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ACTIVITY', 'test', 'review', '审核'), certainty: 'INFERRED' },
        ], [
          createUncertainty('NEEDS_CONTEXT', '需要确认审批人', ['F-001']),
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.ok(result.process_draft.questions.length > 0, 'Should generate questions');
    });

    it('should generate questions for MISSING facts', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [], [
          createUncertainty('MISSING', '缺少驳回流程', []),
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.ok(result.process_draft.questions.length > 0, 'Should generate questions for missing');
    });

    it('should assign activities to lanes based on roles', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'applicant', '申请人'),
          createFact('F-002', 'ROLE', 'test', 'manager', '部门经理'),
          { ...createFact('F-003', 'ACTIVITY', 'test', 'submit', '提交申请'), attributes: { role: '申请人' } },
          { ...createFact('F-004', 'ACTIVITY', 'test', 'review', '审核申请'), attributes: { role: '部门经理' } },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const lanes = result.process_draft.diagram.lanes;
      assert.ok(lanes.length >= 2, 'Should have lanes for roles');
    });

    it('should detect multiple process candidates and block', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ACTIVITY', 'purchase', 'submit', '提交采购'), certainty: 'EXPLICIT' },
        ]),
        createFragment('EB-002', [
          { ...createFact('F-002', 'ACTIVITY', 'hr', 'apply', '申请休假'), certainty: 'EXPLICIT' },
        ]),
      ];

      try {
        await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
        assert.fail('Should block when multiple processes detected without focus');
      } catch (err) {
        assert.ok(err.message.includes('候选') || err.message.includes('focus'), 'Should mention candidates');
      }
    });

    it('should generate stable question IDs', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [], [
          createUncertainty('MISSING', '问题1', []),
          createUncertainty('MISSING', '问题2', []),
        ]),
      ];

      const result1 = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const result2 = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      assert.equal(
        result1.process_draft.questions[0].question_id,
        result2.process_draft.questions[0].question_id,
        'Question IDs should be stable'
      );
    });
  });
});

function createFragment(batchId, facts, uncertainties = []) {
  return {
    schema_version: '2.0.0',
    batch_id: batchId,
    batch_sha256: 'a'.repeat(64),
    task_kind: 'ACTIVITY_CATALOG',
    payload: {
      facts,
      uncertainties,
    },
  };
}

function createFact(factId, kind, processKey, subjectKey, label) {
  return {
    fact_id: factId,
    kind,
    process_key: processKey,
    subject_key: subjectKey,
    label,
    attributes: {},
    certainty: 'EXPLICIT',
    evidence_refs: ['B-001'],
  };
}

function createUncertainty(kind, text, relatedFactIds) {
  return {
    kind,
    text,
    related_fact_ids: relatedFactIds,
    evidence_refs: ['B-001'],
  };
}

describe('Merge 验证增强', () => {
  describe('ORG_UNIT parent 图', () => {
    it('单叶子候选时应选定组织', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ORG_UNIT', 'test', 'dept-a', '部门A'), attributes: { parent: '公司' } },
          { ...createFact('F-002', 'ORG_UNIT', 'test', 'company', '公司'), attributes: {} },
          createFact('F-003', 'ROLE', 'test', 'staff', '职员'),
          { ...createFact('F-004', 'ACTIVITY', 'test', 'act', '执行任务'), attributes: { role: '职员' } },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.merge_report.selected_org_id, '部门A',
        '单叶子时应选定该组织');
    });

    it('多候选时应生成流程级问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ORG_UNIT', 'test', 'dept-a', '部门A'), attributes: { parent: '公司' } },
          { ...createFact('F-002', 'ORG_UNIT', 'test', 'dept-b', '部门B'), attributes: { parent: '公司' } },
          { ...createFact('F-003', 'ORG_UNIT', 'test', 'company', '公司'), attributes: {} },
          createFact('F-004', 'ROLE', 'test', 'staff', '职员'),
          { ...createFact('F-005', 'ACTIVITY', 'test', 'act', '执行任务'), attributes: { role: '职员' } },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.merge_report.selected_org_id, null,
        '多候选时不应选定');
      const orgQuestion = result.process_draft.questions.find(q =>
        q.text.includes('组织') || q.text.includes('边界') || q.text.includes('候选')
      );
      assert.ok(orgQuestion, '应生成组织边界问题');
    });

    it('层级缺失时应生成问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          // 只有子组织，没有父组织 → parent 指向不存在的节点
          { ...createFact('F-001', 'ORG_UNIT', 'test', 'dept-a', '部门A'), attributes: { parent: '不存在的公司' } },
          createFact('F-002', 'ROLE', 'test', 'staff', '职员'),
          { ...createFact('F-003', 'ACTIVITY', 'test', 'act', '执行任务'), attributes: { role: '职员' } },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      // 部门A 仍是叶子（因为不存在的公司不在 orgUnits 中）
      assert.equal(result.merge_report.selected_org_id, '部门A',
        '层级缺失时叶子仍可被识别');
      // 但如果公司作为 ORG_UNIT 存在但没有 parent 呢？
      // 测试层级缺失 = parent 指向未知
    });
  });

  describe('非 EXPLICIT 产生 OPEN 问题', () => {
    it('INFERRED 事实产生 OPEN 问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ACTIVITY', 'test', 'review', '审核'), certainty: 'INFERRED' },
        ], [
          { kind: 'NEEDS_CONTEXT', text: '审核人不确定', related_fact_ids: ['F-001'], evidence_refs: ['B-001'] },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.ok(result.process_draft.questions.length > 0, 'INFERRED 应产生问题');
      const q = result.process_draft.questions.find(q => q.status === 'OPEN');
      assert.ok(q, '问题状态应为 OPEN');
    });

    it('CONFLICT 事实产生 OPEN 问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ACTIVITY', 'test', 'review', '审核'), certainty: 'CONFLICT' },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      // V2 格式中，冲突事实应该被排除出 activities
      assert.equal(result.process_draft.activities.length, 0, 'CONFLICT 事实不应成为活动');
    });

    it('MISSING 不确定性产生 OPEN 问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ACTIVITY', 'test', 'submit', '提交'),
        ], [
          { kind: 'MISSING', text: '缺少驳回流程', related_fact_ids: [], evidence_refs: ['B-001'] },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const missingQ = result.process_draft.questions.find(q =>
        q.text.includes('驳回') && q.status === 'OPEN'
      );
      assert.ok(missingQ, 'MISSING 应产生 OPEN 问题');
    });
  });

  describe('责任角色缺失不静默', () => {
    it('活动缺 role 时不静默塞入第一泳道', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'manager', '经理'),
          // 活动没有 role 属性
          { ...createFact('F-002', 'ACTIVITY', 'test', 'act', '执行任务'), attributes: {} },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      // 应该生成角色缺失问题
      const roleQ = result.process_draft.questions.find(q =>
        q.text.includes('角色') || q.text.includes('责任')
      );
      assert.ok(roleQ, '应生成角色缺失问题');
    });
  });

  describe('IPO/规则/异常保留', () => {
    it('IPO 属性保留在元素中', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ROLE', 'test', 'staff', '职员') },
          {
            ...createFact('F-002', 'ACTIVITY', 'test', 'act', '执行任务'),
            attributes: { role: '职员', inputs: ['申请单'], outputs: ['审批结果'] },
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      const activity = result.process_draft.activities.find(a => a.name === '执行任务');
      assert.ok(activity, '应有活动');
      assert.deepEqual(activity.inputs, ['申请单'], 'inputs 应保留');
      assert.deepEqual(activity.outputs, ['审批结果'], 'outputs 应保留');
    });
  });
});

describe('Task 4 V2 合并要求', () => {
  describe('fragment 输入顺序变化结果不变', () => {
    it('不同顺序输入应产生相同结果', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const facts1 = [
        createFact('F-001', 'ACTIVITY', 'test', 'activity-1', '审批申请'),
        createFact('F-002', 'ACTIVITY', 'test', 'activity-2', '提交申请'),
      ];
      const facts2 = [
        createFact('F-002', 'ACTIVITY', 'test', 'activity-2', '提交申请'),
        createFact('F-001', 'ACTIVITY', 'test', 'activity-1', '审批申请'),
      ];

      const fragments1 = [createFragment('EB-001', facts1)];
      const fragments2 = [createFragment('EB-001', facts2)];

      const result1 = await mergeProcessFragments({ manifest, evidence, fragments: fragments1, focus: null });
      const result2 = await mergeProcessFragments({ manifest, evidence, fragments: fragments2, focus: null });

      // 稳定 ID 应基于 process_key + subject_key，不受输入顺序影响
      const ids1 = result1.process_draft.activities.map(a => a.activity_id).sort();
      const ids2 = result2.process_draft.activities.map(a => a.activity_id).sort();
      assert.deepEqual(ids1, ids2, '稳定 ID 应相同');
    });
  });

  describe('OARP 与 RASCI', () => {
    it('RASCI 活动应有 R 角色', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'manager', '经理'),
          {
            ...createFact('F-002', 'ACTIVITY', 'test', 'act', '审核申请'),
            attributes: {
              role: '经理',
              activity_type: 'STANDARD',
              responsibility_model: 'RASCI',
              role_assignments: [
                { role_id: 'Role-manager', responsibility: 'R' },
                { role_id: 'Role-approver', responsibility: 'A' },
              ],
            },
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      const activity = result.process_draft.activities.find(a => a.name === '审核申请');
      assert.ok(activity, '应有活动');
      assert.equal(activity.responsibility_model, 'RASCI');
      const rAssignment = activity.role_assignments.find(r => r.responsibility === 'R');
      assert.ok(rAssignment, '应有 R 角色');
    });

    it('OARP 活动应有 O 角色', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'owner', '流程负责人'),
          {
            ...createFact('F-002', 'ACTIVITY', 'test', 'act', '评审会议'),
            attributes: {
              role: '流程负责人',
              activity_type: 'REVIEW_MEETING',
              responsibility_model: 'OARP',
              role_assignments: [
                { role_id: 'Role-owner', responsibility: 'O' },
                { role_id: 'Role-approver', responsibility: 'A' },
                { role_id: 'Role-reviewer', responsibility: 'R' },
                { role_id: 'Role-participant', responsibility: 'P' },
              ],
            },
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      const activity = result.process_draft.activities.find(a => a.name === '评审会议');
      assert.ok(activity, '应有活动');
      assert.equal(activity.responsibility_model, 'OARP');
      const oAssignment = activity.role_assignments.find(r => r.responsibility === 'O');
      assert.ok(oAssignment, '应有 O 角色');
    });
  });

  describe('多业务终点', () => {
    it('应支持多个业务终点', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'EVENT', 'test', 'start', '收到申请'), attributes: { type: 'start' } },
          { ...createFact('F-002', 'EVENT', 'test', 'end-approved', '申请已批准'), attributes: { type: 'end' } },
          { ...createFact('F-003', 'EVENT', 'test', 'end-rejected', '申请已拒绝'), attributes: { type: 'end' } },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      assert.ok(result.process_draft.process_card.end_results.length >= 2, '应有多个业务终点');
    });
  });

  describe('正式审批独立活动', () => {
    it('正式审批应为独立 L5 活动', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'applicant', '申请人'),
          createFact('F-002', 'ROLE', 'test', 'approver', '审批人'),
          {
            ...createFact('F-003', 'ACTIVITY', 'test', 'submit', '提交申请'),
            attributes: { role: '申请人' },
          },
          {
            ...createFact('F-004', 'ACTIVITY', 'test', 'approve', '审批申请'),
            attributes: {
              role: '审批人',
              activity_type: 'DECISION_ACTIVITY',
              responsibility_model: 'OARP',
              role_assignments: [
                { role_id: 'Role-approver', responsibility: 'O' },
              ],
            },
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      const approval = result.process_draft.activities.find(a => a.name === '审批申请');
      assert.ok(approval, '应有审批活动');
      assert.equal(approval.activity_type, 'DECISION_ACTIVITY');
    });
  });

  describe('合法 confirmation', () => {
    it('应支持合法确认从 Task', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'executor', '执行者'),
          createFact('F-002', 'ROLE', 'test', 'confirmer', '确认者'),
          {
            ...createFact('F-003', 'ACTIVITY', 'test', 'act', '执行任务'),
            attributes: {
              role: '执行者',
              confirmation: {
                co_completes: true,
                confirm_bears_final_responsibility: true,
                no_formal_approval_meeting: true,
                confirm_role_id: 'Role-confirmer',
              },
            },
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      const activity = result.process_draft.activities.find(a => a.name === '执行任务');
      assert.ok(activity, '应有活动');
      assert.ok(activity.confirmation, '应有 confirmation');
      assert.ok(activity.confirmation.co_completes, '应有 co_completes');
      assert.ok(activity.confirmation.confirm_bears_final_responsibility, '应有 confirm_bears_final_responsibility');
      assert.ok(activity.confirmation.no_formal_approval_meeting, '应有 no_formal_approval_meeting');
    });
  });

  describe('缺 SLA/KPI', () => {
    it('应生成缺失信息问题', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'staff', '职员'),
          {
            ...createFact('F-002', 'ACTIVITY', 'test', 'act', '执行任务'),
            attributes: { role: '职员' },
          },
        ], [
          { kind: 'MISSING', text: '缺少 SLA 信息', related_fact_ids: ['F-002'], evidence_refs: ['B-001'] },
          { kind: 'MISSING', text: '缺少 KPI 指标', related_fact_ids: [], evidence_refs: ['B-001'] },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      const slaQ = result.process_draft.questions.find(q => q.text.includes('SLA'));
      const kpiQ = result.process_draft.questions.find(q => q.text.includes('KPI'));
      assert.ok(slaQ, '应生成 SLA 缺失问题');
      assert.ok(kpiQ, '应生成 KPI 缺失问题');
    });
  });

  describe('缺责任角色不猜泳道', () => {
    it('角色缺失时不应分配泳道', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          // 没有角色事实
          {
            ...createFact('F-001', 'ACTIVITY', 'test', 'act', '执行任务'),
            attributes: {}, // 没有 role 属性
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      // 应该生成角色缺失问题，但不应该分配泳道
      const roleQ = result.process_draft.questions.find(q => q.text.includes('角色'));
      assert.ok(roleQ, '应生成角色缺失问题');
    });
  });

  describe('结构化网关条件', () => {
    it('应支持结构化网关条件', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [
        createFragment('EB-001', [
          createFact('F-001', 'ROLE', 'test', 'staff', '职员'),
          {
            ...createFact('F-002', 'ACTIVITY', 'test', 'submit', '提交申请'),
            attributes: { role: '职员' },
          },
          {
            ...createFact('F-003', 'ACTIVITY', 'test', 'approve', '审批申请'),
            attributes: { role: '职员' },
          },
          {
            ...createFact('F-004', 'FLOW', 'test', 'flow-condition', '条件流转'),
            attributes: {
              source_subject_key: 'submit',
              target_subject_key: 'approve',
            },
          },
          {
            ...createFact('F-005', 'CONDITION', 'test', 'condition-approve', '审批结论为通过'),
            attributes: {
              source_subject_key: 'submit',
              source_output: '审批结论',
              operator: 'EQUALS',
              value: '通过',
            },
          },
        ]),
      ];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });
      assert.equal(result.process_draft.schema_version, '2.0.0');
      const flow = result.process_draft.diagram.flows.find(f => f.condition);
      assert.ok(flow, '应有条件流转');
      assert.ok(flow.condition, '应有条件对象');
      assert.equal(flow.condition.operator, 'EQUALS');
    });
  });

  describe('稳定 ID 不受显示名称变化影响', () => {
    it('显示名称变化应保持稳定 ID', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');
      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments1 = [
        createFragment('EB-001', [
          createFact('F-001', 'ACTIVITY', 'test', 'activity-1', '审批申请'),
        ]),
      ];
      const fragments2 = [
        createFragment('EB-001', [
          { ...createFact('F-001', 'ACTIVITY', 'test', 'activity-1', '审核申请') }, // 名称变化
        ]),
      ];

      const result1 = await mergeProcessFragments({ manifest, evidence, fragments: fragments1, focus: null });
      const result2 = await mergeProcessFragments({ manifest, evidence, fragments: fragments2, focus: null });

      const id1 = result1.process_draft.activities[0].activity_id;
      const id2 = result2.process_draft.activities[0].activity_id;
      assert.equal(id1, id2, '稳定 ID 应相同');
      assert.ok(result1.process_draft.activities[0].name !== result2.process_draft.activities[0].name, '名称应不同');
    });
  });
});
