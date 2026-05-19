const fs = require('fs');
const path = require('path');

const IDENTIFIERS_FILE = path.resolve(__dirname, '..', 'data', 'identifiers.json');
const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function loadIdentifiers(file = IDENTIFIERS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolve(ids, dottedKey) {
  const parts = dottedKey.split('.');
  let v = ids;
  for (const p of parts) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[p];
  }
  return v;
}

function findUnknownPlaceholders(jsonString, ids) {
  const missing = new Set();
  let m;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(jsonString)) !== null) {
    const key = m[1];
    if (resolve(ids, key) == null) missing.add(key);
  }
  return [...missing];
}

function render(template, ids) {
  const json = JSON.stringify(template);
  const missing = findUnknownPlaceholders(json, ids);
  if (missing.length > 0) {
    throw new Error(`Unknown placeholder(s) in template: ${missing.join(', ')}`);
  }
  const rendered = json.replace(PLACEHOLDER_RE, (_, key) => {
    const v = resolve(ids, key);
    // Substitute inside a JSON string literal — JSON-escape the value.
    return JSON.stringify(String(v)).slice(1, -1);
  });
  return JSON.parse(rendered);
}

function renderFile(templatePath, idsPath = IDENTIFIERS_FILE) {
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const ids = loadIdentifiers(idsPath);
  return render(template, ids);
}

module.exports = { render, renderFile, loadIdentifiers, resolve, findUnknownPlaceholders };
