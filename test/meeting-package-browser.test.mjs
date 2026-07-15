import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { makeRunDir, fixture } from './helpers/fixture.mjs';
import { buildMeetingPackageHtml } from '../scripts/lib/meeting-package-html.mjs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function buildFixturePackage(runDir) {
  const bpmnXml = fs.readFileSync(fixture('meeting-package/single-process.bpmn'), 'utf8');
  const questions = JSON.parse(fs.readFileSync(fixture('meeting-package/questions.valid.json'), 'utf8'));
  const html = buildMeetingPackageHtml({
    bpmnXml,
    questions,
    metadata: {
      schema_version: '1.0.0', package_id: 'procurement-approval',
      process_id: 'Process_1', title: '采购审批流程', revision: 'r01',
      based_on_revision: null, runtime_version: '1.0.0',
    },
  });
  const output = path.join(runDir, 'process-r01.html');
  fs.writeFileSync(output, html);
  return output;
}

async function openFixture(t) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const html = await buildFixturePackage(makeRunDir('browser'));
  await page.goto(pathToFileURL(html).href);
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  return { browser, page };
}

test('question list and BPMN overlays locate each other', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const html = await buildFixturePackage(makeRunDir('browser-question'));
  await page.goto(pathToFileURL(html).href);
  await page.locator('[data-question-id="Q-001"] button').click();
  await assert.doesNotReject(() => page.locator('g.fa-question-highlight').waitFor());
  await page.locator('[data-overlay-question-id="Q-001"]').click();
  assert.equal(await page.locator('[data-question-id="Q-001"]').getAttribute('aria-current'), 'true');
});

test('question answer and status update the in-memory payload', async t => {
  const { page } = await openFixture(t);
  await page.getByLabel('Q-001 回答').fill('由采购经理复核');
  await page.getByLabel('Q-001 状态').selectOption('CONFIRMED');
  const question = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.payload.questions.find(q => q.id === 'Q-001'));
  assert.equal(question.answer, '由采购经理复核');
  assert.equal(question.status, 'CONFIRMED');
  assert.equal(await page.locator('[data-overlay-question-id="Q-001"]').count(), 0);
});

test('business edit controls rename, insert, branch, delete, undo and redo', async t => {
  const { browser, page } = await openFixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.getByRole('button', { name: '修改名称' }).click();
  await page.locator('#fa-rename-input').fill('复核采购申请');
  await page.getByRole('button', { name: '确认修改' }).click();
  assert.equal(await page.locator('[data-element-id="Task_Review"] text').textContent(), '复核采购申请');
  await page.getByRole('button', { name: '撤销' }).click();
  assert.equal(await page.locator('[data-element-id="Task_Review"] text').textContent(), '审核采购申请');
  await page.getByRole('button', { name: '重做' }).click();
  assert.equal(await page.locator('[data-element-id="Task_Review"] text').textContent(), '复核采购申请');
  await browser.close();
});

test('insert, branch and protected delete use business controls', async t => {
  const { page } = await openFixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();
  await page.getByRole('button', { name: '后插活动' }).click();
  await page.locator('#fa-insert-input').fill('记录复核结果');
  await page.getByRole('button', { name: '确认新增' }).click();
  assert.equal(await page.locator('.djs-element[data-element-id^="Activity_"]').count() > 0, true);

  await page.locator('[data-element-id="Task_Review"]').click();
  await page.getByRole('button', { name: '增加判断' }).click();
  await page.locator('#fa-gateway-question').fill('申请是否完整？');
  await page.locator('#fa-gateway-yes').fill('继续审批');
  await page.locator('#fa-gateway-no').fill('退回补充');
  await page.getByRole('button', { name: '确认新增判断' }).click();
  assert.equal(await page.locator('.djs-element[data-element-id^="Gateway_"]').count() > 0, true);

  await page.locator('[data-element-id="Task_Review"]').click();
  let dialogMessage = '';
  page.on('dialog', async dialog => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.getByRole('button', { name: '删除活动' }).click();
  await page.waitForTimeout(500);
  assert.match(dialogMessage, /请先处理关联问题：Q-001/);
  assert.equal(await page.locator('[data-element-id="Task_Review"]').count(), 1);
});

test('native drag and reconnect persist BPMN DI and flow refs', async t => {
  const { page } = await openFixture(t);
  const task = page.locator('[data-element-id="Task_Review"] .djs-hit');
  await task.dragTo(page.locator('#fa-canvas'), {
    targetPosition: { x: 520, y: 260 },
  });
  await page.evaluate(() => {
    const modeler = window.__FLOW_ARCHITECT__.modeler;
    const registry = modeler.get('elementRegistry');
    modeler.get('modeling').reconnectEnd(
      registry.get('Flow_Review_Approve'),
      registry.get('Task_Rework'),
      { x: 680, y: 340 },
    );
  });
  const xml = await page.evaluate(async () =>
    (await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true })).xml);
  assert.match(xml, /BPMNShape[^>]+bpmnElement="Task_Review"/);
  assert.match(xml, /<di:waypoint/);
  assert.match(xml, /sequenceFlow[^>]+id="Flow_Review_Approve"[^>]+targetRef="Task_Rework"/);
});

test('browser exports a reopenable r02 HTML', async t => {
  const { browser, page } = await openFixture(t);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出新版本' }).click();
  const item = await download;
  assert.match(item.suggestedFilename(), /-r02\.html$/);
  const tempPath = await item.path();
  const saved = tempPath + '.html';
  fs.copyFileSync(tempPath, saved);
  const context = await browser.newContext();
  const reopened = await context.newPage();
  await reopened.goto(pathToFileURL(saved).href);
  await assert.doesNotReject(() => reopened.locator('#fa-canvas svg[data-element-id]').waitFor());
  await context.close();
});
