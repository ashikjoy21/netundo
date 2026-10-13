#!/usr/bin/env node
/**
 * Create an operator and its API token for the operator updates API.
 *
 *   node scripts/create-operator-token.mjs --name "Kerala Vision NOC" \
 *     --brand kerala-vision [--districts Ernakulam,Kollam] [--contact noc@example.com] [--apply]
 *
 * Prints the token ONCE — store it in the operator's secret manager. Only its
 * SHA-256 hash is saved. Without --apply, prints the SQL to run yourself; with
 * --apply, inserts via the Supabase REST API (needs SUPABASE_URL and
 * SUPABASE_SERVICE_KEY in the environment).
 *
 * Revoke:  update operators set active = false where name = '…';
 */
import { createHash, randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const name = flag('name');
const brand = flag('brand');
const districts = flag('districts')?.split(',').map((d) => d.trim()).filter(Boolean) ?? null;
const contact = flag('contact') ?? null;
if (!name || !brand) {
  console.error('Usage: --name "<public name>" --brand <brand key, e.g. kerala-vision or lco:sree-cable> [--districts A,B] [--apply]');
  process.exit(1);
}
if (!/^[a-z0-9-]+(:[a-z0-9-]+)?$/.test(brand)) {
  console.error('--brand must be a brand slug (providers.ts) or lco:<name-slug>');
  process.exit(1);
}

const token = `nu_op_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const row = { name, brand_key: brand, token_hash: tokenHash, allowed_districts: districts, contact };

if (args.includes('--apply')) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for --apply');
    process.exit(1);
  }
  const res = await fetch(`${url}/rest/v1/operators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.error('Insert failed:', res.status, await res.text());
    process.exit(1);
  }
  console.log(`Created operator "${name}" (${brand}).`);
} else {
  const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const arr = districts ? `array[${districts.map(lit).join(', ')}]` : 'null';
  console.log('-- Run in the Supabase SQL editor:');
  console.log(
    `insert into operators (name, brand_key, token_hash, allowed_districts, contact) values (${lit(name)}, ${lit(brand)}, ${lit(tokenHash)}, ${arr}, ${lit(contact)});`,
  );
}
console.log(`\nAPI token (shown once, store it securely):\n${token}`);
