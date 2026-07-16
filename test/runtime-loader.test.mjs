/**
 * Runtime Loader 单元行为测试
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
  createDeterministicExecutor,
} from './helpers/runtime-loader-fixture.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// 行为 1: 默认 pluginRoot 来自 loader URL，不依赖 process.cwd()
// ═══════════════════════════════════════════════════════════════════════════

test('从不同 cwd import 隔离 loader，仅通过 FLOW_ARCHITECT_CACHE_DIR 加载 READY core', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-pluginroot-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  // 从一个完全不同的 cwd 调用 loader 子进程
  const otherCwd = path.join(tmpDir, 'arbitrary-cwd');
  fs.mkdirSync(otherCwd, { recursive: true });

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      const pkg = loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ ok: true, name: pkg?.name || pkg?.XMLParser ? 'fast-xml-parser' : typeof pkg }));
      process.exit(0);
    } catch (e) {
      console.log(JSON.stringify({ ok: false, code: e.code, message: e.message }));
      process.exit(1);
    }
    `,
  ], {
    cwd: otherCwd,
    env: {
      ...process.env,
      FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir,
      // 清除 NODE_PATH 等可能泄漏的变量
      NODE_PATH: '',
    },
    shell: false,
  });

  const stdout = result.stdout?.toString() || '';
  const stderr = result.stderr?.toString() || '';

  assert.equal(result.status, 0, `loader 应该能从不同 cwd 加载 core: ${stderr}`);
  const output = JSON.parse(stdout);
  assert.equal(output.ok, true, `loader 应该成功加载 fast-xml-parser: ${JSON.stringify(output)}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 2: 插件本地精确版本优先于损坏缓存
// ═══════════════════════════════════════════════════════════════════════════

test('插件本地精确版本优先于损坏缓存', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-local-priority-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  // 安装 core 到缓存
  await installReadyCache(pluginRoot, cacheDir, ['core']);

  // 损坏缓存中的 core 包
  const coreNmDir = path.join(cacheDir, 'runtimes', '2.0.0', 'core', 'node_modules', 'fast-xml-parser');
  if (fs.existsSync(coreNmDir)) {
    fs.writeFileSync(path.join(coreNmDir, 'index.js'), 'throw new Error("corrupted")');
  }

  // 在插件本地安装可用的 fast-xml-parser
  const localNmDir = path.join(pluginRoot, 'node_modules', 'fast-xml-parser');
  fs.mkdirSync(localNmDir, { recursive: true });
  fs.writeFileSync(path.join(localNmDir, 'package.json'), JSON.stringify({
    name: 'fast-xml-parser',
    version: '4.5.7',
    main: 'index.js',
  }));
  fs.writeFileSync(path.join(localNmDir, 'index.js'), `
    class XMLParser { parse(xml) { return { local: true }; } }
    module.exports = { XMLParser };
  `);

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const pkg = loader.requireRuntimePackage('core', 'fast-xml-parser');
    const parser = new pkg.XMLParser();
    const result = parser.parse('<test/>');
    console.log(JSON.stringify(result));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `应该从本地加载: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.local, true, '应该加载本地版本而非损坏缓存');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 3: 无本地依赖时从 manager 验证过的缓存加载
// ═══════════════════════════════════════════════════════════════════════════

test('无本地依赖时从 manager 验证过的缓存加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-cache-load-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  // 验证插件目录没有 node_modules
  const pluginNm = path.join(fixture.pluginRoot, 'node_modules');
  assert.ok(!fs.existsSync(pluginNm), '隔离插件不应有 node_modules');

  // 从缓存加载 ajv
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    const Ajv = loader.requireRuntimePackage('core', 'ajv/dist/2020.js');
    const ajv = new Ajv();
    const validate = ajv.compile({ type: 'object' });
    console.log(JSON.stringify({ ok: typeof validate === 'function' }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `应该从缓存加载 ajv: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.ok, true, 'ajv 应该可从缓存加载并使用');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 4: 错误场景 - 未知组件、未声明包、错版本、损坏 state、错 lock、损坏入口
// ═══════════════════════════════════════════════════════════════════════════

test('未知组件抛 FLOW_ARCHITECT_RUNTIME_MISSING', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-unknown-comp-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      loader.requireRuntimePackage('nonexistent', 'some-pkg');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
        setup_commands: e.setup_commands,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '应该抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(err.component, 'nonexistent');
  assert.equal(err.specifier, 'some-pkg');
  assert.ok(Array.isArray(err.setup_commands), 'setup_commands 应为数组');
  assert.ok(err.setup_commands.length >= 2, '应包含至少两个平台的 setup 命令');
});

test('组件中未声明的 specifier 抛 FLOW_ARCHITECT_RUNTIME_MISSING', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-undeclared-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'lodash');
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
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '应该抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(err.component, 'core');
  assert.equal(err.specifier, 'lodash');
});

test('损坏的 state 文件导致缓存不被加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-corrupt-state-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  // 损坏 state 文件
  const statePath = path.join(fixture.cacheDir, 'runtimes', '2.0.0', 'runtime-state.json');
  fs.writeFileSync(statePath, '{ invalid json !!!');

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '损坏 state 应该导致加载失败');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
});

test('错误的 lock SHA 导致缓存不被加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-wrong-lock-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  // 修改 state 中的 lock SHA
  const statePath = path.join(fixture.cacheDir, 'runtimes', '2.0.0', 'runtime-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.components.core.lock_sha256 = 'wrong-sha-' + '0'.repeat(54);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '错误 lock SHA 应该导致加载失败');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
});

test('损坏的入口文件导致缓存不被加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-corrupt-entry-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  // 损坏 fast-xml-parser 入口
  const entryPath = path.join(fixture.cacheDir, 'runtimes', '2.0.0', 'core', 'node_modules', 'fast-xml-parser', 'index.js');
  if (fs.existsSync(entryPath)) {
    fs.writeFileSync(entryPath, 'throw new Error("entry corrupted")');
  }

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
        hasCause: !!e.cause,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '损坏入口应该导致加载失败');
  // 注意：损坏入口可能是 RuntimeCapabilityError 或原始错误，取决于实现
  // 但不应悄悄返回 undefined
});

test('错误版本的包不被加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-wrong-version-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  // 修改缓存中 fast-xml-parser 的 package.json 版本
  const pkgJsonPath = path.join(fixture.cacheDir, 'runtimes', '2.0.0', 'core', 'node_modules', 'fast-xml-parser', 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    pkg.version = '999.0.0'; // 错误版本
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg));
  }

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '错误版本应该导致加载失败');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 5: 错误精确断言 name/code/component/specifier/setup_commands/cause
// ═══════════════════════════════════════════════════════════════════════════

test('RuntimeCapabilityError 结构完整：name/code/component/specifier/setup_commands', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-error-struct-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});

    // 测试 1: 未知组件
    try {
      loader.requireRuntimePackage('unknown', 'pkg');
      process.exit(1);
    } catch (e) {
      const report = {
        name: e.name,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
        setup_commands: e.setup_commands,
        is_error: e instanceof Error,
        has_message: typeof e.message === 'string' && e.message.length > 0,
      };
      console.log(JSON.stringify(report));
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const report = JSON.parse(result.stdout.toString());

  assert.equal(report.is_error, true, '应该是 Error 实例');
  assert.equal(report.has_message, true, '应该有非空 message');
  assert.equal(report.code, 'FLOW_ARCHITECT_RUNTIME_MISSING', 'code 应为 FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(report.component, 'unknown', 'component 应为调用值');
  assert.equal(report.specifier, 'pkg', 'specifier 应为调用值');
  assert.ok(Array.isArray(report.setup_commands), 'setup_commands 应为数组');
  assert.ok(report.setup_commands.length >= 2, '应包含至少两个平台的 setup 命令');

  // 验证 setup_commands 包含两个平台的命令
  const commandsStr = report.setup_commands.join(' ');
  assert.ok(
    commandsStr.includes('setup') || commandsStr.includes('flow-architect'),
    'setup_commands 应包含 setup 相关命令'
  );
});

test('底层异常时 cause 被保留', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-error-cause-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'empty-cache');
  const packageDir = path.join(pluginRoot, 'node_modules', 'fast-xml-parser');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: 'fast-xml-parser',
    version: '4.5.7',
    main: 'index.js',
    type: 'commonjs',
  }));
  fs.writeFileSync(path.join(packageDir, 'index.js'),
    'throw new Error("fixture package execution failure")');
  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        code: e.code,
        has_cause: e.cause !== undefined && e.cause !== null,
        cause_message: e.cause?.message,
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
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING', '应包装为结构化能力错误');
  assert.equal(err.has_cause, true, '已定位包的执行异常必须保留 cause');
  assert.equal(err.cause_message, 'fixture package execution failure');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 6: 同步 requireRuntimePackage 与异步 importRuntimePackage 均覆盖
// ═══════════════════════════════════════════════════════════════════════════

test('同步 requireRuntimePackage 加载 core 包', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-sync-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});

    // 同步 API
    const xmlPkg = loader.requireRuntimePackage('core', 'fast-xml-parser');
    const ajvPkg = loader.requireRuntimePackage('core', 'ajv/dist/2020.js');

    console.log(JSON.stringify({
      xml_ok: typeof xmlPkg.XMLParser === 'function',
      ajv_ok: typeof ajvPkg === 'function',
    }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `同步 API 应成功: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.xml_ok, true, 'fast-xml-parser 应导出 XMLParser');
  assert.equal(output.ajv_ok, true, 'ajv/dist/2020.js 应可构造');
});

test('异步 importRuntimePackage 加载 core 包', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-async-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});

    // 异步 API
    const xmlPkg = await loader.importRuntimePackage('core', 'fast-xml-parser');
    const ajvPkg = await loader.importRuntimePackage('core', 'ajv/dist/2020.js');

    console.log(JSON.stringify({
      xml_ok: typeof xmlPkg.XMLParser === 'function',
      ajv_ok: typeof ajvPkg === 'function',
    }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `异步 API 应成功: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.xml_ok, true, 'fast-xml-parser 应导出 XMLParser');
  assert.equal(output.ajv_ok, true, 'ajv/dist/2020.js 应可构造');
});

test('同步和异步 API 对同一包返回等价结果', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-sync-async-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});

    const syncPkg = loader.requireRuntimePackage('core', 'fast-xml-parser');
    const asyncPkg = await loader.importRuntimePackage('core', 'fast-xml-parser');

    // 两者都应有 XMLParser
    console.log(JSON.stringify({
      sync_has_parser: typeof syncPkg.XMLParser === 'function',
      async_has_parser: typeof asyncPkg.XMLParser === 'function',
    }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `同步和异步 API 应一致: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.sync_has_parser, true, '同步 API 应有 XMLParser');
  assert.equal(output.async_has_parser, true, '异步 API 应有 XMLParser');
});

test('异步 API 对未知组件也抛 FLOW_ARCHITECT_RUNTIME_MISSING', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-async-error-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });
  t.after(() => fixture.cleanup?.());

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(fixture.loaderUrl)});
    try {
      await loader.importRuntimePackage('unknown', 'some-pkg');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        component: e.component,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());
  assert.equal(err.threw, true, '异步 API 也应该抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(err.component, 'unknown');
});
