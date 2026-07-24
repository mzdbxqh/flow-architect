# Contributing to Flow Architect

## Development Environment

- **Node.js:** >= 22
- **Package manager:** pnpm 10.30.0 (via corepack)
- **Git**

```bash
git clone https://github.com/ifoohoo/flow-architect.git
cd flow-architect
corepack enable
pnpm install --frozen-lockfile
```

## Project Structure

- `packages/flow-architect/` — The public subproject (唯一公开发布源)
- `scripts/` — Build, test, and verification scripts
- `meeting-package/` — Offline HTML meeting package source
- `test/` — Test files (`.test.mjs`)
- `references/` — Schemas, rules, and contracts
- `skills/` — Skill definitions
- `agents/` — Agent definitions

## Test-Driven Development

This project follows TDD. When adding a feature or fixing a bug:

1. Write a failing test first
2. Implement the change
3. Verify the test passes
4. Run the full test suite

Test files are placed in `test/` with the naming convention `*.test.mjs`. We use Node.js built-in `node:test` and `node:assert/strict`.

## Running Tests

```bash
# Full test suite (includes runtime bootstrap)
pnpm test

# Browser E2E tests only
pnpm test:browser

# Contract and adapter consistency tests
pnpm test:contract

# Smoke tests
pnpm test:smoke
```

## Build and Verify

```bash
# Rebuild meeting package bundle and adapters
pnpm build

# Check that built artifacts match source (no drift)
pnpm build:check

# Verify no private information leaks in public subproject
pnpm public:verify

# Full release verification (snapshot + pack audit)
pnpm public:release:verify
```

## Generated Files

Some files are generated deterministically by build scripts and must not be hand-edited:

- `runtime/meeting-package/editor.bundle.js` — Built by `scripts/build-meeting-editor.mjs`
- `runtime/meeting-package/editor.bundle.css` — Built by `scripts/build-meeting-editor.mjs`
- `runtime/meeting-package/shell.html` — Copied from `meeting-package/shell.html`
- `.claude-plugin/plugin.json` — Built by `scripts/build-adapters.mjs`
- `.claude-plugin/marketplace.json` — Built by `scripts/build-adapters.mjs`
- `.codex-plugin/plugin.json` — Built by `scripts/build-adapters.mjs`
- `adapters/` — Entire directory rebuilt by `scripts/build-adapters.mjs`

To modify a generated file, edit the source and run the corresponding build script.

## Commit Boundary

- Do not commit changes to `runs/`, `artifacts/`, or `node_modules/`.
- Do not commit `.release-skill/` run records or frozen plans.
- All commits must pass `pnpm public:verify` (no absolute user paths, no internal artifact IDs, no private markers).

## Public Boundary

The published package must not contain:

- Absolute user paths (e.g., home directory paths)
- Internal artifact IDs
- Private project markers
- Links to internal documentation

Run `pnpm public:verify` before every commit to enforce this boundary.
