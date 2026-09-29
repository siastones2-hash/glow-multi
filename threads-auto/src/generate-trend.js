import { loadConfig } from './util.js';
import { getIntroPhase } from './rotate.js';
import { pickTrendTopic, markTrendUsed } from './trends.js';

const TEMPLATES = [
  `요즘 '{topic}' 이야기 많이 보이더라고요.\n\n솔직히 자세히는 모르는데,\n{angle}.\n\n요즘 뭐에 관심 있으세요?`,
  `검색어에 '{topic}' 올라와 있더라.\n\n{headline}\n\n저는 그냥 옆에서 지켜보는 입장인데,\n{angle} 🙂`,
  `요즘 '{topic}' 자주 보이네요.\n\n뉴스처럼 말하려다 말고,\n그냥 {angle}.\n\n같은 느낌인 분?`,
  `솔직히 '{topic}' 봤을 때\n{angle}.\n\n편하게 적어봅니다.`,
];

const PROMPT = `스레드(Threads) 텍스트 1개 작성.

오늘 한국 검색/화제: {topic}
관련 맥락(참고만, 뉴스 요약 금지): {headline}

작성자: 40대, 여러 일 하는 사람. 편하게, 옆자리 톤.
규칙: {strategyRule}
피할 말: {neverSay}
피할 톤: {neverTone}
단계: {phaseLabel} — {phaseDesc}

요구:
- 트렌드를 뉴스 리포트처럼 설명하지 말 것
- 개인 공감·짧은 소감으로만 살짝 연결
- 회사명·브랜드·직함·전문가 라벨 X
- 500자 이내, ~해요/~더라고요
- 첫 줄 공감 → 내 얘기 → 가벼운 질문
- 이모지 0~1개
- 글만 출력`;

function pickTemplate() {
  return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
}

function fillTemplate(trend) {
  const tpl = pickTemplate();
  return tpl
    .replace(/\{topic\}/g, trend.topic)
    .replace(/\{headline\}/g, trend.headline ? `${trend.headline.slice(0, 60)}…` : '요즘 이야기가 많더라고요.')
    .replace(/\{angle\}/g, trend.angle)
    .slice(0, 500);
}

export async function generateTrendPost({ markUsed = true } = {}) {
  const trend = await pickTrendTopic();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const config = loadConfig();
  const phase = getIntroPhase();
  const phaseInfo = config.strategy?.phases?.find((p) => p.phase === phase) || {};
  const s = config.strategy || {};

  let text;
  let mode = 'template+trend';

  if (apiKey) {
    const prompt = PROMPT
      .replace('{topic}', trend.topic)
      .replace('{headline}', trend.headline || '(없음)')
      .replace('{strategyRule}', s.rule || '')
      .replace('{neverSay}', (s.neverSay || []).join(', '))
      .replace('{neverTone}', (s.neverTone || []).join(', '))
      .replace('{phaseLabel}', phaseInfo.label || `Phase ${phase}`)
      .replace('{phaseDesc}', phaseInfo.desc || '');

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      text = data.content?.[0]?.text?.trim();
      if (text) mode = 'ai+trend';
    }
  }

  if (!text) text = fillTemplate(trend);
  if (markUsed) markTrendUsed(trend.topic);

  return {
    text: text.slice(0, 500),
    mode,
    trend: {
      topic: trend.topic,
      headline: trend.headline,
      source: trend.source,
    },
    businessId: 'trend',
    businessName: '오늘 화제',
    emoji: '🔥',
    chars: text.length,
  };
}
