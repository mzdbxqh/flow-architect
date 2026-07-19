/**
 * 可用性与视觉回归测试（会议包 P0/P1 优化）
 *
 * 1. 未选中元素时编辑按钮禁用，选中图元素后启用
 * 2. 工具箱每个可见条目都渲染出可见 SVG 图标
 * 3. 切换到非流程图标签页时，流程图面板完全隐藏（不再残留空白区域）
 * 4. 首访引导条默认可见、可关闭
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
    questions: [
      {
        question_id: 'Q-001',
        text: '采购申请是否需要经理复核？',
        target_paths: ['Task_Review'],
        status: 'OPEN',
        answer: '',
      },
    ],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

async function openV2Fixture(t) {
  const runDir = makeRunDir('usability');
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

const EDIT_BUTTON_IDS = ['#fa-rename', '#fa-insert-task', '#fa-add-gateway', '#fa-delete'];

test('edit buttons are disabled until a diagram element is selected', async t => {
  const { page } = await openV2Fixture(t);
  for (const id of EDIT_BUTTON_IDS) {
    assert.equal(await page.locator(id).isDisabled(), true, `${id} 初始应禁用`);
  }
  await page.locator('[data-element-id="Task_Review"]').click();
  for (const id of EDIT_BUTTON_IDS) {
    assert.equal(await page.locator(id).isDisabled(), false, `${id} 选中后应启用`);
  }
});

test('palette entries render visible SVG icons', async t => {
  const { page } = await openV2Fixture(t);
  await page.locator('.djs-palette').waitFor({ state: 'visible', timeout: 1000 });
  const entryCount = await page.locator('.djs-palette [data-action]:visible').count();
  assert.ok(entryCount > 0, '工具箱应有可见条目');
  const icons = page.locator('.djs-palette [data-action]:visible img');
  assert.equal(await icons.count(), entryCount, '每个可见条目都应有图标');
  const widths = await icons.evaluateAll(nodes => nodes.map(n => n.naturalWidth));
  assert.ok(widths.every(w => w > 0), '所有图标都应成功加载');
});

test('non-diagram tab fully hides the diagram panel', async t => {
  const { page } = await openV2Fixture(t);
  assert.equal(await page.locator('#fa-diagram-panel').isVisible(), true);
  await page.getByRole('tab', { name: /流程卡片/ }).click();
  assert.equal(await page.locator('#fa-diagram-panel').isVisible(), false, '流程图面板应完全隐藏');
  await page.getByRole('tab', { name: /待确认问题/ }).click();
  assert.equal(await page.locator('#fa-diagram-panel').isVisible(), false, '流程图面板应完全隐藏');
});

test('guide banner is visible initially and dismissible', async t => {
  const { page } = await openV2Fixture(t);
  const banner = page.locator('#fa-guide-banner');
  assert.equal(await banner.isVisible(), true, '引导条初始应可见');
  await page.locator('#fa-guide-dismiss').click();
  assert.equal(await banner.isVisible(), false, '引导条关闭后应隐藏');
});
