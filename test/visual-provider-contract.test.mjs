import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('视觉转 Markdown 合同', () => {
  it('无提供器时返回 VISUAL_REFINEMENT_UNAVAILABLE 且保持占位 chunk', async () => {
    const { refineVisualAsset, resetProviders } = await import('../scripts/lib/visual-to-markdown-provider.mjs');
    resetProviders();

    const result = await refineVisualAsset({
      assetPath: '/tmp/test.png',
      locator: { page: null, slide: 1, sheet: null, range: null, line_start: null, line_end: null },
      budget: { limit: 48000, estimated_tokens: 0 },
    });

    assert.equal(result.status, 'VISUAL_REFINEMENT_UNAVAILABLE');
    assert.ok(result.markdown, '应返回占位 markdown');
    assert.ok(result.markdown.includes('VISUAL_REFINEMENT_UNAVAILABLE'), '占位应包含不可用标记');
    assert.ok(result.chunk_id, '应保持 chunk_id');
    assert.ok(result.source_sha256, '应有 source_sha256');
  });

  it('注册提供器后只替换目标 chunk 正文', async () => {
    const { registerVisualToMarkdownProvider, refineVisualAsset, resetProviders } = await import('../scripts/lib/visual-to-markdown-provider.mjs');
    resetProviders();

    // 注册测试提供器
    registerVisualToMarkdownProvider({
      name: 'test-provider',
      version: '1.0.0',
      async refine({ assetPath, locator, budget }) {
        return {
          markdown: '# 提取的图表内容\n\n这是提供器提取的文本。',
          regions: [{ x: 0, y: 0, width: 100, height: 50, text: '提取的图表内容' }],
          confidence: 0.9,
        };
      },
    });

    const result = await refineVisualAsset({
      assetPath: '/tmp/test.png',
      locator: { page: null, slide: 1, sheet: null, range: null, line_start: null, line_end: null },
      budget: { limit: 48000, estimated_tokens: 0 },
    });

    assert.equal(result.status, 'REFINED');
    assert.ok(result.markdown.includes('提取的图表内容'), '应包含提供器输出');
    assert.ok(result.regions && result.regions.length > 0, '应包含区域定位');
    assert.ok(typeof result.confidence === 'number', '应包含置信度');
    assert.ok(result.source_sha256, '应有 source_sha256');
    assert.ok(result.context_budget, '应有 context_budget');
  });

  it('提供器结果超预算时拒绝验收', async () => {
    const { registerVisualToMarkdownProvider, refineVisualAsset, resetProviders } = await import('../scripts/lib/visual-to-markdown-provider.mjs');
    resetProviders();

    registerVisualToMarkdownProvider({
      name: 'test-overflow',
      version: '1.0.0',
      async refine() {
        return {
          markdown: '中'.repeat(100000), // 超大输出
          regions: [],
          confidence: 0.5,
        };
      },
    });

    const result = await refineVisualAsset({
      assetPath: '/tmp/huge.png',
      locator: { page: 1, slide: null, sheet: null, range: null, line_start: null, line_end: null },
      budget: { limit: 1000, estimated_tokens: 0 },
    });

    // 超预算时应降级为不可用
    assert.equal(result.status, 'VISUAL_REFINEMENT_UNAVAILABLE');
  });

  it('提供器结果缺少区域定位时拒绝验收', async () => {
    const { registerVisualToMarkdownProvider, refineVisualAsset, resetProviders } = await import('../scripts/lib/visual-to-markdown-provider.mjs');
    resetProviders();

    registerVisualToMarkdownProvider({
      name: 'test-no-regions',
      version: '1.0.0',
      async refine() {
        return {
          markdown: '一些内容',
          regions: [], // 缺少区域
          confidence: 0.5,
        };
      },
    });

    const result = await refineVisualAsset({
      assetPath: '/tmp/test.png',
      locator: { page: null, slide: 1, sheet: null, range: null, line_start: null, line_end: null },
      budget: { limit: 48000, estimated_tokens: 0 },
    });

    // 缺少区域时应降级
    assert.equal(result.status, 'VISUAL_REFINEMENT_UNAVAILABLE');
  });

  it('提供器异常时稳定降级不崩溃', async () => {
    const { registerVisualToMarkdownProvider, refineVisualAsset, resetProviders } = await import('../scripts/lib/visual-to-markdown-provider.mjs');
    resetProviders();

    registerVisualToMarkdownProvider({
      name: 'test-error',
      version: '1.0.0',
      async refine() {
        throw new Error('提供器内部错误');
      },
    });

    const result = await refineVisualAsset({
      assetPath: '/tmp/error.png',
      locator: { page: 1, slide: null, sheet: null, range: null, line_start: null, line_end: null },
      budget: { limit: 48000, estimated_tokens: 0 },
    });

    // 异常时应降级
    assert.equal(result.status, 'VISUAL_REFINEMENT_UNAVAILABLE');
    assert.ok(result.markdown, '应返回占位 markdown');
  });
});
