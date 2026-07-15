export class QuestionController {
  constructor({ modeler, questions, root, onChange }) {
    this.modeler = modeler;
    this.questions = questions;
    this.root = root;
    this.onChange = onChange;
    this.overlayIds = [];
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
      for (const elementId of q.element_ids) {
        if (!registry.get(elementId)) continue;
        this.overlayIds.push(overlays.add(elementId, 'fa-question', {
          position: { top: -10, right: -10 },
          html: `<button type="button" class="fa-question-badge" data-overlay-question-id="${q.id}" aria-label="打开问题 ${q.id}">?</button>`,
        }));
      }
    }
  }

  selectQuestion(id) {
    const q = this.questions.find(item => item.id === id);
    const canvas = this.modeler.get('canvas');
    const registry = this.modeler.get('elementRegistry');
    document.querySelectorAll('[aria-current]').forEach(n => n.removeAttribute('aria-current'));
    document.querySelector(`[data-question-id="${CSS.escape(id)}"]`)?.setAttribute('aria-current', 'true');
    q.element_ids.filter(elementId => registry.get(elementId))
      .forEach(elementId => canvas.addMarker(elementId, 'fa-question-highlight'));
  }

  setStatus(id, status) {
    const q = this.questions.find(item => item.id === id);
    q.status = status;
    this.onChange(this.questions);
    this.render();
  }

  setAnswer(id, answer) {
    const q = this.questions.find(item => item.id === id);
    q.answer = answer;
    this.onChange(this.questions);
  }

  addQuestion({ id, text, elementIds }) {
    if (this.questions.some(q => q.id === id)) throw new Error(`问题 ID 已存在：${id}`);
    this.questions.push({ id, text, element_ids: elementIds, status: 'OPEN', answer: '' });
    this.onChange(this.questions);
    this.render();
  }

  #questionNode(q) {
    const item = document.createElement('article');
    item.dataset.questionId = q.id;
    const title = document.createElement('button');
    title.type = 'button';
    title.textContent = `${q.id} ${q.text}`;
    title.addEventListener('click', () => this.selectQuestion(q.id));
    const answer = document.createElement('textarea');
    answer.value = q.answer;
    answer.setAttribute('aria-label', `${q.id} 回答`);
    answer.addEventListener('change', () => {
      q.answer = answer.value;
      this.onChange(this.questions);
    });
    const status = document.createElement('select');
    status.setAttribute('aria-label', `${q.id} 状态`);
    for (const value of ['OPEN', 'CONFIRMED', 'NOT_APPLICABLE']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === q.status;
      status.append(option);
    }
    status.addEventListener('change', () => this.setStatus(q.id, status.value));
    item.append(title, answer, status);
    return item;
  }
}
