/**
 * DrawingML Runtime 隔离测试
 *
 * 黑盒行为合同：只测试可观察行为，不读取实现源码。
 * READY 缓存由 runtime manager 的 buildInstallPlan + installRuntime 生成。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  createIsolatedPlugin,
  installReadyCache,
  createLoaderFixture,
} from './helpers/runtime-loader-fixture.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// 行为 1: buildInstallPlan 的 xlsx component 精确投影
// ═══════════════════════════════════════════════════════════════════════════

test('xlsx component 安装计划精确投影为 {exceljs:"4.4.0",jszip:"3.10.1"}', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-plan-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);

  // 动态导入隔离副本的 manager
  const managerPath = path.join(pluginRoot, 'scripts', 'lib', 'runtime-manager.mjs');
  const managerUrl = pathToFileURL(managerPath).href;
  const manager = await import(managerUrl);

  const plan = manager.buildInstallPlan({
    pluginRoot,
    cacheDir: path.join(tmpDir, 'cache'),
    components: ['core', 'xlsx'],
    env: {},
  });

  // 精确断言 xlsx component 的 packages
  const xlsxPlan = plan.components.find(c => c.name === 'xlsx');
  assert.notEqual(xlsxPlan, undefined, 'xlsx component 应在 plan 中');
  assert.deepEqual(xlsxPlan.packages, { exceljs: '4.4.0', jszip: '3.10.1' });
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 2: 隔离 loader 从任意 cwd 真实调用 core/xlsx 包
// ═══════════════════════════════════════════════════════════════════════════

test('隔离 loader 从任意 cwd 加载 core 和 xlsx 包，pluginRoot 无 node_modules', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-isolation-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core', 'xlsx'] });

  // 验证隔离插件目录没有 node_modules
  const pluginNm = path.join(fixture.pluginRoot, 'node_modules');
  assert.equal(fs.existsSync(pluginNm), false, '隔离插件不应有 node_modules');

  // 从一个完全不同的 cwd 调用 loader 子进程
  const otherCwd = path.join(tmpDir, 'arbitrary-cwd');
  fs.mkdirSync(otherCwd, { recursive: true });

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});

    // 加载 core 包
    const xmlPkg = loader.requireRuntimePackage('core', 'fast-xml-parser');
    const parser = new xmlPkg.XMLParser();
    const xmlResult = parser.parse('<test/>');

    // 加载 xlsx 包
    const jszipPkg = loader.requireRuntimePackage('xlsx', 'jszip');

    console.log(JSON.stringify({
      xml_ok: typeof parser === 'object',
      jszip_name: jszipPkg.name,
      jszip_version: jszipPkg.version,
    }));
    `,
  ], {
    cwd: otherCwd,
    env: {
      ...process.env,
      FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir,
      NODE_PATH: '',
    },
    shell: false,
  });

  assert.equal(result.status, 0, `loader 应能从不同 cwd 加载: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.xml_ok, true);
  assert.deepEqual(output, {
    xml_ok: true,
    jszip_name: 'jszip',
    jszip_version: '3.10.1',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 3: 未声明的 specifier 抛精确结构化错误
// ═══════════════════════════════════════════════════════════════════════════

test('xlsx 中未声明的 specifier 抛精确结构化错误 {code,component,specifier}', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-undeclared-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  // 安装 xlsx 缓存
  await installReadyCache(pluginRoot, cacheDir, ['core', 'xlsx']);

  // 从 manifest 中删除 xlsx.packages.jszip
  const manifestPath = path.join(pluginRoot, 'runtime', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const xlsxComponent = manifest.components.find(c => c.name === 'xlsx');
  delete xlsxComponent.packages.jszip;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('xlsx', 'jszip');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true);
  assert.deepEqual(err, {
    threw: true,
    code: 'FLOW_ARCHITECT_RUNTIME_MISSING',
    component: 'xlsx',
    specifier: 'jszip',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 4: 模块缺失时抛精确结构化错误
// ═══════════════════════════════════════════════════════════════════════════

test('xlsx cache 中删除 jszip 后调用抛精确结构化错误', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-missing-module-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  // 安装 xlsx 缓存
  await installReadyCache(pluginRoot, cacheDir, ['core', 'xlsx']);

  // 删除 cache 中 xlsx/node_modules/jszip
  const jszipDir = path.join(cacheDir, 'runtimes', '2.0.0', 'xlsx', 'node_modules', 'jszip');
  if (fs.existsSync(jszipDir)) {
    fs.rmSync(jszipDir, { recursive: true, force: true });
  }

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('xlsx', 'jszip');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true);
  assert.deepEqual(err, {
    threw: true,
    code: 'FLOW_ARCHITECT_RUNTIME_MISSING',
    component: 'xlsx',
    specifier: 'jszip',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 5: 版本错误时抛精确结构化错误
// ═══════════════════════════════════════════════════════════════════════════

test('xlsx cache 中 jszip 版本错误时调用抛精确结构化错误', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-wrong-version-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  // 安装 xlsx 缓存
  await installReadyCache(pluginRoot, cacheDir, ['core', 'xlsx']);

  // 修改 cache 中 jszip package.json 版本为错误值
  const jszipPkgPath = path.join(cacheDir, 'runtimes', '2.0.0', 'xlsx', 'node_modules', 'jszip', 'package.json');
  if (fs.existsSync(jszipPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(jszipPkgPath, 'utf8'));
    pkg.version = '999.0.0';
    fs.writeFileSync(jszipPkgPath, JSON.stringify(pkg, null, 2));
  }

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('xlsx', 'jszip');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true);
  assert.deepEqual(err, {
    threw: true,
    code: 'FLOW_ARCHITECT_RUNTIME_MISSING',
    component: 'xlsx',
    specifier: 'jszip',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 6: lock 损坏时抛精确结构化错误
// ═══════════════════════════════════════════════════════════════════════════

test('xlsx lock 损坏时调用抛精确结构化错误', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-corrupt-lock-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  // 安装 xlsx 缓存
  await installReadyCache(pluginRoot, cacheDir, ['core', 'xlsx']);

  // 修改 state 中 xlsx 的 lock SHA
  const statePath = path.join(cacheDir, 'runtimes', '2.0.0', 'runtime-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.components.xlsx.lock_sha256 = 'wrong-sha-' + '0'.repeat(54);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('xlsx', 'jszip');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true);
  assert.deepEqual(err, {
    threw: true,
    code: 'FLOW_ARCHITECT_RUNTIME_MISSING',
    component: 'xlsx',
    specifier: 'jszip',
  });
});
