# 离线流程讨论包 V2 合同

## 1. 适用范围

本合同适用于末端 L4 流程的离线 HTML 讨论包。L1～L3 与非末端 L4 只维护流程卡片，不生成活动一览表和 BPMN 图。

## 2. 单一业务数据源

讨论包只接受 `schema_version: 2.0.0` 的流程草稿。草稿必须同时包含：

- `process_card`：流程名称、层级、描述、目的、责任人、上层流程、流程级输入/输出、起点、业务终点和绩效指标；
- `activities`：L5 活动及其描述、RASCI/OARP、SLA/LT、工具、输入、处理概要、输出、自工序完结标准和参考制度；
- `diagram`：泳道、业务节点、顺序流和 Task 绑定；
- `questions`：使用 `question_id` 与 `target_paths` 的待确认问题；
- `provenance` 与 `source_summary`：字段证据和来源摘要。

不得用独立 BPMN 文件、模型生成的 DI 坐标或独立问题文件覆盖草稿内容。

## 3. 一图两表

同一个自包含 HTML 提供四个可切换视图：

1. BPMN 流程图；
2. 流程卡片；
3. L5 活动一览表；
4. 待确认问题。

流程图、卡片、一览表和问题共享同一个 DraftStore。导出的新修订必须从该状态重新生成，重新打开后仍可继续编辑。

## 4. L5 与 BPMN 边界

- 每个 L5 活动恰好绑定一个 `MAIN_TASK`；
- 一个 L5 最多包含一个串行 `CONFIRMATION_TASK`，确认从 Task 不单独计为 L5；
- 确认从 Task 必须位于确认角色泳道，且与主 Task 泳道不同；
- 共同完成、确认者承担最终责任、不存在正式审批会议三项声明必须全部为 true；
- 任一声明不满足时，应创建独立审批 L5 活动；
- XOR、AND、OR 网关、中间事件、结束事件、泳道和顺序流不进入活动一览表。

标准活动使用 RASCI，主 Task 位于 R 泳道；评审会议和决策活动使用 OARP，主 Task 位于 O 泳道。

## 5. 结构编辑事务

有限工具箱只暴露受支持的业务动作。结构操作不依赖拖放坐标，按以下固定事务执行：

1. 保存完整草稿、BPMN XML 和当前选择；
2. 修改业务合同并分配最小可用的稳定 ID；
3. 执行业务规则与引用校验；
4. 使用确定性编译器重建 BPMN XML 与 DI；
5. 重新导入整图并恢复仍然存在的选择；
6. 更新 DraftStore 中的规范 XML。

失败时必须以 `FA-DRAFT-LAYOUT-001` 回滚草稿、XML 和选择。不得保留半成品节点、手工坐标、随机 ID 或 `Date.now()` ID。

## 6. 模型能力边界

语言模型只负责从受限证据批次提取结构化业务事实与不确定项，不生成 BPMN XML、DI、坐标、连接线折点、HTML 或 SVG。这样，能够稳定输出合同 JSON 的模型也可参与事实提取；绘图质量由同一套确定性编译与布局程序保证。

## 7. 构建与导出

独立构建命令的最小形式为：

```bash
node scripts/build-single-diagram-html.mjs \
  --draft ./process-draft.json \
  --title "流程名称" \
  --revision r01 \
  --package-id process-package \
  --run-dir ./runs/meeting-package \
  --output process-r01.html
```

HTML 可导出新修订 HTML、规范 BPMN、SVG、问题 JSON 和完整 V2 JSON，不提供 XLSX 导出。
