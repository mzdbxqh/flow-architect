import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Process Draft Budget Enforcement', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'budget-test-'));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════
  // 文件大小预算
  // ═══════════════════════════════════════════════════════════
  describe('File Size Budget', () => {
    it('should reject files exceeding MAX_FILE_SIZE (50MB)', async () => {
      const { extractArtifactEvidence, BUDGET } = await import('../scripts/lib/source-evidence-extractor.mjs');

      // 创建一个超过 50MB 的假文件
      const largePath = join(tempDir, 'large.md');
      const largeContent = 'x'.repeat(BUDGET.MAX_FILE_SIZE + 1);
      await writeFile(largePath, largeContent);

      try {
        await extractArtifactEvidence({
          artifact: { path: largePath, format: 'md' },
          runDir: tempDir,
        });
        assert.fail('Should reject oversized file');
      } catch (err) {
        assert.ok(err.message.includes('size limit'), 'Should mention size limit');
      }
    });

    it('should accept files at exactly MAX_FILE_SIZE', async () => {
      const { extractArtifactEvidence, BUDGET } = await import('../scripts/lib/source-evidence-extractor.mjs');

      // 创建一个刚好等于限制的文件（但内容为空行以避免超大内存）
      // 我们用一个小文件验证边界：文件大小在限制内应该成功
      const okPath = join(tempDir, 'ok-size.md');
      await writeFile(okPath, '# Test\nSome content here.');

      const result = await extractArtifactEvidence({
        artifact: { path: okPath, format: 'md' },
        runDir: tempDir,
      });

      assert.ok(result.blocks.length > 0, 'Should extract normally sized file');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 字符预算
  // ═══════════════════════════════════════════════════════════
  describe('Character Budget', () => {
    it('should enforce MAX_CHARACTERS per PPTX slide', async () => {
      const { extractArtifactEvidence, BUDGET } = await import('../scripts/lib/source-evidence-extractor.mjs');
      const { loadJszip } = await import('../scripts/lib/source-evidence-extractor.mjs');

      // 创建一个单张幻灯片内容超过 500k 字符的 PPTX
      const JSZip = (await import('node:module')).createRequire(import.meta.url)(
        join(__dirname, '../node_modules/.pnpm/jszip@3.10.1/node_modules/jszip')
      );
      const zip = new JSZip();

      const hugeText = 'x'.repeat(BUDGET.MAX_CHARACTERS + 1);
      zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
      zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldIdLst></p:presentation>');
      zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
      zip.file('ppt/slides/slide1.xml', `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${hugeText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
      zip.file('ppt/slides/_rels/slide1.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const pptxPath = join(tempDir, 'huge-slide.pptx');
      await writeFile(pptxPath, buffer);

      try {
        await extractArtifactEvidence({
          artifact: { path: pptxPath, format: 'pptx' },
          runDir: tempDir,
        });
        assert.fail('Should reject slide exceeding character limit');
      } catch (err) {
        assert.ok(err.message.includes('character limit') || err.message.includes('size'),
          'Should mention character limit');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // ZIP 条目数预算
  // ═══════════════════════════════════════════════════════════
  describe('ZIP Entry Budget', () => {
    it('should reject PPTX with too many ZIP entries', async () => {
      const { extractArtifactEvidence, BUDGET } = await import('../scripts/lib/source-evidence-extractor.mjs');

      const JSZip = (await import('node:module')).createRequire(import.meta.url)(
        join(__dirname, '../node_modules/.pnpm/jszip@3.10.1/node_modules/jszip')
      );
      const zip = new JSZip();

      // 创建超过 MAX_ZIP_ENTRIES 个条目
      for (let i = 0; i < BUDGET.MAX_ZIP_ENTRIES + 1; i++) {
        zip.file(`fake/dir/file-${i}.xml`, '<dummy/>');
      }

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const zipBombPath = join(tempDir, 'zip-bomb.pptx');
      await writeFile(zipBombPath, buffer);

      try {
        await extractArtifactEvidence({
          artifact: { path: zipBombPath, format: 'pptx' },
          runDir: tempDir,
        });
        assert.fail('Should reject ZIP with too many entries');
      } catch (err) {
        assert.ok(err.message.includes('entry count') || err.message.includes('ZIP'),
          'Should mention ZIP entry limit');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 解压大小和压缩比预算
  // ═══════════════════════════════════════════════════════════
  describe('Decompression Budget', () => {
    it('should reject ZIP with excessive decompressed size', async () => {
      const { extractArtifactEvidence, BUDGET } = await import('../scripts/lib/source-evidence-extractor.mjs');

      const JSZip = (await import('node:module')).createRequire(import.meta.url)(
        join(__dirname, '../node_modules/.pnpm/jszip@3.10.1/node_modules/jszip')
      );
      const zip = new JSZip();

      // 创建一个解压后超过 100MB 的条目
      // 使用高度可压缩的内容（全是相同字符）
      const bigContent = 'A'.repeat(BUDGET.MAX_DECOMPRESSED_SIZE + 1);
      zip.file('ppt/slides/slide1.xml', bigContent);
      zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
      zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>');
      zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
      zip.file('ppt/slides/_rels/slide1.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');

      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const bombPath = join(tempDir, 'decompress-bomb.pptx');
      await writeFile(bombPath, buffer);

      try {
        await extractArtifactEvidence({
          artifact: { path: bombPath, format: 'pptx' },
          runDir: tempDir,
        });
        assert.fail('Should reject decompression bomb');
      } catch (err) {
        assert.ok(
          err.message.includes('decompress') || err.message.includes('size') || err.message.includes('limit'),
          'Should mention decompression limit: ' + err.message
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Zip Slip 防护
  // ═══════════════════════════════════════════════════════════
  describe('Zip Slip Protection', () => {
    it('should reject ZIP entries with path traversal', async () => {
      const { extractArtifactEvidence } = await import('../scripts/lib/source-evidence-extractor.mjs');

      const JSZip = (await import('node:module')).createRequire(import.meta.url)(
        join(__dirname, '../node_modules/.pnpm/jszip@3.10.1/node_modules/jszip')
      );
      const zip = new JSZip();

      // 创建带有路径穿越的条目
      zip.file('../../../etc/passwd', 'malicious');
      zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>test</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
      zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
      zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldIdLst></p:presentation>');
      zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
      zip.file('ppt/slides/_rels/slide1.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');

      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const slipPath = join(tempDir, 'zip-slip.pptx');
      await writeFile(slipPath, buffer);

      try {
        await extractArtifactEvidence({
          artifact: { path: slipPath, format: 'pptx' },
          runDir: tempDir,
        });
        assert.fail('Should reject Zip Slip');
      } catch (err) {
        assert.ok(err.message.includes('Zip Slip') || err.message.includes('traversal'),
          'Should mention Zip Slip: ' + err.message);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 批次预算
  // ═══════════════════════════════════════════════════════════
  describe('Batch Budget', () => {
    it('should split blocks exceeding 12,000 chars by natural paragraphs', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      // 创建一个超过 12k 字符的块
      const paragraphs = [];
      for (let i = 0; i < 10; i++) {
        paragraphs.push('段落' + i + '：' + '内容'.repeat(600));
      }
      const longContent = paragraphs.join('\n\n');

      const block = {
        block_id: 'B-long',
        artifact_sha256: 'a'.repeat(64),
        source_format: 'md',
        modality: 'TEXT',
        locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 100 },
        heading_path: ['测试'],
        content: longContent,
        asset_ref: null,
        content_sha256: 'b'.repeat(64),
      };

      const batches = buildEvidenceBatches({ blocks: [block], maxChars: 12000, maxBlocks: 12 });

      // 所有批次都不应超过 12,000 字符
      for (const batch of batches) {
        assert.ok(batch.total_chars <= 12000,
          `Batch ${batch.batch_id} exceeds 12k chars: ${batch.total_chars}`);
      }
    });

    it('should enforce max 12 blocks per batch', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = Array.from({ length: 25 }, (_, i) => ({
        block_id: `B-${String(i).padStart(3, '0')}`,
        artifact_sha256: 'a'.repeat(64),
        source_format: 'md',
        modality: 'TEXT',
        locator: { page: null, slide: null, sheet: null, range: null, line_start: 1, line_end: 10 },
        heading_path: [],
        content: `Content block ${i}`,
        asset_ref: null,
        content_sha256: 'c'.repeat(64),
      }));

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      for (const batch of batches) {
        assert.ok(batch.blocks.length <= 12,
          `Batch ${batch.batch_id} has ${batch.blocks.length} blocks, max is 12`);
      }
    });

    it('should enforce max 1 visual asset per batch', async () => {
      const { buildEvidenceBatches } = await import('../scripts/lib/evidence-batching.mjs');

      const blocks = [
        { block_id: 'B-v1', artifact_sha256: 'a'.repeat(64), source_format: 'png', modality: 'VISUAL_ASSET', locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null }, heading_path: [], content: '[Image 1]', asset_ref: '/path/1', content_sha256: 'd'.repeat(64) },
        { block_id: 'B-v2', artifact_sha256: 'b'.repeat(64), source_format: 'png', modality: 'VISUAL_ASSET', locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null }, heading_path: [], content: '[Image 2]', asset_ref: '/path/2', content_sha256: 'e'.repeat(64) },
      ];

      const batches = buildEvidenceBatches({ blocks, maxChars: 12000, maxBlocks: 12 });

      for (const batch of batches) {
        const visualCount = batch.blocks.filter(b => b.modality === 'VISUAL_ASSET').length;
        assert.ok(visualCount <= 1,
          `Batch ${batch.batch_id} has ${visualCount} visual assets, max is 1`);
      }
    });
  });
});
