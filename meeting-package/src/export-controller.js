import { contentHash, encodePayload } from './payload-codec.js';

export function nextRevision(revision) {
  const match = /^r(\d+)$/.exec(revision);
  if (!match) throw new Error(`非法修订号：${revision}`);
  return `r${String(Number(match[1]) + 1).padStart(match[1].length, '0')}`;
}

const VALID_STATUSES = new Set(['OPEN', 'CONFIRMED', 'NOT_APPLICABLE']);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateQuestionsBeforeExport(questions, modeler, processId) {
  const ids = new Set();
  const registry = modeler?.get('elementRegistry');
  for (const q of questions) {
    if (!q.id || typeof q.id !== 'string') throw new Error('问题 ID 不能为空');
    if (!ID_PATTERN.test(q.id)) throw new Error(`问题 ID 格式非法：${q.id}`);
    if (ids.has(q.id)) throw new Error(`问题 ID 重复：${q.id}`);
    ids.add(q.id);
    if (!q.text || !q.text.trim()) throw new Error(`问题 ${q.id} 的描述不能为空`);
    if (!VALID_STATUSES.has(q.status)) throw new Error(`问题 ${q.id} 的状态非法：${q.status}`);
    if (!Array.isArray(q.element_ids) || q.element_ids.length === 0) {
      throw new Error(`问题 ${q.id} 必须关联至少一个图元素`);
    }
    if (registry) {
      for (const eid of q.element_ids) {
        if (eid === processId) continue;
        if (!registry.get(eid)) throw new Error(`问题 ${q.id} 引用了不存在的图元素：${eid}`);
      }
    }
  }
}

export class ExportController {
  constructor({ modeler, payload }) {
    this.modeler = modeler;
    this.payload = payload;
  }

  async currentPayload() {
    validateQuestionsBeforeExport(this.payload.questions, this.modeler, this.payload.metadata.process_id);
    const { xml } = await this.modeler.saveXML({ format: true });
    const next = {
      metadata: {
        ...this.payload.metadata,
        based_on_revision: this.payload.metadata.revision,
        revision: nextRevision(this.payload.metadata.revision),
      },
      bpmn_xml: xml,
      questions: this.payload.questions,
    };
    next.metadata.content_hash = await contentHash(next.bpmn_xml, next.questions);
    return next;
  }

  download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  fileName(revision, suffix) {
    const base = this.payload.metadata.title.replace(/[\\/:*?"<>|]/g, '-');
    return `${base}-${revision}${suffix}`;
  }

  async downloadNewHtml() {
    const payload = await this.currentPayload();
    const emptyShell = document.querySelector('[data-fa-shell]')?.dataset.faShell;
    if (!emptyShell) throw new Error('导出失败：缺少壳模板');
    const clone = document.documentElement.cloneNode(true);
    const app = clone.querySelector('#fa-app');
    if (app) {
      app.querySelectorAll('.djs-parent, .djs-overlay-container, .bjs-container, [class*="bpmn-js"]').forEach(el => el.remove());
      const canvas = clone.querySelector('#fa-canvas');
      if (canvas) canvas.replaceChildren();
      const questions = clone.querySelector('#fa-questions');
      if (questions) questions.replaceChildren();
      app.querySelectorAll('.fa-question-highlight').forEach(el => el.classList.remove('fa-question-highlight'));
      app.querySelectorAll('[aria-current]').forEach(el => el.removeAttribute('aria-current'));
    }
    clone.querySelector('#fa-package-data').textContent = encodePayload(payload);
    const scriptEl = clone.querySelector('#fa-app ~ script:not([type])');
    if (scriptEl) {
      const currentScript = document.querySelector('#fa-app ~ script:not([type])');
      if (currentScript) scriptEl.textContent = currentScript.textContent;
    }
    const html = `<!doctype html>\n${clone.outerHTML}`;
    this.download(this.fileName(payload.metadata.revision, '.html'), html, 'text/html;charset=utf-8');
  }

  async downloadBpmn() {
    const payload = await this.currentPayload();
    this.download(this.fileName(payload.metadata.revision, '.bpmn'), payload.bpmn_xml, 'application/xml');
  }

  async downloadSvg() {
    const { svg } = await this.modeler.saveSVG();
    const revision = nextRevision(this.payload.metadata.revision);
    this.download(this.fileName(revision, '.svg'), svg, 'image/svg+xml');
  }

  async downloadQuestions() {
    const payload = await this.currentPayload();
    const json = `${JSON.stringify(payload.questions, null, 2)}\n`;
    this.download(this.fileName(payload.metadata.revision, '-questions.json'), json, 'application/json');
  }
}
