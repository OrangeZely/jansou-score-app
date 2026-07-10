/* ============================================================
   雀成績 — 雀荘実績記録アプリ
   データは全てブラウザ(localStorage)に保存されます。
   ============================================================ */

const STORE_KEY = 'jansou_v1';

/* ---------- データ層 ---------- */
const DB = {
  data: { parlors: [], sessions: [] },
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.data = JSON.parse(raw);
    } catch (e) { console.warn('load failed', e); }
    if (!this.data.parlors) this.data.parlors = [];
    if (!this.data.sessions) this.data.sessions = [];
    if (!this.data.updatedAt) this.data.updatedAt = 0;
  },
  save() {
    this.data.updatedAt = Date.now();
    localStorage.setItem(STORE_KEY, JSON.stringify(this.data));
    if (typeof Cloud !== 'undefined') Cloud.schedulePush();
  },
  parlor(id) { return this.data.parlors.find(p => p.id === id); },
  session(id) { return this.data.sessions.find(s => s.id === id); },
  activeSession() { return this.data.sessions.find(s => s.status === 'open'); },
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* 三麻/四麻ごとの既定値とウマのプリセット */
const MODE_DEFAULTS = {
  yonma: { startPts: 25000, returnPts: 30000, uma: [20, 10, -10, -20] },
  sanma: { startPts: 35000, returnPts: 40000, uma: [15, 0, -15] },
};
const UMA_PRESETS = {
  yonma: [
    { label: 'ウマなし', v: [0, 0, 0, 0] },
    { label: 'ゴットー 5-10', v: [10, 5, -5, -10] },
    { label: 'ワンツー 10-20', v: [20, 10, -10, -20] },
    { label: 'ワンスリー 10-30', v: [30, 10, -10, -30] },
  ],
  sanma: [
    { label: 'ウマなし', v: [0, 0, 0] },
    { label: '10-20', v: [20, 0, -20] },
    { label: '10-15', v: [15, 0, -15] },
    { label: '5-10', v: [10, 0, -10] },
  ],
};

/* 店(ルール)の対局人数。三麻=3人・四麻=4人 */
function playersOf(p) { return (p && p.mode === 'sanma') ? 3 : 4; }

/* デフォルトの店設定 */
function defaultParlor() {
  return {
    id: uid(),
    name: '',
    note: '',
    mode: 'yonma',       // 'yonma'(四麻) / 'sanma'(三麻)
    startPts: 25000,     // 配給原点
    returnPts: 30000,    // 返し点(基準点)
    ptPer1000: 1,        // 1000点あたりのpt(レート)
    uma: [20, 10, -10, -20], // 着順ごとの順位点(1000点単位)
    okaAuto: false,      // オカを1位に自動加算(既定はOFF)
    chipPt: 1,           // チップ1枚あたりのpt
    gameFee: 0,          // 半荘ごとのゲーム代(pt)
    topPrize: 0,         // トップ賞(pt)
  };
}

/* ---------- pt計算 ロジック ---------- */
/*
   1半荘のpt変動を計算する。
   place: 着順(1-4), score: 持ち点, chipDelta: チップ増減枚数
*/
function calcHanchanPt(parlor, place, score, chipDelta) {
  const p = parlor;
  const soten = (score - p.returnPts) / 1000;               // 素点(1000点単位)
  const oka = (p.okaAuto && place === 1)
    ? (p.returnPts - p.startPts) * playersOf(p) / 1000 : 0; // オカ(1000点単位・×人数)
  const uma = p.uma[place - 1] || 0;                         // 順位点(1000点単位)
  const scorePt = (soten + oka + uma) * p.ptPer1000;         // 点数由来のpt
  const chipPt = chipDelta * p.chipPt;                       // チップpt
  const topPt = (place === 1) ? -(p.topPrize || 0) : 0;      // トップ賞(1位が支払う=減点)
  const fee = p.gameFee || 0;                                // ゲーム代
  const total = scorePt + chipPt + topPt - fee;
  return {
    soten, oka, uma, scorePt, chipPt, topPt, fee,
    total: Math.round(total * 100) / 100,
  };
}

function sessionDeposit(session) {
  return session.hanchans.reduce((s, h) => s + h.total, 0);
}

/* ---------- 画面ルーティング ---------- */
let route = { name: 'home', param: null };
const app = document.getElementById('app');

/* プレイ中の経過時間を更新するタイマー */
let _tick = null;
function stopTick() { if (_tick) { clearInterval(_tick); _tick = null; } }
function updateSessionTime(sid) {
  const s = DB.session(sid);
  const el = document.getElementById('elapsedTime');
  if (!s || s.status !== 'open' || !el) { stopTick(); return; }
  const ms = Date.now() - s.startedAt;
  el.textContent = fmtDuration(ms);
  const hr = document.getElementById('hourlyRate');
  if (hr) { const h = hourlyPt(sessionDeposit(s), ms); hr.textContent = h == null ? '—' : `${fmtPt(h)}`; }
}

function nav(name, param = null) {
  stopTick();
  route = { name, param };
  render();
  document.querySelectorAll('#tabbar .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.nav === name);
  });
  window.scrollTo(0, 0);
}
document.querySelectorAll('#tabbar .tab').forEach(t => {
  t.addEventListener('click', () => nav(t.dataset.nav));
});

/* ---------- 便利関数 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPt = (n) => (n > 0 ? '+' : '') + (Math.round(n * 100) / 100).toLocaleString('ja-JP');
const clsPt = (n) => n > 0 ? 'pos' : (n < 0 ? 'neg' : '');
const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const fmtDuration = (ms) => {
  const min = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
};
/* pt時給。1時間未満は獲得ptそのまま、1時間以上は1時間あたりのptにする */
const hourlyPt = (pt, ms) => {
  const hours = ms / 3600000;
  if (hours < 1) return pt;
  return Math.round(pt / hours);
};

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

/* ============================================================
   画面レンダリング
   ============================================================ */
function render() {
  const map = { home: viewHome, parlors: viewParlors, parlorEdit: viewParlorEdit,
    session: viewSession, stats: viewStats, sessionDetail: viewSessionDetail,
    editHanchan: viewEditHanchan, account: viewAccount };
  (map[route.name] || viewHome)();
}

/* ---------- ホーム ---------- */
function viewHome() {
  const active = DB.activeSession();
  const recent = DB.data.sessions
    .filter(s => s.status === 'closed')
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);

  let html = `<div class="page-head"><div><h1>雀荘成績管理</h1><div class="sub">雀荘の実績を記録</div></div></div>`;

  if (active) {
    const par = DB.parlor(active.parlorId);
    const dep = sessionDeposit(active);
    html += `
      <div class="card tap" onclick="nav('session','${active.id}')" style="border-color:var(--green)">
        <div class="row"><span class="pill" style="border-color:var(--green);color:var(--accent)">🔴 プレイ中</span>
          <span class="muted small">${esc(par ? par.name : '?')}</span></div>
        <div class="deposit-wrap">
          <div class="deposit-label">現在のデポジット</div>
          <div class="deposit-val ${clsPt(dep)}">${fmtPt(dep)}<span class="unit">pt</span></div>
          <div class="muted small">${active.hanchans.length} 半荘 • タップして続ける</div>
        </div>
      </div>`;
  } else {
    html += `<button class="btn accent" onclick="startSessionFlow()">＋ 新しい来店を始める</button>
             <div class="fab-note">店を選んで記録スタート</div>`;
  }

  html += `<h2 style="font-size:15px;color:var(--muted);margin:22px 0 10px">履歴</h2>`;
  if (recent.length === 0) {
    html += `<div class="empty"><div class="em-ic">🀫</div><div>まだ記録がありません</div></div>`;
  } else {
    for (const s of recent) {
      const par = DB.parlor(s.parlorId);
      const dep = sessionDeposit(s);
      html += `
        <div class="card tap" onclick="nav('sessionDetail','${s.id}')">
          <div class="row">
            <div>
              <div style="font-weight:700">${esc(par ? par.name : '削除された店')}</div>
              <div class="muted small">${fmtDate(s.startedAt)} • ${s.hanchans.length}半荘</div>
            </div>
            <div class="deposit-val ${clsPt(dep)}" style="font-size:26px">${fmtPt(dep)}<span class="unit">pt</span></div>
          </div>
        </div>`;
    }
  }
  app.innerHTML = html;
}

/* ---------- 来店開始フロー ---------- */
function startSessionFlow() {
  if (DB.data.parlors.length === 0) {
    toast('先に店を登録してください');
    nav('parlorEdit', 'new');
    return;
  }
  // 店選択
  let html = `<div class="page-head"><button class="back-btn" onclick="nav('home')">‹</button><h1>店を選ぶ</h1></div>`;
  for (const p of DB.data.parlors) {
    html += `<div class="card tap" onclick="doStartSession('${p.id}')">
      <div class="row"><div style="font-weight:700;font-size:17px">${esc(p.name)}</div>
        <span class="pill" style="border-color:var(--green);color:var(--accent)">${p.mode === 'sanma' ? '三麻' : '四麻'}</span></div>
      <div class="muted small" style="margin-top:4px">${umaLabel(p)} • レート${p.ptPer1000} • チップ${p.chipPt}pt</div>
    </div>`;
  }
  html += `<button class="btn ghost" onclick="nav('parlorEdit','new')">＋ 店を追加</button>`;
  app.innerHTML = html;
}

function doStartSession(parlorId) {
  const s = {
    id: uid(), parlorId, status: 'open',
    startedAt: Date.now(), hanchans: [], liveChips: 0,
  };
  DB.data.sessions.push(s);
  DB.save();
  nav('session', s.id);
}

/* ---------- セッション(プレイ)画面 ---------- */
function viewSession() {
  const s = DB.session(route.param);
  if (!s) return nav('home');
  const par = DB.parlor(s.parlorId);
  const dep = sessionDeposit(s);
  const ss = s._entry || {}; // 一時入力状態

  let html = `
    <div class="page-head">
      <button class="back-btn" onclick="nav('home')">‹</button>
      <div><h1 style="font-size:19px">${esc(par ? par.name : '?')}</h1>
      <div class="sub">${par.mode === 'sanma' ? '三麻' : '四麻'} • ${umaLabel(par)} • ${s.hanchans.length}半荘目</div></div>
    </div>

    <div class="card">
      <div class="deposit-wrap">
        <div class="deposit-label">デポジット (累計収支)</div>
        <div class="deposit-val ${clsPt(dep)}">${fmtPt(dep)}<span class="unit">pt</span></div>
      </div>
      <div class="time-row">
        <div><div class="k">経過時間</div><div class="v mono" id="elapsedTime">${fmtDuration(Date.now() - s.startedAt)}</div></div>
        <div><div class="k">pt時給</div><div class="v mono" id="hourlyRate">${(() => { const h = hourlyPt(dep, Date.now() - s.startedAt); return h == null ? '—' : fmtPt(h); })()}</div></div>
      </div>
    </div>

    <div class="card chip-panel">
      <div class="deposit-label">この半荘のチップ増減</div>
      <div class="chip-count ${clsPt(s.liveChips)}">${s.liveChips > 0 ? '+' : ''}${s.liveChips}</div>
      <div class="muted small">1枚 = ${par.chipPt}pt</div>
      <div class="chip-btns">
        <button class="chip-btn minus" onclick="chipDelta('${s.id}',-1)">−</button>
        <button class="chip-btn plus" onclick="chipDelta('${s.id}',1)">＋</button>
      </div>
    </div>

    <div class="card">
      <div class="lbl" style="color:var(--muted);font-size:13px;margin-bottom:8px">着順</div>
      <div class="rank-grid" id="rankGrid" style="grid-template-columns:repeat(${playersOf(par)},1fr)">
        ${Array.from({ length: playersOf(par) }, (_, i) => i + 1).map(r => `<button class="rank-btn ${ss.place === r ? 'sel' : ''}" onclick="setEntry('${s.id}','place',${r})">${r}<small>位</small></button>`).join('')}
      </div>
      <label class="field" style="margin-top:14px">
        <span class="lbl">最終持ち点</span>
        <input class="score-input mono" type="number" inputmode="numeric" id="scoreInput"
          placeholder="例: 32000" value="${ss.score ?? ''}"
          oninput="setEntry('${s.id}','score',this.value,true)">
      </label>
      ${entryPreview(par, ss, s.liveChips)}
      <button class="btn accent" style="margin-top:6px" onclick="confirmHanchan('${s.id}')">この半荘を確定 ▸</button>
    </div>
  `;

  if (s.hanchans.length) {
    html += `<div class="card"><div class="row"><b>記録した半荘</b><span class="muted small">タップで編集</span></div>`;
    s.hanchans.slice().reverse().forEach((h, i) => {
      const idx = s.hanchans.length - 1 - i;
      html += hanchanRow(h, idx + 1, s.id, idx, 'session');
    });
    html += `</div>`;
  }

  html += `<button class="btn danger" onclick="endSession('${s.id}')">この来店を終了する</button>`;
  app.innerHTML = html;

  // 入力欄フォーカス維持
  if (s._focusScore) {
    const inp = $('#scoreInput');
    if (inp) { inp.focus(); const v = inp.value; inp.value = ''; inp.value = v; }
    s._focusScore = false;
  }

  // 経過時間ライブ更新
  stopTick();
  _tick = setInterval(() => updateSessionTime(s.id), 20000);
}

function entryPreview(par, ss, liveChips) {
  if (!ss.place || ss.score === '' || ss.score == null || isNaN(parseInt(ss.score))) {
    return `<div class="breakdown muted small">着順と持ち点を入力するとpt変動を計算します</div>`;
  }
  const b = calcHanchanPt(par, ss.place, parseInt(ss.score), liveChips);
  const rows = [
    ['素点', b.soten, '×' + par.ptPer1000],
    ['オカ', b.oka, b.oka ? '×' + par.ptPer1000 : ''],
    ['ウマ(順位点)', b.uma, '×' + par.ptPer1000],
  ];
  let inner = rows.filter(r => r[1] !== 0 || r[0] === 'ウマ(順位点)').map(r =>
    `<div class="bd-row"><span class="muted">${r[0]}</span><span class="mono">${r[1] > 0 ? '+' : ''}${r[1]} <span class="muted small">${r[2]}</span></span></div>`).join('');
  if (b.chipPt) inner += `<div class="bd-row"><span class="muted">チップ ${liveChips > 0 ? '+' : ''}${liveChips}枚</span><span class="mono ${clsPt(b.chipPt)}">${fmtPt(b.chipPt)}</span></div>`;
  if (b.topPt) inner += `<div class="bd-row"><span class="muted">トップ賞</span><span class="mono ${clsPt(b.topPt)}">${fmtPt(b.topPt)}</span></div>`;
  if (b.fee) inner += `<div class="bd-row"><span class="muted">ゲーム代</span><span class="mono neg">-${b.fee}</span></div>`;
  return `<div class="breakdown">${inner}
    <div class="bd-row bd-total"><span>この半荘の変動</span><span class="mono ${clsPt(b.total)}">${fmtPt(b.total)} pt</span></div></div>`;
}

function hanchanRow(h, num, sid, idx, from) {
  const clickable = sid != null;
  return `<div class="hanchan ${clickable ? 'tap' : ''}" ${clickable ? `onclick="openHanchanEdit('${sid}',${idx},'${from}')"` : ''}>
    <div class="hc-rank r${h.place}">${h.place}</div>
    <div class="hc-body">
      <div class="mono">${h.score.toLocaleString('ja-JP')}点 ${h.chipDelta ? `<span class="muted small">/ チップ${h.chipDelta > 0 ? '+' : ''}${h.chipDelta}</span>` : ''}</div>
      <div class="muted small">${num}半荘目</div>
    </div>
    <div class="hc-pt mono ${clsPt(h.total)}">${fmtPt(h.total)}</div>
    ${clickable ? '<span class="hc-edit">›</span>' : ''}
  </div>`;
}

/* エントリ操作 */
function setEntry(sid, key, val, noRender) {
  const s = DB.session(sid);
  if (!s._entry) s._entry = {};
  s._entry[key] = (key === 'score') ? val : val;
  if (key === 'score') s._focusScore = true;
  if (!noRender) render();
  else {
    // 持ち点入力中はプレビューだけ更新（フォーカスを外さない）
    const par = DB.parlor(s.parlorId);
    const bd = $('.breakdown');
    if (bd) bd.outerHTML = entryPreview(par, s._entry, s.liveChips);
  }
}

function chipDelta(sid, d) {
  const s = DB.session(sid);
  s.liveChips = (s.liveChips || 0) + d;
  DB.save();
  render();
}

function confirmHanchan(sid) {
  const s = DB.session(sid);
  const e = s._entry || {};
  if (!e.place) { toast('着順を選んでください'); return; }
  const score = parseInt(e.score);
  if (isNaN(score)) { toast('持ち点を入力してください'); return; }
  const par = DB.parlor(s.parlorId);
  const b = calcHanchanPt(par, e.place, score, s.liveChips || 0);
  s.hanchans.push({
    place: e.place, score, chipDelta: s.liveChips || 0,
    total: b.total, breakdown: b, at: Date.now(),
  });
  s.liveChips = 0;
  s._entry = {};
  DB.save();
  toast(`${fmtPt(b.total)}pt を記録`);
  render();
}

function endSession(sid) {
  const s = DB.session(sid);
  if (s.hanchans.length === 0) {
    if (confirm('半荘の記録がありません。この来店を削除しますか？')) {
      DB.data.sessions = DB.data.sessions.filter(x => x.id !== sid);
      DB.save(); nav('home');
    }
    return;
  }
  if (confirm('この来店を終了します。よろしいですか？')) {
    s.status = 'closed';
    s.endedAt = Date.now();
    delete s._entry; delete s._focusScore;
    DB.save();
    nav('sessionDetail', sid);
  }
}

/* ---------- 半荘の編集・削除 ---------- */
let editState = null; // { sid, idx, from, place, score, chip }

function openHanchanEdit(sid, idx, from) {
  const s = DB.session(sid);
  if (!s) return;
  const h = s.hanchans[idx];
  editState = { sid, idx, from, place: h.place, score: String(h.score), chip: h.chipDelta || 0 };
  nav('editHanchan', { sid, idx, from });
}

function viewEditHanchan() {
  if (!editState) return nav('home');
  const s = DB.session(editState.sid);
  if (!s) { editState = null; return nav('home'); }
  const par = DB.parlor(s.parlorId);
  const es = editState;

  let html = `
    <div class="page-head">
      <button class="back-btn" onclick="editState=null;nav('${es.from}','${es.sid}')">‹</button>
      <h1>半荘を編集</h1>
    </div>
    <div class="card">
      <div class="lbl" style="color:var(--muted);font-size:13px;margin-bottom:8px">着順</div>
      <div class="rank-grid" style="grid-template-columns:repeat(${playersOf(par)},1fr)">
        ${Array.from({ length: playersOf(par) }, (_, i) => i + 1).map(r => `<button class="rank-btn ${es.place === r ? 'sel' : ''}" onclick="setEditField('place',${r})">${r}<small>位</small></button>`).join('')}
      </div>
      <label class="field" style="margin-top:14px">
        <span class="lbl">最終持ち点</span>
        <input class="score-input mono" type="number" inputmode="numeric" id="editScore"
          value="${es.score}" oninput="setEditField('score',this.value,true)">
      </label>
      <label class="field">
        <span class="lbl">チップ増減 <span class="hint">(枚)</span></span>
        <div class="chip-step">
          <button onclick="editChip(-1)">−</button>
          <input class="mono" type="number" inputmode="numeric" id="editChip" value="${es.chip}"
            oninput="setEditField('chip',this.value,true)">
          <button onclick="editChip(1)">＋</button>
        </div>
      </label>
      ${entryPreview(par, { place: es.place, score: es.score }, Number(es.chip) || 0)}
      <button class="btn accent" style="margin-top:6px" onclick="saveHanchanEdit()">更新する</button>
    </div>
    <button class="btn danger" onclick="deleteHanchanEntry()">この半荘を削除</button>
  `;
  app.innerHTML = html;
}

function setEditField(key, val, previewOnly) {
  editState[key] = val;
  if (!previewOnly) { render(); return; }
  const s = DB.session(editState.sid);
  const par = DB.parlor(s.parlorId);
  const bd = $('.breakdown');
  if (bd) bd.outerHTML = entryPreview(par, { place: editState.place, score: editState.score }, Number(editState.chip) || 0);
}

function editChip(d) {
  editState.chip = (Number(editState.chip) || 0) + d;
  const inp = $('#editChip');
  if (inp) inp.value = editState.chip;
  setEditField('chip', editState.chip, true);
}

function saveHanchanEdit() {
  const { sid, idx, from } = editState;
  const s = DB.session(sid);
  const par = DB.parlor(s.parlorId);
  if (!editState.place) { toast('着順を選んでください'); return; }
  const score = parseInt(editState.score);
  if (isNaN(score)) { toast('持ち点を入力してください'); return; }
  const chip = Math.round(Number(editState.chip) || 0);
  const b = calcHanchanPt(par, editState.place, score, chip);
  s.hanchans[idx] = { ...s.hanchans[idx], place: editState.place, score, chipDelta: chip, total: b.total, breakdown: b };
  DB.save();
  editState = null;
  toast('更新しました');
  nav(from, sid);
}

function deleteHanchanEntry() {
  const { sid, idx, from } = editState;
  if (!confirm('この半荘の記録を削除しますか？')) return;
  const s = DB.session(sid);
  s.hanchans.splice(idx, 1);
  DB.save();
  editState = null;
  toast('削除しました');
  nav(from, sid);
}

/* ---------- セッション詳細(履歴) ---------- */
function viewSessionDetail() {
  const s = DB.session(route.param);
  if (!s) return nav('home');
  const par = DB.parlor(s.parlorId);
  const dep = sessionDeposit(s);
  const players = playersOf(par);
  const ranks = Array(players).fill(0);
  s.hanchans.forEach(h => { if (h.place >= 1 && h.place <= players) ranks[h.place - 1]++; });
  const n = s.hanchans.length || 1;
  const avg = s.hanchans.reduce((a, h) => a + h.place, 0) / n;
  const durMs = (s.endedAt || s.startedAt) - s.startedAt;
  const hr = hourlyPt(dep, durMs);

  let html = `
    <div class="page-head"><button class="back-btn" onclick="nav('home')">‹</button>
      <div><h1 style="font-size:19px">${esc(par ? par.name : '削除された店')}</h1>
      <div class="sub">${fmtDate(s.startedAt)}</div></div></div>
    <div class="card"><div class="deposit-wrap">
      <div class="deposit-label">この来店の収支</div>
      <div class="deposit-val ${clsPt(dep)}">${fmtPt(dep)}<span class="unit">pt</span></div>
      <div class="muted small">${s.hanchans.length}半荘 • 平均着順 ${avg.toFixed(2)}</div>
    </div>
    <div class="time-row">
      <div><div class="k">プレイ時間</div><div class="v mono">${fmtDuration(durMs)}</div></div>
      <div><div class="k">pt時給</div><div class="v mono">${hr == null ? '—' : fmtPt(hr)}</div></div>
    </div></div>`;

  html += `<div class="card"><b>着順分布</b><div class="rank-bars">`;
  ranks.forEach((c, i) => {
    const pct = Math.round(c / n * 100);
    const colors = ['var(--accent)', '#4a7a63', '#3a5348', '#8a4a3e'];
    html += `<div class="rank-bar-row"><span style="width:28px">${i + 1}位</span>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
      <span class="muted" style="width:56px;text-align:right">${c}回 ${pct}%</span></div>`;
  });
  html += `</div></div>`;

  html += `<div class="card"><div class="row"><b>半荘ごとの記録</b><span class="muted small">タップで編集</span></div>`;
  s.hanchans.forEach((h, i) => html += hanchanRow(h, i + 1, s.id, i, 'sessionDetail'));
  html += `</div>`;

  html += `<button class="btn danger" onclick="deleteSession('${s.id}')">この来店の記録を削除</button>`;
  app.innerHTML = html;
}

function deleteSession(sid) {
  if (confirm('この来店記録を削除します。元に戻せません。')) {
    DB.data.sessions = DB.data.sessions.filter(x => x.id !== sid);
    DB.save(); nav('home');
  }
}

/* ---------- 店設定一覧 ---------- */
function viewParlors() {
  let html = `<div class="page-head"><div><h1>店設定</h1><div class="sub">よく行く雀荘のルールを登録</div></div></div>`;
  if (DB.data.parlors.length === 0) {
    html += `<div class="empty"><div class="em-ic">🀄</div><div>店が未登録です</div></div>`;
  } else {
    for (const p of DB.data.parlors) {
      html += `<div class="card tap" onclick="nav('parlorEdit','${p.id}')">
        <div class="row"><div style="font-weight:700;font-size:17px">${esc(p.name)}</div><span class="muted">›</span></div>
        ${p.note ? `<div class="muted small" style="margin:4px 0">${esc(p.note)}</div>` : ''}
        <div style="margin-top:8px">
          <span class="pill" style="border-color:var(--green);color:var(--accent)">${p.mode === 'sanma' ? '三麻' : '四麻'}</span>
          <span class="pill">${umaLabel(p)}</span>
          <span class="pill">レート ${p.ptPer1000}</span>
          <span class="pill">チップ ${p.chipPt}pt</span>
          ${p.gameFee ? `<span class="pill">代 ${p.gameFee}pt</span>` : ''}
          ${p.topPrize ? `<span class="pill">トップ賞 ${p.topPrize}pt</span>` : ''}
        </div>
      </div>`;
    }
  }
  html += `<button class="btn" onclick="nav('parlorEdit','new')">＋ 店を追加</button>`;
  app.innerHTML = html;
}

function umaLabel(p) {
  if (!p) return '';
  return `ウマ ${p.uma.map(u => (u > 0 ? '+' : '') + u).join('/')}`;
}

/* ---------- 店の追加・編集 ---------- */
let editMode = 'yonma'; // 編集中の店の三麻/四麻

function umaFieldsHtml(mode, uma) {
  const players = mode === 'sanma' ? 3 : 4;
  return Array.from({ length: players }, (_, i) =>
    `<div><div class="lbl">${i + 1}位</div>
      <input id="f_uma${i}" type="number" inputmode="numeric" class="center" value="${uma[i] != null ? uma[i] : 0}"></div>`).join('');
}
function umaPresetOptions(mode) {
  return `<option value="">プリセットを選択…</option>` +
    UMA_PRESETS[mode].map((u, i) => `<option value="${i}">${u.label}</option>`).join('');
}

function viewParlorEdit() {
  const isNew = route.param === 'new';
  const p = isNew ? defaultParlor() : { ...DB.parlor(route.param) };
  if (!p) return nav('parlors');
  if (!p.mode) p.mode = 'yonma';
  editMode = p.mode;
  window._umaPresets = UMA_PRESETS[p.mode];

  let html = `
    <div class="page-head"><button class="back-btn" onclick="nav('parlors')">‹</button>
      <h1>${isNew ? '店を追加' : '店を編集'}</h1></div>

    <div class="mode-tabs">
      <button class="mode-tab ${p.mode === 'yonma' ? 'active' : ''}" data-mode="yonma" onclick="setParlorMode('yonma')">四麻</button>
      <button class="mode-tab ${p.mode === 'sanma' ? 'active' : ''}" data-mode="sanma" onclick="setParlorMode('sanma')">三麻</button>
    </div>

    <div class="card">
      <label class="field"><span class="lbl">店名</span>
        <input id="f_name" value="${esc(p.name)}" placeholder="例: まぁじゃん○○ 天神店"></label>
      <label class="field"><span class="lbl">ルールメモ <span class="hint">(任意)</span></span>
        <input id="f_note" value="${esc(p.note)}" placeholder="例: 東南戦・喰いタン後付けあり"></label>
    </div>

    <div class="card">
      <div class="lbl" style="color:var(--muted);font-size:13px;margin-bottom:10px">点数ルール</div>
      <div class="grid2">
        <label class="field"><span class="lbl">配給原点</span>
          <input id="f_start" type="number" inputmode="numeric" value="${p.startPts}"></label>
        <label class="field"><span class="lbl">返し点(基準点)</span>
          <input id="f_return" type="number" inputmode="numeric" value="${p.returnPts}"></label>
      </div>
      <label class="field"><span class="lbl">1000点あたりのpt <span class="hint">(レート)</span></span>
        <input id="f_rate" type="number" inputmode="decimal" step="0.1" value="${p.ptPer1000}"></label>
      <label class="field" style="margin-bottom:6px"><span class="lbl">ウマ (順位点・1000点単位)</span></label>
      <select id="f_umaPreset" onchange="applyUmaPreset(this.value)">${umaPresetOptions(p.mode)}</select>
      <div class="uma-grid" id="umaFields" style="margin-top:10px;grid-template-columns:repeat(${playersOf(p)},1fr)">
        ${umaFieldsHtml(p.mode, p.uma)}
      </div>
      <label class="field" style="margin-top:14px;display:flex;align-items:center;gap:10px;flex-direction:row">
        <input type="checkbox" id="f_oka" style="width:auto" ${p.okaAuto ? 'checked' : ''}>
        <span class="lbl" style="margin:0">オカを1位に自動加算する</span></label>
    </div>

    <div class="card">
      <div class="lbl" style="color:var(--muted);font-size:13px;margin-bottom:10px">その他の精算</div>
      <div class="grid2">
        <label class="field"><span class="lbl">チップ1枚のpt</span>
          <input id="f_chip" type="number" inputmode="decimal" step="0.1" value="${p.chipPt}"></label>
        <label class="field"><span class="lbl">ゲーム代 <span class="hint">(半荘毎)</span></span>
          <input id="f_fee" type="number" inputmode="numeric" value="${p.gameFee}"></label>
      </div>
      <label class="field"><span class="lbl">トップ賞 <span class="hint">(1位が支払う・減点)</span></span>
        <input id="f_top" type="number" inputmode="numeric" value="${p.topPrize}"></label>
    </div>

    <button class="btn accent" onclick="saveParlor('${isNew ? 'new' : p.id}')">保存する</button>
    ${!isNew ? `<button class="btn danger" style="margin-top:10px" onclick="deleteParlor('${p.id}')">この店を削除</button>` : ''}
  `;
  app.innerHTML = html;
}

/* 三麻/四麻の切替。既定の配給原点・返し点・ウマを反映し、ウマ欄を作り直す */
function setParlorMode(mode) {
  if (mode === editMode) return;
  editMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  const d = MODE_DEFAULTS[mode];
  if ($('#f_start')) $('#f_start').value = d.startPts;
  if ($('#f_return')) $('#f_return').value = d.returnPts;
  const wrap = $('#umaFields');
  wrap.style.gridTemplateColumns = `repeat(${mode === 'sanma' ? 3 : 4},1fr)`;
  wrap.innerHTML = umaFieldsHtml(mode, d.uma);
  $('#f_umaPreset').innerHTML = umaPresetOptions(mode);
  window._umaPresets = UMA_PRESETS[mode];
}

function applyUmaPreset(i) {
  if (i === '') return;
  const v = window._umaPresets[i].v;
  v.forEach((val, k) => { const el = $('#f_uma' + k); if (el) el.value = val; });
}

function saveParlor(id) {
  const name = $('#f_name').value.trim();
  if (!name) { toast('店名を入力してください'); return; }
  const players = editMode === 'sanma' ? 3 : 4;
  const obj = {
    name,
    note: $('#f_note').value.trim(),
    mode: editMode,
    startPts: parseInt($('#f_start').value) || MODE_DEFAULTS[editMode].startPts,
    returnPts: parseInt($('#f_return').value) || MODE_DEFAULTS[editMode].returnPts,
    ptPer1000: parseFloat($('#f_rate').value) || 1,
    uma: Array.from({ length: players }, (_, i) => parseInt($('#f_uma' + i).value) || 0),
    okaAuto: $('#f_oka').checked,
    chipPt: parseFloat($('#f_chip').value) || 0,
    gameFee: parseInt($('#f_fee').value) || 0,
    topPrize: parseInt($('#f_top').value) || 0,
  };
  if (id === 'new') {
    DB.data.parlors.push({ id: uid(), ...obj });
  } else {
    Object.assign(DB.parlor(id), obj);
  }
  DB.save();
  toast('保存しました');
  nav('parlors');
}

function deleteParlor(id) {
  const used = DB.data.sessions.some(s => s.parlorId === id);
  const msg = used ? 'この店の来店記録も残りますが、店設定を削除しますか？' : 'この店を削除しますか？';
  if (confirm(msg)) {
    DB.data.parlors = DB.data.parlors.filter(p => p.id !== id);
    DB.save(); nav('parlors');
  }
}

/* ---------- 成績(統計) ---------- */
let statsMode = null; // 表示中の三麻/四麻。初回に自動決定

function modeOfSession(s) { return playersOf(DB.parlor(s.parlorId)) === 3 ? 'sanma' : 'yonma'; }

function viewStats() {
  const closedAll = DB.data.sessions.filter(s => s.status === 'closed');

  // 初回表示: データのあるモードを優先
  if (statsMode == null) {
    const hasYonma = closedAll.some(s => modeOfSession(s) === 'yonma');
    statsMode = (!hasYonma && closedAll.some(s => modeOfSession(s) === 'sanma')) ? 'sanma' : 'yonma';
  }

  let html = `<div class="page-head"><div><h1>成績</h1><div class="sub">通算のトータル収支</div></div></div>
    <div class="mode-tabs">
      <button class="mode-tab ${statsMode === 'yonma' ? 'active' : ''}" onclick="statsMode='yonma';render()">四麻</button>
      <button class="mode-tab ${statsMode === 'sanma' ? 'active' : ''}" onclick="statsMode='sanma';render()">三麻</button>
    </div>`;

  const players = statsMode === 'sanma' ? 3 : 4;
  const closed = closedAll.filter(s => modeOfSession(s) === statsMode);

  if (closed.length === 0) {
    html += `<div class="empty"><div class="em-ic">📊</div><div>${statsMode === 'sanma' ? '三麻' : '四麻'}の記録がまだありません</div></div>`;
    app.innerHTML = html; return;
  }

  const allHc = closed.flatMap(s => s.hanchans);
  const total = allHc.reduce((a, h) => a + h.total, 0);
  const nHc = allHc.length;
  const ranks = Array(players).fill(0);
  allHc.forEach(h => { if (h.place >= 1 && h.place <= players) ranks[h.place - 1]++; });
  const avg = allHc.reduce((a, h) => a + h.place, 0) / (nHc || 1);
  const topRate = (ranks[0] / (nHc || 1) * 100);
  const lastRate = (ranks[players - 1] / (nHc || 1) * 100);
  const rentai = ((ranks[0] + ranks[1]) / (nHc || 1) * 100);
  const totalMs = closed.reduce((a, s) => a + ((s.endedAt || s.startedAt) - s.startedAt), 0);
  const overallHr = hourlyPt(total, totalMs);

  // 店別集計
  const byParlor = {};
  closed.forEach(s => {
    if (!byParlor[s.parlorId]) byParlor[s.parlorId] = { pt: 0, hc: 0 };
    byParlor[s.parlorId].pt += sessionDeposit(s);
    byParlor[s.parlorId].hc += s.hanchans.length;
  });

  html += `<div class="card"><div class="deposit-wrap">
    <div class="deposit-label">通算収支</div>
    <div class="deposit-val ${clsPt(total)}">${fmtPt(total)}<span class="unit">pt</span></div>
    <div class="muted small">${closed.length}来店 • ${nHc}半荘</div>
  </div>
  <div class="time-row">
    <div><div class="k">総プレイ時間</div><div class="v mono">${fmtDuration(totalMs)}</div></div>
    <div><div class="k">pt時給</div><div class="v mono">${overallHr == null ? '—' : fmtPt(overallHr)}</div></div>
  </div></div>`;

  html += `<div class="stat-grid">
    <div class="stat-box"><div class="v mono">${avg.toFixed(2)}</div><div class="k">平均着順</div></div>
    <div class="stat-box"><div class="v mono">${topRate.toFixed(1)}%</div><div class="k">トップ率</div></div>
    <div class="stat-box"><div class="v mono">${rentai.toFixed(1)}%</div><div class="k">連対率</div></div>
    <div class="stat-box"><div class="v mono">${lastRate.toFixed(1)}%</div><div class="k">ラス率</div></div>
  </div>`;

  html += `<div class="card" style="margin-top:14px"><b>着順分布</b><div class="rank-bars">`;
  const colors = ['var(--accent)', '#4a7a63', '#3a5348', '#8a4a3e'];
  ranks.forEach((c, i) => {
    const pct = Math.round(c / (nHc || 1) * 100);
    html += `<div class="rank-bar-row"><span style="width:28px">${i + 1}位</span>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
      <span class="muted" style="width:56px;text-align:right">${c}回 ${pct}%</span></div>`;
  });
  html += `</div></div>`;

  html += `<div class="card"><b>店別収支</b>`;
  Object.entries(byParlor).sort((a, b) => b[1].pt - a[1].pt).forEach(([pid, v]) => {
    const par = DB.parlor(pid);
    html += `<div class="hanchan"><div class="hc-body">
      <div style="font-weight:700">${esc(par ? par.name : '削除された店')}</div>
      <div class="muted small">${v.hc}半荘</div></div>
      <div class="hc-pt mono ${clsPt(v.pt)}">${fmtPt(v.pt)}</div></div>`;
  });
  html += `</div>`;

  app.innerHTML = html;
}

/* ============================================================
   クラウド同期 (Supabase)
   未設定・未ログイン時は何もせず localStorage のみで動作する。
   ============================================================ */
const Cloud = {
  client: null,
  user: null,
  status: 'off',       // off(未設定) / anon(未ログイン) / syncing / on / error
  pushTimer: null,

  configured() {
    const c = window.JANSOU_CONFIG || {};
    return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY && window.supabase);
  },

  async init() {
    if (!this.configured()) { this.status = 'off'; return; }
    try {
      this.client = window.supabase.createClient(
        window.JANSOU_CONFIG.SUPABASE_URL, window.JANSOU_CONFIG.SUPABASE_ANON_KEY);
      const { data } = await this.client.auth.getSession();
      this.user = data.session ? data.session.user : null;
      this.status = this.user ? 'on' : 'anon';
      this.client.auth.onAuthStateChange((_e, session) => {
        const wasUser = this.user;
        this.user = session ? session.user : null;
        this.status = this.user ? 'on' : 'anon';
        if (this.user && !wasUser) this.pullAndMerge();
        else if (['home', 'account'].includes(route.name)) render();
      });
      if (this.user) await this.pullAndMerge();
      else if (['home', 'account'].includes(route.name)) render();
    } catch (e) {
      console.warn('Cloud init failed', e);
      this.status = 'error';
    }
  },

  async sendCode(email) {
    return this.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  },
  async verify(email, token) {
    return this.client.auth.verifyOtp({ email, token, type: 'email' });
  },
  async signOut() {
    await this.client.auth.signOut();
    this.user = null; this.status = 'anon';
    if (['home', 'account'].includes(route.name)) render();
  },

  /* リモートとローカルを updatedAt で比較し、新しい方を採用 */
  async pullAndMerge() {
    if (!this.user) return;
    this.status = 'syncing';
    if (['home', 'account'].includes(route.name)) render();
    try {
      const { data, error } = await this.client
        .from('app_state').select('data').eq('user_id', this.user.id).maybeSingle();
      if (error) throw error;
      if (data && data.data && Object.keys(data.data).length) {
        const remote = data.data;
        const remoteAt = remote.updatedAt || 0;
        const localAt = DB.data.updatedAt || 0;
        if (remoteAt >= localAt) {
          DB.data = remote;
          if (!DB.data.parlors) DB.data.parlors = [];
          if (!DB.data.sessions) DB.data.sessions = [];
          localStorage.setItem(STORE_KEY, JSON.stringify(DB.data));
        } else {
          await this._upsert();
        }
      } else {
        await this._upsert(); // リモートが空 → ローカルを初期投入
      }
      this.status = 'on';
    } catch (e) {
      console.warn('pull failed', e);
      this.status = 'error';
    }
    render();
  },

  schedulePush() {
    if (!this.user) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this._upsert(), 1200);
  },
  async _upsert() {
    if (!this.user) return;
    try {
      const { error } = await this.client.from('app_state').upsert({
        user_id: this.user.id, data: DB.data, updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    } catch (e) { console.warn('push failed', e); }
  },
};

function cloudBadge() {
  const map = {
    off:     ['☁️', 'ローカル', 'var(--muted)'],
    anon:    ['🔒', 'ログイン', 'var(--muted)'],
    syncing: ['🔄', '同期中', 'var(--accent)'],
    on:      ['✅', '同期中', 'var(--green)'],
    error:   ['⚠️', 'エラー', 'var(--danger)'],
  };
  const [ic, label, col] = map[Cloud.status] || map.off;
  return `<span style="color:${col}">${ic} ${label}</span>`;
}

/* ---------- アカウント / 同期画面 ---------- */
let authFlow = { email: '', sent: false };

function viewAccount() {
  let html = `<div class="page-head"><button class="back-btn" onclick="nav('home')">‹</button><h1>同期 / アカウント</h1></div>`;

  if (!Cloud.configured()) {
    html += `<div class="card">
      <div style="font-weight:700;margin-bottom:6px">☁️ クラウド同期は未設定です</div>
      <div class="muted small" style="line-height:1.7">
        今はこの端末内(localStorage)にのみ保存されています。<br>
        複数端末で同期するには Supabase の設定が必要です。<br>
        <code>config.js</code> に Supabase の URL と anon キーを設定してください。
      </div></div>
      <div class="card"><b>設定手順</b><ol class="muted small" style="line-height:1.9;padding-left:20px">
        <li>supabase.com でプロジェクトを作成</li>
        <li>SQL Editor で <code>supabase/schema.sql</code> を実行</li>
        <li>Settings → API から URL と anon キーをコピー</li>
        <li><code>config.js</code> に貼り付け</li>
      </ol></div>`;
    app.innerHTML = html;
    return;
  }

  if (Cloud.user) {
    html += `<div class="card">
      <div class="row"><span class="muted small">ログイン中</span>${cloudBadge()}</div>
      <div style="font-weight:700;font-size:17px;margin:8px 0">${esc(Cloud.user.email || '')}</div>
      <div class="muted small">このメールで他の端末にログインすると同じ成績が同期されます。</div>
    </div>
    <button class="btn ghost" onclick="Cloud.pullAndMerge()">今すぐ同期する</button>
    <button class="btn danger" style="margin-top:10px" onclick="Cloud.signOut()">サインアウト</button>`;
    app.innerHTML = html;
    return;
  }

  // 未ログイン: メールOTP
  if (!authFlow.sent) {
    html += `<div class="card">
      <div style="font-weight:700;margin-bottom:6px">🔒 ログインして同期</div>
      <div class="muted small" style="margin-bottom:12px">メールアドレスに6桁の確認コードを送ります。パスワード不要です。</div>
      <label class="field"><span class="lbl">メールアドレス</span>
        <input id="authEmail" type="email" inputmode="email" placeholder="you@example.com" value="${esc(authFlow.email)}"></label>
      <button class="btn accent" onclick="sendLoginCode()">確認コードを送る</button>
    </div>`;
  } else {
    html += `<div class="card">
      <div style="font-weight:700;margin-bottom:6px">📧 コードを入力</div>
      <div class="muted small" style="margin-bottom:12px">${esc(authFlow.email)} に届いた6桁のコードを入力してください。</div>
      <label class="field"><span class="lbl">確認コード</span>
        <input id="authCode" class="score-input mono" type="text" inputmode="numeric" placeholder="123456" maxlength="6"></label>
      <button class="btn accent" onclick="verifyLoginCode()">ログイン</button>
      <button class="btn ghost" style="margin-top:10px" onclick="authFlow.sent=false;render()">メールを入力し直す</button>
    </div>`;
  }
  app.innerHTML = html;
}

async function sendLoginCode() {
  const email = ($('#authEmail').value || '').trim();
  if (!email || !email.includes('@')) { toast('メールアドレスを入力してください'); return; }
  authFlow.email = email;
  toast('送信中…');
  const { error } = await Cloud.sendCode(email);
  if (error) { toast('送信に失敗しました'); console.warn(error); return; }
  authFlow.sent = true;
  render();
}

async function verifyLoginCode() {
  const token = ($('#authCode').value || '').trim();
  if (token.length < 6) { toast('6桁のコードを入力してください'); return; }
  toast('確認中…');
  const { error } = await Cloud.verify(authFlow.email, token);
  if (error) { toast('コードが正しくありません'); console.warn(error); return; }
  authFlow = { email: '', sent: false };
  toast('ログインしました');
  nav('home');
}

/* ---------- 起動 ---------- */
DB.load();
nav('home');
Cloud.init();
