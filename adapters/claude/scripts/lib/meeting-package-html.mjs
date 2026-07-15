import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractBpmn } from '../extract-bpmn.mjs';
import { createMeetingPayload, decodeMeetingPayload, encodeMeetingPayload } from './meeting-package-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNTIME = path.join(ROOT, 'runtime', 'meeting-package');
const DATA_RE = /<script id="fa-package-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/;

export function buildMeetingPackageHtml({ bpmnXml, questions, metadata }) {
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
  const inlineHash = createHash('sha256').update(js).digest('base64');
  return shell
    .replace('__FA_SCRIPT_HASH__', `sha256-${scriptHash}`)
    .replace('__FA_INLINE_HASH__', `sha256-${inlineHash}`)
    .replace('__FA_STYLE__', css)
    .replace('__FA_PAYLOAD__', encodeMeetingPayload(payload))
    .replace('__FA_SCRIPT__', js);
}

export function extractMeetingPackageHtml(html) {
  if (Buffer.byteLength(html) > 20 * 1024 * 1024) throw new Error('Meeting package exceeds 20 MiB extraction limit');
  const match = html.match(DATA_RE);
  if (!match) throw new Error('Meeting package data container not found');
  const payload = decodeMeetingPayload(match[1]);
  if (!payload.metadata?.schema_version || payload.metadata.schema_version !== '1.0.0') {
    throw new Error('Invalid payload schema_version');
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
