#!/usr/bin/env node
import { execSync, spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, loadConfig, readJson, writeJson, log, ROOT, saveEnvValue } from '../src/util.js';
import { nextBusinessId, peekNextBusinessId, pickTemplate, peekTemplate, getBusiness, bumpPostCount, getIntroPhase, activeRotation } from '../src/rotate.js';
import { generatePost } from '../src/generate.js';
import { generateTrendPost } from '../src/generate-trend.js';
import { generateDiaryPost } from '../src/generate-diary.js';
import { generateReplyDraft } from '../src/generate-reply.js';
import { listTrendsPreview } from '../src/trends.js';
import { publishText, fetchMe, exchangeCodeForToken, exchangeForLongLivedToken } from '../src/threads.js';
import { hasBrowserSession } from '../src/browser-post.js';
import { publishCurrent } from '../src/publish.js';
import { listQueue, addToQueue, popDue, markPublished, markFailed } from '../src/queue.js';
import {
  listComments,
  commentsMeta,
  upsertComments,
  updateComment,
  getComment,
} from '../src/comments.js';
import { syncCommentsViaBrowser, replyViaBrowser } from '../src/browser-comments.js';


loadEnv();

const PORT = parseInt(process.env.UI_PORT || '3847', 10);
const REDIRECT_URI = process.env.THREADS_REDIRECT_URI?.trim()
  || `http://localhost:${PORT}/api/auth/callback`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function status() {
  const hasEnv = fs.existsSync(path.join(ROOT, '.env'));
  const token = !!process.env.THREADS_ACCESS_TOKEN?.trim();
  const userId = !!process.env.THREADS_USER_ID?.trim();
  const appId = !!process.env.THREADS_APP_ID?.trim();
  const claude = !!process.env.ANTHROPIC_API_KEY?.trim();
  const state = readJson('data/state.json', { rotationIndex: 0, templateIndex: {} });
  const config = loadConfig();
  const browserSession = hasBrowserSession();
  const phase = getIntroPhase();
  const phaseInfo = config.strategy?.phases?.find((p) => p.phase === phase);
  const nextId = peekNextBusinessId();
  const nextBiz = config.businesses[nextId];

  return {
    hasEnv,
    introPhase: phase,
    phaseLabel: phaseInfo?.label,
    phaseDesc: phaseInfo?.desc,
    activeTopics: activeRotation().map((id) => config.businesses[id]?.name),
    activeIds: activeRotation(),
    totalPosts: state.totalPosts || 0,
    threads: {
      appId,
      token,
      userId,
      browserSession,
      apiReady: token && userId,
      ready: (token && userId) || browserSession,
      mode: browserSession ? 'browser' : (token && userId) ? 'api' : null,
    },
    claude,
    contentMode: process.env.CONTENT_MODE || 'trend',
    generateMode: claude ? 'ai' : 'template',
    rotationIndex: state.rotationIndex,
    nextBusiness: nextId ? { id: nextId, ...nextBiz } : null,
    publishTime: `${process.env.PUBLISH_HOUR || '9'}:${String(process.env.PUBLISH_MINUTE || '0').padStart(2, '0')} KST`,
    diary: readJson('config/diary.json', {}),
    comments: commentsMeta(),
    queueCount: listQueue().filter((i) => i.status === 'pending').length,
    redirectUri: REDIRECT_URI,
    appIdPreview: process.env.THREADS_APP_ID?.trim()
      ? process.env.THREADS_APP_ID.trim().slice(0, 6) + '…'
      : '',
  };
}

function authUrl() {
  const appId = process.env.THREADS_APP_ID?.trim();
  if (!appId) return null;
  const scopes = ['threads_basic', 'threads_content_publish'].join(',');
  return (
    `https://threads.net/oauth/authorize?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&response_type=code`
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      let me = null;
      if (process.env.THREADS_ACCESS_TOKEN) {
        try { me = await fetchMe(); } catch { /* not connected yet */ }
      }
      return json(res, 200, { ...status(), threadsUser: me });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, loadConfig());
    }

    if (req.method === 'GET' && url.pathname === '/api/queue') {
      return json(res, 200, { items: listQueue() });
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const logPath = path.join(ROOT, 'data/run.log');
      const lines = fs.existsSync(logPath)
        ? fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-40)
        : [];
      return json(res, 200, { lines });
    }

    if (req.method === 'POST' && url.pathname === '/api/browser/login') {
      const cmd = path.join(ROOT, '스레드-로그인.command');
      execSync(`open "${cmd}"`);
      return json(res, 200, { ok: true, message: '로그인 창을 열었습니다' });
    }

    if (req.method === 'POST' && url.pathname === '/api/meta') {
      const body = await readBody(req);
      if (!body.appId?.trim() || !body.appSecret?.trim()) {
        return json(res, 400, { error: 'App ID와 App Secret 둘 다 필요합니다' });
      }
      saveEnvValue('THREADS_APP_ID', body.appId.trim());
      saveEnvValue('THREADS_APP_SECRET', body.appSecret.trim());
      saveEnvValue('THREADS_REDIRECT_URI', REDIRECT_URI);
      loadEnv();
      return json(res, 200, { ok: true, redirectUri: REDIRECT_URI });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/url') {
      const urlAuth = authUrl();
      if (!urlAuth) return json(res, 400, { error: 'Meta App ID/Secret 먼저 저장하세요' });
      return json(res, 200, { url: urlAuth, redirectUri: REDIRECT_URI });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/callback') {
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<h2>연결 취소됨</h2><p>${err}</p><p><a href="/">돌아가기</a></p>`);
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h2>code 없음</h2><p><a href="/">돌아가기</a></p>');
      }
      const appId = process.env.THREADS_APP_ID?.trim();
      const appSecret = process.env.THREADS_APP_SECRET?.trim();
      if (!appId || !appSecret) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h2>App ID/Secret 없음</h2><p><a href="/">설정으로</a></p>');
      }
      try {
        const short = await exchangeCodeForToken(code, appId, appSecret, REDIRECT_URI);
        const long = await exchangeForLongLivedToken(short.access_token, appSecret);
        const token = long.access_token || short.access_token;
        saveEnvValue('THREADS_ACCESS_TOKEN', token);
        process.env.THREADS_ACCESS_TOKEN = token;
        const me = await fetchMe();
        saveEnvValue('THREADS_USER_ID', me.id);
        log(`Threads 연동 @${me.username || me.id}`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
          <meta http-equiv="refresh" content="2;url=/?connected=1">
          <style>body{font-family:sans-serif;background:#0f1117;color:#eef;padding:40px;text-align:center}
          h2{color:#22c55e}</style></head><body>
          <h2>✅ Threads 연결 완료!</h2>
          <p>@${me.username || me.id}</p>
          <p>2초 후 돌아갑니다…</p>
          <p><a href="/?connected=1" style="color:#818cf8">바로 돌아가기</a></p>
          </body></html>`);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>연결 오류</h2><p>${e.message}</p><p><a href="/">돌아가기</a></p>`);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const body = await readBody(req);
      const businessId = body.businessId || peekNextBusinessId();
      const biz = getBusiness(businessId);
      const template = peekTemplate(businessId);
      const text = await generatePost(businessId, { templateFallback: template });
      return json(res, 200, {
        businessId,
        businessName: biz.name,
        emoji: biz.emoji,
        text,
        mode: process.env.ANTHROPIC_API_KEY ? 'ai' : 'template',
        chars: text.length,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const body = await readBody(req);
      if (!body.text?.trim()) return json(res, 400, { error: '글 내용 없음' });
      if (body.businessId && body.businessId !== 'trend') {
        pickTemplate(body.businessId);
        if (body.businessId === peekNextBusinessId()) nextBusinessId();
      }
      bumpPostCount();
      if (body.businessId === 'trend' && body.trendTopic) {
        const { markTrendUsed } = await import('../src/trends.js');
        markTrendUsed(body.trendTopic);
      }
      const result = await publishCurrent(body.text.trim());
      log(`UI 발행 ${result.postId || result.text?.slice(0, 20) || 'ok'}`);
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/queue-add') {
      const body = await readBody(req);
      if (!body.text?.trim()) return json(res, 400, { error: '글 내용 없음' });
      const item = addToQueue({
        businessId: body.businessId,
        businessName: body.businessName,
        text: body.text.trim(),
        publishAt: body.publishAt || new Date(Date.now() + 86400000).toISOString(),
      });
      return json(res, 200, { ok: true, item });
    }

    if (req.method === 'POST' && url.pathname === '/api/publish-due') {
      const due = popDue();
      const results = [];
      for (const item of due) {
        try {
          const result = await publishCurrent(item.text);
          markPublished(item.id, result);
          results.push({ id: item.id, ok: true, postId: result.postId });
        } catch (e) {
          markFailed(item.id, e.message);
          results.push({ id: item.id, ok: false, error: e.message });
        }
      }
      return json(res, 200, { count: results.length, results });
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readBody(req);
      if (body.publishHour != null) saveEnvValue('PUBLISH_HOUR', String(body.publishHour));
      if (body.publishMinute != null) saveEnvValue('PUBLISH_MINUTE', String(body.publishMinute));
      if (body.contentMode) saveEnvValue('CONTENT_MODE', body.contentMode);
      loadEnv();
      return json(res, 200, { ok: true, publishTime: status().publishTime });
    }

    if (req.method === 'GET' && url.pathname === '/api/trends') {
      const items = await listTrendsPreview(10);
      return json(res, 200, { items });
    }

    if (req.method === 'POST' && url.pathname === '/api/today') {
      const mode = (process.env.CONTENT_MODE || 'trend').trim();
      if (mode === 'diary') {
        const r = await generateDiaryPost({ useAi: true });
        return json(res, 200, r);
      }
      if (mode === 'trend') {
        const r = await generateTrendPost({ markUsed: false });
        return json(res, 200, r);
      }
      const businessId = peekNextBusinessId();
      const biz = getBusiness(businessId);
      const template = peekTemplate(businessId);
      const text = await generatePost(businessId, { templateFallback: template });
      return json(res, 200, {
        businessId,
        businessName: biz.name,
        emoji: biz.emoji,
        text,
        mode: process.env.ANTHROPIC_API_KEY ? 'ai' : 'template',
        chars: text.length,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/diary/fill') {
      const body = await readBody(req);
      const days = Math.min(Math.max(parseInt(body.days || '1', 10), 1), 14);
      await new Promise((resolve, reject) => {
        const child = spawn('node', [path.join(ROOT, 'bin/fill-diary.js'), String(days)], {
          cwd: ROOT,
          stdio: 'inherit',
        });
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`fill-diary exit ${code}`))));
      });
      return json(res, 200, { ok: true, queueCount: listQueue().filter((i) => i.status === 'pending').length });
    }

    if (req.method === 'GET' && url.pathname === '/api/comments') {
      return json(res, 200, { ...commentsMeta(), items: listComments() });
    }

    if (req.method === 'POST' && url.pathname === '/api/comments/sync') {
      const scraped = syncCommentsViaBrowser({ maxPosts: 5 });
      upsertComments(scraped.items || []);
      const needs = listComments().filter((c) => (c.status === 'new' || c.status === 'draft') && !c.draftReply);
      for (const c of needs) {
        const draft = await generateReplyDraft(c);
        updateComment(c.id, { draftReply: draft.text, status: 'draft', draftMode: draft.mode });
      }
      return json(res, 200, { ok: true, scraped: scraped.count || 0, ...commentsMeta(), items: listComments() });
    }

    if (req.method === 'POST' && url.pathname === '/api/comments/draft') {
      const body = await readBody(req);
      const item = getComment(body.id);
      if (!item) return json(res, 404, { error: '댓글 없음' });
      const draft = await generateReplyDraft(item);
      const updated = updateComment(item.id, {
        draftReply: body.text?.trim() || draft.text,
        status: 'draft',
        draftMode: body.text?.trim() ? 'manual' : draft.mode,
      });
      return json(res, 200, { ok: true, item: updated });
    }

    if (req.method === 'POST' && url.pathname === '/api/comments/send') {
      const body = await readBody(req);
      const item = getComment(body.id);
      if (!item) return json(res, 404, { error: '댓글 없음' });
      const text = (body.text || item.draftReply || '').trim();
      if (!text) return json(res, 400, { error: '답글 내용 없음' });
      if (!item.postUrl) return json(res, 400, { error: 'postUrl 없음 — 다시 동기화' });
      const result = replyViaBrowser(item.postUrl, text);
      const updated = updateComment(item.id, {
        draftReply: text,
        status: 'replied',
        repliedAt: new Date().toISOString(),
        replyResult: result,
      });
      log(`답글 전송 @${item.username}`);
      return json(res, 200, { ok: true, item: updated, result });
    }

    if (req.method === 'POST' && url.pathname === '/api/comments/skip') {
      const body = await readBody(req);
      const updated = updateComment(body.id, { status: 'skipped' });
      return json(res, 200, { ok: true, item: updated });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/')) {
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      const fp = path.join(PUBLIC, file);
      if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp)) {
        res.writeHead(404);
        return res.end('not found');
      }
      const ext = path.extname(fp);
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
      res.writeHead(200, { 'Content-Type': `${types[ext] || 'text/plain'}; charset=utf-8` });
      return res.end(fs.readFileSync(fp));
    }
  } catch (e) {
    return json(res, 500, { error: e.message });
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`\n  Threads Auto UI → http://localhost:${PORT}\n`);
  try {
    execSync(`open "http://localhost:${PORT}"`);
  } catch { /* manual open */ }
});
