/**
 * Phase B 测试：业务合同结构命令
 *
 * 测试要点：
 * 1. insertL5After 创建活动、主 Task、binding
 * 2. appendGatewayBranch 创建网关和分支 Task
 * 3. deleteNode 删除节点及相关活动/binding
 * 4. moveActivityToAccountableLane 移动活动到主责泳道
 * 5. addLane 添加泳道
 * 6. addIntermediateEventAfter 添加中间事件
 * 7. addEndResultAfter 添加结束结果
 * 8. connectNodes 连接节点
 * 9. addConfirmationTask/removeConfirmationTask 管理确认 Task
 * 10. 命令失败时输入对象不被修改
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore } from '../meeting-package/src/draft-store.js';
import {
  insertL5After,
  appendGatewayBranch,
  deleteNode,
  moveActivityToAccountableLane,
  addLane,
  addIntermediateEventAfter,
  addEndResultAfter,
  connectNodes,
  addConfirmationTask,
  removeConfirmationTask,
} from '../meeting-package/src/structural-commands.js';

function confirmationDeclaration(overrides = {}) {
  return {
    confirm_role_id: 'Role_2',
    co_completes: true,
    confirm_bears_final_responsibility: true,
    no_formal_approval_meeting: true,
    ...overrides,
  };
}

describe('Phase B: 业务合同结构命令', () => {
  let store;
  let initialSnapshot;

  beforeEach(() => {
    // 创建符合 V2 schema 的 payload
    const payload = {
      schema_version: '2.0.0',
      process_card: {
        process_id: 'Process_1',
        name: '测试流程',
        level: 'L4',
        is_leaf: true,
        description: '',
        purpose: '',
        owner: '',
        parent_process_name: null,
        inputs: [],
        outputs: [],
        start: { event_id: 'Start_1', name: '开始', event_type: 'NONE' },
        end_results: [{ event_id: 'End_1', name: '结束' }],
        performance_indicators: [],
      },
      activities: [
        {
          activity_id: 'Activity_1',
          name: '活动 1',
          description: '',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role_1', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: [],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task_1',
          confirmation: null,
          completeness: 'NEEDS_CONFIRMATION',
        },
      ],
      diagram: {
        lanes: [{ lane_id: 'Lane_1', name: '泳道 1', role_id: 'Role_1' }],
        nodes: [
          { node_id: 'Start_1', node_type: 'START_EVENT', name: '开始', lane_id: null },
          { node_id: 'Task_1', node_type: 'MAIN_TASK', name: '活动 1', lane_id: 'Lane_1' },
          { node_id: 'End_1', node_type: 'END_EVENT', name: '结束', lane_id: null },
        ],
        flows: [
          { flow_id: 'Flow_1', source_ref: 'Start_1', target_ref: 'Task_1', condition: null },
          { flow_id: 'Flow_2', source_ref: 'Task_1', target_ref: 'End_1', condition: null },
        ],
        task_bindings: [
          { activity_id: 'Activity_1', main_task_id: 'Task_1', confirmation_task_id: null },
        ],
        layout_version: '2.0.0',
      },
      questions: [],
      provenance: {},
      source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
      metadata: {
        process_id: 'Process_1',
        title: '测试流程',
        revision: 'r01',
        schema_version: '2.0.0',
      },
      bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
    };

    store = new DraftStore({ payload });
    initialSnapshot = store.snapshot();
  });

  describe('insertL5After', () => {
    it('应在所选节点后插入新活动、主 Task、binding 和流', () => {
      const result = insertL5After(store, 'Task_1', {
        activity_id: 'Activity_2',
        name: '活动 2',
      });

      const snapshot = store.snapshot();

      // 验证活动被创建
      assert.equal(snapshot.activities.length, 2);
      const newActivity = snapshot.activities.find(a => a.activity_id === 'Activity_2');
      assert.ok(newActivity);
      assert.equal(newActivity.name, '活动 2');
      assert.equal(newActivity.main_task_id, 'Task_2');

      // 验证主 Task 被创建
      const newTask = snapshot.diagram.nodes.find(n => n.node_id === 'Task_2');
      assert.ok(newTask);
      assert.equal(newTask.node_type, 'MAIN_TASK');
      assert.equal(newTask.lane_id, 'Lane_1');

      // 验证 binding 被创建
      const newBinding = snapshot.diagram.task_bindings.find(b => b.activity_id === 'Activity_2');
      assert.ok(newBinding);
      assert.equal(newBinding.main_task_id, 'Task_2');

      // 验证流被重连：Task_1 -> Task_2 -> End_1
      const flowsFromTask1 = snapshot.diagram.flows.filter(f => f.source_ref === 'Task_1');
      assert.equal(flowsFromTask1.length, 1);
      assert.equal(flowsFromTask1[0].target_ref, 'Task_2');

      const flowsToTask2 = snapshot.diagram.flows.filter(f => f.target_ref === 'Task_2');
      assert.equal(flowsToTask2.length, 1);
      assert.equal(flowsToTask2[0].source_ref, 'Task_1');

      const flowsFromTask2 = snapshot.diagram.flows.filter(f => f.source_ref === 'Task_2');
      assert.equal(flowsFromTask2.length, 1);
      assert.equal(flowsFromTask2[0].target_ref, 'End_1');

      // 验证结果
      assert.equal(result.activity_id, 'Activity_2');
      assert.equal(result.task_id, 'Task_2');
    });

    it('当无法确定角色时应失败（FA-DRAFT-ROLE-001）', () => {
      // 创建一个没有泳道的节点
      store.upsertActivity({
        activity_id: 'Activity_3',
        name: '活动 3',
        description: '',
        activity_type: 'STANDARD',
        responsibility_model: 'RASCI',
        role_assignments: [],
        sla: null,
        tools: [],
        inputs: [],
        process_summary: '',
        outputs: [],
        completion_criteria: [],
        references: [],
        main_task_id: 'Task_3',
        confirmation: null,
        completeness: 'NEEDS_CONFIRMATION',
      });

      const snapshot = store.snapshot();
      snapshot.diagram.nodes.push({
        node_id: 'Task_3',
        node_type: 'MAIN_TASK',
        name: '活动 3',
        lane_id: null, // 没有泳道
        activity_id: 'Activity_3',
      });
      store.restore(snapshot);

      assert.throws(() => {
        insertL5After(store, 'Task_3', {
          activity_id: 'Activity_4',
          name: '活动 4',
        });
      }, /FA-DRAFT-ROLE-001/);
    });

    it('失败时输入对象不被修改', () => {
      const snapshotBefore = store.snapshot();

      try {
        insertL5After(store, 'Task_3', {
          activity_id: 'Activity_2',
          name: '活动 2',
        });
      } catch (error) {
        // 忽略错误
      }

      const snapshotAfter = store.snapshot();
      assert.deepEqual(snapshotAfter, snapshotBefore);
    });
  });

  describe('appendGatewayBranch', () => {
    it('应在所选节点后创建 XOR 网关和分支 Task', () => {
      const result = appendGatewayBranch(store, 'Task_1', 'XOR', [
        { label: '是', condition: { source_output: 'decision', operator: 'IS_TRUE' } },
        { label: '否', condition: { source_output: 'decision', operator: 'IS_FALSE' } },
      ]);

      const snapshot = store.snapshot();

      // 验证网关被创建
      const gateway = snapshot.diagram.nodes.find(n => n.node_id === result.gateway_id);
      assert.ok(gateway);
      assert.equal(gateway.node_type, 'GATEWAY_XOR');
      assert.equal(gateway.lane_id, 'Lane_1');

      // 验证分支 Task 被创建
      assert.equal(result.branch_tasks.length, 2);
      const branchTasks = result.branch_tasks.map(id =>
        snapshot.diagram.nodes.find(n => n.node_id === id)
      );
      for (const task of branchTasks) {
        assert.ok(task);
        assert.equal(task.node_type, 'MAIN_TASK');
      }

      // 验证网关不绑定活动
      const gatewayBinding = snapshot.diagram.task_bindings.find(b => b.main_task_id === result.gateway_id);
      assert.ok(!gatewayBinding);

      // 验证分支 Task 各自绑定活动
      for (const task_id of result.branch_tasks) {
        const binding = snapshot.diagram.task_bindings.find(b => b.main_task_id === task_id);
        assert.ok(binding);
        const activity = snapshot.activities.find(a => a.activity_id === binding.activity_id);
        assert.ok(activity);
      }

      // 验证流：Task_1 -> Gateway
      const flowsFromTask1 = snapshot.diagram.flows.filter(f => f.source_ref === 'Task_1');
      assert.equal(flowsFromTask1.length, 1);
      assert.equal(flowsFromTask1[0].target_ref, result.gateway_id);

      // 验证流：Gateway -> Branch1, Branch2
      const flowsFromGateway = snapshot.diagram.flows.filter(f => f.source_ref === result.gateway_id);
      assert.equal(flowsFromGateway.length, 2);

      // 验证条件被正确设置
      for (const flow of flowsFromGateway) {
        assert.ok(flow.condition);
        assert.ok(flow.condition.source_output);
      }
    });

    it('AND 网关分支不得携带真假条件', () => {
      const result = appendGatewayBranch(store, 'Task_1', 'AND', [
        { label: '并行 A', condition: { source_output: '判断', operator: 'IS_TRUE' } },
        { label: '并行 B', condition: { source_output: '判断', operator: 'IS_FALSE' } },
      ]);
      const snapshot = store.snapshot();
      const branchFlows = snapshot.diagram.flows.filter(
        flow => flow.source_ref === result.gateway_id,
      );
      assert.equal(branchFlows.length, 2);
      assert.ok(branchFlows.every(flow => flow.condition === null));
    });
  });

  describe('deleteNode', () => {
    it('删除主 Task 应同步删除活动、confirmation、binding 和相关 flow', () => {
      const result = deleteNode(store, 'Task_1');

      const snapshot = store.snapshot();

      // 验证活动被删除
      assert.equal(snapshot.activities.length, 0);

      // 验证主 Task 被删除
      const task = snapshot.diagram.nodes.find(n => n.node_id === 'Task_1');
      assert.ok(!task);

      // 验证 binding 被删除
      const binding = snapshot.diagram.task_bindings.find(b => b.activity_id === 'Activity_1');
      assert.ok(!binding);

      // 验证相关 flow 被删除
      const flowsFromDeleted = snapshot.diagram.flows.filter(f => f.source_ref === 'Task_1' || f.target_ref === 'Task_1');
      assert.equal(flowsFromDeleted.length, 0);
      assert.ok(snapshot.diagram.flows.some(
        flow => flow.source_ref === 'Start_1' && flow.target_ref === 'End_1',
      ), '删除主 Task 后应旁路重连前驱与后继');
    });

    it('删除确认 Task 仅取消 confirmation', () => {
      // 先添加确认 Task
      addLane(store, { lane_id: 'Lane_2', name: '确认人泳道', role_id: 'Role_2' });
      addConfirmationTask(store, 'Activity_1', confirmationDeclaration());

      const snapshotBefore = store.snapshot();
      const confirmTask = snapshotBefore.diagram.nodes.find(n => n.node_type === 'CONFIRMATION_TASK');

      // 删除确认 Task
      deleteNode(store, confirmTask.node_id);

      const snapshotAfter = store.snapshot();

      // 验证活动仍然存在
      assert.equal(snapshotAfter.activities.length, 1);

      // 验证 confirmation 被取消
      const activity = snapshotAfter.activities.find(a => a.activity_id === 'Activity_1');
      assert.ok(!activity.confirmation);

      // 验证确认 Task 被删除
      const deletedTask = snapshotAfter.diagram.nodes.find(n => n.node_id === confirmTask.node_id);
      assert.ok(!deletedTask);
      assert.ok(snapshotAfter.diagram.flows.some(
        flow => flow.source_ref === 'Task_1' && flow.target_ref === 'End_1',
      ));
    });

    it('删除网关后应将前驱连接到各分支 Task', () => {
      const result = appendGatewayBranch(store, 'Task_1', 'XOR', [
        { label: '分支 A', condition: { source_output: '判断', operator: 'IS_TRUE' } },
        { label: '分支 B', condition: { source_output: '判断', operator: 'IS_FALSE' } },
      ]);
      deleteNode(store, result.gateway_id);
      const snapshot = store.snapshot();
      for (const taskId of result.branch_tasks) {
        assert.ok(snapshot.diagram.flows.some(
          flow => flow.source_ref === 'Task_1' && flow.target_ref === taskId,
        ));
      }
    });

    it('删除业务结束事件时应同步移除流程卡片结束结果', () => {
      const { event_id: eventId } = addEndResultAfter(store, 'Task_1', { name: '拒绝结束' });
      deleteNode(store, eventId);
      const snapshot = store.snapshot();
      assert.ok(!snapshot.diagram.nodes.some(node => node.node_id === eventId));
      assert.ok(!snapshot.process_card.end_results.some(result => result.event_id === eventId));
    });

    it('不得删除唯一开始事件', () => {
      const before = store.snapshot();
      assert.throws(() => deleteNode(store, 'Start_1'), /开始事件/);
      assert.deepEqual(store.snapshot(), before);
    });
  });

  describe('moveActivityToAccountableLane', () => {
    it('应将主 Task 移到主责角色的泳道', () => {
      // 添加新泳道
      addLane(store, { lane_id: 'Lane_2', name: '泳道 2', role_id: 'Role_2' });

      // 更新活动的主责角色
      store.upsertActivity({
        ...store.snapshot().activities.find(a => a.activity_id === 'Activity_1'),
        role_assignments: [{ role_id: 'Role_2', responsibility: 'R' }],
      });

      const result = moveActivityToAccountableLane(store, 'Activity_1');

      const snapshot = store.snapshot();

      // 验证主 Task 移到新泳道
      const task = snapshot.diagram.nodes.find(n => n.node_id === 'Task_1');
      assert.equal(task.lane_id, 'Lane_2');
    });

    it('没有对应泳道时应失败', () => {
      store.upsertActivity({
        ...store.snapshot().activities.find(a => a.activity_id === 'Activity_1'),
        role_assignments: [{ role_id: 'Role_999', responsibility: 'R' }],
      });

      assert.throws(() => {
        moveActivityToAccountableLane(store, 'Activity_1');
      }, /没有对应泳道/);
    });

    it('主责角色不是恰好一个时应失败', () => {
      store.upsertActivity({
        ...store.snapshot().activities.find(a => a.activity_id === 'Activity_1'),
        role_assignments: [
          { role_id: 'Role_1', responsibility: 'R' },
          { role_id: 'Role_2', responsibility: 'R' },
        ],
      });
      assert.throws(
        () => moveActivityToAccountableLane(store, 'Activity_1'),
        /恰有一个 R/,
      );
    });

    it('移动主 Task 时确认从 Task 保持在确认角色泳道', () => {
      addLane(store, { lane_id: 'Lane_2', name: '确认人泳道', role_id: 'Role_2' });
      addLane(store, { lane_id: 'Lane_3', name: '新主责泳道', role_id: 'Role_3' });
      addConfirmationTask(store, 'Activity_1', confirmationDeclaration());
      store.upsertActivity({
        ...store.snapshot().activities.find(a => a.activity_id === 'Activity_1'),
        role_assignments: [{ role_id: 'Role_3', responsibility: 'R' }],
      });

      moveActivityToAccountableLane(store, 'Activity_1');

      const snapshot = store.snapshot();
      const binding = snapshot.diagram.task_bindings.find(b => b.activity_id === 'Activity_1');
      assert.equal(snapshot.diagram.nodes.find(n => n.node_id === 'Task_1').lane_id, 'Lane_3');
      assert.equal(
        snapshot.diagram.nodes.find(n => n.node_id === binding.confirmation_task_id).lane_id,
        'Lane_2',
      );
    });
  });

  describe('addLane', () => {
    it('应添加新泳道', () => {
      const result = addLane(store, { lane_id: 'Lane_2', name: '泳道 2', role_id: 'Role_2' });

      const snapshot = store.snapshot();

      // 验证泳道被添加
      assert.equal(snapshot.diagram.lanes.length, 2);
      const newLane = snapshot.diagram.lanes.find(l => l.lane_id === 'Lane_2');
      assert.ok(newLane);
      assert.equal(newLane.name, '泳道 2');
      assert.equal(newLane.role_id, 'Role_2');
    });

    it('省略 lane_id 时应确定性分配最小可用 ID', () => {
      assert.equal(addLane(store, { name: '泳道 2', role_id: 'Role_2' }).lane_id, 'Lane_2');
      assert.equal(addLane(store, { name: '泳道 3', role_id: 'Role_3' }).lane_id, 'Lane_3');
    });

    it('重复 lane_id 或 role_id 时应失败且不修改合同', () => {
      const before = store.snapshot();
      assert.throws(
        () => addLane(store, { lane_id: 'Lane_1', name: '重复 ID', role_id: 'Role_2' }),
        /泳道 ID 已存在/,
      );
      assert.throws(
        () => addLane(store, { name: '重复角色', role_id: 'Role_1' }),
        /角色泳道已存在/,
      );
      assert.deepEqual(store.snapshot(), before);
    });
  });

  describe('addIntermediateEventAfter', () => {
    it('应在所选节点后添加中间事件', () => {
      const result = addIntermediateEventAfter(store, 'Task_1', {
        node_id: 'Event_1',
        name: '等待消息',
        event_type: 'INTERMEDIATE_MESSAGE_CATCH',
      });

      const snapshot = store.snapshot();

      // 验证中间事件被创建
      const event = snapshot.diagram.nodes.find(n => n.node_id === 'Event_1');
      assert.ok(event);
      assert.equal(event.node_type, 'INTERMEDIATE_MESSAGE_CATCH');
      assert.equal(event.lane_id, 'Lane_1');

      // 验证流被重连
      const flowsFromTask1 = snapshot.diagram.flows.filter(f => f.source_ref === 'Task_1');
      assert.equal(flowsFromTask1.length, 1);
      assert.equal(flowsFromTask1[0].target_ref, 'Event_1');

      const flowsFromEvent = snapshot.diagram.flows.filter(f => f.source_ref === 'Event_1');
      assert.equal(flowsFromEvent.length, 1);
      assert.equal(flowsFromEvent[0].target_ref, 'End_1');
    });

    it('省略 node_id 时应确定性分配最小可用 ID', () => {
      const result = addIntermediateEventAfter(store, 'Task_1', {
        name: '等待消息',
        event_type: 'INTERMEDIATE_MESSAGE_CATCH',
      });
      assert.equal(result.node_id, 'Intermediate_1');
    });
  });

  describe('addEndResultAfter', () => {
    it('应在所选节点后添加结束结果', () => {
      const result = addEndResultAfter(store, 'Task_1', {
        event_id: 'End_2',
        name: '完成',
      });

      const snapshot = store.snapshot();

      // 验证结束事件被创建
      const endEvent = snapshot.diagram.nodes.find(n => n.node_id === 'End_2');
      assert.ok(endEvent);
      assert.equal(endEvent.node_type, 'END_EVENT');
      assert.equal(endEvent.lane_id, 'Lane_1');

      // 验证流被重连：Task_1 -> End_2
      const flowsFromTask1 = snapshot.diagram.flows.filter(f => f.source_ref === 'Task_1');
      const flowToEnd2 = flowsFromTask1.find(f => f.target_ref === 'End_2');
      assert.ok(flowToEnd2);

      // 验证 process_card.end_results 被更新
      const endResult = snapshot.process_card.end_results.find(e => e.event_id === 'End_2');
      assert.ok(endResult);
      assert.equal(endResult.name, '完成');
    });

    it('省略 event_id 时应确定性分配最小可用 ID', () => {
      const result = addEndResultAfter(store, 'Task_1', { name: '另一结束结果' });
      assert.equal(result.event_id, 'End_2');
    });
  });

  describe('connectNodes', () => {
    it('应连接两个节点', () => {
      const result = connectNodes(store, 'Start_1', 'End_1', null);

      const snapshot = store.snapshot();

      // 验证流被创建
      const flow = snapshot.diagram.flows.find(f => f.flow_id === result.flow_id);
      assert.ok(flow);
      assert.equal(flow.source_ref, 'Start_1');
      assert.equal(flow.target_ref, 'End_1');
    });

    it('源或目标节点不存在时应在修改前失败', () => {
      const before = store.snapshot();
      assert.throws(
        () => connectNodes(store, 'Task_1', 'Missing_1', null),
        /目标节点不存在/,
      );
      assert.deepEqual(store.snapshot(), before);
    });
  });

  describe('addConfirmationTask/removeConfirmationTask', () => {
    it('应添加确认 Task 并满足三条件', () => {
      addLane(store, { lane_id: 'Lane_2', name: '确认人泳道', role_id: 'Role_2' });
      const result = addConfirmationTask(store, 'Activity_1', confirmationDeclaration());

      const snapshot = store.snapshot();

      // 验证确认 Task 被创建
      const confirmTask = snapshot.diagram.nodes.find(n => n.node_type === 'CONFIRMATION_TASK');
      assert.ok(confirmTask);
      assert.equal(confirmTask.lane_id, 'Lane_2');

      // 验证 confirmation 被设置
      const activity = snapshot.activities.find(a => a.activity_id === 'Activity_1');
      assert.ok(activity.confirmation);
      assert.equal(activity.confirmation.confirm_role_id, 'Role_2');
      assert.equal(activity.confirmation.co_completes, true);
      assert.equal(activity.confirmation.confirm_bears_final_responsibility, true);
      assert.equal(activity.confirmation.no_formal_approval_meeting, true);
      assert.equal(activity.confirmation.confirmation_task_id, confirmTask.node_id);

      // 验证 binding 被更新
      const binding = snapshot.diagram.task_bindings.find(b => b.activity_id === 'Activity_1');
      assert.equal(binding.confirmation_task_id, confirmTask.node_id);

      assert.ok(snapshot.diagram.flows.some(
        flow => flow.source_ref === 'Task_1' && flow.target_ref === confirmTask.node_id,
      ));
      assert.ok(snapshot.diagram.flows.some(
        flow => flow.source_ref === confirmTask.node_id && flow.target_ref === 'End_1',
      ));
      assert.ok(!snapshot.diagram.flows.some(
        flow => flow.source_ref === 'Task_1' && flow.target_ref === 'End_1',
      ));
    });

    it('确认角色为空时应失败（FA-DRAFT-CONFIRM-001）', () => {
      assert.throws(() => {
        addConfirmationTask(store, 'Activity_1', confirmationDeclaration({ confirm_role_id: null }));
      }, /FA-DRAFT-CONFIRM-001/);
    });

    it('确认角色与主责角色相同时应失败（FA-DRAFT-CONFIRM-001）', () => {
      assert.throws(() => {
        addConfirmationTask(store, 'Activity_1', confirmationDeclaration({ confirm_role_id: 'Role_1' }));
      }, /FA-DRAFT-CONFIRM-001/);
    });

    it('三个业务条件任一不满足时应失败（FA-DRAFT-CONFIRM-001）', () => {
      addLane(store, { lane_id: 'Lane_2', name: '确认人泳道', role_id: 'Role_2' });
      assert.throws(() => {
        addConfirmationTask(store, 'Activity_1', confirmationDeclaration({ co_completes: false }));
      }, /FA-DRAFT-CONFIRM-001.*三个条件/);
    });

    it('应移除确认 Task', () => {
      addLane(store, { lane_id: 'Lane_2', name: '确认人泳道', role_id: 'Role_2' });
      addConfirmationTask(store, 'Activity_1', confirmationDeclaration());
      removeConfirmationTask(store, 'Activity_1');

      const snapshot = store.snapshot();

      // 验证确认 Task 被删除
      const confirmTask = snapshot.diagram.nodes.find(n => n.node_type === 'CONFIRMATION_TASK');
      assert.ok(!confirmTask);

      // 验证 confirmation 被清空
      const activity = snapshot.activities.find(a => a.activity_id === 'Activity_1');
      assert.ok(!activity.confirmation);

      // 验证 binding 被更新
      const binding = snapshot.diagram.task_bindings.find(b => b.activity_id === 'Activity_1');
      assert.equal(binding.confirmation_task_id, null);
      assert.ok(snapshot.diagram.flows.some(
        flow => flow.source_ref === 'Task_1' && flow.target_ref === 'End_1',
      ));
    });
  });
});
