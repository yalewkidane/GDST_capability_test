const fs = require('fs');
const path = require('path');
const { epcis, ensureOk } = require('../http');
const { renderFile } = require('../render');
const state = require('../state');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const TEMPLATE_FILE = path.join(DATA_DIR, 'events.template.json');
const STATIC_FILE = path.join(DATA_DIR, 'events.json');

const PER_EVENT_TIMEOUT_MS = 120_000;

function loadDoc() {
  if (fs.existsSync(TEMPLATE_FILE)) {
    return { doc: renderFile(TEMPLATE_FILE), source: TEMPLATE_FILE };
  }
  if (fs.existsSync(STATIC_FILE)) {
    return { doc: JSON.parse(fs.readFileSync(STATIC_FILE, 'utf8')), source: STATIC_FILE };
  }
  throw new Error(`Neither ${TEMPLATE_FILE} nor ${STATIC_FILE} found.`);
}

function buildSingleEventDoc(doc, event) {
  const header = { ...doc };
  delete header.epcisBody;
  return { ...header, epcisBody: { eventList: [event] } };
}

async function run() {
  const { doc, source } = loadDoc();
  const eventList = doc?.epcisBody?.eventList;
  if (!Array.isArray(eventList)) {
    throw new Error(`${source} must be an EPCISDocument with epcisBody.eventList[].`);
  }
  if (eventList.length === 0) {
    console.log(`EPCISDocument in ${source} has no events. Nothing to seed.`);
    return;
  }

  const s = state.read();
  if (!s.uuid) {
    console.warn('WARNING: no capability UUID in state. `start` has not been run yet.');
    console.warn('  Events captured now will have recordTime BEFORE the capability process begins,');
    console.warn('  which may cause step-4 GE_recordTime checks to miss them.');
    console.warn('  Recommended order: start → pull → seed:events → next → report');
    console.warn('  Proceeding anyway in 3 seconds... (Ctrl-C to abort)');
    await new Promise((r) => setTimeout(r, 3000));
  } else if (s.pulledAt == null) {
    console.warn(`WARNING: capability process started (UUID ${s.uuid}) but \`pull\` hasn't run yet.`);
    console.warn('  Recommended order: start → pull → seed:events → next → report');
    console.warn('  Proceeding anyway in 3 seconds... (Ctrl-C to abort)');
    await new Promise((r) => setTimeout(r, 3000));
  }

  const client = epcis();
  console.log(`Source: ${source}`);
  console.log(`Capturing ${eventList.length} event(s) one-by-one to ${client.defaults.baseURL}/epcis/v2/capture (timeout ${PER_EVENT_TIMEOUT_MS / 1000}s/event)...`);

  let captured = 0;
  let skipped = 0;
  let i = 0;
  for (const event of eventList) {
    i += 1;
    const label = event.eventID || `event#${i}`;
    const body = buildSingleEventDoc(doc, event);
    const res = await client.post('/epcis/v2/capture', body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: PER_EVENT_TIMEOUT_MS,
    });
    if (res.status === 409) {
      console.log(`  [${i}/${eventList.length}] ${label} → 409 (already captured)`);
      skipped += 1;
      continue;
    }
    ensureOk(`events capture [${i}/${eventList.length}] ${label}`, res);
    console.log(`  [${i}/${eventList.length}] ${label} → ${res.status}`);
    captured += 1;
  }
  console.log(`Done. captured=${captured}, skipped=${skipped}.`);
}

module.exports = { run, loadDoc, buildSingleEventDoc };
