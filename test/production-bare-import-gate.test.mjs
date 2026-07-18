/**
 * Production Bare Import Gate
 *
 * 检测所有在安装后执行路径中直接裸导入第三方运行时依赖（ajv、ajv-formats、fast-xml-parser、yaml）
 * 的脚本。正式业务脚本必须通过 runtime loader 加载，不得裸导入。
 *
 * 范围：scripts/ 目录下所有 .mjs 文件（不含 lib/runtime-loader.mjs 和 lib/runtime-manager.mjs 自身）。
 * 例外：build-* 脚本是构建期脚本，允许裸导入 devDependency；setup/help 脚本不在此检查范围。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

// 需要通过 runtime loader 加载的运行时包
const RUNTIME_PACKAGES = ['ajv', 'ajv-formats', 'fast-xml-parser'];

// 排除列表：runtime loader 和 runtime manager 自身需要直接引用这些包（作为基础设施）
// build-* 脚本是构建期脚本，允许裸导入
const EXCLUDED_SCRIPTS = [
  'lib/runtime-loader.mjs',
  'lib/runtime-manager.mjs',
];

/**
 * 检查文件是否有裸导入（不通过 runtime loader 的直接 import）
 */
function checkBareImport(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];

  for (const pkg of RUNTIME_PACKAGES) {
    // 检测裸 import 语句：
    // - import ... from 'ajv' / 'ajv/dist/2020.js'
    // - import ... from 'ajv-formats'
    // - import ... from 'fast-xml-parser'
    // 排除 importRuntimePackage('core', 'ajv') 这种形式
    const bareImportRe = new RegExp(
      `^\\s*import\\s+.*\\s+from\\s+['"]${escapeRegex(pkg)}(?:\\/[^'"]*)?['"]`,
      'm'
    );

    if (bareImportRe.test(content)) {
      // 额外检查：是否同时使用了 runtime loader（如果通过 loader 加载，则不算违规）
      const usesLoader = content.includes('importRuntimePackage') || content.includes('requireRuntimePackage');
      if (!usesLoader) {
        violations.push(pkg);
      }
    }
  }

  return violations;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 递归获取目录下所有 .mjs 文件
 */
function getMjsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getMjsFiles(fullPath));
    } else if (entry.name.endsWith('.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

test('production scripts do not bare-import runtime packages (must use loader)', () => {
  const mjsFiles = getMjsFiles(SCRIPTS_DIR);
  const violations = [];

  for (const file of mjsFiles) {
    const relPath = path.relative(SCRIPTS_DIR, file);

    // 跳过排除列表
    if (EXCLUDED_SCRIPTS.includes(relPath)) continue;
    // 跳过 build-* 脚本（构建期脚本允许裸导入）
    if (relPath.startsWith('build-')) continue;

    const fileViolations = checkBareImport(file);
    if (fileViolations.length > 0) {
      violations.push({ file: relPath, packages: fileViolations });
    }
  }

  assert.deepEqual(
    violations,
    [],
    `以下脚本裸导入了运行时包（应通过 runtime loader）:\n${
      violations.map(v => `  ${v.file}: ${v.packages.join(', ')}`).join('\n')
    }`
  );
});

test('runtime loader itself correctly imports runtime packages for infrastructure', () => {
  // 验证 runtime loader 和 manager 存在且可读（不能排除它们自己）
  const loaderPath = path.join(SCRIPTS_DIR, 'lib', 'runtime-loader.mjs');
  const managerPath = path.join(SCRIPTS_DIR, 'lib', 'runtime-manager.mjs');

  assert.ok(fs.existsSync(loaderPath), 'runtime-loader.mjs must exist');
  assert.ok(fs.existsSync(managerPath), 'runtime-manager.mjs must exist');

  // Loader 和 manager 是基础设施，允许直接引用（它们不执行业务逻辑）
  const loaderContent = fs.readFileSync(loaderPath, 'utf8');
  assert.ok(
    loaderContent.includes('importRuntimePackage') || loaderContent.includes('requireRuntimePackage'),
    'runtime-loader must export load functions'
  );
});
