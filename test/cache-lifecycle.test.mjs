/**
 * 真实缓存生命周期测试
 *
 * 验证 prepare→accept→prepare(cached) 完整流程：
 * 1. 第一次 prepare 生成 batches/queue（全 PENDING）
 * 2. accept 每个 batch 的 fragment（全 ACCEPTED）
 * 3. 第二次 prepare 使用相同输入+cacheDir → 从缓存复制，queue 为 CACHED
 * 4. 污染场景：只回退对应批次
 * 5. 路径 containment
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, stat, writeFile, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const scriptsDir = join(__dirname, '..', 'scripts');

/**
 * 通过 CLI 调用 prepare-process-draft.mjs
 */
async function runPrepare({ inputs, runDir, cacheDir, title, focus }) {
  const args = [
    join(scriptsDir, 'prepare-process-draft.mjs'),
  ];
  for (const input of inputs) {
    args.push('--input', input);
  }
  args.push('--run-dir', runDir);
  if (cacheDir) args.push('--cache-dir', cacheDir);
  args.push('--title', title);
  if (focus) args.push('--focus', focus);

  const result = await execFileAsync('node', args, {
    cwd: join(__dirname, '..'),
    timeout: 30000,
  });
  return result;
}

/**
 * 通过 API 验收 fragment（直接 import，避免子进程开销）
 */
async function acceptFragment({ fragment, batch, runDir, cacheDir }) {
  const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');
  return acceptSemanticFragment({ fragment, batch, runDir, cacheDir });
}

/**
 * 读取 queue.json
 */
async function readQueue(runDir) {
  return JSON.parse(await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8'));
}

/**
 * 读取 batches
 */
async function readBatches(runDir) {
  const batchesDir = join(runDir, 'evidence', 'batches');
  const files = (await readdir(batchesDir)).filter(f => f.endsWith('.json')).sort();
  const batches = [];
  for (const f of files) {
    batches.push(JSON.parse(await readFile(join(batchesDir, f), 'utf8')));
  }
  return batches;
}

/**
 * 为 batch 构造一个合法的 semantic fragment
 */
function buildTestFragment(batch) {
  const blockIds = batch.blocks.map(b => b.block_id);
  return {
    schema_version: '1.0.0',
    batch_id: batch.batch_id,
    batch_sha256: batch.batch_sha256,
    facts: [
      {
        fact_id: `F-${batch.batch_id}-act`,
        kind: 'ACTIVITY',
        process_key: 'test-process',
        subject_key: 'step1',
        label: `活动-${batch.batch_id}`,
        attributes: { role: '测试角色' },
        certainty: 'EXPLICIT',
        evidence_refs: [blockIds[0]],
      },
      {
        fact_id: `F-${batch.batch_id}-role`,
        kind: 'ROLE',
        process_key: 'test-process',
        subject_key: 'tester',
        label: '测试角色',
        attributes: {},
        certainty: 'EXPLICIT',
        evidence_refs: [blockIds[0]],
      },
    ],
    uncertainties: [],
  };
}

describe('缓存生命周期', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cache-lifecycle-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('真实两次运行：第一次 prepare → accept → 第二次 prepare', () => {
    it('第二次 prepare 应从缓存复制，queue 全部 CACHED，不重新抽取', async () => {
      const testDir = join(tempDir, 'full-lifecycle');
      await mkdir(testDir, { recursive: true });

      const inputFile = join(testDir, 'input.md');
      await writeFile(inputFile, `# 测试流程\n\n## 第一节\n\n这是测试内容。\n\n## 第二节\n\n更多内容。\n`);

      const runDir1 = join(testDir, 'run1');
      const runDir2 = join(testDir, 'run2');
      const cacheDir = join(testDir, 'shared-cache');

      // ===== 第一次 prepare =====
      await runPrepare({
        inputs: [inputFile],
        runDir: runDir1,
        cacheDir,
        title: '缓存生命周期测试',
      });

      // 验证第一次 prepare 的结果
      const queue1 = await readQueue(runDir1);
      assert.ok(queue1.batches.length > 0, '应有至少一个批次');
      for (const entry of queue1.batches) {
        assert.equal(entry.status, 'PENDING', '第一次 prepare 后所有批次应为 PENDING');
      }

      // ===== accept 每个 batch =====
      const batches1 = await readBatches(runDir1);
      for (const batch of batches1) {
        const fragment = buildTestFragment(batch);
        const result = await acceptFragment({
          fragment,
          batch,
          runDir: runDir1,
          cacheDir,
        });
        assert.ok(result.accepted, `batch ${batch.batch_id} 应验收通过`);
      }

      // 验证 accept 后 queue 全部 ACCEPTED
      const queue1After = await readQueue(runDir1);
      for (const entry of queue1After.batches) {
        assert.equal(entry.status, 'ACCEPTED', 'accept 后所有批次应为 ACCEPTED');
        assert.ok(entry.fragment_sha256, '应有 fragment_sha256');
      }

      // ===== 第二次 prepare（应命中缓存）=====
      await runPrepare({
        inputs: [inputFile],
        runDir: runDir2,
        cacheDir,
        title: '缓存生命周期测试',
      });

      // 核心断言：第二次 prepare 的 queue 项应为 CACHED
      const queue2 = await readQueue(runDir2);
      assert.equal(queue2.batches.length, queue1.batches.length,
        '两次 prepare 的批次数应相同');

      for (const entry of queue2.batches) {
        assert.equal(entry.status, 'CACHED',
          `batch ${entry.batch_id} 在第二次 prepare 后应为 CACHED，实际 ${entry.status}`);
        assert.ok(entry.fragment_sha256, `batch ${entry.batch_id} 应保留 fragment_sha256`);
      }

      // 核心断言：fragment 文件应存在于第二次 runDir
      for (const batch of batches1) {
        const fragPath = join(runDir2, 'stages', 'semantic', 'fragments', `${batch.batch_id}.json`);
        const fragContent = await readFile(fragPath, 'utf8');
        const frag = JSON.parse(fragContent);
        assert.equal(frag.batch_id, batch.batch_id, 'fragment batch_id 应匹配');
        assert.equal(frag.batch_sha256, batch.batch_sha256, 'fragment batch_sha256 应匹配');

        // fragment_sha256 应与 queue 记录一致
        const actualSha = createHash('sha256').update(fragContent).digest('hex');
        const queueEntry = queue2.batches.find(b => b.batch_id === batch.batch_id);
        assert.equal(actualSha, queueEntry.fragment_sha256,
          `fragment 文件 SHA-256 应与 queue 记录一致`);
      }

      // 核心断言：批次文件应存在于第二次 runDir（从缓存复制）
      const batches2 = await readBatches(runDir2);
      assert.equal(batches2.length, batches1.length, '两次 prepare 的 batch 文件数应相同');
      for (let i = 0; i < batches1.length; i++) {
        assert.equal(batches2[i].batch_id, batches1[i].batch_id, 'batch_id 应一致');
        assert.equal(batches2[i].batch_sha256, batches1[i].batch_sha256, 'batch_sha256 应一致');
      }
    });

    it('第二次 prepare 的 fragment 完整性验证应通过', async () => {
      const testDir = join(tempDir, 'integrity-check');
      await mkdir(testDir, { recursive: true });

      const inputFile = join(testDir, 'input.md');
      await writeFile(inputFile, `# 完整性测试\n\n测试内容用于完整性验证。\n`);

      const runDir1 = join(testDir, 'run1');
      const runDir2 = join(testDir, 'run2');
      const cacheDir = join(testDir, 'cache');

      // 第一次 prepare + accept
      await runPrepare({ inputs: [inputFile], runDir: runDir1, cacheDir, title: '完整性测试' });
      const batches1 = await readBatches(runDir1);
      for (const batch of batches1) {
        const fragment = buildTestFragment(batch);
        await acceptFragment({ fragment, batch, runDir: runDir1, cacheDir });
      }

      // 第二次 prepare
      await runPrepare({ inputs: [inputFile], runDir: runDir2, cacheDir, title: '完整性测试' });

      // 调用共享完整性验证
      const { verifyFragmentIntegrity } = await import('../scripts/lib/fragment-integrity.mjs');
      const result = await verifyFragmentIntegrity({ runDir: runDir2 });
      assert.ok(result.valid, `完整性验证应通过: ${result.errors.join(', ')}`);
      assert.ok(result.checked > 0, '应至少检查一个批次');
    });
  });

  describe('污染检测与回退', () => {
    it('batch hash 被篡改时，只回退对应批次为 PENDING，其他仍为 CACHED', async () => {
      const testDir = join(tempDir, 'pollution-hash');
      await mkdir(testDir, { recursive: true });

      // 准备足够多的输入文件以产生多个批次
      const inputFile = join(testDir, 'input.md');
      let content = '# 多批次测试\n\n';
      for (let i = 0; i < 30; i++) {
        content += `## 章节 ${i}\n\n这是第 ${i} 章节的内容，包含足够的文本以生成多个批次。\n\n`;
      }
      await writeFile(inputFile, content);

      const runDir1 = join(testDir, 'run1');
      const runDir2 = join(testDir, 'run2');
      const cacheDir = join(testDir, 'cache');

      // 第一次 prepare + accept
      await runPrepare({ inputs: [inputFile], runDir: runDir1, cacheDir, title: '多批次测试' });
      const batches1 = await readBatches(runDir1);

      // 只在批次数 > 1 时测试污染回退
      if (batches1.length < 2) {
        // 如果只有一个批次，跳过此测试
        return;
      }

      for (const batch of batches1) {
        const fragment = buildTestFragment(batch);
        await acceptFragment({ fragment, batch, runDir: runDir1, cacheDir });
      }

      // 篡改缓存中的第一个 batch 的 hash
      const cacheKey = JSON.parse(
        await readFile(join(runDir1, 'input', 'cache-key.json'), 'utf8')
      ).cache_key;
      const cachePath = join(cacheDir, cacheKey);
      const cachedBatches = JSON.parse(await readFile(join(cachePath, 'batches.json'), 'utf8'));
      cachedBatches[0].batch_sha256 = 'x'.repeat(64);
      await writeFile(join(cachePath, 'batches.json'), JSON.stringify(cachedBatches, null, 2));

      // 第二次 prepare
      await runPrepare({ inputs: [inputFile], runDir: runDir2, cacheDir, title: '多批次测试' });

      const queue2 = await readQueue(runDir2);
      const tampered = queue2.batches.find(b => b.batch_id === cachedBatches[0].batch_id);
      const others = queue2.batches.filter(b => b.batch_id !== cachedBatches[0].batch_id);

      // 被篡改的批次应为 PENDING
      assert.equal(tampered.status, 'PENDING',
        `被篡改的批次 ${tampered.batch_id} 应回退为 PENDING`);

      // 其他批次应仍为 CACHED
      for (const entry of others) {
        assert.equal(entry.status, 'CACHED',
          `未篡改的批次 ${entry.batch_id} 应仍为 CACHED`);
      }
    });

    it('fragment 文件在缓存中被删除时，对应批次回退为 PENDING', async () => {
      const testDir = join(tempDir, 'pollution-missing');
      await mkdir(testDir, { recursive: true });

      const inputFile = join(testDir, 'input.md');
      let content = '# 缺失 fragment 测试\n\n';
      for (let i = 0; i < 30; i++) {
        content += `## 章节 ${i}\n\n这是第 ${i} 章节的内容，包含足够的文本。\n\n`;
      }
      await writeFile(inputFile, content);

      const runDir1 = join(testDir, 'run1');
      const runDir2 = join(testDir, 'run2');
      const cacheDir = join(testDir, 'cache');

      // 第一次 prepare + accept
      await runPrepare({ inputs: [inputFile], runDir: runDir1, cacheDir, title: '缺失 fragment 测试' });
      const batches1 = await readBatches(runDir1);

      if (batches1.length < 2) return;

      for (const batch of batches1) {
        const fragment = buildTestFragment(batch);
        await acceptFragment({ fragment, batch, runDir: runDir1, cacheDir });
      }

      // 删除缓存中第一个 batch 的 fragment 文件
      const cacheKey = JSON.parse(
        await readFile(join(runDir1, 'input', 'cache-key.json'), 'utf8')
      ).cache_key;
      const fragDir = join(cacheDir, cacheKey, 'fragments');
      const targetBatch = batches1[0];
      const { unlink } = await import('node:fs/promises');
      await unlink(join(fragDir, `${targetBatch.batch_id}.json`));

      // 第二次 prepare
      await runPrepare({ inputs: [inputFile], runDir: runDir2, cacheDir, title: '缺失 fragment 测试' });

      const queue2 = await readQueue(runDir2);
      const tampered = queue2.batches.find(b => b.batch_id === targetBatch.batch_id);
      const others = queue2.batches.filter(b => b.batch_id !== targetBatch.batch_id);

      assert.equal(tampered.status, 'PENDING',
        'fragment 缺失的批次应回退为 PENDING');

      for (const entry of others) {
        assert.equal(entry.status, 'CACHED',
          '其他批次应仍为 CACHED');
      }
    });
  });

  describe('路径 containment', () => {
    it('缓存和 runDir 的所有路径应通过 containment 验证', async () => {
      const testDir = join(tempDir, 'containment');
      await mkdir(testDir, { recursive: true });

      const inputFile = join(testDir, 'input.md');
      await writeFile(inputFile, `# Containment 测试\n\n测试路径安全。\n`);

      const runDir = join(testDir, 'run');
      const cacheDir = join(testDir, 'cache');

      await runPrepare({ inputs: [inputFile], runDir, cacheDir, title: 'Containment 测试' });

      // 验证 runDir 下的所有路径都在 runDir 内
      const { isPathContained } = await import('../scripts/lib/path-containment.mjs');

      async function assertAllContained(dir, root) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          assert.ok(
            isPathContained(fullPath, root),
            `路径 ${fullPath} 应在 ${root} 内`
          );
          if (entry.isDirectory()) {
            await assertAllContained(fullPath, root);
          }
        }
      }

      await assertAllContained(runDir, testDir);
      await assertAllContained(cacheDir, testDir);
    });
  });

  describe('缓存写回失败不得破坏本地已 ACCEPTED 状态', () => {
    it('accept 后缓存写回失败，本地 queue 仍为 ACCEPTED', async () => {
      const testDir = join(tempDir, 'cache-write-fail');
      await mkdir(testDir, { recursive: true });

      const inputFile = join(testDir, 'input.md');
      await writeFile(inputFile, `# 写回失败测试\n\n测试缓存写回失败时的回滚。\n`);

      const runDir = join(testDir, 'run');
      const cacheDir = join(testDir, 'cache');

      // 第一次 prepare（不使用缓存，创建缓存）
      await runPrepare({ inputs: [inputFile], runDir, cacheDir, title: '写回失败测试' });

      const batches = await readBatches(runDir);
      const batch = batches[0];
      const fragment = buildTestFragment(batch);

      // 验收，但 cacheDir 指向一个不可写的位置（模拟写回失败）
      const badCacheDir = join(testDir, 'nonexistent-deeply-nested', 'cache');
      const result = await acceptFragment({
        fragment,
        batch,
        runDir,
        cacheDir: badCacheDir,
      });

      // 即使缓存写回失败，本地验收应成功
      assert.ok(result.accepted, '即使缓存写回失败，本地验收应成功');

      // 本地 queue 应为 ACCEPTED
      const queue = await readQueue(runDir);
      const entry = queue.batches.find(b => b.batch_id === batch.batch_id);
      assert.equal(entry.status, 'ACCEPTED', '本地 queue 应仍为 ACCEPTED');

      // fragment 文件应存在
      const fragPath = join(runDir, 'stages', 'semantic', 'fragments', `${batch.batch_id}.json`);
      await stat(fragPath); // 不应抛出
    });
  });
});
