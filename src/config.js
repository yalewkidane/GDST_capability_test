const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function optional(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : v.trim();
}

function joinHostPort(server, port) {
  if (!server) throw new Error('Missing server');
  if (!port) return server;
  return `${server.replace(/\/+$/, '')}:${port}`;
}

const config = {
  dl: {
    baseUrl: joinHostPort(optional('DL_SERVER'), optional('DL_PORT')),
    apiKey: optional('DL_API_KEY'),
  },
  webvoc: {
    baseUrl: joinHostPort(optional('WEBVOC_SERVER'), optional('WEBVOC_PORT')),
    apiKey: optional('WEBVOC_API_KEY'),
  },
  epcis: {
    baseUrl: joinHostPort(optional('EPCIS_SERVER'), optional('EPCIS_PORT')),
    apiKey: optional('EPCIS_API_KEY'),
  },
  capability: {
    baseUrl: optional('CAPABILITY_SERVICE_URL', 'https://capability-service.traceability-dialogue.org').replace(/\/+$/, ''),
    apiKey: optional('CAPABILITY_API_KEY'),
    gdstVersion: optional('GDST_VERSION', '12'),
  },
  solution: {
    name: optional('SOLUTION_NAME'),
    version: optional('SOLUTION_VERSION'),
    pgln: optional('SOLUTION_PGLN'),
    publicUrl: optional('SOLUTION_PROVIDER_PUBLIC_URL'),
    publicEpcisUrl: optional('SOLUTION_PROVIDER_PUBLIC_EPCIS_URL'),
    publicWebvocUrl: optional('SOLUTION_PROVIDER_PUBLIC_WEBVOC_URL'),
    providerApiKey: optional('SOLUTION_PROVIDER_API_KEY'),
    generatedEpcs: optional('SOLUTION_PROVIDER_GENERATED_EPCS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};

module.exports = { config, required, optional };
