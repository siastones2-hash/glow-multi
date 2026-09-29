import { readJson } from './util.js';
import { draftReplyTemplate } from './comments.js';

const PROMPT = `스레드 댓글에 달 답글 1개. 익명 일기 계정 톤.

원글 요약: {postPreview}
상대 댓글 (@{username}): {comment}

규칙:
- 짧고 편하게. 옆자리 톤
- 상호·실명·대표·브랜드·링크·문의유도 X
- 잘난 척·가르치기·판매 멘트 X
- 120자 이내
- 이모지 0~1개
- 답글만 출력`;

export async function generateReplyDraft(comment) {
  const diary = readJson('config/diary.json', { neverSay: [] });
  const fallback = draftReplyTemplate(comment.text || '');
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) return { text: fallback, mode: 'template' };

  const prompt = PROMPT
    .replace('{postPreview}', (comment.postPreview || '(없음)').slice(0, 120))
    .replace('{username}', comment.username || '')
    .replace('{comment}', (comment.text || '').slice(0, 300));

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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) return { text: fallback, mode: 'template' };
    const data = await resp.json();
    let text = data.content?.[0]?.text?.trim() || fallback;
    text = text.slice(0, 120);
    const hit = (diary.neverSay || []).find((w) => text.toLowerCase().includes(String(w).toLowerCase()));
    if (hit) text = fallback;
    return { text, mode: 'ai' };
  } catch {
    return { text: fallback, mode: 'template' };
  }
}
