import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseFrontmatter } from './helpers/frontmatter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function command(name) {
  return parseFrontmatter(read(`commands/${name}.md`));
}

test('Claude help command is discoverable and read-only', () => {
  const { frontmatter, body } = command('help');
  assert.match(frontmatter.description, /帮助|能力|状态/);
  assert.match(frontmatter['allowed-tools'], /runtime-manager\.mjs/);
  assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/runtime-manager\.mjs" check --json/);
  assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/runtime-manager\.mjs" doctor --json/);
  assert.doesNotMatch(body, /runtime-manager\.mjs" install/);
  assert.doesNotMatch(body, /runtime-manager\.mjs" plan/);
  assert.match(body, /flow-architect`=只读盘点输入并自动路由/);
  assert.match(body, /组件 ID 是 `pdf`、包名是 `pdfjs-dist`/);
  assert.match(body, /不得把只读评审入口描述成建模、生成、渲染或自动修复/);
  assert.match(body, /不得把创建入口描述为修改原始输入或自动修复/);
  assert.match(body, /不得显示解析后的插件绝对路径/);
  assert.match(body, /不得建议向插件目录安装依赖/);
  assert.match(body, /不得改写成 `OK`/);
  assert.match(body, /零写入/);
  assert.match(body, /零联网/);
  assert.match(body, /draft-process/);
  assert.match(body, /build-meeting-package/);
  assert.match(body, /独立运行目录创建新制品/);
  assert.match(body, /不修改原始输入/);
});

test('Claude help command reports v0.4.1 and the three fixed entries from the shared catalog', () => {
  const { body } = command('help');
  assert.match(body, /v0\.4\.1/, 'help 必须报告 v0.4.1');
  assert.doesNotMatch(body, /v0\.3\.0/, 'help 不得再报告 v0.3.0 旧当前版本');
  assert.doesNotMatch(body, /v0\.4\.0/, 'help 不得再报告 v0.4.0 旧当前版本');
  assert.match(body, /\/flow-architect:quickstart/, 'help 必须列出 quickstart 入口');
  assert.match(body, /\/flow-architect:setup/, 'help 必须列出 setup 入口');
  assert.match(body, /\/flow-architect:help/, 'help 必须列出 help 入口');
  assert.match(body, /capability-catalog\.json/, 'help 必须从共享能力目录列出公共方法');
  assert.match(body, /Kimi/, 'help 必须说明 Kimi Code 投影边界');
});

test('R1: Claude help command really consumes the shared catalog via read-only --enumerate only', () => {
  const { frontmatter, body } = command('help');
  const allowed = frontmatter['allowed-tools'];

  // 权限只放行精确的只读枚举调用
  assert.match(
    allowed,
    /Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/quickstart-route\.mjs" --enumerate\)/,
    'help 权限必须放行 quickstart-route.mjs --enumerate 精确调用'
  );
  assert.doesNotMatch(allowed, /quickstart-route\.mjs" \*/, 'help 不得放行 quickstart-route 通配调用');
  assert.doesNotMatch(allowed, /quickstart-route\.mjs"[^)]*--request/, 'help 不得放行 --request 路由模式');
  assert.doesNotMatch(allowed, /--request-file/, 'help 不得放行 --request-file 路由模式');
  assert.doesNotMatch(allowed, /runtime-manager\.mjs" install/, 'help 仍不得放行 install');
  assert.doesNotMatch(allowed, /runtime-manager\.mjs" plan/, 'help 仍不得放行 plan');

  // 正文要求运行时真实执行该枚举命令
  assert.match(
    body,
    /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/quickstart-route\.mjs" --enumerate/,
    'help 正文必须包含可执行的 --enumerate 命令'
  );
  assert.match(body, /只允许.*--enumerate/s, 'help 必须声明只允许 --enumerate');
  assert.match(body, /不得使用.*--request/s, 'help 必须禁止 --request 路由模式');
  assert.match(body, /stdin|标准输入/, 'help 必须禁止 stdin 路由模式');
  assert.doesNotMatch(body, /quickstart-route\.mjs" --request/, 'help 正文不得示范路由调用');
  assert.doesNotMatch(body, /quickstart-route\.mjs" --paths/, 'help 正文不得示范路径分类调用');

  // 展示的稳定公共方法必须以枚举输出为准，不另造重复目录
  assert.match(body, /枚举输出|枚举结果|以.*--enumerate.*为准/s, 'help 必须以枚举输出为公共方法来源');
});

test('R1: canonical help skill fixed flow runs the read-only catalog enumeration', () => {
  const { body } = parseFrontmatter(read('skills/flow-architect-help/SKILL.md'));

  assert.match(
    body,
    /node "\$PLUGIN_ROOT\/scripts\/quickstart-route\.mjs" --enumerate/,
    'canonical help 技能固定流程必须包含 --enumerate 只读枚举命令'
  );
  assert.match(body, /只允许.*--enumerate/s, 'canonical help 技能必须声明只允许 --enumerate');
  assert.match(body, /不得使用.*--request/s, 'canonical help 技能必须禁止 --request 路由模式');
  assert.doesNotMatch(body, /quickstart-route\.mjs" --request/, 'canonical help 技能不得示范路由调用');
  assert.doesNotMatch(body, /quickstart-route\.mjs" --paths/, 'canonical help 技能不得示范路径分类调用');
  assert.doesNotMatch(body, /runtime-manager\.mjs" install/);
  assert.doesNotMatch(body, /runtime-manager\.mjs" plan/);
});

test('R1: the enumeration call permitted to help is real and emits the shared capability catalog', () => {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'quickstart-route.mjs'), '--enumerate'],
    { encoding: 'utf8' }
  );
  const enumerated = JSON.parse(out);
  assert.equal(enumerated.plugin_name, 'flow-architect');
  assert.equal(enumerated.plugin_version, '0.4.1');
  assert.equal(enumerated.methods.length, 5, '枚举必须输出目录中的全部稳定公共方法');
  assert.ok(Array.isArray(enumerated.fixed_entries) && enumerated.fixed_entries.length === 3);
});

test('R1: help skill/command adapter copies stay byte-identical to canonical', () => {
  const canonicalSkill = read('skills/flow-architect-help/SKILL.md');
  assert.equal(read('adapters/claude/skills/flow-architect-help/SKILL.md'), canonicalSkill);
  assert.equal(read('adapters/codex/skills/flow-architect-help/SKILL.md'), canonicalSkill);
  const canonicalCommand = read('commands/help.md');
  assert.equal(read('adapters/claude/commands/help.md'), canonicalCommand);
});

test('Claude setup command is manual and enforces plan-confirm-install-doctor', () => {
  const { frontmatter, body } = command('setup');
  assert.match(frontmatter.description, /初始化|安装/);
  assert.equal(frontmatter['disable-model-invocation'], 'true');
  assert.match(frontmatter['allowed-tools'], /runtime-manager\.mjs/);
  assert.match(body, /默认.*core|core.*默认/s);
  for (const component of ['pdf', 'docx', 'xlsx', 'pptx']) assert.match(body, new RegExp(component));
  const check = body.indexOf(' check --json');
  const plan = body.indexOf(' plan --components');
  const confirm = body.indexOf('明确确认', plan);
  const install = body.indexOf(' install --components');
  const doctor = body.indexOf(' doctor --json');
  assert.ok(check >= 0 && check < plan, 'check 必须先于 plan');
  assert.ok(plan < confirm && confirm < install, '必须展示 plan 并明确确认后才能 install');
  assert.ok(install < doctor, 'install 后必须 doctor');
  assert.match(body, /--accept-plan\s+<plan_sha256>/);
  assert.match(body, /取消.*无副作用|拒绝.*无副作用/s);
  assert.match(body, /core 启用 BPMN、SVG、JSON、YAML、Markdown/);
  assert.match(body, /不得用笼统的 XML 代替 BPMN\/SVG/);
  assert.match(body, /请只读评审 <架构文件> 与 <流程图文件>/);
});

test('setup command components are exactly consistent with runtime/manifest.json', () => {
  const manifest = JSON.parse(read('runtime/manifest.json'));
  const manifestNames = manifest.components.map(c => c.name);
  assert.deepEqual(manifestNames, ['core', 'pdf', 'docx', 'xlsx', 'pptx'], 'manifest 必须精确包含五组件');

  const { body } = command('setup');
  assert.match(body, /core,pdf,docx,xlsx,pptx/, 'setup 组件排序必须与 manifest 一致');
  for (const name of manifestNames) {
    assert.match(body, new RegExp(`\`${name}\``), `setup 必须列出组件 ${name}`);
  }
  const skill = read('skills/flow-architect-setup/SKILL.md');
  for (const name of manifestNames) {
    assert.match(skill, new RegExp(`\`${name}\``), `setup 技能必须列出组件 ${name}`);
  }
  assert.match(skill, /core,pdf,docx,xlsx,pptx/, 'setup 技能组件排序必须与 manifest 一致');
});

test('Codex help/setup skills keep discovery and side-effect boundaries explicit', () => {
  const help = parseFrontmatter(read('skills/flow-architect-help/SKILL.md'));
  const setup = parseFrontmatter(read('skills/flow-architect-setup/SKILL.md'));
  assert.equal(help.frontmatter.name, 'flow-architect-help');
  assert.match(help.body, /零写入/);
  assert.match(help.body, /零联网/);
  assert.match(help.body, /SKILL\.md.*向上两级|向上两级.*SKILL\.md/s);
  assert.doesNotMatch(help.body, /所有写入操作.*runDir/);
  assert.equal(setup.frontmatter.name, 'flow-architect-setup');
  assert.match(setup.frontmatter.description, /user explicitly asks|用户明确要求|仅在用户/);
  assert.match(setup.frontmatter.description, /PPTX|pptx/, 'setup 描述必须覆盖 PPTX 可选组件');
  assert.match(setup.body, /不得自动触发/);
  assert.match(setup.body, /默认.*core|core.*默认/s);
  assert.match(setup.body, /plan_sha256/);
  assert.match(setup.body, /用户.*明确确认|明确确认.*用户/s);
  assert.doesNotMatch(setup.body, /所有写入操作.*runDir/);
  assert.match(setup.body, /不得写插件目录或业务输入目录/);
});

test('Codex quickstart skill is a formal routing entry discoverable by skills', () => {
  const quickstart = parseFrontmatter(read('skills/flow-architect-quickstart/SKILL.md'));
  assert.equal(quickstart.frontmatter.name, 'flow-architect-quickstart');
  assert.match(quickstart.frontmatter.description, /当.*时|需要.*时|用于/);
  assert.match(quickstart.body, /SKILL\.md.*向上两级|向上两级.*SKILL\.md/s);
  assert.match(quickstart.body, /正式人类业务入口|正式.*业务入口/s, 'quickstart 必须声明为正式人类业务入口');
  assert.match(quickstart.body, /不是教程|并非教程|不降低/, 'quickstart 必须说明不降低业务范围与验证强度');
});

test('published dependency declaration keeps exact core and test-only optional packages', () => {
  const pkg = JSON.parse(read('package.json'));

  // 顶层 package.json 不应有 dependencies 字段（运行时包在 devDependencies 中）
  assert.ok(!pkg.dependencies, '顶层 package.json 不应有 dependencies 字段');

  // 验证 devDependencies 包含所有运行时包
  const expectedDevDependencies = {
    'ajv': '8.20.0',
    'ajv-formats': '3.0.1',
    'fast-xml-parser': '4.5.7',
    'yaml': '2.9.0',
    '@playwright/test': '1.61.1',
    'bpmn-js': '18.21.0',
    'esbuild': '0.28.1',
    'exceljs': '4.4.0',
    'jszip': '3.10.1',
    'mammoth': '1.12.0',
    'pdfjs-dist': '4.10.38',
  };

  for (const [pkgName, version] of Object.entries(expectedDevDependencies)) {
    assert.equal(
      pkg.devDependencies[pkgName],
      version,
      `devDependencies.${pkgName} 版本应为 ${version}，实际为 ${pkg.devDependencies[pkgName]}`
    );
  }
});

test('Chinese guide documents the supported Marketplace setup path for v0.4.1', () => {
  const guide = read('docs/zh-CN/user-guide.md');
  assert.match(guide, /\/plugin marketplace add mzdbxqh\/flow-architect/);
  assert.match(guide, /\/plugin install flow-architect@flow-architect/);
  assert.match(guide, /\/reload-plugins/);
  assert.match(guide, /\/flow-architect:help/);
  assert.match(guide, /\/flow-architect:setup/);
  assert.match(guide, /\/flow-architect:quickstart/, '用户手册必须介绍 quickstart 入口');
  assert.match(guide, /默认安装.*core|core.*默认安装/s);
  assert.match(guide, /可选.*PDF.*DOCX.*XLSX.*PPTX/s, '用户手册可选组件必须包含 PPTX');
  assert.match(guide, /v0\.4\.1/, '用户手册安装引用必须为当前版本 v0.4.1');
  assert.doesNotMatch(guide, /v0\.1\.1/);
  assert.doesNotMatch(guide, /v0\.1\.2/);
  assert.doesNotMatch(guide, /Claude Code 当前推荐使用源码目录加载/);
  assert.doesNotMatch(guide, /claude --plugin-dir [“”]/);
});

test('top-level installation documents do not advertise the superseded v0.1.1 path', () => {
  for (const file of ['README.zh-CN.md', 'INSTALL.md']) {
    const content = read(file);
    assert.doesNotMatch(content, /v0\.1\.1/, `${file} must not reference the superseded release`);
    assert.match(content, /plugin marketplace add mzdbxqh\/flow-architect/);
    assert.match(content, /flow-architect:setup/);
  }
});

test('stable install references use current version v0.4.1 across README.zh-CN, INSTALL, user-guide, help command and help skill', () => {
  const filesWithVersion = [
    { file: 'README.zh-CN.md', content: read('README.zh-CN.md') },
    { file: 'INSTALL.md', content: read('INSTALL.md') },
    { file: 'docs/zh-CN/user-guide.md', content: read('docs/zh-CN/user-guide.md') },
    { file: 'commands/help.md', content: read('commands/help.md') },
    { file: 'skills/flow-architect-help/SKILL.md', content: read('skills/flow-architect-help/SKILL.md') },
  ];
  for (const { file, content } of filesWithVersion) {
    assert.doesNotMatch(content, /v0\.2\.0/, `${file} must not reference the superseded v0.2.0`);
    assert.match(content, /v0\.4\.1/, `${file} must reference the current version v0.4.1`);
  }
});

test('help surfaces no superseded current version (v0.3.0/v0.4.0)', () => {
  for (const file of ['commands/help.md', 'skills/flow-architect-help/SKILL.md']) {
    const content = read(file);
    assert.doesNotMatch(content, /v0\.3\.0/, `${file} must not display superseded v0.3.0`);
    assert.doesNotMatch(content, /v0\.4\.0/, `${file} must not display superseded v0.4.0`);
    assert.match(content, /v0\.4\.1/, `${file} must display current v0.4.1`);
  }
});
