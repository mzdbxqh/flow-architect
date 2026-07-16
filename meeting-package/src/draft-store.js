/**
 * DraftStore - 统一状态仓库
 *
 * HTML 中流程卡片、活动一览表、图模型和问题的唯一权威内存状态。
 * 所有控制器通过 DraftStore 读写，不直接修改 payload。
 */
export class DraftStore {
  #payload;
  #subscribers;
  #dirty;

  constructor({ payload }) {
    this.#validatePayload(payload);
    this.#payload = structuredClone(payload);
    this.#subscribers = [];
    this.#dirty = false;
  }

  /** 返回当前业务状态的深拷贝 */
  snapshot() {
    return structuredClone(this.#payload);
  }

  /** 用完整 payload 替换当前状态 */
  restore(payload) {
    this.#validatePayload(payload);
    this.#payload = structuredClone(payload);
    this.#dirty = true;
    this.#notify('restore', {});
  }

  /** 部分更新流程卡片 */
  updateProcessCard(partial) {
    const card = this.#payload.process_card;
    for (const [key, value] of Object.entries(partial)) {
      if (Object.prototype.hasOwnProperty.call(card, key) || key in card) {
        card[key] = structuredClone(value);
      }
    }
    this.#dirty = true;
    this.#notify('process_card', { field: Object.keys(partial) });
  }

  /** 新增或更新活动（按 activity_id 匹配） */
  upsertActivity(activity) {
    const idx = this.#payload.activities.findIndex(
      a => a.activity_id === activity.activity_id,
    );
    const cloned = structuredClone(activity);
    if (idx >= 0) {
      this.#payload.activities[idx] = cloned;
    } else {
      this.#payload.activities.push(cloned);
    }
    this.#dirty = true;
    this.#notify('activity_update', {
      activity_id: activity.activity_id,
      is_new: idx < 0,
    });
  }

  /** 删除活动及关联绑定 */
  deleteActivity(activityId) {
    const idx = this.#payload.activities.findIndex(
      a => a.activity_id === activityId,
    );
    if (idx < 0) {
      throw new Error(`活动不存在：${activityId}`);
    }
    this.#payload.activities.splice(idx, 1);
    // Remove related task bindings
    this.#payload.diagram.task_bindings = this.#payload.diagram.task_bindings.filter(
      b => b.activity_id !== activityId,
    );
    this.#dirty = true;
    this.#notify('activity_delete', { activity_id: activityId });
  }

  /** 更新 BPMN XML */
  updateBpmnXml(xml) {
    this.#payload.bpmn_xml = xml;
    this.#dirty = true;
    this.#notify('bpmn_update', {});
  }

  /** 更新图模型 */
  updateDiagram(diagram) {
    this.#payload.diagram = structuredClone(diagram);
    this.#dirty = true;
    this.#notify('diagram_update', {});
  }

  /** 标记手动脏 */
  markDirty() {
    this.#dirty = true;
  }

  get dirty() {
    return this.#dirty;
  }

  /** 注册状态变更回调 */
  subscribe(fn) {
    this.#subscribers.push(fn);
    return () => {
      const idx = this.#subscribers.indexOf(fn);
      if (idx >= 0) this.#subscribers.splice(idx, 1);
    };
  }

  /** 更新问题 */
  updateQuestion(questionId, updates) {
    const q = this.#payload.questions.find(q => q.question_id === questionId);
    if (!q) throw new Error(`问题不存在：${questionId}`);
    for (const [key, value] of Object.entries(updates)) {
      q[key] = structuredClone(value);
    }
    this.#dirty = true;
    this.#notify('question_update', { question_id: questionId });
  }

  #notify(kind, detail) {
    for (const fn of this.#subscribers) {
      try { fn(kind, detail); } catch (_) { /* best-effort */ }
    }
  }

  #validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload 必须是对象');
    }
    if (payload.schema_version !== '2.0.0') {
      throw new Error('schema_version 必须是 2.0.0');
    }
    if (!payload.process_card) {
      throw new Error('payload 缺少 process_card');
    }
    if (!Array.isArray(payload.activities)) {
      throw new Error('payload 缺少 activities 数组');
    }
    if (!payload.diagram) {
      throw new Error('payload 缺少 diagram');
    }
  }
}
