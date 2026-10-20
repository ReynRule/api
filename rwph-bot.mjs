// RWPH Discord bot — /register, /rwph, /skip, /part
// Runs on GitHub Actions inside the tracker repo (needs user.txt + data/state.json + data/part.json).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
} from 'discord.js';

const USERS_FILE = 'user.txt';
const PLAYER_API = 'https://raongames.com/growcastle/restapi/season/now/players/';
const WEB_URL = process.env.WEB_URL ?? 'https://reynrule.github.io/api/';
const MAX_USERS = Number(process.env.MAX_USERS) || 500;   // safety cap on user.txt
const REGISTER_COOLDOWN_MS = 30_000;                      // per Discord user
const PART_WINDOW_MS = 60 * 60_000;                       // /part rolling window (1 hour)
const BLOCKED_NICKS = new Set([
  'title', 'body', 'register users', 'register user', 'register', 'user', 'users',
]);

/* ------------------------------------------------------------------ *
 * Time helpers — hour buckets run :55 → next :55 KST (key "T14" = 14:55~15:55)
 * ------------------------------------------------------------------ */
const HOUR_OFFSET = 55 * 60_000;
const pad = n => String(n).padStart(2, '0');
const nf = n => Number(n || 0).toLocaleString('en-US');
const kst = ms => new Date(ms + 9 * 3_600_000).toISOString();
export const hourKey = ms => kst(ms - HOUR_OFFSET).slice(0, 13);
const fmtMs = ms => kst(ms).replace('T', ' ').slice(0, 16);
const fmtShort = ms => fmtMs(ms).slice(5);                // "MM-DD HH:mm"
const fmtIso = s => fmtMs(Date.parse(`${s}Z`));          // season dates are UTC
// short label for mobile: "10-20 14:55~15:55"
const label = k => {
  const hh = Number(k.slice(11, 13));
  return `${k.slice(5, 10)} ${k.slice(11, 13)}:55~${pad((hh + 1) % 24)}:55`;
};
const seasonLine = s =>
  s?.start && s?.end ? `Season ${fmtIso(s.start)} ~ ${fmtIso(s.end)} (KST)` : '';
const jumpSum = j => (j?.j10 || 0) + (j?.j20 || 0) + (j?.j30 || 0);
const tierOf = d => {
  if (d >= 10 && d <= 12) return 10;
  if (d >= 20 && d <= 22) return 20;
  if (d >= 30 && d <= 32) return 30;
  return 0;
};

/* ------------------------------------------------------------------ *
 * Mobile-friendly text helpers
 * (no padded code blocks — they scroll sideways / break on phones)
 * ------------------------------------------------------------------ */
const esc = s => String(s).replace(/([\\*_~`|>])/g, '\\$1');
const clip = (s, max = 3000) =>
  s.length <= max ? s : s.slice(0, max - 20).replace(/\n[^\n]*$/, '') + '\n…';
const NO_PING = { parse: [] };

/* ------------------------------------------------------------------ *
 * Message builders (same data as the web dashboard)
 * ------------------------------------------------------------------ */
export function findUser(state, name) {
  const users = state?.users ?? {};
  if (users[name]) return [name, users[name]];
  const k = Object.keys(users).find(n => n.toLowerCase() === name.toLowerCase());
  return k ? [k, users[k]] : null;
}

export function buildRwph(state, name, u, now = Date.now()) {
  const J = u.jumps ?? { total: 0, hours: {} };
  const H = u.hours ?? {};
  const nowKey = hourKey(now);
  const keys = Object.keys(H).sort().slice(-24);
  const gain = keys.reduce((s, k) => s + (H[k].gain || 0), 0);
  const best = keys.reduce(
    (b, k) => (b == null || (H[k].count || 0) > (H[b].count || 0) ? k : b), null);

  const rows = keys.slice().reverse().map(k => {
    const h = H[k] ?? { count: 0, gain: 0 };
    const jt = jumpSum(J.hours?.[k]);
    return `**${label(k)}**${k === nowKey ? ' 🟢 NOW' : ''}\n`
      + `└ RWPH \`${nf(h.count)}\` · wave \`+${nf(h.gain)}\` · JUMP \`${jt || '-'}\``;
  });

  const lines = [`**${esc(name)}**`];
  if (seasonLine(state.season)) lines.push(seasonLine(state.season));
  lines.push(
    `Last wave **${u.lastWave == null ? '-' : nf(u.lastWave)}**`,
    `24h total **+${nf(gain)} wave**`,
    `Best hour **${best ? `${best.slice(11, 13)}:55 [${nf(H[best].count)}]` : '-'}**`,
    `Season JUMP **${nf(J.total)}**`,
  );
  if (state.updated) lines.push(`Data updated <t:${Math.floor(state.updated / 1000)}:R>`);

  return {
    content: lines.join('\n'),
    embeds: [new EmbedBuilder().setColor(0x58a6ff).setTitle('Last 24 hours')
      .setDescription(rows.length ? clip(rows.join('\n')) : 'No hourly data yet.')],
  };
}

export function buildSkip(state, name, u) {
  const J = u.jumps ?? { total: 0, j10: 0, j20: 0, j30: 0, hours: {} };
  const lines = [`**${esc(name)}**`];
  if (seasonLine(state.season)) lines.push(seasonLine(state.season));
  lines.push(
    `**Season jump details** — Total **${nf(J.total)}**`,
    `10 Jump (10–12): **${nf(J.j10)}**`,
    `20 Jump (20–22): **${nf(J.j20)}**`,
    `30 Jump (30–32): **${nf(J.j30)}**`,
  );
  if (state.updated) lines.push(`Data updated <t:${Math.floor(state.updated / 1000)}:R>`);

  const jk = Object.keys(J.hours ?? {}).sort().reverse();
  const rows = jk.map(k => {
    const h = J.hours[k];
    return `**${label(k)}**\n`
      + `└ 10 \`${h.j10 || 0}\` · 20 \`${h.j20 || 0}\` · 30 \`${h.j30 || 0}\` · Total \`${jumpSum(h)}\``;
  });
  const embeds = [new EmbedBuilder().setColor(0xf0883e).setTitle('Jumps by hour')
    .setDescription(jk.length ? clip(rows.join('\n'), 2800) : 'No jumps this season.')];

  const past = [...(u.past ?? [])].reverse();
  if (past.length) {
    const pr = past.map(p =>
      `**${fmtIso(p.start)} ~ ${fmtIso(p.end)}**\n└ Total jumps \`${nf(p.total)}\``);
    embeds.push(new EmbedBuilder().setColor(0x8b949e).setTitle('Past seasons')
      .setDescription(clip(pr.join('\n'), 2500)));
  }
  return { content: lines.join('\n'), embeds };
}

/**
 * /part — rolling window: (now - 1h) → now, minute precision.
 * Uses the dedicated event log (data/part.json): users[nick] = { since, ev: [[ms, waveDiff], ...] }
 */
export function buildPart(state, part, name, now = Date.now()) {
  const from = now - PART_WINDOW_MS;
  const pu = part?.users?.[name];

  const head = [
    `**${esc(name)}** · Rolling 1 hour`,
    `🕒 \`${fmtShort(from)}\` ~ \`${fmtShort(now)}\` (KST)`,
  ];

  if (!pu) {
    return {
      content: head.join('\n'),
      embeds: [new EmbedBuilder().setColor(0x8b949e).setTitle('No data yet')
        .setDescription('Minute-level tracking has not started for this player yet.\nTry again in a minute or two.')],
    };
  }

  let rwph = 0, gain = 0, j10 = 0, j20 = 0, j30 = 0;
  for (const [t, d] of pu.ev ?? []) {
    if (t <= from || t > now) continue;
    rwph += 1;
    gain += d;
    const tier = tierOf(d);
    if (tier === 10) j10++;
    else if (tier === 20) j20++;
    else if (tier === 30) j30++;
  }
  const jumps = j10 + j20 + j30;

  const desc = [
    `RWPH (wave count) **${nf(rwph)}**`,
    `wave+ **+${nf(gain)}**`,
    `JUMP total **${nf(jumps)}**`,
    `└ 10 \`${j10}\` · 20 \`${j20}\` · 30 \`${j30}\``,
  ];

  const embed = new EmbedBuilder().setColor(0x3fb950).setTitle('Last 60 minutes')
    .setDescription(desc.join('\n'));

  if (pu.since && pu.since > from + 2_000) {
    embed.setFooter({ text: `Tracking started ${fmtShort(pu.since)} KST — partial window` });
  }
  if (part?.updated) head.push(`Data updated <t:${Math.floor(part.updated / 1000)}:R>`);

  return { content: head.join('\n'), embeds: [embed] };
}

/* ------------------------------------------------------------------ *
 * JSON loading (fresh via GitHub API when running in Actions)
 * ------------------------------------------------------------------ */
const caches = new Map();
async function getJson(path, ttl, envUrl) {
  const hit = caches.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME || 'main';
  let data = null;

  if (!envUrl && repo && process.env.GITHUB_TOKEN) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
        headers: {
          Accept: 'application/vnd.github.raw+json',
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'User-Agent': 'rwph-discord-bot',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) data = await r.json();
    } catch (e) { console.error(`contents API failed (${path}):`, e.message); }
  }
  if (!data) {
    const url = envUrl ?? `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Failed to load ${path} (HTTP ${r.status})`);
      data = await r.json();
    } catch (e) {
      // remote file broken/unreachable: keep serving the last good copy
      if (hit) {
        console.error(`using stale ${path}:`, e.message);
        return hit.data;
      }
      throw new Error(`${path} is temporarily unavailable`);
    }
  }
  caches.set(path, { at: Date.now(), data });
  return data;
}
const getState = () => getJson('data/state.json', 20_000, process.env.STATE_URL);
const getPart = () => getJson('data/part.json', 10_000, process.env.PART_URL);

/* ------------------------------------------------------------------ *
 * /register — verify via game API, then append to user.txt and push
 * ------------------------------------------------------------------ */
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function readUsers() {
  try {
    return fs.readFileSync(USERS_FILE, 'utf8').split(/\r?\n/).map(s => s.trim())
      .filter(s => s.length >= 2 && s.length <= 40 && !BLOCKED_NICKS.has(s.toLowerCase()));
  } catch { return []; }
}

/** Returns 'added' | 'exists' | 'full'. Throws if the push ultimately fails. */
function addToUserFile(nick) {
  try { git('pull', '--rebase', '--autostash'); }
  catch (e) { console.error('git pull failed:', e.message); }

  const users = readUsers();
  if (users.some(u => u.toLowerCase() === nick.toLowerCase())) return 'exists';
  if (users.length >= MAX_USERS) return 'full';

  let txt = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf8') : '';
  if (txt && !txt.endsWith('\n')) txt += '\n';
  fs.writeFileSync(USERS_FILE, `${txt}${nick}\n`);

  git('add', '--', USERS_FILE);
  git('commit', '-m', `chore: register user ${nick.replace(/[\r\n]/g, ' ')} [skip ci]`, '--', USERS_FILE);

  // the tracker pushes every minute, so retry on non-fast-forward
  for (let i = 0; i < 5; i++) {
    try { git('push'); return 'added'; }
    catch (e) {
      console.error(`push attempt ${i + 1} failed:`, e.message);
      try { git('pull', '--rebase', '--autostash'); } catch {}
    }
  }
  try { git('reset', '--hard', 'HEAD~1'); } catch {}
  throw new Error('git push failed');
}

let queue = Promise.resolve();
const serialize = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

const cooldowns = new Map();

function cleanNick(raw) {
  const n = (raw ?? '').trim();
  if (n.length < 2 || n.length > 40) return null;
  if (/[\u0000-\u001f\u007f]/.test(n)) return null;
  if (BLOCKED_NICKS.has(n.toLowerCase())) return null;
  return n;
}

async function handleRegister(i) {
  const last = cooldowns.get(i.user.id) ?? 0;
  const wait = REGISTER_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) return i.editReply(`Please wait ${Math.ceil(wait / 1000)}s before registering again.`);

  const nick = cleanNick(i.options.getString('name', true));
  if (!nick) return i.editReply('Invalid name (2–40 characters, no line breaks).');
  cooldowns.set(i.user.id, Date.now());

  let json;
  try {
    const r = await fetch(PLAYER_API + encodeURIComponent(nick), { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } catch (e) {
    cooldowns.delete(i.user.id);
    return i.editReply(`Could not reach the game API (${e.message}). Try again later.`);
  }

  const list = json?.code === 200 ? (json.result?.list ?? []) : [];
  const exact = list.find(p => p.nick?.toLowerCase() === nick.toLowerCase());
  if (!exact) {
    const hint = list.slice(0, 5).map(p => `\`${p.nick}\``).join(', ');
    return i.editReply(`Player **${esc(nick)}** was not found in the current season.`
      + (hint ? `\nDid you mean: ${hint}?` : ''));
  }
  const apiNick = exact.nick;

  let result;
  try { result = await serialize(async () => addToUserFile(apiNick)); }
  catch (e) {
    console.error(e);
    cooldowns.delete(i.user.id);
    return i.editReply('Failed to save the registration (git error). Please try again.');
  }

  // <...> suppresses the link preview embed (keeps the reply short on mobile)
  const link = `<${WEB_URL}?name=${encodeURIComponent(apiNick)}>`;
  if (result === 'exists') {
    return i.editReply(`**${esc(apiNick)}** is already registered.\nUse \`/rwph name:${apiNick}\`\n${link}`);
  }
  if (result === 'full') return i.editReply(`The tracker is full (${MAX_USERS} users).`);
  return i.editReply(
    `Registered **${esc(apiNick)}** ✅\n`
    + `Tracking starts within ~1–2 minutes.\n`
    + `Then try \`/rwph name:${apiNick}\` or \`/part name:${apiNick}\`\n${link}`);
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */
const nameOpt = o => o.setName('name').setDescription('Player name').setRequired(true).setAutocomplete(true);
const commands = [
  new SlashCommandBuilder().setName('register')
    .setDescription('Register a player for RWPH tracking')
    .addStringOption(o => o.setName('name').setDescription('In-game player name').setRequired(true).setMaxLength(40)),
  new SlashCommandBuilder().setName('rwph')
    .setDescription('Last 24 hours of RWPH / wave+ / JUMP for a player')
    .addStringOption(nameOpt),
  new SlashCommandBuilder().setName('skip')
    .setDescription('Season jump details and past seasons for a player')
    .addStringOption(nameOpt),
  new SlashCommandBuilder().setName('part')
    .setDescription('RWPH and JUMP count for the last 60 minutes (rolling, minute precision)')
    .addStringOption(nameOpt),
].map(c => c.toJSON());

async function handle(i) {
  await i.deferReply(); // public reply
  if (i.commandName === 'register') return handleRegister(i);

  const state = await getState();
  const found = findUser(state, i.options.getString('name', true).trim());
  if (!found) {
    return i.editReply('That player is not registered.\nUse `/register name:<player>` first.');
  }
  const [name, u] = found;

  let payload;
  if (i.commandName === 'part') {
    let part = null;
    try { part = await getPart(); }
    catch (e) { console.error('part load failed:', e.message); }
    payload = buildPart(state, part, name);
  } else if (i.commandName === 'rwph') {
    payload = buildRwph(state, name, u);
  } else {
    payload = buildSkip(state, name, u);
  }
  return i.editReply({ ...payload, allowedMentions: NO_PING });
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const { DISCORD_TOKEN, CLIENT_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error('Missing DISCORD_TOKEN / CLIENT_ID environment variables.');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await new REST({ version: '10' }).setToken(DISCORD_TOKEN)
      .put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Global slash commands registered.');
    // Actions jobs max out at 6h: exit after 350 min, the queued run takes over
    const lifetime = Number(process.env.BOT_LIFETIME_MIN ?? 350) * 60_000;
    setTimeout(async () => {
      console.log('Lifetime reached, handing over to the next run.');
      await queue.catch(() => {});
      await client.destroy();
      process.exit(0);
    }, lifetime);
  });

  client.on('interactionCreate', async i => {
    try {
      if (i.isAutocomplete()) {
        const q = i.options.getFocused().toLowerCase();
        const state = await getState();
        return i.respond(Object.keys(state.users ?? {})
          .filter(n => n.toLowerCase().includes(q)).slice(0, 25)
          .map(n => ({ name: n.slice(0, 100), value: n.slice(0, 100) })));
      }
      if (i.isChatInputCommand()) await handle(i);
    } catch (e) {
      console.error(e);
      const msg = `Error: ${e.message}`;
      if (i.isRepliable()) (i.deferred || i.replied ? i.editReply(msg) : i.reply(msg)).catch(() => {});
    }
  });

  process.on('unhandledRejection', e => console.error('unhandledRejection', e));
  await client.login(DISCORD_TOKEN);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
