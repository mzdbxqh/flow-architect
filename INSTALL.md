# Installation

## Requirements

- Git
- Node.js 22 or newer
- Codex and/or Claude Code

The plugin has no Python runtime dependency and no project-developed npm package. Third-party Node.js dependencies are not committed to Git or bundled into the GitHub source archive. Codex can install the exact core dependencies declared by the plugin; Claude Code users initialize the selected runtime components into a user cache after installing the plugin.

## Codex

Install the stable GitHub release:

```bash
codex plugin marketplace add mzdbxqh/flow-architect --ref v0.1.2
codex plugin add flow-architect@flow-architect
codex plugin list
```

For a local source checkout:

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
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
/plugin marketplace add mzdbxqh/flow-architect
/plugin install flow-architect@flow-architect
/reload-plugins
/flow-architect:help
/flow-architect:setup
```

`/flow-architect:setup` always selects `core` and asks whether to add PDF, DOCX, or XLSX support. It shows a deterministic plan and requires explicit confirmation before running npm or writing the user cache. Then invoke `/flow-architect:flow-architect` for a review.

For local plugin development:

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
cd flow-architect
corepack enable
pnpm install --frozen-lockfile
claude --plugin-dir "$PWD/adapters/claude"
```

## Tests

From the parent workspace root:

```bash
pnpm --dir packages/flow-architect test
pnpm --dir packages/flow-architect test:contract
pnpm --dir packages/flow-architect test:smoke
pnpm --dir packages/flow-architect build:check
pnpm --dir packages/flow-architect pack --json --dry-run
```

The full Chinese guide is at [docs/zh-CN/user-guide.md](docs/zh-CN/user-guide.md).
