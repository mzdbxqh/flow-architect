/**
 * 中文 Skill 合同测试
 *
 * 验证所有公开 Skill、Worker 和规则正文以中文为主导，
 * 且语义可追溯到中文真源。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

describe('中文 Skill 合同', () => {
  it('22 个 Skill 的 description 全部包含汉字', () => {
    const skills = loadAllSkills();
    assert.equal(skills.length, 22, '应有 22 个 Skill');

    for (const skill of skills) {
      const desc = extractFrontmatterField(skill.content, 'description');
      assert.ok(desc, `Skill ${skill.name} 应有 description`);
      const hanCount = countHanChars(desc);
      assert.ok(hanCount > 0, `Skill ${skill.name} 的 description 应包含汉字，实际: "${desc.slice(0, 50)}"`);
    }
  });

  it('20 个 Skill 的自然语言段落以中文为主导', () => {
    const skills = loadAllSkills();

    for (const skill of skills) {
      const body = extractBody(skill.content);
      const paragraphs = body.split(/\n{2,}/).filter(p => p.trim().length > 0);

      let chineseDominant = 0;
      let totalMeaningful = 0;

      for (const para of paragraphs) {
        // 跳过代码块、命令、JSON、YAML
        if (isCodeOrCommand(para)) continue;
        totalMeaningful++;
        if (isChineseDominant(para)) chineseDominant++;
      }

      if (totalMeaningful > 0) {
        const ratio = chineseDominant / totalMeaningful;
        assert.ok(ratio >= 0.7,
          `Skill ${skill.name} 中文段落比例 ${(ratio * 100).toFixed(0)}% 低于 70%`);
      }
    }
  });

  it('SOP 规则包含六个场景分叉信号', () => {
    const sopRulesPath = join(pkgRoot, 'references/rules/sop-review.md');
    const content = readFileSync(sopRulesPath, 'utf8');

    // 六个场景分叉信号
    assert.match(content, /换人/, 'SOP 应包含"换人"信号');
    assert.match(content, /等待超半个工作日/, 'SOP 应包含"等待超半个工作日"信号');
    assert.match(content, /切地点/, 'SOP 应包含"切地点"信号');
    assert.match(content, /切系统/, 'SOP 应包含"切系统"信号');
    assert.match(content, /切业务模式/, 'SOP 应包含"切业务模式"信号');
    assert.match(content, /跳过|新增步骤/, 'SOP 应包含"跳过/新增步骤"信号');
  });

  it('SOP 规则不再使用错误的英文 5W 版本', () => {
    const sopRulesPath = join(pkgRoot, 'references/rules/sop-review.md');
    const content = readFileSync(sopRulesPath, 'utf8');

    // 不应出现 "Who.*What.*When.*Where.*Why" 的 5W 模式
    assert.doesNotMatch(content, /Who.*What.*When.*Where.*Why/s,
      'SOP 规则不应包含英文 5W 模式');
  });

  it('L5 规则包含 R0、R1-R3 和四问', () => {
    const l5RulesPath = join(pkgRoot, 'references/rules/l5-review.md');
    const content = readFileSync(l5RulesPath, 'utf8');

    assert.match(content, /R0/, 'L5 应包含 R0');
    assert.match(content, /R1/, 'L5 应包含 R1');
    assert.match(content, /四问/, 'L5 应包含四问');
  });

  it('rule-catalog.json 的业务描述以中文为主', () => {
    const catalogPath = join(pkgRoot, 'references/rule-catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

    let chineseCount = 0;
    for (const rule of catalog.rules) {
      if (isChineseDominant(rule.applicability || '')) {
        chineseCount++;
      }
    }

    const ratio = chineseCount / catalog.rules.length;
    assert.ok(ratio >= 0.7,
      `规则目录中文比例 ${(ratio * 100).toFixed(0)}% 低于 70%，当前仅 ${chineseCount}/${catalog.rules.length}`);
  });
});

describe('中文真源映射', () => {
  it('source map 文件存在且通过 Schema 验证', () => {
    const mapPath = join(__dirname, '..', '..', '..', 'artifacts/contracts/chinese-skill-source-map.json');
    const content = readFileSync(mapPath, 'utf8');
    const map = JSON.parse(content);

    assert.equal(map.schema_version, '1.0.0');
    assert.ok(Array.isArray(map.mappings), '应有 mappings 数组');
    assert.ok(map.mappings.length >= 20, `应至少映射 20 个目标，实际 ${map.mappings.length}`);
  });

  it('每个公开 Skill 都有对应的真源映射', () => {
    const mapPath = join(__dirname, '..', '..', '..', 'artifacts/contracts/chinese-skill-source-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));

    const skillsDir = join(pkgRoot, 'skills');
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const skillDir of skillDirs) {
      const target = `${skillDir}/SKILL.md`;
      const mapping = map.mappings.find(m => m.public_target === target);
      assert.ok(mapping, `Skill ${target} 应有真源映射`);
      assert.ok(mapping.source_path, `映射应有 source_path`);
      assert.ok(mapping.source_sha256, `映射应有 source_sha256`);
      assert.ok(mapping.source_sections?.length > 0, `映射应有 source_sections`);
    }
  });

  it('source map 不泄漏到公开包', () => {
    // 验证公开包中不包含 source_path
    const skillsDir = join(pkgRoot, 'skills');
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const skillDir of skillDirs) {
      const skillPath = join(skillsDir, skillDir, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf8');
      assert.doesNotMatch(content, /source_path.*references\/source/,
        `Skill ${skillDir} 不应包含 source_path`);
    }
  });
});

// --- 辅助函数 ---

function loadAllSkills() {
  const skillsDir = join(pkgRoot, 'skills');
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      content: readFileSync(join(skillsDir, d.name, 'SKILL.md'), 'utf8'),
    }));
}

function extractFrontmatterField(content, field) {
  const match = content.match(/^---\n[\s\S]*?^---\n/m);
  if (!match) return null;
  const fm = match[0];
  // 单行值
  const fieldMatch = fm.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  if (fieldMatch && fieldMatch[1].trim() !== '|' && fieldMatch[1].trim() !== '>') {
    return fieldMatch[1].trim();
  }
  // 多行值（| 或 > 折叠）
  const multiMatch = fm.match(new RegExp(`^${field}:\\s*[|>]\\n([\\s\\S]*?)(?=^---)`, 'm'));
  if (multiMatch) {
    // 去掉每行的前导缩进
    return multiMatch[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim();
  }
  return null;
}

function extractBody(content) {
  const match = content.match(/^---\n[\s\S]*?^---\n([\s\S]*)/m);
  return match ? match[1] : content;
}

function countHanChars(text) {
  let count = 0;
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) count++;
  }
  return count;
}

function isCodeOrCommand(text) {
  const trimmed = text.trim();
  // 代码块
  if (trimmed.startsWith('```')) return true;
  // JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  // 纯命令行
  if (trimmed.startsWith('$') || trimmed.startsWith('>')) return true;
  // YAML frontmatter
  if (trimmed.startsWith('---')) return true;
  // 纯英文命令描述
  const lines = trimmed.split('\n');
  const commandLines = lines.filter(l => l.match(/^[a-z]+[\s(]/));
  if (commandLines.length > lines.length * 0.5) return true;
  return false;
}

function isChineseDominant(text) {
  let han = 0;
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue; // 跳过空白
    total++;
    if (/\p{Script=Han}/u.test(ch)) han++;
  }
  if (total === 0) return false;
  return han / total >= 0.3; // 汉字占比 30% 以上视为中文主导
}
