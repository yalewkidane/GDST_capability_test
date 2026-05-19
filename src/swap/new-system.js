const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, '.env');
const IDS_FILE = path.join(ROOT, 'data', 'identifiers.json');
const MD_FILE  = path.join(ROOT, 'data', 'master-data.template.json');

function backupIfMissing(file) {
  const v1 = file + '.v1';
  // Both .env.v1 and *.json.v1 — keep the same suffix convention.
  if (fs.existsSync(v1)) {
    return { v1, copied: false };
  }
  fs.copyFileSync(file, v1);
  return { v1, copied: true };
}

function buildReplacements(profile) {
  const entries = [];
  for (const [from, to] of Object.entries(profile.party_prefix_map || {})) {
    entries.push([from, to]);
  }
  for (const [from, to] of Object.entries(profile.product_class_map || {})) {
    entries.push([from, to]);
  }
  // Reject ambiguous duplicate `from` keys
  const seen = new Set();
  for (const [from] of entries) {
    if (seen.has(from)) {
      throw new Error(`Profile has duplicate replacement source: "${from}". Pick one map only.`);
    }
    seen.add(from);
  }
  // Longest-match-first to avoid sub-prefix collisions (88000197 vs 8800019).
  entries.sort((a, b) => b[0].length - a[0].length);
  return entries;
}

function applyReplacements(value, replacements) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const [from, to] of replacements) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
    }
  }
  return out;
}

function freshUuidUrn() {
  return 'urn:uuid:' + crypto.randomUUID();
}

function rewriteIdentifiers(ids, profile, replacements) {
  const counts = { events: 0, parties: 0, locations: 0, products: 0, product_lots: 0, containers: 0 };

  // Events: regenerate UUIDs only if requested.
  if (profile.options?.regenerate_event_uuids) {
    for (const k of Object.keys(ids.events || {})) {
      ids.events[k] = freshUuidUrn();
      counts.events += 1;
    }
  }

  for (const section of ['parties', 'locations', 'products', 'product_lots']) {
    if (!ids[section]) continue;
    for (const [k, v] of Object.entries(ids[section])) {
      const next = applyReplacements(v, replacements);
      if (next !== v) {
        ids[section][k] = next;
        counts[section] += 1;
      }
    }
  }

  // Container SSCC: explicit override.
  if (ids.containers?.container_aqua && profile.container_sscc) {
    ids.containers.container_aqua = profile.container_sscc;
    counts.containers += 1;
  }

  return counts;
}

function rewriteMasterData(md, profile, replacements) {
  // URN substitution via stringify→replace→parse — catches any string-embedded URNs.
  let json = JSON.stringify(md);
  for (const [from, to] of replacements) {
    if (json.includes(from)) json = json.split(from).join(to);
  }
  let out = JSON.parse(json);

  // Optional rename of display-name fields (case-by-case to avoid double-prefix).
  if (profile.options?.rename_master_data) {
    const NAME_FIELDS = ['productName', 'organizationName', 'gs1:physicalLocationName', 'name'];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (NAME_FIELDS.includes(k) && Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === 'object' && typeof item['@value'] === 'string') {
              if (!item['@value'].startsWith('New ')) {
                item['@value'] = 'New ' + item['@value'];
              }
            }
          }
        } else {
          visit(v);
        }
      }
    };
    visit(out);
  }
  return out;
}

function rewriteEnv(envText, profile) {
  const updates = {
    SOLUTION_NAME:                       profile.solution.name,
    SOLUTION_VERSION:                    profile.solution.version,
    SOLUTION_PGLN:                       profile.solution.pgln,
    SOLUTION_PROVIDER_GENERATED_EPCS:    profile.container_sscc,
  };
  const lines = envText.split('\n');
  const diffs = [];
  const seenKeys = new Set();
  const out = lines.map((line) => {
    for (const [key, newVal] of Object.entries(updates)) {
      const re = new RegExp('^' + key + '=(.*)$');
      const m = line.match(re);
      if (m) {
        seenKeys.add(key);
        if (m[1] !== newVal) {
          diffs.push({ key, from: m[1], to: newVal });
          return `${key}=${newVal}`;
        }
      }
    }
    return line;
  });
  // Append missing keys at the end (shouldn't happen normally, but defensive).
  for (const [key, newVal] of Object.entries(updates)) {
    if (!seenKeys.has(key)) {
      out.push(`${key}=${newVal}`);
      diffs.push({ key, from: '(missing)', to: newVal });
    }
  }
  return { text: out.join('\n'), diffs };
}

function gs1CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < first12.length; i++) {
    const d = parseInt(first12[i], 10);
    sum += (i % 2 === 0) ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function validatePglnCheckDigit(pgln) {
  if (!/^\d{13}$/.test(pgln)) {
    throw new Error(`profile.solution.pgln must be 13 digits. Got "${pgln}" (length ${pgln.length}).`);
  }
  const expected = gs1CheckDigit(pgln.slice(0, 12));
  const actual = parseInt(pgln[12], 10);
  if (actual !== expected) {
    const corrected = pgln.slice(0, 12) + expected;
    throw new Error(
      `profile.solution.pgln has invalid GS1 check digit. Expected ${expected}, got ${actual}. ` +
      `Correct PGLN for "${pgln.slice(0, 12)}" is "${corrected}".`
    );
  }
}

function validateProfile(profile) {
  if (!profile.solution?.name)    throw new Error('profile.solution.name is required');
  if (!profile.solution?.version) throw new Error('profile.solution.version is required');
  if (!profile.solution?.pgln)    throw new Error('profile.solution.pgln is required');
  if (!profile.container_sscc)    throw new Error('profile.container_sscc is required');
  if (typeof profile.party_prefix_map !== 'object')   throw new Error('profile.party_prefix_map is required (object)');
  if (typeof profile.product_class_map !== 'object')  throw new Error('profile.product_class_map is required (object)');
  validatePglnCheckDigit(profile.solution.pgln);
}

async function run(profilePath) {
  if (!profilePath) throw new Error('Usage: new-system <profile.json>');
  const abs = path.resolve(process.cwd(), profilePath);
  if (!fs.existsSync(abs)) throw new Error(`Profile not found: ${abs}`);
  const profile = JSON.parse(fs.readFileSync(abs, 'utf8'));
  validateProfile(profile);

  const replacements = buildReplacements(profile);
  console.log(`Loaded profile from ${abs}`);
  console.log(`  ${replacements.length} URN replacement rule(s)`);

  // 1. Backups (idempotent)
  const backups = [ENV_FILE, IDS_FILE, MD_FILE].map((f) => ({ file: f, ...backupIfMissing(f) }));
  console.log('\nBackups:');
  for (const b of backups) {
    console.log(`  ${b.file} → ${b.v1}  ${b.copied ? '(copied)' : '(already existed, kept)'}`);
  }

  // 2. Rewrite identifiers.json
  const ids = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));
  const idCounts = rewriteIdentifiers(ids, profile, replacements);
  fs.writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + '\n');

  // 3. Rewrite master-data.template.json
  const md = JSON.parse(fs.readFileSync(MD_FILE, 'utf8'));
  const newMd = rewriteMasterData(md, profile, replacements);
  fs.writeFileSync(MD_FILE, JSON.stringify(newMd, null, 2) + '\n');

  // 4. Rewrite .env
  const envText = fs.readFileSync(ENV_FILE, 'utf8');
  const { text: newEnv, diffs: envDiffs } = rewriteEnv(envText, profile);
  fs.writeFileSync(ENV_FILE, newEnv);

  // 5. Summary
  console.log('\nidentifiers.json changes:');
  for (const [section, n] of Object.entries(idCounts)) {
    if (n > 0) console.log(`  ${section.padEnd(14)} ${n} value(s) updated`);
  }
  console.log('\nmaster-data.template.json:');
  console.log(`  URN substitutions applied via stringify→replace→parse`);
  if (profile.options?.rename_master_data) {
    console.log(`  display names prefixed with "New " where missing`);
  }
  console.log('\n.env changes:');
  for (const d of envDiffs) {
    console.log(`  ${d.key}: "${d.from}" → "${d.to}"`);
  }
  console.log('\nDone. Run render:digital-links / render:master-data / render:events to verify.');
}

module.exports = { run, buildReplacements, applyReplacements, rewriteIdentifiers, rewriteMasterData, rewriteEnv };
