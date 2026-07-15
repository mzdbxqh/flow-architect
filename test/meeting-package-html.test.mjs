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

test('CSP uses real script hash, not unsafe-inline or unsafe-eval', () => {
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
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
  const maliciousQuestions = JSON.parse(
    fs.readFileSync(fixture('meeting-package/malicious-questions.json'), 'utf8'));
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

test('extractor validates questions schema and content hash', () => {
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  const badQuestions = rewritePayload(html, payload => {
    payload.questions[0].status = 'INVALID_STATUS';
  });
  assert.throws(() => extractMeetingPackageHtml(badQuestions), /问题|schema/i);

  const badHash = rewritePayload(html, payload => {
    payload.metadata.content_hash = 'sha256:' + '0'.repeat(64);
  });
  assert.throws(() => extractMeetingPackageHtml(badHash), /content_hash|hash|不一致|mismatch/i);
});

test('extractor rejects payload with tampered content hash', () => {
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  const badRef = rewritePayload(html, payload => {
    payload.questions[0].element_ids = ['NonExistent_Element'];
  });
  assert.throws(() => extractMeetingPackageHtml(badRef), /content_hash|hash|不一致|element|reference/i);
});

test('extractor rejects duplicate and empty question IDs', () => {
  const html = buildMeetingPackageHtml({ bpmnXml, questions, metadata });
  const dupIds = rewritePayload(html, payload => {
    payload.questions[1].id = 'Q-001';
  });
  assert.throws(() => extractMeetingPackageHtml(dupIds), /重复|duplicate|unique/i);
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

test('path containment rejects same-prefix directory escape', () => {
  const runDir = makeRunDir('prefix-escape');
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--bpmn', fixture('meeting-package/single-process.bpmn'),
    '--questions', fixture('meeting-package/questions.valid.json'),
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
    '--bpmn', fixture('meeting-package/single-process.bpmn'),
    '--questions', fixture('meeting-package/questions.valid.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', runDir,
    '--output', '/tmp/escape-outside.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});

test('CLI rejects missing --process-id when BPMN has multiple processes', () => {
  const runDir = makeRunDir('multi-process');
  const tmpQuestions = path.join(runDir, 'q.json');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(tmpQuestions, JSON.stringify([{
    id: 'Q-001', text: '测试问题', element_ids: ['Task_A1'], status: 'OPEN', answer: '',
  }]));
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--bpmn', fixture('meeting-package/multi-process.bpmn'),
    '--questions', tmpQuestions,
    '--title', '多流程测试', '--revision', 'r01',
    '--package-id', 'multi-process-test', '--run-dir', runDir,
    '--output', 'multi.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  const err = JSON.parse(result.stderr);
  assert.match(err.error, /process/i);
});

test('CLI accepts explicit --process-id for multi-process BPMN', () => {
  const runDir = makeRunDir('multi-process-explicit');
  fs.mkdirSync(runDir, { recursive: true });
  const tmpQuestions = path.join(runDir, 'q.json');
  fs.writeFileSync(tmpQuestions, JSON.stringify([{
    id: 'Q-001', text: '测试问题', element_ids: ['Task_A1'], status: 'OPEN', answer: '',
  }]));
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-single-diagram-html.mjs', import.meta.url)),
    '--bpmn', fixture('meeting-package/multi-process.bpmn'),
    '--questions', tmpQuestions,
    '--title', '多流程测试', '--revision', 'r01',
    '--package-id', 'multi-process-test', '--process-id', 'Process_A',
    '--run-dir', runDir, '--output', 'multi-explicit.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'SUCCEEDED');
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
    '--bpmn', fixture('meeting-package/single-process.bpmn'),
    '--questions', fixture('meeting-package/questions.valid.json'),
    '--title', '采购审批流程', '--revision', 'r01',
    '--package-id', 'procurement-approval', '--run-dir', runDir,
    '--output', 'nested/deep/output.html',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, 'SUCCEEDED');
  assert.ok(fs.existsSync(path.join(runDir, 'nested', 'deep', 'output.html')));
});
