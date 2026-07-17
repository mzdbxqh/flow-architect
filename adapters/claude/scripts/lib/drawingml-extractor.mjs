/**
 * DrawingML 提取器
 *
 * 从 XLSX 包中安全解析 OOXML DrawingML 形状、连接器、锚点和图片。
 * 只读取 ZIP/XML 和允许的 media 元数据，不执行宏、外部链接、OLE/嵌入对象、公式或脚本。
 *
 * 所有输出确定性：相同字节输入重复调用必须深度相等且序列化结果字节一致。
 * 不读取当前时间、随机数或进程相关路径。
 *
 * 运行时依赖通过 ESM 顶层静态导入 requireRuntimePackage 加载，
 * 无动态 CJS 加载、无模块路径内省。
 */

import { normalize } from 'node:path';
import { requireRuntimePackage } from './runtime-loader.mjs';

/**
 * 加载 fast-xml-parser（通过 runtime loader 的显式依赖）
 * @returns {Promise<object>}
 */
async function loadXmlParser() {
  const fastXmlParser = await requireRuntimePackage('core', 'fast-xml-parser');
  return fastXmlParser.XMLParser || fastXmlParser.default?.XMLParser || fastXmlParser;
}

/**
 * 加载 JSZip（通过 runtime loader 的显式依赖）
 * @returns {Promise<object>}
 */
async function loadJszip() {
  return requireRuntimePackage('xlsx', 'jszip');
}

/**
 * 安全预算常量（生产硬上限）
 */
export const DRAWINGML_BUDGET = {
  MAX_ZIP_ENTRIES: 1000,
  MAX_DECOMPRESSED_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_COMPRESSION_RATIO: 100,
  MAX_XML_CHARACTERS: 500_000,
  MAX_ANCHORS_PER_SHEET: 1000,
  MAX_SHAPES_PER_ANCHOR: 10,
};

/**
 * 解析有效安全限制（只允许收紧，不允许放宽）
 * @param {object} [override] - 可选覆盖值，每个值必须 <= 生产硬上限
 * @returns {object} 有效限制
 */
function resolveLimits(override) {
  if (!override) return DRAWINGML_BUDGET;
  const result = { ...DRAWINGML_BUDGET };
  for (const key of Object.keys(DRAWINGML_BUDGET)) {
    if (override[key] !== undefined) {
      if (override[key] > DRAWINGML_BUDGET[key]) {
        throw new Error(`Cannot loosen security limit ${key}: ${override[key]} > ${DRAWINGML_BUDGET[key]}`);
      }
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * 预设几何类型映射
 */
const PRESET_GEOMETRY_NAMES = {
  rect: '矩形',
  roundRect: '圆角矩形',
  ellipse: '椭圆',
  diamond: '菱形',
  triangle: '三角形',
  hexagon: '六边形',
  pentagon: '五边形',
  star4: '四角星',
  star5: '五角星',
  star6: '六角星',
  star7: '七角星',
  star8: '八角星',
  straightConnector1: '直线连接器',
  bentConnector2: '折线连接器2',
  bentConnector3: '折线连接器3',
  curvedConnector2: '曲线连接器2',
  curvedConnector3: '曲线连接器3',
};

/**
 * XML 解析器配置（安全模式）
 */
const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  // 安全：不处理外部实体
  processEntities: false,
  htmlEntities: false,
};

/**
 * 检查 ZIP 包安全性
 * @param {JSZip} zip
 * @param {object} [limits] - 可选安全限制覆盖
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateZipSafety(zip, limits) {
  const budget = resolveLimits(limits);
  const errors = [];
  const entries = Object.keys(zip.files);

  // 条目数限制
  if (entries.length > budget.MAX_ZIP_ENTRIES) {
    errors.push(`ZIP entry count exceeds limit: ${entries.length} > ${budget.MAX_ZIP_ENTRIES}`);
  }

  // 检查每个条目
  let totalDecompressed = 0;
  for (const [entry, zipEntry] of Object.entries(zip.files)) {
    // Zip Slip 防护
    const normalized = normalize(entry);
    if (normalized.startsWith('..') || normalized.startsWith('/')) {
      errors.push(`Zip Slip detected: ${entry}`);
      continue;
    }

    // 检查解压大小
    if (zipEntry._data) {
      const decompressedSize = zipEntry._data.uncompressedSize || 0;
      totalDecompressed += decompressedSize;

      if (decompressedSize > budget.MAX_DECOMPRESSED_SIZE) {
        errors.push(`ZIP entry ${entry} decompressed size exceeds limit: ${decompressedSize} > ${budget.MAX_DECOMPRESSED_SIZE}`);
      }

      // 压缩比检查
      const compressedSize = zipEntry._data.compressedSize || decompressedSize;
      if (compressedSize > 0) {
        const ratio = decompressedSize / compressedSize;
        if (ratio > budget.MAX_COMPRESSION_RATIO) {
          errors.push(`ZIP entry ${entry} compression ratio exceeds limit: ${ratio.toFixed(2)} > ${budget.MAX_COMPRESSION_RATIO}`);
        }
      }
    }
  }

  // 总解压大小限制
  if (totalDecompressed > budget.MAX_DECOMPRESSED_SIZE) {
    errors.push(`Total decompressed size exceeds limit: ${totalDecompressed} > ${budget.MAX_DECOMPRESSED_SIZE}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 检查 XML 内容安全性
 * @param {string} xmlContent
 * @param {string} partName
 * @param {object} [limits] - 可选安全限制覆盖
 * @throws {Error} 如果安全检查失败
 */
function validateXmlSafety(xmlContent, partName, limits) {
  const budget = resolveLimits(limits);
  const errors = [];

  if (xmlContent.length > budget.MAX_XML_CHARACTERS) {
    errors.push(`XML ${partName} character count exceeds limit: ${xmlContent.length} > ${budget.MAX_XML_CHARACTERS}`);
  }

  // 检查是否包含危险的外部实体声明
  if (xmlContent.includes('<!ENTITY') || xmlContent.includes('SYSTEM') || xmlContent.includes('PUBLIC')) {
    errors.push(`XML ${partName} contains potentially dangerous entity declarations`);
  }

  if (errors.length > 0) {
    throw new Error(`XML safety validation failed for ${partName}: ${errors.join('; ')}`);
  }
}

/**
 * 解析 XML 内容
 * @param {string} xmlContent
 * @param {string} partName
 * @param {object} [limits] - 可选安全限制覆盖
 * @returns {Promise<object>}
 */
async function parseXml(xmlContent, partName, limits) {
  validateXmlSafety(xmlContent, partName, limits);

  const XMLParser = await loadXmlParser();
  const parser = new XMLParser(XML_PARSER_OPTIONS);
  return parser.parse(xmlContent);
}

/**
 * 从 relationship 文件解析关系列表
 *
 * - 保留 TargetMode 属性
 * - 检测重复 relationship ID 并抛出错误（fail-closed）
 *
 * @param {string} relsXml
 * @param {string} [partName] - 用于错误消息的 part 名称
 * @param {object} [limits] - 可选安全限制覆盖
 * @returns {Promise<Array<{ id: string, type: string, target: string, targetMode: string|null }>>}
 * @throws {Error} 如果存在重复 relationship ID
 */
async function parseRelationships(relsXml, partName = 'rels', limits) {
  const parsed = await parseXml(relsXml, partName, limits);
  const rels = parsed?.Relationships?.Relationship || [];
  const relArray = Array.isArray(rels) ? rels : [rels];

  const seenIds = new Set();
  const result = [];

  for (const rel of relArray) {
    const id = rel['@_Id'] || rel.Id || '';
    if (id) {
      if (seenIds.has(id)) {
        throw new Error(`Duplicate relationship ID "${id}" in ${partName}`);
      }
      seenIds.add(id);
    }
    result.push({
      id,
      type: rel['@_Type'] || rel.Type || '',
      target: rel['@_Target'] || rel.Target || '',
      targetMode: rel['@_TargetMode'] || rel.TargetMode || null,
    });
  }

  return result;
}

/**
 * 检查 relationship target 是否安全（不逃逸 xl/ 根目录）
 * @param {string} target
 * @returns {boolean}
 */
function isSafeTarget(target) {
  if (!target) return false;
  // 绝对路径不安全
  if (target.startsWith('/')) return false;
  // 不允许外部 URL
  if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('ftp://')) return false;
  // 不允许外部 TargetMode
  // （TargetMode="External" 在 parseRelationships 之后由调用方检查）
  // 检查是否包含危险的路径遍历序列
  // 注意：相对路径中的 ../ 是合法的，只要最终解析后不逃逸 xl/ 根目录
  // 我们在实际使用时会规范化路径并验证
  if (target.includes('\\')) return false; // Windows 路径分隔符
  return true;
}

/**
 * 安全解析 relationship target 并检查逃逸
 *
 * @param {object} rel - relationship 对象
 * @param {string} sheetDir - 当前 sheet 的目录
 * @param {string} partName - 用于错误消息
 * @param {string[]} warnings - 警告收集数组
 * @returns {string|null} 安全的完整路径（xl/...）或 null
 */
function resolveRelationshipTarget(rel, sheetDir, partName, warnings) {
  // External TargetMode → 拒绝
  if (rel.targetMode === 'External') {
    warnings.push({
      code: 'DRAWINGML_EXTERNAL_TARGET',
      message: `Relationship ${rel.id} in ${partName} has External TargetMode, rejected`,
      target: rel.id,
    });
    return null;
  }

  if (!isSafeTarget(rel.target)) {
    warnings.push({
      code: 'DRAWINGML_UNSAFE_TARGET',
      message: `Relationship ${rel.id} in ${partName} has unsafe target: ${rel.target}`,
    });
    return null;
  }

  const fullPath = `xl/${sheetDir}${rel.target}`;
  const normalizedPath = normalize(fullPath).replace(/^\.\.\//, '');

  if (!normalizedPath.startsWith('xl/') && !normalizedPath.startsWith('xl\\')) {
    warnings.push({
      code: 'DRAWINGML_PATH_ESCAPE',
      message: `Relationship ${rel.id} target "${rel.target}" escapes xl/ root after normalization`,
      target: rel.id,
    });
    return null;
  }

  return normalizedPath;
}

/**
 * 从 anchor 解析边界信息
 * @param {object} anchor
 * @param {string} anchorType
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function parseAnchorBounds(anchor, anchorType) {
  // EMU (English Metric Units) 转换因子: 1 inch = 914400 EMU
  const EMU_TO_PIXEL = 914400;

  if (anchorType === 'absoluteAnchor') {
    const pos = anchor['xdr:pos'] || anchor.pos || {};
    const ext = anchor['xdr:ext'] || anchor.ext || {};
    return {
      x: parseInt(pos['@_x'] || pos.x || '0', 10) / EMU_TO_PIXEL,
      y: parseInt(pos['@_y'] || pos.y || '0', 10) / EMU_TO_PIXEL,
      width: parseInt(ext['@_cx'] || ext.cx || '0', 10) / EMU_TO_PIXEL,
      height: parseInt(ext['@_cy'] || ext.cy || '0', 10) / EMU_TO_PIXEL,
    };
  }

  // twoCellAnchor 和 oneCellAnchor 使用 from/to
  const from = anchor['xdr:from'] || anchor.from || {};
  const to = anchor['xdr:to'] || anchor.to || {};
  const ext = anchor['xdr:ext'] || anchor.ext || {};

  if (anchorType === 'twoCellAnchor') {
    return {
      x: parseInt(from['xdr:col'] || from.col || '0', 10),
      y: parseInt(from['xdr:row'] || from.row || '0', 10),
      width: parseInt(to['xdr:col'] || to.col || '0', 10) - parseInt(from['xdr:col'] || from.col || '0', 10),
      height: parseInt(to['xdr:row'] || to.row || '0', 10) - parseInt(from['xdr:row'] || from.row || '0', 10),
    };
  }

  // oneCellAnchor
  return {
    x: parseInt(from['xdr:col'] || from.col || '0', 10),
    y: parseInt(from['xdr:row'] || from.row || '0', 10),
    width: parseInt(ext['@_cx'] || ext.cx || '0', 10) / EMU_TO_PIXEL,
    height: parseInt(ext['@_cy'] || ext.cy || '0', 10) / EMU_TO_PIXEL,
  };
}

/**
 * 从形状 XML 提取文本内容
 * @param {object} txBody
 * @returns {string}
 */
function extractTextFromTxBody(txBody) {
  if (!txBody) return '';

  const paragraphs = [];
  const p = txBody['a:p'] || txBody.p || [];
  const pArray = Array.isArray(p) ? p : [p];

  for (const paragraph of pArray) {
    const runs = paragraph['a:r'] || paragraph.r || [];
    const runArray = Array.isArray(runs) ? runs : [runs];
    const textParts = runArray.map(run => run['a:t'] || run.t || '');
    paragraphs.push(textParts.join(''));
  }

  return paragraphs.join('\n').trim();
}

/**
 * 从形状 XML 提取 preset geometry
 * @param {object} spPr
 * @returns {string}
 */
function extractPresetGeometry(spPr) {
  if (!spPr) return 'unknown';

  const prstGeom = spPr['a:prstGeom'] || spPr.prstGeom;
  if (!prstGeom) return 'unknown';

  return prstGeom['@_prst'] || prstGeom.prst || 'unknown';
}

/**
 * 从形状 XML 提取填充颜色（简化）
 * @param {object} spPr
 * @returns {string|null}
 */
function extractFillColor(spPr) {
  if (!spPr) return null;

  const solidFill = spPr['a:solidFill'] || spPr.solidFill;
  if (!solidFill) return null;

  const srgbClr = solidFill['a:srgbClr'] || solidFill.srgbClr;
  if (!srgbClr) return null;

  return srgbClr['@_val'] || srgbClr.val || null;
}

/**
 * 解析形状元素 (xdr:sp)
 * @param {object} sp
 * @returns {object}
 */
function parseShape(sp) {
  const nvSpPr = sp['xdr:nvSpPr'] || sp.nvSpPr || {};
  const cNvPr = nvSpPr['xdr:cNvPr'] || nvSpPr.cNvPr || {};
  const spPr = sp['xdr:spPr'] || sp.spPr || {};
  const xfrm = spPr['a:xfrm'] || spPr.xfrm || {};
  const txBody = sp['xdr:txBody'] || sp.txBody || {};

  return {
    shape_type: 'sp',
    shape_id: String(cNvPr['@_id'] || cNvPr.id || ''),
    name: cNvPr['@_name'] || cNvPr.name || '',
    text: extractTextFromTxBody(txBody),
    preset_geometry: extractPresetGeometry(spPr),
    fill_color: extractFillColor(spPr),
    bounds: {
      x: parseInt(xfrm['a:off']?.['@_x'] || xfrm.off?.x || '0', 10) / 914400,
      y: parseInt(xfrm['a:off']?.['@_y'] || xfrm.off?.y || '0', 10) / 914400,
      width: parseInt(xfrm['a:ext']?.['@_cx'] || xfrm.ext?.cx || '0', 10) / 914400,
      height: parseInt(xfrm['a:ext']?.['@_cy'] || xfrm.ext?.cy || '0', 10) / 914400,
    },
  };
}

/**
 * 解析连接器元素 (xdr:cxnSp)
 * @param {object} cxnSp
 * @param {object} shapeIndex - 形状 ID 索引
 * @returns {{ connector: object, warnings: string[] }}
 */
function parseConnector(cxnSp, shapeIndex) {
  const warnings = [];
  const nvCxnSpPr = cxnSp['xdr:nvCxnSpPr'] || cxnSp.nvCxnSpPr || {};
  const cNvPr = nvCxnSpPr['xdr:cNvPr'] || nvCxnSpPr.cNvPr || {};
  const spPr = cxnSp['xdr:spPr'] || cxnSp.spPr || {};
  const xfrm = spPr['a:xfrm'] || spPr.xfrm || {};
  const cxnSpElement = cxnSp['xdr:cxnSp'] || cxnSp.cxnSp || {};

  // 解析连接点
  const stCxn = cxnSpElement['a:stCxn'] || cxnSpElement.stCxn;
  const endCxn = cxnSpElement['a:endCxn'] || cxnSpElement.endCxn;

  let sourceRef = null;
  let targetRef = null;
  let startConnection = null;
  let endConnection = null;

  // 起始连接
  if (stCxn) {
    const sourceId = String(stCxn['@_id'] || stCxn.id || '');
    const sourceIdx = parseInt(stCxn['@_idx'] || stCxn.idx || '0', 10);

    if (sourceId && shapeIndex[sourceId]) {
      sourceRef = sourceId;
      startConnection = { shape_id: sourceId, connection_id: sourceIdx };
    } else if (sourceId) {
      warnings.push({
        code: 'DRAWINGML_INVALID_REF',
        message: `Connector ${cNvPr['@_id'] || cNvPr.id} references non-existent source shape ${sourceId}`,
      });
    } else {
      warnings.push({
        code: 'DRAWINGML_MISSING_CONNECTION',
        message: `Connector ${cNvPr['@_id'] || cNvPr.id} missing start connection (stCxn)`,
      });
    }
  } else {
    warnings.push({
      code: 'DRAWINGML_MISSING_CONNECTION',
      message: `Connector ${cNvPr['@_id'] || cNvPr.id} missing start connection (stCxn)`,
    });
  }

  // 结束连接
  if (endCxn) {
    const targetId = String(endCxn['@_id'] || endCxn.id || '');
    const targetIdx = parseInt(endCxn['@_idx'] || endCxn.idx || '0', 10);

    if (targetId && shapeIndex[targetId]) {
      targetRef = targetId;
      endConnection = { shape_id: targetId, connection_id: targetIdx };
    } else if (targetId) {
      warnings.push({
        code: 'DRAWINGML_INVALID_REF',
        message: `Connector ${cNvPr['@_id'] || cNvPr.id} references non-existent target shape ${targetId}`,
      });
    } else {
      warnings.push({
        code: 'DRAWINGML_MISSING_CONNECTION',
        message: `Connector ${cNvPr['@_id'] || cNvPr.id} missing end connection (endCxn)`,
      });
    }
  } else {
    warnings.push({
      code: 'DRAWINGML_MISSING_CONNECTION',
      message: `Connector ${cNvPr['@_id'] || cNvPr.id} missing end connection (endCxn)`,
    });
  }

  // 提取箭头信息
  const ln = spPr['a:ln'] || spPr.ln || {};
  const tailEnd = ln['a:tailEnd'] || ln.tailEnd;
  const headEnd = ln['a:headEnd'] || ln.headEnd;

  const connector = {
    shape_type: 'cxnSp',
    shape_id: String(cNvPr['@_id'] || cNvPr.id || ''),
    name: cNvPr['@_name'] || cNvPr.name || '',
    preset_geometry: extractPresetGeometry(spPr),
    bounds: {
      x: parseInt(xfrm['a:off']?.['@_x'] || xfrm.off?.x || '0', 10) / 914400,
      y: parseInt(xfrm['a:off']?.['@_y'] || xfrm.off?.y || '0', 10) / 914400,
      width: parseInt(xfrm['a:ext']?.['@_cx'] || xfrm.ext?.cx || '0', 10) / 914400,
      height: parseInt(xfrm['a:ext']?.['@_cy'] || xfrm.ext?.cy || '0', 10) / 914400,
    },
    source_ref: sourceRef,
    target_ref: targetRef,
    start_connection: startConnection,
    end_connection: endConnection,
    has_arrow: !!(tailEnd || headEnd),
    arrow_type: tailEnd ? (tailEnd['@_type'] || tailEnd.type || 'arrow') : null,
  };

  return { connector, warnings };
}

/**
 * 解析图片元素 (xdr:pic)
 * @param {object} pic
 * @returns {object}
 */
function parsePicture(pic) {
  const nvPicPr = pic['xdr:nvPicPr'] || pic.nvPicPr || {};
  const cNvPr = nvPicPr['xdr:cNvPr'] || nvPicPr.cNvPr || {};
  const blipFill = pic['xdr:blipFill'] || pic.blipFill || {};
  const spPr = pic['xdr:spPr'] || pic.spPr || {};
  const xfrm = spPr['a:xfrm'] || spPr.xfrm || {};

  // 提取图片引用（兼容 r:embed 和 embed 两种属性名）
  const blip = blipFill['a:blip'] || blipFill.blip || {};
  const embed = blip['@_embed'] || blip['@_r:embed'] || blip.embed || blip['r:embed'] || null;

  return {
    shape_type: 'pic',
    shape_id: String(cNvPr['@_id'] || cNvPr.id || ''),
    name: cNvPr['@_name'] || cNvPr.name || '',
    embed_ref: embed,
    bounds: {
      x: parseInt(xfrm['a:off']?.['@_x'] || xfrm.off?.x || '0', 10) / 914400,
      y: parseInt(xfrm['a:off']?.['@_y'] || xfrm.off?.y || '0', 10) / 914400,
      width: parseInt(xfrm['a:ext']?.['@_cx'] || xfrm.ext?.cx || '0', 10) / 914400,
      height: parseInt(xfrm['a:ext']?.['@_cy'] || xfrm.ext?.cy || '0', 10) / 914400,
    },
  };
}

/**
 * 解析单个 anchor
 * @param {object} anchor
 * @param {string} anchorType
 * @param {object} shapeIndex
 * @returns {{ elements: object[], connectors: object[], pictures: object[], warnings: string[] }}
 */
function parseAnchor(anchor, anchorType, shapeIndex) {
  const elements = [];
  const connectors = [];
  const pictures = [];
  const warnings = [];

  // 移除 anchorType 中的 xdr: 前缀
  const normalizedAnchorType = anchorType.replace('xdr:', '');

  // 形状
  const sp = anchor['xdr:sp'] || anchor.sp;
  if (sp) {
    elements.push({ ...parseShape(sp), anchor_type: normalizedAnchorType });
  }

  // 连接器
  const cxnSp = anchor['xdr:cxnSp'] || anchor.cxnSp;
  if (cxnSp) {
    const result = parseConnector(cxnSp, shapeIndex);
    connectors.push({ ...result.connector, anchor_type: normalizedAnchorType });
    warnings.push(...result.warnings);
  }

  // 图片
  const pic = anchor['xdr:pic'] || anchor.pic;
  if (pic) {
    pictures.push({ ...parsePicture(pic), anchor_type: normalizedAnchorType });
  }

  return { elements, connectors, pictures, warnings };
}

/**
 * 解析单个 drawing XML
 * @param {string} drawingXml
 * @param {string} drawingPart
 * @param {object} [limits] - 可选安全限制覆盖
 * @returns {Promise<{ elements: object[], connectors: object[], pictures: object[], warnings: string[] }>}
 */
async function parseDrawingXml(drawingXml, drawingPart, limits) {
  let parsed;
  try {
    parsed = await parseXml(drawingXml, drawingPart, limits);
  } catch (error) {
    // XML 解析失败，产生 warning 并返回空结果
    return {
      elements: [],
      connectors: [],
      pictures: [],
      warnings: [{
        code: 'DRAWINGML_CORRUPTED_XML',
        message: `Failed to parse drawing XML in ${drawingPart}: ${error.message}`,
        target: drawingPart,
      }],
    };
  }

  const wsDr = parsed?.['xdr:wsDr'] || parsed?.wsDr || {};

  // 检查是否是有效的 DrawingML 结构
  if (!wsDr || Object.keys(wsDr).length === 0 || (!wsDr['xdr:twoCellAnchor'] && !wsDr['xdr:oneCellAnchor'] && !wsDr['xdr:absoluteAnchor'])) {
    // 不是有效的 DrawingML 结构，产生 warning
    return {
      elements: [],
      connectors: [],
      pictures: [],
      warnings: [{
        code: 'DRAWINGML_CORRUPTED_XML',
        message: `Invalid DrawingML structure in ${drawingPart}: missing wsDr or anchor elements`,
        target: drawingPart,
      }],
    };
  }

  const allElements = [];
  const allConnectors = [];
  const allPictures = [];
  const allWarnings = [];

  // 构建形状索引（用于连接器引用解析）
  const shapeIndex = {};

  // 第一遍：收集所有形状 ID
  const anchorTypes = ['xdr:twoCellAnchor', 'xdr:oneCellAnchor', 'xdr:absoluteAnchor'];
  for (const anchorType of anchorTypes) {
    const anchors = wsDr[anchorType] || [];
    const anchorArray = Array.isArray(anchors) ? anchors : [anchors];

    for (const anchor of anchorArray) {
      const sp = anchor['xdr:sp'] || anchor.sp;
      if (sp) {
        const nvSpPr = sp['xdr:nvSpPr'] || sp.nvSpPr || {};
        const cNvPr = nvSpPr['xdr:cNvPr'] || nvSpPr.cNvPr || {};
        const id = String(cNvPr['@_id'] || cNvPr.id || '');
        if (id) shapeIndex[id] = true;
      }
    }
  }

  // 第二遍：解析所有元素
  for (const anchorType of anchorTypes) {
    const anchors = wsDr[anchorType] || [];
    const anchorArray = Array.isArray(anchors) ? anchors : [anchors];

    for (const anchor of anchorArray) {
      const result = parseAnchor(anchor, anchorType, shapeIndex);
      allElements.push(...result.elements);
      allConnectors.push(...result.connectors);
      allPictures.push(...result.pictures);
      allWarnings.push(...result.warnings);
    }
  }

  return {
    elements: allElements,
    connectors: allConnectors,
    pictures: allPictures,
    warnings: allWarnings,
  };
}

/**
 * 检查 XLSX 包是否包含 DrawingML 内容
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {object} [options.limits] - 可选安全限制覆盖（只允许收紧）
 * @returns {Promise<{ hasDrawingml: boolean, hasEditableShapes: boolean, hasRasterOnly: boolean, sheets: object[], warnings: string[] }>}
 */
export async function inspectDrawingmlPackage(buffer, options = {}) {
  const limits = options.limits;
  const JSZip = await loadJszip();
  const zip = await JSZip.loadAsync(buffer);
  const warnings = [];

  // 安全检查
  const safety = validateZipSafety(zip, limits);
  if (!safety.valid) {
    throw new Error(`ZIP safety validation failed: ${safety.errors.join('; ')}`);
  }

  // 解析 workbook relationships
  const workbookRelsPath = 'xl/_rels/workbook.xml.rels';
  if (!zip.files[workbookRelsPath]) {
    return { hasDrawingml: false, hasEditableShapes: false, hasRasterOnly: false, sheets: [], warnings };
  }

  const workbookRelsXml = await zip.files[workbookRelsPath].async('string');
  const workbookRels = await parseRelationships(workbookRelsXml, workbookRelsPath, limits);

  // 查找所有 worksheet（过滤外部 TargetMode）
  const worksheetRels = workbookRels.filter(r =>
    r.type.endsWith('/worksheet') && isSafeTarget(r.target) && r.targetMode !== 'External'
  );

  const sheets = [];
  let hasDrawingml = false;
  let hasEditableShapes = false;
  let hasRasterOnly = false;

  for (const wsRel of worksheetRels) {
    const sheetPath = `xl/${wsRel.target}`;
    if (!zip.files[sheetPath]) continue;

    const sheetXml = await zip.files[sheetPath].async('string');
    const parsed = await parseXml(sheetXml, sheetPath, limits);
    const sheetData = parsed?.worksheet || {};
    const sheetName = sheetData.sheet?.['@_name'] || wsRel.target.replace('worksheets/', '').replace('.xml', '');

    // 检查是否有单元格数据
    const rows = sheetData.sheetData?.row || [];
    const rowArray = Array.isArray(rows) ? rows : [rows];
    let cellCount = 0;
    for (const row of rowArray) {
      const cells = row.c || [];
      const cellArray = Array.isArray(cells) ? cells : [cells];
      cellCount += cellArray.length;
    }

    // 查找 drawing reference
    const drawingRef = sheetData.drawing?.['@_r:id'] || sheetData.drawing?.['r:id'] || null;
    let drawingPart = null;
    let hasDrawingInSheet = false;
    let hasEditableInSheet = false;
    let hasRasterInSheet = false;

    // 检查是否有多个 drawing 引用（歧义）
    const drawings = Array.isArray(sheetData.drawing) ? sheetData.drawing : (sheetData.drawing ? [sheetData.drawing] : []);
    if (drawings.length > 1) {
      const drawingIds = drawings.map(d => d['@_r:id'] || d['r:id']).filter(Boolean);
      warnings.push({
        code: 'DRAWINGML_AMBIGUOUS_DRAWING_REL',
        message: 'Sheet has multiple drawing references, ambiguous which to parse',
        target: drawingIds.join(','),
      });
      // 歧义时跳过解析，但仍然记录 sheet
      sheets.push({
        name: sheetName,
        has_drawing: false,
        cell_count: cellCount,
      });
      continue;
    }

    if (drawingRef) {
      // 解析 worksheet relationships
      const sheetRelsPath = `xl/worksheets/_rels/${wsRel.target.split('/').pop()}.rels`;
      if (zip.files[sheetRelsPath]) {
        const sheetRelsXml = await zip.files[sheetRelsPath].async('string');
        const sheetRels = await parseRelationships(sheetRelsXml, sheetRelsPath, limits);

        // 找到匹配的 drawing relationship（唯一匹配，不静默接受重复 ID）
        const matchingDrels = sheetRels.filter(r => r.id === drawingRef && r.type.endsWith('/drawing'));

        if (matchingDrels.length === 0) {
          warnings.push({
            code: 'DRAWINGML_MISSING_DRAWING_REL',
            message: `No drawing relationship found for ref ${drawingRef} in ${sheetRelsPath}`,
            target: drawingRef,
          });
        } else if (matchingDrels.length > 1) {
          warnings.push({
            code: 'DRAWINGML_AMBIGUOUS_DRAWING_REL',
            message: `Multiple drawing relationships match ref ${drawingRef} in ${sheetRelsPath}`,
          });
        } else {
          const drawingRel = matchingDrels[0];
          const resolvedPath = resolveRelationshipTarget(drawingRel, wsRel.target.replace(/[^/]+$/, ''), sheetRelsPath, warnings);

          if (resolvedPath && zip.files[resolvedPath]) {
            drawingPart = resolvedPath;
            hasDrawingInSheet = true;

            // 检查是否有可编辑形状
            const drawingXml = await zip.files[resolvedPath].async('string');
            // 使用更精确的检查，避免误匹配 <xdr:spPr> 等
            const hasSp = /<xdr:sp[\s>]/.test(drawingXml) || /<sp[\s>]/.test(drawingXml);
            const hasCxnSp = /<xdr:cxnSp[\s>]/.test(drawingXml) || /<cxnSp[\s>]/.test(drawingXml);
            const hasPic = /<xdr:pic[\s>]/.test(drawingXml) || /<pic[\s>]/.test(drawingXml);

            hasEditableInSheet = hasSp || hasCxnSp;
            hasRasterInSheet = hasPic && !hasSp && !hasCxnSp;

            // 只有在有可编辑形状时才标记为有 DrawingML
            if (hasEditableInSheet) {
              hasDrawingml = true;
              hasEditableShapes = true;
            }
            if (hasRasterInSheet) hasRasterOnly = true;
          } else if (resolvedPath) {
            warnings.push({
              code: 'DRAWINGML_MISSING_DRAWING_PART',
              message: `Drawing part ${resolvedPath} not found in ZIP for sheet ${sheetName}`,
            });
          }
        }
      }
    }

    sheets.push({
      name: sheetName,
      cell_count: cellCount,
      has_drawing: hasDrawingInSheet,
      has_editable_shapes: hasEditableInSheet,
      has_raster_only: hasRasterInSheet,
      drawing_part: drawingPart,
    });
  }

  return { hasDrawingml, hasEditableShapes, hasRasterOnly, sheets, warnings };
}

/**
 * 提取 DrawingML 内容
 * @param {Buffer} buffer
 * @param {object} [options]
 * @param {object} [options.limits] - 可选安全限制覆盖（只允许收紧）
 * @returns {Promise<{ elements: object[], connectors: object[], metadata: object, warnings: string[] }>}
 */
export async function extractDrawingml(buffer, options = {}) {
  const limits = options.limits;
  const JSZip = await loadJszip();
  const zip = await JSZip.loadAsync(buffer);

  // 安全检查
  const safety = validateZipSafety(zip, limits);
  if (!safety.valid) {
    throw new Error(`ZIP safety validation failed: ${safety.errors.join('; ')}`);
  }

  const allElements = [];
  const allConnectors = [];
  const allPictures = [];
  const allWarnings = [];
  const sheetsMetadata = [];

  // 检查 workbook XML 安全性
  const workbookPath = 'xl/workbook.xml';
  if (zip.files[workbookPath]) {
    const workbookXml = await zip.files[workbookPath].async('string');
    validateXmlSafety(workbookXml, workbookPath, limits);
  }

  // 解析 workbook relationships
  const workbookRelsPath = 'xl/_rels/workbook.xml.rels';
  if (!zip.files[workbookRelsPath]) {
    return { elements: [], connectors: [], metadata: { sheets: [] }, warnings: [] };
  }

  const workbookRelsXml = await zip.files[workbookRelsPath].async('string');
  const workbookRels = await parseRelationships(workbookRelsXml, workbookRelsPath, limits);

  // 查找所有 worksheet（过滤外部 TargetMode）
  const worksheetRels = workbookRels.filter(r =>
    r.type.endsWith('/worksheet') && isSafeTarget(r.target) && r.targetMode !== 'External'
  );

  // 按 sheet 和 drawing part 排序，确保确定性
  const sortedWorksheetRels = [...worksheetRels].sort((a, b) => a.target.localeCompare(b.target));

  for (const wsRel of sortedWorksheetRels) {
    const sheetPath = `xl/${wsRel.target}`;
    if (!zip.files[sheetPath]) continue;

    const sheetXml = await zip.files[sheetPath].async('string');
    const parsed = await parseXml(sheetXml, sheetPath, limits);
    const sheetData = parsed?.worksheet || {};
    const sheetName = sheetData.sheet?.['@_name'] || wsRel.target.replace('worksheets/', '').replace('.xml', '');

    // 查找 drawing reference
    const drawingRef = sheetData.drawing?.['@_r:id'] || sheetData.drawing?.['r:id'] || null;

    if (drawingRef) {
      // 解析 worksheet relationships
      const sheetRelsPath = `xl/worksheets/_rels/${wsRel.target.split('/').pop()}.rels`;
      if (zip.files[sheetRelsPath]) {
        const sheetRelsXml = await zip.files[sheetRelsPath].async('string');
        const sheetRels = await parseRelationships(sheetRelsXml, sheetRelsPath, limits);

        // 找到匹配的 drawing relationship（唯一匹配）
        const matchingDrels = sheetRels.filter(r => r.id === drawingRef && r.type.endsWith('/drawing'));

        if (matchingDrels.length === 0) {
          allWarnings.push({
            code: 'DRAWINGML_MISSING_DRAWING_REL',
            message: `No drawing relationship found for ref ${drawingRef} in ${sheetRelsPath}`,
            target: drawingRef,
          });
        } else if (matchingDrels.length > 1) {
          allWarnings.push({
            code: 'DRAWINGML_AMBIGUOUS_DRAWING_REL',
            message: `Multiple drawing relationships match ref ${drawingRef} in ${sheetRelsPath}`,
          });
        } else {
          const drawingRel = matchingDrels[0];
          const normalizedDrawingPart = resolveRelationshipTarget(drawingRel, wsRel.target.replace(/[^/]+$/, ''), sheetRelsPath, allWarnings);

          if (normalizedDrawingPart && zip.files[normalizedDrawingPart]) {
            const drawingXml = await zip.files[normalizedDrawingPart].async('string');
            const result = await parseDrawingXml(drawingXml, normalizedDrawingPart, limits);

            // 为每个元素添加 locator 信息
            for (const element of result.elements) {
              allElements.push({
                ...element,
                sheet: sheetName,
                drawing_part: normalizedDrawingPart,
                shape_id: element.shape_id,
              });
            }

            for (const connector of result.connectors) {
              allConnectors.push({
                ...connector,
                sheet: sheetName,
                drawing_part: normalizedDrawingPart,
                connector_id: connector.shape_id,
              });
            }

            for (const picture of result.pictures) {
              allPictures.push({
                ...picture,
                sheet: sheetName,
                drawing_part: normalizedDrawingPart,
              });
            }

            allWarnings.push(...result.warnings);

            sheetsMetadata.push({
              sheet: sheetName,
              drawing_part: normalizedDrawingPart,
              element_count: result.elements.length,
              connector_count: result.connectors.length,
              picture_count: result.pictures.length,
            });
          } else if (normalizedDrawingPart) {
            allWarnings.push({
              code: 'DRAWINGML_MISSING_DRAWING_PART',
              message: `Drawing part ${normalizedDrawingPart} not found in ZIP for sheet ${sheetName}`,
            });
          }
        }
      }
    }
  }

  // 按稳定键排序输出
  allElements.sort((a, b) => {
    const keyA = `${a.sheet}:${a.drawing_part}:${a.shape_id}`;
    const keyB = `${b.sheet}:${b.drawing_part}:${b.shape_id}`;
    return keyA.localeCompare(keyB);
  });

  allConnectors.sort((a, b) => {
    const keyA = `${a.sheet}:${a.drawing_part}:${a.connector_id}`;
    const keyB = `${b.sheet}:${b.drawing_part}:${b.connector_id}`;
    return keyA.localeCompare(keyB);
  });

  allPictures.sort((a, b) => {
    const keyA = `${a.sheet}:${a.drawing_part}:${a.shape_id}`;
    const keyB = `${b.sheet}:${b.drawing_part}:${b.shape_id}`;
    return keyA.localeCompare(keyB);
  });

  // 去重 warnings（基于 code 和 message）
  const uniqueWarnings = [];
  const warningKeys = new Set();
  for (const warning of allWarnings) {
    const key = `${warning.code}:${warning.message}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      uniqueWarnings.push(warning);
    }
  }

  return {
    elements: allElements,
    connectors: allConnectors,
    pictures: allPictures,
    metadata: {
      sheets: sheetsMetadata,
    },
    warnings: uniqueWarnings,
  };
}
