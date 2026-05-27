#!/usr/bin/env node
/** DATABASE_URL만 있으면 비정상 크레딧 일괄 0 정리 */
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 없습니다.');
  process.exit(1);
}

const SQL = `
UPDATE sites SET credit = 0
WHERE credit >= 999999999
   OR (credit * COALESCE(NULLIF(exrate, 0), 1500)) > 10000000
RETURNING id, name;
`;

(async () => {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query(SQL);
  await client.end();
  console.log('');
  console.log('  ✓ 완료: ' + res.rowCount + '개 사이트 크레딧을 0으로 맞췄습니다.');
  if (res.rows.length) {
    res.rows.forEach((r) => console.log('    - ' + r.name));
  }
  console.log('');
  console.log('  glow-0wdh.onrender.com 새로고침 하세요.');
  console.log('');
})().catch((e) => {
  console.error('오류:', e.message);
  process.exit(1);
});
