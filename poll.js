// RWPH tracker (multi-user)
// Poll users in user.txt · jumps 10–12 / 20–22 / 30–32 · /?name= dashboard
const fs = require('fs');
const { execSync } = require('child_process');

const RUN_MS = (Number(process.env.RUN_MINUTES) || 345) * 60 * 1000;
const HANDOFF_AT = Number(process.env.HANDOFF_AT) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMMIT_EVERY_MS = 1 * 60 * 1000;
const MAX_HOURS = 24;
const MAX_PAST = 30;
const STATE = 'data/state.json';
const USERS_FILE = 'user.txt';
const RANK_DIR = 'rankdata';
const RANK_INDEX = `${RANK_DIR}/index.json`;
const RANK_PAGE_DIR = 'rank';
const RANK_HTML = `${RANK_PAGE_DIR}/index.html`;

const RANK_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RWPH Rankings</title>
<style>
body{margin:0;padding:24px;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,"Segoe UI",sans-serif}
main{max-width:800px;margin:auto}
a{color:#58a6ff}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px;margin:14px 0}
select{max-width:100%;padding:10px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #30363d}
.num{text-align:right}
.muted{color:#8b949e}
.scroll{overflow-x:auto}
</style>
</head>
<body>
<main>
<p><a href="../">← Back to RWPH Tracker</a></p>
<h1>RWPH Rankings</h1>
<p class="muted">Hourly wave gain rankings · Korea Standard Time (KST)</p>
<div class="card">
<label for="hour">Select hour: </label>
<select id="hour"></select>
<p id="status" class="muted">Loading rankings...</p>
<div class="scroll">
<table>
<thead><tr><th>Rank</th><th>Player</th><th class="num">Wave Gain</th><th class="num">Wave Changes</th></tr></thead>
<tbody id="rows"></tbody>
</table>
</div>
</div>
<p class="muted">Updates automatically. Historical rankings are saved at 55 minutes past each hour.</p>
</main>
<script>
const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('en-US');
const hourLabel = h => h.replace('T',' ') + ':00 KST';
let selectedHour = '';
let currentHour = '';

function getKstHour(){
  return new Date(Date.now()+9*3600000).toISOString().slice(0,13);
}

function renderRows(rankings){
  $('rows').innerHTML = '';
  if(!rankings || !rankings.length){
    $('rows').innerHTML = '<tr><td colspan="4">No ranking data available.</td></tr>';
    return;
  }
  rankings.forEach((r,i)=>{
    const tr = document.createElement('tr');
    const values = [r.rank || i+1, r.nick || '', '+'+fmt(r.speed), fmt(r.waveChanges)];
    values.forEach((v,j)=>{
      const td = document.createElement('td');
      td.textContent = v;
      if(j===2 || j===3) td.className='num';
      tr.appendChild(td);
    });
    $('rows').appendChild(tr);
  });
}

async function loadRanking(){
  try{
    const now = getKstHour();
    currentHour = now;
    const res = await fetch('../data/state.json?t='+Date.now(),{cache:'no-store'});
    if(!res.ok) throw new Error('State HTTP '+res.status);
    const state = await res.json();

    if(selectedHour === now || !selectedHour){
      const rankings = Object.entries(state.users || {}).map(([nick,u])=>{
        const h = (u.hours || {})[now] || {};
        return {nick,speed:Number(h.gain)||0,waveChanges:Number(h.count)||0,lastWave:u.lastWave};
      }).sort((a,b)=>b.speed-a.speed || a.nick.localeCompare(b.nick))
        .map((r,i)=>({...r,rank:i+1}));
      selectedHour = now;
      renderRows(rankings);
      $('status').textContent = 'Live ranking · '+hourLabel(now)+' · Updated '+new Date(state.updated||Date.now()).toLocaleTimeString();
      return;
    }

    const snap = await fetch('../rankdata/'+selectedHour.slice(0,10)+'-'+selectedHour.slice(11,13)+'.json?t='+Date.now(),{cache:'no-store'});
    if(!snap.ok) throw new Error('Snapshot not available');
    const data = await snap.json();
    renderRows(data.rankings || []);
    $('status').textContent = 'Historical ranking · '+hourLabel(selectedHour);
  }catch(e){
    $('status').textContent = 'Could not load ranking data: '+e.message;
  }
}

async function loadHours(){
  try{
    const res = await fetch('../rankdata/index.json?t='+Date.now(),{cache:'no-store'});
    if(res.ok){
      const data = await res.json();
      (data.hours||[]).slice().reverse().forEach(h=>{
        const opt=document.createElement('option');
        opt.value=h;opt.textContent=hourLabel(h);
        $('hour').appendChild(opt);
      });
    }
  }catch(e){}
  const now=getKstHour();
  if(!Array.from($('hour').options).some(o=>o.value===now)){
    const opt=document.createElement('option');
    opt.value=now;opt.textContent=hourLabel(now)+' (Live)';
    $('hour').insertBefore(opt,$('hour').firstChild);
  }
  selectedHour=now;
  $('hour').value=now;
  loadRanking();
}

$('hour').addEventListener('change',()=>{
  selectedHour=$('hour').value;
  loadRanking();
});
loadHours();
setInterval(()=>{
  loadHours();
},60000);
setInterval(loadRanking,15000);
</script>
</body>
</html>
`;

function ensureRankHtml() {
  fs.mkdirSync(RANK_PAGE_DIR, { recursive: true });

  if (!fs.existsSync(RANK_HTML)) {
    fs.writeFileSync(RANK_HTML, RANK_HTML_TEMPLATE, 'utf8');
    console.log('created', RANK_HTML);
  }
}

const ISSUES_NEW_BASE = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}/issues/new`
  : (process.env.ISSUES_URL || '#');

const ISSUES_URL =
  ISSUES_NEW_BASE === '#'
    ? '#'
    : `${ISSUES_NEW_BASE}?title=${encodeURIComponent('Register users')}&body=`;

const newJumps = () => ({
  total: 0,
  j10: 0,
  j20: 0,
  j30: 0,
  hours: {}
});

const tierOf = (d) => {
  if (d >= 10 && d <= 12) return 10;
  if (d >= 20 && d <= 22) return 20;
  if (d >= 30 && d <= 32) return 30;
  return 0;
};

let state = {
  season: { start: null, end: null },
  users: {},
  updated: 0
};

const load = () => {
  try {
    state = {
      ...state,
      ...JSON.parse(fs.readFileSync(STATE, 'utf8'))
    };
  } catch {}

  state.season ??= { start: null, end: null };
  state.users ??= {};
};

load();

const BLOCKED_NICKS = new Set([
  'title',
  'body',
  'register users',
  'register user',
  'register',
  'user',
  'users'
]);

function readUsers() {
  try {
    return fs
      .readFileSync(USERS_FILE, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(
        (s) =>
          s.length >= 2 &&
          s.length <= 40 &&
          !BLOCKED_NICKS.has(s.toLowerCase())
      );
  } catch {
    return [];
  }
}

const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString();
const hourKey = (ms) => kst(ms).slice(0, 13);

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RWPH Tracker</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--text:#e6edf3;--sub:#8b949e;--acc:#58a6ff;--hot:#f0883e;--ok:#3fb950}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{-webkit-text-size-adjust:100%;min-height:100%}
body{margin:0;min-height:100vh;background-color:var(--bg);background-image:radial-gradient(1200px 600px at 10% -10%,#1b2a4a 0,transparent 60%);background-repeat:no-repeat;background-attachment:fixed;background-size:100% 100%;color:var(--text);font:14px/1.5 -apple-system,"Segoe UI","Noto Sans KR",sans-serif;font-variant-numeric:tabular-nums}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px 48px;padding-left:max(16px,env(safe-area-inset-left));padding-right:max(16px,env(safe-area-inset-right));padding-bottom:max(48px,env(safe-area-inset-bottom))}
h1{margin:0;font-size:22px;letter-spacing:.5px}
.sub{color:var(--sub);margin:4px 0 18px;word-break:keep-all}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card .l{color:var(--sub);font-size:12px}
.card .v{font-size:22px;font-weight:700;margin-top:2px}
.card.click{cursor:pointer;border-color:#5b3a1e;background:linear-gradient(135deg,#2a1c10,#161b22)}
.card.click .v{color:var(--hot)}
.card.click:hover{border-color:var(--hot)}
.hint{color:var(--sub);font-size:11px;margin-top:2px}
.panel{display:none;margin-bottom:16px}
.panel.open{display:block}
.tiers{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px}
.tier{flex:1;min-width:110px;text-align:center;border:1px solid var(--line);border-radius:10px;padding:10px;background:#0d1117}
.tier b{display:block;font-size:20px;color:var(--hot)}
.tier span{color:var(--sub);font-size:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--sub);font-weight:500;font-size:12px}
td.n,th.n{text-align:right}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.now td{background:#1c2a1f}
.badge{display:inline-block;background:var(--ok);color:#04210d;border-radius:6px;padding:0 6px;font-size:11px;font-weight:700;margin-left:6px}
.jbtn{display:inline-block;cursor:pointer;color:var(--hot);font-weight:700;border-radius:6px;padding:2px 8px;border:1px solid #5b3a1e;background:#2a1c10}
.jnone{color:var(--sub)}
tr.detail td{background:#12171e;color:var(--sub);font-size:13px}
tr.detail b{color:var(--hot)}
h2{font-size:15px;margin:22px 0 8px}
.foot{color:var(--sub);font-size:12px;margin-top:16px}
.home{max-width:420px;margin:12vh auto 0;text-align:center}
.home h1{font-size:28px;margin-bottom:8px}
.home p{color:var(--sub);margin:0 0 20px;font-size:14px}
.home form{display:flex;gap:8px}
.home input{flex:1;background:var(--card);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:12px 14px;font-size:15px;outline:none}
.home input:focus{border-color:var(--acc)}
.home button{background:var(--acc);color:#041018;border:none;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:700;cursor:pointer}
.issue-btn{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:14px;font-weight:600;text-decoration:none;cursor:pointer}
.issue-btn:hover{border-color:var(--acc);color:var(--acc)}
.err{color:#f85149;font-size:13px;margin-top:12px;display:none}
.back{display:inline-block;color:var(--sub);font-size:13px;margin-bottom:10px;text-decoration:none}
.back:hover{color:var(--acc)}
@media (max-width:600px){
  body{font-size:13px}
  .grid{grid-template-columns:1fr 1fr;gap:8px}
  .card.click{grid-column:1/-1}
  .home form{flex-direction:column}
}
</style>
</head>
<body>
<div class="wrap">
  <div id="homeView" class="home" style="display:none">
    <h1>RWPH Tracker</h1>
    <p>Enter a player name</p>
    <form id="searchForm">
      <input type="text" id="searchInput" placeholder="Player name" autocomplete="off" autofocus>
      <button type="submit">Go</button>
    </form>
    <div class="err" id="searchErr">User is not registered</div>
    <a class="issue-btn" id="issueBtn" href="/*ISSUES_URL*/" target="_blank" rel="noopener">Register user (open issue)</a>
    <a class="issue-btn rank-btn" href="./rank/" rel="noopener">View RWPH Rankings (/rank)</a>
    <div class="foot" style="margin-top:32px">Made By ReynRule</div>
  </div>
  <div id="dashView" style="display:none">
    <a class="back" href="./">← Back to search</a>
    <h1>RWPH</h1>
    <div class="sub" id="sub"></div>
    <div class="grid" id="cards"></div>
    <div class="card panel" id="seasonPanel">
      <div class="l">Season jump details (click to close)</div>
      <div class="tiers" id="tiers"></div>
      <div class="scroll"><table>
        <thead><tr><th>Hour (KST)</th><th class="n">10 Jump</th><th class="n">20 Jump</th><th class="n">30 Jump</th><th class="n">Total</th></tr></thead>
        <tbody id="seasonRows"></tbody>
      </table></div>
    </div>
    <h2>Last 24 hours</h2>
    <div class="card scroll"><table>
      <thead><tr><th>Hour (KST)</th><th class="n">RWPH</th><th class="n">wave+</th><th class="n">JUMP</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div id="pastWrap" style="display:none">
      <h2>Past seasons</h2>
      <div class="card scroll"><table>
        <thead><tr><th>Season (KST)</th><th class="n">Total jumps</th></tr></thead>
        <tbody id="pastRows"></tbody>
      </table></div>
    </div>
    <div class="foot">Made By ReynRule</div>
  </div>
</div>
<script>
var D = /*DATA*/null;
var $ = function(id){return document.getElementById(id)};
var nf = function(n){return Number(n||0).toLocaleString('en-US')};
var kst = function(ms){return new Date(ms+9*3600e3).toISOString()};
var fmt = function(ms){return kst(ms).replace('T',' ').slice(0,16)};
var label = function(k){var hh=Number(k.slice(11,13));return k.slice(0,10)+' '+k.slice(11,13)+':00~'+String((hh+1)%24).padStart(2,'0')+':00'};
var seasonOpen = false;
var openJumps = {};
var lastUpdated = (D && D.updated) || 0;
var currentName = null;
function getNameParam(){return (new URLSearchParams(location.search).get('name')||'').trim()}
function goName(name){var n=(name||'').trim();if(!n)return;location.search='?name='+encodeURIComponent(n)}
function userData(name){
  if(!D||!D.users)return null;
  if(D.users[name])return D.users[name];
  var keys=Object.keys(D.users);
  for(var i=0;i<keys.length;i++){if(keys[i].toLowerCase()===name.toLowerCase())return D.users[keys[i]]}
  return null;
}
function resolveName(name){
  if(!D||!D.users)return name;
  if(D.users[name])return name;
  var keys=Object.keys(D.users);
  for(var i=0;i<keys.length;i++){if(keys[i].toLowerCase()===name.toLowerCase())return keys[i]}
  return name;
}
function renderHome(){
  $('homeView').style.display='';
  $('dashView').style.display='none';
  document.title='RWPH Tracker';
}
function renderDash(name){
  var u=userData(name);
  if(!u){renderHome();$('searchErr').style.display='block';$('searchInput').value=name;return}
  currentName=resolveName(name);
  $('homeView').style.display='none';
  $('dashView').style.display='';
  document.title=currentName+' · RWPH';
  var J=u.jumps||{total:0,j10:0,j20:0,j30:0,hours:{}};
  var H=u.hours||{};
  var nowKey=kst(Date.now()).slice(0,13);
  var ss=D.season&&D.season.start?new Date(D.season.start+'Z').getTime():null;
  var se=D.season&&D.season.end?new Date(D.season.end+'Z').getTime():null;
  $('sub').textContent=currentName+(ss?'  ·  Season '+fmt(ss)+' ~ '+fmt(se)+' (KST)':'');
  var keys=Object.keys(H).sort().slice(-24);
  var gain=keys.reduce(function(s,k){return s+(H[k].gain||0)},0);
  var best=keys.reduce(function(b,k){return (b==null||(H[k].count||0)>(H[b].count||0))?k:b},null);
  var cards=[
    ['Last wave',u.lastWave==null?'-':nf(u.lastWave)],
    ['24h Total','+'+nf(gain)+' wave'],
    ['Best hour',best?best.slice(11,13)+':00 ['+nf(H[best].count)+']':'-'],
    ['Updated (KST)',D.updated?kst(D.updated).replace('T',' ').slice(5,19):'-']
  ];
  var cardsEl=$('cards');cardsEl.innerHTML='';
  cards.forEach(function(c){var d=document.createElement('div');d.className='card';d.innerHTML='<div class="l">'+c[0]+'</div><div class="v">'+c[1]+'</div>';cardsEl.appendChild(d)});
  var jc=document.createElement('div');jc.className='card click';
  jc.innerHTML='<div class="l">Season total JUMP</div><div class="v">'+nf(J.total)+'</div><div class="hint">Click for 10/20/30 breakdown</div>';
  jc.onclick=function(){seasonOpen=!seasonOpen;$('seasonPanel').classList.toggle('open',seasonOpen)};
  cardsEl.appendChild(jc);
  $('seasonPanel').classList.toggle('open',seasonOpen);
  $('seasonPanel').onclick=function(){seasonOpen=false;$('seasonPanel').classList.remove('open')};
  var tiersEl=$('tiers');tiersEl.innerHTML='';
  [['10 Jump (10–12)',J.j10],['20 Jump (20–22)',J.j20],['30 Jump (30–32)',J.j30]].forEach(function(t){
    var d=document.createElement('div');d.className='tier';d.innerHTML='<b>'+nf(t[1]||0)+'</b><span>'+t[0]+'</span>';tiersEl.appendChild(d);
  });
  var jk=Object.keys(J.hours||{}).sort().reverse();
  $('seasonRows').innerHTML=jk.length?jk.map(function(k){var h=J.hours[k];return '<tr><td>'+label(k)+'</td><td class="n">'+(h.j10||0)+'</td><td class="n">'+(h.j20||0)+'</td><td class="n">'+(h.j30||0)+'</td><td class="n"><b>'+((h.j10||0)+(h.j20||0)+(h.j30||0))+'</b></td></tr>'}).join(''):'<tr><td colspan="5" class="jnone">No jumps this season</td></tr>';
  var tb=$('rows');tb.innerHTML='';
  keys.slice().reverse().forEach(function(k){
    var h=H[k]||{count:0,gain:0};var jh=(J.hours&&J.hours[k])||{j10:0,j20:0,j30:0};var jt=(jh.j10||0)+(jh.j20||0)+(jh.j30||0);
    var tr=document.createElement('tr');if(k===nowKey)tr.className='now';
    tr.innerHTML='<td>'+label(k)+(k===nowKey?'<span class="badge">NOW</span>':'')+'</td><td class="n">'+nf(h.count||0)+'</td><td class="n">+'+nf(h.gain||0)+'</td><td class="n">'+(jt?'<span class="jbtn">'+jt+'</span>':'<span class="jnone">-</span>')+'</td>';
    tb.appendChild(tr);
    if(jt){var dt=document.createElement('tr');dt.className='detail';dt.style.display=openJumps[k]?'':'none';
      dt.innerHTML='<td colspan="4">10 Jump <b>'+(jh.j10||0)+'</b> &nbsp;·&nbsp; 20 Jump <b>'+(jh.j20||0)+'</b> &nbsp;·&nbsp; 30 Jump <b>'+(jh.j30||0)+'</b></td>';tb.appendChild(dt);
      tr.querySelector('.jbtn').onclick=function(){openJumps[k]=!openJumps[k];dt.style.display=openJumps[k]?'':'none'};
    }
  });
  var P=(u.past||[]).slice().reverse();
  if(P.length){$('pastWrap').style.display='';$('pastRows').innerHTML=P.map(function(p){return '<tr><td>'+fmt(new Date(p.start+'Z').getTime())+' ~ '+fmt(new Date(p.end+'Z').getTime())+'</td><td class="n"><b>'+nf(p.total)+'</b></td></tr>'}).join('')}
  else{$('pastWrap').style.display='none'}
}
function render(){var name=getNameParam();if(!name){renderHome();return}renderDash(name)}
function refreshData(){
  fetch('data/state.json?t='+Date.now(),{cache:'no-store'})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()})
    .then(function(json){if(!json)return;if((json.updated||0)<=lastUpdated)return;lastUpdated=json.updated||0;D=json;render()})
    .catch(function(){});
}
$('searchForm').onsubmit=function(e){
  e.preventDefault();
  var n=($('searchInput').value||'').trim();if(!n)return;
  if(D&&D.users&&!userData(n)){$('searchErr').style.display='block';return}
  goName(n);
};
render();
setInterval(refreshData,30000);
</script>
</body>
</html>
`;

function render() {
  const data = JSON.stringify({
    season: state.season,
    updated: Date.now(),
    users: state.users,
  }).replace(/</g, '\\u003c');

  fs.writeFileSync(
    'index.html',
    HTML_TEMPLATE
      .replace('/*DATA*/null', () => data)
      .replace('/*ISSUES_URL*/', ISSUES_URL)
  );
}


// 평속 랭킹 스냅샷: KST 시간대별 wave 증가량(gain)을 기준으로 순위를 매긴다.
const rankFileName = (hour) => `${hour.slice(0, 10)}-${hour.slice(11, 13)}.json`;

function saveRankSnapshot(hour) {
  if (!hour || !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hour)) return false;
  fs.mkdirSync(RANK_DIR, { recursive: true });
  const file = `${RANK_DIR}/${rankFileName(hour)}`;
  // 과거 기록은 절대 덮어쓰지 않는다.
  if (fs.existsSync(file)) return false;

  const rows = Object.entries(state.users || {}).map(([nick, u]) => {
    const h = (u.hours || {})[hour] || { gain: 0, count: 0 };
    return {
      nick,
      speed: Number(h.gain) || 0,
      waveChanges: Number(h.count) || 0,
      lastWave: u.lastWave == null ? null : Number(u.lastWave)
    };
  }).sort((a, b) => b.speed - a.speed || a.nick.localeCompare(b.nick));

  rows.forEach((r, i) => { r.rank = i + 1; });
  const payload = {
    hour,
    timezone: 'Asia/Seoul',
    metric: 'wave gain during this hour',
    savedAt: new Date().toISOString(),
    rankings: rows
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');

  let hours = [];
  try {
    const old = JSON.parse(fs.readFileSync(RANK_INDEX, 'utf8'));
    if (Array.isArray(old.hours)) hours = old.hours;
  } catch {}
  if (!hours.includes(hour)) hours.push(hour);
  hours.sort();
  fs.writeFileSync(RANK_INDEX, JSON.stringify({
    updatedAt: new Date().toISOString(),
    hours
  }, null, 2) + '\n');
  console.log('rank snapshot saved:', file);
  return true;
}

function snapshotCurrentHourAt55() {
  const now = new Date(Date.now() + 9 * 3600e3);
  // KST 기준 매시 55분부터 현재 시간대 기록을 한 번 저장한다.
  // 파일이 이미 존재하면 saveRankSnapshot이 덮어쓰지 않는다.
  if (now.getUTCMinutes() < 55) return;
  saveRankSnapshot(hourKey(Date.now()));
}

function save() {
  state.updated = Date.now();

  for (const name of Object.keys(state.users)) {
    const u = state.users[name];
    const keys = Object.keys(u.hours || {}).sort();

    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_HOURS))) {
      delete u.hours[k];
    }

    if (u.jumps && u.jumps.hours) {
      const jk = Object.keys(u.jumps.hours).sort();

      for (const k of jk.slice(0, Math.max(0, jk.length - MAX_HOURS))) {
        delete u.jumps.hours[k];
      }
    }
  }

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  render();
}

// 기존 추적 job용: 상태 저장 및 index.html 생성 유지
function commit(msg) {
  save();
  ensureRankHtml();

  try {
    execSync('git add index.html data/state.json user.txt');

    // rankdata는 존재할 때만 추가
    if (fs.existsSync(RANK_DIR)) {
      execSync('git add -A -- rankdata');
    }

    // ensureRankHtml()이 생성한 rank 페이지 추가
    execSync('git add -A -- rank');

    if (!execSync('git status --porcelain').toString().trim()) {
      return;
    }

    const m = (msg || 'chore: update rwph [skip ci]')
      .replace(/"/g, '\\"');

    execSync('git commit -m "' + m + '"');

    try {
      execSync('git pull --rebase --autostash', {
        stdio: 'ignore'
      });
    } catch {}

    execSync('git push', { stdio: 'ignore' });

    console.log('committed', new Date().toISOString());
  } catch (e) {
    console.error('commit failed', e.message);
  }
}
// register job 전용: user.txt만 커밋
// save()와 render()를 호출하지 않는다.
function commitUsersFile(msg) {
  try {
    execSync('git add -- user.txt');

    const m = (msg || 'chore: update user.txt')
      .replace(/"/g, '\\"');

    execSync('git commit -m "' + m + '" -- user.txt');

    try {
      execSync('git pull --rebase --autostash', { stdio: 'ignore' });
    } catch {}

    execSync('git push', { stdio: 'inherit' });

    console.log('user.txt committed', new Date().toISOString());
  } catch (e) {
    console.error('user.txt commit failed', e.message);
  }
}

async function fetchPlayer(nick) {
  const url =
    'https://raongames.com/growcastle/restapi/season/now/players/' +
    encodeURIComponent(nick);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000)
  });

  if (!res.ok) throw new Error('HTTP ' + res.status);

  return res.json();
}

async function tick() {
  // KST 기준 매시 55분 이후 현재 시간대 기록을 저장한다. API 오류와 무관하게 실행한다.
  snapshotCurrentHourAt55();
  const names = readUsers();

  if (!names.length) return;

  const results = await Promise.all(
    names.map(async (nick) => {
      try {
        return { nick, json: await fetchPlayer(nick) };
      } catch (e) {
        console.error('fetch fail', nick, e.message);
        return { nick, json: null };
      }
    })
  );

  let anyOk = false;
  let seasonDate = null;

  for (const { nick, json } of results) {
    if (!json || json.code !== 200 || !json.result) continue;

    anyOk = true;

    const sd = json.result.date;

    if (sd && sd.start && sd.end) {
      seasonDate = sd;
    }

    const me =
      (json.result.list || []).find((p) => p.nick === nick) ||
      (json.result.list || [])[0];

    if (!me) continue;

    let u = state.users[nick];

    if (!u) {
      u = state.users[nick] = {
        lastWave: null,
        hours: {},
        jumps: newJumps(),
        past: []
      };
    }

    u.jumps ??= newJumps();
    u.jumps.hours ??= {};
    u.hours ??= {};
    u.past ??= [];

    const wave = Number(me.wave) || 0;
    const k = hourKey(Date.now());

    if (u.lastWave != null && wave > u.lastWave) {
      const diff = wave - u.lastWave;

      const h = (u.hours[k] ??= {
        count: 0,
        gain: 0
      });

      h.count += 1;
      h.gain += diff;

      const t = tierOf(diff);

      if (t) {
        const jh = (u.jumps.hours[k] ??= {
          j10: 0,
          j20: 0,
          j30: 0
        });

        jh['j' + t] += 1;
        u.jumps['j' + t] += 1;
        u.jumps.total += 1;

        console.log(
          'JUMP ' + nick + ' +' + diff + ' (' + t + ')',
          new Date().toISOString()
        );
      }
    }

    u.hours[k] ??= { count: 0, gain: 0 };
    u.lastWave = wave;
  }

  if (!anyOk) {
    console.log('all player fetches failed — keeping previous state');
    return;
  }

  if (
    seasonDate &&
    seasonDate.start &&
    seasonDate.end &&
    (
      state.season.start !== seasonDate.start ||
      state.season.end !== seasonDate.end
    )
  ) {
    if (state.season.start) {
      console.log('season changed', state.season, '->', seasonDate);

      for (const name of Object.keys(state.users)) {
        const u = state.users[name];

        u.past = u.past || [];

        u.past.push({
          start: state.season.start,
          end: state.season.end,
          total: (u.jumps && u.jumps.total) || 0
        });

        u.past = u.past.slice(-MAX_PAST);
        u.jumps = newJumps();
        u.hours = {};
        u.lastWave = null;
      }
    }

    state.season = {
      start: seasonDate.start,
      end: seasonDate.end
    };
  }

  const set = new Set(names);

  for (const name of Object.keys(state.users)) {
    if (!set.has(name)) {
      console.log('remove user from state', name);
      delete state.users[name];
    }
  }
}

function dispatchNext(at) {
  try {
    execSync(
      'gh workflow run rwph.yml --ref ' +
      (process.env.GITHUB_REF_NAME || 'main') +
      ' -f handoff_at=' + at,
      { stdio: 'inherit' }
    );

    console.log(
      'next run dispatched, handoff at',
      new Date(at).toISOString()
    );
  } catch (e) {
    console.error(
      'dispatch failed (cron backup will recover)',
      e.message
    );
  }
}

async function handleIssueRegister() {
  const body = (process.env.ISSUE_BODY || '').trim();
  const issueNumber = process.env.ISSUE_NUMBER;

  // 원격 최신 내용을 가져온 뒤 user.txt를 읽는다.
  try {
    execSync('git pull --rebase --autostash', {
      stdio: 'ignore'
    });
  } catch {}

  // 기존 추적 상태는 읽을 수 있지만 register에서 저장하거나 수정하지 않는다.
  load();

  // Issue 제목은 무시하고 본문에서 닉네임만 가져온다.
  const rawLines = body
    .split(/\r?\n/)
    .map((s) =>
      s
        .replace(/^\[.*?\]\s*/, '')
        .replace(/^[-*•]\s+/, '')
        .trim()
    )
    .filter(Boolean)
    .filter(
      (s) =>
        s.length <= 40 &&
        !/^https?:\/\//i.test(s) &&
        !/^#+\s/.test(s)
    );

  const seen = new Set();
  const nicks = [];

  for (const n of rawLines) {
    const key = n.toLowerCase();

    if (seen.has(key) || BLOCKED_NICKS.has(key)) continue;

    seen.add(key);
    nicks.push(n);
  }

  if (!nicks.length) {
    console.log('empty nick');

    if (issueNumber) {
      try {
        execSync(
          'gh issue comment ' + issueNumber +
          ' --body "Put player names in the issue **body**, one per line (title is ignored)."',
          { stdio: 'inherit' }
        );

        execSync(
          'gh issue close ' + issueNumber,
          { stdio: 'inherit' }
        );
      } catch {}
    }

    return;
  }

  const users = readUsers();
  const ok = [];
  const already = [];
  const fail = [];

  for (const nick of nicks) {
    let json;

    try {
      json = await fetchPlayer(nick);
    } catch (e) {
      console.error('api error', nick, e.message);
      fail.push(nick + ' (API: ' + e.message + ')');
      continue;
    }

    if (
      json.code !== 200 ||
      !(
        json.result &&
        json.result.list &&
        json.result.list.length
      )
    ) {
      console.log('not found', nick, json.code);
      fail.push(nick + ' (code ' + json.code + ')');
      continue;
    }

    const apiNick =
      (
        json.result.list.find((p) => p.nick === nick) ||
        json.result.list[0]
      ).nick || nick;

    if (
      users.some(
        (u) => u.toLowerCase() === apiNick.toLowerCase()
      )
    ) {
      console.log('already registered', apiNick);
      already.push(apiNick);
      continue;
    }

    // register job에서는 state.users를 수정하지 않는다.
    users.push(apiNick);
    ok.push(apiNick);

    console.log('registered', apiNick);
  }

  // 등록 성공 시 user.txt만 수정하고 커밋한다.
  if (ok.length) {
    fs.writeFileSync(
      USERS_FILE,
      users.join('\n') + '\n'
    );

    commitUsersFile(
      'chore: register ' +
      (
        ok.length === 1
          ? 'user ' + ok[0]
          : ok.length + ' users'
      ) +
      ' [skip ci]'
    );
  }

  // GitHub Issue 결과 댓글 작성은 유지한다.
  if (issueNumber) {
    const lines = [];

    if (ok.length) {
      lines.push(
        '**Registered**\n' +
        ok.map((n) =>
          '- `' + n + '` → ?name=' + encodeURIComponent(n) +
          '\n  [Direct](https://reynrule.github.io/api/?name=' + encodeURIComponent(n) + ')'
        ).join('\n')
      );
    }

    if (already.length) {
      lines.push(
        '**Already registered**\n' +
        already.map((n) =>
          '- `' + n + '`\n  [Direct](https://reynrule.github.io/api/?name=' + encodeURIComponent(n) + ')'
        ).join('\n')
      );
    }

    if (fail.length) {
      lines.push(
        '**Failed**\n' +
        fail.map((n) => '- ' + n).join('\n')
      );
    }

    const bodyMsg = lines.join('\n\n') || 'Nothing to process.';

    try {
      fs.writeFileSync('/tmp/issue-comment.md', bodyMsg);

      execSync(
        'gh issue comment ' + issueNumber +
        ' --body-file /tmp/issue-comment.md',
        { stdio: 'inherit' }
      );

      execSync(
        'gh issue close ' + issueNumber,
        { stdio: 'inherit' }
      );
    } catch {}
  }
}

(async () => {
  // register job은 일반 추적 루프에 진입하지 않는다.
  if (process.env.MODE === 'register') {
    await handleIssueRegister();
    return;
  }

  const isCron = process.env.GITHUB_EVENT_NAME === 'schedule';

  if (
    isCron &&
    !HANDOFF_AT &&
    Date.now() - (state.updated || 0) < 10 * 60 * 1000
  ) {
    console.log('Another job is already running — exiting.');
    return;
  }

  let start = Date.now();

  if (HANDOFF_AT) {
    start = HANDOFF_AT;

    await sleep(Math.max(0, HANDOFF_AT - Date.now()));

    for (let i = 0; i < 40; i++) {
      try {
        execSync('git pull --rebase --autostash', {
          stdio: 'ignore'
        });

        load();
      } catch {}

      if ((state.updated || 0) >= HANDOFF_AT - 2000) break;

      await sleep(1000);
    }
  }

  const end = start + RUN_MS;

  let lastCommit = Date.now();
  let next = Date.now();
  let dispatched = false;

  await tick();
  save();

  while (Date.now() < end) {
    await tick();

    if (
      !dispatched &&
      process.env.GITHUB_ACTIONS &&
      Date.now() >= end - 120000
    ) {
      dispatched = true;
      dispatchNext(end);
    }

    if (Date.now() - lastCommit >= COMMIT_EVERY_MS) {
      commit();
      lastCommit = Date.now();
    }

    next += 1000;

    await sleep(Math.max(0, next - Date.now()));
  }

  commit();
})();
