import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { extractBpmn } from '../extract-bpmn.mjs';
import { createMeetingPayload, decodeMeetingPayload, encodeMeetingPayload, computeContentHash, validateQuestions, validateMetadata } from './meeting-package-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNTIME = path.join(ROOT, 'runtime', 'meeting-package');
const DATA_RE = /<script id="fa-package-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/;

export function validateProcessId(bpmnXml, processId) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const parsed = parser.parse(bpmnXml);
  const definitions = parsed?.definitions;
  if (!definitions) throw new Error('BPMN 文件无法解析：缺少 definitions');
  let processes = definitions.process;
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

export function buildMeetingPackageHtml({ bpmnXml, questions, metadata }) {
  if (bpmnXml.includes('<!DOCTYPE') || bpmnXml.includes('<!ENTITY')) {
    throw new Error('BPMN 包含 DOCTYPE 或 ENTITY 声明，已拒绝');
  }
  const model = extractBpmn(bpmnXml);
  if (model.elements.length === 0) throw new Error('BPMN contains no extractable elements');
  const ids = new Set(model.elements.map(e => e.element_id));
  ids.add(metadata.process_id);
  for (const q of questions) {
    for (const id of q.element_ids) if (!ids.has(id)) throw new Error(`Question references missing BPMN element: ${id}`);
  }
  const payload = createMeetingPayload({ bpmnXml, questions, metadata });
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

export function extractMeetingPackageHtml(html) {
  if (Buffer.byteLength(html) > 20 * 1024 * 1024) throw new Error('Meeting package exceeds 20 MiB extraction limit');
  const match = html.match(DATA_RE);
  if (!match) throw new Error('Meeting package data container not found');
  const payload = decodeMeetingPayload(match[1]);

  if (!payload.metadata?.schema_version || payload.metadata.schema_version !== '1.0.0') {
    throw new Error('Invalid payload schema_version');
  }

  const mq = validateMetadata(payload.metadata);
  if (!mq.valid) throw new Error(`元数据不符合 schema: ${JSON.stringify(mq.errors)}`);

  const qr = validateQuestions(payload.questions);
  if (!qr.valid) throw new Error(`问题数组不符合 schema: ${JSON.stringify(qr.errors)}`);

  const seenIds = new Set();
  for (const q of payload.questions) {
    if (seenIds.has(q.id)) throw new Error(`问题 ID 重复: ${q.id}`);
    seenIds.add(q.id);
  }

  if (payload.bpmn_xml && payload.metadata.content_hash) {
    const expectedHash = computeContentHash(payload.bpmn_xml, payload.questions);
    if (expectedHash !== payload.metadata.content_hash) {
      throw new Error(`content_hash 不一致: expected ${expectedHash}, got ${payload.metadata.content_hash}`);
    }
  }

  if (payload.bpmn_xml) {
    try {
      const model = extractBpmn(payload.bpmn_xml);
      const elementIds = new Set(model.elements.map(e => e.element_id));
      elementIds.add(payload.metadata.process_id);
      for (const q of payload.questions) {
        for (const refId of q.element_ids) {
          if (!elementIds.has(refId)) {
            throw new Error(`问题 ${q.id} 引用了不存在的图元素: ${refId}`);
          }
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
  const before = new Map(base.questions.map(q => [q.id, q]));
  const after = new Map(current.questions.map(q => [q.id, q]));
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
