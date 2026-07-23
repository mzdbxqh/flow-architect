#!/usr/bin/env node

/**
 * Finalize 流程草稿
 *
 * 生成最终产物：BPMN、HTML、问题 JSON 和澄清议题。
 *
 * 用法:
 *   node scripts/finalize-process-draft.mjs --run-dir <dir> [--revision <revision>]
 */

import { parseArgs } from 'node:util';
import { finalizeProcessDraft } from './lib/process-draft-pipeline.mjs';

const args = parseArgs({
  options: {
    'run-dir': { type: 'string', short: 'r' },
    revision: { type: 'string', short: 'v', default: 'r01' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/finalize-process-draft.mjs --run-dir <dir> [--revision <revision>]

Finalize 流程草稿，生成最终产物。

选项:
  -r, --run-dir     运行目录
  -v, --revision    修订号（默认: r01）
  -h, --help        显示帮助

输入:
  <runDir>/stages/merge/process-draft.json  流程草稿

输出:
  <runDir>/final/process.bpmn               BPMN 2.0 XML
  <runDir>/final/questions.json             待确认问题
  <runDir>/final/clarification-agenda.md     澄清议题
  <runDir>/final/process-draft.json          最终流程草稿
  <runDir>/final/<title>-<revision>.html     HTML 会议包
`);
  process.exit(0);
}

const runDir = args.values['run-dir'];
const revision = args.values.revision;

if (!runDir) {
  console.error('错误: 必须指定 --run-dir');
  process.exit(1);
}

async function main() {
  console.log('=== Finalize 流程草稿 ===\n');

  try {
    const result = await finalizeProcessDraft({ runDir, revision });

    console.log('\n=== Finalize 完成 ===');
    console.log('\n生成的文件:');
    for (const file of result.files) {
      console.log(`  ✓ ${file}`);
    }

    console.log(`\nHTML 会议包: ${result.files.find(f => f.endsWith('.html'))}`);
    console.log('\n下一步:');
    console.log('  1. 在浏览器中打开 HTML 文件');
    console.log('  2. 查看待确认问题');
    console.log('  3. 与业务人员讨论并补充信息');
    console.log('  4. 导出修订版本');
  } catch (err) {
    console.error(`\n错误: ${err.message}`);
    process.exit(1);
  }
}

main();
