import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { formatCapabilities, classifyXlsxContent } from './lib/input-classifier.mjs';
import { importRuntimePackage } from './lib/runtime-loader.mjs';
import { inspectDrawingmlPackage } from './lib/drawingml-extractor.mjs';

/**
 * Inspect a set of input files and produce an InputManifest.
 *
 * @param {{ inputs: string[], runDir: string }} params
 * @param {string[]} params.inputs - Absolute paths to input files.
 * @param {string} params.runDir - Absolute path to the run directory.
 * @returns {Promise<import('./types.mjs').InputManifest>}
 */
export async function inspectInputs({ inputs, runDir }) {
  const artifacts = [];
  const warnings = [];

  for (const filePath of inputs) {
    const artifact = await classifyFile(filePath, warnings);
    artifacts.push(artifact);
  }

  const manifest = {
    schema_version: '1.0.0',
    run_id: crypto.randomUUID(),
    artifacts,
    warnings,
  };

  // Write manifest to runDir/input/
  const inputDir = path.join(runDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(
    path.join(inputDir, 'input-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  return manifest;
}

/**
 * Classify a single file.
 */
async function classifyFile(filePath, warnings) {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const sizeBytes = content.length;

  const caps = formatCapabilities[ext];
  if (!caps) {
    return {
      file_path: filePath,
      sha256,
      size_bytes: sizeBytes,
      kind: 'UNKNOWN',
      format: ext.slice(1) || 'unknown',
      parse_mode: 'UNSUPPORTED',
      confidence: 0,
      capabilities: [],
      degradation_reason: `Unsupported file extension: ${ext}`,
    };
  }

  const [kind, parseMode, ...capabilities] = caps;

  // Base artifact with defaults
  let artifact = {
    file_path: filePath,
    sha256,
    size_bytes: sizeBytes,
    kind,
    format: ext.slice(1),
    parse_mode: parseMode,
    confidence: 0.9,
    capabilities,
    degradation_reason: null,
  };

  // Special handling for specific formats
  if (ext === '.pdf') {
    artifact = await classifyPdf(filePath, content, artifact, warnings);
  } else if (ext === '.docx') {
    artifact = await classifyDocx(filePath, content, artifact, warnings);
  } else if (ext === '.xlsx') {
    artifact = await classifyXlsx(filePath, content, artifact, warnings);
  } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    artifact.parse_mode = 'VISUAL_ONLY';
    artifact.confidence = 0.5;
    artifact.capabilities = ['VISUAL_ONLY'];
    artifact.degradation_reason = 'Image file: no text extraction possible without OCR';
  }

  return artifact;
}

/**
 * Classify a PDF file: detect text density per page.
 */
async function classifyPdf(filePath, content, artifact, warnings) {
  try {
    const pdfjsLib = await importRuntimePackage('pdf', 'pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(content) });
    const pdf = await loadingTask.promise;

    let visualPageCount = 0;
    const totalPages = pdf.numPages;

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join('');
      const nonWhitespace = text.replace(/\s/g, '').length;
      if (nonWhitespace < 20) {
        visualPageCount++;
      }
    }

    if (visualPageCount === totalPages) {
      artifact.parse_mode = 'VISUAL_ONLY';
      artifact.kind = 'DIAGRAM';
      artifact.confidence = 0.4;
      artifact.capabilities = ['VISUAL_ONLY'];
      artifact.degradation_reason = `All ${totalPages} page(s) appear scanned (fewer than 20 non-whitespace characters per page)`;
    } else if (visualPageCount > 0) {
      artifact.confidence = 0.7;
      artifact.capabilities = ['SEMI_STRUCTURED', 'PARTIAL_TEXT'];
      artifact.degradation_reason = `${visualPageCount} of ${totalPages} page(s) appear scanned`;
    }

    await loadingTask.destroy();
  } catch (err) {
    warnings.push(`PDF analysis failed for ${filePath}: [${err.code || 'UNKNOWN'}] ${err.message}`);
    artifact.confidence = 0.3;
    artifact.degradation_reason = `PDF parsing error: [${err.code || 'UNKNOWN'}] ${err.message}`;
  }

  return artifact;
}

/**
 * Classify a DOCX file using mammoth for text extraction.
 */
async function classifyDocx(filePath, content, artifact, warnings) {
  try {
    const mammoth = await importRuntimePackage('docx', 'mammoth');
    const result = await mammoth.extractRawText({ buffer: content });
    const text = result.value;
    if (!text || text.trim().length === 0) {
      artifact.parse_mode = 'VISUAL_ONLY';
      artifact.confidence = 0.3;
      artifact.degradation_reason = 'DOCX contains no extractable text';
    } else {
      artifact.confidence = 0.85;
    }
    if (result.messages && result.messages.length > 0) {
      for (const msg of result.messages) {
        warnings.push(`DOCX ${filePath}: ${msg.message}`);
      }
    }
  } catch (err) {
    warnings.push(`DOCX analysis failed for ${filePath}: ${err.message}`);
    artifact.confidence = 0.3;
    artifact.degradation_reason = `DOCX parsing error: ${err.message}`;
  }

  return artifact;
}

/**
 * Classify an XLSX file using exceljs (no macro execution).
 * Now integrates DrawingML inspection for dynamic classification.
 */
async function classifyXlsx(filePath, content, artifact, warnings) {
  try {
    const ExcelJS = await importRuntimePackage('xlsx', 'exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content);

    let cellCount = 0;
    workbook.eachSheet((sheet) => {
      sheet.eachRow(() => { cellCount++; });
    });

    // Warn if workbook has VBA macros (but do not execute)
    if (workbook.vbaProject) {
      warnings.push(`XLSX ${filePath}: contains VBA macros (will not be executed)`);
    }

    // 检查 DrawingML 内容
    try {
      const inspection = await inspectDrawingmlPackage(content);
      const classification = classifyXlsxContent({
        cell_count: cellCount,
        has_editable_shapes: inspection.hasEditableShapes,
        has_raster_only: inspection.hasRasterOnly,
      });

      // 根据分类结果更新 artifact
      artifact.kind = classification.kind;
      artifact.parse_mode = classification.parse_mode;
      artifact.capabilities = classification.capabilities;

      // 设置置信度
      if (inspection.hasEditableShapes) {
        artifact.confidence = 0.9;
      } else if (inspection.hasRasterOnly) {
        artifact.confidence = 0.5;
        artifact.degradation_reason = 'XLSX contains only raster images, no editable shapes';
      } else if (cellCount > 0) {
        artifact.confidence = 0.85;
      } else {
        artifact.confidence = 0.3;
        artifact.degradation_reason = 'XLSX contains no data rows or drawings';
      }

      // 收集 DrawingML 警告
      if (inspection.warnings && inspection.warnings.length > 0) {
        warnings.push(...inspection.warnings.map(w => `XLSX ${filePath}: ${w.message || w}`));
      }
    } catch (drawingmlErr) {
      // DrawingML 检查失败，降级到基本分类
      warnings.push(`XLSX DrawingML inspection failed for ${filePath}: ${drawingmlErr.message}`);
      if (cellCount === 0) {
        artifact.parse_mode = 'VISUAL_ONLY';
        artifact.confidence = 0.3;
        artifact.degradation_reason = 'XLSX contains no data rows';
      } else {
        artifact.confidence = 0.7;
      }
    }
  } catch (err) {
    warnings.push(`XLSX analysis failed for ${filePath}: ${err.message}`);
    artifact.confidence = 0.3;
    artifact.degradation_reason = `XLSX parsing error: ${err.message}`;
  }

  return artifact;
}
