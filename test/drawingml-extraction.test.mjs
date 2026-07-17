/**
 * DrawingML 提取器测试
 *
 * 覆盖目标：
 * A. 五类正式入口矩阵（inspectInputs 正式入口，不得以 classifyXlsxContent 代替）
 * B. 确定性公开 fixtures（SHA-256 锁定 + Buffer.equals 验证）
 * C. 关系安全与唯一性（TargetMode、重复 ID、路径逃逸、损坏 XML）
 * D. 安全预算（XML 字符限流贯穿所有 XML part）
 * E. 证据抽取、归一化、batch 完整 Oracle（validateEvidenceBlock/Index、精确 locator）
 * F. classifyXlsxContent 纯函数单测（保留，但不再作为正式入口矩阵）
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { inspectDrawingmlPackage, extractDrawingml, DRAWINGML_BUDGET } from '../scripts/lib/drawingml-extractor.mjs';
import { classifyXlsxContent } from '../scripts/lib/input-classifier.mjs';
import { extractArtifactEvidence } from '../scripts/lib/source-evidence-extractor.mjs';
import { normalizeEvidenceToMarkdown } from '../scripts/lib/markdown-normalizer.mjs';
import { buildEvidenceBatches } from '../scripts/lib/evidence-batching.mjs';
import { validateEvidenceBatch, validateEvidenceBlock, validateEvidenceIndex } from '../scripts/lib/process-draft-contract.mjs';
import { validateContract } from '../scripts/lib/contract-validation.mjs';
import {
  createDrawingmlFlowFixture,
  createDrawingmlOnlyFixture,
  createImageOnlyFixture,
  createSimpleTableFixture,
  createMissingConnectionFixture,
  createTableImageFixture,
  createInvalidReferenceFixture,
  createExternalTargetFixture,
  createDuplicateRelationshipIdFixture,
  createAbsoluteTargetFixture,
  createWindowsPathSeparatorFixture,
  createPathEscapeFixture,
  createCorruptedDrawingFixture,
  createMissingDrawingRelFixture,
  createAmbiguousDrawingFixture,
  createExternalWorkbookTargetFixture,
} from './helpers/drawingml-fixture-generator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// 已提交 fixture 文件的 SHA-256（STORE 压缩，确定性生成）
const COMMITTED_FIXTURE_SHAS = {
  'drawingml-flow.xlsx': '0a608736fbc2bd10d55804b16eb2748e5ed167e47714fee9877c17e17607161a',
  'drawingml-only-flow.xlsx': '704a84ee77ee4e688fab517f84646d3f122e7aa1d56f88186bb951f1808ba5cc',
  'image-only-flow.xlsx': 'ce235aaba835e0f1651ed14eea2456c916f594d5aed8f4c6341d5d17a2e49236',
  'table-image-flow.xlsx': 'bcab821c9804b316975994c08ca9be637e1e056cc2a35db602cffda34af2d3af',
};

describe('DrawingML 提取器', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 B：确定性公开 fixtures
  // ═══════════════════════════════════════════════════════════════════════════
  describe('确定性 fixtures', () => {
    it('同一生成器连续两次生成必须 Buffer.equals（DEFLATE，进程内确定性）', async () => {
      const generators = [
        { name: 'drawingml-flow', fn: createDrawingmlFlowFixture },
        { name: 'drawingml-only-flow', fn: createDrawingmlOnlyFixture },
        { name: 'image-only-flow', fn: createImageOnlyFixture },
        { name: 'table-image-flow', fn: createTableImageFixture },
      ];

      for (const { name, fn } of generators) {
        const buf1 = await fn().generateAsync({ type: 'nodebuffer' });
        const buf2 = await fn().generateAsync({ type: 'nodebuffer' });
        assert.equal(buf1.equals(buf2), true, `${name}: Buffer.equals failed (DEFLATE)`);
      }
    });

    it('同一生成器连续两次生成必须 Buffer.equals（STORE，跨进程确定性）', async () => {
      const generators = [
        { name: 'drawingml-flow', fn: createDrawingmlFlowFixture },
        { name: 'drawingml-only-flow', fn: createDrawingmlOnlyFixture },
        { name: 'image-only-flow', fn: createImageOnlyFixture },
        { name: 'table-image-flow', fn: createTableImageFixture },
      ];

      for (const { name, fn } of generators) {
        const buf1 = await fn().generateAsync({ type: 'nodebuffer', compression: 'STORE' });
        const buf2 = await fn().generateAsync({ type: 'nodebuffer', compression: 'STORE' });
        assert.equal(buf1.equals(buf2), true, `${name}: Buffer.equals failed (STORE)`);
      }
    });

    it('已提交的四个 XLSX fixture 的 SHA-256 必须与生成器一致', async () => {
      const generators = [
        { name: 'drawingml-flow.xlsx', fn: createDrawingmlFlowFixture },
        { name: 'drawingml-only-flow.xlsx', fn: createDrawingmlOnlyFixture },
        { name: 'image-only-flow.xlsx', fn: createImageOnlyFixture },
        { name: 'table-image-flow.xlsx', fn: createTableImageFixture },
      ];

      for (const { name, fn } of generators) {
        const fixturePath = join(__dirname, 'fixtures', 'inputs', name);
        const committed = await readFile(fixturePath);
        const committedSha = createHash('sha256').update(committed).digest('hex');
        assert.equal(committedSha, COMMITTED_FIXTURE_SHAS[name],
          `${name}: committed SHA-256 mismatch`);

        // 生成器输出（STORE）必须与已提交 bytes 一致
        const generated = await fn().generateAsync({ type: 'nodebuffer', compression: 'STORE' });
        assert.equal(generated.equals(committed), true, `${name}: generator output differs from committed`);
      }
    });

    it('四个已提交 fixture 必须能被 inspectInputs 正式读取', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'fixture-verify-'));
      try {
        const names = ['drawingml-flow.xlsx', 'drawingml-only-flow.xlsx', 'image-only-flow.xlsx', 'table-image-flow.xlsx'];
        const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
        for (const name of names) {
          const fixturePath = join(__dirname, 'fixtures', 'inputs', name);
          const manifest = await inspectInputs({ inputs: [fixturePath], runDir: tmpDir });
          assert.equal(manifest.artifacts.length, 1, `${name}: should produce 1 artifact`);
          assert.equal(manifest.artifacts[0].format, 'xlsx', `${name}: format should be xlsx`);
          assert.notEqual(manifest.artifacts[0].kind, 'UNKNOWN', `${name}: kind should not be UNKNOWN`);
        }
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 A：正式入口五类矩阵（inspectInputs 正式入口）
  // ═══════════════════════════════════════════════════════════════════════════
  describe('正式入口五类矩阵（inspectInputs）', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'drawingml-formal-matrix-'));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('纯表格 → ARCHITECTURE / STRUCTURED / 0.85 / [XLSX_TABLE] / null', async () => {
      const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
      const fixture = createSimpleTableFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const filePath = join(tmpDir, 'table-only.xlsx');
      await writeFile(filePath, buffer);

      const manifest = await inspectInputs({ inputs: [filePath], runDir: tmpDir });
      assert.equal(manifest.artifacts.length, 1);
      const a = manifest.artifacts[0];
      assert.equal(a.kind, 'ARCHITECTURE');
      assert.equal(a.format, 'xlsx');
      assert.equal(a.parse_mode, 'STRUCTURED');
      assert.equal(a.confidence, 0.85);
      assert.deepEqual(a.capabilities, ['XLSX_TABLE']);
      assert.equal(a.degradation_reason, null);
      assert.equal(typeof a.sha256, 'string');
      assert.equal(a.sha256.length, 64);
      assert.equal(typeof a.size_bytes, 'number');
      assert.equal(a.size_bytes > 0, true);

      // 调用正式 Schema 验证
      const result = validateContract('input-manifest', manifest);
      assert.deepEqual(result, { valid: true, errors: null }, '纯表格 manifest should be valid');
    });

    it('纯原生图 → DIAGRAM / STRUCTURED / 0.9 / [DRAWINGML_STRUCTURE] / null', async () => {
      const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
      const fixture = createDrawingmlOnlyFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const filePath = join(tmpDir, 'drawingml-only.xlsx');
      await writeFile(filePath, buffer);

      const manifest = await inspectInputs({ inputs: [filePath], runDir: tmpDir });
      const a = manifest.artifacts[0];
      assert.equal(a.kind, 'DIAGRAM');
      assert.equal(a.format, 'xlsx');
      assert.equal(a.parse_mode, 'STRUCTURED');
      assert.equal(a.confidence, 0.9);
      assert.deepEqual(a.capabilities, ['DRAWINGML_STRUCTURE']);
      assert.equal(a.degradation_reason, null);

      // 调用正式 Schema 验证
      const result = validateContract('input-manifest', manifest);
      assert.deepEqual(result, { valid: true, errors: null }, '纯原生图 manifest should be valid');
    });

    it('表格+原生图 → MIXED / STRUCTURED / 0.9 / [XLSX_TABLE,DRAWINGML_STRUCTURE] / null', async () => {
      const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
      const fixture = createDrawingmlFlowFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const filePath = join(tmpDir, 'mixed.xlsx');
      await writeFile(filePath, buffer);

      const manifest = await inspectInputs({ inputs: [filePath], runDir: tmpDir });
      const a = manifest.artifacts[0];
      assert.equal(a.kind, 'MIXED');
      assert.equal(a.format, 'xlsx');
      assert.equal(a.parse_mode, 'STRUCTURED');
      assert.equal(a.confidence, 0.9);
      assert.deepEqual(a.capabilities, ['XLSX_TABLE', 'DRAWINGML_STRUCTURE']);
      assert.equal(a.degradation_reason, null);

      // 调用正式 Schema 验证
      const result = validateContract('input-manifest', manifest);
      assert.deepEqual(result, { valid: true, errors: null }, '表格+原生图 manifest should be valid');
    });

    it('纯图片 → DIAGRAM / VISUAL_ONLY / 0.5 / [VISUAL_ONLY] / 固定降级原因', async () => {
      const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
      const fixture = createImageOnlyFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const filePath = join(tmpDir, 'image-only.xlsx');
      await writeFile(filePath, buffer);

      const manifest = await inspectInputs({ inputs: [filePath], runDir: tmpDir });
      const a = manifest.artifacts[0];
      assert.equal(a.kind, 'DIAGRAM');
      assert.equal(a.format, 'xlsx');
      assert.equal(a.parse_mode, 'VISUAL_ONLY');
      assert.equal(a.confidence, 0.5);
      assert.deepEqual(a.capabilities, ['VISUAL_ONLY']);

      // 精确断言降级原因
      const expectedDegradation = 'XLSX contains only raster images, no editable shapes';
      assert.equal(a.degradation_reason, expectedDegradation, '纯图片 degradation_reason should be fixed');

      // 调用正式 Schema 验证
      const result = validateContract('input-manifest', manifest);
      assert.deepEqual(result, { valid: true, errors: null }, '纯图片 manifest should be valid');
    });

    it('表格+图片 → MIXED / SEMI_STRUCTURED / 0.5 / [XLSX_TABLE,VISUAL_ONLY] / 固定降级原因', async () => {
      const { inspectInputs } = await import('../scripts/inspect-inputs.mjs');
      const fixture = createTableImageFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const filePath = join(tmpDir, 'table-image.xlsx');
      await writeFile(filePath, buffer);

      const manifest = await inspectInputs({ inputs: [filePath], runDir: tmpDir });
      const a = manifest.artifacts[0];
      assert.equal(a.kind, 'MIXED');
      assert.equal(a.format, 'xlsx');
      assert.equal(a.parse_mode, 'SEMI_STRUCTURED');
      assert.equal(a.confidence, 0.5);
      assert.deepEqual(a.capabilities, ['XLSX_TABLE', 'VISUAL_ONLY']);

      // 精确断言降级原因
      const expectedDegradation = 'XLSX contains only raster images, no editable shapes';
      assert.equal(a.degradation_reason, expectedDegradation, '表格+图片 degradation_reason should be fixed');

      // 调用正式 Schema 验证
      const result = validateContract('input-manifest', manifest);
      assert.deepEqual(result, { valid: true, errors: null }, '表格+图片 manifest should be valid');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 F（保留）：classifyXlsxContent 纯函数单测（不再是正式入口矩阵）
  // ═══════════════════════════════════════════════════════════════════════════
  describe('classifyXlsxContent 纯函数', () => {
    it('纯表格 → ARCHITECTURE / STRUCTURED / [XLSX_TABLE]', () => {
      const classification = classifyXlsxContent({
        cell_count: 6,
        has_editable_shapes: false,
        has_raster_only: false,
      });
      assert.deepEqual(classification, {
        kind: 'ARCHITECTURE',
        parse_mode: 'STRUCTURED',
        capabilities: ['XLSX_TABLE'],
      });
    });

    it('纯原生图 → DIAGRAM / STRUCTURED / [DRAWINGML_STRUCTURE]', () => {
      const classification = classifyXlsxContent({
        cell_count: 0,
        has_editable_shapes: true,
        has_raster_only: false,
      });
      assert.deepEqual(classification, {
        kind: 'DIAGRAM',
        parse_mode: 'STRUCTURED',
        capabilities: ['DRAWINGML_STRUCTURE'],
      });
    });

    it('表格+原生图 → MIXED / STRUCTURED / [XLSX_TABLE, DRAWINGML_STRUCTURE]', () => {
      const classification = classifyXlsxContent({
        cell_count: 2,
        has_editable_shapes: true,
        has_raster_only: false,
      });
      assert.deepEqual(classification, {
        kind: 'MIXED',
        parse_mode: 'STRUCTURED',
        capabilities: ['XLSX_TABLE', 'DRAWINGML_STRUCTURE'],
      });
    });

    it('纯图片 → DIAGRAM / VISUAL_ONLY / [VISUAL_ONLY]', () => {
      const classification = classifyXlsxContent({
        cell_count: 0,
        has_editable_shapes: false,
        has_raster_only: true,
      });
      assert.deepEqual(classification, {
        kind: 'DIAGRAM',
        parse_mode: 'VISUAL_ONLY',
        capabilities: ['VISUAL_ONLY'],
      });
    });

    it('表格+图片 → MIXED / SEMI_STRUCTURED / [XLSX_TABLE, VISUAL_ONLY]', () => {
      const classification = classifyXlsxContent({
        cell_count: 2,
        has_editable_shapes: false,
        has_raster_only: true,
      });
      assert.deepEqual(classification, {
        kind: 'MIXED',
        parse_mode: 'SEMI_STRUCTURED',
        capabilities: ['XLSX_TABLE', 'VISUAL_ONLY'],
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 形状与连接器提取
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 C：连接关系安全与唯一性
  // ═══════════════════════════════════════════════════════════════════════════
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

    // ─── 修复 C 扩展测试 ─────────────────────────────────────────────────

    it('External TargetMode 的 drawing relationship 必须被拒绝', async () => {
      const fixture = createExternalTargetFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await inspectDrawingmlPackage(buffer);
      // External target 被拒绝 → 无法解析 drawing → 形状不被检测
      assert.equal(result.hasDrawingml, false);
      assert.equal(result.hasEditableShapes, false);
      const extWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_EXTERNAL_TARGET');
      assert.equal(extWarnings.length, 1, 'Should have exactly 1 DRAWINGML_EXTERNAL_TARGET warning');
      assert.deepEqual(extWarnings[0], {
        code: 'DRAWINGML_EXTERNAL_TARGET',
        message: 'Relationship rId1 in xl/worksheets/_rels/sheet1.xml.rels has External TargetMode, rejected',
        target: 'rId1',
      });
    });

    it('重复 relationship ID 必须 fail-closed 抛出错误', async () => {
      const fixture = createDuplicateRelationshipIdFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => inspectDrawingmlPackage(buffer),
        { message: /Duplicate relationship ID "rId1"/ }
      );
    });

    it('绝对 Target 路径（以 / 开头）必须被拒绝', async () => {
      const fixture = createAbsoluteTargetFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await inspectDrawingmlPackage(buffer);
      assert.equal(result.hasDrawingml, false);
      // 绝对路径被 isSafeTarget 拒绝
      const sheetsWithDrawing = result.sheets.filter(s => s.has_drawing);
      assert.equal(sheetsWithDrawing.length, 0);
    });

    it('Windows 路径分隔符必须被拒绝', async () => {
      const fixture = createWindowsPathSeparatorFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await inspectDrawingmlPackage(buffer);
      assert.equal(result.hasDrawingml, false);
    });

    it('../逃逸 xl/ 根目录的 Target 必须被拒绝', async () => {
      const fixture = createPathEscapeFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await inspectDrawingmlPackage(buffer);
      assert.equal(result.hasDrawingml, false);
      const escapeWarnings = result.warnings.filter(w =>
        w.code === 'DRAWINGML_PATH_ESCAPE' || w.code === 'DRAWINGML_UNSAFE_TARGET'
      );
      assert.equal(escapeWarnings.length, 1, 'Should have exactly 1 path escape/unsafe target warning');
      assert.deepEqual(escapeWarnings[0], {
        code: 'DRAWINGML_PATH_ESCAPE',
        message: 'Relationship rId1 target "../../etc/drawing.xml" escapes xl/ root after normalization',
        target: 'rId1',
      });
    });

    it('损坏的 drawing XML 必须产生稳定结果（空元素，无崩溃）', async () => {
      const fixture = createCorruptedDrawingFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      // fast-xml-parser 对损坏 XML 静默返回空结果，不得崩溃
      const result = await extractDrawingml(buffer);
      assert.equal(result.elements.length, 0);
      assert.equal(result.connectors.length, 0);
      assert.equal(result.pictures.length, 0);
    });

    it('缺失 drawing relationship 应产生 MISSING_DRAWING_REL warning', async () => {
      const fixture = createMissingDrawingRelFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      const missingWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_MISSING_DRAWING_REL');
      assert.equal(missingWarnings.length, 1, 'Should have exactly 1 DRAWINGML_MISSING_DRAWING_REL warning');
      assert.deepEqual(missingWarnings[0], {
        code: 'DRAWINGML_MISSING_DRAWING_REL',
        message: 'No drawing relationship found for ref rId1 in xl/worksheets/_rels/sheet1.xml.rels',
        target: 'rId1',
      });
    });

    it('多 drawing 引用必须产生 AMBIGUOUS_DRAWING_REL warning 并拒绝解析', async () => {
      const fixture = createAmbiguousDrawingFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await inspectDrawingmlPackage(buffer);

      // 多 drawing 歧义：不解析任一 drawing
      assert.equal(result.hasDrawingml, false);
      assert.equal(result.hasEditableShapes, false);
      assert.equal(result.sheets.length, 1);
      assert.equal(result.sheets[0].has_drawing, false);

      // 必须产生稳定的 warning
      const ambiguousWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_AMBIGUOUS_DRAWING_REL');
      assert.equal(ambiguousWarnings.length, 1, 'Should have exactly 1 DRAWINGML_AMBIGUOUS_DRAWING_REL warning');
      assert.deepEqual(ambiguousWarnings[0], {
        code: 'DRAWINGML_AMBIGUOUS_DRAWING_REL',
        message: 'Sheet has multiple drawing references, ambiguous which to parse',
        target: 'rId1,rId2',
      });
    });

    it('External TargetMode 的 workbook relationship 必须被过滤', async () => {
      const fixture = createExternalWorkbookTargetFixture();
      const buffer = await fixture.generateAsync({ type: 'nodebuffer' });
      const result = await inspectDrawingmlPackage(buffer);
      // External workbook rel 被过滤 → 无 sheet 被解析
      assert.equal(result.sheets.length, 0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 D：安全预算（XML 字符限流贯穿所有 XML part）
  // ═══════════════════════════════════════════════════════════════════════════
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
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('test/tiny.xml', '<root/>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await extractDrawingml(buffer);
      assert.equal(Array.isArray(result.elements), true);

      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_COMPRESSION_RATIO: 0 } }),
        { message: /compression ratio exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 workbook.xml（收紧阈值注入）', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + 'x'.repeat(1500) + '</workbook>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', largeXml);
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_XML_CHARACTERS: 1000 } }),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超大的 worksheet.xml（收紧阈值注入）', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeSheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + 'x'.repeat(1500) + '</sheetData></worksheet>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      zip.file('xl/worksheets/sheet1.xml', largeSheet);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_XML_CHARACTERS: 1000 } }),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 workbook.xml.rels（收紧阈值注入）', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + 'x'.repeat(1500) + '</Relationships>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', largeRels);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_XML_CHARACTERS: 1000 } }),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 sheet1.xml.rels（收紧阈值注入）', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeSheetRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + 'x'.repeat(1500) + '</Relationships>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData></sheetData><drawing r:id="rId1"/></worksheet>');
      zip.file('xl/worksheets/_rels/sheet1.xml.rels', largeSheetRels);
      zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"></xdr:wsDr>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer, { limits: { MAX_XML_CHARACTERS: 1000 } }),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 drawing1.xml（收紧阈值注入）', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeDrawing = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + 'x'.repeat(1500) + '</xdr:wsDr>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData></sheetData><drawing r:id="rId1"/></worksheet>');
      zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
      zip.file('xl/drawings/drawing1.xml', largeDrawing);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer, { limits: { MAX_XML_CHARACTERS: 1000 } });
      const corruptedWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_CORRUPTED_XML');
      assert.equal(corruptedWarnings.length, 1);
      assert.deepEqual(corruptedWarnings[0], {
        code: 'DRAWINGML_CORRUPTED_XML',
        message: 'Failed to parse drawing XML in xl/drawings/drawing1.xml: XML safety validation failed for xl/drawings/drawing1.xml: XML xl/drawings/drawing1.xml character count exceeds limit: 1799 > 1000',
        target: 'xl/drawings/drawing1.xml',
      });
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 E：证据抽取 + validateEvidenceBlock/Index + 完整 Oracle
  // ═══════════════════════════════════════════════════════════════════════════
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

    it('混合 XLSX 应同时产生 TABLE 和 STRUCTURED_DIAGRAM 块（1 TABLE + 3 shape + 1 connector = 5 blocks）', async () => {
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

      // 修复 E：精确确认 1 TABLE + 3 shape + 1 connector
      const shapeBlocks = diagramBlocks.filter(b => b.locator.shape_id !== null && b.locator.connector_id === null);
      const connectorBlocks = diagramBlocks.filter(b => b.locator.connector_id !== null);
      assert.equal(tableBlocks.length, 1);
      assert.equal(shapeBlocks.length, 3);
      assert.equal(connectorBlocks.length, 1);
    });

    it('纯图片 XLSX 不应产生 STRUCTURED_DIAGRAM 块', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: imageXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });
      const diagramBlocks = result.blocks.filter(b => b.modality === 'STRUCTURED_DIAGRAM');
      assert.equal(diagramBlocks.length, 0);

      // 修复 E：精确断言 modality 列表（纯图片 XLSX 只有 VISUAL_ASSET 块，无 STRUCTURED_DIAGRAM）
      const modalities = [...new Set(result.blocks.map(b => b.modality))].sort();
      assert.equal(diagramBlocks.length, 0, 'No STRUCTURED_DIAGRAM blocks for image-only');
      assert.deepEqual(modalities, ['VISUAL_ASSET'], 'Should only have VISUAL_ASSET modality');
    });

    it('图片 anchor 应产生 VISUAL_ASSET block（完整固定投影 deepEqual）', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: imageXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });

      // 图片-only fixture 确定只有 1 个 picture → 精确 1 个 block
      assert.equal(result.blocks.length, 1);

      const { block_id, ...blockRest } = result.blocks[0];
      assert.match(block_id, /^B-[a-zA-Z0-9_-]+$/);
      assert.deepEqual(blockRest, {
        artifact_sha256: 'ce235aaba835e0f1651ed14eea2456c916f594d5aed8f4c6341d5d17a2e49236',
        source_format: 'xlsx',
        modality: 'VISUAL_ASSET',
        locator: {
          page: null,
          slide: null,
          sheet: 'sheet1',
          range: null,
          line_start: null,
          line_end: null,
          drawing_part: 'xl/drawings/drawing1.xml',
          shape_id: '1',
          connector_id: null,
          anchor_type: 'absoluteAnchor',
        },
        heading_path: ['sheet1', 'Image 1'],
        content: '{"shape_type":"pic","shape_id":"1","name":"Image 1","embed_ref":"rId1","bounds":{"x":0,"y":0,"width":6,"height":3.5},"anchor_type":"absoluteAnchor","sheet":"sheet1","drawing_part":"xl/drawings/drawing1.xml"}',
        asset_ref: 'rId1',
        content_sha256: 'd3ffb87f053be49b473533b8d91f256e129b8476b94af75bc8ecb45ecf103a4e',
      });
    });

    it('所有证据块应通过 validateEvidenceBlock Schema 验证', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });

      // 调用正式 validateEvidenceBlock，不得手工模拟
      for (const block of result.blocks) {
        const validation = await validateEvidenceBlock(block);
        assert.deepEqual(validation, { valid: true },
          `Block ${block.block_id} failed schema: ${JSON.stringify(validation.errors)}`);
      }

      // 调用 validateEvidenceIndex
      const indexValidation = await validateEvidenceIndex(result.blocks);
      assert.deepEqual(indexValidation, { valid: true },
        `Index validation failed: ${JSON.stringify(indexValidation.errors)}`);
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
        // 精确断言：shape_id 和 connector_id 互斥
        const hasShape = block.locator.shape_id !== null;
        const hasConnector = block.locator.connector_id !== null;
        assert.equal(hasShape, !hasConnector, `Block ${block.block_id}: shape_id and connector_id should be mutually exclusive`);
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

    it('混合 fixture 的 evidence blocks 完整固定投影整体 deepEqual', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });

      const MIXED_SHA = '0a608736fbc2bd10d55804b16eb2748e5ed167e47714fee9877c17e17607161a';

      // 按 block_id 排序，逐个 strip block_id（动态值），对其余字段整体 deepEqual
      const sorted = [...result.blocks].sort((a, b) => a.block_id.localeCompare(b.block_id));
      for (const block of sorted) {
        assert.match(block.block_id, /^B-[a-zA-Z0-9_-]+$/);
      }

      const projections = sorted.map(({ block_id, ...rest }) => rest);
      assert.deepEqual(projections, [
        {
          artifact_sha256: MIXED_SHA,
          source_format: 'xlsx',
          modality: 'STRUCTURED_DIAGRAM',
          locator: {
            page: null, slide: null, sheet: 'sheet1', range: null,
            line_start: null, line_end: null,
            drawing_part: 'xl/drawings/drawing1.xml',
            shape_id: '2', connector_id: null, anchor_type: 'oneCellAnchor',
          },
          heading_path: ['sheet1', 'Shape 2'],
          content: '{"shape_type":"sp","shape_id":"2","name":"Shape 2","text":"决策","preset_geometry":"diamond","fill_color":"ED7D31","bounds":{"x":4,"y":0.16666666666666666,"width":2,"height":1},"anchor_type":"oneCellAnchor","sheet":"sheet1","drawing_part":"xl/drawings/drawing1.xml"}',
          asset_ref: null,
          content_sha256: '617739e875f8879aae9e1829f887be4ddca1e6d259d4099de26d50a040bf6999',
        },
        {
          artifact_sha256: MIXED_SHA,
          source_format: 'xlsx',
          modality: 'STRUCTURED_DIAGRAM',
          locator: {
            page: null, slide: null, sheet: 'sheet1', range: null,
            line_start: null, line_end: null,
            drawing_part: 'xl/drawings/drawing1.xml',
            shape_id: '1', connector_id: null, anchor_type: 'twoCellAnchor',
          },
          heading_path: ['sheet1', 'Shape 1'],
          content: '{"shape_type":"sp","shape_id":"1","name":"Shape 1","text":"开始审核","preset_geometry":"roundRect","fill_color":"4472C4","bounds":{"x":0,"y":0.16666666666666666,"width":2,"height":1},"anchor_type":"twoCellAnchor","sheet":"sheet1","drawing_part":"xl/drawings/drawing1.xml"}',
          asset_ref: null,
          content_sha256: 'b6992084c23bd6d978c853a1f4593515edd07f4ec6c388801927eb4e3c10b86a',
        },
        {
          artifact_sha256: MIXED_SHA,
          source_format: 'xlsx',
          modality: 'STRUCTURED_DIAGRAM',
          locator: {
            page: null, slide: null, sheet: 'sheet1', range: null,
            line_start: null, line_end: null,
            drawing_part: 'xl/drawings/drawing1.xml',
            shape_id: '4', connector_id: null, anchor_type: 'absoluteAnchor',
          },
          heading_path: ['sheet1', 'Shape 3'],
          content: '{"shape_type":"sp","shape_id":"4","name":"Shape 3","text":"结束","preset_geometry":"rect","fill_color":"70AD47","bounds":{"x":6,"y":0.16666666666666666,"width":2,"height":1},"anchor_type":"absoluteAnchor","sheet":"sheet1","drawing_part":"xl/drawings/drawing1.xml"}',
          asset_ref: null,
          content_sha256: '01a50adc80a4534d1e5d2552169c4a5fba9ca07091ae7a02f8895dea38ce3ead',
        },
        {
          artifact_sha256: MIXED_SHA,
          source_format: 'xlsx',
          modality: 'STRUCTURED_DIAGRAM',
          locator: {
            page: null, slide: null, sheet: 'sheet1', range: null,
            line_start: null, line_end: null,
            drawing_part: 'xl/drawings/drawing1.xml',
            shape_id: null, connector_id: '3', anchor_type: 'twoCellAnchor',
          },
          heading_path: ['sheet1', 'Connector 1'],
          content: '{"shape_type":"cxnSp","shape_id":"3","name":"Connector 1","preset_geometry":"straightConnector1","bounds":{"x":2,"y":0.3333333333333333,"width":2,"height":0},"source_ref":"1","target_ref":"2","start_connection":{"shape_id":"1","connection_id":1},"end_connection":{"shape_id":"2","connection_id":0},"has_arrow":true,"arrow_type":"arrow","anchor_type":"twoCellAnchor","sheet":"sheet1","drawing_part":"xl/drawings/drawing1.xml","connector_id":"3"}',
          asset_ref: null,
          content_sha256: '04ecb23ea08cc8ab804df10c818bebb1f8733e5618c60c668c5ba1b89750fe77',
        },
        {
          artifact_sha256: MIXED_SHA,
          source_format: 'xlsx',
          modality: 'TABLE',
          locator: {
            page: null, slide: null, sheet: 'Sheet1', range: 'A1:B2',
            line_start: null, line_end: null,
            drawing_part: null,
            shape_id: null, connector_id: null, anchor_type: null,
          },
          heading_path: ['Sheet1'],
          content: '活动名称\t负责人\n审核采购申请\t采购经理',
          asset_ref: null,
          content_sha256: '47549cbea572d039d0beb9b777f894ea46bed02f2fca16a26aab6c2ac968f806',
        },
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 修复 E：归一化与 batching（精确 Oracle + validateEvidenceBatch）
  // ═══════════════════════════════════════════════════════════════════════════
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

    it('normalizeEvidenceToMarkdown 应保留所有 locator 原样（完整固定投影 deepEqual + .md chunk frontmatter 对比）', async () => {
      const normalized = await normalizeEvidenceToMarkdown({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        artifactSha256,
        blocks: evidenceBlocks,
        runDir: tmpDir,
        converterVersion: '1.0.0',
      });

      assert.equal(normalized.chunks.length, evidenceBlocks.length);

      // 五个 chunk 的 locator 完整固定数组 deepEqual（按 chunk_id 排序，匹配 block_id 排序）
      const sortedChunks = [...normalized.chunks].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));
      const allLocators = sortedChunks.map(c => c.locator);
      assert.deepEqual(allLocators, [
        { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: '1', connector_id: null, anchor_type: 'twoCellAnchor' },
        { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: '2', connector_id: null, anchor_type: 'oneCellAnchor' },
        { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: null, connector_id: '3', anchor_type: 'twoCellAnchor' },
        { page: null, slide: null, sheet: 'Sheet1', range: 'A1:B2', line_start: null, line_end: null, drawing_part: null, shape_id: null, connector_id: null, anchor_type: null },
        { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: '4', connector_id: null, anchor_type: 'absoluteAnchor' },
      ]);

      // 读取实际 .md chunk frontmatter，解析 locator 并与原 evidence locator 整体对比
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const artifactId = `A-${artifactSha256.slice(0, 12)}`;
      const normDir = join(tmpDir, 'normalized', artifactId);

      // 构建 chunk_id → evidence block locator 映射
      const chunkIdToEvidenceLocator = {};
      for (let i = 0; i < normalized.chunks.length; i++) {
        chunkIdToEvidenceLocator[normalized.chunks[i].chunk_id] = evidenceBlocks[i].locator;
      }

      // 逐 .md 文件验证：解析 chunk_id，找到对应原 evidence locator，比较
      for (let seq = 1; seq <= evidenceBlocks.length; seq++) {
        const padded = String(seq).padStart(4, '0');
        const mdContent = await readFile(join(normDir, `chunks/${padded}.md`), 'utf8');
        const fmMatch = mdContent.match(/^---\n([\s\S]*?)\n---/);
        assert.equal(Array.isArray(fmMatch), true, `Missing frontmatter in chunks/${padded}.md`);

        const fmLines = fmMatch[1].split('\n');
        const locatorLine = fmLines.find(l => l.startsWith('locator:'));
        const chunkIdLine = fmLines.find(l => l.startsWith('chunk_id:'));
        assert.equal(typeof locatorLine, 'string', `Missing locator in frontmatter of chunks/${padded}.md`);
        assert.equal(typeof chunkIdLine, 'string', `Missing chunk_id in frontmatter of chunks/${padded}.md`);

        const rawLocator = locatorLine.slice('locator:'.length).trim().replace(/^'|'$/g, '');
        const fmLocator = JSON.parse(rawLocator);
        const fmChunkId = chunkIdLine.slice('chunk_id:'.length).trim();
        assert.equal(typeof chunkIdToEvidenceLocator[fmChunkId], 'object', `Unknown chunk_id ${fmChunkId} in chunks/${padded}.md`);
        const expectedLocator = chunkIdToEvidenceLocator[fmChunkId];
        assert.deepEqual(fmLocator, expectedLocator,
          `chunks/${padded}.md frontmatter locator mismatch with original evidence`);
      }
    });

    it('normalization 磁盘产物与原 evidence 整体 deepEqual', async () => {
      const normalized = await normalizeEvidenceToMarkdown({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        artifactSha256,
        blocks: evidenceBlocks,
        runDir: tmpDir,
        converterVersion: '1.0.0',
      });

      // 读取实际写出的 index 文件
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');

      // 计算 artifactId（与 normalizeEvidenceToMarkdown 一致）
      const artifactId = `A-${artifactSha256.slice(0, 12)}`;

      // 读取 index.json 文件
      const indexContent = await readFile(join(tmpDir, 'normalized', artifactId, 'index.json'), 'utf8');
      const index = JSON.parse(indexContent);

      // 验证磁盘 locator 投影与原 evidence 整体 deepEqual
      const diskLocators = index.chunks.map(c => ({
        sheet: c.locator.sheet,
        drawing_part: c.locator.drawing_part,
        anchor_type: c.locator.anchor_type,
        shape_id: c.locator.shape_id,
        connector_id: c.locator.connector_id,
      }));

      const originalLocators = evidenceBlocks.map(b => ({
        sheet: b.locator.sheet,
        drawing_part: b.locator.drawing_part,
        anchor_type: b.locator.anchor_type,
        shape_id: b.locator.shape_id,
        connector_id: b.locator.connector_id,
      }));

      assert.deepEqual(diskLocators, originalLocators, 'Disk locators should match original evidence');
    });

    it('buildEvidenceBatches 完整固定投影整体 deepEqual（batch_id、modality_mix、markdown_refs、block_id→locator 映射、验证结果）', async () => {
      const batches = buildEvidenceBatches({ blocks: evidenceBlocks });

      // 完整 batch 投影（strip batch_sha256 因为内部 hash 顺序可能微变，单独验证格式）
      assert.equal(batches.length, 1);
      const batch = batches[0];
      assert.match(batch.batch_id, /^EB-[a-zA-Z0-9_-]+$/);
      assert.match(batch.batch_sha256, /^[a-f0-9]{64}$/);
      assert.equal(batch.status, 'PENDING');
      assert.equal(batch.total_chars, 1258);

      // modality_mix 整体 deepEqual
      assert.deepEqual(batch.modality_mix, ['TABLE', 'STRUCTURED_DIAGRAM']);

      // markdown_refs 整体 deepEqual
      assert.deepEqual(batch.markdown_refs, []);

      // block_id→locator 完整映射整体 deepEqual
      const blockIdLocatorMap = {};
      for (const block of batch.blocks) {
        blockIdLocatorMap[block.block_id] = block.locator;
      }
      assert.deepEqual(blockIdLocatorMap, {
        'B-fe12d7424d3a': { page: null, slide: null, sheet: 'Sheet1', range: 'A1:B2', line_start: null, line_end: null, drawing_part: null, shape_id: null, connector_id: null, anchor_type: null },
        'B-6ce9ee67784e': { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: '1', connector_id: null, anchor_type: 'twoCellAnchor' },
        'B-4d1e01796e89': { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: '2', connector_id: null, anchor_type: 'oneCellAnchor' },
        'B-bc345ed02601': { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: '4', connector_id: null, anchor_type: 'absoluteAnchor' },
        'B-ef5bee75a93a': { page: null, slide: null, sheet: 'sheet1', range: null, line_start: null, line_end: null, drawing_part: 'xl/drawings/drawing1.xml', shape_id: null, connector_id: '3', anchor_type: 'twoCellAnchor' },
      });

      // 验证结果数组整体 deepEqual
      const validationResults = [];
      for (const b of batches) {
        validationResults.push(await validateEvidenceBatch(b));
      }
      assert.deepEqual(validationResults, [{ valid: true }]);
    });

    it('每个 evidence batch 应通过 validateEvidenceBatch', async () => {
      const batches = buildEvidenceBatches({ blocks: evidenceBlocks });
      for (const batch of batches) {
        const validation = await validateEvidenceBatch(batch);
        assert.deepEqual(validation, { valid: true },
          `Batch validation failed: ${JSON.stringify(validation.errors)}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // inspectInputs manifest（保留原有测试）
  // ═══════════════════════════════════════════════════════════════════════════
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
      assert.equal(artifact.confidence >= 0, true);
      assert.equal(artifact.confidence <= 1, true);
    });
  });
});
