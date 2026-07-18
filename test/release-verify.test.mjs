/**
 * Release Verification Tests
 *
 * Tests for standalone snapshot, pack audit, npm rejection,
 * and release preflight readiness.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

// ─── Pack Audit ───────────────────────────────────────────────────────────

test('pnpm pack includes required files and excludes forbidden content', () => {
  let raw;
  let packResult;
  try {
    raw = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      shell: false,
    });
  } catch (cmdErr) {
    // If the command itself fails (pnpm not found, non-zero exit with stderr),
    // that is a hard test failure — not a skip.
    assert.fail(`pnpm pack --dry-run --json must succeed: ${cmdErr.message}`);
  }

  try {
    packResult = JSON.parse(raw);
  } catch (parseErr) {
    assert.fail(`pnpm pack output must be valid JSON: ${parseErr.message}`);
  }

  // pnpm may return either an object { files, size, ... }
  // or an array [ { files, size, ... } ]. Accept both.
  const entry = Array.isArray(packResult) ? packResult[0] : packResult;
  assert.ok(entry && entry.files, 'pnpm pack JSON must contain a files array');

  const files = entry.files;
  const fileNames = files.map(f => f.path);

  // Required files
  const required = [
    'package.json',
    'INSTALL.md',
    'README.md',
    'LICENSE',
    'runtime/manifest.json',
    'runtime/components/core/package.json',
    'runtime/components/core/package-lock.json',
    'references/runtime-contract.md',
    '.codex-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
  ];
  for (const req of required) {
    assert.ok(
      fileNames.some(f => f === req || f.endsWith('/' + req) || f === './' + req),
      `required file must be in pack: ${req}`
    );
  }

  // Forbidden content
  const forbiddenPatterns = ['node_modules', 'test/', 'artifacts/'];
  for (const pattern of forbiddenPatterns) {
    assert.ok(
      !fileNames.some(f => f.includes(pattern)),
      `forbidden content must not be in pack: ${pattern}`
    );
  }

  // Public root must not have leftover .tgz files from pack
  const leftoverTgz = fs.readdirSync(ROOT).filter(f => f.endsWith('.tgz'));
  assert.deepEqual(leftoverTgz, [],
    `public root must not contain .tgz files after dry-run pack, found: ${leftoverTgz.join(', ')}`);
});

// ─── npm Rejection ────────────────────────────────────────────────────────

test('plugin declares no npmPackage — project publisher will reject npm publish', () => {
  const releasePath = path.resolve(ROOT, '..', '..', 'public-release.json');
  assert.ok(fs.existsSync(releasePath), `public-release.json must exist at ${releasePath}`);
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  const plugins = release.plugins || [];
  for (const plugin of plugins) {
    assert.equal(plugin.npmPackage, null,
      `plugin "${plugin.name}" must not declare npmPackage so project publisher/publishing orchestration will reject`);
  }
});

test('package.json has no main/types/exports — structure does not suggest npm publish intent', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.main, undefined, 'package.json must not have main');
  assert.equal(pkg.types, undefined, 'package.json must not have types');
  assert.equal(pkg.exports, undefined, 'package.json must not have exports');
});

// ─── Standalone Snapshot ──────────────────────────────────────────────────

test('standalone snapshot is outside source tree and contains no leaks', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-snapshot-test-'));
  t.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  // Copy public source to temp (excluding node_modules, .git, dist)
  const exclude = new Set(['node_modules', '.git', 'dist', '.DS_Store']);
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;
      // 排除所有 *.tgz 文件（glob 排除，不只是名为 ".tgz" 的文件）
      if (entry.isFile() && entry.name.endsWith('.tgz')) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  copyDir(ROOT, tmpDir);

  // Verify outside source tree
  const realRoot = fs.realpathSync(ROOT);
  const realSnapshot = fs.realpathSync(tmpDir);
  assert.ok(!realSnapshot.startsWith(realRoot),
    'snapshot must be outside source tree');

  // Verify no symlinks
  function findSymlinks(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) results.push(entry.name);
      else if (entry.isDirectory()) results.push(...findSymlinks(full));
    }
    return results;
  }
  assert.deepEqual(findSymlinks(tmpDir), [], 'snapshot must have no symlinks');

  // Verify no absolute user paths in text files
  const absPathRe = /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+)/;
  function findLeaks(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findLeaks(full));
      } else if (entry.isFile() && /\.(?:md|json|mjs|js)$/i.test(entry.name)) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          if (absPathRe.test(content)) results.push(entry.name);
        } catch {}
      }
    }
    return results;
  }
  assert.deepEqual(findLeaks(tmpDir), [], 'snapshot must have no absolute path leaks');
});

// ─── Core Runtime Smoke in Isolation ──────────────────────────────────────

test('core runtime loads through isolated loader (no node_modules)', async (t) => {
  // Use the runtime-loader-fixture helper
  const { createLoaderFixture } = await import('./helpers/runtime-loader-fixture.mjs');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-runtime-smoke-'));
  t.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => { try { fixture.cleanup?.(); } catch {} });

  // Test loading fast-xml-parser through loader
  const result = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      const { XMLParser } = loader.requireRuntimePackage('core', 'fast-xml-parser');
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse('<bpmn:definitions><bpmn:process><bpmn:task id="t1"/></bpmn:process></bpmn:definitions>');
      if (parsed?.['bpmn:definitions']?.['bpmn:process']) {
        console.log(JSON.stringify({ ok: true }));
        process.exit(0);
      }
      console.log(JSON.stringify({ ok: false, error: 'parse result unexpected', keys: Object.keys(parsed || {}) }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, code: e.code, message: e.message }));
      process.exit(1);
    }
    `,
  ], {
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
    timeout: 30000,
    encoding: 'utf8',
  });

  const output = JSON.parse(result);
  assert.equal(output.ok, true, `fast-xml-parser must load through runtime loader: ${JSON.stringify(output)}`);
});

test('runtime returns FLOW_ARCHITECT_RUNTIME_MISSING when core is not installed', async (t) => {
  const { createIsolatedPlugin } = await import('./helpers/runtime-loader-fixture.mjs');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-missing-core-'));
  t.after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const loaderPath = path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs');

  const result = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(pathToFileURL(loaderPath).href)});
    try {
      loader.requireRuntimePackage('core', 'ajv');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
      }));
      process.exit(0);
    }
    `,
  ], {
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: '/nonexistent-cache', NODE_PATH: '' },
    shell: false,
    timeout: 30000,
    encoding: 'utf8',
  });

  const output = JSON.parse(result);
  assert.equal(output.threw, true, 'must throw when core is not installed');
  assert.equal(output.code, 'FLOW_ARCHITECT_RUNTIME_MISSING',
    'must throw FLOW_ARCHITECT_RUNTIME_MISSING, not ERR_MODULE_NOT_FOUND');
});
