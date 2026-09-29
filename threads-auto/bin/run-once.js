#!/usr/bin/env node
import { loadEnv, log } from '../src/util.js';
import { nextBusinessId, pickTemplate, getBusiness, bumpPostCount } from '../src/rotate.js';
import { generatePost } from '../src/generate.js';
import { generateTrendPost } from '../src/generate-trend.js';
import { generateDiaryPost } from '../src/generate-diary.js';
import { publishCurrent } from '../src/publish.js';

loadEnv();

const dryRun = process.argv.includes('--dry-run');
const forceTrend = process.argv.includes('--trend');
const forceDiary = process.argv.includes('--diary');
const businessArg = process.argv.find((a) => a.startsWith('--business='))?.split('=')[1];

async function main() {
  const mode = (process.env.CONTENT_MODE || 'trend').trim();
  const useDiary = forceDiary || mode === 'diary';
  const useTrend = !useDiary && (forceTrend || mode === 'trend');

  let text;
  if (useDiary) {
    const r = await generateDiaryPost({ useAi: true });
    text = r.text;
    log(`📓 일기: ${r.label} (${r.mode})`);
  } else if (useTrend) {
    const r = await generateTrendPost({ markUsed: !dryRun });
    text = r.text;
    log(`🔥 트렌드: ${r.trend.topic} (${r.mode})`);
    if (r.trend.headline) log(`   ${r.trend.headline.slice(0, 70)}…`);
  } else {
    const businessId = businessArg || nextBusinessId();
    const biz = getBusiness(businessId);
    const template = pickTemplate(businessId);
    log(`사업: ${biz.emoji} ${biz.name} (${businessId})`);
    text = await generatePost(businessId, { templateFallback: template });
  }

  log('── 생성된 글 ──');
  console.log(text);
  console.log('────────────────');

  if (dryRun) {
    log('dry-run — 발행 안 함');
    return;
  }

  const result = await publishCurrent(text);
  bumpPostCount();
  log(`발행 완료 ${result.postId ? `postId=${result.postId}` : result.verified ? '(프로필 확인)' : 'ok'}`);
}

main().catch((e) => {
  console.error('오류:', e.message);
  process.exit(1);
});
