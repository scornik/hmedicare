import robotsParserModule from 'robots-parser';
import { BOT_NAME } from '../config.js';

export interface RobotsPolicy {
  origin: string;
  robotsUrl: string;
  /** HTTP status of robots.txt; 404/410 mean "no restrictions". */
  status: number;
  fetchedAt: string;
  contentHash: string | null;
  raw: string;
  crawlDelaySeconds: number | undefined;
  sitemaps: string[];
  /** Disallow rules from the group that applies to our bot (bot-specific group if present, else `*`). */
  disallow: string[];
  allow: string[];
  isAllowed(url: string): boolean;
}

interface Parser {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
}
// robots-parser is CommonJS; under NodeNext its default export types as the module namespace.
const robotsParser = robotsParserModule as unknown as (url: string, body: string) => Parser;

export function parseRobots(origin: string, raw: string, meta: { status: number; fetchedAt: string; contentHash: string | null }): RobotsPolicy {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const noRules = meta.status === 404 || meta.status === 410;
  const parser: Parser = robotsParser(robotsUrl, noRules ? '' : raw);
  const group = applicableGroup(noRules ? '' : raw);
  return {
    origin,
    robotsUrl,
    status: meta.status,
    fetchedAt: meta.fetchedAt,
    contentHash: meta.contentHash,
    raw,
    crawlDelaySeconds: parser.getCrawlDelay(BOT_NAME),
    sitemaps: parser.getSitemaps(),
    disallow: group.disallow,
    allow: group.allow,
    // robots-parser returns undefined for URLs on another origin: treat as not allowed.
    isAllowed: (url: string) => parser.isAllowed(url, BOT_NAME) === true
  };
}

/** Extracts Allow/Disallow lines for the user-agent group that applies to our bot, for reporting. */
export function applicableGroup(raw: string): { agent: string; allow: string[]; disallow: string[] } {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const line of raw.split(/\r?\n/)) {
    const cleaned = line.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(cleaned);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'disallow' && value) current.disallow.push(value);
    if (field === 'allow' && value) current.allow.push(value);
  }
  const bot = BOT_NAME.toLowerCase();
  const specific = groups.filter(g => g.agents.some(agent => agent !== '*' && bot.startsWith(agent)));
  const chosen = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  return {
    agent: specific.length ? specific[0].agents.join(',') : '*',
    allow: chosen.flatMap(g => g.allow),
    disallow: chosen.flatMap(g => g.disallow)
  };
}
