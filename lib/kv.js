// Tiny Upstash Redis client (REST), the same store the student screen uses. In local testing without Upstash
// it keeps values in memory; on Vercel without it, it throws a 'setup' error.
const R_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = (globalThis.__cfiKv ||= new Map());
export async function redis(cmd) {
  if (!R_URL()) {
    if (process.env.VERCEL) throw Object.assign(new Error('setup'), { setup: true });
    const [op, key, val] = cmd;
    if (op === 'GET') return mem.get(key) ?? null;
    if (op === 'SET') { mem.set(key, val); return 'OK'; }
    if (op === 'DEL') { mem.delete(key); return 1; }
    return null;
  }
  const r = await fetch(R_URL(), { method: 'POST', headers: { authorization: `Bearer ${R_TOK()}`, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
