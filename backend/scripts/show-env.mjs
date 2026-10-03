#!/usr/bin/env node
// Prints .env with the database password and admin key hidden. Safe to screenshot.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (!existsSync(envPath)) {
  console.log(`No .env file in ${dirname(envPath)}`);
  process.exit(1);
}
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const [name, ...rest] = line.split('=');
  const value = rest.join('=');
  if (name === 'ADMIN_API_KEY') console.log(`ADMIN_API_KEY=(hidden, ${value.length} characters)`);
  else if (/:\/\//.test(value)) console.log(`${name}=${value.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1****@')}`);
  else if (value === '' && line.includes('@')) console.log('(a line that is not NAME=value and looks like part of an address: it will be ignored)');
  else console.log(line);
}
