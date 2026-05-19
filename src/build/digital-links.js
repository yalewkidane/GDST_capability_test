const path = require('path');
const { loadIdentifiers } = require('../render');
const { config } = require('../config');

const DEFAULT_IDS_PATH = path.resolve(__dirname, '..', '..', 'data', 'identifiers.json');

function urnEncode(v) {
  return v;
}

function makeEntry({ keyType, id, description, epcisHref, webvocBase }) {
  return {
    anchor: `/${keyType}/${urnEncode(id)}`,
    itemDescription: description,
    defaultLinktype: 'gs1:masterData',
    links: [
      {
        linktype: 'gs1:epcis',
        href: epcisHref,
        title: 'Oliot EPCIS Server',
        type: 'application/json',
        hreflang: ['en'],
      },
      {
        linktype: 'gs1:masterData',
        href: `${webvocBase}/${keyType}/${urnEncode(id)}`,
        title: 'Master Data',
        type: 'application/json',
        hreflang: ['en'],
      },
    ],
  };
}

function build({ identifiersPath = DEFAULT_IDS_PATH, includeLots = true } = {}) {
  const ids = loadIdentifiers(identifiersPath);
  const epcisHref = config.solution.publicEpcisUrl;
  const webvocBase = config.solution.publicWebvocUrl;
  const pgln = config.solution.pgln;

  if (!epcisHref) throw new Error('SOLUTION_PROVIDER_PUBLIC_EPCIS_URL is required to build digital-link entries.');
  if (!webvocBase) throw new Error('SOLUTION_PROVIDER_PUBLIC_WEBVOC_URL is required to build digital-link entries.');

  const entries = [];

  for (const [name, id] of Object.entries(ids.containers || {})) {
    entries.push(makeEntry({ keyType: '00', id, description: `Container ${name}`, epcisHref, webvocBase }));
  }
  for (const [name, id] of Object.entries(ids.products || {})) {
    entries.push(makeEntry({ keyType: '01', id, description: `Product ${name}`, epcisHref, webvocBase }));
  }
  if (includeLots) {
    for (const [name, id] of Object.entries(ids.product_lots || {})) {
      entries.push(makeEntry({ keyType: '01', id, description: `Product lot ${name}`, epcisHref, webvocBase }));
    }
  }
  for (const [name, id] of Object.entries(ids.locations || {})) {
    entries.push(makeEntry({ keyType: '414', id, description: `Location ${name}`, epcisHref, webvocBase }));
  }
  for (const [name, id] of Object.entries(ids.parties || {})) {
    entries.push(makeEntry({ keyType: '417', id, description: `Party ${name}`, epcisHref, webvocBase }));
  }

  if (pgln) {
    entries.push(makeEntry({
      keyType: '417',
      id: pgln,
      description: `Solution Provider PGLN ${pgln}`,
      epcisHref,
      webvocBase,
    }));
  }

  return entries;
}

module.exports = { build, makeEntry };
