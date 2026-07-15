#!/usr/bin/env node

/**
 * 生成 L5 BPMN 2.0
 *
 * 从流程草稿生成 BPMN XML 和澄清议题。
 *
 * 用法:
 *   node scripts/generate-l5-bpmn.mjs --run-dir <dir>
 */

import { parseArgs } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { generateL5Bpmn } from './lib/l5-bpmn-generator.mjs';
import { renderClarificationAgenda } from './lib/render-clarification-agenda.mjs';
import { writeJsonAtomic } from './lib/atomic-json.mjs';

const args = parseArgs({
  options: {
    'run-dir': { type: 'string', short: 'r' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/generate-l5-bpmn.mjs --run-dir <dir>

从流程草稿生成 BPMN XML 和澄清议题。

选项:
  -r, --run-dir   运行目录
  -h, --help      显示帮助

输入:
  <runDir>/stages/merge/process-draft.json  流程草稿

输出:
  <runDir>/final/process.bpmn               BPMN 2.0 XML
  <runDir>/final/clarification-agenda.md     澄清议题
  <runDir>/final/process-draft.json          最终流程草稿
`);
  process.exit(0);
}

const runDir = args.values['run-dir'];

if (!runDir) {
  console.error('错误: 必须指定 --run-dir');
  process.exit(1);
}

async function main() {
  console.log('=== 生成 L5 BPMN 2.0 ===\n');

  // 1. 读取流程草稿
  console.log('读取流程草稿...');
  const draftPath = join(runDir, 'stages', 'merge', 'process-draft.json');
  let draft;
  try {
    draft = JSON.parse(await readFile(draftPath, 'utf8'));
  } catch (err) {
    console.error(`错误: 无法读取流程草稿: ${err.message}`);
    process.exit(1);
  }

  console.log(`  流程: ${draft.title}`);
  console.log(`  元素: ${draft.elements.length}`);
  console.log(`  问题: ${draft.questions.length}`);

  // 2. 生成 BPMN
  console.log('\n生成 BPMN 2.0...');
  const bpmn = generateL5Bpmn(draft);
  console.log(`  生成 ${bpmn.length} 字节的 BPMN XML`);

  // 3. 生成澄清议题
  console.log('\n生成澄清议题...');
  const agenda = renderClarificationAgenda(draft);
  console.log(`  生成 ${agenda.length} 字节的议题`);

  // 4. 写入输出
  console.log('\n写入输出文件...');
  const finalDir = join(runDir, 'final');
  await mkdir(finalDir, { recursive: true });

  // 写入 BPMN
  await writeFile(join(finalDir, 'process.bpmn'), bpmn, 'utf8');
  console.log('  ✓ process.bpmn');

  // 写入议题
  await writeFile(join(finalDir, 'clarification-agenda.md'), agenda, 'utf8');
  console.log('  ✓ clarification-agenda.md');

  // 写入最终流程草稿
  await writeJsonAtomic(join(finalDir, 'process-draft.json'), draft);
  console.log('  ✓ process-draft.json');

  // 5. 报告摘要
  console.log('\n=== 生成完成 ===');
  console.log(`BPMN: ${finalDir}/process.bpmn`);
  console.log(`议题: ${finalDir}/clarification-agenda.md`);
  console.log(`草稿: ${finalDir}/process-draft.json`);

  if (draft.questions.length > 0) {
    console.log(`\n待确认问题: ${draft.questions.length} 个`);
  }
}

import { writeFile as writeFileRaw } from 'node:fs/promises';

async function writeFile(path, content, encoding) {
  await writeFileRaw(path, content, encoding);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
