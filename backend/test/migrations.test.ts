import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/db/migrations.generated.js';

describe('bundled migrations', () => {
  it('match migrations/*.sql (run npm run gen:migrations after editing them)', () => {
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
    for (const m of MIGRATIONS) expect(m.sql).toBe(readFileSync(`migrations/${m.name}`, 'utf8'));
  });
});
