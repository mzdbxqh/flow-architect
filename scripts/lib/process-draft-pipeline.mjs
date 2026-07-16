/**
 * 流程草稿流水线
 *
 * 确定性 finalize 流程草稿，生成最终产物。
 * 直接复用第一阶段 buildMeetingPackageHtml。
 *
 * 安全发布策略：
 * 1. 完整临时目录生成全部产物
 * 2. 用第一阶段 extractMeetingPackageHtml 复读 HTML，确认 payload 与独立文件一致
 * 3. 用第一阶段 validateQuestions 复验 question↔element 双向引用
 * 4. 全部验证成功后，用同文件系统 rename 发布：
 *    .temp-finalize → final.next → final.bak（旧） → final（新）
 *    失败时从 final.bak 回滚恢复。
 */

import { readFile, writeFile, mkdir, rm, stat, readdir, rename, copyFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { generateL5Bpmn } from './l5-bpmn-generator.mjs';
import { renderClarificationAgenda } from './render-clarification-agenda.mjs';
import { validateProcessDraft } from './process-draft-contract.mjs';
import { buildMeetingPackageHtml, extractMeetingPackageHtml } from './meeting-package-html.mjs';
import { validateQuestions } from './meeting-package-contract.mjs';
import { writeJsonAtomic } from './atomic-json.mjs';
import { verifyFragmentIntegrity } from './fragment-integrity.mjs';

/**
 * Finalize 流程草稿
 *
 * @param {object} params
 * @param {string} params.runDir - 运行目录
 * @param {string} [params.revision='r01'] - 修订号
 * @param {function} [params.onPublishFault] - 测试用发布阶段故障注入回调 (step: string) => void
 * @returns {Promise<{ success: boolean, files: string[], html: string }>}
 */
export async function finalizeProcessDraft({ runDir, revision = 'r01', onPublishFault } = {}) {
  // 1. 验证输入存在
  const stagesDir = join(runDir, 'stages');
  const mergeDir = join(stagesDir, 'merge');
  const semanticDir = join(stagesDir, 'semantic');
  const finalDir = join(runDir, 'final');

  // 检查 merge 目录
  try {
    await stat(mergeDir);
  } catch {
    throw new Error('stages/merge 目录不存在，请先运行 merge-process-fragments');
  }

  // 2a. Fail closed: 验证 queue 状态
  const queuePath = join(semanticDir, 'queue.json');
  let queue;
  try {
    queue = JSON.parse(await readFile(queuePath, 'utf8'));
  } catch {
    throw new Error('stages/semantic/queue.json 不存在或无法读取');
  }

  const pendingBatches = queue.batches.filter(b => b.status !== 'ACCEPTED' && b.status !== 'CACHED');
  if (pendingBatches.length > 0) {
    throw new Error(
      `队列中仍有未验收的批次: ${pendingBatches.map(b => b.batch_id).join(', ')}`
    );
  }

  // 2b. 调用共享完整性验证（含 fragment SHA-256、evidence_refs 等）
  const integrityResult = await verifyFragmentIntegrity({ runDir, queue });
  if (!integrityResult.valid) {
    throw new Error(`Fragment 完整性验证失败:\n${integrityResult.errors.join('\n')}`);
  }

  // 2. 读取流程草稿
  const draftPath = join(mergeDir, 'process-draft.json');
  let draft;
  try {
    draft = JSON.parse(await readFile(draftPath, 'utf8'));
  } catch (err) {
    throw new Error(`无法读取流程草稿: ${err.message}`);
  }

  // 3. 验证草稿
  const validation = await validateProcessDraft(draft);
  if (!validation.valid) {
    throw new Error(`流程草稿验证失败: ${validation.errors.join(', ')}`);
  }

  // 4. 创建临时目录
  const tempDir = join(runDir, '.temp-finalize');
  await mkdir(tempDir, { recursive: true });

  try {
    // 5. 生成 BPMN
    const bpmn = generateL5Bpmn(draft);
    await writeFile(join(tempDir, 'process.bpmn'), bpmn, 'utf8');

    // 6. 映射问题为第一阶段格式
    const questions = draft.questions.map(q => ({
      question_id: q.question_id,
      text: q.text,
      target_paths: q.target_paths,
      status: q.status,
      answer: q.answer || '',
    }));
    await writeJsonAtomic(join(tempDir, 'questions.json'), questions);

    // 7. 生成澄清议题
    const agenda = renderClarificationAgenda(draft);
    await writeFile(join(tempDir, 'clarification-agenda.md'), agenda, 'utf8');

    // 8. 保存最终流程草稿
    await writeJsonAtomic(join(tempDir, 'process-draft.json'), draft);

    // 9. 生成 HTML — 直接复用第一阶段 buildMeetingPackageHtml
    const metadata = {
      schema_version: '2.0.0',
      package_id: `pkg-${draft.process_card.process_id}`,
      process_id: `Process_${draft.process_card.process_id}`,
      title: draft.process_card.name,
      revision,
      based_on_revision: null,
      runtime_version: '2.0.0',
    };
    const html = buildMeetingPackageHtml({
      draft,
      bpmnXml: bpmn,
      metadata,
    });
    const safeTitle = draft.process_card.name.replace(/[^a-zA-Z0-9一-龥_-]/g, '_');
    const htmlFilename = `${safeTitle}-${revision}.html`;
    await writeFile(join(tempDir, htmlFilename), html, 'utf8');

    // 10. 用第一阶段 extractMeetingPackageHtml 复读 HTML payload
    const payload = extractMeetingPackageHtml(html);

    // 10a. payload.bpmn_xml 与 process.bpmn 文件一致
    if (payload.bpmn_xml !== bpmn) {
      throw new Error('HTML payload 的 bpmn_xml 与 process.bpmn 不一致');
    }

    // 10b. payload.questions 与 questions.json 文件一致
    if (JSON.stringify(payload.questions) !== JSON.stringify(questions)) {
      throw new Error('HTML payload 的 questions 与 questions.json 不一致');
    }

    // 10c. payload.metadata 与草稿一致
    if (payload.metadata.process_id !== metadata.process_id) {
      throw new Error('HTML payload 的 metadata.process_id 与草稿不一致');
    }
    if (payload.metadata.title !== metadata.title) {
      throw new Error('HTML payload 的 metadata.title 与草稿不一致');
    }

    // 11. question↔element 双向引用验证
    // 11a. question→element 前向引用：已在 buildMeetingPackageHtml 中验证
    // 11b. element→question 反向引用：draft 活动的 question_ids 必须在 questions 中存在
    const questionIdSet = new Set(draft.questions.map(q => q.question_id));
    for (const activity of draft.activities) {
      for (const qid of (activity.question_ids || [])) {
        if (!questionIdSet.has(qid)) {
          throw new Error(`活动 ${activity.activity_id} 引用了不存在的问题 ${qid}`);
        }
      }
    }

    // 11c. 用 validateQuestions schema 验证（第一阶段 question validator）
    const qr = validateQuestions(questions);
    if (!qr.valid) {
      throw new Error(`问题数组不符合 schema: ${JSON.stringify(qr.errors)}`);
    }

    // ─── 安全发布：rename 原子操作 ─────────────────────────
    const finalNextDir = join(runDir, 'final.next');
    const finalBakDir = join(runDir, 'final.bak');
    const files = ['process.bpmn', 'questions.json', 'clarification-agenda.md', 'process-draft.json', htmlFilename];

    // 12. 将临时目录复制为 final.next（同文件系统 rename 源）
    //     先清理可能残留的 final.next
    try {
      await rm(finalNextDir, { recursive: true, force: true });
    } catch {}
    await cp(tempDir, finalNextDir, { recursive: true });

    // 13. 测试用故障注入点：在 backup rename 之前
    if (onPublishFault) onPublishFault('before-backup');

    // 14. 旧 final → final.bak（backup）
    let hadOldFinal = false;
    try {
      await stat(finalDir);
      hadOldFinal = true;
    } catch {}
    if (hadOldFinal) {
      // 清理可能残留的 final.bak
      try {
        await rm(finalBakDir, { recursive: true, force: true });
      } catch {}
      await rename(finalDir, finalBakDir);
    }

    // 15. final.next → final（promote）
    try {
      // 测试用故障注入点：在 backup 之后、promote 之前
      if (onPublishFault) onPublishFault('before-promote');

      await rename(finalNextDir, finalDir);
    } catch (publishErr) {
      // rollback: 从 final.bak 恢复旧 final
      try {
        // 确保 final 目录不存在（可能 rename 部分失败）
        try { await rm(finalDir, { recursive: true, force: true }); } catch {}
        if (hadOldFinal) {
          await rename(finalBakDir, finalDir);
        }
      } catch (rollbackErr) {
        throw new Error(
          `发布失败且回滚失败: publish=${publishErr.message}, rollback=${rollbackErr.message}`
        );
      }
      throw publishErr;
    }

    // 16. 发布成功，清理 backup
    try {
      await rm(finalBakDir, { recursive: true, force: true });
    } catch {}

    // 17. 清理临时目录
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}

    return {
      success: true,
      files,
      html,
    };
  } catch (err) {
    // 清理临时目录
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {}
    // 清理可能残留的 final.next
    try {
      await rm(join(runDir, 'final.next'), { recursive: true, force: true });
    } catch {}
    throw err;
  }
}
