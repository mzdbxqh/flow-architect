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

test('F3: 通过 palette connect 动作尝试连接到 START_EVENT 被拒绝且不改变合同', async t => {
  const { page } = await openV2Fixture(t);
  // 选择 Task_Review
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

  // 拦截 window.prompt 返回非法目标 START_1
  await page.evaluate(() => {
    window.__origPrompt = window.prompt;
    window.prompt = () => 'Start_1';
  });

  // 点击 palette 的 connect 按钮
  await page.locator('.djs-palette [data-action="connect"]').click();

  // 等待 alert 弹出（错误提示）
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 }).catch(() => null);
  const dialog = await dialogPromise;
  if (dialog) {
    assert.ok(dialog.message().includes('FA-DRAFT-FLOW-001') || dialog.message().includes('不允许'),
      `错误提示应包含门禁信息: ${dialog.message()}`);
    await dialog.accept();
  }

  // 恢复 prompt
  await page.evaluate(() => {
    window.prompt = window.__origPrompt;
  });

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

test('F3: 通过 palette connect 动作尝试从 END_EVENT 出发被拒绝且不改变合同', async t => {
  const { page } = await openV2Fixture(t);
  // 选择 End_1
  await page.locator('[data-element-id="End_1"]').click();

  const contractBefore = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  const xmlBefore = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });

  // 拦截 prompt 返回目标 Task_Review
  await page.evaluate(() => {
    window.__origPrompt2 = window.prompt;
    window.prompt = () => 'Task_Review';
  });

  await page.locator('.djs-palette [data-action="connect"]').click();

  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 }).catch(() => null);
  const dialog = await dialogPromise;
  if (dialog) {
    assert.ok(dialog.message().includes('FA-DRAFT-FLOW-001') || dialog.message().includes('不允许'),
      `错误提示应包含门禁信息: ${dialog.message()}`);
    await dialog.accept();
  }

  await page.evaluate(() => {
    window.prompt = window.__origPrompt2;
  });

  const contractAfter = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  assert.equal(contractBefore, contractAfter, '从 END_EVENT 出发的连接不应改变合同');

  const xmlAfter = await page.evaluate(async () => {
    const { xml } = await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true });
    return xml;
  });
  assert.equal(xmlBefore, xmlAfter, '从 END_EVENT 出发的连接不应改变 XML');
});

test('F3: 通过 palette connect 动作尝试自环被拒绝且不改变合同', async t => {
  const { page } = await openV2Fixture(t);
  // 选择 Task_Review
  await page.locator('[data-element-id="Task_Review"]').click();

  const contractBefore = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));

  // 拦截 prompt 返回自己
  await page.evaluate(() => {
    window.__origPrompt3 = window.prompt;
    window.prompt = () => 'Task_Review';
  });

  await page.locator('.djs-palette [data-action="connect"]').click();

  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 }).catch(() => null);
  const dialog = await dialogPromise;
  if (dialog) {
    assert.ok(dialog.message().includes('FA-DRAFT-FLOW-001') || dialog.message().includes('不允许') || dialog.message().includes('自环'),
      `错误提示应包含门禁信息: ${dialog.message()}`);
    await dialog.accept();
  }

  await page.evaluate(() => {
    window.prompt = window.__origPrompt3;
  });

  const contractAfter = await page.evaluate(() =>
    JSON.stringify(window.__FLOW_ARCHITECT__.store.snapshot()));
  assert.equal(contractBefore, contractAfter, '自环连接不应改变合同');
});
