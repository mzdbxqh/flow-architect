import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { generateDraftValidatorStandalone, generateBrowserSchemaValidator } from './build-draft-validator-standalone.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'meeting-package', 'src');
const RUNTIME = path.join(ROOT, 'runtime', 'meeting-package');

/**
 * 浏览器端 Schema 校验器替换插件。
 *
 * 会议包 CSP 不允许 unsafe-eval，Ajv 运行时 compile 在浏览器中必失败。
 * 构建时在 Node 侧预编译 standalone 校验器，并将 export-controller 对
 * ./schema-validator.js 的导入重定向到预编译版本（Node 测试不受影响）。
 */
function createPrecompiledValidatorPlugin(workDir) {
  const standalonePath = path.join(workDir, 'draft-validator.standalone.mjs');
  const wrapperPath = path.join(workDir, 'schema-validator.browser.mjs');
  fs.writeFileSync(standalonePath, generateDraftValidatorStandalone());
  fs.writeFileSync(wrapperPath, generateBrowserSchemaValidator('./draft-validator.standalone.mjs'));
  return {
    name: 'fa-precompiled-draft-validator',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/schema-validator\.js$/ }, (args) => {
        if (args.importer.endsWith('export-controller.js')) {
          return { path: wrapperPath };
        }
        return null;
      });
    },
  };
}

export async function buildMeetingEditor({ write = true, check = false } = {}) {
  // workDir 必须位于包内，standalone 代码中的 require("ajv/dist/runtime/*") 才能被 esbuild 解析打包
  const cacheParent = path.join(ROOT, 'node_modules', '.cache');
  fs.mkdirSync(cacheParent, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(cacheParent, 'fa-meeting-build-'));
  try {
    const result = await esbuild.build({
      entryPoints: [path.join(SRC, 'app.js')],
      bundle: true,
      minify: true,
      platform: 'browser',
      target: ['chrome120', 'edge120'],
      write: false,
      outdir: path.join(ROOT, 'temp-build'),
      loader: { '.css': 'css' },
      entryNames: '[name]',
      chunkNames: '[name]',
      assetNames: '[name]',
      plugins: [createPrecompiledValidatorPlugin(workDir)],
    });

  const jsFile = result.outputFiles.find(f => f.path.endsWith('.js'));
  const cssFile = result.outputFiles.find(f => f.path.endsWith('.css'));
  const js = jsFile ? jsFile.text : '';
  const css = cssFile ? cssFile.text : '';
  const shell = fs.readFileSync(path.join(SRC, '..', 'shell.html'), 'utf8');

  const output = { js: Buffer.from(js), css: Buffer.from(css), shell: Buffer.from(shell) };

  if (check) {
    const problems = [];
    try {
      const existingJs = fs.readFileSync(path.join(RUNTIME, 'editor.bundle.js'));
      if (!output.js.equals(existingJs)) problems.push('editor.bundle.js');
    } catch { problems.push('editor.bundle.js'); }
    try {
      const existingCss = fs.readFileSync(path.join(RUNTIME, 'editor.bundle.css'));
      if (!output.css.equals(existingCss)) problems.push('editor.bundle.css');
    } catch { problems.push('editor.bundle.css'); }
    try {
      const existingShell = fs.readFileSync(path.join(RUNTIME, 'shell.html'));
      if (!output.shell.equals(existingShell)) problems.push('shell.html');
    } catch { problems.push('shell.html'); }
    return { ...output, problems };
  }

  if (write) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(path.join(RUNTIME, 'editor.bundle.js'), output.js);
    fs.writeFileSync(path.join(RUNTIME, 'editor.bundle.css'), output.css);
    fs.writeFileSync(path.join(RUNTIME, 'shell.html'), output.shell);
  }

  return { ...output, problems: [] };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const check = process.argv.includes('--check');
  const result = await buildMeetingEditor({ write: !check, check });
  console.log(JSON.stringify({
    status: check && result.problems.length > 0 ? 'DRIFT_DETECTED' : 'SUCCEEDED',
    problems: result.problems,
    sizes: {
      js: result.js.length,
      css: result.css.length,
      shell: result.shell.length,
    },
  }));
  if (check && result.problems.length > 0) process.exit(1);
}
