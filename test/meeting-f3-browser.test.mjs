/**
 * meeting-f3-browser.test.mjs - F3: 顺序流结构门禁真实 UI 拒绝测试
 *
 * 真实浏览器 UI 测试证明：
 * - 非法连接（自环、从 END_EVENT 出发、指向 START_EVENT）不会改变合同和 XML
 * - 必须通过真实 palette/UI 路径，不能用 evaluate 直接调用控制器
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
      package_id: 'test-f3',
      process_id: 'Process_1',
      title: 'F3 测试流程',
      revision: 'r01',
      based_on_revision: null,
      runtime_version: '2.0.0',
      content_hash: 'sha256:placeholder',
    },
    process_card: {
      process_id: 'Process_1',
      name: 'F3 测试流程',
      level: 'L4',
      is_leaf: true,
      description: 'F3 测试',
      purpose: 'F3 测试',
      owner: 'Role-owner',
      parent_process_name: null,
      inputs: [],
      outputs: [],
      start: { event_id: 'Start_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'End_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_Review',
        name: '审核申请',
        description: '',
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

async function openV2Fixture(t) {
  const runDir = makeRunDir('f3');
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

// ─── F3: 通过 palette UI 路径尝试非法连接，验证不改变合同和 XML ───
// 新版顺序流对话框在 UI 层过滤非法目标（自环、START_EVENT），
// 从 END_EVENT 出发则在打开对话框前直接门禁拒绝；
// 命令层拒绝仍由 structural-commands-f3.test.mjs 精确覆盖。

test('F3: START_EVENT 不在顺序流可选目标中且合同不变', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();

  // 记录操作前的合同快照和 XML
  const contractBefore = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return JSON.stringify(store.snapshot());
  });
  const xmlBefore = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });

  await page.locator('.djs-palette [data-action="connect"]').click();
  await page.locator('#fa-connect-dialog').waitFor({ state: 'visible' });

  // START_EVENT 被 UI 层过滤，用户无法选到
  const optionValues = await page.locator('#fa-connect-target option').evaluateAll(
    options => options.map(o => o.value),
  );
  assert.ok(!optionValues.includes('Start_1'), 'START_EVENT 不应出现在目标列表中');
  assert.ok(!optionValues.includes('Task_Review'), '源节点自身（自环）不应出现在目标列表中');
  assert.ok(optionValues.includes('End_1'), '合法目标应保留在列表中');
  await page.locator('#fa-connect-cancel').click();

  // 验证合同未变
  const contractAfter = await page.evaluate(() => {
    const store = window.__FLOW_ARCHITECT__.store;
    return JSON.stringify(store.snapshot());
  });
  assert.equal(contractBefore, contractAfter, '非法连接不应改变合同');

  // 验证 XML 未变
  const xmlAfter = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });
  assert.equal(xmlBefore, xmlAfter, '非法连接不应改变 XML');
});

test('F3: 从 END_EVENT 出发的 connect 被门禁拒绝且不改变合同', async t => {
  const { page } = await openV2Fixture(t);
  // 选择 End_1
  await page.locator('[data-element-id="End_1"]').click();

  const contractBefore = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  const xmlBefore = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });

  // 点击 palette 的 connect 按钮：END_EVENT 没有合法的出向连接，应在打开对话框前门禁拒绝
  const alertPromise = new Promise(resolve => {
    const handler = async dialog => {
      page.removeListener('dialog', handler);
      resolve(dialog.message());
      await dialog.accept();
    };
    page.on('dialog', handler);
  });
  await page.locator('.djs-palette [data-action="connect"]').click();
  const alertMsg = await alertPromise;
  assert.ok(alertMsg.includes('FA-DRAFT-FLOW-001') || alertMsg.includes('不允许'),
    `错误提示应包含门禁信息: ${alertMsg}`);
  assert.equal(await page.locator('#fa-connect-dialog').isVisible(), false,
    'END_EVENT 出发时不应打开顺序流对话框');

  const contractAfter = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  assert.equal(contractBefore, contractAfter, '从 END_EVENT 出发的连接不应改变合同');

  const xmlAfter = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });
  assert.equal(xmlBefore, xmlAfter, '从 END_EVENT 出发的连接不应改变 XML');
});

test('F3: 重复顺序流经对话框提交后被门禁拒绝且不改变合同', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();

  const contractBefore = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  const xmlBefore = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });

  // Task_Review → End_1 顺序流已存在：提交后应被命令层门禁拒绝
  const alertPromise = new Promise(resolve => {
    const handler = async dialog => {
      page.removeListener('dialog', handler);
      resolve(dialog.message());
      await dialog.accept();
    };
    page.on('dialog', handler);
  });
  await page.locator('.djs-palette [data-action="connect"]').click();
  await page.locator('#fa-connect-dialog').waitFor({ state: 'visible' });
  await page.locator('#fa-connect-target').selectOption({ label: '结束' });
  await page.getByRole('button', { name: '确认连接' }).click();
  const alertMsg = await alertPromise;
  assert.ok(alertMsg.includes('已存在') || alertMsg.includes('不允许'),
    `错误提示应包含门禁信息: ${alertMsg}`);

  const contractAfter = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  assert.equal(contractBefore, contractAfter, '重复连接不应改变合同');

  const xmlAfter = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });
  assert.equal(xmlBefore, xmlAfter, '重复连接不应改变 XML');
});
