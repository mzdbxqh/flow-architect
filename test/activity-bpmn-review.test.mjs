import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { reviewActivityBpmn, evaluateActivityBpmnStage } from '../scripts/review-activity-bpmn.mjs';
import { validateProcessDraft } from '../scripts/lib/process-draft-contract.mjs';
import { validateContract } from '../scripts/lib/contract-validation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', 'references', 'schemas');

// ── Schema 验证器 ──
let validateDraftSchema;
let validateFindingSet;
before(async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const findingSetSchema = JSON.parse(
    await readFile(join(schemasDir, 'finding-set.schema.json'), 'utf8')
  );
  validateFindingSet = ajv.compile(findingSetSchema);

  const draftAjv = new Ajv2020({ allErrors: true, strict: false });
  for (const name of [
    'process-card.schema.json',
    'activity-catalog.schema.json',
    'diagram-draft.schema.json',
    'field-provenance.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(join(schemasDir, name), 'utf8'));
    draftAjv.addSchema(schema);
  }
  const draftSchema = JSON.parse(
    await readFile(join(schemasDir, 'process-draft.schema.json'), 'utf8')
  );
  validateDraftSchema = draftAjv.compile(draftSchema);
});

// ── V2 合法基线 fixture ──
function makeValidDraft() {
  return {
    schema_version: '2.0.0',
    process_card: {
      process_id: 'Process-purchase',
      name: '采购审批',
      level: 'L4',
      is_leaf: true,
      description: '完成采购申请的审查与决策',
      purpose: '形成可执行的采购决定',
      owner: 'Role-process-owner',
      parent_process_name: '采购管理',
      inputs: ['采购申请'],
      outputs: ['审批结果'],
      start: { event_id: 'Start-request', name: '收到采购申请', event_type: 'NONE' },
      end_results: [{ event_id: 'End-approved', name: '采购申请已批准' }],
      performance_indicators: [],
    },
    activities: [
      {
        activity_id: 'Activity-submit',
        name: '提交采购申请',
        description: '填写并提交采购申请表',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [
          { role_id: 'Role-requester', responsibility: 'R' },
          { role_id: 'Role-approver', responsibility: 'A' },
          { role_id: 'Role-purchaser', responsibility: 'S' },
        ],
        tools: [],
        inputs: ['采购申请'],
        process_summary: '填写采购申请表',
        outputs: ['已提交的采购申请'],
        completion_criteria: ['申请已提交'],
        references: [],
        main_task_id: 'Task-submit',
        confirmation: null,
        completeness: 'COMPLETE',
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'Lane-requester', name: '申请人', role_id: 'Role-requester' },
        { lane_id: 'Lane-approver', name: '审批人', role_id: 'Role-approver' },
        { lane_id: 'Lane-purchaser', name: '采购员', role_id: 'Role-purchaser' },
      ],
      nodes: [
        { node_id: 'Start-request', node_type: 'START_EVENT', name: '收到采购申请', lane_id: 'Lane-requester' },
        { node_id: 'Task-submit', node_type: 'MAIN_TASK', name: '提交采购申请', lane_id: 'Lane-requester' },
        { node_id: 'End-approved', node_type: 'END_EVENT', name: '采购申请已批准', lane_id: 'Lane-requester' },
      ],
      flows: [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-submit', target_ref: 'End-approved', condition: null },
      ],
      task_bindings: [
        { activity_id: 'Activity-submit', main_task_id: 'Task-submit', confirmation_task_id: null },
      ],
      layout_version: '2.0.0',
    },
    questions: [],
    provenance: {},
    source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
  };
}

// ── 工具函数 ──

function oracle(findings) {
  return findings.map(f => `${f.rule_id}:${f.target_refs[0]}`).sort();
}

function assertValidFindingSet(findings, msg) {
  const wrapped = { schema_version: '1.0.0', findings };
  const valid = validateFindingSet(wrapped);
  if (!valid) {
    const errors = validateFindingSet.errors.map(e => `${e.instancePath} ${e.message}`).join('\n');
    assert.fail(`${msg} - finding-set Schema 无效:\n${errors}\n${JSON.stringify(findings, null, 2)}`);
  }
}

function assertNoTargetRef(findings, msg) {
  for (const f of findings) {
    assert.equal(f.target_ref, undefined, `${msg} - finding 不应有 target_ref 额外属性`);
  }
}

/** 仅 JSON Schema 合法（不含引用一致性） */
function assertSchemaValid(draft, msg) {
  const valid = validateDraftSchema(draft);
  if (!valid) {
    const errors = validateDraftSchema.errors.map(e => `${e.instancePath} ${e.message}`).join('\n');
    assert.fail(`${msg} - process-draft Schema 无效:\n${errors}`);
  }
}

/** JSON Schema 合法 + 引用一致性 */
async function assertFullyValid(draft, msg) {
  assertSchemaValid(draft, msg);
  const result = await validateProcessDraft(draft);
  assert.deepEqual(result, { valid: true }, `${msg} - validateProcessDraft 失败: ${JSON.stringify(result)}`);
}


// ══════════════════════════════════════════════════════════════
// 测试
// ══════════════════════════════════════════════════════════════

describe('reviewActivityBpmn V2 合同', () => {

  // ── 基础合同验证 ──

  describe('基础合同', () => {
    it('合法 V2 fixture 通过 assertFullyValid', async () => {
      const draft = makeValidDraft();
      await assertFullyValid(draft, '合法 fixture');
    });

    it('合法 fixture 调用审查器后为精确空数组', async () => {
      const draft = makeValidDraft();
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(findings, [], `合法 fixture 应零 finding，实际 ${findings.length}`);
      assertValidFindingSet(findings, '合法 fixture');
      assertNoTargetRef(findings, '合法 fixture');
    });

    it('不修改输入，相同输入重复运行深度相等', async () => {
      const draft = makeValidDraft();
      const frozen = structuredClone(draft);
      const findings1 = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const findings2 = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(draft, frozen, '审查器不应修改输入');
      assert.deepEqual(findings1, findings2, '相同输入应产生深度相等结果');
    });
  });

  // ── FA-ACT-BPMN-001: 泳道不得使用个人姓名 ──

  describe('FA-ACT-BPMN-001', () => {
    it('含 person_ 前缀的个人标识应触发 001', async () => {
      const draft = makeValidDraft();
      draft.diagram.lanes[0].name = '张三';
      draft.diagram.lanes[0].role_id = 'person_zhangsan';
      draft.activities[0].role_assignments = [
        { role_id: 'person_zhangsan', responsibility: 'R' },
        { role_id: 'Role-approver', responsibility: 'A' },
        { role_id: 'Role-purchaser', responsibility: 'S' },
      ];
      assertSchemaValid(draft, '001 个人标识');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-001:Lane-requester']);
      assertValidFindingSet(findings, '001 个人标识');
      assertNoTargetRef(findings, '001');
    });

    it('合法角色名不触发 001', async () => {
      const draft = makeValidDraft();
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [], '合法角色不应产生 finding');
    });

    it('Role-demand/需求方不应触发 001', async () => {
      const draft = makeValidDraft();
      draft.diagram.lanes[0].name = '需求方';
      draft.diagram.lanes[0].role_id = 'Role-demand';
      draft.activities[0].role_assignments = [
        { role_id: 'Role-demand', responsibility: 'R' },
        { role_id: 'Role-approver', responsibility: 'A' },
        { role_id: 'Role-purchaser', responsibility: 'S' },
      ];
      assertSchemaValid(draft, 'Role-demand/需求方');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [], 'Role-demand/需求方不应产生 finding');
      assertValidFindingSet(findings, 'Role-demand/需求方');
    });
  });

  // ── FA-ACT-BPMN-002: 活动—主 Task 三方一致 ──

  describe('FA-ACT-BPMN-002', () => {
    it('活动无 binding 应触发 002', async () => {
      const draft = makeValidDraft();
      draft.diagram.task_bindings = [];
      assertSchemaValid(draft, '002 无 binding');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-submit',
      ]);
      assertValidFindingSet(findings, '002 无 binding');
    });

    it('缺少 MAIN_TASK node 应触发 002', async () => {
      const draft = makeValidDraft();
      draft.activities[0].main_task_id = 'Task';
      draft.diagram.task_bindings[0].main_task_id = 'Task';
      draft.diagram.nodes = draft.diagram.nodes.filter(n => n.node_id !== 'Task-submit');
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task', target_ref: 'End-approved', condition: null },
      ];
      assertSchemaValid(draft, '缺少 MAIN_TASK node');
      const pdResult = await validateProcessDraft(draft);
      assert.equal(pdResult.valid, false, '缺少 MAIN_TASK node 应 validateProcessDraft 失败');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-002:Activity-submit'], '缺少 MAIN_TASK node');
      assertValidFindingSet(findings, '缺少 MAIN_TASK node');
    });

    it('两个 binding 应触发 002 和 009', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Task-submit2', node_type: 'MAIN_TASK', name: '另一个主任务', lane_id: 'Lane-requester',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-submit', main_task_id: 'Task-submit2', confirmation_task_id: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-submit2', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-submit2', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      assertSchemaValid(draft, '两个 binding');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-submit2',
        'FA-ACT-BPMN-009:Activity-submit',
      ], '两个 binding');
      assertValidFindingSet(findings, '两个 binding');
    });

    it('三方不一致应触发 002', async () => {
      const draft = makeValidDraft();
      draft.diagram.task_bindings[0].main_task_id = 'Task-wrong';
      assertSchemaValid(draft, '三方不一致');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-submit',
      ], '三方不一致');
      assertValidFindingSet(findings, '三方不一致');
    });
  });

  // ── FA-ACT-BPMN-003: R/O 泳道 ──

  describe('FA-ACT-BPMN-003', () => {
    it('RASCI/R 主 Task 不在 R 泳道应触发 003', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.find(n => n.node_id === 'Task-submit').lane_id = 'Lane-approver';
      assertSchemaValid(draft, '003 RASCI/R 主 Task 不在 R 泳道');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-003:Activity-submit']);
      assertValidFindingSet(findings, '003');
    });

    it('角色无泳道时应触发 003', async () => {
      const draft = makeValidDraft();
      draft.diagram.lanes = [];
      assertSchemaValid(draft, '003 角色无泳道');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-003:Activity-submit'], '角色无泳道');
      assertValidFindingSet(findings, '角色无泳道');
    });
  });

  // ── FA-ACT-BPMN-004: 确认从 Task ──

  describe('FA-ACT-BPMN-004', () => {
    it('三条件不全应触发 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: false,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-confirm', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      await assertFullyValid(draft, '004 三条件不全');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 三条件不全');
      assertValidFindingSet(findings, '004 三条件不全');
    });

    it('确认角色等于主责角色应触发 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-requester',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-confirm', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      await assertFullyValid(draft, '004 确认角色等于主责');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-004:Activity-submit',
      ], '004 确认角色等于主责');
      assertValidFindingSet(findings, '004 确认角色等于主责');
    });

    it('activity.confirmation 非空但 binding.confirmation_task_id 为空: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      // binding.confirmation_task_id 保持 null
      assertSchemaValid(draft, '004 confirmation 非空但 binding 为空');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 confirmation 非空但 binding 为空');
      assertValidFindingSet(findings, '004 confirmation 非空但 binding 为空');
    });

    it('binding ID 存在但节点不存在: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      // 不添加 Task-confirm 节点
      assertSchemaValid(draft, '004 binding ID 存在但节点不存在');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 binding ID 存在但节点不存在');
      assertValidFindingSet(findings, '004 binding ID 存在但节点不存在');
    });

    it('节点存在但 node_type 不是 CONFIRMATION_TASK: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'MAIN_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      await assertFullyValid(draft, '004 节点类型错误');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Task-confirm',
        'FA-ACT-BPMN-004:Activity-submit',
      ], '004 节点类型错误');
      assertValidFindingSet(findings, '004 节点类型错误');
    });

    it('activity/binding/节点三方不一致: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Conf-A',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Conf-B';
      draft.diagram.nodes.push({
        node_id: 'Conf-B', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Conf-B', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Conf-B', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      await assertFullyValid(draft, '004 三方不一致');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 三方不一致');
      assertValidFindingSet(findings, '004 三方不一致');
    });

    it('缺少直接 MAIN_TASK -> CONFIRMATION_TASK flow: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      // flows 从 Task-submit 直接到 End-approved，没有 MAIN_TASK -> CONFIRMATION_TASK
      await assertFullyValid(draft, '004 缺少 MAIN->CONFIRM flow');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-004:Activity-submit',
      ], '004 缺少 MAIN->CONFIRM flow');
      assertValidFindingSet(findings, '004 缺少 MAIN->CONFIRM flow');
    });

    it('confirmation Task 没有后续 flow: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      // 有 MAIN_TASK -> CONFIRMATION_TASK flow
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      // 删除直接 Task-submit -> End-approved 的 flow，但不添加 Task-confirm 后续
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      assertSchemaValid(draft, '004 确认 Task 无后续 flow');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 确认 Task 无后续 flow');
      assertValidFindingSet(findings, '004 确认 Task 无后续 flow');
    });

    it('activity.confirmation 为 null 但 binding.confirmation_task_id 非空: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = null;
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-confirm', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      assertSchemaValid(draft, '004 confirmation null 但 binding 非空');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 confirmation null 但 binding 非空');
      assertValidFindingSet(findings, '004 confirmation null 但 binding 非空');
    });

    it('activity.confirmation 为 null 但存在 CONFIRMATION_TASK 残留: 004', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = null;
      // 不修改 binding（confirmation_task_id 仍为 null），但图中有 CONFIRMATION_TASK
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      await assertFullyValid(draft, '004 confirmation null 但节点残留');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-004:Activity-submit'], '004 confirmation null 但节点残留');
      assertValidFindingSet(findings, '004 confirmation null 但节点残留');
    });

    it('多活动残留归属：只能报告有直接前驱的活动', async () => {
      const draft = makeValidDraft();
      // 添加第二个活动 Activity-review
      draft.activities.push({
        activity_id: 'Activity-review',
        name: '审核申请',
        description: '审核采购申请',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [
          { role_id: 'Role-approver', responsibility: 'R' },
        ],
        tools: [],
        inputs: ['已提交的采购申请'],
        process_summary: '审核采购申请',
        outputs: ['审核结果'],
        completion_criteria: ['审核完成'],
        references: [],
        main_task_id: 'Task-review',
        confirmation: null,
        completeness: 'COMPLETE',
      });
      draft.diagram.nodes.push({
        node_id: 'Task-review', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-approver',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-review', main_task_id: 'Task-review', confirmation_task_id: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-review', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-review', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');

      // 添加一个未绑定的 CONFIRMATION_TASK，直接前驱是 Task-review（Activity-review 的主 Task）
      draft.diagram.nodes.push({
        node_id: 'Task-confirm-review', node_type: 'CONFIRMATION_TASK', name: '确认审核', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-5', source_ref: 'Task-review', target_ref: 'Task-confirm-review', condition: null,
      });

      assertSchemaValid(draft, '多活动残留归属');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      // 只能报告 Activity-review（因为 Task-confirm-review 的直接前驱是 Task-review）
      // 不能报告 Activity-submit（因为没有直接前驱关联）
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-004:Activity-review',
      ], '多活动残留归属');
      assertValidFindingSet(findings, '多活动残留归属');
    });
  });

  // ── FA-ACT-BPMN-005: 正式审批不得作为确认从 Task ──

  describe('FA-ACT-BPMN-005', () => {
    it('REVIEW_MEETING 有 confirmation 应触发 005', async () => {
      const draft = makeValidDraft();
      draft.activities[0].activity_type = 'REVIEW_MEETING';
      draft.activities[0].responsibility_model = 'OARP';
      draft.activities[0].role_assignments = [
        { role_id: 'Role-approver', responsibility: 'O' },
        { role_id: 'Role-requester', responsibility: 'A' },
      ];
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-requester',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      assertSchemaValid(draft, '005 REVIEW_MEETING');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-003:Activity-submit',
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-005:Activity-submit',
      ], '005');
      assertValidFindingSet(findings, '005');
    });
  });

  // ── FA-ACT-BPMN-006: XOR/OR 必须有条件 ──

  describe('FA-ACT-BPMN-006', () => {
    it('GATEWAY_XOR 无条件出向流应触发 006', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '审批分支', lane_id: 'Lane-approver',
      });
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-submit', target_ref: 'Gw-xor', condition: null },
        { flow_id: 'Flow-3', source_ref: 'Gw-xor', target_ref: 'End-approved', condition: null },
        { flow_id: 'Flow-4', source_ref: 'Gw-xor', target_ref: 'End-approved', condition: null },
      ];
      assertSchemaValid(draft, '006 XOR 无条件');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-006:Gw-xor']);
      assertValidFindingSet(findings, '006');
    });

    it('GATEWAY_XOR 所有出向流有 condition 时不触发 006', async () => {
      const draft = makeValidDraft();
      draft.activities.push({
        activity_id: 'Activity-review',
        name: '审核申请',
        description: '审核采购申请',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [
          { role_id: 'Role-approver', responsibility: 'R' },
        ],
        tools: [],
        inputs: ['已提交的采购申请'],
        process_summary: '审核采购申请',
        outputs: ['审核结果'],
        completion_criteria: ['审核完成'],
        references: [],
        main_task_id: 'Task-review',
        confirmation: null,
        completeness: 'COMPLETE',
      });
      draft.diagram.nodes.push({
        node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '审批分支', lane_id: 'Lane-approver',
      });
      draft.diagram.nodes.push({
        node_id: 'Task-review', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-approver',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-review', main_task_id: 'Task-review', confirmation_task_id: null,
      });
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-submit', target_ref: 'Gw-xor', condition: null },
        { flow_id: 'Flow-3', source_ref: 'Gw-xor', target_ref: 'Task-review', condition: { label: '通过', source_output: '结论', operator: 'EQUALS', value: '通过' } },
        { flow_id: 'Flow-4', source_ref: 'Gw-xor', target_ref: 'End-approved', condition: { label: '驳回', source_output: '结论', operator: 'EQUALS', value: '驳回' } },
        { flow_id: 'Flow-5', source_ref: 'Task-review', target_ref: 'End-approved', condition: null },
      ];
      await assertFullyValid(draft, '006 XOR 全有条件');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [], 'XOR 全有条件时不应触发 006');
    });
  });

  // ── FA-ACT-BPMN-007: 结束事件与卡片终点一致 ──

  describe('FA-ACT-BPMN-007', () => {
    it('结束事件不在 end_results 中应触发 007', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'End-extra', node_type: 'END_EVENT', name: '异常结束', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'End-extra', condition: null,
      });
      await assertFullyValid(draft, '007 结束事件不在 end_results');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-007:End-extra'], '007 结束事件不在 end_results');
      assertValidFindingSet(findings, '007 结束事件不在 end_results');
    });

    it('end_results 有但图中没有结束事件应触发 007', async () => {
      const draft = makeValidDraft();
      draft.process_card.end_results.push({ event_id: 'End-rejected', name: '采购申请被驳回' });
      await assertFullyValid(draft, '007 图中缺少结束事件');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-007:End-rejected'], '007 图中缺少结束事件');
      assertValidFindingSet(findings, '007 图中缺少结束事件');
    });

    it('同一 event_id 下 name 不一致应触发 007', async () => {
      const draft = makeValidDraft();
      // end_results name 与 END_EVENT name 不同
      draft.process_card.end_results[0].name = '采购申请审批完成';
      await assertFullyValid(draft, '007 name 不一致');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-007:End-approved']);
      assertValidFindingSet(findings, '007 name 不一致');
    });
  });

  // ── FA-ACT-BPMN-008: Link Catch/Throw 成对 ──

  describe('FA-ACT-BPMN-008', () => {
    it('INTERMEDIATE_LINK_THROW 无配对应触发 008', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Link-throw', node_type: 'INTERMEDIATE_LINK_THROW', name: '跳转A', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Link-throw', condition: null,
      });
      assertSchemaValid(draft, '008 LINK_THROW 无配对');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-008:Link-throw']);
      assertValidFindingSet(findings, '008');
    });

    it('同名 Throw-Catch 成对且有正确 flow 时不触发 008', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Link-throw', node_type: 'INTERMEDIATE_LINK_THROW', name: '跳转A', lane_id: 'Lane-requester',
      });
      draft.diagram.nodes.push({
        node_id: 'Link-catch', node_type: 'INTERMEDIATE_LINK_CATCH', name: '跳转A', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Link-throw', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Link-throw', target_ref: 'Link-catch', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-5', source_ref: 'Link-catch', target_ref: 'End-approved', condition: null,
      });
      assertSchemaValid(draft, '008 成对 Link');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [], '成对 Link 且有正确 flow 不应触发 008');
    });

    it('Catch -> Throw 应触发 008', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Link-throw', node_type: 'INTERMEDIATE_LINK_THROW', name: '跳转A', lane_id: 'Lane-requester',
      });
      draft.diagram.nodes.push({
        node_id: 'Link-catch', node_type: 'INTERMEDIATE_LINK_CATCH', name: '跳转A', lane_id: 'Lane-requester',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Link-catch', target_ref: 'Link-throw', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-submit', target_ref: 'Link-catch', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-5', source_ref: 'Link-throw', target_ref: 'End-approved', condition: null,
      });
      assertSchemaValid(draft, '008 Catch -> Throw');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-008:Link-throw'], 'Catch -> Throw');
      assertValidFindingSet(findings, 'Catch -> Throw');
    });
  });

  // ── FA-ACT-BPMN-009: 一主一从串行与 AND 并行 ──

  describe('FA-ACT-BPMN-009', () => {
    it('同一 activity 多个主 Task 应触发 009', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Task-extra', node_type: 'MAIN_TASK', name: '并行任务', lane_id: 'Lane-requester',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-submit', main_task_id: 'Task-extra', confirmation_task_id: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-extra', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-extra', target_ref: 'End-approved', condition: null,
      });
      assertSchemaValid(draft, '009 多个主 Task');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-extra',
        'FA-ACT-BPMN-009:Activity-submit',
      ], '多个主 Task');
      assertValidFindingSet(findings, '多个主 Task');
    });

    it('一个 activity 最多一个 CONFIRMATION_TASK', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      // 添加两个 CONFIRMATION_TASK
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认A', lane_id: 'Lane-approver',
      });
      draft.diagram.nodes.push({
        node_id: 'Task-confirm2', node_type: 'CONFIRMATION_TASK', name: '确认B', lane_id: 'Lane-approver',
      });
      // 绑定第二个 CONFIRMATION_TASK（通过 activity_id 关联）
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-submit', main_task_id: 'Task-submit', confirmation_task_id: 'Task-confirm2',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-confirm', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      assertSchemaValid(draft, '009 多个 confirmation');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-submit',
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-009:Activity-submit',
      ], '多个 confirmation');
      assertValidFindingSet(findings, '多个 confirmation');
    });

    it('GATEWAY_AND 将主 Task 与确认 Task 并行: 009', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm';
      draft.diagram.nodes.push({
        node_id: 'Task-confirm', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'Lane-approver',
      });
      draft.diagram.nodes.push({
        node_id: 'Gw-and-split', node_type: 'GATEWAY_AND', name: '并行拆分', lane_id: 'Lane-requester',
      });
      draft.diagram.nodes.push({
        node_id: 'Gw-and-join', node_type: 'GATEWAY_AND', name: '并行汇合', lane_id: 'Lane-requester',
      });
      // 并行: split -> Task-submit 和 split -> Task-confirm
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Gw-and-split', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Gw-and-split', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-3', source_ref: 'Gw-and-split', target_ref: 'Task-confirm', condition: null },
        { flow_id: 'Flow-4', source_ref: 'Task-submit', target_ref: 'Gw-and-join', condition: null },
        { flow_id: 'Flow-5', source_ref: 'Task-confirm', target_ref: 'Gw-and-join', condition: null },
        { flow_id: 'Flow-6', source_ref: 'Gw-and-join', target_ref: 'End-approved', condition: null },
      ];
      assertSchemaValid(draft, '009 AND 并行');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-009:Activity-submit',
      ], 'AND 并行');
      assertValidFindingSet(findings, 'AND 并行');
    });

    it('一个 binding confirmation + 一个从同一主 Task 直连的额外 confirmation node', async () => {
      const draft = makeValidDraft();
      draft.activities[0].confirmation = {
        confirmation_task_id: 'Task-confirm-binding',
        confirm_role_id: 'Role-approver',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'Task-confirm-binding';
      // 添加 binding 指定的 CONFIRMATION_TASK
      draft.diagram.nodes.push({
        node_id: 'Task-confirm-binding', node_type: 'CONFIRMATION_TASK', name: '确认A', lane_id: 'Lane-approver',
      });
      // 添加从同一主 Task 直连的额外 CONFIRMATION_TASK（未绑定）
      draft.diagram.nodes.push({
        node_id: 'Task-confirm-extra', node_type: 'CONFIRMATION_TASK', name: '确认B', lane_id: 'Lane-approver',
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Task-submit', target_ref: 'Task-confirm-binding', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-submit', target_ref: 'Task-confirm-extra', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-5', source_ref: 'Task-confirm-binding', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows.push({
        flow_id: 'Flow-6', source_ref: 'Task-confirm-extra', target_ref: 'End-approved', condition: null,
      });
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      assertSchemaValid(draft, '009 一个 binding confirmation + 一个直连额外 confirmation');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      // 应该触发 009（多个确认 Task），以及 004（额外 CONFIRMATION_TASK 残留）
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-004:Activity-submit',
        'FA-ACT-BPMN-009:Activity-submit',
      ], '一个 binding confirmation + 一个直连额外 confirmation');
      assertValidFindingSet(findings, '一个 binding confirmation + 一个直连额外 confirmation');
    });
  });
});

// ── Stage 判定合同 (Repair C) ──

describe('evaluateActivityBpmnStage', () => {
  it('完整输入 -> SUCCEEDED', async () => {
    const draft = makeValidDraft();
    const result = evaluateActivityBpmnStage({
      processCard: draft.process_card,
      activities: draft.activities,
      diagramModel: draft.diagram,
    });
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(result.missing, []);
    assert.ok(Array.isArray(result.findings));
  });

  it('缺少 activities -> NEEDS_INPUT', () => {
    const draft = makeValidDraft();
    const result = evaluateActivityBpmnStage({
      processCard: draft.process_card,
      activities: null,
      diagramModel: draft.diagram,
    });
    assert.equal(result.status, 'NEEDS_INPUT');
    assert.deepEqual(result.missing, ['activities']);
    assert.deepEqual(result.findings, []);
  });

  it('空 activities -> NEEDS_INPUT', () => {
    const draft = makeValidDraft();
    const result = evaluateActivityBpmnStage({
      processCard: draft.process_card,
      activities: [],
      diagramModel: draft.diagram,
    });
    assert.equal(result.status, 'NEEDS_INPUT');
    assert.deepEqual(result.missing, ['activities']);
    assert.deepEqual(result.findings, []);
  });

  it('缺少 processCard -> NEEDS_INPUT', () => {
    const draft = makeValidDraft();
    const result = evaluateActivityBpmnStage({
      processCard: null,
      activities: draft.activities,
      diagramModel: draft.diagram,
    });
    assert.equal(result.status, 'NEEDS_INPUT');
    assert.deepEqual(result.missing, ['process_card']);
    assert.deepEqual(result.findings, []);
  });

  it('缺少 diagramModel -> NEEDS_INPUT', () => {
    const draft = makeValidDraft();
    const result = evaluateActivityBpmnStage({
      processCard: draft.process_card,
      activities: draft.activities,
      diagramModel: null,
    });
    assert.equal(result.status, 'NEEDS_INPUT');
    assert.deepEqual(result.missing, ['diagram_model']);
    assert.deepEqual(result.findings, []);
  });

  it('完整输入有 finding -> SUCCEEDED with findings', async () => {
    const draft = makeValidDraft();
    draft.diagram.lanes[0].name = '张三';
    draft.diagram.lanes[0].role_id = 'Role-zhangsan';
    const result = evaluateActivityBpmnStage({
      processCard: draft.process_card,
      activities: draft.activities,
      diagramModel: draft.diagram,
    });
    assert.equal(result.status, 'SUCCEEDED');
    assert.deepEqual(oracle(result.findings), ['FA-ACT-BPMN-003:Activity-submit'], 'stage with findings');
    assertValidFindingSet(result.findings, 'stage with findings');
  });
});

// ── Skill/Worker 禁词测试 ──

describe('Skill/Worker 禁词测试', () => {
  const skillPath = join(__dirname, '..', 'skills', 'flow-architect-review-activity-bpmn', 'SKILL.md');
  const workerPath = join(__dirname, '..', 'agents', 'flow-architect-review-activity-bpmn-worker.md');

  it('Skill 文件不应包含 NEEDS_INPUT finding', async () => {
    const content = await readFile(skillPath, 'utf8');
    assert.ok(!content.includes('NEEDS_INPUT finding'), 'Skill 文件不应包含 "NEEDS_INPUT finding"');
    assert.ok(!content.includes('NEEDS_INPUT rule_id'), 'Skill 文件不应包含 "NEEDS_INPUT rule_id"');
  });

  it('Worker 文件不应包含 NEEDS_INPUT finding', async () => {
    const content = await readFile(workerPath, 'utf8');
    assert.ok(!content.includes('NEEDS_INPUT finding'), 'Worker 文件不应包含 "NEEDS_INPUT finding"');
    assert.ok(!content.includes('NEEDS_INPUT rule_id'), 'Worker 文件不应包含 "NEEDS_INPUT rule_id"');
  });

  it('Skill 文件不应包含 BPMN_LANE locator_type', async () => {
    const content = await readFile(skillPath, 'utf8');
    assert.ok(!content.includes('BPMN_LANE'), 'Skill 文件不应包含 "BPMN_LANE" locator_type');
  });

  it('Worker 文件不应包含 BPMN_LANE locator_type', async () => {
    const content = await readFile(workerPath, 'utf8');
    assert.ok(!content.includes('BPMN_LANE'), 'Worker 文件不应包含 "BPMN_LANE" locator_type');
  });

  it('Skill 文件不应包含单数 target_ref', async () => {
    const content = await readFile(skillPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('target_ref') && !line.includes('target_refs')) {
        assert.fail(`Skill 文件包含单数 "target_ref": ${line.trim()}`);
      }
    }
  });

  it('Worker 文件不应包含单数 target_ref', async () => {
    const content = await readFile(workerPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('target_ref') && !line.includes('target_refs')) {
        assert.fail(`Worker 文件包含单数 "target_ref": ${line.trim()}`);
      }
    }
  });
});

// ── 静态扫描：测试源码不应包含弱断言 ──

describe('测试源码静态扫描', () => {
  it('测试源码不应包含弱断言模式', async () => {
    const testSource = await readFile(
      join(__dirname, 'activity-bpmn-review.test.mjs'), 'utf8'
    );
    const weakPatterns = [
      /length\s*>=\s*1/,
      /length\s*>\s*0/,
      /assert\.ok\(\s*\w+\.length\s*[><=]/,
    ];
    // 排除静态扫描 describe 块自身的行（含 "弱断言" 或 "weakPatterns" 关键词）
    const scanBlockPattern = /弱断言|weakPatterns|弱断言模式/;
    const violations = [];
    const lines = testSource.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (scanBlockPattern.test(lines[i])) continue;
      for (const pattern of weakPatterns) {
        if (pattern.test(lines[i])) {
          violations.push(`行 ${i + 1}: ${lines[i].trim()}`);
        }
      }
    }
    assert.deepEqual(violations, [], `测试源码包含弱断言:\n${violations.join('\n')}`);
  });
});
