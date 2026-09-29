import { getBusiness, getIntroPhase } from './rotate.js';
import { loadConfig } from './util.js';

const PROMPT = `스레드(Threads)에 올릴 글 1개. 40대, 여러 일 하는 사람 — 편하게 써줘.

주제: {name} / {oneLiner}
톤: {tone}
끝: {cta}
(역할·브랜드 직접 말하지 말 것: {roleHint})

규칙: {strategyRule}
공감: {engagement}
피할 말: {neverSay}
피할 톤: {neverTone}
쓸 말투: {alwaysSay} ({alwaysTone})

- 500자 이내, ~해요/~더라고요/~같아요
- 옆자리 친구한테 말하듯. 딱딱·전문가·잘난 척 X
- 첫 줄 공감 → 짧은 내 얘기 → 가벼운 질문
- 이모지 0~1개
- 글만 출력`;

export async function generatePost(businessId, { templateFallback } = {}) {
  const biz = getBusiness(businessId);
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    if (templateFallback) return templateFallback;
    throw new Error('ANTHROPIC_API_KEY 없음 — .env 설정 또는 템플릿 모드 사용');
  }

  const config = loadConfig();
  const phase = getIntroPhase();
  const phaseInfo = config.strategy?.phases?.find((p) => p.phase === phase) || {};
  const s = config.strategy || {};

  const prompt = PROMPT
    .replace('{name}', biz.name)
    .replace('{oneLiner}', biz.oneLiner)
    .replace('{tone}', biz.tone)
    .replace('{cta}', biz.cta)
    .replace('{roleHint}', biz.roleHint || '없음')
    .replace('{strategyRule}', s.rule || '')
    .replace('{engagement}', s.engagement || '')
    .replace('{neverSay}', (s.neverSay || []).join(', '))
    .replace('{neverTone}', (s.neverTone || []).join(', '))
    .replace('{alwaysSay}', (s.alwaysSay || []).join(', '))
    .replace('{alwaysTone}', (s.alwaysTone || []).join(', '))
    + `\n단계: ${phaseInfo.label || phase}`;

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

  if (!resp.ok) {
    const err = await resp.text();
    if (templateFallback) return templateFallback;
    throw new Error(`Claude API 실패: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) {
    if (templateFallback) return templateFallback;
    throw new Error('Claude 응답 비어 있음');
  }
  return text.slice(0, 500);
}
