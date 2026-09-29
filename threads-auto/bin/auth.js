#!/usr/bin/env node
/**
 * Threads OAuth 1회 — 브라우저 로그인 후 .env에 토큰 저장
 * 사전: developers.facebook.com → Threads API 앱 + THREADS_APP_ID/SECRET in .env
 */
import http from 'http';
import { execSync } from 'child_process';
import { loadEnv, saveEnvValue, log } from '../src/util.js';
import { exchangeCodeForToken, exchangeForLongLivedToken, fetchMe } from '../src/threads.js';

loadEnv();

const appId = process.env.THREADS_APP_ID?.trim();
const appSecret = process.env.THREADS_APP_SECRET?.trim();
const redirectUri = process.env.THREADS_REDIRECT_URI?.trim() || 'http://localhost:8787/callback';
const port = new URL(redirectUri).port || 8787;

if (!appId || !appSecret) {
  console.error('THREADS_APP_ID, THREADS_APP_SECRET 을 .env에 넣어주세요.');
  console.error('→ developers.facebook.com → 앱 만들기 → Threads 사용 사례');
  process.exit(1);
}

const scopes = ['threads_basic', 'threads_content_publish'].join(',');
const authUrl =
  `https://threads.net/oauth/authorize?client_id=${appId}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}` +
  `&scope=${encodeURIComponent(scopes)}` +
  `&response_type=code`;

console.log('\n브라우저에서 Threads 로그인...\n');
console.log(authUrl + '\n');

try {
  execSync(`open "${authUrl}"`);
} catch {
  console.log('브라우저를 수동으로 열어 위 URL 접속');
}

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const code = new URL(req.url, redirectUri).searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('code 없음');
    return;
  }

  try {
    const short = await exchangeCodeForToken(code, appId, appSecret, redirectUri);
    const long = await exchangeForLongLivedToken(short.access_token, appSecret);
    const token = long.access_token || short.access_token;

    saveEnvValue('THREADS_ACCESS_TOKEN', token);
    process.env.THREADS_ACCESS_TOKEN = token;

    const me = await fetchMe();
    saveEnvValue('THREADS_USER_ID', me.id);

    log(`인증 완료 @${me.username || me.id}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Threads 연결 완료</h2><p>@${me.username || me.id}</p><p>이 창 닫고 터미널로 돌아가세요.</p>`);
  } catch (e) {
    res.writeHead(500);
    res.end('오류: ' + e.message);
    console.error(e);
  } finally {
    setTimeout(() => server.close(), 500);
  }
});

server.listen(port, () => console.log(`콜백 대기 http://localhost:${port}/callback`));
