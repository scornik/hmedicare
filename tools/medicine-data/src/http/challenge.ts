/**
 * Detects bot-protection interstitials (Cloudflare, Sucuri, Incapsula, DDoS-Guard, AWS WAF, CAPTCHA walls).
 * We never try to pass these; detection only stops the source.
 * Markers are specific on purpose: a page that merely loads a CDN script from cloudflare is not a challenge.
 */
const BODY_MARKERS: RegExp[] = [
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /\/cdn-cgi\/challenge-platform\//i,
  /\bcf-chl-(?:bypass|widget|opt)/i,
  /attention required!\s*\|\s*cloudflare/i,
  /sucuri website firewall - access denied/i,
  /_incapsula_resource|incapsula incident id/i,
  /ddos-guard/i,
  /awswaf|aws-waf-token/i,
  /<title>[^<]*(captcha|verify you are human|are you a robot|access denied|bot verification)[^<]*<\/title>/i,
  /class=["'][^"']*\b(g-recaptcha|h-captcha|cf-turnstile)\b/i
];

export function detectChallenge(status: number, headers: Headers | Record<string, string>, body: string): string | null {
  const get = (name: string) => (headers instanceof Headers ? headers.get(name) : headers[name.toLowerCase()]) ?? '';
  if (get('cf-mitigated').toLowerCase() === 'challenge') return 'cf-mitigated: challenge header';
  if (get('x-amzn-waf-action')) return `AWS WAF action header (${get('x-amzn-waf-action')})`;
  const head = body.slice(0, 50_000);
  for (const marker of BODY_MARKERS) {
    if (marker.test(head)) return `challenge marker ${marker.source}`;
  }
  if (status === 503 && /cloudflare/i.test(get('server')) && /challenge|captcha/i.test(head)) return 'cloudflare 503 challenge';
  return null;
}
