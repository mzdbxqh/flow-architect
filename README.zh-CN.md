# Flow Architect

Flow Architect 是面向 Codex 与 Claude Code 的流程架构与流程图评审技能族，同时提供流程初稿和离线会议包创建能力。

## 快速安装

Codex 稳定版：

```bash
codex plugin marketplace add mzdbxqh/flow-architect --ref v0.4.0
codex plugin add flow-architect@flow-architect
```

Claude Code Marketplace（推荐）：

```bash
/plugin marketplace add mzdbxqh/flow-architect
/plugin install flow-architect@flow-architect
/reload-plugins
/flow-architect:help
/flow-architect:setup
```

`setup` 默认安装 core，并让用户选择 PDF、DOCX、XLSX；依赖写入用户缓存，不写入 Git 仓库或插件目录。

完整的安装、入口选择、提示词示例、更新、卸载和故障排查见[中文用户手册](docs/zh-CN/user-guide.md)。

### 从源码验证（贡献者）

如需从源码验证插件或参与开发：

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
cd flow-architect
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

此方式仅供贡献者使用；普通用户应通过上方的市场安装方式。

## 最小验证示例

安装完成后，运行帮助命令验证是否正常工作：

```bash
# Claude Code
/flow-architect:help

# Codex
$flow-architect-help
```

此只读命令会展示所有可用技能、运行时状态、支持格式、示例和诊断信息，不会修改任何文件。如果看到能力表格和运行时状态，说明安装成功。

## 入口 Skill

| Skill | 用途 |
|---|---|
| `flow-architect` | 默认入口；盘点输入并路由至联合评审 |
| `flow-architect-flow-review-integrated` | 联合评审流程架构与流程图 |
| `flow-architect-flow-review-architecture` | 仅评审 L4/L5/L6/SOP 分层架构 |
| `flow-architect-flow-review-diagram` | 仅评审 BPMN、Mermaid、SVG、PNG 或 PDF 流程图 |
| `flow-architect-build-meeting-package` | 从一份完整 V2 流程草稿构建可离线编辑的 HTML 讨论包 |
| `flow-architect-draft-process` | 从多种来源材料生成 L5 BPMN 流程初稿（确定性抽取与生成，零 LLM） |
| `flow-architect-help` | 查看能力、格式、状态、示例和诊断 |
| `flow-architect-setup` | 初始化 core 和用户选择的可选运行时组件 |

默认入口 Skill（`flow-architect`）盘点输入文件、识别制品族并路由至对应评审流程。三个流程 Skill 也可在已知评审需求时直接调用。

## 支持的输入格式

**流程架构：** JSON、YAML、CSV、XLSX、Markdown、DOCX、文本型 PDF。

**流程图：** BPMN 2.0 XML、Mermaid、SVG、PNG、JPEG、扫描 PDF。

## 安全起步

<!-- release-skill:capability:safe-first-command -->

最安全的第一条命令是 **`/flow-architect:help`** — 它是只读的，会展示所有可用技能、运行时状态、支持格式、示例和诊断信息，不会修改任何文件。

## 能力边界

<!-- release-skill:capability:external-write-boundary -->

评审技能为**只读**：检查现有制品并输出结构化 Finding，不修改原始输入。

创建技能（`flow-architect-draft-process`、`flow-architect-build-meeting-package`）**仅在**用户授权的独立运行目录创建新制品，不修改原始输入。初稿生成全程确定性（零 LLM）：抽取、分批、BPMN 生成、HTML 打包均为纯代码；LLM 仅在逐批语义解释时调用。两条路径互补：初稿产出可评审的制品，评审技能评估这些制品。

## 流程初稿 — 格式支持

| 格式 | 状态 | 说明 |
|------|------|------|
| Markdown (.md) | ✅ 完整支持 | 按标题分块，保留行号 |
| PDF (.pdf) | ✅ 完整支持 | 按页提取，低文本页标记为视觉 |
| DOCX (.docx) | ✅ 完整支持 | 提取文字内容 |
| XLSX (.xlsx) | ✅ 完整支持 | 按实际 OOXML 内容动态分类，支持表格、原生 DrawingML、图片及混合输入；明确 ID 关系才形成连接，缺失或多义时 warning/降级，不按几何距离猜线 |
| PPTX (.pptx) | ⚠️ 需要组件 | 通过 `/flow-architect:setup` 或 `$flow-architect-setup` 安装 |
| PNG/JPEG (.png/.jpg) | ⚠️ 视觉资产 | 标记为视觉，不 OCR |
| BPMN (.bpmn) | ✅ 完整支持 | 提取元素和流转 |
| Mermaid / SVG | ✅ 完整支持 | 提取结构 |

## 流程初稿 — 会前/线下/会后流程

**会前生成：** 从来源材料生成一份 V2 流程草稿，由确定性编译器生成 BPMN XML/DI 和离线 HTML 讨论包。仅末端 L4 交付完整"一图两表"；L1～L3 和非末端 L4 只有流程卡片，图和活动表不适用。

**线下讨论：** 在浏览器中打开 HTML（无需联网），在同一个文件中查看和编辑流程图、流程卡片、活动一览表与待确认问题。

**一图两表与四页签：** 封装在同一个离线 HTML 的四个页签：

| 页签 | 内容 |
|------|------|
| 流程图 | BPMN 流程图，支持泳道、XOR/AND/OR 网关、受支持的中间事件、多个业务结束事件和顺序流 |
| 流程卡片 | 流程名称、层级、描述、目的、责任人、输入/输出、绩效指标等 |
| L5 活动一览表 | 活动名称、描述、角色与 RASCI/OARP、SLA/LT、工具、输入、处理概要、输出、自工序完结标准、参考制度/标准/规范 |
| 待确认问题 | 待确认问题列表，支持与流程元素双向定位 |

**L5 活动与 Task 关系：** 每个 L5 活动恰好一个主 Task，最多一个串行确认从 Task；网关、中间事件和结束事件不是 L5 活动。

**模型与程序分工：**

- **模型不绘图：** 模型只输出受 Schema 约束的结构化业务事实和不确定项，不生成 BPMN XML、DI、坐标、折点、SVG 或 HTML。
- **确定性程序负责：** 编译、布局、重排与导出。
- **有限工具箱：** HTML 使用有限业务工具箱。
- **结构操作后确定性重排：** 每次结构操作后按固定算法全图重排，不保留手工坐标为权威状态。

**五类导出：** HTML 可导出新修订 HTML、BPMN、SVG、问题 JSON、完整 V2 JSON；不导出 XLSX。

**会后比对：** 使用 `extract-meeting-package.mjs` 抽取导出的 HTML 版本，用 `compare-package-revisions.mjs` 与原稿进行版本比较，将确认的变更作为下一轮输入继续补全。

## 流程初稿 — 缓存与恢复

准备阶段的结果按运行目录缓存。相同输入重新运行时，缓存批次直接复用（队列状态 `CACHED`），仅新增或变更的输入进入 `PENDING`。若缓存批次损坏（哈希不匹配、证据漂移），对应项回退为 `PENDING`，其他合法缓存项仍保持 `CACHED`。

## 流程初稿 — 确定性零 LLM 阶段

以下阶段纯确定性运行，零 LLM 调用：

- **归一化：** 异构输入（MD、PDF、DOCX、XLSX、PPTX、BPMN、Mermaid、SVG）转换为可定位 Markdown 分片。
- **抽取：** 从源文件提取文本、表格和结构化图表。
- **分批：** 证据拆分为 ≤12,000 字符、≤12 blocks、≤1 visual 的批次，每批包含上下文预算报告。
- **预算门禁：** 三态预算（BUDGET_OK / BUDGET_ATTENTION / BUDGET_SPLIT_REQUIRED）。超过 token 限 120% 的批次禁止启动 Worker。
- **BPMN 生成：** 从合并的语义片段生成 L5 BPMN 2.0 XML + DI。
- **HTML 打包：** 组装包含流程图、问题和元数据的离线会议包。

仅逐批语义解释（fragment 生产）可能调用 LLM worker。

## 离线会议包构建

从一份完整的 V2 流程草稿构建可在 Chrome/Edge 打开的离线 HTML 讨论包：

```bash
node scripts/build-single-diagram-html.mjs \
  --draft ./process-draft.json \
  --title "采购审批流程" \
  --revision r01 \
  --package-id procurement-approval \
  --run-dir ./runs/meeting-package \
  --output procurement-r01.html
```

V2 草稿是唯一业务数据源，必须包含 `process_card`、`activities`、`diagram` 和 `questions`。BPMN XML 与 DI 由确定性编译器生成，命令不接收模型绘制的坐标。

生成的 HTML：
- 无需联网即可打开和编辑
- 在同一文件中查看和编辑流程图、流程卡片、活动一览表
- 支持问题与流程元素双向定位
- 使用有限 BPMN 工具箱，所有图标为内联 SVG（无字体加载，严格 CSP 下正常工作）
- 工具栏编辑按钮在未选中元素时禁用，选中后启用
- 所有结构操作（中间事件、结束事件、泳道、网关、顺序流）使用业务对话框，带空值校验
- 顺序流连接自动过滤自环和非法目标
- 首访引导条说明操作方式，可关闭并持久化
- 切换到非流程图标签页时画布完全隐藏
- 每次结构操作后确定性全图重排
- 可导出新版本 HTML、BPMN、SVG、问题 JSON 和完整 V2 JSON
- 所有导出经 JSON Schema 门禁校验（CSP 安全的 Ajv 预编译）

## 置信度降级

图片和扫描 PDF 以视觉分析为主。仅基于图片输入得出的结构推断，置信度上限为 0.6，可能需要业务确认。插件不会从图片中产生虚假的精确 BPMN 元素级结论。

## 运行目录

每次评审会话创建结构化的运行目录：

```text
runs/flow-architect/<run-id>/
├── input/
│   └── input-manifest.json
├── stages/
│   ├── 10-inspect/
│   ├── 20-extract-architecture/
│   ├── 21-extract-diagram/
│   ├── 30-review-l4/
│   ├── 31-review-l5/
│   ├── 32-review-l6/
│   ├── 33-review-sop/
│   ├── 40-review-hierarchy/
│   ├── 41-review-bpmn/
│   ├── 42-review-visual/
│   ├── 50-review-consistency/
│   └── 60-validate/
└── final/
    ├── result.json
    ├── review-verdict.json
    └── review-report.md
```

运行根目录由用户或目标项目决定，不写入已安装插件目录。

## 故障排查

### 安装失败

- **Codex：** 运行 `codex plugin list` 检查插件是否已注册。如果未注册，运行 `codex plugin marketplace list` 验证市场访问。
- **Claude Code：** 运行 `/plugin list` 验证安装。如果插件未出现，尝试 `/reload-plugins` 或参见[中文用户手册](docs/zh-CN/user-guide.md)。

### 帮助命令不可见

- **Claude Code：** 确保安装后运行了 `/reload-plugins`。如果仍不可见，尝试重启 Claude Code 会话。
- **Codex：** 运行 `codex plugin list` 验证插件已安装。帮助命令应显示为 `$flow-architect-help`。

### 运行时组件未就绪

- 运行 `/flow-architect:setup`（Claude Code）或 `$flow-architect-setup`（Codex）初始化 core 和可选组件。
- 运行 `/flow-architect:help` 或 `$flow-architect-help` 检查运行时状态和诊断信息。
- 参见[中文用户手册](docs/zh-CN/user-guide.md)了解缓存诊断和恢复步骤。

### PPTX 支持缺失

- PPTX 处理需要额外组件。通过 `/flow-architect:setup` 或 `$flow-architect-setup` 安装，并在提示时选择 PPTX 选项。

## 隐私边界

发布的包（`@flow-architect/plugin`）仅包含通用化规则、Schema、脚本和适配器。它不包含：

- 私有来源方法论文档
- 内部制品 ID 或项目特定引用
- 绝对用户路径或环境特定配置
- 专有方法论术语或原始培训材料

所有私有资料保留在父工作区，通过 `public-release.json` 治理和自动泄漏扫描排除在发布包之外。

## 许可证

Apache-2.0
