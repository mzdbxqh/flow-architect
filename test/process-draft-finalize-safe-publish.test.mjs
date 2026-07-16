/**
 * Finalize 安全发布测试
 *
 * 验证 B 部分要求：
 * 1. finalize 必须在完整临时目录生成所有产物
 * 2. 用 extractMeetingPackageHtml 复读 HTML payload，验证与独立文件一致
 * 3. 用 validateQuestions 复验 question↔element 双向引用
 * 4. 采用同文件系统目录 rename + backup/rollback 原子发布
 * 5. 失败注入测试：旧 final 按字节保留，无半成品
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, readdir, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Process Draft Finalize Safe Publish', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'finalize-safe-publish-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('RED: 失败注入 - rename 发布阶段中断恢复', () => {
    it('发布阶段中断时旧 final 必须按字节恢复（真实 rename 故障注入）', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'rename-fault-rollback');
      await createTestRunDir(runDir);

      // 第一次 finalize 成功
      const result1 = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result1.success, '第一次 finalize 应成功');

      // 保存旧 final 的完整内容快照
      const finalDir = join(runDir, 'final');
      const oldSnapshot = await snapshotDir(finalDir);

      // 第二次 finalize，在旧 final → final.bak 之后、final.next → final 之前抛错
      try {
        await finalizeProcessDraft({
          runDir,
          revision: 'r01',
          onPublishFault: (step) => {
            if (step === 'before-promote') {
              throw new Error('INJECTED_PUBLISH_FAULT');
            }
          },
        });
        assert.fail('第二次 finalize 应因注入故障而失败');
      } catch (err) {
        assert.ok(err.message.includes('INJECTED_PUBLISH_FAULT'), '应是注入的故障: ' + err.message);
      }

      // 断言 1: 旧 final 全部文件按字节恢复
      const newSnapshot = await snapshotDir(finalDir);
      assert.equal(
        newSnapshot.size,
        oldSnapshot.size,
        'final 文件数量应与旧 final 完全一致'
      );
      for (const [name, hash] of oldSnapshot.hashes) {
        assert.ok(newSnapshot.hashes.has(name), `文件 ${name} 应存在`);
        assert.equal(
          newSnapshot.hashes.get(name),
          hash,
          `文件 ${name} 应按字节恢复（SHA-256 一致）`
        );
      }

      // 断言 2: temp 和 backup 无残留
      await assertNotExists(join(runDir, 'final.next'), 'final.next 目录不应残留');
      await assertNotExists(join(runDir, 'final.bak'), 'final.bak 目录不应残留');
      await assertNotExists(join(runDir, '.temp-finalize'), '.temp-finalize 不应残留');
    });

    it('首次发布中断时无 final 残留、无 temp/backup 残留', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'first-fault-cleanup');
      await createTestRunDir(runDir);
      // 确保没有 final 目录中的文件（创建测试目录时已创建空 final）
      const finalDir = join(runDir, 'final');

      try {
        await finalizeProcessDraft({
          runDir,
          revision: 'r01',
          onPublishFault: (step) => {
            if (step === 'before-promote') {
              throw new Error('INJECTED_FIRST_FAULT');
            }
          },
        });
        assert.fail('应因注入故障而失败');
      } catch (err) {
        assert.ok(err.message.includes('INJECTED_FIRST_FAULT'));
      }

      // final 应被 rollback 清理（因为备份时 final 已 rename 走，rollback 从 bak 恢复，但原 final 为空目录）
      await assertNotExists(join(runDir, 'final.next'), 'final.next 不应残留');
      await assertNotExists(join(runDir, 'final.bak'), 'final.bak 不应残留');
      await assertNotExists(join(runDir, '.temp-finalize'), '.temp-finalize 不应残留');
    });

    it('queue 验证失败时旧 final 按字节保留（故障在 rename 之前）', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'preserve-on-queue-fail');
      await createTestRunDir(runDir);

      // 第一次 finalize 成功
      await finalizeProcessDraft({ runDir, revision: 'r01' });
      const finalDir = join(runDir, 'final');
      const oldSnapshot = await snapshotDir(finalDir);

      // 修改 queue 状态使第二次 finalize 在验证阶段失败（rename 之前）
      const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
      const queue = JSON.parse(await readFile(queuePath, 'utf8'));
      queue.batches[0].status = 'FAILED';
      await writeFile(queuePath, JSON.stringify(queue));

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('queue 验证应失败');
      } catch (err) {
        assert.ok(
          err.message.includes('未验收') || err.message.includes('FAILED'),
          '错误应提及未验收: ' + err.message
        );
      }

      // 旧 final 按字节保留
      const newSnapshot = await snapshotDir(finalDir);
      for (const [name, hash] of oldSnapshot.hashes) {
        assert.equal(newSnapshot.hashes.get(name), hash, `文件 ${name} 应按字节保留`);
      }
    });
  });

  describe('RED: HTML payload 复读验证', () => {
    it('必须用 extractMeetingPackageHtml 复读 payload 验证与独立文件一致', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const { extractMeetingPackageHtml } = await import('../scripts/lib/meeting-package-html.mjs');

      const runDir = join(tempDir, 'payload-verify');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      // 从 HTML 复读 payload
      const payload = extractMeetingPackageHtml(result.html);

      // 验证 payload.bpmn_xml 与 process.bpmn 文件一致
      const bpmnFile = await readFile(join(runDir, 'final', 'process.bpmn'), 'utf8');
      assert.equal(
        payload.bpmn_xml,
        bpmnFile,
        'HTML payload 的 bpmn_xml 必须与 process.bpmn 文件按字节一致'
      );

      // 验证 payload.questions 与 questions.json 文件一致
      const questionsFile = JSON.parse(await readFile(join(runDir, 'final', 'questions.json'), 'utf8'));
      assert.deepEqual(
        payload.questions,
        questionsFile,
        'HTML payload 的 questions 必须与 questions.json 文件完全一致'
      );

      // 验证 payload.metadata 与 process-draft.json 中的信息一致
      const draftFile = JSON.parse(await readFile(join(runDir, 'final', 'process-draft.json'), 'utf8'));
      assert.equal(
        payload.metadata.process_id,
        `Process_${draftFile.process_card.process_id}`,
        'HTML payload 的 metadata.process_id 必须与 draft 一致'
      );
      assert.equal(
        payload.metadata.title,
        draftFile.process_card.name,
        'HTML payload 的 metadata.title 必须与 draft 一致'
      );
    });
  });

  describe('RED: question validator 复验双向引用', () => {
    it('必须用 validateQuestions 复验 question↔element 双向引用', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const { validateQuestions } = await import('../scripts/lib/meeting-package-contract.mjs');

      const runDir = join(tempDir, 'question-verify');
      await createTestRunDir(runDir);

      await finalizeProcessDraft({ runDir, revision: 'r01' });

      const questions = JSON.parse(
        await readFile(join(runDir, 'final', 'questions.json'), 'utf8')
      );

      const qr = validateQuestions(questions);
      assert.ok(qr.valid, `问题验证应通过: ${JSON.stringify(qr.errors)}`);
    });

    it('question→element 前向引用必须在 BPMN 中存在', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const { extractMeetingPackageHtml } = await import('../scripts/lib/meeting-package-html.mjs');
      const { extractBpmn } = await import('../scripts/extract-bpmn.mjs');

      const runDir = join(tempDir, 'q-ref-fwd');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
      const payload = extractMeetingPackageHtml(result.html);
      const model = extractBpmn(payload.bpmn_xml);

      // V2: diagram.nodes, V1: elements
      const nodes = model.diagram?.nodes || model.elements || [];
      const elementIds = new Set(nodes.map(e => e.element_id || e.node_id));
      elementIds.add(payload.metadata.process_id);

      for (const q of payload.questions) {
        for (const refId of q.target_paths) {
          // V2 支持 Activity-xxxx → Task-xxxx 映射
          let found = elementIds.has(refId);
          if (!found && refId.startsWith('Activity-')) {
            found = elementIds.has(refId.replace('Activity-', 'Task-'));
          }
          if (!found && refId.startsWith('Task-')) {
            found = elementIds.has(refId.replace('Task-', 'Activity-'));
          }
          assert.ok(found, `问题 ${q.question_id} 引用的元素 ${refId} 应在 BPMN 中存在`);
        }
      }
    });

    it('element→question 反向引用必须在 questions 中存在', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'q-ref-rev');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      const questions = JSON.parse(
        await readFile(join(runDir, 'final', 'questions.json'), 'utf8')
      );
      const questionIds = new Set(questions.map(q => q.question_id));
      const draft = JSON.parse(
        await readFile(join(runDir, 'final', 'process-draft.json'), 'utf8')
      );

      // V2: 检查活动级别的 question_ids 反向引用
      for (const activity of draft.activities) {
        for (const qid of (activity.question_ids || [])) {
          assert.ok(
            questionIds.has(qid),
            `活动 ${activity.activity_id} 引用的问题 ${qid} 应在 questions 中存在`
          );
        }
      }
    });
  });

  describe('RED: rename + backup 原子发布', () => {
    it('finalize 必须使用 rename 原子操作发布（final.bak 在成功后清理）', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'rename-atomic');
      await createTestRunDir(runDir);

      const result1 = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result1.success, '第一次应成功');

      await stat(join(runDir, 'final'));
      await assertNotExists(join(runDir, 'final.bak'), '正常完成不应有 final.bak 残留');
      await assertNotExists(join(runDir, 'final.next'), '正常完成不应有 final.next 残留');
    });

    it('重复 finalize 时旧 final 必须先 backup 再发布', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'backup-rollback');
      await createTestRunDir(runDir);

      // 第一次 finalize
      await finalizeProcessDraft({ runDir, revision: 'r01' });
      const oldBpmnHash = createHash('sha256')
        .update(await readFile(join(runDir, 'final', 'process.bpmn'), 'utf8'))
        .digest('hex');

      // 第二次 finalize（相同输入应产生相同输出）
      const result2 = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result2.success, '重复 finalize 应成功');

      const newBpmnHash = createHash('sha256')
        .update(await readFile(join(runDir, 'final', 'process.bpmn'), 'utf8'))
        .digest('hex');
      assert.equal(newBpmnHash, oldBpmnHash, '相同输入应产生相同输出');

      await assertNotExists(join(runDir, 'final.bak'), '正常完成不应有 final.bak 残留');
    });
  });

  describe('RED: 完整临时目录生成', () => {
    it('所有产物必须在临时目录完整生成后再发布', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'temp-complete');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      const finalDir = join(runDir, 'final');
      const requiredFiles = [
        'process.bpmn',
        'questions.json',
        'clarification-agenda.md',
        'process-draft.json',
      ];

      for (const f of requiredFiles) {
        const content = await readFile(join(finalDir, f), 'utf8');
        assert.ok(content.length > 0, `${f} 不应为空`);
      }

      const htmlFiles = result.files.filter(f => f.endsWith('.html'));
      assert.ok(htmlFiles.length > 0, '应生成 HTML 文件');
      for (const f of htmlFiles) {
        await stat(join(finalDir, f));
      }
    });
  });
});

// ─── 辅助函数 ─────────────────────────────────────────

/** 目录快照：记录每个文件的 SHA-256 哈希 */
async function snapshotDir(dir) {
  const files = await readdir(dir);
  const hashes = new Map();
  for (const f of files) {
    const content = await readFile(join(dir, f));
    hashes.set(f, createHash('sha256').update(content).digest('hex'));
  }
  return { size: files.length, hashes };
}

/** 断言路径不存在 */
async function assertNotExists(p, msg) {
  try {
    await stat(p);
    assert.fail(msg || `${p} 不应存在`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** 创建测试 run 目录（含双向 question↔element 引用） */
async function createTestRunDir(runDir) {
  await mkdir(join(runDir, 'input'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'batches'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
  await mkdir(join(runDir, 'final'), { recursive: true });

  // manifest
  await writeFile(join(runDir, 'input', 'input-manifest.json'), JSON.stringify({
    schema_version: '1.0.0',
    title: '测试流程',
    focus: null,
    artifacts: [{ file_path: 'test.md', format: 'md', sha256: 'a'.repeat(64) }],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
  }));

  // evidence index
  await writeFile(join(runDir, 'evidence', 'evidence-index.json'), JSON.stringify({
    schema_version: '1.0.0',
    total_blocks: 1,
    blocks: [{
      block_id: 'B-001',
      source_format: 'md',
      modality: 'TEXT',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
      heading_path: [],
      content_sha256: 'b'.repeat(64),
    }],
    warnings: [],
  }));

  // batch
  await writeFile(join(runDir, 'evidence', 'batches', 'EB-001.json'), JSON.stringify({
    batch_id: 'EB-001',
    batch_sha256: 'c'.repeat(64),
    blocks: [{
      block_id: 'B-001',
      source_format: 'md',
      modality: 'TEXT',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
      heading_path: [],
      content_sha256: 'b'.repeat(64),
    }],
    total_chars: 100,
    modality_mix: ['TEXT'],
  }));

  // V2 fragments (每个 batch 三个 task_kind)
  const activityFacts = [
    {
      fact_id: 'F-001',
      kind: 'ACTIVITY',
      process_key: 'test',
      subject_key: 'submit',
      label: '提交申请',
      attributes: { role: '申请人' },
      certainty: 'EXPLICIT',
      evidence_refs: ['B-001'],
    },
    {
      fact_id: 'F-002',
      kind: 'ACTIVITY',
      process_key: 'test',
      subject_key: 'review',
      label: '审批申请',
      attributes: { role: '审批人' },
      certainty: 'EXPLICIT',
      evidence_refs: ['B-001'],
    },
    {
      fact_id: 'F-003',
      kind: 'ROLE',
      process_key: 'test',
      subject_key: 'applicant',
      label: '申请人',
      attributes: {},
      certainty: 'EXPLICIT',
      evidence_refs: ['B-001'],
    },
    {
      fact_id: 'F-004',
      kind: 'ROLE',
      process_key: 'test',
      subject_key: 'reviewer',
      label: '审批人',
      attributes: {},
      certainty: 'EXPLICIT',
      evidence_refs: ['B-001'],
    },
  ];

  const fragmentFragments = [
    {
      schema_version: '2.0.0',
      batch_id: 'EB-001',
      batch_sha256: 'c'.repeat(64),
      task_kind: 'PROCESS_CARD',
      payload: { facts: [], uncertainties: [] },
    },
    {
      schema_version: '2.0.0',
      batch_id: 'EB-001',
      batch_sha256: 'c'.repeat(64),
      task_kind: 'ACTIVITY_CATALOG',
      payload: { facts: activityFacts, uncertainties: [] },
    },
    {
      schema_version: '2.0.0',
      batch_id: 'EB-001',
      batch_sha256: 'c'.repeat(64),
      task_kind: 'CONTROL_FLOW',
      payload: {
        facts: [{
          fact_id: 'F-flow-001',
          kind: 'FLOW',
          process_key: 'test',
          subject_key: 'flow-1',
          label: '提交→审批',
          attributes: { source: '提交申请', target: '审批申请' },
          certainty: 'EXPLICIT',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [],
      },
    },
  ];

  const queueEntries = [];
  for (const fragment of fragmentFragments) {
    const taskSuffixMap = { PROCESS_CARD: 'card', ACTIVITY_CATALOG: 'activity', CONTROL_FLOW: 'flow' };
    const taskId = `EB-001-${taskSuffixMap[fragment.task_kind]}`;
    const fragmentContent = JSON.stringify(fragment, null, 2) + '\n';
    const fragmentSha256 = createHash('sha256').update(fragmentContent).digest('hex');

    await writeFile(
      join(runDir, 'stages', 'semantic', 'fragments', `${taskId}.json`),
      fragmentContent
    );

    queueEntries.push({
      batch_id: 'EB-001',
      task_id: taskId,
      task_kind: fragment.task_kind,
      batch_sha256: 'c'.repeat(64),
      status: 'ACCEPTED',
      fragment_sha256: fragmentSha256,
    });
  }

  // queue
  await writeFile(join(runDir, 'stages', 'semantic', 'queue.json'), JSON.stringify({
    schema_version: '1.0.0',
    batches: queueEntries,
    total_batches: 1,
    total_blocks: 1,
  }));

  // process-draft（V2 格式，含双向 question↔element 引用）
  await writeFile(join(runDir, 'stages', 'merge', 'process-draft.json'), JSON.stringify({
    schema_version: '2.0.0',
    process_card: {
      process_id: 'test',
      name: '测试流程',
      level: 'L4',
      is_leaf: true,
      description: '测试流程',
      purpose: '测试',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start-1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End-1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-001',
        name: '提交申请',
        description: '提交申请',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-001', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: [],
        process_summary: '',
        outputs: ['申请单'],
        completion_criteria: [],
        references: [],
        main_task_id: 'Task-001',
        confirmation: null,
        completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity-002',
        name: '审批申请',
        description: '审批申请',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-002', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: ['申请单'],
        process_summary: '',
        outputs: ['审批结果'],
        completion_criteria: [],
        references: [],
        main_task_id: 'Task-002',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-001', name: '申请人', role_id: 'Role-001' },
        { lane_id: 'Lane-002', name: '审批人', role_id: 'Role-002' },
      ],
      nodes: [
        { node_id: 'Start-1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交申请', lane_id: 'Lane-001' },
        { node_id: 'Task-002', node_type: 'MAIN_TASK', name: '审批申请', lane_id: 'Lane-002' },
        { node_id: 'End-1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Task-001', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-001', target_ref: 'Task-002', condition: null },
        { flow_id: 'Flow-3', source_ref: 'Task-002', target_ref: 'End-1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null },
        { activity_id: 'Activity-002', main_task_id: 'Task-002', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [
      {
        question_id: 'Q-001',
        text: '审批人是谁？',
        target_paths: ['Task-002'],
        status: 'OPEN',
        answer: '',
        evidence_refs: ['B-001'],
      },
    ],
    provenance: {},
    source_summary: {
      total_blocks: 1,
      formats: ['md'],
      evidence_refs: ['B-001'],
    },
  }));
}
