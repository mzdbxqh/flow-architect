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
    payload: ajv.compile(JSON.parse(fs.readFileSync(
      path.join(SCHEMA_DIR, 'meeting-package-payload.schema.json'), 'utf8'))),
  };
  return validators;
}

function result(validate, value) {
  const valid = validate(value);
  return { valid, errors: valid ? null : [...(validate.errors ?? [])] };
}

export const validateQuestions = value => result(getValidators().questions, value);
export const validateMetadata = value => result(getValidators().metadata, value);
export const validatePayload = value => result(getValidators().payload, value);

export function canonicalQuestions(questions) {
  return questions.map(q => ({
    question_id: q.question_id,
    text: q.text,
    target_paths: [...q.target_paths],
    status: q.status,
    answer: q.answer,
  }));
}

/**
 * Recursively sort object keys for deterministic hash.
 * Arrays preserve element order.
 */
export function normalizeKeys(obj) {
  if (Array.isArray(obj)) return obj.map(normalizeKeys);
  if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalizeKeys(obj[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Compute content hash over 7 business fields.
 * Objects normalized by key sort, arrays preserve order.
 * The hash field itself is excluded.
 */
export function computeContentHash(processCard, activities, diagram, bpmnXml, questions, provenance, sourceSummary) {
  const normalized = {
    process_card: normalizeKeys(processCard),
    activities: normalizeKeys(activities),
    diagram: normalizeKeys(diagram),
    bpmn_xml: bpmnXml,
    questions: normalizeKeys(canonicalQuestions(questions)),
    provenance: normalizeKeys(provenance),
    source_summary: normalizeKeys(sourceSummary),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

/**
 * Create a complete V2 meeting package payload.
 *
 * @param {object} params
 * @param {object} params.draft - V2 process draft containing process_card, activities, diagram, provenance, source_summary
 * @param {string} params.bpmnXml - BPMN XML string
 * @param {object} params.metadata - Partial metadata (schema_version, runtime_version are forced to 2.0.0)
 * @returns {object} Complete V2 payload
 */
export function createMeetingPayload({ draft, bpmnXml, metadata }) {
  const normalizedQuestions = canonicalQuestions(draft.questions || []);

  const contentHash = computeContentHash(
    draft.process_card,
    draft.activities || [],
    draft.diagram || { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
    bpmnXml,
    normalizedQuestions,
    draft.provenance || {},
    draft.source_summary || { total_blocks: 0, formats: [], evidence_refs: [] },
  );

  const completeMetadata = {
    ...metadata,
    schema_version: '2.0.0',
    runtime_version: '2.0.0',
    content_hash: contentHash,
  };

  const m = validateMetadata(completeMetadata);
  if (!m.valid) throw new Error(`元数据不符合 schema: ${JSON.stringify(m.errors)}`);

  const q = validateQuestions(normalizedQuestions);
  if (!q.valid) throw new Error(`问题数组不符合 schema: ${JSON.stringify(q.errors)}`);

  const payload = {
    metadata: completeMetadata,
    process_card: draft.process_card,
    activities: draft.activities || [],
    diagram: draft.diagram || { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
    bpmn_xml: bpmnXml,
    questions: normalizedQuestions,
    provenance: draft.provenance || {},
    source_summary: draft.source_summary || { total_blocks: 0, formats: [], evidence_refs: [] },
  };

  const p = validatePayload(payload);
  if (!p.valid) throw new Error(`payload 不符合 schema: ${JSON.stringify(p.errors)}`);

  return payload;
}

export const encodeMeetingPayload = payload =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
export const decodeMeetingPayload = encoded =>
  JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
