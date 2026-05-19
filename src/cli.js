#!/usr/bin/env node
const { Command } = require('commander');

const program = new Command();
program
  .name('gdst')
  .description('GDST Capability Test automation (per-step CLI)')
  .version('0.1.0');

function wrap(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
      process.exit(1);
    }
  };
}

program
  .command('seed:master-data')
  .description('POST data/master-data.json entries to WEBVOC /gs1webvoc/capture')
  .action(wrap(() => require('./seed/master-data').run()));

program
  .command('clean:digital-links')
  .description('DELETE every generated anchor × linkType from the DL resolver (use before a clean re-seed)')
  .action(wrap(() => require('./clean/digital-links').run()));

program
  .command('seed:digital-links')
  .description('POST data/digital-links.json entries to DL /digitallink/new')
  .action(wrap(() => require('./seed/digital-links').run()));

program
  .command('seed:events')
  .description('Render events template + POST to EPCIS. RUN AFTER `pull` so recordTime falls within the capability process window')
  .action(wrap(() => require('./seed/events').run()));

program
  .command('render:master-data')
  .description('Render data/master-data.template.json offline and write to out/master-data.rendered.json (no HTTP)')
  .action(wrap(() => {
    const fs = require('fs');
    const path = require('path');
    const { renderFile } = require('./render');
    const OUT_DIR = path.resolve(__dirname, '..', 'out');
    const TEMPLATE_FILE = path.resolve(__dirname, '..', 'data', 'master-data.template.json');
    const entries = renderFile(TEMPLATE_FILE);
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, 'master-data.rendered.json');
    fs.writeFileSync(outFile, JSON.stringify(entries, null, 2));
    console.log(`Rendered ${entries.length} entry/entries → ${outFile}`);
  }));

program
  .command('render:digital-links')
  .description('Build DL entries from data/identifiers.json + .env and write to out/digital-links.rendered.json (no HTTP)')
  .action(wrap(() => {
    const fs = require('fs');
    const path = require('path');
    const { build } = require('./build/digital-links');
    const { loadOverrides, mergeByAnchor } = require('./seed/digital-links');
    const OUT_DIR = path.resolve(__dirname, '..', 'out');
    const generated = build();
    const overrides = loadOverrides();
    const entries = mergeByAnchor(generated, overrides);
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, 'digital-links.rendered.json');
    fs.writeFileSync(outFile, JSON.stringify(entries, null, 2));
    console.log(`Built ${entries.length} entry/entries (${generated.length} generated, ${overrides.length} override(s)) → ${outFile}`);
  }));

program
  .command('render:events')
  .description('Render data/events.template.json offline and write to out/events.rendered.json (no HTTP)')
  .action(wrap(() => {
    const fs = require('fs');
    const path = require('path');
    const { renderFile } = require('./render');
    const OUT_DIR = path.resolve(__dirname, '..', 'out');
    const TEMPLATE_FILE = path.resolve(__dirname, '..', 'data', 'events.template.json');
    const doc = renderFile(TEMPLATE_FILE);
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, 'events.rendered.json');
    fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
    const n = doc?.epcisBody?.eventList?.length || 0;
    console.log(`Rendered ${n} event(s) → ${outFile}`);
  }));

program
  .command('seed:pre-start')
  .description('Pre-start seeds (run BEFORE `start`): seed:digital-links + seed:master-data. Excludes events.')
  .action(wrap(async () => {
    await require('./seed/digital-links').run();
    await require('./seed/master-data').run();
  }));

program
  .command('start')
  .description('Step 1: POST capability /process/start; persists UUID and source EPC(s) to .capability-state.json')
  .action(wrap(() => require('./capability/start').run()));

program
  .command('pull')
  .description('Step 2: GET capability DL + EPCIS events for the source EPC, then trace-back; writes out/pulled-<UUID>.json')
  .action(wrap(() => require('./capability/pull').run()));

program
  .command('verify:epcis')
  .description('Poll our EPCIS until our solution events are queryable. Use between seed:events and next.')
  .action(wrap(() => require('./verify/epcis').run()));

program
  .command('next')
  .description('Step 3: POST capability /process/next with SOLUTION_PROVIDER_GENERATED_EPCS')
  .action(wrap(() => require('./capability/next').run()));

program
  .command('report')
  .description('Step 6: GET capability /process/report; prints status/stage/errors; writes out/report-<UUID>.json')
  .action(wrap(() => require('./capability/report').run()));

program.parseAsync(process.argv);
