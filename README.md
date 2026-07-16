# Flow Architect

Flow Architect is a process architecture and diagram review skill family for Codex and Claude Code, with creation capabilities for process drafts and offline meeting packages.

For installation and usage instructions, see [INSTALL.md](INSTALL.md) or the [Chinese user guide](docs/zh-CN/user-guide.md).

## Entry Skills

| Skill | Purpose |
|---|---|
| `flow-architect` | Default entry; inspects inputs and routes to integrated review |
| `flow-architect-flow-review-integrated` | Joint review of process architecture and diagrams |
| `flow-architect-flow-review-architecture` | Review L4/L5/L6/SOP layered architecture only |
| `flow-architect-flow-review-diagram` | Review BPMN, Mermaid, SVG, PNG, or PDF diagrams only |
| `flow-architect-build-meeting-package` | Build offline HTML discussion package from BPMN + questions JSON |
| `flow-architect-draft-process` | Generate L5 BPMN process drafts from multiple source materials (deterministic, zero-LLM extraction and generation) |
| `flow-architect-help` | Show capabilities, runtime status, examples, and diagnostics |
| `flow-architect-setup` | Initialize core and user-selected optional runtime components |

The default entry skill (`flow-architect`) inspects your input files, determines which artifact families are present, and routes to the appropriate review flow. The three flow skills can also be invoked directly when you know which review you need.

## Supported Input Formats

**Process architecture:** JSON, YAML, CSV, XLSX, Markdown, DOCX, text PDF.

**Process diagrams:** BPMN 2.0 XML, Mermaid, SVG, PNG, JPEG, scanned PDF.

## V1 Scope

V1 review skills are **read-only**: they inspect existing artifacts and produce structured findings without modifying, creating, or fixing any user files.

Phase 2 adds `flow-architect-draft-process`, a **creation** skill that generates process drafts from source materials. Draft generation is deterministic (zero LLM for extraction, batching, BPMN generation, and HTML packaging); LLM is only invoked during per-batch semantic interpretation. The two paths are complementary: drafts produce reviewable artifacts, and review skills evaluate them.

## Process Draft — Format Support

| Format | Status | Notes |
|--------|--------|-------|
| Markdown (.md) | ✅ Full | Chunked by heading, line numbers preserved |
| PDF (.pdf) | ✅ Full | Per-page extraction; low-text pages marked visual |
| DOCX (.docx) | ✅ Full | Text extraction |
| XLSX (.xlsx) | ✅ Full | Per-sheet table extraction |
| PPTX (.pptx) | ⚠️ Requires component | Install via `/flow-architect:setup` or `$flow-architect-setup` |
| PNG/JPEG | ⚠️ Visual asset | Marked visual, no OCR |
| BPMN (.bpmn) | ✅ Full | Element and flow extraction |
| Mermaid / SVG | ✅ Full | Structure extraction |

## Process Draft — Meeting Workflow

**Before the meeting:** Generate the draft from source materials, producing BPMN, questions JSON, and an offline HTML discussion package.

**During the meeting:** Open the HTML in a browser (no network required). Edit process elements, answer questions, and mark confidence. Export a new revision at any time.

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

Build an offline HTML discussion package from BPMN XML and questions JSON:

```bash
node scripts/build-single-diagram-html.mjs \
  --bpmn ./process.bpmn \
  --questions ./questions.json \
  --title "Procurement Approval" \
  --revision r01 \
  --package-id procurement-approval \
  --run-dir ./runs/meeting-package \
  --output procurement-r01.html
```

When the BPMN contains multiple processes, you must specify which one to build:

```bash
node scripts/build-single-diagram-html.mjs \
  --bpmn ./multi-process.bpmn \
  --questions ./questions.json \
  --title "Order Process" \
  --revision r01 \
  --package-id order-process \
  --process-id Process_Order \
  --run-dir ./runs/meeting-package \
  --output order-r01.html
```

When the BPMN contains exactly one process, `--process-id` can be omitted and is auto-inferred.

The generated HTML:
- Opens and edits offline without network access
- Supports bidirectional navigation between questions and process elements
- Supports undo, redo, and business-friendly editing
- Exports new HTML versions, BPMN, SVG, and questions JSON

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

## Privacy Boundary

The published package (`@flow-architect/plugin`) contains only generalized rules, schemas, scripts, and adapters. It does not contain:

- Private source methodology documents
- Internal artifact IDs or project-specific references
- Absolute user paths or environment-specific configuration
- Proprietary methodology terminology or original training materials

All private materials remain in the parent workspace and are excluded from the published package through `public-release.json` governance and automated leak scanning.

## License

Apache-2.0
