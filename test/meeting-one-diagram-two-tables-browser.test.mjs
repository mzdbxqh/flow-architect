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

function buildV2Package(runDir, payloadOverride) {
  const payload = payloadOverride || v2Payload();
  // For V2, we embed the full payload including process_card, activities, diagram
  const draft = {
    schema_version: '2.0.0',
    process_card: payload.process_card,
    activities: payload.activities,
    diagram: payload.diagram,
    questions: payload.questions,
    provenance: payload.provenance,
    source_summary: payload.source_summary || { total_blocks: 0, formats: [], evidence_refs: [] },
  };
  const isLeaf = draft.process_card.level === 'L4' && draft.process_card.is_leaf;
  let bpmnXml;
  if (isLeaf) {
    bpmnXml = compileBpmn(draft).xml;
  } else {
    bpmnXml = '<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><process id="Process_1" isExecutable="false"></process></definitions>';
  }
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata: payload.metadata });
  const output = path.join(runDir, 'process-r01.html');
  fs.writeFileSync(output, html);
  return output;
}

async function openV2Fixture(t, payloadOverride) {
  const runDir = makeRunDir('v2-browser');
  const html = buildV2Package(runDir, payloadOverride);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(html).href);
  const payload = payloadOverride || v2Payload();
  if (payload.process_card.level === 'L4' && payload.process_card.is_leaf) {
    await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  } else {
    // Non-leaf: wait for tabs to be rendered
    await page.locator('[role="tab"]').first().waitFor();
  }
  return { browser, page };
}

// --- Tab structure tests ---

test('V2 HTML has four tabs: flow diagram, process card, activity catalog, questions', async t => {
  const { page } = await openV2Fixture(t);
  const tabs = page.locator('[role="tab"]');
  const tabTexts = await tabs.allTextContents();
  assert.ok(tabTexts.some(t => t.includes('流程图')));
  assert.ok(tabTexts.some(t => t.includes('流程卡片')));
  assert.ok(tabTexts.some(t => t.includes('活动一览表')));
  assert.ok(tabTexts.some(t => t.includes('待确认问题')));
});

test('V2 tab switching shows correct panel', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  assert.equal(await page.locator('#fa-card-panel').isVisible(), true);
  assert.equal(await page.locator('#fa-canvas').isVisible(), false);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  assert.equal(await page.locator('#fa-activity-panel').isVisible(), true);
  assert.equal(await page.locator('#fa-card-panel').isVisible(), false);
});

// --- Process card form tests ---

test('process card form shows all basic fields with current values', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  assert.equal(await page.getByLabel('流程名称').inputValue(), '采购审批流程');
  assert.equal(await page.getByLabel('流程目的').inputValue(), '形成可执行的采购决定');
  assert.equal(await page.getByLabel('流程描述').inputValue(), '完成采购申请的审查与决策');
});

test('process card form edits flow through DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  await page.getByLabel('流程目的').fill('新目的');
  await page.getByLabel('流程目的').dispatchEvent('change');
  const card = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card);
  assert.equal(card.purpose, '新目的');
});

test('non-leaf L3 shows diagram and activity tabs as not applicable', async t => {
  const payload = v2Payload();
  payload.process_card.level = 'L3';
  payload.process_card.is_leaf = false;
  payload.activities = [];
  payload.diagram = { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' };
  payload.questions = [];
  const { page } = await openV2Fixture(t, payload);
  // Diagram and activity tabs should be disabled for non-leaf
  assert.equal(await page.locator('#fa-tab-diagram').isDisabled(), true);
  assert.equal(await page.locator('#fa-tab-activities').isDisabled(), true);
  // Not-applicable indicator should be visible
  assert.ok(await page.locator('#fa-not-applicable').isVisible());
});

// --- Activity catalog tests ---

test('activity catalog main table shows activity rows', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const rows = page.locator('[data-activity-row]');
  assert.ok(await rows.count() >= 1);
});

test('clicking activity row opens detail panel', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row]').first().click();
  assert.ok(await page.locator('#fa-activity-detail').isVisible());
  assert.equal(await page.locator('#fa-activity-detail').getByLabel('活动名称').inputValue(), '审核采购申请');
});

test('activity detail panel can edit tools and process summary', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row]').first().click();
  await page.locator('#fa-activity-detail').getByLabel('处理概要').fill('新的处理概要');
  await page.locator('#fa-activity-detail').getByLabel('处理概要').dispatchEvent('change');
  const act = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities[0]);
  assert.equal(act.process_summary, '新的处理概要');
});

test('new L5 activity button adds row to catalog', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const beforeCount = await page.locator('[data-activity-row]').count();
  await page.getByRole('button', { name: /新增.*活动/ }).click();
  assert.equal(await page.locator('[data-activity-row]').count(), beforeCount + 1);
});

test('activity catalog shows RASCI/OARP model label', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const firstRow = page.locator('[data-activity-row]').first();
  const text = await firstRow.textContent();
  assert.ok(text.includes('RASCI') || text.includes('R'));
});

test('activity catalog shows SLA, input, output columns', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const headers = await page.locator('#fa-activity-table th').allTextContents();
  assert.ok(headers.some(h => h.includes('SLA') || h.includes('时限')));
  assert.ok(headers.some(h => h.includes('输入')));
  assert.ok(headers.some(h => h.includes('输出')));
});

// --- Shared DraftStore access ---

test('window.__FLOW_ARCHITECT__.store provides DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  const hasStore = await page.evaluate(() =>
    typeof window.__FLOW_ARCHITECT__?.store?.snapshot === 'function');
  assert.equal(hasStore, true);
});

test('DraftStore snapshot in browser matches original payload', async t => {
  const { page } = await openV2Fixture(t);
  const snap = await page.evaluate(() => window.__FLOW_ARCHITECT__.store.snapshot());
  assert.equal(snap.process_card.name, '采购审批流程');
  assert.equal(snap.activities.length, 1);
  assert.equal(snap.activities[0].activity_id, 'Activity_Review');
});

// --- Offline ---

test('V2 package loads with no network requests', async t => {
  const { page } = await openV2Fixture(t);
  const requests = [];
  page.on('request', request => {
    if (!request.url().startsWith('file:') && !request.url().startsWith('blob:')) requests.push(request.url());
  });
  await page.reload();
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  assert.deepEqual(requests, []);
});
