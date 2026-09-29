import { readJson, writeJson } from './util.js';

export function listQueue() {
  return readJson('data/queue.json', { items: [] }).items;
}

export function addToQueue(item) {
  const q = readJson('data/queue.json', { items: [] });
  q.items.push({
    id: `q_${Date.now()}`,
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...item,
  });
  writeJson('data/queue.json', q);
  return q.items[q.items.length - 1];
}

export function popDue(now = new Date()) {
  const q = readJson('data/queue.json', { items: [] });
  const due = q.items.filter(
    (i) => i.status === 'pending' && i.publishAt && new Date(i.publishAt) <= now
  );
  return due.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
}

export function markPublished(id, result) {
  const q = readJson('data/queue.json', { items: [] });
  const item = q.items.find((i) => i.id === id);
  if (item) {
    item.status = 'published';
    item.publishedAt = new Date().toISOString();
    item.result = result;
  }
  writeJson('data/queue.json', q);
}

export function markFailed(id, error) {
  const q = readJson('data/queue.json', { items: [] });
  const item = q.items.find((i) => i.id === id);
  if (item) {
    item.status = 'failed';
    item.error = String(error);
  }
  writeJson('data/queue.json', q);
}
