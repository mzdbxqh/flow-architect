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
      start: { event_id: 'StartEvent_1', name: '收到采购申请', event_type: 'NONE' },
      end_results: [{ event_id: 'EndEvent_1', name: '采购申请已批准' }],
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

  const beforeXml = await page.evaluate(async () =>
    (await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true })).xml);

  await page.evaluate(() => {
    const dc = window.__FLOW_ARCHITECT__.diagramController;
    const origAppend = window.__FLOW_ARCHITECT__.modeler.get('autoPlace').append;
    let callCount = 0;
    window.__FLOW_ARCHITECT__.modeler.get('autoPlace').append = function (...args) {
      callCount++;
      if (callCount === 3) throw new Error('模拟第三步失败');
      return origAppend.apply(this, args);
    };
    try {
      dc.appendExclusiveBranch('测试问题', '是', '否');
    } catch (e) {
      // expected
    }
    window.__FLOW_ARCHITECT__.modeler.get('autoPlace').append = origAppend;
  });

  const afterXml = await page.evaluate(async () =>
    (await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true })).xml);

  const extractIds = (xml) => {
    const elements = new Set();
    const flows = new Set();
    for (const m of xml.matchAll(/id="(Task_|Gateway_|Activity_|StartEvent_|EndEvent_)[^"]*"/g)) elements.add(m[0]);
    for (const m of xml.matchAll(/id="Flow_[^"]*"/g)) flows.add(m[0]);
    for (const m of xml.matchAll(/id="SequenceFlow_[^"]*"/g)) flows.add(m[0]);
    return { elements, flows };
  };

  const before = extractIds(beforeXml);
  const after = extractIds(afterXml);
  assert.deepEqual(after.elements, before.elements);
  assert.deepEqual(after.flows, before.flows);
  assert.equal(afterXml, beforeXml);
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
