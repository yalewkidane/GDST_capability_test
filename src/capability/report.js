const fs = require('fs');
const path = require('path');
const { capability, ensureOk } = require('../http');
const state = require('../state');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'out');

// NOTE: the GDST docs have these labels swapped. The actual server semantics:
//   `status` = terminal result (0 in progress, 10 failed, 11 passed, 12 approved, 13 timed out)
//   `stage`  = test phase (0 started, 1 full-chain s1, 2 full-chain s2, 3 first mile, 4 finished)
const STATUS = {
  0:  'in progress',
  10: 'failed',
  11: 'passed',
  12: 'approved',
  13: 'timed out',
};
const STAGE = {
  0: 'started',
  1: 'full-chain stage #1',
  2: 'full-chain stage #2',
  3: 'first mile stage #1',
  4: 'finished',
};

async function run() {
  const uuid = state.requireField('uuid');
  const client = capability({ uuid });
  console.log(`GET ${client.defaults.baseURL}/process/report`);
  const res = await client.get('/process/report');
  ensureOk('process/report', res);
  const data = res.data || {};
  const statusLabel = STATUS[data.status] ?? `unknown(${data.status})`;
  const stageLabel = STAGE[data.stage] ?? `unknown(${data.stage})`;
  console.log(`Status: ${data.status} (${statusLabel})`);
  console.log(`Stage : ${data.stage} (${stageLabel})`);
  const errors = Array.isArray(data.errors) ? data.errors : [];
  console.log(`Errors: ${errors.length}`);
  if (errors.length > 0) {
    for (const e of errors) {
      console.log(`  - ${typeof e === 'string' ? e : JSON.stringify(e)}`);
    }
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `report-${uuid}.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  state.update({ lastReport: data, lastReportAt: new Date().toISOString() });
  console.log(`Saved → ${outFile}`);
}

module.exports = { run };
