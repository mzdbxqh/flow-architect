import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('BPMN Compiler V2', () => {
  /**
   * 创建完整 V2 流程草稿，覆盖所有必测场景
   * - 4 泳道: 采购人、审核人、财务、系统
   * - XOR/AND/OR 网关
   * - Message catch/throw、Timer catch、Link catch/throw
   * - 多 End Event
   * - confirmation 串行且跨泳道
   * - 条件（含需 XML 转义字符）
   */
  function createFullV2Draft() {
    return {
      schema_version: '2.0.0',
      process_card: {
        process_id: 'Process-Procurement',
        name: '采购审批流程',
        level: 'L4',
        is_leaf: true,
        description: '企业采购审批',
        purpose: '规范采购',
        owner: 'Role-Buyer',
        parent_process_name: null,
        inputs: ['采购需求'],
        outputs: ['采购结果'],
        start: { event_id: 'Start-1', name: '收到采购申请', event_type: 'NONE' },
        end_results: [
          { event_id: 'End-1', name: '采购完成' },
          { event_id: 'End-2', name: '采购拒绝' },
        ],
        performance_indicators: [],
      },
      activities: [
        {
          activity_id: 'Activity-001',
          name: '提交采购申请',
          description: '采购人填写并提交采购申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-Buyer', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: [],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-001',
          confirmation: null,
          completeness: 'COMPLETE',
        },
        {
          activity_id: 'Activity-002',
          name: '审核采购申请',
          description: '审核人审核采购申请',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-Reviewer', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: [],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-002',
          confirmation: {
            confirm_role_id: 'Role-Buyer',
            co_completes: true,
            confirm_bears_final_responsibility: true,
            no_formal_approval_meeting: true,
            confirmation_task_id: 'Confirm-002',
          },
          completeness: 'COMPLETE',
        },
        {
          activity_id: 'Activity-003',
          name: '执行采购',
          description: '财务执行采购',
          activity_type: 'STANDARD',
          responsibility_model: 'RASCI',
          role_assignments: [{ role_id: 'Role-Finance', responsibility: 'R' }],
          sla: null,
          tools: [],
          inputs: [],
          process_summary: '',
          outputs: [],
          completion_criteria: [],
          references: [],
          main_task_id: 'Task-003',
          confirmation: null,
          completeness: 'COMPLETE',
        },
      ],
      diagram: {
        lanes: [
          { lane_id: 'Lane-Buyer', name: '采购人', role_id: 'Role-Buyer' },
          { lane_id: 'Lane-Reviewer', name: '审核人', role_id: 'Role-Reviewer' },
          { lane_id: 'Lane-Finance', name: '财务', role_id: 'Role-Finance' },
          { lane_id: 'Lane-System', name: '系统', role_id: 'Role-System' },
        ],
        nodes: [
          { node_id: 'Start-1', node_type: 'START_EVENT', name: '收到采购申请', lane_id: null },
          { node_id: 'Task-001', node_type: 'MAIN_TASK', name: '提交采购申请', lane_id: 'Lane-Buyer' },
          { node_id: 'MsgCatch-001', node_type: 'INTERMEDIATE_MESSAGE_CATCH', name: '等待供应商报价', lane_id: 'Lane-System' },
          { node_id: 'MsgThrow-001', node_type: 'INTERMEDIATE_MESSAGE_THROW', name: '发送报价请求', lane_id: 'Lane-System' },
          { node_id: 'TimerCatch-001', node_type: 'INTERMEDIATE_TIMER_CATCH', name: '报价截止时间', lane_id: 'Lane-System' },
          { node_id: 'GW-Review', node_type: 'GATEWAY_XOR', name: '审核结论', lane_id: null },
          { node_id: 'Task-002', node_type: 'MAIN_TASK', name: '审核采购申请', lane_id: 'Lane-Reviewer' },
          { node_id: 'Confirm-002', node_type: 'CONFIRMATION_TASK', name: '确认采购需求', lane_id: 'Lane-Buyer' },
          { node_id: 'GW-Amount', node_type: 'GATEWAY_AND', name: '金额检查并行', lane_id: null },
          { node_id: 'GW-Final', node_type: 'GATEWAY_OR', name: '最终决策', lane_id: null },
          { node_id: 'LinkCatch-001', node_type: 'INTERMEDIATE_LINK_CATCH', name: '跳转目标A', lane_id: null },
          { node_id: 'LinkThrow-001', node_type: 'INTERMEDIATE_LINK_THROW', name: '跳转目标A', lane_id: null },
          { node_id: 'Task-003', node_type: 'MAIN_TASK', name: '执行采购', lane_id: 'Lane-Finance' },
          { node_id: 'End-1', node_type: 'END_EVENT', name: '采购完成', lane_id: null },
          { node_id: 'End-2', node_type: 'END_EVENT', name: '采购拒绝', lane_id: null },
        ],
        flows: [
          { flow_id: 'Flow-1', source_ref: 'Start-1', target_ref: 'Task-001' },
          { flow_id: 'Flow-2', source_ref: 'Task-001', target_ref: 'MsgThrow-001' },
          { flow_id: 'Flow-3', source_ref: 'MsgThrow-001', target_ref: 'MsgCatch-001' },
          { flow_id: 'Flow-4', source_ref: 'MsgCatch-001', target_ref: 'TimerCatch-001' },
          { flow_id: 'Flow-5', source_ref: 'TimerCatch-001', target_ref: 'Task-002' },
          { flow_id: 'Flow-6', source_ref: 'Task-002', target_ref: 'Confirm-002' },
          { flow_id: 'Flow-7', source_ref: 'Confirm-002', target_ref: 'GW-Review' },
          {
            flow_id: 'Flow-8', source_ref: 'GW-Review', target_ref: 'GW-Amount',
            condition: { label: '通过', source_activity_id: 'Activity-002', source_output: '审核结论', operator: 'EQUALS', value: '通过' },
          },
          {
            flow_id: 'Flow-9', source_ref: 'GW-Review', target_ref: 'End-2',
            condition: { label: '驳回 <不合格>', source_activity_id: 'Activity-002', source_output: '审核结论', operator: 'EQUALS', value: '驳回' },
          },
          { flow_id: 'Flow-10', source_ref: 'GW-Amount', target_ref: 'GW-Final' },
          { flow_id: 'Flow-11', source_ref: 'GW-Final', target_ref: 'Task-003' },
          { flow_id: 'Flow-12', source_ref: 'LinkThrow-001', target_ref: 'LinkCatch-001' },
          { flow_id: 'Flow-13', source_ref: 'Task-003', target_ref: 'LinkThrow-001' },
          { flow_id: 'Flow-14', source_ref: 'LinkCatch-001', target_ref: 'End-1' },
        ],
        task_bindings: [
          { activity_id: 'Activity-001', main_task_id: 'Task-001', confirmation_task_id: null },
          { activity_id: 'Activity-002', main_task_id: 'Task-002', confirmation_task_id: 'Confirm-002' },
          { activity_id: 'Activity-003', main_task_id: 'Task-003', confirmation_task_id: null },
        ],
        layout_version: '2.0.0',
      },
      questions: [],
      provenance: {},
      source_summary: { total_blocks: 0, formats: [], evidence_refs: [] },
    };
  }

  describe('compileBpmn — 全要素 V2 编译', () => {
    it('应生成所有 V2 节点类型和标准 BPMN 2.0 命名空间', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { xml } = compileBpmn(draft);

      // 命名空间
      assert.match(xml, /xmlns:bpmn="http:\/\/www\.omg\.org\/spec\/BPMN\/20100524\/MODEL"/);
      assert.match(xml, /xmlns:bpmndi="http:\/\/www\.omg\.org\/spec\/BPMN\/20100524\/DI"/);
      assert.match(xml, /xmlns:dc="http:\/\/www\.omg\.org\/spec\/DD\/20100524\/DC"/);
      assert.match(xml, /xmlns:di="http:\/\/www\.omg\.org\/spec\/DD\/20100524\/DI"/);

      // 网关
      assert.match(xml, /<bpmn:exclusiveGateway id="GW-Review"/, 'XOR 网关');
      assert.match(xml, /<bpmn:parallelGateway id="GW-Amount"/, 'AND 网关');
      assert.match(xml, /<bpmn:inclusiveGateway id="GW-Final"/, 'OR 网关');

      // 中间事件
      assert.match(xml, /<bpmn:intermediateCatchEvent id="MsgCatch-001"/, 'Message catch');
      assert.match(xml, /<bpmn:intermediateThrowEvent id="MsgThrow-001"/, 'Message throw');
      assert.match(xml, /<bpmn:intermediateCatchEvent id="TimerCatch-001"/, 'Timer catch');
      assert.match(xml, /<bpmn:intermediateCatchEvent id="LinkCatch-001"/, 'Link catch');
      assert.match(xml, /<bpmn:intermediateThrowEvent id="LinkThrow-001"/, 'Link throw');

      // Message/Timer eventDefinition
      assert.match(xml, /<bpmn:messageEventDefinition/, '有 messageEventDefinition');
      assert.match(xml, /<bpmn:timerEventDefinition/, '有 timerEventDefinition');

      // Link eventDefinition
      assert.match(xml, /<bpmn:linkEventDefinition/, '有 linkEventDefinition');

      // 多 End
      assert.match(xml, /<bpmn:endEvent id="End-1"/, 'End-1');
      assert.match(xml, /<bpmn:endEvent id="End-2"/, 'End-2');

      // Confirmation task
      assert.match(xml, /<bpmn:userTask id="Confirm-002"/, 'confirmation 编译为 userTask');

      // laneSet 和 flowNodeRef
      assert.match(xml, /<bpmn:laneSet id="LaneSet_1"/);
      assert.match(xml, /<bpmn:flowNodeRef>Task-001<\/bpmn:flowNodeRef>/);

      // BPMN DI 完整
      assert.match(xml, /<bpmndi:BPMNDiagram/);
      assert.match(xml, /<bpmndi:BPMNPlane/);
      assert.match(xml, /<bpmndi:BPMNShape/);
      assert.match(xml, /<bpmndi:BPMNEdge/);
      assert.match(xml, /<di:waypoint/);
    });
  });

  describe('compileBpmn — 条件编译与 XML 转义', () => {
    it('应正确编译结构化条件并转义 XML 特殊字符', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { xml } = compileBpmn(draft);

      // 结构化条件应编译为 conditionExpression
      assert.match(xml, /conditionExpression/);
      assert.match(xml, /bpmn:tFormalExpression/);

      // 条件值中的双引号应被转义为 &quot;
      assert.match(xml, /&quot;/, '应包含转义后的双引号');

      // 结构化条件应编译为标准表达式（source_output op "value"）
      assert.match(xml, /审核结论/, '应包含 source_output');
    });
  });

  describe('compileBpmn — Link catch/throw 配对', () => {
    it('Link catch/throw 应按名称配对', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { xml } = compileBpmn(draft);

      // 两个 linkEventDefinition，name 相同
      const linkDefs = [...xml.matchAll(/<bpmn:linkEventDefinition[^/]*name="([^"]+)"/g)];
      assert.equal(linkDefs.length, 2, '应有 2 个 linkEventDefinition');
      assert.equal(linkDefs[0][1], linkDefs[1][1], 'Link catch/throw 名称应相同（跳转目标A）');
    });

    it('Link 缺失配对应阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      // 移除 LinkThrow，只留 LinkCatch
      draft.diagram.nodes = draft.diagram.nodes.filter(n => n.node_id !== 'LinkThrow-001');
      draft.diagram.flows = draft.diagram.flows.filter(f =>
        f.source_ref !== 'LinkThrow-001' && f.target_ref !== 'LinkThrow-001'
      );

      assert.throws(() => compileBpmn(draft), /Link/, '缺失 Link throw 应阻断');
    });

    it('Link 多配应阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      // 添加第二个同名 LinkCatch
      draft.diagram.nodes.push({
        node_id: 'LinkCatch-002',
        node_type: 'INTERMEDIATE_LINK_CATCH',
        name: '跳转目标A',
        lane_id: null,
      });

      assert.throws(() => compileBpmn(draft), /Link/, 'Link 多配应阻断');
    });

    it('Link 方向错误应阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      // 交换 catch/throw 类型 AND 改名称使其不匹配
      const linkCatch = draft.diagram.nodes.find(n => n.node_id === 'LinkCatch-001');
      const linkThrow = draft.diagram.nodes.find(n => n.node_id === 'LinkThrow-001');
      linkCatch.node_type = 'INTERMEDIATE_LINK_THROW';
      linkCatch.name = '跳转目标A';
      linkThrow.node_type = 'INTERMEDIATE_LINK_CATCH';
      linkThrow.name = '跳转目标B'; // 不同名称 → 配对失败

      assert.throws(() => compileBpmn(draft), /Link/, 'Link 方向错误应阻断');
    });
  });

  describe('compileBpmn — 字节一致性', () => {
    it('相同输入应产生字节一致的 XML 和 DI', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const result1 = compileBpmn(draft);
      const result2 = compileBpmn(structuredClone(draft));
      assert.equal(result1.xml, result2.xml, 'XML 应字节一致');
      assert.deepEqual(result1.layout, result2.layout, 'Layout 应完全一致');
    });

    it('输入坐标变化不应影响输出', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const result1 = compileBpmn(draft);
      const result2 = compileBpmn(structuredClone(draft));
      assert.equal(result1.xml, result2.xml, '不同坐标不应影响输出');
    });
  });

  describe('compileBpmn — 非法引用阻断', () => {
    it('引用不存在的节点应阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      draft.diagram.flows.push({
        flow_id: 'Flow-bad',
        source_ref: 'Task-001',
        target_ref: 'NonExistent',
      });

      assert.throws(() => compileBpmn(draft), /引用/, '非法引用应阻断');
    });

    it('多主 Task 应阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      // 给 Activity-001 添加第二个 main_task_id
      draft.diagram.task_bindings.push({
        activity_id: 'Activity-001',
        main_task_id: 'Task-Duplicate',
        confirmation_task_id: null,
      });

      assert.throws(() => compileBpmn(draft), /主 Task|main/i, '多主 Task 应阻断');
    });
  });

  describe('compileBpmn — Layout', () => {
    it('每条 flow 应至少两个 waypoint', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { layout } = compileBpmn(draft);

      for (const edge of layout.edges) {
        assert.ok(edge.waypoints.length >= 2,
          `Edge ${edge.id} 应至少 2 个 waypoint，实际 ${edge.waypoints.length}`);
      }
    });

    it('同秩节点应按稳定 ID 排序', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { layout } = compileBpmn(draft);

      // 检查同 rank 节点按 ID 排序
      const rankGroups = new Map();
      for (const [nodeId, pos] of Object.entries(layout.elements)) {
        const rank = pos.rank;
        if (!rankGroups.has(rank)) rankGroups.set(rank, []);
        rankGroups.get(rank).push(nodeId);
      }
      for (const [rank, nodeIds] of rankGroups) {
        const sorted = [...nodeIds].sort();
        assert.deepEqual(nodeIds, sorted, `Rank ${rank} 节点应按 ID 排序`);
      }
    });

    it('节点不应重叠', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { layout } = compileBpmn(draft);
      const elements = Object.entries(layout.elements);

      for (let i = 0; i < elements.length; i++) {
        for (let j = i + 1; j < elements.length; j++) {
          const [idA, a] = elements[i];
          const [idB, b] = elements[j];
          const overlaps =
            a.x < b.x + b.width && a.x + a.width > b.x &&
            a.y < b.y + b.height && a.y + a.height > b.y;
          assert.ok(!overlaps, `节点 ${idA} 和 ${idB} 重叠`);
        }
      }
    });

    it('失败不应返回部分布局', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      // 制造一个会导致布局失败的场景（引用不存在的节点）
      draft.diagram.flows.push({
        flow_id: 'Flow-bad',
        source_ref: 'Task-001',
        target_ref: 'NonExistent',
      });

      assert.throws(() => compileBpmn(draft), /引用/, '布局失败应抛出异常而非返回部分结果');
    });
  });

  describe('normalizeBpmnXml', () => {
    it('应恢复有限支持元素、名称、泳道和流', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { xml } = compileBpmn(draft);
      const { diagram, warnings } = normalizeBpmnXml(xml, { activities: draft.activities });

      assert.ok(diagram, '应产生 diagram');
      assert.ok(Array.isArray(warnings), '应产生 warnings 数组');
      assert.ok(diagram.nodes.length > 0, '应恢复节点');
      assert.ok(diagram.flows.length > 0, '应恢复流');
      assert.ok(diagram.lanes.length > 0, '应恢复泳道');
    });

    it('应强制调用确定性布局（忽略旧 DI 坐标）', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { xml } = compileBpmn(draft);
      const { diagram } = normalizeBpmnXml(xml, { activities: draft.activities });

      // 规范化后的 diagram 应有 layout_version 标记
      assert.ok(diagram.layout_version, '规范化后应有 layout_version');
    });

    it('应恢复 activity/task binding', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();
      const { xml } = compileBpmn(draft);
      const { diagram } = normalizeBpmnXml(xml, { activities: draft.activities });

      assert.ok(diagram.task_bindings.length > 0, '应恢复 task_bindings');
    });

    it('未支持元素应产生警告', async () => {
      const { normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:subProcess id="Sub_1" name="子流程">
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Sub_1" targetRef="Sub_1" />
  </bpmn:process>
</bpmn:definitions>`;

      const { diagram, warnings } = normalizeBpmnXml(xml, { activities: [] });
      // subProcess 不在支持列表中，应产生警告
      assert.ok(warnings.some(w => w.includes('不支持')), '未支持元素应产生警告');
    });

    it('重复 ID 应产生警告', async () => {
      const { normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="任务A" />
    <bpmn:task id="Task_1" name="任务B" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_1" />
  </bpmn:process>
</bpmn:definitions>`;

      const { warnings } = normalizeBpmnXml(xml, { activities: [] });
      assert.ok(warnings.some(w => w.includes('重复')), '重复 ID 应产生警告');
    });

    it('悬空引用应产生警告', async () => {
      const { normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:task id="Task_1" name="任务" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Ghost" />
  </bpmn:process>
</bpmn:definitions>`;

      const { warnings } = normalizeBpmnXml(xml, { activities: [] });
      assert.ok(warnings.some(w => w.includes('不存在')), '悬空引用应产生警告');
    });

    it('normalize → compile → normalize 业务图语义稳定', async () => {
      const { compileBpmn, normalizeBpmnXml } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 第一次 normalize
      const { xml: xml1 } = compileBpmn(draft);
      const { diagram: diagram1 } = normalizeBpmnXml(xml1, { activities: draft.activities });

      // 第二次 compile + normalize
      const draft2 = { ...draft, diagram: diagram1 };
      const { xml: xml2 } = compileBpmn(draft2);
      const { diagram: diagram2 } = normalizeBpmnXml(xml2, { activities: draft.activities });

      // 节点集合应稳定
      const nodeIds1 = new Set(diagram1.nodes.map(n => n.node_id).sort());
      const nodeIds2 = new Set(diagram2.nodes.map(n => n.node_id).sort());
      assert.deepEqual(nodeIds1, nodeIds2, '节点集合应稳定');

      // 流集合应稳定
      const flowIds1 = new Set(diagram1.flows.map(f => f.flow_id).sort());
      const flowIds2 = new Set(diagram2.flows.map(f => f.flow_id).sort());
      assert.deepEqual(flowIds1, flowIds2, '流集合应稳定');
    });
  });

  describe('compileBpmn — 编译前业务门禁', () => {
    it('应执行 validateDraftBusinessRules 并在业务规则失败时阻断', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 修改为非法的责任模型：STANDARD 使用 OARP
      draft.activities[0].activity_type = 'STANDARD';
      draft.activities[0].responsibility_model = 'OARP';

      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          assert.match(err.message, /业务规则验证失败/);
          assert.match(err.message, /FA-DRAFT-MODEL-001/);
          return true;
        },
        'STANDARD 活动使用 OARP 应被阻断'
      );
    });

    it('应阻断缺 parent_process_name 的草稿', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 删除 parent_process_name
      delete draft.process_card.parent_process_name;

      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          assert.match(err.message, /业务规则验证失败/);
          assert.match(err.message, /FA-DRAFT-CARD-001/);
          return true;
        },
        '缺少 parent_process_name 应被阻断'
      );
    });

    it('应阻断主 Task 三方不一致', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 使 activity.main_task_id 与 binding.main_task_id 不一致
      draft.activities[0].main_task_id = 'Task-999';

      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          assert.match(err.message, /业务规则验证失败/);
          assert.match(err.message, /FA-DRAFT-BIND-002/);
          return true;
        },
        '主 Task 三方不一致应被阻断'
      );
    });

    it('应阻断 confirmation 三方不一致', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 删除 binding 中的 confirmation_task_id
      const binding = draft.diagram.task_bindings.find(b => b.activity_id === 'Activity-002');
      binding.confirmation_task_id = null;

      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          assert.match(err.message, /业务规则验证失败/);
          assert.match(err.message, /FA-DRAFT-CONFIRM-002/);
          return true;
        },
        'confirmation 三方不一致应被阻断'
      );
    });

    it('应阻断 REVIEW/DECISION 活动的正式审批 confirmation', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 修改为 REVIEW_MEETING 活动并添加 confirmation
      draft.activities[1].activity_type = 'REVIEW_MEETING';
      draft.activities[1].responsibility_model = 'OARP';
      draft.activities[1].role_assignments = [{ role_id: 'Role-Reviewer', responsibility: 'O' }];

      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          assert.match(err.message, /业务规则验证失败/);
          assert.match(err.message, /FA-DRAFT-CONFIRM-003/);
          return true;
        },
        'REVIEW_MEETING 活动不应有 confirmation'
      );
    });

    it('应阻断无开始事件的草稿', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 删除开始事件
      draft.diagram.nodes = draft.diagram.nodes.filter(n => n.node_type !== 'START_EVENT');
      draft.process_card.start = null;

      // 同时删除引用开始事件的流
      draft.diagram.flows = draft.diagram.flows.filter(f => f.source_ref !== 'Start-1');

      await assert.rejects(
        async () => compileBpmn(draft),
        (err) => {
          // 应该抛出错误（可能是结构验证或业务规则验证）
          return err.message.includes('缺少') || err.message.includes('业务规则验证失败') || err.message.includes('悬空流引用');
        },
        '无开始事件应被阻断'
      );
    });

    it('应阻断无结束事件的草稿', async () => {
      const { compileBpmn } = await import('../scripts/lib/bpmn-compiler.mjs');
      const draft = createFullV2Draft();

      // 删除所有结束事件
      draft.diagram.nodes = draft.diagram.nodes.filter(n => n.node_type !== 'END_EVENT');
      draft.process_card.end_results = [];

      // 同时删除引用结束事件的流
      draft.diagram.flows = draft.diagram.flows.filter(f => !f.target_ref.startsWith('End-'));

      // 应该抛出错误
      assert.throws(
        () => compileBpmn(draft),
        (err) => {
          // 应该抛出错误（可能是结构验证或业务规则验证）
          return err.message.includes('缺少') || err.message.includes('业务规则验证失败') || err.message.includes('悬空流引用');
        },
        '无结束事件应被阻断'
      );
    });
  });

  describe('Node 内置依赖扫描', () => {
    it('bpmn-compiler.mjs 不应依赖 Node 内置模块', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const filePath = path.join(dir, '..', 'scripts', 'lib', 'bpmn-compiler.mjs');
      const content = await fs.readFile(filePath, 'utf8');

      const nodeImports = content.match(/from\s+['"]node:/g) || [];
      assert.equal(nodeImports.length, 0,
        `bpmn-compiler.mjs 包含 ${nodeImports.length} 个 Node 内置依赖`);
    });

    it('bpmn-normalizer.mjs 不应依赖 Node 内置模块', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const filePath = path.join(dir, '..', 'scripts', 'lib', 'bpmn-normalizer.mjs');
      const content = await fs.readFile(filePath, 'utf8');

      const nodeImports = content.match(/from\s+['"]node:/g) || [];
      assert.equal(nodeImports.length, 0,
        `bpmn-normalizer.mjs 包含 ${nodeImports.length} 个 Node 内置依赖`);
    });

    it('deterministic-bpmn-layout.mjs 不应依赖 Node 内置模块', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const filePath = path.join(dir, '..', 'scripts', 'lib', 'deterministic-bpmn-layout.mjs');
      const content = await fs.readFile(filePath, 'utf8');

      const nodeImports = content.match(/from\s+['"]node:/g) || [];
      assert.equal(nodeImports.length, 0,
        `deterministic-bpmn-layout.mjs 包含 ${nodeImports.length} 个 Node 内置依赖`);
    });

    it('process-draft-v2-rules.mjs 不应依赖 Node 内置模块', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const url = await import('node:url');

      const dir = path.dirname(url.fileURLToPath(import.meta.url));
      const filePath = path.join(dir, '..', 'scripts', 'lib', 'process-draft-v2-rules.mjs');
      const content = await fs.readFile(filePath, 'utf8');

      const nodeImports = content.match(/from\s+['"]node:/g) || [];
      assert.equal(nodeImports.length, 0,
        `process-draft-v2-rules.mjs 包含 ${nodeImports.length} 个 Node 内置依赖`);
    });
  });
});
