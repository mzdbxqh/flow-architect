import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import './styles.css';
import { decodePayload } from './payload-codec.js';
import { QuestionController } from './question-controller.js';
import { DiagramController } from './diagram-controller.js';
import { ExportController } from './export-controller.js';
import { DraftStore } from './draft-store.js';
import { ProcessCardController } from './process-card-controller.js';
import { ActivityCatalogController } from './activity-catalog-controller.js';
import { LimitedPaletteModule } from './limited-palette-provider.js';
import { AutoLayoutController } from './auto-layout-controller.js';
import { compileBpmn, normalizeBpmnXml } from '../../scripts/lib/bpmn-compiler.mjs';
import * as structuralCommands from './structural-commands.js';

(async function() {
  const encoded = document.querySelector('#fa-package-data')?.textContent?.trim();
  if (!encoded) throw new Error('会议包缺少 fa-package-data');
  const payload = decodePayload(encoded);

  // V2-only: 校验 metadata.schema_version 并补顶层 schema_version
  const schemaVersion = payload.metadata?.schema_version;
  if (schemaVersion !== '2.0.0') {
    throw new Error('仅支持 schema_version 2.0.0 的流程草稿');
  }

  const store = new DraftStore({
    payload: {
      schema_version: schemaVersion,
      process_card: payload.process_card,
      activities: payload.activities,
      diagram: payload.diagram,
      questions: payload.questions,
      provenance: payload.provenance,
      source_summary: payload.source_summary,
      metadata: payload.metadata,
      bpmn_xml: payload.bpmn_xml,
    },
  });

  // Determine leaf L4 early: non-leaf processes have no diagram
  const card = store.snapshot().process_card;
  const isLeafL4 = card.level === 'L4' && card.is_leaf;

  const modeler = new BpmnModeler({
    container: '#fa-canvas',
    additionalModules: [LimitedPaletteModule],
  });
  if (isLeafL4) {
    await modeler.importXML(payload.bpmn_xml);
    modeler.get('canvas').zoom('fit-viewport');
  }

  // Structural controllers below share the same deterministic compiler-backed
  // layout facade. Initialise it before any view controller receives it.
  const autoLayout = new AutoLayoutController({
    store, modeler,
    compileBpmn,
    normalizeBpmnXml,
  });
  document.querySelector('#fa-title').textContent = payload.metadata.title;
  document.querySelector('#fa-revision').textContent = payload.metadata.revision;

  // --- Tab navigation ---
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');

  function activateTab(tabId) {
    for (const tab of tabs) {
      const isActive = tab.id === tabId;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    }
    for (const panel of panels) {
      const isTarget = panel.getAttribute('aria-labelledby') === tabId;
      panel.hidden = !isTarget;
    }
    // BPMN canvas visibility: hide when not on diagram tab
    const canvas = document.querySelector('#fa-canvas');
    if (canvas) {
      canvas.style.display = tabId === 'fa-tab-diagram' ? '' : 'none';
    }
    if (tabId === 'fa-tab-diagram' && isLeafL4) {
      modeler.get('canvas').zoom('fit-viewport');
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => activateTab(tab.id));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const tabList = [...tabs];
        const idx = tabList.indexOf(tab);
        const next = e.key === 'ArrowRight'
          ? tabList[(idx + 1) % tabList.length]
          : tabList[(idx - 1 + tabList.length) % tabList.length];
        next.focus();
        next.click();
      }
    });
  }

  // --- Not applicable indicator ---
  function updateTabApplicability() {
    const card = store.snapshot().process_card;
    const isLeafL4 = card.level === 'L4' && card.is_leaf;
    const notApplicable = document.querySelector('#fa-not-applicable');
    if (notApplicable) {
      notApplicable.hidden = isLeafL4;
    }
    // Disable diagram and activity tabs for non-leaf processes
    const diagramTab = document.querySelector('#fa-tab-diagram');
    const activityTab = document.querySelector('#fa-tab-activities');
    if (diagramTab) diagramTab.disabled = !isLeafL4;
    if (activityTab) activityTab.disabled = !isLeafL4;
    // If currently on a disabled tab, switch to card tab
    if (!isLeafL4) {
      const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
      if (activeTab && (activeTab.id === 'fa-tab-diagram' || activeTab.id === 'fa-tab-activities')) {
        activateTab('fa-tab-card');
      }
    }
  }

  store.subscribe((kind) => {
    if (kind === 'process_card' || kind === 'restore') {
      updateTabApplicability();
    }
  });

  // --- Process Card Controller ---
  const cardPanel = document.querySelector('#fa-card-panel');
  if (cardPanel) {
    const cardController = new ProcessCardController({ store, root: cardPanel, autoLayout });
    cardController.render();
    store.subscribe((kind) => {
      if (kind === 'restore') cardController.render();
    });
    cardPanel.addEventListener('fa-level-change', () => updateTabApplicability());

  // F2: 删除终点确认
  cardPanel.addEventListener('fa-delete-end-result', async (e) => {
    const { eventId, eventName } = e.detail;
    const deleteMessage = document.querySelector('#fa-delete-confirm-message');
    if (deleteMessage) {
      deleteMessage.textContent = `确定要删除终点「${eventName}」？此操作不可撤销。`;
    }
    pendingDeleteTarget = { type: 'end-result', eventId, eventName };
    document.querySelector('#fa-delete-confirm-dialog').showModal();
  });
  }

  // --- Activity Catalog Controller ---
  const activityPanel = document.querySelector('#fa-activity-panel');
  if (activityPanel) {
    const activityController = new ActivityCatalogController({ store, root: activityPanel, autoLayout });
    activityController.render();
    store.subscribe((kind) => {
      if (kind === 'activity_update' || kind === 'activity_delete' || kind === 'restore') {
        activityController.render();
      }
    });
  }

  // --- Question Controller ---
  const questionController = new QuestionController({
    modeler,
    questions: store.snapshot().questions,
    root: document.querySelector('#fa-questions'),
    onChange: (questions) => {
      for (const q of questions) {
        store.updateQuestion(q.question_id, {
          answer: q.answer,
          status: q.status,
        });
      }
    },
  });
  questionController.render();

  // --- Diagram Controller ---
  const diagramController = new DiagramController(modeler, store.snapshot().questions, { store, autoLayout });
  const exportController = new ExportController({ modeler, payload, store, compileBpmn });

  // --- Guide banner ---
  const guideBanner = document.querySelector('#fa-guide-banner');
  const guideDismiss = document.querySelector('#fa-guide-dismiss');
  let guideSeen = false;
  try { guideSeen = localStorage.getItem('fa-guide-v1-dismissed') === '1'; } catch { /* file:// 等环境下忽略 */ }
  if (guideBanner && guideSeen) guideBanner.hidden = true;
  if (guideDismiss && guideBanner) {
    guideDismiss.addEventListener('click', () => {
      guideBanner.hidden = true;
      try { localStorage.setItem('fa-guide-v1-dismissed', '1'); } catch { /* 忽略持久化失败 */ }
    });
  }

  // --- Selection-dependent edit controls ---
  // 编辑按钮在未选中图元素时禁用，避免“点了没反应/弹 alert”的事后报错体验。
  const selectionButtons = ['#fa-rename', '#fa-insert-task', '#fa-add-gateway', '#fa-delete']
    .map(selector => document.querySelector(selector))
    .filter(Boolean);
  function updateSelectionButtons() {
    const hasSelection = Boolean(diagramController.selected);
    for (const button of selectionButtons) {
      button.disabled = !hasSelection;
    }
  }
  modeler.on('selection.changed', () => updateSelectionButtons());
  updateSelectionButtons();

  // --- Palette business event routing ---
  let pendingDeleteTarget = null;
  let pendingConfirmationActivityId = null;
  let pendingActionSourceId = null;
  let currentGatewayType = 'XOR';
  const eventBus = modeler.get('eventBus');

  function openSelectedDeleteDialog() {
    if (!diagramController.selected) return;
    pendingDeleteTarget = null;
    const selectedId = diagramController.selected.id;
    document.querySelector('#fa-delete-confirm-message').textContent =
      `确定要删除「${diagramController.selected.businessObject?.name || selectedId}」？此操作不可撤销。`;
    document.querySelector('#fa-delete-confirm-dialog').showModal();
  }

  eventBus.on('flowArchitect.paletteAction', (event) => {
    const { action } = event;
    switch (action) {
      case 'create.l5-task': {
        const selected = diagramController.selected;
        if (!selected) { alert('请先选择一个节点'); return; }
        document.querySelector('#fa-insert-input').value = '';
        document.querySelector('#fa-insert-dialog').showModal();
        break;
      }
      case 'create.confirmation-task': {
        const selected = diagramController.selected;
        if (!selected || selected.type !== 'bpmn:Task') { alert('请先选择一个主 Task'); return; }
        const binding = store.snapshot().diagram.task_bindings.find(b => b.main_task_id === selected.id);
        if (!binding) { alert('所选元素未绑定活动'); return; }
        const act = store.snapshot().activities.find(a => a.activity_id === binding.activity_id);
        if (!act) { alert('关联活动不存在'); return; }
        if (act.confirmation) { alert('该活动已有确认从 Task'); return; }
        pendingConfirmationActivityId = act.activity_id;
        document.querySelector('#fa-confirmation-role').value = '';
        document.querySelector('#fa-confirmation-co-completes').checked = false;
        document.querySelector('#fa-confirmation-final-responsibility').checked = false;
        document.querySelector('#fa-confirmation-no-meeting').checked = false;
        document.querySelector('#fa-confirmation-dialog').showModal();
        break;
      }
      case 'create.xor':
      case 'create.and':
      case 'create.or': {
        const selected = diagramController.selected;
        if (!selected) { alert('请先选择一个节点'); return; }
        currentGatewayType = action === 'create.xor' ? 'XOR'
          : action === 'create.and' ? 'AND' : 'OR';
        document.querySelector('#fa-gateway-question').value = '';
        document.querySelector('#fa-gateway-yes').value = '';
        document.querySelector('#fa-gateway-no').value = '';
        document.querySelector('#fa-gateway-dialog').showModal();
        break;
      }
      case 'create.start': {
        const existing = store.snapshot().diagram.nodes.find(n => n.node_type === 'START_EVENT');
        if (existing) { alert('流程中已存在开始事件，不允许新增第二个'); return; }
        alert('开始事件已由系统自动维护');
        break;
      }
      case 'create.intermediate': {
        const selected = diagramController.selected;
        if (!selected) { alert('请先选择一个节点'); return; }
        pendingActionSourceId = selected.id;
        document.querySelector('#fa-intermediate-input').value = '';
        document.querySelector('#fa-intermediate-dialog').showModal();
        break;
      }
      case 'create.end': {
        const selected = diagramController.selected;
        if (!selected) { alert('请先选择一个节点'); return; }
        pendingActionSourceId = selected.id;
        document.querySelector('#fa-end-input').value = '';
        document.querySelector('#fa-end-dialog').showModal();
        break;
      }
      case 'create.lane': {
        document.querySelector('#fa-lane-name').value = '';
        document.querySelector('#fa-lane-role').value = '';
        document.querySelector('#fa-lane-dialog').showModal();
        break;
      }
      case 'connect': {
        const selected = diagramController.selected;
        if (!selected) { alert('请先选择顺序流的源节点'); return; }
        if (selected.type === 'bpmn:EndEvent') {
          alert('FA-DRAFT-FLOW-001: 不允许从结束事件出发创建连接');
          return;
        }
        // 目标候选：排除自身（自环）和 START_EVENT（门禁规则 FA-DRAFT-FLOW-001）
        const candidates = store.snapshot().diagram.nodes.filter(node =>
          node.node_id !== selected.id && node.node_type !== 'START_EVENT');
        if (candidates.length === 0) { alert('没有可连接的目标节点'); return; }
        pendingActionSourceId = selected.id;
        const select = document.querySelector('#fa-connect-target');
        select.replaceChildren(...candidates.map(node => {
          const option = document.createElement('option');
          option.value = node.node_id;
          option.textContent = node.name || node.node_id;
          return option;
        }));
        document.querySelector('#fa-connect-dialog').showModal();
        break;
      }
      case 'delete': {
        openSelectedDeleteDialog();
        break;
      }
      default:
        break;
    }
  });

  // --- Edit controls ---
  document.querySelector('#fa-rename').addEventListener('click', () => {
    if (!diagramController.selected) return;
    document.querySelector('#fa-rename-input').value = diagramController.selected.businessObject.name || '';
    document.querySelector('#fa-rename-dialog').showModal();
  });

  document.querySelector('#fa-rename-confirm').addEventListener('click', (event) => {
    event.preventDefault();
    const name = document.querySelector('#fa-rename-input').value.trim();
    if (!name) { alert('活动名称不能为空'); return; }
    try {
      diagramController.renameSelected(name);
      document.querySelector('#fa-rename-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-rename-cancel').addEventListener('click', () => {
    document.querySelector('#fa-rename-dialog').close();
  });

  document.querySelector('#fa-insert-task').addEventListener('click', () => {
    if (!diagramController.selected) return;
    document.querySelector('#fa-insert-input').value = '';
    document.querySelector('#fa-insert-dialog').showModal();
  });

  document.querySelector('#fa-insert-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#fa-insert-input').value.trim();
    if (!name) { alert('新活动名称不能为空'); return; }
    try {
      await diagramController.insertL5TaskAfterSelected(name);
      document.querySelector('#fa-insert-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-insert-cancel').addEventListener('click', () => {
    document.querySelector('#fa-insert-dialog').close();
  });

  document.querySelector('#fa-confirmation-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    if (!pendingConfirmationActivityId) return;
    const declaration = {
      confirm_role_id: document.querySelector('#fa-confirmation-role').value.trim(),
      co_completes: document.querySelector('#fa-confirmation-co-completes').checked,
      confirm_bears_final_responsibility: document.querySelector('#fa-confirmation-final-responsibility').checked,
      no_formal_approval_meeting: document.querySelector('#fa-confirmation-no-meeting').checked,
    };
    const activityId = pendingConfirmationActivityId;
    const doConfirm = (store) => structuralCommands.addConfirmationTask(store, activityId, declaration);
    try {
      await autoLayout.applyStructureChange(doConfirm, '添加确认从 Task');
      pendingConfirmationActivityId = null;
      document.querySelector('#fa-confirmation-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-confirmation-cancel').addEventListener('click', () => {
    pendingConfirmationActivityId = null;
    document.querySelector('#fa-confirmation-dialog').close();
  });

  document.querySelector('#fa-add-gateway').addEventListener('click', () => {
    if (!diagramController.selected) return;
    document.querySelector('#fa-gateway-question').value = '';
    document.querySelector('#fa-gateway-yes').value = '';
    document.querySelector('#fa-gateway-no').value = '';
    document.querySelector('#fa-gateway-dialog').showModal();
  });

  document.querySelector('#fa-gateway-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    const question = document.querySelector('#fa-gateway-question').value.trim();
    const yesLabel = document.querySelector('#fa-gateway-yes').value.trim();
    const noLabel = document.querySelector('#fa-gateway-no').value.trim();
    if (!question || !yesLabel || !noLabel) {
      alert('判断问题和两个分支活动名称均不能为空');
      return;
    }
    try {
      await diagramController.appendGatewayBranch(currentGatewayType, question, yesLabel, noLabel);
      document.querySelector('#fa-gateway-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-gateway-cancel').addEventListener('click', () => {
    document.querySelector('#fa-gateway-dialog').close();
  });

  document.querySelector('#fa-delete').addEventListener('click', () => {
    openSelectedDeleteDialog();
  });

  // 活动表"删除此活动"按钮二次确认
  document.querySelector('#fa-activity-panel').addEventListener('fa-delete-activity', (e) => {
    const { mainTaskId, name } = e.detail;
    pendingDeleteTarget = { type: 'activity', mainTaskId, name };
    document.querySelector('#fa-delete-confirm-message').textContent =
      `确定要删除活动「${name}」？此操作将同时删除关联的主 Task。`;
    document.querySelector('#fa-delete-confirm-dialog').showModal();
  });

  // 删除确认对话框：确认按钮
  document.querySelector('#fa-delete-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      if (pendingDeleteTarget?.type === 'activity') {
        const doDelete = (store) => structuralCommands.deleteNode(store, pendingDeleteTarget.mainTaskId);
        await autoLayout.applyStructureChange(doDelete, '删除活动');
      } else if (pendingDeleteTarget?.type === 'end-result') {
        const eventId = pendingDeleteTarget.eventId;
        const doDeleteEnd = (store) => structuralCommands.deleteNode(store, eventId);
        await autoLayout.applyStructureChange(doDeleteEnd, '删除终点');
      } else {
        await diagramController.deleteSelected();
      }
    } catch (error) {
      alert(error.message);
    } finally {
      pendingDeleteTarget = null;
      document.querySelector('#fa-delete-confirm-dialog').close();
    }
  });

  // 删除确认对话框：取消按钮
  document.querySelector('#fa-delete-cancel').addEventListener('click', () => {
    pendingDeleteTarget = null;
    document.querySelector('#fa-delete-confirm-dialog').close();
  });

  // 顺序流对话框：确认/取消
  document.querySelector('#fa-connect-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    const targetId = document.querySelector('#fa-connect-target').value;
    if (!targetId) { alert('请选择目标节点'); return; }
    if (!pendingActionSourceId) { alert('请先选择顺序流的源节点'); return; }
    const connect = store => structuralCommands.connectNodes(store, pendingActionSourceId, targetId, null);
    try {
      await autoLayout.applyStructureChange(connect, '添加顺序流');
      pendingActionSourceId = null;
      document.querySelector('#fa-connect-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-connect-cancel').addEventListener('click', () => {
    pendingActionSourceId = null;
    document.querySelector('#fa-connect-dialog').close();
  });

  // 中间事件对话框：确认/取消
  document.querySelector('#fa-intermediate-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#fa-intermediate-input').value.trim();
    if (!name) { alert('中间事件名称不能为空'); return; }
    if (!pendingActionSourceId) { alert('请先选择一个节点'); return; }
    const doIntermediate = (store) => structuralCommands.addIntermediateEventAfter(
      store,
      pendingActionSourceId,
      { name, event_type: 'INTERMEDIATE_MESSAGE_CATCH' },
    );
    try {
      await autoLayout.applyStructureChange(doIntermediate, '添加中间事件');
      pendingActionSourceId = null;
      document.querySelector('#fa-intermediate-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-intermediate-cancel').addEventListener('click', () => {
    pendingActionSourceId = null;
    document.querySelector('#fa-intermediate-dialog').close();
  });

  // 结束事件对话框：确认/取消
  document.querySelector('#fa-end-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#fa-end-input').value.trim();
    if (!name) { alert('结束结果名称不能为空'); return; }
    if (!pendingActionSourceId) { alert('请先选择一个节点'); return; }
    const doEnd = (store) => structuralCommands.addEndResultAfter(
      store,
      pendingActionSourceId,
      { name },
    );
    try {
      await autoLayout.applyStructureChange(doEnd, '添加结束事件');
      pendingActionSourceId = null;
      document.querySelector('#fa-end-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-end-cancel').addEventListener('click', () => {
    pendingActionSourceId = null;
    document.querySelector('#fa-end-dialog').close();
  });

  // 泳道对话框：确认/取消
  document.querySelector('#fa-lane-confirm').addEventListener('click', async (event) => {
    event.preventDefault();
    const name = document.querySelector('#fa-lane-name').value.trim();
    const roleId = document.querySelector('#fa-lane-role').value.trim();
    if (!name || !roleId) { alert('泳道名称和角色 ID 均不能为空'); return; }
    const doLane = (store) => structuralCommands.addLane(store, { name, role_id: roleId });
    try {
      await autoLayout.applyStructureChange(doLane, '添加泳道');
      document.querySelector('#fa-lane-dialog').close();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-lane-cancel').addEventListener('click', () => {
    document.querySelector('#fa-lane-dialog').close();
  });

  document.querySelector('#fa-export-html').addEventListener('click', () => {
    exportController.downloadNewHtml().catch(e => alert(`导出失败：${e.message}`));
  });

  document.querySelector('#fa-export-bpmn').addEventListener('click', () => {
    exportController.downloadBpmn().catch(e => alert(`导出失败：${e.message}`));
  });

  document.querySelector('#fa-export-svg').addEventListener('click', () => {
    exportController.downloadSvg().catch(e => alert(`导出失败：${e.message}`));
  });

  document.querySelector('#fa-export-questions').addEventListener('click', () => {
    exportController.downloadQuestions().catch(e => alert(`导出失败：${e.message}`));
  });

  document.querySelector('#fa-export-full-json').addEventListener('click', () => {
    exportController.downloadFullJson().catch(e => alert(`导出失败：${e.message}`));
  });

  // --- Dirty indicator ---
  const dirtyIndicator = document.querySelector('#fa-dirty-indicator');
  store.subscribe(() => {
    if (dirtyIndicator) {
      dirtyIndicator.hidden = !store.dirty;
    }
  });

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (store.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // Initial tab state: non-leaf starts on card tab
  if (isLeafL4) {
    activateTab('fa-tab-diagram');
  } else {
    activateTab('fa-tab-card');
  }
  updateTabApplicability();

  window.__FLOW_ARCHITECT__ = { modeler, payload, store, questionController, diagramController, exportController, autoLayout };
})();
