import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');

/**
 * Run pnpm pack --json and return the parsed JSON result.
 * Uses a temp output path and cleans up the tarball afterward.
 * @returns {{ files: Array<{path: string}> }}
 */
function packFileList() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-pack-'));
  const outFile = path.join(tmpDir, 'pack.tgz');
  try {
    const raw = execSync(`pnpm pack --json --out ${outFile}`, {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(raw);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Get the set of forbidden paths from public-release.json.
 * @returns {string[]}
 */
function forbiddenPaths() {
  const releasePath = path.join(WORKSPACE_ROOT, 'public-release.json');
  if (!fs.existsSync(releasePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  return parsed.forbiddenPaths || [];
}

function assertPackContains(expectedPath) {
  const result = packFileList();
  const paths = (result.files || []).map(f => f.path.replace(/^package\//, ''));
  assert.ok(paths.includes(expectedPath), `Published package must contain ${expectedPath}`);
}

// --- Test: Published package excludes private parent paths ---

test('published package does not contain artifacts/ files', () => {
  const result = packFileList();
  const artifactFiles = (result.files || [])
    .filter(f => f.path.startsWith('artifacts/') || f.path.startsWith('package/artifacts/'));
  assert.equal(artifactFiles.length, 0,
    `Package should not contain artifacts/ files, found: ${artifactFiles.map(f => f.path).join(', ')}`);
});

test('published package does not contain references/source/ files', () => {
  const result = packFileList();
  const sourceFiles = (result.files || [])
    .filter(f => f.path.includes('references/source/') || f.path.includes('package/references/source/'));
  assert.equal(sourceFiles.length, 0,
    `Package should not contain references/source/ files, found: ${sourceFiles.map(f => f.path).join(', ')}`);
});

test('published package does not contain docs/process/ files', () => {
  const result = packFileList();
  const docsProcess = (result.files || [])
    .filter(f => f.path.includes('docs/process/') || f.path.includes('package/docs/process/'));
  assert.equal(docsProcess.length, 0,
    `Package should not contain docs/process/ files, found: ${docsProcess.map(f => f.path).join(', ')}`);
});

test('published package does not contain docs/reviews/ files', () => {
  const result = packFileList();
  const docsReviews = (result.files || [])
    .filter(f => f.path.includes('docs/reviews/') || f.path.includes('package/docs/reviews/'));
  assert.equal(docsReviews.length, 0,
    `Package should not contain docs/reviews/ files, found: ${docsReviews.map(f => f.path).join(', ')}`);
});

test('published package does not contain runs/ files', () => {
  const result = packFileList();
  const runsFiles = (result.files || [])
    .filter(f => f.path.includes('/runs/') || f.path.startsWith('runs/'));
  assert.equal(runsFiles.length, 0,
    `Package should not contain runs/ files, found: ${runsFiles.map(f => f.path).join(', ')}`);
});

// --- Test: All forbidden paths from public-release.json are excluded ---

test('all forbidden paths from public-release.json are excluded from pack', () => {
  const forbidden = forbiddenPaths();
  if (forbidden.length === 0) return; // Skip if no release config
  const result = packFileList();
  const paths = (result.files || []).map(f => f.path);

  for (const fb of forbidden) {
    const matches = paths.filter(p => p.startsWith(fb + '/') || p.startsWith('package/' + fb + '/'));
    assert.equal(matches.length, 0,
      `Forbidden path "${fb}" found in pack: ${matches.join(', ')}`);
  }
});

// --- Test: Pack file list contains expected core directories ---

test('pack file list contains skills/ directory entries', () => {
  const result = packFileList();
  const skillFiles = (result.files || [])
    .filter(f => f.path.includes('skills/'));
  assert.ok(skillFiles.length > 0, 'Package should contain skills/ files');
});

test('pack file list contains references/ directory entries', () => {
  const result = packFileList();
  const refFiles = (result.files || [])
    .filter(f => f.path.includes('references/'));
  assert.ok(refFiles.length > 0, 'Package should contain references/ files');
});

test('pack file list contains scripts/ directory entries', () => {
  const result = packFileList();
  const scriptFiles = (result.files || [])
    .filter(f => f.path.includes('scripts/'));
  assert.ok(scriptFiles.length > 0, 'Package should contain scripts/ files');
});

test('pack file list contains agents/ directory entries', () => {
  const result = packFileList();
  const agentFiles = (result.files || [])
    .filter(f => f.path.includes('agents/'));
  assert.ok(agentFiles.length > 0, 'Package should contain agents/ files');
});

test('pack file list contains the Chinese user guide', () => {
  assertPackContains('docs/zh-CN/user-guide.md');
});

test('pack file list contains the Codex marketplace', () => {
  assertPackContains('.agents/plugins/marketplace.json');
});

test('pack file list contains the Claude marketplace', () => {
  assertPackContains('.claude-plugin/marketplace.json');
});

test('pack file list is non-empty and has reasonable size', () => {
  const result = packFileList();
  assert.ok(Array.isArray(result.files), 'pack result must have files array');
  assert.ok(result.files.length >= 50, `Expected at least 50 files in pack, got ${result.files.length}`);
});
