#!/usr/bin/env node

/**
 * 验收语义片段（V2 only）
 *
 * 验证 worker 输出的语义片段是否符合 V2 协议要求。
 * 验收通过后写入 fragments 目录并更新 queue。
 *
 * 用法:
 *   node scripts/accept-semantic-fragment.mjs \
 *     --fragment <file> \
 *     --batch <file> \
 *     --run-dir <dir>
 */

import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSemanticFragment } from './lib/process-draft-contract.mjs';
import { writeJsonAtomic } from './lib/atomic-json.mjs';

const args = parseArgs({
  options: {
    fragment: { type: 'string', short: 'f' },
    batch: { type: 'string', short: 'b' },
    'run-dir': { type: 'string', short: 'r' },
    'cache-dir': { type: 'string', short: 'c' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/accept-semantic-fragment.mjs --fragment <file> --batch <file> --run-dir <dir>

验收语义片段（V2 only）。

选项:
  -f, --fragment   语义片段文件路径
  -b, --batch      对应的证据批次文件路径
  -r, --run-dir    运行目录
  -c, --cache-dir  缓存目录（验收后回写缓存）
  -h, --help       显示帮助

验收检查:
  1. Schema 验证（V2）
  2. task_kind 和 batch hash 匹配
  3. evidence_refs 只引用当前 batch 的 block
  4. fact_id 唯一
  5. INFERRED 事实有对应的 uncertainty
`);
  process.exit(0);
}

/**
 * 验收语义片段（V2 only）
 *
 * @param {object} params
 * @param {object} params.fragment - V2 语义片段对象
 * @param {object} params.batch - 证据批次对象
 * @param {string} [params.runDir] - 运行目录（可选，用于写入文件）
 * @param {Function} [params._writeQueue] - 仅供测试使用的 queue 写入函数（依赖注入点）
 * @returns {Promise<{ accepted: boolean, errors?: string[] }>}
 */
export async function acceptSemanticFragment({ fragment, batch, runDir = null, cacheDir = null, _writeQueue = null }) {
  const errors = [];

  // 1. Schema 验证（V2 only）
  const schemaResult = await validateSemanticFragment(fragment);
  if (!schemaResult.valid) {
    errors.push(...schemaResult.errors.map(e => `Schema: ${e}`));
  }

  // 2. 批次 ID 匹配
  if (fragment.batch_id !== batch.batch_id) {
    errors.push(`Batch ID mismatch: fragment=${fragment.batch_id}, batch=${batch.batch_id}`);
  }

  // 3. 批次哈希匹配
  if (fragment.batch_sha256 !== batch.batch_sha256) {
    errors.push(`Batch hash mismatch: fragment=${fragment.batch_sha256}, batch=${batch.batch_sha256}`);
  }

  // 4. V2: evidence_refs 引用验证（从 payload.facts 和 payload.uncertainties 读取）
  const payload = fragment.payload || {};
  const facts = payload.facts || [];
  const uncertainties = payload.uncertainties || [];

  const batchBlockIds = new Set(batch.blocks.map(b => b.block_id));
  for (const fact of facts) {
    for (const ref of fact.evidence_refs) {
      if (!batchBlockIds.has(ref)) {
        errors.push(`Fact ${fact.fact_id}: evidence_ref ${ref} not in batch`);
      }
    }
  }

  for (const uncertainty of uncertainties) {
    for (const ref of uncertainty.evidence_refs) {
      if (!batchBlockIds.has(ref)) {
        errors.push(`Uncertainty: evidence_ref ${ref} not in batch`);
      }
    }
  }

  // 5. 输出大小检查
  const fragmentStr = JSON.stringify(fragment);
  if (fragmentStr.length > 100000) {
    errors.push(`Fragment too large: ${fragmentStr.length} chars`);
  }

  // 如果有错误，返回失败
  if (errors.length > 0) {
    return { accepted: false, errors };
  }

  // 写入文件（如果指定了 runDir）
  if (runDir) {
    // Fail closed: queue 必须存在且包含该 task
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    let queue;
    try {
      queue = JSON.parse(await readFile(queuePath, 'utf8'));
    } catch (err) {
      errors.push(`Queue file missing: ${queuePath}`);
      return { accepted: false, errors };
    }

    // 按 task_id 精确查找（V2: batch_id + task_kind）
    const taskEntry = queue.batches.find(
      b => b.batch_id === fragment.batch_id && b.task_kind === fragment.task_kind
    );
    if (!taskEntry) {
      errors.push(`Task ${fragment.batch_id}/${fragment.task_kind} not registered in queue`);
      return { accepted: false, errors };
    }

    // Queue entry hash 必须与 batch hash 匹配
    if (taskEntry.batch_sha256 !== batch.batch_sha256) {
      errors.push(`Queue hash mismatch for task ${taskEntry.task_id}`);
      return { accepted: false, errors };
    }

    // 准备写入路径（使用 task_id 而非 batch_id）
    const fragmentsDir = join(runDir, 'stages', 'semantic', 'fragments');
    await mkdir(fragmentsDir, { recursive: true });

    const fragmentFileName = `${taskEntry.task_id}.json`;
    const fragmentPath = join(fragmentsDir, fragmentFileName);

    // 保存旧 fragment 内容用于回滚（如果存在）
    let oldFragmentContent = null;
    try {
      oldFragmentContent = await readFile(fragmentPath, 'utf8');
    } catch {
      // 旧文件不存在，标记为新 fragment
    }

    // 计算新 fragment 内容哈希
    const { createHash } = await import('node:crypto');
    const newFragmentContent = JSON.stringify(fragment, null, 2) + '\n';
    const fragmentSha256 = createHash('sha256').update(newFragmentContent).digest('hex');

    // 写入 fragment
    await writeJsonAtomic(fragmentPath, fragment);

    // 更新 queue 状态和 fragment_sha256
    taskEntry.status = 'ACCEPTED';
    taskEntry.fragment_sha256 = fragmentSha256;

    // 写入 queue（支持依赖注入用于故障测试）
    const writeQueueFn = _writeQueue || (async () => {
      await writeJsonAtomic(queuePath, queue);
    });

    try {
      await writeQueueFn();
    } catch (err) {
      // 回滚 fragment：恢复旧内容或删除新文件
      if (oldFragmentContent !== null) {
        await writeFile(fragmentPath, oldFragmentContent, 'utf8');
      } else {
        const { unlink } = await import('node:fs/promises');
        try {
          await unlink(fragmentPath);
        } catch {
          // 删除失败不掩盖原始错误
        }
      }
      errors.push(`Queue write failed: ${err.message}`);
      return { accepted: false, errors };
    }

    // 缓存回写：将 fragment 和更新后的 queue 写入缓存
    if (cacheDir) {
      try {
        const cacheKeyPath = join(runDir, 'input', 'cache-key.json');
        const cacheKeyData = JSON.parse(await readFile(cacheKeyPath, 'utf8'));
        const cacheKey = cacheKeyData.cache_key;
        const cacheFragDir = join(cacheDir, cacheKey, 'fragments');
        await mkdir(cacheFragDir, { recursive: true });

        // 写入 fragment 到缓存（使用 task_id）
        await writeJsonAtomic(join(cacheFragDir, fragmentFileName), fragment);

        // 更新缓存的 queue.json
        const cacheQueuePath = join(cacheDir, cacheKey, 'queue.json');
        let cacheQueue;
        try {
          cacheQueue = JSON.parse(await readFile(cacheQueuePath, 'utf8'));
        } catch {
          cacheQueue = queue;
        }

        // 更新缓存 queue 中对应任务的状态
        const cacheTaskEntry = cacheQueue.batches?.find(
          b => b.batch_id === fragment.batch_id && b.task_kind === fragment.task_kind
        );
        if (cacheTaskEntry) {
          cacheTaskEntry.status = 'ACCEPTED';
          cacheTaskEntry.fragment_sha256 = fragmentSha256;
          await writeJsonAtomic(cacheQueuePath, cacheQueue);
        }
      } catch {
        // 缓存写回失败不影响本地验收结果
      }
    }
  }

  return { accepted: true };
}

// CLI 模式
if (process.argv[1]?.endsWith('accept-semantic-fragment.mjs')) {
  const fragmentPath = args.values.fragment;
  const batchPath = args.values.batch;
  const runDir = args.values['run-dir'];
  const cacheDir = args.values['cache-dir'];

  if (!fragmentPath || !batchPath || !runDir) {
    console.error('错误: 必须指定 --fragment, --batch, --run-dir');
    process.exit(1);
  }

  async function main() {
    try {
      const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'));
      const batch = JSON.parse(await readFile(batchPath, 'utf8'));

      const result = await acceptSemanticFragment({ fragment, batch, runDir, cacheDir });

      if (result.accepted) {
        console.log('✓ 语义片段验收通过');
        console.log(`  批次: ${fragment.batch_id}`);
        console.log(`  任务类型: ${fragment.task_kind}`);
        console.log(`  事实: ${fragment.payload?.facts?.length || 0}`);
        console.log(`  不确定性: ${fragment.payload?.uncertainties?.length || 0}`);
      } else {
        console.error('✗ 语义片段验收失败');
        result.errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
      }
    } catch (err) {
      console.error('错误:', err.message);
      process.exit(1);
    }
  }

  main();
}
