# Flow Architect Runtime Contract

## Runtime Components

Flow Architect 使用组件化运行时，`runtime/manifest.json` 定义所有组件及其精确版本：

| 组件 | 必装 | 包 | 精确版本 |
|------|------|-----|----------|
| `core` | ✅ | ajv, ajv-formats, fast-xml-parser, yaml | 8.20.0, 3.0.1, 4.5.7, 2.9.0 |
| `pdf` | 否 | pdfjs-dist | 4.10.38 |
| `docx` | 否 | mammoth | 1.12.0 |
| `xlsx` | 否 | exceljs, jszip | 4.4.0, 3.10.1 |
| `pptx` | 否 | jszip | 3.10.1 |

### 隔离加载

- 运行时安装在用户缓存目录（macOS `~/Library/Caches/flow-architect/`，Linux `~/.cache/flow-architect/`，Windows `%LOCALAPPDATA%\flow-architect\`），不写入插件目录或 Git 仓库。
- 通过 `requireRuntimePackage(component, specifier)`（同步）或 `importRuntimePackage(component, specifier)`（异步）加载，不通过 pnpm store 私有路径或第三方包内部路径偷加载。
- 所有 `scripts/lib/` 下的正式业务脚本必须通过 runtime loader 加载第三方运行时依赖，不得裸导入 `ajv`、`ajv-formats`、`fast-xml-parser` 或 `yaml`。
- xlsx 组件显式声明 `jszip: 3.10.1`，不从 exceljs 内部加载 jszip。

### 结构化缺失错误

组件未安装时，脚本返回结构化错误而非崩溃：

- 错误码：`FLOW_ARCHITECT_RUNTIME_MISSING`
- 包含缺失组件名、所需包名和安装指令
- 不静默降级或假装成功

## Run Directory Structure

Every review run produces a directory with the following layout:

```
<run_dir>/
  run.json                  # Run metadata (run_id, created_at, route)
  input-manifest.json       # Validated inventory of input artifacts
  stages/
    <stage_id>/
      task.json             # Stage task contract (input to the executor)
      result.json           # Stage result (output from the executor)
      artifacts/            # Stage-local intermediate artifacts
  review-verdict.json       # Final aggregated verdict (written by orchestrator)
```

- `run_id` is a UUIDv4 generated at run start.
- `stage_id` matches the pipeline stage name (e.g. `input-validation`, `architecture-parse`, `diagram-parse`, `consistency-review`, `verdict-aggregate`).
- Each stage may be re-attempted; `attempt` is a 1-based integer recorded in `task.json` and `result.json`.

## Stage Task Contract

Every stage executor receives a `task.json` and must produce a `result.json`.
See [stage-task-template.md](stage-task-template.md) for the full template.

The executor MUST:
1. Validate that all input paths exist and pass path-containment checks.
2. Write `result.json` atomically (via `writeJsonAtomic`).
3. Never write outside `output_dir`.

## result.json

Defined by `schemas/result.schema.json`.

### Key fields

| Field | Purpose |
|-------|---------|
| `status` | Whether the stage **executed** successfully. One of `SUCCEEDED`, `SUCCEEDED_WITH_WARNINGS`, `FAILED`, `BLOCKED`, `NEEDS_INPUT`, `CANCELLED`. |
| `decision` | The stage's **domain verdict** on the content it reviewed. One of `PASS`, `WARN`, `FAIL`, `BLOCKED`, or `null`. A stage that does not produce a domain verdict (e.g. input-validation) sets this to `null`. |

### Status vs Decision vs Review Verdict

These three concepts are intentionally separate:

- **`status` (result.json)** -- Did the executor run to completion? This is an operational concern. A stage can `SUCCEED` even if it finds problems (decision = `FAIL`).
- **`decision` (result.json)** -- Given the stage ran, what is its domain-level assessment? A consistency-review stage that finds blockers would set `status: SUCCEEDED` and `decision: FAIL`.
- **`review_verdict` (review-verdict.json)** -- The aggregated verdict across all stages, set by the orchestrator. One of `PASS`, `CONDITIONAL_PASS`, `FAIL`, `INSUFFICIENT_EVIDENCE`. This is the final user-facing outcome.

Keeping these separate means:
- A stage that cannot run (status = `BLOCKED`) does not pollute the domain verdict.
- A stage that runs successfully but finds no issues (status = `SUCCEEDED`, decision = `PASS`) is distinct from one that found blockers (decision = `FAIL`).
- The orchestrator can aggregate decisions without re-interpreting statuses.

## review-verdict.json

Defined by `schemas/review-verdict.schema.json`.

Written once by the orchestrator after all stages complete. Contains:
- `route`: which path was taken (`INTEGRATED`, `ARCHITECTURE_ONLY`, `DIAGRAM_ONLY`).
- `review_verdict`: the final aggregated verdict.
- Severity counts (`blocker_count`, `critical_count`, etc.).
- `business_confirmation_required_count`: findings that need human confirmation.
- `scope_limitations`: list of known gaps (e.g. "diagram could not be parsed").
