import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { ROOT } from './util.js';

const PYTHON = process.env.THREADS_PYTHON
  || '/Users/apple/glow-multi/.venv-barona/bin/python';
const STORAGE = path.join(ROOT, 'data/threads-storage.json');
const PROFILE = path.join(ROOT, 'data/browser-profile');

export function hasBrowserSession() {
  if (fs.existsSync(PROFILE)) {
    const prefs = path.join(PROFILE, 'Default', 'Preferences');
    if (fs.existsSync(prefs)) return true;
  }
  return fs.existsSync(STORAGE);
}

export function publishViaBrowser(text) {
  const script = path.join(ROOT, 'scripts/threads_post.py');
  const r = spawnSync(PYTHON, [script, text], {
    encoding: 'utf8',
    timeout: 120000,
    cwd: ROOT,
  });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  if (r.status !== 0) {
    let msg = err || out;
    try {
      const j = JSON.parse(out);
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg || '브라우저 발행 실패');
  }
  try {
    return JSON.parse(out);
  } catch {
    return { ok: true, raw: out };
  }
}

export function startLoginProcess() {
  const script = path.join(ROOT, 'scripts/threads_login.py');
  return spawn(PYTHON, [script], {
    cwd: ROOT,
    detached: true,
    stdio: 'inherit',
  });
}
