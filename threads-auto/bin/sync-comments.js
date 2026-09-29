#!/usr/bin/env node
/** 댓글 수집 + 답글 초안 자동 생성 */
import { loadEnv, log } from '../src/util.js';
import { syncCommentsViaBrowser } from '../src/browser-comments.js';
import { upsertComments, listComments, updateComment } from '../src/comments.js';
import { generateReplyDraft } from '../src/generate-reply.js';

loadEnv();

async function main() {
  const headed = process.argv.includes('--headed');
  log('댓글 수집 중…');
  const scraped = syncCommentsViaBrowser({ maxPosts: 5, headed });
  if (scraped.error) throw new Error(scraped.error);

  upsertComments(scraped.items || []);
  log(`수집 ${scraped.count || 0}개`);

  const needsDraft = listComments().filter((c) => c.status === 'new' && !c.draftReply);
  for (const c of needsDraft) {
    const draft = await generateReplyDraft(c);
    updateComment(c.id, {
      draftReply: draft.text,
      status: 'draft',
      draftMode: draft.mode,
    });
    log(`초안 @${c.username}: ${draft.text.slice(0, 40)}…`);
  }

  log('완료 → UI에서 확인 후 전송');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
