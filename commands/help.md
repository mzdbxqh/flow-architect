---
description: 查看 Flow Architect 能力、只读边界、运行时状态、最小示例和故障诊断入口
allowed-tools: Bash(node "$CLAUDE_PLUGIN_ROOT/scripts/runtime-manager.mjs" check --json) Bash(node "$CLAUDE_PLUGIN_ROOT/scripts/runtime-manager.mjs" doctor --json)
---

# Flow Architect Help

这是只读帮助入口。不要安装依赖、修改项目文件或访问网络。

1. 运行以下两个只读命令；必须使用插件根变量，不能依赖当前工作目录：

   ```bash
   node "$CLAUDE_PLUGIN_ROOT/scripts/runtime-manager.mjs" check --json
   node "$CLAUDE_PLUGIN_ROOT/scripts/runtime-manager.mjs" doctor --json
   ```

2. 用中文展示：
   - 插件版本 `v0.1.2` 与 V1 只读评审边界；
   - 联合评审、架构评审、流程图评审入口；
   - core 支持的 BPMN、SVG、JSON、YAML、Markdown；
   - PDF、DOCX、XLSX 对应的可选组件及当前状态；
   - 一个最小联合评审示例；
   - 下一步 `/flow-architect:setup` 与诊断建议。

3. 若命令失败，原样保留结构化错误码并给出故障诊断入口，不要自行修复。

约束：零写入、零联网、不得调用 setup/install，不得修改任何输入或插件文件。
