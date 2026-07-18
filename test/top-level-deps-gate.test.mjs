/**
 * Top-level production dependencies gate tests.
 *
 * Asserts that:
 * 1. The public top-level package.json does NOT declare runtime production
 *    dependencies (ajv, ajv-formats, fast-xml-parser, yaml) in `dependencies`.
 * 2. These runtime packages are declared in `devDependencies` instead.
 * 3. Core runtime component still declares these dependencies in its own
 *    package.json and manifest.
 * 4. node_modules in installed root triggers fail-closed (no deletion).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

// ─── 1. Top-level package.json must NOT have runtime production dependencies ───

test('top-level package.json has no runtime production dependencies', () => {
  const pkg = readJson('package.json');

  // Top-level dependencies field must not exist or be empty
  assert.ok(
    !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    'Top-level package.json must not declare production dependencies; ' +
    'runtime packages (ajv, ajv-formats, fast-xml-parser, yaml) must be in devDependencies'
  );
});

test('top-level package.json devDependencies include all runtime packages', () => {
  const pkg = readJson('package.json');

  const RUNTIME_PACKAGES = ['ajv', 'ajv-formats', 'fast-xml-parser', 'yaml'];

  for (const dep of RUNTIME_PACKAGES) {
    assert.ok(
      pkg.devDependencies && pkg.devDependencies[dep],
      `Top-level package.json devDependencies must include ${dep}`
    );
  }
});

test('top-level package.json devDependencies versions match expected', () => {
  const pkg = readJson('package.json');

  const EXPECTED_VERSIONS = {
    'ajv': '8.20.0',
    'ajv-formats': '3.0.1',
    'fast-xml-parser': '4.5.7',
    'yaml': '2.9.0',
  };

  for (const [dep, expectedVersion] of Object.entries(EXPECTED_VERSIONS)) {
    assert.equal(
      pkg.devDependencies[dep],
      expectedVersion,
      `Top-level devDependencies.${dep} must be exactly ${expectedVersion}`
    );
  }
});

// ─── 2. Core runtime component still declares these dependencies ────────────

test('core runtime component package.json declares all runtime packages', () => {
  const corePkg = readJson('runtime/components/core/package.json');

  const RUNTIME_PACKAGES = ['ajv', 'ajv-formats', 'fast-xml-parser', 'yaml'];

  for (const dep of RUNTIME_PACKAGES) {
    assert.ok(
      corePkg.dependencies && corePkg.dependencies[dep],
      `Core component package.json must declare ${dep} in dependencies`
    );
  }
});

test('runtime manifest core component declares all runtime packages', () => {
  const manifest = readJson('runtime/manifest.json');
  const core = manifest.components.find(c => c.name === 'core');
  assert.ok(core, 'core component must exist in manifest');

  const RUNTIME_PACKAGES = ['ajv', 'ajv-formats', 'fast-xml-parser', 'yaml'];

  for (const dep of RUNTIME_PACKAGES) {
    assert.ok(
      core.packages[dep],
      `Runtime manifest core component must declare ${dep}`
    );
  }
});

// ─── 3. node_modules cache-only test ───────────────────────────────────────

test('installed root with node_modules uses cache-only evidence (not fail-closed)', () => {
  // This is a structural test verifying the gate logic exists
  // The actual dual-host smoke test verifies runtime behavior
  const dualHostPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'dual-host-smoke.mjs');
  const content = fs.readFileSync(dualHostPath, 'utf8');

  // Verify the cache-only logic exists in the gate (coreOk && bizOk && missingOk)
  assert.ok(
    content.includes('coreOk && bizOk && missingOk'),
    'dual-host-smoke.mjs must use cache-only evidence: coreOk && bizOk && missingOk'
  );

  // Verify the gate does NOT have the old "MARKETPLACE_CREATED" bypass
  assert.ok(
    !content.includes('MARKETPLACE_CREATED'),
    'dual-host-smoke.mjs must not have MARKETPLACE_CREATED bypass'
  );

  // Verify the gate does NOT delete node_modules
  assert.ok(
    !content.includes('fs.rmSync.*node_modules') && !content.includes('.delete'),
    'dual-host-smoke.mjs must not delete node_modules'
  );

  // Verify node_modules state is recorded as PRESENT_IGNORED or ABSENT
  assert.ok(
    content.includes('PRESENT_IGNORED') && content.includes('ABSENT'),
    'dual-host-smoke.mjs must record node_modules state as PRESENT_IGNORED or ABSENT'
  );
});
