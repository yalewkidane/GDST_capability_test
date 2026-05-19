function classifyUrn(urn) {
  if (typeof urn !== 'string') return null;
  const s = urn.trim();
  if (!s) return null;

  if (s.startsWith('urn:epc:id:sscc:'))     return { key: '00',  kind: 'sscc' };
  if (s.startsWith('urn:epc:id:sgtin:'))    return { key: '01',  kind: 'sgtin' };
  if (s.startsWith('urn:epc:idpat:sgtin:')) return { key: '01',  kind: 'sgtin-pat' };
  if (s.startsWith('urn:epc:id:sgln:'))     return { key: '414', kind: 'sgln' };
  if (s.startsWith('urn:epc:id:pgln:'))     return { key: '417', kind: 'pgln' };

  // gdst-style URNs (urn:gdst:example.org:product:class:..., etc.)
  if (/:product:lot:class:/.test(s)) return { key: '01',  kind: 'lot' };
  if (/:product:class:/.test(s))     return { key: '01',  kind: 'product' };
  if (/:location:/.test(s))          return { key: '414', kind: 'location' };
  if (/:party:/.test(s))             return { key: '417', kind: 'party' };

  return null;
}

// For a `urn:...:product:lot:class:{class}.{lot}` URN, return the parent class URN
// (`urn:...:product:class:{class}`). Returns null if input isn't a lot URN.
function parentClassUrn(urn) {
  if (typeof urn !== 'string') return null;
  const m = urn.match(/^(urn:.+?):product:lot:class:(.+)$/);
  if (!m) return null;
  const prefix = m[1];
  const tail = m[2];
  const lastDot = tail.lastIndexOf('.');
  if (lastDot === -1) return null;
  const classOnly = tail.slice(0, lastDot);
  return `${prefix}:product:class:${classOnly}`;
}

module.exports = { classifyUrn, parentClassUrn };