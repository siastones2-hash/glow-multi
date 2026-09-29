import { loadConfig, readJson, writeJson } from './util.js';

function diaryConfig() {
  return readJson('config/diary.json', { seeds: [], postsPerDay: 4, hours: [9, 13, 18, 21] });
}

function getState() {
  return readJson('data/state.json', {
    rotationIndex: 0,
    templateIndex: {},
    introPhase: 1,
    totalPosts: 0,
    diarySeedIndex: 0,
    diaryLineIndex: {},
  });
}

function pickSeedLine() {
  const diary = diaryConfig();
  const seeds = diary.seeds || [];
  if (!seeds.length) throw new Error('diary seeds 없음');

  const state = getState();
  const seedIdx = state.diarySeedIndex || 0;
  const seed = seeds[seedIdx % seeds.length];
  const lines = seed.lines || [];
  const lineIdx = state.diaryLineIndex?.[seed.id] || 0;
  const text = lines[lineIdx % lines.length];

  state.diarySeedIndex = (seedIdx + 1) % seeds.length;
  state.diaryLineIndex = state.diaryLineIndex || {};
  state.diaryLineIndex[seed.id] = (lineIdx + 1) % Math.max(lines.length, 1);
  writeJson('data/state.json', state);

  return { seedId: seed.id, label: seed.label, text };
}

function bannedHit(text, neverSay) {
  const lower = text.toLowerCase();
  return (neverSay || []).find((w) => lower.includes(String(w).toLowerCase()));
}

const PROMPT = `스레드(Threads) 일기 1개. 익명, 일하는 사람 메모장 톤.

소재 힌트: {label}
참고 문장(비슷하게 다시 써도 됨): {seed}

규칙:
- 상호·실명·대표·브랜드·홈페이지·자격증명 X
- "문의 주세요" "상담" "전문가" "할인" "팔로우" X
- 오늘 한 일 / 막힌 것 / 느낀 것만 짧게
- 의뢰 유도는 CTA로 하지 말고, 일의 결만 남길 것
- 500자 이내, ~해요/~더라고요/~같아요
- 옆자리 톤, 이모지 0~1개
- 글만 출력

피할 말: {neverSay}
피할 톤: {neverTone}
쓸 톤: {alwaysTone}
단계: {phaseLabel} — {phaseDesc}`;

export async function generateDiaryPost({ useAi = true } = {}) {
  const picked = pickSeedLine();
  const diary = diaryConfig();
  const config = loadConfig();
  const state = getState();
  const phase = state.introPhase || 1;
  const phaseInfo = config.strategy?.phases?.find((p) => p.phase === phase) || {};
  const apiKey = useAi ? process.env.ANTHROPIC_API_KEY?.trim() : '';

  let text = picked.text;
  let mode = 'diary-template';

  if (apiKey) {
    const prompt = PROMPT
      .replace('{label}', picked.label)
      .replace('{seed}', picked.text)
      .replace('{neverSay}', (diary.neverSay || []).join(', '))
      .replace('{neverTone}', (diary.neverTone || []).join(', '))
      .replace('{alwaysTone}', (diary.alwaysTone || []).join(', '))
      .replace('{phaseLabel}', phaseInfo.label || String(phase))
      .replace('{phaseDesc}', phaseInfo.desc || '');

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const ai = data.content?.[0]?.text?.trim();
        if (ai) {
          text = ai;
          mode = 'diary-ai';
        }
      }
    } catch {
      /* template fallback */
    }
  }

  text = text.slice(0, 500);
  const hit = bannedHit(text, diary.neverSay);
  if (hit) text = picked.text.slice(0, 500);

  return {
    businessId: 'diary',
    businessName: '일기',
    emoji: '📓',
    seedId: picked.seedId,
    label: picked.label,
    text,
    mode,
    chars: text.length,
  };
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 정각이 티 나지 않게 분·초 살짝 흔들기 */
function jitterClock(hour, jitterRange) {
  const [jMin, jMax] = Array.isArray(jitterRange) && jitterRange.length >= 2
    ? [Number(jitterRange[0]), Number(jitterRange[1])]
    : [4, 38];
  const lo = Math.max(1, Math.min(jMin, jMax));
  const hi = Math.min(58, Math.max(jMin, jMax));
  const minute = randInt(lo, hi);
  const second = randInt(0, 45);
  return {
    hour,
    minute,
    second,
    slotKey: String(hour).padStart(2, '0'),
  };
}

/**
 * @returns {{ publishAt: string, slotKey: string }[]}
 * slotKey = YYYY-MM-DDTHH (중복 방지용, 분은 랜덤)
 */
export function diarySchedule(dayOffset = 0) {
  const diary = diaryConfig();
  const hours = diary.hours?.length ? diary.hours : [9, 13, 18, 21];
  const count = Math.min(Math.max(diary.postsPerDay || hours.length, 3), 5);
  const tz = process.env.TIMEZONE || 'Asia/Seoul';

  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;

  return hours.slice(0, count).map((h) => {
    const j = jitterClock(h, diary.jitterMinutes);
    return {
      publishAt: `${y}-${m}-${day}T${String(j.hour).padStart(2, '0')}:${String(j.minute).padStart(2, '0')}:${String(j.second).padStart(2, '0')}+09:00`,
      slotKey: `${y}-${m}-${day}T${j.slotKey}`,
    };
  });
}
