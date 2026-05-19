const axios = require('axios');
const { config } = require('./config');

function makeClient({ baseURL, apiKey, extraHeaders = {} }) {
  const headers = { Accept: 'application/json', ...extraHeaders };
  if (apiKey) headers['X-API-Key'] = apiKey;
  return axios.create({
    baseURL,
    headers,
    timeout: 60_000,
    validateStatus: () => true,
  });
}

function ensureOk(label, res) {
  if (res.status >= 200 && res.status < 300) return res;
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  throw new Error(`${label} failed: ${res.status} ${res.statusText}\n${body}`);
}

const dl = () => makeClient({ baseURL: config.dl.baseUrl, apiKey: config.dl.apiKey });
const webvoc = () => makeClient({ baseURL: config.webvoc.baseUrl, apiKey: config.webvoc.apiKey });
const epcis = () => makeClient({ baseURL: config.epcis.baseUrl, apiKey: config.epcis.apiKey });

function capability({ uuid } = {}) {
  const extra = uuid
    ? { 'X-Capability-Process-UUID': uuid, 'X-Compliance-Process-UUID': uuid }
    : {};
  return makeClient({ baseURL: config.capability.baseUrl, apiKey: config.capability.apiKey, extraHeaders: extra });
}

module.exports = { dl, webvoc, epcis, capability, ensureOk };
