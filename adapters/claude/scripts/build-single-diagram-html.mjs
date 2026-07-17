import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMeetingPackageHtml } from './lib/meeting-package-html.mjs';
import { compileBpmn } from './lib/bpmn-compiler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const key = {
      '--draft': 'draft',
      '--title': 'title',
      '--revision': 'revision',
      '--package-id': 'packageId',
      '--run-dir': 'runDir',
      '--output': 'output',
    }[flag];
    if (!key) throw new Error(`未知参数：${flag}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`参数缺少值：${flag}`);
    }
    result[key] = args[++i];
  }
  return result;
}

function resolveExistingAncestor(filePath) {
  let current = path.resolve(filePath);
  while (current && current !== path.dirname(current)) {
    try {
      fs.statSync(current);
      return current;
    } catch {
      current = path.dirname(current);
    }
  }
  return current;
}

function validatePath(filePath, runDir) {
  const resolved = path.resolve(runDir, filePath);
  const ancestor = resolveExistingAncestor(resolved);
  const realAncestor = fs.realpathSync(ancestor);
  const realResolved = path.join(realAncestor, resolved.slice(ancestor.length));
  const realRunDir = fs.realpathSync(runDir);
  const relative = path.relative(realRunDir, realResolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path containment violation: ${filePath}`);
  }
  return resolved;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', error: error.message }));
  process.exit(1);
}
if (!args.draft || !args.title || !args.revision || !args.packageId || !args.runDir || !args.output) {
  console.error(JSON.stringify({ status: 'FAILED', error: 'Missing required arguments' }));
  process.exit(1);
}

try {
  const draft = JSON.parse(fs.readFileSync(path.resolve(args.draft), 'utf8'));
  if (draft.schema_version !== '2.0.0') {
    throw new Error('仅支持 schema_version 2.0.0 的流程草稿');
  }

  const runDir = path.resolve(args.runDir);
  fs.mkdirSync(runDir, { recursive: true });

  const outputPath = validatePath(args.output, runDir);
  const tempPath = validatePath(args.output + '.tmp', runDir);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const { xml: bpmnXml } = compileBpmn(draft);

  const html = buildMeetingPackageHtml({
    draft,
    bpmnXml,
    metadata: {
      package_id: args.packageId,
      process_id: draft.process_card.process_id,
      title: args.title,
      revision: args.revision,
      based_on_revision: null,
    },
  });

  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeSync(fd, html);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, outputPath);

  console.log(JSON.stringify({
    status: 'SUCCEEDED',
    output: outputPath,
    size: Buffer.byteLength(html),
  }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', error: error.message }));
  process.exit(2);
}
