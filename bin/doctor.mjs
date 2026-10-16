#!/usr/bin/env node
// dsh-opencode-doctor CLI.
//
//   probe    re-probe both OpenCode gateways and rewrite the catalog + patch
//   render   rewrite cordis.patch.yml from models.catalog.json (no network)
//   list     print what the shipped catalog contains
//   check    resolve the credential and verify each gateway answers
//   usage    show the OpenCode Go quota (used / remaining, per window)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { resolveKey, maskKey, dshHome, SEARCHED } from '../lib/keys.mjs';
import {
  writePatch,
  renderPatch,
  readProxyFromPatch,
  resolveProxy,
  PROXY_ENV,
  availabilityNote,
  isUnreachable,
  isPick,
  regionModelIds,
  unshippableRoutes,
} from '../lib/render.mjs';
import { findCompositionConflicts } from '../lib/compose.mjs';
import { probe, readCatalog, summarize, fetchModelIds, BASES, NOTES } from '../lib/probe.mjs';
import {
  fetchUsage,
  formatReset,
  WINDOW_LABELS,
  usageBar,
  padDisplay,
  padStartDisplay,
} from '../lib/usage.mjs';

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
const BAR_WIDTH = 20;

/** What each probe verdict means for the shipped patch. */
const NOTE_HELP = {
  funds: 'written into the model name',
  freetier: 'written into the model name',
  authdata: 'written into the model name',
  unavailable: 'written into the model name',
  protocol: 'model dropped — no usable wire protocol',
  region: 'recorded only; the model rides the proxy, so its name stays clean',
};

const HELP = `${C.bold('dsh-opencode-doctor')} — pre-probed OpenCode model routes for DeepSeek Harness

${C.bold('Usage')}
  npx dsh-opencode-doctor <command> [options]

${C.bold('Commands')}
  list                Show the shipped catalog (offline)
  usage               Show the OpenCode Go quota — used / remaining per window
  probe               Re-probe both gateways, rewrite catalog + patch
  render              Rewrite cordis.patch.yml from the catalog (offline)
  check               Resolve the credential, ping each gateway, report conflicts

${C.bold('Options')}
  --key <key>         OpenCode API key (default: env → .credentials.yaml → auth.json)
  --gateway <key>     probe only one gateway (${GATEWAY_KEYS.join(', ')})
  --concurrency <n>   parallel probes during \`probe\` (default 4)
  --timeout <ms>      per-request timeout (default 60000)
  --proxy <url>       outbound proxy for region-blocked models, used by
                      \`probe\` and \`render\` (default ${PROXY_ENV} → ${resolveProxy()})
  --json              machine-readable output for \`list\` / \`check\` / \`usage\`
  -h, --help          Show this help
  -v, --version       Show the version

${C.bold('Probe verdicts')}
${Object.entries(NOTES)
  .map(
    ([code, note]) =>
      `  ${padDisplay(note, 14)} ${code.padEnd(12)} ${C.dim(NOTE_HELP[code] ?? '')}`,
  )
  .join('\n')}`;

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
  const routes = (catalog.routes ?? [])
    .map((route) => ({ ...route, models: (route.models ?? []).filter((m) => !isUnreachable(m)) }))
    .filter((route) => route.models.length);
  // Routes the patch cannot register: DSH only accepts three wire protocols from
  // a provider config. They stay in the list for transparency but must not be
  // counted as shipped, or the totals disagree with cordis.patch.yml.
  const held = new Set(unshippableRoutes(catalog).map((route) => route.routeId));
  const shipped = routes.filter((route) => !held.has(route.routeId));
  const total = shipped.reduce((n, r) => n + r.models.length, 0);
  const usable = shipped.reduce((n, r) => n + r.models.filter((m) => !availabilityNote(m)).length, 0);
  const heldCount = routes
    .filter((route) => held.has(route.routeId))
    .reduce((n, r) => n + r.models.length, 0);
  console.log(
    `${C.bold('dsh-opencode-doctor')} · probed ${catalog.probedAt} · ` +
      `${C.ok(`${usable} 可用`)} / ${total} 下发` +
      (heldCount ? C.dim(`（另有 ${heldCount} 个因协议不受支持未下发）`) : '') +
      '\n',
  );
  const region = regionModelIds(catalog).length;
  if (region) {
    console.log(`${C.dim(`${region} 个地区受限模型已自动走代理（名字里不再标注）`)}\n`);
  }
  for (const route of routes) {
    const ok = route.models.filter((m) => !availabilityNote(m));
    const blocked = route.models.length - ok.length;
    console.log(
      `${C.bold(route.label)}  ${C.dim(`route ${route.routeId} · ${route.api}`)}` +
        (held.has(route.routeId) ? `  ${C.warn('← 不下发：DSH 不支持该协议')}` : ''),
    );
    console.log(
      `  ${ok.length} usable` +
        (blocked ? `, ${C.warn(`${blocked} blocked`)}` : '') +
        `  ${C.dim(`(${route.models.length} total)`)}`,
    );
    for (const model of route.models) {
      const note = availabilityNote(model);
      const mark = note ? C.bad('✕') : C.ok('✓');
      const star = isPick(model) ? C.warn('★ ') : '  ';
      const suffix = note ? `  ${C.warn(`（${note}）`)}` : '';
      const ctx = model.contextWindow ? C.dim(` ctx ${Math.round(model.contextWindow / 1024)}k`) : '';
      console.log(`    ${star}${mark} ${model.id.padEnd(36)}${suffix}${ctx}`);
    }
    console.log();
  }
  console.log(C.dim('★ = 常用模型（选择器里输入 ★ 即可筛出来）'));
}

function cmdRender({ proxy }) {
  const { file, proxy: url } = writePatch(loadCatalog(), PATCH_FILE, { proxy });
  console.log(C.ok(`wrote ${path.relative(process.cwd(), file)}`));
  console.log(`${C.dim('proxy')}  ${url}`);
}

async function cmdUsage({ key: explicitKey, json }) {
  const { key, source } = resolveKey(explicitKey);
  if (!key) {
    console.error(C.bad('No OpenCode credential found. Run `check` to see where we looked.'));
    process.exit(1);
  }

  let rows;
  try {
    rows = await fetchUsage(key);
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.error(C.bad(`读取额度失败：${err.message}`));
    }
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify({ ok: true, key: maskKey(key), windows: rows }, null, 2));
    return;
  }

  console.log(`${C.bold('OpenCode Go 额度')}  ${C.dim(`${maskKey(key)} ← ${source}`)}\n`);
  console.log(
    `  ${padDisplay('窗口', 17)}` +
      `${padStartDisplay('已用', 4)}  ` +
      `${padDisplay('用掉', BAR_WIDTH)}   ` +
      `${padStartDisplay('剩余', 4)}   重置`,
  );
  for (const row of rows) {
    const label = `${WINDOW_LABELS[row.window] ?? row.window}`;
    // CJK labels are two columns wide each, so pad on printable width, not
    // string length, or every row skews by the number of wide characters.
    const head = padDisplay(label, 9) + C.dim(String(row.window).padEnd(8));
    if (row.usedPercent === null) {
      console.log(`  ${head}${'—'.padStart(4)}  ${C.dim('（该窗口没有数据）'.padEnd(BAR_WIDTH))}   ${'—'.padStart(4)}   ${C.dim(formatReset(row.resetsAt))}`);
      continue;
    }
    const tone = row.usedPercent >= 90 ? 'bad' : row.usedPercent >= 70 ? 'warn' : 'ok';
    const bar = usageBar(row.usedPercent, BAR_WIDTH);
    console.log(
      `  ${head}` +
        `${C[tone](padStartDisplay(`${row.usedPercent}%`, 4))}  ` +
        `${C[tone](bar.filled)}${C.dim(bar.empty)}   ` +
        `${padStartDisplay(`${row.remainingPercent}%`, 4)}   ` +
        `${C.dim(formatReset(row.resetsAt))}`,
    );
  }
  console.log(`\n${C.dim('「已用」是套餐消耗百分比，剩余 = 100 − 已用；窗口到期后自动重置。')}`);
}

/**
 * Local, credential-free part of `check`: the patch file this package ships,
 * the proxy it carries, and every composition conflict that would silently
 * change what boots. Reported before the network work so a broken composition
 * is visible even when the key is missing.
 */
function compositionReport() {
  const shipped = fs.existsSync(PATCH_FILE) ? readProxyFromPatch(fs.readFileSync(PATCH_FILE, 'utf8')) : null;
  return { shippedProxy: shipped, conflicts: findCompositionConflicts(dshHome()) };
}

function printComposition({ shippedProxy, conflicts }, json) {
  if (json) return;
  console.log(
    `${C.bold('patch')}  ${path.relative(process.cwd(), PATCH_FILE)}` +
      `${shippedProxy ? `  ${C.dim(`proxy ${shippedProxy}`)}` : ''}`,
  );
  if (!conflicts.length) {
    console.log(`  ${C.ok('✓')} no composition conflict found\n`);
    return;
  }
  for (const finding of conflicts) {
    const mark = finding.level === 'info' ? C.dim('i') : C.warn('!');
    console.log(`  ${mark} ${finding.where}`);
    console.log(`      ${finding.message}`);
    console.log(`      ${C.dim(`→ ${finding.fix}`)}`);
  }
  console.log();
}

async function cmdCheck({ key: explicitKey, json }) {
  const composition = compositionReport();
  printComposition(composition, json);

  const { key, source } = resolveKey(explicitKey);
  if (!key) {
    if (json) {
      console.log(
        JSON.stringify(
          { composition, credential: { found: false, searched: SEARCHED }, gateways: [] },
          null,
          2,
        ),
      );
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
    console.log(
      JSON.stringify(
        { composition, credential: { found: true, source, key: maskKey(key) }, gateways: rows },
        null,
        2,
      ),
    );
  }
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}

async function cmdProbe({ key: explicitKey, gateway, concurrency, timeout, proxy }) {
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
  writePatch(merged, PATCH_FILE, { proxy });

  console.log();
  for (const row of summarize(merged)) {
    const blocked = row.blocked ? C.warn(`${row.blocked} blocked`) : C.dim('0 blocked');
    console.log(
      `  ${row.routeId.padEnd(32)} ${String(row.usable).padStart(2)} usable / ${String(row.total).padStart(2)} total  (${blocked})`,
    );
  }
  console.log(`\n${C.ok('updated')} models.catalog.json + cordis.patch.yml`);
  console.log(`${C.dim('proxy')}  ${resolveProxy(proxy)}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      key: { type: 'string' },
      gateway: { type: 'string' },
      concurrency: { type: 'string' },
      timeout: { type: 'string' },
      proxy: { type: 'string' },
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
      return cmdRender({ proxy: values.proxy });
    case 'check':
      return cmdCheck({ key: values.key, json: values.json });
    case 'usage':
      return cmdUsage({ key: values.key, json: values.json });
    case 'probe':
      return cmdProbe({
        key: values.key,
        gateway: values.gateway,
        concurrency: Number(values.concurrency) || 4,
        timeout: Number(values.timeout) || 60000,
        proxy: values.proxy,
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
