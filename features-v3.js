/* features-v3.js — load AFTER the main inline <script> (right before </body>).
   Adds: 1) delete-on-read  2) admin login + dashboard  3) tiers  4) groups.
   Reuses existing globals ($, R, ROOT, state, esc, showToast, showScreen, renderBody, chatKey...). */
(() => {
const FB = window;

/* ============ 3. TIERS (edit limits here; V3.tier() is available everywhere) ============ */
const TIERS = {
  free:   { label: 'Free Plan', maxOwned: 1, maxJoined: 3,  maxMembers: 10,  history: 30,  cooldownMs: 3000, customCode: false },
  paid19: { label: '₹19 Plan',  maxOwned: 5, maxJoined: 25, maxMembers: 100, history: 200, cooldownMs: 0,    customCode: true  }
};
const tier = () => TIERS[state.me && state.me.tier] || TIERS.free;
FB.V3 = { TIERS, tier };

/* ============ UI injection (existing layout untouched) ============ */
document.head.insertAdjacentHTML('beforeend', '<style>.v3-chips{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}.v3-chips button{border:1px solid #e5e7eb;background:#fff;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:700;color:#6b7280;cursor:pointer}.v3-chips button.on{background:#fef3c7;color:#92400e;border-color:#f59e0b}.v3-tier{width:auto;padding:6px;font-size:12px}.v3-row{display:flex;gap:8px;margin-bottom:10px}.v3-row input{flex:1;min-width:0}.v3-row button{width:auto;padding:0 16px;margin:0}</style>');
$('screen-auth').insertAdjacentHTML('beforeend', '<p class="auth-hint"><a id="goAdmin">Admin login</a></p>');
$('app').insertAdjacentHTML('beforeend', `
<div class="screen" id="screen-adminlogin">
  <h2 style="color:#111827;margin-top:0">Admin Login</h2>
  <div class="form-group"><label for="alEmail">Admin email</label><input id="alEmail" type="email"></div>
  <div class="form-group"><label for="alPw">Password</label><input id="alPw" type="password"></div>
  <button class="btn-primary" id="alBtn">Sign in as admin</button>
  <button class="btn-secondary" id="alBack">Back to user login</button>
  <p id="alStatus" style="font-size:12px;color:#ef4444;text-align:center"></p>
</div>
<div class="screen" id="screen-groups">
  <h3 style="margin:0 0 4px;color:#111827">Groups</h3>
  <p class="map-hint" id="gTier" style="text-align:left"></p>
  <div class="v3-row"><input id="gName" maxlength="30" placeholder="New group name"><input id="gCustom" maxlength="12" placeholder="Custom code" style="max-width:120px"><button class="btn-primary" id="gCreate">Create</button></div>
  <div class="v3-row"><input id="gCode" maxlength="12" placeholder="Invite code"><button class="btn-primary" id="gJoin">Join</button></div>
  <div id="g-list"></div>
</div>
<div class="screen" id="screen-group">
  <div class="chat-header"><div style="flex:1"><div id="gTitle" style="font-weight:700"></div><div id="gSub" style="font-size:12px;color:#6b7280"></div></div><button class="icon-btn" id="gShare" title="Copy invite link">🔗</button><button class="icon-btn" id="gLeave" title="Leave group">🚪</button></div>
  <div class="chat-area" id="gArea"></div>
  <div class="chat-input-wrap"><input id="gMsg" maxlength="500" placeholder="Message the group..."><button id="gSend">Send</button></div>
</div>`);
document.querySelector('#navbar [data-go=settings]').insertAdjacentHTML('beforebegin', '<button data-go="groups">Groups</button>');
document.querySelector('#navbar [data-go=groups]').onclick = () => showScreen('groups');
$('btnNotif').insertAdjacentHTML('beforebegin', '<div class="loc-info" id="v3Tier"></div>');

/* ============ Hooks into existing functions (wrappers, originals kept) ============ */
const _show = showScreen;
FB.showScreen = name => {
  _show(name);
  if (name === 'groups') $('navbar').style.display = 'flex';
  if (name === 'group') $('backBtn').style.display = 'inline-block';
  if (name === 'adminlogin') $('logoutBtn').style.display = 'none';
};
const _back = $('backBtn').onclick;
$('backBtn').onclick = e => $('screen-group').classList.contains('active') ? (closeRoom(), showScreen('groups')) : _back(e);

const _enter = enterApp;
FB.enterApp = () => {
  const first = !state.entered;
  _enter();
  if (!first) return;
  const uid = state.me.uid;
  state.offs.push(FB.firebaseOnValue(R(`users/${uid}/tier`), s => {   // live: admin changes apply instantly
    state.me.tier = s.val() || 'free';
    $('v3Tier').textContent = 'Plan: ' + tier().label;
    $('gTier').textContent = `${tier().label}: own ${tier().maxOwned}, join ${tier().maxJoined}, ${tier().maxMembers} members/group`;
  }));
  state.offs.push(FB.firebaseOnValue(R('user-groups/' + uid), s => { myGroups = s.val() || {}; renderGroups(); }));
  state.offs.push(() => { closeRoom(); pend.clear(); });             // cleaned by stopApp()
  if (state.isAdmin && FB.__goAdmin) { FB.__goAdmin = false; showScreen('admin'); }
  const c = new URLSearchParams(location.search).get('join');       // invite link ?join=CODE
  if (c) { history.replaceState(null, '', location.pathname); showScreen('groups'); $('gCode').value = c.toUpperCase(); showToast('Tap Join to enter the group'); }
};

/* ============ 1. DELETE-ON-READ (recipient only) ============
   A message is removed only after: rendered in the open chat + tab visible + Firebase connected,
   then a full 2000 ms with all of that still true. Any drop (offline / tab hidden / chat closed)
   cancels the timer; it restarts with a fresh 2 s window once conditions return.
   Crash / reload before the timer = node stays in DB and is re-shown + re-armed next open. */
const BUFFER = 2000, pend = new Map();
let online = false;
const disarm = k => { const p = pend.get(k); if (p) { clearTimeout(p.t); p.t = null; } };
const ready = p => online && document.visibilityState === 'visible' && state.activeChatUid === p.peer && $('screen-chat').classList.contains('active');
const arm = k => { const p = pend.get(k); if (!p) return; disarm(k); if (ready(p)) p.t = setTimeout(() => fire(k), BUFFER); };
async function fire(k) {
  const p = pend.get(k); if (!p) return;
  if (!ready(p)) return disarm(k);
  try { await FB.firebaseRemove(R(p.path)); pend.delete(k); }
  catch (e) { disarm(k); if (++p.tries < 3) setTimeout(() => arm(k), 5000); else pend.delete(k); }
}
const rearm = () => pend.forEach((_, k) => (online && document.visibilityState === 'visible') ? arm(k) : disarm(k));
document.addEventListener('visibilitychange', rearm);
addEventListener('DOMContentLoaded', () => FB.firebaseOnValue(R('.info/connected'), s => { online = s.val() === true; rearm(); }));

const _append = appendMessage;
FB.appendMessage = m => {
  _append(m);                                                       // render immediately, as before
  if (m._k && state.me && m.from !== state.me.uid && state.activeChatUid) {
    pend.set(m._k, { path: chatKey(state.me.uid, state.activeChatUid) + '/messages/' + m._k, peer: state.activeChatUid, t: null, tries: 0 });
    arm(m._k);
  }
};
const _open = openChat;
FB.openChat = uid => { pend.forEach((_, k) => disarm(k)); pend.clear(); _open(uid); };

/* ============ 2. ADMIN LOGIN + DASHBOARD ============
   Admins = Firebase Auth users with /admins/<uid> = true (set in the console). */
$('goAdmin').onclick = () => showScreen('adminlogin');
$('alBack').onclick = () => showScreen('auth');
$('alBtn').onclick = async () => {
  const st = $('alStatus'); st.textContent = '';
  if (!$('alEmail').value.trim() || !$('alPw').value) { st.textContent = 'Enter email and password.'; return; }
  FB.__signingUp = true;                                            // reuse existing flag: pauses auto-routing until we verify
  try {
    const { user } = await FB.firebaseSignIn(FB.firebaseAuth, $('alEmail').value.trim(), $('alPw').value);
    if ((await FB.firebaseGet(R('admins/' + user.uid))).val() !== true) { await FB.firebaseSignOut(FB.firebaseAuth); throw new Error('This account is not an admin.'); }
    FB.__signingUp = false; FB.__goAdmin = true; $('alPw').value = '';
    await routeUser(user);
  } catch (e) { FB.__signingUp = false; st.textContent = e.message; showToast(e.message); }
};

let adminUsers = {}, adminFilter = 'pending';
const stOf = u => u.status || 'pending';
FB.listenAdmin = () => state.offs.push(FB.firebaseOnValue(R('users'), s => { adminUsers = s.val() || {}; renderAdmin(); }));
function renderAdmin() {
  const all = Object.entries(adminUsers).filter(([id]) => id !== state.me.uid);
  const cnt = f => all.filter(([, u]) => f === 'all' || stOf(u) === f).length;
  const rows = all.filter(([, u]) => adminFilter === 'all' || stOf(u) === adminFilter);
  $('admin-list').innerHTML = '<div class="v3-chips">' + ['pending', 'approved', 'rejected', 'all'].map(f => `<button data-f="${f}" class="${f === adminFilter ? 'on' : ''}">${f} (${cnt(f)})</button>`).join('') + '</div>' +
    (rows.length ? rows.map(([id, u]) => `<div class="user-card" style="cursor:default;flex-wrap:wrap"><div class="avatar">${esc((u.name || '?')[0].toUpperCase())}</div><div class="user-info" data-prof="${id}" style="cursor:pointer"><div class="user-name">${esc(u.name || '')}</div><div class="user-meta">${esc(u.email || '')} · ${esc(u.area || '')}</div></div>` +
      `<select class="v3-tier" data-t="${id}">${Object.entries(TIERS).map(([k, t]) => `<option value="${k}"${(u.tier || 'free') === k ? ' selected' : ''}>${t.label}</option>`).join('')}</select>` +
      (stOf(u) !== 'approved' ? `<button class="mini ok" data-id="${id}" data-s="approved">Approve</button>` : '') +
      (stOf(u) !== 'rejected' ? `<button class="mini no" data-id="${id}" data-s="rejected">Reject</button>` : '') + '</div>').join('') : '<div class="empty-state">Nothing here.</div>');
}
const upd = (id, v, msg) => FB.firebaseUpdate(R('users/' + id), v).then(() => showToast(msg)).catch(e => showToast(e.message));
$('admin-list').onclick = e => {
  const b = e.target.closest('button'), pr = e.target.closest('[data-prof]');
  if (b && b.dataset.f) { adminFilter = b.dataset.f; return renderAdmin(); }
  if (b && b.dataset.s) return upd(b.dataset.id, { status: b.dataset.s }, 'Marked ' + b.dataset.s);
  if (pr) {
    const u = adminUsers[pr.dataset.prof] || {};
    $('modalBody').innerHTML = `<div class="avatar" style="margin:0 auto 8px">${esc((u.name || '?')[0].toUpperCase())}</div><h3 style="margin:0">${esc(u.name || '')}</h3><p class="user-meta">${esc(u.email || '')} · ${esc(u.area || 'Unknown area')}</p><p style="font-size:14px;color:#374151">${esc(u.bio || 'No bio.')}</p><p class="user-meta">Radius ${+u.radius || '?'} km · ${stOf(u)} · ${(TIERS[u.tier] || TIERS.free).label}</p><button class="btn-secondary" id="mClose">Close</button>`;
    $('modal').classList.add('open'); $('mClose').onclick = () => $('modal').classList.remove('open');
  }
};
$('admin-list').onchange = e => { if (e.target.dataset.t) upd(e.target.dataset.t, { tier: e.target.value }, 'Plan set: ' + TIERS[e.target.value].label); };

/* ============ 4. GROUPS ============
   groups/{gid}                 meta (members only)
   group-codes/{CODE}           {gid,name,owner,max,n}  join lookup, readable only if you know the code
   group-members/{gid}/{uid}    membership
   user-groups/{uid}/{gid}      my group list
   group-messages/{gid}/{id}    chat (separate from global/DM feeds) */
let myGroups = {}, curGid = null, gOff = null, lastSend = 0;
const CODE_RE = /^[A-Z0-9]{4,12}$/, ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rndCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHA[b % 32]).join('');
function renderGroups() {
  const l = Object.entries(myGroups);
  $('g-list').innerHTML = l.length ? l.map(([id, g]) => `<div class="user-card" data-g="${id}"><div class="avatar">${esc((g.name || '?')[0].toUpperCase())}</div><div class="user-info"><div class="user-name">${esc(g.name || '')}</div><div class="user-meta">${g.role === 'owner' ? 'Owner' : 'Member'} · code ${esc(g.code || '')}</div></div></div>`).join('') : '<div class="empty-state">No groups yet.<br><span style="font-size:13px">Create one or join with a code.</span></div>';
}
$('g-list').onclick = e => { const c = e.target.closest('[data-g]'); if (c) openGroup(c.dataset.g); };
function closeRoom() { if (gOff) { gOff(); gOff = null; } curGid = null; }

$('gCreate').onclick = async () => {
  const name = $('gName').value.trim().slice(0, 30), t = tier(), mine = Object.values(myGroups);
  let code = $('gCustom').value.trim().toUpperCase();
  if (!name) return showToast('Enter a group name');
  if (mine.filter(g => g.role === 'owner').length >= t.maxOwned) return showToast(`${t.label}: max ${t.maxOwned} owned group(s). Upgrade for more.`);
  if (mine.length >= t.maxJoined) return showToast(`${t.label}: max ${t.maxJoined} groups`);
  if (code && !t.customCode) return showToast('Custom codes need the ₹19 Plan');
  if (code && !CODE_RE.test(code)) return showToast('Code: 4–12 letters or digits');
  code = code || rndCode();
  const uid = state.me.uid, ts = Date.now(), gid = FB.firebasePush(R('groups')).key;
  try {
    await FB.firebaseUpdate(ROOT(), {                               // one atomic multi-path write
      [`group-codes/${code}`]: { gid, name, owner: uid, max: t.maxMembers, n: 1 },
      [`groups/${gid}`]: { name, owner: uid, code, ts },
      [`group-members/${gid}/${uid}`]: { name: state.me.name, ts },
      [`user-groups/${uid}/${gid}`]: { name, code, role: 'owner', ts }
    });
    $('gName').value = $('gCustom').value = ''; showToast('Group created · code ' + code);
  } catch (e) { showToast('Code already taken — try another'); }
};
const joinByCode = async raw => {
  const code = String(raw || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return showToast('Enter a valid invite code');
  try {
    const c = (await FB.firebaseGet(R('group-codes/' + code))).val();
    if (!c) return showToast('No group with that code');
    if (myGroups[c.gid]) return openGroup(c.gid);
    if (Object.keys(myGroups).length >= tier().maxJoined) return showToast(`${tier().label}: max ${tier().maxJoined} groups`);
    if (c.n >= c.max) return showToast('This group is full');
    const uid = state.me.uid, ts = Date.now();
    await FB.firebaseUpdate(ROOT(), {
      [`group-codes/${code}/n`]: FB.firebaseIncrement(1),
      [`group-members/${c.gid}/${uid}`]: { name: state.me.name, ts },
      [`user-groups/${uid}/${c.gid}`]: { name: c.name, code, role: 'member', ts }
    });
    $('gCode').value = ''; showToast('Joined ' + c.name);
    myGroups[c.gid] = { name: c.name, code, role: 'member', ts }; openGroup(c.gid);
  } catch (e) { showToast('Could not join: ' + e.message); }
};
$('gJoin').onclick = () => joinByCode($('gCode').value);
function openGroup(gid) {
  const g = myGroups[gid]; if (!g) return;
  closeRoom(); curGid = gid; $('gArea').innerHTML = '';
  $('gTitle').textContent = g.name; $('gSub').textContent = 'Invite code: ' + g.code;
  showScreen('group');
  const offAdd = FB.firebaseOnChildAdded(FB.firebaseQuery(R('group-messages/' + gid), FB.firebaseLimitToLast(tier().history)), s => {
    const m = s.val(); if (!m) return;
    const mine = m.from === state.me.uid, d = document.createElement('div');
    d.className = 'message ' + (mine ? 'me' : 'them');
    d.innerHTML = (mine ? '' : `<b style="font-size:12px">${esc(m.name || 'User')}</b>`) + renderBody(m) + `<span class="ts">${new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`;
    $('gArea').appendChild(d); $('gArea').scrollTop = $('gArea').scrollHeight;
    if (FB.V3.gmsg) FB.V3.gmsg(gid, s.key, m, d);
  });
  const offDel = FB.firebaseOnChildRemoved(R('group-messages/' + gid), s => FB.V3.gdel && FB.V3.gdel(s.key));
  if (FB.V3.groom) FB.V3.groom(gid);
  gOff = () => { offAdd(); offDel(); if (FB.V3.groom) FB.V3.groom(null); };
}
function gSend() {
  const text = $('gMsg').value.trim(), now = Date.now();
  if (!text || !curGid) return;
  if (now - lastSend < tier().cooldownMs) return showToast('Free Plan: 1 message per 3s. ₹19 Plan has no limit.');
  lastSend = now; $('gMsg').value = '';
  FB.firebaseSet(FB.firebasePush(R('group-messages/' + curGid)), { from: state.me.uid, name: state.me.name, text: text.slice(0, 500), ts: now, readBy: { [state.me.uid]: true } }).catch(e => showToast('Send failed: ' + e.message));
}
$('gSend').onclick = gSend;
$('gMsg').addEventListener('keydown', e => { if (e.key === 'Enter') gSend(); });
$('gShare').onclick = () => {
  const g = myGroups[curGid]; if (!g) return;
  const url = location.origin + location.pathname + '?join=' + g.code;
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => showToast('Invite link copied'), () => prompt('Invite link:', url));
};
$('gLeave').onclick = async () => {
  const g = myGroups[curGid], gid = curGid, uid = state.me.uid;
  if (!g) return;
  if (g.role === 'owner') return showToast('Owners cannot leave their group yet');
  if (!confirm('Leave this group?')) return;
  try {
    await FB.firebaseUpdate(ROOT(), { [`group-codes/${g.code}/n`]: FB.firebaseIncrement(-1), [`group-members/${gid}/${uid}`]: null, [`user-groups/${uid}/${gid}`]: null });
    closeRoom(); showScreen('groups');
  } catch (e) { showToast(e.message); }
};
FB.V3.join = joinByCode; FB.V3.groups = () => myGroups;
})();