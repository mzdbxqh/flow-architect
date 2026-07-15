import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRuntimePackage } from './runtime-loader.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(DIR, '..', '..', 'references', 'schemas');
let validators;

function getValidators() {
  if (validators) return validators;
  const Ajv = requireRuntimePackage('core', 'ajv/dist/2020.js');
  const ajv = new Ajv({ allErrors: true });
  validators = {
    questions: ajv.compile(JSON.parse(fs.readFileSync(
      path.join(SCHEMA_DIR, 'clarification-questions.schema.json'), 'utf8'))),
    metadata: ajv.compile(JSON.parse(fs.readFileSync(
      path.join(SCHEMA_DIR, 'meeting-package-metadata.schema.json'), 'utf8'))),
  };
  return validators;
}

function result(validate, value) {
  const valid = validate(value);
  return { valid, errors: valid ? null : [...(validate.errors ?? [])] };
}

export const validateQuestions = value => result(getValidators().questions, value);
export const validateMetadata = value => result(getValidators().metadata, value);

export function canonicalQuestions(questions) {
  return questions.map(q => ({
    id: q.id,
    text: q.text,
    element_ids: [...q.element_ids],
    status: q.status,
    answer: q.answer,
  }));
}

export function computeContentHash(bpmnXml, questions) {
  const body = JSON.stringify({ bpmn_xml: bpmnXml, questions: canonicalQuestions(questions) });
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

export function createMeetingPayload({ bpmnXml, questions, metadata }) {
  const normalizedQuestions = canonicalQuestions(questions);
  const completeMetadata = {
    ...metadata,
    content_hash: computeContentHash(bpmnXml, normalizedQuestions),
  };
  const q = validateQuestions(normalizedQuestions);
  const m = validateMetadata(completeMetadata);
  if (!q.valid || !m.valid) throw new Error(JSON.stringify({ questions: q.errors, metadata: m.errors }));
  return { metadata: completeMetadata, bpmn_xml: bpmnXml, questions: normalizedQuestions };
}

export const encodeMeetingPayload = payload =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
export const decodeMeetingPayload = encoded =>
  JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
