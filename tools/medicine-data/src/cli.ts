import { effectiveDelays, loadOverrides, requireContactEmail } from './config.js';
import { runComplianceGate } from './compliance/gate.js';
import { reportStage } from './export/card.js';
import { exportStage } from './export/dataset.js';
import { PoliteFetcher } from './http/fetcher.js';
import { RawStore } from './http/raw-store.js';
import { crawl, discover, parseAll } from './pipeline/acquire.js';
import { mergeStage, normalizeStage } from './pipeline/build.js';
import { ADAPTERS } from './sources/index.js';
import { StateStore } from './state/db.js';

const HELP = `Usage: pnpm md <command> [--source a,b] [options]

Network commands (require CONTACT_EMAIL):
  compliance              robots.txt + terms gate for every source → compliance/*.md, verdicts.json, SUMMARY.md
  discover                enqueue seeds and fetch sitemap/listing pages (ALLOWED/RESTRICTED/UNCLEAR only)
  crawl [--sample N]      fetch detail/export URLs; --sample limits per source (policy: 50 first); --refresh re-checks fetched URLs
  all                     compliance → discover → crawl → parse → build

Offline commands:
  parse [--reparse]       run source parsers over fetched snapshots (--reparse after a parser fix)
  normalize | merge | export | report
  build                   normalize → merge → export → report
  status                  frontier / parse / block status
  completeness            per-source raw field completeness (inspect after a sample crawl)
  prune-raw [--days 30]   delete raw snapshots older than the retention window
  unblock --source id --reason "..."   audited manual lift of a BLOCKED status after investigation
`;

function args() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const opt = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : 'true') : undefined;
  };
  const sources = opt('source')?.split(',').map(s => s.trim()).filter(Boolean);
  return { command, opt, sources };
}

function completeness(store: StateStore): void {
  const fields = ['brand_name', 'brand_name_bn', 'generic_names', 'strength_raw', 'dosage_form_raw', 'route', 'manufacturer_raw', 'pack_size_raw', 'unit_price_bdt', 'pack_price_bdt', 'price_label', 'registration_number', 'therapeutic_class', 'availability'];
  const bySource = new Map<string, Array<Record<string, unknown>>>();
  for (const row of store.allFacts()) bySource.set(row.source, [...(bySource.get(row.source) ?? []), JSON.parse(row.fact_json)]);
  for (const [source, facts] of bySource) {
    console.log(`\n${source}: ${facts.length} facts`);
    for (const f of fields) {
      const n = facts.filter(x => x[f] !== undefined && x[f] !== '' && !(Array.isArray(x[f]) && !(x[f] as unknown[]).length)).length;
      console.log(`  ${f.padEnd(20)} ${String(n).padStart(7)}  ${((100 * n) / facts.length).toFixed(1)}%`);
    }
  }
}

function build(store: StateStore, notes: string[] = []) {
  normalizeStage(store);
  mergeStage();
  exportStage();
  return reportStage(store, notes);
}

async function main() {
  const { command, opt, sources } = args();
  if (command === 'help' || command === '--help') { console.log(HELP); return; }
  const store = new StateStore();
  try {
    switch (command) {
      case 'compliance': {
        requireContactEmail();
        const fetcher = new PoliteFetcher({ store, delays: effectiveDelays(loadOverrides()), capFor: () => 1500 });
        const verdicts = await runComplianceGate(fetcher, sources);
        for (const v of Object.values(verdicts)) console.log(`  ${v.source.padEnd(18)} ${v.verdict}${v.legal_review_required ? ' (LEGAL_REVIEW_REQUIRED)' : ''}`);
        break;
      }
      case 'discover': requireContactEmail(); await discover(store, sources); break;
      case 'crawl': {
        requireContactEmail();
        const sample = opt('sample');
        await crawl(store, sources, { sample: sample ? Number(sample) : undefined, refresh: opt('refresh') === 'true' });
        break;
      }
      case 'parse':
        if (opt('reparse') === 'true') for (const id of sources ?? Object.keys(ADAPTERS)) console.log(`[parse] reset ${id}: ${store.resetParse(id)} documents`);
        parseAll(store, sources);
        break;
      case 'normalize': normalizeStage(store); break;
      case 'merge': mergeStage(); break;
      case 'export': exportStage(); break;
      case 'report': reportStage(store); break;
      case 'build': build(store); break;
      case 'all': {
        requireContactEmail();
        const fetcher = new PoliteFetcher({ store, delays: effectiveDelays(loadOverrides()), capFor: () => 1500 });
        await runComplianceGate(fetcher, sources);
        await discover(store, sources);
        await crawl(store, sources, {});
        parseAll(store, sources);
        build(store, ['Full pipeline run via `all`.']);
        break;
      }
      case 'status': {
        console.table(store.countsBySource());
        console.table(store.parseStats());
        for (const e of store.events().filter(e => e.type !== 'ROBOTS_DISALLOWED').slice(-20)) console.log(`${e.at} ${e.source} ${e.type} ${e.detail}`);
        break;
      }
      case 'completeness': completeness(store); break;
      case 'unblock': {
        // Manual, audited lift of a BLOCKED status after investigating the cause. Never automatic.
        const reason = opt('reason');
        if (!sources?.length || !reason || reason === 'true') throw new Error('Usage: unblock --source <id> --reason "<why the block was not a denial of access>"');
        for (const id of sources) {
          const previous = store.sourceStatus(id);
          store.setSourceStatus(id, 'ACTIVE', `manual unblock: ${reason}`);
          store.logEvent(id, 'UNBLOCK_MANUAL', `previous: ${previous?.reason ?? 'none'}; reason: ${reason}`);
          console.log(`[unblock] ${id}: ${previous?.reason ?? 'was not blocked'} → ACTIVE`);
        }
        break;
      }
      case 'prune-raw': console.log(`Removed ${new RawStore().prune(Number(opt('days') ?? 30))} raw snapshot files.`); break;
      default: console.log(HELP); process.exitCode = 2;
    }
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
