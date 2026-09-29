import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ROOT, readJson } from './util.js';

const PYTHON = process.env.THREADS_PYTHON
  || '/Users/apple/glow-multi/.venv-barona/bin/python';

function runPy(scriptName, args = []) {
  const script = path.join(ROOT, 'scripts', scriptName);
  const r = spawnSync(PYTHON, [script, ...args], {
    encoding: 'utf8',
    timeout: 180000,
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
    throw new Error(msg || `${scriptName} 실패`);
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`${scriptName} JSON 파싱 실패: ${out.slice(0, 200)}`);
  }
}

export function syncCommentsViaBrowser({ maxPosts = 5, headed = false } = {}) {
  const diary = readJson('config/diary.json', {});
  const handle = diary.profileHandle || 'leestones2';
  const args = [`--user=${handle}`, `--max=${maxPosts}`];
  if (headed) args.push('--headed');
  return runPy('threads_comments.py', args);
}

export function replyViaBrowser(postUrl, text, { headed = false } = {}) {
  const args = [postUrl, text];
  if (headed) args.push('--headed');
  return runPy('threads_reply.py', args);
}

export function hasBrowserProfile() {
  return fs.existsSync(path.join(ROOT, 'data/browser-profile'));
}
