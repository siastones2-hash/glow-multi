#!/usr/bin/env node
/** 일기 N일치 × 하루 3~5개를 큐에 쌓기 */
import { loadEnv, log } from '../src/util.js';
import { generateDiaryPost, diarySchedule } from '../src/generate-diary.js';
import { addToQueue, listQueue } from '../src/queue.js';

loadEnv();

const days = parseInt(process.argv[2] || '1', 10);

function slotKeyFromPublishAt(publishAt) {
  // 2026-08-10T09:17:22+09:00 → 2026-08-10T09
  const m = String(publishAt || '').match(/^(\d{4}-\d{2}-\d{2}T\d{2})/);
  return m ? m[1] : publishAt;
}

async function main() {
  const pendingSlots = new Set(
    listQueue()
      .filter((i) => i.status === 'pending')
      .map((i) => i.slotKey || slotKeyFromPublishAt(i.publishAt))
  );
  const now = Date.now();
  let added = 0;

  for (let d = 0; d < days; d++) {
    const slots = diarySchedule(d);
    for (const { publishAt, slotKey } of slots) {
      if (new Date(publishAt).getTime() <= now) {
        log(`스킵(지난 시각) ${publishAt}`);
        continue;
      }
      if (pendingSlots.has(slotKey)) {
        log(`스킵(이미 있음) ${slotKey}`);
        continue;
      }
      const post = await generateDiaryPost({ useAi: true });
      addToQueue({
        businessId: 'diary',
        businessName: `일기 · ${post.label}`,
        text: post.text,
        publishAt,
        slotKey,
        seedId: post.seedId,
        mode: post.mode,
      });
      pendingSlots.add(slotKey);
      added++;
      log(`큐 ${publishAt} — ${post.label}`);
    }
  }

  log(`${added}개 일기 초안 → data/queue.json (분·초 랜덤)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
