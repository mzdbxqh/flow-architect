/**
 * 结构操作业务对话框与网关覆盖测试
 *
 * 背景：中间事件/结束事件/泳道/顺序流原来使用浏览器原生 prompt，
 * 且顺序流要求用户手输目标节点 ID（正常用户不可摸索）。
 * 本文件验证统一后的业务对话框路径：
 * 1. 中间事件/结束事件/泳道通过 styled dialog 创建，不再触发原生 prompt
 * 2. AND/OR 网关浏览器端完整创建（此前只有 XOR 与单元测试）
 * 3. 顺序流对话框按名称选择目标，并过滤自环与 START_EVENT
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
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

async function openV2Fixture(t) {
  const runDir = makeRunDir('structural-dialogs');
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
  // 捕获原生 prompt（原生 prompt 出现即视为回归）
  const nativePrompts = [];
  page.on('dialog', dialog => {
    nativePrompts.push(dialog.type());
    return dialog.dismiss();
  });
  return { browser, page, nativePrompts };
}

test('中间事件通过业务对话框创建且不触发原生 prompt', async t => {
  const { page, nativePrompts } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="create.intermediate"]:visible').click();
  await page.locator('#fa-intermediate-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-intermediate-input').fill('等待供应商反馈');
  await page.getByRole('button', { name: '确认新增' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.nodes.some(
      n => n.node_type === 'INTERMEDIATE_MESSAGE_CATCH' && n.name === '等待供应商反馈'));
  assert.deepEqual(nativePrompts.filter(type => type === 'prompt'), [], '不应再使用原生 prompt');
});

test('AND 网关通过对话框创建两分支', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="create.and"]:visible').click();
  await page.locator('#fa-gateway-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-gateway-question').fill('是否需要会签');
  await page.locator('#fa-gateway-yes').fill('法务会签');
  await page.locator('#fa-gateway-no').fill('财务会签');
  await page.getByRole('button', { name: '确认新增判断' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.length === 3);
  const nodes = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.nodes);
  assert.ok(nodes.some(n => n.node_type === 'GATEWAY_AND'), '应创建 GATEWAY_AND 网关节点');
  assert.ok(nodes.some(n => n.node_type === 'MAIN_TASK' && n.name === '法务会签'), '应创建是分支活动');
  assert.ok(nodes.some(n => n.node_type === 'MAIN_TASK' && n.name === '财务会签'), '应创建否分支活动');
});

test('OR 网关通过对话框创建两分支', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="create.or"]:visible').click();
  await page.locator('#fa-gateway-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-gateway-question').fill('是否需要加签');
  await page.locator('#fa-gateway-yes').fill('安全加签');
  await page.locator('#fa-gateway-no').fill('合规加签');
  await page.getByRole('button', { name: '确认新增判断' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().activities.length === 3);
  const nodes = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.nodes);
  assert.ok(nodes.some(n => n.node_type === 'GATEWAY_OR'), '应创建 GATEWAY_OR 网关节点');
  assert.ok(nodes.some(n => n.node_type === 'MAIN_TASK' && n.name === '安全加签'), '应创建是分支活动');
  assert.ok(nodes.some(n => n.node_type === 'MAIN_TASK' && n.name === '合规加签'), '应创建否分支活动');
});

test('结束事件通过业务对话框创建且不触发原生 prompt', async t => {
  const { page, nativePrompts } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="create.end"]:visible').click();
  await page.locator('#fa-end-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-end-input').fill('采购申请已拒绝');
  await page.getByRole('button', { name: '确认新增' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().process_card.end_results.length === 2);
  assert.deepEqual(nativePrompts.filter(type => type === 'prompt'), [], '不应再使用原生 prompt');
});

test('泳道通过双字段业务对话框创建且不触发原生 prompt', async t => {
  const { page, nativePrompts } = await openV2Fixture(t);
  await page.locator('.djs-palette [data-action="create.lane"]:visible').click();
  await page.locator('#fa-lane-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-lane-name').fill('法务');
  await page.locator('#fa-lane-role').fill('Role-legal');
  await page.getByRole('button', { name: '确认新增泳道' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.lanes.some(
      lane => lane.role_id === 'Role-legal' && lane.name === '法务'));
  assert.deepEqual(nativePrompts.filter(type => type === 'prompt'), [], '不应再使用原生 prompt');
});

test('顺序流对话框按名称选择目标并更新合同', async t => {
  const { page, nativePrompts } = await openV2Fixture(t);
  await page.locator('[data-element-id="StartEvent_1"]').click();
  await page.locator('.djs-palette [data-action="connect"]:visible').click();
  await page.locator('#fa-connect-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-connect-target').selectOption({ label: '结束' });
  await page.getByRole('button', { name: '确认连接' }).click();
  await page.waitForFunction(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.flows.length === 3);
  const added = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.store.snapshot().diagram.flows.find(
      f => f.source_ref === 'StartEvent_1' && f.target_ref === 'EndEvent_1'));
  assert.ok(added, '应新增 StartEvent_1 → EndEvent_1 顺序流');
  assert.deepEqual(nativePrompts.filter(type => type === 'prompt'), [], '不应再使用原生 prompt');
});

test('顺序流对话框过滤自环与 START_EVENT 目标', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.locator('.djs-palette [data-action="connect"]:visible').click();
  await page.locator('#fa-connect-dialog').waitFor({ state: 'visible' });
  const options = await page.locator('#fa-connect-target option').allTextContents();
  assert.ok(!options.includes('审核采购申请'), '目标列表不应包含源节点自身（自环）');
  assert.ok(!options.includes('开始'), '目标列表不应包含 START_EVENT');
  assert.ok(options.includes('结束'), '目标列表应包含可选的结束事件');
  await page.locator('#fa-connect-cancel').click();
});
