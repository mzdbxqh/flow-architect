#!/usr/bin/env node
/**
 * measure-context-budget.mjs
 *
 * CLI 工具：估算一个或多个文件的 Token 预算
 *
 * Usage:
 *   node scripts/measure-context-budget.mjs --file <path>... [--limit <n>] [--json]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { estimateTokens, assessBudget, buildContextBudget, BUDGET_STATUS } from './lib/context-budget.mjs';

const args = process.argv.slice(2);
const files = [];
let limit = 2000; // default: single skill limit
let jsonMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') {
    while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      files.push(args[++i]);
    }
  } else if (args[i] === '--limit') {
    limit = parseInt(args[++i], 10);
  } else if (args[i] === '--json') {
    jsonMode = true;
  }
}

if (files.length === 0) {
  process.stderr.write('用法: node scripts/measure-context-budget.mjs --file <path>... [--limit <n>] [--json]\n');
  process.exit(1);
}

const texts = [];
const absPaths = [];

for (const f of files) {
  const abs = resolve(f);
  try {
    const text = await readFile(abs, 'utf8');
    texts.push(text);
    absPaths.push(abs);
  } catch {
    process.stderr.write(`错误: 文件不存在 ${abs}\n`);
    process.exit(1);
  }
}

const allText = texts.join('\n');
const estimate = estimateTokens(allText);
const assessment = assessBudget({ used: estimate.estimated_tokens, limit });
const budget = buildContextBudget({
  contentTexts: texts,
  fixedTexts: [],
  metadataTexts: [],
  limit,
  sourceIds: absPaths,
});

if (jsonMode) {
  process.stdout.write(JSON.stringify(budget, null, 2) + '\n');
} else {
  process.stdout.write(`Token 预算报告\n`);
  process.stdout.write(`  汉字: ${budget.total.han_chars}\n`);
  process.stdout.write(`  ASCII: ${budget.total.ascii_chars}\n`);
  process.stdout.write(`  其他: ${budget.total.other_chars}\n`);
  process.stdout.write(`  估算 Token: ${budget.total.estimated_tokens}\n`);
  process.stdout.write(`  预算上限: ${budget.limit}\n`);
  process.stdout.write(`  比率: ${(budget.ratio * 100).toFixed(1)}%\n`);
  process.stdout.write(`  状态: ${budget.status}\n`);
  if (budget.split_required) {
    process.stdout.write(`  ⚠ 必须拆分\n`);
  }
}
