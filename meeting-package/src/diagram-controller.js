/**
 * DiagramController - BPMN 图表操作控制器
 *
 * V2: 所有结构操作（后插、分支、删除）通过结构命令门面和 AutoLayoutController 完成，
 * 不再直接调用 bpmn-js modeling/autoPlace 作为最终结构写入。
 */

import * as structuralCommands from './structural-commands.js';

export class DiagramController {
  constructor(modeler, questions, { store, autoLayout } = {}) {
    this.modeler = modeler;
    this.questions = questions;
    this.store = store;
    this.autoLayout = autoLayout;
    this.selected = null;
    modeler.on('selection.changed', event => {
      this.selected = event.newSelection[0] ?? null;
    });
  }

  renameSelected(name) {
    if (!this.selected || !name.trim()) throw new Error('请选择元素并填写名称');
    // 只修改 label，不重排
    this.modeler.get('modeling').updateLabel(this.selected, name.trim());
    // 同步活动名称
    if (this.store && this.selected.type === 'bpmn:Task') {
      const binding = this.store.snapshot().diagram.task_bindings.find(
        b => b.main_task_id === this.selected.id,
      );
      if (binding) {
        const act = this.store.snapshot().activities.find(
          a => a.activity_id === binding.activity_id,
        );
        if (act) {
          this.store.upsertActivity({ ...act, name: name.trim() });
        }
      }
    }
  }

  async insertL5TaskAfterSelected(name) {
    if (!this.selected) throw new Error('请选择前置活动');
    if (!this.store) throw new Error('缺少 DraftStore');

    const selectedNodeId = this.selected.id;

    const doInsert = (store) => {
      return structuralCommands.insertL5After(store, selectedNodeId, {
        name: name.trim(),
      });
    };

    let result;
    if (this.autoLayout) {
      await this.autoLayout.applyStructureChange(doInsert, '新增 L5 活动');
      // applyStructureChange 中 mutation 返回值不可直接获取
      // 从 store 中查找最后创建的活动
      const snap = this.store.snapshot();
      const lastActivity = snap.activities[snap.activities.length - 1];
      result = {
        activityId: lastActivity?.activity_id,
        taskId: lastActivity?.main_task_id,
      };
    } else {
      result = doInsert(this.store);
      result = { activityId: result.activity_id, taskId: result.task_id };
    }

    return result;
  }

  async appendExclusiveBranch(question, yesLabel, noLabel) {
    return this.appendGatewayBranch('XOR', question, yesLabel, noLabel);
  }

  async appendGatewayBranch(gatewayType, question, yesLabel, noLabel) {
    if (!this.selected) throw new Error('请选择分支前置活动');
    if (!this.store) throw new Error('缺少 DraftStore');

    const selectedNodeId = this.selected.id;
    const gatewayNodeType = {
      XOR: 'GATEWAY_XOR',
      AND: 'GATEWAY_AND',
      OR: 'GATEWAY_OR',
    }[gatewayType] || 'GATEWAY_XOR';

    const doAppend = (store) => {
      return structuralCommands.appendGatewayBranch(store, selectedNodeId, gatewayType, [
        { label: yesLabel.trim(), condition: { source_output: question.trim(), operator: 'IS_TRUE' } },
        { label: noLabel.trim(), condition: { source_output: question.trim(), operator: 'IS_FALSE' } },
      ]);
    };

    let result;
    if (this.autoLayout) {
      await this.autoLayout.applyStructureChange(doAppend, `增加 ${gatewayType} 分支`);
      const snap = this.store.snapshot();
      const lastNodes = snap.diagram.nodes.filter(n => n.node_type === 'MAIN_TASK').slice(-2);
      result = {
        gateway: snap.diagram.nodes.find(n => n.node_type === gatewayNodeType),
        yes: lastNodes[0],
        no: lastNodes[1],
      };
    } else {
      result = doAppend(this.store);
    }

    return result;
  }

  async deleteSelected() {
    if (!this.selected) throw new Error('请选择要删除的元素');
    const linked = this.questions.filter(q => {
      const paths = q.target_paths || q.element_ids || [];
      return paths.includes(this.selected.id);
    });
    if (linked.length) throw new Error(`请先处理关联问题：${linked.map(q => q.question_id || q.id).join(', ')}`);

    const nodeId = this.selected.id;

    const doDelete = (store) => {
      structuralCommands.deleteNode(store, nodeId);
    };

    if (this.autoLayout) {
      await this.autoLayout.applyStructureChange(doDelete, '删除节点');
    } else {
      doDelete(this.store);
    }
  }

  /**
   * 验证确认从 Task 门禁 (AD-001 v2.0 三条件)
   */
  validateConfirmationTask(activity, confirmRoleId) {
    const errors = [];
    if (!activity.confirmation) {
      if (!confirmRoleId) {
        errors.push('确认角色不能为空');
      }
      const mainRole = this.#accountableRole(activity);
      if (mainRole && confirmRoleId === mainRole.role_id) {
        errors.push('确认角色不能与主责角色相同');
      }
    }
    return errors;
  }

  #accountableRole(activity) {
    if (!activity.role_assignments || activity.role_assignments.length === 0) return null;
    if (activity.responsibility_model === 'OARP') {
      return activity.role_assignments.find(r => r.responsibility === 'O') || null;
    }
    return activity.role_assignments.find(r => r.responsibility === 'R') || null;
  }

  undo() { this.modeler.get('commandStack').undo(); }
  redo() { this.modeler.get('commandStack').redo(); }
}
