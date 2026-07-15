import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT, 'scripts', 'runtime-manager.mjs');
const LIB_PATH = path.join(ROOT, 'scripts', 'lib', 'runtime-manager.mjs');

// Helper: 创建临时目录并在测试后清理
function createTempDir(testName) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `runtime-test-${testName}-`));
  return {
    path: tmpDir,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        // ignore cleanup errors
      }
    }
  };
}

// Helper: 创建插件根目录结构（模拟无 node_modules 的 Marketplace 插件）
function createPluginFixture(tmpDir) {
  const pluginRoot = path.join(tmpDir, 'plugin-root');
  fs.mkdirSync(pluginRoot, { recursive: true });

  // 创建 package.json
  const packageJson = {
    name: '@flow-architect/test-plugin',
    version: '0.1.2',
    private: true,
    dependencies: {
      ajv: '8.20.0',
      'fast-xml-parser': '4.5.7',
      yaml: '2.9.0',
      'pdfjs-dist': '4.10.38',
      mammoth: '1.12.0',
      exceljs: '4.4.0'
    }
  };
  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify(packageJson, null, 2));

  // 创建 runtime 目录结构
  const runtimeDir = path.join(pluginRoot, 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  // 创建 manifest.json
  const manifest = {
    runtime_version: '1.0.0',
    plugin_compatibility: '>=0.1.2 <0.2.0',
    components: [
      {
        name: 'core',
        required: true,
        packages: {
          ajv: '8.20.0',
          'fast-xml-parser': '4.5.7',
          yaml: '2.9.0'
        }
      },
      {
        name: 'pdf',
        required: false,
        packages: {
          'pdfjs-dist': '4.10.38'
        }
      },
      {
        name: 'docx',
        required: false,
        packages: {
          mammoth: '1.12.0'
        }
      },
      {
        name: 'xlsx',
        required: false,
        packages: {
          exceljs: '4.4.0'
        }
      }
    ]
  };
  fs.writeFileSync(path.join(runtimeDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 创建 component package.json 和 lock 文件（描述性，不是已安装）
  const componentsDir = path.join(runtimeDir, 'components');
  for (const comp of manifest.components) {
    const compDir = path.join(componentsDir, comp.name);
    fs.mkdirSync(compDir, { recursive: true });

    const compPackageJson = {
      name: `@flow-architect/runtime-${comp.name}`,
      version: '1.0.0',
      private: true,
      dependencies: comp.packages
    };
    fs.writeFileSync(path.join(compDir, 'package.json'), JSON.stringify(compPackageJson, null, 2));

    // 创建 lock 文件（简化版，实际应为完整 lock）
    const lockFile = {
      name: `@flow-architect/runtime-${comp.name}`,
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {}
    };
    for (const [pkg, version] of Object.entries(comp.packages)) {
      lockFile.packages[`node_modules/${pkg}`] = { version };
    }
    fs.writeFileSync(path.join(compDir, 'package-lock.json'), JSON.stringify(lockFile, null, 2));
  }

  return pluginRoot;
}

// Helper: 复制 CLI 和 lib 到插件根目录，使其可独立执行
function copyCliToPlugin(pluginRoot) {
  const pluginScriptsDir = path.join(pluginRoot, 'scripts');
  const pluginLibDir = path.join(pluginScriptsDir, 'lib');
  fs.mkdirSync(pluginLibDir, { recursive: true });

  // 复制 CLI
  fs.copyFileSync(CLI_PATH, path.join(pluginScriptsDir, 'runtime-manager.mjs'));

  // 复制 lib（如果存在）
  if (fs.existsSync(LIB_PATH)) {
    fs.copyFileSync(LIB_PATH, path.join(pluginLibDir, 'runtime-manager.mjs'));
  }

  return path.join(pluginScriptsDir, 'runtime-manager.mjs');
}

// Helper: 获取文件/目录的快照哈希
function getPathSnapshot(targetPath) {
  if (!fs.existsSync(targetPath)) return { exists: false };

  const records = [];
  function walk(absolutePath, relativePath) {
    const stat = fs.lstatSync(absolutePath);
    const mode = stat.mode & 0o7777;
    if (stat.isSymbolicLink()) {
      records.push({ path: relativePath, type: 'symlink', mode, target: fs.readlinkSync(absolutePath) });
      return;
    }
    if (stat.isDirectory()) {
      records.push({ path: relativePath, type: 'directory', mode });
      for (const name of fs.readdirSync(absolutePath).sort()) {
        walk(path.join(absolutePath, name), path.join(relativePath, name));
      }
      return;
    }
    records.push({
      path: relativePath,
      type: 'file',
      mode,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex')
    });
  }
  walk(targetPath, '.');
  return { exists: true, records };
}

function createFakePackages(packageRoot, packages) {
  const nodeModulesDir = path.join(packageRoot, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  for (const [packageName, version] of Object.entries(packages)) {
    const packageDir = path.join(nodeModulesDir, packageName);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      name: packageName,
      version,
      main: 'index.js'
    }));
    fs.writeFileSync(path.join(packageDir, 'index.js'), `module.exports = ${JSON.stringify({ name: packageName, version })};`);
  }
}

function createFakeNpm(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const npmPath = path.join(binDir, 'npm');
  fs.writeFileSync(npmPath, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] === '--version') { process.stdout.write('10.9.0\\n'); process.exit(0); }
if (process.env.FAKE_NPM_FAIL === '1') {
  process.stderr.write('npm failed at https://user:super-secret@registry.example.test/ token=npm_secret_123');
  process.exit(7);
}
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
for (const [name, version] of Object.entries(pkg.dependencies || {})) {
  const dir = path.join(process.cwd(), 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = ' + JSON.stringify({ name, version }));
}
fs.writeFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(process.argv.slice(2)));
`);
  fs.chmodSync(npmPath, 0o755);
  return npmPath;
}

// 测试 1: CLI 存在且可执行
test('CLI script exists and is executable', () => {
  const tmp = createTempDir('cli-exists');
  try {
    assert.ok(fs.existsSync(CLI_PATH), 'runtime-manager.mjs CLI should exist');
    const stat = fs.statSync(CLI_PATH);
    assert.ok(stat.isFile(), 'CLI should be a file');
  } finally {
    tmp.cleanup();
  }
});

// 测试 2: lib module 存在且可导入
test('lib/runtime-manager.mjs exists and exports required functions', async () => {
  const tmp = createTempDir('lib-exists');
  try {
    assert.ok(fs.existsSync(LIB_PATH), 'lib/runtime-manager.mjs should exist');
    const mod = await import(LIB_PATH);

    // 验证所有必需的导出函数
    assert.equal(typeof mod.cacheRoot, 'function', 'cacheRoot should be a function');
    assert.equal(typeof mod.readManifest, 'function', 'readManifest should be a function');
    assert.equal(typeof mod.checkRuntime, 'function', 'checkRuntime should be a function');
    assert.equal(typeof mod.buildInstallPlan, 'function', 'buildInstallPlan should be a function');
    assert.equal(typeof mod.installRuntime, 'function', 'installRuntime should be a function');
    assert.equal(typeof mod.doctorRuntime, 'function', 'doctorRuntime should be a function');
  } finally {
    tmp.cleanup();
  }
});

// 测试 3: 无 node_modules 时 check 报告 core BLOCKED
test('check reports BLOCKED when node_modules does not exist', async () => {
  const tmp = createTempDir('check-blocked');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const result = mod.checkRuntime({ pluginRoot, cacheDir, env: {} });

    // 精确断言
    assert.equal(result.overall, 'BLOCKED', 'overall should be BLOCKED');
    assert.equal(Array.isArray(result.components), true, 'components must be an array');

    const coreComp = result.components.find(c => c.name === 'core');
    assert.ok(coreComp, 'should have core component');
    assert.equal(coreComp.status, 'MISSING', 'core should be MISSING');
    assert.deepEqual(coreComp.missing_packages, ['ajv', 'fast-xml-parser', 'yaml']);

    // 验证 exit code 逻辑：BLOCKED 应返回 1
    assert.equal(result.exitCode, 1, 'exit code should be 1 for BLOCKED');
  } finally {
    tmp.cleanup();
  }
});

test('check reports local packages READY only when every exact version can be loaded', async () => {
  const tmp = createTempDir('check-local-ready');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'runtime', 'manifest.json'), 'utf8'));
    for (const component of manifest.components) createFakePackages(pluginRoot, component.packages);

    const mod = await import(LIB_PATH);
    const result = mod.checkRuntime({ pluginRoot, cacheDir: path.join(tmp.path, 'cache'), env: {} });

    assert.equal(result.overall, 'READY');
    assert.deepEqual(result.components.map(component => [component.name, component.status, component.source]), [
      ['core', 'READY', 'plugin'],
      ['pdf', 'READY', 'plugin'],
      ['docx', 'READY', 'plugin'],
      ['xlsx', 'READY', 'plugin']
    ]);
  } finally {
    tmp.cleanup();
  }
});

test('check accepts the real exact plugin-local dependencies', async () => {
  const tmp = createTempDir('check-real-local-ready');
  try {
    const mod = await import(LIB_PATH);
    const result = mod.checkRuntime({ pluginRoot: ROOT, cacheDir: path.join(tmp.path, 'cache'), env: {} });
    assert.equal(result.overall, 'READY');
    assert.deepEqual(result.components.map(component => [component.name, component.status, component.source]), [
      ['core', 'READY', 'plugin'],
      ['pdf', 'READY', 'plugin'],
      ['docx', 'READY', 'plugin'],
      ['xlsx', 'READY', 'plugin']
    ]);
  } finally {
    tmp.cleanup();
  }
});

// 测试 4: check/plan/doctor 不修改文件系统（零写入）
test('check, plan, and doctor do not modify filesystem', async () => {
  const tmp = createTempDir('no-write');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    // 快照所有相关路径
    const beforeSnapshots = {
      pluginRoot: getPathSnapshot(pluginRoot),
      cacheDir: getPathSnapshot(cacheDir)
    };

    const mod = await import(LIB_PATH);

    // 运行 check
    mod.checkRuntime({ pluginRoot, cacheDir, env: {} });

    // 运行 plan
    mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    // 运行 doctor
    mod.doctorRuntime({ pluginRoot, cacheDir, env: {}, processInfo: { nodeVersion: process.version, platform: process.platform } });

    // 验证快照未变
    const afterSnapshots = {
      pluginRoot: getPathSnapshot(pluginRoot),
      cacheDir: getPathSnapshot(cacheDir)
    };

    assert.deepEqual(beforeSnapshots.pluginRoot, afterSnapshots.pluginRoot, 'pluginRoot should be unchanged after check/plan/doctor');
    assert.deepEqual(beforeSnapshots.cacheDir, afterSnapshots.cacheDir, 'cacheDir should be unchanged after check/plan/doctor');
  } finally {
    tmp.cleanup();
  }
});

// 测试 5: plan 返回稳定结果（两次调用字节相等）
test('buildInstallPlan returns stable output for same input', async () => {
  const tmp = createTempDir('plan-stable');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan1 = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core', 'pdf'], env: {} });
    const plan2 = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core', 'pdf'], env: {} });

    // 验证稳定性
    assert.deepEqual(plan1, plan2, 'plan should be identical for same input');
    assert.ok(plan1.plan_sha256, 'plan should have plan_sha256');
    assert.equal(plan1.plan_sha256, plan2.plan_sha256, 'plan_sha256 should be identical');

    // 验证组件排序：core, pdf, docx, xlsx
    const expectedOrder = ['core', 'pdf'];
    assert.deepEqual(plan1.components.map(c => c.name), expectedOrder, 'components should be sorted');

    // 验证不包含敏感信息
    const planStr = JSON.stringify(plan1);
    assert.ok(!planStr.includes(os.homedir()), 'plan should not contain home directory');
    assert.ok(!planStr.includes('token'), 'plan should not contain tokens');
    assert.ok(!planStr.includes('password'), 'plan should not contain passwords');
  } finally {
    tmp.cleanup();
  }
});

// 测试 6: plan 包含所有请求的组件
test('buildInstallPlan includes all requested components', async () => {
  const tmp = createTempDir('plan-components');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core', 'pdf', 'docx', 'xlsx'], env: {} });

    assert.equal(plan.components.length, 4, 'should include all 4 components');
    assert.deepEqual(plan.components.map(c => c.name), ['core', 'pdf', 'docx', 'xlsx'], 'should have correct order');

    // 验证每个组件都有 packages
    for (const comp of plan.components) {
      assert.ok(comp.name, 'component should have name');
      assert.ok(comp.packages, 'component should have packages');
      assert.equal(typeof comp.packages, 'object', 'packages should be an object');
    }
  } finally {
    tmp.cleanup();
  }
});

// 测试 7: install 拒绝不匹配的 SHA
test('installRuntime rejects mismatched plan SHA', async () => {
  const tmp = createTempDir('install-wrong-sha');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    // 快照
    const beforeSnapshot = getPathSnapshot(cacheDir);

    let executorCallCount = 0;
    // 使用错误的 SHA
    await assert.rejects(
      () => mod.installRuntime(plan, {
        acceptedPlanSha256: 'wrong-sha-12345',
        executeNpm: async () => { executorCallCount += 1; },
        now: () => new Date('2026-07-15T00:00:00Z'),
        processInfo: { nodeVersion: process.version, platform: process.platform }
      }),
      { message: /SHA.*mismatch/i }
    );

    // 验证未创建任何目录
    const afterSnapshot = getPathSnapshot(cacheDir);
    assert.deepEqual(beforeSnapshot, afterSnapshot, 'cacheDir should be unchanged after rejected install');
    assert.equal(executorCallCount, 0, 'executor must not run before plan acceptance');
  } finally {
    tmp.cleanup();
  }
});

// 测试 8: install 拒绝缺少 acceptedPlanSha256
test('installRuntime rejects missing acceptedPlanSha256', async () => {
  const tmp = createTempDir('install-missing-sha');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    await assert.rejects(
      () => mod.installRuntime(plan, {}),
      { message: /acceptedPlanSha256/i }
    );
  } finally {
    tmp.cleanup();
  }
});

// 测试 9: 安装成功后组件状态为 READY
test('installRuntime makes component READY after successful install', async () => {
  const tmp = createTempDir('install-ready');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    // 模拟成功的 npm executor（创建 node_modules）
    let executorCallCount = 0;
    const mockExecutor = async (componentDir, packages) => {
      executorCallCount++;
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });

      // 创建模拟的包
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
          name: pkg,
          version: version,
          main: 'index.js'
        }));
        // 创建可加载的入口
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = { name: '${pkg}', version: '${version}' };`);
      }
    };

    const result = await mod.installRuntime(plan, {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    });

    assert.ok(result, 'install should return result');
    assert.equal(executorCallCount, 1, 'executor should be called once');

    // 验证 core 组件状态
    const coreComp = result.components.find(c => c.name === 'core');
    assert.ok(coreComp, 'should have core component');
    assert.equal(coreComp.status, 'READY', 'core should be READY after install');

    // 验证 overall 状态
    assert.equal(result.overall, 'DEGRADED', 'core-only runtime should be DEGRADED because optional components are missing');
  } finally {
    tmp.cleanup();
  }
});

// 测试 10: state 文件被正确创建
test('installRuntime creates runtime-state.json', async () => {
  const tmp = createTempDir('install-state');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    const mockExecutor = async (componentDir, packages) => {
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = {};`);
      }
    };

    await mod.installRuntime(plan, {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: 'darwin', arch: 'arm64' }
    });

    // 验证 state 文件
    const statePath = path.join(cacheDir, 'runtimes', '1.0.0', 'runtime-state.json');
    assert.ok(fs.existsSync(statePath), 'runtime-state.json should exist');

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(state.installed_at, '2026-07-15T00:00:00.000Z');
    assert.equal(state.node_version, process.version);
    assert.equal(state.npm_version, '10.9.0');
    assert.equal(state.platform, 'darwin');
    assert.equal(state.arch, 'arm64');
    assert.equal(typeof state.components.core, 'object');
    assert.equal(state.components.core.status, 'READY', 'core status in state should be READY');
  } finally {
    tmp.cleanup();
  }
});

// 测试 11: 错误 SHA 时不创建任何目录
test('wrong SHA prevents directory creation', async () => {
  const tmp = createTempDir('wrong-sha-no-create');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    // 记录 cacheDir 之前的状态
    const cacheDirExisted = fs.existsSync(cacheDir);

    await assert.rejects(
      () => mod.installRuntime(plan, {
        acceptedPlanSha256: 'completely-wrong-sha',
        executeNpm: async () => { throw new Error('should not be called'); }
      })
    );

    // 如果 cacheDir 之前不存在，现在也不应该存在
    if (!cacheDirExisted) {
      assert.ok(!fs.existsSync(cacheDir), 'cacheDir should not be created on SHA mismatch');
    }
  } finally {
    tmp.cleanup();
  }
});

// 测试 12: 并发安装只允许一个执行
test('concurrent installs are serialized by lock', async () => {
  const tmp = createTempDir('concurrent-install');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    let executorCallCount = 0;
    const mockExecutor = async (componentDir, packages) => {
      executorCallCount++;
      // 模拟慢速安装
      await new Promise(resolve => setTimeout(resolve, 100));
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = {};`);
      }
    };

    const installOpts = {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    };

    // 同时启动两个安装
    const [result1, result2] = await Promise.allSettled([
      mod.installRuntime(plan, installOpts),
      mod.installRuntime(plan, installOpts)
    ]);

    // 一个应该成功，一个应该失败（锁冲突）
    const settled = [result1, result2];
    const successes = settled.filter(r => r.status === 'fulfilled');
    const failures = settled.filter(r => r.status === 'rejected');

    assert.equal(executorCallCount, 1, 'executor should be called only once');
    assert.equal(successes.length, 1, 'one install should succeed');
    assert.equal(failures.length, 1, 'one install should fail');

    // 失败的应该是锁错误
    const lockError = failures[0].reason;
    assert.ok(lockError.message.includes('lock') || lockError.message.includes('concurrent'), 'error should mention lock or concurrent');
  } finally {
    tmp.cleanup();
  }
});

// 测试 13: 重复安装是幂等的
test('reinstall does not call executor again for READY component', async () => {
  const tmp = createTempDir('reinstall-idempotent');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    let executorCallCount = 0;
    const mockExecutor = async (componentDir, packages) => {
      executorCallCount++;
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = {};`);
      }
    };

    const installOpts = {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    };

    // 第一次安装
    await mod.installRuntime(plan, installOpts);
    assert.equal(executorCallCount, 1, 'executor called once on first install');

    // 第二次安装（应复用）
    await mod.installRuntime(plan, installOpts);
    assert.equal(executorCallCount, 1, 'executor should not be called again on reinstall');
    assert.equal(fs.existsSync(path.join(cacheDir, 'locks', 'runtime-1.0.0.lock')), false, 'pure reuse must release the install lock');
  } finally {
    tmp.cleanup();
  }
});

test('CLI install uses the default npm executor with argument arrays', () => {
  const tmp = createTempDir('cli-default-executor');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cliInPlugin = copyCliToPlugin(pluginRoot);
    const binDir = path.join(tmp.path, 'bin');
    createFakeNpm(binDir);
    const npmLog = path.join(tmp.path, 'npm-args.json');
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FLOW_ARCHITECT_CACHE_DIR: path.join(tmp.path, 'cache'),
      FAKE_NPM_LOG: npmLog
    };
    const planRun = spawnSync(process.execPath, [cliInPlugin, 'plan', '--components', 'core', '--json'], {
      cwd: tmp.path, env, encoding: 'utf8'
    });
    assert.equal(planRun.status, 0);
    const plan = JSON.parse(planRun.stdout);
    const installRun = spawnSync(process.execPath, [cliInPlugin, 'install', '--components', 'core', '--accept-plan', plan.plan_sha256, '--json'], {
      cwd: tmp.path, env, encoding: 'utf8'
    });
    assert.equal(installRun.status, 0, installRun.stdout || installRun.stderr);
    assert.equal(JSON.parse(installRun.stdout).overall, 'DEGRADED');
    assert.deepEqual(JSON.parse(fs.readFileSync(npmLog, 'utf8')), ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts']);
    const state = JSON.parse(fs.readFileSync(path.join(tmp.path, 'cache', 'runtimes', '1.0.0', 'runtime-state.json'), 'utf8'));
    assert.equal(state.npm_version, '10.9.0');
    assert.equal(state.components.core.smoke, 'passed');
  } finally {
    tmp.cleanup();
  }
});

test('CLI install redacts credentials from default npm failures', () => {
  const tmp = createTempDir('cli-default-executor-redaction');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cliInPlugin = copyCliToPlugin(pluginRoot);
    const binDir = path.join(tmp.path, 'bin');
    createFakeNpm(binDir);
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FLOW_ARCHITECT_CACHE_DIR: path.join(tmp.path, 'cache'),
      FAKE_NPM_LOG: path.join(tmp.path, 'npm-args.json'),
      FAKE_NPM_FAIL: '1'
    };
    const planRun = spawnSync(process.execPath, [cliInPlugin, 'plan', '--components', 'core', '--json'], { cwd: tmp.path, env, encoding: 'utf8' });
    const plan = JSON.parse(planRun.stdout);
    const installRun = spawnSync(process.execPath, [cliInPlugin, 'install', '--components', 'core', '--accept-plan', plan.plan_sha256, '--json'], {
      cwd: tmp.path, env, encoding: 'utf8'
    });
    assert.equal(installRun.status, 1);
    const output = `${installRun.stdout}\n${installRun.stderr}`;
    assert.equal(output.includes('super-secret'), false);
    assert.equal(output.includes('npm_secret_123'), false);
    assert.equal(output.includes('user:'), false);
  } finally {
    tmp.cleanup();
  }
});

// 测试 14: CLI check 命令输出 JSON 并返回正确 exit code
test('CLI check --json outputs correct JSON and exit code', () => {
  const tmp = createTempDir('cli-check');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cliInPlugin = copyCliToPlugin(pluginRoot);

    // 运行 CLI（无 node_modules，应报告 BLOCKED）
    const result = spawnSync(process.execPath, [cliInPlugin, 'check', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: path.join(tmp.path, 'cli-cache') },
      encoding: 'utf8'
    });

    // 验证 exit code
    assert.equal(result.status, 1, 'exit code should be 1 for BLOCKED');

    // 验证 stdout 是有效 JSON
    let output;
    try {
      output = JSON.parse(result.stdout);
    } catch (e) {
      assert.fail(`stdout should be valid JSON: ${result.stdout}`);
    }

    // 验证 JSON 结构
    assert.equal(output.overall, 'BLOCKED', 'overall should be BLOCKED');
    assert.ok(Array.isArray(output.components), 'components should be array');

    const coreComp = output.components.find(c => c.name === 'core');
    assert.ok(coreComp, 'should have core component');
    assert.equal(coreComp.status, 'MISSING', 'core should be MISSING');
  } finally {
    tmp.cleanup();
  }
});

// 测试 15: CLI plan 命令输出稳定 JSON
test('CLI plan --json outputs stable JSON', () => {
  const tmp = createTempDir('cli-plan');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cliInPlugin = copyCliToPlugin(pluginRoot);

    // 运行两次
    const result1 = spawnSync(process.execPath, [cliInPlugin, 'plan', '--components', 'core,pdf', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: path.join(tmp.path, 'cli-cache') },
      encoding: 'utf8'
    });

    const result2 = spawnSync(process.execPath, [cliInPlugin, 'plan', '--components', 'core,pdf', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: path.join(tmp.path, 'cli-cache') },
      encoding: 'utf8'
    });

    // 验证 exit code
    assert.equal(result1.status, 0, 'plan should succeed');
    assert.equal(result2.status, 0, 'plan should succeed');

    // 验证输出完全相同
    assert.equal(result1.stdout, result2.stdout, 'plan output should be byte-identical');

    // 验证 JSON 结构
    const plan = JSON.parse(result1.stdout);
    assert.ok(plan.plan_sha256, 'plan should have sha256');
    assert.deepEqual(plan.components.map(c => c.name), ['core', 'pdf'], 'components should be sorted');
  } finally {
    tmp.cleanup();
  }
});

test('CLI rejects invalid arguments with exit code 2', () => {
  const tmp = createTempDir('cli-invalid-arguments');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cliInPlugin = copyCliToPlugin(pluginRoot);
    const result = spawnSync(process.execPath, [cliInPlugin, 'install', '--components', 'core', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: path.join(tmp.path, 'cli-cache') },
      encoding: 'utf8'
    });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).code, 'INVALID_ARGUMENTS');
  } finally {
    tmp.cleanup();
  }
});

// 测试 16: cacheRoot 正确计算平台路径
test('cacheRoot returns platform-specific path', async () => {
  const mod = await import(LIB_PATH);

  // FLOW_ARCHITECT_CACHE_DIR 覆盖
  const customPath = mod.cacheRoot({ env: { FLOW_ARCHITECT_CACHE_DIR: '/custom/cache/path' } });
  assert.equal(customPath, '/custom/cache/path', 'should use FLOW_ARCHITECT_CACHE_DIR');

  // 各平台路径
  assert.equal(mod.cacheRoot({ env: {}, platform: 'darwin', homedir: '/Users/test' }), '/Users/test/Library/Caches/flow-architect');
  assert.equal(mod.cacheRoot({ env: {}, platform: 'linux', homedir: '/home/test' }), '/home/test/.cache/flow-architect');
  assert.equal(mod.cacheRoot({ env: { XDG_CACHE_HOME: '/xdg/cache' }, platform: 'linux', homedir: '/home/test' }), '/xdg/cache/flow-architect');
  assert.equal(mod.cacheRoot({ env: {}, platform: 'win32', homedir: 'C:\\Users\\test' }), path.join('C:\\Users\\test', 'AppData', 'Local', 'flow-architect'));
  assert.equal(mod.cacheRoot({ env: { LOCALAPPDATA: 'D:\\Local' }, platform: 'win32', homedir: 'C:\\Users\\test' }), path.join('D:\\Local', 'flow-architect'));
});

// 测试 17: readManifest 正确解析 manifest
test('readManifest parses manifest correctly', async () => {
  const tmp = createTempDir('read-manifest');
  try {
    const pluginRoot = createPluginFixture(tmp.path);

    const mod = await import(LIB_PATH);
    const manifest = mod.readManifest(pluginRoot);

    assert.ok(manifest, 'manifest should exist');
    assert.equal(manifest.runtime_version, '1.0.0', 'runtime_version should be 1.0.0');
    assert.ok(manifest.plugin_compatibility.includes('>=0.1.2'), 'should include >=0.1.2');
    assert.ok(Array.isArray(manifest.components), 'components should be array');
    assert.equal(manifest.components.length, 4, 'should have 4 components');

    // 验证 core 组件
    const core = manifest.components.find(c => c.name === 'core');
    assert.ok(core, 'should have core');
    assert.equal(core.required, true, 'core should be required');
    assert.ok(core.packages.ajv, 'core should have ajv');
    assert.ok(core.packages['fast-xml-parser'], 'core should have fast-xml-parser');
    assert.ok(core.packages.yaml, 'core should have yaml');
  } finally {
    tmp.cleanup();
  }
});

// 测试 18: doctor 报告系统信息
test('doctorRuntime reports system information', async () => {
  const tmp = createTempDir('doctor-system');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const result = mod.doctorRuntime({
      pluginRoot,
      cacheDir,
      env: {},
      processInfo: {
        nodeVersion: 'v20.10.0',
        platform: 'darwin',
        arch: 'arm64'
      }
    });

    assert.equal(result.node_version, 'v20.10.0', 'should report node version');
    assert.equal(result.platform, 'darwin', 'should report platform');
    assert.equal(result.arch, 'arm64', 'should report arch');
    assert.ok(Array.isArray(result.components), 'should have components array');
    assert.equal(result.overall, 'BLOCKED');
  } finally {
    tmp.cleanup();
  }
});

// 测试 19: 未知组件被拒绝
test('unknown component name is rejected', async () => {
  const tmp = createTempDir('unknown-component');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);

    assert.throws(
      () => mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['unknown-comp'], env: {} }),
      { message: /(?:unknown|invalid).*component/i }
    );
  } finally {
    tmp.cleanup();
  }
});

// 测试 20: check/plan/doctor 使用 CLI 时不修改文件
test('CLI check/plan/doctor do not modify plugin directory', () => {
  const tmp = createTempDir('cli-no-modify');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cliInPlugin = copyCliToPlugin(pluginRoot);

    const cacheDir = path.join(tmp.path, 'cli-cache');
    const beforeSnapshot = {
      pluginRoot: getPathSnapshot(pluginRoot),
      cacheDir: getPathSnapshot(cacheDir)
    };

    // 运行 check
    spawnSync(process.execPath, [cliInPlugin, 'check', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir }
    });

    // 运行 plan
    spawnSync(process.execPath, [cliInPlugin, 'plan', '--components', 'core', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir }
    });

    // 运行 doctor
    spawnSync(process.execPath, [cliInPlugin, 'doctor', '--json'], {
      cwd: tmp.path,
      env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir }
    });

    // 验证快照未变
    const afterSnapshot = {
      pluginRoot: getPathSnapshot(pluginRoot),
      cacheDir: getPathSnapshot(cacheDir)
    };
    assert.deepEqual(beforeSnapshot, afterSnapshot, 'plugin and cache trees must be byte-for-byte unchanged');
  } finally {
    tmp.cleanup();
  }
});

// 测试 21: 真实模块可加载（smoke test）
test('installed packages can be actually loaded', async () => {
  const tmp = createTempDir('smoke-load');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    // 创建真实的可加载模块
    const mockExecutor = async (componentDir, packages) => {
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
          name: pkg,
          version: version,
          main: 'index.js'
        }));
        // 创建可加载的入口（使用 ESM 或 CJS 取决于实际包）
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = { name: '${pkg}', version: '${version}' };`);
      }
    };

    await mod.installRuntime(plan, {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    });

    // 验证模块可实际加载，而非只检查 package.json
    const runtimeDir = path.join(cacheDir, 'runtimes', '1.0.0', 'core');
    const runtimeRequire = createRequire(path.join(runtimeDir, 'package.json'));
    assert.deepEqual(runtimeRequire('ajv'), { name: 'ajv', version: '8.20.0' });
  } finally {
    tmp.cleanup();
  }
});

// 测试 22: lock 文件 SHA 被记录
test('install records lock file SHA in state', async () => {
  const tmp = createTempDir('lock-sha');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    const mockExecutor = async (componentDir, packages) => {
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = {};`);
      }
    };

    await mod.installRuntime(plan, {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    });

    // 验证 state 中的 lock SHA
    const statePath = path.join(cacheDir, 'runtimes', '1.0.0', 'runtime-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    assert.equal(state.components.core.lock_sha256, plan.components[0].lock_sha256);
  } finally {
    tmp.cleanup();
  }
});

// 测试 23: executor 失败后清理临时目录
test('executor failure cleans up temp directory', async () => {
  const tmp = createTempDir('executor-fail-cleanup');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    const runtimesDir = path.join(cacheDir, 'runtimes', '1.0.0');

    // executor 抛出错误
    const failingExecutor = async () => {
      throw new Error('npm ci failed');
    };

    await assert.rejects(
      () => mod.installRuntime(plan, {
        acceptedPlanSha256: plan.plan_sha256,
        executeNpm: failingExecutor,
        now: () => new Date('2026-07-15T00:00:00Z'),
        processInfo: { nodeVersion: process.version, platform: process.platform }
      })
    );

    // 验证没有残留临时目录
    if (fs.existsSync(runtimesDir)) {
      const entries = fs.readdirSync(runtimesDir);
      const tempEntries = entries.filter(e => e.startsWith('.tmp-') || e.startsWith('temp-'));
      assert.equal(tempEntries.length, 0, 'should not have temp directories after failure');
    }
    assert.equal(fs.existsSync(path.join(cacheDir, 'locks', 'runtime-1.0.0.lock')), false, 'install lock must be removed after failure');
  } finally {
    tmp.cleanup();
  }
});

// 测试 24: 增量安装 optional 组件
test('incremental install adds only missing optional component', async () => {
  const tmp = createTempDir('incremental-install');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);

    // 先安装 core
    const corePlan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    let executorCalls = [];
    const mockExecutor = async (componentDir, packages) => {
      executorCalls.push(Object.keys(packages).sort().join(','));
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = {};`);
      }
    };

    await mod.installRuntime(corePlan, {
      acceptedPlanSha256: corePlan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    });

    assert.deepEqual(executorCalls, ['ajv,fast-xml-parser,yaml'], 'first install should install the core package set');

    // 安装 core + pdf
    const fullPlan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core', 'pdf'], env: {} });
    executorCalls = [];

    await mod.installRuntime(fullPlan, {
      acceptedPlanSha256: fullPlan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    });

    // 应该只调用 pdf（core 已 READY）
    assert.deepEqual(executorCalls, ['pdfjs-dist'], 'incremental install should only install the pdf package set');
  } finally {
    tmp.cleanup();
  }
});

test('incremental install preserves READY components outside the new plan', async () => {
  const tmp = createTempDir('incremental-preserves-state');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');
    const mod = await import(LIB_PATH);
    const mockExecutor = async (componentDir, packages) => createFakePackages(componentDir, packages);
    const options = plan => ({
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: process.platform, arch: process.arch }
    });
    const firstPlan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core', 'docx'], env: {} });
    await mod.installRuntime(firstPlan, options(firstPlan));
    const secondPlan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core', 'pdf'], env: {} });
    await mod.installRuntime(secondPlan, options(secondPlan));

    const state = JSON.parse(fs.readFileSync(path.join(cacheDir, 'runtimes', '1.0.0', 'runtime-state.json'), 'utf8'));
    assert.deepEqual(Object.keys(state.components).sort(), ['core', 'docx', 'pdf']);
  } finally {
    tmp.cleanup();
  }
});

test('matching lock is not reused when smoke validation fails', async () => {
  const tmp = createTempDir('reuse-requires-smoke');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');
    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });
    let executorCallCount = 0;
    const executeNpm = async (componentDir, packages) => {
      executorCallCount += 1;
      createFakePackages(componentDir, packages);
    };
    const options = {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: process.platform, arch: process.arch }
    };
    await mod.installRuntime(plan, options);
    fs.writeFileSync(path.join(cacheDir, 'runtimes', '1.0.0', 'core', 'node_modules', 'ajv', 'index.js'), 'throw new Error("corrupt smoke")');
    await mod.installRuntime(plan, options);
    assert.equal(executorCallCount, 2, 'corrupt component must be reinstalled even when lock SHA matches');
  } finally {
    tmp.cleanup();
  }
});

test('failed reinstall after smoke corruption preserves the previous target and state', async () => {
  const tmp = createTempDir('failed-reinstall-preserves-old');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');
    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });
    const successOptions = {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: async (componentDir, packages) => createFakePackages(componentDir, packages),
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: process.platform, arch: process.arch }
    };
    await mod.installRuntime(plan, successOptions);
    const versionDir = path.join(cacheDir, 'runtimes', '1.0.0');
    const targetDir = path.join(versionDir, 'core');
    const statePath = path.join(versionDir, 'runtime-state.json');
    fs.writeFileSync(path.join(targetDir, 'node_modules', 'ajv', 'index.js'), 'throw new Error("corrupt smoke")');
    const before = { target: getPathSnapshot(targetDir), state: getPathSnapshot(statePath) };

    await assert.rejects(() => mod.installRuntime(plan, {
      ...successOptions,
      executeNpm: async () => { throw new Error('simulated npm failure'); }
    }), /simulated npm failure/);

    assert.deepEqual({ target: getPathSnapshot(targetDir), state: getPathSnapshot(statePath) }, before);
    assert.deepEqual(fs.readdirSync(versionDir).filter(name => name.startsWith('.tmp-') || name.startsWith('.backup-')), []);
  } finally {
    tmp.cleanup();
  }
});

test('state write failure rolls back every newly published target', async () => {
  const tmp = createTempDir('state-write-rollback');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');
    const mod = await import(LIB_PATH);
    const firstPlan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });
    const common = {
      executeNpm: async (componentDir, packages) => createFakePackages(componentDir, packages),
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: process.platform, arch: process.arch }
    };
    await mod.installRuntime(firstPlan, { ...common, acceptedPlanSha256: firstPlan.plan_sha256 });
    const versionDir = path.join(cacheDir, 'runtimes', '1.0.0');
    const targetDir = path.join(versionDir, 'core');
    const statePath = path.join(versionDir, 'runtime-state.json');
    const before = { target: getPathSnapshot(targetDir), state: getPathSnapshot(statePath) };

    fs.appendFileSync(path.join(pluginRoot, 'runtime', 'components', 'core', 'package-lock.json'), '\n');
    const replacementPlan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function injectedWriteFailure(filePath, ...args) {
      if (String(filePath).includes('.tmp-state-')) throw new Error('simulated state write failure');
      return originalWriteFileSync.call(this, filePath, ...args);
    };
    try {
      await assert.rejects(() => mod.installRuntime(replacementPlan, {
        ...common,
        acceptedPlanSha256: replacementPlan.plan_sha256
      }), /simulated state write failure/);
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }

    assert.deepEqual({ target: getPathSnapshot(targetDir), state: getPathSnapshot(statePath) }, before);
    assert.deepEqual(fs.readdirSync(versionDir).filter(name => name.startsWith('.tmp-') || name.startsWith('.backup-')), []);
  } finally {
    tmp.cleanup();
  }
});

test('plugin-local READY packages take precedence over a corrupt cache', async () => {
  const tmp = createTempDir('local-before-cache');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'runtime', 'manifest.json'), 'utf8'));
    for (const component of manifest.components) createFakePackages(pluginRoot, component.packages);
    const cacheDir = path.join(tmp.path, 'cache');
    const versionDir = path.join(cacheDir, 'runtimes', '1.0.0');
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, 'runtime-state.json'), '{ corrupt json }');

    const mod = await import(LIB_PATH);
    const result = mod.checkRuntime({ pluginRoot, cacheDir, env: {} });
    assert.equal(result.overall, 'READY');
    assert.deepEqual(result.components.map(component => component.source), ['plugin', 'plugin', 'plugin', 'plugin']);
  } finally {
    tmp.cleanup();
  }
});

// 测试 25: 凭据脱敏
test('plan does not leak credentials from environment', async () => {
  const tmp = createTempDir('credential-sanitize');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);

    // 带凭据的环境
    const envWithCreds = {
      npm_config_registry: 'https://user:password@registry.example.com/',
      NPM_TOKEN: 'secret-token-12345'
    };

    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: envWithCreds });
    const planStr = JSON.stringify(plan);

    // 验证不包含敏感信息
    assert.ok(!planStr.includes('password'), 'plan should not contain password');
    assert.ok(!planStr.includes('secret-token'), 'plan should not contain token');
    assert.ok(!planStr.includes('user:password'), 'plan should not contain credentials in URL');
  } finally {
    tmp.cleanup();
  }
});

// 测试 26: 越界路径拒绝
test('path traversal component name is rejected', async () => {
  const tmp = createTempDir('path-containment');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);

    assert.throws(
      () => mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['../core'], env: {} }),
      { message: /unknown|component|invalid|containment/i }
    );
  } finally {
    tmp.cleanup();
  }
});

// 测试 27: 缺失 lock 文件被拒绝
test('missing lock file is rejected', async () => {
  const tmp = createTempDir('missing-lock');
  try {
    const pluginRoot = createPluginFixture(tmp.path);

    // 删除 core 的 lock 文件
    const lockPath = path.join(pluginRoot, 'runtime', 'components', 'core', 'package-lock.json');
    fs.unlinkSync(lockPath);

    const cacheDir = path.join(tmp.path, 'cache');
    const mod = await import(LIB_PATH);

    assert.throws(
      () => mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} }),
      { message: /lock.*missing|missing.*lock/i }
    );
  } finally {
    tmp.cleanup();
  }
});

// 测试 28: 损坏的 state 文件被拒绝
test('corrupted state file is rejected', async () => {
  const tmp = createTempDir('corrupted-state');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');

    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });

    // 先安装
    const mockExecutor = async (componentDir, packages) => {
      const nmDir = path.join(componentDir, 'node_modules');
      fs.mkdirSync(nmDir, { recursive: true });
      for (const [pkg, version] of Object.entries(packages)) {
        const pkgDir = path.join(nmDir, pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
        fs.writeFileSync(path.join(pkgDir, 'index.js'), `module.exports = {};`);
      }
    };

    await mod.installRuntime(plan, {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: mockExecutor,
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, platform: process.platform }
    });

    // 损坏 state 文件
    const statePath = path.join(cacheDir, 'runtimes', '1.0.0', 'runtime-state.json');
    fs.writeFileSync(statePath, '{ invalid json }');

    // 检查应报告损坏
    const checkResult = mod.checkRuntime({ pluginRoot, cacheDir, env: {} });
    assert.equal(checkResult.overall, 'BLOCKED');
    assert.equal(checkResult.components.find(component => component.name === 'core').status, 'CORRUPT');
  } finally {
    tmp.cleanup();
  }
});

test('install recovers atomically from corrupt state with an existing component directory', async () => {
  const tmp = createTempDir('recover-corrupt-state');
  try {
    const pluginRoot = createPluginFixture(tmp.path);
    const cacheDir = path.join(tmp.path, 'cache');
    const mod = await import(LIB_PATH);
    const plan = mod.buildInstallPlan({ pluginRoot, cacheDir, components: ['core'], env: {} });
    let executorCallCount = 0;
    const options = {
      acceptedPlanSha256: plan.plan_sha256,
      executeNpm: async (componentDir, packages) => {
        executorCallCount += 1;
        createFakePackages(componentDir, packages);
      },
      now: () => new Date('2026-07-15T00:00:00Z'),
      processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: process.platform, arch: process.arch }
    };
    await mod.installRuntime(plan, options);
    const versionDir = path.join(cacheDir, 'runtimes', '1.0.0');
    fs.writeFileSync(path.join(versionDir, 'runtime-state.json'), '{ corrupt json }');

    const recovered = await mod.installRuntime(plan, options);
    assert.equal(executorCallCount, 2);
    assert.equal(recovered.overall, 'DEGRADED');
    assert.equal(JSON.parse(fs.readFileSync(path.join(versionDir, 'runtime-state.json'), 'utf8')).components.core.status, 'READY');
    assert.deepEqual(fs.readdirSync(versionDir).filter(name => name.startsWith('.tmp-') || name.startsWith('.backup-')), []);
  } finally {
    tmp.cleanup();
  }
});
