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
    const qid = q.question_id || q.id;
    const paths = q.target_paths || q.element_ids || [];
    if (!qid || typeof qid !== 'string') throw new Error('问题 ID 不能为空');
    if (!ID_PATTERN.test(qid)) throw new Error(`问题 ID 格式非法：${qid}`);
    if (ids.has(qid)) throw new Error(`问题 ID 重复：${qid}`);
    ids.add(qid);
    if (!q.text || !q.text.trim()) throw new Error(`问题 ${qid} 的描述不能为空`);
    if (!VALID_STATUSES.has(q.status)) throw new Error(`问题 ${qid} 的状态非法：${q.status}`);
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error(`问题 ${qid} 必须关联至少一个图元素`);
    }
    if (registry) {
      for (const eid of paths) {
        if (eid === processId) continue;
        if (!registry.get(eid)) throw new Error(`问题 ${qid} 引用了不存在的图元素：${eid}`);
      }
    }
  }
}

export class ExportController {
  constructor({ modeler, payload, store, compileBpmn }) {
    this.modeler = modeler;
    this.payload = payload;
    this.store = store;
    this.compileBpmn = compileBpmn;
  }

  async currentPayload() {
    const questions = this.store ? this.store.snapshot().questions : this.payload.questions;
    validateQuestionsBeforeExport(questions, this.modeler, this.payload.metadata.process_id);

    let bpmnXml;
    if (this.store && this.compileBpmn) {
      // 末端 L4：使用 compileBpmn 从业务合同生成规范 XML
      const snapshot = this.store.snapshot();
      const { xml } = this.compileBpmn(snapshot);
      bpmnXml = xml;
    } else {
      // 非末端流程：无 BPMN，不调用 compileBpmn 或 modeler.saveXML
      bpmnXml = null;
    }

    const next = {
      metadata: {
        ...this.payload.metadata,
        based_on_revision: this.payload.metadata.revision,
        revision: nextRevision(this.payload.metadata.revision),
      },
      questions,
    };
    if (bpmnXml !== null) {
      next.bpmn_xml = bpmnXml;
    }
    if (this.store) {
      const snap = this.store.snapshot();
      next.process_card = snap.process_card;
      next.activities = snap.activities;
      next.diagram = snap.diagram;
      next.provenance = snap.provenance;
      next.source_summary = snap.source_summary;
    }
    next.metadata.content_hash = await contentHash(next.bpmn_xml, next.questions, {
      processCard: next.process_card,
      activities: next.activities,
      diagram: next.diagram,
      provenance: next.provenance,
      sourceSummary: next.source_summary,
    });
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
      // 重置页签状态：确保导出的 HTML 默认显示流程图页签
      // 避免用户在其他页签导出时 bpmn-js 在隐藏容器中初始化导致画布不可交互
      for (const tab of app.querySelectorAll('[role="tab"]')) {
        const isDiagram = tab.id === 'fa-tab-diagram';
        tab.setAttribute('aria-selected', isDiagram ? 'true' : 'false');
        tab.tabIndex = isDiagram ? 0 : -1;
        tab.disabled = false;
      }
      for (const panel of app.querySelectorAll('[role="tabpanel"]')) {
        panel.hidden = panel.getAttribute('aria-labelledby') !== 'fa-tab-diagram';
      }
      const canvasEl = clone.querySelector('#fa-canvas');
      if (canvasEl) canvasEl.style.display = '';
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

  async downloadFullJson() {
    const payload = await this.currentPayload();
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    this.download(this.fileName(payload.metadata.revision, '-full.json'), json, 'application/json');
  }
}
