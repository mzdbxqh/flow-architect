import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRuntimePackage } from './runtime-loader.mjs';

// Use 2020-12 dialect — lazy loaded via runtime loader for isolated Marketplace support
function getAjvConstructor() {
  return requireRuntimePackage('core', 'ajv/dist/2020.js');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMAS_DIR = path.resolve(__dirname, '..', '..', 'references', 'schemas');

const SCHEMA_FILES = {
  result: 'result.schema.json',
  'input-manifest': 'input-manifest.schema.json',
  'architecture-model': 'architecture-model.schema.json',
  'diagram-model': 'diagram-model.schema.json',
  'finding-set': 'finding-set.schema.json',
  'consistency-map': 'consistency-map.schema.json',
  'review-verdict': 'review-verdict.schema.json',
};

// Lazily compile validators
let _validators = null;

function getValidators() {
  if (_validators) return _validators;

  const ajv = new (getAjvConstructor())({ allErrors: true });
  _validators = new Map();

  for (const [kind, filename] of Object.entries(SCHEMA_FILES)) {
    const schemaPath = path.join(SCHEMAS_DIR, filename);
    const raw = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    _validators.set(kind, ajv.compile(raw));
  }

  return _validators;
}

/**
 * Validate a value against a named schema kind.
 *
 * @param {string} kind - One of: result, input-manifest, architecture-model,
 *   diagram-model, finding-set, consistency-map, review-verdict.
 * @param {*} value - The value to validate.
 * @returns {{ valid: boolean, errors: Array|null }} Validation result.
 */
export function validateContract(kind, value) {
  const validators = getValidators();
  const validate = validators.get(kind);

  if (!validate) {
    return {
      valid: false,
      errors: [{ message: `Unknown schema kind: ${kind}` }],
    };
  }

  const valid = validate(value);
  return {
    valid,
    errors: valid ? null : (validate.errors ?? []),
  };
}

/**
 * List all known schema kinds.
 * @returns {string[]}
 */
export function schemaKinds() {
  return Object.keys(SCHEMA_FILES);
}
