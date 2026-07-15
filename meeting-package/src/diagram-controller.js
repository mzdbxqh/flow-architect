export class DiagramController {
  constructor(modeler, questions) {
    this.modeler = modeler;
    this.questions = questions;
    this.selected = null;
    modeler.on('selection.changed', event => {
      this.selected = event.newSelection[0] ?? null;
    });
  }

  renameSelected(name) {
    if (!this.selected || !name.trim()) throw new Error('请选择元素并填写名称');
    this.modeler.get('modeling').updateLabel(this.selected, name.trim());
  }

  insertTaskAfterSelected(name) {
    if (!this.selected) throw new Error('请选择前置活动');
    const factory = this.modeler.get('elementFactory');
    const task = factory.createShape({ type: 'bpmn:Task' });
    task.businessObject.name = name.trim();
    return this.modeler.get('autoPlace').append(this.selected, task);
  }

  appendExclusiveBranch(question, yesLabel, noLabel) {
    if (!this.selected) throw new Error('请选择分支前置活动');
    const factory = this.modeler.get('elementFactory');
    const autoPlace = this.modeler.get('autoPlace');
    const modeling = this.modeler.get('modeling');
    const created = [];
    try {
      const gateway = autoPlace.append(this.selected,
        factory.createShape({ type: 'bpmn:ExclusiveGateway' }));
      modeling.updateLabel(gateway, question.trim());
      created.push(gateway);

      const yes = autoPlace.append(gateway, factory.createShape({ type: 'bpmn:Task' }));
      modeling.updateLabel(yes, yesLabel.trim());
      created.push(yes);

      const no = autoPlace.append(gateway, factory.createShape({ type: 'bpmn:Task' }));
      modeling.updateLabel(no, noLabel.trim());
      created.push(no);

      return { gateway, yes, no };
    } catch (error) {
      for (const el of created.reverse()) {
        try { modeling.removeElements([el]); } catch (_) { /* best-effort rollback */ }
      }
      throw error;
    }
  }

  deleteSelected() {
    if (!this.selected) throw new Error('请选择要删除的元素');
    const linked = this.questions.filter(q => q.element_ids.includes(this.selected.id));
    if (linked.length) throw new Error(`请先处理关联问题：${linked.map(q => q.id).join(', ')}`);
    this.modeler.get('modeling').removeElements([this.selected]);
  }

  undo() { this.modeler.get('commandStack').undo(); }
  redo() { this.modeler.get('commandStack').redo(); }
}
