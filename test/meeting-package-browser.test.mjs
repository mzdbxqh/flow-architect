/**
 * meeting-package-browser.test.mjs - V2 四页签/一图两表闭环测试
 *
 * 覆盖：四页签结构、流程卡片编辑、活动一览表编辑、
 * 图表同步、导出 r02、重新打开、精确 diff、离线、dirty 状态。
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

function buildV2Package(runDir, payloadOverride, options = {}) {
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

  let bpmnXml;
  if (options.skipBpmnCompile) {
    // 非末端 L3 流程不使用图，生成一个空的 BPMN
    bpmnXml = '<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><process id="Process_1" isExecutable="false"></process></definitions>';
  } else {
    const result = compileBpmn(draft);
    bpmnXml = result.xml;
  }

  const metadata = {
    package_id: payload.metadata.package_id,
    process_id: payload.metadata.process_id,
    title: payload.metadata.title,
    revision: payload.metadata.revision,
    based_on_revision: payload.metadata.based_on_revision,
  };
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const output = path.join(runDir, 'process-r01.html');
  fs.writeFileSync(output, html);
  return output;
}

async function openV2Fixture(t, payloadOverride, options = {}) {
  const runDir = makeRunDir('v2-e2e');
  const html = buildV2Package(runDir, payloadOverride, options);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(html).href);
  const payload = payloadOverride || v2Payload();
  if (payload.process_card.level === 'L4' && payload.process_card.is_leaf) {
    await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  } else {
    await page.locator('[role="tab"]').first().waitFor();
  }
  return { browser, page, runDir };
}

async function assertExportable(page) {
  const result = await page.evaluate(async () => {
    try {
      await window.__FLOW_ARCHITECT__.exportController.currentPayload();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  assert.equal(result.ok, true, `导出门禁失败：${result.message || ''}`);
}

// ===== 四页签结构 =====

test('V2 HTML has four tabs: diagram, card, activities, questions', async t => {
  const { page } = await openV2Fixture(t);
  const tabTexts = await page.locator('[role="tab"]').allTextContents();
  assert.ok(tabTexts.some(t => t.includes('流程图')));
  assert.ok(tabTexts.some(t => t.includes('流程卡片')));
  assert.ok(tabTexts.some(t => t.includes('活动一览表')));
  assert.ok(tabTexts.some(t => t.includes('待确认问题')));
});

test('meeting package does not expose bpmn-js-only undo or redo controls', async t => {
  const { page } = await openV2Fixture(t);
  assert.equal(await page.locator('#fa-undo').count(), 0);
  assert.equal(await page.locator('#fa-redo').count(), 0);
});

test('tab switching shows correct panel and hides others', async t => {
  const { page } = await openV2Fixture(t);
  // Switch to card tab
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  assert.equal(await page.locator('#fa-card-panel').isVisible(), true);
  // Switch to activity tab
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  assert.equal(await page.locator('#fa-activity-panel').isVisible(), true);
  // Switch to questions tab
  await page.getByRole('tab', { name: /待确认问题/ }).click();
  assert.equal(await page.locator('#fa-questions-panel').isVisible(), true);
  // Switch back to diagram
  await page.getByRole('tab', { name: /流程图/ }).click();
  assert.equal(await page.locator('#fa-diagram-panel').isVisible(), true);
});

// ===== 流程卡片编辑 =====

test('process card shows all fields and edits flow through DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  // Check current values
  assert.equal(await page.getByLabel('流程名称').inputValue(), '采购审批流程');
  assert.equal(await page.getByLabel('流程目的').inputValue(), '形成可执行的采购决定');
  // Edit purpose
  await page.getByLabel('流程目的').fill('新采购决定');
  await page.getByLabel('流程目的').dispatchEvent('change');
  const card = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card);
  assert.equal(card.purpose, '新采购决定');
});

test('process hierarchy and leaf status are read-only inside a meeting package', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  assert.equal(await page.getByLabel('流程层级').isDisabled(), true);
  assert.equal(await page.getByLabel('末端流程').isDisabled(), true);
});

// ===== 活动一览表编辑 =====

test('activity catalog shows RASCI/OARP, SLA, tools, inputs, outputs', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const headers = await page.locator('#fa-activity-table th').allTextContents();
  assert.ok(headers.some(h => h.includes('SLA') || h.includes('时限')));
  assert.ok(headers.some(h => h.includes('输入')));
  assert.ok(headers.some(h => h.includes('输出')));
  // Click activity row to open detail
  await page.locator('[data-activity-row]').first().click();
  assert.ok(await page.locator('#fa-activity-detail').isVisible());
  // Edit process summary
  await page.locator('#fa-activity-detail').getByLabel('处理概要').fill('新处理概要');
  await page.locator('#fa-activity-detail').getByLabel('处理概要').dispatchEvent('change');
  const act = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities[0]);
  assert.equal(act.process_summary, '新处理概要');
});

test('switching activity type also converts the accountable responsibility code', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row="Activity_Review"]').click();
  await page.locator('#fa-activity-detail').getByLabel('活动类型').selectOption('REVIEW_MEETING');
  const activity = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities[0]);
  assert.equal(activity.responsibility_model, 'OARP');
  assert.equal(
    activity.role_assignments.filter(role => role.responsibility === 'O').length,
    1,
  );
});

test('renaming an activity in the catalog synchronizes its MAIN_TASK without relayout', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row="Activity_Review"]').click();
  const nameInput = page.locator('#fa-activity-detail').getByLabel('活动名称');
  await nameInput.fill('表内复核采购申请');
  await nameInput.press('Tab');
  const state = await page.evaluate(() => {
    const snapshot = window.__FLOW_ARCHITECT__.store.snapshot();
    return {
      activityName: snapshot.activities.find(item => item.activity_id === 'Activity_Review').name,
      nodeName: snapshot.diagram.nodes.find(item => item.node_id === 'Task_Review').name,
    };
  });
  assert.deepEqual(state, {
    activityName: '表内复核采购申请',
    nodeName: '表内复核采购申请',
  });
  await page.getByRole('tab', { name: /流程图/ }).click();
  assert.match(
    await page.locator('[data-element-id="Task_Review"] .djs-label').textContent(),
    /表内复核采购申请/,
  );
});

test('invalid accountable-role edit rolls back both activity and lane', async t => {
  const { page } = await openV2Fixture(t);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row="Activity_Review"]').click();
  const roleInput = page.locator('#fa-activity-detail').getByLabel('角色 ID').first();
  await roleInput.fill('Role-missing');
  await roleInput.press('Tab');
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.autoLayout.applying === false);
  const state = await page.evaluate(() => {
    const snapshot = window.__FLOW_ARCHITECT__.store.snapshot();
    return {
      roleId: snapshot.activities[0].role_assignments[0].role_id,
      laneId: snapshot.diagram.nodes.find(node => node.node_id === 'Task_Review').lane_id,
    };
  });
  assert.deepEqual(state, { roleId: 'Role-applicant', laneId: 'Lane_Applicant' });
});

test('deleting the only accountable role is rejected and rolled back', async t => {
  const { page } = await openV2Fixture(t);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row="Activity_Review"]').click();
  await page.locator('#fa-activity-detail .fa-role-item .fa-array-remove').click();
  await page.waitForFunction(() => window.__FLOW_ARCHITECT__.autoLayout.applying === false);
  const assignments = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities[0].role_assignments);
  assert.deepEqual(assignments, [{ role_id: 'Role-applicant', responsibility: 'R' }]);
});

test('new L5 activity adds row to catalog and DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const beforeCount = await page.locator('[data-activity-row]').count();
  await page.getByRole('button', { name: /新增.*活动/ }).click();
  // 等待 store activities 增长为可观测完成信号（#addActivity 是 async）
  await page.waitForFunction(
    (expected) => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === expected,
    beforeCount + 1,
    { timeout: 10000 },
  );
  assert.equal(await page.locator('[data-activity-row]').count(), beforeCount + 1);
  const actCount = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.length);
  assert.equal(actCount, 2);
});

// ===== 图表同步 =====

test('rename L5 via diagram updates store activity name', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.getByRole('button', { name: '修改名称' }).click();
  await page.locator('#fa-rename-input').fill('复核采购申请');
  await page.getByRole('button', { name: '确认修改' }).click();
  const act = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.find(
      a => a.activity_id === 'Activity_Review'));
  assert.equal(act.name, '复核采购申请');
});

// ===== 问题管理 =====

test('question list shows questions and status select has Chinese labels', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /待确认问题/ }).click();
  const questionText = await page.locator('[data-question-id="Q-001"]').textContent();
  assert.ok(questionText.includes('采购申请'));
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

test('question answer and status update DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /待确认问题/ }).click();
  await page.getByLabel('Q-001 回答').fill('由采购经理复核');
  await page.getByLabel('Q-001 状态').selectOption('CONFIRMED');
  const q = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().questions.find(q => q.question_id === 'Q-001'));
  assert.equal(q.answer, '由采购经理复核');
  assert.equal(q.status, 'CONFIRMED');
});

// ===== Dirty 状态 =====

test('DraftStore dirty indicator shows after edit', async t => {
  const { page } = await openV2Fixture(t);
  // Initially not dirty
  assert.equal(await page.locator('#fa-dirty-indicator').isVisible(), false);
  // Edit something
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  await page.getByLabel('流程目的').fill('修改目的');
  await page.getByLabel('流程目的').dispatchEvent('change');
  // Dirty indicator should appear
  assert.equal(await page.locator('#fa-dirty-indicator').isVisible(), true);
});

// ===== 非叶子适用状态 =====

test('non-leaf L3 disables diagram and activity tabs', async t => {
  const payload = v2Payload();
  payload.process_card.level = 'L3';
  payload.process_card.is_leaf = false;
  payload.activities = [];
  payload.diagram = { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' };
  payload.questions = [];
  const { browser, page } = await openV2Fixture(t, payload, { skipBpmnCompile: true });
  // 等待编辑器初始化完成（不要求图表渲染）
  await page.locator('[role="tab"]').first().waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#fa-tab-diagram').isDisabled(), true);
  assert.equal(await page.locator('#fa-tab-activities').isDisabled(), true);
  assert.ok(await page.locator('#fa-not-applicable').isVisible());
});

// ===== 有限工具箱 =====

test('default bpmn-js palette is replaced by an exact visible limited palette', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('.djs-palette').waitFor({ state: 'visible', timeout: 1000 });
  const actions = await page.locator('.djs-palette [data-action]:visible').evaluateAll(
    entries => entries.map(entry => entry.dataset.action).sort(),
  );
  assert.deepEqual(actions, [
    'connect', 'create.and', 'create.confirmation-task', 'create.end',
    'create.intermediate', 'create.l5-task', 'create.lane', 'create.or',
    'create.start', 'create.xor', 'delete', 'hand-tool', 'lasso-tool',
  ]);
});

test('palette delete uses the same confirmation dialog as the toolbar', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="delete"]:visible').click();
  await page.locator('#fa-delete-confirm-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('#fa-delete-confirm-message').textContent(), /审核采购申请/);
  await page.locator('#fa-delete-cancel').click();
  assert.equal(await page.locator('[data-element-id="Task_Review"]').count(), 1);
});

test('palette sequence-flow action asks for a target and updates the deterministic contract', async t => {
  const { page } = await openV2Fixture(t);
  const before = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.flows.length);
  await page.locator('[data-element-id="StartEvent_1"]').click();
  page.once('dialog', dialog => dialog.accept('EndEvent_1'));
  await page.locator('.djs-palette [data-action="connect"]:visible').click();
  await page.waitForFunction(
    expected => window.__FLOW_ARCHITECT__.store.snapshot().diagram.flows.length === expected,
    before + 1,
  );
  const added = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.flows.find(
      flow => flow.source_ref === 'StartEvent_1' && flow.target_ref === 'EndEvent_1',
    ));
  assert.ok(added);
});

test('palette L5 and XOR actions open the business input dialogs', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="create.l5-task"]:visible').click();
  await page.locator('#fa-insert-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-insert-cancel').click();

  await page.locator('.djs-palette [data-action="create.xor"]:visible').click();
  await page.locator('#fa-gateway-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-gateway-cancel').click();
});

test('empty structural dialog input is rejected without closing or mutating the draft', async t => {
  const { page } = await openV2Fixture(t);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-element-id="Task_Review"]').click();
  const before = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.length);
  await page.getByRole('button', { name: '后插活动' }).click();
  await page.locator('#fa-insert-confirm').click();
  assert.equal(await page.locator('#fa-insert-dialog').isVisible(), true);
  assert.equal(await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.length), before);
});

test('palette end and lane actions update the contract through deterministic layout', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  page.once('dialog', dialog => dialog.accept('采购申请已拒绝'));
  await page.locator('.djs-palette [data-action="create.end"]:visible').click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.end_results.length === 2);

  const answers = ['法务', 'Role-legal'];
  const answerDialog = dialog => dialog.accept(answers.shift());
  page.on('dialog', answerDialog);
  await page.locator('.djs-palette [data-action="create.lane"]:visible').click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.lanes.some(
      lane => lane.role_id === 'Role-legal' && lane.name === '法务',
    ));
  page.off('dialog', answerDialog);
});

test('palette internal confirmation creates a serial confirmation task only after all gates pass', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="create.confirmation-task"]:visible').click();
  await page.getByLabel('确认角色 ID').fill('Role-manager');
  await page.getByLabel('与主任务共同完成').check();
  await page.getByLabel('确认者承担最终责任').check();
  await page.getByLabel('不存在正式审批会议').check();
  await page.getByRole('button', { name: '确认新增内部确认' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities[0].confirmation != null);
  const snapshot = await page.evaluate(() => window.__FLOW_ARCHITECT__.store.snapshot());
  const confirmation = snapshot.activities[0].confirmation;
  const confirmationNode = snapshot.diagram.nodes.find(
    node => node.node_id === confirmation.confirmation_task_id,
  );
  assert.equal(confirmationNode.node_type, 'CONFIRMATION_TASK');
  assert.equal(confirmationNode.lane_id, 'Lane_Manager');
  assert.ok(snapshot.diagram.flows.some(
    flow => flow.source_ref === 'Task_Review' && flow.target_ref === confirmationNode.node_id,
  ));
});

test('internal confirmation uses a business gate dialog with role and three declarations', async t => {
  const { page } = await openV2Fixture(t);
  assert.equal(await page.locator('#fa-confirmation-dialog').count(), 1);
  assert.equal(await page.getByLabel('确认角色 ID').count(), 1);
  assert.equal(await page.getByLabel('与主任务共同完成').count(), 1);
  assert.equal(await page.getByLabel('确认者承担最终责任').count(), 1);
  assert.equal(await page.getByLabel('不存在正式审批会议').count(), 1);
});

// ===== 导出 r02 =====

test('export r02 HTML preserves V2 payload and can be reopened', async t => {
  const { browser, page } = await openV2Fixture(t);
  // Make an edit
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  await page.getByLabel('流程目的').fill('导出测试目的');
  await page.getByLabel('流程目的').dispatchEvent('change');

  // Switch back to diagram and export
  await page.getByRole('tab', { name: /流程图/ }).click();
  await assertExportable(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出新版本' }).click();
  const item = await download;
  assert.match(item.suggestedFilename(), /-r02\.html$/);
  const tempPath = await item.path();
  const saved = tempPath + '.html';
  fs.copyFileSync(tempPath, saved);

  // Reopen r02
  const context = await browser.newContext();
  const r02Page = await context.newPage();
  await r02Page.goto(pathToFileURL(saved).href);
  await r02Page.locator('#fa-canvas svg[data-element-id]').waitFor();

  // Verify V2 structure preserved
  assert.equal(await r02Page.locator('[role="tab"]').count(), 4);
  const snap = await r02Page.evaluate(() => window.__FLOW_ARCHITECT__.store.snapshot());
  assert.equal(snap.process_card.purpose, '导出测试目的');
  assert.equal(snap.process_card.name, '采购审批流程');
  assert.equal(snap.activities.length, 1);
  assert.equal(snap.activities[0].name, '审核采购申请');
  assert.equal(snap.questions[0].question_id, 'Q-001');
  await context.close();
});

// ===== 导出完整 JSON =====

test('export full JSON includes all V2 business fields', async t => {
  const { page } = await openV2Fixture(t);
  await assertExportable(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整 JSON' }).click();
  const item = await download;
  assert.match(item.suggestedFilename(), /-full\.json$/);
  const tempPath = await item.path();
  const content = fs.readFileSync(tempPath, 'utf8');
  const parsed = JSON.parse(content);
  assert.equal(parsed.metadata.schema_version, '2.0.0');
  assert.ok(parsed.process_card);
  assert.ok(Array.isArray(parsed.activities));
  assert.ok(parsed.diagram);
  assert.ok(parsed.bpmn_xml);
  assert.ok(Array.isArray(parsed.questions));
});

// ===== 离线 =====

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

// ===== 导出错误处理 =====

test('export with illegal question status shows Chinese error', async t => {
  const { page } = await openV2Fixture(t);
  await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const questions = store.snapshot().questions;
    questions[0].status = 'BOGUS';
    store.restore({ ...store.snapshot(), questions });
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
  assert.match(alertMsg, /[一-鿿]/);
  assert.ok(!alertMsg.includes('Unhandled'));
});

// ===== 修订链 =====

test('r02 can modify and re-export to r03', async t => {
  const { browser, page } = await openV2Fixture(t);
  // Export r02
  await assertExportable(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出新版本' }).click();
  const item = await download;
  const tempPath = await item.path();
  const saved = tempPath + '.html';
  fs.copyFileSync(tempPath, saved);

  // Open r02
  const context = await browser.newContext();
  const r02Page = await context.newPage();
  await r02Page.goto(pathToFileURL(saved).href);
  await r02Page.locator('#fa-canvas svg[data-element-id]').waitFor();

  // Modify in r02
  await r02Page.getByRole('tab', { name: /流程卡片/ }).click();
  await r02Page.getByLabel('流程目的').fill('r02 修改');
  await r02Page.getByLabel('流程目的').dispatchEvent('change');

  // Export r03
  await r02Page.getByRole('tab', { name: /流程图/ }).click();
  await assertExportable(r02Page);
  const r03Download = r02Page.waitForEvent('download');
  await r02Page.getByRole('button', { name: '导出新版本' }).click();
  const r03 = await r03Download;
  assert.match(r03.suggestedFilename(), /-r03\.html$/);
  await context.close();
});
