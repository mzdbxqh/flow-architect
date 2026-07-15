import { contentHash, encodePayload } from './payload-codec.js';

export function nextRevision(revision) {
  const match = /^r(\d+)$/.exec(revision);
  if (!match) throw new Error(`非法修订号：${revision}`);
  return `r${String(Number(match[1]) + 1).padStart(match[1].length, '0')}`;
}

export class ExportController {
  constructor({ modeler, payload }) {
    this.modeler = modeler;
    this.payload = payload;
  }

  async currentPayload() {
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
    const clone = document.documentElement.cloneNode(true);
    const app = clone.querySelector('#fa-app');
    if (app) {
      const canvas = document.createElement('div');
      canvas.id = 'fa-canvas';
      const questions = document.createElement('aside');
      questions.id = 'fa-questions';
      app.replaceChildren(
        clone.querySelector('#fa-toolbar'),
        document.createElement('main').appendChild(canvas).appendChild(questions).parentNode,
      );
    }
    clone.querySelector('#fa-package-data').textContent = encodePayload(payload);
    const scriptEl = clone.querySelector('script:not([type])');
    if (scriptEl) scriptEl.textContent = document.querySelector('script:not([type])').textContent;
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
