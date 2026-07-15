# Flow Architect

Flow Architect is a read-only process architecture and diagram review skill family for Codex and Claude Code.

For installation and usage instructions, see [INSTALL.md](INSTALL.md) or the [Chinese user guide](docs/zh-CN/user-guide.md).

## Entry Skills

| Skill | Purpose |
|---|---|
| `flow-architect` | Default entry; inspects inputs and routes to integrated review |
| `flow-architect-flow-review-integrated` | Joint review of process architecture and diagrams |
| `flow-architect-flow-review-architecture` | Review L4/L5/L6/SOP layered architecture only |
| `flow-architect-flow-review-diagram` | Review BPMN, Mermaid, SVG, PNG, or PDF diagrams only |
| `flow-architect-build-meeting-package` | Build offline HTML discussion package from BPMN + questions JSON |
| `flow-architect-help` | Show capabilities, runtime status, examples, and diagnostics |
| `flow-architect-setup` | Initialize core and user-selected optional runtime components |

The default entry skill (`flow-architect`) inspects your input files, determines which artifact families are present, and routes to the appropriate review flow. The three flow skills can also be invoked directly when you know which review you need.

## Supported Input Formats

**Process architecture:** JSON, YAML, CSV, XLSX, Markdown, DOCX, text PDF.

**Process diagrams:** BPMN 2.0 XML, Mermaid, SVG, PNG, JPEG, scanned PDF.

## V1 Scope

V1 is **read-only**. It reviews existing artifacts and produces structured findings, but does not modify, create, or fix any user files.

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
