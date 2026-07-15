# BPMN Review Rules

Rules for reviewing BPMN diagram structural and semantic correctness against the BPMN 2.0 specification.

---

## FA-BPMN-001: Start Event Presence

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

Every BPMN process must have at least one start event. A process without a start event has no defined entry point, making execution initiation ambiguous.

### Check Procedure

1. For each process (pool), collect all EVENT elements with sub_type `startEvent`.
2. If a process has zero start events, flag it.
3. Exception: collapsed sub-processes may inherit the parent process start.

### Evidence Required

- Process (pool) identifier
- Count of start events found

---

## FA-BPMN-002: End Event Presence

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

Every BPMN process must have at least one end event. A process without an end event has no defined termination point.

### Check Procedure

1. For each process (pool), collect all EVENT elements with sub_type `endEvent`.
2. If a process has zero end events, flag it.

### Evidence Required

- Process (pool) identifier
- Count of end events found

---

## FA-BPMN-003: Event Type Declaration

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

All events in a BPMN diagram must have a declared event definition type (message, timer, signal, error, escalation, compensation, conditional, terminate, etc.). Bare events without definitions are ambiguous.

### Check Procedure

1. For each EVENT element, check if the sub_type or sub_type metadata includes a specific event definition.
2. Flag events that are bare (only startEvent/endEvent/intermediateEvent without further definition).
3. Note: This rule applies where the source BPMN XML contains event definition sub-elements. If the extraction only provides sub_type as `startEvent`/`endEvent`/`intermediateEvent` without further detail, flag for manual review.

### Evidence Required

- Event element identifier and sub_type
- Whether a specific event definition type is declared

---

## FA-BPMN-004: Gateway Pairing

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Split gateways (gateways with multiple outgoing sequence flows) must have a corresponding merge gateway (gateways with multiple incoming sequence flows) of the same type. Unpaired splits create potential concurrency or logic issues.

### Check Procedure

1. Identify all GATEWAY elements.
2. For each gateway, count incoming and outgoing sequence flows.
3. Gateways with >1 outgoing flow are "splits"; gateways with >1 incoming flow are "merges".
4. Group gateways by sub_type (exclusiveGateway, parallelGateway, inclusiveGateway).
5. For each sub_type group, flag if the count of splits does not equal the count of merges.
6. Exception: event-based gateways do not require merging.

### Evidence Required

- Gateway identifiers and sub_types
- Incoming and outgoing flow counts
- Split/merge balance per sub_type

---

## FA-BPMN-005: Default Flow on Exclusive Gateway

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Every exclusive gateway (XOR split) with multiple outgoing flows must designate exactly one flow as the default flow. The default flow is taken when no other condition evaluates to true.

### Check Procedure

1. For each GATEWAY with sub_type `exclusiveGateway` and >1 outgoing sequence flow.
2. Check if exactly one outgoing flow has `is_default: true`.
3. Flag if zero or more than one default flows exist.

### Evidence Required

- Gateway identifier
- Number of outgoing flows
- Number of flows marked as default

---

## FA-BPMN-006: Dangling Sequence Flow

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

Every sequence flow must have valid source and target references that point to existing elements in the diagram. Dangling flows (referencing non-existent elements) indicate structural errors.

### Check Procedure

1. Collect all element IDs into a set.
2. For each SEQUENCE_FLOW, check that source_ref and target_ref exist in the element ID set.
3. Flag any flow with a missing source or target reference.

### Evidence Required

- Flow identifier
- The dangling reference (source_ref or target_ref)
- Whether the referenced element ID exists

---

## FA-BPMN-007: Orphan Task Detection

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Every task, sub-process, and event must be connected to at least one sequence flow (either as source or target). Unconnected elements are orphans and represent incomplete modeling.

### Check Procedure

1. Collect all TASK, SUB_PROCESS, and EVENT element IDs.
2. Collect all elements referenced as source_ref or target_ref in SEQUENCE_FLOW entries.
3. Any element not appearing in any flow reference is an orphan.
4. Exception: DATA_OBJECT elements are exempt (they use associations, not sequence flows).

### Evidence Required

- Element identifier and type
- Whether the element appears in any sequence flow

---

## FA-BPMN-008: Pool and Lane Usage

**Severity**: MAJOR
**Deterministic**: Yes

### Description

When a BPMN diagram contains multiple pools, all tasks must be assigned to a lane within a pool. Unassigned tasks (no parent pool or lane) in multi-pool diagrams indicate missing organizational attribution.

### Check Procedure

1. Count POOL elements in the diagram.
2. If count > 1, check that every TASK and SUB_PROCESS element has a non-null parent_id (pool reference).
3. Flag any task without a pool assignment in multi-pool diagrams.

### Evidence Required

- Number of pools
- Element identifiers missing pool assignment

---

## FA-BPMN-009: Sequence Flow vs Message Flow Distinction

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Sequence flows must connect elements within the same pool. Message flows must connect elements across different pools. Using sequence flow across pools or message flow within a pool is a structural error.

### Check Procedure

1. Build a map from element_id to parent_id (pool).
2. For each SEQUENCE_FLOW, verify that source and target elements share the same parent_id.
3. For each MESSAGE_FLOW, verify that source and target elements have different parent_ids.
4. Flag violations.

### Evidence Required

- Flow identifier and type
- Source and target element identifiers
- Source and target parent pool identifiers

---

## FA-BPMN-010: Sub-Process Boundary Completeness

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Sub-processes in BPMN should have clearly defined input and output connections. A sub-process with no incoming or no outgoing sequence flow is potentially incomplete.

### Check Procedure

1. For each SUB_PROCESS element, check if it appears as source or target in any SEQUENCE_FLOW.
2. Flag sub-processes with no incoming flow or no outgoing flow.

### Evidence Required

- Sub-process identifier
- Incoming flow count
- Outgoing flow count

---

## FA-BPMN-011: Exception and Error Path

**Severity**: MAJOR
**Deterministic**: No

### Description

Processes that involve external interactions, system calls, or approval steps should define exception or error handling paths. A process with only happy-path flows and no error/escalation handling is incomplete.

### Check Procedure

1. Identify tasks with sub-types that imply external interaction (serviceTask, sendTask, receiveTask).
2. Check if any boundary events or error-catching intermediate events exist near these tasks.
3. If no exception handling is found, flag for review.

### Evidence Required

- Task identifiers with external interaction sub-types
- Presence or absence of boundary/error events

---

## FA-BPMN-012: Rollback Path Presence

**Severity**: MAJOR
**Deterministic**: No

### Description

Processes that involve multi-step transactions (e.g., payment + confirmation) should define rollback or compensation paths. Without rollback paths, partial failures leave the system in an inconsistent state.

### Check Procedure

1. Identify sequences of tasks that form transactional groups.
2. Check for compensation events or compensation sub-processes.
3. If transactional groups exist without compensation paths, flag for review.

### Evidence Required

- Task groups identified as transactional
- Presence or absence of compensation events

---

## FA-BPMN-013: Task Label Completeness

**Severity**: MAJOR
**Deterministic**: Yes

### Description

All tasks in a BPMN diagram must have non-empty names. Unnamed tasks make the diagram unreadable and prevent mapping to architecture nodes.

### Check Procedure

1. For each TASK element, check that `name` is a non-empty string.
2. Flag any task with an empty or missing name.

### Evidence Required

- Task identifier
- Task name (or empty/missing indicator)

---

## FA-BPMN-014: Intermediate Event Placement

**Severity**: MINOR
**Deterministic**: No

### Description

Intermediate events should be placed at meaningful positions in the process flow (between tasks, not at process boundaries). Misplaced intermediate events indicate modeling errors.

### Check Procedure

1. For each EVENT with sub_type `intermediateEvent`, check that it has both incoming and outgoing sequence flows.
2. Flag intermediate events that lack either incoming or outgoing connections.

### Evidence Required

- Event identifier and sub_type
- Incoming and outgoing flow counts

---

## FA-BPMN-015: Data Object Association

**Severity**: MINOR
**Deterministic**: Yes

### Description

Data objects referenced in a BPMN diagram should be associated with at least one task or sub-process via an association flow. Orphan data objects indicate incomplete modeling.

### Check Procedure

1. For each DATA_OBJECT element, check if it appears as source or target in any ASSOCIATION flow.
2. Flag data objects without any association.

### Evidence Required

- Data object identifier and name
- Whether it appears in any association flow
