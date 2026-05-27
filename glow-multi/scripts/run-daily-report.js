#!/usr/bin/env node
/**
 * 수동 실행: node glow-multi/scripts/run-daily-report.js
 * (서버 없이 DB + 텔레그램만으로 일일 리포트 테스트)
 */
const { Pool } = require('pg');
const fetch = require('node-fetch');
const path = require('path');
const {
  buildAndSendDailySiteReport,
} = require('../lib/daily-site-report');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function getGlobalSetting(key) {
  const r = await query(`SELECT value FROM global_settings WHERE key=$1`, [key]);
  return r.rows[0]?.value || '';
}

async function setGlobalSetting(key, value) {
  await query(
    `INSERT INTO global_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2`,
    [key, value]
  );
}

async function sendTelegramToSuper(message) {
  const token = await getGlobalSetting('tg_token');
  const chat = await getGlobalSetting('tg_chat');
  if (!token || !chat) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
  });
  return res.ok;
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL 필요');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  if (force) await setGlobalSetting('daily_report_last_sent', '');
  const result = await buildAndSendDailySiteReport(
    query,
    getGlobalSetting,
    setGlobalSetting,
    sendTelegramToSuper
  );
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
