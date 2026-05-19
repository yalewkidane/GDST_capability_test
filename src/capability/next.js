const { capability, ensureOk } = require('../http');
const { config } = require('../config');
const state = require('../state');

async function run() {
  const uuid = state.requireField('uuid');
  const epcs = config.solution.generatedEpcs;
  if (epcs.length === 0) {
    throw new Error('SOLUTION_PROVIDER_GENERATED_EPCS is empty in .env (comma-separated EPC list).');
  }
  const client = capability({ uuid });
  console.log(`POST ${client.defaults.baseURL}/process/next`);
  console.log(`  EPCs: ${epcs.join(', ')}`);
  const res = await client.post('/process/next', { EPCs: epcs }, {
    headers: { 'Content-Type': 'application/json' },
  });
  ensureOk('process/next', res);
  state.update({ nextSentAt: new Date().toISOString(), generatedEpcs: epcs });
  console.log(`  → ${res.status}`);
}

module.exports = { run };
