---
description: 查看 Flow Architect 能力、固定三入口、只读边界、运行时状态、最小示例和故障诊断入口
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" check --json) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" doctor --json) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/quickstart-route.mjs" --enumerate)
---

# Flow Architect Help

这是只读帮助入口。不要安装依赖、修改项目文件或访问网络。

1. 运行以下三个只读命令；必须使用插件根变量，不能依赖当前工作目录：

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" check --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" doctor --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/quickstart-route.mjs" --enumerate
   ```

   第三条命令是对共享能力目录 `references/capability-catalog.json` 的只读枚举，是本入口对 `quickstart-route.mjs` 的唯一允许用法：只允许 `--enumerate`，不得使用 `--request`、`--request-file` 或 stdin 路由模式。要展示的稳定公共方法（入口、适用场景、副作用、双宿主语法）必须以该命令的枚举输出为准，不得另造重复目录，也不得重新推导路由算法。

2. 用中文展示：
   - 插件版本 `v0.5.1` 与只读评审边界；创建入口（流程初稿、离线会议包）在用户指定的独立运行目录创建新制品，不修改原始输入；
   - 固定三入口：`/flow-architect:help`=只读帮助（本入口），`/flow-architect:setup`=显式初始化入口（人工触发、确认计划后才写用户缓存），`/flow-architect:quickstart`=正式自然语言路由入口（把自然语言请求转换为严格业务入口任务）；
   - 稳定公共业务入口及固定含义：`/flow-architect:flow-architect`=只读盘点输入并自动路由，`/flow-architect:flow-architect-flow-review-integrated`=只读联合评审，`/flow-architect:flow-architect-flow-review-architecture`=只读架构评审，`/flow-architect:flow-architect-flow-review-diagram`=只读流程图评审；创建入口：`/flow-architect:draft-process`=在独立运行目录创建流程初稿，`/flow-architect:build-meeting-package`=在独立运行目录创建离线会议包；入口、适用场景与副作用以上一步 `--enumerate` 的枚举输出与 `references/capability-catalog.json` 为准，不复制任何入口的执行协议；
   - core=`ajv,ajv-formats,fast-xml-parser,yaml`，支持 BPMN、SVG、JSON、YAML、Markdown；
   - optional 精确映射：PDF 的组件 ID 是 `pdf`、包名是 `pdfjs-dist`；DOCX 的组件 ID 是 `docx`、包名是 `mammoth`；XLSX 的组件 ID 是 `xlsx`、包名是 `exceljs`、另含 `jszip`；PPTX 的组件 ID 是 `pptx`、包名是 `jszip`；
   - 双宿主边界：Claude Code 使用 `/flow-architect:<命令或技能>` 语法；Codex 通过 skills 发现三入口与业务技能（`$flow-architect-help`、`$flow-architect-setup`、`$flow-architect-quickstart` 等）；Kimi Code 投影未纳入本次发布，记为后续迁移项；
   - 一个最小联合评审示例；
   - 下一步 `/flow-architect:setup` 与诊断建议。

3. 若命令失败，原样保留结构化错误码并给出故障诊断入口，不要自行修复；不得虚构入口别名、包名、安装路径或环境变量配置。

输出禁令：不得把只读评审入口描述成建模、生成、渲染或自动修复；不得把创建入口描述为修改原始输入或自动修复；不得显示解析后的插件绝对路径；不得建议向插件目录安装依赖。运行时只允许位于 doctor 报告的用户缓存，安装只通过 `/flow-architect:setup`。状态词必须原样使用 `READY`、`DEGRADED`、`BLOCKED`、`MISSING`、`CORRUPT`，不得改写成 `OK` 等其他词。

约束：零写入、零联网、不得调用 plan/setup/install，不得修改任何输入或插件文件。
