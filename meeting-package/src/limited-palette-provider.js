/**
 * LimitedPaletteProvider - 有限 BPMN 工具箱
 *
 * 只注册 V2 设计允许的元素类型。
 * 所有结构动作通过 eventBus.fire('flowArchitect.paletteAction', { action }) 触发业务事件，
 * 由 app.js 接收后走对话框和结构命令，不直接调用 bpmn-js create.start/globalConnect.start。
 *
 * 允许：L5 活动、确认从 Task、XOR/AND/OR 网关、开始/中间/结束事件、顺序流、泳道、删除。
 * 辅助：手形、框选。
 */

const STRUCTURAL_ENTRIES = {
  'create.l5-task': {
    group: 'activity',
    className: 'bpmn-icon-task',
    title: '新增 L5 活动',
    action: 'create.l5-task',
  },
  'create.confirmation-task': {
    group: 'activity',
    className: 'bpmn-icon-user-task',
    title: '内部确认',
    action: 'create.confirmation-task',
  },
  'create.xor': {
    group: 'gateway',
    className: 'bpmn-icon-gateway-xor',
    title: '排他网关 (XOR)',
    action: 'create.xor',
  },
  'create.and': {
    group: 'gateway',
    className: 'bpmn-icon-gateway-parallel',
    title: '并行网关 (AND)',
    action: 'create.and',
  },
  'create.or': {
    group: 'gateway',
    className: 'bpmn-icon-gateway-inclusive',
    title: '包容网关 (OR)',
    action: 'create.or',
  },
  'create.start': {
    group: 'event',
    className: 'bpmn-icon-start-event-none',
    title: '开始事件',
    action: 'create.start',
  },
  'create.intermediate': {
    group: 'event',
    className: 'bpmn-icon-intermediate-event-none',
    title: '中间事件',
    action: 'create.intermediate',
  },
  'create.end': {
    group: 'event',
    className: 'bpmn-icon-end-event-none',
    title: '结束事件',
    action: 'create.end',
  },
  'create.lane': {
    group: 'collaboration',
    className: 'bpmn-icon-lane',
    title: '泳道',
    action: 'create.lane',
  },
  'connect': {
    group: 'tools',
    className: 'bpmn-icon-connection',
    title: '顺序流',
    action: 'connect',
  },
  'delete': {
    group: 'tools',
    className: 'bpmn-icon-trash',
    title: '删除',
    action: 'delete',
  },
};

export class LimitedPaletteProvider {
  constructor(palette, eventBus, handTool, lassoTool) {
    this._palette = palette;
    this._eventBus = eventBus;
    this._handTool = handTool;
    this._lassoTool = lassoTool;

    palette.registerProvider(this);
  }

  getPaletteEntries() {
    return (element) => {
      const entries = {};

      // Hand tool — 辅助工具，直接调用 bpmn-js 服务
      entries['hand-tool'] = {
        group: 'tools',
        className: 'bpmn-icon-hand-tool',
        title: '拖拽画布',
        action: { click: (event) => this._handTool.activateHand(event) },
      };

      // Lasso tool — 辅助工具，直接调用 bpmn-js 服务
      entries['lasso-tool'] = {
        group: 'tools',
        className: 'bpmn-icon-lasso-tool',
        title: '框选',
        action: { click: (event) => this._lassoTool.activateSelection(event) },
      };

      // 结构动作：全部通过业务事件触发
      for (const [id, config] of Object.entries(STRUCTURAL_ENTRIES)) {
        entries[id] = {
          group: config.group,
          className: config.className,
          title: config.title,
          action: {
            click: () => {
              this._eventBus.fire('flowArchitect.paletteAction', {
                action: config.action,
              });
            },
          },
        };
      }

      return entries;
    };
  }
}

LimitedPaletteProvider.$inject = [
  'palette', 'eventBus', 'handTool', 'lassoTool',
];

// bpmn-js module definition for custom palette
export const LimitedPaletteModule = {
  __init__: ['limitedPaletteProvider'],
  limitedPaletteProvider: ['type', LimitedPaletteProvider],
};
