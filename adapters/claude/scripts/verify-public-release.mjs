#!/usr/bin/env node
/**
 * Public Release Verification
 *
 * Verifies the public subproject is ready for release:
 * 1. Pack audit: required files present, forbidden content absent
 * 2. npm rejection: plugins without npmPackage cannot be npm-published
 * 3. Snapshot self-containment: standalone copy works outside source tree
 *
 * Usage:
 *   node scripts/verify-public-release.mjs [--snapshot]
 *
 * --snapshot: also create and verify a standalone snapshot in a temp dir
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let exitCode = 0;
function fail(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  exitCode = 1;
}
function pass(msg) {
  process.stdout.write(`PASS: ${msg}\n`);
}

// ─── 1. Pack Audit ────────────────────────────────────────────────────────

function auditPack() {
  process.stdout.write('\n=== Pack Audit ===\n');
  let packResult;
  try {
    const raw = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      shell: false,
    });
    packResult = JSON.parse(raw);
  } catch (err) {
    fail(`pnpm pack --dry-run --json failed: ${err.message}`);
    return;
  }

  // pnpm may return either an object { files, size, ... }
  // or an array [ { files, size, ... } ]. Accept both.
  const entry = Array.isArray(packResult) ? packResult[0] : packResult;
  const files = entry?.files || [];
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
    if (fileNames.some(f => f === req || f.endsWith('/' + req) || f === './' + req)) {
      pass(`required: ${req}`);
    } else {
      fail(`required file missing from pack: ${req}`);
    }
  }

  // Forbidden content
  const forbidden = [
    'node_modules',
    'test/',
    'artifacts/',
    'docs/process/',
    '.tgz',
  ];
  for (const f of forbidden) {
    if (fileNames.some(name => name.includes(f))) {
      const matched = fileNames.filter(name => name.includes(f));
      fail(`forbidden content in pack: ${f} (${matched.slice(0, 3).join(', ')})`);
    } else {
      pass(`forbidden absent: ${f}`);
    }
  }

  // Absolute path check in packed text files
  process.stdout.write(`  Total files in pack: ${fileNames.length}\n`);
  process.stdout.write(`  Pack size: ${entry?.size || 'unknown'} bytes\n`);

  // C-06: Public root must not have leftover .tgz files — report FAIL only, do NOT delete
  const leftoverTgz = fs.readdirSync(ROOT).filter(f => f.endsWith('.tgz'));
  if (leftoverTgz.length > 0) {
    fail(`public root contains .tgz files: ${leftoverTgz.join(', ')} (not deleted — manual cleanup required)`);
  } else {
    pass('no leftover .tgz files in public root');
  }
}

// ─── 2. npm Rejection ─────────────────────────────────────────────────────

function auditNpmRejection() {
  process.stdout.write('\n=== npm Rejection ===\n');

  // Read public-release.json from workspace root (up from packages/flow-architect/)
  // When running from adapters/claude/scripts/ or adapters/codex/scripts/,
  // navigate up to packages/flow-architect/ first, then to workspace root.
  let releasePath = path.resolve(ROOT, '..', '..', 'public-release.json');
  if (!fs.existsSync(releasePath)) {
    // Fallback: search upward for public-release.json
    let dir = ROOT;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'public-release.json');
      if (fs.existsSync(candidate)) { releasePath = candidate; break; }
      dir = path.dirname(dir);
    }
  }
  if (!fs.existsSync(releasePath)) {
    fail('public-release.json not found');
    return;
  }

  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  const plugins = release.plugins || [];

  for (const plugin of plugins) {
    if (plugin.npmPackage) {
      fail(`plugin "${plugin.name}" declares npmPackage "${plugin.npmPackage}" — project publisher would allow npm publish`);
    } else {
      pass(`plugin "${plugin.name}" has no npmPackage — project publisher/publishing orchestration will reject npm publish (NPM_PUBLISH_NOT_ALLOWED)`);
    }
  }

  // Verify package.json does not declare "main" or "types" (which would suggest npm publishability)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.main || pkg.types || pkg.exports) {
    fail('package.json declares main/types/exports — package appears structurally npm-publishable');
  } else {
    pass('package.json has no main/types/exports — package structure does not suggest npm publish intent');
  }
}

// ─── 3. Snapshot Self-Containment ─────────────────────────────────────────

function auditSnapshot() {
  process.stdout.write('\n=== Snapshot Self-Containment ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-release-snapshot-'));

  try {
    // Copy public source to temp (excluding node_modules, .git, dist)
    const exclude = ['node_modules', '.git', 'dist', '.tgz'];
    copyDir(ROOT, tmpDir, exclude);

    pass(`snapshot created at: ${tmpDir}`);

    // Verify no symlinks
    const symlinks = findSymlinks(tmpDir);
    if (symlinks.length > 0) {
      fail(`symlinks found in snapshot: ${symlinks.join(', ')}`);
    } else {
      pass('no symlinks in snapshot');
    }

    // Verify no absolute user paths in text files
    const leaks = findAbsolutePaths(tmpDir);
    if (leaks.length > 0) {
      fail(`absolute paths found: ${leaks.slice(0, 5).join(', ')}`);
    } else {
      pass('no absolute user paths in snapshot');
    }

    // Verify snapshot is outside source tree
    const realRoot = fs.realpathSync(ROOT);
    const realSnapshot = fs.realpathSync(tmpDir);
    if (realSnapshot.startsWith(realRoot)) {
      fail('snapshot is inside source tree');
    } else {
      pass('snapshot is outside source tree');
    }

    // Verify pnpm install works (if --snapshot flag)
    if (process.argv.includes('--snapshot')) {
      try {
        execFileSync('pnpm', ['install', '--frozen-lockfile'], {
          cwd: tmpDir,
          encoding: 'utf8',
          timeout: 120000,
          shell: false,
          stdio: 'pipe',
        });
        pass('pnpm install --frozen-lockfile succeeded in snapshot');
      } catch (err) {
        fail(`pnpm install failed in snapshot: ${err.message}`);
      }
    }
  } finally {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function copyDir(src, dest, exclude = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // 精确名称匹配（隐藏目录、node_modules 等）
    if (exclude.includes(entry.name)) continue;
    // glob 模式匹配：排除所有 *.tgz 文件
    if (entry.isFile() && entry.name.endsWith('.tgz')) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, exclude);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function findSymlinks(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      results.push(path.relative(ROOT, full));
    } else if (entry.isDirectory()) {
      results.push(...findSymlinks(full));
    }
  }
  return results;
}

function findAbsolutePaths(dir) {
  const results = [];
  const absPathRe = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/u;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAbsolutePaths(full));
    } else if (entry.isFile() && /\.(?:md|json|mjs|js|txt)$/i.test(entry.name)) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        if (absPathRe.test(content)) {
          results.push(entry.name);
        }
      } catch {}
    }
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────

auditPack();
auditNpmRejection();

if (process.argv.includes('--snapshot') || process.argv.includes('--full')) {
  auditSnapshot();
}

process.stdout.write(`\n=== Result: ${exitCode === 0 ? 'ALL PASSED' : 'SOME FAILURES'} ===\n`);
process.exit(exitCode);
