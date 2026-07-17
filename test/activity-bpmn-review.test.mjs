import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewActivityBpmn } from '../scripts/review-activity-bpmn.mjs';

/**
 * 活动—BPMN 交叉审查测试
 *
 * 规则 FA-ACT-BPMN-001 ~ 009
 */

// ── 基础 fixture ──

function makeBaseDraft() {
  return {
    process_card: {
      name: '采购流程',
      level: 'L4',
      is_leaf: true,
      parent_process_name: '供应链管理',
      start: { event_id: 'start_1', name: '发起采购' },
      end_results: [{ event_id: 'end_1', name: '采购完成' }],
    },
    activities: [
      {
        activity_id: 'act_1',
        name: '提交采购申请',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [
          { role_id: 'role_requester', responsibility: 'R' },
          { role_id: 'role_approver', responsibility: 'A' },
          { role_id: 'role_purchaser', responsibility: 'S' },
        ],
        main_task_id: 'task_1',
        confirmation: null,
      },
    ],
    diagram: {
      lanes: [
        { lane_id: 'lane_requester', role_id: 'role_requester', name: '申请人' },
        { lane_id: 'lane_approver', role_id: 'role_approver', name: '审批人' },
        { lane_id: 'lane_purchaser', role_id: 'role_purchaser', name: '采购员' },
      ],
      nodes: [
        { node_id: 'start_1', node_type: 'START_EVENT', name: '发起采购', lane_id: 'lane_requester' },
        { node_id: 'task_1', node_type: 'MAIN_TASK', name: '提交采购申请', lane_id: 'lane_requester' },
        { node_id: 'end_1', node_type: 'END_EVENT', name: '采购完成', lane_id: 'lane_requester' },
      ],
      flows: [
        { flow_id: 'f1', type: 'SEQUENCE_FLOW', source_ref: 'start_1', target_ref: 'task_1' },
        { flow_id: 'f2', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'end_1' },
      ],
      task_bindings: [
        { activity_id: 'act_1', main_task_id: 'task_1', confirmation_task_id: null },
      ],
    },
  };
}

function findFinding(findings, ruleId) {
  return findings.filter(f => f.rule_id === ruleId);
}

// ── 测试用例 ──

describe('reviewActivityBpmn', () => {
  describe('FA-ACT-BPMN-001: 泳道不得使用个人姓名', () => {
    it('合法 fixture 应产生零 finding', () => {
      const draft = makeBaseDraft();
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      assert.equal(findings.length, 0, `Expected 0 findings, got ${findings.length}: ${JSON.stringify(findings)}`);
    });

    it('明显个人姓名泳道应触发 001', () => {
      const draft = makeBaseDraft();
      draft.diagram.lanes[0].name = '张三';
      draft.diagram.lanes[0].role_id = 'role_zhangsan';
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-001');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-001, got ${JSON.stringify(findings)}`);
      assert.equal(f[0].target_ref, 'lane_requester');
    });
  });

  describe('FA-ACT-BPMN-002: 每个 L5 活动恰有一个 MAIN_TASK', () => {
    it('活动无主 Task 应触发 002', () => {
      const draft = makeBaseDraft();
      draft.activities[0].main_task_id = null;
      draft.diagram.task_bindings = [];
      draft.diagram.nodes = draft.diagram.nodes.filter(n => n.node_type !== 'MAIN_TASK');
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-002');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-002, got ${JSON.stringify(findings)}`);
      assert.equal(f[0].target_ref, 'act_1');
    });

    it('两个主 Task 应触发 002', () => {
      const draft = makeBaseDraft();
      draft.diagram.nodes.push({
        node_id: 'task_2', node_type: 'MAIN_TASK', name: '另一个主任务', lane_id: 'lane_requester',
      });
      draft.diagram.task_bindings.push({
        activity_id: 'act_1', main_task_id: 'task_2', confirmation_task_id: null,
      });
      draft.diagram.flows.push({
        flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'task_2',
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-002');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-002, got ${JSON.stringify(findings)}`);
    });

    it('binding 三方不一致应触发 002', () => {
      const draft = makeBaseDraft();
      draft.diagram.task_bindings[0].main_task_id = 'task_xxx';
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-002');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-002, got ${JSON.stringify(findings)}`);
    });
  });

  describe('FA-ACT-BPMN-003: 主 Task 泳道与 RASCI/R 或 OARP/O 一致', () => {
    it('RASCI/R 主 Task 不在 R 泳道应触发 003', () => {
      const draft = makeBaseDraft();
      draft.diagram.nodes.find(n => n.node_id === 'task_1').lane_id = 'lane_approver';
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-003');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-003, got ${JSON.stringify(findings)}`);
      assert.equal(f[0].target_ref, 'act_1');
    });
  });

  describe('FA-ACT-BPMN-004: 确认从 Task 三条件', () => {
    it('三项声明不全应触发 004', () => {
      const draft = makeBaseDraft();
      draft.activities[0].confirmation = {
        confirm_role_id: 'role_approver',
        co_completes: true,
        confirm_bears_final_responsibility: false, // 缺失
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'conf_1';
      draft.diagram.nodes.push({
        node_id: 'conf_1', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'lane_approver',
      });
      draft.diagram.flows.push({
        flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'conf_1',
      });
      draft.diagram.flows.push({
        flow_id: 'f4', type: 'SEQUENCE_FLOW', source_ref: 'conf_1', target_ref: 'end_1',
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-004');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-004, got ${JSON.stringify(findings)}`);
    });

    it('确认角色等于主责角色应触发 004', () => {
      const draft = makeBaseDraft();
      draft.activities[0].confirmation = {
        confirm_role_id: 'role_requester', // 等于 R 角色
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'conf_1';
      draft.diagram.nodes.push({
        node_id: 'conf_1', node_type: 'CONFIRMATION_TASK', name: '确认采购', lane_id: 'lane_requester',
      });
      draft.diagram.flows.push({
        flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'conf_1',
      });
      draft.diagram.flows.push({
        flow_id: 'f4', type: 'SEQUENCE_FLOW', source_ref: 'conf_1', target_ref: 'end_1',
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-004');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-004, got ${JSON.stringify(findings)}`);
    });
  });

  describe('FA-ACT-BPMN-005: 正式审批不得作为确认从 Task', () => {
    it('REVIEW_MEETING 有 confirmation 应触发 005', () => {
      const draft = makeBaseDraft();
      draft.activities[0].activity_type = 'REVIEW_MEETING';
      draft.activities[0].responsibility_model = 'OARP';
      draft.activities[0].role_assignments = [
        { role_id: 'role_approver', responsibility: 'O' },
        { role_id: 'role_requester', responsibility: 'A' },
      ];
      draft.activities[0].confirmation = {
        confirm_role_id: 'role_requester',
        co_completes: true,
        confirm_bears_final_responsibility: true,
        no_formal_approval_meeting: true,
      };
      draft.diagram.task_bindings[0].confirmation_task_id = 'conf_1';
      draft.diagram.nodes.push({
        node_id: 'conf_1', node_type: 'CONFIRMATION_TASK', name: '确认', lane_id: 'lane_requester',
      });
      draft.diagram.flows.push({
        flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'conf_1',
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-005');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-005, got ${JSON.stringify(findings)}`);
    });
  });

  describe('FA-ACT-BPMN-006: XOR/OR 必须有条件或默认路径', () => {
    it('XOR 无条件且无默认路径应触发 006', () => {
      const draft = makeBaseDraft();
      draft.diagram.nodes.push({
        node_id: 'xor_1', node_type: 'GATEWAY', sub_type: 'exclusiveGateway', name: '分支', lane_id: 'lane_requester',
      });
      draft.diagram.nodes.push({
        node_id: 'task_2', node_type: 'MAIN_TASK', name: '任务2', lane_id: 'lane_requester',
      });
      // task_1 → xor_1 → task_2 → end_1
      draft.diagram.flows = [
        { flow_id: 'f1', type: 'SEQUENCE_FLOW', source_ref: 'start_1', target_ref: 'task_1' },
        { flow_id: 'f2', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'xor_1' },
        { flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'xor_1', target_ref: 'task_2' },
        { flow_id: 'f4', type: 'SEQUENCE_FLOW', source_ref: 'xor_1', target_ref: 'end_1' },
        { flow_id: 'f5', type: 'SEQUENCE_FLOW', source_ref: 'task_2', target_ref: 'end_1' },
      ];
      // 无 condition_expression 和 is_default
      draft.diagram.task_bindings.push({
        activity_id: 'act_1', main_task_id: 'task_2', confirmation_task_id: null,
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-006');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-006, got ${JSON.stringify(findings)}`);
    });
  });

  describe('FA-ACT-BPMN-007: 结束事件必须有业务结果名称', () => {
    it('多个无意义或与卡片不一致的结束事件应触发 007', () => {
      const draft = makeBaseDraft();
      draft.diagram.nodes.push({
        node_id: 'end_2', node_type: 'END_EVENT', name: '', lane_id: 'lane_requester',
      });
      draft.diagram.flows.push({
        flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'end_2',
      });
      draft.process_card.end_results.push({ event_id: 'end_2', name: '异常结束' });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-007');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-007, got ${JSON.stringify(findings)}`);
    });
  });

  describe('FA-ACT-BPMN-008: Link Catch/Throw 成对', () => {
    it('Link 未成对应触发 008', () => {
      const draft = makeBaseDraft();
      draft.diagram.nodes.push({
        node_id: 'link_throw_1', node_type: 'INTERMEDIATE_EVENT', sub_type: 'linkThrow', name: '跳转A', lane_id: 'lane_requester',
      });
      draft.diagram.flows.push({
        flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'link_throw_1',
      });
      // 没有对应的 linkCatch
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-008');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-008, got ${JSON.stringify(findings)}`);
    });
  });

  describe('FA-ACT-BPMN-009: 同一 L5 不得映射并行主 Task', () => {
    it('同一 L5 并行 Task 应触发 009', () => {
      const draft = makeBaseDraft();
      // 添加并行节点
      draft.diagram.nodes.push({
        node_id: 'task_2', node_type: 'MAIN_TASK', name: '并行任务', lane_id: 'lane_requester',
      });
      draft.diagram.nodes.push({
        node_id: 'gw_split', node_type: 'GATEWAY', sub_type: 'parallelGateway', name: '并行拆分', lane_id: 'lane_requester',
      });
      draft.diagram.nodes.push({
        node_id: 'gw_join', node_type: 'GATEWAY', sub_type: 'parallelGateway', name: '并行汇合', lane_id: 'lane_requester',
      });
      draft.diagram.flows = [
        { flow_id: 'f1', type: 'SEQUENCE_FLOW', source_ref: 'start_1', target_ref: 'task_1' },
        { flow_id: 'f2', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'gw_split' },
        { flow_id: 'f3', type: 'SEQUENCE_FLOW', source_ref: 'gw_split', target_ref: 'task_1' },
        { flow_id: 'f4', type: 'SEQUENCE_FLOW', source_ref: 'gw_split', target_ref: 'task_2' },
        { flow_id: 'f5', type: 'SEQUENCE_FLOW', source_ref: 'task_1', target_ref: 'gw_join' },
        { flow_id: 'f6', type: 'SEQUENCE_FLOW', source_ref: 'task_2', target_ref: 'gw_join' },
        { flow_id: 'f7', type: 'SEQUENCE_FLOW', source_ref: 'gw_join', target_ref: 'end_1' },
      ];
      // 添加第二个 binding，使同一活动有两个主 Task
      draft.diagram.task_bindings.push({
        activity_id: 'act_1', main_task_id: 'task_2', confirmation_task_id: null,
      });
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: draft.activities,
        diagramModel: draft.diagram,
      });
      const f = findFinding(findings, 'FA-ACT-BPMN-009');
      assert.ok(f.length >= 1, `Expected FA-ACT-BPMN-009, got ${JSON.stringify(findings)}`);
    });
  });

  describe('缺少活动表时返回 NEEDS_INPUT', () => {
    it('无活动表应返回 NEEDS_INPUT 而非空数组', () => {
      const draft = makeBaseDraft();
      const findings = reviewActivityBpmn({
        processCard: draft.process_card,
        activities: [], // 空活动表
        diagramModel: draft.diagram,
      });
      assert.equal(findings.length, 1);
      assert.equal(findings[0].rule_id, 'NEEDS_INPUT');
      assert.match(findings[0].evidence[0].observation, /活动表/);
    });
  });
});
