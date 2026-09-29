#!/usr/bin/env node
/** publishAt 지난 pending 글 발행 */
import { loadEnv, log } from '../src/util.js';
import { popDue, markPublished, markFailed } from '../src/queue.js';
import { publishCurrent } from '../src/publish.js';

loadEnv();

async function main() {
  const due = popDue();
  if (!due.length) {
    log('발행할 예약 글 없음');
    return;
  }

  for (const item of due) {
    log(`발행: ${item.businessName} (${item.id})`);
    console.log(item.text);
    try {
      const result = await publishCurrent(item.text);
      markPublished(item.id, result);
      log(`완료 ${result.postId || result.verified ? 'ok' : JSON.stringify(result)}`);
    } catch (e) {
      markFailed(item.id, e.message);
      log(`실패: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
