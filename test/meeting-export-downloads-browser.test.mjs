/**
 * 辅助导出按钮端到端测试（覆盖缺口补全）
 *
 * 定位：画面内改动之后，四个辅助导出都必须产出正确内容。
 * 1. 导出 BPMN：文件名正确、内容反映画面改动、且能被 BPMN 2.0 工具重新导入
 * 2. 导出 SVG：文件名正确、内容为可解析的 SVG
 * 3. 导出问题：文件名正确、JSON 可解析且反映问题页的回答与状态改动
 * 4. 导出完整 JSON：文件名正确、携带修订链与全部业务字段
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { makeRunDir } from './helpers/fixture.mjs';
import { buildMeetingPackageHtml } from '../scripts/lib/meeting-package-html.mjs';
import { compileBpmn } from '../scripts/lib/bpmn-compiler.mjs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function v2Payload() {
  return {
    metadata: {
      schema_version: '2.0.0',
      package_id: 'procurement-approval',
      process_id: 'Process_1',
      title: '采购审批流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
      content_hash: 'sha256:placeholder',
    },
    process_card: {
      process_id: 'Process_1',
      name: '采购审批流程',
      level: 'L4',
      is_leaf: true,
      description: '完成采购申请的审查与决策',
      purpose: '形成可执行的采购决定',
      owner: 'Role-process-owner',
      parent_process_name: '采购管理',
      inputs: ['采购申请'],
      outputs: ['审批结果'],
      start: { event_id: 'StartEvent_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'EndEvent_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_Review',
        name: '审核采购申请',
        description: '对采购需求和材料完整性进行业务审核',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-applicant', responsibility: 'R' }],
        sla: null,
        tools: ['ERP'],
        inputs: ['采购申请'],
        process_summary: '审核采购申请内容',
        outputs: ['审核结果'],
        completion_criteria: ['申请已审核'],
        references: [],
        main_task_id: 'Task_Review',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane_Applicant', name: '申请人', role_id: 'Role-applicant' },
        { lane_id: 'Lane_Manager', name: '经理', role_id: 'Role-manager' },
      ],
      nodes: [
        { node_id: 'StartEvent_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_Review', node_type: 'MAIN_TASK', name: '审核采购申请', lane_id: 'Lane_Applicant' },
        { node_id: 'EndEvent_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_Start_Review', source_ref: 'StartEvent_1', target_ref: 'Task_Review', condition: null },
        { flow_id: 'Flow_Review_End', source_ref: 'Task_Review', target_ref: 'EndEvent_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_Review', main_task_id: 'Task_Review', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [
      {
        question_id: 'Q-001',
        text: '采购申请是否需要经理复核？',
        target_paths: ['Task_Review'],
        status: 'OPEN',
        answer: '',
      },
    ],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

async function openV2Fixture(t) {
  const runDir = makeRunDir('export-downloads');
  const payload = v2Payload();
  const draft = {
    schema_version: '2.0.0',
    process_card: payload.process_card,
    activities: payload.activities,
    diagram: payload.diagram,
    questions: payload.questions,
    provenance: payload.provenance,
    source_summary: payload.source_summary,
  };
  const { xml: bpmnXml } = compileBpmn(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata: payload.metadata });
  const output = path.join(runDir, 'process-r01.html');
  fs.writeFileSync(output, html);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(output).href);
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  return { browser, page };
}

async function clickExport(page, name) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const item = await downloadPromise;
  const filePath = await item.path();
  return { filename: item.suggestedFilename(), content: fs.readFileSync(filePath, 'utf8') };
}

test('导出 BPMN：反映画面改名且可被 BPMN 2.0 工具重新导入', async t => {
  const { page } = await openV2Fixture(t);

  // 画面内改动：选中活动并改名
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.getByRole('button', { name: '修改名称' }).click();
  await page.locator('#fa-rename-input').fill('复核采购申请');
  await page.getByRole('button', { name: '确认修改' }).click();

  const { filename, content } = await clickExport(page, '导出 BPMN');
  assert.equal(filename, '采购审批流程-r02.bpmn');
  assert.match(content, /<(bpmn:)?definitions/, '应为 BPMN 2.0 XML');
  assert.ok(content.includes('复核采购申请'), '导出的 BPMN 必须包含画面上的改名');
  assert.ok(content.includes('Task_Review'), '导出的 BPMN 必须包含活动节点 ID');

  // 关键校验：导出的 XML 能被一个全新的 BPMN 2.0 建模器重新导入
  const reimport = await page.evaluate(async (xml) => {
    try {
      const ModelerCtor = window.__FLOW_ARCHITECT__.modeler.constructor;
      const host = document.createElement('div');
      host.style.cssText = 'width:800px;height:600px;position:absolute;left:-9999px;top:0;';
      document.body.appendChild(host);
      const m2 = new ModelerCtor({ container: host });
      await m2.importXML(xml);
      const found = Boolean(m2.get('elementRegistry').get('Task_Review'));
      m2.destroy();
      host.remove();
      return { ok: found };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, content);
  assert.ok(reimport.ok, `导出的 BPMN 应可被重新导入: ${reimport.error || '元素缺失'}`);
});

test('导出 SVG：文件名正确且内容为可解析的 SVG', async t => {
  const { page } = await openV2Fixture(t);
  const { filename, content } = await clickExport(page, '导出 SVG');
  assert.equal(filename, '采购审批流程-r02.svg');
  assert.ok(content.includes('<svg'), '导出内容应为 SVG');

  const parsed = await page.evaluate((svgText) => {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    return {
      hasError: Boolean(doc.querySelector('parsererror')),
      rootTag: doc.documentElement?.tagName,
    };
  }, content);
  assert.equal(parsed.hasError, false, 'SVG 应可被 XML 解析');
  assert.equal(parsed.rootTag, 'svg');
});

test('导出问题：JSON 可解析且反映问题页的回答与状态改动', async t => {
  const { page } = await openV2Fixture(t);

  // 画面内改动：回答问题并标记已确认
  await page.getByRole('tab', { name: /待确认问题/ }).click();
  await page.getByLabel('Q-001 回答').fill('由采购经理复核');
  await page.getByLabel('Q-001 状态').selectOption('CONFIRMED');

  const { filename, content } = await clickExport(page, '导出问题');
  assert.equal(filename, '采购审批流程-r02-questions.json');
  const questions = JSON.parse(content);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].question_id, 'Q-001');
  assert.equal(questions[0].answer, '由采购经理复核', '导出的问题必须包含页面上的回答');
  assert.equal(questions[0].status, 'CONFIRMED', '导出的问题必须包含页面上的状态改动');
});

test('导出完整 JSON：携带修订链与全部业务字段', async t => {
  const { page } = await openV2Fixture(t);
  const { filename, content } = await clickExport(page, '导出完整 JSON');
  assert.equal(filename, '采购审批流程-r02-full.json');

  const payload = JSON.parse(content);
  assert.equal(payload.metadata.revision, 'r02', '完整 JSON 应为下一修订号');
  assert.equal(payload.metadata.based_on_revision, 'r01', '完整 JSON 应携带修订链');
  assert.ok(payload.metadata.content_hash?.length > 10, '应携带 content_hash');
  for (const field of ['process_card', 'activities', 'diagram', 'questions', 'provenance', 'source_summary', 'bpmn_xml']) {
    assert.ok(payload[field] !== undefined && payload[field] !== null, `缺少业务字段: ${field}`);
  }
  assert.equal(payload.activities[0].name, '审核采购申请');
  assert.match(payload.bpmn_xml, /<(bpmn:)?definitions/);
});

test('schema 门禁：非法草稿真实点击导出被阻断并提示中文错误', async t => {
  const { page } = await openV2Fixture(t);

  // 破坏业务合同：清空活动名称（不走 UI，直接改 store）
  await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const snapshot = store.snapshot();
    snapshot.activities[0].name = '';
    store.restore({ ...snapshot });
  });

  const alertPromise = new Promise(resolve => {
    const handler = async dialog => {
      page.removeListener('dialog', handler);
      resolve(dialog.message());
      await dialog.accept();
    };
    page.on('dialog', handler);
  });
  await page.getByRole('button', { name: '导出新版本' }).click();
  const alertMsg = await alertPromise;
  assert.match(alertMsg, /FA-DRAFT-SCHEMA-001/, '非法草稿应被预编译校验器阻断');
});
