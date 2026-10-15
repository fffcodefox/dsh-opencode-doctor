// Credential resolution for dsh-opencode-doctor.
//
// Order: explicit value > environment > DSH credential refs > OpenCode's own auth.json.
// Read-only: this module never writes a credential anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENV_NAMES = ['OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENCODE_ZEN_API_KEY'];

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** Parse the flat `refs:` block out of a DSH .credentials.yaml. */
function readRefs(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const refs = {};
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\S/.test(line)) break; // left the refs block
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/.exec(line);
    if (m && m[2]) refs[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return Object.keys(refs).length ? refs : null;
}

function credentialFiles() {
  const home = os.homedir();
  const out = [
    path.join(dshHome(), '.credentials.yaml'),
    path.join(home, '.dsh', '.credentials.yaml'),
  ];
  return [...new Set(out)];
}

function opencodeAuthFiles() {
  const home = os.homedir();
  const candidates = [
    process.env.OPENCODE_DATA ? path.join(process.env.OPENCODE_DATA, 'auth.json') : null,
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json') : null,
    path.join(home, '.local', 'share', 'opencode', 'auth.json'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'opencode', 'auth.json') : null,
    path.join(home, '.opencode', 'auth.json'),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function readOpencodeAuth(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const id of ['opencode', 'opencode-go', 'opencode-zen']) {
      const entry = data?.[id];
      const key = entry?.key ?? entry?.apiKey ?? entry?.access_token;
      if (typeof key === 'string' && key) return key;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} [explicit] key passed on the command line
 * @returns {{key: string|null, source: string}}
 */
export function resolveKey(explicit) {
  if (explicit) return { key: explicit, source: '--key' };

  for (const name of ENV_NAMES) {
    const value = process.env[name];
    if (value) return { key: value, source: `env ${name}` };
  }

  for (const file of credentialFiles()) {
    const refs = readRefs(file);
    if (!refs) continue;
    for (const name of ENV_NAMES) {
      if (refs[name]) return { key: refs[name], source: `${file} → refs.${name}` };
    }
  }

  for (const file of opencodeAuthFiles()) {
    const key = readOpencodeAuth(file);
    if (key) return { key, source: `${file} → opencode.key` };
  }

  return { key: null, source: 'not found' };
}

/** Redacted form safe to print. */
export function maskKey(key) {
  if (!key) return '(none)';
  if (key.length <= 12) return '***';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export const SEARCHED = { ENV_NAMES, credentialFiles, opencodeAuthFiles };
