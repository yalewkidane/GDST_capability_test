const fs = require('fs');
const path = require('path');
const { webvoc, ensureOk } = require('../http');
const { renderFile } = require('../render');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const TEMPLATE_FILE = path.join(DATA_DIR, 'master-data.template.json');
const STATIC_FILE = path.join(DATA_DIR, 'master-data.json');

function loadEntries() {
  if (fs.existsSync(TEMPLATE_FILE)) {
    return { entries: renderFile(TEMPLATE_FILE), source: TEMPLATE_FILE };
  }
  if (fs.existsSync(STATIC_FILE)) {
    return { entries: JSON.parse(fs.readFileSync(STATIC_FILE, 'utf8')), source: STATIC_FILE };
  }
  throw new Error(`Neither ${TEMPLATE_FILE} nor ${STATIC_FILE} found.`);
}

function describe(entry, fallback) {
  const t = entry?.['@type'] || 'entry';
  const id = entry?.gtin || entry?.globalLocationNumber || fallback;
  return `${t} ${id}`;
}

async function run() {
  const { entries, source } = loadEntries();
  if (!Array.isArray(entries)) {
    throw new Error(`${source} must be a JSON array of vocabulary entries.`);
  }
  if (entries.length === 0) {
    console.log(`No entries in ${source}. Nothing to seed.`);
    return;
  }
  const client = webvoc();
  console.log(`Source: ${source}`);
  console.log(`Seeding ${entries.length} master-data entry/entries to webvoc ${client.defaults.baseURL}/gs1webvoc/capture...`);
  let i = 0;
  for (const entry of entries) {
    i += 1;
    const label = describe(entry, `#${i}`);
    const res = await client.post('/gs1webvoc/capture', entry, {
      headers: { 'Content-Type': 'application/ld+json' },
    });
    if (res.status === 409) {
      console.log(`  [${i}/${entries.length}] ${label} → 409 (already exists, treating as update OK)`);
      continue;
    }
    ensureOk(`master-data [${i}/${entries.length}] ${label}`, res);
    console.log(`  [${i}/${entries.length}] ${label} → ${res.status}`);
  }
  console.log('Done.');
}

module.exports = { run, loadEntries };
