/**
 * DrawingML 提取器测试
 *
 * 覆盖目标：
 * 1. 五类分类矩阵（inspectDrawingmlPackage + classifyXlsxContent）
 * 2. 形状/连接器精确提取与完整 Oracle
 * 3. 缺失连接与无效引用的真实降级
 * 4. 安全预算失败关闭（ZIP entry、解压大小、压缩比、XML 字符）
 * 5. 证据抽取（extractArtifactEvidence）TABLE + STRUCTURED_DIAGRAM
 * 6. 归一化（normalizeEvidenceToMarkdown）locator 保留
 * 7. 分批（buildEvidenceBatches）locator 保留与 Schema 验证
 * 8. 确定性：重复运行深度相等且序列化字节一致
 * 9. inspectInputs manifest 通过 Input Manifest Schema
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inspectDrawingmlPackage, extractDrawingml, DRAWINGML_BUDGET } from '../scripts/lib/drawingml-extractor.mjs';
import { classifyXlsxContent } from '../scripts/lib/input-classifier.mjs';
import { extractArtifactEvidence } from '../scripts/lib/source-evidence-extractor.mjs';
import { normalizeEvidenceToMarkdown } from '../scripts/lib/markdown-normalizer.mjs';
import { buildEvidenceBatches } from '../scripts/lib/evidence-batching.mjs';
import { validateEvidenceBatch } from '../scripts/lib/process-draft-contract.mjs';
import {
  createDrawingmlFlowFixture,
  createImageOnlyFixture,
  createSimpleTableFixture,
  createMissingConnectionFixture,
  createTableImageFixture,
  createInvalidReferenceFixture,
} from './helpers/drawingml-fixture-generator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('DrawingML 提取器', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // 五类分类矩阵（inspectDrawingmlPackage + classifyXlsxContent）
  // ─────────────────────────────────────────────────────────────────────────
  describe('五类分类矩阵', () => {
    it('纯表格 → ARCHITECTURE / STRUCTURED / [XLSX_TABLE]', async () => {
      const fixture = createSimpleTableFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const inspection = await inspectDrawingmlPackage(buffer);
      assert.equal(inspection.hasDrawingml, false);
      assert.equal(inspection.hasEditableShapes, false);
      assert.equal(inspection.hasRasterOnly, false);
      const classification = classifyXlsxContent({
        cell_count: 6,
        has_editable_shapes: inspection.hasEditableShapes,
        has_raster_only: inspection.hasRasterOnly,
      });
      assert.deepEqual(classification, {
        kind: 'ARCHITECTURE',
        parse_mode: 'STRUCTURED',
        capabilities: ['XLSX_TABLE'],
      });
    });

    it('纯原生图 → DIAGRAM / STRUCTURED / [DRAWINGML_STRUCTURE]', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const inspection = await inspectDrawingmlPackage(buffer);
      assert.equal(inspection.hasDrawingml, true);
      assert.equal(inspection.hasEditableShapes, true);
      assert.equal(inspection.hasRasterOnly, false);
      const classification = classifyXlsxContent({
        cell_count: 0,
        has_editable_shapes: inspection.hasEditableShapes,
        has_raster_only: inspection.hasRasterOnly,
      });
      assert.deepEqual(classification, {
        kind: 'DIAGRAM',
        parse_mode: 'STRUCTURED',
        capabilities: ['DRAWINGML_STRUCTURE'],
      });
    });

    it('表格+原生图 → MIXED / STRUCTURED / [XLSX_TABLE, DRAWINGML_STRUCTURE]', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const inspection = await inspectDrawingmlPackage(buffer);
      assert.equal(inspection.hasDrawingml, true);
      assert.equal(inspection.hasEditableShapes, true);
      const classification = classifyXlsxContent({
        cell_count: 2,
        has_editable_shapes: inspection.hasEditableShapes,
        has_raster_only: inspection.hasRasterOnly,
      });
      assert.deepEqual(classification, {
        kind: 'MIXED',
        parse_mode: 'STRUCTURED',
        capabilities: ['XLSX_TABLE', 'DRAWINGML_STRUCTURE'],
      });
    });

    it('纯图片 → DIAGRAM / VISUAL_ONLY / [VISUAL_ONLY]', async () => {
      const fixture = createImageOnlyFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const inspection = await inspectDrawingmlPackage(buffer);
      assert.equal(inspection.hasDrawingml, false);
      assert.equal(inspection.hasEditableShapes, false);
      assert.equal(inspection.hasRasterOnly, true);
      const classification = classifyXlsxContent({
        cell_count: 0,
        has_editable_shapes: inspection.hasEditableShapes,
        has_raster_only: inspection.hasRasterOnly,
      });
      assert.deepEqual(classification, {
        kind: 'DIAGRAM',
        parse_mode: 'VISUAL_ONLY',
        capabilities: ['VISUAL_ONLY'],
      });
    });

    it('表格+图片 → MIXED / SEMI_STRUCTURED / [XLSX_TABLE, VISUAL_ONLY]', async () => {
      const fixture = createTableImageFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const inspection = await inspectDrawingmlPackage(buffer);
      assert.equal(inspection.hasDrawingml, false);
      assert.equal(inspection.hasEditableShapes, false);
      assert.equal(inspection.hasRasterOnly, true);
      const classification = classifyXlsxContent({
        cell_count: 2,
        has_editable_shapes: inspection.hasEditableShapes,
        has_raster_only: inspection.hasRasterOnly,
      });
      assert.deepEqual(classification, {
        kind: 'MIXED',
        parse_mode: 'SEMI_STRUCTURED',
        capabilities: ['XLSX_TABLE', 'VISUAL_ONLY'],
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 形状与连接器提取
  // ─────────────────────────────────────────────────────────────────────────
  describe('形状与连接器提取', () => {
    it('应提取两个 shape 和一个 connector，带明确起止 ID', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      assert.equal(result.elements.length, 3);
      assert.equal(result.connectors.length, 1);
      assert.equal(result.connectors[0].source_ref, '1');
      assert.equal(result.connectors[0].target_ref, '2');
    });

    it('应支持 twoCellAnchor、oneCellAnchor 和 absoluteAnchor', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      const anchorTypes = result.elements.map(e => e.anchor_type).sort();
      assert.deepEqual(anchorTypes, ['absoluteAnchor', 'oneCellAnchor', 'twoCellAnchor']);
    });

    it('应提取完整 shape 属性：text、preset_geometry、fill_color、bounds', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      const shape1 = result.elements.find(e => e.shape_id === '1');
      assert.equal(shape1.shape_type, 'sp');
      assert.equal(shape1.shape_id, '1');
      assert.equal(shape1.name, 'Shape 1');
      assert.equal(shape1.text, '开始审核');
      assert.equal(shape1.preset_geometry, 'roundRect');
      assert.equal(shape1.fill_color, '4472C4');
      assert.equal(shape1.bounds.x, 0);
      assert.equal(shape1.bounds.y, 152400 / 914400);
      assert.equal(shape1.bounds.width, 1828800 / 914400);
      assert.equal(shape1.bounds.height, 914400 / 914400);
      assert.equal(shape1.anchor_type, 'twoCellAnchor');
      assert.equal(typeof shape1.sheet, 'string');
      assert.equal(shape1.drawing_part, 'xl/drawings/drawing1.xml');
    });

    it('应提取 connector 的完整连接点和箭头信息', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      const connector = result.connectors[0];
      assert.deepEqual(connector.start_connection, { shape_id: '1', connection_id: 1 });
      assert.deepEqual(connector.end_connection, { shape_id: '2', connection_id: 0 });
      assert.equal(connector.has_arrow, true);
      assert.equal(connector.arrow_type, 'arrow');
      assert.equal(connector.source_ref, '1');
      assert.equal(connector.target_ref, '2');
    });

    it('同一输入运行两次必须深度相等且序列化字节一致', async () => {
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result1 = await extractDrawingml(buffer);
      const result2 = await extractDrawingml(buffer);
      assert.deepEqual(result1, result2);
      assert.equal(JSON.stringify(result1), JSON.stringify(result2));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 连接关系安全
  // ─────────────────────────────────────────────────────────────────────────
  describe('连接关系安全', () => {
    it('缺失 stCxn 时 source_ref 应为 null 并产生 DRAWINGML_MISSING_CONNECTION warning', async () => {
      const fixture = createMissingConnectionFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      const connector = result.connectors[0];
      assert.equal(connector.source_ref, null);
      assert.equal(connector.target_ref, '1');
      const missingWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_MISSING_CONNECTION');
      assert.equal(missingWarnings.length, 1);
      assert.equal(missingWarnings[0].message, 'Connector 2 missing start connection (stCxn)');
    });

    it('引用不存在的 shape ID 时 target_ref 应为 null 并产生 DRAWINGML_INVALID_REF warning', async () => {
      const fixture = createInvalidReferenceFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      const connector = result.connectors[0];
      assert.equal(connector.source_ref, '1');
      assert.equal(connector.target_ref, null);
      const invalidWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_INVALID_REF');
      assert.equal(invalidWarnings.length, 1);
      assert.equal(invalidWarnings[0].message, 'Connector 2 references non-existent target shape 99');
    });

    it('图片 fixture 不应产生 editable shape 或 connector', async () => {
      const fixture = createImageOnlyFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      assert.equal(result.elements.length, 0);
      assert.equal(result.connectors.length, 0);
      assert.equal(result.pictures.length, 1);
      assert.equal(result.pictures[0].shape_id, '1');
      assert.equal(result.pictures[0].embed_ref, 'rId1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 安全预算
  // ─────────────────────────────────────────────────────────────────────────
  describe('安全预算', () => {
    it('应拒绝超过 ZIP 条目数限制的文件', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (let i = 0; i < 1001; i++) {
        zip.file(`test/file${i}.xml`, '<?xml version="1.0"?><root/>');
      }
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer),
        { message: /ZIP entry count exceeds limit/ }
      );
    });

    it('应拒绝超过解压大小限制的文件（通过 limits 注入小阈值）', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('test/big.xml', 'x'.repeat(200));
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_DECOMPRESSED_SIZE: 100 } }),
        { message: /decompressed size exceeds limit/ }
      );
    });

    it('压缩比检查逻辑可达（当 _data.compressedSize 可用时触发拒绝）', async () => {
      // JSZip 的 _data.compressedSize 不反映 ZIP 文件中的实际压缩大小，
      // 因此用正常 JSZip 创建的文件无法触发压缩比拒绝。
      // 此测试验证代码路径可达：直接构造带有异常 _data 的 ZIP 对象。
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('test/tiny.xml', '<root/>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });

      // 验证 extractDrawingml 对正常小文件不抛出
      const result = await extractDrawingml(buffer);
      assert.equal(Array.isArray(result.elements), true);

      // 验证压缩比检查在代码中存在：构造极端 limits 使 ratio > limit
      // 由于 JSZip._data.compressedSize == uncompressedSize, ratio = 1
      // 使用 MAX_COMPRESSION_RATIO = 0 来触发（任何 ratio > 0 都会拒绝）
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_COMPRESSION_RATIO: 0 } }),
        { message: /compression ratio exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的内容', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + 'x'.repeat(500001) + '</workbook>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', largeXml);
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('不应允许放宽安全限制', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('test/tiny.xml', '<root/>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_ZIP_ENTRIES: 99999 } }),
        { message: /Cannot loosen security limit MAX_ZIP_ENTRIES: 99999 > 1000/ }
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 证据抽取：TABLE + STRUCTURED_DIAGRAM
  // ─────────────────────────────────────────────────────────────────────────
  describe('证据抽取（extractArtifactEvidence）', () => {
    let tmpDir;
    let mixedXlsxPath;
    let tableXlsxPath;
    let imageXlsxPath;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'drawingml-test-'));

      const mixedFixture = createDrawingmlFlowFixture();
      const mixedBuffer = await mixedFixture.generateAsync({ type: 'nodebuffer' });
      mixedXlsxPath = join(tmpDir, 'mixed.xlsx');
      await writeFile(mixedXlsxPath, mixedBuffer);

      const tableFixture = createSimpleTableFixture();
      const tableBuffer = await tableFixture.generateAsync({ type: 'nodebuffer' });
      tableXlsxPath = join(tmpDir, 'table.xlsx');
      await writeFile(tableXlsxPath, tableBuffer);

      const imageFixture = createImageOnlyFixture();
      const imageBuffer = await imageFixture.generateAsync({ type: 'nodebuffer' });
      imageXlsxPath = join(tmpDir, 'image.xlsx');
      await writeFile(imageXlsxPath, imageBuffer);
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('混合 XLSX 应同时产生 TABLE 和 STRUCTURED_DIAGRAM 块', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      assert.equal(typeof result.artifact_sha256, 'string');
      assert.equal(result.artifact_sha256.length, 64);

      const tableBlocks = result.blocks.filter(b => b.modality === 'TABLE');
      const diagramBlocks = result.blocks.filter(b => b.modality === 'STRUCTURED_DIAGRAM');

      assert.equal(tableBlocks.length, 1);
      assert.equal(typeof tableBlocks[0].locator.sheet, 'string');

      // 3 个形状 + 1 个连接器 = 4 个 STRUCTURED_DIAGRAM 块
      assert.equal(diagramBlocks.length, 4);
    });

    it('纯图片 XLSX 不应产生 STRUCTURED_DIAGRAM 块', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: imageXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      const diagramBlocks = result.blocks.filter(b => b.modality === 'STRUCTURED_DIAGRAM');
      assert.equal(diagramBlocks.length, 0);
    });

    it('所有证据块应通过 Source Evidence Schema 必需字段验证', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      for (const block of result.blocks) {
        assert.equal(typeof block.block_id, 'string');
        assert.match(block.block_id, /^B-[a-zA-Z0-9_-]+$/);
        assert.equal(block.artifact_sha256, result.artifact_sha256);
        assert.equal(block.source_format, 'xlsx');
        assert.equal(typeof block.content, 'string');
        assert.equal(typeof block.content_sha256, 'string');
        assert.match(block.content_sha256, /^[a-f0-9]{64}$/);
        assert.equal(Array.isArray(block.heading_path), true);

        const loc = block.locator;
        assert.equal(typeof loc, 'object');
        assert.equal('page' in loc, true);
        assert.equal('slide' in loc, true);
        assert.equal('sheet' in loc, true);
        assert.equal('range' in loc, true);
        assert.equal('line_start' in loc, true);
        assert.equal('line_end' in loc, true);
      }
    });

    it('STRUCTURED_DIAGRAM 块的 locator 应精确包含 sheet、drawing_part、shape_id 或 connector_id、anchor_type', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      const diagramBlocks = result.blocks.filter(b => b.modality === 'STRUCTURED_DIAGRAM');
      for (const block of diagramBlocks) {
        assert.equal(typeof block.locator.sheet, 'string');
        assert.equal(block.locator.drawing_part, 'xl/drawings/drawing1.xml');
        assert.equal(typeof block.locator.anchor_type, 'string');
        const hasShape = block.locator.shape_id !== null;
        const hasConnector = block.locator.connector_id !== null;
        assert.equal(hasShape || hasConnector, true);
        assert.equal(hasShape && hasConnector, false);
      }
    });

    it('纯表格 XLSX 应只产生 TABLE 块', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: tableXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      const tableBlocks = result.blocks.filter(b => b.modality === 'TABLE');
      const diagramBlocks = result.blocks.filter(b => b.modality === 'STRUCTURED_DIAGRAM');
      assert.equal(tableBlocks.length, 1);
      assert.equal(diagramBlocks.length, 0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 归一化与 batching：locator 保留
  // ─────────────────────────────────────────────────────────────────────────
  describe('归一化与 batching', () => {
    let tmpDir;
    let mixedXlsxPath;
    let evidenceBlocks;
    let artifactSha256;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'drawingml-norm-test-'));

      const mixedFixture = createDrawingmlFlowFixture();
      const mixedBuffer = await mixedFixture.generateAsync({ type: 'nodebuffer' });
      mixedXlsxPath = join(tmpDir, 'mixed.xlsx');
      await writeFile(mixedXlsxPath, mixedBuffer);

      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      evidenceBlocks = result.blocks;
      artifactSha256 = result.artifact_sha256;
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('normalizeEvidenceToMarkdown 应保留 locator 原样（含 drawing_part、shape_id）', async () => {
      const normalized = await normalizeEvidenceToMarkdown({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        artifactSha256,
        blocks: evidenceBlocks,
        runDir: tmpDir,
        converterVersion: '1.0.0',
      });

      assert.equal(normalized.chunks.length, evidenceBlocks.length);

      // 验证 STRUCTURED_DIAGRAM 块的 locator 完整保留
      const diagramChunks = normalized.chunks.filter(c => c.modality === 'STRUCTURED_DIAGRAM');
      assert.equal(diagramChunks.length, 4);
      for (const chunk of diagramChunks) {
        assert.equal(typeof chunk.locator.sheet, 'string');
        assert.equal(chunk.locator.drawing_part, 'xl/drawings/drawing1.xml');
        assert.equal(typeof chunk.locator.anchor_type, 'string');
      }
    });

    it('buildEvidenceBatches 应保留 locator 并生成有效批次', async () => {
      const batches = buildEvidenceBatches({ blocks: evidenceBlocks });

      assert.notEqual(batches.length, 0);

      for (const batch of batches) {
        assert.match(batch.batch_id, /^EB-[a-zA-Z0-9_-]+$/);
        assert.match(batch.batch_sha256, /^[a-f0-9]{64}$/);
        assert.notEqual(batch.blocks.length, 0);
        assert.equal(batch.blocks.length <= 12, true);
        assert.equal(batch.total_chars >= 0, true);
        assert.equal(batch.total_chars <= 12000, true);
        assert.equal(Array.isArray(batch.modality_mix), true);
        assert.equal(batch.status, 'PENDING');
        assert.equal(typeof batch.context_budget, 'object');
        assert.equal(Array.isArray(batch.markdown_refs), true);

        // 验证每个块的 locator 保留
        for (const block of batch.blocks) {
          if (block.modality === 'STRUCTURED_DIAGRAM') {
            assert.equal(typeof block.locator.sheet, 'string');
            assert.equal(block.locator.drawing_part, 'xl/drawings/drawing1.xml');
          }
        }
      }

      // 验证所有原始块都被包含在某个批次中
      const allBatchBlockIds = batches.flatMap(b => b.blocks.map(bl => bl.block_id));
      for (const block of evidenceBlocks) {
        assert.equal(allBatchBlockIds.includes(block.block_id), true, `Block ${block.block_id} missing from batches`);
      }
    });

    it('evidence batch 应通过合同验证', async () => {
      const batches = buildEvidenceBatches({ blocks: evidenceBlocks });
      for (const batch of batches) {
        const validation = await validateEvidenceBatch(batch);
        assert.equal(validation.valid, true, `Batch validation failed: ${JSON.stringify(validation.errors)}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 输入检查 manifest（inspectInputs）
  // ─────────────────────────────────────────────────────────────────────────
  describe('inspectInputs manifest', () => {
    let tmpDir;
    let mixedXlsxPath;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'drawingml-manifest-test-'));
      const mixedFixture = createDrawingmlFlowFixture();
      const mixedBuffer = await mixedFixture.generateAsync({ type: 'nodebuffer' });
      mixedXlsxPath = join(tmpDir, 'mixed.xlsx');
      await writeFile(mixedXlsxPath, mixedBuffer);
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('inspectInputs 应为混合 XLSX 生成符合 Input Manifest Schema 的 manifest', async () => {
      const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
      const manifest = await inspectInputs({
        inputs: [mixedXlsxPath],
        runDir: tmpDir,
      });

      assert.equal(manifest.schema_version, '1.0.0');
      assert.equal(typeof manifest.run_id, 'string');
      assert.equal(Array.isArray(manifest.artifacts), true);
      assert.equal(Array.isArray(manifest.warnings), true);
      assert.equal(manifest.artifacts.length, 1);

      const artifact = manifest.artifacts[0];
      assert.equal(artifact.file_path, mixedXlsxPath);
      assert.equal(typeof artifact.sha256, 'string');
      assert.equal(artifact.sha256.length, 64);
      assert.equal(typeof artifact.size_bytes, 'number');
      assert.equal(artifact.format, 'xlsx');

      // 混合 XLSX 的分类结果
      assert.equal(artifact.kind, 'MIXED');
      assert.equal(artifact.parse_mode, 'STRUCTURED');
      assert.deepEqual(artifact.capabilities, ['XLSX_TABLE', 'DRAWINGML_STRUCTURE']);
      assert.equal(typeof artifact.confidence, 'number');
      assert.equal(artifact.confidence >= 0 && artifact.confidence <= 1, true);
    });
  });
});
