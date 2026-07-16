#!/usr/bin/env node

/**
 * 准备流程草稿运行
 *
 * 从输入文件生成 manifest、evidence blocks、batches 和 queue。
 * 纯确定性脚本，不调用 LLM。
 *
 * 用法:
 *   node scripts/prepare-process-draft.mjs \
 *     --input <file> [--input <file>...] \
 *     --run-dir <dir> \
 *     [--cache-dir <dir>] \
 *     --title <title> \
 *     [--focus <focus>] \
 *     [--dry-run]
 */

import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { extractArtifactEvidence } from './lib/source-evidence-extractor.mjs';
import { buildEvidenceBatches } from './lib/evidence-batching.mjs';
import { validateEvidenceIndex, validateEvidenceBatch } from './lib/process-draft-contract.mjs';
import { writeJsonAtomic } from './lib/atomic-json.mjs';
import { normalizeEvidenceToMarkdown } from './lib/markdown-normalizer.mjs';

/**
 * 抽取器版本 — 缓存键的一部分
 */
const EXTRACTOR_VERSION = '1.0.0';
const BATCH_PROTOCOL_VERSION = '1.0.0';
const NORMALIZER_VERSION = '1.0.0';
const FORMULA_VERSION = '1.0.0';

/**
 * 计算内容寻址缓存键
 */
function computeCacheKey(inputHashes, batchParams) {
  const keyData = {
    extractor_version: EXTRACTOR_VERSION,
    protocol_version: BATCH_PROTOCOL_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    formula_version: FORMULA_VERSION,
    input_hashes: inputHashes.sort(),
    batch_params: batchParams,
  };
  return createHash('sha256').update(JSON.stringify(keyData)).digest('hex');
}

/**
 * 检查缓存是否命中并验证完整性
 *
 * 缓存键包含 input hash、抽取器版本、协议版本和批次参数。
 * 命中时重验 Schema、batch hash、fragment 引用，污染则回退 PENDING。
 *
 * @param {object} params
 * @param {string} params.cacheDir - 缓存目录
 * @param {string} params.cacheKey - 缓存键
 * @param {object} params.batchParams - 批次参数
 * @returns {Promise<{ hit: boolean, batches?: object[], queue?: object }>}
 */
async function checkCache({ cacheDir, cacheKey, batchParams }) {
  const cachePath = join(cacheDir, cacheKey);
  const metaPath = join(cachePath, 'cache-meta.json');

  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));

    // 验证缓存键匹配
    if (meta.cache_key !== cacheKey) {
      return { hit: false };
    }

    // 验证版本匹配
    if (meta.extractor_version !== EXTRACTOR_VERSION || meta.protocol_version !== BATCH_PROTOCOL_VERSION) {
      return { hit: false };
    }

    // 验证批次参数匹配
    if (meta.batch_params.maxChars !== batchParams.maxChars || meta.batch_params.maxBlocks !== batchParams.maxBlocks) {
      return { hit: false };
    }

    // 读取缓存的批次和队列
    const batchesPath = join(cachePath, 'batches.json');
    const queuePath = join(cachePath, 'queue.json');

    let batches, queue;
    try {
      batches = JSON.parse(await readFile(batchesPath, 'utf8'));
      queue = JSON.parse(await readFile(queuePath, 'utf8'));
    } catch {
      return { hit: false };
    }

    // 重验每个批次的 hash 和 fragment 引用
    const pollutedBatches = [];

    for (const batch of batches) {
      // Schema 验证：确保批次符合 evidence-batch schema
      const schemaResult = await validateEvidenceBatch(batch);
      if (!schemaResult.valid) {
        pollutedBatches.push({ batch_id: batch.batch_id, reason: 'schema_violation', errors: schemaResult.errors });
        continue;
      }

      // 重新计算 batch hash 并比较（hash 验证已保证内容完整性）
      const contentHashes = batch.blocks.map(b => b.content_sha256).sort().join(',');
      const recomputedHash = createHash('sha256').update(contentHashes).digest('hex');
      if (recomputedHash !== batch.batch_sha256) {
        pollutedBatches.push({ batch_id: batch.batch_id, reason: 'hash_mismatch' });
        continue;
      }

      // 验证 fragment 引用（如果队列中有对应 fragment）
      const queueEntry = queue.batches?.find(q => q.batch_id === batch.batch_id);
      if (queueEntry && queueEntry.status === 'ACCEPTED') {
        const fragPath = join(cachePath, 'fragments', `${batch.batch_id}.json`);
        try {
          const frag = JSON.parse(await readFile(fragPath, 'utf8'));
          if (frag.batch_sha256 !== batch.batch_sha256) {
            pollutedBatches.push({ batch_id: batch.batch_id, reason: 'fragment_hash_mismatch' });
          }
        } catch {
          // Fragment 文件缺失，标记为需要重新处理
          pollutedBatches.push({ batch_id: batch.batch_id, reason: 'fragment_missing' });
        }
      }
    }

    // 如果有污染的批次，将它们回退到 PENDING
    if (pollutedBatches.length > 0) {
      for (const polluted of pollutedBatches) {
        const queueEntry = queue.batches?.find(q => q.batch_id === polluted.batch_id);
        if (queueEntry) {
          queueEntry.status = 'PENDING';
        }
      }
      console.log(`  缓存污染检测: ${pollutedBatches.length} 个批次回退到 PENDING`);
    }

    return { hit: true, batches, queue };
  } catch {
    return { hit: false };
  }
}

const args = parseArgs({
  options: {
    input: { type: 'string', short: 'i', multiple: true },
    'run-dir': { type: 'string', short: 'r' },
    'cache-dir': { type: 'string', short: 'c' },
    title: { type: 'string', short: 't' },
    focus: { type: 'string', short: 'f' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/prepare-process-draft.mjs --input <file> [--input <file>...] --run-dir <dir> [选项]

准备流程草稿运行：生成 manifest、证据块、批次和队列。

选项:
  -i, --input       输入文件路径（可多次指定）
  -r, --run-dir     运行目录
  -c, --cache-dir   缓存目录（默认: <runDir>/.cache）
  -t, --title       流程标题
  -f, --focus       流程焦点（可选）
  -d, --dry-run     只检查输入和依赖，不创建文件
  -h, --help        显示帮助

输出:
  <runDir>/input/input-manifest.json     输入清单
  <runDir>/evidence/evidence-index.json  证据索引
  <runDir>/evidence/blocks/*.json        单个证据块
  <runDir>/evidence/batches/*.json       证据批次
  <runDir>/stages/semantic/queue.json    语义处理队列
`);
  process.exit(0);
}

const inputs = args.values.input;
const runDir = args.values['run-dir'];
const cacheDir = args.values['cache-dir'] || (runDir ? join(runDir, '.cache') : null);
const title = args.values.title;
const focus = args.values.focus;
const dryRun = args.values['dry-run'];

// 验证参数
if (!inputs || inputs.length === 0) {
  console.error('错误: 必须指定至少一个 --input 文件');
  process.exit(1);
}

if (!runDir) {
  console.error('错误: 必须指定 --run-dir');
  process.exit(1);
}

if (!title) {
  console.error('错误: 必须指定 --title');
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
  console.log('=== 准备流程草稿运行 ===\n');

  // 1. 检查输入文件
  console.log('检查输入文件...');
  const validInputs = [];
  const warnings = [];

  for (const inputPath of inputs) {
    try {
      await stat(inputPath);
      const ext = extname(inputPath).toLowerCase();
      const format = formatMap[ext];

      if (!format) {
        warnings.push(`不支持的文件格式: ${ext} (${basename(inputPath)})`);
        continue;
      }

      validInputs.push({ path: inputPath, format });
      console.log(`  ✓ ${basename(inputPath)} (${format})`);
    } catch {
      warnings.push(`文件不存在: ${inputPath}`);
      console.error(`  ✗ ${basename(inputPath)} (不存在)`);
    }
  }

  if (validInputs.length === 0) {
    console.error('\n错误: 没有有效的输入文件');
    process.exit(1);
  }

  // 2. 计算输入哈希并去重
  console.log('\n计算输入哈希...');
  const inputHashes = [];
  const seenHashes = new Set();
  for (const input of validInputs) {
    const content = await readFile(input.path);
    const hash = createHash('sha256').update(content).digest('hex');

    // 去重：相同哈希的文件只处理一次
    if (seenHashes.has(hash)) {
      console.log(`  ${basename(input.path)}: ${hash.slice(0, 16)}... (已去重)`);
      continue;
    }
    seenHashes.add(hash);

    inputHashes.push({ ...input, sha256: hash });
    console.log(`  ${basename(input.path)}: ${hash.slice(0, 16)}...`);
  }

  // 3. 预估批次
  console.log('\n预估批次...');
  const estimatedBatches = estimateBatches(validInputs);
  console.log(`  预计批次: ${estimatedBatches}`);

  // 计算缓存键
  const batchParams = { maxChars: 12000, maxBlocks: 12 };
  const cacheKey = computeCacheKey(
    inputHashes.map(i => i.sha256),
    batchParams,
  );

  // 4. Dry-run 模式 — 只读，不创建 run/cache
  if (dryRun) {
    console.log('\n=== Dry-Run 模式 ===');
    console.log('\n执行计划:');
    console.log(`  输入文件: ${validInputs.length} 个`);
    console.log(`  流程标题: ${title}`);
    console.log(`  流程焦点: ${focus || '(未指定)'}`);
    console.log(`  运行目录: ${runDir}`);
    console.log(`  缓存目录: ${cacheDir}`);
    console.log(`  预计批次: ${estimatedBatches}`);
    console.log(`  缓存键: ${cacheKey}`);
    console.log(`  抽取器版本: ${EXTRACTOR_VERSION}`);
    console.log(`  协议版本: ${BATCH_PROTOCOL_VERSION}`);

    if (warnings.length > 0) {
      console.log('\n警告:');
      warnings.forEach(w => console.log(`  - ${w}`));
    }

    console.log('\n输出文件:');
    console.log(`  ${join(runDir, 'input/input-manifest.json')}`);
    console.log(`  ${join(runDir, 'evidence/evidence-index.json')}`);
    console.log(`  ${join(runDir, 'evidence/blocks/*.json')}`);
    console.log(`  ${join(runDir, 'evidence/batches/*.json')}`);
    console.log(`  ${join(runDir, 'stages/semantic/queue.json')}`);

    // 输出确定性计划哈希
    const planHash = createHash('sha256')
      .update(JSON.stringify({
        inputs: inputHashes.map(i => i.sha256).sort(),
        title,
        focus,
        extractor_version: EXTRACTOR_VERSION,
        protocol_version: BATCH_PROTOCOL_VERSION,
        cache_key: cacheKey,
      }))
      .digest('hex');
    console.log(`\n计划哈希: ${planHash}`);

    // 验证不创建任何文件
    process.exit(0);
  }

  // 5. 检查缓存
  let cachedResult = null;
  if (cacheDir) {
    console.log('\n检查缓存...');
    cachedResult = await checkCache({ cacheDir, cacheKey, batchParams });
    if (cachedResult.hit) {
      console.log(`  ✓ 缓存命中 (${cacheKey.slice(0, 16)}...)`);
      const cachedBatches = cachedResult.batches || [];
      const pendingCount = cachedResult.queue?.batches?.filter(b => b.status === 'PENDING').length || 0;
      console.log(`  批次: ${cachedBatches.length}, 待处理: ${pendingCount}`);

      // 真实缓存命中路径：从缓存复制到 runDir，跳过重抽取
      try {
        await restoreRunDirFromCache({
          cacheResult: cachedResult,
          cacheDir,
          cacheKey,
          runDir,
          inputHashes,
          title,
          focus,
          warnings,
          batchParams,
        });
        process.exit(0);
      } catch (err) {
        console.error(`  缓存恢复失败，回退到重新抽取: ${err.message}`);
        cachedResult = null;
      }
    } else {
      console.log('  缓存未命中');
    }
  }

  // 6. 创建目录（缓存未命中或缓存恢复失败时执行）
  console.log('\n创建目录...');
  await mkdir(join(runDir, 'input'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'batches'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'semantic'), { recursive: true });
  if (cacheDir) {
    await mkdir(cacheDir, { recursive: true });
  }

  // 写入缓存键元数据（用于后续验证）
  await writeJsonAtomic(join(runDir, 'input', 'cache-key.json'), {
    cache_key: cacheKey,
    extractor_version: EXTRACTOR_VERSION,
    protocol_version: BATCH_PROTOCOL_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    formula_version: FORMULA_VERSION,
    batch_params: batchParams,
    input_hashes: inputHashes.map(i => i.sha256).sort(),
  });

  // 7. 生成 manifest
  console.log('\n生成输入清单...');
  const manifest = {
    schema_version: '1.0.0',
    title,
    focus: focus || null,
    artifacts: inputHashes.map(i => ({
      file_path: i.path,
      format: i.format,
      sha256: i.sha256,
    })),
    warnings,
    created_at: new Date().toISOString(),
  };

  await writeJsonAtomic(join(runDir, 'input/input-manifest.json'), manifest);
  console.log('  ✓ input-manifest.json');

  // 8. 抽取证据并归一化为 Markdown
  console.log('\n抽取证据并归一化为 Markdown...');
  const allBlocks = [];
  const normalizedDocs = [];

  for (const input of inputHashes) {
    console.log(`  处理: ${basename(input.path)}`);
    try {
      const result = await extractArtifactEvidence({
        artifact: { path: input.path, format: input.format },
        runDir,
      });

      for (const block of result.blocks) {
        await writeJsonAtomic(join(runDir, 'evidence', 'blocks', `${block.block_id}.json`), block);
        allBlocks.push(block);
      }

      console.log(`    -> ${result.blocks.length} 个证据块`);

      // 归一化为 Markdown
      console.log(`    归一化为 Markdown...`);
      const normalizedDoc = await normalizeEvidenceToMarkdown({
        artifact: { path: input.path, format: input.format },
        artifactSha256: input.sha256,
        blocks: result.blocks,
        runDir,
        converterVersion: NORMALIZER_VERSION,
      });
      normalizedDocs.push(normalizedDoc);
      console.log(`    -> 归一化完成: ${normalizedDoc.chunks.length} 个 chunks`);
    } catch (err) {
      warnings.push(`抽取失败 ${basename(input.path)}: ${err.message}`);
      console.error(`    -> 错误: ${err.message}`);
    }
  }

  // 9. 验证证据索引
  console.log('\n验证证据索引...');
  const validation = await validateEvidenceIndex(allBlocks);
  if (!validation.valid) {
    console.error('证据验证失败:');
    validation.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
  console.log('  ✓ 证据验证通过');

  // 写入证据索引
  const evidenceIndex = {
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

  await writeJsonAtomic(join(runDir, 'evidence', 'evidence-index.json'), evidenceIndex);
  console.log('  ✓ evidence-index.json');

  // 10. 构建批次并填充 markdown_refs
  console.log('\n构建批次...');
  const batches = buildEvidenceBatches({ blocks: allBlocks });
  console.log(`  生成 ${batches.length} 个批次`);

  // 构建原始 content_sha256 到 normalized chunk 路径的映射
  // 使用 source_content_sha256 来映射，因为视觉块在归一化后内容哈希会变化
  const contentToChunkMap = new Map();
  for (const normalizedDoc of normalizedDocs) {
    for (const chunk of normalizedDoc.chunks) {
      const fullPath = `${normalizedDoc.artifact_id}/${chunk.path}`;
      // 使用 source_content_sha256（原始块的哈希）作为映射键
      const mappingKey = chunk.source_content_sha256 || chunk.content_sha256;
      contentToChunkMap.set(mappingKey, fullPath);
    }
  }

  // 为每个批次填充 markdown_refs
  for (const batch of batches) {
    const markdownRefs = new Set();
    for (const block of batch.blocks) {
      const chunkPath = contentToChunkMap.get(block.content_sha256);
      if (chunkPath) {
        markdownRefs.add(`normalized/${chunkPath}`);
      }
    }
    batch.markdown_refs = Array.from(markdownRefs);
  }

  // 写入批次文件和预算文件
  const contextBudgetsDir = join(runDir, 'evidence', 'context-budgets');
  await mkdir(contextBudgetsDir, { recursive: true });

  for (const batch of batches) {
    await writeJsonAtomic(join(runDir, 'evidence', 'batches', `${batch.batch_id}.json`), batch);
    await writeJsonAtomic(join(contextBudgetsDir, `${batch.batch_id}.json`), batch.context_budget);
  }
  console.log('  ✓ batches/*.json');
  console.log('  ✓ context-budgets/*.json');

  // 11. 生成队列
  console.log('\n生成语义处理队列...');
  const queue = {
    schema_version: '1.0.0',
    batches: batches.map(b => ({
      batch_id: b.batch_id,
      batch_sha256: b.batch_sha256,
      total_chars: b.total_chars,
      modality_mix: b.modality_mix,
      block_count: b.blocks.length,
      status: b.context_budget?.split_required ? 'SPLIT_REQUIRED' : 'PENDING',
      allowed_read_paths: [
        `evidence/batches/${b.batch_id}.json`,
        ...b.markdown_refs,
      ],
      markdown_refs: b.markdown_refs || [],
      split_required: b.context_budget?.split_required || false,
    })),
    total_batches: batches.length,
    total_blocks: allBlocks.length,
  };

  await writeJsonAtomic(join(runDir, 'stages', 'semantic', 'queue.json'), queue);
  console.log('  ✓ queue.json');

  // 12. 保存到缓存
  if (cacheDir) {
    const cachePath = join(cacheDir, cacheKey);
    await mkdir(join(cachePath, 'fragments'), { recursive: true });

    await writeJsonAtomic(join(cachePath, 'cache-meta.json'), {
      cache_key: cacheKey,
      extractor_version: EXTRACTOR_VERSION,
      protocol_version: BATCH_PROTOCOL_VERSION,
      batch_params: batchParams,
      input_hashes: inputHashes.map(i => i.sha256).sort(),
      created_at: new Date().toISOString(),
    });
    await writeJsonAtomic(join(cachePath, 'batches.json'), batches);
    await writeJsonAtomic(join(cachePath, 'queue.json'), queue);
    console.log(`  ✓ 缓存已保存 (${cacheKey.slice(0, 16)}...)`);
  }

  // 完成
  console.log('\n=== 完成 ===');
  console.log(`证据块: ${allBlocks.length}`);
  console.log(`批次: ${batches.length}`);
  console.log(`警告: ${warnings.length}`);

  if (warnings.length > 0) {
    console.log('\n警告列表:');
    warnings.forEach(w => console.log(`  - ${w}`));
  }
}

/**
 * 预估批次数
 */
function estimateBatches(inputs) {
  // 简单估算：每个文件平均 2-3 个块，每批 12 个块
  const estimatedBlocks = inputs.length * 2.5;
  return Math.ceil(estimatedBlocks / 12);
}

/**
 * 从缓存恢复 runDir 内容
 *
 * 缓存命中时，将缓存的 batches、fragments、queue 复制到 runDir，
 * 跳过抽取和分批。已验收的 fragment 标记为 CACHED。
 *
 * @param {object} params
 * @param {object} params.cacheResult - checkCache 的返回结果
 * @param {string} params.cacheDir - 缓存目录
 * @param {string} params.cacheKey - 缓存键
 * @param {string} params.runDir - 运行目录
 * @param {object[]} params.inputHashes - 输入文件哈希列表
 * @param {string} params.title - 流程标题
 * @param {string|null} params.focus - 流程焦点
 * @param {string[]} params.warnings - 警告列表（可变）
 * @param {object} params.batchParams - 批次参数
 */
async function restoreRunDirFromCache({
  cacheResult, cacheDir, cacheKey, runDir,
  inputHashes, title, focus, warnings, batchParams,
}) {
  const { batches: cachedBatches, queue: cachedQueue } = cacheResult;
  const cachePath = join(cacheDir, cacheKey);

  // 创建 runDir 目录结构
  await mkdir(join(runDir, 'input'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'batches'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });

  // 写入缓存键元数据
  await writeJsonAtomic(join(runDir, 'input', 'cache-key.json'), {
    cache_key: cacheKey,
    extractor_version: EXTRACTOR_VERSION,
    protocol_version: BATCH_PROTOCOL_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    formula_version: FORMULA_VERSION,
    batch_params: batchParams,
    input_hashes: inputHashes.map(i => i.sha256).sort(),
  });

  // 写入 manifest（使用缓存的 manifest 或重新生成）
  const cachedManifestPath = join(cachePath, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(cachedManifestPath, 'utf8'));
  } catch {
    // 缓存无 manifest，重新生成
    manifest = {
      schema_version: '1.0.0',
      title,
      focus: focus || null,
      artifacts: inputHashes.map(i => ({
        file_path: i.path,
        format: i.format,
        sha256: i.sha256,
      })),
      warnings,
      created_at: new Date().toISOString(),
    };
  }
  await writeJsonAtomic(join(runDir, 'input/input-manifest.json'), manifest);

  // 写入 evidence index（缓存命中时从缓存批次重建索引）
  const allBlockIds = new Set();
  for (const batch of cachedBatches) {
    for (const block of batch.blocks) {
      allBlockIds.add(block.block_id);
    }
  }

  const evidenceIndex = {
    schema_version: '1.0.0',
    total_blocks: allBlockIds.size,
    blocks: cachedBatches.flatMap(b => b.blocks).filter((b, i, arr) =>
      arr.findIndex(x => x.block_id === b.block_id) === i
    ).map(b => ({
      block_id: b.block_id,
      source_format: b.source_format,
      modality: b.modality,
      locator: b.locator,
      heading_path: b.heading_path,
      content_sha256: b.content_sha256,
    })),
    warnings,
  };
  await writeJsonAtomic(join(runDir, 'evidence', 'evidence-index.json'), evidenceIndex);

  // 复制批次文件到 runDir
  for (const batch of cachedBatches) {
    await writeJsonAtomic(join(runDir, 'evidence', 'batches', `${batch.batch_id}.json`), batch);
  }

  // 验证并复制 fragment，更新 queue 状态
  const updatedQueue = {
    schema_version: '1.0.0',
    batches: [],
    total_batches: cachedBatches.length,
    total_blocks: allBlockIds.size,
  };

  const cachedFragmentsDir = join(cachePath, 'fragments');
  let copiedFragments = 0;
  let revertedToPending = 0;

  for (const queueEntry of cachedQueue.batches) {
    const newEntry = { ...queueEntry };

    if (queueEntry.status === 'ACCEPTED') {
      // 验证 fragment 完整性
      const fragPath = join(cachedFragmentsDir, `${queueEntry.batch_id}.json`);
      const batch = cachedBatches.find(b => b.batch_id === queueEntry.batch_id);

      let fragmentValid = false;
      try {
        const fragContent = await readFile(fragPath, 'utf8');
        const frag = JSON.parse(fragContent);
        const actualSha = createHash('sha256').update(fragContent).digest('hex');

        // 验证 fragment_sha256、batch_id、batch_sha256
        if (
          actualSha === queueEntry.fragment_sha256 &&
          frag.batch_id === queueEntry.batch_id &&
          frag.batch_sha256 === queueEntry.batch_sha256 &&
          batch
        ) {
          // 验证 evidence_refs 只引用当前 batch 的 blocks
          const batchBlockIds = new Set(batch.blocks.map(b => b.block_id));
          let refsValid = true;
          for (const fact of (frag.facts || [])) {
            for (const ref of (fact.evidence_refs || [])) {
              if (!batchBlockIds.has(ref)) { refsValid = false; break; }
            }
            if (!refsValid) break;
          }
          if (refsValid) {
            // 复制 fragment 到 runDir
            await writeJsonAtomic(join(runDir, 'stages', 'semantic', 'fragments', `${queueEntry.batch_id}.json`), frag);
            newEntry.status = 'CACHED';
            copiedFragments++;
            fragmentValid = true;
          }
        }
      } catch {
        // fragment 文件缺失或读取失败
      }

      if (!fragmentValid) {
        // 污染：回退到 PENDING，删除不可信的 fragment_sha256
        newEntry.status = 'PENDING';
        delete newEntry.fragment_sha256;
        revertedToPending++;
        warnings.push(`缓存污染: batch ${queueEntry.batch_id} 回退到 PENDING`);
      }
    }
    // PENDING 状态保持不变

    updatedQueue.batches.push(newEntry);
  }

  await writeJsonAtomic(join(runDir, 'stages', 'semantic', 'queue.json'), updatedQueue);

  console.log(`  从缓存恢复: ${cachedBatches.length} 批次, ${copiedFragments} fragments CACHED`);
  if (revertedToPending > 0) {
    console.log(`  污染回退: ${revertedToPending} 批次回退到 PENDING`);
  }
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
