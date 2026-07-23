#!/usr/bin/env node

/**
 * 确定性评估单个语义 worker 的原始输出。
 *
 * 本脚本是确定性编排器（scripts/lib/semantic-worker-orchestrator.mjs）的 CLI 入口，
 * 供 Skill / harness 在每次 fresh worker 返回后调用，得到 ACCEPT / RETRY / FAIL 判定，
 * 从而决定「验收 / 用 fresh worker 重试 / 形成问题」，绝不手工修补模型 JSON。
 *
 * 用法:
 *   node scripts/evaluate-worker-output.mjs \
 *     --worker-output <worker 原始输出文件> \
 *     --batch <对应证据批次文件>
 *
 * 输出（stdout，JSON）:
 *   { verdict: 'ACCEPT'|'RETRY'|'FAIL', category, reason, fragment_sha256, issues }
 *
 * 退出码:
 *   0 = ACCEPT（可验收）
 *   1 = RETRY 或 FAIL（不可直接验收；以 verdict 字段区分重试还是形成问题）
 */

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { evaluateWorkerOutput, computeFragmentSha256 } from './lib/semantic-worker-orchestrator.mjs';

const args = parseArgs({
  options: {
    'worker-output': { type: 'string', short: 'w' },
    batch: { type: 'string', short: 'b' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/evaluate-worker-output.mjs --worker-output <file> --batch <file>

确定性评估 worker 原始输出，判定 ACCEPT / RETRY / FAIL。

选项:
  -w, --worker-output  worker 原始输出文件（原始文本，可能是坏 JSON）
  -b, --batch          对应证据批次文件
  -h, --help           显示帮助

判定:
  ACCEPT  通过 Schema 与业务冲突检查，可验收（fragment_sha256 给出最终哈希）
  RETRY   可恢复缺陷（JSON_PARSE / SCHEMA / INFERRED_MISSING_UNCERTAINTY），用 fresh worker 重试
  FAIL    业务语义冲突（BUSINESS_CONFLICT），形成问题，不得以重试掩盖
`);
  process.exit(0);
}

async function main() {
  const workerOutputPath = args.values['worker-output'];
  const batchPath = args.values.batch;

  if (!workerOutputPath || !batchPath) {
    console.error('错误: 必须指定 --worker-output 与 --batch');
    process.exit(1);
  }

  const rawText = await readFile(workerOutputPath, 'utf8');
  let batch = null;
  try {
    batch = JSON.parse(await readFile(batchPath, 'utf8'));
  } catch {
    batch = null;
  }

  const evaluation = await evaluateWorkerOutput(rawText, { batch });

  const out = {
    verdict: evaluation.verdict,
    category: evaluation.category,
    reason: evaluation.reason,
    fragment_sha256: evaluation.verdict === 'ACCEPT' && evaluation.fragment
      ? computeFragmentSha256(evaluation.fragment)
      : null,
    issues: evaluation.issues,
  };

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(evaluation.verdict === 'ACCEPT' ? 0 : 1);
}

main().catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
