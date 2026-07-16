import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGIN_ROOT = path.resolve(__dirname, '..');

/**
 * Public wording contract tests for Phase 2.
 *
 * These tests assert that public-facing documents (README, SKILL.md)
 * accurately describe implemented capabilities and do not claim
 * features that do not exist yet.
 */

// --- Helper: read file content once ---

function read(relPath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relPath), 'utf8');
}

// ============================================================
// 1. README 会后能力 — 不得声称自动导入/自动合并
// ============================================================

const README_EN = read('README.md');
const README_ZH = read('README.zh-CN.md');

test('EN README after-meeting section must not claim auto-import into run directory', () => {
  // Phrases that imply the system automatically pulls in the exported HTML
  const forbidden = [
    /[Ii]mport\s+(?:the\s+)?exported.*(?:back\s+)?into\s+(?:the\s+)?run\s+directory/i,
    /[Ii]mport.*revision.*into\s+(?:the\s+)?run/i,
  ];
  for (const re of forbidden) {
    assert.ok(
      !re.test(README_EN),
      `EN README must not say the system auto-imports exported HTML into the run directory (matched: ${re})`,
    );
  }
});

test('EN README after-meeting section must not claim automatic merge of questions or BPMN changes', () => {
  const forbidden = [
    /[Tt]he\s+system\s+merges/i,
    /[Ss]ystem.*automatically\s+merges/i,
    /auto-merge/i,
    /automatically\s+merge/i,
  ];
  for (const re of forbidden) {
    assert.ok(
      !re.test(README_EN),
      `EN README must not claim the system auto-merges (matched: ${re})`,
    );
  }
});

test('EN README must describe the actual after-meeting path (extract, compare, feed-back)', () => {
  // The correct description should mention extract-meeting-package or compare-package-revisions
  // or at least describe the manual compare-and-feed-back workflow
  const hasExtract = /extract/i.test(README_EN);
  const hasCompare = /compare/i.test(README_EN) || /comparison/i.test(README_EN) || /diff/i.test(README_EN);
  assert.ok(
    hasExtract || hasCompare,
    'EN README should mention the actual after-meeting workflow (extract package, compare revisions, feed back)',
  );
});

test('ZH README 会后部分不得声称回收到运行目录后系统自动合并', () => {
  const forbidden = [
    /回收到运行目录/,
    /系统合并/,
    /自动合并/,
    /自动导入/,
  ];
  for (const re of forbidden) {
    assert.ok(
      !re.test(README_ZH),
      `ZH README must not claim auto-import or auto-merge (matched: ${re})`,
    );
  }
});

test('ZH README must describe the actual after-meeting path (extract, compare, feed-back)', () => {
  const hasExtract = /抽取/.test(README_ZH) || /提取/.test(README_ZH);
  const hasCompare = /比较/.test(README_ZH) || /版本对比/.test(README_ZH) || /diff/i.test(README_ZH);
  assert.ok(
    hasExtract || hasCompare,
    'ZH README should mention the actual after-meeting workflow (extract package, compare revisions)',
  );
});

// ============================================================
// 2. SKILL.md — 不得建议放宽 12,000 字符硬上限
// ============================================================

const SKILL_MD = read('skills/flow-architect-draft-process/SKILL.md');

test('draft-process SKILL.md must not suggest increasing the 12000-char batch limit', () => {
  // "增加批次大小限制" or similar phrases that suggest relaxing the hard cap
  const forbidden = [
    /增加批次大小/,
    /增大批次大小/,
    /放宽.*上限/,
    /增加.*批次.*限制/,
    /increase.*batch.*limit/i,
    /raise.*batch.*cap/i,
    /relax.*limit/i,
    /expand.*batch.*size/i,
  ];
  for (const re of forbidden) {
    assert.ok(
      !re.test(SKILL_MD),
      `SKILL.md must not suggest increasing/relaxing the 12000-char batch hard cap (matched: ${re})`,
    );
  }
});

test('draft-process SKILL.md batch-too-large error must suggest splitting source materials or shrinking blocks', () => {
  // The correct guidance is to split inputs or shrink individual blocks
  const hasSplit = /拆分/.test(SKILL_MD) || /split/i.test(SKILL_MD);
  const hasShrink = /缩小/.test(SKILL_MD) || /shrink/i.test(SKILL_MD) || /缩减/.test(SKILL_MD);
  assert.ok(
    hasSplit || hasShrink,
    'SKILL.md should suggest splitting source materials or shrinking blocks when batch exceeds limit',
  );
});

// ============================================================
// 3. v0.2.0 产品描述 — 不得错误描述为"只读、不建模"
// ============================================================

test('EN README must not describe the entire v0.2.0 product as read-only or no-modeling', () => {
  // v0.2.0 includes creation skills (draft-process, build-meeting-package)
  // so the entire product cannot be described as read-only
  const forbidden = [
    /Flow Architect is a read-only/i,
    /read-only process architecture and diagram review skill family/i,
    /only review, no creation/i,
    /no modeling/i,
  ];
  for (const re of forbidden) {
    assert.ok(
      !re.test(README_EN),
      `EN README must not describe the entire v0.2.0 product as read-only (matched: ${re})`,
    );
  }
});

test('ZH README must not describe the entire v0.2.0 product as read-only or no-modeling', () => {
  const forbidden = [
    /只读.*评审.*技能族/,
    /仅评审.*不创建/,
    /不建模/,
  ];
  for (const re of forbidden) {
    assert.ok(
      !re.test(README_ZH),
      `ZH README must not describe the entire v0.2.0 product as read-only (matched: ${re})`,
    );
  }
});

test('EN README must still prohibit modifying original inputs or auto-fixing', () => {
  // Even though creation skills exist, they must not modify original inputs
  assert.ok(
    /not modify.*original/i.test(README_EN) || /without modifying/i.test(README_EN),
    'EN README must still prohibit modifying original inputs',
  );
});

test('ZH README must still prohibit modifying original inputs or auto-fixing', () => {
  assert.ok(
    /不修改原始输入/.test(README_ZH) || /不修改原始/.test(README_ZH),
    'ZH README must still prohibit modifying original inputs',
  );
});
