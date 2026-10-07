// RWPH tracker: 1초마다 wave 확인 → 오르면 해당 시간(KST)의 RWPH +1
const fs = require('fs');
const { execSync } = require('child_process');

const PLAYER = process.env.PLAYER || 'ReynRule';
const URL = `https://raongames.com/growcastle/restapi/season/now/players/${encodeURIComponent(PLAYER)}`;
const RUN_MS = (Number(process.env.RUN_MINUTES) || 345) * 60 * 1000;
const HANDOFF_AT = Number(process.env.HANDOFF_AT) || 0; // 이전 job에게 넘겨받는 시각(ms)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMMIT_EVERY_MS = 1 * 60 * 1000;
const MAX_HOURS = 24;
const STATE = 'data/state.json';

let state = { player: PLAYER, lastWave: null, hours: {}, updated: 0 };
const load = () => { try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {} state.player = PLAYER; };
load();

const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString(); // KST 기준 ISO 문자열
const hourKey = (ms) => kst(ms).slice(0, 13); // 2026-10-04T21
const nf = (n) => n.toLocaleString('en-US');

function render() {
  const keys = Object.keys(state.hours).sort().slice(-MAX_HOURS);
  const nowKey = hourKey(Date.now());
  const max = Math.max(1, ...keys.map((k) => state.hours[k].count));
  const total = keys.reduce((s, k) => s + state.hours[k].count, 0);
  const totalGain = keys.reduce((s, k) => s + state.hours[k].gain, 0);
  const best = keys.reduce((b, k) => (state.hours[k].count > (state.hours[b]?.count ?? -1) ? k : b), keys[0]);
  const W = 62, line = '═'.repeat(W);
  const pad = (s) => '║ ' + s + ' '.repeat(Math.max(0, W - 1 - s.length)) + '║';

  const out = [
    '╔' + line + '╗',
    pad(''),
    pad(`   R W P H   ::   Rate of Waves Per Hour`),
    pad(`   Player : ${PLAYER}`),
    pad(''),
    '╠' + line + '╣',
    pad(` Last wave   : ${state.lastWave == null ? '-' : nf(state.lastWave)}`),
    pad(` Updated     : ${kst(Date.now()).replace('T', ' ').slice(0, 19)} (KST)`),
    pad(` Total       : +${nf(totalGain)} wave`),
    pad(` Best hour   : ${best ? best.replace('T', ' ') + ':00  [' + nf(state.hours[best].count) + ']' : '-'}`),
    '╚' + line + '╝',
    '',
    '  Time(KST)               RWPH   Graph                  wave+',
    '  ──────────────────────────────────────────────────────────────────',
  ];
  for (const k of keys.slice().reverse()) {
    const h = state.hours[k];
    const hh = Number(k.slice(11, 13));
    const next = String((hh + 1) % 24).padStart(2, '0');
    const len = Math.round((h.count / max) * 20);
    const bar = '█'.repeat(len) + '░'.repeat(20 - len);
    const label = `${k.slice(0, 10)} ${k.slice(11, 13)}:00~${next}:00`;
    out.push(`  ${label}  ${String(nf(h.count)).padStart(6)}   ${bar}  +${nf(h.gain)}${k === nowKey ? '  ◀ NOW' : ''}`);
  }
  out.push('', '  * Recording for 24h');
  fs.writeFileSync('rwph.txt', out.join('\n') + '\n');
}

function save() {
  state.updated = Date.now();
  const keys = Object.keys(state.hours).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_HOURS))) delete state.hours[k];
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  render();
}

function commit() {
  save();
  try {
    execSync('git add rwph.txt data/state.json');
    if (!execSync('git status --porcelain').toString().trim()) return;
    execSync('git commit -m "chore: update rwph [skip ci]"');
    try { execSync('git pull --rebase --autostash', { stdio: 'ignore' }); } catch {}
    execSync('git push', { stdio: 'ignore' });
    console.log('committed', new Date().toISOString());
  } catch (e) { console.error('commit failed', e.message); }
}

async function tick() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(4000) });
    const json = await res.json();
    const me = json?.result?.list?.find((p) => p.nick === PLAYER) ?? json?.result?.list?.[0];
    if (!me) return;
    const wave = me.wave;
    if (state.lastWave != null && wave > state.lastWave) {
      const k = hourKey(Date.now());
      const h = (state.hours[k] ??= { count: 0, gain: 0 });
      h.count += 1;
      h.gain += wave - state.lastWave;
    }
    // 현재 시간 칸이 비어 있어도 0으로 보이게 생성
    state.hours[hourKey(Date.now())] ??= { count: 0, gain: 0 };
    state.lastWave = wave;
  } catch (e) { /* 네트워크 오류는 무시하고 다음 틱 */ }
}

function dispatchNext(at) {
  try {
    execSync(`gh workflow run rwph.yml --ref ${process.env.GITHUB_REF_NAME || 'main'} -f handoff_at=${at}`, { stdio: 'inherit' });
    console.log('next run dispatched, handoff at', new Date(at).toISOString());
  } catch (e) { console.error('dispatch failed (cron 백업이 복구함)', e.message); }
}

(async () => {
  // cron 백업으로 시작됐는데 이미 다른 job이 돌고 있으면 바로 종료
  if (!HANDOFF_AT && Date.now() - (state.updated || 0) < 10 * 60 * 1000) {
    console.log('이미 실행 중인 job이 있어 종료합니다.');
    return;
  }
  let start = Date.now();
  if (HANDOFF_AT) {
    start = HANDOFF_AT;
    await sleep(Math.max(0, HANDOFF_AT - Date.now()));
    // 이전 job의 마지막 커밋(최신 state)을 받아올 때까지 최대 40초 대기
    for (let i = 0; i < 40; i++) {
      try { execSync('git pull --rebase --autostash', { stdio: 'ignore' }); load(); } catch {}
      if ((state.updated || 0) >= HANDOFF_AT - 2000) break;
      await sleep(1000);
    }
  }
  const end = start + RUN_MS;
  let lastCommit = Date.now(), next = Date.now(), dispatched = false;
  while (Date.now() < end) {
    await tick();
    if (!dispatched && process.env.GITHUB_ACTIONS && Date.now() >= end - 120000) {
      dispatched = true;
      dispatchNext(end);
    }
    if (Date.now() - lastCommit >= COMMIT_EVERY_MS) { commit(); lastCommit = Date.now(); }
    next += 1000;
    await sleep(Math.max(0, next - Date.now()));
  }
  commit();
})();
