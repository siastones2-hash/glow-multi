import { readJson, writeJson } from './util.js';

const FILE = 'data/comments.json';

function load() {
  return readJson(FILE, { items: [], syncedAt: null });
}

function save(data) {
  writeJson(FILE, data);
}

export function listComments({ status } = {}) {
  const items = load().items || [];
  if (!status) return items;
  return items.filter((i) => i.status === status);
}

export function commentsMeta() {
  const data = load();
  return {
    syncedAt: data.syncedAt,
    total: (data.items || []).length,
    pending: (data.items || []).filter((i) => i.status === 'new' || i.status === 'draft').length,
  };
}

export function upsertComments(rawList) {
  const data = load();
  const byKey = new Map((data.items || []).map((i) => [i.key, i]));

  for (const raw of rawList) {
    const key = raw.key || `${raw.postUrl || ''}::${raw.username || ''}::${(raw.text || '').slice(0, 40)}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.text = raw.text || prev.text;
      prev.username = raw.username || prev.username;
      prev.postUrl = raw.postUrl || prev.postUrl;
      prev.postPreview = raw.postPreview || prev.postPreview;
      prev.seenAt = new Date().toISOString();
    } else {
      byKey.set(key, {
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        key,
        username: raw.username || '',
        text: raw.text || '',
        postUrl: raw.postUrl || '',
        postPreview: raw.postPreview || '',
        status: 'new',
        draftReply: '',
        createdAt: new Date().toISOString(),
        seenAt: new Date().toISOString(),
      });
    }
  }

  data.items = [...byKey.values()].sort((a, b) => (b.seenAt || '').localeCompare(a.seenAt || ''));
  data.syncedAt = new Date().toISOString();
  save(data);
  return data;
}

export function updateComment(id, patch) {
  const data = load();
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error('댓글 없음');
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  save(data);
  return item;
}

export function getComment(id) {
  return load().items.find((i) => i.id === id);
}

/** 템플릿 기반 답글 초안 */
export function draftReplyTemplate(commentText = '') {
  const diary = readJson('config/diary.json', { replyTemplates: [] });
  const tpls = diary.replyTemplates?.length
    ? diary.replyTemplates
    : ['비슷한 경험이에요. 저도 그 부분 자주 걸려요.'];

  const t = commentText.trim();
  if (/고마|감사|감사합|thanks/i.test(t)) {
    return '편하게 남겨주셔서 감사해요 🙂';
  }
  if (/\?|어떻|뭐|궁금|방법|어떻게/.test(t)) {
    return '저도 딱 정답은 없고, 조금씩 맞춰가는 편이에요. 편히 이야기해요.';
  }
  if (/공감|맞아요|진짜/.test(t)) {
    return '공감돼요. 저도 요즘 그 고민 중이에요.';
  }
  return tpls[Math.floor(Math.random() * tpls.length)];
}
