const BASE = 'https://graph.threads.net/v1.0';

function requireToken() {
  const token = process.env.THREADS_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('THREADS_ACCESS_TOKEN 없음 — npm run auth 실행');
  return token;
}

function userId() {
  const id = process.env.THREADS_USER_ID?.trim();
  if (!id) throw new Error('THREADS_USER_ID 없음 — npm run auth 실행');
  return id;
}

async function apiPost(path, params) {
  const token = requireToken();
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url, { method: 'POST' });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error?.message || JSON.stringify(data));
  }
  return data;
}

/** 텍스트 글 2단계: 컨테이너 생성 → 발행 */
export async function publishText(text) {
  const uid = userId();
  const container = await apiPost(`/${uid}/threads`, {
    media_type: 'TEXT',
    text,
  });

  const creationId = container.id;
  if (!creationId) throw new Error('creation_id 없음: ' + JSON.stringify(container));

  // Meta 권장: 짧은 대기 후 publish
  await sleep(1500);

  const published = await apiPost(`/${uid}/threads_publish`, {
    creation_id: creationId,
  });

  return { creationId, postId: published.id };
}

export async function fetchMe() {
  const token = requireToken();
  const url = new URL(`${BASE}/me`);
  url.searchParams.set('fields', 'id,username,name');
  url.searchParams.set('access_token', token);
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

export async function exchangeCodeForToken(code, appId, appSecret, redirectUri) {
  const url = new URL(`${BASE}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('grant_type', 'authorization_code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);

  const resp = await fetch(url, { method: 'GET' });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error_message || JSON.stringify(data));
  return data;
}

export async function exchangeForLongLivedToken(shortToken, appSecret) {
  const url = new URL(`${BASE}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('access_token', shortToken);

  const resp = await fetch(url, { method: 'GET' });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
