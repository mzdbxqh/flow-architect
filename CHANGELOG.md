# Changelog

All notable changes to Flow Architect are documented in this file.

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
