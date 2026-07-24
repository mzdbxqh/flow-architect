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
import { discoverProcessCandidates, buildFocusClarification, blockMatchesProcessKey } from './lib/process-focus-precheck.mjs';

/**
 * 抽取器版本 — 缓存键的一部分
 */
const EXTRACTOR_VERSION = '1.0.0';
const BATCH_PROTOCOL_VERSION = '2.0.0';
const NORMALIZER_VERSION = '1.0.0';
const FORMULA_VERSION = '1.0.0';
const ESTIMATE_METHOD_VERSION = '2.0.0';
const FRAGMENT_TASK_KINDS = ['PROCESS_CARD', 'ACTIVITY_CATALOG', 'CONTROL_FLOW'];

/**
 * 可安全内存抽取的格式：无需可选运行时依赖、无视觉解析，
 * dry-run 可复用真实抽取与 batching 逻辑给出精确计数且零写入。
 */
const SAFE_MEMORY_FORMATS = new Set(['md', 'bpmn', 'svg', 'mermaid']);

/**
 * 计算内容寻址缓存键
 *
 * 焦点（focus）纳入缓存键：不同焦点会过滤出不同的证据块与批次，
 * 因此必须区分缓存，避免「选了 CM-1.4 却命中无焦点的全量缓存」。
 */
function computeCacheKey(inputHashes, batchParams, focus) {
  const keyData = {
    extractor_version: EXTRACTOR_VERSION,
    protocol_version: BATCH_PROTOCOL_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    formula_version: FORMULA_VERSION,
    task_kinds: FRAGMENT_TASK_KINDS,
    input_hashes: inputHashes.sort(),
    batch_params: batchParams,
    focus: focus || null,
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

    // 重验每个批次的 hash 和 fragment 引用（逐 task_id 校验）
    const pollutedTasks = [];

    for (const batch of batches) {
      // Schema 验证：确保批次符合 evidence-batch schema
      const schemaResult = await validateEvidenceBatch(batch);
      if (!schemaResult.valid) {
        // batch 级别污染：影响该 batch 的所有 task
        const relatedEntries = (queue.batches || []).filter(q => q.batch_id === batch.batch_id);
        for (const entry of relatedEntries) {
          pollutedTasks.push({ task_id: entry.task_id, batch_id: batch.batch_id, reason: 'schema_violation' });
        }
        continue;
      }

      // 重新计算 batch hash 并比较（hash 验证已保证内容完整性）
      const contentHashes = batch.blocks.map(b => b.content_sha256).sort().join(',');
      const recomputedHash = createHash('sha256').update(contentHashes).digest('hex');
      if (recomputedHash !== batch.batch_sha256) {
        const relatedEntries = (queue.batches || []).filter(q => q.batch_id === batch.batch_id);
        for (const entry of relatedEntries) {
          pollutedTasks.push({ task_id: entry.task_id, batch_id: batch.batch_id, reason: 'hash_mismatch' });
        }
        continue;
      }

      // 逐 task_id 验证 fragment 引用（V2: 每个 task_kind 有独立 fragment 文件）
      const taskEntries = (queue.batches || []).filter(q => q.batch_id === batch.batch_id && q.status === 'ACCEPTED');
      for (const taskEntry of taskEntries) {
        const fragPath = join(cachePath, 'fragments', `${taskEntry.task_id}.json`);
        try {
          const frag = JSON.parse(await readFile(fragPath, 'utf8'));
          const fragBatchId = frag.batch_id;
          const fragBatchHash = frag.batch_sha256;
          if (fragBatchId !== batch.batch_id || fragBatchHash !== batch.batch_sha256) {
            pollutedTasks.push({ task_id: taskEntry.task_id, batch_id: batch.batch_id, reason: 'fragment_hash_mismatch' });
          }
        } catch {
          // Fragment 文件缺失，标记为需要重新处理
          pollutedTasks.push({ task_id: taskEntry.task_id, batch_id: batch.batch_id, reason: 'fragment_missing' });
        }
      }
    }

    // 如果有污染的任务，逐 task 回退到 PENDING（不影响同 batch 的其他 task）
    if (pollutedTasks.length > 0) {
      for (const polluted of pollutedTasks) {
        const queueEntry = queue.batches?.find(q => q.task_id === polluted.task_id);
        if (queueEntry) {
          queueEntry.status = 'PENDING';
          delete queueEntry.fragment_sha256;
        }
      }
      console.log(`  缓存污染检测: ${pollutedTasks.length} 个任务回退到 PENDING`);
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

  // 3. 流程焦点只读预检（不落盘：仅内存抽取，预检前后文件系统零变化）。
  //     单候选自动继续；多候选且无 focus 时，非 dry-run 转交一个证据驱动问题，
  //     并在创建 runDir 之前退出，避免无焦点直接生成跨层级混合 BPMN。
  const precheck = await discoverProcessCandidates({ inputs: inputHashes, focus });
  const precheckCandidates = precheck.candidates;
  let effectiveFocus = focus || null;

  if (precheckCandidates.length === 1 && !effectiveFocus) {
    effectiveFocus = precheckCandidates[0].process_key;
    console.log(`\n焦点预检: 单候选自动继续 (${effectiveFocus})`);
  } else if (precheckCandidates.length > 1) {
    const complete = precheckCandidates.filter(c => c.has_complete_l5).map(c => c.process_key);
    console.log(`\n焦点预检: ${precheckCandidates.length} 个候选流程 (${precheckCandidates.map(c => c.process_key).join(', ')})`);
    if (complete.length > 0) {
      console.log(`  完整 L5 活动证据: ${complete.join(', ')}`);
    }
  }

  if (!dryRun && precheckCandidates.length > 1 && !effectiveFocus) {
    const clarification = buildFocusClarification(precheckCandidates);
    console.log('\n=== 需要选择流程焦点（不创建运行目录）===');
    console.log(`问题: ${clarification.question}`);
    console.log(`依据: ${clarification.reason}`);
    console.log(`影响: ${clarification.impact}`);
    for (const opt of clarification.options) {
      console.log(`  - ${opt.value}: ${opt.label} → ${opt.effect}`);
    }
    // 机器可解析的单一 JSON 行，供严格入口/技能转交用户选择。
    console.log(`FOCUS_CLARIFICATION ${JSON.stringify(clarification)}`);
    process.exit(2);
  }

  // 3b. 估计执行预算（诚实预算：区分 EXACT 与 HEURISTIC_RANGE）。
  //     对可安全内存抽取的格式复用真实抽取与 batching，零写入给精确计数；
  //     对需可选运行时/视觉解析的格式给区间 + 依据 + 置信度。
  console.log('\n估计执行预算...');
  const budget = await estimateBudget({ inputs: validInputs, focus: effectiveFocus });
  console.log(`  预计证据块: ${formatBudgetValue(budget.blocks)} 个证据块 (${budget.method})`);
  console.log(`  预计批次: ${formatBudgetValue(budget.batches)} 个批次 (${budget.method})`);
  console.log(`  预计任务: ${formatBudgetValue(budget.tasks)} 个任务 (${budget.method})`);
  console.log(`  估计依据: ${budget.basis}`);
  console.log(`  置信度: ${budget.confidence}`);

  // 计算缓存键（含焦点：不同焦点过滤出不同批次，必须区分缓存）
  const batchParams = { maxChars: 12000, maxBlocks: 12 };
  const cacheKey = computeCacheKey(
    inputHashes.map(i => i.sha256),
    batchParams,
    effectiveFocus,
  );

  // 4. Dry-run 模式 — 只读，不创建 run/cache
  if (dryRun) {
    console.log('\n=== Dry-Run 模式 ===');
    console.log('\n执行计划:');
    console.log(`  输入文件: ${validInputs.length} 个`);
    console.log(`  流程标题: ${title}`);
    console.log(`  流程焦点: ${effectiveFocus || '(未指定)'}`);
    console.log(`  候选流程: ${precheckCandidates.length > 0 ? precheckCandidates.map(c => c.process_key).join(', ') : '(未识别到候选)'}`);
    console.log(`  运行目录: ${runDir}`);
    console.log(`  缓存目录: ${cacheDir}`);
    console.log(`  预计证据块: ${formatBudgetValue(budget.blocks)} 个证据块 (${budget.method})`);
    console.log(`  预计批次: ${formatBudgetValue(budget.batches)} 个批次 (${budget.method})`);
    console.log(`  预计任务: ${formatBudgetValue(budget.tasks)} 个任务 (${budget.method})`);
    console.log(`  估计依据: ${budget.basis}`);
    console.log(`  置信度: ${budget.confidence}`);
    console.log(`  估计方法版本: ${ESTIMATE_METHOD_VERSION}`);
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

    // 输出确定性计划哈希（纳入估计方法版本：算法变化即视为不同计划，避免误认同一计划）。
    const planHash = createHash('sha256')
      .update(JSON.stringify({
        inputs: inputHashes.map(i => i.sha256).sort(),
        title,
        focus: effectiveFocus,
        extractor_version: EXTRACTOR_VERSION,
        protocol_version: BATCH_PROTOCOL_VERSION,
        estimate_method_version: ESTIMATE_METHOD_VERSION,
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
          focus: effectiveFocus,
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
    focus: effectiveFocus || null,
    input_hashes: inputHashes.map(i => i.sha256).sort(),
  });

  // 7. 生成 manifest
  console.log('\n生成输入清单...');
  const manifest = {
    schema_version: '1.0.0',
    title,
    focus: effectiveFocus || null,
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

      // 焦点过滤：选定焦点后仅保留归属该焦点的证据块，
      // 确保后续批次/队列/生成只见焦点流程，避免跨层级混合。
      const blocks = effectiveFocus
        ? result.blocks.filter(block => blockMatchesProcessKey(block, effectiveFocus))
        : result.blocks;

      for (const block of blocks) {
        await writeJsonAtomic(join(runDir, 'evidence', 'blocks', `${block.block_id}.json`), block);
        allBlocks.push(block);
      }

      console.log(`    -> ${blocks.length} 个证据块${effectiveFocus ? `（焦点 ${effectiveFocus}，原始 ${result.blocks.length} 块）` : ''}`);

      // 归一化为 Markdown
      console.log(`    归一化为 Markdown...`);
      const normalizedDoc = await normalizeEvidenceToMarkdown({
        artifact: { path: input.path, format: input.format },
        artifactSha256: input.sha256,
        blocks,
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

  // 11. 生成队列（V2：每个 batch 生成三个 task_kind 任务）
  console.log('\n生成语义处理队列...');
  const taskSuffixMap = {
    'PROCESS_CARD': 'card',
    'ACTIVITY_CATALOG': 'activity',
    'CONTROL_FLOW': 'flow',
  };
  const queueEntries = [];
  for (const b of batches) {
    for (const kind of FRAGMENT_TASK_KINDS) {
      queueEntries.push({
        batch_id: b.batch_id,
        task_kind: kind,
        task_id: `${b.batch_id}-${taskSuffixMap[kind]}`,
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
      });
    }
  }

  const queue = {
    schema_version: '2.0.0',
    batches: queueEntries,
    total_batches: batches.length,
    total_tasks: queueEntries.length,
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
      fragment_protocol_version: '2.0.0',
      task_kinds: FRAGMENT_TASK_KINDS,
      batch_params: batchParams,
      focus: effectiveFocus || null,
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
  console.log(`任务: ${queueEntries.length}`);
  console.log(`警告: ${warnings.length}`);

  // 报告实际值与预算估计的偏差（诚实预算：prepare 完成后核对，避免预算长期失真）。
  const actual = { blocks: allBlocks.length, batches: batches.length, tasks: queueEntries.length };
  reportBudgetDeviation(budget, actual);

  if (warnings.length > 0) {
    console.log('\n警告列表:');
    warnings.forEach(w => console.log(`  - ${w}`));
  }
}

/**
 * 报告实际执行值与 dry-run/预算估计之间的偏差。
 * EXACT 估计应与实际完全一致；HEURISTIC_RANGE 则核对实际是否落在估计区间内。
 * @param {object} budget - estimateBudget 的返回。
 * @param {{blocks:number,batches:number,tasks:number}} actual - 实际计数。
 */
function reportBudgetDeviation(budget, actual) {
  console.log('\n预算核对:');
  const rows = [
    ['证据块', actual.blocks, budget.blocks],
    ['批次', actual.batches, budget.batches],
    ['任务', actual.tasks, budget.tasks],
  ];
  for (const [label, actualValue, estimated] of rows) {
    if (budget.method === 'EXACT') {
      const match = estimated === actualValue;
      console.log(`  ${label}: 实际 ${actualValue} / 预计 ${estimated} (EXACT) → ${match ? '一致' : '偏差 ' + (actualValue - estimated)}`);
    } else {
      const inRange = actualValue >= estimated.min && actualValue <= estimated.max;
      console.log(`  ${label}: 实际 ${actualValue} / 预计区间 ${estimated.min}~${estimated.max} (HEURISTIC_RANGE) → ${inRange ? '落在区间内' : '超出区间'}`);
    }
  }
}

/**
 * 估计执行预算（诚实预算：区分 EXACT 与 HEURISTIC_RANGE）。
 *
 * - 对可安全内存抽取的格式（md/bpmn/svg/mermaid）复用真实抽取与 batching，
 *   返回精确 block/batch/task 数，零写入；
 * - 对需可选运行时（pdf/docx/xlsx/pptx）或视觉解析（png/jpg/jpeg）的格式，
 *   返回区间、估计依据与置信度，绝不把启发式值标为精确「预计批次」。
 *
 * 焦点（focus）会过滤证据块，因此估计必须应用与真实 prepare 相同的焦点过滤，
 * 否则 dry-run 预算与实际执行会不一致。
 *
 * @param {object} params
 * @param {Array<{path:string, format:string}>} params.inputs - 有效输入文件列表
 * @param {string|null} params.focus - 有效焦点（可能由预检自动选定）
 * @returns {Promise<{
 *   method: 'EXACT'|'HEURISTIC_RANGE',
 *   blocks: number|{min:number,max:number},
 *   batches: number|{min:number,max:number},
 *   tasks: number|{min:number,max:number},
 *   basis: string,
 *   confidence: 'high'|'medium'|'low'
 * }>}
 */
async function estimateBudget({ inputs, focus }) {
  const safeInputs = inputs.filter(i => SAFE_MEMORY_FORMATS.has(i.format));
  const unsafeInputs = inputs.filter(i => !SAFE_MEMORY_FORMATS.has(i.format));

  // 仅当全部输入都可安全内存抽取时，才给出 EXACT 精确预算。
  if (unsafeInputs.length === 0 && safeInputs.length > 0) {
    try {
      const allBlocks = [];
      for (const input of safeInputs) {
        // runDir=null：抽取器对这些纯文本格式只读、不写盘。
        const result = await extractArtifactEvidence({
          artifact: { path: input.path, format: input.format },
          runDir: null,
        });
        const blocks = focus
          ? result.blocks.filter(block => blockMatchesProcessKey(block, focus))
          : result.blocks;
        for (const block of blocks) allBlocks.push(block);
      }
      // 复用真实 batching 逻辑（maxChars/maxBlocks 与 prepare 一致）。
      const batches = buildEvidenceBatches({ blocks: allBlocks, maxChars: 12000, maxBlocks: 12 });
      const tasks = batches.length * FRAGMENT_TASK_KINDS.length;
      return {
        method: 'EXACT',
        blocks: allBlocks.length,
        batches: batches.length,
        tasks,
        basis: `真实内存抽取 + 真实 batching（零写入）；格式=${[...new Set(safeInputs.map(i => i.format))].join('/')}`,
        confidence: 'high',
      };
    } catch {
      // 内存抽取失败：降级为启发式区间，不谎报精确。
    }
  }

  // 启发式区间：对需可选运行时或视觉解析的格式给出范围而非单值。
  const safeCount = safeInputs.length;
  const unsafeCount = unsafeInputs.length;
  const needsVisual = unsafeInputs.some(i => ['png', 'jpg', 'jpeg'].includes(i.format));

  // 经验区间：纯文本/结构化格式每文件约 3~30 块；视觉/运行时格式每文件约 1~8 块。
  const safeMin = safeCount * 3;
  const safeMax = safeCount * 30;
  const unsafeMin = unsafeCount * 1;
  const unsafeMax = unsafeCount * 8;
  const minBlocks = Math.max(1, safeMin + unsafeMin);
  const maxBlocks = Math.max(minBlocks, safeMax + unsafeMax);
  const minBatches = Math.max(1, Math.ceil(minBlocks / 12));
  const maxBatches = Math.max(minBatches, Math.ceil(maxBlocks / 12));

  const reasonParts = [];
  if (unsafeCount > 0) reasonParts.push(`${unsafeCount} 个文件需可选运行时解析`);
  if (needsVisual) reasonParts.push('含视觉资产需视觉解析');
  if (safeCount > 0 && unsafeCount > 0) reasonParts.push(`${safeCount} 个文件可内存抽取但与不可精确文件混合`);

  return {
    method: 'HEURISTIC_RANGE',
    blocks: { min: minBlocks, max: maxBlocks },
    batches: { min: minBatches, max: maxBatches },
    tasks: { min: minBatches * FRAGMENT_TASK_KINDS.length, max: maxBatches * FRAGMENT_TASK_KINDS.length },
    basis: `启发式区间：${reasonParts.join('；') || '无法在 dry-run 阶段精确抽取'}`,
    confidence: needsVisual ? 'low' : 'medium',
  };
}

/**
 * 将预算数值格式化为可读字符串：EXACT 为单值，HEURISTIC_RANGE 为「min~max」区间。
 */
function formatBudgetValue(value) {
  if (typeof value === 'number') return String(value);
  return `${value.min}~${value.max}`;
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
    focus: focus || null,
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
    schema_version: '2.0.0',
    batches: [],
    total_batches: cachedBatches.length,
    total_tasks: cachedQueue.batches?.length || cachedBatches.length * 3,
    total_blocks: allBlockIds.size,
  };

  const cachedFragmentsDir = join(cachePath, 'fragments');
  let copiedFragments = 0;
  let revertedToPending = 0;

  for (const queueEntry of cachedQueue.batches) {
    const newEntry = { ...queueEntry };

    if (queueEntry.status === 'ACCEPTED') {
      // 验证 fragment 完整性（V2: 使用 task_id 而非 batch_id 作为文件名）
      const fragPath = join(cachedFragmentsDir, `${queueEntry.task_id}.json`);
      const batch = cachedBatches.find(b => b.batch_id === queueEntry.batch_id);

      let fragmentValid = false;
      try {
        const fragContent = await readFile(fragPath, 'utf8');
        const frag = JSON.parse(fragContent);
        const actualSha = createHash('sha256').update(fragContent).digest('hex');

        // 验证 fragment_sha256、batch_id、batch_sha256、task_kind
        if (
          actualSha === queueEntry.fragment_sha256 &&
          frag.batch_id === queueEntry.batch_id &&
          frag.batch_sha256 === queueEntry.batch_sha256 &&
          frag.task_kind === queueEntry.task_kind &&
          batch
        ) {
          // 验证 evidence_refs 只引用当前 batch 的 blocks
          const batchBlockIds = new Set(batch.blocks.map(b => b.block_id));
          const facts = frag.payload?.facts || [];
          const uncertainties = frag.payload?.uncertainties || [];
          let refsValid = true;
          for (const fact of facts) {
            for (const ref of (fact.evidence_refs || [])) {
              if (!batchBlockIds.has(ref)) { refsValid = false; break; }
            }
            if (!refsValid) break;
          }
          if (refsValid) {
            for (const unc of uncertainties) {
              for (const ref of (unc.evidence_refs || [])) {
                if (!batchBlockIds.has(ref)) { refsValid = false; break; }
              }
              if (!refsValid) break;
            }
          }
          if (refsValid) {
            // 复制 fragment 到 runDir（使用 task_id 文件名）
            await writeJsonAtomic(join(runDir, 'stages', 'semantic', 'fragments', `${queueEntry.task_id}.json`), frag);
            newEntry.status = 'CACHED';
            copiedFragments++;
            fragmentValid = true;
          }
        }
      } catch {
        // fragment 文件缺失或读取失败
      }

      if (!fragmentValid) {
        // 污染：逐 task 回退到 PENDING，不影响同 batch 的其他 task
        newEntry.status = 'PENDING';
        delete newEntry.fragment_sha256;
        revertedToPending++;
        warnings.push(`缓存污染: task ${queueEntry.task_id} 回退到 PENDING`);
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
