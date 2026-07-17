import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { reviewActivityBpmn } from '../scripts/review-activity-bpmn.mjs';
import { evaluateActivityBpmnStage } from '../scripts/review-activity-bpmn.mjs';
import { validateProcessDraft } from '../scripts/lib/process-draft-contract.mjs';
import { readFile as readFileAsync } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', 'references', 'schemas');

// ── finding-set Schema 验证器 ──
let validateFindingSet;
before(async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const findingSetSchema = JSON.parse(
    await readFile(join(schemasDir, 'finding-set.schema.json'), 'utf8')
  );
  validateFindingSet = ajv.compile(findingSetSchema);
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

// ══════════════════════════════════════════════════════════════
// 测试
// ══════════════════════════════════════════════════════════════

describe('reviewActivityBpmn V2 合同', () => {

  // ── 基础合同验证 ──

  describe('基础合同', () => {
    it('合法 V2 fixture 通过 validateProcessDraft', async () => {
      const draft = makeValidDraft();
      const result = await validateProcessDraft(draft);
      assert.deepEqual(result, { valid: true }, `合法 fixture Schema 无效: ${JSON.stringify(result)}`);
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
      // 使用 person_ 前缀的个人标识
      draft.diagram.lanes[0].name = '张三';
      draft.diagram.lanes[0].role_id = 'person_zhangsan';
      // 同步活动 R 角色避免 003 干扰
      draft.activities[0].role_assignments = [
        { role_id: 'person_zhangsan', responsibility: 'R' },
        { role_id: 'Role-approver', responsibility: 'A' },
        { role_id: 'Role-purchaser', responsibility: 'S' },
      ];
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-001:Lane-requester']);
      assertValidFindingSet(findings, '001 个人标识');
      assertNoTargetRef(findings, '001');
    });

    it('合法角色名如"经办人、审核人、采购员"不触发 001', async () => {
      const draft = makeValidDraft();
      // 所有泳道都是合法角色名，不应触发
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f001 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-001');
      assert.equal(f001.length, 0, `合法角色不应误报 001: ${JSON.stringify(oracle(f001))}`);
    });

    it('含 person_ 前缀的个人标识应触发 001', async () => {
      const draft = makeValidDraft();
      draft.diagram.lanes[0].name = '李四';
      draft.diagram.lanes[0].role_id = 'person_lisi';
      // 同步活动 R 角色避免 003 干扰
      draft.activities[0].role_assignments = [
        { role_id: 'person_lisi', responsibility: 'R' },
        { role_id: 'Role-approver', responsibility: 'A' },
        { role_id: 'Role-purchaser', responsibility: 'S' },
      ];
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.deepEqual(oracle(findings), ['FA-ACT-BPMN-001:Lane-requester']);
    });
  });

  // ── FA-ACT-BPMN-002: 活动—主 Task 三方一致 ──

  describe('FA-ACT-BPMN-002', () => {
    it('活动无主 Task 应触发 002', async () => {
      const draft = makeValidDraft();
      // 保留 MAIN_TASK 节点但移除 binding，使活动"无 binding"
      draft.diagram.task_bindings = [];
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      // 活动无 binding + MAIN_TASK 节点未被引用 = 两条 002
      assert.deepEqual(oracle(findings), [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-submit',
      ]);
      assertValidFindingSet(findings, '002 无主 Task');
    });

    it('两个 binding 应触发 002', async () => {
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
      // Remove original Flow-2
      draft.diagram.flows = draft.diagram.flows.filter(f => f.flow_id !== 'Flow-2');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f002 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-002');
      assert.ok(f002.length >= 1, `Expected 002: ${JSON.stringify(oracle(findings))}`);
    });

    it('三方不一致应触发 002', async () => {
      const draft = makeValidDraft();
      draft.diagram.task_bindings[0].main_task_id = 'Task-wrong';
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f002 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-002');
      assert.ok(f002.length >= 1, `Expected 002: ${JSON.stringify(oracle(findings))}`);
    });
  });

  // ── FA-ACT-BPMN-003: R/O 泳道 ──

  describe('FA-ACT-BPMN-003', () => {
    it('RASCI/R 主 Task 不在 R 泳道应触发 003', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.find(n => n.node_id === 'Task-submit').lane_id = 'Lane-approver';
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
      draft.diagram.lanes = []; // 删除所有泳道
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f003 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-003');
      assert.ok(f003.length >= 1, `Expected 003 for missing lane: ${JSON.stringify(oracle(findings))}`);
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f004 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-004');
      assert.ok(f004.length >= 1, `Expected 004: ${JSON.stringify(oracle(findings))}`);
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f004 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-004');
      assert.ok(f004.length >= 1, `Expected 004: ${JSON.stringify(oracle(findings))}`);
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f005 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-005');
      assert.ok(f005.length >= 1, `Expected 005: ${JSON.stringify(oracle(findings))}`);
    });
  });

  // ── FA-ACT-BPMN-006: XOR/OR 必须有条件 ──

  describe('FA-ACT-BPMN-006', () => {
    it('GATEWAY_XOR 无条件出向流应触发 006', async () => {
      const draft = makeValidDraft();
      // 插入 XOR 网关在 Task-submit 和 End-approved 之间
      draft.diagram.nodes.push({
        node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '审批分支', lane_id: 'Lane-approver',
      });
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-submit', target_ref: 'Gw-xor', condition: null },
        // 两条无条件出向流
        { flow_id: 'Flow-3', source_ref: 'Gw-xor', target_ref: 'End-approved', condition: null },
        { flow_id: 'Flow-4', source_ref: 'Gw-xor', target_ref: 'End-approved', condition: null },
      ];
      // 只保留一条从 Task-submit 出发的流（移除直接到 End 的）
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
      draft.diagram.nodes.push({
        node_id: 'Gw-xor', node_type: 'GATEWAY_XOR', name: '审批分支', lane_id: 'Lane-approver',
      });
      draft.diagram.nodes.push({
        node_id: 'Task-review', node_type: 'MAIN_TASK', name: '审核申请', lane_id: 'Lane-approver',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-submit', main_task_id: 'Task-review', confirmation_task_id: null,
      });
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-submit', target_ref: 'Gw-xor', condition: null },
        { flow_id: 'Flow-3', source_ref: 'Gw-xor', target_ref: 'Task-review', condition: { label: '审批结论为通过', source_output: '审批结论', operator: 'EQUALS', value: '通过' } },
        { flow_id: 'Flow-4', source_ref: 'Gw-xor', target_ref: 'End-approved', condition: { label: '审批结论为驳回', source_output: '审批结论', operator: 'EQUALS', value: '驳回' } },
        { flow_id: 'Flow-5', source_ref: 'Task-review', target_ref: 'End-approved', condition: null },
      ];
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f006 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-006');
      assert.equal(f006.length, 0, `XOR 全有条件时不应触发 006: ${JSON.stringify(oracle(findings))}`);
    });

    it('GATEWAY_AND 不检查条件，不触发 006', async () => {
      const draft = makeValidDraft();
      draft.diagram.nodes.push({
        node_id: 'Gw-and', node_type: 'GATEWAY_AND', name: '并行拆分', lane_id: 'Lane-requester',
      });
      draft.diagram.nodes.push({
        node_id: 'Gw-join', node_type: 'GATEWAY_AND', name: '并行汇合', lane_id: 'Lane-requester',
      });
      draft.diagram.nodes.push({
        node_id: 'Task-extra', node_type: 'MAIN_TASK', name: '额外任务', lane_id: 'Lane-requester',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-submit', main_task_id: 'Task-extra', confirmation_task_id: null,
      });
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task-submit', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task-submit', target_ref: 'Gw-and', condition: null },
        { flow_id: 'Flow-3', source_ref: 'Gw-and', target_ref: 'Task-extra', condition: null },
        { flow_id: 'Flow-4', source_ref: 'Gw-and', target_ref: 'End-approved', condition: null },
        { flow_id: 'Flow-5', source_ref: 'Task-extra', target_ref: 'Gw-join', condition: null },
        { flow_id: 'Flow-6', source_ref: 'End-approved', target_ref: 'Gw-join', condition: null },
      ];
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f006 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-006');
      assert.equal(f006.length, 0, `AND 不检查条件: ${JSON.stringify(oracle(findings))}`);
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f007 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-007');
      assert.ok(f007.length >= 1, `Expected 007: ${JSON.stringify(oracle(findings))}`);
      assertValidFindingSet(findings, '007');
    });

    it('end_results 有但图中没有结束事件应触发 007', async () => {
      const draft = makeValidDraft();
      draft.process_card.end_results.push({ event_id: 'End-rejected', name: '采购申请被驳回' });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f007 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-007');
      assert.ok(f007.length >= 1, `Expected 007 for missing end event: ${JSON.stringify(oracle(findings))}`);
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f008 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-008');
      assert.equal(f008.length, 0, `成对 Link 且有正确 flow 不应触发 008: ${JSON.stringify(oracle(findings))}`);
    });
  });

  // ── FA-ACT-BPMN-009: 同一 L5 不得映射并行主 Task ──

  describe('FA-ACT-BPMN-009', () => {
    it('同一 L5 并行 Task 应触发 009', async () => {
      const draft = makeValidDraft();
      // 给同一活动增加第二个 binding（模拟并行 Task）
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      // 应同时触发 002（多个 binding + 反向检查）和 009（多个主 Task）
      const expected = [
        'FA-ACT-BPMN-002:Activity-submit',
        'FA-ACT-BPMN-002:Task-extra',
        'FA-ACT-BPMN-009:Activity-submit',
      ];
      assert.deepEqual(oracle(findings), expected);
      assertValidFindingSet(findings, '009');
    });
  });

  // ── Fresh review 反例（当前提交的四个确定性失败） ──

  describe('Fresh review 反例', () => {
    it('Role-demand/需求方不应触发 001', async () => {
      const draft = makeValidDraft();
      draft.diagram.lanes[0].name = '需求方';
      draft.diagram.lanes[0].role_id = 'Role-demand';
      draft.activities[0].role_assignments = [
        { role_id: 'Role-demand', responsibility: 'R' },
        { role_id: 'Role-approver', responsibility: 'A' },
        { role_id: 'Role-purchaser', responsibility: 'S' },
      ];
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f001 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-001');
      assert.equal(f001.length, 0, `Role-demand/需求方不应触发 001: ${JSON.stringify(oracle(f001))}`);
      assertValidFindingSet(findings, 'Role-demand/需求方');
    });

    it('缺少 MAIN_TASK node 应触发 002', async () => {
      const draft = makeValidDraft();
      // activity.main_task_id 与 binding.main_task_id 都为 'Task'，但 nodes 中不存在 'Task'
      draft.activities[0].main_task_id = 'Task';
      draft.diagram.task_bindings[0].main_task_id = 'Task';
      // 删除原有的 Task-submit 节点
      draft.diagram.nodes = draft.diagram.nodes.filter(n => n.node_id !== 'Task-submit');
      // 更新 flows 以避免悬空引用
      draft.diagram.flows = [
        { flow_id: 'Flow-1', source_ref: 'Start-request', target_ref: 'Task', condition: null },
        { flow_id: 'Flow-2', source_ref: 'Task', target_ref: 'End-approved', condition: null },
      ];
      // 注意：此反例故意破坏基本引用，因此只断言 Schema valid，不调用 validateProcessDraft
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f002 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-002');
      assert.ok(f002.length >= 1, `缺少 MAIN_TASK node 应触发 002: ${JSON.stringify(oracle(findings))}`);
      assertValidFindingSet(findings, '缺少 MAIN_TASK node');
    });

    it('Conf-A vs Conf-B 应触发 004', async () => {
      const draft = makeValidDraft();
      // activity.confirmation.confirmation_task_id = 'Conf-A'
      // binding.confirmation_task_id = 'Conf-B'
      // 节点为 'Conf-B'
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
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f004 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-004');
      assert.ok(f004.length >= 1, `Conf-A vs Conf-B 应触发 004: ${JSON.stringify(oracle(findings))}`);
      assertValidFindingSet(findings, 'Conf-A vs Conf-B');
    });

    it('Catch -> Throw 应触发 008', async () => {
      const draft = makeValidDraft();
      // 同名 Link Throw/Catch 存在，但 flow 为 Catch -> Throw
      draft.diagram.nodes.push({
        node_id: 'Link-throw', node_type: 'INTERMEDIATE_LINK_THROW', name: '跳转A', lane_id: 'Lane-requester',
      });
      draft.diagram.nodes.push({
        node_id: 'Link-catch', node_type: 'INTERMEDIATE_LINK_CATCH', name: '跳转A', lane_id: 'Lane-requester',
      });
      // flow 为 Catch -> Throw（反向）
      draft.diagram.flows.push({
        flow_id: 'Flow-3', source_ref: 'Link-catch', target_ref: 'Link-throw', condition: null,
      });
      // 添加从 Task-submit 到 Link-catch 的流
      draft.diagram.flows.push({
        flow_id: 'Flow-4', source_ref: 'Task-submit', target_ref: 'Link-catch', condition: null,
      });
      // 添加从 Link-throw 到 End-approved 的流
      draft.diagram.flows.push({
        flow_id: 'Flow-5', source_ref: 'Link-throw', target_ref: 'End-approved', condition: null,
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f008 = findings.filter(f => f.rule_id === 'FA-ACT-BPMN-008');
      assert.ok(f008.length >= 1, `Catch -> Throw 应触发 008: ${JSON.stringify(oracle(findings))}`);
      assertValidFindingSet(findings, 'Catch -> Throw');
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
    assert.ok(result.findings.length > 0);
    assertValidFindingSet(result.findings, 'stage with findings');
  });
});

// ── Skill/Worker 禁词测试 ──

describe('Skill/Worker 禁词测试', () => {
  const skillPath = join(__dirname, '..', 'skills', 'flow-architect-review-activity-bpmn', 'SKILL.md');
  const workerPath = join(__dirname, '..', 'agents', 'flow-architect-review-activity-bpmn-worker.md');

  it('Skill 文件不应包含 NEEDS_INPUT finding', async () => {
    const content = await readFileAsync(skillPath, 'utf8');
    assert.ok(!content.includes('NEEDS_INPUT finding'), 'Skill 文件不应包含 "NEEDS_INPUT finding"');
    assert.ok(!content.includes('NEEDS_INPUT rule_id'), 'Skill 文件不应包含 "NEEDS_INPUT rule_id"');
  });

  it('Worker 文件不应包含 NEEDS_INPUT finding', async () => {
    const content = await readFileAsync(workerPath, 'utf8');
    assert.ok(!content.includes('NEEDS_INPUT finding'), 'Worker 文件不应包含 "NEEDS_INPUT finding"');
    assert.ok(!content.includes('NEEDS_INPUT rule_id'), 'Worker 文件不应包含 "NEEDS_INPUT rule_id"');
  });

  it('Skill 文件不应包含 BPMN_LANE locator_type', async () => {
    const content = await readFileAsync(skillPath, 'utf8');
    assert.ok(!content.includes('BPMN_LANE'), 'Skill 文件不应包含 "BPMN_LANE" locator_type');
  });

  it('Worker 文件不应包含 BPMN_LANE locator_type', async () => {
    const content = await readFileAsync(workerPath, 'utf8');
    assert.ok(!content.includes('BPMN_LANE'), 'Worker 文件不应包含 "BPMN_LANE" locator_type');
  });

  it('Skill 文件不应包含单数 target_ref', async () => {
    const content = await readFileAsync(skillPath, 'utf8');
    // 检查是否包含 "target_ref" 但不包含 "target_refs"
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('target_ref') && !line.includes('target_refs')) {
        assert.fail(`Skill 文件包含单数 "target_ref": ${line.trim()}`);
      }
    }
  });

  it('Worker 文件不应包含单数 target_ref', async () => {
    const content = await readFileAsync(workerPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('target_ref') && !line.includes('target_refs')) {
        assert.fail(`Worker 文件包含单数 "target_ref": ${line.trim()}`);
      }
    }
  });
});
