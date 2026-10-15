// Renders models.catalog.json into the cordis patch that registers the pi-ai
// provider routes. Hand-rolled emitter so the package stays dependency-free.
import fs from 'node:fs';
import path from 'node:path';

const API_KEY_ENV = 'OPENCODE_API_KEY';
const SESSION_HEADER = 'dsh-opencode-doctor';
const DEFAULT_RETRY = { mode: 'normal', maxRetries: 5 };

// ---------------------------------------------------------------------------
// Everyday shortlist
// ---------------------------------------------------------------------------
// DSH's picker has no favourites feature, but it does fuzzy-search the model
// name — so starring the handful of models most people actually use turns the
// star into a filter: type `★` and the noise disappears. Ids are starred on
// every route that carries them, so a star never depends on which protocol you
// happened to pick.
const PICK_PREFIX = '★ ';
const PICKS = new Set([
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'gpt-5.3-codex',
  'grok-4.7',
  'deepseek-v4.1-flash',
  'glm-5.3',
  'kimi-k3',
  'qwen3.8-max',
  'minimax-m3',
]);

// ---------------------------------------------------------------------------
// Region routing (the "跳过地区限制" half)
// ---------------------------------------------------------------------------
// Models the probe marked `region` are reachable only from outside the
// mainland; they are routed through an outbound proxy while everything else
// keeps its direct route. The list is derived from the catalog rather than
// hand-written, so `probe` refreshes it automatically.
//
// The default proxy is the Clash Verge / Mihomo mixed port. It is only a
// starting point: `fallbackToDirect` means a user with no proxy at all still
// gets a fully working plugin — the region-blocked models simply fail the way
// they did before.
const PROXY_DEFAULT = 'http://127.0.0.1:7897';
const PROXY_ORIGINS = ['opencode.ai'];
const PROXY_TUNING = {
  fallbackToDirect: true,
  probeTimeoutMs: 300,
  probeCacheMs: 2000,
  peekBytes: 16384,
};

/** Model ids the probe found region-blocked, across every route. */
export function regionModelIds(catalog) {
  const ids = new Set();
  for (const route of catalog.routes ?? []) {
    for (const model of route.models ?? []) {
      if (model.code === 'region') ids.add(model.id);
    }
  }
  return [...ids].sort();
}

/**
 * The `model-proxy` row, which `dsh-model-proxy` turns into a routing undici
 * dispatcher: matching models go through the proxy, everything else keeps the
 * route it already had. Exact ids, never globs — a glob that over-matches
 * would silently send a working model through a needless hop.
 */
export function buildProxyRow(catalog) {
  const models = regionModelIds(catalog);
  if (!models.length) return null;
  return {
    insert: [
      {
        id: 'model-proxy',
        name: 'dsh-model-proxy',
        config: {
          enabled: true,
          proxy: PROXY_DEFAULT,
          origins: [...PROXY_ORIGINS],
          models,
          ...PROXY_TUNING,
        },
      },
    ],
  };
}

const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_\-./ ]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

function scalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (s !== '' && PLAIN.test(s) && !RESERVED.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function emit(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value
      .map((item) => {
        if (isContainer(item)) {
          const inner = emit(item, indent + 2);
          return `${pad}- ${inner.slice(indent + 2)}`;
        }
        return `${pad}- ${scalar(item)}`;
      })
      .join('\n');
  }
  if (isContainer(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return `${pad}{}`;
    return keys
      .map((key) => {
        const v = value[key];
        const k = scalar(key);
        if (isContainer(v)) {
          const empty = Array.isArray(v) ? !v.length : !Object.keys(v).length;
          if (empty) return `${pad}${k}: ${Array.isArray(v) ? '[]' : '{}'}`;
          return `${pad}${k}:\n${emit(v, indent + 2)}`;
        }
        return `${pad}${k}: ${scalar(v)}`;
      })
      .join('\n');
  }
  return `${pad}${scalar(value)}`;
}

export function toYaml(value) {
  return `${emit(value, 0)}\n`;
}

/** Model name shown in the picker. The picker has no description field, so any
 *  still-unfixed availability caveat has to live inside the name to be visible
 *  and searchable. */
export function displayName(model) {
  const note = availabilityNote(model);
  const base = note ? `${model.name}（${note}）` : model.name;
  return PICKS.has(model.id) ? `${PICK_PREFIX}${base}` : base;
}

/**
 * The availability annotation still worth showing, if any.
 *
 * Region blocks no longer count: this plugin routes those models through the
 * outbound proxy by default, so keeping 「地区限制」 in the name would warn
 * about a problem the user no longer has. Everything the plugin genuinely
 * cannot fix (balance, client-only free tiers, dead endpoints) keeps its note.
 */
export function availabilityNote(model) {
  if (model.code === 'region') return null;
  return model.note ?? null;
}

/** Models dropped from the picker entirely: no protocol on this gateway can
 *  call them, so listing them would only waste a slot. */
export function isUnreachable(model) {
  return model.code === 'protocol';
}

/**
 * Wire protocols `@deepseek-ai/dsh-llm-pi-ai` will accept from configuration.
 *
 * pi-ai itself speaks more (Google's native surface among them), but the DSH
 * wrapper hardcodes this table and rejects any other value — with a validation
 * error that fails the *whole* llm-pi-ai entry, taking every route down with
 * it. The catalog still records the probe result for protocols we cannot ship
 * (see {@link unshippableRoutes}), so the day upstream widens the table a
 * plain `probe` restores those models with no code change here.
 */
const SUPPORTED_APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);

/** Routes the catalog carries but the patch cannot register. */
export function unshippableRoutes(catalog) {
  return (catalog.routes ?? []).filter(
    (route) => (route.models ?? []).length && !SUPPORTED_APIS.has(route.api),
  );
}

/** Whether the model belongs to the everyday shortlist (rendered with a star). */
export function isPick(model) {
  return PICKS.has(model.id);
}

function modelEntry(model) {
  const entry = { id: model.id, name: displayName(model) };
  if (model.contextWindow) entry.contextWindow = model.contextWindow;
  if (model.maxTokens) entry.maxTokens = model.maxTokens;
  if (Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length) {
    entry.reasoningEfforts = Object.fromEntries(
      model.reasoningEfforts.map((level) => [level, level === 'off' ? null : level]),
    );
  }
  if (model.compat && Object.keys(model.compat).length) entry.compat = model.compat;
  return entry;
}

export function buildProviders(catalog) {
  const providers = {};
  for (const route of catalog.routes ?? []) {
    if (!SUPPORTED_APIS.has(route.api)) continue;
    const callable = (route.models ?? []).filter((model) => !isUnreachable(model));
    if (!callable.length) continue;
    const provider = {
      displayName: route.label,
      api: route.api,
      baseURL: route.baseURL,
      apiKeyEnv: API_KEY_ENV,
      headers: { ...(route.headers ?? {}), 'x-opencode-session': SESSION_HEADER },
    };
    if (route.providerCompat && Object.keys(route.providerCompat).length) {
      provider.compat = route.providerCompat;
    }
    provider.models = callable.map(modelEntry);
    provider.retryPolicy = { ...DEFAULT_RETRY };
    providers[route.routeId] = provider;
  }
  return providers;
}

function header(catalog) {
  const routes = (catalog.routes ?? [])
    .filter((route) => SUPPORTED_APIS.has(route.api))
    .map((route) => ({ ...route, models: (route.models ?? []).filter((m) => !isUnreachable(m)) }))
    .filter((route) => route.models.length);
  const total = routes.reduce((n, r) => n + r.models.length, 0);
  const usable = routes.reduce((n, r) => n + r.models.filter((m) => !availabilityNote(m)).length, 0);
  const noted = total - usable;
  const region = regionModelIds(catalog).length;
  // Distinct ids, not per-route rows: the same model often appears on both the
  // Go and the Zen route, and users count models, not rows.
  const picks = new Set(
    routes.flatMap((r) => r.models.filter((m) => PICKS.has(m.id)).map((m) => m.id)),
  ).size;
  const held = unshippableRoutes(catalog);
  const heldLines = held.length
    ? [
        '#',
        '# Not listed here — probed, working, but unreachable from configuration:',
        ...held.map((route) => `#   ${route.label} (${route.api}) — ${route.models.length} models`),
        '#   DSH only accepts openai-completions / openai-responses /',
        '#   anthropic-messages from a provider config, and naming any other',
        '#   protocol fails the whole llm-pi-ai entry. Re-run `probe` once',
        '#   upstream widens that table and the route reappears on its own.',
      ].join('\n')
    : null;
  return `# dsh-opencode-doctor — GENERATED FILE, do not edit by hand.
#
# Registers pre-probed OpenCode provider routes on @deepseek-ai/dsh-llm-pi-ai,
# and routes the region-blocked ones through an outbound proxy.
#
# The picker renders only the model name (no description), so an availability
# caveat has to live inside the name to be visible — and searchable: typing
# "需充值" filters that whole group. Models this plugin already fixed carry no
# caveat at all: the region-blocked ones ride the proxy below.
#
# Starred entries are the everyday shortlist; the picker fuzzy-searches names,
# so typing "${PICK_PREFIX.trim()}" narrows the list to them.
#
# Route ids carry a -doctor suffix and a protocol suffix on purpose:
# dsh-opencode-go owns \`opencode-go\`, and registering the same id twice fails
# the whole composition.
#
# Credential: refs.${API_KEY_ENV} in .credentials.yaml (or the matching env var).
# Re-probe and rewrite this file with:  npx dsh-opencode-doctor probe
#
# Probed ${catalog.probedAt} · ${total} model entries registered across ${routes.length} routes
#   ${usable} with no caveat, ${noted} keeping one (需充值 / 限官方客户端)
#   ${picks} starred as the everyday shortlist — type ${PICK_PREFIX.trim()} to filter
#   ${region} region-blocked ride the proxy below (no caveat: already fixed)${heldLines ? `\n${heldLines}` : ''}
#
# Changing the outbound proxy: the \`model-proxy\` row further down is a plain
# override target — add your own \`- id: model-proxy\` row to the profile patch
# and set \`proxy\` to whatever your local client listens on. Leaving it
# unreachable is safe: matching models fall back to a direct connection.
#
# One row, not two: the row below is the only one this plugin relies on. If
# \`dsh-model-proxy\` is ALSO listed in your profile's dsh.profile.bundles, its
# own bundled patch inserts a second row (default 127.0.0.1:7890, models
# grok-* and gpt-*-luna) — two rows chain two dispatchers rather than
# overriding, so drop it from that list. As a plain dependency of this plugin
# it stays installed and resolvable, which is the intended shape.
# ============================================================
`;
}

export function renderPatch(catalog) {
  const rows = [
    {
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: { providers: buildProviders(catalog) },
    },
  ];
  const proxy = buildProxyRow(catalog);
  if (proxy) rows.push(proxy);
  return header(catalog) + toYaml(rows);
}

export function writePatch(catalog, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderPatch(catalog), 'utf8');
  return outFile;
}
