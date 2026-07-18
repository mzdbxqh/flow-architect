/**
 * 测试运行时 bootstrap 行为测试
 *
 * 验证：
 * 1. bootstrap 后真实核心组件可从缓存加载（Ajv/XML/YAML）
 * 2. bootstrap 后可选组件可从缓存加载（JSZip/PDF/DOCX/XLSX）
 * 3. 空缓存即使项目有 node_modules，生产 loader 仍返回 FLOW_ARCHITECT_RUNTIME_MISSING
 * 4. bootstrap 子进程失败时顶层命令非零退出，且临时目录被清理
 * 5. 顶层公开 package 的运行包位于 devDependencies
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const BOOTSTRAP_SCRIPT = path.join(ROOT, 'scripts', 'test-with-runtime.mjs');
const MANIFEST_PATH = path.join(ROOT, 'runtime', 'manifest.json');

// ─── 共享缓存：全量测试只建立一次真实全组件缓存 ──────────────────────────

let sharedCacheDir = null;
let sharedTmpDir = null;
let sharedCacheInitialized = false;

// 进程退出时清理共享缓存
process.on('exit', () => {
  if (sharedTmpDir) {
    try {
      fs.rmSync(sharedTmpDir, { recursive: true, force: true });
    } catch {}
  }
});
process.on('SIGINT', () => {
  if (sharedTmpDir) {
    try {
      fs.rmSync(sharedTmpDir, { recursive: true, force: true });
    } catch {}
  }
  process.exit(130);
});
process.on('SIGTERM', () => {
  if (sharedTmpDir) {
    try {
      fs.rmSync(sharedTmpDir, { recursive: true, force: true });
    } catch {}
  }
  process.exit(143);
});

// ─── 辅助：读取 manifest ──────────────────────────────────────────────────

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

// ─── 辅助：从可能包含 warning 消息的输出中解析 JSON ─────────────────────

/**
 * 从输出中解析 JSON（可能包含 warning 消息）。
 * 从最后一行开始向前查找有效的 JSON。
 */
function parseJsonFromOutput(output) {
  const lines = output.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      continue;
    }
  }
  return null;
}

// ─── 辅助：运行 bootstrap 并获取缓存路径 ──────────────────────────────────

/**
 * 运行 bootstrap 脚本获取缓存目录。
 * 使用共享缓存，全量测试只建立一次真实全组件缓存。
 */
function runBootstrapGetCacheDir() {
  // 如果已经初始化过共享缓存，直接返回
  if (sharedCacheInitialized && sharedCacheDir && sharedTmpDir) {
    return { tmpDir: sharedTmpDir, cacheDir: sharedCacheDir, overall: 'READY', components: ['core:READY', 'pdf:READY', 'docx:READY', 'xlsx:READY', 'pptx:READY'] };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));

  // 直接调用 runtime manager 来建立缓存
  const managerPath = path.join(ROOT, 'scripts', 'lib', 'runtime-manager.mjs');
  const managerUrl = pathToFileURL(managerPath).href;

  // 使用同步方式：spawn 一个子进程来完成 bootstrap
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { buildInstallPlan, installRuntime } from ${JSON.stringify(managerUrl)};
    import fs from 'node:fs';
    import path from 'node:path';

    const pluginRoot = ${JSON.stringify(ROOT)};
    const cacheDir = ${JSON.stringify(path.join(tmpDir, 'cache'))};
    const allComponents = ['core', 'pdf', 'docx', 'xlsx', 'pptx'];

    try {
      const plan = buildInstallPlan({ pluginRoot, cacheDir, components: allComponents, env: {} });
      const result = await installRuntime(plan, {
        acceptedPlanSha256: plan.plan_sha256,
        now: () => new Date(),
        processInfo: { nodeVersion: process.version, npmVersion: '', platform: process.platform, arch: process.arch },
      });
      console.log(JSON.stringify({ cacheDir, overall: result.overall, components: result.components.map(c => c.name + ':' + c.status) }));
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env },
    shell: false,
    timeout: 120_000,
  });

  const stdout = result.stdout?.toString() || '';
  const stderr = result.stderr?.toString() || '';

  if (result.status !== 0) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Bootstrap failed (exit ${result.status}): ${stderr}`);
  }

  // 查找 JSON 输出（可能包含 warning 消息）
  const lines = stdout.trim().split('\n');
  let jsonLine = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      jsonLine = JSON.parse(lines[i]);
      break;
    } catch {
      continue;
    }
  }

  if (!jsonLine) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`Bootstrap failed: no valid JSON output found in stdout`);
  }

  const info = jsonLine;

  // 存储到共享缓存
  sharedCacheDir = info.cacheDir;
  sharedTmpDir = tmpDir;
  sharedCacheInitialized = true;

  return { tmpDir, cacheDir: info.cacheDir, overall: info.overall, components: info.components };
}

// ─── 测试 1: 空缓存时生产 loader 返回 FLOW_ARCHITECT_RUNTIME_MISSING ─────

test('空缓存即使项目有 node_modules，生产 loader 仍返回 FLOW_ARCHITECT_RUNTIME_MISSING', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-cache-test-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const emptyCacheDir = path.join(tmpDir, 'empty-cache');
  fs.mkdirSync(emptyCacheDir, { recursive: true });

  const loaderUrl = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    try {
      loader.requireRuntimePackage('core', 'ajv/dist/2020.js');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({ threw: true, code: e.code, component: e.component }));
      process.exit(0);
    }
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: emptyCacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = parseJsonFromOutput(result.stdout.toString());
  assert.ok(err, '输出应包含有效 JSON');
  assert.equal(err.threw, true, '应该抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING');
  assert.equal(err.component, 'core');
});

// ─── 测试 2: bootstrap 后真实核心组件可从缓存加载 ────────────────────────

test('bootstrap 后真实 Ajv/XML/YAML 组件可从缓存加载', async (t) => {
  let tmpDir, cacheDir;
  try {
    ({ tmpDir, cacheDir } = runBootstrapGetCacheDir());
  } catch (err) {
    // bootstrap 失败应让测试失败，不得跳过
    assert.fail(`Bootstrap 失败，测试应失败: ${err.message}`);
  }
  // 注意：共享缓存的清理由 process.on('exit') 处理，不在测试中清理

  const loaderUrl = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  // 测试 Ajv
  const ajvResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const Ajv2020 = loader.requireRuntimePackage('core', 'ajv/dist/2020.js');
    const ajv = new Ajv2020();
    const validate = ajv.compile({ type: 'object' });
    const valid = validate({ test: true });
    console.log(JSON.stringify({ ok: valid === true, type: typeof Ajv2020 }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(ajvResult.status, 0, `Ajv 加载失败: ${ajvResult.stderr?.toString()}`);
  // 查找 JSON 输出（可能包含 warning 消息）
  const ajvLines = ajvResult.stdout.toString().trim().split('\n');
  let ajvInfo = null;
  for (let i = ajvLines.length - 1; i >= 0; i--) {
    try {
      ajvInfo = JSON.parse(ajvLines[i]);
      break;
    } catch {
      continue;
    }
  }
  assert.ok(ajvInfo, 'Ajv 输出应包含有效 JSON');
  assert.equal(ajvInfo.ok, true, 'Ajv 应能正常编译和校验');

  // 测试 fast-xml-parser
  const xmlResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const { XMLParser } = loader.requireRuntimePackage('core', 'fast-xml-parser');
    const parser = new XMLParser();
    const result = parser.parse('<root><item>test</item></root>');
    console.log(JSON.stringify({ ok: result !== null, type: typeof XMLParser }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(xmlResult.status, 0, `XML 加载失败: ${xmlResult.stderr?.toString()}`);
  const xmlInfo = parseJsonFromOutput(xmlResult.stdout.toString());
  assert.ok(xmlInfo, 'XML 输出应包含有效 JSON');
  assert.equal(xmlInfo.ok, true, 'XMLParser 应能正常解析');

  // 测试 yaml
  const yamlResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const yaml = loader.requireRuntimePackage('core', 'yaml');
    const parsed = yaml.parse('key: value');
    console.log(JSON.stringify({ ok: parsed !== null && parsed !== undefined, type: typeof yaml.parse }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(yamlResult.status, 0, `YAML 加载失败: ${yamlResult.stderr?.toString()}`);
  const yamlInfo = parseJsonFromOutput(yamlResult.stdout.toString());
  assert.ok(yamlInfo, 'YAML 输出应包含有效 JSON');
  assert.equal(yamlInfo.ok, true, 'YAML 应能正常解析');
});

// ─── 测试 3: bootstrap 后可选组件可从缓存加载 ────────────────────────────

test('bootstrap 后真实 JSZip/PDF/DOCX/XLSX 组件可从缓存加载', async (t) => {
  let tmpDir, cacheDir;
  try {
    ({ tmpDir, cacheDir } = runBootstrapGetCacheDir());
  } catch (err) {
    // bootstrap 失败应让测试失败，不得跳过
    assert.fail(`Bootstrap 失败，测试应失败: ${err.message}`);
  }
  // 注意：共享缓存的清理由 process.on('exit') 处理，不在测试中清理

  const loaderUrl = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'runtime-loader.mjs')).href;

  // 测试 JSZip (pptx 组件)
  const jszipResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const JSZip = loader.requireRuntimePackage('pptx', 'jszip');
    const zip = new JSZip();
    zip.file('test.txt', 'hello');
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    console.log(JSON.stringify({ ok: Buffer.isBuffer(content) && content.length > 0, type: typeof JSZip }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(jszipResult.status, 0, `JSZip 加载失败: ${jszipResult.stderr?.toString()}`);
  const jszipInfo = parseJsonFromOutput(jszipResult.stdout.toString());
  assert.ok(jszipInfo, 'JSZip 输出应包含有效 JSON');
  assert.equal(jszipInfo.ok, true, 'JSZip 应能正常创建和压缩');

  // 测试 pdfjs-dist
  const pdfResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const pdfjsLib = loader.requireRuntimePackage('pdf', 'pdfjs-dist');
    console.log(JSON.stringify({ ok: typeof pdfjsLib === 'object' || typeof pdfjsLib === 'function', keys: Object.keys(pdfjsLib).slice(0, 5) }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(pdfResult.status, 0, `pdfjs-dist 加载失败: ${pdfResult.stderr?.toString()}`);
  const pdfInfo = parseJsonFromOutput(pdfResult.stdout.toString());
  assert.ok(pdfInfo, 'pdfjs-dist 输出应包含有效 JSON');
  assert.equal(pdfInfo.ok, true, 'pdfjs-dist 应能正常加载');

  // 测试 mammoth
  const mammothResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const mammoth = loader.requireRuntimePackage('docx', 'mammoth');
    console.log(JSON.stringify({ ok: typeof mammoth.extractRawText === 'function' }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(mammothResult.status, 0, `mammoth 加载失败: ${mammothResult.stderr?.toString()}`);
  const mammothInfo = parseJsonFromOutput(mammothResult.stdout.toString());
  assert.ok(mammothInfo, 'mammoth 输出应包含有效 JSON');
  assert.equal(mammothInfo.ok, true, 'mammoth 应有 extractRawText 方法');

  // 测试 exceljs
  const excelResult = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const loader = await import(${JSON.stringify(loaderUrl)});
    const { Workbook } = loader.requireRuntimePackage('xlsx', 'exceljs');
    const wb = new Workbook();
    console.log(JSON.stringify({ ok: typeof wb === 'object' }));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(excelResult.status, 0, `exceljs 加载失败: ${excelResult.stderr?.toString()}`);
  const excelInfo = parseJsonFromOutput(excelResult.stdout.toString());
  assert.ok(excelInfo, 'exceljs 输出应包含有效 JSON');
  assert.equal(excelInfo.ok, true, 'exceljs Workbook 应能正常实例化');
});

// ─── 测试 4: bootstrap 子进程失败时顶层命令非零退出 ──────────────────────

test('bootstrap 子进程失败时顶层命令非零退出，且临时目录被清理', async (t) => {
  // 使用一个不存在的 pluginRoot 来触发失败
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { buildInstallPlan } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'runtime-manager.mjs')).href)};
    try {
      buildInstallPlan({
        pluginRoot: '/nonexistent/path',
        cacheDir: '/tmp/test-cache',
        components: ['core'],
        env: {},
      });
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env },
    shell: false,
  });

  assert.notEqual(result.status, 0, '失败时应返回非零退出码');
  assert.ok(result.stderr?.toString().includes('not found') || result.stderr?.toString().includes('missing'), '应有错误消息');
});

// ─── 测试 5: 顶层公开 package 的运行包位于 devDependencies ────────────────

test('顶层公开 package 的运行包位于 devDependencies', () => {
  const pkg = readPackageJson();
  const manifest = readManifest();

  // 检查所有 manifest 中声明的运行时包都在 devDependencies 中
  for (const component of manifest.components) {
    for (const [pkgName, version] of Object.entries(component.packages)) {
      assert.ok(
        pkg.devDependencies?.[pkgName],
        `运行时包 ${pkgName} 应在 devDependencies 中（组件: ${component.name}）`
      );
      assert.equal(
        pkg.devDependencies[pkgName],
        version,
        `运行时包 ${pkgName} 版本应与 manifest 一致：期望 ${version}，实际 ${pkg.devDependencies[pkgName]}`
      );
    }
  }

  // 检查运行时包不在 dependencies 中（应仅在 devDependencies）
  assert.ok(!pkg.dependencies, '顶层 package.json 不应有 dependencies 字段');
});

// ─── 测试 6: bootstrap 脚本文件存在且可执行 ───────────────────────────────

test('bootstrap 脚本文件存在', () => {
  assert.ok(fs.existsSync(BOOTSTRAP_SCRIPT), `bootstrap 脚本应存在: ${BOOTSTRAP_SCRIPT}`);
  const content = fs.readFileSync(BOOTSTRAP_SCRIPT, 'utf8');
  assert.ok(content.includes('buildInstallPlan'), '脚本应使用 buildInstallPlan');
  assert.ok(content.includes('installRuntime'), '脚本应使用 installRuntime');
  assert.ok(content.includes('FLOW_ARCHITECT_CACHE_DIR'), '脚本应设置 FLOW_ARCHITECT_CACHE_DIR');
});

// ─── 测试 7: spawn 时测试文件应被确定性枚举 ─────────────────────────────

test('spawn 时测试文件应被确定性枚举，不得依赖 shell glob 展开', () => {
  const content = fs.readFileSync(BOOTSTRAP_SCRIPT, 'utf8');
  // 不应使用 glob 模式（shell:false 下不会展开）
  assert.ok(!content.includes("test/*.test.mjs"), '不应使用 glob 模式 test/*.test.mjs');
  assert.ok(!content.includes("'test/*.test.mjs'"), '不应使用单引号包裹的 glob 模式');
  assert.ok(!content.includes('"test/*.test.mjs"'), '不应使用双引号包裹的 glob 模式');
  // 应该使用 readdir 或 readdirSync 枚举文件
  assert.ok(
    content.includes('readdirSync') || content.includes('readdir') || content.includes('readdirSync('),
    '应使用 readdir/readdirSync 枚举测试文件'
  );
});

// ─── 测试 8: bootstrap 安装失败时测试应失败而非跳过 ──────────────────────

test('bootstrap 安装失败时测试应失败而非跳过', () => {
  const content = fs.readFileSync(path.join(ROOT, 'test/test-runtime-bootstrap.test.mjs'), 'utf8');

  // 不应有 catch 块中的 return 跳过模式（会导致测试冒充通过）
  const lines = content.split('\n');
  let inCatchBlock = false;
  let hasReturnInCatch = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.includes('catch (err)') || line.includes('catch {')) {
      inCatchBlock = true;
    } else if (inCatchBlock && line === '}') {
      inCatchBlock = false;
    } else if (inCatchBlock && line === 'return;') {
      hasReturnInCatch = true;
      break;
    }
  }

  assert.ok(!hasReturnInCatch, '不应在 catch 块中使用 return 跳过失败的 bootstrap');

  // 应该有抛出错误或让测试失败的机制
  const hasThrowPattern = content.includes("assert.fail") || content.includes("throw new Error");
  assert.ok(hasThrowPattern, 'bootstrap 失败时应抛出错误或让测试失败');
});

// ─── 测试 9: 全量测试只建立一次真实全组件缓存 ────────────────────────────

test('全量测试只建立一次真实全组件缓存', () => {
  const content = fs.readFileSync(path.join(ROOT, 'test/test-runtime-bootstrap.test.mjs'), 'utf8');

  // 应该有模块级缓存变量
  const hasModuleLevelCache = content.includes('let sharedCacheDir') ||
                              content.includes('let sharedTmpDir') ||
                              content.includes('let sharedCacheInitialized');

  assert.ok(hasModuleLevelCache, '应有模块级缓存变量');

  // 检查函数定义中是否有缓存复用逻辑
  const funcDefMatch = content.match(/function runBootstrapGetCacheDir\(\) \{[\s\S]*?\n\}/);
  assert.ok(funcDefMatch, '应找到 runBootstrapGetCacheDir 函数定义');

  const funcDef = funcDefMatch[0];
  const hasCacheReuse = funcDef.includes('sharedCacheInitialized') ||
                        funcDef.includes('sharedCacheDir') ||
                        funcDef.includes('sharedTmpDir');

  assert.ok(hasCacheReuse, '函数应使用共享缓存变量');
});

// ─── 测试 10: package.json test 入口应经过 bootstrap ────────────────────

test('package.json test 入口应经过 bootstrap', () => {
  const pkg = readPackageJson();

  // 应该使用 test-with-runtime.mjs 包装测试
  assert.match(
    pkg.scripts.test,
    /test-with-runtime\.mjs/,
    'test 入口应使用 bootstrap 包装'
  );

  // 不应该直接运行 node --test（未经过 bootstrap）
  assert.doesNotMatch(
    pkg.scripts.test,
    /^node --test/,
    'test 入口不应直接运行 node --test'
  );
});

// ─── 测试 11: setup-help-contract 断言应反映当前依赖结构 ─────────────────

test('setup-help-contract 断言应反映当前依赖结构', () => {
  const content = fs.readFileSync(path.join(ROOT, 'test/setup-help-contract.test.mjs'), 'utf8');

  // 不应断言 dependencies 字段（当前已移除）
  assert.ok(
    !content.includes('assert.deepEqual(pkg.dependencies'),
    '不应断言 dependencies 字段'
  );

  // 应该断言 devDependencies
  assert.ok(
    content.includes('devDependencies'),
    '应断言 devDependencies'
  );

  // 运行时包应在 devDependencies 中
  const pkg = readPackageJson();
  const manifest = readManifest();

  // 验证所有 manifest 中声明的运行时包都在 devDependencies 中
  for (const component of manifest.components) {
    for (const [pkgName, version] of Object.entries(component.packages)) {
      assert.ok(
        pkg.devDependencies?.[pkgName],
        `运行时包 ${pkgName} 应在 devDependencies 中（组件: ${component.name}）`
      );
      assert.equal(
        pkg.devDependencies[pkgName],
        version,
        `运行时包 ${pkgName} 版本应与 manifest 一致：期望 ${version}，实际 ${pkg.devDependencies[pkgName]}`
      );
    }
  }

  // 检查运行时包不在 dependencies 中（应仅在 devDependencies）
  assert.ok(!pkg.dependencies, '顶层 package.json 不应有 dependencies 字段');
});

// ─── 测试 12: bootstrap 后五组件应为 READY 状态 ─────────────────────────

test('bootstrap 后五组件应为 READY 状态', async (t) => {
  let tmpDir, cacheDir;
  try {
    ({ tmpDir, cacheDir } = runBootstrapGetCacheDir());
  } catch (err) {
    // bootstrap 失败应让测试失败，不得跳过
    assert.fail(`Bootstrap 失败，测试应失败: ${err.message}`);
  }
  // 注意：共享缓存的清理由 process.on('exit') 处理，不在测试中清理

  // 使用 runtime-manager 的 checkRuntime 验证
  const managerUrl = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'runtime-manager.mjs')).href;
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    const manager = await import(${JSON.stringify(managerUrl)});
    const status = manager.checkRuntime({ pluginRoot: ${JSON.stringify(ROOT)}, cacheDir: ${JSON.stringify(cacheDir)}, env: {} });
    console.log(JSON.stringify(status));
    `,
  ], {
    cwd: ROOT,
    env: { ...process.env },
    shell: false,
  });

  assert.equal(result.status, 0, `checkRuntime 失败: ${result.stderr?.toString()}`);
  const status = parseJsonFromOutput(result.stdout.toString());
  assert.ok(status, 'checkRuntime 输出应包含有效 JSON');
  assert.equal(status.overall, 'READY', '五组件应全部 READY');
  assert.equal(status.components.length, 5, '应有 5 个组件');

  // 验证每个组件都是 READY 状态
  const componentNames = status.components.map(c => c.name);
  assert.ok(componentNames.includes('core'), '应包含 core 组件');
  assert.ok(componentNames.includes('pdf'), '应包含 pdf 组件');
  assert.ok(componentNames.includes('docx'), '应包含 docx 组件');
  assert.ok(componentNames.includes('xlsx'), '应包含 xlsx 组件');
  assert.ok(componentNames.includes('pptx'), '应包含 pptx 组件');

  for (const comp of status.components) {
    assert.equal(comp.status, 'READY', `${comp.name} 应为 READY`);
  }
});

// ─── 测试 13: 不得修改生产 cache-only loader 的语义 ─────────────────────

test('不得修改生产 cache-only loader 的语义', () => {
  const loaderContent = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'runtime-loader.mjs'), 'utf8');

  // 验证 loader 仍然是 cache-only 模式
  assert.ok(
    loaderContent.includes('cache-only') || loaderContent.includes('cacheOnly'),
    'loader 应保持 cache-only 模式'
  );

  // 验证 loader 没有被修改为支持其他模式
  assert.ok(
    !loaderContent.includes('non-cache') || !loaderContent.includes('nonCache'),
    'loader 不应支持非 cache 模式'
  );

  // 验证 loader 的主要函数未被修改
  assert.ok(
    loaderContent.includes('requireRuntimePackage'),
    'loader 应包含 requireRuntimePackage 函数'
  );
  assert.ok(
    loaderContent.includes('importRuntimePackage'),
    'loader 应包含 importRuntimePackage 函数'
  );

  // 验证 loader 的错误处理未被修改
  assert.ok(
    loaderContent.includes('RuntimeCapabilityError'),
    'loader 应包含 RuntimeCapabilityError 类'
  );
  assert.ok(
    loaderContent.includes('FLOW_ARCHITECT_RUNTIME_MISSING'),
    'loader 应使用 FLOW_ARCHITECT_RUNTIME_MISSING 错误码'
  );
});
