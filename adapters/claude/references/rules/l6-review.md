# L6 Review Rules

Rules for reviewing L6 sub-process architecture.

---

## FA-L6-001: One-Breath Granularity

**Severity**: MAJOR
**Deterministic**: No

### Description

Each L6 step must be describable in one breath (approximately 15 seconds of speaking). If a step requires multiple sentences to describe, it is too coarse and should be decomposed further.

### Check Procedure

1. For each L6 step, estimate the speaking time for its description.
2. If the description exceeds one sentence or 15 seconds, flag for review.
3. Check whether the step contains compound actions (e.g. "validate AND approve").

### Evidence Required

- L6 step identifier and description
- Description length (word count or sentence count)
- Whether compound actions are detected

---

## FA-L6-002: Verb-Object Naming at L6

**Severity**: MAJOR
**Deterministic**: Yes

### Description

L6 step names must follow verb-object pattern, consistent with parent L5 naming conventions. The L6 name should be a refinement of its parent L5 name, not a completely different domain.

### Check Procedure

1. For each L6 step, check that the name follows verb-object pattern.
2. Verify that the L6 name's verb-object domain is consistent with its parent L5 name.
3. Flag names that do not follow the pattern or that drift from the parent domain.

### Evidence Required

- L6 step identifier and name
- Parent L5 step identifier and name
- Whether the naming pattern is consistent

---

## FA-L6-003: Business Semantics Only

**Severity**: CRITICAL
**Deterministic**: No

### Description

L6 steps must describe business actions, not technical system operations. "Submit the purchase requisition for approval" is business semantics. "POST /api/v1/requisitions" is technical leakage.

### Check Procedure

1. For each L6 step description, scan for technical language (API paths, SQL, UI controls, code references).
2. Flag steps that use technical language instead of business language.
3. Suggest business-language alternatives for flagged steps.

### Evidence Required

- L6 step identifier and description
- Technical language detected (if any)
- Suggested business-language alternative

---

## FA-L6-004: Tool Leakage Detection

**Severity**: MAJOR
**Deterministic**: Yes

### Description

L6 steps must not contain references to specific tool names, API endpoints, or database tables. Tool references belong in implementation documentation, not in business process architecture.

### Check Procedure

1. Maintain a pattern list of known tool names, API patterns, and database naming conventions.
2. For each L6 step, scan the name and description against the pattern list.
3. Flag steps containing tool-specific references.

### Evidence Required

- L6 step identifier and name/description
- The specific tool reference detected
- The pattern that matched

---

## FA-L6-005: Role Leakage Detection

**Severity**: MAJOR
**Deterministic**: No

### Description

L6 steps must not embed role assignments that belong to the L4 or L5 layer. Role assignment is a property of the parent process layer, not the step-level detail layer.

### Check Procedure

1. For each L6 step, check if role assignments or RASCI attributions are embedded in the step description.
2. Flag steps that contain explicit role references beyond the executing role.
3. Role references should be at the L4 or L5 level, not repeated at L6.

### Evidence Required

- L6 step identifier and description
- Embedded role references (if any)
- The parent L4/L5 role attribution for comparison

---

## FA-L6-006: L6 Step Completeness

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Each L6 step must have all required fields:
- **Name**: A descriptive step name following verb-object pattern
- **Input Reference**: At least one input artifact or trigger
- **Output Reference**: At least one output artifact or result
- **Parent L5 Link**: A valid reference to the parent L5 process

### Check Procedure

1. For each L6 step, verify presence of: name, input reference, output reference, parent L5 link.
2. Verify that the parent L5 link resolves to an existing L5 node.
3. Flag any step missing required fields or with a broken parent link.

### Evidence Required

- L6 step identifier
- List of present vs. missing required fields
- Parent L5 link validity
