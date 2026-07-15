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
} from '../scripts/lib/meeting-package-html.mjs';

const bpmnXml = fs.readFileSync(fixture('meeting-package/single-process.bpmn'), 'utf8');
const questions = JSON.parse(fs.readFileSync(fixture('meeting-package/questions.valid.json'), 'utf8'));
const metadata = {
  schema_version: '1.0.0', package_id: 'procurement-approval',
  process_id: 'Process_1', title: '采购审批流程', revision: 'r01',
  based_on_revision: null, runtime_version: '1.0.0',
};

test('HTML build is deterministic and round-trips payload', () => {
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  assert.equal(html, buildMeetingPackageHtml({ bpmnXml, questions, metadata }));
  assert.deepEqual(extractMeetingPackageHtml(html).questions, questions);
  assert.equal(extractMeetingPackageHtml(html).bpmn_xml, bpmnXml);
});

test('HTML contains no external dependency', () => {
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(?:src|href)=["']https?:/i);
  assert.match(html, /Content-Security-Policy/);
});

test('invalid BPMN and dangling question references are rejected', () => {
  assert.throws(() => buildMeetingPackageHtml({ bpmnXml: '<x/>', questions, metadata }), /BPMN/);
  assert.throws(() => buildMeetingPackageHtml({
    bpmnXml, questions: [{ ...questions[0], element_ids: ['Missing_1'] }], metadata,
  }), /Missing_1/);
});

test('revision comparison reports BPMN and question changes', () => {
  const baseHtml = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  const base = extractMeetingPackageHtml(baseHtml);
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
  const maliciousQuestions = [{
    id: 'Q-XSS',
    text: '</script><img src=x onerror="globalThis.pwned=1">',
    element_ids: ['Task_Review'], status: 'OPEN', answer: '',
  }];
  const html = buildMeetingPackageHtml({ bpmnXml, questions: maliciousQuestions, metadata });
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
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  const unknown = rewritePayload(html, payload => { payload.metadata.schema_version = '9.9.9'; });
  assert.throws(() => extractMeetingPackageHtml(unknown), /schema_version|payload/i);
  globalThis.__meetingPackageExecuted = false;
  const hostile = html.replace('</body>', '<script>globalThis.__meetingPackageExecuted=true</script></body>');
  extractMeetingPackageHtml(hostile);
  assert.equal(globalThis.__meetingPackageExecuted, false);
});

test('builder rejects XML declarations and unsafe output paths', () => {
  assert.throws(() => buildMeetingPackageHtml({
    bpmnXml: '<!DOCTYPE x><definitions/>', questions, metadata,
  }), /DOCTYPE/);
  const safeRunDir = makeRunDir('path-containment');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--bpmn', fixture('meeting-package/single-process.bpmn'),
    '--questions', fixture('meeting-package/questions.valid.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', safeRunDir,
    '--output', '../escape.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
