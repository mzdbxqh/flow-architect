# L4 Review Rules

Rules for reviewing L4 sub-process architecture.

---

## FA-L4-001: 4D Boundary Check

**Severity**: BLOCKER
**Deterministic**: No

### Description

Every L4 sub-process step must operate within a single 4D boundary defined by:
1. **Department** (organizational unit)
2. **System** (IT system or manual process)
3. **Time** (temporal boundary, e.g. business day vs. calendar day)
4. **Location** (physical or logical location)

A step that crosses any of these dimensions must be decomposed into separate steps with an explicit handoff.

### Check Procedure

1. For each L4 step, extract the department, system, time, and location attributes.
2. Verify that all four attributes are single-valued (not multi-valued).
3. If any attribute spans multiple values, flag the step as crossing a 4D boundary.
4. Check that handoffs between boundaries have explicit transition definitions.

### Evidence Required

- Step name and identifier
- The four dimension attributes
- If violation: the multi-valued dimension and its values

---

## FA-L4-002: 4D Attribution Check

**Severity**: CRITICAL
**Deterministic**: No

### Description

Every L4 step must have explicit attribution for all four dimensions:
1. **Who**: The responsible role or person
2. **Which System**: The IT system or manual tool used
3. **When**: The timing or trigger condition
4. **Where**: The location or organizational context

Missing attribution in any dimension creates ambiguity in execution responsibility.

### Check Procedure

1. For each L4 step, check presence of who, system, when, where attributes.
2. Flag any step missing one or more dimensions.
3. Verify that "who" references a valid role, not a person name.
4. Verify that "system" references a system, not a vague category.

### Evidence Required

- Step identifier and name
- List of present vs. missing dimensions
- The actual value (or absence) for each dimension

---

## FA-L4-003: Terminal Org Check

**Severity**: CRITICAL
**Deterministic**: No

### Description

L4 steps must not route to organizational units that have no further defined actions. A terminal org is an organizational unit referenced in a handoff that has no subsequent step defined in the architecture.

### Check Procedure

1. For each handoff in the L4 flow, identify the receiving organizational unit.
2. Verify that the receiving unit has at least one subsequent step defined.
3. If the receiving unit has no subsequent step, flag it as a terminal org.
4. Exception: final deliverables to external parties are acceptable terminals.

### Evidence Required

- The handoff step identifier
- The receiving organizational unit
- Whether the unit has subsequent steps

---

## FA-L4-004: Cross-Org Exceptions

**Severity**: MAJOR
**Deterministic**: No

### Description

Cross-organizational handoffs must be explicitly documented with exception handling. When a step transfers work from one organizational unit to another, the exception path (what happens if the receiving unit cannot process) must be defined.

### Check Procedure

1. Identify all cross-organizational handoffs in the L4 flow.
2. For each cross-org handoff, check for an explicit exception handler.
3. Flag handoffs without exception handling.
4. Verify that exception handlers themselves are valid steps.

### Evidence Required

- The cross-org handoff step and its source/target organizations
- Presence or absence of exception handling
- If present, the exception handler step identifier

---

## FA-L4-005: Quantity Consistency

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Input and output quantities referenced in L4 steps must be consistent across connected steps. If step A produces 10 units and step B expects 5, there is a quantity mismatch.

### Check Procedure

1. For each connection between L4 steps, compare output quantity of the source with input quantity of the target.
2. Flag mismatches where quantities do not align.
3. Allow aggregation (many-to-one) and distribution (one-to-many) when explicitly documented.
4. Flag implicit many-to-many connections.

### Evidence Required

- Source step output quantity
- Target step input quantity
- Connection identifier

---

## FA-L4-006: Wait Step Validation

**Severity**: MAJOR
**Deterministic**: No

### Description

Wait or hold steps must have explicit timeout or escalation conditions defined. A step that pauses processing must specify:
1. What condition resumes processing
2. Maximum wait duration
3. Escalation path if wait exceeds the limit

### Check Procedure

1. Identify all steps with wait/hold/pending semantics (by name or attribute).
2. Check for resume condition, timeout, and escalation path.
3. Flag steps missing any of the three required elements.

### Evidence Required

- Step identifier and name
- Presence of resume condition, timeout, escalation path

---

## FA-L4-007: Duplicate Entry Detection

**Severity**: MAJOR
**Deterministic**: Yes

### Description

L4 flow must not contain duplicate entry points for the same trigger condition. Two entry steps that respond to the same trigger create ambiguity about which path is taken.

### Check Procedure

1. Collect all entry point steps (steps with no predecessors).
2. Group entry points by their trigger condition.
3. Flag groups with more than one entry point sharing the same trigger.
4. Exception: parallel paths triggered by the same event but serving different organizational contexts.

### Evidence Required

- Entry point step identifiers
- Their trigger conditions
- The duplicate group

---

## FA-L4-008: System Switch Check

**Severity**: CRITICAL
**Deterministic**: No

### Description

Transitions between systems within a single L4 step must be explicitly documented. A step that involves switching from one IT system to another mid-execution should be decomposed.

### Check Procedure

1. For each L4 step, identify all systems referenced.
2. If a step references more than one system, flag for review.
3. Verify that multi-system steps have explicit handoff documentation between systems.

### Evidence Required

- Step identifier
- Systems referenced in the step
- Whether inter-system handoff is documented

---

## FA-L4-009: Unnecessary Approval Detection

**Severity**: MINOR
**Deterministic**: No

### Description

Approval steps that add no business value or duplicate prior approvals should be flagged. An approval is considered unnecessary when:
1. The same approver has already approved a prior step for the same content
2. The approval is a rubber-stamp with no rejection path
3. The approval adds delay without risk mitigation

### Check Procedure

1. Identify all approval-type steps in the L4 flow.
2. Check if the same approver appears in a prior approval step for the same content scope.
3. Check if the approval step has a rejection or escalation path.
4. Flag approvals that appear to be redundant.

### Evidence Required

- Approval step identifier and assigned role
- Prior approval steps with the same role
- Presence of rejection/escalation path

---

## FA-L4-010: L4 Step Completeness

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Every L4 step must have all required fields populated:
- **Name**: A descriptive step name
- **Assigned Role**: The responsible role (R in RASCI)
- **Input**: At least one input artifact or trigger
- **Output**: At least one output artifact or result
- **Successor or Terminal**: Either a next step or a terminal condition

### Check Procedure

1. For each L4 step, verify presence of: name, role, input, output, successor/terminal.
2. Flag any step missing one or more required fields.
3. Verify that input and output names are non-empty strings.

### Evidence Required

- Step identifier
- List of present vs. missing required fields
