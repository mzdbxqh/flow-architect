# Flow Architect

Flow Architect 是面向 Codex 与 Claude Code 的只读流程架构与流程图评审技能族。

## 快速安装

Codex 稳定版：

```bash
codex plugin marketplace add mzdbxqh/flow-architect --ref v0.1.2
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

## 入口 Skill

| Skill | 用途 |
|---|---|
| `flow-architect` | 默认入口；盘点输入并路由至联合评审 |
| `flow-architect-flow-review-integrated` | 联合评审流程架构与流程图 |
| `flow-architect-flow-review-architecture` | 仅评审 L4/L5/L6/SOP 分层架构 |
| `flow-architect-flow-review-diagram` | 仅评审 BPMN、Mermaid、SVG、PNG 或 PDF 流程图 |
| `flow-architect-build-meeting-package` | 从 BPMN + 问题 JSON 构建离线 HTML 讨论包 |
| `flow-architect-help` | 查看能力、格式、状态、示例和诊断 |
| `flow-architect-setup` | 初始化 core 和用户选择的可选运行时组件 |

默认入口 Skill（`flow-architect`）盘点输入文件、识别制品族并路由至对应评审流程。三个流程 Skill 也可在已知评审需求时直接调用。

## 支持的输入格式

**流程架构：** JSON、YAML、CSV、XLSX、Markdown、DOCX、文本型 PDF。

**流程图：** BPMN 2.0 XML、Mermaid、SVG、PNG、JPEG、扫描 PDF。

## V1 范围

V1 为**只读**。它评审现有制品并输出结构化 Finding，但不修改、创建或修复任何用户文件。

## 离线会议包构建

从 BPMN XML 和问题 JSON 构建可在 Chrome/Edge 打开的离线 HTML 讨论包：

```bash
node scripts/build-single-diagram-html.mjs \
  --bpmn ./process.bpmn \
  --questions ./questions.json \
  --title "采购审批流程" \
  --revision r01 \
  --package-id procurement-approval \
  --run-dir ./runs/meeting-package \
  --output procurement-r01.html
```

生成的 HTML：
- 无需联网即可打开和编辑
- 支持问题与流程元素双向定位
- 支持撤销、重做和业务编辑
- 可导出新版本 HTML、BPMN、SVG 和问题 JSON

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

## 隐私边界

发布的包（`@flow-architect/plugin`）仅包含通用化规则、Schema、脚本和适配器。它不包含：

- 私有来源方法论文档
- 内部制品 ID 或项目特定引用
- 绝对用户路径或环境特定配置
- 专有方法论术语或原始培训材料

所有私有资料保留在父工作区，通过 `public-release.json` 治理和自动泄漏扫描排除在发布包之外。

## 许可证

Apache-2.0
