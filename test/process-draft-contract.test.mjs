import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/process-draft/contracts');

// 动态导入，避免模块缓存问题
async function loadContract() {
  return await import('../scripts/lib/process-draft-contract.mjs');
}

describe('Process Draft Contract Validation', () => {
  describe('Evidence Block Validation', () => {
    it('should validate a correct evidence block', async () => {
      const validBlock = JSON.parse(
        await readFile(join(fixturesDir, 'valid-evidence-block.json'), 'utf8')
      );
      const { validateEvidenceBlock } = await loadContract();
      const result = await validateEvidenceBlock(validBlock);
      assert.equal(result.valid, true, 'Valid block should pass validation');
    });

    it('should reject block with invalid locator page number', async () => {
      const invalidBlock = {
        block_id: 'B-003',
        artifact_sha256: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        source_format: 'pdf',
        modality: 'TEXT',
        locator: { page: -1, slide: null, sheet: null, range: null, line_start: null, line_end: null },
        heading_path: ['test'],
        content: 'test',
        asset_ref: null,
        content_sha256: 'b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567a'
      };
      const { validateEvidenceBlock } = await loadContract();
      const result = await validateEvidenceBlock(invalidBlock);
      assert.equal(result.valid, false, 'Invalid page number should fail');
    });

    it('should reject block with duplicate block_id in collection', async () => {
      const blocks = [
        { block_id: 'B-001', artifact_sha256: 'abc123456789012345678901234567890123456789012345678901234567890ab', source_format: 'pdf', modality: 'TEXT',
          locator: { page: 1, slide: null, sheet: null, range: null, line_start: null, line_end: null },
          heading_path: [], content: 'a', asset_ref: null, content_sha256: 'def123456789012345678901234567890123456789012345678901234567890ab' },
        { block_id: 'B-001', artifact_sha256: 'abc123456789012345678901234567890123456789012345678901234567890ab', source_format: 'pdf', modality: 'TEXT',
          locator: { page: 2, slide: null, sheet: null, range: null, line_start: null, line_end: null },
          heading_path: [], content: 'b', asset_ref: null, content_sha256: 'ghi123456789012345678901234567890123456789012345678901234567890ab' }
      ];
      const { validateEvidenceIndex } = await loadContract();
      const result = await validateEvidenceIndex(blocks);
      assert.equal(result.valid, false, 'Duplicate block_id should fail');
    });
  });

  describe('Evidence Batch Validation', () => {
    it('should validate a correct evidence batch', async () => {
      const validBatch = JSON.parse(
        await readFile(join(fixturesDir, 'valid-evidence-batch.json'), 'utf8')
      );
      const { validateEvidenceBatch } = await loadContract();
      const result = await validateEvidenceBatch(validBatch);
      assert.equal(result.valid, true, 'Valid batch should pass validation');
    });

    it('should reject batch with total_chars exceeding limit', async () => {
      const invalidBatch = {
        batch_id: 'EB-002',
        batch_sha256: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        blocks: [],
        total_chars: 15000, // Exceeds 12000 limit
        modality_mix: ['TEXT']
      };
      const { validateEvidenceBatch } = await loadContract();
      const result = await validateEvidenceBatch(invalidBatch);
      assert.equal(result.valid, false, 'Batch exceeding char limit should fail');
    });
  });

  describe('Semantic Fragment Validation', () => {
    it('should validate a correct V2 semantic fragment', async () => {
      const validFragment = JSON.parse(
        await readFile(join(fixturesDir, 'valid-semantic-fragment.json'), 'utf8')
      );
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(validFragment);
      assert.equal(result.valid, true, 'Valid V2 fragment should pass validation');
    });

    it('should reject V1 semantic fragment (schema_version=1.0.0)', async () => {
      const v1Fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'test',
          label: 'Test',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(v1Fragment);
      assert.equal(result.valid, false, 'V1 fragment should be rejected');
    });

    it('should reject fragment with invalid certainty value', async () => {
      const invalidFragment = {
        schema_version: '2.0.0',
        task_kind: 'ACTIVITY_CATALOG',
        batch_id: 'EB-001',
        batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
        payload: {
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
          facts: [{
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'test',
            label: 'Test',
            attributes: {},
            certainty: 'INVALID_VALUE',
            evidence_refs: ['B-001'],
          }],
          uncertainties: [],
        },
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(invalidFragment);
      assert.equal(result.valid, false, 'Invalid certainty should fail');
    });

    it('should reject fragment with empty evidence_refs', async () => {
      const invalidFragment = {
        schema_version: '2.0.0',
        task_kind: 'ACTIVITY_CATALOG',
        batch_id: 'EB-001',
        batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
        payload: {
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
          facts: [{
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'test',
            label: 'Test',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: [],
          }],
          uncertainties: [],
        },
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(invalidFragment);
      assert.equal(result.valid, false, 'Empty evidence_refs should fail');
    });

    it('should reject fragment with dangling related_fact_ids in uncertainties', async () => {
      const invalidFragment = {
        schema_version: '2.0.0',
        task_kind: 'ACTIVITY_CATALOG',
        batch_id: 'EB-001',
        batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
        payload: {
          task_kind: 'ACTIVITY_CATALOG',
          batch_id: 'EB-001',
          batch_sha256: 'd4e5f6789012345678901234567890abcdef1234567890abcdef1234567ab1c2',
          facts: [{
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'test',
            label: 'Test',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          }],
          uncertainties: [{
            kind: 'MISSING',
            text: 'Something missing',
            related_fact_ids: ['F-999'],
            evidence_refs: ['B-001'],
          }],
        },
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(invalidFragment);
      assert.equal(result.valid, false, 'Dangling related_fact_ids should fail');
    });
  });

  describe('Process Draft V2 Schema Validation', () => {
    it('should validate a correct V2 process draft', async () => {
      const validDraft = JSON.parse(
        await readFile(join(fixturesDir, 'valid-process-draft-v2.json'), 'utf8')
      );
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(validDraft);
      assert.equal(result.valid, true, 'Valid V2 draft should pass validation');
    });

    it('should validate a correct V2 OARP process draft', async () => {
      const validDraft = JSON.parse(
        await readFile(join(fixturesDir, 'valid-process-draft-v2-oarp.json'), 'utf8')
      );
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(validDraft);
      assert.equal(result.valid, true, 'Valid V2 OARP draft should pass validation');
    });

    it('should reject draft with schema_version != 2.0.0', async () => {
      const invalidDraft = {
        schema_version: '1.0.0',
        process_card: {
          process_id: 'Process-test',
          name: 'Test',
          level: 'L4',
          is_leaf: true,
          description: '',
          purpose: '',
          owner: 'Role-owner',
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结果' }],
          performance_indicators: [],
        },
        activities: [],
        diagram: { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'Non-2.0.0 schema_version should fail');
    });

    it('should reject draft with missing required top-level fields', async () => {
      const invalidDraft = {
        schema_version: '2.0.0',
        // Missing process_card, activities, diagram, etc.
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'Missing required fields should fail');
    });

    it('should reject draft with V1 top-level fields', async () => {
      const invalidDraft = {
        schema_version: '2.0.0',
        title: 'Old V1 title', // V1 field, should not be allowed
        process_card: {
          process_id: 'Process-test',
          name: 'Test',
          level: 'L4',
          is_leaf: true,
          description: '',
          purpose: '',
          owner: 'Role-owner',
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结果' }],
          performance_indicators: [],
        },
        activities: [],
        diagram: { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'V1 top-level fields should fail with additionalProperties:false');
    });

    it('should reject draft with flow referencing non-existent node', async () => {
      const invalidDraft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'Process-test',
          name: 'Test',
          level: 'L4',
          is_leaf: true,
          description: '',
          purpose: '',
          owner: 'Role-owner',
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结果' }],
          performance_indicators: [],
        },
        activities: [],
        diagram: {
          lanes: [],
          nodes: [],
          flows: [{
            flow_id: 'Flow-1',
            source_ref: 'NonExistent',
            target_ref: 'AlsoNonExistent',
            condition: null,
          }],
          task_bindings: [],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'Flow with dangling refs should fail');
    });

    it('should reject draft with task_binding referencing non-existent activity', async () => {
      const invalidDraft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'Process-test',
          name: 'Test',
          level: 'L4',
          is_leaf: true,
          description: '',
          purpose: '',
          owner: 'Role-owner',
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结果' }],
          performance_indicators: [],
        },
        activities: [],
        diagram: {
          lanes: [],
          nodes: [],
          flows: [],
          task_bindings: [{
            activity_id: 'Activity-nonexistent',
            main_task_id: 'Task-1',
            confirmation_task_id: null,
          }],
          layout_version: '2.0.0',
        },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'Binding with non-existent activity should fail');
    });
  });

  describe('Stable ID Generation', () => {
    it('should generate stable IDs from content', async () => {
      const { stableId } = await loadContract();
      const id1 = stableId('Activity', '审核采购申请');
      const id2 = stableId('Activity', '审核采购申请');
      assert.equal(id1, id2, 'Same content should produce same ID');
      assert.match(id1, /^Activity-[a-f0-9]{8}$/, 'ID should match expected format');
    });

    it('should generate different IDs for different content', async () => {
      const { stableId } = await loadContract();
      const id1 = stableId('Activity', '审核采购申请');
      const id2 = stableId('Activity', '驳回采购申请');
      assert.notEqual(id1, id2, 'Different content should produce different IDs');
    });
  });

  describe('Canonical JSON', () => {
    it('should produce deterministic JSON output', async () => {
      const { canonicalJson } = await loadContract();
      const obj = { b: 2, a: 1, c: { z: 26, y: 25 } };
      const json1 = canonicalJson(obj);
      const json2 = canonicalJson(obj);
      assert.equal(json1, json2, 'Same object should produce same JSON');
      assert.equal(json1, '{"a":1,"b":2,"c":{"y":25,"z":26}}');
    });

    it('should sort arrays deterministically when specified', async () => {
      const { canonicalJson } = await loadContract();
      const obj = { items: ['c', 'a', 'b'] };
      const json = canonicalJson(obj, { sortArrays: true });
      assert.equal(json, '{"items":["a","b","c"]}');
    });
  });

  describe('AJV Strict Mode', () => {
    it('process-card schema 要求 parent_process_name 必填', async () => {
      const schema = JSON.parse(
        await readFile(join(__dirname, '../references/schemas/process-card.schema.json'), 'utf8')
      );
      assert.ok(
        schema.required.includes('parent_process_name'),
        'parent_process_name 应在 required 列表中'
      );
    });

    it('缺少 parent_process_name 的草稿应被 Schema 验证拒绝', async () => {
      const invalidDraft = {
        schema_version: '2.0.0',
        process_card: {
          process_id: 'Process-test',
          name: '测试',
          level: 'L4',
          is_leaf: true,
          description: '',
          purpose: '',
          owner: 'Role-owner',
          // parent_process_name 缺失
          inputs: [],
          outputs: [],
          start: { event_id: 'Start-1', name: '触发', event_type: 'NONE' },
          end_results: [{ event_id: 'End-1', name: '结果' }],
          performance_indicators: [],
        },
        activities: [],
        diagram: { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
        questions: [],
        provenance: {},
        source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, '缺少 parent_process_name 应被拒绝');
    });
  });
});
