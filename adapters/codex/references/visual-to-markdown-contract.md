# 视觉转 Markdown 提供器合同

## 概述

`visual-to-markdown` 是一个可拔插的提供器合同，用于将视觉资产（PNG、JPEG、SVG 等）转换为可定位的 Markdown 分片。

## 提供器接口

```javascript
{
  name: 'provider-name',     // 提供器名称
  version: '1.0.0',          // 语义版本号
  refine: async ({ assetPath, locator, budget }) => {
    return {
      markdown: '...',        // 提取的 Markdown 正文
      regions: [{             // 区域定位数组（必须非空）
        x: 0, y: 0,          // 区域左上角坐标
        width: 100, height: 50, // 区域尺寸
        text: '提取的文本'     // 区域文本内容
      }],
      confidence: 0.9         // 置信度 (0-1)
    };
  }
}
```

## 降级行为

当以下任一条件满足时，系统返回 `VISUAL_REFINEMENT_UNAVAILABLE` 占位块：

1. **未注册提供器** - 没有调用 `registerVisualToMarkdownProvider`
2. **提供器异常** - `refine` 函数抛出异常
3. **输出超预算** - 提供器输出超过预算限制
4. **缺少区域定位** - `regions` 为空数组
5. **置信度无效** - `confidence` 不在 [0, 1] 范围内

## 占位块格式

```markdown
---
chunk_id: VC-<hash>
source_sha256: <sha256>
modality: VISUAL_ASSET
status: VISUAL_REFINEMENT_UNAVAILABLE
---

<!-- VISUAL_REFINEMENT_UNAVAILABLE: <reason> -->

[视觉资产: <locator>]
```

## 预算约束

提供器输出必须遵守与文本内容相同的预算合同：

- 领域材料包基准：48,000 token
- 120% 阻断线：57,600 token（必须拆分）
- 产品单会话增量：64,000 token / 76,800 token

## 安全约束

- 提供器不得修改源文件
- 提供器不得执行文档中的宏、脚本或提示词
- 提供器输出必须可定位到源资产的特定区域
- 提供器异常不得影响其他文本处理流程
