// Live availability probing for the OpenCode gateways.
//
// The point of this package: a gateway's /models endpoint lists what it *can*
// serve, not what your account *may* use, and not which wire protocol each
// model answers on. Region blocks, empty balances, client-only free tiers and
// protocol mismatches all surface only when you actually send a request. So we
// send one — per model, per protocol — and record the verdict in the model name.
import fs from 'node:fs';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Session id written into the generated provider headers. Stable on purpose:
 *  dsh-opencode-go does the same, and low request volume tolerates it. */
export const SESSION = 'dsh-opencode-doctor';

/** Probing fires hundreds of requests, and the gateway throttles a repeated
 *  session id — so every probe request gets its own. */
let sessionSeq = 0;
function probeSession() {
  sessionSeq += 1;
  return `dsh-doctor-${Date.now().toString(36)}-${sessionSeq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Availability vocabulary — keep in sync with README. */
export const NOTES = {
  funds: '需充值',
  freetier: '限官方客户端',
  region: '地区限制',
  authdata: '需授权训练数据',
  unavailable: '暂不可用',
  // Reached only when every protocol failed with ModelProtocolUnsupported — the
  // model is exposed by /models but speaks none of the three wire protocols we
  // can drive, so it is unusable here. It needs a note like any other failure,
  // otherwise it renders as a plain usable model.
  protocol: '协议不兼容',
};

/** Gateways we probe. */
export const BASES = [
  {
    key: 'go',
    label: 'OpenCode Go',
    modelsUrl: 'https://opencode.ai/inference/go/v1/models',
  },
  {
    key: 'zen',
    label: 'OpenCode Zen',
    modelsUrl: 'https://opencode.ai/inference/v1/models',
  },
];

/** Wire protocols, in the order we try them for a non-Claude model. */
export const PROTOCOLS = {
  openai: { api: 'openai-completions', compat: { supportsReasoningEffort: true } },
  anthropic: { api: 'anthropic-messages', compat: null },
  responses: { api: 'openai-responses', compat: null },
};

/**
 * Per (gateway, protocol): the route id, the baseURL pi-ai needs, and the full
 * URL probing must POST to.
 *
 * These differ for the Anthropic protocol and it is worth being explicit about
 * why: pi-ai drives the Anthropic SDK, which appends `/v1/messages` to whatever
 * baseURL you give it — so the provider baseURL must NOT contain `/v1`, or the
 * request lands on `/v1/v1/messages` and 404s. Probing builds the URL by hand,
 * so it needs the segment spelled out.
 */
export const ROUTES = {
  'go:anthropic': {
    id: 'opencode-go-doctor-anthropic',
    displayName: 'OpenCode Go · Claude',
    api: 'anthropic-messages',
    baseURL: 'https://opencode.ai/inference/go',
    probeURL: 'https://opencode.ai/inference/go/v1/messages',
  },
  'go:openai': {
    id: 'opencode-go-doctor-openai',
    displayName: 'OpenCode Go · OpenAI',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    probeURL: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
  },
  'go:responses': {
    id: 'opencode-go-doctor-responses',
    displayName: 'OpenCode Go · Responses',
    api: 'openai-responses',
    baseURL: 'https://opencode.ai/inference/go/openai/v1',
    probeURL: 'https://opencode.ai/inference/go/openai/v1/responses',
  },
  'zen:anthropic': {
    id: 'opencode-zen-doctor-anthropic',
    displayName: 'OpenCode Zen · Claude',
    api: 'anthropic-messages',
    baseURL: 'https://opencode.ai/inference',
    probeURL: 'https://opencode.ai/inference/v1/messages',
  },
  'zen:openai': {
    id: 'opencode-zen-doctor-openai',
    displayName: 'OpenCode Zen · OpenAI',
    api: 'openai-completions',
    baseURL: 'https://opencode.ai/inference/v1',
    probeURL: 'https://opencode.ai/inference/v1/chat/completions',
  },
  'zen:responses': {
    id: 'opencode-zen-doctor-responses',
    displayName: 'OpenCode Zen · Responses',
    api: 'openai-responses',
    baseURL: 'https://opencode.ai/inference/v1',
    probeURL: 'https://opencode.ai/inference/v1/responses',
  },
};

/** Where models with no working protocol are listed, so they stay visible. */
export const FALLBACK_PROTOCOL = 'openai';

/** Internal test entries the gateway exposes but nobody should select. */
export const SKIP_IDS = new Set(['test']);

/** Codes that mean "wrong wire protocol, try the next one". */
const RETRY_CODES = new Set(['protocol', 'unavailable']);

/** Most informative verdict when nothing worked. */
const PRIORITY = ['funds', 'freetier', 'region', 'authdata', 'unavailable', 'protocol'];

/**
 * Reasoning levels offered per protocol.
 *
 * `off` is deliberately absent from the Responses set: pi-ai forwards `off` as
 * `reasoning_effort: "none"`, and the models that live on that route (grok,
 * gpt-codex) reject `none` outright. Declaring only real levels keeps the
 * picker from offering a value that cannot work.
 */
const EFFORTS = {
  anthropic: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['off', 'low', 'medium', 'high'],
  responses: ['low', 'medium', 'high'],
};

/** Families known to reason even when models.dev has no entry for them. */
const REASONING_HINT = /^(claude|gpt-5|gpt-6|grok|o[134]|glm-5|qwen3|deepseek-v4|kimi-k3|minimax-m3|muse-spark|gemini-3|gemini-4)/i;

function effortsFor(id, protocol, reasoning) {
  if (!reasoning) return null;
  return EFFORTS[protocol] ?? EFFORTS.openai;
}

/** Claude on the Anthropic protocol rejects `thinking.type.disabled` — it only
 *  accepts adaptive thinking. Without this flag pi-ai sends `disabled` and the
 *  upstream answers 400. */
function compatFor(id, protocol, known) {
  if (protocol === 'anthropic' && /^claude/i.test(id)) return { forceAdaptiveThinking: true };
  return known?.compat ?? null;
}

export function classify(status, body) {
  const text = String(body ?? '').toLowerCase();
  if (status >= 200 && status < 300) return { code: 'ok', note: null };
  if (/modelprotocolunsupported|does not support this protocol|unsupported.*protocol/.test(text)) {
    return { code: 'protocol', note: NOTES.protocol };
  }
  if (/insufficient account funds|insufficient_quota|insufficient balance|out of credits/.test(text)) {
    return { code: 'funds', note: NOTES.funds };
  }
  if (/freetier|free tier|free_tier|only available in the opencode|upgrade to use/.test(text)) {
    return { code: 'freetier', note: NOTES.freetier };
  }
  if (/unsupported_country_region_territory|not available in your (country|region)|country, region, or territory/.test(text)) {
    return { code: 'region', note: NOTES.region };
  }
  if (/training data|training_data|model training|opt.?in to.*training/.test(text)) {
    return { code: 'authdata', note: NOTES.authdata };
  }
  return { code: 'unavailable', note: NOTES.unavailable };
}

function request(base, protocol, model, key) {
  const { probeURL } = ROUTES[`${base.key}:${protocol}`];
  const headers = {
    'content-type': 'application/json',
    'x-opencode-session': probeSession(),
    'user-agent': UA,
  };
  if (protocol === 'anthropic') {
    return {
      url: probeURL,
      headers: { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 },
    };
  }
  const bearer = { ...headers, authorization: `Bearer ${key}` };
  if (protocol === 'responses') {
    return {
      url: probeURL,
      headers: bearer,
      body: { model, input: 'hi', max_output_tokens: 16 },
    };
  }
  return {
    url: probeURL,
    headers: bearer,
    body: { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 },
  };
}

async function send(base, protocol, model, key, timeoutMs) {
  const { url, headers, body } = request(base, protocol, model, key);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return classify(res.status, await res.text());
  } catch (err) {
    return { code: 'unavailable', note: NOTES.unavailable, transport: err?.name ?? String(err) };
  }
}

/** Claude answers best on the Anthropic protocol, so ask there first. */
function protocolOrder(modelId) {
  return /^claude/.test(modelId)
    ? ['anthropic', 'openai', 'responses']
    : ['openai', 'anthropic', 'responses'];
}

export async function fetchModelIds(base, key, timeoutMs = 25000) {
  const res = await fetch(base.modelsUrl, {
    headers: { authorization: `Bearer ${key}`, 'user-agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${base.modelsUrl} → HTTP ${res.status}`);
  const data = await res.json();
  return [...new Set((data.data ?? []).map((m) => m.id))]
    .filter((id) => !SKIP_IDS.has(id))
    .sort();
}

/** Minimal promise pool — keeps the gateway from rate-limiting a wide burst. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/** models.dev catalog. Best-effort — a failure only costs us nicer metadata. */
export async function fetchCatalog(timeoutMs = 25000) {
  try {
    const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function metadataFrom(catalog, providerIds, modelId) {
  for (const providerId of providerIds) {
    const entry = catalog?.[providerId]?.models?.[modelId];
    if (entry) {
      const limit = entry.limit ?? {};
      return {
        name: entry.name ?? modelId,
        contextWindow: limit.context ?? null,
        maxTokens: limit.output ?? null,
        reasoning: Boolean(entry.reasoning),
      };
    }
  }
  return null;
}

function previousIndex(catalog) {
  const index = new Map();
  for (const route of catalog?.routes ?? []) {
    for (const model of route.models ?? []) {
      index.set(`${route.gateway}/${model.id}`, { ...model, gateway: route.gateway });
    }
  }
  return index;
}

/**
 * Probe every gateway and return a fresh catalog, preserving metadata we
 * already know for models that are still present.
 */
export async function probe({ key, previous = null, concurrency = 4, timeoutMs = 60000, onProgress } = {}) {
  const modelsdev = await fetchCatalog();
  const before = previousIndex(previous);
  const routes = new Map(); // "gateway:protocol" → route

  const routeFor = (gateway, protocol) => {
    const routeKey = `${gateway}:${protocol}`;
    if (!routes.has(routeKey)) {
      const spec = ROUTES[routeKey];
      routes.set(routeKey, {
        routeKey,
        gateway,
        protocol,
        routeId: spec.id,
        label: spec.displayName,
        api: spec.api,
        baseURL: spec.baseURL,
        headers: { 'x-opencode-session': SESSION },
        providerCompat: PROTOCOLS[protocol]?.compat ?? null,
        models: [],
      });
    }
    return routes.get(routeKey);
  };

  for (const base of BASES) {
    let ids;
    try {
      ids = await fetchModelIds(base, key);
    } catch (err) {
      onProgress?.(`${base.key}: model list failed — ${err.message}`);
      continue;
    }

    onProgress?.(`${base.key}: probing ${ids.length} models (3 protocols, first hit wins)`);

    let done = 0;
    const records = await pool(ids, concurrency, async (id) => {
      const verdicts = [];
      let won = null;
      for (const protocol of protocolOrder(id)) {
        const verdict = await send(base, protocol, id, key, timeoutMs);
        verdicts.push({ protocol, ...verdict });
        if (verdict.code === 'ok') {
          won = protocol;
          break;
        }
        if (!RETRY_CODES.has(verdict.code)) break;
      }

      done += 1;
      onProgress?.(
        `${base.key}: ${String(done).padStart(2)}/${ids.length} ${id} → ${won ?? bestOf(verdicts).code}`,
      );

      const known = before.get(`${base.key}/${id}`);
      const meta =
        known ??
        metadataFrom(modelsdev, ['opencode-go', 'opencode', 'opencode-zen'], id) ?? {
          name: id,
          contextWindow: null,
          maxTokens: null,
          reasoning: false,
        };

      const reasoning =
        Boolean(meta.reasoning) ||
        (Array.isArray(known?.reasoningEfforts) && known.reasoningEfforts.length > 0) ||
        REASONING_HINT.test(id);

      const fallback = bestOf(verdicts);
      return {
        gateway: base.key,
        protocol: won ?? FALLBACK_PROTOCOL,
        usable: Boolean(won),
        model: {
          id,
          name: known?.name ?? meta.name ?? id,
          note: won ? null : fallback.note,
          code: won ? 'ok' : fallback.code,
          contextWindow: known?.contextWindow ?? meta.contextWindow ?? null,
          maxTokens: known?.maxTokens ?? meta.maxTokens ?? null,
          reasoningEfforts: effortsFor(id, won ?? FALLBACK_PROTOCOL, reasoning),
          compat: compatFor(id, won, known),
        },
      };
    });

    for (const record of records) {
      routeFor(record.gateway, record.protocol).models.push(record.model);
    }
  }

  const ordered = [...routes.values()].sort(
    (a, b) => a.gateway.localeCompare(b.gateway) || a.protocol.localeCompare(b.protocol),
  );

  return {
    $comment:
      'Probe result for the OpenCode gateways. `note` is the availability annotation rendered into the model name. Regenerate with: npx dsh-opencode-doctor probe',
    schema: 2,
    probedAt: new Date().toISOString().slice(0, 10),
    routes: ordered,
  };
}

function bestOf(verdicts) {
  for (const code of PRIORITY) {
    const hit = verdicts.find((v) => v.code === code);
    if (hit) return hit;
  }
  return verdicts[verdicts.length - 1] ?? { code: 'unavailable', note: NOTES.unavailable };
}

export function summarize(catalog) {
  return (catalog.routes ?? []).map((route) => {
    const usable = route.models.filter((m) => !m.note);
    return {
      routeId: route.routeId,
      gateway: route.gateway,
      protocol: route.protocol,
      total: route.models.length,
      usable: usable.length,
      blocked: route.models.length - usable.length,
    };
  });
}

export function readCatalog(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
