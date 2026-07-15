import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import './styles.css';
import { decodePayload } from './payload-codec.js';
import { QuestionController } from './question-controller.js';
import { DiagramController } from './diagram-controller.js';

(async function() {
  const encoded = document.querySelector('#fa-package-data')?.textContent?.trim();
  if (!encoded) throw new Error('会议包缺少 fa-package-data');
  const payload = decodePayload(encoded);
  const modeler = new BpmnModeler({ container: '#fa-canvas' });
  await modeler.importXML(payload.bpmn_xml);
  modeler.get('canvas').zoom('fit-viewport');
  document.querySelector('#fa-title').textContent = payload.metadata.title;
  document.querySelector('#fa-revision').textContent = payload.metadata.revision;

  const questionController = new QuestionController({
    modeler,
    questions: payload.questions,
    root: document.querySelector('#fa-questions'),
    onChange: () => {},
  });
  questionController.render();

  const diagramController = new DiagramController(modeler, payload.questions);

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

  document.querySelector('#fa-insert-confirm').addEventListener('click', () => {
    const name = document.querySelector('#fa-insert-input').value;
    diagramController.insertTaskAfterSelected(name);
    document.querySelector('#fa-insert-dialog').close();
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

  document.querySelector('#fa-gateway-confirm').addEventListener('click', () => {
    const question = document.querySelector('#fa-gateway-question').value;
    const yesLabel = document.querySelector('#fa-gateway-yes').value;
    const noLabel = document.querySelector('#fa-gateway-no').value;
    diagramController.appendExclusiveBranch(question, yesLabel, noLabel);
    document.querySelector('#fa-gateway-dialog').close();
  });

  document.querySelector('#fa-gateway-cancel').addEventListener('click', () => {
    document.querySelector('#fa-gateway-dialog').close();
  });

  document.querySelector('#fa-delete').addEventListener('click', () => {
    try {
      diagramController.deleteSelected();
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector('#fa-undo').addEventListener('click', () => {
    diagramController.undo();
  });

  document.querySelector('#fa-redo').addEventListener('click', () => {
    diagramController.redo();
  });

  window.__FLOW_ARCHITECT__ = { modeler, payload, questionController, diagramController };
})();
