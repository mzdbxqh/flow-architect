# 有界上下文黑盒合同 GREEN 验收证据

**日期：** 2026-07-16
**提交：** `baac9c3` feat: 实现有界上下文黑盒合同 GREEN
**状态：** 全部通过

## 1. 背景

提交 `64c8fce` 的三个测试为不可修改 oracle：
- `test/material-packet-builder.test.mjs`
- `test/review-context-cli.test.mjs`
- `test/long-context-budget-e2e.test.mjs`

当前定向命令有 8 个真实失败。

## 2. 修复的 8 个真实失败

### 2.1 领域过滤缺失
- **问题：** `buildMaterialPackets` 没有过滤 `domain_tags`
- **修复：** 添加 `ROUTE_ALLOWED_DOMAINS` 常量，按领域过滤 chunks
- **文件：** `material-packet-builder.mjs`

### 2.2 BLOCKED 状态缺失
- **问题：** `finalizePacket` 没有返回 `status` 字段
- **修复：** 添加 `status: 'BLOCKED'` 或 `status: 'RUNNABLE'`
- **文件：** `material-packet-builder.mjs`

### 2.3 maxTokens 未贯穿
- **问题：** `buildRecursiveAggregationTasks` 硬编码 `limit: 48000`
- **修复：** 使用调用方传入的 `maxTokens` 参数
- **文件：** `material-packet-builder.mjs`

### 2.4 时间戳不稳定
- **问题：** `created_at: new Date().toISOString()` 导致字节不稳定
- **修复：** 移除所有 `created_at` 字段
- **文件：** `build-review-context.mjs`

### 2.5 symlink 检测缺失
- **问题：** 没有检查输出目录是否是逃逸 symlink
- **修复：** 添加 `lstat` + `realpath` 检查
- **文件：** `build-review-context.mjs`

### 2.6 domain_tags 未添加
- **问题：** `normalizeEvidenceToMarkdown` 没有添加 `domain_tags`
- **修复：** 添加 `extractDomainTags` 函数，从标题和内容提取领域标签
- **文件：** `markdown-normalizer.mjs`

### 2.7 相对 allow-list
- **问题：** `allowed_read_paths` 使用绝对路径
- **修复：** 改为相对路径
- **文件：** `build-review-context.mjs`

### 2.8 每批预算文件
- **问题：** 缺少 `context-budgets/` 目录和文件
- **修复：** `prepare-process-draft.mjs` 写入 `context-budgets/` 目录
- **文件：** `prepare-process-draft.mjs`

## 3. 测试结果

| 测试文件 | 测试数 | 通过 | 失败 |
|---|---|---|---|
| material-packet-builder.test.mjs | 4 | 4 | 0 |
| review-context-cli.test.mjs | 6 | 6 | 0 |
| long-context-budget-e2e.test.mjs | 1 | 1 | 0 |
| 其他测试 | 734 | 734 | 0 |
| **总计** | **745** | **745** | **0** |

## 4. 验证结果

| 验证项 | 结果 |
|---|---|
| `pnpm test` | 745/745 通过，0 失败 |
| `pnpm public:verify` | exit 0，无公开泄漏 |
| `pnpm build:check` | exit 0，adapter 字节一致 |
| `git diff --check` | 无白空间问题 |

## 5. 结论

所有 8 个真实失败已修复，测试全部通过。
