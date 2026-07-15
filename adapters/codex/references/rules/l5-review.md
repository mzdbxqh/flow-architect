# L5 Review Rules

Rules for reviewing L5 sub-process architecture.

---

## FA-L5-001: Single Main Role

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Each L5 sub-process must have exactly one main Responsible (R) role. When multiple roles share responsibility, accountability is diluted and handoff points become ambiguous.

### Check Procedure

1. For each L5 process, extract the assigned roles with RASCI attribution.
2. Count the number of roles with "R" (Responsible) attribution.
3. Flag processes with zero R roles or more than one R role.
4. Multiple "S" (Support), "C" (Consulted), or "I" (Informed) roles are acceptable.

### Evidence Required

- L5 process identifier and name
- List of roles with their RASCI attribution
- Count of R-attributed roles

---

## FA-L5-002: Business Output Four Questions

**Severity**: MAJOR
**Deterministic**: No

### Description

Each L5 output must answer four questions:
1. **What** is delivered?
2. **To whom** is it delivered?
3. **In what format** is it delivered?
4. **By when** is it delivered (timing/SLA)?

### Check Procedure

1. For each L5 output artifact, check for answers to all four questions.
2. Flag outputs missing one or more answers.
3. Verify that "to whom" references a valid role or organizational unit.
4. Verify that "by when" specifies a concrete time frame, not "ASAP" or "immediately".

### Evidence Required

- Output artifact identifier
- Presence/absence of each of the four answers

---

## FA-L5-003: Verb-Object Naming Convention

**Severity**: MAJOR
**Deterministic**: Yes

### Description

L5 process names must follow verb-object pattern. Acceptable: "Approve Request", "Validate Data", "Generate Report". Unacceptable: "Request Approval" (noun-verb), "Data Validation" (noun-noun), "Approval" (noun-only).

### Check Procedure

1. For each L5 process, parse the name into words.
2. Check that the first word is a verb (action word).
3. Check that subsequent words form a noun phrase (the object being acted upon).
4. Flag names that do not follow verb-object pattern.

### Evidence Required

- L5 process identifier and name
- Parsed verb and object components
- Whether the pattern matches

---

## FA-L5-004: R0 Anti-Pattern: Missing Input

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

L5 process must not start without a clearly defined trigger or input artifact. A process with no inputs is either unreachable or represents an incomplete specification.

### Check Procedure

1. For each L5 process, check for at least one input artifact or trigger condition.
2. Flag processes with zero inputs.
3. Exception: top-level entry processes may have event-based triggers instead of artifact inputs.

### Evidence Required

- L5 process identifier and name
- List of input artifacts (or absence thereof)
- Whether an event trigger is defined

---

## FA-L5-005: R1 Anti-Pattern: Orphan Output

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

L5 output must connect to a downstream consumer or be a documented final deliverable. An output with no consumer creates a dead end in the process flow.

### Check Procedure

1. For each L5 output, trace to downstream consumers.
2. If no consumer is found, check if the output is a documented final deliverable.
3. Flag outputs that are neither consumed nor final deliverables.

### Evidence Required

- Output artifact identifier
- Downstream consumer step (if any)
- Whether it is marked as a final deliverable

---

## FA-L5-006: R2 Anti-Pattern: Role Mismatch

**Severity**: CRITICAL
**Deterministic**: No

### Description

The assigned role must be capable of performing the described action in the given system context. For example, assigning a "Finance Manager" to perform a "Code Review" is a role mismatch.

### Check Procedure

1. For each L5 step, examine the assigned role and the described action.
2. Assess whether the role naturally encompasses the action's domain.
3. Flag obvious mismatches (role domain vs. action domain).
4. This rule requires business judgment and cannot be fully automated.

### Evidence Required

- L5 step identifier and name
- Assigned role
- Described action
- The domain mismatch (if any)

---

## FA-L5-007: R3 Anti-Pattern: System Mismatch

**Severity**: CRITICAL
**Deterministic**: No

### Description

The referenced system must support the described operation for the assigned role. For example, referencing "SAP MM" for a step that describes a document approval workflow is a system mismatch.

### Check Procedure

1. For each L5 step, examine the referenced system and the described operation.
2. Assess whether the system supports the operation type.
3. Flag mismatches where the system does not provide the needed capability.

### Evidence Required

- L5 step identifier and name
- Referenced system
- Described operation
- The capability mismatch (if any)

---

## FA-L5-008: IPO Structure Check

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Each L5 process must have identifiable Input, Process, and Output (IPO) structure. A process that lacks any of these three elements is incomplete.

### Check Procedure

1. For each L5 process, verify presence of: at least one input, a defined process (name + steps), and at least one output.
2. Flag processes missing any IPO element.
3. Verify that inputs and outputs are not duplicated (same name listed as both input and output).

### Evidence Required

- L5 process identifier
- List of inputs
- List of outputs
- Whether a process definition exists

---

## FA-L5-009: Good Product Conditions

**Severity**: MAJOR
**Deterministic**: No

### Description

L5 outputs must define what constitutes a good product: measurable quality criteria. An output without quality criteria is unverifiable.

### Check Procedure

1. For each L5 output, check for quality criteria or acceptance conditions.
2. Flag outputs without any quality definition.
3. Verify that quality criteria are measurable (not subjective like "good quality").

### Evidence Required

- Output artifact identifier
- Quality criteria (or absence thereof)
- Whether criteria are measurable

---

## FA-L5-010: Tool Decoupling

**Severity**: MINOR
**Deterministic**: No

### Description

L5 process description should describe business logic independent of specific tool implementations. A process that says "click Save button in SAP" is coupled to a tool; "persist the record" is decoupled.

### Check Procedure

1. For each L5 step description, scan for specific tool names, UI elements, or technical references.
2. Flag steps that embed tool-specific language in business process descriptions.
3. Suggest business-language alternatives.

### Evidence Required

- L5 step identifier and description
- Specific tool references found
- Suggested business-language replacement
