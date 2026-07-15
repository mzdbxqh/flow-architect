# Visual Review Rules

Rules for reviewing visual layout and readability of process diagrams. These rules apply to any visual diagram format (BPMN, Mermaid, SVG, PNG, JPEG, scanned PDF).

## Fact Classification

Every observation during visual review MUST be classified as one of:

- **VISIBLE_FACT**: An observation directly verifiable from the visual rendering (e.g., "line crosses another line", "text label is present"). Confidence can reach 1.0 for structured formats (BPMN XML, Mermaid).
- **INFERRED_RELATION**: A relationship or semantic meaning inferred from visual layout but not directly stated in the data (e.g., "these two boxes appear to be in the same group"). Confidence must not exceed 0.6 for PNG/JPEG/scanned PDF sources.
- **BUSINESS_CONFIRMATION**: An observation that requires business domain knowledge to validate (e.g., "this approval step appears redundant"). Always requires human confirmation.

### Confidence Caps by Source Format

| Source Format | VISIBLE_FACT max | INFERRED_RELATION max |
|---|---|---|
| BPMN XML | 1.0 | 0.9 |
| Mermaid | 1.0 | 0.8 |
| SVG | 0.9 | 0.7 |
| PNG/JPEG | 0.8 | 0.6 |
| Scanned PDF | 0.8 | 0.6 |

---

## FA-VIS-001: Line Crossing Detection

**Severity**: MAJOR
**Deterministic**: No

### Description

Flow lines (sequence flows, message flows) should not cross each other. Line crossings reduce readability and can mislead viewers about process flow direction.

### Fact Type: VISIBLE_FACT (for structured), INFERRED_RELATION (for raster)

### Check Procedure

1. For each pair of flows, check if their visual paths intersect.
2. For structured formats (BPMN XML with DI, SVG with path data), compute geometric intersection.
3. For raster formats, detect crossings from visual layout.
4. Flag crossings with the crossing location.

### Evidence Required

- The two crossing flow identifiers
- Approximate crossing location

---

## FA-VIS-002: Flow Direction Consistency

**Severity**: MAJOR
**Deterministic**: No

### Description

All sequence flows in a diagram should follow a consistent primary direction (left-to-right or top-to-bottom). Mixed directions reduce readability.

### Fact Type: VISIBLE_FACT (for structured), INFERRED_RELATION (for raster)

### Check Procedure

1. Determine the primary flow direction from the majority of flows.
2. Identify any flows that go against the primary direction.
3. Flag reverse-direction flows.

### Evidence Required

- Primary direction detected
- Flow identifiers going against the primary direction

---

## FA-VIS-003: Backflow Detection

**Severity**: CRITICAL
**Deterministic**: No

### Description

Backflow occurs when a flow goes backward relative to the primary reading direction (right-to-left in LTR layouts, or bottom-to-top). Backflow indicates either a loop that should be explicit or a layout error.

### Fact Type: VISIBLE_FACT (for structured), INFERRED_RELATION (for raster)

### Check Procedure

1. For each sequence flow, determine the relative position of source and target.
2. If the target is positioned before the source in the primary reading direction, flag as backflow.
3. Exception: explicit loop-back flows with a clear label are acceptable.

### Evidence Required

- Flow identifier
- Source and target positions
- Whether the flow is labeled as a loop

---

## FA-VIS-004: Diagram Density

**Severity**: MINOR
**Deterministic**: Yes

### Description

Diagrams should not contain an excessive number of elements in a single view. High density reduces readability and comprehension.

### Fact Type: VISIBLE_FACT

### Check Procedure

1. Count the total number of visual elements (excluding pools and lanes).
2. Warn if element count exceeds 25 in a single process/pool.
3. Block if element count exceeds 50.

### Evidence Required

- Total element count
- Threshold exceeded

---

## FA-VIS-005: Label Readability

**Severity**: MAJOR
**Deterministic**: No

### Description

All element labels must be readable: sufficient font size, not truncated, not overlapping with other elements.

### Fact Type: VISIBLE_FACT (for structured), INFERRED_RELATION (for raster)

### Check Procedure

1. For structured formats, check that all named elements have non-empty labels.
2. For raster formats, assess label legibility.
3. Flag labels that appear truncated or overlapping.

### Evidence Required

- Element identifier
- Label text or legibility assessment

---

## FA-VIS-006: Spacing Consistency

**Severity**: MINOR
**Deterministic**: No

### Description

Elements in a diagram should have consistent spacing. Uneven spacing suggests layout problems and reduces professional appearance.

### Fact Type: VISIBLE_FACT (for structured), INFERRED_RELATION (for raster)

### Check Procedure

1. Measure distances between adjacent elements in the same lane or row.
2. Calculate the variance of inter-element distances.
3. Flag diagrams with high spacing variance.

### Evidence Required

- Set of inter-element distances
- Variance measure

---

## FA-VIS-007: Color Dependency

**Severity**: MAJOR
**Deterministic**: No

### Description

Diagrams must not rely solely on color to convey meaning. Information distinguished only by color is inaccessible to colorblind users and fails in grayscale printing.

### Fact Type: VISIBLE_FACT

### Check Procedure

1. Identify elements differentiated only by color (same shape, same type, different fill/stroke).
2. If color is the sole differentiator, flag for review.
3. Verify that a legend or text annotation provides alternative differentiation.

### Evidence Required

- Elements distinguished only by color
- Presence or absence of alternative differentiation

---

## FA-VIS-008: Legend Presence

**Severity**: MINOR
**Deterministic**: Yes

### Description

Diagrams with custom symbols, colors, or non-standard notations should include a legend explaining the visual vocabulary.

### Fact Type: VISIBLE_FACT

### Check Procedure

1. Check if the diagram uses custom symbols or non-standard color coding.
2. If custom visual vocabulary is detected, check for a legend element.
3. Flag if custom vocabulary exists without a legend.

### Evidence Required

- Custom visual elements detected
- Legend presence or absence

---

## FA-VIS-009: Title and Metadata

**Severity**: MINOR
**Deterministic**: Yes

### Description

Diagrams should have a title or caption that identifies the process being depicted. Metadata such as version, date, and author improves traceability.

### Fact Type: VISIBLE_FACT

### Check Procedure

1. Check for a title text element in the diagram.
2. Check for metadata annotations (version, date, author).
3. Flag if no title is present.

### Evidence Required

- Title text element presence
- Metadata annotations present

---

## FA-VIS-010: Minimum Element Separation

**Severity**: MINOR
**Deterministic**: No

### Description

Adjacent elements must have sufficient separation to be visually distinguishable. Overlapping elements create ambiguity about whether they are separate or merged.

### Fact Type: VISIBLE_FACT (for structured), INFERRED_RELATION (for raster)

### Check Procedure

1. For each pair of elements, check if their bounding boxes overlap.
2. Flag overlapping elements.
3. For raster formats, flag elements that appear to touch or merge.

### Evidence Required

- Element pair identifiers
- Overlap area or separation distance
