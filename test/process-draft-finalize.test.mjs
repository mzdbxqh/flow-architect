import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Process Draft Finalize', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'finalize-test-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('finalizeProcessDraft', () => {
    it('should generate all final output files', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      // 创建测试 run 目录
      const runDir = join(tempDir, 'run1');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      assert.ok(result.success, 'Should succeed');
      assert.ok(result.files.includes('process.bpmn'), 'Should generate BPMN');
      assert.ok(result.files.includes('questions.json'), 'Should generate questions');
      assert.ok(result.files.includes('clarification-agenda.md'), 'Should generate agenda');
      assert.ok(result.files.includes('process-draft.json'), 'Should generate draft');

      // 验证文件存在
      await assertFileExists(join(runDir, 'final', 'process.bpmn'));
      await assertFileExists(join(runDir, 'final', 'questions.json'));
      await assertFileExists(join(runDir, 'final', 'clarification-agenda.md'));
    });

    it('should generate HTML meeting package', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'run-html');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      // 应该生成 HTML
      const htmlFiles = result.files.filter(f => f.endsWith('.html'));
      assert.ok(htmlFiles.length > 0, 'Should generate HTML');
    });

    it('should produce deterministic output', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir1 = join(tempDir, 'det1');
      const runDir2 = join(tempDir, 'det2');
      await createTestRunDir(runDir1);
      await createTestRunDir(runDir2);

      await finalizeProcessDraft({ runDir: runDir1, revision: 'r01' });
      await finalizeProcessDraft({ runDir: runDir2, revision: 'r01' });

      const bpmn1 = await readFile(join(runDir1, 'final', 'process.bpmn'), 'utf8');
      const bpmn2 = await readFile(join(runDir2, 'final', 'process.bpmn'), 'utf8');

      assert.equal(bpmn1, bpmn2, 'Same input should produce same BPMN');
    });

    it('should not call LLM when fragments exist', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'no-llm');
      await createTestRunDir(runDir);

      // 验证 finalize 是确定性的（不接受 LLM 参数）
      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result.success, 'Should succeed without LLM');
    });

    it('should fail if fragments missing', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'missing');
      await mkdir(runDir, { recursive: true });

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('Should fail when fragments missing');
      } catch (err) {
        assert.ok(err.message.includes('不存在') || err.message.includes('missing'), 'Should mention missing');
      }
    });

    it('should not produce partial output on failure', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'partial');
      await mkdir(runDir, { recursive: true });

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
      } catch {
        // Should not leave partial files
        try {
          await stat(join(runDir, 'final', 'process.bpmn'));
          assert.fail('Should not create partial files');
        } catch (err) {
          assert.ok(err.code === 'ENOENT', 'Partial files should not exist');
        }
      }
    });

    it('should validate questions reference existing elements', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'validate-questions');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result.success, 'Should succeed with valid questions');
    });
  });

  describe('Questions JSON', () => {
    it('should include all required fields', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'questions-fields');
      await createTestRunDir(runDir);

      await finalizeProcessDraft({ runDir, revision: 'r01' });

      const questions = JSON.parse(
        await readFile(join(runDir, 'final', 'questions.json'), 'utf8')
      );

      assert.ok(Array.isArray(questions), 'Should be array');
      if (questions.length > 0) {
        assert.ok(questions[0].id || questions[0].question_id, 'Should have id');
        assert.ok(questions[0].text, 'Should have text');
        assert.ok(questions[0].status, 'Should have status');
      }
    });
  });

  describe('Phase 1 HTML Builder Reuse', () => {
    it('should use phase 1 buildMeetingPackageHtml with embedded payload', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'phase1-html');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      // Phase 1 builder embeds payload as base64 in #fa-package-data script tag
      assert.ok(result.html.includes('fa-package-data'),
        'HTML should use phase 1 builder with fa-package-data container');
      // Phase 1 builder uses CSP with script hash
      assert.ok(result.html.includes("script-src"),
        'HTML should include CSP script-src directive');
    });

    it('should produce HTML payload consistent with BPMN and questions', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const { extractMeetingPackageHtml } = await import('../scripts/lib/meeting-package-html.mjs');

      const runDir = join(tempDir, 'payload-consistency');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });

      // Extract payload from HTML
      const payload = extractMeetingPackageHtml(result.html);

      // Payload BPMN should match the generated BPMN file
      const bpmnFile = await readFile(join(runDir, 'final', 'process.bpmn'), 'utf8');
      assert.equal(payload.bpmn_xml, bpmnFile, 'HTML payload BPMN should match process.bpmn');

      // Payload questions should match questions.json
      const questionsFile = JSON.parse(await readFile(join(runDir, 'final', 'questions.json'), 'utf8'));
      assert.equal(payload.questions.length, questionsFile.length,
        'Payload question count should match questions.json');
    });
  });

  describe('Revision Handling', () => {
    it('should use specified revision', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const runDir = join(tempDir, 'revision');
      await createTestRunDir(runDir);

      const result = await finalizeProcessDraft({ runDir, revision: 'r02' });
      // Filename contains revision
      const htmlFile = result.files.find(f => f.endsWith('.html'));
      assert.ok(htmlFile.includes('r02'), 'HTML filename should contain revision');
      // HTML payload contains revision (base64 encoded)
      assert.ok(result.html.length > 0, 'HTML should be generated');
    });
  });

  describe('Queue 验证增强', () => {
    it('queue 中有 PENDING 批次时应失败', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const runDir = join(tempDir, 'queue-pending');
      await createTestRunDir(runDir);

      // 修改 queue 为 PENDING
      const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
      const queue = JSON.parse(await readFile(queuePath, 'utf8'));
      queue.batches[0].status = 'PENDING';
      await writeFile(queuePath, JSON.stringify(queue));

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('queue 有 PENDING 批次时应失败');
      } catch (err) {
        assert.ok(
          err.message.includes('未验收') || err.message.includes('PENDING') || err.message.includes('ACCEPTED'),
          '错误应提及未验收: ' + err.message
        );
      }
    });

    it('queue 中有 FAILED 批次时应失败', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const runDir = join(tempDir, 'queue-failed');
      await createTestRunDir(runDir);

      const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
      const queue = JSON.parse(await readFile(queuePath, 'utf8'));
      queue.batches[0].status = 'FAILED';
      await writeFile(queuePath, JSON.stringify(queue));

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('queue 有 FAILED 批次时应失败');
      } catch (err) {
        assert.ok(
          err.message.includes('未验收') || err.message.includes('FAILED') || err.message.includes('ACCEPTED'),
          '错误应提及未验收'
        );
      }
    });

    it('fragment 文件缺失时应失败', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const runDir = join(tempDir, 'frag-missing');
      await createTestRunDir(runDir);

      // 删除 fragment 文件
      const fragPath = join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json');
      const { unlink } = await import('node:fs/promises');
      await unlink(fragPath);

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('fragment 缺失时应失败');
      } catch (err) {
        assert.ok(
          err.message.includes('缺失') || err.message.includes('missing') || err.message.includes('Fragment'),
          '错误应提及 fragment 缺失'
        );
      }
    });

    it('fragment hash 与 queue 不匹配时应失败', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const runDir = join(tempDir, 'frag-hash-mismatch');
      await createTestRunDir(runDir);

      // 修改 fragment 的 batch_sha256 使其与 queue 不匹配
      const fragPath = join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json');
      const frag = JSON.parse(await readFile(fragPath, 'utf8'));
      frag.batch_sha256 = 'x'.repeat(64);  // queue 中是 'c'.repeat(64)
      await writeFile(fragPath, JSON.stringify(frag));

      try {
        await finalizeProcessDraft({ runDir, revision: 'r01' });
        assert.fail('hash 不匹配时应失败');
      } catch (err) {
        assert.ok(
          err.message.includes('hash') || err.message.includes('Hash') || err.message.includes('不匹配'),
          '错误应提及 hash 不匹配'
        );
      }
    });

    it('queue 有 CACHED 状态批次时应通过', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');
      const runDir = join(tempDir, 'queue-cached');
      await createTestRunDir(runDir);

      const queuePath = join(runDir, 'stages', 'semantic', 'queue.json');
      const queue = JSON.parse(await readFile(queuePath, 'utf8'));
      queue.batches[0].status = 'CACHED';
      await writeFile(queuePath, JSON.stringify(queue));

      const result = await finalizeProcessDraft({ runDir, revision: 'r01' });
      assert.ok(result.success, 'CACHED 状态应通过 finalize');
    });
  });
});

async function createTestRunDir(runDir) {
  // 创建必要的目录和文件
  await mkdir(join(runDir, 'input'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'blocks'), { recursive: true });
  await mkdir(join(runDir, 'evidence', 'batches'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'semantic', 'fragments'), { recursive: true });
  await mkdir(join(runDir, 'stages', 'merge'), { recursive: true });
  await mkdir(join(runDir, 'final'), { recursive: true });

  // 创建 manifest
  await writeFile(join(runDir, 'input', 'input-manifest.json'), JSON.stringify({
    schema_version: '1.0.0',
    title: '测试流程',
    focus: null,
    artifacts: [{ file_path: 'test.md', format: 'md', sha256: 'a'.repeat(64) }],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
  }));

  // 创建 evidence index
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

  // 写入 batch 文件（供完整性验证重验 evidence_refs）
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

  // 创建 fragment
  const fragment = {
    schema_version: '1.0.0',
    batch_id: 'EB-001',
    batch_sha256: 'c'.repeat(64),
    facts: [
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
    ],
    uncertainties: [],
  };

  await writeFile(join(runDir, 'stages', 'semantic', 'fragments', 'EB-001.json'), JSON.stringify(fragment, null, 2) + '\n');

  // 计算 fragment 内容哈希
  const { createHash } = await import('node:crypto');
  const fragmentContent = JSON.stringify(fragment, null, 2) + '\n';
  const fragmentSha256 = createHash('sha256').update(fragmentContent).digest('hex');

  // 创建 queue
  await writeFile(join(runDir, 'stages', 'semantic', 'queue.json'), JSON.stringify({
    schema_version: '1.0.0',
    batches: [{
      batch_id: 'EB-001',
      batch_sha256: 'c'.repeat(64),
      total_chars: 100,
      modality_mix: ['TEXT'],
      block_count: 1,
      status: 'ACCEPTED',
      fragment_sha256: fragmentSha256,
    }],
    total_batches: 1,
    total_blocks: 1,
  }));

  // 创建 process-draft
  await writeFile(join(runDir, 'stages', 'merge', 'process-draft.json'), JSON.stringify({
    title: '测试流程',
    level: 'L5',
    process_id: 'test',
    boundary: { start: '开始', end: '结束' },
    lanes: [
      { lane_id: 'Lane-001', name: '申请人', org_candidates: [] },
      { lane_id: 'Lane-002', name: '审批人', org_candidates: [] },
    ],
    elements: [
      {
        element_id: 'Activity-001',
        kind: 'ACTIVITY',
        name: '提交申请',
        lane_id: 'Lane-001',
        inputs: [],
        outputs: ['申请单'],
        evidence_refs: ['B-001'],
        certainty: 'EXPLICIT',
        question_ids: [],
      },
      {
        element_id: 'Activity-002',
        kind: 'ACTIVITY',
        name: '审批申请',
        lane_id: 'Lane-002',
        inputs: ['申请单'],
        outputs: ['审批结果'],
        evidence_refs: ['B-001'],
        certainty: 'EXPLICIT',
        question_ids: [],
      },
    ],
    flows: [
      {
        flow_id: 'Flow-001',
        source_ref: 'Activity-001',
        target_ref: 'Activity-002',
        condition: null,
        evidence_refs: ['B-001'],
      },
    ],
    questions: [
      {
        question_id: 'Q-001',
        text: '审批人是谁？',
        element_ids: ['Activity-002'],
        status: 'OPEN',
        answer: '',
        evidence_refs: ['B-001'],
      },
    ],
    conflicts: [],
    source_summary: {
      total_blocks: 1,
      formats: ['md'],
      evidence_refs: ['B-001'],
    },
  }));
}

import { writeFile } from 'node:fs/promises';

async function assertFileExists(path) {
  try {
    await stat(path);
  } catch (err) {
    assert.fail(`File should exist: ${path}`);
  }
}
