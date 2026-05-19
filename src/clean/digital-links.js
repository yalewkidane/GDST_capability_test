const { dl } = require('../http');
const { build } = require('../build/digital-links');

const LINK_TYPES = ['gs1:epcis', 'gs1:masterData'];

async function run() {
  const entries = build();
  const client = dl();
  console.log(`Cleaning ${entries.length} anchor(s) × ${LINK_TYPES.length} linkType(s) from DL ${client.defaults.baseURL}...`);

  let deleted = 0;
  let notFound = 0;
  let errors = [];
  let i = 0;
  for (const entry of entries) {
    i += 1;
    const path = `/digitallink${entry.anchor}`;
    for (const linkType of LINK_TYPES) {
      const res = await client.delete(path, { params: { linkType } });
      const tag = `[${i}/${entries.length}] DELETE ${entry.anchor} linkType=${linkType}`;
      if (res.status >= 200 && res.status < 300) {
        deleted += 1;
        console.log(`  ${tag} → ${res.status}`);
      } else if (res.status === 404) {
        notFound += 1;
        console.log(`  ${tag} → 404 (already gone)`);
      } else {
        const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        errors.push({ anchor: entry.anchor, linkType, status: res.status, body });
        console.log(`  ${tag} → ${res.status} ${res.statusText} ${body}`);
      }
    }
  }
  console.log(`Done. deleted=${deleted}, notFound=${notFound}, errors=${errors.length}.`);
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

module.exports = { run, LINK_TYPES };
