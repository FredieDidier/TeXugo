import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shippedPackages, NOTICES } from '../scripts/notices.mjs';

test('every shipped package has its license in THIRD-PARTY-NOTICES.txt', async () => {
  const text = fs.readFileSync(NOTICES, 'utf8');
  const missing = (await shippedPackages()).filter((n) => !text.includes(`\n${n} `));
  assert.deepEqual(missing, [], 'rode: node scripts/notices.mjs');
});
