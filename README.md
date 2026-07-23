# Flow Architect

Flow Architect is a process architecture and diagram review skill family for Codex and Claude Code, with creation capabilities for process drafts and offline meeting packages.

## Quick Installation

**Codex (stable):**

```bash
codex plugin marketplace add ifoohoo/flow-architect --ref v0.5.0
codex plugin add flow-architect@flow-architect
```

**Claude Code Marketplace (recommended):**

```bash
/plugin marketplace add ifoohoo/flow-architect
/plugin install flow-architect@flow-architect
/reload-plugins
/flow-architect:setup
```

`setup` installs core components and lets you choose optional ones (PDF, DOCX, XLSX, PPTX). Dependencies are written to user cache, not into Git or plugin directories.

For detailed installation, usage examples, update, uninstall, and troubleshooting, see the [full installation guide](INSTALL.md) or the [Chinese user guide](docs/zh-CN/user-guide.md).

### Verifying from Source (Contributors)

To validate the plugin from source or contribute to development:

```bash
git clone https://github.com/ifoohoo/flow-architect.git
cd flow-architect
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

This is for contributors only; regular users should install from marketplace as described above.

## Minimal Verification Example

After installation, run the help command to verify everything is working:

```bash
# Claude Code
/flow-architect:help

# Codex
$flow-architect-help
```

This read-only command displays all available skills, runtime status, supported formats, examples, and diagnostics without modifying any files. If you see the capability table and runtime status, the installation is successful.

## Entry Skills

| Skill | Purpose |
|---|---|
| `flow-architect` | Default entry; inspects inputs and routes to integrated review |
| `flow-architect-flow-review-integrated` | Joint review of process architecture and diagrams |
| `flow-architect-flow-review-architecture` | Review L4/L5/L6/SOP layered architecture only |
| `flow-architect-flow-review-diagram` | Review BPMN, Mermaid, SVG, PNG, or PDF diagrams only |
| `flow-architect-build-meeting-package` | Build an offline editable HTML discussion package from one complete V2 process draft |
| `flow-architect-draft-process` | Generate L5 BPMN process drafts from multiple source materials (deterministic, zero-LLM extraction and generation) |
| `flow-architect-help` | Show capabilities, runtime status, examples, and diagnostics |
| `flow-architect-setup` | Initialize core and user-selected optional runtime components |
| `flow-architect-quickstart` | Formal natural-language entry; enumerates candidate public methods deterministically and routes to the chosen strict entry after user confirmation |

The default entry skill (`flow-architect`) inspects your input files, determines which artifact families are present, and routes to the appropriate review flow. The three flow skills can also be invoked directly when you know which review you need.

## Supported Input Formats

**Process architecture:** JSON, YAML, CSV, XLSX, Markdown, DOCX, text PDF.

**Process diagrams:** BPMN 2.0 XML, Mermaid, SVG, PNG, JPEG, scanned PDF.

## Getting Started Safely

<!-- release-skill:capability:safe-first-command -->

The safest first command is **`/flow-architect:help`** — it is read-only, shows all available skills, runtime status, supported formats, examples, and diagnostics without modifying any files.

## Capability Boundary

<!-- release-skill:capability:external-write-boundary -->

Review skills are **read-only**: they inspect existing artifacts and produce structured findings without modifying, creating, or fixing any user files.

Creation skills (`flow-architect-draft-process`, `flow-architect-build-meeting-package`) generate new artifacts **only** in a user-authorized run directory, without modifying original inputs. Draft generation is deterministic (zero LLM for extraction, batching, BPMN generation, and HTML packaging); LLM is only invoked during per-batch semantic interpretation. The two paths are complementary: drafts produce reviewable artifacts, and review skills evaluate them.

## Process Draft — Format Support

| Format | Status | Notes |
|--------|--------|-------|
| Markdown (.md) | ✅ Full | Chunked by heading, line numbers preserved |
| PDF (.pdf) | ✅ Full | Per-page extraction; low-text pages marked visual |
| DOCX (.docx) | ✅ Full | Text extraction |
| XLSX (.xlsx) | ✅ Full | Dynamic classification based on actual OOXML content: supports tables, native DrawingML, images, and mixed inputs; explicit ID relationships form connections, missing or ambiguous relationships generate warnings/degradation, no geometric distance guessing |
| PPTX (.pptx) | ⚠️ Requires component | Install via `/flow-architect:setup` or `$flow-architect-setup` |
| PNG/JPEG | ⚠️ Visual asset | Marked visual, no OCR |
| BPMN (.bpmn) | ✅ Full | Element and flow extraction |
| Mermaid / SVG | ✅ Full | Structure extraction |

## Process Draft — Meeting Workflow

**Before the meeting:** Generate one V2 process draft. The deterministic compiler turns that business contract into BPMN XML/DI and an offline HTML discussion package.

**During the meeting:** Open the HTML in a browser (no network required). View and edit the process diagram, process card, activity catalog, and confirmation questions in one file. Structural changes are re-laid out deterministically after each operation. Export a new revision at any time.

**After the meeting:** Extract the exported HTML revision using `extract-meeting-package.mjs`, compare it against the original draft with `compare-package-revisions.mjs`, and feed the confirmed changes back as the next iteration's input.

## Process Draft — Cache and Recovery

Preparation results are cached per run directory. On re-run with identical inputs, cached batches are reused (queue status `CACHED`) and only new or changed inputs enter `PENDING`. If a cached batch is corrupted (hash mismatch, evidence drift), that single item falls back to `PENDING` while other valid cached items remain `CACHED`.

## Process Draft — Deterministic Zero-LLM Stages

The following stages run with zero LLM calls — pure deterministic code:

- **Extraction:** Text, tables, and structured diagrams extracted from source files.
- **Normalization:** Heterogeneous inputs (MD, PDF, DOCX, XLSX, PPTX, BPMN, Mermaid, SVG) converted to locatable Markdown shards.
- **Batching:** Evidence split into ≤12,000-char batches with ≤12 blocks and ≤1 visual. Each batch includes a context budget report.
- **Budget gates:** Three-state budget (BUDGET_OK / BUDGET_ATTENTION / BUDGET_SPLIT_REQUIRED). Batches exceeding 120% of the token limit are blocked from worker dispatch.
- **BPMN generation:** L5 BPMN 2.0 XML + DI generated from merged semantic fragments.
- **HTML packaging:** Offline meeting package assembled with process diagram, questions, and metadata.

Only per-batch semantic interpretation (fragment production) may invoke an LLM worker.

## Offline Meeting Package

Build an offline HTML discussion package from one complete V2 process draft:

```bash
node scripts/build-single-diagram-html.mjs \
  --draft ./process-draft.json \
  --title "Procurement Approval" \
  --revision r01 \
  --package-id procurement-approval \
  --run-dir ./runs/meeting-package \
  --output procurement-r01.html
```

The V2 draft is the single business-data source and includes `process_card`, `activities`, `diagram`, and `questions`. BPMN XML and DI are compiled deterministically; the command does not accept model-generated coordinates.

The generated HTML:
- Opens and edits offline without network access
- Shows and edits the process diagram, process card, and activity catalog together
- Supports bidirectional navigation between questions and process elements
- Uses a limited BPMN toolbox with inline SVG icons (no font loading, works under strict CSP)
- Toolbar edit buttons are disabled until a diagram element is selected
- All structural operations (intermediate events, end events, lanes, gateways, sequence flows) use styled business dialogs with validation
- Sequence flow connections filter out self-loops and invalid targets
- A first-visit guide banner explains the workflow; dismissible and localStorage-persisted
- Diagram panel is fully hidden when viewing other tabs
- Deterministic full re-layout after every structural operation
- Exports new HTML versions, BPMN, SVG, questions JSON, and the complete V2 JSON
- All exports gated by JSON Schema validation (CSP-safe Ajv standalone precompilation)

## Confidence Degradation

Images and scanned PDFs are analyzed visually. Structural conclusions drawn from image-only inputs carry reduced confidence (at most 0.6) and may require business confirmation. The plugin will not produce fabricated precise BPMN element-level conclusions from images.

## Run Directory

Each review session creates a structured run directory:

```text
runs/flow-architect/<run-id>/
├── input/
│   └── input-manifest.json
├── stages/
│   ├── 10-inspect/
│   ├── 20-extract-architecture/
│   ├── 21-extract-diagram/
│   ├── 30-review-l4/
│   ├── 31-review-l5/
│   ├── 32-review-l6/
│   ├── 33-review-sop/
│   ├── 40-review-hierarchy/
│   ├── 41-review-bpmn/
│   ├── 42-review-visual/
│   ├── 50-review-consistency/
│   └── 60-validate/
└── final/
    ├── result.json
    ├── review-verdict.json
    └── review-report.md
```

The run root directory is determined by the user or target project; it is not written into the installed plugin directory.

## Troubleshooting

### Installation Fails

- **Codex:** Run `codex plugin list` to check if the plugin is registered. If not, verify marketplace access with `codex plugin marketplace list`.
- **Claude Code:** Run `/plugin list` to verify installation. If the plugin doesn't appear, try `/reload-plugins` or see the [full installation guide](INSTALL.md).

### Help Command Not Visible

- **Claude Code:** Ensure you've run `/reload-plugins` after installation. If still not visible, try restarting the Claude Code session.
- **Codex:** Run `codex plugin list` to verify the plugin is installed. The help command should appear as `$flow-architect-help`.

### Runtime Components Not Ready

- Run `/flow-architect:setup` (Claude Code) or `$flow-architect-setup` (Codex) to initialize core and optional components.
- Run `/flow-architect:help` or `$flow-architect-help` to check runtime status and diagnostics.
- See the [full installation guide](INSTALL.md) for cache diagnostics and recovery steps.

### PPTX Support Missing

- PPTX processing requires additional components. Install via `/flow-architect:setup` or `$flow-architect-setup` and select the PPTX option when prompted.

## Privacy Boundary

The published package (`@flow-architect/plugin`) contains only generalized rules, schemas, scripts, and adapters. It does not contain:

- Private source methodology documents
- Internal artifact IDs or project-specific references
- Absolute user paths or environment-specific configuration
- Proprietary methodology terminology or original training materials

All private materials remain in the parent workspace and are excluded from the published package through `public-release.json` governance and automated leak scanning.

## License

Apache-2.0
