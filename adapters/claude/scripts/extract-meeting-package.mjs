import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMeetingPackageHtml } from './lib/meeting-package-html.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--html' && args[i + 1]) result.html = args[++i];
    else if (args[i] === '--output' && args[i + 1]) result.output = args[++i];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.html || !args.output) {
  console.error(JSON.stringify({ status: 'FAILED', error: 'Missing required arguments: --html and --output' }));
  process.exit(1);
}

try {
  const html = fs.readFileSync(path.resolve(args.html), 'utf8');
  const payload = extractMeetingPackageHtml(html);

  fs.writeFileSync(path.resolve(args.output), JSON.stringify(payload, null, 2) + '\n');

  console.log(JSON.stringify({
    status: 'SUCCEEDED',
    output: path.resolve(args.output),
    revision: payload.metadata.revision,
  }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', error: error.message }));
  process.exit(2);
}
