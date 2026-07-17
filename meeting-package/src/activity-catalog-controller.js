/**
 * ActivityCatalogController - 活动主表与详情面板
 *
 * 主表显示短字段（名称、类型、主责角色、SLA、输入、输出、完整度）。
 * 点击行打开详情面板编辑长字段。
 *
 * 结构变更（新增/删除/移泳道）通过结构命令门面完成，
 * 不再直接调用 store.upsertActivity/deleteActivity 处理结构变化。
 */
import * as structuralCommands from './structural-commands.js';

const ACTIVITY_TYPE_LABELS = {
  STANDARD: '标准活动',
  REVIEW_MEETING: '评审会议',
  DECISION_ACTIVITY: '决策活动',
};

const COMPLETENESS_LABELS = {
  COMPLETE: '完整',
  NEEDS_CONFIRMATION: '待确认',
  CONFLICTED: '冲突',
};

const SLA_UNIT_LABELS = {
  MINUTE: '分钟',
  HOUR: '小时',
  WORKING_DAY: '工作日',
  CALENDAR_DAY: '日历日',
  WEEK: '周',
  MONTH: '月',
};

export class ActivityCatalogController {
  #store;
  #root;
  #selectedId;
  #autoLayout;

  constructor({ store, root, autoLayout }) {
    this.#store = store;
    this.#root = root;
    this.#selectedId = null;
    this.#autoLayout = autoLayout;
  }

  render() {
    const snap = this.#store.snapshot();
    const activities = snap.activities;
    this.#root.replaceChildren();
    this.#root.id = 'fa-activity-panel';
    this.#root.setAttribute('role', 'tabpanel');
    this.#root.setAttribute('aria-labelledby', 'fa-tab-activities');

    // Add activity button
    const toolbar = document.createElement('div');
    toolbar.className = 'fa-activity-toolbar';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '新增 L5 活动';
    addBtn.setAttribute('aria-label', '新增 L5 活动');
    addBtn.className = 'fa-activity-add';
    addBtn.addEventListener('click', () => this.#addActivity());
    toolbar.appendChild(addBtn);
    this.#root.appendChild(toolbar);

    // Main table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'fa-activity-table-wrap';
    const table = document.createElement('table');
    table.id = 'fa-activity-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const text of ['序号', '活动名称', '类型', '主责 R/O', 'SLA', '输入', '输出', '完整度']) {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    activities.forEach((act, idx) => {
      tbody.appendChild(this.#activityRow(act, idx));
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    this.#root.appendChild(tableWrap);

    // Detail panel (initially hidden)
    const detail = document.createElement('aside');
    detail.id = 'fa-activity-detail';
    detail.className = 'fa-activity-detail';
    detail.hidden = true;
    this.#root.appendChild(detail);

    // If previously selected, re-open; clear if deleted
    if (this.#selectedId) {
      const act = activities.find(a => a.activity_id === this.#selectedId);
      if (act) {
        this.#renderDetail(act, detail);
      } else {
        this.#selectedId = null;
      }
    }
  }

  #activityRow(act, idx) {
    const tr = document.createElement('tr');
    tr.dataset.activityRow = act.activity_id;
    tr.className = 'fa-activity-row';
    if (act.activity_id === this.#selectedId) tr.classList.add('fa-activity-selected');

    // 序号
    const tdIdx = document.createElement('td');
    tdIdx.textContent = String(idx + 1);
    tr.appendChild(tdIdx);

    // 活动名称
    const tdName = document.createElement('td');
    tdName.textContent = act.name;
    tr.appendChild(tdName);

    // 类型
    const tdType = document.createElement('td');
    tdType.textContent = ACTIVITY_TYPE_LABELS[act.activity_type] || act.activity_type;
    tr.appendChild(tdType);

    // 主责 R/O
    const tdRole = document.createElement('td');
    const accountable = this.#accountableRole(act);
    tdRole.textContent = accountable ? `${accountable.role_id} (${accountable.responsibility})` : '-';
    tr.appendChild(tdRole);

    // SLA
    const tdSla = document.createElement('td');
    if (act.sla) {
      tdSla.textContent = act.sla.raw_text ||
        (act.sla.value ? `${act.sla.value} ${SLA_UNIT_LABELS[act.sla.unit] || act.sla.unit}` : '-');
    } else {
      tdSla.textContent = '-';
    }
    tr.appendChild(tdSla);

    // 输入
    const tdInputs = document.createElement('td');
    tdInputs.textContent = act.inputs.join(', ') || '-';
    tr.appendChild(tdInputs);

    // 输出
    const tdOutputs = document.createElement('td');
    tdOutputs.textContent = act.outputs.join(', ') || '-';
    tr.appendChild(tdOutputs);

    // 完整度
    const tdComplete = document.createElement('td');
    tdComplete.textContent = COMPLETENESS_LABELS[act.completeness] || act.completeness;
    tr.appendChild(tdComplete);

    // Click to open detail
    tr.addEventListener('click', () => {
      this.#selectedId = act.activity_id;
      const detail = this.#root.querySelector('#fa-activity-detail');
      if (detail) {
        this.#renderDetail(act, detail);
        detail.hidden = false;
      }
      // Highlight selected row
      this.#root.querySelectorAll('.fa-activity-selected').forEach(el =>
        el.classList.remove('fa-activity-selected'));
      tr.classList.add('fa-activity-selected');
    });

    return tr;
  }

  #renderDetail(act, detail) {
    detail.replaceChildren();

    const title = document.createElement('h3');
    title.textContent = `活动详情：${act.name}`;
    detail.appendChild(title);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '关闭';
    closeBtn.className = 'fa-detail-close';
    closeBtn.addEventListener('click', () => {
      detail.hidden = true;
      this.#selectedId = null;
    });
    detail.appendChild(closeBtn);

    // Basic info
    detail.appendChild(this.#detailField('活动名称', 'name', act.name, 'text', (v) => {
      this.#saveActivity(act.activity_id, { name: v });
    }));
    detail.appendChild(this.#detailField('活动描述', 'description', act.description, 'textarea', (v) => {
      this.#saveActivity(act.activity_id, { description: v });
    }));

    // Activity type
    detail.appendChild(this.#detailSelect('活动类型', 'activity_type', act.activity_type,
      Object.entries(ACTIVITY_TYPE_LABELS), (v) => {
        const isOarp = v === 'REVIEW_MEETING' || v === 'DECISION_ACTIVITY';
        const updates = { activity_type: v };
        if (isOarp && act.responsibility_model !== 'OARP') {
          updates.responsibility_model = 'OARP';
        } else if (!isOarp && act.responsibility_model !== 'RASCI') {
          updates.responsibility_model = 'RASCI';
        }
        this.#saveActivity(act.activity_id, updates);
        this.render();
      }));

    // Responsibility model
    detail.appendChild(this.#detailSelect('责任模型', 'responsibility_model', act.responsibility_model,
      [['RASCI', 'RASCI'], ['OARP', 'OARP']], (v) => {
        this.#saveActivity(act.activity_id, { responsibility_model: v });
        this.render();
      }));

    // Role assignments
    detail.appendChild(this.#roleAssignmentsField(act));

    // SLA
    detail.appendChild(this.#slaField(act));

    // Tools
    detail.appendChild(this.#detailArrayField('当前承载工具', 'tools', act.tools, act.activity_id));

    // Inputs
    detail.appendChild(this.#detailArrayField('输入', 'inputs', act.inputs, act.activity_id));

    // Process summary
    detail.appendChild(this.#detailField('处理概要', 'process_summary', act.process_summary, 'textarea', (v) => {
      this.#saveActivity(act.activity_id, { process_summary: v });
    }));

    // Outputs
    detail.appendChild(this.#detailArrayField('输出', 'outputs', act.outputs, act.activity_id));

    // Completion criteria
    detail.appendChild(this.#detailArrayField('自工序完结标准', 'completion_criteria', act.completion_criteria, act.activity_id));

    // References
    detail.appendChild(this.#detailArrayField('参考制度/标准/规范', 'references', act.references, act.activity_id));

    // Main task ID
    const mainTask = document.createElement('div');
    mainTask.className = 'fa-field';
    mainTask.innerHTML = `<span class="fa-field-label">主 Task ID</span><code>${act.main_task_id}</code>`;
    detail.appendChild(mainTask);

    // Confirmation
    detail.appendChild(this.#confirmationField(act));

    // Delete button
    const deleteWrap = document.createElement('div');
    deleteWrap.className = 'fa-field';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '删除此活动';
    deleteBtn.className = 'fa-activity-delete';
    deleteBtn.addEventListener('click', () => {
      // 派发自定义事件，由 app.js 打开确认对话框
      this.#root.dispatchEvent(new CustomEvent('fa-delete-activity', {
        detail: { activityId: act.activity_id, mainTaskId: act.main_task_id, name: act.name },
        bubbles: true,
      }));
    });
    deleteWrap.appendChild(deleteBtn);
    detail.appendChild(deleteWrap);
  }

  #detailField(label, key, value, type, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
      input.value = value || '';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = value || '';
    }
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.value));
    lbl.appendChild(input);
    wrap.appendChild(lbl);
    return wrap;
  }

  #detailSelect(label, key, value, options, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    for (const [val, text] of options) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      opt.selected = val === value;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onChange(select.value));
    lbl.appendChild(select);
    wrap.appendChild(lbl);
    return wrap;
  }

  #detailArrayField(label, key, items, activityId) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field fa-array-field';
    const title = document.createElement('span');
    title.textContent = label;
    title.className = 'fa-array-title';
    wrap.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'fa-array-list';
    for (const item of items) {
      list.appendChild(this.#detailArrayItem(item, key, activityId, list));
    }
    wrap.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = `新增`;
    addBtn.className = 'fa-array-add';
    addBtn.addEventListener('click', () => {
      const act = this.#store.snapshot().activities.find(a => a.activity_id === activityId);
      if (!act) return;
      act[key].push('');
      this.#store.upsertActivity(act);
      this.#renderDetail(this.#store.snapshot().activities.find(a => a.activity_id === activityId),
        this.#root.querySelector('#fa-activity-detail'));
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  #detailArrayItem(value, key, activityId, list) {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => {
      const act = this.#store.snapshot().activities.find(a => a.activity_id === activityId);
      if (!act) return;
      const siblings = [...list.querySelectorAll('input')];
      const idx = siblings.indexOf(input);
      if (idx >= 0) act[key][idx] = input.value;
      this.#store.upsertActivity(act);
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '删除';
    removeBtn.className = 'fa-array-remove';
    removeBtn.addEventListener('click', () => {
      const act = this.#store.snapshot().activities.find(a => a.activity_id === activityId);
      if (!act) return;
      const siblings = [...list.querySelectorAll('input')];
      const idx = siblings.indexOf(input);
      if (idx >= 0) act[key].splice(idx, 1);
      this.#store.upsertActivity(act);
      this.#renderDetail(this.#store.snapshot().activities.find(a => a.activity_id === activityId),
        this.#root.querySelector('#fa-activity-detail'));
    });
    li.append(input, removeBtn);
    return li;
  }

  #roleAssignmentsField(act) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field fa-array-field';
    const title = document.createElement('span');
    title.textContent = '角色分工';
    title.className = 'fa-array-title';
    wrap.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'fa-array-list';
    for (const [assignmentIndex, ra] of act.role_assignments.entries()) {
      const li = document.createElement('li');
      li.className = 'fa-role-item';
      const roleInput = document.createElement('input');
      roleInput.type = 'text';
      roleInput.value = ra.role_id;
      roleInput.placeholder = '角色 ID';
      roleInput.setAttribute('aria-label', '角色 ID');
      const respSelect = document.createElement('select');
      respSelect.setAttribute('aria-label', '职责');
      const codes = act.responsibility_model === 'OARP'
        ? ['O', 'A', 'R', 'P'] : ['R', 'A', 'S', 'C', 'I'];
      for (const c of codes) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        opt.selected = c === ra.responsibility;
        respSelect.appendChild(opt);
      }

      // 角色 ID 变更时保存并尝试移泳道
      const handleRoleChange = async () => {
        try {
          await this.#applyRoleChange(act.activity_id, current => {
            if (!current.role_assignments[assignmentIndex]) return;
            current.role_assignments[assignmentIndex] = {
              role_id: roleInput.value.trim(),
              responsibility: respSelect.value,
            };
          });
        } catch (error) {
          roleInput.value = ra.role_id;
          respSelect.value = ra.responsibility;
          alert(error.message);
        }
      };
      roleInput.addEventListener('change', handleRoleChange);
      respSelect.addEventListener('change', handleRoleChange);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '删除';
      removeBtn.className = 'fa-array-remove';
      removeBtn.addEventListener('click', async () => {
        try {
          await this.#applyRoleChange(act.activity_id, current => {
            current.role_assignments.splice(assignmentIndex, 1);
          });
          this.#renderDetail(this.#store.snapshot().activities.find(a => a.activity_id === act.activity_id),
            this.#root.querySelector('#fa-activity-detail'));
        } catch (error) {
          alert(error.message);
        }
      });
      li.append(roleInput, respSelect, removeBtn);
      list.appendChild(li);
    }
    wrap.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '新增角色';
    addBtn.className = 'fa-array-add';
    addBtn.addEventListener('click', () => {
      const roleId = prompt('请输入新增角色 ID');
      if (!roleId) return;
      const current = this.#store.snapshot().activities.find(a => a.activity_id === act.activity_id);
      if (!current) return;
      if (current.role_assignments.some(item => item.role_id === roleId.trim())) {
        alert(`角色已存在：${roleId.trim()}`);
        return;
      }
      current.role_assignments.push({ role_id: roleId.trim(), responsibility: 'A' });
      this.#store.upsertActivity(current);
      this.#renderDetail(this.#store.snapshot().activities.find(a => a.activity_id === act.activity_id),
        this.#root.querySelector('#fa-activity-detail'));
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  async #applyRoleChange(activityId, update) {
    const mutation = (store) => {
      const current = store.snapshot().activities.find(
        activity => activity.activity_id === activityId,
      );
      if (!current) throw new Error(`活动不存在：${activityId}`);
      update(current);
      store.upsertActivity(current);
      structuralCommands.moveActivityToAccountableLane(store, activityId);
    };
    if (this.#autoLayout) {
      await this.#autoLayout.applyStructureChange(mutation, '修改角色分工并移泳道');
    } else {
      const snapshot = this.#store.snapshot();
      try {
        mutation(this.#store);
      } catch (error) {
        this.#store.restore(snapshot);
        throw error;
      }
    }
  }

  #slaField(act) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const title = document.createElement('span');
    title.textContent = 'SLA / 时限';
    title.className = 'fa-field-label';
    wrap.appendChild(title);

    const sla = act.sla || {};
    const row = document.createElement('div');
    row.className = 'fa-sla-row';

    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.min = '0';
    valInput.value = sla.value || '';
    valInput.placeholder = '数值';
    valInput.setAttribute('aria-label', 'SLA 数值');

    const unitSelect = document.createElement('select');
    unitSelect.setAttribute('aria-label', 'SLA 单位');
    for (const [val, label] of Object.entries(SLA_UNIT_LABELS)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      opt.selected = val === sla.unit;
      unitSelect.appendChild(opt);
    }

    const rawInput = document.createElement('input');
    rawInput.type = 'text';
    rawInput.value = sla.raw_text || '';
    rawInput.placeholder = '原文（无法结构化时填写）';
    rawInput.setAttribute('aria-label', 'SLA 原文');

    row.append(valInput, unitSelect, rawInput);
    wrap.appendChild(row);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = '保存 SLA';
    saveBtn.addEventListener('click', () => {
      const newSla = {};
      if (valInput.value) {
        newSla.value = Number(valInput.value);
        newSla.unit = unitSelect.value;
      }
      if (rawInput.value) newSla.raw_text = rawInput.value;
      this.#saveActivity(act.activity_id, { sla: Object.keys(newSla).length ? newSla : null });
    });
    wrap.appendChild(saveBtn);

    return wrap;
  }

  #confirmationField(act) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const title = document.createElement('span');
    title.textContent = '确认从 Task';
    title.className = 'fa-field-label';
    wrap.appendChild(title);

    if (act.confirmation) {
      const info = document.createElement('div');
      info.className = 'fa-confirmation-info';
      info.innerHTML = `<p>确认 Task：<code>${act.confirmation.confirmation_task_id}</code></p>` +
        `<p>确认角色：${act.confirmation.confirm_role_id}</p>` +
        `<p>共同完成：${act.confirmation.co_completes ? '是' : '否'}</p>` +
        `<p>承担最终责任：${act.confirmation.confirm_bears_final_responsibility ? '是' : '否'}</p>` +
        `<p>无正式审批会议：${act.confirmation.no_formal_approval_meeting ? '是' : '否'}</p>`;
      wrap.appendChild(info);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '移除确认从 Task';
      removeBtn.addEventListener('click', async () => {
        const remove = store => structuralCommands.removeConfirmationTask(store, act.activity_id);
        if (this.#autoLayout) {
          await this.#autoLayout.applyStructureChange(remove, '移除确认从 Task');
        } else {
          remove(this.#store);
        }
        this.render();
      });
      wrap.appendChild(removeBtn);
    } else {
      const info = document.createElement('p');
      info.textContent = '暂无确认从 Task。';
      wrap.appendChild(info);
    }
    return wrap;
  }

  #saveActivity(activityId, updates) {
    const snapshot = this.#store.snapshot();
    const act = snapshot.activities.find(a => a.activity_id === activityId);
    if (!act) return;
    if (updates.responsibility_model
      && updates.responsibility_model !== act.responsibility_model) {
      const oldCode = act.responsibility_model === 'OARP' ? 'O' : 'R';
      const newCode = updates.responsibility_model === 'OARP' ? 'O' : 'R';
      if (!act.role_assignments.some(role => role.responsibility === newCode)) {
        const oldAccountable = act.role_assignments.find(
          role => role.responsibility === oldCode,
        );
        if (oldAccountable) oldAccountable.responsibility = newCode;
      }
    }
    Object.assign(act, updates);

    if (typeof updates.name === 'string') {
      const binding = snapshot.diagram.task_bindings.find(
        item => item.activity_id === activityId,
      );
      const node = binding
        ? snapshot.diagram.nodes.find(item => item.node_id === binding.main_task_id)
        : null;
      if (node) {
        node.name = updates.name;
        this.#store.updateDiagram(snapshot.diagram);
        const modeler = this.#autoLayout?.modeler;
        const element = modeler?.get('elementRegistry').get(node.node_id);
        if (element) modeler.get('modeling').updateLabel(element, updates.name);
      }
    }

    this.#store.upsertActivity(act);
  }

  async #addActivity() {
    const snap = this.#store.snapshot();
    const count = snap.activities.length;
    const activityName = `新活动 ${count + 1}`;

    const doInsert = (store) => {
      const result = structuralCommands.addL5Activity(store, {
        name: activityName,
      });
      this.#selectedId = result.activity_id;
      return result;
    };

    if (this.#autoLayout) {
      await this.#autoLayout.applyStructureChange(doInsert, '新增 L5 活动');
    } else {
      doInsert(this.#store);
    }
    this.render();
  }

  #accountableRole(act) {
    if (!act.role_assignments || act.role_assignments.length === 0) return null;
    if (act.responsibility_model === 'OARP') {
      return act.role_assignments.find(r => r.responsibility === 'O') || null;
    }
    return act.role_assignments.find(r => r.responsibility === 'R') || null;
  }
}
