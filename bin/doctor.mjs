#!/usr/bin/env node
// dsh-opencode-doctor CLI.
//
//   probe    re-probe both OpenCode gateways and rewrite the catalog + patch
//   render   rewrite cordis.patch.yml from models.catalog.json (no network)
//   list     print what the shipped catalog contains
//   check    resolve the credential and verify each gateway answers
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveKey, maskKey, dshHome, SEARCHED } from '../lib/keys.mjs';
import { writePatch } from '../lib/render.mjs';
import { probe, readCatalog, summarize, fetchModelIds, BASES, NOTES } from '../lib/probe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_FILE = path.join(ROOT, 'models.catalog.json');
const PATCH_FILE = path.join(ROOT, 'cordis.patch.yml');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const C = color
  ? {
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
      ok: (s) => `\x1b[32m${s}\x1b[0m`,
      bad: (s) => `\x1b[31m${s}\x1b[0m`,
      warn: (s) => `\x1b[33m${s}\x1b[0m`,
    }
  : { dim: (s) => s, bold: (s) => s, ok: (s) => s, bad: (s) => s, warn: (s) => s };

const GATEWAY_KEYS = BASES.map((b) => b.key);

const HELP = `${C.bold('dsh-opencode-doctor')} — pre-probed OpenCode model routes for DeepSeek Harness

${C.bold('Usage')}
  npx dsh-opencode-doctor <command> [options]

${C.bold('Commands')}
  list                Show the shipped catalog (offline)
  probe               Re-probe both gateways, rewrite catalog + patch
  render              Rewrite cordis.patch.yml from the catalog (offline)
  check               Resolve the credential and ping each gateway

${C.bold('Options')}
  --key <key>         OpenCode API key (default: env → .credentials.yaml → auth.json)
  --gateway <key>     probe only one gateway (${GATEWAY_KEYS.join(', ')})
  --concurrency <n>   parallel probes during \`probe\` (default 4)
  --timeout <ms>      per-request timeout (default 60000)
  --json              machine-readable output for \`list\` / \`check\`
  -h, --help          Show this help
  -v, --version       Show the version

${C.bold('Availability notes written into model names')}
${Object.entries(NOTES).map(([code, note]) => `  ${note.padEnd(8)} ${C.dim(code)}`).join('\n')}
`;

function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function loadCatalog() {
  const catalog = readCatalog(CATALOG_FILE);
  if (!catalog) {
    console.error(C.bad(`No catalog at ${CATALOG_FILE}. Run \`probe\` first.`));
    process.exit(1);
  }
  return catalog;
}

function cmdList(catalog, { json }) {
  if (json) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }
  const routes = (catalog.routes ?? []).filter((r) => r.models?.length);
  const total = routes.reduce((n, r) => n + r.models.length, 0);
  const usable = routes.reduce((n, r) => n + r.models.filter((m) => !m.note).length, 0);
  console.log(
    `${C.bold('dsh-opencode-doctor')} · probed ${catalog.probedAt} · ${C.ok(`${usable} usable`)} / ${total} total\n`,
  );
  for (const route of routes) {
    const ok = route.models.filter((m) => !m.note);
    const blocked = route.models.length - ok.length;
    console.log(`${C.bold(route.label)}  ${C.dim(`route ${route.routeId} · ${route.api}`)}`);
    console.log(
      `  ${ok.length} usable` +
        (blocked ? `, ${C.warn(`${blocked} blocked`)}` : '') +
        `  ${C.dim(`(${route.models.length} total)`)}`,
    );
    for (const model of route.models) {
      const mark = model.note ? C.bad('✕') : C.ok('✓');
      const note = model.note ? `  ${C.warn(`（${model.note}）`)}` : '';
      const ctx = model.contextWindow ? C.dim(` ctx ${Math.round(model.contextWindow / 1024)}k`) : '';
      console.log(`    ${mark} ${model.id.padEnd(36)}${note}${ctx}`);
    }
    console.log();
  }
}

function cmdRender() {
  writePatch(loadCatalog(), PATCH_FILE);
  console.log(C.ok(`wrote ${path.relative(process.cwd(), PATCH_FILE)}`));
}

async function cmdCheck({ key: explicitKey, json }) {
  const { key, source } = resolveKey(explicitKey);
  if (!key) {
    if (json) {
      console.log(JSON.stringify({ credential: { found: false, searched: SEARCHED }, gateways: [] }, null, 2));
    } else {
      console.log(C.bad('No OpenCode credential found.'));
      console.log(`\nSearched:\n  env ${SEARCHED.ENV_NAMES.join(', ')}`);
      for (const f of [...SEARCHED.credentialFiles(), ...SEARCHED.opencodeAuthFiles()]) {
        console.log(`  ${f}`);
      }
      console.log(
        `\nAdd one under refs.OPENCODE_API_KEY in ${path.join(dshHome(), '.credentials.yaml')}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!json) console.log(`${C.bold('credential')}  ${maskKey(key)}  ${C.dim(`← ${source}`)}\n`);

  const rows = [];
  for (const base of BASES) {
    try {
      const ids = await fetchModelIds(base, key);
      rows.push({ gateway: base.key, ok: true, models: ids.length });
      if (!json) {
        console.log(`  ${C.ok('✓')} ${base.key.padEnd(6)} ${String(ids.length).padStart(3)} models  ${C.dim(base.modelsUrl)}`);
      }
    } catch (err) {
      rows.push({ gateway: base.key, ok: false, error: err.message });
      if (!json) console.log(`  ${C.bad('✕')} ${base.key.padEnd(6)} ${err.message}`);
    }
  }

  if (json) {
    console.log(JSON.stringify({ credential: { found: true, source, key: maskKey(key) }, gateways: rows }, null, 2));
  }
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}

async function cmdProbe({ key: explicitKey, gateway, concurrency, timeout }) {
  const { key, source } = resolveKey(explicitKey);
  if (!key) {
    console.error(C.bad('No OpenCode credential found. Run `check` to see where we looked.'));
    process.exit(1);
  }
  if (gateway && !GATEWAY_KEYS.includes(gateway)) {
    console.error(C.bad(`Unknown gateway: ${gateway}. Expected one of ${GATEWAY_KEYS.join(', ')}.`));
    process.exit(1);
  }

  console.log(`${C.bold('probing')} with ${maskKey(key)} ${C.dim(`← ${source}`)}`);
  console.log(C.dim('one real request per model per protocol; blocked models are annotated, not dropped\n'));

  const previous = readCatalog(CATALOG_FILE);
  const scoped = gateway
    ? { ...previous, routes: (previous?.routes ?? []).filter((r) => r.gateway === gateway) }
    : previous;

  const fresh = await probe({
    key,
    previous: scoped,
    concurrency,
    timeoutMs: timeout,
    onProgress: (line) => process.stderr.write(`${C.dim(line)}\n`),
  });

  // A single-gateway probe must not drop the others.
  const merged =
    gateway && previous
      ? {
          ...fresh,
          routes: [
            ...previous.routes.filter((r) => r.gateway !== gateway),
            ...fresh.routes.filter((r) => r.gateway === gateway),
          ],
        }
      : fresh;

  merged.routes.sort(
    (a, b) => a.gateway.localeCompare(b.gateway) || a.protocol.localeCompare(b.protocol),
  );

  fs.writeFileSync(CATALOG_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  writePatch(merged, PATCH_FILE);

  console.log();
  for (const row of summarize(merged)) {
    const blocked = row.blocked ? C.warn(`${row.blocked} blocked`) : C.dim('0 blocked');
    console.log(
      `  ${row.routeId.padEnd(32)} ${String(row.usable).padStart(2)} usable / ${String(row.total).padStart(2)} total  (${blocked})`,
    );
  }
  console.log(`\n${C.ok('updated')} models.catalog.json + cordis.patch.yml`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: 'string' },
      gateway: { type: 'string' },
      concurrency: { type: 'string' },
      timeout: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  if (values.version) {
    console.log(version());
    return;
  }
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'list':
      return cmdList(loadCatalog(), values);
    case 'render':
      return cmdRender();
    case 'check':
      return cmdCheck({ key: values.key, json: values.json });
    case 'probe':
      return cmdProbe({
        key: values.key,
        gateway: values.gateway,
        concurrency: Number(values.concurrency) || 4,
        timeout: Number(values.timeout) || 60000,
      });
    default:
      console.error(C.bad(`Unknown command: ${command}\n`));
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(C.bad(err?.stack ?? String(err)));
  process.exit(1);
});
