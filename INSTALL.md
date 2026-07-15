# Installation

## Requirements

- Git
- Node.js 22 or newer
- Codex and/or Claude Code

The plugin has Node.js production dependencies and no Python runtime dependencies. Codex installs the declared Node.js dependencies in its plugin cache. Claude Code v0.1.1 uses a source checkout with pnpm so those dependencies remain outside the Git repository and release source archive.

## Codex

Install the stable GitHub release:

```bash
codex plugin marketplace add mzdbxqh/flow-architect --ref v0.1.1
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

The fully supported v0.1.1 path is a source checkout loaded with `--plugin-dir`:

```bash
git clone https://github.com/mzdbxqh/flow-architect.git
cd flow-architect
corepack enable
pnpm install --prod --frozen-lockfile
claude --plugin-dir "$PWD/adapters/claude"
```

Then invoke `/flow-architect:flow-architect`. For non-interactive use:

```bash
claude -p --plugin-dir "$PWD/adapters/claude" \
  'Use /flow-architect:flow-architect to review ./review-inputs without modifying source files.'
```

The repository includes Claude marketplace metadata, but v0.1.1 does not bundle third-party dependencies and Claude marketplace installation does not install ordinary skill-script dependencies. It is therefore not documented as the fully supported Claude Code path yet.

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
