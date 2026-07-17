import { contentHash, encodePayload } from './payload-codec.js';
import { validateV2Draft } from './schema-validator.js';
import { validateDraftBusinessRules as validateDraftBusinessRulesFull } from '../../scripts/lib/process-draft-v2-rules.mjs';

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
    const qid = q.question_id;
    const paths = q.target_paths;
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

/**
 * F1: 执行完整 V2 Schema 门禁
 *
 * 使用 Ajv + 真实 process-draft.schema.json 及其引用 Schema，
 * 对当前完整草稿执行与服务端构建器相同语义的 V2 Schema 校验。
 * 浏览器端校验必须来自可打包的确定性合同，不得联网，也不得复制会漂移的字段列表。
 */
function validateV2SchemaBeforeExport(snapshot) {
  // 提取 process-draft schema 相关字段（排除 metadata/bpmn_xml 等非 schema 字段）
  const draftSubset = {
    schema_version: snapshot.schema_version,
    process_card: snapshot.process_card,
    activities: snapshot.activities,
    diagram: snapshot.diagram,
    questions: snapshot.questions,
    provenance: snapshot.provenance,
    source_summary: snapshot.source_summary,
  };

  // 1. Ajv 完整 Schema 校验（复用真实 JSON Schema）
  const schemaResult = validateV2Draft(draftSubset);
  if (!schemaResult.valid) {
    const firstError = schemaResult.errors[0];
    throw new Error(`${firstError.code}: ${firstError.message}`);
  }

  // 2. 服务端与浏览器共同使用的完整业务规则。
  const fullResult = validateDraftBusinessRulesFull(draftSubset);
  if (!fullResult.valid) {
    const firstError = fullResult.errors[0];
    throw new Error(`${firstError.code}: ${firstError.message}`);
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
    const snapshot = this.store.snapshot();
    const questions = snapshot.questions;
    validateQuestionsBeforeExport(questions, this.modeler, this.payload.metadata.process_id);

    // F1: 执行完整 V2 Schema 门禁
    validateV2SchemaBeforeExport(snapshot);

    let bpmnXml;
    if (snapshot.process_card.level === 'L4' && snapshot.process_card.is_leaf) {
      // 末端 L4：使用 compileBpmn 从业务合同生成规范 XML
      const { xml } = this.compileBpmn(snapshot);
      bpmnXml = xml;
    } else {
      // 非末端流程只允许流程卡片；保留构建时的空 BPMN 容器以满足会议包合同。
      if (snapshot.activities.length > 0
        || snapshot.diagram.nodes.length > 0
        || snapshot.diagram.flows.length > 0
        || snapshot.diagram.task_bindings.length > 0) {
        throw new Error('非末端流程只能包含流程卡片，不能包含活动或流程图');
      }
      bpmnXml = this.payload.bpmn_xml;
    }

    const next = {
      metadata: {
        ...this.payload.metadata,
        based_on_revision: this.payload.metadata.revision,
        revision: nextRevision(this.payload.metadata.revision),
      },
      questions,
    };
    next.bpmn_xml = bpmnXml;
    next.process_card = snapshot.process_card;
    next.activities = snapshot.activities;
    next.diagram = snapshot.diagram;
    next.provenance = snapshot.provenance;
    next.source_summary = snapshot.source_summary;
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
