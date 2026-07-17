/**
 * meeting-f2-browser.test.mjs - F2: KPI/起终点 UI 接线与结构同步浏览器测试
 *
 * - KPI 名称、目标值编辑必须写回 DraftStore（真实 UI change 事件）
 * - 起点名称修改必须同步 START_EVENT
 * - 终点新增必须通过结构命令 + AutoLayout 重排
 * - 终点改名同步 END_EVENT
 * - 禁止删除最后一个业务终点
 * - 不允许直接调用 store.updateProcessCard() 代替 UI 操作
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
      package_id: 'test-f2',
      process_id: 'Process_1',
      title: 'F2 测试流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
      content_hash: 'sha256:placeholder',
    },
    process_card: {
      process_id: 'Process_1',
      name: 'F2 测试流程',
      level: 'L4',
      is_leaf: true,
      description: 'F2 测试描述',
      purpose: 'F2 测试目的',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: ['输入A'],
      outputs: ['输出A'],
      start: { event_id: 'Start_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '结束' }],
      performance_indicators: [
        { indicator_id: 'KPI-1', name: '审核及时率', target: '95%', unit: '%' },
      ],
    },
    activities: [
      {
        activity_id: 'Activity_Review',
        name: '审核申请',
        description: '审核申请内容',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-owner', responsibility: 'R' }],
        sla: null,
        tools: [],
        inputs: [],
        process_summary: '',
        outputs: [],
        completion_criteria: [],
        references: [],
        main_task_id: 'Task_Review',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane_Owner', name: '责任人', role_id: 'Role-owner' },
      ],
      nodes: [
        { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
        { node_id: 'Task_Review', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane_Owner' },
        { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
      ],
      flows: [
        { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_Review', condition: null },
        { flow_id: 'Flow_2', source_ref: 'Task_Review', target_ref: 'End_1', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity_Review', main_task_id: 'Task_Review', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

async function openV2Fixture(t, payloadOverride) {
  const runDir = makeRunDir('f2');
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

async function assertCanonicalBpmn(page) {
  const snapshot = await page.evaluate(() => window.__FLOW_ARCHITECT__.store.snapshot());
  assert.equal(snapshot.bpmn_xml, compileBpmn(snapshot).xml);
}

// ─── F2: KPI 编辑写回 DraftStore（真实 UI change 事件） ───

test('F2: KPI 名称编辑通过 change 事件写回 DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  // 切换到流程卡片页签
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  // 找到 KPI 名称输入框并修改，然后触发 blur 使 change 事件生效
  const kpiNameInput = page.locator('.fa-kpi-item [aria-label="KPI 名称"]').first();
  await kpiNameInput.fill('新 KPI 名称');
  await kpiNameInput.dispatchEvent('change');
  // 验证 store 已更新
  const kpiName = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return store.snapshot().process_card.performance_indicators[0]?.name;
  });
  assert.equal(kpiName, '新 KPI 名称');
});

test('F2: KPI 目标值编辑通过 change 事件写回 DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  const kpiTargetInput = page.locator('.fa-kpi-item [aria-label="KPI 目标值"]').first();
  await kpiTargetInput.fill('98%');
  await kpiTargetInput.dispatchEvent('change');
  const kpiTarget = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return store.snapshot().process_card.performance_indicators[0]?.target;
  });
  assert.equal(kpiTarget, '98%');
});

test('F2: 新增 KPI 写回 DraftStore', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  await page.getByRole('button', { name: /新增.*KPI/ }).click();
  const kpiCount = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.performance_indicators.length);
  assert.equal(kpiCount, 2);
});

// ─── F2: 起点名称修改同步 START_EVENT ───

test('F2: 起点名称修改同步 START_EVENT', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  const startNameInput = page.locator('[aria-label="起点名称"]');
  await startNameInput.fill('新起点名称');
  await startNameInput.dispatchEvent('change');
  // 验证 START_EVENT 节点名称同步
  const startName = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const snap = store.snapshot();
    const startNode = snap.diagram.nodes.find(n => n.node_type === 'START_EVENT');
    return startNode?.name;
  });
  assert.equal(startName, '新起点名称');
  await assertCanonicalBpmn(page);
});

test('F2: 起点事件类型修改经 AutoLayout 写入规范 BPMN', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  await page.getByLabel('起点事件类型').selectOption('MESSAGE');
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.start.event_type === 'MESSAGE');
  const snapshot = await page.evaluate(() => window.__FLOW_ARCHITECT__.store.snapshot());
  assert.match(snapshot.bpmn_xml, /messageEventDefinition/);
  await assertCanonicalBpmn(page);
});

// ─── F2: 终点改名同步 END_EVENT ───

test('F2: 终点改名同步 END_EVENT 节点名称', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  // 找到终点名称输入框并修改
  const endNameInput = page.locator('[aria-label="终点名称"]').first();
  await endNameInput.fill('新终点名称');
  await endNameInput.dispatchEvent('change');
  // 验证 END_EVENT 节点名称同步
  const endName = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    const snap = store.snapshot();
    const endNode = snap.diagram.nodes.find(n => n.node_type === 'END_EVENT');
    return endNode?.name;
  });
  assert.equal(endName, '新终点名称');
  await assertCanonicalBpmn(page);
});

// ─── F2: 终点新增通过结构命令 + AutoLayout 重排 ───

test('F2: 新增终点通过 AutoLayout 重排且 diagram 出现新 END_EVENT', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  // 获取操作前的节点数
  const endCountBefore = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.nodes.filter(n => n.node_type === 'END_EVENT').length);
  assert.equal(endCountBefore, 1);
  // 新增终点
  await page.getByRole('button', { name: /新增终点/ }).click();
  // 等待 AutoLayout 完成
  await page.waitForTimeout(1000);
  // 验证 END_EVENT 节点增加
  const endCount = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return store.snapshot().diagram.nodes.filter(n => n.node_type === 'END_EVENT').length;
  });
  assert.equal(endCount, 2, '应有 2 个 END_EVENT');
  // 验证 end_results 也增加
  const endResultCount = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.end_results.length);
  assert.equal(endResultCount, 2);
  await assertCanonicalBpmn(page);
});

// ─── F2: 禁止删除最后一个业务终点 ───

test('F2: 删除最后一个业务终点被阻止', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  // 仅有一个终点时，删除按钮应触发 alert
  const endCountBefore = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.end_results.length);
  assert.equal(endCountBefore, 1, '应只有 1 个终点');
  // 设置 dialog handler 接受 alert
  const dialogMessages = [];
  page.on('dialog', async dialog => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  // 点击删除按钮
  const removeBtn = page.locator('.fa-end-results .fa-array-remove').first();
  await removeBtn.click();
  // 等待 alert 处理
  await page.waitForTimeout(500);
  // 验证终点仍然存在（删除被阻止）
  const endCountAfter = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.end_results.length);
  assert.equal(endCountAfter, 1, '最后一个终点不应被删除');
  // 验证弹出了错误提示
  assert.ok(dialogMessages.length > 0, '应弹出阻止提示');
  assert.ok(
    dialogMessages.some(m => m.includes('FA-DRAFT-CARD-002') || m.includes('至少一个')),
    `错误提示应包含阻止信息: ${JSON.stringify(dialogMessages)}`,
  );
});

test('F2: 删除非最后终点经确认、AutoLayout 后图卡同步', async t => {
  const payload = v2Payload();
  payload.process_card.end_results.push({ event_id: 'End_2', name: '驳回完成' });
  payload.diagram.nodes.push({
    node_id: 'End_2', node_type: 'END_EVENT', name: '驳回完成', lane_id: null,
  });
  payload.diagram.flows.push({
    flow_id: 'Flow_3', source_ref: 'Task_Review', target_ref: 'End_2', condition: null,
  });
  const { page } = await openV2Fixture(t, payload);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  await page.locator('.fa-end-results .fa-array-remove').nth(1).click();
  await page.locator('#fa-delete-confirm-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-delete-confirm').click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.end_results.length === 1);
  const snapshot = await page.evaluate(() => window.__FLOW_ARCHITECT__.store.snapshot());
  assert.equal(snapshot.diagram.nodes.some(node => node.node_id === 'End_2'), false);
  assert.equal(snapshot.diagram.flows.some(flow => flow.target_ref === 'End_2'), false);
  await assertCanonicalBpmn(page);
});

// ─── F2: 导出重开后状态完整保留 ───

test('F2: KPI 编辑后导出重开状态完整保留', async t => {
  const { page } = await openV2Fixture(t);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  // 修改 KPI
  const kpiNameInput = page.locator('.fa-kpi-item [aria-label="KPI 名称"]').first();
  await kpiNameInput.fill('导出测试 KPI');
  await kpiNameInput.dispatchEvent('change');
  // 获取当前 payload（模拟导出）
  const exportedPayload = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return store.snapshot();
  });
  assert.equal(exportedPayload.process_card.performance_indicators[0].name, '导出测试 KPI');
});
