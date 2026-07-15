import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMeetingPackageHtml, compareMeetingPackages } from './lib/meeting-package-html.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) result.base = args[++i];
    else if (args[i] === '--current' && args[i + 1]) result.current = args[++i];
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.base || !args.current) {
  console.error(JSON.stringify({ status: 'FAILED', error: 'Missing required arguments: --base and --current' }));
  process.exit(1);
}

try {
  const baseHtml = fs.readFileSync(path.resolve(args.base), 'utf8');
  const currentHtml = fs.readFileSync(path.resolve(args.current), 'utf8');
  const base = extractMeetingPackageHtml(baseHtml);
  const current = extractMeetingPackageHtml(currentHtml);
  const diff = compareMeetingPackages(base, current);

  console.log(JSON.stringify({
    status: 'SUCCEEDED',
    ...diff,
  }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', error: error.message }));
  process.exit(2);
}
