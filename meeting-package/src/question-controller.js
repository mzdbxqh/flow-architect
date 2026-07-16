const STATUS_LABELS = {
  OPEN: '待确认',
  CONFIRMED: '已确认',
  NOT_APPLICABLE: '不适用',
};

export class QuestionController {
  constructor({ modeler, questions, root, onChange }) {
    this.modeler = modeler;
    this.questions = questions;
    this.root = root;
    this.onChange = onChange;
    this.overlayIds = [];
    this.highlightedElements = [];
    document.addEventListener('click', event => {
      const id = event.target.closest('[data-overlay-question-id]')?.dataset.overlayQuestionId;
      if (id) this.selectQuestion(id);
    });
  }

  render() {
    const overlays = this.modeler.get('overlays');
    const registry = this.modeler.get('elementRegistry');
    for (const id of this.overlayIds) overlays.remove(id);
    this.overlayIds = [];
    this.root.replaceChildren(...this.questions.map(q => this.#questionNode(q)));
    for (const q of this.questions.filter(q => q.status === 'OPEN')) {
      for (const elementId of (q.target_paths || q.element_ids || [])) {
        if (!registry.get(elementId)) continue;
        this.overlayIds.push(overlays.add(elementId, 'fa-question', {
          position: { top: -10, right: -10 },
          html: `<button type="button" class="fa-question-badge" data-overlay-question-id="${q.question_id || q.id}" aria-label="打开问题 ${q.question_id || q.id}">?</button>`,
        }));
      }
    }
  }

  clearHighlights() {
    const canvas = this.modeler.get('canvas');
    for (const elementId of this.highlightedElements) {
      canvas.removeMarker(elementId, 'fa-question-highlight');
    }
    this.highlightedElements = [];
  }

  selectQuestion(id) {
    const q = this.questions.find(item => (item.question_id || item.id) === id);
    if (!q) return;
    const canvas = this.modeler.get('canvas');
    const registry = this.modeler.get('elementRegistry');
    this.clearHighlights();
    document.querySelectorAll('[aria-current]').forEach(n => n.removeAttribute('aria-current'));
    document.querySelector(`[data-question-id="${CSS.escape(id)}"]`)?.setAttribute('aria-current', 'true');
    const paths = q.target_paths || q.element_ids || [];
    const newHighlighted = paths.filter(elementId => registry.get(elementId));
    for (const elementId of newHighlighted) {
      canvas.addMarker(elementId, 'fa-question-highlight');
    }
    this.highlightedElements = newHighlighted;
  }

  setStatus(id, status) {
    const q = this.questions.find(item => (item.question_id || item.id) === id);
    q.status = status;
    this.onChange(this.questions);
    this.render();
  }

  setAnswer(id, answer) {
    const q = this.questions.find(item => (item.question_id || item.id) === id);
    q.answer = answer;
    this.onChange(this.questions);
  }

  addQuestion({ id, text, elementIds }) {
    if (this.questions.some(q => (q.question_id || q.id) === id)) throw new Error(`问题 ID 已存在：${id}`);
    this.questions.push({ question_id: id, text, target_paths: elementIds, status: 'OPEN', answer: '' });
    this.onChange(this.questions);
    this.render();
  }

  #questionNode(q) {
    const qid = q.question_id || q.id;
    const item = document.createElement('article');
    item.dataset.questionId = qid;
    const title = document.createElement('button');
    title.type = 'button';
    title.textContent = `${qid} ${q.text}`;
    title.addEventListener('click', () => this.selectQuestion(qid));
    const answer = document.createElement('textarea');
    answer.value = q.answer;
    answer.setAttribute('aria-label', `${qid} 回答`);
    answer.addEventListener('change', () => {
      q.answer = answer.value;
      this.onChange(this.questions);
    });
    const status = document.createElement('select');
    status.setAttribute('aria-label', `${qid} 状态`);
    for (const value of ['OPEN', 'CONFIRMED', 'NOT_APPLICABLE']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = STATUS_LABELS[value] || value;
      option.selected = value === q.status;
      status.append(option);
    }
    status.addEventListener('change', () => this.setStatus(qid, status.value));
    item.append(title, answer, status);
    return item;
  }
}
