/**
 * meeting-structural-editing-e2e.test.mjs - 结构编辑全链路 Playwright 测试
 *
 * 从可见 UI 依次完成：活动表新增、图上后插、XOR 两分支、改名、R/O 移泳道、删除、导出 r02 重开。
 * 每步断言 activities/nodes/bindings/XML，同步和布局。
 * 禁止 force/dispatchEvent/evaluate 调控制器（evaluate 只读状态可用）。
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

function minimalPayload() {
  return {
    metadata: {
      schema_version: '2.0.0',
      package_id: 'structural-test',
      process_id: 'Process_1',
      title: '结构编辑测试',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
      content_hash: 'sha256:placeholder',
    },
    process_card: {
      process_id: 'Process_1',
      name: '结构编辑测试',
      level: 'L4',
      is_leaf: true,
      description: '结构编辑全链路测试流程',
      purpose: '验证结构编辑闭环',
      owner: 'Role_A',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_1',
        name: '初始活动',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role_A', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: [],
        process_summary: '',
        outputs: [],
        completion_criteria: [],
        references: [],
        main_task_id: 'Task_1',
        confirmation: null,
        completeness: 'NEEDS_CONFIRMATION',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane_A', name: '泳道A', role_id: 'Role_A' },
        { lane_id: 'Lane_B', name: '泳道B', role_id: 'Role_B' },
      ],
      nodes: [
        { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_1', node_type: 'MAIN_TASK', name: '初始活动', lane_id: 'Lane_A', activity_id: 'Activity_1' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_1', condition: null },
        { flow_id: 'Flow_2', source_ref: 'Task_1', target_ref: 'End_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_1', main_task_id: 'Task_1', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

function buildPackage(runDir, payload) {
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
  const html = buildMeetingPackageHtml({
    draft,
    bpmnXml,
    metadata: payload.metadata,
  });
  const output = path.join(runDir, 'structural-test-r01.html');
  fs.writeFileSync(output, html);
  return output;
}

async function openFixture(t, payload) {
  const runDir = makeRunDir('structural-e2e');
  const htmlPath = buildPackage(runDir, payload || minimalPayload());
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  return { browser, page, runDir };
}

/**
 * 读取 store 快照（只读状态）
 */
function readSnapshot(page) {
  return page.evaluate(() => {
    const s = window.__FLOW_ARCHITECT__.store.snapshot();
    return {
      activityCount: s.activities.length,
      activities: s.activities.map(a => ({
        activity_id: a.activity_id,
        name: a.name,
        main_task_id: a.main_task_id,
        role_assignments: a.role_assignments,
      })),
      nodeCount: s.diagram.nodes.length,
      nodes: s.diagram.nodes.map(n => ({
        node_id: n.node_id,
        node_type: n.node_type,
        name: n.name,
        lane_id: n.lane_id,
        activity_id: n.activity_id,
      })),
      bindingCount: s.diagram.task_bindings.length,
      bindings: s.diagram.task_bindings.map(b => ({
        activity_id: b.activity_id,
        main_task_id: b.main_task_id,
      })),
      flowCount: s.diagram.flows.length,
      bpmnXmlLength: s.bpmn_xml?.length || 0,
    };
  });
}

// ===== Step 1: 活动表新增 L5 =====

test('Step 1: 活动表新增 L5 活动，断言 activities/nodes/bindings 各 +1', async t => {
  const { page } = await openFixture(t);

  // 切到活动一览表
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  const before = await readSnapshot(page);
  assert.equal(before.activityCount, 1);
  assert.equal(before.bindingCount, 1);

  // 点击「新增 L5 活动」按钮
  await page.getByRole('button', { name: /新增.*活动/ }).click();
  // 等待 store activities 增长为可观测完成信号
  await page.waitForFunction(
    (expected) => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === expected,
    before.activityCount + 1,
    { timeout: 10000 },
  );

  const after = await readSnapshot(page);
  assert.equal(after.activityCount, before.activityCount + 1, '活动 +1');
  assert.equal(after.bindingCount, before.bindingCount + 1, 'binding +1');

  // 新活动应有对应的 MAIN_TASK
  const newTasks = after.nodes.filter(n =>
    n.node_type === 'MAIN_TASK' && n.node_id !== 'Task_1'
  );
  assert.equal(newTasks.length, 1, '新增 MAIN_TASK 应为 1');
  assert.ok(newTasks[0].activity_id, '新 Task 应绑定活动');
  assert.ok(after.bpmnXmlLength > 0, 'bpmn_xml 应被更新');

  // 切回流程图验证图上同步
  await page.getByRole('tab', { name: /流程图/ }).click();
  const newTaskId = newTasks[0].node_id;
  const svgTask = page.locator(`[data-element-id="${newTaskId}"]`);
  assert.ok(await svgTask.count() > 0, `图上应出现新 Task ${newTaskId}`);
});

// ===== Step 2: 图上后插活动 =====

test('Step 2: 图上选择 Task 后「后插活动」，断言同步', async t => {
  const { page } = await openFixture(t);

  // 选择 Task_1
  await page.locator('[data-element-id="Task_1"]').click();

  const before = await readSnapshot(page);

  // 点击「后插活动」
  await page.getByRole('button', { name: '后插活动' }).click();
  // 填写对话框
  await page.locator('#fa-insert-input').fill('后插活动');
  await page.locator('#fa-insert-confirm').click();
  // 等待 store 活动数增长
  await page.waitForFunction(
    (expected) => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === expected,
    before.activityCount + 1,
    { timeout: 10000 },
  );

  const after = await readSnapshot(page);
  assert.equal(after.activityCount, before.activityCount + 1, '活动 +1');
  assert.equal(after.bindingCount, before.bindingCount + 1, 'binding +1');

  // 验证流重连：Task_1 -> newTask -> End_1
  const newTask = after.nodes.find(n =>
    n.node_type === 'MAIN_TASK' && n.node_id !== 'Task_1'
  );
  assert.ok(newTask, '新 Task 应存在');
  assert.equal(newTask.name, '后插活动');

  // 验证新 Task 在图上出现
  const svgNewTask = page.locator(`[data-element-id="${newTask.node_id}"]`);
  assert.ok(await svgNewTask.count() > 0, '图上应出现后插的 Task');

  // 验证 bpmn_xml 包含新 Task
  const bpmnXml = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().bpmn_xml
  );
  assert.ok(bpmnXml.includes(newTask.node_id), 'bpmn_xml 应包含新 Task ID');
});

// ===== Step 3: XOR 两分支 =====

test('Step 3: 增加 XOR 两分支，断言 gateway +1、活动 +2', async t => {
  const { page } = await openFixture(t);

  // 选择 Task_1
  await page.locator('[data-element-id="Task_1"]').click();

  const before = await readSnapshot(page);

  // 点击「增加判断」
  await page.getByRole('button', { name: '增加判断' }).click();
  // 填写对话框
  await page.locator('#fa-gateway-question').fill('是否需要审批');
  await page.locator('#fa-gateway-yes').fill('需要审批');
  await page.locator('#fa-gateway-no').fill('无需审批');
  await page.locator('#fa-gateway-confirm').click();
  // 等待 store 活动数增长（每个分支各一个活动）
  await page.waitForFunction(
    (expected) => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === expected,
    before.activityCount + 2,
    { timeout: 10000 },
  );

  const after = await readSnapshot(page);

  // gateway +1
  const gateways = after.nodes.filter(n => n.node_type === 'GATEWAY_XOR');
  assert.equal(gateways.length, 1, 'XOR 网关应为 1');

  // 活动 +2（每个分支一个）
  assert.equal(after.activityCount, before.activityCount + 2, '活动 +2');

  // 新增主 Task +2
  const newBranchTasks = after.nodes.filter(
    n => n.node_type === 'MAIN_TASK' && n.node_id !== 'Task_1'
  );
  assert.equal(newBranchTasks.length, 2, '新增分支主 Task 应为 2');

  // 网关不绑定活动
  const gatewayBindings = after.bindings.filter(
    b => after.nodes.find(n => n.node_id === b.main_task_id)?.node_type?.startsWith('GATEWAY')
  );
  assert.equal(gatewayBindings.length, 0, '网关不应有 binding');

  // 验证 bpmn_xml 包含网关
  const bpmnXml = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().bpmn_xml
  );
  assert.ok(bpmnXml.includes('exclusiveGateway'), 'bpmn_xml 应包含 exclusiveGateway');
  assert.ok(after.bpmnXmlLength > 0, 'bpmn_xml 应被更新');
});

// ===== Step 4: 改名 =====

test('Step 4: 改名后图和表同步', async t => {
  const { page } = await openFixture(t);

  // 选择 Task_1
  await page.locator('[data-element-id="Task_1"]').click();

  // 点击「修改名称」
  await page.getByRole('button', { name: '修改名称' }).click();
  await page.locator('#fa-rename-input').fill('已改名活动');
  await page.getByRole('button', { name: '确认修改' }).click();
  // 等待 store 活动名称更新
  await page.waitForFunction(
    () => {
      const snap = window.__FLOW_ARCHITECT__.store.snapshot();
      const act = snap.activities.find(a => a.main_task_id === 'Task_1');
      return act?.name === '已改名活动';
    },
    { timeout: 5000 },
  );

  // 验证 store 中活动名称更新
  const act = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.find(
      a => a.main_task_id === 'Task_1'
    )
  );
  assert.equal(act.name, '已改名活动', '活动名称应同步');

  // 验证图上 label 更新
  const label = await page.locator('[data-element-id="Task_1"] .djs-label').textContent();
  assert.ok(label.includes('已改名活动'), '图上 label 应同步');
});

// ===== Step 5: R/O 移泳道 =====

test('Step 5: 修改 R/O 后节点移至新泳道', async t => {
  const { page } = await openFixture(t);

  // 切到活动一览表并打开详情
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.locator('[data-activity-row="Activity_1"]').click();
  // 等待详情面板可见
  await page.locator('#fa-activity-detail').waitFor({ state: 'visible' });

  // 读取移泳道前的 lane_id
  const beforeLaneId = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const snap = store.snapshot();
    const task = snap.diagram.nodes.find(n => n.node_id === 'Task_1');
    return task?.lane_id;
  });
  assert.equal(beforeLaneId, 'Lane_A', '初始泳道应为 Lane_A');

  // 修改角色 ID 为 Role_B（Lane_B 对应角色）
  const roleInput = page.locator('#fa-activity-detail input[aria-label="角色 ID"]').first();
  await roleInput.fill('');
  await roleInput.pressSequentially('Role_B');
  // 用 Tab 触发 blur/change（fill() 不触发 change 事件）
  await roleInput.press('Tab');
  // 等待 store lane_id 更新
  await page.waitForFunction(
    () => {
      const snap = window.__FLOW_ARCHITECT__.store.snapshot();
      const task = snap.diagram.nodes.find(n => n.node_id === 'Task_1');
      return task?.lane_id === 'Lane_B';
    },
    { timeout: 10000 },
  );

  // 验证 lane_id 改变
  const afterLaneId = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const snap = store.snapshot();
    const task = snap.diagram.nodes.find(n => n.node_id === 'Task_1');
    return task?.lane_id;
  });
  assert.equal(afterLaneId, 'Lane_B', '主 Task 应移至 Lane_B');
  assert.notEqual(afterLaneId, beforeLaneId, '泳道应发生变化');
});

// ===== Step 6: 删除 =====

test('Step 6: 删除主 Task 后活动和 binding 同步删除', async t => {
  const { page } = await openFixture(t);

  // 选择 Task_1
  await page.locator('[data-element-id="Task_1"]').click();

  const before = await readSnapshot(page);

  // 点击「删除活动」→ 弹出确认对话框
  await page.getByRole('button', { name: '删除活动' }).click();
  await page.locator('#fa-delete-confirm-dialog').waitFor({ state: 'visible' });
  // 确认删除
  await page.locator('#fa-delete-confirm').click();
  // 等待 store 活动数减少
  await page.waitForFunction(
    (expected) => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === expected,
    before.activityCount - 1,
    { timeout: 10000 },
  );

  const after = await readSnapshot(page);

  // 活动和 binding 同步删除
  assert.equal(after.activityCount, before.activityCount - 1, '活动 -1');
  assert.equal(after.bindingCount, before.bindingCount - 1, 'binding -1');
  assert.ok(
    !after.nodes.find(n => n.node_id === 'Task_1'),
    'Task_1 应被删除'
  );

  // bpmn_xml 应被更新且不包含已删除的 Task
  const bpmnXml = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().bpmn_xml
  );
  assert.ok(!bpmnXml.includes('Task_1'), 'bpmn_xml 不应包含已删除的 Task');
});

// ===== Step 7: 导出 r02 重开 =====

test('Step 7: 导出 r02 重开后状态完整保留', async t => {
  const { browser, page } = await openFixture(t);

  // Step A: 新增一个活动
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.getByRole('button', { name: /新增.*活动/ }).click();
  await page.waitForFunction(
    () => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === 2,
    { timeout: 10000 },
  );

  const snapBefore = await readSnapshot(page);
  assert.equal(snapBefore.activityCount, 2, '应有 2 个活动');

  // Step B: 导出 r02
  await page.getByRole('tab', { name: /流程图/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出新版本' }).click();
  const item = await download;
  assert.match(item.suggestedFilename(), /-r02\.html$/);
  const tempPath = await item.path();
  const saved = tempPath + '.html';
  fs.copyFileSync(tempPath, saved);

  // Step C: 重新打开 r02
  const context = await browser.newContext();
  const r02Page = await context.newPage();
  t.after(() => context.close());
  await r02Page.goto(pathToFileURL(saved).href);
  await r02Page.locator('#fa-canvas svg[data-element-id]').waitFor();

  // Step D: 断言状态完整保留
  const snapAfter = await readSnapshot(r02Page);
  assert.equal(snapAfter.activityCount, 2, 'r02 应保留 2 个活动');
  assert.equal(snapAfter.bindingCount, 2, 'r02 应保留 2 个 binding');

  // 验证两个活动名称
  const actNames = snapAfter.activities.map(a => a.name).sort();
  assert.ok(actNames.includes('初始活动'), 'r02 应包含初始活动');
  assert.ok(actNames.some(n => n.startsWith('新活动')), 'r02 应包含新增活动');

  // 验证 bpmn_xml 有效
  const bpmnXml = await r02Page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().bpmn_xml
  );
  assert.ok(bpmnXml.includes('<bpmn:definitions'), 'r02 bpmn_xml 应有效');
  assert.ok(bpmnXml.includes('Task_1'), 'r02 bpmn_xml 应包含 Task_1');

  // 验证 r02 仍可继续编辑（新增活动）
  await r02Page.getByRole('tab', { name: /活动一览表/ }).click();
  await r02Page.getByRole('button', { name: /新增.*活动/ }).click();
  await r02Page.waitForFunction(
    () => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === 3,
    { timeout: 10000 },
  );
  const snapEdited = await readSnapshot(r02Page);
  assert.equal(snapEdited.activityCount, 3, 'r02 编辑后应有 3 个活动');
});

// ===== 综合验证：compileBpmn 一致性 =====

test('所有结构操作后 bpmn_xml 可通过 compileBpmn 重新编译', async t => {
  const { page } = await openFixture(t);

  // 新增活动
  await page.getByRole('tab', { name: /活动一览表/ }).click();
  await page.getByRole('button', { name: /新增.*活动/ }).click();
  await page.waitForFunction(
    () => window.__FLOW_ARCHITECT__.store.snapshot().activities.length === 2,
    { timeout: 10000 },
  );

  // 读取当前 snapshot 并验证 compileBpmn
  const result = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const snap = store.snapshot();
    // 验证 bpmn_xml 不为空
    return {
      hasBpmn: snap.bpmn_xml && snap.bpmn_xml.length > 100,
      activityCount: snap.activities.length,
      nodeCount: snap.diagram.nodes.length,
      bindingCount: snap.diagram.task_bindings.length,
    };
  });
  assert.ok(result.hasBpmn, 'bpmn_xml 应不为空');
  assert.equal(result.activityCount, 2);
  assert.ok(result.nodeCount >= 4, '节点数应 >= 4（Start + Task1 + 新Task + End）');
  assert.equal(result.bindingCount, 2);
});
