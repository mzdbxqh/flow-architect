#!/usr/bin/env node

/**
 * 构建评审上下文
 *
 * 从 normalized 工件生成领域材料包和 Stage Task。
 *
 * 用法:
 *   node scripts/build-review-context.mjs \
 *     --run-dir <dir> \
 *     --route <route> \
 *     [--dry-run]
 *
 * route: review-l4, review-l5, review-l6, review-sop, review-bpmn 等
 */

import { parseArgs } from 'node:util';
import { readFile, mkdir, readdir, stat, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildRulePacket } from './lib/rule-packet-builder.mjs';
import { buildMaterialPackets, buildRecursiveAggregationTasks, ROUTE_ALLOWED_DOMAINS } from './lib/material-packet-builder.mjs';
import { estimateTokens, buildContextBudget } from './lib/context-budget.mjs';
import { writeJsonAtomic } from './lib/atomic-json.mjs';

// 允许的 route
const VALID_ROUTES = [
  'review-l4',
  'review-l5',
  'review-l6',
  'review-sop',
  'review-bpmn',
  'review-visual',
  'review-consistency',
  'review-hierarchy',
];

// route 到阶段 ID 的映射
const ROUTE_TO_STAGE = {
  'review-l4': 'review-l4',
  'review-l5': 'review-l5',
  'review-l6': 'review-l6',
  'review-sop': 'review-sop',
  'review-bpmn': 'review-bpmn',
  'review-visual': 'review-visual',
  'review-consistency': 'review-consistency',
  'review-hierarchy': 'review-hierarchy',
};

// route 到规则 ID 前缀的映射
const ROUTE_TO_RULE_PREFIX = {
  'review-l4': 'FA-L4-',
  'review-l5': 'FA-L5-',
  'review-l6': 'FA-L6-',
  'review-sop': 'FA-SOP-',
  'review-bpmn': 'FA-BPMN-',
  'review-visual': 'FA-VISUAL-',
  'review-consistency': 'FA-CONSISTENCY-',
  'review-hierarchy': 'FA-HIERARCHY-',
};

// 预算限制
const BUDGET_LIMITS = {
  material_packet: 48000, // 领域材料包基准
  session_increment: 64000, // 产品单会话增量基准
  model_context: 100000, // 模型完整上下文硬上限
};

const args = parseArgs({
  options: {
    'run-dir': { type: 'string', short: 'r' },
    route: { type: 'string' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (args.values.help) {
  console.log(`
用法: node scripts/build-review-context.mjs --run-dir <dir> --route <route> [选项]

从 normalized 工件生成领域材料包和 Stage Task。

选项:
  -r, --run-dir     运行目录（必须包含 normalized/ 子目录）
  --route           评审路由: ${VALID_ROUTES.join(', ')}
  -d, --dry-run     只报告计划，不创建文件
  -h, --help        显示帮助

输出:
  <runDir>/context/manifest.json           上下文清单
  <runDir>/context/rule-packet.json        最小规则包
  <runDir>/context/material-packets/       材料包
  <runDir>/context/stage-tasks/            Stage Task
  <runDir>/context/budget-report.json      预算报告
`);
  process.exit(0);
}

const runDir = args.values['run-dir'];
const route = args.values.route;
const dryRun = args.values['dry-run'];

// 验证参数
if (!runDir) {
  console.error('错误: 必须指定 --run-dir');
  process.exit(1);
}

if (!route) {
  console.error('错误: 必须指定 --route');
  process.exit(1);
}

if (!VALID_ROUTES.includes(route)) {
  console.error(`错误: 无效的 route "${route}"，允许: ${VALID_ROUTES.join(', ')}`);
  process.exit(1);
}

// 路径安全检查：禁止路径逃逸
const resolvedRunDir = resolve(runDir);
if (resolvedRunDir.includes('..')) {
  console.error('错误: --run-dir 不能包含路径逃逸 (..)');
  process.exit(1);
}

async function main() {
  console.log(`=== 构建评审上下文 ===`);
  console.log(`运行目录: ${runDir}`);
  console.log(`路由: ${route}`);

  // 检查 normalized 目录
  const normalizedDir = join(runDir, 'normalized');
  try {
    await stat(normalizedDir);
  } catch {
    console.error(`错误: normalized 目录不存在: ${normalizedDir}`);
    console.error('请先运行 prepare-process-draft.mjs 生成 normalized 工件');
    process.exit(1);
  }

  // 检查 context 目录是否是逃逸 symlink
  const contextDir = join(runDir, 'context');
  try {
    const contextStat = await lstat(contextDir);
    if (contextStat.isSymbolicLink()) {
      // 检查 symlink 指向是否在 runDir 内
      const realContext = await realpath(contextDir);
      const realRunDir = await realpath(runDir);
      if (!realContext.startsWith(realRunDir)) {
        console.error(`错误: context 目录是逃逸 symlink，指向 ${realContext}`);
        process.exit(1);
      }
    }
  } catch (err) {
    // ENOENT 表示目录不存在，可以继续
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  // 读取所有 normalized artifacts
  console.log('\n读取 normalized 工件...');
  const artifacts = await readdir(normalizedDir);
  if (artifacts.length === 0) {
    console.error('错误: normalized 目录为空');
    process.exit(1);
  }

  const allChunks = [];
  for (const artifactId of artifacts) {
    const indexPath = join(normalizedDir, artifactId, 'index.json');
    try {
      const indexContent = JSON.parse(await readFile(indexPath, 'utf8'));
      for (const chunk of indexContent.chunks) {
        // 读取 chunk 内容
        const chunkPath = join(normalizedDir, artifactId, chunk.path);
        const chunkContent = await readFile(chunkPath, 'utf8');

        // 提取 YAML frontmatter 和正文
        const { metadata, content } = parseMarkdownChunk(chunkContent);

        // 从 metadata 或 chunk 提取 domain_tags 和 heading_path
        const domainTags = metadata.domain_tags || chunk.domain_tags || [];
        const headingPath = metadata.heading_path || chunk.heading_path || [];

        allChunks.push({
          ...chunk,
          artifact_id: artifactId,
          artifact_sha256: indexContent.artifact_sha256,
          content,
          metadata,
          domain_tags: Array.isArray(domainTags) ? domainTags : [],
          heading_path: Array.isArray(headingPath) ? headingPath : [],
        });
      }
    } catch (err) {
      console.warn(`警告: 无法读取 ${artifactId}: ${err.message}`);
    }
  }

  console.log(`  加载了 ${allChunks.length} 个 chunks`);

  // 构建规则包
  console.log('\n构建规则包...');
  // 从脚本位置找到 references 目录
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const referencesDir = join(scriptDir, '..', 'references');
  const rulePrefix = ROUTE_TO_RULE_PREFIX[route] || '';

  let rulePacket = null;
  if (rulePrefix) {
    try {
      const catalog = JSON.parse(await readFile(join(referencesDir, 'rule-catalog.json'), 'utf8'));

      // 动态获取匹配前缀的规则 ID
      const ruleIds = catalog.rules
        .filter(rule => rule.rule_id.startsWith(rulePrefix))
        .map(rule => rule.rule_id);

      if (ruleIds.length > 0) {
        const ruleDocuments = await loadRuleDocuments(referencesDir, ruleIds);
        rulePacket = buildRulePacket({ catalog, ruleDocuments, ruleIds });
        console.log(`  规则包: ${rulePacket.ruleIds.length} 个规则, ${rulePacket.budget.estimated_tokens} tokens`);
      }
    } catch (err) {
      console.error(`错误: 无法构建规则包: ${err.message}`);
      process.exit(1);
    }
  }

  // 构建材料包
  console.log('\n构建材料包...');
  const stageId = ROUTE_TO_STAGE[route];
  const materialPackets = buildMaterialPackets({
    stageId,
    chunks: allChunks,
    maxTokens: BUDGET_LIMITS.material_packet,
  });
  console.log(`  生成 ${materialPackets.length} 个材料包`);

  // 验证材料包预算
  for (const packet of materialPackets) {
    if (packet.status === 'BLOCKED') {
      console.warn(`警告: 材料包 ${packet.packet_id} 超过阻断线，状态为 BLOCKED`);
    }
  }

  // 找出未分类的 chunks（完全没有领域标签的）
  // 注意：有领域标签但不匹配当前 route 的 chunks 不是"未分类"，而是属于其他领域
  const uncoveredChunks = allChunks.filter(chunk => {
    const tags = chunk.domain_tags || [];
    return tags.length === 0;
  });
  console.log(`  未分类 chunks: ${uncoveredChunks.length} 个`);

  // 为未分类内容构建 refinement tasks
  const refinementTasks = [];
  if (uncoveredChunks.length > 0) {
    // 将未分类 chunks 按 batch 分组（每批不超过 14400 字符）
    let currentBatch = [];
    let currentChars = 0;
    const MAX_BATCH_CHARS = 14400;

    for (const chunk of uncoveredChunks) {
      const chunkChars = (chunk.content || '').length;

      if (currentChars + chunkChars > MAX_BATCH_CHARS && currentBatch.length > 0) {
        refinementTasks.push(createRefinementTask(currentBatch, runDir));
        currentBatch = [];
        currentChars = 0;
      }

      currentBatch.push(chunk);
      currentChars += chunkChars;
    }

    if (currentBatch.length > 0) {
      refinementTasks.push(createRefinementTask(currentBatch, runDir));
    }
  }
  console.log(`  生成 ${refinementTasks.length} 个 refinement tasks`);

  // 构建 Stage Tasks
  console.log('\n构建 Stage Tasks...');
  const stageTasks = materialPackets
    .filter(packet => packet.status === 'RUNNABLE')
    .map(packet => createStageTask(packet, rulePacket, runDir));
  console.log(`  生成 ${stageTasks.length} 个 Stage Tasks`);

  // Dry-run 模式
  if (dryRun) {
    console.log('\n=== Dry-Run 模式 ===');
    console.log(`\n执行计划:`);
    console.log(`  规则包: ${rulePacket ? rulePacket.ruleIds.length + ' 个规则' : '无'}`);
    console.log(`  材料包: ${materialPackets.length} 个`);
    console.log(`  Stage Tasks: ${stageTasks.length} 个`);

    const totalTokens = stageTasks.reduce((sum, task) => sum + task.context_budget.total.estimated_tokens, 0);
    console.log(`  总 token 估算: ${totalTokens}`);

    // 预算报告
    console.log(`\n预算报告:`);
    for (const task of stageTasks) {
      console.log(`  ${task.task_id}: ${task.context_budget.total.estimated_tokens} tokens [${task.context_budget.status}]`);
    }

    process.exit(0);
  }

  // 创建输出目录
  await mkdir(join(contextDir, 'material-packets'), { recursive: true });
  await mkdir(join(contextDir, 'stage-tasks'), { recursive: true });
  await mkdir(join(contextDir, 'refinement-tasks'), { recursive: true });

  // 写入清单
  console.log('\n写入上下文清单...');
  const manifest = {
    schema_version: '1.0.0',
    route,
    stage_id: stageId,
    rule_packet: rulePacket ? {
      rule_ids: rulePacket.ruleIds,
      budget: rulePacket.budget,
    } : null,
    material_packet_count: materialPackets.length,
    stage_task_count: stageTasks.length,
  };
  await writeJsonAtomic(join(contextDir, 'manifest.json'), manifest);

  // 写入规则包
  if (rulePacket) {
    console.log('写入规则包...');
    await writeJsonAtomic(join(contextDir, 'rule-packet.json'), {
      rule_ids: rulePacket.ruleIds,
      markdown: rulePacket.markdown,
      budget: rulePacket.budget,
    });
  }

  // 写入材料包
  console.log('写入材料包...');
  for (const packet of materialPackets) {
    await writeJsonAtomic(join(contextDir, 'material-packets', `${packet.packet_id}.json`), packet);
  }

  // 写入 Stage Tasks
  console.log('写入 Stage Tasks...');
  for (const task of stageTasks) {
    await writeJsonAtomic(join(contextDir, 'stage-tasks', `${task.task_id}.json`), task);
  }

  // 写入 Refinement Tasks
  console.log('写入 Refinement Tasks...');
  for (const task of refinementTasks) {
    await writeJsonAtomic(join(contextDir, 'refinement-tasks', `${task.task_id}.json`), task);
  }

  // 写入预算报告
  console.log('写入预算报告...');
  const budgetReport = {
    route,
    stage_id: stageId,
    rule_packet_tokens: rulePacket?.budget.estimated_tokens || 0,
    material_packet_tokens: materialPackets.reduce((sum, p) => sum + p.context_budget.total.estimated_tokens, 0),
    stage_task_tokens: stageTasks.reduce((sum, t) => sum + t.context_budget.total.estimated_tokens, 0),
    limits: BUDGET_LIMITS,
  };
  await writeJsonAtomic(join(contextDir, 'budget-report.json'), budgetReport);

  // 完成
  console.log('\n=== 完成 ===');
  console.log(`规则包: ${rulePacket ? rulePacket.ruleIds.length + ' 个规则' : '无'}`);
  console.log(`材料包: ${materialPackets.length} 个`);
  console.log(`Stage Tasks: ${stageTasks.length} 个`);
}

/**
 * 解析 Markdown chunk 的 YAML frontmatter 和正文
 */
function parseMarkdownChunk(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { metadata: {}, content };
  }

  const frontmatterStr = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // 简单解析 YAML（假设都是 key: value 格式）
  const metadata = {};
  for (const line of frontmatterStr.split('\n')) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const key = match[1];
      let value = match[2].replace(/^['"]|['"]$/g, '');

      // 尝试解析 JSON 数组（如 domain_tags: '["L4"]'）
      if (value.startsWith('[') || value.startsWith('{')) {
        try {
          value = JSON.parse(value);
        } catch {
          // 保持原始字符串
        }
      }

      metadata[key] = value;
    }
  }

  return { metadata, content: body.trim() };
}

/**
 * 加载规则文档
 */
async function loadRuleDocuments(referencesDir, ruleIds) {
  const catalogPath = join(referencesDir, 'rule-catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  const ruleDocuments = {};
  const neededFiles = new Set();

  for (const ruleId of ruleIds) {
    const rule = catalog.rules.find(r => r.rule_id === ruleId);
    if (rule?.public_reference) {
      const [filename] = rule.public_reference.split('#');
      if (filename) {
        neededFiles.add(filename);
      }
    }
  }

  for (const filename of neededFiles) {
    // filename 格式如 "references/rules/l4-review.md"
    // rule-packet-builder 使用 parseReference 提取文件名（去掉路径），如 "l4-review.md"
    // 所以需要用同样的方式作为 key
    const parts = filename.split('/');
    const basename = parts[parts.length - 1]; // "l4-review.md"

    // 构建完整路径
    const relativePath = filename.replace(/^references\//, '');
    const filePath = join(referencesDir, relativePath);

    try {
      ruleDocuments[basename] = await readFile(filePath, 'utf8');
    } catch (err) {
      console.warn(`警告: 无法读取规则文档 ${relativePath}: ${err.message}`);
    }
  }

  return ruleDocuments;
}

/**
 * 创建 Stage Task
 */
function createStageTask(materialPacket, rulePacket, runDir) {
  const taskId = `ST-${materialPacket.packet_id.slice(3)}`;

  // 构建 allowed_read_paths（相对路径，逐文件列举）
  const allowedReadPaths = [
    `context/material-packets/${materialPacket.packet_id}.json`,
  ];

  if (rulePacket) {
    allowedReadPaths.push('context/rule-packet.json');
  }

  // 计算总预算（材料包 + 规则包 + 固定上下文）
  const fixedTexts = [
    JSON.stringify(materialPacket.lineage),
    rulePacket?.markdown || '',
  ];

  const totalBudget = buildContextBudget({
    contentTexts: [JSON.stringify(materialPacket)],
    fixedTexts,
    metadataTexts: [JSON.stringify(materialPacket.markdown_refs)],
    limit: BUDGET_LIMITS.session_increment,
    sourceIds: materialPacket.chunk_ids,
  });

  return {
    task_id: taskId,
    packet_id: materialPacket.packet_id,
    stage_id: materialPacket.stage_id,
    rule_packet_ref: rulePacket ? 'context/rule-packet.json' : null,
    material_packet_ref: `context/material-packets/${materialPacket.packet_id}.json`,
    allowed_read_paths: allowedReadPaths,
    output_dir: `context/output/${materialPacket.packet_id}`,
    runnable: materialPacket.status === 'RUNNABLE',
    fresh_session: materialPacket.status === 'RUNNABLE',
    context_budget: totalBudget,
  };
}

/**
 * 创建 Refinement Task（用于未分类内容）
 */
function createRefinementTask(chunks, runDir) {
  const chunkIds = chunks.map(c => c.chunk_id);
  const taskId = `RF-${createHash('sha256').update(chunkIds.join(',')).digest('hex').slice(0, 12)}`;

  const contentText = chunks.map(c => c.content || '').join('\n');
  const budget = buildContextBudget({
    contentTexts: [contentText],
    fixedTexts: [],
    metadataTexts: [],
    limit: 14400,
    sourceIds: chunkIds,
  });

  return {
    task_id: taskId,
    chunk_ids: chunkIds,
    stage_id: 'refinement',
    fresh_session: true,
    context_budget: budget,
    allowed_read_paths: chunks.map(c =>
      `normalized/${c.artifact_id}/${c.path}`
    ),
  };
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
