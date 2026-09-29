import { hasBrowserSession, publishViaBrowser } from './browser-post.js';
import { publishText } from './threads.js';

/** 브라우저 로그인 또는 Meta API — 사용 가능한 방식으로 발행 */
export async function publishCurrent(text) {
  const useBrowser = hasBrowserSession() && !(process.env.THREADS_ACCESS_TOKEN?.trim());
  if (useBrowser) return publishViaBrowser(text);
  if (process.env.THREADS_ACCESS_TOKEN?.trim()) return publishText(text);
  throw new Error('Threads 연결 필요 — 스레드-로그인.command 실행');
}
