#!/usr/bin/env node
/**
 * normalize-inputs-to-markdown.mjs
 *
 * CLI 工具：将多格式输入文件归一化为可定位 Markdown 分片
 *
 * Usage:
 *   node scripts/normalize-inputs-to-markdown.mjs --input <path>... --run-dir <dir> [--dry-run] [--json]
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { extractArtifactEvidence } from './lib/source-evidence-extractor.mjs';
import { normalizeEvidenceToMarkdown } from './lib/markdown-normalizer.mjs';

const args = process.argv.slice(2);
const inputs = [];
let runDir = null;
let dryRun = false;
let jsonMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input') {
    while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      inputs.push(args[++i]);
    }
  } else if (args[i] === '--run-dir') {
    runDir = args[++i];
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--json') {
    jsonMode = true;
  }
}

if (inputs.length === 0 || !runDir) {
  process.stderr.write('用法: node scripts/normalize-inputs-to-markdown.mjs --input <path>... --run-dir <dir> [--dry-run] [--json]\n');
  process.exit(1);
}

const formatMap = {
  '.md': 'md', '.markdown': 'md',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.pptx': 'pptx',
  '.bpmn': 'bpmn', '.xml': 'bpmn',
  '.mmd': 'mermaid', '.mermaid': 'mermaid',
  '.svg': 'svg',
  '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg',
};

const absRunDir = resolve(runDir);
const results = [];

for (const input of inputs) {
  const absInput = resolve(input);
  const ext = extname(absInput).toLowerCase();
  const format = formatMap[ext];

  if (!format) {
    process.stderr.write(`跳过不支持的格式: ${absInput}\n`);
    continue;
  }

  try {
    await stat(absInput);
  } catch {
    process.stderr.write(`错误: 文件不存在 ${absInput}\n`);
    process.exit(1);
  }

  if (dryRun) {
    const fileStat = await stat(absInput);
    results.push({
      file: absInput,
      format,
      size: fileStat.size,
      plan: 'normalize to markdown chunks',
    });
    continue;
  }

  const { artifact_sha256, blocks } = await extractArtifactEvidence({
    artifact: { path: absInput, format },
    runDir: absRunDir,
  });

  const doc = await normalizeEvidenceToMarkdown({
    artifact: { path: absInput, format },
    artifactSha256: artifact_sha256,
    blocks,
    runDir: absRunDir,
    converterVersion: '1.0.0',
  });

  results.push({
    file: absInput,
    artifact_id: doc.artifact_id,
    artifact_sha256: doc.artifact_sha256,
    source_format: doc.source_format,
    chunk_count: doc.chunks.length,
    chunks: doc.chunks.map(c => ({
      chunk_id: c.chunk_id,
      path: c.path,
      modality: c.modality,
      budget_status: c.budget_status,
    })),
  });
}

if (jsonMode) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} else {
  for (const r of results) {
    if (dryRun) {
      process.stdout.write(`[dry-run] ${r.file} (${r.format}, ${r.size} bytes) → ${r.plan}\n`);
    } else {
      process.stdout.write(`${r.file} → ${r.artifact_id} (${r.chunk_count} chunks)\n`);
      for (const c of r.chunks) {
        process.stdout.write(`  ${c.chunk_id} [${c.modality}] ${c.path}\n`);
      }
    }
  }
}
