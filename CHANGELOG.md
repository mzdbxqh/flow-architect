# Changelog

All notable changes to Flow Architect are documented in this file.

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
