/**
 * Maps file extensions to their classification capabilities.
 *
 * Each value is an array of capability strings that describe:
 *   - kind:          DIAGRAM | ARCHITECTURE | MIXED
 *   - parse_mode:    STRUCTURED | SEMI_STRUCTURED | VISUAL_ONLY
 *   - capability:    Specific capability tag (e.g. BPMN_STRUCTURE, VISUAL_GEOMETRY)
 *
 * The first element is used as `kind`, second as `parse_mode`.
 */
export const formatCapabilities = {
  '.bpmn':    ['DIAGRAM', 'STRUCTURED', 'BPMN_STRUCTURE'],
  '.xml':     ['DIAGRAM', 'STRUCTURED', 'BPMN_STRUCTURE'],
  '.mmd':     ['DIAGRAM', 'STRUCTURED', 'MERMAID_STRUCTURE'],
  '.mermaid': ['DIAGRAM', 'STRUCTURED', 'MERMAID_STRUCTURE'],
  '.svg':     ['DIAGRAM', 'SEMI_STRUCTURED', 'VISUAL_GEOMETRY'],
  '.png':     ['DIAGRAM', 'VISUAL_ONLY'],
  '.jpg':     ['DIAGRAM', 'VISUAL_ONLY'],
  '.jpeg':    ['DIAGRAM', 'VISUAL_ONLY'],
  '.json':    ['ARCHITECTURE', 'STRUCTURED'],
  '.yaml':    ['ARCHITECTURE', 'STRUCTURED'],
  '.yml':     ['ARCHITECTURE', 'STRUCTURED'],
  '.csv':     ['ARCHITECTURE', 'STRUCTURED'],
  '.xlsx':    ['ARCHITECTURE', 'STRUCTURED'], // 默认值，实际分类需要检查内容
  '.md':      ['ARCHITECTURE', 'SEMI_STRUCTURED'],
  '.docx':    ['ARCHITECTURE', 'SEMI_STRUCTURED'],
  '.pdf':     ['MIXED', 'SEMI_STRUCTURED'],
};

/**
 * 根据 XLSX 内容动态分类
 *
 * 分类矩阵：
 * | 单元格数据 | 可编辑形状/连接器 | 仅嵌入图片 | kind | parse_mode | 关键 capability |
 * |---|---|---|---|---|---|
 * | 有 | 无 | 否 | ARCHITECTURE | STRUCTURED | XLSX_TABLE |
 * | 无 | 有 | 否 | DIAGRAM | STRUCTURED | DRAWINGML_STRUCTURE |
 * | 有 | 有 | 否/有 | MIXED | STRUCTURED | XLSX_TABLE + DRAWINGML_STRUCTURE |
 * | 无 | 无 | 是 | DIAGRAM | VISUAL_ONLY | VISUAL_ONLY |
 * | 有 | 无 | 是 | MIXED | SEMI_STRUCTURED | XLSX_TABLE + VISUAL_ONLY |
 *
 * @param {{ cell_count: number, has_editable_shapes: boolean, has_raster_only: boolean }} inspection
 * @returns {{ kind: string, parse_mode: string, capabilities: string[] }}
 */
export function classifyXlsxContent(inspection) {
  const { cell_count = 0, has_editable_shapes = false, has_raster_only = false } = inspection;
  const hasCellData = cell_count > 0;

  // 纯表格
  if (hasCellData && !has_editable_shapes && !has_raster_only) {
    return {
      kind: 'ARCHITECTURE',
      parse_mode: 'STRUCTURED',
      capabilities: ['XLSX_TABLE'],
    };
  }

  // 纯原生图
  if (!hasCellData && has_editable_shapes && !has_raster_only) {
    return {
      kind: 'DIAGRAM',
      parse_mode: 'STRUCTURED',
      capabilities: ['DRAWINGML_STRUCTURE'],
    };
  }

  // 表格+原生图
  if (hasCellData && has_editable_shapes) {
    return {
      kind: 'MIXED',
      parse_mode: 'STRUCTURED',
      capabilities: ['XLSX_TABLE', 'DRAWINGML_STRUCTURE'],
    };
  }

  // 纯图片
  if (!hasCellData && !has_editable_shapes && has_raster_only) {
    return {
      kind: 'DIAGRAM',
      parse_mode: 'VISUAL_ONLY',
      capabilities: ['VISUAL_ONLY'],
    };
  }

  // 表格+图片
  if (hasCellData && !has_editable_shapes && has_raster_only) {
    return {
      kind: 'MIXED',
      parse_mode: 'SEMI_STRUCTURED',
      capabilities: ['XLSX_TABLE', 'VISUAL_ONLY'],
    };
  }

  // 默认：空工作簿
  return {
    kind: 'ARCHITECTURE',
    parse_mode: 'STRUCTURED',
    capabilities: ['XLSX_TABLE'],
  };
}
