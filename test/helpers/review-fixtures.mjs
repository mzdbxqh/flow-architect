/**
 * Test fixtures for diagram and consistency review tests.
 */

/**
 * Create a minimal architecture model fixture with L4 and L5 nodes.
 * @returns {object} Architecture model conforming to architecture-model schema.
 */
export function architectureFixture() {
  return {
    schema_version: '1.0.0',
    nodes: [
      {
        node_id: 'L4-001',
        type: 'L4',
        name: 'Order Management',
        parent_id: null,
        roles: ['Sales'],
        inputs: [{ name: 'customer-order', type: 'OrderRequest' }],
        outputs: [{ name: 'order-confirmation', type: 'OrderConfirmation' }],
        rasci: 'R',
        source_refs: ['arch-doc#L4'],
        rules_refs: [],
      },
      {
        node_id: 'L5-001',
        type: 'L5',
        name: 'Process Order',
        parent_id: 'L4-001',
        roles: ['Sales'],
        inputs: [{ name: 'customer-order', type: 'OrderRequest' }],
        outputs: [{ name: 'processed-order', type: 'ProcessedOrder' }],
        rasci: 'R',
        source_refs: ['arch-doc#L5-001'],
        rules_refs: [],
      },
      {
        node_id: 'L5-002',
        type: 'L5',
        name: 'Approve Payment',
        parent_id: 'L4-001',
        roles: ['Finance'],
        inputs: [{ name: 'processed-order', type: 'ProcessedOrder' }],
        outputs: [{ name: 'payment-approval', type: 'PaymentApproval' }],
        rasci: 'R',
        source_refs: ['arch-doc#L5-002'],
        rules_refs: [],
      },
      {
        node_id: 'L5-003',
        type: 'L5',
        name: 'Ship Order',
        parent_id: 'L4-001',
        roles: ['Warehouse'],
        inputs: [{ name: 'payment-approval', type: 'PaymentApproval' }],
        outputs: [{ name: 'shipment', type: 'Shipment' }],
        rasci: 'R',
        source_refs: ['arch-doc#L5-003'],
        rules_refs: [],
      },
    ],
    relationships: [
      { from_node_id: 'L4-001', to_node_id: 'L5-001', type: 'contains' },
      { from_node_id: 'L4-001', to_node_id: 'L5-002', type: 'contains' },
      { from_node_id: 'L4-001', to_node_id: 'L5-003', type: 'contains' },
      { from_node_id: 'L5-001', to_node_id: 'L5-002', type: 'sequence' },
      { from_node_id: 'L5-002', to_node_id: 'L5-003', type: 'sequence' },
    ],
    metadata: {},
  };
}

/**
 * Create a diagram model fixture that is missing the 'Approve Payment' task.
 * This simulates a diagram that does not fully cover the architecture.
 * @returns {object} Diagram model conforming to diagram-model schema.
 */
export function diagramFixtureWithoutApproveTask() {
  return {
    schema_version: '1.0.0',
    elements: [
      {
        element_id: 'pool-1',
        type: 'POOL',
        name: 'Order Management',
        parent_id: null,
        lane_id: null,
        sub_type: null,
      },
      {
        element_id: 'start-1',
        type: 'EVENT',
        name: 'Order Received',
        parent_id: 'pool-1',
        lane_id: 'lane-sales',
        sub_type: 'startEvent',
      },
      {
        element_id: 'task-process',
        type: 'TASK',
        name: 'Process Order',
        parent_id: 'pool-1',
        lane_id: 'lane-sales',
        sub_type: null,
      },
      {
        element_id: 'task-ship',
        type: 'TASK',
        name: 'Ship Order',
        parent_id: 'pool-1',
        lane_id: 'lane-warehouse',
        sub_type: null,
      },
      {
        element_id: 'end-1',
        type: 'EVENT',
        name: 'Complete',
        parent_id: 'pool-1',
        lane_id: 'lane-warehouse',
        sub_type: 'endEvent',
      },
      {
        element_id: 'lane-sales',
        type: 'LANE',
        name: 'Sales',
        parent_id: 'pool-1',
        lane_id: null,
        sub_type: null,
      },
      {
        element_id: 'lane-warehouse',
        type: 'LANE',
        name: 'Warehouse',
        parent_id: 'pool-1',
        lane_id: null,
        sub_type: null,
      },
    ],
    flows: [
      {
        flow_id: 'flow-1',
        type: 'SEQUENCE_FLOW',
        source_ref: 'start-1',
        target_ref: 'task-process',
        is_default: false,
      },
      {
        flow_id: 'flow-2',
        type: 'SEQUENCE_FLOW',
        source_ref: 'task-process',
        target_ref: 'task-ship',
        is_default: false,
      },
      {
        flow_id: 'flow-3',
        type: 'SEQUENCE_FLOW',
        source_ref: 'task-ship',
        target_ref: 'end-1',
        is_default: false,
      },
    ],
    metadata: {
      parse_mode: 'STRUCTURED',
      source_format: 'bpmn',
      confidence: 0.95,
      warnings: [],
    },
  };
}

/**
 * Create a visual-only finding fixture (simulating PNG/JPEG source).
 * @returns {object[]} Array of findings with high confidence and BPMN_ELEMENT locators.
 */
export function visualOnlyFindingFixture() {
  return [
    {
      finding_id: 'vis-001',
      rule_id: 'FA-VIS-001',
      category: 'VISUAL',
      severity: 'MAJOR',
      verdict: 'FAIL',
      artifact_refs: ['diagram.png'],
      target_refs: ['flow-1', 'flow-2'],
      evidence: [
        {
          artifact_id: 'diagram.png',
          locator_type: 'BPMN_ELEMENT',
          locator: 'flow-1',
          excerpt: 'Line crossing detected',
          observation: 'Sequence flows cross at coordinates (100, 200)',
        },
      ],
      expected: 'Lines should not cross',
      actual: 'Line crossing detected between flow-1 and flow-2',
      recommendation: 'Reroute flow to avoid crossing',
      confidence: 0.85,
      business_confirmation_required: false,
      source_rule_refs: [],
      fingerprint: 'vis-fp-001',
    },
  ];
}

/**
 * Create a finding set fixture for a specific rule ID.
 * @param {string} ruleId - The rule ID to create findings for.
 * @returns {object} A finding-set conforming object.
 */
export function findingSet(ruleId) {
  return {
    schema_version: '1.0.0',
    findings: [
      {
        finding_id: `f-${ruleId}`,
        rule_id: ruleId,
        category: ruleId.split('-')[1],
        severity: 'MAJOR',
        verdict: 'FAIL',
        artifact_refs: ['test-artifact'],
        target_refs: ['test-target'],
        evidence: [
          {
            artifact_id: 'test-artifact',
            locator_type: 'BPMN_ELEMENT',
            locator: 'test-elem',
            excerpt: 'test excerpt',
            observation: 'test observation',
          },
        ],
        expected: 'expected behavior',
        actual: 'actual behavior',
        recommendation: 'fix recommendation',
        confidence: 0.9,
        business_confirmation_required: false,
        source_rule_refs: [],
        fingerprint: 'test-fp',
      },
    ],
  };
}

/**
 * Create a valid stages array with at least one BLOCKER finding.
 * @returns {object[]} Array of stage results.
 */
export function validStagesWithBlocker() {
  return [
    {
      stage_id: 'review-bpmn',
      status: 'SUCCEEDED_WITH_WARNINGS',
      findings: [
        {
          finding_id: 'blk-001',
          rule_id: 'FA-BPMN-001',
          category: 'BPMN',
          severity: 'BLOCKER',
          verdict: 'FAIL',
          artifact_refs: ['diagram.bpmn'],
          target_refs: ['process-1'],
          evidence: [
            {
              artifact_id: 'diagram.bpmn',
              locator_type: 'BPMN_ELEMENT',
              locator: 'process-1',
              excerpt: 'No start event',
              observation: 'Process has no start event',
            },
          ],
          expected: 'Process should have at least one start event',
          actual: 'No start event found in process-1',
          recommendation: 'Add a start event to the process',
          confidence: 1.0,
          business_confirmation_required: false,
          source_rule_refs: [],
          fingerprint: 'blk-fp-001',
        },
      ],
    },
  ];
}
