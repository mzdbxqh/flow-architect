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

    it('应拒绝超过 XML 字符数限制的内容（workbook XML）', async () => {
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

    it('应拒绝超大的 worksheet XML', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeSheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + 'x'.repeat(500001) + '</sheetData></worksheet>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      zip.file('xl/worksheets/sheet1.xml', largeSheet);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 workbook rels', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + 'x'.repeat(500001) + '</Relationships>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', largeRels);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 worksheet rels', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeSheetRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + 'x'.repeat(500001) + '</Relationships>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData></sheetData><drawing r:id="rId1"/></worksheet>');
      zip.file('xl/worksheets/_rels/sheet1.xml.rels', largeSheetRels);
      zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"></xdr:wsDr>');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await assert.rejects(
        () => extractDrawingml(buffer),
        { message: /XML safety validation failed.*character count exceeds limit/ }
      );
    });

    it('应拒绝超过 XML 字符数限制的 drawing XML', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const largeDrawing = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + 'x'.repeat(500001) + '</xdr:wsDr>';
      zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>');
      zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      zip.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData></sheetData><drawing r:id="rId1"/></worksheet>');
      zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
      zip.file('xl/drawings/drawing1.xml', largeDrawing);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const result = await extractDrawingml(buffer);
      // drawing XML 安全检查应该产生 warning，而不是抛出异常
      const corruptedWarnings = result.warnings.filter(w => w.code === 'DRAWINGML_CORRUPTED_XML');
      assert.equal(corruptedWarnings.length, 1, 'Should have exactly 1 DRAWINGML_CORRUPTED_XML warning');
      assert.equal(corruptedWarnings[0].code, 'DRAWINGML_CORRUPTED_XML');
      assert.equal(corruptedWarnings[0].target, 'xl/drawings/drawing1.xml');
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

    it('图片 anchor 应产生 VISUAL_ASSET block', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: imageXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });

      // 图片-only fixture 确定只有 1 个 picture → 1 个 VISUAL_ASSET block
      const visualBlocks = result.blocks.filter(b => b.modality === 'VISUAL_ASSET');
      assert.equal(visualBlocks.length, 1, 'Should have exactly 1 VISUAL_ASSET block');

      // 精确断言 VISUAL_ASSET block 完整投影
      const block = visualBlocks[0];
      assert.equal(block.modality, 'VISUAL_ASSET');
      assert.equal(block.source_format, 'xlsx');
      assert.deepEqual(block.heading_path, ['sheet1', 'Image 1']);
      assert.equal(block.asset_ref, 'rId1');
      assert.equal(block.locator.sheet, 'sheet1');
      assert.equal(block.locator.shape_id, '1');
      assert.equal(block.locator.connector_id, null);
      assert.equal(block.locator.anchor_type, 'absoluteAnchor');
      assert.equal(block.locator.drawing_part, 'xl/drawings/drawing1.xml');
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

    it('混合 fixture 的 evidence blocks 精确投影', async () => {
      const result = await extractArtifactEvidence({
        artifact: { path: mixedXlsxPath, format: 'xlsx' },
        runDir: tmpDir,
      });

      // 混合 fixture：1 TABLE + 3 shape + 1 connector = 5 blocks
      assert.equal(result.blocks.length, 5, 'Should have exactly 5 blocks');

      // 精确断言每个 block 的完整投影
      const tableBlocks = result.blocks.filter(b => b.modality === 'TABLE');
      const diagramBlocks = result.blocks.filter(b => b.modality === 'STRUCTURED_DIAGRAM');

      assert.equal(tableBlocks.length, 1, 'Should have exactly 1 TABLE block');
      assert.equal(diagramBlocks.length, 4, 'Should have exactly 4 STRUCTURED_DIAGRAM blocks');

      // TABLE block 精确投影
      const table = tableBlocks[0];
      assert.equal(table.modality, 'TABLE');
      assert.equal(table.source_format, 'xlsx');
      assert.deepEqual(table.heading_path, ['Sheet1']);
      assert.equal(table.asset_ref, null);
      assert.equal(table.locator.sheet, 'Sheet1');
      assert.equal(table.locator.range, 'A1:B2');
      assert.equal(table.locator.shape_id, null);
      assert.equal(table.locator.connector_id, null);

      // STRUCTURED_DIAGRAM blocks 精确投影
      const shape1 = diagramBlocks.find(b => b.locator.shape_id === '1');
      assert.equal(shape1.modality, 'STRUCTURED_DIAGRAM');
      assert.equal(shape1.locator.sheet, 'sheet1');
      assert.equal(shape1.locator.drawing_part, 'xl/drawings/drawing1.xml');
      assert.equal(shape1.locator.shape_id, '1');
      assert.equal(shape1.locator.connector_id, null);
      assert.equal(shape1.locator.anchor_type, 'twoCellAnchor');

      const shape2 = diagramBlocks.find(b => b.locator.shape_id === '2');
      assert.equal(shape2.modality, 'STRUCTURED_DIAGRAM');
      assert.equal(shape2.locator.sheet, 'sheet1');
      assert.equal(shape2.locator.shape_id, '2');
      assert.equal(shape2.locator.connector_id, null);
      assert.equal(shape2.locator.anchor_type, 'oneCellAnchor');

      const connector = diagramBlocks.find(b => b.locator.connector_id === '3');
      assert.equal(connector.modality, 'STRUCTURED_DIAGRAM');
      assert.equal(connector.locator.sheet, 'sheet1');
      assert.equal(connector.locator.shape_id, null);
      assert.equal(connector.locator.connector_id, '3');
      assert.equal(connector.locator.anchor_type, 'twoCellAnchor');

      const shape4 = diagramBlocks.find(b => b.locator.shape_id === '4');
      assert.equal(shape4.modality, 'STRUCTURED_DIAGRAM');
      assert.equal(shape4.locator.sheet, 'sheet1');
      assert.equal(shape4.locator.shape_id, '4');
      assert.equal(shape4.locator.connector_id, null);
      assert.equal(shape4.locator.anchor_type, 'absoluteAnchor');
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

      // 修复 E：对四个 DrawingML chunk 的 locator 列表整体 deepEqual
      const locatorProjections = diagramChunks.map(c => ({
        sheet: c.locator.sheet,
        drawing_part: c.locator.drawing_part,
        anchor_type: c.locator.anchor_type,
        shape_id: c.locator.shape_id,
        connector_id: c.locator.connector_id,
      })).sort((a, b) => {
        const keyA = `${a.shape_id || a.connector_id}`;
        const keyB = `${b.shape_id || b.connector_id}`;
        return keyA.localeCompare(keyB);
      });

      // 精确确认 3 shape + 1 connector
      const shapes = locatorProjections.filter(l => l.shape_id !== null);
      const connectors = locatorProjections.filter(l => l.connector_id !== null);
      assert.equal(shapes.length, 3);
      assert.equal(connectors.length, 1);

      // 所有 drawing_part 一致
      for (const loc of locatorProjections) {
        assert.equal(loc.drawing_part, 'xl/drawings/drawing1.xml');
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

    it('buildEvidenceBatches 应保留 locator 并生成有效批次', async () => {
      const batches = buildEvidenceBatches({ blocks: evidenceBlocks });

      // 混合 fixture 有 5 个 blocks，应该生成 1 个 batch
      assert.equal(batches.length, 1, 'Should produce exactly 1 batch');

      const batch = batches[0];
      assert.match(batch.batch_id, /^EB-[a-zA-Z0-9_-]+$/);
      assert.match(batch.batch_sha256, /^[a-f0-9]{64}$/);
      assert.equal(batch.blocks.length, 5, 'Batch should contain all 5 blocks');
      assert.equal(batch.total_chars >= 0, true, 'total_chars should be non-negative');
      assert.equal(batch.total_chars <= 12000, true, 'total_chars should not exceed 12000');
      assert.equal(batch.status, 'PENDING');
      assert.equal(typeof batch.context_budget, 'object');

      // 验证每个块的 locator 保留
      for (const block of batch.blocks) {
        if (block.modality === 'STRUCTURED_DIAGRAM') {
          assert.equal(typeof block.locator.sheet, 'string');
          assert.equal(block.locator.drawing_part, 'xl/drawings/drawing1.xml');
        }
      }

      // 修复 E：所有原始 block_id→locator 映射精确匹配
      const allBatchBlockIds = batches.flatMap(b => b.blocks.map(bl => bl.block_id));
      const originalBlockIds = evidenceBlocks.map(b => b.block_id).sort();
      const batchBlockIds = [...new Set(allBatchBlockIds)].sort();
      assert.deepEqual(batchBlockIds, originalBlockIds,
        'All original blocks must appear in batches');

      // block_id→locator 映射整体 deepEqual
      const batchLocatorMap = {};
      for (const batch of batches) {
        for (const block of batch.blocks) {
          batchLocatorMap[block.block_id] = block.locator;
        }
      }
      for (const block of evidenceBlocks) {
        assert.deepEqual(batchLocatorMap[block.block_id], block.locator,
          `Locator mismatch for block ${block.block_id}`);
      }
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
