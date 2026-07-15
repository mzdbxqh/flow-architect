import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import './styles.css';
import { decodePayload } from './payload-codec.js';
import { QuestionController } from './question-controller.js';

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

  window.__FLOW_ARCHITECT__ = { modeler, payload, questionController };
})();
