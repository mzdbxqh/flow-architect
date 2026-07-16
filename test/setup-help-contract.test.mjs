import assert from 'node:assert/strict';
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
  assert.match(body, /flow-architect`=只读盘点输入并自动路由/);
  assert.match(body, /组件 ID 是 `pdf`、包名是 `pdfjs-dist`/);
  assert.match(body, /不得把任何入口描述成建模、生成、渲染或自动修复/);
  assert.match(body, /不得显示解析后的插件绝对路径/);
  assert.match(body, /不得建议向插件目录安装依赖/);
  assert.match(body, /不得改写成 `OK`/);
  assert.match(body, /零写入/);
  assert.match(body, /零联网/);
});

test('Claude setup command is manual and enforces plan-confirm-install-doctor', () => {
  const { frontmatter, body } = command('setup');
  assert.match(frontmatter.description, /初始化|安装/);
  assert.equal(frontmatter['disable-model-invocation'], 'true');
  assert.match(frontmatter['allowed-tools'], /runtime-manager\.mjs/);
  assert.match(body, /默认.*core|core.*默认/s);
  for (const component of ['pdf', 'docx', 'xlsx']) assert.match(body, new RegExp(component));
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
  assert.match(setup.body, /不得自动触发/);
  assert.match(setup.body, /默认.*core|core.*默认/s);
  assert.match(setup.body, /plan_sha256/);
  assert.match(setup.body, /用户.*明确确认|明确确认.*用户/s);
  assert.doesNotMatch(setup.body, /所有写入操作.*runDir/);
});

test('published dependency declaration keeps exact core and test-only optional packages', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.dependencies, {
    ajv: '8.20.0',
    'ajv-formats': '3.0.1',
    'fast-xml-parser': '4.5.7',
    yaml: '2.9.0',
  });
  assert.deepEqual(pkg.devDependencies, {
    '@playwright/test': '1.61.1',
    'bpmn-js': '18.21.0',
    'esbuild': '0.28.1',
    'exceljs': '4.4.0',
    'mammoth': '1.12.0',
    'pdfjs-dist': '4.10.38',
  });
});

test('Chinese guide documents the supported Marketplace setup path for v0.1.2', () => {
  const guide = read('docs/zh-CN/user-guide.md');
  assert.match(guide, /\/plugin marketplace add mzdbxqh\/flow-architect/);
  assert.match(guide, /\/plugin install flow-architect@flow-architect/);
  assert.match(guide, /\/reload-plugins/);
  assert.match(guide, /\/flow-architect:help/);
  assert.match(guide, /\/flow-architect:setup/);
  assert.match(guide, /默认安装.*core|core.*默认安装/s);
  assert.match(guide, /可选.*PDF.*DOCX.*XLSX/s);
  assert.doesNotMatch(guide, /v0\.1\.1/);
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
