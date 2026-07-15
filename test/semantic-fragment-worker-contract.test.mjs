import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Semantic Fragment Worker Contract', () => {
  describe('Worker Protocol Document', () => {
    it('should exist and contain required sections', async () => {
      const content = await readFile(
        join(__dirname, '../agents/flow-architect-extract-process-fragment-worker.md'),
        'utf8'
      );

      assert.ok(content.includes('单批次限制'), 'Should mention single batch limit');
      assert.ok(content.includes('prompt-injection'), 'Should mention prompt injection boundary');
      assert.ok(content.includes('JSON'), 'Should mention JSON-only output');
      assert.ok(content.includes('evidence_refs'), 'Should mention evidence references');
      assert.ok(content.includes('certainty'), 'Should mention certainty rules');
    });
  });

  describe('Worker Input Constraints', () => {
    it('should accept only one batch per invocation', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('只处理一个 batch'), 'Protocol should specify single batch');
      assert.ok(protocol.includes('不得读取其他 batch'), 'Should forbid reading other batches');
    });

    it('should forbid reading run final directory', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('final') && protocol.includes('禁止'),
        'Should forbid reading final directory');
    });
  });

  describe('Worker Output Contract', () => {
    it('should require JSON-only output', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('JSON'), 'Protocol should require JSON output');
    });

    it('should require evidence_refs from current batch only', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('当前 batch'), 'Should reference current batch only');
    });

    it('should require INFERRED to provide reasoning', async () => {
      const protocol = await readFile(
        join(__dirname, '../references/process-fragment-protocol.md'),
        'utf8'
      );

      assert.ok(protocol.includes('INFERRED'), 'Should mention INFERRED status');
      assert.ok(protocol.includes('推断依据'), 'Should require reasoning for INFERRED');
    });
  });

  describe('Accept Semantic Fragment', () => {
    it('should validate fragment against batch', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');

      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
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

      const batch = {
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        blocks: [{
          block_id: 'B-001',
          source_format: 'md',
          modality: 'TEXT',
          locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
          heading_path: [],
          content_sha256: 'b'.repeat(64),
        }],
        total_chars: 100,
        modality_mix: ['TEXT'],
      };

      const result = await acceptSemanticFragment({ fragment, batch });
      assert.equal(result.accepted, true, 'Valid fragment should be accepted');
    });

    it('should reject fragment with wrong batch_id', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');

      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-wrong',
        batch_sha256: 'a'.repeat(64),
        facts: [],
        uncertainties: [],
      };

      const batch = {
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        blocks: [],
        total_chars: 0,
        modality_mix: [],
      };

      const result = await acceptSemanticFragment({ fragment, batch });
      assert.equal(result.accepted, false, 'Wrong batch_id should be rejected');
    });

    it('should reject fragment with evidence_refs not in batch', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');

      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'test',
          label: 'Test',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-999'], // Not in batch
        }],
        uncertainties: [],
      };

      const batch = {
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        blocks: [{ block_id: 'B-001' }],
        total_chars: 0,
        modality_mix: [],
      };

      const result = await acceptSemanticFragment({ fragment, batch });
      assert.equal(result.accepted, false, 'Invalid evidence_refs should be rejected');
    });

    it('should reject fragment with duplicate fact IDs', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');

      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        facts: [
          {
            fact_id: 'F-001',
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'test',
            label: 'Test 1',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          },
          {
            fact_id: 'F-001', // Duplicate ID
            kind: 'ACTIVITY',
            process_key: 'test',
            subject_key: 'test',
            label: 'Test 2',
            attributes: {},
            certainty: 'EXPLICIT',
            evidence_refs: ['B-001'],
          },
        ],
        uncertainties: [],
      };

      const batch = {
        batch_id: 'EB-test',
        batch_sha256: 'a'.repeat(64),
        blocks: [{ block_id: 'B-001' }],
        total_chars: 0,
        modality_mix: [],
      };

      const result = await acceptSemanticFragment({ fragment, batch });
      assert.equal(result.accepted, false, 'Duplicate fact IDs should be rejected');
    });
  });

  describe('Accept with Queue (runDir)', () => {
    let tempDir;

    before(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'accept-queue-test-'));
    });

    after(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    function validFragment(batchId = 'EB-001') {
      return {
        schema_version: '1.0.0',
        batch_id: batchId,
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'test',
          label: '测试活动',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      };
    }

    function validBatch(batchId = 'EB-001') {
      return {
        batch_id: batchId,
        batch_sha256: 'a'.repeat(64),
        blocks: [{ block_id: 'B-001' }],
        total_chars: 100,
        modality_mix: ['TEXT'],
      };
    }

    async function setupRunDir(runDir, queue) {
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(queue)
      );
    }

    it('应拒绝: queue 文件缺失', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'no-queue-' + Date.now());
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, 'queue 缺失时应拒绝');
      assert.ok(result.errors.some(e => e.includes('Queue') || e.includes('queue')),
        '错误应提及 queue');
    });

    it('应拒绝: batch 未在 queue 中登记', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'not-registered-' + Date.now());
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-OTHER',
          batch_sha256: 'b'.repeat(64),
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment('EB-001'),
        batch: validBatch('EB-001'),
        runDir,
      });

      assert.equal(result.accepted, false, 'batch 未登记时应拒绝');
      assert.ok(result.errors.some(e => e.includes('not registered') || e.includes('EB-001')),
        '错误应提及未登记的 batch');
    });

    it('应拒绝: queue 中 hash 与 batch hash 不匹配', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'hash-mismatch-' + Date.now());
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'f'.repeat(64),  // 不同的 hash
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, 'hash 不匹配时应拒绝');
      assert.ok(result.errors.some(e => e.includes('hash') || e.includes('Hash') || e.includes('mismatch')),
        '错误应提及 hash 不匹配');
    });

    it('应无半状态: 验证失败时 fragment 文件和 queue 都不被修改', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'no-half-state-' + Date.now());
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'f'.repeat(64),  // 不匹配
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, '应拒绝');

      // fragment 目录应为空
      const fragDir = join(runDir, 'stages', 'semantic', 'fragments');
      const fragFiles = await readdir(fragDir);
      assert.equal(fragFiles.length, 0, 'fragment 文件不应被写入');

      // queue 状态仍为 PENDING
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'PENDING', 'queue 状态不应改变');
    });

    it('应成功: queue 存在、batch 已登记、hash 匹配', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'success-' + Date.now());
      const queue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await setupRunDir(runDir, queue);

      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, true, '应验收通过');

      // fragment 文件应已写入
      const fragContent = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json'), 'utf8')
      );
      assert.equal(fragContent.batch_id, 'EB-001');

      // queue 状态应更新为 ACCEPTED
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'ACCEPTED', 'queue 状态应为 ACCEPTED');
    });
  });
});
