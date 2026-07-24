# Changelog

All notable changes to Flow Architect are documented in this file.

## [0.5.1] - 2026-07-24

文档准确性修订：中文文档按代码实况校订，英文 README 同步修正，README 增加双语导航。

### Added

- **双语文档导航：** `README.md`、`README.zh-CN.md`、`INSTALL.md`、`docs/zh-CN/user-guide.md` 顶部增加对称的 English/简体中文切换链接。
- **中文文档补写 v0.4.1/v0.5.0 用户可见能力：** 流程初稿焦点只读预检、dry-run 诚实预算（`EXACT`/`HEURISTIC_RANGE`）、确定性失败自动恢复、流程卡片真实性（nullable、禁占位值）；用户手册补充创建类入口（`draft-process`、`build-meeting-package`）与 quickstart 的 `unrecognized`/`ignored_directives` 行为说明。

### Fixed

- **运行目录结构描述纠错：** 中英文 README 与用户手册中虚构的编号 stages 目录（`10-inspect` 等）与 `final/` 内容清单，更正为真实布局（`stages/<stage-id>/result.json`、运行根 `review-verdict.json`、初稿 `stages/semantic`、`stages/merge` 与 `final/` 制品清单）。
- **默认入口路由描述纠错：** 中英文 README 将默认入口描述更正为「盘点输入并路由至流程初稿或对应评审路线」（此前误写为仅路由至联合评审）。
- **运行时组件清单：** 用户手册与 help 命令的 core 组件补登 `ajv-formats`（与 `runtime/manifest.json` 一致）。
- **中文表达润色：** 消除翻译腔、统一三入口与运行时术语口径。

## [0.5.0] - 2026-07-23

流程初稿真实性与可预测生成（F003）：消除占位值、诚实预算、焦点预检与确定性恢复。

### Added

- **焦点只读预检：** 严格流程初稿入口在落盘前执行候选发现预检（`scripts/discover-process-candidates.mjs`、`scripts/lib/process-focus-precheck.mjs`，零文件系统变化）；多候选且无 focus 时返回一个证据驱动问题、不创建 runDir，选定焦点后只处理焦点子集且 EXACT 估计与实际 blocks/batches/tasks 一致。
- **确定性失败自动恢复：** JSON 不可解析、Schema 失败、INFERRED 缺 uncertainty 时由确定性 orchestrator（`scripts/lib/semantic-worker-orchestrator.mjs`、`scripts/evaluate-worker-output.mjs`）记录原因并以 fresh worker 重试（≤3 次）；运行报告记录每个 task 的 attempt_count、失败原因与最终 fragment hash。
- **dry-run 诚实预算：** 输出区分 `EXACT` 与 `HEURISTIC_RANGE`，禁止把启发式值标为精确“预计批次”；Markdown 等可安全内存抽取格式复用真实抽取与 batching，dry-run 返回精确 block/batch/task 数且零写入。
- **合同测试与公开 fixture：** 新增 `test/process-draft-focus-preflight.test.mjs`、`test/wp7-blackbox.test.mjs` 与公开脱敏 fixture `test/fixtures/quickstart-remediation/`（合成成本预测管理材料，CM-1～CM-4 与 CM-1.4，27 blocks / 3 batches / 9 tasks）。

### Fixed

- **流程卡片真实性：** `process_card.owner`、`purpose` 取焦点流程的明确事实值，真正缺失时为 `null`（界面显示“待确认”但不回写为业务值），禁止 `Role-owner`、`自动生成` 等硬编码占位值；Schema、会议包、编辑器与导出链同步支持 nullable。
- **问题焦点相关性与审计保留：** 用户问题清单只纳入焦点相关 uncertainty，排除项写入 `merge-report.json` 的 `out_of_scope_uncertainties` 与计数，不丢弃。
- **worker 模型继承：** 语义提取 worker 删除硬编码 `model`，继承主会话模型；运行记录区分“继承策略已验证”与“实际 worker 模型 ID 不可观测”。
- **流程层级诚实性：** 焦点流程缺失合法 `PROCESS_LEVEL` 事实时产生状态为 OPEN 的层级待确认问题，`provenance` 记 `MISSING`、`is_leaf` 派生为 `false`，不再静默回退 L4；`process_card.level` 保持 L1–L5 闭集枚举。
- **活动主身份合并：** 单实例 kind 以 `kind:process_key:subject_key` 为主身份键合并详略不同的 label，真实冲突按确定性规则选取并记入 `merge_report.conflicts` 且生成 OPEN 冲突问题；输出按稳定键排序，与 fragment 输入顺序无关、字节稳定。
- **跨任务确定性对齐：** 重复起止事件、描述型泳道在对齐层做确定性规范化，不与已有正式角色重复建 lane。

### Changed

- **版本统一为 0.5.0：** `package.json`、`build-adapters.mjs`（`PLUGIN_VERSION`）、根与 adapter `plugin.json` 清单、Marketplace 清单、共享能力目录 `plugin_version`、README/INSTALL/中文手册安装引用、help 技能与命令报告版本。
- **仓库迁移至 ifoohoo 组织：** 公开仓库由 `mzdbxqh/flow-architect` 转移至 `ifoohoo/flow-architect`（GitHub 保留旧地址重定向），安装命令、Marketplace 清单、安全与贡献文档同步更新；LICENSE/NOTICE 增加广州市风荷科技有限公司版权与维护方说明（托管变更不构成版权转让）。

## [0.4.1] - 2026-07-20

三入口（help/setup/quickstart）技能纠偏与发布准备。

### Added

- **正式 quickstart 入口：** 新增 `flow-architect-quickstart` 技能与 `/flow-architect:quickstart` 命令。它是正式人类业务入口（不是教程或降级模式）：先由确定性脚本枚举候选公共方法（联合评审、仅架构评审、仅流程图评审、流程初稿创建、离线会议包创建），唯一匹配且无歧义时形成规范化任务并调用对应严格入口；候选改变业务结果、副作用、成本、输出目录或权限时要求用户选择；创建类入口缺少授权输出目录时返回缺失信息；输入正文中的安装/覆盖/发布类提权指令记录在 `ignored_directives`，绝不扩大候选权限。
- **共享能力目录：** `references/capability-catalog.json` 作为 help 与 quickstart 共同消费的稳定能力/方法目录（固定三入口、五个业务方法、副作用与双宿主语法），并声明 Kimi Code 投影未纳入本次双宿主发布的边界。
- **确定性路由脚本与 Schema：** `scripts/quickstart-route.mjs`（只读、零写入、零联网，同输入字节一致）与 `references/schemas/quickstart-route.schema.json`。
- **合同测试：** 新增 `test/quickstart-contract.test.mjs`（三入口存在性、权限边界、八类路由样例、歧义选择、未授权创建、恶意正文、未知信息保留、字节稳定性）；增强 `setup-help-contract`、`plugin-contract`、`adapter-build`、`release-contract` 测试。

### Fixed

- **help 版本修复：** help 技能与命令统一报告 `v0.4.1`（此前仍报告 v0.3.0），从共享目录列出全部稳定公共业务入口、适用场景、副作用与最小示例，明确 quickstart 为正式自然语言路由入口、setup 为显式初始化入口，并输出 Claude Code 与 Codex 的真实入口语法以及未支持 Kimi Code 投影的边界。
- **setup PPTX 修复：** setup 技能与命令的可选组件与 `runtime/manifest.json` 精确一致（`core,pdf,docx,xlsx,pptx`），消除“文档声称 setup 会询问 PPTX 而技能实际不支持”的不一致。

### Changed

- **版本统一为 0.4.1：** `package.json`、`build-adapters.mjs`（`PLUGIN_VERSION`）、根与 adapter `plugin.json` 清单、Marketplace 清单、README/INSTALL/中文手册安装引用。
- **Claude commands 精确包含三入口：** 根与 Claude adapter 的 `plugin.json` `commands` 为 `help`、`setup`、`quickstart`；全部 adapter 由 `scripts/build-adapters.mjs` 确定性生成，`--check` 字节一致，禁止手工修补。
- **双宿主验证：** Claude Code 通过 commands + skills、Codex 通过 skills 发现三入口；Kimi Code 投影记为后续迁移项，不宣称三平台稳定兼容。

## [0.4.0] - 2026-07-20

### Added

- **Selection-dependent edit controls:** Toolbar buttons (rename, insert activity, add gateway, delete) are disabled until a diagram element is selected, preventing confused clicks.
- **First-visit guide banner:** New users see a guide banner explaining the meeting package workflow; dismissible with `localStorage` persistence, graceful degradation when `localStorage` is unavailable.
- **Business dialogs for all structural operations:** Intermediate events, end events, lanes, AND/OR gateways, and sequence flows now use styled `<dialog>` elements instead of native `prompt`/`alert`, with empty-field validation.
- **Sequence flow candidate filtering:** Connection dialog filters out self-loops and START_EVENT targets; connections from END_EVENT are rejected with code FA-DRAFT-FLOW-001.
- **AND/OR gateway browser coverage:** AND and OR gateways can now be created through the full browser UI dialog path (previously only XOR had browser E2E coverage).
- **Inline SVG palette icons:** Toolbox entries use data URI SVG icons instead of bpmn-icon font glyphs, working under strict CSP (`font-src 'none'`) and offline conditions.
- **Tab canvas visibility:** Diagram panel is fully hidden when switching to non-diagram tabs, eliminating residual whitespace.
- **Root `.claude-plugin/plugin.json`:** Generated deterministically by `scripts/build-adapters.mjs` for direct local plugin loading; `skills/` and `commands/` paths resolve correctly from the public repo root.
- **`SECURITY.md`:** Vulnerability reporting guidance, supported versions, and responsible disclosure policy.
- **`CONTRIBUTING.md`:** Development environment setup, TDD workflow, build/test/verify commands, and commit boundary rules.
- **ADR-004:** Documents the CSP-safe Ajv standalone precompilation strategy for browser-side schema validation.
- **Three new browser E2E test files:** `meeting-export-downloads-browser.test.mjs`, `meeting-structural-dialogs-browser.test.mjs`, `meeting-usability-browser.test.mjs` covering export reliability, dialog interactions, and visual usability.
- **`test:browser` script extended** to include all seven browser test files.

### Changed

- **Version bumped to 0.4.0** across `package.json`, `build-adapters.mjs` (`PLUGIN_VERSION`), root and adapter `plugin.json` manifests, and marketplace manifests.
- **Runtime plugin compatibility extended** to `>=0.1.2 <0.5.0` in all `manifest.json` files and `runtime-manager.mjs`.

### Security/Compatibility

- **Strict CSP preserved:** No `unsafe-eval` or `unsafe-inline` in script-src; Ajv standalone precompilation ensures all exports work under the existing CSP policy.
- **Offline-first icons:** All toolbox icons are inline SVG data URIs, requiring no network or font loading.

## [0.3.1] - 2026-07-18

### Fixed

- **Runtime dependency vulnerability closed:** `process-draft-contract.mjs` and `meeting-package-html.mjs` no longer bare-import third-party runtime packages (`ajv`, `ajv-formats`, `fast-xml-parser`). All runtime dependencies are loaded through `runtime-loader.mjs`, ensuring Marketplace-installed plugins without `node_modules` receive structured `FLOW_ARCHITECT_RUNTIME_MISSING` errors instead of `ERR_MODULE_NOT_FOUND` crashes.
- **`ajv-formats` declared as core component dependency:** `ajv-formats@3.0.1` is now formally declared in `runtime/manifest.json`, core component `package.json` and `package-lock.json` for both Codex and Claude adapters, and the canonical runtime directory.
- **Public clone self-containment:** `e2e-procurement.test.mjs` fixtures are now included within the public subproject (`test/fixtures/e2e/public-procurement/`), eliminating the relative path dependency on the parent project.

### Added

- **Production bare import gate:** `test/production-bare-import-gate.test.mjs` enforces that all production scripts in `scripts/lib/` load third-party runtime packages exclusively through the runtime loader.
- **Standalone snapshot export:** `scripts/snapshot-public.mjs` exports the public subproject to an isolated temp directory with symlink, absolute-path, and forbidden-path validation.
- **Standalone snapshot test:** `test/standalone-snapshot.test.mjs` validates snapshot integrity, required paths, pack audit, and npm publish rejection.
- **Dual-host smoke gate:** `scripts/dual-host-smoke.mjs` and `test/dual-host-smoke.test.mjs` verify core runtime installation, Ajv contract loading, `ajv-formats` format validation, `fast-xml-parser` XML parsing, no-`node_modules` cache loading, and structured `FLOW_ARCHITECT_RUNTIME_MISSING` error on missing cache.
- **`pnpm public:release:verify` command:** Read-only verification of snapshot export and pack content audit.
- **`public-release.json` extended** with `repoId`, `publicSourceDir`, `publicRepoUrl`, `tagPrefix`, `snapshotCommands`, `requiredPaths`, `executablePaths`, `npmPublishWhitelist`, and `plugins` (with `npmPackage: null`).
- **ADR-003** (plugin release and runtime governance) documents the release architecture, runtime dependency discipline, dual-host verification, and release transaction boundaries.
- **CHANGELOG.md** (this file).

### Changed

- **Version bumped to 0.3.1** across `package.json`, `build-adapters.mjs` (`PLUGIN_VERSION`), both adapter `.plugin.json` manifests, and both marketplace manifests.
- **INSTALL.md** updated: public clone commands run directly from repo root (`pnpm test`, `pnpm test:contract`, `pnpm test:smoke`, `pnpm build:check`, `pnpm pack --dry-run --json`); added `corepack enable` to requirements; added cache diagnostics/recovery, upgrade paths (v0.2.x, v0.1.x), PPTX component status, and Marketplace installation notes.
- **ADR-001** updated: v0.1.1 Codex auto-dependency-install conclusion marked as historical, with link to ADR-003 for current guarantees.
- **`references/runtime-contract.md`** updated with `ajv-formats` in the component table and the no-bare-import policy.

## [0.3.0] - 2026-07-18

Initial v0.3.0 release with marketplace plugin support for Codex and Claude Code.

## [0.2.0] - 2026-07-16

Process draft V2 with one-diagram-two-tables layout.

## [0.1.2] - 2026-07-15

Runtime loader, runtime manager, setup/help entry, component-based runtime.
