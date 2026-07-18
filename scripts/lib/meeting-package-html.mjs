import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireRuntimePackage } from './runtime-loader.mjs';
import { extractBpmn } from '../extract-bpmn.mjs';
import { createMeetingPayload, decodeMeetingPayload, encodeMeetingPayload, computeContentHash, validateQuestions, validateMetadata, validatePayload } from './meeting-package-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNTIME = path.join(ROOT, 'runtime', 'meeting-package');
const DATA_RE = /<script id="fa-package-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/;

export function validateProcessId(bpmnXml, processId) {
  const { XMLParser } = requireRuntimePackage('core', 'fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const parsed = parser.parse(bpmnXml);
  const definitions = parsed?.definitions ?? parsed?.['bpmn:definitions'];
  if (!definitions) throw new Error('BPMN 文件无法解析：缺少 definitions');
  let processes = definitions.process ?? definitions['bpmn:process'];
  if (!processes) throw new Error('BPMN 文件中未找到 process');
  if (!Array.isArray(processes)) processes = [processes];
  if (processes.length === 1) {
    const id = processes[0].id;
    if (processId && processId !== id) {
      throw new Error(`指定的 process-id "${processId}" 在 BPMN 中不存在`);
    }
    return id;
  }
  if (!processId) {
    throw new Error(`BPMN 包含 ${processes.length} 个 process，请通过 --process-id 显式指定`);
  }
  const found = processes.find(p => p.id === processId);
  if (!found) {
    throw new Error(`指定的 process-id "${processId}" 在 BPMN 中不存在`);
  }
  return processId;
}

/**
 * Build a complete V2 meeting package HTML.
 *
 * @param {object} params
 * @param {object} params.draft - V2 process draft
 * @param {string} params.bpmnXml - BPMN XML
 * @param {object} params.metadata - Partial metadata
 */
export function buildMeetingPackageHtml({ draft, bpmnXml, metadata }) {
  if (bpmnXml.includes('<!DOCTYPE') || bpmnXml.includes('<!ENTITY')) {
    throw new Error('BPMN 包含 DOCTYPE 或 ENTITY 声明，已拒绝');
  }

  // Extract BPMN elements for validation (V2 only: use diagram.nodes)
  const model = extractBpmn(bpmnXml, { v2Mode: true });
  const elements = model.diagram?.nodes || [];

  // Build ID set from BPMN (V2: use node_id)
  const bpmnIds = new Set(elements.map(e => e.node_id));
  bpmnIds.add(metadata.process_id);

  const questions = draft.questions;

  // Validate question target_paths against BPMN elements (V2 only: direct node_id match)
  for (const q of questions) {
    for (const id of q.target_paths) {
      if (bpmnIds.has(id)) continue;
      throw new Error(`Question references missing BPMN element: ${id}`);
    }
  }

  // Validate task_bindings against BPMN elements
  const diagram = draft.diagram;
  for (const binding of diagram.task_bindings) {
    if (!bpmnIds.has(binding.main_task_id)) {
      throw new Error(`task_binding references missing BPMN element: ${binding.main_task_id}`);
    }
  }

  // Create payload (hash covers all 7 business fields)
  const payload = createMeetingPayload({
    draft,
    bpmnXml,
    metadata,
  });

  const shell = fs.readFileSync(path.join(RUNTIME, 'shell.html'), 'utf8');
  const js = fs.readFileSync(path.join(RUNTIME, 'editor.bundle.js'), 'utf8');
  const css = fs.readFileSync(path.join(RUNTIME, 'editor.bundle.css'), 'utf8');
  const scriptHash = createHash('sha256').update(js).digest('base64');

  const emptyShell = shell
    .replace(/__FA_SCRIPT_HASH__/g, `sha256-${scriptHash}`)
    .replace('__FA_STYLE__', css)
    .replace('__FA_PAYLOAD__', () => '')
    .replace('__FA_SCRIPT__', () => '')
    .replace('__FA_EMPTY_SHELL__', () => '');

  return shell
    .replace(/__FA_SCRIPT_HASH__/g, `sha256-${scriptHash}`)
    .replace('__FA_STYLE__', css)
    .replace('__FA_PAYLOAD__', () => encodeMeetingPayload(payload))
    .replace('__FA_SCRIPT__', () => js)
    .replace('__FA_EMPTY_SHELL__', () => Buffer.from(emptyShell, 'utf8').toString('base64'));
}

/**
 * Extract and validate a V2 meeting package from HTML.
 */
export function extractMeetingPackageHtml(html) {
  if (Buffer.byteLength(html) > 20 * 1024 * 1024) throw new Error('Meeting package exceeds 20 MiB extraction limit');
  const match = html.match(DATA_RE);
  if (!match) throw new Error('Meeting package data container not found');
  const payload = decodeMeetingPayload(match[1]);

  // V2 schema_version must be 2.0.0
  if (!payload.metadata?.schema_version || payload.metadata.schema_version !== '2.0.0') {
    throw new Error('Invalid payload schema_version');
  }

  // Validate payload structure (all 8 required fields)
  const pr = validatePayload(payload);
  if (!pr.valid) throw new Error(`payload 不符合 schema: ${JSON.stringify(pr.errors)}`);

  const mq = validateMetadata(payload.metadata);
  if (!mq.valid) throw new Error(`元数据不符合 schema: ${JSON.stringify(mq.errors)}`);

  const qr = validateQuestions(payload.questions);
  if (!qr.valid) throw new Error(`问题数组不符合 schema: ${JSON.stringify(qr.errors)}`);

  // Duplicate question ID check
  const seenIds = new Set();
  for (const q of payload.questions) {
    if (seenIds.has(q.question_id)) throw new Error(`问题 ID 重复: ${q.question_id}`);
    seenIds.add(q.question_id);
  }

  // Content hash verification (covers all 7 business fields)
  if (payload.metadata.content_hash) {
    const expectedHash = computeContentHash(
      payload.process_card,
      payload.activities,
      payload.diagram,
      payload.bpmn_xml,
      payload.questions,
      payload.provenance,
      payload.source_summary,
    );
    if (expectedHash !== payload.metadata.content_hash) {
      throw new Error(`content_hash 不一致: expected ${expectedHash}, got ${payload.metadata.content_hash}`);
    }
  }

  // BPMN element reference validation (V2 only: use diagram.nodes)
  if (payload.bpmn_xml) {
    try {
      const model = extractBpmn(payload.bpmn_xml, { v2Mode: true });
      const elements = model.diagram?.nodes || [];
      const elementIds = new Set(elements.map(e => e.node_id));
      elementIds.add(payload.metadata.process_id);
      for (const q of payload.questions) {
        for (const refId of q.target_paths) {
          if (elementIds.has(refId)) continue;
          throw new Error(`问题 ${q.question_id} 引用了不存在的图元素: ${refId}`);
        }
      }
    } catch (e) {
      if (e.message.includes('引用了不存在')) throw e;
      throw new Error('BPMN XML 无法解析: ' + e.message);
    }
  }

  return payload;
}

export function compareMeetingPackages(base, current) {
  if (current.metadata.based_on_revision !== base.metadata.revision) {
    throw new Error(`Revision lineage mismatch: ${current.metadata.based_on_revision}`);
  }
  const before = new Map(base.questions.map(q => [q.question_id, q]));
  const after = new Map(current.questions.map(q => [q.question_id, q]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  return {
    from_revision: base.metadata.revision,
    to_revision: current.metadata.revision,
    bpmn_changed: base.bpmn_xml !== current.bpmn_xml,
    question_changes: ids.flatMap(id => {
      const left = before.get(id);
      const right = after.get(id);
      if (JSON.stringify(left) === JSON.stringify(right)) return [];
      return [{ id, before: left ?? null, after: right ?? null }];
    }),
  };
}
