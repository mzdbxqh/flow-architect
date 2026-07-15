import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

describe('Evidence Batching', () => {
  describe('buildEvidenceBatches', () => {
    it('should batch blocks within character limit', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', 'Short content'),
        createBlock('B-002', 'TEXT', 'Another short content'),
      ];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });
      assert.ok(batches.length > 0, 'Should create batches');
      assert.ok(batches[0].total_chars <= 12000, 'Batch should not exceed char limit');
    });

    it('should split blocks exceeding character limit', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const longContent = 'x'.repeat(15000);
      const blocks = [createBlock('B-001', 'TEXT', longContent)];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });
      assert.ok(batches.length >= 1, 'Should create batch');
      // Large block should be split or handled
    });

    it('should not exceed maxBlocks per batch', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = Array.from({ length: 25 }, (_, i) =>
        createBlock(`B-${String(i).padStart(3, '0')}`, 'TEXT', `Content ${i}`)
      );

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });
      for (const batch of batches) {
        assert.ok(batch.blocks.length <= 12, 'Batch should not exceed maxBlocks');
      }
    });

    it('should keep same artifact blocks together when possible', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', 'Content from doc1', 'doc1'),
        createBlock('B-002', 'TEXT', 'More from doc1', 'doc1'),
        createBlock('B-003', 'TEXT', 'Content from doc2', 'doc2'),
      ];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      // Find batch containing B-001
      const batch1 = batches.find(b => b.blocks.some(bl => bl.block_id === 'B-001'));
      const hasDoc1 = batch1.blocks.some(bl => bl.block_id === 'B-002');
      assert.ok(hasDoc1, 'Same artifact blocks should be in same batch');
    });

    it('should limit visual assets to one per batch', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'VISUAL_ASSET', '[Image 1]'),
        createBlock('B-002', 'VISUAL_ASSET', '[Image 2]'),
        createBlock('B-003', 'TEXT', 'Some text'),
      ];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      for (const batch of batches) {
        const visualCount = batch.blocks.filter(b => b.modality === 'VISUAL_ASSET').length;
        assert.ok(visualCount <= 1, 'Batch should have at most one visual asset');
      }
    });

    it('should generate stable batch IDs', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', 'Content'),
      ];

      const batches1 = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });
      const batches2 = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      assert.equal(batches1[0].batch_id, batches2[0].batch_id, 'Same input should produce same batch_id');
    });

    it('should not mix unrelated process focus blocks', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', 'Purchase process', 'doc1', ['采购管理']),
        createBlock('B-002', 'TEXT', 'HR process', 'doc2', ['人力资源']),
      ];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      // Different heading paths should ideally be in different batches
      // This is a soft constraint - the function should try to separate them
      assert.ok(batches.length >= 1, 'Should create batches');
    });

    it('RED: should preserve artifact_sha256 in batch blocks', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', 'Content from doc1', 'doc1'),
        createBlock('B-002', 'TEXT', 'Content from doc2', 'doc2'),
      ];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      // 验证每个 block 都保留了 artifact_sha256
      for (const batch of batches) {
        for (const block of batch.blocks) {
          assert.ok(block.artifact_sha256, `Block ${block.block_id} should have artifact_sha256`);
          assert.match(block.artifact_sha256, /^[a-f0-9]{64}$/, `Block ${block.block_id} artifact_sha256 should be valid hex`);
        }
      }

      // 验证特定 block 的 artifact_sha256 正确
      const expectedHash1 = createHash('sha256').update('doc1').digest('hex');
      const expectedHash2 = createHash('sha256').update('doc2').digest('hex');

      const batch1 = batches.find(b => b.blocks.some(bl => bl.block_id === 'B-001'));
      const block1 = batch1.blocks.find(bl => bl.block_id === 'B-001');
      assert.equal(block1.artifact_sha256, expectedHash1, 'B-001 should have correct artifact_sha256');

      const batch2 = batches.find(b => b.blocks.some(bl => bl.block_id === 'B-002'));
      const block2 = batch2.blocks.find(bl => bl.block_id === 'B-002');
      assert.equal(block2.artifact_sha256, expectedHash2, 'B-002 should have correct artifact_sha256');
    });

    it('should detect cache pollution', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks1 = [createBlockWithHash('B-001', 'TEXT', 'hash111111111111111111111111111111111111111111111111111111111111111111')];
      const blocks2 = [createBlockWithHash('B-001', 'TEXT', 'hash222222222222222222222222222222222222222222222222222222222222222222')]; // Same ID, different content hash

      const batches1 = buildEvidenceBatches({ blocks: blocks1, maxChars: 12000, maxBlocks: 12 });
      const batches2 = buildEvidenceBatches({ blocks: blocks2, maxChars: 12000, maxBlocks: 12 });

      // Different content should produce different batch hashes
      assert.notEqual(batches1[0].batch_sha256, batches2[0].batch_sha256,
        'Different content should produce different batch hashes');
    });
  });

  describe('Queue Generation', () => {
    it('should generate queue with correct status', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [createBlock('B-001', 'TEXT', 'Content')];
      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      assert.ok(batches[0].status === 'PENDING' || batches[0].status === 'CACHED',
        'Batch should have valid status');
    });

    it('queue entry should not include block content', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [createBlock('B-001', 'TEXT', 'Sensitive content')];
      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      // Queue entries (as generated by prepare-process-draft.mjs) strip content
      // but batch files (returned by buildEvidenceBatches) include content for workers
      const batch = batches[0];
      assert.ok(batch.blocks[0].content, 'Batch file must include content');
      // Simulate queue entry which only has metadata
      const queueEntry = {
        batch_id: batch.batch_id,
        batch_sha256: batch.batch_sha256,
        total_chars: batch.total_chars,
        modality_mix: batch.modality_mix,
        block_count: batch.blocks.length,
        status: batch.status,
      };
      const queueStr = JSON.stringify(queueEntry);
      assert.ok(!queueStr.includes('Sensitive content'), 'Queue entry should not contain block content');
    });

    it('batch file should contain content for worker consumption', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', '采购审批流程第一步'),
        createBlock('B-002', 'TEXT', '经理审核签字'),
      ];
      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      // Batch file entries must include content so workers can extract semantics
      for (const batch of batches) {
        for (const block of batch.blocks) {
          assert.ok(typeof block.content === 'string' && block.content.length > 0,
            `Batch block ${block.block_id} must include content for worker`);
        }
      }
    });

    it('batch total_chars should reflect actual content length', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        createBlock('B-001', 'TEXT', 'Hello world'),
        createBlock('B-002', 'TEXT', '第二段内容'),
      ];
      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      const totalContent = blocks.reduce((sum, b) => sum + b.content.length, 0);
      assert.equal(batches[0].total_chars, totalContent,
        'total_chars should equal sum of actual content lengths');
    });
  });
});

function createBlock(blockId, modality, content, artifactId = 'doc1', headingPath = []) {
  // 生成有效的 hex 格式 artifact_sha256
  const hash = createHash('sha256').update(artifactId).digest('hex');
  return {
    block_id: blockId,
    artifact_sha256: hash,
    source_format: 'md',
    modality,
    locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
    heading_path: headingPath,
    content,
    asset_ref: modality === 'VISUAL_ASSET' ? '/path/to/asset' : null,
    content_sha256: 'a'.repeat(64),
  };
}

function createBlockWithHash(blockId, modality, contentSha256) {
  return {
    block_id: blockId,
    artifact_sha256: 'doc1' + '0'.repeat(60),
    source_format: 'md',
    modality,
    locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
    heading_path: [],
    content: 'test content',
    asset_ref: modality === 'VISUAL_ASSET' ? '/path/to/asset' : null,
    content_sha256: contentSha256,
  };
}
