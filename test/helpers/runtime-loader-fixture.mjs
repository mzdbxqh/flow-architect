/**
 * 隔离测试夹具：创建无 node_modules 的插件副本，通过 runtime manager 生成 READY 缓存。
 *
 * 核心原则：
 * - 不依赖开发仓库的 node_modules
 * - 不手工伪造 runtime-state.json（由 manager 自己写）
 * - 使用确定性 executor 创建可加载的夹具包
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

/**
 * 在临时目录创建一个无 node_modules 的隔离插件副本。
 * 复制：manifest、组件描述、loader/manager、业务脚本、schema。
 */
export function createIsolatedPlugin(tmpDir) {
  const pluginRoot = path.join(tmpDir, 'plugin');
  fs.mkdirSync(pluginRoot, { recursive: true });

  // 复制 runtime 目录（manifest + 组件描述）
  const runtimeSrc = path.join(ROOT, 'runtime');
  const runtimeDest = path.join(pluginRoot, 'runtime');
  fs.cpSync(runtimeSrc, runtimeDest, { recursive: true });

  // 复制 scripts 目录（loader、manager、业务脚本）
  const scriptsSrc = path.join(ROOT, 'scripts');
  const scriptsDest = path.join(pluginRoot, 'scripts');
  fs.cpSync(scriptsSrc, scriptsDest, { recursive: true });

  // 复制 references/schemas 目录
  const schemasSrc = path.join(ROOT, 'references', 'schemas');
  const schemasDest = path.join(pluginRoot, 'references', 'schemas');
  if (fs.existsSync(schemasSrc)) {
    fs.cpSync(schemasSrc, schemasDest, { recursive: true });
  }

  // 创建最小 package.json（无依赖）
  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify({
    name: '@flow-architect/test-fixture',
    version: '0.0.0',
    private: true,
  }, null, 2));

  return pluginRoot;
}

/**
 * 确定性 executor：根据组件 package.json 创建可加载的夹具包。
 *
 * - fast-xml-parser: 导出 XMLParser，对最小 BPMN/SVG 返回确定结构
 * - ajv: 导出可构造类，compile 返回带 errors 的 validator
 * - yaml: 导出 parse/stringify
 * - pdfjs-dist/mammoth/exceljs: 最小占位
 */
export function createDeterministicExecutor() {
  return async (componentDir, packages) => {
    const nmDir = path.join(componentDir, 'node_modules');
    fs.mkdirSync(nmDir, { recursive: true });

    for (const [pkg, version] of Object.entries(packages)) {
      const pkgDir = path.join(nmDir, pkg);
      fs.mkdirSync(pkgDir, { recursive: true });

      // 写 package.json
      fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: pkg,
        version,
        main: 'index.js',
        type: 'commonjs',
      }));

      // 按包名创建确定性夹具入口
      const entry = createFixtureEntry(pkg, version);
      fs.writeFileSync(path.join(pkgDir, 'index.js'), entry);

      // ajv/dist/2020.js 需要额外子路径入口
      if (pkg === 'ajv') {
        const distDir = path.join(pkgDir, 'dist');
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(distDir, '2020.js'), entry);
      }
    }
  };
}

/**
 * 为每个包生成确定性可工作的夹具入口代码。
 */
function createFixtureEntry(pkg, version) {
  switch (pkg) {
    case 'fast-xml-parser':
      return `
// 确定性 XMLParser 夹具
class XMLParser {
  constructor(opts) { this.opts = opts || {}; }
  parse(xml) {
    // 最小 BPMN 解析
    if (xml.includes('bpmn:definitions') || xml.includes('definitions')) {
      const hasTask = xml.includes('bpmn:task') || xml.includes('task');
      const hasFlow = xml.includes('bpmn:sequenceFlow') || xml.includes('sequenceFlow');
      return {
        'bpmn:definitions': {
          'bpmn:process': {
            'bpmn:task': hasTask ? [{ '@_id': 'task_1', '@_name': 'Test Task' }] : [],
            'bpmn:sequenceFlow': hasFlow ? [{ '@_id': 'flow_1', '@_source': 'start', '@_target': 'end' }] : [],
            'bpmn:startEvent': [{ '@_id': 'start', '@_name': 'Start' }],
            'bpmn:endEvent': [{ '@_id': 'end', '@_name': 'End' }],
          }
        }
      };
    }
    // 最小 SVG 解析
    if (xml.includes('<svg')) {
      return {
        svg: {
          rect: [{ '@_id': 'rect_1', '@_x': '0', '@_y': '0', '@_width': '100', '@_height': '50' }],
          circle: [{ '@_id': 'circle_1', '@_cx': '50', '@_cy': '50', '@_r': '25' }],
        }
      };
    }
    return {};
  }
}
module.exports = { XMLParser };
`;

    case 'ajv':
      return `
// 确定性 Ajv 2020 夹具
class Ajv2020 {
  constructor(opts) { this.opts = opts || {}; }
  compile(schema) {
    const validate = (data) => {
      // 基于 schema type 做最小校验
      if (schema.type === 'object' && typeof data !== 'object') return false;
      if (schema.type === 'string' && typeof data !== 'string') return false;
      if (schema.type === 'array' && !Array.isArray(data)) return false;
      return true;
    };
    validate.errors = null;
    return validate;
  }
}
module.exports = Ajv2020;
module.exports.default = Ajv2020;
`;

    case 'ajv-formats':
      return `
// 确定性 ajv-formats 夹具
module.exports = function addFormats(ajv) {
  // 最小格式注册：对 'date-time' 格式做基本校验
  ajv.addFormat('date-time', /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/);
  ajv.addFormat('email', /^.+@.+$/);
  ajv.addFormat('uri', /^https?:\\/\\//);
  return ajv;
};
module.exports.default = module.exports;
`;

    case 'yaml':
      return `
// 确定性 yaml 夹具
module.exports = {
  parse: (str) => { try { return JSON.parse(str); } catch { return {}; } },
  stringify: (obj) => JSON.stringify(obj),
};
`;

    case 'pdfjs-dist':
      return `
// 最小 pdfjs-dist 占位
module.exports = { getDocument: () => Promise.resolve({ numPages: 0 }) };
`;

    case 'mammoth':
      return `
// 最小 mammoth 占位
module.exports = { extractRawText: () => Promise.resolve({ value: '', messages: [] }) };
`;

    case 'exceljs':
      return `
// 最小 exceljs 占位
class Workbook { }
module.exports = { Workbook };
`;

    default:
      return `module.exports = { name: '${pkg}', version: '${version}' };`;
  }
}

/**
 * 通过 runtime manager 生成 READY 缓存。
 *
 * 1. 调用 buildInstallPlan
 * 2. 调用 installRuntime 并传确定性 executor
 * 3. 由 manager 自己写 state/lock/READY
 */
export async function installReadyCache(pluginRoot, cacheDir, components = ['core']) {
  // 动态导入隔离副本的 manager
  const managerPath = path.join(pluginRoot, 'scripts', 'lib', 'runtime-manager.mjs');
  const managerUrl = pathToFileURL(managerPath).href;
  const manager = await import(managerUrl);

  const plan = manager.buildInstallPlan({ pluginRoot, cacheDir, components, env: {} });
  const executor = createDeterministicExecutor();

  const result = await manager.installRuntime(plan, {
    acceptedPlanSha256: plan.plan_sha256,
    executeNpm: executor,
    now: () => new Date('2026-07-15T00:00:00Z'),
    processInfo: { nodeVersion: process.version, npmVersion: '10.9.0', platform: process.platform, arch: process.arch },
  });

  return result;
}

/**
 * 创建完整的 loader 测试夹具。
 */
export async function createLoaderFixture({ tmpDir, components = ['core'] }) {
  const pluginRoot = createIsolatedPlugin(tmpDir);
  const cacheDir = path.join(tmpDir, 'cache');

  await installReadyCache(pluginRoot, cacheDir, components);

  const loaderPath = path.join(pluginRoot, 'scripts', 'lib', 'runtime-loader.mjs');
  const loaderUrl = pathToFileURL(loaderPath).href;

  return {
    pluginRoot,
    cacheDir,
    loaderPath,
    loaderUrl,
  };
}
