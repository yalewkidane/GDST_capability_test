const { capability, ensureOk } = require('../http');
const { config } = require('../config');
const state = require('../state');

async function run() {
  const { solution, capability: cap } = config;
  if (!solution.name) throw new Error('SOLUTION_NAME is required in .env');
  if (!solution.version) throw new Error('SOLUTION_VERSION is required in .env');
  if (!solution.publicUrl) throw new Error('SOLUTION_PROVIDER_PUBLIC_URL is required in .env');
  if (!solution.providerApiKey) throw new Error('SOLUTION_PROVIDER_API_KEY is required in .env');
  if (!solution.pgln) throw new Error('SOLUTION_PGLN is required in .env');

  const body = {
    SolutionName: solution.name,
    Version: solution.version,
    APIKey: solution.providerApiKey,
    URL: solution.publicUrl,
    VERSION: solution.version,
    PGLN: solution.pgln,
    GDSTVersion: cap.gdstVersion,
  };

  const client = capability();
  console.log(`POST ${client.defaults.baseURL}/process/start`);
  const res = await client.post('/process/start', body, {
    headers: { 'Content-Type': 'application/json' },
  });
  ensureOk('process/start', res);

  const data = res.data || {};
  // Server returns camelCase + complianceProcessUUID / epCs (GDST docs use UUID / EPCs — stale).
  const uuid = data.complianceProcessUUID || data.UUID;
  const sourceEpcs = data.epCs || data.EPCs || [];
  const solutionName = data.solutionName || data.SolutionName;
  const version = data.version || data.Version;
  if (!uuid) throw new Error(`process/start returned no UUID. Body: ${JSON.stringify(data)}`);
  state.clear();
  state.write({
    uuid,
    solutionName,
    version,
    sourceEpcs: Array.isArray(sourceEpcs) ? sourceEpcs : [],
    startedAt: new Date().toISOString(),
  });
  console.log(`UUID: ${uuid}`);
  console.log(`Source EPC(s): ${(sourceEpcs || []).join(', ')}`);
}

module.exports = { run };
