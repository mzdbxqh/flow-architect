/**
 * V2 公开文档合同测试
 *
 * 验证 Cycle 6 的公开文档、技能入口、来源治理与架构决策收口。
 * 使用明确文档×语义矩阵和精确依赖对象 deepEqual，不使用宽泛关键词循环。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

// --- 辅助函数 ---

function read(relPath) {
  return readFileSync(join(pkgRoot, relPath), 'utf8');
}

function json(relPath) {
  return JSON.parse(read(relPath));
}

// --- 文档集合 ---

const DOCS = {
  README_EN: read('README.md'),
  README_ZH: read('README.zh-CN.md'),
  USER_GUIDE: read('docs/zh-CN/user-guide.md'),
  ENTRY_SKILL: read('skills/flow-architect/SKILL.md'),
  DRAFT_PROCESS: read('skills/flow-architect-draft-process/SKILL.md'),
  HELP_SKILL: read('skills/flow-architect-help/SKILL.md'),
};

const ALL_PUBLIC_DOCS = {
  'README.md': DOCS.README_EN,
  'README.zh-CN.md': DOCS.README_ZH,
  'docs/zh-CN/user-guide.md': DOCS.USER_GUIDE,
  'skills/flow-architect/SKILL.md': DOCS.ENTRY_SKILL,
  'skills/flow-architect-draft-process/SKILL.md': DOCS.DRAFT_PROCESS,
  'skills/flow-architect-help/SKILL.md': DOCS.HELP_SKILL,
};

const REFERENCE_DOCS = {
  'references/meeting-package-v2-contract.md': read('references/meeting-package-v2-contract.md'),
  'references/drawingml-input-contract.md': read('references/drawingml-input-contract.md'),
};

// ============================================================
// 1. 公开文档×能力语义矩阵（精确匹配，非宽泛循环）
// ============================================================

describe('1. 文档×能力语义矩阵', () => {
  // 矩阵定义：每个文档必须匹配的能力语义
  // 不用 for 循环，每个断言独立，错误消息可定位缺失的文档与语义
  const MATRIX = [
    { doc: 'README.zh-CN.md', content: DOCS.README_ZH, must: [
      { pattern: /流程初稿|process draft/, desc: '流程初稿能力' },
      { pattern: /离线.*HTML|offline.*HTML/, desc: '离线 HTML' },
      { pattern: /会议包|meeting package/, desc: '会议包' },
    ]},
    { doc: 'README.md', content: DOCS.README_EN, must: [
      { pattern: /process draft/, desc: 'process draft' },
      { pattern: /offline.*HTML|离线.*HTML/, desc: 'offline HTML' },
      { pattern: /meeting package|会议包/, desc: 'meeting package' },
    ]},
    { doc: 'docs/zh-CN/user-guide.md', content: DOCS.USER_GUIDE, must: [
      { pattern: /流程初稿|process draft/, desc: '流程初稿能力' },
      { pattern: /离线.*HTML|offline.*HTML/, desc: '离线 HTML' },
      { pattern: /会议包|meeting package/, desc: '会议包' },
    ]},
    { doc: 'skills/flow-architect/SKILL.md', content: DOCS.ENTRY_SKILL, must: [
      { pattern: /流程初稿|process draft/, desc: '流程初稿能力' },
      { pattern: /离线.*HTML|offline.*HTML/, desc: '离线 HTML' },
      { pattern: /会议包|meeting package/, desc: '会议包' },
    ]},
    { doc: 'skills/flow-architect-draft-process/SKILL.md', content: DOCS.DRAFT_PROCESS, must: [
      { pattern: /流程初稿|process draft/, desc: '流程初稿能力' },
      { pattern: /离线.*HTML|offline.*HTML/, desc: '离线 HTML' },
      { pattern: /会议包|meeting package/, desc: '会议包' },
    ]},
    { doc: 'skills/flow-architect-help/SKILL.md', content: DOCS.HELP_SKILL, must: [
      { pattern: /流程初稿|process draft/, desc: '流程初稿能力' },
      { pattern: /离线.*HTML|offline.*HTML/, desc: '离线 HTML' },
      { pattern: /会议包|meeting package/, desc: '会议包' },
    ]},
  ];

  for (const { doc, content, must } of MATRIX) {
    it(`${doc} 包含全部必要能力语义`, () => {
      const missing = must.filter(m => !m.pattern.test(content));
      assert.deepEqual(missing, [],
        `${doc} 缺少能力语义: ${missing.map(m => m.desc).join(', ')}`);
    });
  }
});

// ============================================================
// 2. 中文主文档关键概念矩阵（精确匹配）
// ============================================================

describe('2. 中文主文档关键概念矩阵', () => {
  const REQUIRED_CONCEPTS = [
    { pattern: /末端 L4|leaf L4/, desc: '末端 L4' },
    { pattern: /一图两表|one diagram two tables/, desc: '一图两表' },
    { pattern: /四页签|四个页签|four tabs/, desc: '四页签' },
    { pattern: /模型不绘图|model does not draw/, desc: '模型不绘图' },
    { pattern: /有限工具箱|limited toolbox/, desc: '有限工具箱' },
    { pattern: /结构操作后.*确定性重排|deterministic re-layout/, desc: '确定性重排' },
  ];

  for (const doc of ['README.zh-CN.md', 'docs/zh-CN/user-guide.md']) {
    const content = ALL_PUBLIC_DOCS[doc];
    it(`${doc} 包含全部关键概念`, () => {
      const missing = REQUIRED_CONCEPTS.filter(m => !m.pattern.test(content));
      assert.deepEqual(missing, [],
        `${doc} 缺少关键概念: ${missing.map(m => m.desc).join(', ')}`);
    });
  }
});

// ============================================================
// 3. 活动一览表字段与五类导出矩阵
// ============================================================

describe('3. 活动一览表字段与五类导出', () => {
  const ACTIVITY_FIELDS = [
    { pattern: /活动名称|activity name/, desc: '活动名称' },
    { pattern: /角色.*RASCI|role.*RASCI/, desc: '角色与 RASCI' },
    { pattern: /SLA|LT/, desc: 'SLA/LT' },
    { pattern: /输入.*输出|input.*output/, desc: '输入/输出' },
  ];

  const FIVE_EXPORTS = [
    { pattern: /HTML/, desc: 'HTML 导出' },
    { pattern: /BPMN/, desc: 'BPMN 导出' },
    { pattern: /SVG/, desc: 'SVG 导出' },
    { pattern: /问题.*JSON|questions.*JSON/, desc: '问题 JSON 导出' },
    { pattern: /V2.*JSON|complete.*V2.*JSON/, desc: '完整 V2 JSON 导出' },
  ];

  for (const doc of ['README.zh-CN.md', 'docs/zh-CN/user-guide.md']) {
    const content = ALL_PUBLIC_DOCS[doc];

    it(`${doc} 列明活动一览表核心字段`, () => {
      const missing = ACTIVITY_FIELDS.filter(m => !m.pattern.test(content));
      assert.deepEqual(missing, [],
        `${doc} 缺少活动一览表字段: ${missing.map(m => m.desc).join(', ')}`);
    });

    it(`${doc} 列明五类导出且明确无 XLSX`, () => {
      const missing = FIVE_EXPORTS.filter(m => !m.pattern.test(content));
      assert.deepEqual(missing, [],
        `${doc} 缺少导出类型: ${missing.map(m => m.desc).join(', ')}`);
      assert.match(content, /不导出.*XLSX|no.*XLSX.*export/i,
        `${doc} 应明确说明不导出 XLSX`);
    });
  }
});

// ============================================================
// 4. XLSX 描述必须说明动态分类（非仅表格提取）
// ============================================================

describe('4. XLSX 动态分类描述', () => {
  const XLSX_DOCS = [
    { doc: 'README.zh-CN.md', content: DOCS.README_ZH },
    { doc: 'README.md', content: DOCS.README_EN },
    { doc: 'skills/flow-architect-draft-process/SKILL.md', content: DOCS.DRAFT_PROCESS },
  ];

  for (const { doc, content } of XLSX_DOCS) {
    it(`${doc} XLSX 描述包含动态分类，不含"仅表格"`, () => {
      assert.doesNotMatch(content, /XLSX.*仅.*表格|XLSX.*only.*table/i,
        `${doc} 不应把 XLSX 仅描述为表格提取`);
      assert.match(content, /DrawingML|动态分类|dynamic classification/i,
        `${doc} 应说明 XLSX 的动态分类能力`);
    });
  }
});

// ============================================================
// 5. xlsx runtime 精确依赖对象 deepEqual
// ============================================================

describe('5. xlsx runtime 精确依赖', () => {
  it('用户手册同时列出 exceljs 和 jszip', () => {
    const missing = [];
    if (!/exceljs/i.test(DOCS.USER_GUIDE)) missing.push('exceljs');
    if (!/jszip/i.test(DOCS.USER_GUIDE)) missing.push('jszip');
    assert.deepEqual(missing, [], `用户手册缺少: ${missing.join(', ')}`);
  });

  it('manifest 精确依赖对象 deepEqual', () => {
    const manifest = json('runtime/manifest.json');
    assert.equal(manifest.runtime_version, '2.0.0',
      'runtime manifest 版本应为 2.0.0');

    // 精确组件名投影，替代弱 assert.ok 存在性检查
    const componentNames = manifest.components.map(c => c.name);
    assert.ok(componentNames.includes('xlsx'),
      `manifest.components 缺少 xlsx，实际组件: [${componentNames.join(', ')}]`);

    const xlsxComponent = manifest.components.find(c => c.name === 'xlsx');

    // 精确依赖对象 deepEqual
    assert.deepEqual(xlsxComponent.packages, {
      exceljs: '4.4.0',
      jszip: '3.10.1',
    }, 'xlsx 组件精确依赖应为 {exceljs: "4.4.0", jszip: "3.10.1"}');
  });
});

// ============================================================
// 6. help 真正列出核心能力（非仅 description 加"离线 HTML"）
// ============================================================

describe('6. help 核心能力清单', () => {
  const HELP_CAPABILITIES = [
    { pattern: /一图两表|one diagram two tables/, desc: '一图两表' },
    { pattern: /DrawingML/, desc: 'DrawingML 输入' },
    { pattern: /有限工具箱|有限.*BPMN.*工具箱|limited toolbox/, desc: '有限工具箱' },
    { pattern: /确定性重排|自动重排|deterministic.*re-?layout/, desc: '确定性重排' },
    { pattern: /五类导出|导出.*HTML.*BPMN.*SVG/, desc: '导出能力' },
    { pattern: /模型不绘图/, desc: '模型不绘图' },
  ];

  it('help SKILL.md 正文列出全部核心能力', () => {
    const missing = HELP_CAPABILITIES.filter(m => !m.pattern.test(DOCS.HELP_SKILL));
    assert.deepEqual(missing, [],
      `help SKILL.md 缺少核心能力: ${missing.map(m => m.desc).join(', ')}`);
  });

  it('help 保持只读，不创建 runDir，不默认安装', () => {
    assert.doesNotMatch(DOCS.HELP_SKILL, /创建.*runDir|create.*runDir/i,
      'help 不应创建业务 runDir');
    assert.doesNotMatch(DOCS.HELP_SKILL, /默认安装|default install/i,
      'help 不应默认安装');
    assert.match(DOCS.HELP_SKILL, /零写入|zero write/i,
      'help 应声明零写入约束');
    assert.match(DOCS.HELP_SKILL, /零联网|zero network/i,
      'help 应声明零联网约束');
  });

  it('setup 才执行 check—plan—confirm—install—doctor', () => {
    const setupSkill = read('skills/flow-architect-setup/SKILL.md');
    const REQUIRED_STEPS = [
      { pattern: /check.*json/i, desc: 'check' },
      { pattern: /plan.*json/i, desc: 'plan' },
      { pattern: /confirm|确认/i, desc: 'confirm' },
      { pattern: /install.*json/i, desc: 'install' },
      { pattern: /doctor.*json/i, desc: 'doctor' },
    ];
    const missing = REQUIRED_STEPS.filter(m => !m.pattern.test(setupSkill));
    assert.deepEqual(missing, [],
      `setup SKILL.md 缺少步骤: ${missing.map(m => m.desc).join(', ')}`);
  });
});

// ============================================================
// 7. 旧阶段措辞禁令（V1 范围、第二阶段、Phase 2 等）
// ============================================================

describe('7. 旧生命周期措辞禁令', () => {
  const FORBIDDEN_LIFECYCLE = [
    { pattern: /V1\s*范围|V1\s*Scope/i, desc: 'V1 范围 / V1 Scope' },
    { pattern: /当前\s*V1/i, desc: '当前 V1' },
    { pattern: /第二阶段|Phase\s*2/i, desc: '第二阶段 / Phase 2' },
  ];

  for (const [file, content] of Object.entries(ALL_PUBLIC_DOCS)) {
    it(`${file} 不含旧生命周期措辞`, () => {
      const found = FORBIDDEN_LIFECYCLE.filter(m => m.pattern.test(content));
      assert.deepEqual(found, [],
        `${file} 仍含旧生命周期措辞: ${found.map(m => m.desc).join(', ')}`);
    });
  }
});

// ============================================================
// 8. 不得出现旧 1:N/五模式活动—Task 口径
// ============================================================

describe('8. 旧活动—Task 口径禁令', () => {
  const FORBIDDEN_PATTERNS = [
    { pattern: /1:N.*活动.*Task|1:N.*activity.*Task/i, desc: '1:N 活动-Task' },
    { pattern: /五模式|five patterns/i, desc: '五模式' },
    { pattern: /旧.*活动.*Task.*关系|old.*activity.*Task.*relationship/i, desc: '旧活动-Task 关系' },
  ];

  const ALL_CHECK_FILES = { ...ALL_PUBLIC_DOCS, ...REFERENCE_DOCS };

  for (const [file, content] of Object.entries(ALL_CHECK_FILES)) {
    it(`${file} 不含旧活动—Task 口径`, () => {
      const found = FORBIDDEN_PATTERNS.filter(m => m.pattern.test(content));
      assert.deepEqual(found, [],
        `${file} 仍含旧活动—Task 口径: ${found.map(m => m.desc).join(', ')}`);
    });
  }
});

// ============================================================
// 9. 公开边界：无私有来源名、绝对路径、组织标记、内部工件编号
// ============================================================

describe('9. 公开边界泄漏检查', () => {
  const FORBIDDEN_PRIVATE = [
    { pattern: new RegExp(['gt','mc','-ea-','bpm'].join(''), 'i'), desc: '私有来源名' },
    { pattern: /references\/source/i, desc: '私有路径 references/source' },
    { pattern: /artifacts\/contracts/i, desc: '私有路径 artifacts/contracts' },
    { pattern: /\/Users\/[^/]+\/source\//i, desc: '绝对用户路径 macOS' },
    { pattern: /\/home\/[^/]+\//i, desc: '绝对用户路径 Linux' },
    { pattern: /C:\\Users\\[^\\]+\\source\\/i, desc: '绝对用户路径 Windows' },
    { pattern: new RegExp('\\b' + 'GT' + 'MC' + '\\b', 'i'), desc: '组织标记' },
    { pattern: /E-\d{3}/i, desc: '内部工件编号 E-xxx' },
  ];

  for (const [file, content] of Object.entries(ALL_PUBLIC_DOCS)) {
    it(`${file} 不含私有来源/路径/标记`, () => {
      const found = FORBIDDEN_PRIVATE.filter(m => m.pattern.test(content));
      assert.deepEqual(found, [],
        `${file} 仍含私有内容: ${found.map(m => m.desc).join(', ')}`);
    });
  }
});

// ============================================================
// 10. runtime-contract 错误码必须匹配实现
// ============================================================

describe('10. runtime-contract 错误码与实现一致', () => {
  const RUNTIME_CONTRACT_PATHS = [
    'references/runtime-contract.md',
    'adapters/claude/references/runtime-contract.md',
    'adapters/codex/references/runtime-contract.md',
  ];

  // 实现真实导出的错误码
  const EXPECTED_ERROR_CODE = 'FLOW_ARCHITECT_RUNTIME_MISSING';

  for (const relPath of RUNTIME_CONTRACT_PATHS) {
    it(`${relPath} 错误码精确匹配 ${EXPECTED_ERROR_CODE}`, () => {
      const content = read(relPath);
      assert.match(content, new RegExp(EXPECTED_ERROR_CODE),
        `${relPath} 应包含真实错误码 ${EXPECTED_ERROR_CODE}`);
      assert.doesNotMatch(content, /RUNTIME_COMPONENT_MISSING/,
        `${relPath} 仍含旧错误码 RUNTIME_COMPONENT_MISSING，应为 ${EXPECTED_ERROR_CODE}`);
    });
  }
});

// ============================================================
// 11. canonical / Claude / Codex runtime-contract 字节一致
// ============================================================

describe('11. runtime-contract 三份副本字节一致', () => {
  const canonical = read('references/runtime-contract.md');
  const claude = read('adapters/claude/references/runtime-contract.md');
  const codex = read('adapters/codex/references/runtime-contract.md');

  it('canonical == claude adapter (字节一致)', () => {
    assert.equal(canonical, claude,
      'canonical 与 claude adapter 的 runtime-contract.md 内容不一致');
  });

  it('canonical == codex adapter (字节一致)', () => {
    assert.equal(canonical, codex,
      'canonical 与 codex adapter 的 runtime-contract.md 内容不一致');
  });
});
