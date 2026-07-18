/**
 * Runtime Loader Cache-Only 行为测试
 *
 * 验证 cache-only 模式下：
 * 1. 空缓存时返回 FLOW_ARCHITECT_RUNTIME_MISSING
 * 2. 即使插件根存在精确版本本地包也拒绝加载
 * 3. 输出不含 ERR_MODULE_NOT_FOUND
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
// 行为 1: 空缓存时返回 FLOW_ARCHITECT_RUNTIME_MISSING（同步 require）
// ═══════════════════════════════════════════════════════════════════════════

test('空缓存时同步 requireRuntimePackage 返回 FLOW_ARCHITECT_RUNTIME_MISSING', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-cache-only-require-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 创建隔离插件，但不安装缓存
  const pluginRoot = createIsolatedPlugin(tmpDir);
  const emptyCacheDir = path.join(tmpDir, 'empty-cache');
  fs.mkdirSync(emptyCacheDir, { recursive: true });

  // 在插件根创建精确版本本地包
  const localNmDir = path.join(pluginRoot, 'node_modules', 'fast-xml-parser');
  fs.mkdirSync(localNmDir, { recursive: true });
  fs.writeFileSync(path.join(localNmDir, 'package.json'), JSON.stringify({
    name: 'fast-xml-parser',
    version: '4.5.7',
    main: 'index.js',
    type: 'commonjs',
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
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
        message: e.message,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: emptyCacheDir, NODE_PATH: '' },
    shell: false,
  });

  const stdout = result.stdout?.toString() || '';
  const stderr = result.stderr?.toString() || '';

  // 验证进程正常退出
  assert.equal(result.status, 0, `进程应正常退出: ${stderr}`);

  // 验证输出不含 ERR_MODULE_NOT_FOUND
  assert.ok(!stdout.includes('ERR_MODULE_NOT_FOUND'), `输出不应包含 ERR_MODULE_NOT_FOUND: ${stdout}`);
  assert.ok(!stderr.includes('ERR_MODULE_NOT_FOUND'), `stderr 不应包含 ERR_MODULE_NOT_FOUND: ${stderr}`);

  // 验证抛出正确的错误
  const err = JSON.parse(stdout);
  assert.equal(err.threw, true, '应该抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(err.component, 'core');
  assert.equal(err.specifier, 'fast-xml-parser');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 2: 空缓存时返回 FLOW_ARCHITECT_RUNTIME_MISSING（异步 import）
// ═══════════════════════════════════════════════════════════════════════════

test('空缓存时异步 importRuntimePackage 返回 FLOW_ARCHITECT_RUNTIME_MISSING', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-cache-only-import-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 创建隔离插件，但不安装缓存
  const pluginRoot = createIsolatedPlugin(tmpDir);
  const emptyCacheDir = path.join(tmpDir, 'empty-cache');
  fs.mkdirSync(emptyCacheDir, { recursive: true });

  // 在插件根创建精确版本本地包
  const localNmDir = path.join(pluginRoot, 'node_modules', 'fast-xml-parser');
  fs.mkdirSync(localNmDir, { recursive: true });
  fs.writeFileSync(path.join(localNmDir, 'package.json'), JSON.stringify({
    name: 'fast-xml-parser',
    version: '4.5.7',
    main: 'index.js',
    type: 'commonjs',
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
    try {
      await loader.importRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
        message: e.message,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: emptyCacheDir, NODE_PATH: '' },
    shell: false,
  });

  const stdout = result.stdout?.toString() || '';
  const stderr = result.stderr?.toString() || '';

  // 验证进程正常退出
  assert.equal(result.status, 0, `进程应正常退出: ${stderr}`);

  // 验证输出不含 ERR_MODULE_NOT_FOUND
  assert.ok(!stdout.includes('ERR_MODULE_NOT_FOUND'), `输出不应包含 ERR_MODULE_NOT_FOUND: ${stdout}`);
  assert.ok(!stderr.includes('ERR_MODULE_NOT_FOUND'), `stderr 不应包含 ERR_MODULE_NOT_FOUND: ${stderr}`);

  // 验证抛出正确的错误
  const err = JSON.parse(stdout);
  assert.equal(err.threw, true, '应该抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(err.component, 'core');
  assert.equal(err.specifier, 'fast-xml-parser');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 3: 插件根存在精确版本本地包但缓存损坏时，拒绝本地包
// ═══════════════════════════════════════════════════════════════════════════

test('插件根存在精确版本本地包但缓存损坏时，拒绝本地包并返回 FLOW_ARCHITECT_RUNTIME_MISSING', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-cache-only-corrupt-'));
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
    type: 'commonjs',
  }));
  fs.writeFileSync(path.join(localNmDir, 'index.js'), `
    class XMLParser { parse(xml) { return { local: true }; } }
    module.exports = { XMLParser };
  `);

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  // 测试同步 require
  const requireResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
        message: e.message,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  const requireStdout = requireResult.stdout?.toString() || '';
  const requireStderr = requireResult.stderr?.toString() || '';

  // 验证进程正常退出
  assert.equal(requireResult.status, 0, `同步 require 进程应正常退出: ${requireStderr}`);

  // 验证输出不含 ERR_MODULE_NOT_FOUND
  assert.ok(!requireStdout.includes('ERR_MODULE_NOT_FOUND'), `同步 require 输出不应包含 ERR_MODULE_NOT_FOUND: ${requireStdout}`);
  assert.ok(!requireStderr.includes('ERR_MODULE_NOT_FOUND'), `同步 require stderr 不应包含 ERR_MODULE_NOT_FOUND: ${requireStderr}`);

  // 验证抛出正确的错误
  const requireErr = JSON.parse(requireStdout);
  assert.equal(requireErr.threw, true, '同步 require 应该抛出异常');
  assert.equal(requireErr.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(requireErr.component, 'core');
  assert.equal(requireErr.specifier, 'fast-xml-parser');

  // 测试异步 import
  const importResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      await loader.importRuntimePackage('core', 'fast-xml-parser');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
        component: e.component,
        specifier: e.specifier,
        message: e.message,
      }));
      process.exit(0);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  const importStdout = importResult.stdout?.toString() || '';
  const importStderr = importResult.stderr?.toString() || '';

  // 验证进程正常退出
  assert.equal(importResult.status, 0, `异步 import 进程应正常退出: ${importStderr}`);

  // 验证输出不含 ERR_MODULE_NOT_FOUND
  assert.ok(!importStdout.includes('ERR_MODULE_NOT_FOUND'), `异步 import 输出不应包含 ERR_MODULE_NOT_FOUND: ${importStdout}`);
  assert.ok(!importStderr.includes('ERR_MODULE_NOT_FOUND'), `异步 import stderr 不应包含 ERR_MODULE_NOT_FOUND: ${importStderr}`);

  // 验证抛出正确的错误
  const importErr = JSON.parse(importStdout);
  assert.equal(importErr.threw, true, '异步 import 应该抛出异常');
  assert.equal(importErr.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(importErr.component, 'core');
  assert.equal(importErr.specifier, 'fast-xml-parser');
});

// ═══════════════════════════════════════════════════════════════════════════
// 行为 4: 缓存正常时，即使插件根存在本地包，也从缓存加载
// ═══════════════════════════════════════════════════════════════════════════

test('缓存正常时，即使插件根存在本地包，也从缓存加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-cache-only-normal-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  // 安装 core 到缓存
  await installReadyCache(pluginRoot, cacheDir, ['core']);

  // 在插件本地安装可用的 fast-xml-parser
  const localNmDir = path.join(pluginRoot, 'node_modules', 'fast-xml-parser');
  fs.mkdirSync(localNmDir, { recursive: true });
  fs.writeFileSync(path.join(localNmDir, 'package.json'), JSON.stringify({
    name: 'fast-xml-parser',
    version: '4.5.7',
    main: 'index.js',
    type: 'commonjs',
  }));
  fs.writeFileSync(path.join(localNmDir, 'index.js'), `
    class XMLParser { parse(xml) { return { local: true, marker: 'LOCAL_PACKAGE' }; } }
    module.exports = { XMLParser };
  `);

  const loaderUrl = pathToFileURL(path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  // 测试同步 require
  const requireResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const pkg = loader.requireRuntimePackage('core', 'fast-xml-parser');
    const parser = new pkg.XMLParser();
    const result = parser.parse('<test/>');
    console.log(JSON.stringify({ fromCache: !result.local, marker: result.marker || 'none' }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  const requireStdout = requireResult.stdout?.toString() || '';
  const requireStderr = requireResult.stderr?.toString() || '';

  // 验证进程正常退出
  assert.equal(requireResult.status, 0, `同步 require 进程应正常退出: ${requireStderr}`);

  // 验证从缓存加载（不包含 LOCAL_PACKAGE 标记）
  const requireOutput = JSON.parse(requireStdout);
  assert.equal(requireOutput.fromCache, true, '应该从缓存加载，而非本地包');
  assert.notEqual(requireOutput.marker, 'LOCAL_PACKAGE', '不应加载本地包');

  // 测试异步 import
  const importResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const pkg = await loader.importRuntimePackage('core', 'fast-xml-parser');
    const parser = new pkg.XMLParser();
    const result = parser.parse('<test/>');
    console.log(JSON.stringify({ fromCache: !result.local, marker: result.marker || 'none' }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  const importStdout = importResult.stdout?.toString() || '';
  const importStderr = importResult.stderr?.toString() || '';

  // 验证进程正常退出
  assert.equal(importResult.status, 0, `异步 import 进程应正常退出: ${importStderr}`);

  // 验证从缓存加载（不包含 LOCAL_PACKAGE 标记）
  const importOutput = JSON.parse(importStdout);
  assert.equal(importOutput.fromCache, true, '应该从缓存加载，而非本地包');
  assert.notEqual(importOutput.marker, 'LOCAL_PACKAGE', '不应加载本地包');
});
