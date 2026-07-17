/**
 * DrawingML 测试 Fixture 生成器
 *
 * 生成确定性的 OOXML fixtures，用于测试 DrawingML 提取器。
 * 所有 fixture 使用固定的时间戳、ZIP entry 顺序和内容，确保可重复性。
 *
 * 不包含用户名、绝对路径、私有项目标记或当前时间。
 */

import JSZip from 'jszip';

/**
 * 固定时间戳：用于所有 ZIP entry，确保确定性输出
 * 2024-01-15T00:00:00.000Z → Unix 1705276800000
 */
const FIXED_DATE = new Date(Date.UTC(2024, 0, 15, 0, 0, 0, 0));

/**
 * 向 JSZip 添加文件并设置固定时间戳
 *
 * 通过 options.date 参数设置 ZIP entry 时间戳，确保确定性。
 * 注意：JSZip 自动创建的目录 entries（如 xl/、_rels/）不受此控制，
 * 必须在生成前调用 fixAllDates() 修复。
 */
function addFileWithFixedDate(zip, name, data, options) {
  zip.file(name, data, { ...options, date: FIXED_DATE });
}

/**
 * 修复 JSZip 中所有 entries 的日期为固定时间戳
 * （包括自动创建的目录 entries）
 */
function fixAllDates(zip) {
  for (const entry of Object.values(zip.files)) {
    entry.date = FIXED_DATE;
  }
}

/**
 * 公共 PNG 最小图片（1x1 像素透明图片）
 */
const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAABlJREFUCNdjYGBg+A8AAQQBAScLuN4AAAAASUVORK5CYII=',
  'base64'
);

/**
 * 向 zip 中添加最小 OOXML 骨架
 * @param {JSZip} zip
 * @param {object} opts
 * @param {boolean} opts.hasDrawing - 是否包含 drawing
 * @param {boolean} opts.hasImage - 是否包含图片
 */
function addMinimalXlsxSkeleton(zip, { hasDrawing = false, hasImage = false } = {}) {
  const drawingOverride = hasDrawing
    ? `\n  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    : '';
  const imageOverride = hasImage
    ? `\n  <Override PartName="/xl/media/image1.png" ContentType="image/png"/>`
    : '';

  addFileWithFixedDate(zip, '[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${drawingOverride}${imageOverride}
</Types>`);

  addFileWithFixedDate(zip, '_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`);

  const wbDrawingRel = hasDrawing
    ? `\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="drawings/drawing1.xml"/>`
    : '';

  addFileWithFixedDate(zip, 'xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${wbDrawingRel}
</Relationships>`);
}

/**
 * 向 zip 中添加 sheet1.xml 的 relationship（引用 drawing）
 */
function addSheetDrawingRel(zip) {
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`);
}

/**
 * 生成最小 DrawingML 流程图 fixture
 * 包含：两个可编辑形状、一个 connector、明确起止连接点 + 单元格数据
 * 分类：表格+原生图（MIXED / STRUCTURED / [XLSX_TABLE, DRAWINGML_STRUCTURE]）
 */
export function createDrawingmlFlowFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true, hasImage: false });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>活动名称</t></is></c>
      <c r="B1" t="inlineStr"><is><t>负责人</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>审核采购申请</t></is></c>
      <c r="B2" t="inlineStr"><is><t>采购经理</t></is></c>
    </row>
  </sheetData>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <!-- Shape 1: two-cell anchor -->
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="1" name="Shape 1"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="152400"/>
          <a:ext cx="1828800" cy="914400"/>
        </a:xfrm>
        <a:prstGeom prst="roundRect"/>
        <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
      </xdr:spPr>
      <xdr:txBody>
        <a:bodyPr/>
        <a:p><a:r><a:t>开始审核</a:t></a:r></a:p>
      </xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <!-- Shape 2: one-cell anchor -->
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="1828800" cy="914400"/>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="2" name="Shape 2"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="3657600" y="152400"/>
          <a:ext cx="1828800" cy="914400"/>
        </a:xfrm>
        <a:prstGeom prst="diamond"/>
        <a:solidFill><a:srgbClr val="ED7D31"/></a:solidFill>
      </xdr:spPr>
      <xdr:txBody>
        <a:bodyPr/>
        <a:p><a:r><a:t>决策</a:t></a:r></a:p>
      </xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
  <!-- Connector: two-cell anchor -->
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:cxnSp macro="">
      <xdr:nvCxnSpPr>
        <xdr:cNvPr id="3" name="Connector 1"/>
        <xdr:cNvCxnSpPr/>
      </xdr:nvCxnSpPr>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="1828800" y="304800"/>
          <a:ext cx="1828800" cy="0"/>
        </a:xfrm>
        <a:prstGeom prst="straightConnector1"/>
        <a:ln w="12700">
          <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
          <a:tailEnd type="arrow"/>
        </a:ln>
      </xdr:spPr>
      <xdr:cxnSp>
        <a:stCxn id="1" idx="1"/>
        <a:endCxn id="2" idx="0"/>
      </xdr:cxnSp>
    </xdr:cxnSp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <!-- Shape 3: absolute anchor -->
  <xdr:absoluteAnchor>
    <xdr:pos x="5486400" y="152400"/>
    <xdr:ext cx="1828800" cy="914400"/>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="4" name="Shape 3"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="5486400" y="152400"/>
          <a:ext cx="1828800" cy="914400"/>
        </a:xfrm>
        <a:prstGeom prst="rect"/>
        <a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>
      </xdr:spPr>
      <xdr:txBody>
        <a:bodyPr/>
        <a:p><a:r><a:t>结束</a:t></a:r></a:p>
      </xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:absoluteAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成纯原生图 fixture（有可编辑形状，无单元格数据）
 * 分类：纯原生图（DIAGRAM / STRUCTURED / [DRAWINGML_STRUCTURE]）
 */
export function createDrawingmlOnlyFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true, hasImage: false });

  // 空 sheetData（无单元格）
  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  // 与 createDrawingmlFlowFixture 相同的 drawing，但 sheet 无单元格
  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="1" name="Start"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
        <a:prstGeom prst="roundRect"/>
        <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
      </xdr:spPr>
      <xdr:txBody><a:bodyPr/><a:p><a:r><a:t>开始</a:t></a:r></a:p></xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="1828800" cy="914400"/>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="2" name="End"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="3657600" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
        <a:prstGeom prst="rect"/>
        <a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>
      </xdr:spPr>
      <xdr:txBody><a:bodyPr/><a:p><a:r><a:t>结束</a:t></a:r></a:p></xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:cxnSp macro="">
      <xdr:nvCxnSpPr>
        <xdr:cNvPr id="3" name="Connector"/>
        <xdr:cNvCxnSpPr/>
      </xdr:nvCxnSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="1828800" y="457200"/><a:ext cx="1828800" cy="0"/></a:xfrm>
        <a:prstGeom prst="straightConnector1"/>
        <a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="arrow"/></a:ln>
      </xdr:spPr>
      <xdr:cxnSp>
        <a:stCxn id="1" idx="0"/>
        <a:endCxn id="2" idx="0"/>
      </xdr:cxnSp>
    </xdr:cxnSp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成纯图片 fixture（无可编辑形状）
 * 分类：纯图片（DIAGRAM / VISUAL_ONLY / [VISUAL_ONLY]）
 */
export function createImageOnlyFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true, hasImage: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  // 只包含图片引用，无 xdr:sp 或 xdr:cxnSp
  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:absoluteAnchor>
    <xdr:pos x="0" y="0"/>
    <xdr:ext cx="5486400" cy="3200400"/>
    <xdr:pic macro="">
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Image 1"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="5486400" cy="3200400"/>
        </a:xfrm>
        <a:prstGeom prst="rect"/>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:absoluteAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/media/image1.png', MINIMAL_PNG);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成纯表格 fixture（无 DrawingML）
 * 分类：纯表格（ARCHITECTURE / STRUCTURED / [XLSX_TABLE]）
 */
export function createSimpleTableFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: false, hasImage: false });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>活动名称</t></is></c>
      <c r="B1" t="inlineStr"><is><t>负责人</t></is></c>
      <c r="C1" t="inlineStr"><is><t>SLA</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>审核采购申请</t></is></c>
      <c r="B2" t="inlineStr"><is><t>采购经理</t></is></c>
      <c r="C2" t="inlineStr"><is><t>2小时</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>批准采购</t></is></c>
      <c r="B3" t="inlineStr"><is><t>总监</t></is></c>
      <c r="C3" t="inlineStr"><is><t>1天</t></is></c>
    </row>
  </sheetData>
</worksheet>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成表格+图片混合 fixture（有单元格数据 + 仅图片，无 editable shapes）
 * 分类：表格+图片（MIXED / SEMI_STRUCTURED / [XLSX_TABLE, VISUAL_ONLY]）
 */
export function createTableImageFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true, hasImage: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>步骤</t></is></c>
      <c r="B1" t="inlineStr"><is><t>描述</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>1</t></is></c>
      <c r="B2" t="inlineStr"><is><t>开始</t></is></c>
    </row>
  </sheetData>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  // 只包含图片，无 xdr:sp 或 xdr:cxnSp
  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:absoluteAnchor>
    <xdr:pos x="0" y="0"/>
    <xdr:ext cx="5486400" cy="3200400"/>
    <xdr:pic macro="">
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Flowchart Image"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="5486400" cy="3200400"/>
        </a:xfrm>
        <a:prstGeom prst="rect"/>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:absoluteAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/media/image1.png', MINIMAL_PNG);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含无效引用（引用不存在的 shape ID）的 fixture
 */
export function createInvalidReferenceFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  // 一个 shape (id=1) + 一个 connector 引用不存在的 id=99
  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="1" name="Shape A"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
        <a:prstGeom prst="rect"/>
      </xdr:spPr>
      <xdr:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:cxnSp macro="">
      <xdr:nvCxnSpPr>
        <xdr:cNvPr id="2" name="Connector 1"/>
        <xdr:cNvCxnSpPr/>
      </xdr:nvCxnSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="1828800" y="152400"/><a:ext cx="1828800" cy="0"/></a:xfrm>
        <a:prstGeom prst="straightConnector1"/>
      </xdr:spPr>
      <xdr:cxnSp>
        <a:stCxn id="1" idx="0"/>
        <a:endCxn id="99" idx="0"/>
      </xdr:cxnSp>
    </xdr:cxnSp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含缺失连接关系的 fixture
 */
export function createMissingConnectionFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  // 包含一个连接器，但缺少 stCxn
  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp macro="">
      <xdr:nvSpPr>
        <xdr:cNvPr id="1" name="Shape 1"/>
        <xdr:cNvSpPr/>
      </xdr:nvSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
        <a:prstGeom prst="rect"/>
      </xdr:spPr>
      <xdr:txBody><a:bodyPr/><a:p><a:r><a:t>Shape A</a:t></a:r></a:p></xdr:txBody>
    </xdr:sp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:cxnSp macro="">
      <xdr:nvCxnSpPr>
        <xdr:cNvPr id="2" name="Connector 1"/>
        <xdr:cNvCxnSpPr/>
      </xdr:nvCxnSpPr>
      <xdr:spPr>
        <a:xfrm><a:off x="1828800" y="152400"/><a:ext cx="1828800" cy="0"/></a:xfrm>
        <a:prstGeom prst="straightConnector1"/>
      </xdr:spPr>
      <!-- 缺少 a:stCxn，导致 source_ref 为 null -->
      <xdr:cxnSp>
        <a:endCxn id="1" idx="0"/>
      </xdr:cxnSp>
    </xdr:cxnSp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

// ─────────────────────────────────────────────────────────────────────────
// 关系安全 fixtures（Fix C）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 生成包含 External TargetMode 的 fixture
 * sheet relationship 引用外部目标，应被拒绝
 */
export function createExternalTargetFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // External TargetMode on drawing relationship
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="https://evil.com/drawing.xml" TargetMode="External"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="1" name="S1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>X</a:t></a:r></a:p></xdr:txBody></xdr:sp>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含重复 relationship ID 的 fixture
 */
export function createDuplicateRelationshipIdFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // 两个 relationship 都使用 rId1（重复 ID）
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="1" name="S1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含绝对 Target 路径的 fixture
 */
export function createAbsoluteTargetFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // Absolute target path (starts with /)
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="/xl/drawings/drawing1.xml"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="1" name="S1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含 Windows 路径分隔符的 fixture
 */
export function createWindowsPathSeparatorFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // Windows path separator in target
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="..\\drawings\\drawing1.xml"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="1" name="S1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含 ../ 逃逸路径的 fixture
 * target 使用 ../../ 逃逸 xl/ 根目录
 */
export function createPathEscapeFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // Path escape: ../../etc/passwd normalized would escape xl/
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../../etc/drawing.xml"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含损坏 drawing XML 的 fixture
 * drawing relationship 存在但目标文件内容为无效 XML
 */
export function createCorruptedDrawingFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  addSheetDrawingRel(zip);

  // 损坏的 XML
  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', '<broken><unclosed>');

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含缺失 drawing relationship 的 fixture
 * sheet 引用了 rId1 但 sheet rels 中没有对应的 drawing relationship
 */
export function createMissingDrawingRelFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: false });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // sheet rels 中没有 drawing relationship（空 rels）
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成包含两个同类型 drawing relationship 的 fixture
 * sheet 引用 rId1，但 rels 中有两个匹配的 drawing relationship
 */
export function createAmbiguousDrawingFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: true });

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
  <drawing r:id="rId1"/>
</worksheet>`);

  // 两个 relationship 都是 rId1 且类型都是 drawing（歧义映射）
  addFileWithFixedDate(zip, 'xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing2.xml"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="1" name="S1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`);

  addFileWithFixedDate(zip, 'xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  fixAllDates(zip);
  return zip;
}

/**
 * 生成 workbook relationship 中包含 External TargetMode 的 fixture
 */
export function createExternalWorkbookTargetFixture() {
  const zip = new JSZip();

  addMinimalXlsxSkeleton(zip, { hasDrawing: false });

  // workbook rels 中的 worksheet relationship 有 External TargetMode
  addFileWithFixedDate(zip, 'xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://evil.com/sheet.xml" TargetMode="External"/>
</Relationships>`);

  addFileWithFixedDate(zip, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>`);

  fixAllDates(zip);
  return zip;
}
