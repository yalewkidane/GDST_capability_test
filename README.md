# GDST Capability Test — Automation

Per-step CLI that drives the GDST Capability Test end-to-end against
`https://capability-service.traceability-dialogue.org`, with a templated data
model (identifiers + Mustache-style placeholders) so a single source of truth
feeds Digital Link anchors, Web Vocabulary master-data, and EPCIS events.

---

## TL;DR — running a capability test

```sh
# 0. one-time
npm install
cp .env.example .env   # then fill values (already populated in this repo)

# 1. pre-start (no capability credits)
node src/cli.js clean:digital-links    # wipe any stale DL records first
node src/cli.js seed:pre-start         # DL + master-data only (events come later)

# 2. live capability test
node src/cli.js start                  # step 1 — 1 credit
node src/cli.js pull                   # step 2 — pulls events + master-data + DL from capability
node src/cli.js seed:events            # AFTER pull, so recordTime lands inside the test window
node src/cli.js verify:epcis           # wait for async EPCIS ingestion so the capability tool doesn't race us
node src/cli.js next                   # step 3 — provides our SOLUTION_PROVIDER_GENERATED_EPCS
node src/cli.js report                 # step 6 — re-run to poll until stage=4 (finished), status=11 (passed)
```

To re-test under a different identity (different PGLN, prefixes, solution name), see [Re-running with a different identity](#re-running-with-a-different-identity-new-system).

---

## Architecture

```
GDST_capability_test/
├── .env                          ← credentials + URLs (gitignored, sample in .env.example)
├── data/
│   ├── identifiers.json          ← SOURCE OF TRUTH for every URN used in the test
│   │                                (events / parties / locations / products / product_lots / containers)
│   ├── events.template.json      ← EPCISDocument template; placeholders like {{parties.haeundae_farm}}
│   ├── master-data.template.json ← JSON-LD array template (gs1:Product / gs1:Organization / gs1:Place)
│   ├── profile.example.json      ← example profile for `new-system` swap (different identity, same scenario)
│   ├── events.json               ← optional static fallback (empty by default; template wins)
│   ├── master-data.json          ← optional static fallback (empty by default; template wins)
│   └── digital-links.json        ← optional override list (empty by default; entries here override generated)
├── src/
│   ├── cli.js                    ← commander entry — defines every subcommand
│   ├── config.js                 ← loads .env, exposes typed config
│   ├── state.js                  ← reads/writes .capability-state.json (UUID, source EPCs, pull stats…)
│   ├── http.js                   ← axios clients for DL / webvoc / EPCIS / capability service
│   ├── render.js                 ← Mustache-style {{section.name}} → identifiers.json substitution
│   ├── urn.js                    ← URN classifier (sscc→00, sgtin→01, location→414, party→417, etc.)
│   ├── build/digital-links.js    ← deterministic DL anchor builder (25 entries from identifiers + .env)
│   ├── seed/digital-links.js     ← POSTs DL anchors (idempotent: 409 → skip)
│   ├── seed/master-data.js       ← Renders template, POSTs each record (idempotent: 409 → skip)
│   ├── seed/events.js            ← Renders template, POSTs each event one-by-one (warns if start hasn't run)
│   ├── clean/digital-links.js    ← DELETEs every generated anchor × linkType (use before clean re-seed)
│   ├── verify/epcis.js           ← Polls our EPCIS until our seeded events are queryable (bridges async ingestion)
│   ├── swap/new-system.js        ← Backs up + rewrites identifiers/master-data/.env for a different identity
│   ├── traceback.js              ← Pure trace-back algo (seen/used/frontier sets, broad EPC extraction)
│   └── capability/{start,pull,mirror,next,report}.js  ← the live capability-service commands + per-URN mirror helper
├── out/                          ← rendered debug artifacts + run outputs (gitignored)
└── .capability-state.json        ← run state (gitignored)
```

### Data flow

```
                ┌───────────────────────┐
                │  data/identifiers.json│   single source of truth
                └────────────┬──────────┘
                             │ {{section.name}} resolution via src/render.js
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
 events.template      master-data.template   build/digital-links.js
       │                     │                     │  (also reads SOLUTION_PROVIDER_PUBLIC_*
       │                     │                     │   and SOLUTION_PGLN from .env)
       ▼                     ▼                     ▼
  16 EPCIS events       16 JSON-LD records     24 DL anchors
       │                     │                     │
       ▼                     ▼                     ▼
 EPCIS /capture        webvoc /gs1webvoc/      DL /digitallink/new
                            capture
```

---

## The six-step GDST flow

```
Step 1: start                  POST /process/start              → UUID + source EPC (we save to state)
Step 2: pull                   GET /digitallink/00/<epc>?linkType=gs1:epcis
                               GET /epcis/events?MATCH_anyEPC=<epc>
                               (recursive trace-back — each pulled event is auto-captured into our EPCIS)
                               *** AND: master-data + DL anchors are pulled from capability and pushed to us ***
Step 3: next                   POST /process/next               (we provide SOLUTION_PROVIDER_GENERATED_EPCS)
Step 4: capability calls us    GET our DL    /417/{PGLN}?linkType=gs1:epcis
                               GET our EPCIS /events?GE_recordTime=<startTime>&LE_recordTime=<now>
                               (relies on the master-data + events that pull / seed:events populated)
Step 5: capability calls us    GET our DL    /00/{our EPC}?linkType=gs1:epcis
                               GET our EPCIS /events?MATCH_anyEPC=<our EPC>
                               (plus trace-back from the capability tool's side)
Step 6: report                 GET /process/report              → status + stage + errors
```

Steps 1, 2, 3, 6 are driven by our CLI. Steps 4 and 5 are passive — the
capability tool calls into our DL / EPCIS / webvoc and our infrastructure must
respond correctly. That's why `seed:pre-start` + `pull` + `seed:events` must
finish before `next`.

---

## The `pull` step in detail

For the EPC the capability tool gave us in `start`, `pull` walks the entire
chain on the capability side and replicates everything we need into our own
infrastructure. After `pull` completes, our DL / webvoc / EPCIS contain a
**superset of what the capability tool will ask back from us** in steps 4 / 5.

```
SOURCE_EPC = state.sourceEpcs[0]

queue = [SOURCE_EPC]
while queue not empty:
  epc = queue.pop()

  # 1. DL lookup against the capability tool
  GET  https://capability-service…/digitallink/00/<epc>?linkType=gs1:epcis
       → epcisLink  (where the capability EPCIS lives for this EPC)
  GET  https://capability-service…/digitallink/00/<epc>?linkType=gs1:masterData
       → masterDataLink  (where master-data for this EPC lives)

  # 2. Replicate DL anchor on OUR side, pointing at OUR servers
  POST our DL /digitallink/new
       anchor:           /00/<epc>
       links.gs1:epcis:  SOLUTION_PROVIDER_PUBLIC_EPCIS_URL
       links.gs1:masterData: SOLUTION_PROVIDER_PUBLIC_WEBVOC_URL/00/<epc>

  # 3. Pull master-data from capability webvoc, push to ours
  GET  <masterDataLink>
       → JSON-LD record
  POST our webvoc /gs1webvoc/capture  <body>

  # 4. Pull events from capability EPCIS, push to ours (existing logic)
  GET  https://capability-service…/epcis/events?MATCH_anyEPC=<epc>
       → EPCISQueryDocument
  for each event:
    POST our EPCIS /epcis/v2/events   <event>   (with the document's @context)
    extract upstream EPCs (childEPCs, inputEPCList, quantity-list epcClasses, parentID, sourceList, …)
    extract entity URNs    (bizLocation.id, readPoint.id, party URIs in sourceList/destinationList,
                            gdst:productOwner, cbvmda:informationProvider, …)
    push every new URN into `queue` (deduped by seen-set)
```

So `pull` is recursive over **two kinds of identifiers**:

- **EPCs / lots / containers** — drive the next EPCIS query for trace-back.
- **Entities (parties / locations)** — don't drive new EPCIS queries, but each
  needs its master-data record + DL anchor mirrored into our infrastructure.

When `pull` exits, the following are in our infrastructure:

| In our DL | In our webvoc | In our EPCIS |
|---|---|---|
| every EPC + every entity URN from the trace, anchored to OUR endpoints | master-data record for every EPC + entity URN | every event the capability tool published, with `recordTime` inside the test window |

Then `seed:events` adds our own 16 solution-provider events on top, also with
`recordTime` inside the window. Now both step-4 (`GE_recordTime`) and step-5
(`MATCH_anyEPC`) queries from the capability tool can be served.

---

## Configuration — `.env`

| Variable | Meaning |
|---|---|
| `DL_SERVER` / `DL_PORT` / `DL_API_KEY` | Where the CLI POSTs DL anchors (your local-write endpoint) |
| `WEBVOC_SERVER` / `WEBVOC_PORT` / `WEBVOC_API_KEY` | Where the CLI POSTs master-data |
| `EPCIS_SERVER` / `EPCIS_PORT` / `EPCIS_API_KEY` | Where the CLI POSTs / queries events |
| `CAPABILITY_SERVICE_URL` | Always `https://capability-service.traceability-dialogue.org` |
| `CAPABILITY_API_KEY` | The key you got from the capability tool (different from your own server keys) |
| `GDST_VERSION` | `12` for GDST 1.2, `11` for GDST 1.1 |
| `SOLUTION_NAME` / `SOLUTION_VERSION` | Sent in `start`; shown in the public capable-solutions list |
| `SOLUTION_PGLN` | The literal PGLN the capability tool calls back at in step 4 (`/417/<PGLN>`) |
| `SOLUTION_PROVIDER_PUBLIC_URL` | Public URL of your DL (capability tool reaches it in steps 4/5) |
| `SOLUTION_PROVIDER_PUBLIC_EPCIS_URL` | Public URL of your EPCIS; goes into the `gs1:epcis` href of every DL anchor |
| `SOLUTION_PROVIDER_PUBLIC_WEBVOC_URL` | Public URL of your webvoc; goes into the `gs1:masterData` href of every DL anchor |
| `SOLUTION_PROVIDER_API_KEY` | The key the capability tool will use to call your DL / EPCIS / webvoc |
| `SOLUTION_PROVIDER_GENERATED_EPCS` | Comma-separated EPC(s) returned to the capability tool in `next` (step 3) |

If your local write-endpoint and public read-endpoint are the same server (NAT
or same host), the `*_SERVER`/`*_PORT` and `SOLUTION_PROVIDER_PUBLIC_*` values
will match.

---

## Command reference

### Offline / debug (no HTTP)
| Command | Effect |
|---|---|
| `render:digital-links` | Build & write `out/digital-links.rendered.json` (25 anchors) |
| `render:master-data` | Render & write `out/master-data.rendered.json` (17 records) |
| `render:events` | Render & write `out/events.rendered.json` (16 events) |
| `new-system <profile>` | Swap identity per the profile JSON. Backs up `.env` / `data/identifiers.json` / `data/master-data.template.json` to `.v1` siblings, then rewrites in place. See "Re-running with a different identity" below. |

### Local seeding + verification (hits your own DL / webvoc / EPCIS, no capability credits)
| Command | When to run |
|---|---|
| `clean:digital-links` | Before a clean re-seed — DELETEs every anchor × linkType from your DL |
| `seed:pre-start` | Before `start` — runs `seed:digital-links` + `seed:master-data` |
| `seed:digital-links` | Pre-start. Idempotent (409 = skip). Includes the literal PGLN anchor for step 4 |
| `seed:master-data` | Pre-start. Idempotent (409 = skip) |
| `seed:events` | **After `pull`.** Warns + waits if state has no UUID or `pull` hasn't run |
| `verify:epcis` | **After `seed:events`, before `next`.** Polls our EPCIS until our seeded events are queryable, so the capability tool doesn't race our async ingestion |

### Capability service (live test — uses credits)
| Command | Step | What it does |
|---|---|---|
| `start`  | 1 | POST `/process/start`; persists UUID + source EPC to `.capability-state.json` |
| `pull`   | 2 | Recursive trace-back: pulls events + master-data + DL from capability and pushes them to your infrastructure; writes `out/pulled-<UUID>.json` |
| `next`   | 3 | POST `/process/next` with `SOLUTION_PROVIDER_GENERATED_EPCS` |
| `report` | 6 | GET `/process/report`; re-run to poll. stage `4` = finished; status `11` = passed |

---

## Re-running with a different identity (`new-system`)

After a passing run, you can re-test under a **completely different solution-provider identity** — different `SOLUTION_NAME`, different PGLN, different company prefixes for every party/location/product/lot, new container SSCC, fresh event UUIDs — without touching the event sequence or any source code. The salmon+tuna scenario stays the same; only identifiers move.

### How it works

1. You fill a small profile JSON describing the new identity (start from [data/profile.example.json](data/profile.example.json)).
2. Run `node src/cli.js new-system <profile.json>`. It:
   - Backs up `.env`, `data/identifiers.json`, `data/master-data.template.json` to `*.v1` siblings (only if the sibling doesn't already exist — never overwrites).
   - Rewrites the three files in place, substituting URN prefixes per the maps in the profile.
   - Optionally regenerates all 16 event UUIDs and/or renames master-data display names.
3. Run the normal pipeline (`seed:pre-start` → `start` → `pull` → …). Everything downstream picks up the new identity automatically because the events template uses `{{section.name}}` placeholders.

### Profile shape

```json
{
  "solution": {
    "name":    "newpass ver.1.0",
    "version": "1.0",
    "pgln":    "8810027900078"
  },
  "party_prefix_map": {
    "8800037": "8810037",
    "8800048": "8810048",
    "8800057": "8810057",
    "8800067": "8810067",
    "8800026": "8810026"
  },
  "product_class_map": {
    "88000197.2000002": "88010197.3000002",
    "8800017.2000002":  "8810017.3000002",
    "8800028.2000002":  "8810028.3000002",
    "8800027.2000002":  "8810027.3000002",
    "8800027.2000003":  "8810027.3000003",
    "8800026.2000001":  "8810026.3000001"
  },
  "container_sscc": "urn:epc:id:sscc:88100269.20000000",
  "options": {
    "regenerate_event_uuids": true,
    "rename_master_data":     false
  }
}
```

- `party_prefix_map` — rewrites both `parties.*` and `locations.*` URNs (they share the company prefix in this scheme).
- `product_class_map` — rewrites `products.*` and the class portion of `product_lots.*`. Use the full `{compcode}.{itemref}` segment as the key to disambiguate (e.g. `8800027.2000002` vs `8800027.2000003`).
- `options.regenerate_event_uuids` — `true` (recommended) replaces all 16 `events.v*` UUIDs via `crypto.randomUUID()`.
- `options.rename_master_data` — `false` (default) keeps display names; `true` prefixes every organization/place/product name with `"New "`.

### Full re-test workflow

```sh
# 1. Edit profile (or just use the example as-is)
cp data/profile.example.json data/profile.json
$EDITOR data/profile.json

# 2. Swap identity (no HTTP)
node src/cli.js new-system data/profile.json

# 3. Verify offline
node src/cli.js render:digital-links   # new prefixes everywhere
node src/cli.js render:master-data     # new GLNs/GTINs
node src/cli.js render:events          # new event UUIDs and entity URNs

# 4. Wipe DL + EPCIS + webvoc DBs manually (same as a first-time run)

# 5. Run the live test
node src/cli.js seed:pre-start
node src/cli.js start
node src/cli.js pull
node src/cli.js seed:events
node src/cli.js verify:epcis
node src/cli.js next
node src/cli.js report
```

### Restoring the original (v1) identity

```sh
cp data/identifiers.json.v1            data/identifiers.json
cp data/master-data.template.json.v1   data/master-data.template.json
cp .env.v1                              .env
```

The pipeline picks up the v1 data immediately — no code change needed.

### Out of scope

`new-system` only swaps **identifiers and display names**. Changing the underlying GDST scenario (different species, biz-step sequence, vessel attributes, certifications) requires manual edits to [data/events.template.json](data/events.template.json) and the corresponding master-data records.

---

## Troubleshooting

**Step 4 returns no events.** Either `pull` hasn't run, or you re-seeded events
before `start` (so `recordTime` is outside the window). Re-flow: wipe EPCIS →
`start` → `pull` → `seed:events`.

**Capability tool can't reach our DL/EPCIS.** `SOLUTION_PROVIDER_PUBLIC_*` URLs
must be reachable from the public internet. The local `DL_SERVER` /
`EPCIS_SERVER` (where we *write*) can differ if you're behind NAT, but the
`SOLUTION_PROVIDER_PUBLIC_*` URLs are what get embedded inside DL anchors and
what the capability tool calls.

**DL has duplicate records for the same anchor.** Run `clean:digital-links`
then `seed:digital-links`. The Oliot DL allows multiple records per anchor
rather than upserting.

**Event capture timed out.** EPCIS captures one event at a time with a 120s
timeout (`seed:events`). Re-run — already-captured events return 409 and are
skipped.

**`pull` errors with "Expected EPCISQueryDocument, got EPCISDocument".** Your
EPCIS Query Interface is returning the wrong document type. GDST 1.2 requires
`EPCISQueryDocument` (with `epcisBody.queryResults.resultsBody.eventList`).
Fix the capability tool URL or your local EPCIS configuration.

---

## State and outputs

- `.capability-state.json` — persistent run state: UUID, source EPCs, pulled
  counts, timestamps, last report. Cleared on each `start`.
- `out/pulled-<UUID>.json` — every event pulled from capability + EPCs seen.
- `out/report-<UUID>.json` — raw report payload.
- `out/{events,master-data,digital-links}.rendered.json` — debug snapshots of
  the rendered/built payloads.
