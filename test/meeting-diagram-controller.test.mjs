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

function v2Draft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process_1', name: '采购审批流程', level: 'L4', is_leaf: true,
      description: '完成采购申请的审查与决策', purpose: '形成可执行的采购决定',
      owner: 'Role-process-owner', parent_process_name: '采购管理',
      inputs: ['采购申请'], outputs: ['审批结果'],
      start: { event_id: 'StartEvent_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'EndEvent_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_Review', name: '审核采购申请',
        description: '对采购需求和材料完整性进行业务审核',
        activity_type: 'STANDARD', responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-applicant', responsibility: 'R' }],
        sla: null, tools: ['ERP'], inputs: ['采购申请'],
        process_summary: '审核采购申请内容', outputs: ['审核结果'],
        completion_criteria: ['申请已审核'], references: [],
        main_task_id: 'Task_Review', confirmation: null, completeness: 'COMPLETE',
      },
      {
        activity_id: 'Activity_Approve', name: '批准采购',
        description: '批准已审核的采购申请',
        activity_type: 'STANDARD', responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-manager', responsibility: 'R' }],
        sla: null, tools: ['ERP'], inputs: ['审核结果'],
        process_summary: '批准采购申请', outputs: ['审批结果'],
        completion_criteria: ['审批结论已记录'], references: [],
        main_task_id: 'Task_Approve', confirmation: null, completeness: 'COMPLETE',
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
        { node_id: 'Task_Approve', node_type: 'MAIN_TASK', name: '批准采购', lane_id: 'Lane_Manager' },
        { node_id: 'EndEvent_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_Start_Review', source_ref: 'StartEvent_1', target_ref: 'Task_Review', condition: null },
        { flow_id: 'Flow_Review_Approve', source_ref: 'Task_Review', target_ref: 'Task_Approve', condition: null },
        { flow_id: 'Flow_Approve_End', source_ref: 'Task_Approve', target_ref: 'EndEvent_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_Review', main_task_id: 'Task_Review', confirmation_task_id: null },
        { activity_id: 'Activity_Approve', main_task_id: 'Task_Approve', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [
      { question_id: 'Q-001', text: '采购申请是否需要经理复核？', target_paths: ['Task_Review'], status: 'OPEN', answer: '' },
      { question_id: 'Q-002', text: '超过多少金额需要额外审批？', target_paths: ['Task_Approve'], status: 'OPEN', answer: '' },
    ],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

async function openFixture(t) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const draft = v2Draft();
  const { xml: bpmnXml } = compileBpmn(draft);
  const metadata = {
    schema_version: '2.0.0', package_id: 'procurement-approval',
    process_id: 'Process_1', title: '采购审批流程', revision: 'r01',
    based_on_revision: null, runtime_version: '2.0.0',
  };
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const runDir = makeRunDir('diagram-controller');
  const output = path.join(runDir, 'process-r01.html');
  fs.writeFileSync(output, html);
  await page.goto(pathToFileURL(output).href);
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  return { browser, page };
}

test('XOR branch creation rolls back all elements and sequence flows on failure', async t => {
  const { page } = await openFixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();

  const result = await page.evaluate(async () => {
    const app = window.__FLOW_ARCHITECT__;
    const beforeDraft = app.store.snapshot();
    const beforeXml = (await app.modeler.saveXML({ format: true })).xml;
    const beforeSelection = app.modeler.get('selection').get().map(element => element.id);
    const originalCompile = app.autoLayout.compileBpmn;
    app.autoLayout.compileBpmn = () => {
      throw new Error('模拟编译失败');
    };
    let message = '';
    try {
      await app.diagramController.appendGatewayBranch('XOR', '测试问题', '是', '否');
    } catch (e) {
      message = e.message;
    } finally {
      app.autoLayout.compileBpmn = originalCompile;
    }
    return {
      beforeDraft,
      afterDraft: app.store.snapshot(),
      beforeXml,
      afterXml: (await app.modeler.saveXML({ format: true })).xml,
      beforeSelection,
      afterSelection: app.modeler.get('selection').get().map(element => element.id),
      message,
    };
  });

  assert.match(result.message, /FA-DRAFT-LAYOUT-001.*结构变更失败.*模拟编译失败/);
  assert.deepEqual(result.afterDraft, result.beforeDraft);
  assert.equal(result.afterXml, result.beforeXml);
  assert.deepEqual(result.afterSelection, result.beforeSelection);
});

test('question pre-export validation rejects duplicate IDs', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const questions = store.snapshot().questions;
    questions[1].question_id = 'Q-001';
    store.restore({ ...store.snapshot(), questions });
  });
  const result = await page.evaluate(async () => {
    try {
      await window.__FLOW_ARCHITECT__.exportController.currentPayload();
      return { caught: false };
    } catch (e) {
      return { caught: true, message: e.message };
    }
  });
  assert.equal(result.caught, true);
  assert.match(result.message, /重复|duplicate/i);
});

test('question pre-export validation rejects empty question text', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const questions = store.snapshot().questions;
    questions[0].text = '';
    store.restore({ ...store.snapshot(), questions });
  });
  const result = await page.evaluate(async () => {
    try {
      await window.__FLOW_ARCHITECT__.exportController.currentPayload();
      return { caught: false };
    } catch (e) {
      return { caught: true, message: e.message };
    }
  });
  assert.equal(result.caught, true);
  assert.match(result.message, /不能为空|empty/i);
});

test('question status select shows Chinese labels', async t => {
  const { page } = await openFixture(t);
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="Q-001 状态"] option')].map(o => ({
      value: o.value, text: o.textContent,
    })));
  assert.deepEqual(options, [
    { value: 'OPEN', text: '待确认' },
    { value: 'CONFIRMED', text: '已确认' },
    { value: 'NOT_APPLICABLE', text: '不适用' },
  ]);
});
