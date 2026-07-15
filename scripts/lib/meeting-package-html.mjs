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
  return shell
    .replace('__FA_SCRIPT_HASH__', `sha256-${scriptHash}`)
    .replace('__FA_STYLE__', css)
    .replace('__FA_PAYLOAD__', encodeMeetingPayload(payload))
    .replace('__FA_SCRIPT__', js);
}

export function extractMeetingPackageHtml(html) {
  if (Buffer.byteLength(html) > 20 * 1024 * 1024) throw new Error('Meeting package exceeds 20 MiB extraction limit');
  const match = html.match(DATA_RE);
  if (!match) throw new Error('Meeting package data container not found');
  return decodeMeetingPayload(match[1]);
}
