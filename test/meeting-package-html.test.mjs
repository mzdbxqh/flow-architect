import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixture } from './helpers/fixture.mjs';
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
