/**
 * LimitedPaletteProvider - 有限 BPMN 工具箱
 *
 * 只注册 V2 设计允许的元素类型。
 * 所有结构动作通过 eventBus.fire('flowArchitect.paletteAction', { action }) 触发业务事件，
 * 由 app.js 接收后走对话框和结构命令，不直接调用 bpmn-js create.start/globalConnect.start。
 *
 * 允许：L5 活动、确认从 Task、XOR/AND/OR 网关、开始/中间/结束事件、顺序流、泳道、删除。
 * 辅助：手形、框选。
 *
 * 图标：bpmn-icon-* 字体无法在本环境加载（CSP font-src 'none'，bundle 不携带字体），
 * 因此每个条目通过 imageUrl 提供内联 SVG data URI 图标（img-src data: 允许）。
 */

// ─── 内联 SVG 图标 ──────────────────────────────────────────────────────

const ICON_COLOR = '#3c4043';

function svgIcon(inner, { filled = false } = {}) {
  const fill = filled ? ICON_COLOR : 'none';
  const stroke = filled ? 'none' : ICON_COLOR;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PALETTE_ICONS = {
  'create.l5-task': svgIcon('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  'create.confirmation-task': svgIcon('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><circle cx="12" cy="10" r="2.2"/><path d="M8 16.2c.8-2 2.3-3 4-3s3.2 1 4 3"/>'),
  'create.xor': svgIcon('<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  'create.and': svgIcon('<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/><path d="M12 8.5v7M8.5 12h7"/>'),
  'create.or': svgIcon('<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z"/><circle cx="12" cy="12" r="3.5"/>'),
  'create.start': svgIcon('<circle cx="12" cy="12" r="8.5"/>'),
  'create.intermediate': svgIcon('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/>'),
  'create.end': svgIcon('<circle cx="12" cy="12" r="8.5" stroke-width="3.4"/>'),
  'create.lane': svgIcon('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M8 4v16M3 12h5"/>'),
  'connect': svgIcon('<path d="M4 19 19 5"/><path d="M12.5 5H19v6.5"/>'),
  'delete': svgIcon('<path d="M4 6.5h16M9.5 6V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6M6.5 6.5l1 12a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12"/>'),
  'hand-tool': svgIcon('<path d="M12 2.5v19M2.5 12h19"/><path d="m15 5.5-3-3-3 3M15 18.5l-3 3-3-3M5.5 9l-3 3 3 3M18.5 9l3 3-3 3"/>'),
  'lasso-tool': svgIcon('<rect x="3" y="3" width="13" height="13" rx="2" stroke-dasharray="3 2.5"/><path d="M13.5 13.5 20 20l-5.2 1.2L13.5 13.5Z" fill="#3c4043" stroke="none"/>'),
};

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
        imageUrl: PALETTE_ICONS['hand-tool'],
        action: { click: (event) => this._handTool.activateHand(event) },
      };

      // Lasso tool — 辅助工具，直接调用 bpmn-js 服务
      entries['lasso-tool'] = {
        group: 'tools',
        className: 'bpmn-icon-lasso-tool',
        title: '框选',
        imageUrl: PALETTE_ICONS['lasso-tool'],
        action: { click: (event) => this._lassoTool.activateSelection(event) },
      };

      // 结构动作：全部通过业务事件触发
      for (const [id, config] of Object.entries(STRUCTURAL_ENTRIES)) {
        entries[id] = {
          group: config.group,
          className: config.className,
          title: config.title,
          imageUrl: PALETTE_ICONS[id],
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
