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
    it('should validate a correct semantic fragment', async () => {
      const validFragment = JSON.parse(
        await readFile(join(fixturesDir, 'valid-semantic-fragment.json'), 'utf8')
      );
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(validFragment);
      assert.equal(result.valid, true, 'Valid fragment should pass validation');
    });

    it('should reject fragment with invalid certainty value', async () => {
      const invalidFragment = {
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
          certainty: 'INVALID_VALUE', // Invalid certainty
          evidence_refs: ['B-001']
        }],
        uncertainties: []
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(invalidFragment);
      assert.equal(result.valid, false, 'Invalid certainty should fail');
    });

    it('should reject fragment with empty evidence_refs', async () => {
      const invalidFragment = {
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
          evidence_refs: [] // Empty evidence refs
        }],
        uncertainties: []
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(invalidFragment);
      assert.equal(result.valid, false, 'Empty evidence_refs should fail');
    });

    it('should reject fragment with dangling related_fact_ids in uncertainties', async () => {
      const invalidFragment = {
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
          evidence_refs: ['B-001']
        }],
        uncertainties: [{
          kind: 'MISSING',
          text: 'Something missing',
          related_fact_ids: ['F-999'], // Dangling reference
          evidence_refs: ['B-001']
        }]
      };
      const { validateSemanticFragment } = await loadContract();
      const result = await validateSemanticFragment(invalidFragment);
      assert.equal(result.valid, false, 'Dangling related_fact_ids should fail');
    });
  });

  describe('Process Draft Validation', () => {
    it('should validate a correct process draft', async () => {
      const validDraft = JSON.parse(
        await readFile(join(fixturesDir, 'valid-process-draft.json'), 'utf8')
      );
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(validDraft);
      assert.equal(result.valid, true, 'Valid draft should pass validation');
    });

    it('should reject draft with activity missing lane_id', async () => {
      const invalidDraft = {
        title: 'Test',
        level: 'L5',
        process_id: 'test',
        boundary: { start: 'A', end: 'B' },
        lanes: [{ lane_id: 'Lane-001', name: 'Test', org_candidates: [] }],
        elements: [{
          element_id: 'Activity-001',
          kind: 'ACTIVITY',
          name: 'Test Activity',
          lane_id: null, // Missing lane
          inputs: [],
          outputs: [],
          evidence_refs: ['B-001'],
          certainty: 'EXPLICIT',
          question_ids: []
        }],
        flows: [],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 1, formats: ['pdf'], evidence_refs: ['B-001'] }
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'Activity missing lane should fail');
    });

    it('should reject draft with flow referencing non-existent element', async () => {
      const invalidDraft = {
        title: 'Test',
        level: 'L5',
        process_id: 'test',
        boundary: { start: 'A', end: 'B' },
        lanes: [],
        elements: [],
        flows: [{
          flow_id: 'Flow-001',
          source_ref: 'NonExistent',
          target_ref: 'AlsoNonExistent',
          condition: null,
          evidence_refs: []
        }],
        questions: [],
        conflicts: [],
        source_summary: { total_blocks: 0, formats: [], evidence_refs: [] }
      };
      const { validateProcessDraft } = await loadContract();
      const result = await validateProcessDraft(invalidDraft);
      assert.equal(result.valid, false, 'Flow with dangling refs should fail');
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
});
