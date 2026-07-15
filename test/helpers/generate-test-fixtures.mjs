#!/usr/bin/env node

/**
 * 生成测试用合成夹具
 *
 * 生成 PDF、DOCX、XLSX、PPTX 合成文件，用于证据抽取测试。
 * 所有内容为中文采购管理流程，确定性生成。
 *
 * 用法: node scripts/generate-test-fixtures.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

// 定位 jszip（通过 pnpm store 的 jszip@3.10.1）
function loadJszip() {
  const pnpmJszip = join(__dirname, '../../node_modules/.pnpm/jszip@3.10.1/node_modules/jszip');
  try {
    return require(pnpmJszip);
  } catch {
    // 回退：通过 exceljs 的依赖树
    const exceljs = require('exceljs');
    // exceljs 内部使用 jszip，尝试通过 require 解析
    throw new Error('jszip not found. Run: cd packages/flow-architect && npm install jszip@3.10.1 --no-save');
  }
}

const fixturesDir = join(__dirname, '../fixtures/process-draft/sources');

// 采购管理流程合成内容
const CONTENT = {
  title: '采购管理制度',
  sections: [
    { heading: '第一章 总则', text: '本制度适用于公司所有采购活动，包括物资采购、服务采购和工程采购。所有采购活动必须遵循公开、公平、公正的原则。' },
    { heading: '第二章 采购申请', text: '采购申请人填写《采购申请单》，注明采购物品名称、规格、数量、预算金额和交货时间。申请单经部门经理审核签字后，提交采购部。' },
    { heading: '第三章 审批流程', text: '金额5000元以下由部门经理审批；5000至50000元由分管副总审批；50000元以上由总经理审批。紧急采购可先口头审批，后补书面手续。' },
    { heading: '第四章 供应商管理', text: '采购部建立合格供应商名录，定期评估供应商资质、价格、交货能力和售后服务。新供应商需经资质审核、样品测试和现场考察。' },
  ],
  tableHeaders: ['金额范围', '审批人', '审批时限'],
  tableRows: [
    ['< 5000元', '部门经理', '1个工作日'],
    ['5000-50000元', '分管副总', '3个工作日'],
    ['> 50000元', '总经理', '5个工作日'],
  ],
};

/**
 * 生成最小有效 PDF
 */
async function generatePdf() {
  // 手工构建一个有效的 PDF 1.4（ASCII 安全内容用于测试）
  const pdfText = 'Procurement Management System. Chapter 1 General Provisions. This system applies to all procurement activities. Chapter 2 Purchase Request. Applicants fill in the Purchase Request Form and submit to department manager. Chapter 3 Approval Process. Under 5000 yuan approved by department manager. 5000 to 50000 yuan approved by VP. Over 50000 yuan approved by CEO. Chapter 4 Supplier Management. Maintain qualified supplier list with regular evaluation.';

  const objects = [];
  const offsets = [];
  let currentOffset = 0;

  function addObject(content) {
    offsets.push(currentOffset);
    objects.push(content);
    currentOffset += content.length;
  }

  // Header
  const header = '%PDF-1.4\n';
  currentOffset = header.length;

  // Object 1: Catalog
  addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // Object 2: Pages
  addObject('2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n');
  // Object 3: Page 1
  addObject('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n');
  // Object 4: Page 2
  addObject('4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n');

  // Object 5: Page 1 content stream (ASCII-safe for WinAnsi encoding)
  const page1Text = 'Procurement Management System. Chapter 1 General Provisions. This system applies to all procurement activities. Chapter 2 Purchase Request. Applicants fill in the Purchase Request Form and submit to department manager.';
  const page1Content = `BT\n/F1 14 Tf\n50 740 Td\n(${page1Text}) Tj\nET`;
  addObject(`5 0 obj\n<< /Length ${page1Content.length} >>\nstream\n${page1Content}\nendstream\nendobj\n`);

  // Object 6: Font
  addObject('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // Object 7: Page 2 content stream
  const page2Text = 'Chapter 3 Approval Process. Under 5000 yuan approved by department manager. 5000 to 50000 yuan approved by VP. Over 50000 yuan approved by CEO. Chapter 4 Supplier Management. Maintain qualified supplier list with regular evaluation.';
  const page2Content = `BT\n/F1 14 Tf\n50 740 Td\n(${page2Text}) Tj\nET`;
  addObject(`7 0 obj\n<< /Length ${page2Content.length} >>\nstream\n${page2Content}\nendstream\nendobj\n`);

  // Build xref
  let pdf = header;
  const xrefOffset = currentOffset;
  for (const obj of objects) {
    pdf += obj;
  }

  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  await writeFile(join(fixturesDir, 'sample.pdf'), pdf, 'latin1');
  console.log('  ✓ sample.pdf');
}

/**
 * 生成 DOCX（使用 JSZip 构建最小 OOXML）
 */
async function generateDocx() {
  const JSZip = loadJszip();
  const zip = new JSZip();

  const bodyParagraphs = CONTENT.sections.map(s => {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${s.heading.startsWith('第') ? '1' : '2'}"/></w:pPr><w:r><w:t>${escapeXml(s.heading)}</w:t></w:r></w:p><w:p><w:r><w:t>${escapeXml(s.text)}</w:t></w:r></w:p>`;
  }).join('');

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyParagraphs}</w:body>
</w:document>`);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(join(fixturesDir, 'sample.docx'), buffer);
  console.log('  ✓ sample.docx');
}

/**
 * 生成 XLSX（使用 ExcelJS）
 */
async function generateXlsx() {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: 审批权限表
  const ws1 = workbook.addWorksheet('审批权限');
  ws1.addRow(CONTENT.tableHeaders);
  for (const row of CONTENT.tableRows) {
    ws1.addRow(row);
  }

  // Sheet 2: 供应商清单
  const ws2 = workbook.addWorksheet('供应商清单');
  ws2.addRow(['供应商名称', '资质等级', '主营范围', '联系人']);
  ws2.addRow(['A供应商', '一级', '办公用品', '张三']);
  ws2.addRow(['B供应商', '二级', 'IT设备', '李四']);
  ws2.addRow(['C供应商', '一级', '工程材料', '王五']);

  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(join(fixturesDir, 'sample.xlsx'), buffer);
  console.log('  ✓ sample.xlsx');
}

/**
 * 生成 PPTX（使用 JSZip 构建最小 OOXML）
 */
async function generatePptx() {
  const JSZip = loadJszip();
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><p:sldId id="257" r:id="rId3" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></p:sldIdLst>
</p:presentation>`);

  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`);

  // Slide 1
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(CONTENT.title)}</a:t></a:r></a:p><a:p><a:r><a:t>${escapeXml(CONTENT.sections[0].text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`);

  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  // Slide 2
  zip.file('ppt/slides/slide2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(CONTENT.sections[1].heading)}</a:t></a:r></a:p><a:p><a:r><a:t>${escapeXml(CONTENT.sections[1].text)}</a:t></a:r></a:p><a:p><a:r><a:t>${escapeXml(CONTENT.sections[2].heading)}</a:t></a:r></a:p><a:p><a:r><a:t>${escapeXml(CONTENT.sections[2].text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`);

  zip.file('ppt/slides/_rels/slide2.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  // Minimal slideMaster (required by presentation.xml)
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldMaster>`);

  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(join(fixturesDir, 'sample.pptx'), buffer);
  console.log('  ✓ sample.pptx');
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 主流程
async function main() {
  console.log('生成测试夹具...\n');
  await mkdir(fixturesDir, { recursive: true });

  await generatePdf();
  await generateDocx();
  await generateXlsx();
  await generatePptx();

  console.log('\n所有夹具生成完成。');
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
