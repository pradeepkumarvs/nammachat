/* features-v5.js — load AFTER features-v4.js (right before </body>).
   Adds: 1) group delete-when-all-read (transactional)  2) GPS area picker (Chennai / Tamil Nadu)  3) privacy notice + consent. */
(() => {
const FB = window;
const POLICY_VERSION = '2026-10';
const OPERATOR = '[Your name / organisation]', CONTACT = '[your-grievance-email@example.com]';   // <-- EDIT THESE

/* ================= 1. GROUP MESSAGES: DELETE WHEN EVERY MEMBER HAS READ ================= */
let gid = null, members = new Set(), ready = false, offMem = null, online = false;
const els = new Map();
const okNow = () => online && document.visibilityState === 'visible' && $('screen-group').classList.contains('active');
function mark(key) {                       // one transaction per message: add me to readBy, or delete if I'm the last reader
  if (!gid || !ready || !okNow()) return;
  const uid = state.me.uid;
  FB.firebaseTransaction(R(`group-messages/${gid}/${key}`), cur => {
    if (!cur) return cur;                                        // already gone
    const rb = { ...(cur.readBy || {}), [uid]: true };
    if ([...members].every(u => rb[u])) return null;             // readBy covers ALL current members (3, 5, 10...) -> delete node
    if ((cur.readBy || {})[uid]) return;                         // nothing new -> abort, no write
    return { ...cur, readBy: rb };
  }, { applyLocally: false }).catch(() => {});
}
const flush = () => els.forEach((_, k) => mark(k));               // idempotent; re-checks after reconnect / tab focus / member change
FB.V3.groom = g => {                                              // called by features-v3 when a room opens (g) / closes (null)
  if (offMem) { offMem(); offMem = null; }
  els.clear(); ready = false; gid = g;
  if (!g) return;
  offMem = FB.firebaseOnValue(R('group-members/' + g), s => { members = new Set(Object.keys(s.val() || {})); ready = members.size > 0; flush(); });
};
FB.V3.gmsg = (g, key, m, el) => { els.set(key, el); mark(key); };  // rendered first, then marked as read
FB.V3.gdel = key => { const el = els.get(key); els.delete(key); if (el) setTimeout(() => el.remove(), 2000); };  // vanishes for everyone after a 2 s grace
addEventListener('DOMContentLoaded', () => FB.firebaseOnValue(R('.info/connected'), s => { online = s.val() === true; flush(); }));
document.addEventListener('visibilitychange', flush);
$('screen-group').querySelector('.chat-header').insertAdjacentHTML('afterend', '<p class="map-hint">Messages here are deleted once every member has read them.</p>');
$('chatArea').insertAdjacentHTML('beforebegin', '<p class="map-hint">Messages are deleted shortly after the other person reads them.</p>');

/* ================= 2. GPS AREA PICKER (Chennai / Tamil Nadu) ================= */
const CENTROIDS = { Velachery: [12.9815, 80.218], Adyar: [13.0012, 80.2565], OMR: [12.901, 80.2279], 'Anna Nagar': [13.085, 80.2101], 'T Nagar': [13.0418, 80.2341], Mylapore: [13.0368, 80.2676], 'Besant Nagar': [13.0002, 80.2668], Thiruvanmiyur: [12.983, 80.2594], Guindy: [13.0067, 80.2206], Kodambakkam: [13.0521, 80.2255], Chromepet: [12.9516, 80.1462], Pallikaranai: [12.9325, 80.214], Perambur: [13.118, 80.233], Ambattur: [13.1143, 80.1548], Nungambakkam: [13.0569, 80.2425], Kilpauk: [13.0836, 80.242], Porur: [13.0382, 80.1565], Madhavaram: [13.1485, 80.2306] };
const CHENNAI = Object.keys(CENTROIDS);
const TN = ['Coimbatore', 'Madurai', 'Salem', 'Tiruchirappalli', 'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi', 'Thanjavur', 'Tiruppur', 'Dindigul', 'Kancheepuram', 'Chengalpattu', 'Kanyakumari', 'Cuddalore', 'Namakkal', 'Karur', 'Krishnagiri', 'Villupuram', 'Nagapattinam'];
const BOX = { s: 12.8, n: 13.3, w: 80.05, e: 80.35 };              // Chennai bounding box
const inChennai = (la, lo) => la >= BOX.s && la <= BOX.n && lo >= BOX.w && lo <= BOX.e;
function fillArea(sel, mode, extra) {
  const list = mode === 'chennai' ? CHENNAI : mode === 'tn' ? TN : [...CHENNAI, ...TN];
  sel.innerHTML = '<option value="" disabled selected>Select your area</option>' + list.map(v => `<option>${v}</option>`).join('') + (extra && !list.includes(extra) ? `<option>${esc(extra)}</option>` : '') + '<option>Other</option>';
}
const sel = $('suNeighborhood');
fillArea(sel, 'chennai'); fillArea($('pfArea'), 'all');            // profile editor can hold any area
sel.parentElement.insertAdjacentHTML('beforebegin', `<div class="form-group"><label for="suRegion">Region</label><select id="suRegion"><option value="chennai">Chennai</option><option value="tn">Tamil Nadu (other districts)</option></select><button class="gps-btn" id="btnDetect" type="button" style="margin:8px 0 0">📍 Detect my area (optional)</button><p class="map-hint" id="detectMsg" style="margin:6px 0 0">Your browser asks permission once. Location is only used to suggest an area and is not stored from this step.</p></div>`);
$('suRegion').onchange = () => fillArea(sel, $('suRegion').value);
$('btnDetect').onclick = async () => {
  const msg = $('detectMsg'), setRegion = r => { $('suRegion').value = r; fillArea(sel, r); };
  msg.textContent = 'Waiting for location permission…';
  try {
    const { lat, lng } = await getLocation();                      // navigator.geolocation (free, no API key)
    if (inChennai(lat, lng)) {
      const [name, km] = Object.entries(CENTROIDS).map(([n, c]) => [n, haversine(lat, lng, c[0], c[1])]).sort((a, b) => a[1] - b[1])[0];
      setRegion('chennai'); sel.value = km <= 6 ? name : 'Other';
      msg.textContent = `You're in Chennai. Suggested area: ${sel.value}. You can change it.`; return;
    }
    setRegion('tn'); msg.textContent = 'Looking up your place via OpenStreetMap Nominatim…';
    const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`)).json();
    const a = j.address || {}, place = (a.state_district || a.county || a.city || a.town || '').replace(/ district$/i, '').trim();
    const hit = TN.find(d => place.toLowerCase().includes(d.toLowerCase()));
    fillArea(sel, 'tn', hit ? null : place); sel.value = hit || place || 'Other';
    msg.textContent = a.state === 'Tamil Nadu' ? `Detected: ${sel.value}. You can change it.` : `You appear to be outside Tamil Nadu${a.state ? ' (' + a.state + ')' : ''}. "${sel.value}" was added — you can still join.`;
  } catch (err) {
    setRegion('tn'); msg.textContent = 'Could not detect location (' + (err.message || err) + '). Please pick your area manually.';
  }
};

/* ================= 3. PRIVACY NOTICE + CONSENT (DPDP Act 2023 principles) ================= */
const NOTICE = `<div style="text-align:left;font-size:13px;line-height:1.45;color:#374151;max-height:62vh;overflow-y:auto">
<h3 style="margin:0 0 6px">Privacy Notice <span style="font-weight:400;font-size:11px">(v${POLICY_VERSION})</span></h3>
<p><b>Who:</b> ${OPERATOR} runs NammaChat (the "Data Fiduciary"). Contact / Grievance Officer: ${CONTACT}. NammaChat is for people aged <b>18+</b>.</p>
<p><b>What we collect:</b> email, display name, bio, neighbourhood or district, and — only if you set it — your map pin (latitude/longitude) and distance radius.</p>
<p><b>Location:</b> "Detect my area" uses your browser's location once, with your permission. In Chennai it only picks a neighbourhood on your device. Elsewhere, your coordinates are sent to OpenStreetMap Nominatim to get a place name; we don't store them from that step. Your map pin is stored to show nearby people and distances, and other users' apps can read it, so place it near — not exactly at — your home. You can refuse permission and choose your area manually.</p>
<p><b>Auto-deletion:</b> a direct message is deleted about 2 seconds after the recipient reads it. A group message is deleted once <b>every</b> current member has read it. Unread messages stay until read. Deletion can't stop someone copying or screenshotting a message, and the chat list keeps a short preview of the latest message until the chat is deleted.</p>
<p><b>Purpose &amp; storage:</b> to run chat, nearby discovery, groups and approvals. Data is stored on Google Firebase (Singapore region), so it is processed outside India. We keep account data until you delete your account.</p>
<p><b>Your rights:</b> view and correct your data in <i>Profile</i>; erase it with <i>Settings → Delete Account</i>; withdraw consent at any time (this ends your account); nominate someone to act for you; complain to the Grievance Officer above, then the Data Protection Board of India.</p></div>`;
function showNotice(extra) {
  $('modalBody').innerHTML = NOTICE + (extra || '<button class="btn-primary" id="pnOk" style="margin-top:10px">Close</button>');
  $('modal').classList.add('open');
  if ($('pnOk')) $('pnOk').onclick = () => $('modal').classList.remove('open');
}
$('goAdmin').parentElement.insertAdjacentHTML('beforebegin', '<p class="auth-hint"><a id="goPrivacy">Privacy Notice</a></p>');
$('goPrivacy').onclick = () => showNotice();
$('btnSignup').insertAdjacentHTML('beforebegin', '<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;font-size:13px"><input type="checkbox" id="suConsent" style="width:auto;margin-top:3px"><span>I am 18 or older and agree to the <a id="pnLink" style="color:#d97706;font-weight:600;cursor:pointer">Privacy Notice</a>, including location use and auto-deletion of read messages.</span></label>');
$('pnLink').onclick = e => { e.preventDefault(); showNotice(); };
$('signupForm').addEventListener('click', e => {                   // capture phase: blocks the original signup handler until consent is given
  if (!e.target.closest('#btnSignup')) return;
  if ($('suConsent').checked) { FB.__v5consent = true; return; }
  e.stopPropagation(); e.preventDefault();
  $('auth-status').style.color = '#ef4444'; $('auth-status').textContent = 'Please accept the Privacy Notice to continue.';
}, true);
$('btnNotif').insertAdjacentHTML('beforebegin', '<button class="btn-secondary" id="btnPrivacy">Privacy &amp; data notice</button><button class="btn-secondary" id="btnWithdraw">Withdraw consent &amp; delete my data</button>');
$('btnPrivacy').onclick = () => showNotice();
$('btnWithdraw').onclick = () => $('btnDeleteAcct').click();       // reuses the existing re-auth + erase flow

const _e = enterApp;
FB.enterApp = () => {
  const first = !state.entered; _e();
  if (!first || state.isAdmin) return;
  const rec = { v: POLICY_VERSION, ts: Date.now() }, uid = state.me.uid;
  const save = () => FB.firebaseUpdate(R('users/' + uid), { consent: rec }).then(() => { state.me.consent = rec; }).catch(() => {});
  if (state.me.consent && state.me.consent.v === POLICY_VERSION) return;
  if (FB.__v5consent) { FB.__v5consent = false; return save(); }  // ticked at signup
  showNotice('<button class="btn-primary" id="pnAgree" style="margin-top:10px">I am 18+ and I agree</button><button class="danger-btn" id="pnDecline">Decline &amp; log out</button>');   // existing users: one-time consent gate
  $('pnAgree').onclick = () => { $('modal').classList.remove('open'); save(); };
  $('pnDecline').onclick = () => { $('modal').classList.remove('open'); $('logoutBtn').click(); };
};
})();