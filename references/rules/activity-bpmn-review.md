# 活动—BPMN 交叉审查规则

针对活动表与 BPMN 图表之间语义一致性的确定性审查规则。

---

## FA-ACT-BPMN-001: 泳道不得使用个人姓名

**严重级别**: CRITICAL
**确定性**: 是（保守）

### 描述

泳道必须表达业务角色，不得使用可识别的个人姓名作为角色或泳道名。个人姓名无法表达职责语义，且在人员变动时需要频繁修改图表。

### 检查步骤

1. 对每个泳道，检查名称是否匹配明显姓名格式：
   - 中文姓名：2-3个汉字，且不含"角色"、"人员"、"部门"等语义词
   - 西文姓名：首字母大写的 First Last 格式
2. 检查角色 ID 是否包含业务语义（如 approver、requester 等），排除 `role_` 前缀
3. 若角色 ID 与泳道名称匹配（如 role_zhangsan 对应 张三），也视为无语义
4. 仅当泳道名称为姓名格式且角色 ID 无语义时产生 finding

### 不适用条件

- 泳道名称包含业务语义词（申请人、审批人、采购员等）
- 角色 ID 包含明确业务语义（approver、reviewer 等）
- 无法确定是否为姓名时不产生 finding

### 所需证据

- 泳道标识符与名称
- 角色标识符
- 姓名格式匹配结果
- 角色语义检测结果

### 修复建议

将泳道名称改为业务角色，例如"申请人"、"审批人"、"采购员"等。

---

## FA-ACT-BPMN-002: 每个 L5 活动恰有一个 MAIN_TASK

**严重级别**: BLOCKER
**确定性**: 是

### 描述

每个 L5 活动必须恰好有一个 MAIN_TASK 节点绑定。活动、binding 和节点的 ID 和名称必须三方一致。多个主 Task 表示活动拆分不完整或绑定错误。

### 检查步骤

1. 对每个活动，检查是否存在 task_binding
2. 检查 activity.main_task_id 与 binding.main_task_id 是否一致
3. 检查 binding.main_task_id 对应的节点类型是否为 MAIN_TASK
4. 检查同一活动是否有多个 binding

### 不适用条件

- 无（每个 L5 活动必须满足）

### 所需证据

- 活动标识符与名称
- binding 数量与 main_task_id
- 节点类型

### 修复建议

- 若缺少 binding：创建 MAIN_TASK 节点并建立 binding
- 若多个 binding：保留一个，删除多余的
- 若三方不一致：统一 activity、binding 和节点的 main_task_id

---

## FA-ACT-BPMN-003: 主 Task 泳道与 RASCI/R 或 OARP/O 一致

**严重级别**: CRITICAL
**确定性**: 是

### 描述

普通活动（STANDARD）的主 Task 必须位于 RASCI 的 R 泳道；评审/决策活动（REVIEW_MEETING/DECISION_ACTIVITY）的主 Task 必须位于 OARP 的 O 泳道。泳道错配导致职责归属不清。

### 检查步骤

1. 确定活动的责任模型（RASCI 或 OARP）
2. 找到责任角色（RASCI → R，OARP → O）
3. 检查主 Task 的 lane_id 是否与责任角色对应的泳道一致

### 不适用条件

- 责任模型不是 RASCI 或 OARP
- 找不到责任角色
- 角色无对应泳道

### 所需证据

- 活动标识符与责任模型
- 责任角色标识符
- 主 Task 当前泳道
- 期望泳道

### 修复建议

将主 Task 移至责任角色对应的泳道。

---

## FA-ACT-BPMN-004: 确认从 Task 三条件

**严重级别**: BLOCKER
**确定性**: 是

### 描述

确认从 Task 仅在三项声明全真、确认角色存在且不同于主责角色时成立：
1. co_completes: 确认方与主责方共同完成工作
2. confirm_bears_final_responsibility: 确认方承担最终责任
3. no_formal_approval_meeting: 不涉及正式审批会议

### 检查步骤

1. 检查活动是否有 confirmation 声明
2. 验证三项声明是否全为 true
3. 检查确认角色是否存在
4. 检查确认角色是否不同于主责角色（RASCI → R，OARP → O）

### 不适用条件

- 活动无 confirmation 声明

### 所需证据

- 活动标识符
- 三项声明值
- 确认角色标识符
- 主责角色标识符

### 修复建议

- 若声明不全：确认确认从 Task 满足三项条件，或移除确认从 Task
- 若角色相同：指定不同于主责角色的确认角色

---

## FA-ACT-BPMN-005: 正式审批不得作为确认从 Task

**严重级别**: BLOCKER
**确定性**: 是

### 描述

正式审批、正式评审会议或独立决策不得建模为确认从 Task，应为独立 L5 活动。确认从 Task 适用于非正式确认场景，不适合正式审批流程。

### 检查步骤

1. 检查活动类型是否为 REVIEW_MEETING 或 DECISION_ACTIVITY
2. 检查活动是否有 confirmation 声明或 binding 中的 confirmation_task_id

### 不适用条件

- 活动类型不是 REVIEW_MEETING 或 DECISION_ACTIVITY

### 所需证据

- 活动标识符与类型
- confirmation 声明存在性
- binding 中的 confirmation_task_id

### 修复建议

将正式审批建模为独立的 REVIEW_MEETING 或 DECISION_ACTIVITY，移除确认从 Task。

---

## FA-ACT-BPMN-006: XOR/OR 必须有条件或默认路径

**严重级别**: CRITICAL
**确定性**: 是

### 描述

XOR（互斥）或 OR（包容）拆分的业务分支必须具有结构化条件或明确默认路径。AND（并行）网关不要求条件。缺少条件或默认路径导致路由逻辑不明确。

### 检查步骤

1. 找到所有 exclusiveGateway 或 inclusiveGateway 节点
2. 检查出向流是否 > 1
3. 检查是否有默认流（is_default = true）
4. 检查所有分支是否有条件表达式

### 不适用条件

- 网关类型不是 XOR 或 OR
- 出向流 ≤ 1

### 所需证据

- 网关标识符与类型
- 出向流数量
- 默认流存在性
- 条件表达式存在性

### 修复建议

- 为每条分支添加条件表达式
- 或指定一条默认流

---

## FA-ACT-BPMN-007: 结束事件必须有业务结果名称

**严重级别**: MAJOR
**确定性**: 是

### 描述

业务结束事件必须有可区分的业务结果名称，并与流程卡片终点集合一致。无名称或与卡片不一致的结束事件导致流程结果不明确。

### 检查步骤

1. 检查结束事件是否有非空名称
2. 检查结束事件是否在流程卡片 end_results 中声明
3. 检查流程卡片 end_results 中的事件是否在图中有对应节点

### 不适用条件

- 无（所有结束事件必须满足）

### 所需证据

- 结束事件标识符与名称
- 流程卡片 end_results 列表
- 匹配结果

### 修复建议

- 为结束事件指定业务结果名称
- 在流程卡片 end_results 中添加结束事件
- 或删除图中多余的结束事件

---

## FA-ACT-BPMN-008: Link Catch/Throw 成对

**严重级别**: CRITICAL
**确定性**: 是

### 描述

Link Catch/Throw 必须按名称或显式引用成对，方向正确且不得悬空。未成对的 Link 事件导致流程跳转失败。

### 检查步骤

1. 收集所有 linkThrow 和 linkCatch 事件
2. 检查每个 linkThrow 是否有同名的 linkCatch
3. 检查每个 linkCatch 是否有同名的 linkThrow

### 不适用条件

- 无 Link 事件

### 所需证据

- Link Throw 标识符与名称
- Link Catch 标识符与名称
- 配对结果

### 修复建议

- 添加同名的配对 Link 事件
- 或删除未成对的 Link 事件

---

## FA-ACT-BPMN-009: 同一 L5 不得映射并行主 Task

**严重级别**: BLOCKER
**确定性**: 是

### 描述

同一 L5 活动不得映射并行或多个主 Task；最多允许一个满足门禁的串行确认从 Task。多个主 Task 表示活动拆分不完整。

### 检查步骤

1. 按活动 ID 分组 task_binding
2. 检查同一活动是否有多个不同的 main_task_id

### 不适用条件

- 无（每个 L5 活动必须满足）

### 所需证据

- 活动标识符
- 主 Task ID 列表
- 主 Task 数量

### 修复建议

- 将并行主 Task 合并为串行
- 或拆分为多个独立活动
