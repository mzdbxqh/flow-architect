---
description: 查看 Flow Architect 能力、只读边界、运行时状态、最小示例和故障诊断入口
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" check --json) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" doctor --json)
---

# Flow Architect Help

这是只读帮助入口。不要安装依赖、修改项目文件或访问网络。

1. 运行以下两个只读命令；必须使用插件根变量，不能依赖当前工作目录：

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" check --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-manager.mjs" doctor --json
   ```

2. 用中文展示：
   - 插件版本 `v0.1.2` 与 V1 只读评审边界；
   - 精确入口及固定含义：`/flow-architect:flow-architect`=只读盘点输入并自动路由，`/flow-architect:flow-architect-flow-review-integrated`=只读联合评审，`/flow-architect:flow-architect-flow-review-architecture`=只读架构评审，`/flow-architect:flow-architect-flow-review-diagram`=只读流程图评审；
   - core=`ajv,fast-xml-parser,yaml`，支持 BPMN、SVG、JSON、YAML、Markdown；
   - optional 精确映射：PDF 的组件 ID 是 `pdf`、包名是 `pdfjs-dist`；DOCX 的组件 ID 是 `docx`、包名是 `mammoth`；XLSX 的组件 ID 是 `xlsx`、包名是 `exceljs`；
   - 一个最小联合评审示例；
   - 下一步 `/flow-architect:setup` 与诊断建议。

3. 若命令失败，原样保留结构化错误码并给出故障诊断入口，不要自行修复；不得虚构入口别名、包名、安装路径或环境变量配置。

输出禁令：不得把任何入口描述成建模、生成、渲染或自动修复；不得显示解析后的插件绝对路径；不得建议向插件目录安装依赖。运行时只允许位于 doctor 报告的用户缓存，安装只通过 `/flow-architect:setup`。状态词必须原样使用 `READY`、`DEGRADED`、`BLOCKED`、`MISSING`、`CORRUPT`，不得改写成 `OK` 等其他词。

约束：零写入、零联网、不得调用 setup/install，不得修改任何输入或插件文件。
