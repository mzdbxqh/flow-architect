import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixture, makeRunDir } from './helpers/fixture.mjs';
import { formatCapabilities } from '../scripts/lib/input-classifier.mjs';
import { inspectInputs } from '../scripts/inspect-inputs.mjs';
import { validateContract } from '../scripts/lib/contract-validation.mjs';

// --- formatCapabilities classification ---

test('formatCapabilities has expected entries', () => {
  const expected = [
    '.bpmn', '.xml', '.mmd', '.mermaid', '.svg',
    '.png', '.jpg', '.jpeg',
    '.json', '.yaml', '.yml', '.csv', '.xlsx',
    '.md', '.docx', '.pdf',
  ];
  for (const ext of expected) {
    assert.ok(ext in formatCapabilities, `Expected ${ext} in formatCapabilities`);
  }
});

test('.bpmn is DIAGRAM/STRUCTURED with BPMN_STRUCTURE', () => {
  const caps = formatCapabilities['.bpmn'];
  assert.deepEqual(caps, ['DIAGRAM', 'STRUCTURED', 'BPMN_STRUCTURE']);
});

test('.json is ARCHITECTURE/STRUCTURED', () => {
  const caps = formatCapabilities['.json'];
  assert.equal(caps[0], 'ARCHITECTURE');
  assert.equal(caps[1], 'STRUCTURED');
});

test('.pdf is MIXED/SEMI_STRUCTURED', () => {
  const caps = formatCapabilities['.pdf'];
  assert.deepEqual(caps, ['MIXED', 'SEMI_STRUCTURED']);
});

test('image extensions are DIAGRAM/VISUAL_ONLY', () => {
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const caps = formatCapabilities[ext];
    assert.equal(caps[0], 'DIAGRAM', `${ext} should be DIAGRAM`);
    assert.equal(caps[1], 'VISUAL_ONLY', `${ext} should be VISUAL_ONLY`);
  }
});

// --- inspectInputs ---

test('inspectInputs classifies JSON architecture correctly', async () => {
  const runDir = makeRunDir('json-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.json')],
      runDir,
    });

    assert.equal(manifest.artifacts.length, 1);
    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'ARCHITECTURE');
    assert.equal(art.format, 'json');
    assert.equal(art.parse_mode, 'STRUCTURED');
    assert.ok(art.sha256.length === 64, 'sha256 should be 64 hex chars');
    assert.ok(art.size_bytes > 0);
    assert.equal(art.degradation_reason, null);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs classifies image as VISUAL_ONLY', async () => {
  const runDir = makeRunDir('image-vis');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('diagrams/sample.png')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'DIAGRAM');
    assert.equal(art.parse_mode, 'VISUAL_ONLY');
    assert.ok(art.degradation_reason.includes('Image'));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs detects text.pdf as MIXED with text', async () => {
  const runDir = makeRunDir('pdf-text');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/text.pdf')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'MIXED');
    assert.equal(art.format, 'pdf');
    // text.pdf has enough text so it's NOT VISUAL_ONLY
    assert.notEqual(art.parse_mode, 'VISUAL_ONLY', 'Text PDF should not be VISUAL_ONLY');
    assert.equal(art.degradation_reason, null);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs detects scan.pdf as VISUAL_ONLY', async () => {
  const runDir = makeRunDir('pdf-scan');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/scan.pdf')],
      runDir,
    });

    const art = manifest.artifacts[0];
    // scan.pdf has no text => detected as VISUAL_ONLY, kind switches to DIAGRAM
    assert.equal(art.parse_mode, 'VISUAL_ONLY');
    assert.equal(art.kind, 'DIAGRAM');
    assert.ok(art.degradation_reason.includes('scanned'));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs handles YAML architecture', async () => {
  const runDir = makeRunDir('yaml-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.yaml')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'ARCHITECTURE');
    assert.equal(art.format, 'yaml');
    assert.equal(art.parse_mode, 'STRUCTURED');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs handles CSV architecture', async () => {
  const runDir = makeRunDir('csv-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.csv')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'ARCHITECTURE');
    assert.equal(art.format, 'csv');
    assert.equal(art.parse_mode, 'STRUCTURED');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs handles DOCX architecture', async () => {
  const runDir = makeRunDir('docx-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.docx')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'ARCHITECTURE');
    assert.equal(art.format, 'docx');
    assert.equal(art.parse_mode, 'SEMI_STRUCTURED');
    assert.ok(art.confidence > 0.5);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs handles XLSX architecture', async () => {
  const runDir = makeRunDir('xlsx-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.xlsx')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'ARCHITECTURE');
    assert.equal(art.format, 'xlsx');
    assert.equal(art.parse_mode, 'STRUCTURED');
    assert.ok(art.confidence > 0.5);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs handles Markdown architecture', async () => {
  const runDir = makeRunDir('md-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.md')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'ARCHITECTURE');
    assert.equal(art.format, 'md');
    assert.equal(art.parse_mode, 'SEMI_STRUCTURED');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs rejects unknown extensions', async () => {
  const runDir = makeRunDir('unknown-ext');
  const tmpFile = path.join(runDir, 'test.xyz');
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(tmpFile, 'test content');

    const manifest = await inspectInputs({
      inputs: [tmpFile],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'UNKNOWN');
    assert.equal(art.parse_mode, 'UNSUPPORTED');
    assert.ok(art.degradation_reason.includes('Unsupported'));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('inspectInputs writes input-manifest.json to runDir/input/', async () => {
  const runDir = makeRunDir('manifest-write');
  try {
    await inspectInputs({
      inputs: [fixture('inputs/architecture.json')],
      runDir,
    });

    const manifestPath = path.join(runDir, 'input', 'input-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'input-manifest.json should exist');

    const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(written.schema_version, '1.0.0');
    assert.ok(written.run_id);
    assert.ok(Array.isArray(written.artifacts));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('manifest validates against input-manifest schema', async () => {
  const runDir = makeRunDir('schema-validate');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('inputs/architecture.json')],
      runDir,
    });

    const result = validateContract('input-manifest', manifest);
    assert.equal(result.valid, true, `Manifest should be valid: ${JSON.stringify(result.errors)}`);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('manifest with multiple inputs validates against schema', async () => {
  const runDir = makeRunDir('multi-input');
  try {
    const manifest = await inspectInputs({
      inputs: [
        fixture('inputs/architecture.json'),
        fixture('diagrams/valid.bpmn'),
        fixture('diagrams/sample.png'),
      ],
      runDir,
    });

    assert.equal(manifest.artifacts.length, 3);
    const result = validateContract('input-manifest', manifest);
    assert.equal(result.valid, true, `Manifest should be valid: ${JSON.stringify(result.errors)}`);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('BPMN is classified as DIAGRAM/STRUCTURED', async () => {
  const runDir = makeRunDir('bpmn-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('diagrams/valid.bpmn')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'DIAGRAM');
    assert.equal(art.parse_mode, 'STRUCTURED');
    assert.ok(art.capabilities.includes('BPMN_STRUCTURE'));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('SVG is classified as DIAGRAM/SEMI_STRUCTURED', async () => {
  const runDir = makeRunDir('svg-classify');
  try {
    const manifest = await inspectInputs({
      inputs: [fixture('diagrams/geometry.svg')],
      runDir,
    });

    const art = manifest.artifacts[0];
    assert.equal(art.kind, 'DIAGRAM');
    assert.equal(art.parse_mode, 'SEMI_STRUCTURED');
    assert.ok(art.capabilities.includes('VISUAL_GEOMETRY'));
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('SHA256 is deterministic', async () => {
  const runDir = makeRunDir('sha256-determinism');
  try {
    const manifest1 = await inspectInputs({
      inputs: [fixture('inputs/architecture.json')],
      runDir,
    });
    const manifest2 = await inspectInputs({
      inputs: [fixture('inputs/architecture.json')],
      runDir,
    });

    assert.equal(manifest1.artifacts[0].sha256, manifest2.artifacts[0].sha256);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
