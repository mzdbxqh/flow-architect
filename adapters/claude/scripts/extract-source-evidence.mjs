#!/usr/bin/env node

/**
 * 从输入文件抽取证据块
 *
 * 用法:
 *   node scripts/extract-source-evidence.mjs --input <file> --run-dir <dir>
 *
 * 输出:
 *   <runDir>/evidence/evidence-index.json
 *   <runDir>/evidence/blocks/<block-id>.json
 */

import { parseArgs } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { extractArtifactEvidence } from './lib/source-evidence-extractor.mjs';
import { validateEvidenceIndex } from './lib/process-draft-contract.mjs';
import { writeJsonAtomic } from './lib/atomic-json.mjs';

const args = parseArgs({
  options: {
    input: { type: 'string', short: 'i', multiple: true },
    'run-dir': { type: 'string', short: 'r' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/extract-source-evidence.mjs --input <file> [--input <file>...] --run-dir <dir>

从输入文件抽取证据块。

选项:
  -i, --input     输入文件路径（可多次指定）
  -r, --run-dir   运行目录
  -h, --help      显示帮助

输出:
  <runDir>/evidence/evidence-index.json   证据索引
  <runDir>/evidence/blocks/<block-id>.json  单个证据块
`);
  process.exit(0);
}

const inputs = args.values.input;
const runDir = args.values['run-dir'];

if (!inputs || inputs.length === 0) {
  console.error('错误: 必须指定至少一个 --input 文件');
  process.exit(1);
}

if (!runDir) {
  console.error('错误: 必须指定 --run-dir');
  process.exit(1);
}

// 格式映射
const formatMap = {
  '.md': 'md',
  '.markdown': 'md',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
  '.bpmn': 'bpmn',
  '.xml': 'bpmn',
  '.svg': 'svg',
  '.mmd': 'mermaid',
  '.mermaid': 'mermaid',
};

async function main() {
  // 创建目录
  const evidenceDir = join(runDir, 'evidence');
  const blocksDir = join(evidenceDir, 'blocks');
  await mkdir(blocksDir, { recursive: true });

  const allBlocks = [];
  const warnings = [];

  for (const inputPath of inputs) {
    const ext = extname(inputPath).toLowerCase();
    const format = formatMap[ext];

    if (!format) {
      warnings.push(`Unsupported file extension: ${ext} for ${inputPath}`);
      continue;
    }

    try {
      console.log(`抽取: ${basename(inputPath)}`);
      const result = await extractArtifactEvidence({
        artifact: { path: inputPath, format },
        runDir,
      });

      // 写入单个块文件
      for (const block of result.blocks) {
        await writeJsonAtomic(join(blocksDir, `${block.block_id}.json`), block);
        allBlocks.push(block);
      }

      console.log(`  -> ${result.blocks.length} 个证据块`);
    } catch (err) {
      warnings.push(`Error extracting ${inputPath}: ${err.message}`);
      console.error(`  -> 错误: ${err.message}`);
    }
  }

  // 验证证据索引
  const validation = await validateEvidenceIndex(allBlocks);
  if (!validation.valid) {
    console.error('证据验证失败:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }

  // 写入证据索引
  const index = {
    schema_version: '1.0.0',
    total_blocks: allBlocks.length,
    blocks: allBlocks.map(b => ({
      block_id: b.block_id,
      source_format: b.source_format,
      modality: b.modality,
      locator: b.locator,
      heading_path: b.heading_path,
      content_sha256: b.content_sha256,
    })),
    warnings,
  };

  await writeJsonAtomic(join(evidenceDir, 'evidence-index.json'), index);

  console.log(`\n完成: ${allBlocks.length} 个证据块已抽取`);
  if (warnings.length > 0) {
    console.log(`警告: ${warnings.length} 个`);
  }
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
