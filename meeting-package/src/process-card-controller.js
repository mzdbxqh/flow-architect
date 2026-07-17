/**
 * ProcessCardController - 流程卡片表单
 *
 * 按基本、归属、边界、绩效四组渲染可编辑表单。
 * 所有修改通过 DraftStore 提交。
 * F2: 结构变更（起点/终点）通过结构命令 + AutoLayout 事务重排。
 */
import * as structuralCommands from './structural-commands.js';

export class ProcessCardController {
  #store;
  #root;
  #autoLayout;

  constructor({ store, root, autoLayout }) {
    this.#store = store;
    this.#root = root;
    this.#autoLayout = autoLayout;
  }

  render() {
    const card = this.#store.snapshot().process_card;
    this.#root.replaceChildren();
    this.#root.id = 'fa-card-panel';
    this.#root.setAttribute('role', 'tabpanel');

    // 基本信息
    this.#root.appendChild(this.#section('基本信息', [
      this.#textField('流程名称', 'name', card.name),
      this.#selectField('流程层级', 'level', card.level, ['L1', 'L2', 'L3', 'L4']),
      this.#checkboxField('末端流程', 'is_leaf', card.is_leaf),
      this.#textareaField('流程描述', 'description', card.description),
    ]));

    // 归属信息
    this.#root.appendChild(this.#section('归属信息', [
      this.#textField('流程责任人', 'owner', card.owner),
      this.#textField('上一层流程', 'parent_process_name', card.parent_process_name || ''),
    ]));

    // 边界信息
    this.#root.appendChild(this.#section('边界信息', [
      this.#textareaField('流程目的', 'purpose', card.purpose),
      this.#arrayField('流程级输入', 'inputs', card.inputs),
      this.#arrayField('流程级输出', 'outputs', card.outputs),
      this.#startField(card.start),
      this.#endResultsField(card.end_results),
    ]));

    // 绩效信息
    this.#root.appendChild(this.#section('绩效信息', [
      this.#kpiField(card.performance_indicators),
    ]));

    // 设置 tabpanel 标签
    this.#root.setAttribute('aria-labelledby', 'fa-tab-card');
  }

  #section(title, children) {
    const section = document.createElement('section');
    section.className = 'fa-card-section';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    section.appendChild(h2);
    for (const child of children) section.appendChild(child);
    return section;
  }

  #textField(label, key, value) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => {
      this.#store.updateProcessCard({ [key]: input.value });
    });
    lbl.appendChild(input);
    wrap.appendChild(lbl);
    return wrap;
  }

  #textareaField(label, key, value) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const textarea = document.createElement('textarea');
    textarea.value = value || '';
    textarea.setAttribute('aria-label', label);
    textarea.addEventListener('change', () => {
      this.#store.updateProcessCard({ [key]: textarea.value });
    });
    lbl.appendChild(textarea);
    wrap.appendChild(lbl);
    return wrap;
  }

  #selectField(label, key, value, options) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    if (key === 'level') select.disabled = true;
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      option.selected = opt === value;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.#store.updateProcessCard({ [key]: select.value });
      this.#notifyLevelChange();
    });
    lbl.appendChild(select);
    wrap.appendChild(lbl);
    return wrap;
  }

  #checkboxField(label, key, checked) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', label);
    if (key === 'is_leaf') input.disabled = true;
    input.addEventListener('change', () => {
      this.#store.updateProcessCard({ [key]: input.checked });
      this.#notifyLevelChange();
    });
    lbl.prepend(input);
    wrap.appendChild(lbl);
    return wrap;
  }

  #arrayField(label, key, items) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field fa-array-field';
    const title = document.createElement('span');
    title.textContent = label;
    title.className = 'fa-array-title';
    wrap.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'fa-array-list';
    for (const item of items) {
      list.appendChild(this.#arrayItem(key, item, list));
    }
    wrap.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = `新增${label}`;
    addBtn.className = 'fa-array-add';
    addBtn.addEventListener('click', () => {
      const current = this.#store.snapshot().process_card[key];
      current.push('');
      this.#store.updateProcessCard({ [key]: current });
      this.render();
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  #arrayItem(key, value, list) {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', () => {
      const current = this.#store.snapshot().process_card[key];
      const siblings = [...list.querySelectorAll('input')];
      const idx = siblings.indexOf(input);
      if (idx >= 0) current[idx] = input.value;
      this.#store.updateProcessCard({ [key]: current });
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '删除';
    removeBtn.className = 'fa-array-remove';
    removeBtn.addEventListener('click', () => {
      const current = this.#store.snapshot().process_card[key];
      const siblings = [...list.querySelectorAll('input')];
      const idx = siblings.indexOf(input);
      if (idx >= 0) current.splice(idx, 1);
      this.#store.updateProcessCard({ [key]: current });
      this.render();
    });
    li.append(input, removeBtn);
    return li;
  }

  #startField(start) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field';
    const title = document.createElement('span');
    title.textContent = '起点';
    title.className = 'fa-array-title';
    wrap.appendChild(title);

    const nameLbl = document.createElement('label');
    nameLbl.textContent = '起点名称';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = start.name || '';
    nameInput.setAttribute('aria-label', '起点名称');
    nameInput.addEventListener('change', async () => {
      const current = this.#store.snapshot().process_card.start;
      await this.#applyStructureChange(
        store => structuralCommands.updateStartEvent(store, { ...current, name: nameInput.value }),
        '修改流程起点',
      );
    });
    nameLbl.appendChild(nameInput);
    wrap.appendChild(nameLbl);

    const typeLbl = document.createElement('label');
    typeLbl.textContent = '事件类型';
    const typeSelect = document.createElement('select');
    typeSelect.setAttribute('aria-label', '起点事件类型');
    for (const t of ['NONE', 'MESSAGE', 'TIMER', 'SIGNAL', 'CONDITIONAL']) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      opt.selected = t === start.event_type;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener('change', async () => {
      const current = this.#store.snapshot().process_card.start;
      await this.#applyStructureChange(
        store => structuralCommands.updateStartEvent(store, { ...current, event_type: typeSelect.value }),
        '修改起点事件类型',
      );
    });
    typeLbl.appendChild(typeSelect);
    wrap.appendChild(typeLbl);

    return wrap;
  }

  #endResultsField(endResults) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field fa-array-field fa-end-results';
    const title = document.createElement('span');
    title.textContent = '业务终点';
    title.className = 'fa-array-title';
    wrap.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'fa-array-list';
    for (const er of endResults) {
      const li = document.createElement('li');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = er.name;
      nameInput.setAttribute('aria-label', '终点名称');
      // F2: 终点改名同步 END_EVENT 节点名称
      nameInput.addEventListener('change', async () => {
        await this.#applyStructureChange(
          store => structuralCommands.renameEndResult(store, er.event_id, nameInput.value),
          '修改业务终点',
        );
      });
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '删除';
      removeBtn.className = 'fa-array-remove';
      // F2: 删除终点通过结构命令 + AutoLayout
      removeBtn.addEventListener('click', async () => {
        const current = this.#store.snapshot().process_card.end_results;
        if (current.length <= 1) {
          alert('FA-DRAFT-CARD-002: 流程必须保留至少一个业务终点');
          return;
        }
        const idx = [...list.children].indexOf(li);
        if (idx < 0) return;
        const eventId = current[idx].event_id;
        const eventName = current[idx].name;
        // 派发确认事件，由 app.js 处理
        this.#root.dispatchEvent(new CustomEvent('fa-delete-end-result', {
          detail: { eventId, eventName, eventIds: current.map(r => r.event_id) },
          bubbles: true,
        }));
      });
      li.append(nameInput, removeBtn);
      list.appendChild(li);
    }
    wrap.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '新增终点';
    addBtn.className = 'fa-array-add';
    // F2: 新增终点通过结构命令 + AutoLayout 重排
    addBtn.addEventListener('click', async () => {
      const current = this.#store.snapshot().process_card.end_results;
      const nextIdx = current.length + 1;
      const eventName = `终点${nextIdx}`;
      await this.#applyAddEndResult(eventName);
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  /**
   * F2: 通过结构命令 + AutoLayout 新增终点
   * 使用确定性业务插入点，不得武断连接 START_EVENT → END_EVENT
   */
  async #applyAddEndResult(eventName) {
    const mutation = (store) => {
      const snapshot = store.snapshot();
      // 确定性插入点：最后一个连接到 END_EVENT 的 MAIN_TASK
      const endEvents = snapshot.diagram.nodes.filter(n => n.node_type === 'END_EVENT');
      let insertAfterId = null;
      for (const endEvent of endEvents) {
        const incomingFlows = snapshot.diagram.flows.filter(f => f.target_ref === endEvent.node_id);
        for (const flow of incomingFlows) {
          const sourceNode = snapshot.diagram.nodes.find(n => n.node_id === flow.source_ref);
          if (sourceNode && sourceNode.node_type === 'MAIN_TASK') {
            insertAfterId = sourceNode.node_id;
            break;
          }
        }
        if (insertAfterId) break;
      }
      if (!insertAfterId) {
        // 回退到 START_EVENT
        const startEvent = snapshot.diagram.nodes.find(n => n.node_type === 'START_EVENT');
        if (startEvent) insertAfterId = startEvent.node_id;
      }
      if (!insertAfterId) {
        throw new Error('FA-DRAFT-ROLE-001: 无法确定终点插入点');
      }
      structuralCommands.addEndResultAfter(store, insertAfterId, { name: eventName });
    };
    await this.#applyStructureChange(mutation, '新增终点');
  }

  async #applyStructureChange(mutation, description) {
    try {
      if (!this.#autoLayout) throw new Error('流程卡片缺少自动布局控制器');
      await this.#autoLayout.applyStructureChange(mutation, description);
      this.render();
      return true;
    } catch (error) {
      alert(error.message);
      this.render();
      return false;
    }
  }

  #kpiField(kpis) {
    const wrap = document.createElement('div');
    wrap.className = 'fa-field fa-array-field';
    const title = document.createElement('span');
    title.textContent = '流程绩效指标';
    title.className = 'fa-array-title';
    wrap.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'fa-array-list';
    for (let kpiIdx = 0; kpiIdx < kpis.length; kpiIdx++) {
      const kpi = kpis[kpiIdx];
      const li = document.createElement('li');
      li.className = 'fa-kpi-item';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = kpi.name;
      nameInput.placeholder = '指标名称';
      nameInput.setAttribute('aria-label', 'KPI 名称');
      // F2: KPI 名称 change listener 写回 DraftStore
      nameInput.addEventListener('change', () => {
        const current = this.#store.snapshot().process_card.performance_indicators;
        if (kpiIdx < current.length) {
          current[kpiIdx] = { ...current[kpiIdx], name: nameInput.value };
          this.#store.updateProcessCard({ performance_indicators: current });
        }
      });
      const targetInput = document.createElement('input');
      targetInput.type = 'text';
      targetInput.value = kpi.target || '';
      targetInput.placeholder = '目标值';
      targetInput.setAttribute('aria-label', 'KPI 目标值');
      // F2: KPI 目标值 change listener 写回 DraftStore
      targetInput.addEventListener('change', () => {
        const current = this.#store.snapshot().process_card.performance_indicators;
        if (kpiIdx < current.length) {
          current[kpiIdx] = { ...current[kpiIdx], target: targetInput.value };
          this.#store.updateProcessCard({ performance_indicators: current });
        }
      });
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '删除';
      removeBtn.className = 'fa-array-remove';
      removeBtn.addEventListener('click', () => {
        const current = this.#store.snapshot().process_card.performance_indicators;
        const idx = [...list.children].indexOf(li);
        if (idx >= 0) current.splice(idx, 1);
        this.#store.updateProcessCard({ performance_indicators: current });
        this.render();
      });
      li.append(nameInput, targetInput, removeBtn);
      list.appendChild(li);
    }
    wrap.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '新增 KPI';
    addBtn.className = 'fa-array-add';
    addBtn.addEventListener('click', () => {
      const current = this.#store.snapshot().process_card.performance_indicators;
      current.push({ indicator_id: `KPI-${current.length + 1}`, name: '', target: '' });
      this.#store.updateProcessCard({ performance_indicators: current });
      this.render();
    });
    wrap.appendChild(addBtn);
    return wrap;
  }

  #notifyLevelChange() {
    // Dispatch custom event so app.js can update tab visibility
    this.#root.dispatchEvent(new CustomEvent('fa-level-change', { bubbles: true }));
  }
}
