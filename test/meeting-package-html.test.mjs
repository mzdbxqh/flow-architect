import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixture, makeRunDir } from './helpers/fixture.mjs';
import {
  buildMeetingPackageHtml,
  extractMeetingPackageHtml,
  compareMeetingPackages,
  validateProcessId,
} from '../scripts/lib/meeting-package-html.mjs';
import { compileBpmn } from '../scripts/lib/bpmn-compiler.mjs';

function v2Draft(overrides = {}) {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process_1', name: '采购审批流程', level: 'L4', is_leaf: true,
      description: '完成采购申请的审查与决策', purpose: '形成可执行的采购决定',
      owner: 'Role-process-owner', parent_process_name: '采购管理',
      inputs: ['采购申请'], outputs: ['审批结果'],
      start: { event_id: 'StartEvent_1', name: '开始', event_type: 'NONE' },
      end_results: [{ event_id: 'EndEvent_1', name: '结束' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity_Review', name: '审核采购申请',
        description: '对采购需求和材料完整性进行业务审核',
        activity_type: 'STANDARD', responsibility_model: 'RASCI',
        role_assignments: [{ role_id: 'Role-applicant', responsibility: 'R' }],
        sla: null, tools: ['ERP'], inputs: ['采购申请'],
        process_summary: '审核采购申请内容', outputs: ['审核结果'],
        completion_criteria: ['申请已审核'], references: [],
        main_task_id: 'Task_Review', confirmation: null, completeness: 'COMPLETE',
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
      { question_id: 'Q-001', text: '采购申请是否需要经理复核？', target_paths: ['Task_Review'], status: 'OPEN', answer: '' },
      { question_id: 'Q-002', text: '超过多少金额需要额外审批？', target_paths: ['Task_Review'], status: 'OPEN', answer: '' },
    ],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
    ...overrides,
  };
}

function generateBpmnXml(draft) {
  const { xml } = compileBpmn(draft);
  return xml;
}

const metadata = {
  package_id: 'procurement-approval',
  process_id: 'Process_1',
  title: '采购审批流程',
  revision: 'r01',
  based_on_revision: null,
};

test('HTML build is deterministic and round-trips payload', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  assert.equal(html, buildMeetingPackageHtml({ draft, bpmnXml, metadata }));
  const extracted = extractMeetingPackageHtml(html);
  assert.deepEqual(extracted.questions, draft.questions);
  assert.equal(extracted.bpmn_xml, bpmnXml);
  assert.deepEqual(extracted.process_card, draft.process_card);
  assert.deepEqual(extracted.activities, draft.activities);
});

test('builder rejects a V2 draft missing any required top-level field', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  delete draft.questions;
  assert.throws(
    () => buildMeetingPackageHtml({ draft, bpmnXml, metadata }),
    /流程草稿不符合 schema|questions|required/i,
  );
});

test('HTML contains no external dependency', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(?:src|href)=["']https?:/i);
  assert.match(html, /Content-Security-Policy/);
});

test('CSP uses real script hash, not unsafe-inline or unsafe-eval', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const cspMatch = html.match(/Content-Security-Policy"[^"]*content="([^"]+)"/);
  assert.ok(cspMatch, 'CSP header must exist');
  const csp = cspMatch[1];
  assert.match(csp, /script-src\s+'sha256-[A-Za-z0-9+/=]+'/);
  const scriptSrc = csp.split(';').find(s => s.trim().startsWith('script-src'));
  assert.ok(scriptSrc, 'script-src must exist');
  assert.doesNotMatch(scriptSrc, /unsafe-inline/);
  assert.doesNotMatch(scriptSrc, /unsafe-eval/);
});

test('invalid BPMN and dangling question references are rejected', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  assert.throws(() => buildMeetingPackageHtml({ draft, bpmnXml: '<x/>', metadata }), /BPMN/);
  assert.throws(() => buildMeetingPackageHtml({
    draft: v2Draft({ questions: [{ ...draft.questions[0], target_paths: ['Missing_1'] }] }),
    bpmnXml, metadata,
  }), /Missing_1/);
});

test('revision comparison reports BPMN and question changes', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const base = extractMeetingPackageHtml(html);
  const current = structuredClone(base);
  current.metadata.revision = 'r02';
  current.metadata.based_on_revision = 'r01';
  current.questions[0].status = 'CONFIRMED';
  const diff = compareMeetingPackages(base, current);
  assert.equal(diff.from_revision, 'r01');
  assert.equal(diff.to_revision, 'r02');
  assert.deepEqual(diff.question_changes.map(x => x.id), ['Q-001']);
});

test('malicious question text remains inert text', () => {
  const maliciousQuestions = JSON.parse(
    fs.readFileSync(fixture('meeting-package/malicious-questions.json'), 'utf8'));
  const draft = v2Draft({ questions: maliciousQuestions });
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  assert.doesNotMatch(html, /<img src=x/);
  assert.deepEqual(extractMeetingPackageHtml(html).questions, maliciousQuestions);
});

function rewritePayload(html, mutate) {
  const payload = structuredClone(extractMeetingPackageHtml(html));
  mutate(payload);
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return html.replace(
    /(<script id="fa-package-data" type="application\/json">)[A-Za-z0-9+/=]+(<\/script>)/,
    `$1${encoded}$2`,
  );
}

test('extractor enforces size and schema limits without executing HTML', () => {
  assert.throws(() => extractMeetingPackageHtml('x'.repeat(20 * 1024 * 1024 + 1)), /20 MiB/);
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const unknown = rewritePayload(html, payload => { payload.metadata.schema_version = '9.9.9'; });
  assert.throws(() => extractMeetingPackageHtml(unknown), /schema_version|payload/i);
  globalThis.__meetingPackageExecuted = false;
  const hostile = html.replace('</body>', '<script>globalThis.__meetingPackageExecuted=true</script></body>');
  extractMeetingPackageHtml(hostile);
  assert.equal(globalThis.__meetingPackageExecuted, false);
});

test('extractor validates questions schema and content hash', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const badQuestions = rewritePayload(html, payload => {
    payload.questions[0].status = 'INVALID_STATUS';
  });
  assert.throws(() => extractMeetingPackageHtml(badQuestions), /问题|schema|payload/i);

  const badHash = rewritePayload(html, payload => {
    payload.metadata.content_hash = 'sha256:' + '0'.repeat(64);
  });
  assert.throws(() => extractMeetingPackageHtml(badHash), /content_hash|hash|不一致|mismatch/i);
});

test('extractor rejects payload with tampered content hash', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const badRef = rewritePayload(html, payload => {
    payload.questions[0].target_paths = ['NonExistent_Element'];
  });
  assert.throws(() => extractMeetingPackageHtml(badRef), /content_hash|hash|不一致|element|reference/i);
});

test('extractor rejects duplicate and empty question IDs', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const dupIds = rewritePayload(html, payload => {
    payload.questions[1].question_id = 'Q-001';
  });
  assert.throws(() => extractMeetingPackageHtml(dupIds), /重复|duplicate|unique/i);
});

test('builder rejects XML declarations and unsafe output paths', () => {
  const draft = v2Draft();
  assert.throws(() => buildMeetingPackageHtml({
    draft, bpmnXml: '<!DOCTYPE x><definitions/>', metadata,
  }), /DOCTYPE/);
  const safeRunDir = makeRunDir('path-containment');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--draft', fixture('meeting-package/v2-draft.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', safeRunDir,
    '--output', '../escape.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('path containment rejects same-prefix directory escape', () => {
  const runDir = makeRunDir('prefix-escape');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--draft', fixture('meeting-package/v2-draft.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', runDir,
    '--output', '../' + path.basename(runDir) + '-escape/out.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('path containment rejects absolute output path outside runDir', () => {
  const runDir = makeRunDir('absolute-escape');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--draft', fixture('meeting-package/v2-draft.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', runDir,
    '--output', '/tmp/escape-outside.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('CLI uses one V2 draft as the complete business-data input', () => {
  const runDir = makeRunDir('v2-draft-only');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--draft', fixture('meeting-package/v2-draft.json'),
    '--title', 'V2 草稿测试', '--revision', 'r01',
    '--package-id', 'v2-draft-test',
    '--run-dir', runDir, '--output', 'draft-only.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'SUCCEEDED');
  const payload = extractMeetingPackageHtml(fs.readFileSync(path.join(runDir, 'draft-only.html'), 'utf8'));
  assert.equal(payload.metadata.process_id, v2Draft().process_card.process_id);
  assert.deepEqual(payload.questions, v2Draft().questions);
});

test('CLI rejects removed --questions compatibility argument', () => {
  const runDir = makeRunDir('removed-cli-argument');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--draft', fixture('meeting-package/v2-draft.json'),
    '--questions', fixture('meeting-package/questions.valid.json'),
    '--title', 'V2 草稿测试', '--revision', 'r01',
    '--package-id', 'v2-draft-test',
    '--run-dir', runDir, '--output', 'should-not-exist.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未知参数.*--questions/);
});

test('validateProcessId supports prefixed bpmn: namespace', () => {
  const prefixedBpmn = fs.readFileSync(fixture('diagrams/valid.bpmn'), 'utf8');
  assert.equal(validateProcessId(prefixedBpmn, 'Process_Order'), 'Process_Order');
  assert.throws(() => validateProcessId(prefixedBpmn, 'NonExistent'), /不存在/);
});

test('nested output directory is created inside runDir', () => {
  const runDir = makeRunDir('nested-output');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--draft', fixture('meeting-package/v2-draft.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', runDir,
    '--output', 'nested/deep/output.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'SUCCEEDED');
  assert.ok(fs.existsSync(path.join(runDir, 'nested', 'deep', 'output.html')));
});

// ===== V2 篡改检测 =====

test('tampering process_card in HTML is detected by extractor', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const tampered = rewritePayload(html, p => { p.process_card.name = '篡改名称'; });
  assert.throws(() => extractMeetingPackageHtml(tampered), /content_hash|hash|不一致/i);
});

test('tampering activities in HTML is detected by extractor', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const tampered = rewritePayload(html, p => { p.activities[0].name = '篡改活动'; });
  assert.throws(() => extractMeetingPackageHtml(tampered), /content_hash|hash|不一致/i);
});

test('tampering diagram in HTML is detected by extractor', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const tampered = rewritePayload(html, p => { p.diagram.lanes[0].name = '篡改泳道'; });
  assert.throws(() => extractMeetingPackageHtml(tampered), /content_hash|hash|不一致/i);
});

test('tampering provenance in HTML is detected by extractor', () => {
  const draft = v2Draft({
    provenance: { '/process_card/name': { certainty: 'EXPLICIT', evidence_refs: ['B-001'] } },
  });
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const tampered = rewritePayload(html, p => {
    p.provenance['/process_card/name'].certainty = 'MISSING';
  });
  assert.throws(() => extractMeetingPackageHtml(tampered), /content_hash|hash|不一致/i);
});

test('V2 complete payload round-trips with all business fields intact', () => {
  const draft = v2Draft();
  const bpmnXml = generateBpmnXml(draft);
  const html = buildMeetingPackageHtml({ draft, bpmnXml, metadata });
  const extracted = extractMeetingPackageHtml(html);
  assert.deepEqual(extracted.process_card, draft.process_card);
  assert.deepEqual(extracted.activities, draft.activities);
  assert.deepEqual(extracted.diagram, draft.diagram);
  assert.equal(extracted.bpmn_xml, bpmnXml);
  assert.deepEqual(extracted.questions, draft.questions);
  assert.deepEqual(extracted.provenance, draft.provenance);
  assert.deepEqual(extracted.source_summary, draft.source_summary);
});
