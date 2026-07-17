/**
 * 源码扫描测试：防止 V1 fallback 再次引入
 *
 * 确保 meeting/process-draft V2 路径不使用 V1 fallback
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * 扫描文件中是否包含 V1 fallback 模式
 */
function scanForV1Fallbacks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  // V1 fallback 模式
  const patterns = [
    {
      pattern: /model\.elements\s*\|\|/,
      message: 'V1 fallback: model.elements || (应使用 model.diagram.nodes)',
    },
    {
      pattern: /e\.element_id\s*\|\|\s*e\.node_id/,
      message: 'V1 fallback: element_id || node_id (应使用 node_id)',
    },
    {
      pattern: /e\.element_id/,
      message: 'V1 引用: element_id (应使用 node_id)',
    },
    {
      pattern: /model\.elements/,
      message: 'V1 引用: model.elements (应使用 model.diagram.nodes)',
    },
    {
      pattern: /q\.question_id\s*\|\|\s*q\.id|item\.question_id\s*\|\|\s*item\.id/,
      message: 'V1 问题 ID fallback（应只使用 question_id）',
    },
    {
      pattern: /q\.target_paths\s*\|\|\s*q\.element_ids/,
      message: 'V1 问题目标 fallback（应只使用 target_paths）',
    },
  ];

  if (filePath.includes(`${path.sep}meeting-package${path.sep}src${path.sep}`)) {
    patterns.push({
      pattern: /Date\.now\s*\(/,
      message: '非确定性结构 ID（应由结构命令分配稳定 ID）',
    });
  }

  for (const [lineNumber, line] of lines.entries()) {
    for (const { pattern, message } of patterns) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(ROOT, filePath),
          line: lineNumber + 1,
          message,
          code: line.trim(),
        });
      }
    }
  }

  return violations;
}

test('meeting-package-html.mjs 不应包含 V1 fallback', () => {
  const filePath = path.join(ROOT, 'scripts', 'lib', 'meeting-package-html.mjs');
  const violations = scanForV1Fallbacks(filePath);

  assert.deepEqual(
    violations,
    [],
    `发现 V1 fallback:\n${violations.map(v => `  ${v.file}:${v.line}: ${v.message}\n    ${v.code}`).join('\n')}`
  );
});

test('process-fragment-merge.mjs 不应包含 V1 fallback', () => {
  const filePath = path.join(ROOT, 'scripts', 'lib', 'process-fragment-merge.mjs');
  const violations = scanForV1Fallbacks(filePath);

  assert.deepEqual(
    violations,
    [],
    `发现 V1 fallback:\n${violations.map(v => `  ${v.file}:${v.line}: ${v.message}\n    ${v.code}`).join('\n')}`
  );
});

test('所有 scripts/lib/*.mjs 不应包含 V1 fallback', () => {
  const libDir = path.join(ROOT, 'scripts', 'lib');
  const files = fs.readdirSync(libDir)
    .filter(f => f.endsWith('.mjs'))
    .map(f => path.join(libDir, f));

  const allViolations = [];
  for (const file of files) {
    const violations = scanForV1Fallbacks(file);
    allViolations.push(...violations);
  }

  assert.deepEqual(
    allViolations,
    [],
    `发现 V1 fallback:\n${allViolations.map(v => `  ${v.file}:${v.line}: ${v.message}\n    ${v.code}`).join('\n')}`
  );
});

test('meeting-package/src/*.js 不应包含 V1 fallback 或非确定性结构 ID', () => {
  const sourceDir = path.join(ROOT, 'meeting-package', 'src');
  const files = fs.readdirSync(sourceDir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(sourceDir, f));

  const allViolations = files.flatMap(scanForV1Fallbacks);

  assert.deepEqual(
    allViolations,
    [],
    `发现 V1 fallback 或非确定性结构 ID:\n${allViolations.map(v => `  ${v.file}:${v.line}: ${v.message}\n    ${v.code}`).join('\n')}`
  );
});
