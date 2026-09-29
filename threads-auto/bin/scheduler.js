#!/usr/bin/env node
/**
 * 1분마다 실행:
 * - 큐에 도래한 글 발행 (일기 하루 3~5개용)
 * - diary 모드가 아니면 기존처럼 정해진 시각에 1개
 */
import { loadEnv, log, readJson, writeJson } from '../src/util.js';
import { popDue } from '../src/queue.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

loadEnv();

const tz = process.env.TIMEZONE || 'Asia/Seoul';
const hour = parseInt(process.env.PUBLISH_HOUR || '9', 10);
const minute = parseInt(process.env.PUBLISH_MINUTE || '0', 10);
const contentMode = (process.env.CONTENT_MODE || 'trend').trim();
const useQueue = process.argv.includes('--queue') || contentMode === 'diary';

function kstNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  return {
    hour: parseInt(parts.find((p) => p.type === 'hour').value, 10),
    minute: parseInt(parts.find((p) => p.type === 'minute').value, 10),
  };
}

function runScript(name) {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(dir, name)], { stdio: 'inherit' });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exit ${code}`))));
  });
}

async function main() {
  const now = kstNow();

  if (useQueue) {
    const due = popDue();
    if (due.length) {
      log(`큐 발행 ${due.length}개`);
      await runScript('publish-queue.js');
      return;
    }
    if (contentMode === 'diary') return;
  }

  if (now.hour !== hour || now.minute !== minute) {
    return;
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const state = readJson('data/state.json', {});
  if (state.lastAutoPublishDate === today) {
    return;
  }

  log(`정기 발행 ${hour}:${String(minute).padStart(2, '0')} KST`);
  await runScript('run-once.js');
  state.lastAutoPublishDate = today;
  writeJson('data/state.json', state);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
