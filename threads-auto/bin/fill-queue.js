#!/usr/bin/env node
/** 다음 N일치 글 초안을 큐에 쌓기 (발행 전 검토용) */
import { loadEnv, loadConfig, log } from '../src/util.js';
import { pickTemplate, getBusiness } from '../src/rotate.js';
import { generatePost } from '../src/generate.js';
import { addToQueue } from '../src/queue.js';

loadEnv();

const days = parseInt(process.argv[2] || '14', 10);
const hour = parseInt(process.env.PUBLISH_HOUR || '9', 10);
const minute = parseInt(process.env.PUBLISH_MINUTE || '0', 10);
const tz = process.env.TIMEZONE || 'Asia/Seoul';

const config = loadConfig();
let rotationIndex = 0;

function nextPublishDate(fromDayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + fromDayOffset);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
}

async function main() {
  for (let i = 0; i < days; i++) {
    const businessId = config.rotation[rotationIndex % config.rotation.length];
    rotationIndex++;
    const biz = getBusiness(businessId);
    const template = pickTemplate(businessId);
    const text = await generatePost(businessId, { templateFallback: template });
    const item = addToQueue({
      businessId,
      businessName: biz.name,
      text,
      publishAt: nextPublishDate(i + 1),
    });
    log(`큐 추가 ${item.publishAt} — ${biz.name}`);
  }
  log(`${days}개 초안 큐에 저장 → data/queue.json`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
