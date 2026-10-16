// Composition-conflict diagnostics for dsh-opencode-doctor.
//
// The plugin ships a *bundle* patch, and DSH applies patch layers in a fixed
// order: every bundle (in `dsh.profile.bundles` order), then the profile's own
// `cordis.patch.yml`, then `$DSH_HOME/cordis.patch.yml`, then `--patch`
// overlays. Two facts follow, and both bite silently:
//
//   1. A patch assigns `target[key] = value` — it REPLACES an entry's `config`
//      object, it does not deep-merge it. So a later `- id: llm-pi-ai` row
//      wipes the routes this plugin declared on that entry.
//   2. A bundle that is listed in `dsh.profile.bundles` contributes its own
//      bundled patch. When that bundle also inserts a row this plugin inserts
//      (`model-proxy`, `opencode-go`), the composition carries two rows and
//      they chain instead of overriding.
//
// Everything here is read-only: it reads the user's patch files and profile
// manifests and reports what it finds. Nothing is written.
import fs from 'node:fs';
import path from 'node:path';

import { dshHome } from './keys.mjs';

/** Rows this plugin inserts itself, and what a duplicate means. */
const INSERTED_ROWS = {
  'model-proxy': {
    owner: 'dsh-model-proxy',
    message: 'dsh-model-proxy is also listed in this profile\'s dsh.profile.bundles',
    fix: 'drop it from that list — this plugin already inserts the row, and two rows chain two dispatchers',
  },
  'opencode-go': {
    owner: 'dsh-opencode-go',
    message: 'dsh-opencode-go is also listed in this profile\'s dsh.profile.bundles',
    fix: 'harmless (the loader tolerates the duplicate row), but the listing is redundant — this plugin already inserts it',
    level: 'info',
  },
};

/** A row declaration inside a patch list: `- id: <name>` at any indent. */
function hasRowId(text, id) {
  const re = new RegExp(`^\\s*-\\s*id:\\s*['"]?${id}['"]?\\s*$`, 'm');
  return re.test(text);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Every `cordis.patch.yml` a user could have written, with a readable label. */
export function patchLayers(home = dshHome()) {
  const out = [];
  const homePatch = path.join(home, 'cordis.patch.yml');
  if (fs.existsSync(homePatch)) out.push({ label: homePatch, file: homePatch, scope: 'home' });
  const profilesDir = path.join(home, 'profiles');
  let names = [];
  try {
    names = fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return out;
  }
  for (const name of names) {
    const file = path.join(profilesDir, name, 'cordis.patch.yml');
    if (fs.existsSync(file)) out.push({ label: file, file, scope: 'profile', profile: name });
  }
  return out;
}

/** Profile manifests that carry a `dsh.profile.bundles` list. */
function profileManifests(home) {
  const profilesDir = path.join(home, 'profiles');
  let names = [];
  try {
    names = fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, manifest: readJson(path.join(profilesDir, name, 'package.json')) }))
    .filter((entry) => entry.manifest !== null);
}

/**
 * Report every composition conflict that would change this plugin's behaviour.
 *
 * `warn` entries are the ones that silently disable or double up a row;
 * `info` entries are worth knowing but cannot break anything.
 * @param {string} [home] - DSH home directory.
 * @returns {Array<{level: 'warn'|'info', where: string, message: string, fix: string}>}
 */
export function findCompositionConflicts(home = dshHome()) {
  const findings = [];

  for (const layer of patchLayers(home)) {
    const text = readText(layer.file);
    if (text === null) continue;

    if (hasRowId(text, 'llm-pi-ai')) {
      findings.push({
        level: 'warn',
        where: layer.label,
        message:
          'declares its own `- id: llm-pi-ai` row, which is applied AFTER this plugin\'s bundle layer',
        fix:
          'a patch replaces the whole `config` object, so that row drops every route this plugin declares — merge your providers into it, or delete it',
      });
    }
  }

  for (const { name, manifest } of profileManifests(home)) {
    const bundles = manifest?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) continue;
    for (const [id, spec] of Object.entries(INSERTED_ROWS)) {
      if (!bundles.includes(spec.owner)) continue;
      findings.push({
        level: spec.level ?? 'warn',
        where: `${path.join(home, 'profiles', name, 'package.json')} (profile "${name}")`,
        message: `${spec.message} — this plugin inserts the \`${id}\` row itself`,
        fix: spec.fix,
      });
    }
  }

  return findings;
}
