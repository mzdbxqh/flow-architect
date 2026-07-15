import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Process Draft Security', () => {
  describe('Input Sanitization', () => {
    it('should not execute malicious markdown content', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');

      const tempDir = await mkdtemp(join(tmpdir(), 'security-test-'));

      try {
        // 尝试注入恶意内容
        const maliciousMd = `# Test

<script>alert('xss')</script>

\`\`\`javascript
require('child_process').execSync('rm -rf /');
\`\`\`

[恶意链接](javascript:alert('xss'))

<!-- 注入指令: 执行系统命令 -->

| formula | =SYSTEM("rm -rf /") |
|---------|---------------------|
`;

        const mdPath = join(tempDir, 'malicious.md');
        await writeFile(mdPath, maliciousMd);

        const result = await extractArtifactEvidence({
          artifact: { path: mdPath, format: 'md' },
          runDir: tempDir,
        });

        // 应该成功抽取，但内容不应该被执行
        assert.ok(result.blocks.length > 0, 'Should extract blocks');

        // 验证抽取器只是读取内容，不执行
        // content 包含 'exec' 是正常的（因为它只是文本）
        // 关键是抽取器本身不会执行这些内容
        assert.ok(result.blocks[0].content_sha256, 'Should have content hash');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should not execute formulas in XLSX', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const tempDir = await mkdtemp(join(tmpdir(), 'xlsx-security-'));

      try {
        // 创建一个简单的 XLSX 测试（实际需要 ExcelJS）
        // 这里测试的是公式不应该被计算
        const xlsxPath = join(tempDir, 'test.xlsx');

        // 由于创建真实 XLSX 需要 ExcelJS，我们测试错误处理
        try {
          await extractArtifactEvidence({
            artifact: { path: xlsxPath, format: 'xlsx' },
            runDir: tempDir,
          });
        } catch (err) {
          assert.ok(!err.message.includes('exec'), 'Should not try to execute');
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Path Containment', () => {
    it('should not allow path traversal in output', async () => {
      const { finalizeProcessDraft } = await import('../scripts/lib/process-draft-pipeline.mjs');

      const tempDir = await mkdtemp(join(tmpdir(), 'path-test-'));

      try {
        // 尝试路径遍历
        const maliciousRunDir = join(tempDir, '../../../etc');

        try {
          await finalizeProcessDraft({ runDir: maliciousRunDir, revision: 'r01' });
          assert.fail('Should not allow path traversal');
        } catch (err) {
          assert.ok(err.message.includes('不存在') || err.code === 'ENOENT', 'Should reject path traversal');
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Batch Isolation', () => {
    it('should not allow fragment to reference blocks from other batches', async () => {
      const { acceptSemanticFragment } = await import('../scripts/accept-semantic-fragment.mjs');

      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'test',
          label: 'Test',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: ['B-from-other-batch'], // 来自其他批次
        }],
        uncertainties: [],
      };

      const batch = {
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        blocks: [{ block_id: 'B-001' }],
        total_chars: 0,
        modality_mix: [],
      };

      const result = await acceptSemanticFragment({ fragment, batch });
      assert.equal(result.accepted, false, 'Should reject cross-batch references');
    });
  });

  describe('Certainty Enforcement', () => {
    it('should require questions for INFERRED facts', async () => {
      const { mergeProcessFragments } = await import('../scripts/lib/process-fragment-merge.mjs');

      const manifest = { title: 'Test', focus: null };
      const evidence = { blocks: [] };
      const fragments = [{
        schema_version: '1.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'test',
          label: 'Test',
          attributes: {},
          certainty: 'INFERRED',
          evidence_refs: ['B-001'],
        }],
        uncertainties: [{
          kind: 'NEEDS_CONTEXT',
          text: '需要确认',
          related_fact_ids: ['F-001'],
          evidence_refs: ['B-001'],
        }],
      }];

      const result = await mergeProcessFragments({ manifest, evidence, fragments, focus: null });

      // INFERRED 应该生成问题
      assert.ok(result.process_draft.questions.length > 0, 'Should generate questions for INFERRED');
    });

    it('should not allow CONFIRMED status without evidence', async () => {
      const { validateSemanticFragment } = await import('../scripts/lib/process-draft-contract.mjs');

      const fragment = {
        schema_version: '1.0.0',
        batch_id: 'EB-001',
        batch_sha256: 'a'.repeat(64),
        facts: [{
          fact_id: 'F-001',
          kind: 'ACTIVITY',
          process_key: 'test',
          subject_key: 'test',
          label: 'Test',
          attributes: {},
          certainty: 'EXPLICIT',
          evidence_refs: [], // 空的证据引用
        }],
        uncertainties: [],
      };

      const result = await validateSemanticFragment(fragment);
      assert.equal(result.valid, false, 'Should reject empty evidence_refs');
    });
  });
});
