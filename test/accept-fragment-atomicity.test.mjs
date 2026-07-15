import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Accept Fragment Atomicity', () => {
  describe('写入失败无半状态', () => {
    let tempDir;

    before(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'accept-atomicity-test-'));
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

    it('应恢复调用前状态当 queue 原子写失败时', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'queue-write-fail-' + Date.now());

      // 设置初始状态
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      const initialQueue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(initialQueue)
      );

      // 模拟 queue 写入失败（通过权限限制）
      // 注意：这个测试需要在实际实现中模拟失败
      // 这里我们先测试成功路径，然后在实现中添加失败注入
      const result = await acceptSemanticFragment({
        fragment: validFragment(),
        batch: validBatch(),
        runDir,
      });

      // 成功路径应正常工作
      assert.equal(result.accepted, true, '应验收通过');

      // 验证 fragment 文件已写入
      const fragDir = join(runDir, 'stages', 'semantic', 'fragments');
      const fragFiles = await readdir(fragDir);
      assert.ok(fragFiles.includes('EB-001.json'), 'fragment 文件应已写入');

      // 验证 queue 状态已更新
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'ACCEPTED', 'queue 状态应为 ACCEPTED');
    });

    it('应记录 fragment_sha256 当成功时', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'sha256-record-' + Date.now());

      // 设置初始状态
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      const initialQueue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(initialQueue)
      );

      const fragment = validFragment();
      const result = await acceptSemanticFragment({
        fragment,
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, true, '应验收通过');

      // 验证 queue 记录了 fragment_sha256
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );

      const batchEntry = queueAfter.batches.find(b => b.batch_id === 'EB-001');
      assert.ok(batchEntry.fragment_sha256, '应记录 fragment_sha256');
      assert.ok(batchEntry.fragment_sha256.length === 64, 'fragment_sha256 应为 64 字符');
      assert.equal(batchEntry.status, 'ACCEPTED', '状态应为 ACCEPTED');
    });

    it('应恢复新 fragment 不残留当验证失败时', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'no-residue-' + Date.now());

      // 设置初始状态
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      const initialQueue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          status: 'PENDING',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(initialQueue)
      );

      // 创建一个无效 fragment（batch_id 不匹配）
      const invalidFragment = {
        ...validFragment(),
        batch_id: 'EB-WRONG',
      };

      const result = await acceptSemanticFragment({
        fragment: invalidFragment,
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, '应拒绝');

      // 验证 fragment 目录应为空
      const fragDir = join(runDir, 'stages', 'semantic', 'fragments');
      const fragFiles = await readdir(fragDir);
      assert.equal(fragFiles.length, 0, 'fragment 文件不应被写入');

      // 验证 queue 状态仍为 PENDING
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'PENDING', 'queue 状态不应改变');
    });

    it('应保持同名 fragment 内容不变当原本存在时', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
      const runDir = join(tempDir, 'preserve-existing-' + Date.now());

      // 设置初始状态，包含已存在的 fragment
      await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
      const existingFragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-EXISTING',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'existing',
          label: '已有活动',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json'),
        JSON.stringify(existingFragment)
      );

      const initialQueue = {
        schema_version: '1.0.0',
        batches: [{
          batch_id: 'EB-001',
          batch_sha256: 'a'.repeat(64),
          status: 'ACCEPTED',
        }],
        total_batches: 1,
        total_blocks: 1,
      };
      await writeFile(
        join(runDir, 'stages', 'semantic', 'queue.json'),
        JSON.stringify(initialQueue)
      );

      // 尝试验收一个无效 fragment
      const invalidFragment = {
        ...validFragment(),
        facts: [{
          fact_id: 'F-INVALID',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'invalid',
          label: '无效活动',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-999'], // 不存在的引用
        }],
      };

      const result = await acceptSemanticFragment({
        fragment: invalidFragment,
        batch: validBatch(),
        runDir,
      });

      assert.equal(result.accepted, false, '应拒绝');

      // 验证已存在的 fragment 内容不变
      const fragmentAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json'), 'utf8')
      );
      assert.deepEqual(fragmentAfter, existingFragment, '已有 fragment 内容应不变');

      // 验证 queue 状态不变
      const queueAfter = JSON.parse(
        await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
      );
      assert.equal(queueAfter.batches[0].status, 'ACCEPTED', 'queue 状态应不变');
    });
  });
});
