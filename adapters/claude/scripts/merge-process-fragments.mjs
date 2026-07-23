#!/usr/bin/env node

/**
 * 合并流程片段
 *
 * 将多个语义片段合并为一个规范化的流程草稿。
 *
 * 用法:
 *   node scripts/merge-process-fragments.mjs --run-dir <dir> [--focus <focus>]
 */

import { parseArgs } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeProcessFragments } from './lib/process-fragment-merge.mjs';
import { validateProcessDraft } from './lib/process-draft-contract.mjs';
import { writeJsonAtomic } from './lib/atomic-json.mjs';
import { verifyFragmentIntegrity } from './lib/fragment-integrity.mjs';

const args = parseArgs({
  options: {
    'run-dir': { type: 'string', short: 'r' },
    focus: { type: 'string', short: 'f' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/merge-process-fragments.mjs --run-dir <dir> [--focus <focus>]

合并流程片段为流程草稿。

选项:
  -r, --run-dir   运行目录
  -f, --focus     流程焦点（可选，多流程时必须指定）
  -h, --help      显示帮助

输入:
  <runDir>/input/input-manifest.json     输入清单
  <runDir>/evidence/evidence-index.json  证据索引
  <runDir>/stages/semantic/fragments/*.json  语义片段

输出:
  <runDir>/stages/merge/process-draft.json  流程草稿
  <runDir>/stages/merge/merge-report.json   合并报告
`);
  process.exit(0);
}

const runDir = args.values['run-dir'];
const focus = args.values.focus || null;

if (!runDir) {
  console.error('错误: 必须指定 --run-dir');
  process.exit(1);
}

async function main() {
  console.log('=== 合并流程片段 ===\n');

  // 1. 读取清单
  console.log('读取输入清单...');
  const manifest = JSON.parse(
    await readFile(join(runDir, 'input', 'input-manifest.json'), 'utf8')
  );
  console.log(`  标题: ${manifest.title}`);
  console.log(`  焦点: ${focus || '(未指定)'}`);

  // 2. 读取证据索引
  console.log('\n读取证据索引...');
  const evidence = JSON.parse(
    await readFile(join(runDir, 'evidence', 'evidence-index.json'), 'utf8')
  );
  console.log(`  证据块: ${evidence.total_blocks}`);

  // 3. 读取队列
  console.log('\n读取语义处理队列...');
  const queue = JSON.parse(
    await readFile(join(runDir, 'stages', 'semantic', 'queue.json'), 'utf8')
  );

  // 4. 调用共享完整性验证 + 读取片段
  console.log('\n验证并读取语义片段...');

  const integrityResult = await verifyFragmentIntegrity({ runDir, queue });
  if (!integrityResult.valid) {
    console.error('\n错误: Fragment 完整性验证失败:');
    integrityResult.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
  console.log(`  ✓ 完整性验证通过 (${integrityResult.checked} 个批次)`);

  // 读取所有片段（V2: 使用 task_id 而非 batch_id）
  const fragments = [];
  const fragmentsDir = join(runDir, 'stages', 'semantic', 'fragments');

  for (const batch of queue.batches) {
    const fragmentPath = join(fragmentsDir, `${batch.task_id}.json`);
    const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'));
    fragments.push(fragment);
    console.log(`  ✓ ${batch.task_id}`);
  }

  if (fragments.length === 0) {
    console.error('\n错误: 没有可用的语义片段');
    process.exit(1);
  }

  console.log(`\n已加载 ${fragments.length} 个片段`);

  // 5. 合并片段
  console.log('\n合并片段...');
  let result;
  try {
    result = await mergeProcessFragments({ manifest, evidence, fragments, focus, runDir });
  } catch (err) {
    console.error(`\n合并失败: ${err.message}`);
    process.exit(1);
  }

  // 6. 验证草稿
  console.log('\n验证流程草稿...');
  const validation = await validateProcessDraft(result.process_draft);
  if (!validation.valid) {
    console.error('流程草稿验证失败:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
  console.log('  ✓ 验证通过');

  // 7. 写入输出
  console.log('\n写入输出文件...');
  const mergeDir = join(runDir, 'stages', 'merge');
  await mkdir(mergeDir, { recursive: true });

  await writeJsonAtomic(join(mergeDir, 'process-draft.json'), result.process_draft);
  console.log('  ✓ process-draft.json');

  await writeJsonAtomic(join(mergeDir, 'merge-report.json'), result.merge_report);
  console.log('  ✓ merge-report.json');

  // 8. 报告摘要
  console.log('\n=== 合并完成 ===');
  console.log(`流程: ${result.process_draft.process_card.name}`);
  console.log(`活动: ${result.process_draft.activities.length}`);
  console.log(`泳道: ${result.process_draft.diagram.lanes.length}`);
  console.log(`流转: ${result.process_draft.diagram.flows.length}`);
  console.log(`问题: ${result.process_draft.questions.length}`);

  if (result.process_draft.questions.length > 0) {
    console.log('\n待确认问题:');
    result.process_draft.questions.slice(0, 5).forEach(q => {
      console.log(`  - ${q.question_id}: ${q.text}`);
    });
    if (result.process_draft.questions.length > 5) {
      console.log(`  ... 还有 ${result.process_draft.questions.length - 5} 个问题`);
    }
  }
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
