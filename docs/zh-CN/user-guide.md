# Flow Architect 中文用户手册

Flow Architect 是面向 Codex 与 Claude Code 的只读流程架构和流程图评审技能族。当前 V1 只分析现有制品、给出证据和 Finding，不创建、修改或修复业务文件。

## 1. 能评审什么

- 流程架构：JSON、YAML、CSV、XLSX、Markdown、DOCX、文本型 PDF。
- 流程图：BPMN 2.0 XML、Mermaid、SVG、PNG、JPEG、扫描 PDF。
- 联合评审：同时检查 L4/L5/L6/SOP 分层、BPMN 或视觉质量，以及架构与流程图之间的一致性。

图片和扫描 PDF 只能提供视觉证据。仅由图片推断的结构结论置信度最高为 0.6，报告会明确标记需要业务确认的内容。

## 2. 前置条件

所有用户都需要：

- Git；
- Node.js 22 或更高版本；
- 已安装并登录 Codex 或 Claude Code。

Codex Marketplace 安装会自动安装本插件声明的 Node.js 生产依赖。插件当前没有 Python 运行时依赖，也不要求用户安装本项目自行研发的 npm 包。

Claude Code 当前推荐使用源码目录加载。这个路径还需要 pnpm；可通过 Node.js 自带的 Corepack 启用：

```bash
corepack enable
```

## 3. Codex 安装

### 3.1 从 GitHub 安装稳定版

```bash
codex plugin marketplace add mzdbxqh/flow-architect --ref v0.1.1
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

Claude Code 当前的完整支持路径是“源码检出 + 安装生产依赖 + `--plugin-dir` 加载”：

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
cd flow-architect
corepack enable
pnpm install --prod --frozen-lockfile
claude --plugin-dir "$PWD/adapters/claude"
```

如需非交互执行：

```bash
claude -p --plugin-dir "$PWD/adapters/claude" \
  '使用 /flow-architect:flow-architect 评审 ./examples 下的流程架构和流程图，只读，不修改原文件。'
```

仓库包含 Claude Marketplace 元数据，但 v0.1.1 不把第三方 Node.js 依赖打进发布制品，Claude Marketplace 安装也不会自动为普通技能脚本安装这些依赖。因此 v0.1.1 不把远程 Marketplace 安装列为 Claude Code 的完整支持路径。后续版本会通过初始化能力改善这一体验。

## 5. 怎么使用

### 5.1 选择入口

| 需求 | Codex | Claude Code |
|---|---|---|
| 不确定该选哪种评审 | `$flow-architect` | `/flow-architect:flow-architect` |
| 架构与流程图一起评审 | `$flow-architect-flow-review-integrated` | `/flow-architect:flow-architect-flow-review-integrated` |
| 只评审 L4/L5/L6/SOP 架构 | `$flow-architect-flow-review-architecture` | `/flow-architect:flow-architect-flow-review-architecture` |
| 只评审流程图 | `$flow-architect-flow-review-diagram` | `/flow-architect:flow-architect-flow-review-diagram` |

一般建议使用默认入口，让技能先盘点输入并自动路由。架构与流程图很难彼此割裂地判断；只要两类制品同时存在，优先使用联合评审。

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

在通过 `--plugin-dir` 启动的 Claude Code 会话中输入：

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

## 7. 更新

### 7.1 Codex Git Marketplace

如果 Marketplace 固定在某个 tag，先切换到新版本对应的 ref；如果跟踪分支，可刷新后重新安装：

```bash
codex plugin marketplace upgrade flow-architect
codex plugin remove flow-architect@flow-architect
codex plugin add flow-architect@flow-architect
```

完成后新建一个 Codex 任务，避免旧任务继续使用已加载的旧技能定义。

### 7.2 Claude Code 源码目录

```bash
cd /path/to/flow-architect
git pull --ff-only
pnpm install --prod --frozen-lockfile
claude --plugin-dir "$PWD/adapters/claude"
```

## 8. 卸载

Codex：

```bash
codex plugin remove flow-architect@flow-architect
codex plugin marketplace remove flow-architect
```

Claude Code 使用 `--plugin-dir` 时没有持久安装项；退出会话并停止传入该参数即可。源码目录可在确认不再需要后自行删除。

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

确认是在仓库根目录执行过：

```bash
corepack enable
pnpm install --prod --frozen-lockfile
```

然后使用仓库中的绝对适配器路径重新启动 `claude --plugin-dir`。

### 输入很多，但报告结论很少

检查提示词是否说明了文件之间的关系、流程边界和分层口径。图片或扫描件缺少可定位的结构化证据时，技能会主动减少断言。

### 会修改我的流程文件吗

不会。v0.1.x 是只读评审版本，只写独立运行目录。建模和自动修复分别属于后续版本范围。

## 10. 当前限制

- v0.1.1 不提供 `flow-architect-init` 初始化命令；
- Claude Code 尚未提供依赖自动初始化，推荐使用源码目录加载；
- V1 不创建模型、不自动修复原始制品；
- 视觉输入不能替代 BPMN XML 等结构化源文件；
- 业务正确性仍依赖用户提供足够的业务上下文。
