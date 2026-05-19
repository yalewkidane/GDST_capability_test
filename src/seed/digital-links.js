const fs = require('fs');
const path = require('path');
const { dl, ensureOk } = require('../http');
const { build } = require('../build/digital-links');

const OVERRIDES_FILE = path.resolve(__dirname, '..', '..', 'data', 'digital-links.json');

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return [];
  const arr = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
  if (!Array.isArray(arr)) throw new Error(`${OVERRIDES_FILE} must be a JSON array.`);
  return arr;
}

function mergeByAnchor(generated, overrides) {
  const map = new Map(generated.map((e) => [e.anchor, e]));
  for (const e of overrides) {
    if (!e?.anchor) continue;
    map.set(e.anchor, e);
  }
  return [...map.values()];
}

async function run() {
  const generated = build();
  const overrides = loadOverrides();
  const entries = mergeByAnchor(generated, overrides);

  if (entries.length === 0) {
    console.log('No digital-link entries to seed (identifiers + overrides both empty).');
    return;
  }

  const client = dl();
  console.log(
    `Seeding ${entries.length} digital-link anchor(s) (${generated.length} generated, ${overrides.length} override(s)) ` +
    `to DL ${client.defaults.baseURL}...`
  );

  let created = 0;
  let updated = 0;
  let i = 0;
  for (const entry of entries) {
    i += 1;
    const res = await client.post('/digitallink/new', entry, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 409) {
      console.log(`  [${i}/${entries.length}] ${entry.anchor} → 409 (already exists, treating as update OK)`);
      updated += 1;
      continue;
    }
    ensureOk(`digital-link [${i}/${entries.length}] anchor=${entry.anchor}`, res);
    console.log(`  [${i}/${entries.length}] ${entry.anchor} → ${res.status}`);
    created += 1;
  }
  console.log(`Done. created=${created}, updated/conflict=${updated}.`);
}

module.exports = { run, loadOverrides, mergeByAnchor };
