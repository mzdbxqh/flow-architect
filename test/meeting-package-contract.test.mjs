import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fixture } from './helpers/fixture.mjs';
import {
  computeContentHash,
  createMeetingPayload,
  decodeMeetingPayload,
  encodeMeetingPayload,
  validateMetadata,
  validateQuestions,
} from '../scripts/lib/meeting-package-contract.mjs';

const questions = JSON.parse(fs.readFileSync(
  fixture('meeting-package/questions.valid.json'), 'utf8'));
const bpmnXml = fs.readFileSync(
  fixture('meeting-package/single-process.bpmn'), 'utf8');

test('valid questions and metadata pass', () => {
  assert.equal(validateQuestions(questions).valid, true);
  assert.equal(validateMetadata({
    schema_version: '1.0.0',
    package_id: 'procurement-approval',
    process_id: 'Process_1',
    title: '采购审批流程',
    revision: 'r01',
    based_on_revision: null,
    runtime_version: '1.0.0',
    content_hash: computeContentHash(bpmnXml, questions),
  }).valid, true);
});

test('question status and dangling-free element list are constrained', () => {
  assert.equal(validateQuestions([{ ...questions[0], status: 'DONE' }]).valid, false);
  assert.equal(validateQuestions([{ ...questions[0], element_ids: [] }]).valid, false);
});

test('payload encoding is deterministic and reversible', () => {
  const payload = createMeetingPayload({
    bpmnXml,
    questions,
    metadata: {
      schema_version: '1.0.0', package_id: 'procurement-approval',
      process_id: 'Process_1', title: '采购审批流程', revision: 'r01',
      based_on_revision: null, runtime_version: '1.0.0',
    },
  });
  assert.equal(encodeMeetingPayload(payload), encodeMeetingPayload(payload));
  assert.deepEqual(decodeMeetingPayload(encodeMeetingPayload(payload)), payload);
});
