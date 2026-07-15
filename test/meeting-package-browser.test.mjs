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
