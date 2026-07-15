# SOP Review Rules

Rules for reviewing Standard Operating Procedure architecture.

---

## FA-SOP-001: Scenario Context Required

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Every SOP must declare the business scenario or context in which it applies. An SOP without context is ambiguous about when it should be followed.

### Check Procedure

1. For each SOP, check for a scenario or context field.
2. Verify that the context is non-empty and specific (not generic like "all scenarios").
3. Flag SOPs without a declared scenario context.

### Evidence Required

- SOP identifier
- Scenario/context field value (or absence)

---

## FA-SOP-002: Five Signals Check

**Severity**: MAJOR
**Deterministic**: No

### Description

SOP must identify trigger signals for each procedure entry:
1. **Who** initiates the procedure
2. **What** condition triggers the procedure
3. **When** the procedure should be executed
4. **Where** the procedure applies
5. **Why** the procedure is needed (business justification)

### Check Procedure

1. For each SOP entry, check for the five signal dimensions.
2. Flag entries missing one or more signals.
3. Verify that signals are specific, not vague.

### Evidence Required

- SOP entry identifier
- Presence/absence of each of the five signals
- Signal specificity assessment

---

## FA-SOP-003: Specialization Fields

**Severity**: MAJOR
**Deterministic**: No

### Description

SOP must specify specialization fields such as applicable product lines, regions, or departments. An SOP that applies to everything effectively applies to nothing with precision.

### Check Procedure

1. For each SOP, check for specialization fields (product line, region, department, etc.).
2. Verify that at least one specialization dimension is specified.
3. Flag SOPs that declare universal applicability without justification.

### Evidence Required

- SOP identifier
- Specialization fields (or absence)

---

## FA-SOP-004: Non-Empty L6 Reference

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Every SOP entry must reference at least one L6 step or explain why no L6 decomposition exists. An SOP entry without an L6 reference is either incomplete or belongs to a different abstraction level.

### Check Procedure

1. For each SOP entry, check for L6 step references.
2. If no L6 reference exists, check for an explicit justification.
3. Flag entries with neither L6 reference nor justification.

### Evidence Required

- SOP entry identifier
- L6 references (or absence)
- Justification for absence (if any)

---

## FA-SOP-005: SOP Attribution

**Severity**: MAJOR
**Deterministic**: Yes

### Description

SOP entries must attribute ownership to a specific role or organizational unit. Unowned SOPs cannot be maintained or enforced.

### Check Procedure

1. For each SOP entry, check for an owner (role or organizational unit).
2. Verify that the owner is a valid entity in the architecture model.
3. Flag entries without ownership attribution.

### Evidence Required

- SOP entry identifier
- Owner role/unit (or absence)
- Owner validity in the architecture model

---

## FA-SOP-006: Reference Validity

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

All references from SOP to L4/L5/L6 nodes must resolve to existing nodes in the architecture model. Broken references indicate structural inconsistency.

### Check Procedure

1. Collect all cross-references from SOP entries to L4, L5, and L6 nodes.
2. For each reference, verify that the target node exists in the architecture model.
3. Flag all broken (unresolvable) references.

### Evidence Required

- SOP entry identifier
- The reference target
- Whether the target exists in the architecture model

---

## FA-SOP-007: Applicability Scope

**Severity**: MAJOR
**Deterministic**: No

### Description

SOP must declare its applicability scope as one of:
1. **Universal**: Applies to all instances of the process
2. **Conditional**: Applies only when specific conditions are met
3. **Exception-Only**: Applies only as an exception to the default process

### Check Procedure

1. For each SOP, check for an applicability scope declaration.
2. If conditional, verify that conditions are specific and verifiable.
3. If exception-only, verify that the default process is referenced.
4. Flag SOPs without a scope declaration.

### Evidence Required

- SOP identifier
- Applicability scope declaration
- If conditional: the specific conditions
- If exception-only: the default process reference
