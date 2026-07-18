/**
 * Runtime dependency gate tests.
 *
 * 1. Runtime manifest core component declares ajv-formats.
 * 2. Core component package.json and lockfile include ajv-formats.
 * 3. Production scripts (scripts/lib/*.mjs) do not have bare imports of
 *    third-party runtime packages; all runtime deps must be loaded through
 *    the runtime loader.
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

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ─── 1. Manifest declares ajv-formats in core ────────────────────────────

test('runtime manifest core component declares ajv-formats', () => {
  const manifest = readJson('runtime/manifest.json');
  const core = manifest.components.find(c => c.name === 'core');
  assert.ok(core, 'core component must exist');
  assert.equal(core.packages['ajv-formats'], '3.0.1',
    'core must declare ajv-formats@3.0.1');
});

// ─── 2. Core component package.json includes ajv-formats ─────────────────

test('core component package.json declares ajv-formats dependency', () => {
  const pkg = readJson('runtime/components/core/package.json');
  assert.equal(pkg.dependencies['ajv-formats'], '3.0.1',
    'core package.json must depend on ajv-formats@3.0.1');
});

// ─── 3. Core component package-lock.json includes ajv-formats ────────────

test('core component package-lock.json includes ajv-formats', () => {
  const lock = readJson('runtime/components/core/package-lock.json');
  const hasAjvFormats = lock.packages && lock.packages['node_modules/ajv-formats'];
  assert.ok(hasAjvFormats, 'core lockfile must include ajv-formats');
  assert.equal(hasAjvFormats.version, '3.0.1',
    'core lockfile ajv-formats version must be 3.0.1');
});

// ─── 4. Production scripts: no bare imports of runtime third-party deps ──

test('production scripts in scripts/lib/ do not have bare imports of runtime packages', () => {
  const manifest = readJson('runtime/manifest.json');
  const declaredPackages = new Set();
  for (const comp of manifest.components) {
    for (const pkg of Object.keys(comp.packages)) {
      declaredPackages.add(pkg);
    }
  }

  const BUILTIN_MODULES = new Set([
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
    'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel',
    'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
    'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
    'process', 'punycode', 'querystring', 'readline', 'repl',
    'stream', 'string_decoder', 'sys', 'timers', 'tls',
    'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
    'worker_threads', 'zlib', 'node:assert', 'node:buffer',
    'node:child_process', 'node:cluster', 'node:console',
    'node:constants', 'node:crypto', 'node:dgram', 'node:dns',
    'node:domain', 'node:events', 'node:fs', 'node:http',
    'node:http2', 'node:https', 'node:inspector', 'node:module',
    'node:net', 'node:os', 'node:path', 'node:perf_hooks',
    'node:process', 'node:punycode', 'node:querystring',
    'node:readline', 'node:repl', 'node:stream', 'node:string_decoder',
    'node:sys', 'node:timers', 'node:tls', 'node:trace_events',
    'node:tty', 'node:url', 'node:util', 'node:v8', 'node:vm',
    'node:wasi', 'node:worker_threads', 'node:zlib',
    'node:test', 'node:assert/strict',
  ]);

  const importRe = /\bimport\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;

  const scriptsDir = path.join(ROOT, 'scripts', 'lib');
  const files = fs.readdirSync(scriptsDir)
    .filter(f => f.endsWith('.mjs'))
    .sort();

  const violations = [];
  for (const file of files) {
    // Skip the runtime loader itself; it is allowed to use createRequire
    if (file === 'runtime-loader.mjs') continue;

    const content = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
    let match;
    while ((match = importRe.exec(content)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('..')) continue;
      if (BUILTIN_MODULES.has(specifier)) continue;
      const pkgName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (declaredPackages.has(pkgName)) {
        violations.push(`${file}: bare import of declared runtime package "${pkgName}"`);
      }
    }
  }

  assert.deepEqual(violations, [],
    'Production scripts must not have bare imports of declared runtime packages; use the runtime loader');
});
