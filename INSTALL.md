# Installation

English | [简体中文](docs/zh-CN/user-guide.md)

## Requirements

- Git
- Node.js 22 or newer
- pnpm (install via `corepack enable` if using Node.js 22+)
- Codex and/or Claude Code

The plugin has no Python runtime dependency and no project-developed npm package. Third-party Node.js dependencies are not committed to Git or bundled into the GitHub source archive. Codex can install the exact core dependencies declared by the plugin; Claude Code users initialize the selected runtime components into a user cache after installing the plugin. Marketplace installation does not automatically install plugin root dependencies; the `/flow-architect:setup` command handles runtime initialization separately.

## Codex

Install the stable GitHub release:

```bash
codex plugin marketplace add ifoohoo/flow-architect --ref v0.5.1
codex plugin add flow-architect@flow-architect
codex plugin list
```

> **升级提示：** 从 v0.1.x 升级时，请先移除旧版本再安装新版本。

For a local source checkout:

```bash
git clone https://github.com/ifoohoo/flow-architect.git
cd flow-architect
codex plugin marketplace add "$PWD"
codex plugin add flow-architect@flow-architect
```

Use `$flow-architect` in a new Codex task. Uninstall with:

```bash
codex plugin remove flow-architect@flow-architect
codex plugin marketplace remove flow-architect
```

## Claude Code

Install from the public Claude Marketplace:

```bash
/plugin marketplace add ifoohoo/flow-architect
/plugin install flow-architect@flow-architect
/reload-plugins
/flow-architect:help
/flow-architect:setup
```

`/flow-architect:setup` always selects `core` and asks whether to add PDF, DOCX, XLSX, or PPTX support. It shows a deterministic plan and requires explicit confirmation before running npm or writing the user cache. Then invoke `/flow-architect:flow-architect` for a review, or `/flow-architect:quickstart` to route a natural-language request to the right strict entry.

For local plugin development:

```bash
git clone https://github.com/ifoohoo/flow-architect.git
cd flow-architect
corepack enable
pnpm install --frozen-lockfile
claude --plugin-dir "$PWD/adapters/claude"
```

## Upgrading from v0.2.x

1. Uninstall the old plugin: `/plugin uninstall flow-architect@flow-architect` (Claude) or `codex plugin remove flow-architect@flow-architect` (Codex).
2. Install v0.5.1 following the instructions above.
3. Run `/flow-architect:setup` to re-initialize the runtime cache. The setup command is idempotent and reuses existing verified caches.

## Upgrading from v0.1.x

Follow the same uninstall-then-install pattern. The runtime cache format changed in an earlier release; re-running setup is required.

## Cache Diagnostics and Recovery

The runtime cache lives at:

| Platform | Default Cache Path |
|---|---|
| macOS | `~/Library/Caches/flow-architect/` |
| Linux | `~/.cache/flow-architect/` |
| Windows | `%LOCALAPPDATA%\flow-architect\` |

Override with the `FLOW_ARCHITECT_CACHE_DIR` environment variable.

To verify cache integrity: invoke the help skill (`/flow-architect:help` or `$flow-architect-help`) which reports runtime status. To force a clean rebuild, delete the cache directory and re-run setup.

## PPTX Support

PPTX input parsing requires the optional `pptx` runtime component. The setup skill asks whether to install it. If not installed, PPTX inputs are rejected with a structured capability error directing the user to run setup.

## Tests

From the public repository root (after `pnpm install --frozen-lockfile`):

```bash
pnpm test
pnpm test:contract
pnpm test:smoke
pnpm build:check
pnpm pack --dry-run --json
```

The full Chinese guide is at [docs/zh-CN/user-guide.md](docs/zh-CN/user-guide.md).
