// Reads the OpenCode Go quota the gateway exposes over HTTP.
//
// The Go plan meters usage in three windows — a rolling one, a weekly one and
// a monthly one — and reports each as a used percentage plus a reset time.
// Requesting it directly keeps this plugin dependency-free: the same numbers
// the official client shows, without pulling in a settings UI.
//
// The endpoint sits under the Go gateway's v1 base, and only accepts the key
// as a bearer token (the Zen gateway has no equivalent path).
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const MAX_BYTES = 64 * 1024;

/** Human labels for the windows the gateway reports. */
export const WINDOW_LABELS = {
  rolling: '滚动窗口',
  weekly: '本周',
  monthly: '本月',
};

/**
 * Fetch the current quota for one key.
 * @param {string} key - the OpenCode API key.
 * @returns {Promise<Array<{window: string, status: string, usedPercent: number|null, remainingPercent: number|null, resetsAt: string|null}>>}
 */
export async function fetchUsage(key, { timeoutMs = 15000 } = {}) {
  const res = await fetch(USAGE_URL, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`额度接口返回 HTTP ${res.status}`);

  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('额度响应异常大，已放弃解析');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('额度接口没有返回 JSON（可能没有这张套餐）');
  }

  const rows = parsed?.usage;
  if (!rows || typeof rows !== 'object') throw new Error('额度响应结构不是预期的样子');

  return Object.entries(rows).map(([windowKey, row]) => {
    const percent = typeof row?.percent === 'number' ? row.percent : null;
    return {
      window: windowKey,
      status: typeof row?.status === 'string' ? row.status : 'unknown',
      usedPercent: percent,
      remainingPercent: percent === null ? null : Math.max(0, 100 - percent),
      resetsAt: typeof row?.resetsAt === 'string' ? row.resetsAt : null,
    };
  });
}

/** Local `MM-DD HH:mm` for a reset timestamp, or `—` when absent/unparseable. */
export function formatReset(iso) {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Terminal layout helpers
// ---------------------------------------------------------------------------
// The window labels are CJK, so `String.padEnd` under-counts them by one column
// per character and the table skews. Measure East Asian wide characters as two
// columns and pad on that.
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Printable column count of `text` (CJK counted as two). */
export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

/** Left-align `text` in `width` printable columns. */
export function padDisplay(text, width) {
  const s = String(text);
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** Right-align `text` in `width` printable columns. */
export function padStartDisplay(text, width) {
  const s = String(text);
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}

/** A `used`-percent meter, split into `filled` / `empty` so the caller can colour
 *  each half (the whole bar takes the pressure colour, the remainder stays dim). */
export function usageBar(usedPercent, size = 20) {
  const ratio = Math.min(100, Math.max(0, usedPercent)) / 100;
  const filled = Math.round(ratio * size);
  return { filled: '█'.repeat(filled), empty: '░'.repeat(size - filled), size };
}
