/**
 * AutoLayoutController - 结构变更快照、重排、回滚
 *
 * 每次结构操作完成后执行：
 * 1. 保存操作前快照
 * 2. 从当前业务合同重建规范化图
 * 3. 运行方法论和结构校验
 * 4. 重新计算 DI (通过 compileBpmn)
 * 5. 重新导入 bpmn-js
 * 6. 恢复选择状态
 * 7. 若失败，回滚快照并展示明确错误
 */

export class AutoLayoutController {
  constructor({ store, modeler, compileBpmn, normalizeBpmnXml }) {
    if (typeof compileBpmn !== 'function') {
      throw new Error('compileBpmn 必须是函数');
    }
    this.store = store;
    this.modeler = modeler;
    this.compileBpmn = compileBpmn;
    this.normalizeBpmnXml = normalizeBpmnXml;
    this._applying = false;
  }

  /**
   * 执行结构变更并自动重排。
   * @param {Function} mutation - 执行变更的回调，接收 (store, modeler) 参数
   * @param {string} description - 变更描述（用于错误信息）
   */
  async applyStructureChange(mutation, description) {
    if (this._applying) {
      throw new Error('正在处理结构变更，请稍候');
    }
    this._applying = true;
    let snapshot = null;
    let xmlBefore = null;
    let selectionId = null;
    const dirtyBefore = this.store.dirty;

    try {
      // 1. 保存操作前快照
      snapshot = this.store.snapshot();
      ({ xml: xmlBefore } = await this.modeler.saveXML({ format: true }));
      const selection = this.modeler.get('selection').get();
      selectionId = selection.length > 0 ? selection[0].id : null;

      // 2. 执行变更
      const result = await mutation(this.store, this.modeler);

      // 3. 从当前业务合同重建规范化图
      const currentSnapshot = this.store.snapshot();
      const { xml: newXml } = this.compileBpmn(currentSnapshot);

      // 4. 重新导入 bpmn-js
      await this.modeler.importXML(newXml);
      try { this.modeler.get('canvas').zoom('fit-viewport'); } catch (_) { /* SVG 尚未就绪 */ }

      // 5. 恢复选择状态
      if (selectionId) {
        const registry = this.modeler.get('elementRegistry');
        const element = registry.get(selectionId);
        if (element) {
          this.modeler.get('selection').select(element);
        }
      }

      // 6. 直接保存 compileBpmn 返回的规范 XML，不信任 modeler.saveXML
      this.store.updateBpmnXml(newXml);
      return result;

    } catch (error) {
      let rollbackError = null;
      if (snapshot && xmlBefore !== null) {
        try {
          await this._rollback(snapshot, xmlBefore, selectionId, dirtyBefore);
        } catch (caught) {
          rollbackError = caught;
        }
      }
      const rollbackMessage = rollbackError
        ? `；回滚失败：${rollbackError.message}`
        : '';
      throw new Error(
        `FA-DRAFT-LAYOUT-001: 结构变更失败（${description}）：${error.message}${rollbackMessage}`,
      );
    } finally {
      this._applying = false;
    }
  }

  async _rollback(snapshot, xmlBefore, selectionId, dirtyBefore) {
    // 恢复 store，包含操作前 dirty 状态
    this.store.restore(snapshot, { dirty: dirtyBefore });

    // 恢复 bpmn-js
    await this.modeler.importXML(xmlBefore);
    try { this.modeler.get('canvas').zoom('fit-viewport'); } catch (_) { /* SVG 尚未就绪 */ }

    // 恢复选择
    if (selectionId) {
      const registry = this.modeler.get('elementRegistry');
      const element = registry.get(selectionId);
      if (element) {
        this.modeler.get('selection').select(element);
      }
    }
  }

  get applying() {
    return this._applying;
  }
}
