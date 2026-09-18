import type { StrengthComponent } from '../schemas.js';
import { bnDigitsToAscii } from '../sources/shared.js';

const UNIT_ALIASES: Record<string, string> = {
  mg: 'mg', mcg: 'mcg', µg: 'mcg', μg: 'mcg', ug: 'mcg', g: 'g', gm: 'g', gms: 'g', gram: 'g',
  ml: 'ml', l: 'l', iu: 'IU', 'i.u.': 'IU', unit: 'IU', units: 'IU', '%': '%', mmol: 'mmol', meq: 'mEq',
  actuation: 'actuation', puff: 'actuation', dose: 'dose', tablet: 'tablet', capsule: 'capsule', vial: 'vial',
  ampoule: 'ampoule', drop: 'drop', sachet: 'sachet', 'w/w': '%', 'w/v': '%'
};

// Also accepts a missing leading zero, as DGDA writes ".5 mg".
const NUM = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;
const UNIT = String.raw`(mg|mcg|µg|μg|ug|gms?|gram|g|ml|l|iu|i\.u\.|units?|%|mmol|meq)`;
const PER_UNIT = String.raw`(mg|mcg|gms?|g|ml|l|actuation|puff|dose|tablet|capsule|vial|ampoule|drop|sachet)`;
/** value unit [/ [per_value] per_unit]  e.g. 500 mg | 250 mg/5 ml | 40 IU/ml | 0.1% w/w | 100 mcg/actuation */
const COMPONENT = new RegExp(String.raw`${NUM}\s*${UNIT}(?:\s*(?:w/w|w/v))?(?:\s*(?:/|per)\s*(?:${NUM}\s*)?${PER_UNIT}\b)?`, 'gi');

const toNumber = (value: string) => Number(value.replace(',', '.'));
const unit = (u: string) => UNIT_ALIASES[u.toLowerCase()] ?? u.toLowerCase();

/**
 * Parses strength text into components, one per ingredient for combination products.
 * A slash between two mass values ("325MG/37.5MG") separates ingredients only when the product is known
 * to have several ingredients; otherwise it is a ratio ("3 gm/100 gm"). A trailing bare volume or a volume
 * on the last component ("175 mg + 225 mg/5 ml") applies to every ingredient. Never invents values.
 */
export function parseStrength(raw?: string, ingredientCount = 1): StrengthComponent[] {
  if (!raw) return [];
  const text = bnDigitsToAscii(raw.normalize('NFKC')).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const splitter = ingredientCount > 1
    ? /\s*\+\s*|\s*,\s*(?=\d)|(?<=[a-z%])\s*\/\s*(?=(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:mg|mcg|g|gm|iu)\b)/i
    : /\s*\+\s*|\s*,\s*(?=\d)/;
  let components: StrengthComponent[] = [];
  for (const segment of text.split(splitter)) {
    for (const match of segment.matchAll(COMPONENT)) {
      const component: StrengthComponent = { value: toNumber(match[1]), unit: unit(match[2]) };
      if (match[4]) {
        component.per_unit = unit(match[4]);
        component.per_value = match[3] ? toNumber(match[3]) : 1;
      }
      components.push(component);
    }
  }
  // "(175 mg + 225 mg) + 5 ml" → the bare volume is the denominator of every ingredient.
  const last = components.at(-1);
  if (components.length > 1 && last && (last.unit === 'ml' || last.unit === 'l') && !last.per_unit && components.slice(0, -1).every(c => !c.per_unit)) {
    components = components.slice(0, -1).map(c => ({ ...c, per_value: last.value, per_unit: last.unit }));
  }
  // "175 mg + 225 mg/5 ml" → propagate the volume denominator to earlier ingredients that lack one.
  const volumePer = components.findLast(c => c.per_unit === 'ml' || c.per_unit === 'l');
  if (volumePer && components.length > 1) {
    components = components.map(c => (c.per_unit || !MASS_TO_MG[c.unit] && c.unit !== 'IU' ? c : { ...c, per_value: volumePer.per_value, per_unit: volumePer.per_unit }));
  }
  return components;
}

const MASS_TO_MG: Record<string, number> = { mg: 1, mcg: 0.001, g: 1000 };
const VOLUME_TO_ML: Record<string, number> = { ml: 1, l: 1000 };
const fmt = (value: number) => String(Number(value.toPrecision(6)));

/**
 * Canonical key for comparing strengths across sources:
 *   mass → mg ("1 gm" ≡ "1000 mg"); mass per volume → mg/ml ("600 mg/3 ml" ≡ "200 mg/ml");
 *   mass per mass → % w/w ("3 g/100 g" ≡ "3%"); IU per volume → IU/ml; other denominators kept (500mg/vial).
 * Falls back to compacted raw text when nothing is parseable.
 */
export function strengthKey(raw: string | undefined, components = parseStrength(raw), opts: { liquid?: boolean; ingredientKeys?: string[] } = {}): string {
  if (!components.length) return (raw ?? '').toLowerCase().replace(/\s+/g, '');
  // Pair each strength with its ingredient and sort by ingredient, so source-specific ingredient order
  // ("Caffeine + Paracetamol 65 mg + 500 mg" vs "Paracetamol + Caffeine 500 mg + 65 mg") does not matter.
  let ordered = components;
  if (opts.ingredientKeys && opts.ingredientKeys.length === components.length && components.length > 1) {
    ordered = components.map((c, i) => [opts.ingredientKeys![i], c] as const).sort((a, b) => a[0].localeCompare(b[0])).map(([, c]) => c);
  }
  return ordered.map(c => {
    // In liquid presentations "%" is w/v: 0.5% = 5 mg/ml. In semi-solids it stays % w/w.
    if (opts.liquid && c.unit === '%' && !c.per_unit) return `${fmt(c.value * 10)}mg/ml`;
    const mg = MASS_TO_MG[c.unit];
    if (c.per_unit && c.per_value) {
      const perMl = VOLUME_TO_ML[c.per_unit];
      const perMg = MASS_TO_MG[c.per_unit];
      if (mg !== undefined && perMl !== undefined) return `${fmt((c.value * mg) / (c.per_value * perMl))}mg/ml`;
      if (mg !== undefined && perMg !== undefined) return `${fmt(((c.value * mg) / (c.per_value * perMg)) * 100)}%`;
      if (c.unit === 'IU' && perMl !== undefined) return `${fmt(c.value / (c.per_value * perMl))}IU/ml`;
      return `${fmt(mg !== undefined ? c.value * mg : c.value)}${mg !== undefined ? 'mg' : c.unit.toLowerCase()}/${c.per_value === 1 ? '' : fmt(c.per_value)}${c.per_unit.toLowerCase()}`;
    }
    if (mg !== undefined) return `${fmt(c.value * mg)}mg`;
    return `${fmt(c.value)}${c.unit === '%' ? '%' : c.unit.toLowerCase()}`;
  }).join('+');
}

/** "10 x 10", "3x10's", "30 tablets", "100 ml bottle" → units per pack when it is an explicit count. */
export function parsePackSize(raw?: string): { raw?: string; units_per_pack?: number } {
  if (!raw) return {};
  const text = bnDigitsToAscii(raw).toLowerCase();
  const grid = /(\d+)\s*[x×*]\s*(\d+)/.exec(text);
  if (grid) return { raw, units_per_pack: Number(grid[1]) * Number(grid[2]) };
  const count = /(\d+)\s*(?:'s|pcs|pieces|tablets?|capsules?|tabs?|caps?|sachets?|vials?|ampoules?|suppositor(?:y|ies))\b/.exec(text);
  if (count) return { raw, units_per_pack: Number(count[1]) };
  return { raw };
}
