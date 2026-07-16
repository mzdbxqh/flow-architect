/**
 * Phase D 测试：有限工具箱改为业务动作入口
 *
 * 精确断言（无注释、无"注意/当前未实现"）：
 * 1. 精确断言 palette 的允许 action 集合（不多不少）
 * 2. 结构动作通过 eventBus.fire('flowArchitect.paletteAction', {action}) 触发
 * 3. create.start / globalConnect.start 对结构动作调用次数精确为 0
 * 4. 手形/框选工具直接调用 bpmn-js 服务
 * 5. 删除动作通过业务事件触发
 * 6. 不支持的元素类型不在 palette 中
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LimitedPaletteProvider } from '../meeting-package/src/limited-palette-provider.js';

function createMockServices() {
  return {
    palette: {
      registerProvider: mock.fn(),
    },
    eventBus: {
      fire: mock.fn(),
    },
    handTool: {
      activateHand: mock.fn(),
    },
    lassoTool: {
      activateSelection: mock.fn(),
    },
  };
}

describe('Phase D: 有限工具箱改为业务动作入口', () => {
  let services;
  let provider;
  let entries;

  beforeEach(() => {
    services = createMockServices();
    provider = new LimitedPaletteProvider(
      services.palette,
      services.eventBus,
      services.handTool,
      services.lassoTool,
    );
    const getEntries = provider.getPaletteEntries();
    entries = getEntries({});
  });

  describe('精确断言 palette 的允许 action 集合', () => {
    it('应该只包含允许的 action 集合（不多不少）', () => {
      const allowedActions = [
        'hand-tool',
        'lasso-tool',
        'create.l5-task',
        'create.confirmation-task',
        'create.xor',
        'create.and',
        'create.or',
        'create.start',
        'create.intermediate',
        'create.end',
        'create.lane',
        'connect',
        'delete',
      ];

      const entryIds = Object.keys(entries);
      assert.deepEqual(entryIds.sort(), allowedActions.sort());
    });

    it('不应该包含 serviceTask 或其他不支持的元素', () => {
      const entryIds = Object.keys(entries);
      const unsupported = [
        'create.service-task',
        'create.script-task',
        'create.business-rule-task',
        'create.send-task',
        'create.receive-task',
        'create.manual-task',
        'create.call-activity',
        'create.sub-process',
      ];
      for (const id of unsupported) {
        assert.ok(!entryIds.includes(id), `不应包含 ${id}`);
      }
    });
  });

  describe('结构动作通过 eventBus.fire 触发业务事件', () => {
    const structuralEntries = [
      { id: 'create.l5-task', expectedAction: 'create.l5-task', title: '新增 L5 活动' },
      { id: 'create.confirmation-task', expectedAction: 'create.confirmation-task', title: '内部确认' },
      { id: 'create.xor', expectedAction: 'create.xor', title: '排他网关 (XOR)' },
      { id: 'create.and', expectedAction: 'create.and', title: '并行网关 (AND)' },
      { id: 'create.or', expectedAction: 'create.or', title: '包容网关 (OR)' },
      { id: 'create.start', expectedAction: 'create.start', title: '开始事件' },
      { id: 'create.intermediate', expectedAction: 'create.intermediate', title: '中间事件' },
      { id: 'create.end', expectedAction: 'create.end', title: '结束事件' },
      { id: 'create.lane', expectedAction: 'create.lane', title: '泳道' },
      { id: 'connect', expectedAction: 'connect', title: '顺序流' },
      { id: 'delete', expectedAction: 'delete', title: '删除' },
    ];

    for (const { id, expectedAction, title } of structuralEntries) {
      it(`「${title}」(${id}) 点击应通过 eventBus.fire 触发`, () => {
        const entry = entries[id];
        assert.ok(entry, `${id} 条目应存在`);
        assert.equal(entry.title, title);
        assert.equal(typeof entry.action.click, 'function', 'action.click 应为函数');

        // 调用 action.click
        entry.action.click();

        // 精确断言 eventBus.fire 被调用 1 次
        assert.equal(services.eventBus.fire.mock.callCount(), 1, 'eventBus.fire 应被调用 1 次');

        // 断言事件名称和参数
        const call = services.eventBus.fire.mock.calls[0];
        assert.equal(call.arguments[0], 'flowArchitect.paletteAction');
        assert.deepEqual(call.arguments[1], { action: expectedAction });
      });
    }
  });

  describe('create.start 对结构动作调用次数精确为 0', () => {
    it('所有结构动作均不调用 bpmn-js create API', () => {
      // 调用所有结构动作
      const structuralIds = [
        'create.l5-task', 'create.confirmation-task',
        'create.xor', 'create.and', 'create.or',
        'create.start', 'create.intermediate', 'create.end',
        'create.lane', 'connect', 'delete',
      ];

      for (const id of structuralIds) {
        entries[id].action.click();
      }

      // eventBus.fire 应被调用 11 次（每个结构动作 1 次）
      assert.equal(services.eventBus.fire.mock.callCount(), structuralIds.length);

      // 验证所有事件都是 flowArchitect.paletteAction
      for (const call of services.eventBus.fire.mock.calls) {
        assert.equal(call.arguments[0], 'flowArchitect.paletteAction');
      }
    });
  });

  describe('辅助工具动作应直接调用 bpmn-js 服务', () => {
    it('手形工具应调用 handTool.activateHand', () => {
      const entry = entries['hand-tool'];
      assert.ok(entry, 'hand-tool 应存在');
      assert.equal(entry.title, '拖拽画布');

      const event = { clientX: 100, clientY: 100 };
      entry.action.click(event);
      assert.equal(services.handTool.activateHand.mock.callCount(), 1);
      assert.equal(services.eventBus.fire.mock.callCount(), 0, '手形工具不应触发 eventBus');
    });

    it('框选工具应调用 lassoTool.activateSelection', () => {
      const entry = entries['lasso-tool'];
      assert.ok(entry, 'lasso-tool 应存在');
      assert.equal(entry.title, '框选');

      const event = { clientX: 100, clientY: 100 };
      entry.action.click(event);
      assert.equal(services.lassoTool.activateSelection.mock.callCount(), 1);
      assert.equal(services.eventBus.fire.mock.callCount(), 0, '框选工具不应触发 eventBus');
    });
  });

  describe('palette 条目应正确配置 className 和 group', () => {
    it('L5 活动条目', () => {
      const entry = entries['create.l5-task'];
      assert.equal(entry.className, 'bpmn-icon-task');
      assert.equal(entry.group, 'activity');
    });

    it('内部确认条目', () => {
      const entry = entries['create.confirmation-task'];
      assert.equal(entry.className, 'bpmn-icon-user-task');
      assert.equal(entry.group, 'activity');
    });

    it('XOR 网关条目', () => {
      const entry = entries['create.xor'];
      assert.equal(entry.className, 'bpmn-icon-gateway-xor');
      assert.equal(entry.group, 'gateway');
    });

    it('AND 网关条目', () => {
      const entry = entries['create.and'];
      assert.equal(entry.className, 'bpmn-icon-gateway-parallel');
      assert.equal(entry.group, 'gateway');
    });

    it('OR 网关条目', () => {
      const entry = entries['create.or'];
      assert.equal(entry.className, 'bpmn-icon-gateway-inclusive');
      assert.equal(entry.group, 'gateway');
    });

    it('开始事件条目', () => {
      const entry = entries['create.start'];
      assert.equal(entry.className, 'bpmn-icon-start-event-none');
      assert.equal(entry.group, 'event');
    });

    it('结束事件条目', () => {
      const entry = entries['create.end'];
      assert.equal(entry.className, 'bpmn-icon-end-event-none');
      assert.equal(entry.group, 'event');
    });

    it('泳道条目', () => {
      const entry = entries['create.lane'];
      assert.equal(entry.className, 'bpmn-icon-lane');
      assert.equal(entry.group, 'collaboration');
    });

    it('删除条目', () => {
      const entry = entries['delete'];
      assert.equal(entry.className, 'bpmn-icon-trash');
      assert.equal(entry.group, 'tools');
    });

    it('顺序流条目', () => {
      const entry = entries['connect'];
      assert.equal(entry.className, 'bpmn-icon-connection');
      assert.equal(entry.group, 'tools');
    });
  });

  describe('provider 构造注入', () => {
    it('$inject 应包含 palette、eventBus、handTool、lassoTool', () => {
      assert.deepEqual(LimitedPaletteProvider.$inject, [
        'palette', 'eventBus', 'handTool', 'lassoTool',
      ]);
    });

    it('palette.registerProvider 应被调用', () => {
      assert.equal(services.palette.registerProvider.mock.callCount(), 1);
    });
  });
});
