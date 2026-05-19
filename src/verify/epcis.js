const path = require('path');
const { epcis } = require('../http');
const { renderFile } = require('../render');

const TEMPLATE_FILE = path.resolve(__dirname, '..', '..', 'data', 'events.template.json');
const MAX_ATTEMPTS = 30;
const SLEEP_MS = 2000;

async function isQueryable(client, eventId) {
  // Use MATCH_anyEPC + eventID filter — Oliot supports both EQ_eventID and MATCH_anyEPC parameters.
  const q = `/epcis/v2/events?EQ_eventID=${encodeURIComponent('["' + eventId + '"]')}`;
  const res = await client.get(q);
  if (res.status !== 200) return false;
  const events =
    res.data?.epcisBody?.queryResults?.resultsBody?.eventList ||
    res.data?.epcisBody?.eventList ||
    [];
  return events.length > 0;
}

async function run() {
  const doc = renderFile(TEMPLATE_FILE);
  const eventList = doc?.epcisBody?.eventList || [];
  const eventIds = eventList.map((e) => e.eventID).filter(Boolean);
  if (eventIds.length === 0) {
    console.log('No event IDs to verify.');
    return;
  }

  const client = epcis();
  console.log(`Verifying ${eventIds.length} event ID(s) are queryable on ${client.defaults.baseURL}/epcis/v2/events...`);
  const sample = [eventIds[0], eventIds[Math.floor(eventIds.length / 2)], eventIds[eventIds.length - 1]];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const checks = await Promise.all(sample.map((id) => isQueryable(client, id)));
    const found = checks.filter(Boolean).length;
    console.log(`  attempt ${attempt}/${MAX_ATTEMPTS}: ${found}/${sample.length} sample event(s) queryable`);
    if (found === sample.length) {
      console.log('All sampled events queryable. Indexing has caught up.');
      return;
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
  throw new Error(`Events still not queryable after ${MAX_ATTEMPTS * SLEEP_MS / 1000}s. Investigate EPCIS ingestion.`);
}

module.exports = { run };