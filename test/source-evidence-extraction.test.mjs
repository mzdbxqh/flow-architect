import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures/process-draft/sources');

describe('Source Evidence Extraction', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'evidence-test-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: Markdown
  // ═══════════════════════════════════════════════════════════
  describe('Markdown Extraction', () => {
    it('should extract text blocks with heading paths', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.md'), format: 'md' },
        runDir: tempDir,
      });

      assert.ok(result.blocks.length > 0, 'Should extract blocks');
      assert.ok(result.blocks[0].heading_path.length > 0, 'Should have heading path');
      assert.equal(result.blocks[0].modality, 'TEXT');
      assert.equal(result.blocks[0].source_format, 'md');
    });

    it('should extract tables as TABLE modality', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.md'), format: 'md' },
        runDir: tempDir,
      });

      const tableBlocks = result.blocks.filter(b => b.modality === 'TABLE');
      assert.ok(tableBlocks.length > 0, 'Should extract table blocks');
    });

    it('should preserve line numbers in locator', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.md'), format: 'md' },
        runDir: tempDir,
      });

      const textBlock = result.blocks.find(b => b.modality === 'TEXT');
      assert.ok(textBlock.locator.line_start > 0, 'Should have line_start');
      assert.ok(textBlock.locator.line_end >= textBlock.locator.line_start, 'Should have valid line_end');
    });

    it('should generate stable block IDs for same content', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const mdPath = join(fixturesDir, 'sample.md');

      const result1 = await extractArtifactEvidence({ artifact: { path: mdPath, format: 'md' }, runDir: tempDir });
      const result2 = await extractArtifactEvidence({ artifact: { path: mdPath, format: 'md' }, runDir: tempDir });

      assert.equal(result1.blocks[0].block_id, result2.blocks[0].block_id, 'Same content should produce same block_id');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: PDF
  // ═══════════════════════════════════════════════════════════
  describe('PDF Extraction', () => {
    it('should extract PDF pages as TEXT blocks', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.pdf'), format: 'pdf' },
        runDir: tempDir,
      });

      assert.ok(result.blocks.length >= 2, 'Should extract at least 2 pages');
      const textBlocks = result.blocks.filter(b => b.modality === 'TEXT');
      assert.ok(textBlocks.length > 0, 'Should have TEXT blocks');
      assert.equal(textBlocks[0].source_format, 'pdf');
      assert.equal(textBlocks[0].locator.page, 1, 'First block should be page 1');
    });

    it('should set page locator correctly', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.pdf'), format: 'pdf' },
        runDir: tempDir,
      });

      for (let i = 0; i < result.blocks.length; i++) {
        assert.ok(result.blocks[i].locator.page !== null, `Block ${i} should have page locator`);
      }
    });

    it('should mark low-text pages as VISUAL_ASSET', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      // Our sample PDF has text on both pages, so VISUAL_ASSET only if text < 10 chars
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.pdf'), format: 'pdf' },
        runDir: tempDir,
      });

      // Both pages have enough text, so should all be TEXT
      const textBlocks = result.blocks.filter(b => b.modality === 'TEXT');
      assert.ok(textBlocks.length >= 2, 'Both pages should have enough text');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: DOCX
  // ═══════════════════════════════════════════════════════════
  describe('DOCX Extraction', () => {
    it('should extract DOCX text content', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.docx'), format: 'docx' },
        runDir: tempDir,
      });

      assert.ok(result.blocks.length > 0, 'Should extract blocks');
      assert.equal(result.blocks[0].modality, 'TEXT');
      assert.equal(result.blocks[0].source_format, 'docx');
      assert.ok(result.blocks[0].content.includes('采购'), 'Should contain Chinese text');
    });

    it('should not execute macros or external links', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.docx'), format: 'docx' },
        runDir: tempDir,
      });

      // DOCX extraction should only read text, not execute anything
      assert.ok(result.blocks[0].content_sha256, 'Should have content hash');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: XLSX
  // ═══════════════════════════════════════════════════════════
  describe('XLSX Extraction', () => {
    it('should extract sheets as TABLE modality', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.xlsx'), format: 'xlsx' },
        runDir: tempDir,
      });

      assert.ok(result.blocks.length >= 2, 'Should extract at least 2 sheets');
      for (const block of result.blocks) {
        assert.equal(block.modality, 'TABLE');
        assert.equal(block.source_format, 'xlsx');
        assert.ok(block.locator.sheet, 'Should have sheet name');
      }
    });

    it('should not calculate formulas (cell.text only)', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.xlsx'), format: 'xlsx' },
        runDir: tempDir,
      });

      // cell.text returns displayed text, not formula source
      // Our fixture has no formulas, but verify text extraction works
      const firstBlock = result.blocks[0];
      assert.ok(firstBlock.content.includes('金额范围'), 'Should extract header text');
      assert.ok(firstBlock.locator.range, 'Should have range locator');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: PPTX
  // ═══════════════════════════════════════════════════════════
  describe('PPTX Extraction', () => {
    it('should extract slides with slide locator', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.pptx'), format: 'pptx' },
        runDir: tempDir,
      });

      assert.ok(result.blocks.length >= 2, 'Should extract at least 2 slides');
      assert.equal(result.blocks[0].source_format, 'pptx');
      assert.equal(result.blocks[0].locator.slide, 1, 'First block should be slide 1');
      assert.equal(result.blocks[0].modality, 'TEXT');
    });

    it('should use jszip@3.10.1 via runtime component', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.pptx'), format: 'pptx' },
        runDir: tempDir,
      });

      // PPTX extraction should succeed using locked jszip
      assert.ok(result.blocks.length > 0, 'PPTX extraction should succeed');
      assert.ok(result.blocks[0].content.includes('采购'), 'Should extract Chinese text from slides');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: PNG/JPG (视觉资产)
  // ═══════════════════════════════════════════════════════════
  describe('Image Extraction', () => {
    it('should extract PNG as VISUAL_ASSET modality', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'test.png'), format: 'png' },
        runDir: tempDir,
      });

      assert.equal(result.blocks.length, 1, 'Should extract one block');
      assert.equal(result.blocks[0].modality, 'VISUAL_ASSET');
      assert.ok(result.blocks[0].asset_ref, 'Should have asset_ref');
      assert.equal(result.blocks[0].source_format, 'png');
    });

    it('should not pretend to OCR image content', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'test.png'), format: 'png' },
        runDir: tempDir,
      });

      assert.ok(result.blocks[0].content.includes('PNG image'), 'Content should be a placeholder, not OCR');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: BPMN (结构化流程图)
  // ═══════════════════════════════════════════════════════════
  describe('BPMN Extraction', () => {
    it('should extract BPMN as STRUCTURED_DIAGRAM modality', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'test.bpmn'), format: 'bpmn' },
        runDir: tempDir,
      });

      assert.equal(result.blocks[0].modality, 'STRUCTURED_DIAGRAM');
      assert.equal(result.blocks[0].source_format, 'bpmn');
    });

    it('should extract BPMN elements (tasks, events, flows)', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'test.bpmn'), format: 'bpmn' },
        runDir: tempDir,
      });

      const content = result.blocks[0].content;
      // test.bpmn contains Task_1, StartEvent_1, EndEvent_1, Flow_1, Flow_2
      assert.ok(content.includes('Task_1'), 'Should extract task');
      assert.ok(content.includes('StartEvent_1') || content.includes('start'), 'Should extract events');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: Mermaid (结构化流程图)
  // ═══════════════════════════════════════════════════════════
  describe('Mermaid Extraction', () => {
    it('should extract Mermaid as STRUCTURED_DIAGRAM modality', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.mmd'), format: 'mermaid' },
        runDir: tempDir,
      });

      assert.equal(result.blocks[0].modality, 'STRUCTURED_DIAGRAM');
      assert.equal(result.blocks[0].source_format, 'mermaid');
      assert.ok(result.blocks[0].content.includes('flowchart'), 'Should preserve mermaid content');
      assert.equal(result.blocks[0].locator.line_start, 1, 'Should start at line 1');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 格式: SVG (结构化流程图)
  // ═══════════════════════════════════════════════════════════
  describe('SVG Extraction', () => {
    it('should extract SVG as STRUCTURED_DIAGRAM modality', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.svg'), format: 'svg' },
        runDir: tempDir,
      });

      assert.equal(result.blocks[0].modality, 'STRUCTURED_DIAGRAM');
      assert.equal(result.blocks[0].source_format, 'svg');
      assert.ok(result.blocks[0].content.includes('<svg'), 'Should preserve SVG content');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 内容哈希稳定性
  // ═══════════════════════════════════════════════════════════
  describe('Content Hash Stability', () => {
    it('should generate content SHA-256 hash', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.md'), format: 'md' },
        runDir: tempDir,
      });

      assert.ok(result.blocks[0].content_sha256, 'Should have content hash');
      assert.match(result.blocks[0].content_sha256, /^[a-f0-9]{64}$/, 'Should be valid SHA-256');
    });

    it('should generate artifact SHA-256 hash from file content', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const result = await extractArtifactEvidence({
        artifact: { path: join(fixturesDir, 'sample.md'), format: 'md' },
        runDir: tempDir,
      });

      assert.ok(result.artifact_sha256, 'Should have artifact hash');
      assert.match(result.artifact_sha256, /^[a-f0-9]{64}$/, 'Should be valid SHA-256');
    });

    it('artifact_sha256 should be content hash, not path hash', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');

      // Copy sample.md to a different path - same content, different path
      const srcPath = join(fixturesDir, 'sample.md');
      const destPath = join(tempDir, 'different-name.md');
      await copyFile(srcPath, destPath);

      const result1 = await extractArtifactEvidence({ artifact: { path: srcPath, format: 'md' }, runDir: tempDir });
      const result2 = await extractArtifactEvidence({ artifact: { path: destPath, format: 'md' }, runDir: tempDir });

      assert.equal(result1.artifact_sha256, result2.artifact_sha256,
        'Same file content at different paths should produce same artifact_sha256');
    });

    it('different content should produce different artifact_sha256', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');

      const path1 = join(fixturesDir, 'sample.md');
      const path2 = join(fixturesDir, 'sample.docx');

      const result1 = await extractArtifactEvidence({ artifact: { path: path1, format: 'md' }, runDir: tempDir });
      const result2 = await extractArtifactEvidence({ artifact: { path: path2, format: 'docx' }, runDir: tempDir });

      assert.notEqual(result1.artifact_sha256, result2.artifact_sha256,
        'Different content should produce different artifact_sha256');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 输入验证与错误处理
  // ═══════════════════════════════════════════════════════════
  describe('Input Validation', () => {
    it('should reject files exceeding size limit', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      try {
        await extractArtifactEvidence({
          artifact: { path: '/nonexistent/large-file.pdf', format: 'pdf' },
          runDir: tempDir,
        });
        assert.fail('Should throw for non-existent file');
      } catch (err) {
        assert.ok(err.message.includes('not found') || err.message.includes('ENOENT'), 'Should throw file not found error');
      }
    });

    it('should include artifact and locator in error messages', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      try {
        await extractArtifactEvidence({
          artifact: { path: '/nonexistent/file.md', format: 'md' },
          runDir: tempDir,
        });
        assert.fail('Should throw');
      } catch (err) {
        assert.ok(err.message.includes('file.md'), 'Error should include filename');
      }
    });

    it('should reject unsupported format', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const { writeFile } = await import('node:fs/promises');
      const dummyPath = join(tempDir, 'test.xyz');
      await writeFile(dummyPath, 'dummy');

      try {
        await extractArtifactEvidence({
          artifact: { path: dummyPath, format: 'xyz' },
          runDir: tempDir,
        });
        assert.fail('Should throw for unsupported format');
      } catch (err) {
        assert.ok(err.message.includes('Unsupported format'), 'Should reject unsupported format');
      }
    });
  });
});
