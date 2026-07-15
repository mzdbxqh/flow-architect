#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, schemaKinds } from './lib/contract-validation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  process.stderr.write(
    'Usage: node scripts/validate-contract.mjs --kind <kind> --input <path>\n\n' +
    `Kinds: ${schemaKinds().join(', ')}\n`
  );
  process.exit(2);
}

// Parse args
const args = process.argv.slice(2);
let kind = null;
let inputPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--kind' && i + 1 < args.length) {
    kind = args[++i];
  } else if (args[i] === '--input' && i + 1 < args.length) {
    inputPath = args[++i];
  } else if (args[i] === '--help' || args[i] === '-h') {
    usage();
  }
}

if (!kind || !inputPath) {
  usage();
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
  process.stderr.write(`File not found: ${resolvedInput}\n`);
  process.exit(1);
}

let value;
try {
  value = JSON.parse(fs.readFileSync(resolvedInput, 'utf8'));
} catch (err) {
  process.stderr.write(`Failed to parse JSON: ${err.message}\n`);
  process.exit(1);
}

const result = validateContract(kind, value);

if (result.valid) {
  process.stdout.write(`${kind}: valid\n`);
} else {
  for (const err of result.errors) {
    const loc = err.instancePath || '/';
    process.stderr.write(`${kind} ${loc}: ${err.message}\n`);
  }
  process.exit(1);
}
