import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fixture } from './helpers/fixture.mjs';
import { extractBpmn } from '../scripts/extract-bpmn.mjs';
import { extractMermaid } from '../scripts/extract-mermaid.mjs';
import { extractSvg } from '../scripts/extract-svg.mjs';
import { validateContract } from '../scripts/lib/contract-validation.mjs';

// --- BPMN Extraction ---

test('BPMN XXE attack is rejected', () => {
  const xml = fs.readFileSync(fixture('diagrams/xxe.bpmn'), 'utf8');
  assert.throws(
    () => extractBpmn(xml),
    /DOCTYPE|ENTITY/,
    'Should reject XML with DOCTYPE/ENTITY declarations'
  );
});

test('BPMN DOCTYPE without ENTITY is rejected', () => {
  const xml = `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ELEMENT foo (#PCDATA)>
]>
<foo>bar</foo>`;
  assert.throws(() => extractBpmn(xml), /DOCTYPE/);
});

test('BPMN ENTITY without DOCTYPE is rejected', () => {
  const xml = `<?xml version="1.0"?>
<!ENTITY xxe SYSTEM "file:///etc/passwd">
<foo>bar</foo>`;
  assert.throws(() => extractBpmn(xml), /ENTITY/);
});

test('valid BPMN extraction produces correct elements', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  // Check schema version
  assert.equal(model.schema_version, '1.0.0');

  // Check element types present
  const types = new Set(model.elements.map(e => e.type));
  assert.ok(types.has('POOL'), 'Should have POOL elements');
  assert.ok(types.has('LANE'), 'Should have LANE elements');
  assert.ok(types.has('TASK'), 'Should have TASK elements');
  assert.ok(types.has('EVENT'), 'Should have EVENT elements');
  assert.ok(types.has('GATEWAY'), 'Should have GATEWAY elements');
});

test('valid BPMN extraction produces correct flows', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  const flowTypes = new Set(model.flows.map(f => f.type));
  assert.ok(flowTypes.has('SEQUENCE_FLOW'), 'Should have SEQUENCE_FLOW');
  assert.ok(flowTypes.has('MESSAGE_FLOW'), 'Should have MESSAGE_FLOW');

  // Check message flow details
  const msgFlow = model.flows.find(f => f.type === 'MESSAGE_FLOW');
  assert.ok(msgFlow, 'Should have a message flow');
  assert.equal(msgFlow.source_ref, 'Task_Ship');
  assert.equal(msgFlow.target_ref, 'Task_Receive');
});

test('valid BPMN has correct pool names', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  const pools = model.elements.filter(e => e.type === 'POOL');
  assert.equal(pools.length, 2);
  assert.ok(pools.some(p => p.name === 'Order Process'));
  assert.ok(pools.some(p => p.name === 'Warehouse'));
});

test('valid BPMN has correct lane structure', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  const lanes = model.elements.filter(e => e.type === 'LANE');
  assert.equal(lanes.length, 2);
  assert.ok(lanes.some(l => l.name === 'Sales'));
  assert.ok(lanes.some(l => l.name === 'Fulfillment'));

  // Lanes should have pool as parent
  for (const lane of lanes) {
    assert.ok(lane.parent_id, `Lane ${lane.name} should have a parent_id`);
    assert.equal(lane.parent_id, 'Pool_Order');
  }
});

test('semantically valid BPMN without DI preserves structural confidence separately from visual warning', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  assert.deepEqual(model.metadata.warnings, [
    'BPMN DI geometry evidence unavailable; visual layout review requires INSUFFICIENT_EVIDENCE',
  ]);
  assert.equal(model.metadata.confidence, 0.7, 'Missing DI lowers overall review confidence');
  assert.equal(model.metadata.source_format, 'bpmn');
  assert.equal(model.metadata.parse_mode, 'STRUCTURED');
});

test('valid BPMN output validates against diagram-model schema', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);
  const result = validateContract('diagram-model', model);
  assert.equal(result.valid, true, `Model should be valid: ${JSON.stringify(result.errors)}`);
});

test('BPMN dangling sourceRef produces warning', () => {
  const xml = fs.readFileSync(fixture('diagrams/dangling-ref.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  assert.ok(model.metadata.warnings.length > 0, 'Should have warnings for dangling refs');
  assert.ok(
    model.metadata.warnings.some(w => w.includes('NonExistent_Source')),
    'Should warn about NonExistent_Source'
  );
  assert.equal(model.metadata.confidence, 0.7, 'Lower confidence for dangling refs');
});

test('BPMN with no definitions root returns empty model with warning', () => {
  const xml = `<?xml version="1.0"?><root><foo>bar</foo></root>`;
  const model = extractBpmn(xml);

  assert.equal(model.elements.length, 0);
  assert.ok(model.metadata.warnings.some(w => w.includes('No bpmn:definitions')));
});

test('BPMN gateway sub_type is preserved', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  const gateways = model.elements.filter(e => e.type === 'GATEWAY');
  assert.ok(gateways.length > 0, 'Should have gateways');
  assert.ok(
    gateways.some(g => g.sub_type === 'exclusiveGateway'),
    'Should have exclusiveGateway sub_type'
  );
});

test('BPMN event sub_types are preserved', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  const events = model.elements.filter(e => e.type === 'EVENT');
  assert.ok(events.some(e => e.sub_type === 'startEvent'), 'Should have startEvent');
  assert.ok(events.some(e => e.sub_type === 'endEvent'), 'Should have endEvent');
});

test('BPMN default flow is flagged', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);

  const defaultFlows = model.flows.filter(f => f.is_default);
  assert.deepEqual(defaultFlows.map(f => f.flow_id), ['Flow_4']);
});

test('BPMN sequenceFlow isDefault attribute is not mistaken for default-flow semantics', () => {
  const xml = `<?xml version="1.0"?>
  <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
    <process id="P">
      <task id="A"/><task id="B"/>
      <sequenceFlow id="F" sourceRef="A" targetRef="B" isDefault="true"/>
    </process>
  </definitions>`;
  const model = extractBpmn(xml);
  assert.equal(model.flows[0].is_default, false);
});

test('BPMN DI bounds and waypoints are retained as visual evidence', () => {
  const xml = fs.readFileSync(
    resolve(import.meta.dirname, '../../../test/fixtures/e2e/public-procurement/process.bpmn'),
    'utf8'
  );
  const model = extractBpmn(xml);
  const task = model.elements.find(e => e.element_id === 'task-submit');
  const flow = model.flows.find(f => f.flow_id === 'flow-6');

  assert.deepEqual(task.geometry.bounds, { x: 240, y: 30, width: 100, height: 80 });
  assert.equal(flow.geometry.waypoints.length, 6);
  assert.deepEqual(flow.geometry.waypoints[2], { x: 250, y: 290 });
  assert.ok(!model.metadata.warnings.some(w => w.includes('geometry evidence unavailable')));
});

test('BPMN without DI explicitly reports insufficient visual evidence', () => {
  const xml = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  const model = extractBpmn(xml);
  assert.ok(model.metadata.warnings.some(w => w.includes('geometry evidence unavailable')));
});

// --- Mermaid Extraction ---

test('Mermaid flowchart extracts nodes and edges', () => {
  const text = fs.readFileSync(fixture('diagrams/flowchart.mmd'), 'utf8');
  const model = extractMermaid(text);

  assert.ok(model.elements.length > 0, 'Should have elements');
  assert.ok(model.flows.length > 0, 'Should have flows');
  assert.equal(model.metadata.source_format, 'mermaid');
  assert.equal(model.metadata.parse_mode, 'STRUCTURED');
});

test('Mermaid flowchart output validates against diagram-model schema', () => {
  const text = fs.readFileSync(fixture('diagrams/flowchart.mmd'), 'utf8');
  const model = extractMermaid(text);
  const result = validateContract('diagram-model', model);
  assert.equal(result.valid, true, `Model should be valid: ${JSON.stringify(result.errors)}`);
});

test('Mermaid flowchart with subgraph creates SUB_PROCESS', () => {
  const text = fs.readFileSync(fixture('diagrams/flowchart.mmd'), 'utf8');
  const model = extractMermaid(text);

  const subProcesses = model.elements.filter(e => e.type === 'SUB_PROCESS');
  assert.ok(subProcesses.length > 0, 'Should have SUB_PROCESS from subgraph');
  assert.ok(
    subProcesses.some(s => s.name === 'Validation'),
    'Should have Validation subgraph'
  );
});

test('Mermaid flowchart edge types are correct', () => {
  const text = fs.readFileSync(fixture('diagrams/flowchart.mmd'), 'utf8');
  const model = extractMermaid(text);

  const flowTypes = new Set(model.flows.map(f => f.type));
  assert.ok(flowTypes.has('SEQUENCE_FLOW') || flowTypes.has('ASSOCIATION'),
    'Should have recognized flow types');
});

test('unsupported Mermaid sequenceDiagram returns degradation', () => {
  const text = fs.readFileSync(fixture('diagrams/unsupported-sequence.mmd'), 'utf8');
  const model = extractMermaid(text);

  assert.equal(model.elements.length, 0, 'Unsupported type should have no elements');
  assert.equal(model.flows.length, 0, 'Unsupported type should have no flows');
  assert.equal(model.metadata.confidence, 0);
  assert.ok(
    model.metadata.warnings.some(w => w.includes('sequenceDiagram')),
    'Should mention unsupported diagram type'
  );
  assert.ok(
    model.metadata.warnings.some(w => w.includes('Only graph/flowchart')),
    'Should mention supported types'
  );
});

test('unsupported Mermaid output validates against diagram-model schema', () => {
  const text = fs.readFileSync(fixture('diagrams/unsupported-sequence.mmd'), 'utf8');
  const model = extractMermaid(text);
  const result = validateContract('diagram-model', model);
  assert.equal(result.valid, true, `Degraded model should still be schema-valid: ${JSON.stringify(result.errors)}`);
});

test('Mermaid graph TD is recognized as flowchart', () => {
  const model = extractMermaid('graph TD\n  A --> B');
  assert.ok(model.elements.length > 0, 'graph TD should be parsed');
  assert.equal(model.metadata.confidence > 0, true);
});

test('Mermaid flowchart LR is recognized', () => {
  const model = extractMermaid('flowchart LR\n  X[Start] --> Y[End]');
  assert.ok(model.elements.length >= 2, 'Should parse LR flowchart');
  assert.ok(model.flows.length >= 1, 'Should have at least one flow');
});

// --- SVG Extraction ---

test('SVG extraction finds text elements', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);

  const textElements = model.elements.filter(e => e.sub_type === 'text');
  assert.ok(textElements.length > 0, 'Should find text elements');
  assert.ok(
    textElements.some(e => e.name === 'Start Process'),
    'Should extract "Start Process" text'
  );
  assert.ok(
    textElements.some(e => e.name === 'Decision'),
    'Should extract "Decision" text'
  );
});

test('SVG extraction finds shapes', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);

  const subTypes = new Set(model.elements.map(e => e.sub_type));
  assert.ok(subTypes.has('rect'), 'Should find rectangles');
  assert.ok(subTypes.has('circle'), 'Should find circles');
  assert.ok(subTypes.has('line'), 'Should find lines');
  assert.ok(subTypes.has('path'), 'Should find paths');
  assert.ok(subTypes.has('ellipse'), 'Should find ellipses');
});

test('SVG extraction retains locatable geometry', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);
  const firstRect = model.elements.find(e => e.sub_type === 'rect');
  const firstLine = model.elements.find(e => e.sub_type === 'line');
  const firstPath = model.elements.find(e => e.sub_type === 'path');

  assert.deepEqual(firstRect.geometry, { x: 10, y: 10, width: 180, height: 80 });
  assert.deepEqual(firstLine.geometry, { x1: 100, y1: 90, x2: 100, y2: 160 });
  assert.equal(firstPath.geometry.d, 'M 100 160 Q 200 140 200 160');
});

test('SVG all elements are UNKNOWN_VISUAL_ELEMENT', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);

  for (const elem of model.elements) {
    assert.equal(elem.type, 'UNKNOWN_VISUAL_ELEMENT',
      `Element ${elem.name} should be UNKNOWN_VISUAL_ELEMENT, got ${elem.type}`);
  }
});

test('SVG has no BPMN semantic claims', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);

  const bpmnTypes = ['POOL', 'LANE', 'TASK', 'SUB_PROCESS', 'EVENT', 'GATEWAY', 'DATA_OBJECT'];
  for (const elem of model.elements) {
    assert.ok(
      !bpmnTypes.includes(elem.type),
      `SVG should not claim BPMN type ${elem.type}`
    );
  }
});

test('SVG metadata is correct', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);

  assert.equal(model.metadata.parse_mode, 'SEMI_STRUCTURED');
  assert.equal(model.metadata.source_format, 'svg');
  assert.equal(model.metadata.confidence, 0.5);
  assert.equal(model.schema_version, '1.0.0');
});

test('SVG output validates against diagram-model schema', () => {
  const svg = fs.readFileSync(fixture('diagrams/geometry.svg'), 'utf8');
  const model = extractSvg(svg);
  const result = validateContract('diagram-model', model);
  assert.equal(result.valid, true, `SVG model should be valid: ${JSON.stringify(result.errors)}`);
});

test('empty SVG produces warning', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>`;
  const model = extractSvg(svg);

  assert.equal(model.elements.length, 0);
  assert.ok(model.metadata.warnings.some(w => w.includes('No visual elements')));
});
