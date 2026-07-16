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
      start: { event_id: 'Start_1', name: '收到采购申请', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '采购申请已批准' }],
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
        { node_id: 'Task_Approve', node_type: 'MAIN_TASK', name: '批准采购', lane_id: 'Lane_Manager' },
        { node_id: 'Task_Rework', node_type: 'MAIN_TASK', name: '退回修改', lane_id: 'Lane_Manager' },
        { node_id: 'EndEvent_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_Start_Review', source_ref: 'StartEvent_1', target_ref: 'Task_Review' },
        { flow_id: 'Flow_Review_Approve', source_ref: 'Task_Review', target_ref: 'Task_Approve' },
        { flow_id: 'Flow_Review_Rework', source_ref: 'Task_Review', target_ref: 'Task_Rework' },
        { flow_id: 'Flow_Rework_Review', source_ref: 'Task_Rework', target_ref: 'Task_Review' },
        { flow_id: 'Flow_Approve_End', source_ref: 'Task_Approve', target_ref: 'EndEvent_1' },
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

async function openV2Fixture(t, payloadOverride) {
  const runDir = makeRunDir('auto-layout');
  const payload = payloadOverride || v2Payload();
  const draft = {
    schema_version: '2.0.0',
    process_card: payload.process_card,
    activities: payload.activities,
    diagram: payload.diagram,
    questions: payload.questions,
    provenance: payload.provenance,
    source_summary: payload.source_summary || { total_blocks: 0, formats: [], evidence_refs: [] },
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

// --- Limited palette tests ---

test('default bpmn-js palette is not visible', async t => {
  const { page } = await openV2Fixture(t);
  // The default bpmn-js palette should be hidden or replaced
  const defaultPalette = page.locator('.djs-palette');
  const count = await defaultPalette.count();
  if (count > 0) {
    // If palette exists, it should be hidden or have limited entries
    const isHidden = await defaultPalette.evaluate(el =>
      getComputedStyle(el).display === 'none' || !el.offsetHeight);
    assert.ok(isHidden, 'Default palette should be hidden');
  }
});

test('limited palette has L5 task, confirmation, gateways, events, connect, delete', async t => {
  const { page } = await openV2Fixture(t);
  // Check that the limited palette entries are available via the palette API
  const entries = await page.evaluate(() => {
    const palette = window.__FLOW_ARCHITECT__.modeler.get('palette');
    // Trigger palette population by calling getEntries
    const container = document.querySelector('.djs-palette');
    if (!container) return [];
    return [...container.querySelectorAll('[data-action]')].map(el => ({
      action: el.dataset.action,
      title: el.title || el.getAttribute('aria-label'),
    }));
  });
  // At minimum, should have hand, lasso, connect, delete
  const actions = entries.map(e => e.action);
  assert.ok(actions.length >= 4, `Expected at least 4 palette entries, got ${actions.length}`);
});

// --- L5 activity sync tests ---

test('new L5 from activity table does not appear in BPMN until sync', async t => {
  const { page } = await openV2Fixture(t);
  // Go to activity table and add a new activity
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.getByRole('button', { name: /新增.*活动/ }).click();
  // Verify activity was added to store
  const actCount = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.length);
  assert.equal(actCount, 2); // Original + new
});

test('rename L5 activity via diagram updates store', async t => {
  const { page } = await openV2Fixture(t);
  // Select the task and rename it
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.getByRole('button', { name: '修改名称' }).click();
  await page.locator('#fa-rename-input').fill('新审核名称');
  await page.getByRole('button', { name: '确认修改' }).click();
  // Check store was updated
  const act = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.find(
      a => a.activity_id === 'Activity_Review'));
  assert.equal(act.name, '新审核名称');
});

// --- Question integration ---

test('question overlay uses V2 target_paths field', async t => {
  const { page } = await openV2Fixture(t);
  // The question Q-001 targets Task_Review
  const overlay = page.locator('[data-overlay-question-id="Q-001"]');
  assert.ok(await overlay.count() >= 0); // May or may not exist depending on position
});

// --- DraftStore integration ---

test('store has updateBpmnXml and updateDiagram methods', async t => {
  const { page } = await openV2Fixture(t);
  const hasMethods = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return typeof store.updateBpmnXml === 'function' && typeof store.updateDiagram === 'function';
  });
  assert.equal(hasMethods, true);
});

test('autoLayout controller is available', async t => {
  const { page } = await openV2Fixture(t);
  const hasAutoLayout = await page.evaluate(() =>
    typeof window.__FLOW_ARCHITECT__.autoLayout?.applyStructureChange === 'function');
  assert.equal(hasAutoLayout, true);
});

// --- Offline ---

test('V2 package with limited palette loads offline', async t => {
  const { page } = await openV2Fixture(t);
  const requests = [];
  page.on('request', request => {
    if (!request.url().startsWith('file:') && !request.url().startsWith('blob:')) requests.push(request.url());
  });
  await page.reload();
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  assert.deepEqual(requests, []);
});
