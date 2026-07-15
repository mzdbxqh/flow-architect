# Installation

## Codex

Codex installs published plugins from a configured marketplace. After the
public repository or marketplace is available, add that source and install the
plugin using the marketplace name reported by Codex:

```bash
codex plugin marketplace add <owner/repository>
codex plugin marketplace list
codex plugin add flow-architect@<marketplace-name>
```

For an unpublished source checkout, validate the adapter locally instead of
claiming it is installed:

```bash
python3 /path/to/plugin-creator/scripts/validate_plugin.py packages/flow-architect/adapters/codex
```

List marketplace plugins and installed state:

```bash
codex plugin list
```

### Uninstall (Codex)

```bash
codex plugin remove flow-architect@<marketplace-name>
```

## Claude Code

### Option A: Plugin directory

```bash
claude -p --plugin-dir ./packages/flow-architect/adapters/claude
```

### Option B: Published marketplace

After a Claude marketplace has been published, add it and install the plugin:

```bash
claude plugin marketplace add <owner/repository>
claude plugin install flow-architect@<marketplace-name>
```

Verify:

```bash
claude plugin list
```

### Uninstall (Claude Code)

If installed from a marketplace:

```bash
claude plugin uninstall flow-architect@<marketplace-name>
```

If using `--plugin-dir`, no uninstall step is needed; simply stop passing the flag.

## Running Tests

From the workspace root:

```bash
pnpm install
pnpm test
pnpm build
pnpm build:check
```

Or from the plugin directory:

```bash
cd packages/flow-architect
pnpm test
```

## Contract and Smoke Tests

```bash
# Skill structure and worker binding validation
pnpm --dir packages/flow-architect test:contract

# Integrated review smoke test
pnpm --dir packages/flow-architect test:smoke

# Dry-run pack to verify package contents
cd packages/flow-architect && pnpm pack --dry-run
```

## Verifying Package Contents

To verify the published package does not contain private material:

```bash
# From the workspace root
pnpm public:verify

# From the plugin directory
pnpm pack --json --dry-run
```
