-- Render PostgreSQL → Connect → SQL 에 붙여넣고 Run (배포 전 즉시 정리)
-- credit = USD, 화면 = credit × exrate(원)
UPDATE sites SET credit = 0
WHERE credit >= 999999999
   OR (credit * COALESCE(NULLIF(exrate, 0), 1500)) > 10000000;
