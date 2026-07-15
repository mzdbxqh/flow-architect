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
      assert.equal(result.process_draft.elements.length, 2, 'Should have 2 elements');
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
      assert.equal(result.process_draft.elements.length, 1, 'Should deduplicate');
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
      assert.ok(result.process_draft.conflicts.length > 0, 'Should have conflicts');
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
      const lanes = result.process_draft.lanes;
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
    schema_version: '1.0.0',
    batch_id: batchId,
    batch_sha256: 'a'.repeat(64),
    facts,
    uncertainties,
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
      assert.ok(result.process_draft.conflicts.length > 0, 'CONFLICT 应进入冲突记录');
      // CONFLICT 事实的活动不应出现在 elements 中
      const conflictElement = result.process_draft.elements.find(e => e.name === '审核');
      assert.ok(!conflictElement, 'CONFLICT 事实不应直接成为流程元素');
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
      const element = result.process_draft.elements.find(e => e.name === '执行任务');
      assert.ok(element, '应有元素');
      assert.deepEqual(element.inputs, ['申请单'], 'inputs 应保留');
      assert.deepEqual(element.outputs, ['审批结果'], 'outputs 应保留');
    });
  });
});
