import { SOURCES } from '../config.js';
import { transliterateBnToLatin } from '../normalize/bangla.js';
import { genericSetKey, titleCase } from '../normalize/generics.js';
import type { NormalizedFact } from '../schemas.js';
import { decide, GENERIC_AUTO_SIMILARITY, GENERIC_REVIEW_SIMILARITY, genericSimilarity, scorePair, type MatchDecision, type MatchScore } from './fuzzy.js';
import { blockKey, formFamily, recordKey, stableId } from './keys.js';

/**
 * Canonical value precedence (documented): DGDA > MedEx > open dataset > pharmacies.
 * Within the winning precedence tier the value backed by the most distinct sources wins
 * (majority among pharmacies); ties go to the value with more source records, then lexical order.
 */
export function precedenceOf(sourceId: string): number {
  return SOURCES.find(s => s.id === sourceId)?.precedence ?? 99;
}

interface Group { key: string; facts: NormalizedFact[]; matchMethod: Map<NormalizedFact, { method: 'exact_key' | 'fuzzy_auto'; score: number }> }

interface FieldValue { compare: string; display: unknown; sources: Set<string>; records: number; bestPrecedence: number }

export interface MergeResult {
  medications: Array<Record<string, unknown>>;
  generics: Array<Record<string, unknown>>;
  manufacturers: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>;
  prices: Array<Record<string, unknown>>;
  provenance: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  reviewQueue: Array<Record<string, unknown>>;
  stats: { exactGroups: number; fuzzyAutoMerges: number; fuzzyReview: number; dgdaLoaded: boolean };
}

function selectField(facts: NormalizedFact[], extract: (f: NormalizedFact) => { compare: string; display: unknown } | undefined) {
  const values = new Map<string, FieldValue>();
  for (const fact of facts) {
    const v = extract(fact);
    if (!v || v.compare === '') continue;
    const entry = values.get(v.compare) ?? { compare: v.compare, display: v.display, sources: new Set<string>(), records: 0, bestPrecedence: 99 };
    entry.sources.add(fact.source_id);
    entry.records++;
    const p = precedenceOf(fact.source_id);
    if (p < entry.bestPrecedence) { entry.bestPrecedence = p; entry.display = v.display; }
    values.set(v.compare, entry);
  }
  if (!values.size) return undefined;
  const ranked = [...values.values()].sort((a, b) =>
    a.bestPrecedence - b.bestPrecedence || b.sources.size - a.sources.size || b.records - a.records || a.compare.localeCompare(b.compare));
  const chosen = ranked[0];
  const agreeing = facts.filter(f => extract(f)?.compare === chosen.compare);
  return {
    chosenCompare: chosen.compare,
    field: {
      value: chosen.display,
      sources: [...chosen.sources].sort(),
      agreement_count: agreeing.length,
      ...(ranked.length > 1 ? { alternatives: ranked.slice(1).map(r => ({ value: r.display, sources: [...r.sources].sort() })) } : {})
    },
    conflict: ranked.length > 1 ? ranked.map(r => ({ value: r.display, sources: [...r.sources].sort() })) : undefined,
    rule: ranked.length > 1 && ranked[0].bestPrecedence < ranked[1].bestPrecedence ? 'source_precedence' : 'majority_of_sources'
  };
}

export function mergeFacts(facts: NormalizedFact[]): MergeResult {
  const reviewQueue: Array<Record<string, unknown>> = [];
  const dgdaLoaded = facts.some(f => f.source_id === 'dgda');

  // 1. Exact grouping by record key.
  const byKey = new Map<string, Group>();
  for (const fact of facts) {
    const group: Group = byKey.get(fact.record_key) ?? { key: fact.record_key, facts: [], matchMethod: new Map() };
    group.facts.push(fact);
    group.matchMethod.set(fact, { method: 'exact_key', score: 1 });
    byKey.set(fact.record_key, group);
  }
  const groups = [...byKey.values()];
  const exactGroups = groups.length;

  // 2. Fuzzy matching inside blocks (same generic set + form family). Weaker groups attach to more
  //    authoritative ones. A group's representative is its highest-precedence fact; absorbing weaker
  //    facts never changes it, so it is computed once.
  const reprCache = new Map<Group, { brandKey: string; strengthKey: string; manufacturerKey: string; form: string; precedence: number; hasDgda: boolean }>();
  const repr = (g: Group) => {
    let r = reprCache.get(g);
    if (!r) {
      const best = [...g.facts].sort((a, b) => precedenceOf(a.source_id) - precedenceOf(b.source_id))[0];
      r = { brandKey: best.brand_key, strengthKey: best.strength.key, manufacturerKey: best.manufacturer.key, form: best.dosage_form, precedence: precedenceOf(best.source_id), hasDgda: g.facts.some(f => f.source_id === 'dgda') };
      reprCache.set(g, r);
    }
    return r;
  };
  const absorbed = new Set<Group>();
  const queuedPairs = new Set<string>();
  let fuzzyAutoMerges = 0;
  let fuzzyReview = 0;
  const genericKeysOf = (g: Group) => g.facts[0].generics.map(x => x.key);

  /**
   * Pass "generic_block": same generic set + form family (catches brand/strength/manufacturer notation noise).
   * Pass "brand_block":   same brand key + form family but a different generic set (catches generic spelling
   *                       variants such as "Levocetirizine"/"Levocetrizine"); generic similarity gates the decision.
   */
  const runPass = (pass: 'generic_block' | 'brand_block') => {
    const blocks = new Map<string, Group[]>();
    for (const group of groups) {
      if (absorbed.has(group)) continue;
      const k = pass === 'generic_block' ? blockKey(group.facts[0]) : `${repr(group).brandKey}|${formFamily(repr(group).form)}`;
      const list = blocks.get(k);
      if (list) list.push(group); else blocks.set(k, [group]);
    }
    for (const block of blocks.values()) {
      if (block.length < 2) continue;
      const sorted = [...block].sort((a, b) => repr(a).precedence - repr(b).precedence || b.facts.length - a.facts.length || a.key.localeCompare(b.key));
      for (let i = sorted.length - 1; i >= 0; i--) {
        const candidate = sorted[i];
        if (absorbed.has(candidate)) continue;
        const c = repr(candidate);
        const scored: Array<{ target: Group; s: MatchScore; d: MatchDecision }> = [];
        for (const target of sorted) {
          if (target === candidate || absorbed.has(target)) continue;
          const t = repr(target);
          // Two groups that both carry a DGDA registration are distinct registered products: never merge.
          if (c.hasDgda && t.hasDgda) continue;
          if (t.precedence > c.precedence) continue; // attach weaker → stronger (or equal) only
          if (queuedPairs.has(`${candidate.key}>${target.key}`)) continue;
          const s = scorePair(c, t);
          let d = decide(s);
          if (pass === 'brand_block') {
            if (genericSetKey(candidate.facts[0].generics) === genericSetKey(target.facts[0].generics)) continue; // pass 1 covered it
            s.generic = genericSimilarity(genericKeysOf(candidate), genericKeysOf(target));
            if (s.generic < GENERIC_REVIEW_SIMILARITY) continue;
            if (d === 'auto_merge' && s.generic < GENERIC_AUTO_SIMILARITY) d = 'review';
          }
          if (d !== 'distinct') scored.push({ target, s, d });
        }
        const auto = scored.filter(x => x.d === 'auto_merge');
        if (auto.length === 1) {
          const target = auto[0].target;
          for (const fact of candidate.facts) {
            target.facts.push(fact);
            target.matchMethod.set(fact, { method: 'fuzzy_auto', score: auto[0].s.score });
          }
          absorbed.add(candidate);
          fuzzyAutoMerges++;
          continue;
        }
        for (const { target, s } of scored) {
          fuzzyReview++;
          queuedPairs.add(`${candidate.key}>${target.key}`);
          reviewQueue.push({
            type: 'fuzzy_match',
            score: s.score,
            detail: {
              pass,
              reason: auto.length > 1 ? 'multiple_auto_candidates' : 'below_auto_threshold',
              candidate_key: candidate.key, target_key: target.key,
              candidate_sources: [...new Set(candidate.facts.map(f => f.source_id))],
              target_sources: [...new Set(target.facts.map(f => f.source_id))],
              components: { brand: round(s.brand), strength: s.strength, manufacturer: round(s.manufacturer), form: s.form, ...(s.generic !== undefined ? { generic: round(s.generic) } : {}) }
            }
          });
        }
      }
    }
  };
  runPass('generic_block');
  runPass('brand_block');
  const finalGroups = groups.filter(g => !absorbed.has(g));
  const pendingDgdaReview = new Set(reviewQueue
    .map(r => r.detail as { candidate_key: string; target_sources: string[] })
    .filter(d => d.target_sources.includes('dgda'))
    .map(d => d.candidate_key));

  // 3. Canonical records with per-field provenance.
  const medications: Array<Record<string, unknown>> = [];
  const provenance: Array<Record<string, unknown>> = [];
  const prices: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];
  const aliases: Array<Record<string, unknown>> = [];
  const genericIndex = new Map<string, { names: Map<string, number>; originals: Set<string>; salts: Set<string>; products: Set<string>; sources: Set<string> }>();
  const manufacturerIndex = new Map<string, { names: Map<string, { count: number; sources: Set<string>; precedence: number }>; aliases: Map<string, { rule: string; sources: Set<string> }>; products: Set<string>; sources: Set<string> }>();

  for (const group of finalGroups.sort((a, b) => a.key.localeCompare(b.key))) {
    const fs = group.facts;
    const brand = selectField(fs, f => ({ compare: f.brand_key, display: f.brand_name }))!;
    const generics = selectField(fs, f => ({ compare: genericSetKey(f.generics), display: f.generics.map(g => g.name) }))!;
    const strength = selectField(fs, f => (f.strength.raw || f.strength.key ? { compare: f.strength.key, display: f.strength.raw ?? f.strength.key } : undefined));
    const form = selectField(fs, f => ({ compare: f.dosage_form, display: f.dosage_form }))!;
    const manufacturer = selectField(fs, f => (f.manufacturer.key ? { compare: f.manufacturer.key, display: f.manufacturer.name } : undefined));
    const brandBn = selectField(fs, f => (f.brand_name_bn ? { compare: f.brand_name_bn, display: f.brand_name_bn } : undefined));
    const route = selectField(fs, f => (f.route ? { compare: f.route.toLowerCase(), display: f.route } : undefined));
    const pack = selectField(fs, f => (f.pack_size.raw ? { compare: f.pack_size.raw.toLowerCase().replace(/\s+/g, ''), display: f.pack_size.raw } : undefined));
    const reg = selectField(fs, f => (f.registration_number ? { compare: f.registration_number.replace(/\s+/g, ''), display: f.registration_number } : undefined));
    const tclass = selectField(fs, f => (f.therapeutic_class ? { compare: f.therapeutic_class.toLowerCase(), display: f.therapeutic_class } : undefined));

    const byPrecedence = (a: NormalizedFact, b: NormalizedFact) => precedenceOf(a.source_id) - precedenceOf(b.source_id);
    const bestStrengthFact = strength ? fs.filter(f => f.strength.key === strength.chosenCompare).sort(byPrecedence)[0] : undefined;
    const canonicalKey = recordKey({
      brand_name: String(brand.field.value),
      generics: fs.find(f => genericSetKey(f.generics) === generics.chosenCompare)!.generics,
      strength: bestStrengthFact?.strength ?? fs[0].strength,
      dosage_form: String(form.field.value),
      manufacturer: manufacturer ? fs.find(f => f.manufacturer.key === manufacturer.chosenCompare)!.manufacturer : { key: '' },
      route: route ? String(route.field.value) : undefined
    });
    const id = stableId('med', canonicalKey);
    const sourceIds = [...new Set(fs.map(f => f.source_id))].sort();

    const dgdaFacts = fs.filter(f => f.source_id === 'dgda');
    let dgdaMatch: string = 'NOT_CHECKED';
    if (dgdaLoaded) {
      // One or more DGDA registrations inside the canonical record → MATCHED. Several DAR numbers for the same
      // brand/generic/strength/form/company are the same product registered at different plants; they are all
      // kept in registration_number.alternatives and conflicts.jsonl. (DGDA records never merge fuzzily.)
      if (dgdaFacts.length) dgdaMatch = 'MATCHED';
      else {
        // A near DGDA match waiting in the review queue makes the cross-reference AMBIGUOUS, not NOT_FOUND.
        dgdaMatch = pendingDgdaReview.has(group.key) ? 'AMBIGUOUS' : 'NOT_FOUND';
      }
    }

    const record: Record<string, unknown> = {
      id,
      record_key: canonicalKey,
      brand_name: brand.field,
      ...(brandBn ? { brand_name_bn: brandBn.field } : {}),
      generic_names: generics.field,
      salt_forms: [...new Set(fs.flatMap(f => f.generics.map(g => g.salt_form).filter((s): s is string => !!s)))].sort(),
      strength: strength?.field ?? { value: null, sources: [], agreement_count: 0 },
      strength_parsed: bestStrengthFact?.strength.components ?? [],
      dosage_form: form.field,
      dosage_form_raw: [...new Set(fs.map(f => f.dosage_form_raw).filter((s): s is string => !!s))].sort(),
      ...(route ? { route: route.field } : {}),
      manufacturer: manufacturer?.field ?? { value: null, sources: [], agreement_count: 0 },
      ...(pack ? { pack_size: pack.field } : {}),
      ...(reg ? { registration_number: reg.field } : {}),
      ...(tclass ? { therapeutic_class: tclass.field } : {}),
      monograph_available: fs.some(f => f.monograph_available),
      monograph_urls: [...new Set(fs.filter(f => f.monograph_available).map(f => f.source_url))],
      dgda_match: dgdaMatch,
      source_ids: sourceIds,
      source_record_count: fs.length,
      status: 'UNVERIFIED'
    };
    medications.push(record);

    const fieldConflicts: Array<[string, ReturnType<typeof selectField>]> = [['brand_name', brand], ['generic_names', generics], ['strength', strength], ['dosage_form', form], ['manufacturer', manufacturer], ['route', route], ['pack_size', pack], ['registration_number', reg], ['therapeutic_class', tclass], ['brand_name_bn', brandBn]];
    for (const [field, sel] of fieldConflicts) {
      if (sel?.conflict) conflicts.push({ medication_id: id, field, chosen: sel.field.value, rule: sel.rule, values: sel.conflict });
    }

    for (const fact of fs) {
      const m = group.matchMethod.get(fact)!;
      provenance.push({ medication_id: id, source_id: fact.source_id, source_url: fact.source_url, ...(fact.source_record_id ? { source_record_id: fact.source_record_id } : {}), fetched_at: fact.fetched_at, content_hash: fact.content_hash, match_method: m.method, match_score: m.score });
      if (fact.unit_price_bdt !== undefined || fact.pack_price_bdt !== undefined) {
        prices.push({
          medication_id: id, record_key: fact.record_key, source_id: fact.source_id, source_url: fact.source_url,
          ...(fact.unit_price_bdt !== undefined ? { unit_price_bdt: fact.unit_price_bdt } : {}),
          ...(fact.pack_price_bdt !== undefined ? { pack_price_bdt: fact.pack_price_bdt } : {}),
          ...(fact.price_label ? { price_label: fact.price_label } : {}),
          is_official_mrp: /\bmrp\b/i.test(fact.price_label ?? ''),
          observed_at: fact.fetched_at
        });
      }
      for (const g of fact.generics) {
        const entry = genericIndex.get(g.key) ?? { names: new Map(), originals: new Set(), salts: new Set(), products: new Set(), sources: new Set() };
        entry.names.set(g.name, (entry.names.get(g.name) ?? 0) + 1);
        entry.originals.add(g.original);
        if (g.salt_form) entry.salts.add(g.salt_form);
        entry.products.add(id);
        entry.sources.add(fact.source_id);
        genericIndex.set(g.key, entry);
      }
      if (fact.manufacturer.key) {
        const entry = manufacturerIndex.get(fact.manufacturer.key) ?? { names: new Map(), aliases: new Map(), products: new Set(), sources: new Set() };
        const name = fact.manufacturer.name!;
        const named = entry.names.get(name) ?? { count: 0, sources: new Set<string>(), precedence: 99 };
        named.count++;
        named.precedence = Math.min(named.precedence, precedenceOf(fact.source_id));
        named.sources.add(fact.source_id);
        entry.names.set(name, named);
        if (fact.manufacturer.raw && fact.manufacturer.raw !== name) {
          const alias = entry.aliases.get(fact.manufacturer.raw) ?? { rule: fact.manufacturer.alias_rule ?? 'exact', sources: new Set<string>() };
          alias.sources.add(fact.source_id);
          entry.aliases.set(fact.manufacturer.raw, alias);
        }
        entry.products.add(id);
        entry.sources.add(fact.source_id);
        manufacturerIndex.set(fact.manufacturer.key, entry);
      }
    }

    // Aliases: brand spelling variants and Bangla names from sources; generated Banglish for search only.
    const canonicalBrand = String(brand.field.value);
    const variants = new Map<string, Set<string>>();
    for (const fact of fs) {
      if (fact.brand_name !== canonicalBrand && fact.brand_name.toLowerCase() !== canonicalBrand.toLowerCase()) {
        variants.set(fact.brand_name, (variants.get(fact.brand_name) ?? new Set()).add(fact.source_id));
      }
    }
    for (const [alias, srcs] of variants) aliases.push({ alias, script: 'latin', kind: 'brand_variant', alias_origin: 'source', target_type: 'medication', target_id: id, sources: [...srcs] });
    const bnNames = new Map<string, Set<string>>();
    for (const fact of fs) if (fact.brand_name_bn) bnNames.set(fact.brand_name_bn, (bnNames.get(fact.brand_name_bn) ?? new Set()).add(fact.source_id));
    for (const [alias, srcs] of bnNames) {
      aliases.push({ alias, script: 'bengali', kind: 'brand_bn', alias_origin: 'source', target_type: 'medication', target_id: id, sources: [...srcs] });
      const generated = transliterateBnToLatin(alias);
      if (generated && generated.toLowerCase() !== canonicalBrand.toLowerCase()) {
        aliases.push({ alias: generated, script: 'latin', kind: 'banglish', alias_origin: 'generated', target_type: 'medication', target_id: id, sources: [...srcs] });
      }
    }
  }

  const generics = [...genericIndex.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => {
    const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const id = stableId('gen', key);
    for (const original of e.originals) {
      if (original.toLowerCase() !== name.toLowerCase()) aliases.push({ alias: original, script: /[ঀ-৿]/.test(original) ? 'bengali' : 'latin', kind: 'generic_variant', alias_origin: 'source', target_type: 'generic', target_id: id, sources: [...e.sources] });
    }
    return { id, key, name: titleCase(name), aliases: [...e.originals].filter(o => o.toLowerCase() !== name.toLowerCase()).sort(), salt_forms: [...e.salts].sort(), product_count: e.products.size, source_ids: [...e.sources].sort() };
  });
  const manufacturers = [...manufacturerIndex.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => {
    // Display name follows source precedence (registry spelling first), then frequency.
    const name = [...e.names.entries()].sort((a, b) => a[1].precedence - b[1].precedence || b[1].count - a[1].count || a[0].localeCompare(b[0]))[0][0];
    // Every merge is logged: alias-table renames plus names that only differ by suffix, site/unit qualifier,
    // punctuation or spelling variant (rule "name_normalization").
    const logged = new Map<string, { rule: string; sources: Set<string> }>(e.aliases);
    for (const [other, info] of e.names) if (other !== name && !logged.has(other)) logged.set(other, { rule: 'name_normalization', sources: info.sources });
    return {
      id: stableId('mfr', key),
      key,
      name,
      aliases: [...logged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([raw, a]) => ({ raw, rule: a.rule, sources: [...a.sources].sort() })),
      product_count: e.products.size,
      source_ids: [...e.sources].sort()
    };
  });

  return { medications, generics, manufacturers, aliases, prices, provenance, conflicts, reviewQueue, stats: { exactGroups, fuzzyAutoMerges, fuzzyReview, dgdaLoaded } };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
