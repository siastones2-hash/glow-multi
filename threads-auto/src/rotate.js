import { loadConfig, readJson, writeJson } from './util.js';

function getState() {
  return readJson('data/state.json', {
    rotationIndex: 0,
    templateIndex: {},
    introPhase: 1,
    totalPosts: 0,
  });
}

/** 현재 단계에서 올릴 수 있는 주제만 */
export function activeRotation() {
  const config = loadConfig();
  const state = getState();
  const phase = state.introPhase || 1;
  return config.rotation.filter((id) => {
    const biz = config.businesses[id];
    return biz && (biz.introPhase || 1) <= phase;
  });
}

export function getIntroPhase() {
  return getState().introPhase || 1;
}

export function bumpPostCount() {
  const config = loadConfig();
  const state = getState();
  state.totalPosts = (state.totalPosts || 0) + 1;
  const phases = config.strategy?.phases || [];
  for (const p of phases) {
    if (state.totalPosts < p.untilPosts) {
      state.introPhase = p.phase;
      break;
    }
  }
  writeJson('data/state.json', state);
  return state;
}

export function peekNextBusinessId() {
  const ids = activeRotation();
  if (!ids.length) throw new Error('활성 주제 없음');
  const state = getState();
  return ids[state.rotationIndex % ids.length];
}

export function nextBusinessId() {
  const ids = activeRotation();
  if (!ids.length) throw new Error('활성 주제 없음');
  const state = getState();
  const id = ids[state.rotationIndex % ids.length];
  state.rotationIndex = (state.rotationIndex + 1) % ids.length;
  writeJson('data/state.json', state);
  return id;
}

export function peekTemplate(businessId) {
  const config = loadConfig();
  const biz = config.businesses[businessId];
  if (!biz?.templates?.length) throw new Error(`템플릿 없음: ${businessId}`);
  const state = getState();
  const idx = state.templateIndex[businessId] || 0;
  return biz.templates[idx % biz.templates.length];
}

export function pickTemplate(businessId) {
  const config = loadConfig();
  const biz = config.businesses[businessId];
  if (!biz?.templates?.length) throw new Error(`템플릿 없음: ${businessId}`);

  const state = getState();
  const idx = state.templateIndex[businessId] || 0;
  const text = biz.templates[idx % biz.templates.length];
  state.templateIndex[businessId] = (idx + 1) % biz.templates.length;
  writeJson('data/state.json', state);
  return text;
}

export function getBusiness(businessId) {
  const config = loadConfig();
  const biz = config.businesses[businessId];
  if (!biz) throw new Error(`사업 없음: ${businessId}`);
  return biz;
}
