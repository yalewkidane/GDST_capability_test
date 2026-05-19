function extractEventList(queryDoc) {
  if (queryDoc?.type !== 'EPCISQueryDocument') {
    throw new Error(`Expected EPCISQueryDocument, got "${queryDoc?.type}". (FAQ: do not return EPCISDocument from a query.)`);
  }
  const list = queryDoc?.epcisBody?.queryResults?.resultsBody?.eventList;
  return Array.isArray(list) ? list : [];
}

function epcsFromEvent(event) {
  const out = [];
  const pushStr = (v) => {
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) out.push(s);
    }
  };
  const pushArr = (arr) => Array.isArray(arr) && arr.forEach(pushStr);
  const pushQty = (list) => Array.isArray(list) && list.forEach((q) => q?.epcClass && pushStr(q.epcClass));

  pushArr(event?.epcList);
  pushArr(event?.inputEPCList);
  pushArr(event?.outputEPCList);
  pushArr(event?.childEPCs);
  pushStr(event?.parentID);
  pushQty(event?.quantityList);
  pushQty(event?.childQuantityList);
  pushQty(event?.inputQuantityList);
  pushQty(event?.outputQuantityList);
  return out;
}

async function traceBack({ startEpc, queryEvents, onQueryResult, log = () => {} }) {
  const seen = new Set([startEpc]);
  const used = new Set();
  const frontier = new Set([startEpc]);
  const allEvents = [];

  while (frontier.size > 0) {
    const [current] = frontier;
    frontier.delete(current);
    if (used.has(current)) continue;
    used.add(current);

    log(`querying events for ${current}`);
    const doc = await queryEvents(current);
    const events = extractEventList(doc);
    log(`  → ${events.length} event(s)`);
    allEvents.push(...events);

    if (onQueryResult) {
      await onQueryResult({ epc: current, doc, events });
    }

    for (const ev of events) {
      for (const next of epcsFromEvent(ev)) {
        if (!seen.has(next)) frontier.add(next);
        seen.add(next);
      }
    }
  }
  return { events: allEvents, seen: [...seen], used: [...used] };
}

function entityUrnsFromEvent(event) {
  const out = [];
  const pushStr = (v) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };
  pushStr(event?.bizLocation?.id);
  pushStr(event?.readPoint?.id);
  pushStr(event?.['gdst:productOwner']);
  pushStr(event?.['cbvmda:informationProvider']);
  if (Array.isArray(event?.sourceList)) {
    for (const s of event.sourceList) pushStr(s?.source);
  }
  if (Array.isArray(event?.destinationList)) {
    for (const d of event.destinationList) pushStr(d?.destination);
  }
  return out;
}

function allUrnsFromEvent(event) {
  return [...epcsFromEvent(event), ...entityUrnsFromEvent(event)];
}

module.exports = { traceBack, extractEventList, epcsFromEvent, entityUrnsFromEvent, allUrnsFromEvent };
