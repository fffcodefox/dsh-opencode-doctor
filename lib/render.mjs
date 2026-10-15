// Renders models.catalog.json into the cordis patch that registers the pi-ai
// provider routes. Hand-rolled emitter so the package stays dependency-free.
import fs from 'node:fs';
import path from 'node:path';

const API_KEY_ENV = 'OPENCODE_API_KEY';
const SESSION_HEADER = 'dsh-opencode-doctor';
const DEFAULT_RETRY = { mode: 'normal', maxRetries: 5 };

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

/** Model name shown in the picker. The picker has no description field, so the
 *  availability note has to live inside the name to be visible and searchable. */
export function displayName(model) {
  return model.note ? `${model.name}（${model.note}）` : model.name;
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
    if (!route.models?.length) continue;
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
    provider.models = route.models.map(modelEntry);
    provider.retryPolicy = { ...DEFAULT_RETRY };
    providers[route.routeId] = provider;
  }
  return providers;
}

function header(catalog) {
  const routes = (catalog.routes ?? []).filter((r) => r.models?.length);
  const total = routes.reduce((n, r) => n + r.models.length, 0);
  const usable = routes.reduce((n, r) => n + r.models.filter((m) => !m.note).length, 0);
  return `# dsh-opencode-doctor — GENERATED FILE, do not edit by hand.
#
# Registers pre-probed OpenCode provider routes on @deepseek-ai/dsh-llm-pi-ai.
# Model names carry an availability suffix because the DSH model picker renders
# only the name (no description) — that also makes the notes searchable, so
# typing "需充值" filters the whole group.
#
# Route ids carry a -doctor suffix and a protocol suffix on purpose:
# dsh-opencode-go owns \`opencode-go\`, and registering the same id twice fails
# the whole composition.
#
# Credential: refs.${API_KEY_ENV} in .credentials.yaml (or the matching env var).
# Re-probe and rewrite this file with:  npx dsh-opencode-doctor probe
#
# Probed ${catalog.probedAt} · ${usable} usable / ${total} total across ${routes.length} routes
# ============================================================
`;
}

export function renderPatch(catalog) {
  return (
    header(catalog) +
    toYaml([
      {
        id: 'llm-pi-ai',
        name: '@deepseek-ai/dsh-llm-pi-ai',
        config: { providers: buildProviders(catalog) },
      },
    ])
  );
}

export function writePatch(catalog, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderPatch(catalog), 'utf8');
  return outFile;
}
