/**
 * 多源证据抽取器
 *
 * 从 PDF、DOCX、XLSX、PPTX、Markdown、图片和结构化流程图中抽取证据块。
 * 每个证据块包含可定位的内容、模态类型和内容哈希。
 */

import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, dirname, extname, basename, resolve, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * 加载 jszip — 通过 runtime loader 显式加载
 */
function loadJszip() {
  const { requireRuntimePackage } = require('./runtime-loader.mjs');
  return requireRuntimePackage('xlsx', 'jszip');
}

/**
 * 预算安全常量
 */
export const BUDGET = {
  MAX_FILE_SIZE: 50 * 1024 * 1024,        // 50MB 单文件
  MAX_CHARACTERS: 500_000,                  // 500k 字符
  MAX_PAGES: 1000,                          // PDF 页数上限
  MAX_ZIP_ENTRIES: 1000,                    // ZIP 条目数
  MAX_DECOMPRESSED_SIZE: 100 * 1024 * 1024, // 100MB 解压总量
  MAX_COMPRESSION_RATIO: 100,               // 压缩比上限
  MAX_JSON_DEPTH: 20,                       // JSON 深度
  MAX_JSON_ENTRIES: 10_000,                 // JSON 条目数
};

/**
 * 从单个文件抽取证据
 *
 * @param {object} params
 * @param {{ path: string, format: string }} params.artifact - 文件信息
 * @param {string} params.runDir - 运行目录
 * @returns {Promise<{ artifact_sha256: string, blocks: object[] }>}
 */
export async function extractArtifactEvidence({ artifact, runDir }) {
  const { path: filePath, format } = artifact;

  // 检查文件存在和大小限制
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (fileStat.size > BUDGET.MAX_FILE_SIZE) {
    throw new Error(`File exceeds size limit: ${filePath} (${fileStat.size} > ${BUDGET.MAX_FILE_SIZE})`);
  }

  // 计算文件哈希
  const fileContent = await readFile(filePath);
  const artifactSha256 = createHash('sha256').update(fileContent).digest('hex');

  // 根据格式分发到对应的抽取器
  let blocks;
  switch (format) {
    case 'md':
      blocks = await extractMarkdown(filePath, fileContent, artifactSha256);
      break;
    case 'pdf':
      blocks = await extractPdf(filePath, fileContent, artifactSha256);
      break;
    case 'docx':
      blocks = await extractDocx(filePath, fileContent, artifactSha256);
      break;
    case 'xlsx':
      blocks = await extractXlsx(filePath, fileContent, artifactSha256);
      break;
    case 'pptx':
      blocks = await extractPptx(filePath, fileContent, artifactSha256);
      break;
    case 'png':
    case 'jpg':
    case 'jpeg':
      blocks = await extractImage(filePath, fileContent, format, artifactSha256);
      break;
    case 'bpmn':
    case 'svg':
      blocks = await extractStructuredDiagram(filePath, fileContent, format, artifactSha256);
      break;
    case 'mermaid':
      blocks = await extractMermaid(filePath, fileContent, artifactSha256);
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  return {
    artifact_sha256: artifactSha256,
    blocks,
  };
}

/**
 * 生成稳定的块 ID
 */
function generateBlockId(artifactSha256, locatorKey) {
  const hash = createHash('sha256')
    .update(`${artifactSha256}:${locatorKey}`)
    .digest('hex')
    .slice(0, 12);
  return `B-${hash}`;
}

/**
 * 生成内容哈希
 */
function contentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * 抽取 Markdown 文件
 */
async function extractMarkdown(filePath, fileContent, artifactSha256) {
  const content = fileContent.toString('utf8');
  const lines = content.split('\n');
  const blocks = [];

  let currentHeadingPath = [];
  let currentBlockStart = 1;
  let currentBlockContent = [];
  let inTable = false;
  let tableStartLine = 0;
  let tableContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 检测标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // 保存之前的块
      if (currentBlockContent.length > 0) {
        const blockContent = currentBlockContent.join('\n').trim();
        if (blockContent) {
          blocks.push(createTextBlock(
            filePath,
            currentHeadingPath.slice(),
            blockContent,
            currentBlockStart,
            currentBlockStart + currentBlockContent.length - 1,
            artifactSha256
          ));
        }
        currentBlockContent = [];
      }

      // 更新标题路径
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      currentHeadingPath = currentHeadingPath.slice(0, level - 1);
      currentHeadingPath[level - 1] = title;
      currentBlockStart = lineNum + 1;
      continue;
    }

    // 检测表格开始
    if (line.includes('|') && line.trim().startsWith('|')) {
      if (!inTable) {
        // 保存之前的文本块
        if (currentBlockContent.length > 0) {
          const blockContent = currentBlockContent.join('\n').trim();
          if (blockContent) {
            blocks.push(createTextBlock(
              filePath,
              currentHeadingPath.slice(),
              blockContent,
              currentBlockStart,
              currentBlockStart + currentBlockContent.length - 1,
              artifactSha256
            ));
          }
          currentBlockContent = [];
        }
        inTable = true;
        tableStartLine = lineNum;
        tableContent = [];
      }
      tableContent.push(line);
      continue;
    }

    // 表格结束
    if (inTable) {
      blocks.push(createTableBlock(
        filePath,
        currentHeadingPath.slice(),
        tableContent.join('\n'),
        tableStartLine,
        lineNum - 1,
        artifactSha256
      ));
      inTable = false;
      tableContent = [];
      currentBlockStart = lineNum;
    }

    currentBlockContent.push(line);
  }

  // 处理最后的块
  if (inTable && tableContent.length > 0) {
    blocks.push(createTableBlock(
      filePath,
      currentHeadingPath.slice(),
      tableContent.join('\n'),
      tableStartLine,
      lines.length,
      artifactSha256
    ));
  } else if (currentBlockContent.length > 0) {
    const blockContent = currentBlockContent.join('\n').trim();
    if (blockContent) {
      blocks.push(createTextBlock(
        filePath,
        currentHeadingPath.slice(),
        blockContent,
        currentBlockStart,
        lines.length,
        artifactSha256
      ));
    }
  }

  return blocks;
}

/**
 * 创建文本块
 */
function createTextBlock(filePath, headingPath, content, lineStart, lineEnd, artifactSha256) {
  const locatorKey = `md:${lineStart}:${lineEnd}`;
  return {
    block_id: generateBlockId(artifactSha256, locatorKey),
    artifact_sha256: artifactSha256,
    source_format: 'md',
    modality: 'TEXT',
    locator: {
      page: null,
      slide: null,
      sheet: null,
      range: null,
      line_start: lineStart,
      line_end: lineEnd,
    },
    heading_path: headingPath,
    content,
    asset_ref: null,
    content_sha256: contentHash(content),
  };
}

/**
 * 创建表格块
 */
function createTableBlock(filePath, headingPath, content, lineStart, lineEnd, artifactSha256) {
  const locatorKey = `md:table:${lineStart}:${lineEnd}`;
  return {
    block_id: generateBlockId(artifactSha256, locatorKey),
    artifact_sha256: artifactSha256,
    source_format: 'md',
    modality: 'TABLE',
    locator: {
      page: null,
      slide: null,
      sheet: null,
      range: null,
      line_start: lineStart,
      line_end: lineEnd,
    },
    heading_path: headingPath,
    content,
    asset_ref: null,
    content_sha256: contentHash(content),
  };
}

/**
 * 抽取 PDF 文件
 * 注意：完整实现需要 pdfjs-dist，这里提供基础框架
 */
async function extractPdf(filePath, fileContent, artifactSha256) {
  const blocks = [];

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileContent) }).promise;

    // 页数预算检查
    if (pdf.numPages > BUDGET.MAX_PAGES) {
      throw new Error(`PDF page count exceeds limit: ${pdf.numPages} > ${BUDGET.MAX_PAGES}`);
    }

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(item => item.str).join(' ');

      if (text.trim().length > 10) {
        blocks.push({
          block_id: generateBlockId(artifactSha256, `pdf:${pageNum}`),
          artifact_sha256: artifactSha256,
          source_format: 'pdf',
          modality: 'TEXT',
          locator: {
            page: pageNum,
            slide: null,
            sheet: null,
            range: null,
            line_start: null,
            line_end: null,
          },
          heading_path: [],
          content: text.trim(),
          asset_ref: null,
          content_sha256: contentHash(text.trim()),
        });
      } else {
        // 低文本页面标记为视觉资产
        blocks.push({
          block_id: generateBlockId(artifactSha256, `pdf:visual:${pageNum}`),
          artifact_sha256: artifactSha256,
          source_format: 'pdf',
          modality: 'VISUAL_ASSET',
          locator: {
            page: pageNum,
            slide: null,
            sheet: null,
            range: null,
            line_start: null,
            line_end: null,
          },
          heading_path: [],
          content: `[PDF page ${pageNum}: visual content]`,
          asset_ref: filePath,
          content_sha256: contentHash(`[visual:${pageNum}]`),
        });
      }
    }
  } catch (err) {
    // 如果 pdfjs-dist 不可用，返回一个说明块
    blocks.push({
      block_id: generateBlockId(artifactSha256, 'pdf:unavailable'),
      artifact_sha256: artifactSha256,
      source_format: 'pdf',
      modality: 'VISUAL_ASSET',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null },
      heading_path: [],
      content: `[PDF extraction unavailable: ${err.message}]`,
      asset_ref: filePath,
      content_sha256: contentHash('[pdf:unavailable]'),
    });
  }

  return blocks;
}

/**
 * 抽取 DOCX 文件
 */
async function extractDocx(filePath, fileContent, artifactSha256) {
  const blocks = [];

  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer: fileContent });
    const text = result.value;

    if (text.trim()) {
      blocks.push({
        block_id: generateBlockId(artifactSha256, 'docx:full'),
        artifact_sha256: artifactSha256,
        source_format: 'docx',
        modality: 'TEXT',
        locator: {
          page: null,
          slide: null,
          sheet: null,
          range: null,
          line_start: 1,
          line_end: text.split('\n').length,
        },
        heading_path: [],
        content: text.trim(),
        asset_ref: null,
        content_sha256: contentHash(text.trim()),
      });
    }

    // 添加视觉资产占位符（DOCX 可能包含嵌入的图表、图片等）
    blocks.push({
      block_id: generateBlockId(artifactSha256, 'docx:visual'),
      artifact_sha256: artifactSha256,
      source_format: 'docx',
      modality: 'VISUAL_ASSET',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null },
      heading_path: [],
      content: '[DOCX embedded visual content]',
      asset_ref: filePath,
      content_sha256: contentHash('[docx:visual]'),
    });
  } catch (err) {
    blocks.push({
      block_id: generateBlockId(artifactSha256, 'docx:unavailable'),
      artifact_sha256: artifactSha256,
      source_format: 'docx',
      modality: 'TEXT',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null },
      heading_path: [],
      content: `[DOCX extraction unavailable: ${err.message}]`,
      asset_ref: null,
      content_sha256: contentHash('[docx:unavailable]'),
    });
  }

  return blocks;
}

/**
 * 抽取 XLSX 文件
 * 现在集成 DrawingML 提取，同时产生 TABLE 和 STRUCTURED_DIAGRAM 证据块
 */
async function extractXlsx(filePath, fileContent, artifactSha256) {
  const blocks = [];

  try {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileContent);

    // 提取表格数据
    for (const worksheet of workbook.worksheets) {
      const sheetName = worksheet.name;
      const rows = [];

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells = [];
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          cells.push(cell.text || '');
        });
        rows.push(cells.join('\t'));
      });

      if (rows.length > 0) {
        blocks.push({
          block_id: generateBlockId(artifactSha256, `xlsx:${sheetName}`),
          artifact_sha256: artifactSha256,
          source_format: 'xlsx',
          modality: 'TABLE',
          locator: {
            page: null,
            slide: null,
            sheet: sheetName,
            range: `A1:${String.fromCharCode(64 + rows[0].split('\t').length)}${rows.length}`,
            line_start: null,
            line_end: null,
            drawing_part: null,
            shape_id: null,
            connector_id: null,
            anchor_type: null,
          },
          heading_path: [sheetName],
          content: rows.join('\n'),
          asset_ref: null,
          content_sha256: contentHash(rows.join('\n')),
        });
      }
    }

    // 提取 DrawingML 内容
    try {
      const { extractDrawingml } = await import('./drawingml-extractor.mjs');
      const drawingResult = await extractDrawingml(fileContent);

      // 为每个元素创建 STRUCTURED_DIAGRAM 证据块
      for (const element of drawingResult.elements) {
        const locatorKey = `xlsx:drawing:${element.sheet}:${element.drawing_part}:${element.shape_id}`;
        blocks.push({
          block_id: generateBlockId(artifactSha256, locatorKey),
          artifact_sha256: artifactSha256,
          source_format: 'xlsx',
          modality: 'STRUCTURED_DIAGRAM',
          locator: {
            page: null,
            slide: null,
            sheet: element.sheet,
            range: null,
            line_start: null,
            line_end: null,
            drawing_part: element.drawing_part,
            shape_id: element.shape_id,
            connector_id: null,
            anchor_type: element.anchor_type || null,
          },
          heading_path: [element.sheet, element.name || element.shape_id],
          content: JSON.stringify(element),
          asset_ref: null,
          content_sha256: contentHash(JSON.stringify(element)),
        });
      }

      // 为每个连接器创建 STRUCTURED_DIAGRAM 证据块
      for (const connector of drawingResult.connectors) {
        const locatorKey = `xlsx:connector:${connector.sheet}:${connector.drawing_part}:${connector.connector_id}`;
        blocks.push({
          block_id: generateBlockId(artifactSha256, locatorKey),
          artifact_sha256: artifactSha256,
          source_format: 'xlsx',
          modality: 'STRUCTURED_DIAGRAM',
          locator: {
            page: null,
            slide: null,
            sheet: connector.sheet,
            range: null,
            line_start: null,
            line_end: null,
            drawing_part: connector.drawing_part,
            shape_id: null,
            connector_id: connector.connector_id,
            anchor_type: connector.anchor_type || null,
          },
          heading_path: [connector.sheet, connector.name || connector.connector_id],
          content: JSON.stringify(connector),
          asset_ref: null,
          content_sha256: contentHash(JSON.stringify(connector)),
        });
      }

      // 收集警告
      if (drawingResult.warnings && drawingResult.warnings.length > 0) {
        // 将警告添加到第一个块的 metadata 或单独处理
        // 这里简化处理，实际应该在 manifest 中记录
      }
    } catch (drawingmlErr) {
      // DrawingML 提取失败，降级到只有表格数据
      // 不影响已有的 TABLE 块
    }
  } catch (err) {
    blocks.push({
      block_id: generateBlockId(artifactSha256, 'xlsx:unavailable'),
      artifact_sha256: artifactSha256,
      source_format: 'xlsx',
      modality: 'TABLE',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null, drawing_part: null, shape_id: null, connector_id: null, anchor_type: null },
      heading_path: [],
      content: `[XLSX extraction unavailable: ${err.message}]`,
      asset_ref: null,
      content_sha256: contentHash('[xlsx:unavailable]'),
    });
  }

  return blocks;
}

/**
 * 抽取 PPTX 文件
 */
async function extractPptx(filePath, fileContent, artifactSha256) {
  const blocks = [];

  try {
    const JSZip = loadJszip();
    const zip = await JSZip.loadAsync(fileContent);

    // Zip bomb 检测：条目数限制
    const entryCount = Object.keys(zip.files).length;
    if (entryCount > BUDGET.MAX_ZIP_ENTRIES) {
      throw new Error(`ZIP entry count exceeds limit: ${entryCount} > ${BUDGET.MAX_ZIP_ENTRIES}`);
    }

    // Zip Slip 防护 + 解压大小/压缩比检查
    let totalDecompressed = 0;
    for (const [entry, zipEntry] of Object.entries(zip.files)) {
      const normalized = normalize(entry);
      if (normalized.startsWith('..') || normalized.startsWith('/')) {
        throw new Error(`Zip Slip detected: ${entry}`);
      }
      // 检查每个条目的解压大小（通过 _data 压缩前大小估算）
      if (zipEntry._data) {
        const decompressedSize = zipEntry._data.uncompressedSize || 0;
        totalDecompressed += decompressedSize;
        if (decompressedSize > BUDGET.MAX_DECOMPRESSED_SIZE) {
          throw new Error(`ZIP entry ${entry} decompressed size exceeds limit: ${decompressedSize} > ${BUDGET.MAX_DECOMPRESSED_SIZE}`);
        }
        // 压缩比检查
        const compressedSize = zipEntry._data.compressedSize || decompressedSize;
        if (compressedSize > 0 && decompressedSize / compressedSize > BUDGET.MAX_COMPRESSION_RATIO) {
          throw new Error(`ZIP entry ${entry} compression ratio exceeds limit: ${decompressedSize / compressedSize} > ${BUDGET.MAX_COMPRESSION_RATIO}`);
        }
      }
    }
    if (totalDecompressed > BUDGET.MAX_DECOMPRESSED_SIZE) {
      throw new Error(`Total decompressed size exceeds limit: ${totalDecompressed} > ${BUDGET.MAX_DECOMPRESSED_SIZE}`);
    }

    // 查找所有幻灯片
    const slideFiles = Object.keys(zip.files).filter(f =>
      f.match(/^ppt\/slides\/slide\d+\.xml$/)
    );

    for (const slideFile of slideFiles) {
      const slideNum = parseInt(slideFile.match(/slide(\d+)\.xml/)[1], 10);
      const slideXml = await zip.files[slideFile].async('string');

      // 简单提取文本内容
      const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [];
      const texts = textMatches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

      if (texts.length > 0) {
        const textContent = texts.join('\n');
        if (textContent.length > BUDGET.MAX_CHARACTERS) {
          throw new Error(`PPTX slide ${slideNum} content exceeds character limit`);
        }
        blocks.push({
          block_id: generateBlockId(artifactSha256, `pptx:${slideNum}`),
          artifact_sha256: artifactSha256,
          source_format: 'pptx',
          modality: 'TEXT',
          locator: {
            page: null,
            slide: slideNum,
            sheet: null,
            range: null,
            line_start: null,
            line_end: null,
          },
          heading_path: [`Slide ${slideNum}`],
          content: textContent,
          asset_ref: null,
          content_sha256: contentHash(textContent),
        });
      }

      // 检查是否有图片
      const relsFile = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
      if (zip.files[relsFile]) {
        const relsXml = await zip.files[relsFile].async('string');
        if (relsXml.includes('image')) {
          blocks.push({
            block_id: generateBlockId(artifactSha256, `pptx:visual:${slideNum}`),
            artifact_sha256: artifactSha256,
            source_format: 'pptx',
            modality: 'VISUAL_ASSET',
            locator: {
              page: null,
              slide: slideNum,
              sheet: null,
              range: null,
              line_start: null,
              line_end: null,
            },
            heading_path: [`Slide ${slideNum}`],
            content: `[PPTX slide ${slideNum}: visual content]`,
            asset_ref: filePath,
            content_sha256: contentHash(`[pptx:visual:${slideNum}]`),
          });
        }
      }
    }
  } catch (err) {
    blocks.push({
      block_id: generateBlockId(artifactSha256, 'pptx:unavailable'),
      artifact_sha256: artifactSha256,
      source_format: 'pptx',
      modality: 'TEXT',
      locator: { page: null, slide: null, sheet: null, range: null, line_start: null, line_end: null },
      heading_path: [],
      content: `[PPTX extraction unavailable: ${err.message}]`,
      asset_ref: null,
      content_sha256: contentHash('[pptx:unavailable]'),
    });
  }

  return blocks;
}

/**
 * 抽取图片文件
 */
async function extractImage(filePath, fileContent, format, artifactSha256) {
  return [{
    block_id: generateBlockId(artifactSha256, `image:${format}`),
    artifact_sha256: artifactSha256,
    source_format: format,
    modality: 'VISUAL_ASSET',
    locator: {
      page: null,
      slide: null,
      sheet: null,
      range: null,
      line_start: null,
      line_end: null,
    },
    heading_path: [],
    content: `[${format.toUpperCase()} image: ${basename(filePath)}]`,
    asset_ref: filePath,
    content_sha256: contentHash(`[image:${format}]`),
  }];
}

/**
 * 抽取结构化流程图 (BPMN/SVG)
 */
async function extractStructuredDiagram(filePath, fileContent, format, artifactSha256) {
  const content = fileContent.toString('utf8');

  // 提取元素信息
  const elements = [];

  if (format === 'bpmn') {
    // 提取 BPMN 元素
    const taskMatches = content.matchAll(/<bpmn:task[^>]*id="([^"]*)"[^>]*name="([^"]*)"[^>]*>/g);
    for (const match of taskMatches) {
      elements.push({ id: match[1], name: match[2], type: 'task' });
    }

    const eventMatches = content.matchAll(/<bpmn:(?:start|end|intermediate)[^>]*Event[^>]*id="([^"]*)"[^>]*name="([^"]*)"[^>]*>/g);
    for (const match of eventMatches) {
      elements.push({ id: match[1], name: match[2], type: 'event' });
    }

    const gatewayMatches = content.matchAll(/<bpmn:(?:exclusive|parallel|inclusive)[^>]*Gateway[^>]*id="([^"]*)"[^>]*name="([^"]*)"[^>]*>/g);
    for (const match of gatewayMatches) {
      elements.push({ id: match[1], name: match[2], type: 'gateway' });
    }

    const flowMatches = content.matchAll(/<bpmn:sequenceFlow[^>]*id="([^"]*)"[^>]*sourceRef="([^"]*)"[^>]*targetRef="([^"]*)"[^>]*>/g);
    for (const match of flowMatches) {
      elements.push({ id: match[1], source: match[2], target: match[3], type: 'flow' });
    }
  }

  return [{
    block_id: generateBlockId(artifactSha256, `diagram:${format}`),
    artifact_sha256: artifactSha256,
    source_format: format,
    modality: 'STRUCTURED_DIAGRAM',
    locator: {
      page: null,
      slide: null,
      sheet: null,
      range: null,
      line_start: 1,
      line_end: content.split('\n').length,
    },
    heading_path: [],
    content: elements.length > 0 ? JSON.stringify(elements) : content,
    asset_ref: null,
    content_sha256: contentHash(content),
  }];
}

/**
 * 抽取 Mermaid 文件
 */
async function extractMermaid(filePath, fileContent, artifactSha256) {
  const content = fileContent.toString('utf8');

  return [{
    block_id: generateBlockId(artifactSha256, 'mermaid:full'),
    artifact_sha256: artifactSha256,
    source_format: 'mermaid',
    modality: 'STRUCTURED_DIAGRAM',
    locator: {
      page: null,
      slide: null,
      sheet: null,
      range: null,
      line_start: 1,
      line_end: content.split('\n').length,
    },
    heading_path: [],
    content,
    asset_ref: null,
    content_sha256: contentHash(content),
  }];
}
