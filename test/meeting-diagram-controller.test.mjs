import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { makeRunDir, fixture } from './helpers/fixture.mjs';
import { buildMeetingPackageHtml } from '../scripts/lib/meeting-package-html.mjs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function openFixture(t) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const bpmnXml = fs.readFileSync(fixture('meeting-package/single-process.bpmn'), 'utf8');
  const questions = JSON.parse(fs.readFileSync(fixture('meeting-package/questions.valid.json'), 'utf8'));
  const html = buildMeetingPackageHtml({
    bpmnXml, questions,
    metadata: {
      schema_version: '1.0.0', package_id: 'procurement-approval',
      process_id: 'Process_1', title: '采购审批流程', revision: 'r01',
      based_on_revision: null, runtime_version: '1.0.0',
    },
  });
  const runDir = makeRunDir('diagram-controller');
  const output = path.join(runDir, 'process-r01.html');
  fs.writeFileSync(output, html);
  await page.goto(pathToFileURL(output).href);
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();
  return { browser, page };
}

test('XOR branch creation rolls back all elements on failure', async t => {
  const { page } = await openFixture(t);
  await page.locator('[data-element-id="Task_Review"]').click();

  const beforeCount = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.modeler.get('elementRegistry').filter(e =>
      e.type === 'bpmn:ExclusiveGateway' || e.type === 'bpmn:Task').length);

  await page.evaluate(() => {
    const dc = window.__FLOW_ARCHITECT__.diagramController;
    const origAppend = window.__FLOW_ARCHITECT__.modeler.get('autoPlace').append;
    let callCount = 0;
    window.__FLOW_ARCHITECT__.modeler.get('autoPlace').append = function (...args) {
      callCount++;
      if (callCount === 3) throw new Error('模拟第三步失败');
      return origAppend.apply(this, args);
    };
    try {
      dc.appendExclusiveBranch('测试问题', '是', '否');
    } catch (e) {
      // expected
    }
    window.__FLOW_ARCHITECT__.modeler.get('autoPlace').append = origAppend;
  });

  const afterCount = await page.evaluate(() =>
    window.__FLOW_ARCHITECT__.modeler.get('elementRegistry').filter(e =>
      e.type === 'bpmn:ExclusiveGateway' || e.type === 'bpmn:Task').length);
  assert.equal(afterCount, beforeCount);
});

test('question pre-export validation rejects duplicate IDs', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    window.__FLOW_ARCHITECT__.payload.questions[1].id = 'Q-001';
  });
  const result = await page.evaluate(async () => {
    try {
      await window.__FLOW_ARCHITECT__.exportController.currentPayload();
      return { caught: false };
    } catch (e) {
      return { caught: true, message: e.message };
    }
  });
  assert.equal(result.caught, true);
  assert.match(result.message, /重复|duplicate/i);
});

test('question pre-export validation rejects empty question text', async t => {
  const { page } = await openFixture(t);
  await page.evaluate(() => {
    window.__FLOW_ARCHITECT__.payload.questions[0].text = '';
  });
  const result = await page.evaluate(async () => {
    try {
      await window.__FLOW_ARCHITECT__.exportController.currentPayload();
      return { caught: false };
    } catch (e) {
      return { caught: true, message: e.message };
    }
  });
  assert.equal(result.caught, true);
  assert.match(result.message, /不能为空|empty/i);
});

test('question status select shows Chinese labels', async t => {
  const { page } = await openFixture(t);
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
