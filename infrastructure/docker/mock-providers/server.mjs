// Provider-shaped HTTP mocks for local development and adapter contract tests (LOCAL-DEVELOPMENT.md §2).
// Zero dependencies. Never makes outbound calls. Never stores API keys or full phone numbers.
//
// Zaman IT (ADR-018):
//   POST /zamanit/api/sendsms      form body: api_key, type, phone, senderid, message
//   POST /zamanit/api/checkbalance form body: api_key
//   Any GET to /zamanit/api/*  → 405 (the real adapter must never use GET, T27)
// The real success/balance response formats are UNVERIFIED (ZAMANIT-VERIFICATION.md ZAMANIT-VER-02),
// so these bodies are deliberately labelled "PROVISIONAL-MOCK" and only error codes 1001–1007 are real.
//
// Scenario control (tests):
//   POST /__mock/zamanit/scenario  {"scenario": "<name>", "times": n?}
//   GET  /__mock/zamanit/requests  recorded requests (method, path, content type, key presence, masked phone)
//   POST /__mock/reset
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4010);
const SCENARIOS = new Set([
  'success',
  'e1001',
  'e1002',
  'e1003',
  'e1004',
  'e1005',
  'e1006',
  'e1007',
  'timeout_after_send',
  'http500',
  'unparseable',
  'low_balance',
]);

let scenarioQueue = [];
let defaultScenario = 'success';
let requests = [];

function nextScenario() {
  const head = scenarioQueue[0];
  if (!head) return defaultScenario;
  head.times -= 1;
  if (head.times <= 0) scenarioQueue.shift();
  return head.scenario;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function maskPhone(phone) {
  return typeof phone === 'string' && phone.length > 4
    ? `${'*'.repeat(phone.length - 3)}${phone.slice(-3)}`
    : null;
}

async function zamanit(req, res, url) {
  const body = await readBody(req);
  const form = new URLSearchParams(body);
  const endpoint = url.pathname.endsWith('/checkbalance') ? 'checkbalance' : 'sendsms';
  requests.push({
    at: new Date().toISOString(),
    method: req.method,
    endpoint,
    contentType: req.headers['content-type'] ?? null,
    queryPresent: url.search.length > 0,
    apiKeyPresent: Boolean(form.get('api_key')),
    type: form.get('type'),
    phoneMasked: maskPhone(form.get('phone')),
    senderid: form.get('senderid'),
    messageLength: (form.get('message') ?? '').length,
  });
  if (req.method !== 'POST')
    return json(res, 405, { status: 'PROVISIONAL-MOCK', error: 'method not allowed' });
  const scenario = nextScenario();
  const errMatch = scenario.match(/^e(100[1-7])$/);
  if (errMatch) return json(res, 200, { status: 'PROVISIONAL-MOCK', error_code: Number(errMatch[1]) });
  if (scenario === 'http500') return json(res, 500, { status: 'PROVISIONAL-MOCK', error: 'server error' });
  if (scenario === 'unparseable') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<html>maintenance</html>');
  }
  if (scenario === 'timeout_after_send') {
    // The message is "sent" but the response never arrives within any sane client timeout.
    return setTimeout(() => json(res, 200, { status: 'PROVISIONAL-MOCK', result: 'accepted-late' }), 60_000);
  }
  if (endpoint === 'checkbalance') {
    return json(res, 200, {
      status: 'PROVISIONAL-MOCK',
      balance: scenario === 'low_balance' ? '12.50' : '1500.00',
    });
  }
  return json(res, 200, { status: 'PROVISIONAL-MOCK', result: 'accepted' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
    if (url.pathname.startsWith('/zamanit/api/')) return await zamanit(req, res, url);
    if (url.pathname === '/__mock/zamanit/scenario' && req.method === 'POST') {
      const { scenario, times, persistent } = JSON.parse((await readBody(req)) || '{}');
      if (!SCENARIOS.has(scenario))
        return json(res, 400, { error: 'unknown scenario', scenarios: [...SCENARIOS] });
      if (persistent) defaultScenario = scenario;
      else scenarioQueue.push({ scenario, times: Number(times ?? 1) });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/__mock/zamanit/requests') return json(res, 200, { requests });
    if (url.pathname === '/__mock/reset' && req.method === 'POST') {
      scenarioQueue = [];
      defaultScenario = 'success';
      requests = [];
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  } catch {
    return json(res, 500, { error: 'mock failure' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`mock-providers listening on ${PORT}`);
});

export { server };
