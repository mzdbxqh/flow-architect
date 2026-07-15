import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMeetingPackageHtml, validateProcessId } from './lib/meeting-package-html.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bpmn' && args[i + 1]) result.bpmn = args[++i];
    else if (args[i] === '--questions' && args[i + 1]) result.questions = args[++i];
    else if (args[i] === '--title' && args[i + 1]) result.title = args[++i];
    else if (args[i] === '--revision' && args[i + 1]) result.revision = args[++i];
    else if (args[i] === '--package-id' && args[i + 1]) result.packageId = args[++i];
    else if (args[i] === '--process-id' && args[i + 1]) result.processId = args[++i];
    else if (args[i] === '--run-dir' && args[i + 1]) result.runDir = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.output = args[++i];
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

const args = parseArgs(process.argv.slice(2));
if (!args.bpmn || !args.questions || !args.title || !args.revision || !args.packageId || !args.runDir || !args.output) {
  console.error(JSON.stringify({ status: 'FAILED', error: 'Missing required arguments' }));
  process.exit(1);
}

try {
  const bpmnXml = fs.readFileSync(path.resolve(args.bpmn), 'utf8');
  const questions = JSON.parse(fs.readFileSync(path.resolve(args.questions), 'utf8'));

  const runDir = path.resolve(args.runDir);
  fs.mkdirSync(runDir, { recursive: true });

  const outputPath = validatePath(args.output, runDir);
  const tempPath = validatePath(args.output + '.tmp', runDir);

  const processId = validateProcessId(bpmnXml, args.processId || null);

  const html = buildMeetingPackageHtml({
    bpmnXml,
    questions,
    metadata: {
      schema_version: '1.0.0',
      package_id: args.packageId,
      process_id: processId,
      title: args.title,
      revision: args.revision,
      based_on_revision: null,
      runtime_version: '1.0.0',
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
