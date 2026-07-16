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
      activities: payload.activities || [],
      diagram: payload.diagram || { lanes: [], nodes: [], flows: [], task_bindings: [], layout_version: '2.0.0' },
      questions: payload.questions || [],
      provenance: payload.provenance || {},
      source_summary: payload.source_summary || { total_blocks: 0, formats: [], evidence_refs: [] },
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
    const cardController = new ProcessCardController({ store, root: cardPanel });
    cardController.render();
    cardPanel.addEventListener('fa-level-change', () => updateTabApplicability());
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
        store.updateQuestion(q.question_id || q.id, {
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

  // --- Palette business event routing ---
  let pendingDeleteTarget = null;
  let currentGatewayType = 'XOR';
  const eventBus = modeler.get('eventBus');

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
        const confirmRoleId = prompt('请输入确认角色 ID（不能与主责角色相同）');
        if (!confirmRoleId) return;
        const doConfirm = (store) => structuralCommands.addConfirmationTask(store, act.activity_id, confirmRoleId);
        if (autoLayout) {
          autoLayout.applyStructureChange(doConfirm, '添加确认从 Task').catch(e => alert(e.message));
        } else {
          try { doConfirm(store); } catch (e) { alert(e.message); }
        }
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
        const name = prompt('中间事件名称');
        if (!name) return;
        const doIntermediate = (store) => {
          const nodeId = `Intermediate_${Date.now()}`;
          return structuralCommands.addIntermediateEventAfter(store, selected.id, {
            node_id: nodeId,
            name,
            event_type: 'INTERMEDIATE_MESSAGE_CATCH',
          });
        };
        if (autoLayout) {
          autoLayout.applyStructureChange(doIntermediate, '添加中间事件').catch(e => alert(e.message));
        } else {
          try { doIntermediate(store); } catch (e) { alert(e.message); }
        }
        break;
      }
      case 'create.end': {
        const selected = diagramController.selected;
        if (!selected) { alert('请先选择一个节点'); return; }
        const name = prompt('结束结果名称');
        if (!name) return;
        const doEnd = (store) => {
          const eventId = `End_${Date.now()}`;
          return structuralCommands.addEndResultAfter(store, selected.id, {
            event_id: eventId,
            name,
          });
        };
        if (autoLayout) {
          autoLayout.applyStructureChange(doEnd, '添加结束事件').catch(e => alert(e.message));
        } else {
          try { doEnd(store); } catch (e) { alert(e.message); }
        }
        break;
      }
      case 'create.lane': {
        const name = prompt('泳道名称');
        if (!name) return;
        const roleId = prompt('角色 ID');
        if (!roleId) return;
        const doLane = (store) => {
          const laneId = `Lane_${Date.now()}`;
          return structuralCommands.addLane(store, { lane_id: laneId, name, role_id: roleId });
        };
        if (autoLayout) {
          autoLayout.applyStructureChange(doLane, '添加泳道').catch(e => alert(e.message));
        } else {
          try { doLane(store); } catch (e) { alert(e.message); }
        }
        break;
      }
      case 'connect': {
        alert('请使用工具栏的「后插活动」或「增加判断」来创建结构连接');
        break;
      }
      case 'delete': {
        diagramController.deleteSelected().catch(e => alert(e.message));
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

  document.querySelector('#fa-rename-confirm').addEventListener('click', () => {
    const name = document.querySelector('#fa-rename-input').value;
    diagramController.renameSelected(name);
    document.querySelector('#fa-rename-dialog').close();
  });

  document.querySelector('#fa-rename-cancel').addEventListener('click', () => {
    document.querySelector('#fa-rename-dialog').close();
  });

  document.querySelector('#fa-insert-task').addEventListener('click', () => {
    if (!diagramController.selected) return;
    document.querySelector('#fa-insert-input').value = '';
    document.querySelector('#fa-insert-dialog').showModal();
  });

  document.querySelector('#fa-insert-confirm').addEventListener('click', async () => {
    const name = document.querySelector('#fa-insert-input').value;
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

  document.querySelector('#fa-add-gateway').addEventListener('click', () => {
    if (!diagramController.selected) return;
    document.querySelector('#fa-gateway-question').value = '';
    document.querySelector('#fa-gateway-yes').value = '';
    document.querySelector('#fa-gateway-no').value = '';
    document.querySelector('#fa-gateway-dialog').showModal();
  });

  document.querySelector('#fa-gateway-confirm').addEventListener('click', async () => {
    const question = document.querySelector('#fa-gateway-question').value;
    const yesLabel = document.querySelector('#fa-gateway-yes').value;
    const noLabel = document.querySelector('#fa-gateway-no').value;
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
    if (!diagramController.selected) return;
    const selectedId = diagramController.selected.id;
    document.querySelector('#fa-delete-confirm-message').textContent =
      `确定要删除「${diagramController.selected.businessObject?.name || selectedId}」？此操作不可撤销。`;
    document.querySelector('#fa-delete-confirm-dialog').showModal();
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
  document.querySelector('#fa-delete-confirm').addEventListener('click', async () => {
    try {
      if (pendingDeleteTarget?.type === 'activity') {
        const doDelete = (store) => structuralCommands.deleteNode(store, pendingDeleteTarget.mainTaskId);
        await autoLayout.applyStructureChange(doDelete, '删除活动');
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

  document.querySelector('#fa-undo').addEventListener('click', () => {
    diagramController.undo();
  });

  document.querySelector('#fa-redo').addEventListener('click', () => {
    diagramController.redo();
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
