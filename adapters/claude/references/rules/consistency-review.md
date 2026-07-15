# Consistency Review Rules

Rules for checking consistency between an architecture model and a diagram model. These rules verify that the visual diagram accurately represents the documented architecture.

---

## FA-CONS-001: L4 to Sub-Process Mapping

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

Every L4 sub-process node in the architecture model must have a corresponding SUB_PROCESS or process-level element in the diagram model. An L4 node without a diagram counterpart means the architecture is not fully visualized.

### Check Procedure

1. Extract all L4 nodes from the architecture model.
2. For each L4 node, search the diagram model for a SUB_PROCESS or POOL element with a matching or similar name.
3. Use fuzzy name matching (normalized lowercase, strip common prefixes/suffixes).
4. Flag L4 nodes with no matching diagram element as MISSING_IN_DIAGRAM.
5. Flag diagram SUB_PROCESS elements with no matching L4 node as MISSING_IN_ARCHITECTURE.

### Evidence Required

- Architecture node identifier and name
- Diagram element identifier and name (if matched)
- Match type and confidence score

---

## FA-CONS-002: L5 to Task Mapping

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

Every L5 process node in the architecture model must have a corresponding TASK element in the diagram model. L5 tasks represent the operational steps that should be visible in the process flow.

### Check Procedure

1. Extract all L5 nodes from the architecture model.
2. For each L5 node, search the diagram model for a TASK element with a matching or similar name.
3. Use fuzzy name matching (normalized lowercase, verb-object pattern comparison).
4. Flag L5 nodes with no matching TASK element as MISSING_IN_DIAGRAM.
5. Flag diagram TASK elements with no matching L5 node as MISSING_IN_ARCHITECTURE.

### Evidence Required

- Architecture node identifier, name, and type
- Diagram element identifier, name, and type
- Match type and confidence score

---

## FA-CONS-003: Role to Lane Mapping

**Severity**: CRITICAL
**Deterministic**: No

### Description

Roles assigned to architecture nodes should correspond to lanes in the diagram model. Each lane should represent a distinct role or organizational unit, and tasks assigned to a role should appear in the corresponding lane.

### Check Procedure

1. Extract roles from architecture nodes (L4 and L5).
2. Extract lanes from the diagram model.
3. Match roles to lanes by name similarity.
4. For each matched role-lane pair, verify that tasks assigned to the role appear in the corresponding lane.
5. Flag mismatches where a task's architecture role does not match its diagram lane.

### Evidence Required

- Role name from architecture
- Lane name from diagram
- Task identifiers and their role/lane assignments

---

## FA-CONS-004: Deliverable to Data Object Mapping

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Input and output deliverables defined in architecture nodes should have corresponding DATA_OBJECT elements in the diagram. Data objects represent the artifacts that flow between tasks.

### Check Procedure

1. Extract all inputs and outputs from architecture nodes (L4 and L5).
2. Extract all DATA_OBJECT elements from the diagram model.
3. Match deliverables to data objects by name similarity.
4. Flag deliverables with no matching data object as MISSING_IN_DIAGRAM.
5. Flag data objects with no matching deliverable as MISSING_IN_ARCHITECTURE.

### Evidence Required

- Deliverable name and parent node
- Data object identifier and name
- Match type and confidence score

---

## FA-CONS-005: Cross-Org Message Flow Mapping

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Cross-organizational interactions in the architecture model (handoffs between different organizational units) should be represented as MESSAGE_FLOW elements in the diagram. Message flows indicate communication across pool boundaries.

### Check Procedure

1. Identify cross-organizational relationships in the architecture model (nodes with different organizational unit contexts connected by sequence).
2. Check the diagram model for MESSAGE_FLOW elements connecting the corresponding pools.
3. Flag architecture cross-org relationships without corresponding message flows.
4. Flag diagram message flows without corresponding architecture cross-org relationships.

### Evidence Required

- Architecture relationship identifiers
- Message flow identifiers
- Source and target organizational contexts

---

## FA-CONS-006: Exception Path Mapping

**Severity**: MAJOR
**Deterministic**: No

### Description

Exception handling paths defined in the architecture model (error handlers, escalation paths, alternative flows) should be represented in the diagram model via boundary events, error intermediate events, or explicit alternative sequence flows.

### Check Procedure

1. Identify exception-related nodes or relationships in the architecture model.
2. Check the diagram model for exception-related elements (boundary events, error events, alternative flows from gateways).
3. Flag architecture exception paths without diagram representation.
4. Flag diagram exception elements without architecture counterpart.

### Evidence Required

- Architecture exception node/relationship identifiers
- Diagram exception element identifiers
- Mapping confidence

---

## FA-CONS-007: Architecture Completeness Coverage

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

All architecture nodes at L4 and L5 levels must be represented in the diagram model. The diagram must cover 100% of the defined architecture scope.

### Check Procedure

1. Count all L4 and L5 nodes in the architecture model.
2. Count how many have matching diagram elements (from FA-CONS-001 and FA-CONS-002).
3. Calculate coverage percentage.
4. Flag if coverage is below 100% for L4 nodes or below 80% for L5 nodes.

### Evidence Required

- Total L4 node count and matched count
- Total L5 node count and matched count
- Coverage percentages

---

## FA-CONS-008: Diagram Extra Elements

**Severity**: MINOR
**Deterministic**: Yes

### Description

Diagram elements that do not map to any architecture node may indicate undocumented processes or diagram artifacts that should be cleaned up.

### Check Procedure

1. For each TASK and SUB_PROCESS in the diagram model, check if a matching architecture node exists.
2. Flag unmatched diagram elements as MISSING_IN_ARCHITECTURE.
3. Informational: these may be legitimate visual elements (annotations, labels) that do not require architecture representation.

### Evidence Required

- Diagram element identifier, name, and type
- Whether a matching architecture node exists
