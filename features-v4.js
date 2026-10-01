/* features-v4.js — load AFTER features-v3.js (right before </body>).
   Adds: 1) group invite cards in chat  2) 🔔 unread badges on People/Chats  3) profile view + edit. */
(() => {
const FB = window;

document.head.insertAdjacentHTML('beforeend', '<style>.v4-card{background:#fff;color:#111827;border:1px solid #fde68a;border-radius:12px;padding:12px;min-width:200px}.v4-from{font-size:12px;color:#6b7280}.v4-gname{font-weight:700;font-size:15px;margin:4px 0 10px}.v4-join{width:100%;padding:9px;border:none;border-radius:8px;background:#059669;color:#fff;font-weight:700;cursor:pointer}.v4-join:disabled{opacity:.6}.v4-bell{background:#ef4444;color:#fff;border-radius:12px;padding:2px 8px;font-size:12px;font-weight:700;white-space:nowrap}</style>');

/* ================= 1. GROUP INVITE CARDS ================= */
$('btnSend').insertAdjacentHTML('beforebegin', '<button class="icon-btn" id="btnInvite" title="Invite to a group">👥</button>');

// Render type:'invite' messages as a card (all other types go to the original renderBody)
const _rb = renderBody;
FB.renderBody = m => m.type !== 'invite' ? _rb(m) :
  `<div class="v4-card"><div class="v4-from">${esc(m.fromName || 'Someone')} invited you to join</div><div class="v4-gname">👥 ${esc(m.gname || 'Group Name')}</div><button class="v4-join" data-code="${esc(m.code || '')}">Join Group</button></div>`;

// Same write shape as sendMsg (message + chat-list previews + unread count) for the new 'invite' type
function sendInvite(gid, g) {
  const peer = state.activeChatUid, me = state.me; if (!peer) return;
  const path = chatKey(me.uid, peer), ts = Date.now(), key = FB.firebasePush(R(path + '/messages')).key;
  const pv = '👥 Group invite: ' + g.name.slice(0, 40), mine = `user-chats/${me.uid}/${peer}/`, theirs = `user-chats/${peer}/${me.uid}/`;
  FB.firebaseUpdate(ROOT(), {
    [`${path}/messages/${key}`]: { from: me.uid, ts, type: 'invite', fromName: me.name, gid, code: g.code, gname: g.name },
    [mine + 'lastMessage']: pv, [mine + 'timestamp']: ts, [mine + 'name']: peerName(peer), [mine + 'unreadCount']: 0,
    [theirs + 'lastMessage']: pv, [theirs + 'timestamp']: ts, [theirs + 'name']: me.name, [theirs + 'unreadCount']: FB.firebaseIncrement(1)
  }).then(() => showToast('Invite sent')).catch(e => showToast('Send failed: ' + e.message));
}
$('btnInvite').onclick = () => {
  const gs = Object.entries(V3.groups());
  if (!gs.length) return showToast('Create or join a group first (Groups tab)');
  $('modalBody').innerHTML = '<h3 style="margin:0 0 10px">Invite to which group?</h3>' + gs.map(([id, g]) => `<button class="btn-secondary" data-gi="${id}">👥 ${esc(g.name || '')}</button>`).join('') + '<button class="danger-btn" id="mCancel">Cancel</button>';
  $('modal').classList.add('open');
  $('modalBody').querySelectorAll('[data-gi]').forEach(b => b.onclick = () => { $('modal').classList.remove('open'); sendInvite(b.dataset.gi, V3.groups()[b.dataset.gi]); });
  $('mCancel').onclick = () => $('modal').classList.remove('open');
};
// "Join Group": joins (if needed) and opens the group room right away (V3.join does both)
document.addEventListener('click', async e => {
  const b = e.target.closest('.v4-join'); if (!b) return;
  b.disabled = true; await V3.join(b.dataset.code); b.disabled = false;
});

/* ================= 2. 🔔 UNREAD BADGES (People + Chats) ================= */
function paintBells() {
  document.querySelectorAll('#users-list .user-card[data-uid]').forEach(c => {
    const n = (state.chats[c.dataset.uid] || {}).unreadCount || 0;
    let b = c.querySelector('.v4-bell');
    if (!n || state.blocked.has(c.dataset.uid)) return b && b.remove();
    if (!b) { b = document.createElement('span'); b.className = 'v4-bell'; c.insertBefore(b, c.querySelector('.distance-badge')); }
    b.textContent = '🔔 ' + n;
  });
}
const _ru = renderUsers, _rc = renderChats, _ub = updateBadge;
FB.renderUsers = () => { _ru(); paintBells(); };
FB.renderChats = () => { _rc(); document.querySelectorAll('#chats-list .badge').forEach(b => { b.textContent = '🔔 ' + b.textContent; }); };
FB.updateBadge = () => { _ub(); paintBells(); };   // runs whenever user-chats changes (new unread arrives)

/* ================= 3. PROFILE VIEW + EDIT ================= */
$('app').insertAdjacentHTML('beforeend', `
<div class="screen" id="screen-profile">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><div class="avatar" id="pfAvatar"></div><div><div class="user-name" id="pfEmail"></div><div class="user-meta" id="pfMeta"></div></div></div>
  <div class="form-group"><label for="pfName">Display name</label><input id="pfName" maxlength="20"></div>
  <div class="form-group"><label for="pfBio">Bio</label><input id="pfBio" maxlength="140" placeholder="A line about you"></div>
  <div class="form-group"><label for="pfArea">Neighborhood</label><select id="pfArea"></select></div>
  <div class="form-group"><label for="pfRadius">Distance radius</label><select id="pfRadius"><option value="1">1 km</option><option value="3">3 km</option><option value="5">5 km</option><option value="10">10 km</option></select></div>
  <button class="btn-primary" id="pfSave">Save changes</button>
  <p id="pfStatus" style="font-size:12px;text-align:center;margin-top:10px"></p>
</div>`);
$('pfArea').innerHTML = $('suNeighborhood').innerHTML;
document.querySelector('#navbar [data-go=settings]').insertAdjacentHTML('beforebegin', '<button data-go="profile">Profile</button>');
document.querySelector('#navbar [data-go=profile]').onclick = () => showScreen('profile');
$('logoutBtn').insertAdjacentHTML('beforebegin', '<button id="profileBtn" title="My profile" style="display:none">👤</button>');
$('profileBtn').onclick = () => showScreen('profile');

function fillProfile() {
  const m = state.me || {};
  $('pfAvatar').textContent = (m.name || '?')[0].toUpperCase();
  $('pfEmail').textContent = m.email || '';
  $('pfMeta').textContent = `${V3.tier().label} · ${m.area || 'No area set'}`;
  $('pfName').value = m.name || ''; $('pfBio').value = m.bio || '';
  $('pfArea').value = m.area || ''; $('pfRadius').value = String(m.radius || 3);
  $('pfStatus').textContent = '';
}
$('pfSave').onclick = async () => {
  const st = $('pfStatus'), name = $('pfName').value.trim();
  st.style.color = '#ef4444';
  if (name.length < 2) { st.textContent = 'Name needs 2–20 characters.'; return; }
  const v = { name, bio: $('pfBio').value.trim().slice(0, 140), area: $('pfArea').value || state.me.area || '', radius: parseFloat($('pfRadius').value) || 3 };
  try {
    await FB.firebaseUpdate(R('users/' + state.me.uid), v);
    if (state.presenceRef) await FB.firebaseUpdate(state.presenceRef, v).catch(() => {});   // keep People list in sync
    const u = FB.firebaseAuth.currentUser; if (u) await FB.firebaseUpdateProfile(u, { displayName: name }).catch(() => {});
    Object.assign(state.me, v); fillProfile(); showToast('Profile updated');
  } catch (e) { st.textContent = 'Could not save: ' + e.message; }
};

const _s = showScreen;
FB.showScreen = name => {
  _s(name);
  if (name === 'profile') { $('navbar').style.display = 'flex'; fillProfile(); }
  $('profileBtn').style.display = ['auth', 'adminlogin'].includes(name) ? 'none' : 'inline-block';
};
const _e = enterApp;
FB.enterApp = () => {
  const first = !state.entered; _e();
  if (first) showToast(`Welcome, ${state.me.name}! Tap 👤 to view or edit your profile.`);
};
})();