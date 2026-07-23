#!/usr/bin/env node
/**
 * 确定性 XLSX Fixture 生成器
 *
 * 生成四个 XLSX fixture 文件到 test/fixtures/inputs/，
 * 用于 DrawingML 提取器的五类矩阵和关系安全测试。
 *
 * 所有 ZIP entry 使用固定时间戳（2024-01-15T00:00:00.000Z），
 * entry 顺序固定，不读取当前时间或随机数。
 * 重复生成必须产生完全相同的字节。
 *
 * 用法：node scripts/generate-xlsx-fixtures.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// 使用 test helpers 中的生成器（它们已经实现确定性）
// 这里需要从 packages/flow-architect 根目录运行
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'test', 'fixtures', 'inputs');

// 动态导入 fixture 生成器
const { createDrawingmlFlowFixture, createDrawingmlOnlyFixture, createImageOnlyFixture, createTableImageFixture, createSimpleTableFixture } = await import(join(__dirname, '..', 'test', 'helpers', 'drawingml-fixture-generator.mjs'));

const fixtures = [
  { name: 'drawingml-flow.xlsx', generator: createDrawingmlFlowFixture, description: 'table + native diagram (MIXED)' },
  { name: 'drawingml-only-flow.xlsx', generator: createDrawingmlOnlyFixture, description: 'pure native diagram (DIAGRAM)' },
  { name: 'image-only-flow.xlsx', generator: createImageOnlyFixture, description: 'pure image (DIAGRAM/VISUAL_ONLY)' },
  { name: 'table-image-flow.xlsx', generator: createTableImageFixture, description: 'table + image (MIXED/SEMI_STRUCTURED)' },
];

mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('Generating deterministic XLSX fixtures...\n');

for (const { name, generator, description } of fixtures) {
  const zip = generator();
  // STORE 模式确保跨进程确定性（DEFLATE 在不同进程可能产生不同字节）
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
  });

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const filePath = join(OUTPUT_DIR, name);

  writeFileSync(filePath, buffer);

  console.log(`  ${name}`);
  console.log(`    description: ${description}`);
  console.log(`    size: ${buffer.length} bytes`);
  console.log(`    sha256: ${sha256}`);
  console.log();
}

console.log('Done. All fixtures generated with deterministic timestamps.');
