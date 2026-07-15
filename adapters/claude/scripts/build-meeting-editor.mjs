import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'meeting-package', 'src');
const RUNTIME = path.join(ROOT, 'runtime', 'meeting-package');

export async function buildMeetingEditor({ write = true, check = false } = {}) {
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
  });

  const jsFile = result.outputFiles.find(f => f.path.endsWith('.js'));
  const cssFile = result.outputFiles.find(f => f.path.endsWith('.css'));
  const js = jsFile ? jsFile.text : '';
  const css = cssFile ? cssFile.text : '';
  const shell = fs.readFileSync(path.join(SRC, '..', 'shell.html'), 'utf8');

  const output = { js: Buffer.from(js), css: Buffer.from(css), shell: Buffer.from(shell) };

  if (write) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    const problems = [];

    if (check) {
      const existingJs = fs.readFileSync(path.join(RUNTIME, 'editor.bundle.js'));
      const existingCss = fs.readFileSync(path.join(RUNTIME, 'editor.bundle.css'));
      const existingShell = fs.readFileSync(path.join(RUNTIME, 'shell.html'));
      if (!output.js.equals(existingJs)) problems.push('editor.bundle.js');
      if (!output.css.equals(existingCss)) problems.push('editor.bundle.css');
      if (!output.shell.equals(existingShell)) problems.push('shell.html');
    }

    if (!check || problems.length > 0) {
      fs.writeFileSync(path.join(RUNTIME, 'editor.bundle.js'), output.js);
      fs.writeFileSync(path.join(RUNTIME, 'editor.bundle.css'), output.css);
      fs.writeFileSync(path.join(RUNTIME, 'shell.html'), output.shell);
    }

    return { ...output, problems };
  }

  return { ...output, problems: [] };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const check = process.argv.includes('--check');
  const result = await buildMeetingEditor({ write: true, check });
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
