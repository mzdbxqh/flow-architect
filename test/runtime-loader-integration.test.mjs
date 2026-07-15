/**
 * Runtime Loader 隔离业务行为测试
 *
 * 在无 node_modules 的隔离插件中，验证 BPMN、SVG、契约校验真正执行。
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

// 最小 BPMN 样本
const MINIMAL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="start" name="Start">
      <bpmn:outgoing>flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="task_1" name="Test Task">
      <bpmn:incoming>flow_1</bpmn:incoming>
      <bpmn:outgoing>flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="end" name="End">
      <bpmn:incoming>flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start" targetRef="task_1" />
    <bpmn:sequenceFlow id="flow_2" sourceRef="task_1" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

// 最小 SVG 样本
const MINIMAL_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect id="rect_1" x="10" y="10" width="80" height="40" fill="blue" />
  <circle id="circle_1" cx="150" cy="50" r="25" fill="red" />
</svg>`;

// ═══════════════════════════════════════════════════════════════════════════
// 隔离业务行为 1: READY core 下的 BPMN/SVG/契约校验
// ═══════════════════════════════════════════════════════════════════════════

test('隔离插件 + READY core: extractBpmn 同步返回预期 task/flow', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-bpmn-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });

  // 验证插件无 node_modules
  assert.ok(!fs.existsSync(path.join(fixture.pluginRoot, 'node_modules')),
    '隔离插件不应有 node_modules');

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const bpmnUrl = pathToFileURL(${JSON.stringify(path.join(fixture.pluginRoot, 'scripts', 'extract-bpmn.mjs'))}).href;
    const mod = await import(bpmnUrl);

    const xml = ${JSON.stringify(MINIMAL_BPMN)};
    const result = mod.extractBpmn(xml);

    // 验证返回值不是 Promise
    const is_promise = result instanceof Promise || (result && typeof result.then === 'function');

    console.log(JSON.stringify({
      is_promise,
      has_elements: Array.isArray(result.elements),
      element_count: result.elements?.length,
      has_flows: Array.isArray(result.flows),
      flow_count: result.flows?.length,
    }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `extractBpmn 应成功: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());

  assert.equal(output.is_promise, false, 'extractBpmn 必须同步返回，不是 Promise');
  assert.equal(output.has_elements, true, '应返回 elements 数组');
  assert.ok(output.element_count >= 2, `应至少有 start 和 task 元素，实际 ${output.element_count}`);
  assert.equal(output.has_flows, true, '应返回 flows 数组');
  assert.ok(output.flow_count >= 1, `应至少有 1 条 flow，实际 ${output.flow_count}`);
});

test('隔离插件 + READY core: extractSvg 同步返回预期可视元素', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-svg-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const svgUrl = pathToFileURL(${JSON.stringify(path.join(fixture.pluginRoot, 'scripts', 'extract-svg.mjs'))}).href;
    const mod = await import(svgUrl);

    const svg = ${JSON.stringify(MINIMAL_SVG)};
    const result = mod.extractSvg(svg);

    const is_promise = result instanceof Promise || (result && typeof result.then === 'function');

    console.log(JSON.stringify({
      is_promise,
      has_elements: Array.isArray(result.elements),
      element_count: result.elements?.length,
      has_flows: Array.isArray(result.flows),
    }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `extractSvg 应成功: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());

  assert.equal(output.is_promise, false, 'extractSvg 必须同步返回，不是 Promise');
  assert.equal(output.has_elements, true, '应返回 elements 数组');
  assert.ok(output.element_count >= 2, `应至少有 rect 和 circle 元素，实际 ${output.element_count}`);
  assert.equal(output.has_flows, true, '应返回 flows 数组');
});

test('隔离插件 + READY core: validateContract 同步返回 valid 结果', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-contract-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const contractUrl = pathToFileURL(${JSON.stringify(path.join(fixture.pluginRoot, 'scripts', 'lib', 'contract-validation.mjs'))}).href;
    const mod = await import(contractUrl);

    // 合法样本：result schema
    const validData = { summary: { total: 1, passed: 1, failed: 0 }, findings: [] };
    const validResult = mod.validateContract('result', validData);

    // 非法样本：result schema 要求 object，传 string
    const invalidResult = mod.validateContract('result', 'not an object');

    console.log(JSON.stringify({
      valid_is_promise: validResult instanceof Promise || (validResult && typeof validResult.then === 'function'),
      invalid_is_promise: invalidResult instanceof Promise || (invalidResult && typeof invalidResult.then === 'function'),
      valid_result: validResult,
      invalid_result: invalidResult,
    }));
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
  });

  assert.equal(result.status, 0, `validateContract 应成功: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());

  assert.equal(output.valid_is_promise, false, 'validateContract 必须同步返回，不是 Promise');
  assert.equal(output.invalid_is_promise, false, 'validateContract 必须同步返回，不是 Promise');
  assert.equal(output.valid_result?.valid, true, '合法样本应返回 valid=true');
  assert.equal(output.invalid_result?.valid, false, '非法样本应返回 valid=false');
});

// ═══════════════════════════════════════════════════════════════════════════
// 隔离业务行为 2: core 缺失时 API 抛结构化能力错误
// ═══════════════════════════════════════════════════════════════════════════

test('core 缺失时 extractBpmn 抛结构化能力错误并包含 setup 命令', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-bpmn-nocore-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 创建隔离插件但不安装 core
  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'empty-cache');

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const bpmnUrl = pathToFileURL(${JSON.stringify(path.join(pluginRoot, 'scripts', 'extract-bpmn.mjs'))}).href;
    const mod = await import(bpmnUrl);

    try {
      mod.extractBpmn('<bpmn:definitions/>');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        name: e.name,
        code: e.code,
        component: e.component,
        setup_commands: e.setup_commands,
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

  assert.equal(result.status, 0, `进程应正常退出: ${result.stderr?.toString()}`);
  const err = JSON.parse(result.stdout.toString());

  assert.equal(err.threw, true, 'core 缺失时应抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING', '应为结构化能力错误');
  assert.ok(Array.isArray(err.setup_commands), '应包含 setup_commands');
  assert.ok(err.setup_commands.length >= 2, '应包含至少两个平台的 setup 命令');
});

test('core 缺失时 extractSvg 抛结构化能力错误', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-svg-nocore-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'empty-cache');

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const svgUrl = pathToFileURL(${JSON.stringify(path.join(pluginRoot, 'scripts', 'extract-svg.mjs'))}).href;
    const mod = await import(svgUrl);

    try {
      mod.extractSvg('<svg/>');
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        setup_commands: e.setup_commands,
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

  assert.equal(err.threw, true, 'core 缺失时应抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING', '应为结构化能力错误');
  assert.ok(err.setup_commands?.length >= 2, '应包含至少两个平台的 setup 命令');
});

test('core 缺失时 validateContract 抛结构化能力错误', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-contract-nocore-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'empty-cache');

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const contractUrl = pathToFileURL(${JSON.stringify(path.join(pluginRoot, 'scripts', 'lib', 'contract-validation.mjs'))}).href;
    const mod = await import(contractUrl);

    try {
      mod.validateContract('result', {});
      console.log(JSON.stringify({ threw: false }));
      process.exit(1);
    } catch (e) {
      console.log(JSON.stringify({
        threw: true,
        code: e.code,
        setup_commands: e.setup_commands,
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

  assert.equal(err.threw, true, 'core 缺失时应抛出异常');
  assert.equal(err.code, 'FLOW_ARCHITECT_RUNTIME_MISSING', '应为结构化能力错误');
  assert.ok(err.setup_commands?.length >= 2, '应包含至少两个平台的 setup 命令');
});

// ═══════════════════════════════════════════════════════════════════════════
// 隔离业务行为 3: optional 缺失时的降级
// ═══════════════════════════════════════════════════════════════════════════

test('optional 缺失时 inspectInputs 处理 Markdown 成功，可选格式产生 warning', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-optional-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 只安装 core，不安装 pdf/docx/xlsx
  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });

  // 创建一个最小 Markdown 文件
  const mdPath = path.join(tmpDir, 'test.md');
  fs.writeFileSync(mdPath, '# Test\nHello world\n');
  const pdfPath = path.join(tmpDir, 'optional.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4\n% isolated optional fixture\n');
  const runDir = path.join(tmpDir, 'run');

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    import fs from 'fs';
    const inspectUrl = pathToFileURL(${JSON.stringify(path.join(fixture.pluginRoot, 'scripts', 'inspect-inputs.mjs'))}).href;
    const mod = await import(inspectUrl);

    try {
      const manifest = await mod.inspectInputs({
        inputs: [${JSON.stringify(mdPath)}, ${JSON.stringify(pdfPath)}],
        runDir: ${JSON.stringify(runDir)},
      });
      const markdown = manifest.artifacts.find((item) => item.file_path === ${JSON.stringify(mdPath)});
      const pdf = manifest.artifacts.find((item) => item.file_path === ${JSON.stringify(pdfPath)});

      console.log(JSON.stringify({
        ok: true,
        artifact_count: manifest.artifacts.length,
        warnings: manifest.warnings,
        markdown_degradation: markdown?.degradation_reason,
        pdf_degradation: pdf?.degradation_reason,
        manifest_written: fs.existsSync(${JSON.stringify(path.join(runDir, 'input', 'input-manifest.json'))}),
      }));
      process.exit(0);
    } catch (e) {
      console.log(JSON.stringify({
        ok: false,
        error: e.message,
        code: e.code,
      }));
      process.exit(1);
    }
    `,
  ], {
    cwd: tmpDir,
    env: { ...process.env, FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir, NODE_PATH: '' },
    shell: false,
    timeout: 30000,
  });

  assert.equal(result.status, 0, `inspectInputs 应成功处理 Markdown: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());

  assert.equal(output.ok, true, 'inspectInputs 应成功完成');
  assert.equal(output.artifact_count, 2, 'Markdown 与 PDF 都应进入 manifest');
  assert.equal(output.markdown_degradation, null, 'Markdown 不应受缺失 optional 组件影响');
  assert.match(output.pdf_degradation, /FLOW_ARCHITECT_RUNTIME_MISSING|pdf|setup/i,
    '只有 PDF 应记录 optional 组件缺失的降级原因');
  assert.equal(output.manifest_written, true, 'manifest 应成功写入 runDir/input');
  assert.equal(output.warnings.length, 1, '只应产生一个对应 PDF 的 warning');
  assert.match(output.warnings[0], /PDF analysis failed.*FLOW_ARCHITECT_RUNTIME_MISSING|PDF analysis failed.*setup/i,
    'warning 应明确指出 PDF optional 组件缺失');
});

test('业务脚本在隔离副本内不通过仓库根依赖漏加载', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-no-leak-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const fixture = await createLoaderFixture({ tmpDir, components: ['core'] });

  // 设置一个假的 NODE_PATH 指向空目录，确保不能通过它找到包
  const emptyNodePath = path.join(tmpDir, 'empty-node-path');
  fs.mkdirSync(emptyNodePath, { recursive: true });

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
    import { pathToFileURL } from 'url';
    const bpmnUrl = pathToFileURL(${JSON.stringify(path.join(fixture.pluginRoot, 'scripts', 'extract-bpmn.mjs'))}).href;
    const mod = await import(bpmnUrl);

    const xml = ${JSON.stringify(MINIMAL_BPMN)};
    const result = mod.extractBpmn(xml);

    console.log(JSON.stringify({
      ok: true,
      element_count: result.elements?.length,
    }));
    `,
  ], {
    cwd: tmpDir,
    env: {
      ...process.env,
      FLOW_ARCHITECT_CACHE_DIR: fixture.cacheDir,
      NODE_PATH: emptyNodePath, // 故意设置一个空的 NODE_PATH
    },
    shell: false,
  });

  assert.equal(result.status, 0, `不应通过 NODE_PATH 漏加载: ${result.stderr?.toString()}`);
  const output = JSON.parse(result.stdout.toString());
  assert.equal(output.ok, true, '应该只从隔离缓存加载');
});
