const { classifyUrn } = require('../urn');
const { config } = require('../config');

const LINK_TYPE_MD = 'gs1:masterData';
const LINK_TYPE_EPCIS = 'gs1:epcis';

function pickLink(dlResponse, linkType) {
  if (!dlResponse) return null;
  const list = Array.isArray(dlResponse) ? dlResponse : [dlResponse];
  const match = list.find((l) => (l.linkType || l.linktype) === linkType);
  if (!match) return null;
  return match.link || match.href || null;
}

async function mirrorEntity({ urn, capabilityClient, dlClient, webvocClient, seenUrns, log }) {
  if (seenUrns.has(urn)) return { skipped: true, reason: 'already-mirrored' };
  seenUrns.add(urn);

  const cls = classifyUrn(urn);
  if (!cls) {
    log(`    mirror skip (unclassifiable URN): ${urn}`);
    return { skipped: true, reason: 'unclassifiable', urn };
  }
  const { key, kind } = cls;
  const result = { urn, key, kind, masterDataPushed: false, dlAnchorPushed: false };

  // 1. Capability DL — find the master-data link
  let mdUrl = null;
  try {
    const dlPath = `/digitallink/${key}/${urn}`;
    const res = await capabilityClient.get(dlPath, { params: { linkType: LINK_TYPE_MD } });
    if (res.status >= 200 && res.status < 300) {
      mdUrl = pickLink(res.data, LINK_TYPE_MD);
    } else if (res.status === 404) {
      log(`    capability DL ${key}/${urn} → 404 (no anchor)`);
    } else {
      log(`    capability DL ${key}/${urn} → ${res.status} ${res.statusText}`);
    }
  } catch (e) {
    log(`    ERR capability DL ${key}/${urn}: ${e.message}`);
  }

  // 2. Fetch master-data body from capability webvoc
  let mdBody = null;
  if (mdUrl) {
    try {
      const res = await capabilityClient.get(mdUrl, { headers: { Accept: 'application/ld+json' } });
      if (res.status >= 200 && res.status < 300) {
        mdBody = res.data;
      } else {
        log(`    ERR capability master-data GET ${mdUrl} → ${res.status}`);
      }
    } catch (e) {
      log(`    ERR fetching master-data ${mdUrl}: ${e.message}`);
    }
  }

  // 3. Push master-data to OUR webvoc
  if (mdBody) {
    try {
      const res = await webvocClient.post('/gs1webvoc/capture', mdBody, {
        headers: { 'Content-Type': 'application/ld+json' },
      });
      if (res.status === 409) {
        log(`    webvoc /gs1webvoc/capture ${key}/${urn} → 409 (already exists, ok)`);
        result.masterDataPushed = true;
      } else if (res.status >= 200 && res.status < 300) {
        log(`    webvoc /gs1webvoc/capture ${key}/${urn} → ${res.status}`);
        result.masterDataPushed = true;
      } else {
        log(`    ERR webvoc capture ${key}/${urn}: ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      log(`    ERR webvoc capture ${key}/${urn}: ${e.message}`);
    }
  }

  // 4. Push DL anchor to OUR DL (pointing at OUR endpoints)
  try {
    const epcisHref = config.solution.publicEpcisUrl;
    const webvocBase = config.solution.publicWebvocUrl;
    const anchor = {
      anchor: `/${key}/${urn}`,
      itemDescription: `Mirrored from capability (${kind})`,
      defaultLinktype: LINK_TYPE_MD,
      links: [
        {
          linktype: LINK_TYPE_EPCIS,
          href: epcisHref,
          title: 'Solution Provider EPCIS',
          type: 'application/json',
          hreflang: ['en'],
        },
        {
          linktype: LINK_TYPE_MD,
          href: `${webvocBase}/${key}/${urn}`,
          title: 'Master Data',
          type: 'application/json',
          hreflang: ['en'],
        },
      ],
    };
    const res = await dlClient.post('/digitallink/new', anchor, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status === 409) {
      log(`    DL /digitallink/new ${anchor.anchor} → 409 (already exists, ok)`);
      result.dlAnchorPushed = true;
    } else if (res.status >= 200 && res.status < 300) {
      log(`    DL /digitallink/new ${anchor.anchor} → ${res.status}`);
      result.dlAnchorPushed = true;
    } else {
      log(`    ERR DL POST ${anchor.anchor}: ${res.status} ${res.statusText}`);
    }
  } catch (e) {
    log(`    ERR DL POST ${urn}: ${e.message}`);
  }

  return result;
}

module.exports = { mirrorEntity };