import { readJson, writeJson } from './util.js';

const RSS_URL = 'https://trends.google.com/trending/rss?geo=KR';
const CACHE_TTL_MS = 30 * 60 * 1000;

/** 일상·공감 글에 부적합한 키워드 */
const BLOCK = /사망|살해|성범|논란|피의|체포|고발|탄핵|선거|전쟁|테러|학대|자살|마약|혐의|구속|실종/;

/** 스포츠·라이프 등 연결하기 쉬운 키워드 */
const LIFE = /골프|야구|축구|운동|날씨|여름|겨울|건강|다이어|카페|여행|휴가|월요|금요|아침|저녁|습도|더위|장마|연휴|명절|주말/;

const ANGLES = [
  { re: /야구|MLB|KBO|골프|축구|스포츠|선수|트레이드/, text: '꾸준히 하는 사람 보면 저도 마음가짐 다시 잡게 되더라고요' },
  { re: /날씨|더위|장마|폭우|습도|태풍|미세/, text: '몸 컨디션이 하루를 좌우하는 것 같아요' },
  { re: /카페|맛집|음식|요리|배달/, text: '바쁠수록 끼니 챙기는 게 생각보다 중요하더라고요' },
  { re: /여행|휴가|연휴|명절/, text: '쉬는 날도 머릿속에 일이 남아 있는 편이에요' },
  { re: /.*/, text: '요즘 정보가 너무 빨리 지나가서, 잠깐 멈춰 생각해보게 되더라고요' },
];

let cache = { at: 0, items: [] };

function decodeXml(s) {
  return (s || '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
  return decodeXml(m?.[1] || '');
}

function parseRss(xml) {
  const chunks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return chunks.map((chunk) => {
    const title = tag(chunk, 'title');
    const news = tag(chunk, 'ht:news_item_title') || tag(chunk, 'description');
    return { topic: title, headline: news.slice(0, 120), source: 'google' };
  }).filter((t) => t.topic);
}

export async function fetchTrends() {
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.items.length) {
    return cache.items;
  }
  const res = await fetch(RSS_URL, {
    headers: { 'User-Agent': 'threads-auto/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`트렌드 RSS ${res.status}`);
  const xml = await res.text();
  cache = { at: Date.now(), items: parseRss(xml) };
  return cache.items;
}

function scoreTrend(t) {
  const hay = `${t.topic} ${t.headline}`;
  if (BLOCK.test(hay)) return -100;
  let s = 0;
  if (LIFE.test(hay)) s += 3;
  if (t.headline) s += 1;
  if (t.topic.length <= 8) s += 1;
  return s;
}

function pickAngle(topic, headline) {
  const hay = `${topic} ${headline}`;
  return (ANGLES.find((a) => a.re.test(hay)) || ANGLES[ANGLES.length - 1]).text;
}

function seasonalHook() {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    weekday: 'long',
  }).formatToParts(new Date());
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  const hooks = [
    `${month} 들어서 컨디션 어떠세요?`,
    `${weekday}인데 벌써 한 주가 이렇게`,
    '요즘 하루가 빨리 가는 것 같아요',
    '갑자기 날씨 바뀌니까 몸도 같이 힘들더라고요',
  ];
  return hooks[Math.floor(Math.random() * hooks.length)];
}

/** 오늘 쓸 트렌드 1개 + 각도 */
export async function pickTrendTopic() {
  const state = readJson('data/state.json', { usedTrends: [] });
  const used = new Set(state.usedTrends || []);
  let items = [];

  try {
    items = await fetchTrends();
  } catch {
    items = [];
  }

  const ranked = items
    .map((t) => ({ ...t, score: scoreTrend(t) }))
    .filter((t) => t.score >= 0 && !used.has(t.topic))
    .sort((a, b) => b.score - a.score);

  let pick = ranked[0];
  if (!pick) {
    pick = {
      topic: seasonalHook(),
      headline: '',
      source: 'seasonal',
      score: 0,
    };
  }

  pick.angle = pickAngle(pick.topic, pick.headline);
  return pick;
}

export function markTrendUsed(topic) {
  const state = readJson('data/state.json', { usedTrends: [] });
  const list = [topic, ...(state.usedTrends || [])].slice(0, 30);
  state.usedTrends = list;
  writeJson('data/state.json', state);
}

export async function listTrendsPreview(limit = 8) {
  const items = await fetchTrends();
  return items
    .map((t) => ({ ...t, score: scoreTrend(t), ok: scoreTrend(t) >= 0 }))
    .slice(0, limit);
}
