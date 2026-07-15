/**
 * 片段完整性验证函数
 *
 * 共享验证逻辑，供 merge-process-fragments 和 finalizeProcessDraft 共用。
 * 避免两处逐渐漂移的验证逻辑。
 *
 * 验证项:
 * 1. queue 状态必须为 ACCEPTED 或 CACHED
 * 2. fragment 文件必须存在
 * 3. fragment 内容 SHA-256 必须与 queue 中记录的 fragment_sha256 匹配
 * 4. fragment 的 batch_id 必须与 queue 记录匹配
 * 5. fragment 的 batch_sha256 必须与 queue 记录匹配
 * 6. fragment 的 evidence_refs 只能引用对应 batch 的 blocks
 * 7. ACCEPTED/CACHED 项必须有 fragment_sha256
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 验证单个 fragment 的完整性
 *
 * @param {object} params
 * @param {string} params.runDir - 运行目录
 * @param {string} [params.batchId] - 指定批次 ID 验证；省略则验证所有批次
 * @param {object} [params.queue] - 预加载的 queue（可选，避免重复读取）
 * @returns {Promise<{ valid: boolean, errors: string[], checked: number }>}
 */
export async function verifyFragmentIntegrity({ runDir, batchId = null, queue = null }) {
  const errors = [];
  let checked = 0;

  // 读取 queue
  if (!queue) {
    const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
    try {
      queue = JSON.parse(await readFile(queuePath, 'utf8'));
    } catch {
      return { valid: false, errors: ['queue.json 缺失或无法读取'], checked: 0 };
    }
  }

  // 确定要验证的批次
  const batchesToCheck = batchId
    ? queue.batches.filter(b => b.batch_id === batchId)
    : queue.batches;

  if (batchId && batchesToCheck.length === 0) {
    return { valid: false, errors: [`批次 ${batchId} 不存在于 queue 中`], checked: 0 };
  }

  const fragmentsDir = join(runDir, 'stages', 'semantic', 'fragments');
  const batchesDir = join(runDir, 'evidence', 'batches');

  for (const batchEntry of batchesToCheck) {
    checked++;

    // 1. 检查 queue 状态
    if (batchEntry.status !== 'ACCEPTED' && batchEntry.status !== 'CACHED') {
      errors.push(`批次 ${batchEntry.batch_id}: 状态 ${batchEntry.status} 不是 ACCEPTED/CACHED`);
      continue;
    }

    // 2. 检查 fragment_sha256 存在
    if (!batchEntry.fragment_sha256) {
      errors.push(`批次 ${batchEntry.batch_id}: 缺少 fragment_sha256`);
      continue;
    }

    // 3. 读取 fragment 文件
    const fragPath = join(fragmentsDir, `${batchEntry.batch_id}.json`);
    let fragContent;
    try {
      fragContent = await readFile(fragPath, 'utf8');
    } catch {
      errors.push(`批次 ${batchEntry.batch_id}: fragment 文件缺失`);
      continue;
    }

    // 4. 验证 fragment 内容 SHA-256
    const actualSha = createHash('sha256').update(fragContent).digest('hex');
    if (actualSha !== batchEntry.fragment_sha256) {
      errors.push(
        `批次 ${batchEntry.batch_id}: fragment SHA-256 不匹配 ` +
        `(实际=${actualSha.slice(0, 16)}..., 记录=${batchEntry.fragment_sha256.slice(0, 16)}...)`
      );
      continue;
    }

    // 解析 fragment
    let fragment;
    try {
      fragment = JSON.parse(fragContent);
    } catch {
      errors.push(`批次 ${batchEntry.batch_id}: fragment JSON 解析失败`);
      continue;
    }

    // 5. 验证 batch_id 匹配
    if (fragment.batch_id !== batchEntry.batch_id) {
      errors.push(
        `批次 ${batchEntry.batch_id}: fragment batch_id 不匹配 (fragment=${fragment.batch_id})`
      );
    }

    // 6. 验证 batch_sha256 匹配
    if (fragment.batch_sha256 !== batchEntry.batch_sha256) {
      errors.push(
        `批次 ${batchEntry.batch_id}: fragment batch_sha256 不匹配`
      );
    }

    // 7. 读取 batch 文件，验证 evidence_refs
    const batchPath = join(batchesDir, `${batchEntry.batch_id}.json`);
    let batchData;
    try {
      batchData = JSON.parse(await readFile(batchPath, 'utf8'));
    } catch {
      errors.push(`批次 ${batchEntry.batch_id}: batch 文件缺失，无法验证 evidence_refs`);
      continue;
    }

    const batchBlockIds = new Set((batchData.blocks || []).map(b => b.block_id));

    for (const fact of (fragment.facts || [])) {
      for (const ref of (fact.evidence_refs || [])) {
        if (!batchBlockIds.has(ref)) {
          errors.push(
            `批次 ${batchEntry.batch_id}: fact ${fact.fact_id} 的 evidence_ref ${ref} 不在 batch blocks 中`
          );
        }
      }
    }

    for (const uncertainty of (fragment.uncertainties || [])) {
      for (const ref of (uncertainty.evidence_refs || [])) {
        if (!batchBlockIds.has(ref)) {
          errors.push(
            `批次 ${batchEntry.batch_id}: uncertainty 的 evidence_ref ${ref} 不在 batch blocks 中`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    checked,
  };
}
