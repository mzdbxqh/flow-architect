#!/usr/bin/env node
/**
 * discover-process-candidates.mjs — 流程焦点只读预检 CLI 入口（零写入）。
 *
 * 供严格入口/技能在创建 runDir 之前调用：只读发现候选流程键/名称/层级/证据定位，
 * 多候选且无 focus 时输出一个证据驱动焦点问题。本脚本绝不创建运行目录、绝不写盘。
 *
 * 用法:
 *   node scripts/discover-process-candidates.mjs --input <file> [--input <file>...] [--focus <focus>]
 *
 * 输出（stdout，JSON）:
 *   {
 *     status: 'SINGLE_CANDIDATE' | 'NEEDS_FOCUS_CHOICE' | 'NO_CANDIDATE',
 *     selected_process_key: string | null,
 *     candidates: [{ process_key, display_code, name, level, evidence_locator, has_complete_l5 }],
 *     clarification: object | null   // 多候选且无 focus 时为单一焦点问题
 *   }
 */

import { parseArgs } from 'node:util';
import { extname } from 'node:path';
import { discoverProcessCandidates, buildFocusClarification } from './lib/process-focus-precheck.mjs';

// 与 prepare-process-draft.mjs 一致的扩展名 → 格式映射（唯一用于预检的文本格式会贡献候选）。
const FORMAT_MAP = {
  '.md': 'md',
  '.markdown': 'md',
  '.bpmn': 'bpmn',
  '.xml': 'bpmn',
  '.svg': 'svg',
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
};

const args = parseArgs({
  options: {
    input: { type: 'string', short: 'i', multiple: true },
    focus: { type: 'string', short: 'f' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/discover-process-candidates.mjs --input <file> [--input <file>...] [--focus <focus>]

流程焦点只读预检：发现候选流程并在多候选且无焦点时输出单一焦点问题。
零写入：不创建运行目录，不修改任何文件。
`);
  process.exit(0);
}

const inputs = args.values.input;
if (!inputs || inputs.length === 0) {
  console.error('错误: 必须指定至少一个 --input 文件');
  process.exit(1);
}

const focus = args.values.focus || null;

const discovered = [];
for (const inputPath of inputs) {
  const format = FORMAT_MAP[extname(inputPath).toLowerCase()];
  if (!format) continue; // 不支持的格式不贡献候选（与严格入口的格式门一致）
  discovered.push({ path: inputPath, format });
}

const { candidates } = await discoverProcessCandidates({ inputs: discovered, focus });

// 裁剪内部字段（_blocks）后输出，保持对外 JSON 干净、可序列化。
const publicCandidates = candidates.map(({ _blocks, ...rest }) => rest);

let status;
if (publicCandidates.length === 0) {
  status = 'NO_CANDIDATE';
} else if (publicCandidates.length === 1) {
  status = 'SINGLE_CANDIDATE';
} else {
  status = 'NEEDS_FOCUS_CHOICE';
}

const clarification = !focus ? buildFocusClarification(candidates) : null;

const result = {
  status,
  selected_process_key: focus,
  candidates: publicCandidates,
  clarification,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
