#!/usr/bin/env node
// Saves the database connection string into .env without showing it on screen.
// Usage: npm run set-db   (then paste the string when asked; it is not shown)
//    or: pbpaste | npm run set-db
// Add --new-key to replace the admin key (then store it in Cloudflare again with wrangler secret put).
// Accepts the plain string or Neon's "psql '...'" snippet; strips quotes and spaces.
// Also creates ADMIN_API_KEY if it is missing or too short. Prints only a masked summary.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

/** Asks for the string in the terminal without showing what is typed or pasted. */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write(`\n(received ${value.length} characters)\n`);
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\nCancelled.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ' || ch === '\t') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

let input;
if (process.stdin.isTTY) {
  input = await askHidden('Paste the Neon connection string (it stays hidden), then press Enter: ');
} else {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  input = Buffer.concat(chunks).toString('utf8');
}

const fail = (msg) => {
  console.error(`Not saved: ${msg}`);
  process.exit(1);
};

const found = input.match(/postgres(?:ql)?:\/\/[^\s'"`]+/);
if (!found) fail('no address starting with postgresql:// was found. Copy the connection string from Neon (Connect button) and try again.');

let url;
try {
  url = new URL(found[0]);
} catch {
  fail('the copied text is not a complete connection string. Copy it again from Neon.');
}
if (!url.password) fail('the connection string has no password. In Neon, use the Copy button so the password is included.');
if (/^(localhost|127\.|0\.0\.0\.0|base$)/.test(url.hostname)) fail(`the address points to "${url.hostname}", not to Neon.`);
url.searchParams.delete('channel_binding');
if (!url.searchParams.get('sslmode')) url.searchParams.set('sslmode', 'require');

const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
const keep = lines.filter((l) => l.trim() && !/^\s*(DATABASE_URL|ADMIN_API_KEY)\s*=/.test(l) && !/^[^#=]*@[^=]*$/.test(l));
const oldKey = lines.map((l) => l.match(/^\s*ADMIN_API_KEY\s*=\s*(\S+)\s*$/)?.[1]).filter(Boolean).pop();
const wantNew = process.argv.includes('--new-key');
const key = !wantNew && oldKey && oldKey.length >= 32 && !oldKey.startsWith('change-me') ? oldKey : randomBytes(32).toString('hex');

writeFileSync(envPath, [...keep, `DATABASE_URL=${url.toString()}`, `ADMIN_API_KEY=${key}`, ''].join('\n'));

console.log('Saved .env');
console.log(`  Database: ${url.protocol}//${decodeURIComponent(url.username)}:****@${url.host}${url.pathname}`);
console.log(`  Admin key: ${key === oldKey ? 'kept the existing one' : 'created a new one'} (${key.length} characters, hidden)`);
if (url.hostname.includes('-pooler')) console.log('  Note: this is a pooled address. It works, but for Hyperdrive Neon\'s direct address (pooling off) is preferred.');
