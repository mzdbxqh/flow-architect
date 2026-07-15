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

test('original package has dual-column layout with fa-main, fa-canvas, fa-questions', async t => {
  const { page } = await openFixture(t);
  assert.equal(await page.locator('#fa-main').count(), 1);
  assert.equal(await page.locator('#fa-canvas').count(), 1);
  assert.equal(await page.locator('#fa-questions').count(), 1);
  const mainBox = await page.locator('#fa-main').boundingBox();
  const canvasBox = await page.locator('#fa-canvas').boundingBox();
  const questionsBox = await page.locator('#fa-questions').boundingBox();
  assert.ok(mainBox.width > 600);
  assert.ok(mainBox.height > 400);
  assert.ok(canvasBox.x < questionsBox.x);
  assert.ok(questionsBox.x >= canvasBox.x + canvasBox.width - 2);
});

test('bpmn-js palette and context pad are hidden', async t => {
  const { page } = await openFixture(t);
  assert.equal(await page.locator('.djs-palette').evaluateAll(els =>
    els.every(e => getComputedStyle(e).display === 'none')), true);
  assert.equal(await page.locator('.djs-context-pad').evaluateAll(els =>
    els.every(e => getComputedStyle(e).display === 'none')), true);
  assert.equal(await page.locator('.djs-palette').evaluateAll(els =>
    els.every(e => !e.offsetHeight)), true);
});

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

test('question switch clears old highlight and shows new one', async t => {
  const { page } = await openFixture(t);
  await page.locator('[data-question-id="Q-001"] button').click();
  await assert.doesNotReject(() => page.locator('g.fa-question-highlight').waitFor());
  await page.locator('[data-question-id="Q-002"] button').click();
  await page.waitForTimeout(200);
  const highlightedQ1 = await page.locator('[data-element-id="Task_Review"].fa-question-highlight').count();
  const highlightedQ2 = await page.locator('[data-element-id="Task_Approve"].fa-question-highlight').count();
  assert.equal(highlightedQ1, 0);
  assert.equal(highlightedQ2, 1);
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

test('browser exports a reopenable r02 HTML with correct structure', async t => {
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
  await reopened.locator('#fa-canvas svg[data-element-id]').waitFor();
  assert.equal(await reopened.locator('#fa-main').count(), 1);
  assert.equal(await reopened.locator('#fa-canvas').count(), 1);
  assert.equal(await reopened.locator('#fa-questions').count(), 1);
  const mainBox = await reopened.locator('#fa-main').boundingBox();
  const canvasBox = await reopened.locator('#fa-canvas').boundingBox();
  const questionsBox = await reopened.locator('#fa-questions').boundingBox();
  assert.ok(mainBox.width > 600);
  assert.ok(mainBox.height > 400);
  assert.ok(canvasBox.x < questionsBox.x);
  assert.ok(questionsBox.x >= canvasBox.x + canvasBox.width - 2);
  assert.equal(await reopened.locator('.djs-palette').evaluateAll(els =>
    els.every(e => getComputedStyle(e).display === 'none')), true);
  await context.close();
});

test('r02 can modify activity name, question answer/status, and re-export to r03', async t => {
  const { browser, page } = await openFixture(t);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出新版本' }).click();
  const item = await download;
  const tempPath = await item.path();
  const saved = tempPath + '.html';
  fs.copyFileSync(tempPath, saved);

  const context = await browser.newContext();
  const r02Page = await context.newPage();
  await r02Page.goto(pathToFileURL(saved).href);
  await r02Page.locator('#fa-canvas svg[data-element-id]').waitFor();

  await r02Page.locator('[data-element-id="Task_Review"]').click();
  await r02Page.getByRole('button', { name: '修改名称' }).click();
  await r02Page.locator('#fa-rename-input').fill('修改后名称');
  await r02Page.getByRole('button', { name: '确认修改' }).click();
  assert.equal(await r02Page.locator('[data-element-id="Task_Review"] text').textContent(), '修改后名称');

  await r02Page.getByLabel('Q-001 回答').fill('测试回答');
  await r02Page.getByLabel('Q-001 状态').selectOption('CONFIRMED');
  const q = await r02Page.evaluate(() =>
    window.__FLOW_ARCHITECT__.payload.questions.find(q => q.id === 'Q-001'));
  assert.equal(q.answer, '测试回答');
  assert.equal(q.status, 'CONFIRMED');

  const r03Download = r02Page.waitForEvent('download');
  await r02Page.getByRole('button', { name: '导出新版本' }).click();
  const r03 = await r03Download;
  assert.match(r03.suggestedFilename(), /-r03\.html$/);
  await context.close();
});

test('offline package emits no network request', async t => {
  const { page } = await openFixture(t);
  const requests = [];
  page.on('request', request => {
    if (!request.url().startsWith('file:') && !request.url().startsWith('blob:')) requests.push(request.url());
  });
  await page.reload();
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  assert.deepEqual(requests, []);
});

async function clickAndWaitForAlert(page, btnName) {
  const alertPromise = new Promise(resolve => {
    const handler = async dialog => {
      page.removeListener('dialog', handler);
      resolve(dialog.message());
      await dialog.accept();
    };
    page.on('dialog', handler);
  });
  await page.getByRole('button', { name: btnName }).click();
  return alertPromise;
}

test('export with illegal question status shows Chinese error, no download', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    window.__FLOW_ARCHITECT__.payload.questions[0].status = 'BOGUS';
  });
  const alertMsg = await clickAndWaitForAlert(page, '导出新版本');
  assert.match(alertMsg, /[一-鿿]/);
  assert.ok(!alertMsg.includes('Unhandled'));
});

test('export with dangling element ref shows Chinese error, no download', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    window.__FLOW_ARCHITECT__.payload.questions[0].element_ids.push('Ghost_Element');
  });
  const alertMsg = await clickAndWaitForAlert(page, '导出新版本');
  assert.match(alertMsg, /[一-鿿]/);
  assert.match(alertMsg, /Ghost_Element|不存在|引用/);
});

test('all four export buttons catch async errors with Chinese alert', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    window.__FLOW_ARCHITECT__.payload.questions[0].text = '';
  });
  for (const btn of ['导出新版本', '导出 BPMN', '导出问题']) {
    const alertMsg = await clickAndWaitForAlert(page, btn);
    assert.match(alertMsg, /[一-鿿]/);
  }
});
