import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { extractMeetingPackageHtml } from '../scripts/lib/meeting-package-html.mjs';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const execFileAsync = promisify(execFile);

const testDir = fileURLToPath(new URL('.', import.meta.url));
const packageDir = join(testDir, '..');
const fixtureDir = join(testDir, 'fixtures', 'process-draft', 'sources');
const node = process.execPath;

async function runScript(script, args) {
  return execFileAsync(node, [join(packageDir, 'scripts', script), ...args], {
    cwd: packageDir,
    maxBuffer: 20 * 1024 * 1024,
  });
}

/**
 * 使用真实多源材料通过 CLI 流水线生成 r01 HTML
 * 复用 e2e-process-draft.test.mjs 的完整构造流程
 */
async function buildRealMultiSourceR01(runDir) {
  const inputs = [
    'sample.md',
    'sample.docx',
    'sample.xlsx',
    'sample.pptx',
    'sample.pdf',
    'test.bpmn',
  ].map(name => join(fixtureDir, name));

  const prepareArgs = inputs.flatMap(input => ['--input', input]);
  prepareArgs.push('--run-dir', runDir, '--title', '多源采购审批流程');
  await runScript('prepare-process-draft.mjs', prepareArgs);

  const batchDir = join(runDir, 'evidence', 'batches');
  const batchFiles = (await readdir(batchDir)).filter(name => name.endsWith('.json')).sort();
  assert.ok(batchFiles.length > 0, 'prepare 必须生成真实 batch');

  for (const [index, filename] of batchFiles.entries()) {
    const batchPath = join(batchDir, filename);
    const batch = JSON.parse(await readFile(batchPath, 'utf8'));

    const evidenceRef = batch.blocks[0].block_id;
    const suffix = String(index + 1).padStart(3, '0');
    const facts = [];
    if (index === 0) {
      facts.push({
        fact_id: 'F-role-001',
        kind: 'ROLE',
        process_key: 'procurement-approval',
        subject_key: 'applicant',
        label: '申请人',
        attributes: {},
        certainty: 'EXPLICIT',
        evidence_refs: [evidenceRef],
      });
    }
    facts.push({
      fact_id: `F-activity-${suffix}`,
      kind: 'ACTIVITY',
      process_key: 'procurement-approval',
      subject_key: `activity-${suffix}`,
      label: `待确认活动 ${suffix}`,
      attributes: { inputs: [], outputs: [] },
      certainty: 'EXPLICIT',
      evidence_refs: [evidenceRef],
    });

    const fragment = {
      schema_version: '1.0.0',
      batch_id: batch.batch_id,
      batch_sha256: batch.batch_sha256,
      facts,
      uncertainties: [],
    };
    const fragmentPath = join(runDir, `${batch.batch_id}.fragment.json`);
    await writeFile(fragmentPath, `${JSON.stringify(fragment, null, 2)}\n`);
    await runScript('accept-semantic-fragment.mjs', [
      '--fragment', fragmentPath,
      '--batch', batchPath,
      '--run-dir', runDir,
    ]);
  }

  await runScript('merge-process-fragments.mjs', ['--run-dir', runDir]);
  await runScript('finalize-process-draft.mjs', ['--run-dir', runDir, '--revision', 'r01']);

  const finalDir = join(runDir, 'final');
  const htmlName = (await readdir(finalDir)).find(name => name.endsWith('-r01.html'));
  assert.ok(htmlName, 'finalize 必须生成 r01 HTML');

  return join(finalDir, htmlName);
}

test('真实多源 r01 浏览器端到端：编辑、导出 r02、重新打开并验证', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flow-architect-browser-e2e-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  // 步骤 1: 使用真实多源材料生成 r01 HTML
  const htmlPath = await buildRealMultiSourceR01(root);

  // 步骤 2: 打开 r01 HTML 并监听网络请求
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const networkRequests = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('file:') && !url.startsWith('blob:')) {
      networkRequests.push(url);
    }
  });

  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator('#fa-canvas svg[data-element-id]').waitFor();

  // 断言: 除 file/blob 外零网络
  assert.deepEqual(networkRequests, [], 'r01 打开后不应有任何网络请求');

  // 步骤 3: 验证双栏布局
  assert.equal(await page.locator('#fa-main').count(), 1, '必须存在 #fa-main');
  assert.equal(await page.locator('#fa-canvas').count(), 1, '必须存在 #fa-canvas');
  assert.equal(await page.locator('#fa-questions').count(), 1, '必须存在 #fa-questions');

  const canvasBox = await page.locator('#fa-canvas').boundingBox();
  const questionsBox = await page.locator('#fa-questions').boundingBox();
  assert.ok(canvasBox.x < questionsBox.x, 'canvas 应在 questions 左侧');
  assert.ok(questionsBox.x >= canvasBox.x + canvasBox.width - 2, '双栏应水平排列');

  // 步骤 4: 选第一个可编辑 task 修改名称为"线下确认活动"
  const firstTask = page.locator('.djs-element[data-element-id^="Activity-"]').first();
  const firstTaskId = await firstTask.getAttribute('data-element-id');
  assert.ok(firstTaskId, '必须找到可编辑的活动元素');
  await firstTask.click({ force: true });
  await page.waitForTimeout(200);

  // 检查是否出现了修改名称按钮
  const renameButton = page.getByRole('button', { name: '修改名称' });
  await renameButton.waitFor({ state: 'visible' });
  await renameButton.click();
  await page.waitForTimeout(200);

  // 检查输入框是否出现
  const input = page.locator('#fa-rename-input');
  await input.waitFor({ state: 'visible' });
  await input.fill('线下确认活动');

  // 监听控制台错误
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.getByRole('button', { name: '确认修改' }).click();
  await page.waitForTimeout(2000);

  // 检查是否有错误
  if (consoleErrors.length > 0) {
    console.log('Console errors:', consoleErrors);
  }

  // 验证内存中的 BPMN 数据已更新
  const bpmnXml = await page.evaluate(async () =>
    (await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true })).xml
  );
  assert.ok(bpmnXml.includes('线下确认活动'), `内存中的 BPMN 应包含"线下确认活动"，实际为: ${bpmnXml.substring(0, 500)}`);

  // 步骤 5: 填写第一个问题回答"线下会议已确认"并状态 CONFIRMED
  const firstQuestion = page.locator('[data-question-id]').first();
  const questionId = await firstQuestion.getAttribute('data-question-id');

  await page.getByLabel(`${questionId} 回答`).fill('线下会议已确认');
  await page.getByLabel(`${questionId} 状态`).selectOption('CONFIRMED');

  // 验证内存中的 payload 已更新
  const questionPayload = await page.evaluate((qId) =>
    window.__FLOW_ARCHITECT__.payload.questions.find(q => q.id === qId),
    questionId
  );
  assert.equal(questionPayload.answer, '线下会议已确认', '问题回答应已保存');
  assert.equal(questionPayload.status, 'CONFIRMED', '问题状态应为 CONFIRMED');

  // 步骤 6: 点击导出新版本捕获 r02 下载
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出新版本' }).click();
  const r02Download = await download;

  assert.match(r02Download.suggestedFilename(), /-r02\.html$/, '下载文件名应为 r02');

  const r02TempPath = await r02Download.path();
  const r02Path = join(root, 'process-r02.html');
  fs.copyFileSync(r02TempPath, r02Path);

  // 步骤 7: 用 extractMeetingPackageHtml 读取 r02 并断言
  const r02Html = await readFile(r02Path, 'utf8');
  const r02Payload = extractMeetingPackageHtml(r02Html);

  assert.equal(r02Payload.metadata.revision, 'r02', 'revision 应为 r02');
  assert.equal(r02Payload.metadata.based_on_revision, 'r01', 'based_on_revision 应为 r01');

  // 断言 BPMN 含新名称
  assert.ok(r02Payload.bpmn_xml.includes('线下确认活动'), 'BPMN XML 应包含修改后的任务名称"线下确认活动"');

  // 断言问题回答/状态保存
  const r02Question = r02Payload.questions.find(q => q.id === questionId);
  assert.ok(r02Question, `r02 应包含问题 ${questionId}`);
  assert.equal(r02Question.answer, '线下会议已确认', 'r02 问题回答应保存');
  assert.equal(r02Question.status, 'CONFIRMED', 'r02 问题状态应为 CONFIRMED');

  // 步骤 8: 重新用新 page 打开 r02，确认仍可修改且零网络
  const r02Context = await browser.newContext();
  t.after(() => r02Context.close());

  const r02Page = await r02Context.newPage({ viewport: { width: 1440, height: 900 } });
  const r02NetworkRequests = [];
  r02Page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('file:') && !url.startsWith('blob:')) {
      r02NetworkRequests.push(url);
    }
  });

  await r02Page.goto(pathToFileURL(r02Path).href);
  await r02Page.locator('#fa-canvas svg[data-element-id]').waitFor();

  // 断言: r02 打开后零网络
  assert.deepEqual(r02NetworkRequests, [], 'r02 打开后不应有任何网络请求');

  // 验证 r02 仍可修改 - 尝试再次修改任务名称
  const r02FirstTask = r02Page.locator(`[data-element-id="${firstTaskId}"]`);
  await r02FirstTask.click({ force: true });
  await r02Page.getByRole('button', { name: '修改名称' }).click();
  await r02Page.locator('#fa-rename-input').fill('最终确认活动');
  await r02Page.getByRole('button', { name: '确认修改' }).click();
  await r02Page.waitForTimeout(500);

  const r02EditedXml = await r02Page.evaluate(async () =>
    (await window.__FLOW_ARCHITECT__.modeler.saveXML({ format: true })).xml);
  assert.ok(r02EditedXml.includes('最终确认活动'), 'r02 BPMN 模型必须仍可修改活动名称');

  // 验证 r02 问题仍可修改
  await r02Page.getByLabel(`${questionId} 回答`).fill('最终确认完成');
  await r02Page.getByLabel(`${questionId} 状态`).selectOption('CONFIRMED');

  const r02QuestionPayload = await r02Page.evaluate((qId) =>
    window.__FLOW_ARCHITECT__.payload.questions.find(q => q.id === qId),
    questionId
  );
  assert.equal(r02QuestionPayload.answer, '最终确认完成', 'r02 问题回答应可再次修改');
});
