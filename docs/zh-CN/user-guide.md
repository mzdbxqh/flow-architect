# Flow Architect 中文用户手册

Flow Architect 是面向 Codex 与 Claude Code 的流程架构和流程图评审技能族，同时提供流程初稿和离线 HTML 会议包创建能力。评审入口只分析现有制品、给出证据和 Finding，不修改原始输入；创建入口在用户指定的独立运行目录创建新制品，支持生成离线 HTML 会议包用于线下讨论。

## 关键概念

- **末端 L4：** 只有末端 L4 交付完整"一图两表"；L1～L3 和非末端 L4 只有流程卡片，图和活动表不适用。
- **一图两表：** 实际封装在同一个离线 HTML 的四个页签：流程图、流程卡片、L5 活动一览表、待确认问题。
- **活动一览表字段：** 包含活动名称、描述、角色与 RASCI/OARP、SLA/LT、工具、输入、处理概要、输出、自工序完结标准、参考制度/标准/规范。
- **模型不绘图：** 模型只输出受 Schema 约束的结构化业务事实和不确定项，不生成 BPMN XML、DI、坐标、折点、SVG 或 HTML；确定性程序负责编译、布局、重排与导出。
- **有限工具箱：** HTML 使用有限业务工具箱，所有图标为内联 SVG（无需字体加载，严格 CSP 和离线条件下正常工作）。
- **编辑按钮选择态：** 工具栏编辑按钮在未选中元素时禁用，选中图元素后启用，避免无效操作。
- **业务对话框：** 中间事件、结束事件、泳道、网关、顺序流均通过业务对话框操作，带空值校验，取消不改合同。
- **顺序流门禁：** 自环、从结束事件出发、指向开始事件均被拦截。
- **首访引导条：** 首次打开显示操作说明引导条，可关闭并持久化到 `localStorage`。
- **标签页画布显隐：** 切换到非流程图标签页时 BPMN 画布完全隐藏。
- **结构操作后确定性重排：** 每次结构操作后按固定算法全图重排，不保留手工坐标为权威状态。
- **五类导出：** HTML、BPMN、SVG、问题 JSON、完整 V2 JSON；不导出 XLSX。所有导出经 JSON Schema 门禁校验（CSP 安全的 Ajv 预编译）。

## 1. 能评审什么

- 流程架构：JSON、YAML、CSV、XLSX、Markdown、DOCX、文本型 PDF。
- 流程图：BPMN 2.0 XML、Mermaid、SVG、PNG、JPEG、扫描 PDF。
- 联合评审：同时检查 L4/L5/L6/SOP 分层、BPMN 或视觉质量，以及架构与流程图之间的一致性。

图片和扫描 PDF 只能提供视觉证据。仅由图片推断的结构结论置信度最高为 0.6，报告会明确标记需要业务确认的内容。

### 上下文预算

所有输入先经过确定性 Markdown 归一化，再按预算拆分为有界批次和材料包：

| 项目 | 基准限制 | 120% 阻断线 |
|---|---|---|
| 原始 Markdown 批次 | 12,000 中文字符 | 14,400 中文字符 |
| 单个 SKILL.md | 2,000 token | 2,400 token |
| 领域材料包 | 48,000 token | 57,600 token |
| 产品单会话增量 | 64,000 token | 76,800 token |

三态预算状态：`BUDGET_OK`（正常）、`BUDGET_ATTENTION`（达到基准，重点关注）、`BUDGET_SPLIT_REQUIRED`（超过 120%，必须拆分且禁止启动 Worker）。

视觉资产（PNG/JPEG）在未安装视觉转 Markdown 提供器时返回稳定占位块，不调用 LLM。

## 2. 前置条件

所有用户都需要：

- Git；
- Node.js 22 或更高版本；
- 已安装并登录 Codex 或 Claude Code。

插件当前没有 Python 运行时依赖，也不要求用户安装本项目自行研发的 npm 包。第三方 Node.js 依赖不会提交到 Git，也不会塞进 GitHub Release 源码包：Codex 可使用插件声明的精确 core 依赖；Claude Code 安装插件后通过 `/flow-architect:setup` 把选定依赖安装到用户缓存。

## 3. Codex 安装

### 3.1 从 GitHub 安装稳定版

```bash
codex plugin marketplace add mzdbxqh/flow-architect --ref v0.4.1
codex plugin add flow-architect@flow-architect
codex plugin list
```

`codex plugin list` 中看到 `flow-architect@flow-architect` 为 `installed, enabled` 即安装成功。Codex 会在自己的插件缓存中安装生产依赖，不会把 `node_modules` 提交进 Git 仓库或 GitHub Release 源码包。

### 3.2 从本地源码安装

适合开发、验证或试用尚未发布的改动：

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
cd flow-architect
codex plugin marketplace add "$PWD"
codex plugin add flow-architect@flow-architect
codex plugin list
```

使用本地 Marketplace 时请保留源码目录。源码发生变化后，可移除并重新安装插件以刷新缓存。

## 4. Claude Code 安装

### 4.1 从 Claude Marketplace 安装（推荐）

```bash
/plugin marketplace add mzdbxqh/flow-architect
/plugin install flow-architect@flow-architect
/reload-plugins
```

安装完成后，使用 help 查看能力：

```bash
/flow-architect:help
```

首次使用需要初始化运行时：

```bash
/flow-architect:setup
```

### 4.2 从本地源码安装（开发者）

适合开发、验证或试用尚未发布的改动：

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
cd flow-architect
corepack enable
pnpm install --frozen-lockfile
claude --plugin-dir "$PWD/adapters/claude"
```

### 4.3 运行时组件

Flow Architect 使用组件化运行时管理：

- **核心组件 `core`（默认安装）：** ajv、fast-xml-parser、yaml
- **可选组件（由用户选择，可多选或不选，以 `runtime/manifest.json` 为准）：**
  - `pdf`：pdfjs-dist（PDF 文本提取）
  - `docx`：mammoth（DOCX 文本提取）
  - `xlsx`：exceljs + jszip（XLSX 结构读取，支持表格、原生 DrawingML、图片及混合输入）
  - `pptx`：jszip（PPTX 结构读取）

运行时安装在用户缓存目录，不在插件目录内：

- macOS: `~/Library/Caches/flow-architect/`
- Linux: `~/.cache/flow-architect/`
- Windows: `%LOCALAPPDATA%\flow-architect\`

### 4.4 诊断与维护

检查运行时状态：

```bash
/flow-architect:help
```

重新初始化运行时：

```bash
/flow-architect:setup
```

## 5. 怎么使用

### 5.1 选择入口

| 需求 | Codex | Claude Code |
|---|---|---|
| 用自然语言描述需求，由技能路由到合适入口 | `$flow-architect-quickstart` | `/flow-architect:quickstart` |
| 不确定该选哪种评审 | `$flow-architect` | `/flow-architect:flow-architect` |
| 架构与流程图一起评审 | `$flow-architect-flow-review-integrated` | `/flow-architect:flow-architect-flow-review-integrated` |
| 只评审 L4/L5/L6/SOP 架构 | `$flow-architect-flow-review-architecture` | `/flow-architect:flow-architect-flow-review-architecture` |
| 只评审流程图 | `$flow-architect-flow-review-diagram` | `/flow-architect:flow-architect-flow-review-diagram` |

`quickstart` 是正式业务入口（不是教程或降级模式）：先用确定性脚本枚举候选公共方法，唯一匹配时形成规范化任务并调用对应严格入口；候选会改变结果、副作用或输出目录时要求你选择；创建类入口缺少你授权的输出目录时只返回缺失信息。一般建议使用默认入口，让技能先盘点输入并自动路由。架构与流程图很难彼此割裂地判断；只要两类制品同时存在，优先使用联合评审。

### 5.2 准备输入

把本次需要一起判断的文件放在同一个目录，或在提示词中逐一给出路径。不要把无关历史版本混入同一目录；如果必须保留，请明确指出基准版和对照版。

推荐说明以下业务上下文：

- 流程目标和边界；
- 参与角色、组织或系统；
- L4/L5/L6/SOP 的分层口径；
- 哪些文件互为架构、流程图或补充说明；
- 已知例外、监管要求和必须遵守的业务规则。

缺少业务上下文时仍可评审结构、表达和制品间一致性，但技能会降低相关结论的置信度，不会臆造业务规则。

### 5.3 Codex 示例

```text
$flow-architect
请只读评审 /absolute/path/to/review-inputs 中的全部流程架构和流程图。
业务目标是缩短采购申请到订单下达的周期；L4/L5/L6 定义见该目录下的 README.md。
请重点检查层级完整性、BPMN 合规性和架构—流程图一致性，不要修改原文件。
```

只评审一张 BPMN：

```text
$flow-architect-flow-review-diagram
评审 /absolute/path/to/procurement.bpmn，重点检查网关、事件、默认流、悬空引用和可视化布局。只读输出报告。
```

### 5.4 Claude Code 示例

在 Claude Code 会话中输入：

```text
/flow-architect:flow-architect
请只读评审 ./review-inputs 中的流程架构和流程图，先盘点输入，再做联合评审。
```

也可以直接使用自然语言提出评审需求；显式写出入口名称能让路由更确定。

## 6. 输出在哪里

每次评审在目标项目或用户指定位置创建独立运行目录：

```text
runs/flow-architect/<run-id>/
├── input/input-manifest.json
├── stages/
└── final/
    ├── result.json
    ├── review-verdict.json
    └── review-report.md
```

主要阅读 `final/review-report.md`。结构化集成可使用 `result.json` 和 `review-verdict.json`。Finding 会尽量包含规则、严重程度、证据位置、置信度和建议；证据不足时会明确降级，不会给出伪精确结论。

技能只会在运行目录中写评审制品，不会改写输入文件。启动前仍建议由用户确认运行目录位于合适的位置。

## 6.1 导出格式

离线 HTML 会议包支持五类导出：

1. **HTML：** 新修订版本的离线 HTML 会议包
2. **BPMN：** BPMN 2.0 XML 格式的流程图
3. **SVG：** 矢量图形格式的流程图
4. **问题 JSON：** 待确认问题列表的结构化数据
5. **完整 V2 JSON：** 包含流程卡片、活动一览表、图和问题的完整 V2 草稿数据

**注意：** 不导出 XLSX 格式。

## 7. 更新

### 7.1 Codex Git Marketplace

如果 Marketplace 固定在某个 tag，先切换到新版本对应的 ref；如果跟踪分支，可刷新后重新安装：

```bash
codex plugin marketplace upgrade flow-architect
codex plugin remove flow-architect@flow-architect
codex plugin add flow-architect@flow-architect
```

完成后新建一个 Codex 任务，避免旧任务继续使用已加载的旧技能定义。

### 7.2 Claude Marketplace

```bash
/plugin marketplace update flow-architect
/plugin uninstall flow-architect@flow-architect
/plugin install flow-architect@flow-architect
/reload-plugins
```

更新后再次运行 `/flow-architect:help` 检查版本与状态；runtime 版本不兼容时再运行 `/flow-architect:setup`。

## 8. 卸载

Codex：

```bash
codex plugin remove flow-architect@flow-architect
codex plugin marketplace remove flow-architect
```

Claude Code：

```bash
/plugin uninstall flow-architect@flow-architect
/plugin marketplace remove flow-architect
```

默认卸载会清理 Claude Code 的插件缓存。Flow Architect 的独立 runtime 缓存不会被插件卸载命令自动删除，避免误删用户数据；如需释放空间，请先用 help/doctor 确认路径，再由用户自行删除对应 `flow-architect` 缓存目录。

## 9. 常见问题

### 找不到 `codex` 或 `claude`

先安装对应客户端，并确认其可执行文件位于 `PATH`。重新打开终端后再试。

### Codex 提示找不到插件

依次运行：

```bash
codex plugin marketplace list
codex plugin list
```

确认 Marketplace 名称和插件选择器都是 `flow-architect`。若安装源已更新，执行升级并重新安装。

### Claude Code 报 Node.js 模块缺失

先运行：

```bash
/flow-architect:help
/flow-architect:setup
```

setup 默认安装 core，并允许选择 PDF、DOCX、XLSX、PPTX。若仍失败，保留 help/doctor 输出中的结构化错误码；不要在插件缓存目录内手工运行 npm。

### 输入很多，但报告结论很少

检查提示词是否说明了文件之间的关系、流程边界和分层口径。图片或扫描件缺少可定位的结构化证据时，技能会主动减少断言。

### 会修改我的流程文件吗

不会。评审入口是只读的，只写独立运行目录。创建入口在用户指定的独立运行目录创建新制品，不修改原始输入。

## 10. 当前限制

- setup 仅管理第三方 Node.js 运行时组件，不安装 Python 环境；
- setup 需要 Node.js 22+、npm 和可访问的 npm Registry；离线环境只能复用已验证缓存；
- 评审入口不创建模型、不自动修复原始制品；
- 视觉输入不能替代 BPMN XML 等结构化源文件；
- 业务正确性仍依赖用户提供足够的业务上下文。
