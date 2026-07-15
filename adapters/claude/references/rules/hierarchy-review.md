# Hierarchy Review Rules

Rules for reviewing the architecture hierarchy structure and consistency.

---

## FA-HIER-001: Orphan Node Detection

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

Every node in the architecture model (except the root) must have a valid parent reference. Orphan nodes without a parent create disconnected fragments in the architecture.

### Check Procedure

1. Iterate all nodes in the architecture model.
2. For each non-root node, verify that `parent_id` is non-null.
3. Verify that `parent_id` references an existing node.
4. Flag nodes with null `parent_id` (except root) or referencing non-existent parents.

### Evidence Required

- Node identifier and name
- The `parent_id` value
- Whether the parent node exists

---

## FA-HIER-002: Dangling Reference Detection

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

All `parent_id` and relationship references must point to existing nodes. A dangling reference occurs when a node references another node that does not exist in the model.

### Check Procedure

1. Collect all node identifiers into a set.
2. For each node, check that `parent_id` (if non-null) is in the set.
3. For each relationship, check that `from_node_id` and `to_node_id` are in the set.
4. Flag all dangling references.

### Evidence Required

- The reference type (parent_id or relationship)
- The source node identifier
- The missing target identifier

---

## FA-HIER-003: Cycle Detection

**Severity**: BLOCKER
**Deterministic**: Yes

### Description

The hierarchy must be a directed acyclic graph (DAG). Cycles create infinite loops and are structurally invalid.

### Check Procedure

1. Build an adjacency list from all parent-child and relationship edges.
2. Run a topological sort or DFS-based cycle detection algorithm.
3. If a cycle is detected, report all nodes involved in the cycle.

### Evidence Required

- The list of nodes forming the cycle
- The edges that create the cycle

---

## FA-HIER-004: Fan-Out Limit

**Severity**: MAJOR
**Deterministic**: Yes

### Description

A single node should not have an excessive number of children:
- Above 10 children: warn (MINOR severity)
- Above 20 children: flag as BLOCKER

High fan-out suggests the parent node may need further decomposition or that children are not properly grouped.

### Check Procedure

1. For each node, count the number of children (nodes with `parent_id` pointing to it).
2. If count > 20, flag as BLOCKER.
3. If count > 10, flag as MAJOR.
4. Document the fan-out count.

### Evidence Required

- Node identifier and name
- Number of children
- Threshold exceeded (if any)

---

## FA-HIER-005: Attribution Conflict

**Severity**: CRITICAL
**Deterministic**: No

### Description

Child node attribution must not contradict parent node attribution in the same dimension. For example, if the parent node is attributed to "Finance Department", a child node attributed to "Engineering Department" is a conflict unless explicitly justified.

### Check Procedure

1. For each parent-child pair, compare attribution dimensions.
2. Flag direct contradictions (e.g. different departments for the same organizational dimension).
3. Allow justified overrides when an explicit reason is documented.

### Evidence Required

- Parent node identifier and its attribution
- Child node identifier and its attribution
- The conflicting dimension

---

## FA-HIER-006: Coverage Completeness

**Severity**: MAJOR
**Deterministic**: Yes

### Description

All leaf nodes at the lowest declared level must be reachable from the root through the hierarchy. Unreachable leaf nodes indicate gaps in the architecture.

### Check Procedure

1. Identify all leaf nodes (nodes with no children).
2. For each leaf node, trace the path back to the root.
3. If no path exists to the root, flag the leaf as unreachable.
4. Identify the lowest declared level in the hierarchy.
5. Verify that all leaf nodes at that level are reachable.

### Evidence Required

- Leaf node identifier
- Path from leaf to root (or absence thereof)

---

## FA-HIER-007: Output Chain Continuity

**Severity**: MAJOR
**Deterministic**: Yes

### Description

Outputs from child nodes must chain into the parent node's output or a sibling node's input. Disconnected outputs create dead ends in the process flow.

### Check Procedure

1. For each parent node, collect its outputs.
2. For each child node, collect its outputs.
3. Verify that child outputs contribute to (chain into) the parent output or a sibling's input.
4. Flag child outputs that connect to nothing.

### Evidence Required

- Parent node identifier and outputs
- Child node identifier and outputs
- Whether the child output chains to parent or sibling

---

## FA-HIER-008: Layer Skip Detection

**Severity**: CRITICAL
**Deterministic**: Yes

### Description

A node must not skip a layer in the hierarchy. For example, an L3 node must not directly contain an L6 node without intermediate L4 and L5 layers.

### Check Procedure

1. For each parent-child pair, compare their type (L3, L4, L5, L6, SOP).
2. Verify that the child is exactly one level below the parent.
3. Flag any parent-child pair where the child skips one or more levels.

### Evidence Required

- Parent node identifier and type
- Child node identifier and type
- The skipped levels (if any)

---

## FA-HIER-009: Naming Consistency

**Severity**: MINOR
**Deterministic**: No

### Description

Child node names should be consistent in style with their parent node names. If the parent uses verb-object naming, children should follow the same convention.

### Check Procedure

1. For each parent node, determine the naming style (verb-object, noun-phrase, etc.).
2. For each child node, check consistency with the parent's naming style.
3. Flag inconsistencies (e.g. parent uses verb-object, child uses noun-phrase).

### Evidence Required

- Parent node identifier, name, and detected naming style
- Child node identifier, name, and detected naming style
- The inconsistency (if any)

---

## FA-HIER-010: Version Consistency

**Severity**: MAJOR
**Deterministic**: Yes

### Description

All nodes in a single architecture model must belong to the same version. Mixing versions within a model creates inconsistency.

### Check Procedure

1. Collect version metadata from all nodes (or from the model-level metadata).
2. Verify that all nodes share the same version.
3. Flag any node with a version different from the majority.

### Evidence Required

- Model-level version
- Node identifier and its version (if different)
