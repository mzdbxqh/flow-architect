# DrawingML 输入合同

## 概述

本文档定义了 Flow Architect 对 XLSX 文件中 DrawingML 内容的解析边界和行为规范。DrawingML 解析只提供业务事实和证据，不生成或修复几何、连接关系、BPMN XML、DI 或 HTML。

## 分类矩阵

XLSX 输入根据实际 OOXML 内容动态分类，不再由 `.xlsx` 扩展名固定决定：

| 单元格数据 | 可编辑形状/连接器 | 仅嵌入图片 | kind | parse_mode | 关键 capability |
|---|---|---|---|---|---|
| 有 | 无 | 否 | ARCHITECTURE | STRUCTURED | XLSX_TABLE |
| 无 | 有 | 否 | DIAGRAM | STRUCTURED | DRAWINGML_STRUCTURE |
| 有 | 有 | 否/有 | MIXED | STRUCTURED | XLSX_TABLE + DRAWINGML_STRUCTURE |
| 无 | 无 | 是 | DIAGRAM | VISUAL_ONLY | VISUAL_ONLY |
| 有 | 无 | 是 | MIXED | SEMI_STRUCTURED | XLSX_TABLE + VISUAL_ONLY |

### 分类规则

1. **单元格数据**：工作表中至少有一个非空单元格
2. **可编辑形状/连接器**：`<xdr:sp>` 或 `<xdr:cxnSp>` 元素
3. **仅嵌入图片**：只有 `<xdr:pic>` 元素，无 `<xdr:sp>` 或 `<xdr:cxnSp>`
4. **空工作簿**：无单元格数据、无形状、无图片 → 降级为 ARCHITECTURE/STRUCTURED

## 支持的 OOXML 对象

### 锚点类型

- `twoCellAnchor`：双单元格锚点（起始和结束单元格）
- `oneCellAnchor`：单单元格锚点（起始单元格 + 固定尺寸）
- `absoluteAnchor`：绝对锚点（固定位置和尺寸）

### 形状元素

- `xdr:sp`：可编辑形状（矩形、菱形、圆形等）
- `xdr:cxnSp`：连接器（直线、折线、曲线等）
- `xdr:pic`：嵌入图片

### 形状属性

- `shape_id`：形状唯一标识符
- `name`：形状名称
- `text`：形状文本内容
- `preset_geometry`：预设几何类型（rect、roundRect、diamond 等）
- `fill_color`：填充颜色（十六进制）
- `bounds`：边界信息（x、y、width、height）

### 连接器属性

- `connector_id`：连接器唯一标识符
- `source_ref`：起始形状 ID（仅当 OOXML 中存在明确 ID 关系时）
- `target_ref`：结束形状 ID（仅当 OOXML 中存在明确 ID 关系时）
- `start_connection`：起始连接点信息
- `end_connection`：结束连接点信息
- `has_arrow`：是否有箭头
- `arrow_type`：箭头类型

## 显式连接关系原则

连接器只有在 OOXML 中存在明确 ID 关系时才设置 `source_ref` / `target_ref`。

**禁止行为**：
- 按距离推断连接关系
- 按重叠推断连接关系
- 按模型猜测连线

**降级行为**：
- 引用缺失 → `source_ref` 或 `target_ref` 为 `null`
- 对象不存在 → `source_ref` 或 `target_ref` 为 `null`
- 多义情况 → 保留 `null` 和 warning

## UNKNOWN/视觉降级

### UNKNOWN_VISUAL_ELEMENT

当形状语义不明确时，使用 `UNKNOWN_VISUAL_ELEMENT` 作为形状类型，不直接冒充 BPMN Task/Gateway。

### VISUAL_ASSET

- 图片-only 工件产生 `VISUAL_ASSET` 降级证据
- 不产生 STRUCTURED_DIAGRAM 证据
- 应用置信度上限（0.5）

### VISUAL_ONLY

- 纯图片 XLSX 分类为 `DIAGRAM/VISUAL_ONLY/VISUAL_ONLY`
- 不包含可编辑形状或连接器

## Locator 字段

DrawingML evidence locator 必须真实携带以下字段：

### 必填字段（继承自 source-evidence.schema.json）

- `page`：PDF 页码（XLSX 为 null）
- `slide`：PPTX 幻灯片编号（XLSX 为 null）
- `sheet`：XLSX 工作表名称
- `range`：XLSX 单元格范围（DrawingML 为 null）
- `line_start`：起始行号（DrawingML 为 null）
- `line_end`：结束行号（DrawingML 为 null）

### 新增可选字段（DrawingML 专用）

- `drawing_part`：DrawingML drawing part 路径（如 `xl/drawings/drawing1.xml`）
- `shape_id`：DrawingML 形状 ID
- `connector_id`：DrawingML 连接器 ID
- `anchor_type`：锚点类型（`twoCellAnchor`、`oneCellAnchor`、`absoluteAnchor`）

### 示例

```json
{
  "locator": {
    "page": null,
    "slide": null,
    "sheet": "Sheet1",
    "range": null,
    "line_start": null,
    "line_end": null,
    "drawing_part": "xl/drawings/drawing1.xml",
    "shape_id": "1",
    "connector_id": null,
    "anchor_type": "twoCellAnchor"
  }
}
```

## 安全预算和禁止执行内容

### 硬上限

- ZIP 条目数：1000
- 总解压大小：100MB
- 压缩比：100:1
- XML 字符数：500,000

### 禁止执行内容

- 宏（VBA）
- 外部链接
- OLE/嵌入对象
- 公式
- 脚本

### 安全检查

- Zip Slip 防护
- 绝对 Target 检测
- 外部 relationship 检测
- 越出 `xl/` 包根的关系检测
- 重复/冲突部件检测

## 模型边界

### 模型只读业务事实

- 提取形状文本、类型、连接关系
- 不生成或修复几何
- 不生成或修复连接关系
- 不生成 BPMN XML、DI 或 HTML

### 确定性输出

- 相同字节输入重复调用必须深度相等
- 序列化结果字节一致
- 不读取当前时间、随机数或进程相关路径

## 接口定义

### inspectDrawingmlPackage

```javascript
inspectDrawingmlPackage(buffer)
// -> { hasDrawingml, hasEditableShapes, hasRasterOnly, sheets, warnings }
```

检查 XLSX 包是否包含 DrawingML 内容，返回分类信息。

### extractDrawingml

```javascript
extractDrawingml(buffer)
// -> { elements, connectors, metadata, warnings }
```

提取 DrawingML 内容，返回结构化数据。

## 降级策略

### DrawingML 缺少明确连接关系

- 保留几何邻接证据
- 不虚构连线
- `source_ref` 或 `target_ref` 为 `null`
- 生成 warning

### 形状语义不明确

- 使用 `UNKNOWN_VISUAL_ELEMENT`
- 不直接冒充 BPMN Task/Gateway

### 只有图片

- 按视觉输入处理
- 应用置信度上限（0.5）
- 不宣称为 DrawingML 图件

### OOXML 关系损坏

- 输出可定位错误
- 不宣称成功恢复完整流程
- 降级到可用的部分

## 实现约束

### 依赖隔离

- 通过 `requireRuntimePackage('xlsx', 'jszip')` 加载 ZIP
- 通过 core runtime 的 `fast-xml-parser` 解析 XML
- 不通过 pnpm store 私有路径偷加载
- 不从 exceljs 内部解析 jszip

### 测试覆盖

1. 两个 shape + 一个 connector，明确起止 ID、箭头和 two-cell anchor
2. one-cell、absolute anchor 至少各一个最小对象
3. 同一 DrawingML 输入运行两次深度相等、规范化 JSON 字节相同
4. 纯表格、纯原生图、表格+原生图、纯图片、表格+图片五类分类矩阵
5. 图片 fixture 不产生 editable shape/connector/STRUCTURED_DIAGRAM
6. 连接端缺失或引用不存在时 source/target 为 null，出现稳定 warning
7. workbook/worksheet/drawing relationship 正确映射 sheet 与 drawing part
8. ZIP entry/decompression/XML 字符预算至少各有一个失败关闭测试
9. TABLE 与 DrawingML evidence 同时存在时完整 block Oracle
10. 新 locator 字段经过 normalization 和 batching 后不丢失
