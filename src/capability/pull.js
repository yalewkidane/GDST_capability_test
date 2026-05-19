const fs = require('fs');
const path = require('path');
const { capability, dl, webvoc, epcis, ensureOk } = require('../http');
const state = require('../state');
const { traceBack, allUrnsFromEvent } = require('../traceback');
const { mirrorEntity } = require('./mirror');
const { parentClassUrn } = require('../urn');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'out');

async function run() {
  const uuid = state.requireField('uuid');
  const sourceEpcs = state.requireField('sourceEpcs');
  if (!Array.isArray(sourceEpcs) || sourceEpcs.length === 0) {
    throw new Error('State has no sourceEpcs. Re-run `start`.');
  }
  const startEpc = sourceEpcs[0];

  const capClient = capability({ uuid });
  const localEpcis = epcis();
  const localDl = dl();
  const localWebvoc = webvoc();

  console.log(`Using UUID ${uuid}, source EPC ${startEpc}`);

  // 2a. Initial DL lookup against the capability tool (gs1:epcis)
  const dlPath = `/digitallink/00/${encodeURIComponent(startEpc)}?linkType=gs1:epcis`;
  console.log(`GET ${capClient.defaults.baseURL}${dlPath}`);
  const dlRes = await capClient.get(dlPath);
  ensureOk('capability digital-link lookup', dlRes);
  console.log(`  → ${JSON.stringify(dlRes.data)}`);

  // ---- Counters for the recursive walk
  const capturedEventIds = new Set();
  const seenUrns = new Set();
  let capturedCount = 0;
  let skippedEventCount = 0;
  let mirroredCount = 0;
  let mirrorSkipped = 0;

  // 2b. Helper: capture one event into our EPCIS
  async function captureLocally({ doc, events }) {
    const context = doc?.['@context'];
    for (const ev of events) {
      const id = ev?.eventID;
      if (!id) {
        skippedEventCount += 1;
        continue;
      }
      if (capturedEventIds.has(id)) {
        skippedEventCount += 1;
        continue;
      }
      const payload = { ...ev, '@context': context };
      const res = await localEpcis.post('/epcis/v2/events', payload, {
        headers: { 'Content-Type': 'application/json' },
      });
      ensureOk(`local epcis capture ${id}`, res);
      capturedEventIds.add(id);
      capturedCount += 1;
    }
  }

  // 2c. Helper: mirror one URN (capability DL → master-data → our webvoc → our DL anchor),
  //     and if it's a product:lot:class URN, also mirror its parent product:class URN.
  async function mirror(urn) {
    const r = await mirrorEntity({
      urn,
      capabilityClient: capClient,
      dlClient: localDl,
      webvocClient: localWebvoc,
      seenUrns,
      log: (m) => console.log(m),
    });
    if (r?.skipped) mirrorSkipped += 1;
    else mirroredCount += 1;

    const parent = parentClassUrn(urn);
    if (parent && !seenUrns.has(parent)) {
      const pr = await mirrorEntity({
        urn: parent,
        capabilityClient: capClient,
        dlClient: localDl,
        webvocClient: localWebvoc,
        seenUrns,
        log: (m) => console.log(m),
      });
      if (pr?.skipped) mirrorSkipped += 1;
      else mirroredCount += 1;
    }
  }

  // 2d. Mirror the source EPC itself (so step 5 DL lookup for it works)
  console.log(`  Mirroring source EPC ${startEpc}...`);
  await mirror(startEpc);

  // 2e. Trace-back EPCIS queries
  async function queryEvents(epc) {
    const q = `/epcis/events?MATCH_anyEPC=${encodeURIComponent(epc)}`;
    const res = await capClient.get(q);
    ensureOk(`capability epcis query for ${epc}`, res);
    return res.data;
  }

  const { events, seen, used } = await traceBack({
    startEpc,
    queryEvents,
    onQueryResult: async ({ epc, doc, events }) => {
      await captureLocally({ doc, events });
      for (const ev of events) {
        for (const urn of allUrnsFromEvent(ev)) {
          await mirror(urn);
        }
      }
    },
    log: (m) => console.log(`  ${m}`),
  });

  // 3. Persist outputs
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `pulled-${uuid}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ uuid, startEpc, seen, used, events, mirroredUrns: [...seenUrns] }, null, 2));

  state.update({
    pulledEpcsSeen: seen,
    pulledEpcsUsed: used,
    pulledEventCount: events.length,
    locallyCapturedCount: capturedCount,
    locallyCapturedSkipped: skippedEventCount,
    mirroredUrnCount: mirroredCount,
    mirrorSkippedCount: mirrorSkipped,
    pulledAt: new Date().toISOString(),
  });

  console.log(
    `\nPull summary:\n` +
    `  events pulled        : ${events.length}\n` +
    `  EPCs seen / queried  : ${seen.length} / ${used.length}\n` +
    `  events captured local: ${capturedCount} (skipped/dup: ${skippedEventCount})\n` +
    `  URNs mirrored        : ${mirroredCount} (skipped/dup: ${mirrorSkipped})\n` +
    `  saved → ${outFile}`
  );
}

module.exports = { run };