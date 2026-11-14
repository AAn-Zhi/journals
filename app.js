function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function safe(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function label(s,o={month:'long',day:'numeric',year:'numeric'}){return new Date(s+'T12:00:00').toLocaleDateString('en-US',o)}
function toast(s){let t=$('#toast');t.textContent=s;t.style.display='block';clearTimeout(window.tt);window.tt=setTimeout(()=>t.style.display='none',2200)}
function showView(v){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+v));document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===v));document.querySelectorAll('.top-actions .pill').forEach((x,i)=>x.classList.toggle('active',(i===0&&v==='today')||(i===1&&v==='calendar')));if(v==='calendar')renderCalendar();if(v==='memories')renderMemories()}
function renderDate(){let d=new Date(selected+'T12:00:00');$('#dateTitle').innerHTML=`${d.toLocaleDateString('en-US',{month:'long'})} <em>${d.getDate()}</em>`;$('#dateSub').textContent=`${d.getFullYear()} · ${d.toLocaleDateString('en-US',{weekday:'long'})} — Leave a little of today here.`;$('#bigday').textContent=d.getDate()}
function renderCalendar(){let y=cal.getFullYear(),m=cal.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),names=['SUN','MON','TUE','WED','THU','FRI','SAT'];$('#calmonth').textContent=cal.toLocaleDateString('en-US',{month:'long',year:'numeric'});let out=names.map(n=>`<div class="weekday">${n}</div>`).join(''),a=all();for(let i=0;i<42;i++){let d=new Date(start);d.setDate(start.getDate()+i);let k=iso(d),es=a.filter(e=>e.date===k);out+=`<button class="calday ${d.getMonth()!==m?'other':''} ${k===iso(new Date())?'today':''} ${k===selected?'selected':''}" onclick="selectDate('${k}')"><span>${d.getDate()}</span><div class="marks">${es.slice(0,3).map(e=>`<i class="mark ${e.writer==='B'?'b':''}"></i>`).join('')}</div></button>`}$('#calgrid').innerHTML=out}
function changeMonth(n){cal=new Date(cal.getFullYear(),cal.getMonth()+n,1);renderCalendar()}
function renderMemories(){let a=all().sort((x,y)=>y.date.localeCompare(x.date)||y.created-x.created);$('#memorylist').innerHTML=a.length?a.map(e=>`<div class="memory" onclick="selectDate('${e.date}')"><div class="memorydate">${new Date(e.date+'T12:00:00').getDate()}<small>${label(e.date,{month:'short',year:'numeric'})}</small></div><div><div class="memorytext">${safe((e.text||'Photographs from the day.').slice(0,190))}${e.text?.length>190?'…':''}</div><div class="memorymeta">${safe(e.name)} · ${label(e.date,{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · ${e.photos?.length||0} photos</div></div></div>`).join(''):'<div class="empty"><strong>Nothing here just yet.</strong>Your archive will grow one entry at a time.</div>'}

const $ = selector => document.querySelector(selector);
const db = window.supabase?.createClient(
  'https://cxxhlzfvehmozlbmybvk.supabase.co',
  'sb_publishable_6CnJOolqaMDxVqFjuWz9Pw_CLTjsqYi'
);
const hash = new URLSearchParams(location.hash.slice(1));
let setup = ['invite', 'recovery'].includes(hash.get('type'));
let selected = iso(new Date()), cal = new Date(), pinned = false;
let journal, user, edit, pending;
let members = new Map(), entries = [], busy = false;
let sessionVersion = 0, refreshVersion = 0;
const all = () => entries.slice();
const status = message => { $('#status').textContent = message; };
const authStatus = message => { $('#auth-status').textContent = message; };
function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

function renderEntries() {
  renderDate();
  const records = entries.filter(item => item.date === selected).sort((a, b) => a.created - b.created);
  $('#count').textContent = records.length + ' · ' + label(selected);
  $('#entries').innerHTML = records.map(item => {
    const date = new Date(item.created);
    const time = iso(date) === selected ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleString();
    return `<article class="entry" style="--accent:${item.writer === 'B' ? '#722F42' : '#8A72A6'}">
      <div class="entry-head"><div class="byline"><div class="avatar">${safe(item.writer)}</div><div>
      <div class="author">${safe(item.name)}</div><div class="time">${safe(time)}${item.revision > 1 ? ' · edited' : ''}</div></div></div>
      <div class="actions">${item.revision > 1 ? '<button class="action" data-action="history">History</button>' : ''}
      ${item.author_id === user ? '<button class="action" data-action="edit">Edit</button><button class="action" data-action="delete">Delete</button>' : ''}</div></div>
      <div class="bodytext ${item.writer === 'B' ? 'b' : 'a'}">${safe(item.text)}</div><div class="history" hidden></div></article>`;
  }).join('') || '<div class="empty"><strong>A page not yet filled.</strong>It can begin with something small.</div>';
  records.forEach((item, index) => { $('#entries').children[index].dataset.entry = item.id; });
}

function selectDate(date) {
  selected = date;
  pinned = true;
  renderEntries();
  showView('today');
}

for (const button of document.querySelectorAll('button[onclick]')) {
  if (button.getAttribute('onclick') === "showView('today')") button.onclick = () => {
    selectDate(iso(new Date()));
    pinned = false;
  };
}

const cancel = document.createElement('button');
cancel.type = 'button';
cancel.className = 'btn';
cancel.textContent = 'Cancel edit';
$('.compose-bottom').append(cancel);
function clearDraft() {
  edit = null;
  $('#entryText').value = '';
  $('#writerHint').textContent = members.get(user)?.profiles?.display_name || '';
  cancel.hidden = true;
}
cancel.onclick = () => { if (!busy) clearDraft(); };

async function refresh() {
  if (!journal) return;
  const diary = journal, version = ++refreshVersion;
  const rows = [];
  for (let start = 0; ; start += 500) {
    const page = checked(await db.from('entries').select('*').eq('journal_id', diary).order('id').range(start, start + 499));
    rows.push(...page);
    if (page.length < 500) break;
  }
  if (version !== refreshVersion || diary !== journal) return;
  entries = rows.map(row => ({
    ...row, date: row.entry_date, created: Date.parse(row.created_at), text: row.body,
    name: members.get(row.author_id)?.profiles?.display_name || 'Writer',
    writer: members.get(row.author_id)?.writer_slot || 'A'
  }));
  if (!pinned && !edit && !$('#entryText').value.trim()) selected = iso(new Date());
  renderEntries();
  if ($('#view-calendar').classList.contains('active')) renderCalendar();
  if ($('#view-memories').classList.contains('active')) renderMemories();
}

async function write(params) {
  const signature = JSON.stringify(params);
  if (pending && pending.signature !== signature) {
    const previous = pending;
    const result = await db.rpc('write_entry', previous.params);
    if (!result.error || result.error.code === 'P0001' || result.error.code === '42501') pending = null;
    checked(result);
    await refresh();
    throw new Error('previous_save_confirmed');
  }
  pending ||= { signature, params: { ...params, p_request: crypto.randomUUID() } };
  const result = await db.rpc('write_entry', pending.params);
  if (!result.error || result.error.code === 'P0001' || result.error.code === '42501') pending = null;
  return checked(result);
}

function feedback(problem) {
  if (problem.message === 'revision_conflict') return 'This entry changed on another device. Copy your draft before reopening the latest entry.';
  if (problem.message === 'previous_save_confirmed') return 'The previous save succeeded. Review this draft before submitting again.';
  return pending ? 'Save could not be confirmed. Retry to check the result.' : 'Could not save. Your draft is still here.';
}

async function saveEntry() {
  const body = $('#entryText').value.trim();
  if (!journal || busy || !body) return;
  const scope = sessionVersion;
  busy = true;
  $('#entryText').disabled = true;
  status('Saving…');
  try {
    const params = edit
      ? { p_journal: journal, p_action: 'edit', p_body: body, p_entry: edit.id, p_revision: edit.revision }
      : { p_journal: journal, p_action: 'create', p_body: body, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, p_date: pinned ? selected : null, p_expected_date: selected };
    let receipt;
    try { receipt = await write(params); }
    catch (problem) {
      if (problem.message !== 'archive_date_changed') throw problem;
      if (scope !== sessionVersion || !confirm('The date changed. Save to ' + problem.details + '?')) {
        status('Draft kept. Choose a date in Calendar or try again.');
        return;
      }
      receipt = await write({ ...params, p_date: problem.details });
    }
    if (scope !== sessionVersion) return;
    selected = receipt.entry_date;
    pinned = selected !== iso(new Date());
    clearDraft();
    status('Saved to your shared diary.');
    await refresh().catch(() => toast('Saved. Refresh to see the latest archive.'));
  } catch (problem) {
    if (scope === sessionVersion) status(feedback(problem));
  } finally {
    busy = false;
    $('#entryText').disabled = false;
  }
}

$('#entries').onclick = async event => {
  const button = event.target.closest('[data-action]');
  const card = button?.closest('[data-entry]');
  const item = entries.find(entry => entry.id === card?.dataset.entry);
  if (!item || busy) return;
  if (button.dataset.action === 'edit') {
    if ($('#entryText').value.trim() && !confirm('Replace the current draft?')) return;
    edit = item;
    $('#entryText').value = item.text;
    $('#writerHint').textContent = 'Editing · ' + label(item.date);
    cancel.hidden = false;
    $('#entryText').focus();
  }
  if (button.dataset.action === 'history') {
    const panel = card.querySelector('.history');
    if (!panel.hidden) { panel.hidden = true; return; }
    try {
      const rows = checked(await db.from('entry_versions').select('*').eq('entry_id', item.id).order('revision'));
      panel.innerHTML = rows.map(row => `<p class="muted">Previous version ${row.revision} · ${safe(new Date(row.created_at).toLocaleString())}</p><div class="bodytext">${safe(row.body_snapshot)}</div>`).join('');
      panel.hidden = false;
    } catch { toast('Could not load history.'); }
  }
  if (button.dataset.action === 'delete' && confirm('Remove this entry from the shared diary?')) {
    const scope = sessionVersion;
    busy = true;
    try {
      await write({ p_journal: journal, p_action: 'delete', p_entry: item.id, p_revision: item.revision });
      if (scope !== sessionVersion) return;
      if (edit?.id === item.id) clearDraft();
      toast('Entry removed.');
      await refresh().catch(() => toast('Removed. Refresh to see the latest archive.'));
    } catch (problem) { if (scope === sessionVersion) toast(feedback(problem)); }
    finally { busy = false; }
  }
};

let channel, refreshTimer;

function queueRealtimeRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh().catch(() => toast('Could not sync your diary. It will retry when you return to this page.'));
  }, 200);
}

function subscribeToDiary() {
  const active = db.channel('journal:' + journal, { config: { private: true } });
  channel = active;
  active.on('broadcast', { event: 'entries_changed' }, () => {
    if (channel === active) queueRealtimeRefresh();
  }).subscribe(state => {
    if (channel !== active) return;
    if (state === 'SUBSCRIBED') queueRealtimeRefresh();
    if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
      toast('Live updates are unavailable. Return to this page to refresh.');
    }
  });
}

function hideArchive() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  const previousChannel = channel;
  channel = null;
  if (previousChannel) void db.removeChannel(previousChannel);
  ++refreshVersion;
  journal = user = pending = null;
  entries = [];
  members.clear();
  clearDraft();
  $('.layout').style.display = 'none';
  $('.top-actions').style.display = 'none';
  $('#auth').hidden = false;
  for (const id of ['entries', 'memorylist', 'calgrid', 'account']) $('#' + id).replaceChildren();
}

async function openSession(session) {
  const scope = ++sessionVersion;
  hideArchive();
  $('#login').hidden = Boolean(session && setup);
  $('#password').hidden = !session || !setup;
  if (!session) {
    authStatus(hash.has('error') || hash.has('error_code') || setup ? 'This link could not be used. Request a new password reset.' : '');
    setup = false;
    return;
  }
  if (setup) { authStatus('Choose a password for your account.'); return; }
  authStatus('Opening your diary…');
  try {
    const diaries = checked(await db.from('journals').select('id').limit(2));
    if (diaries.length !== 1) throw new Error('membership');
    const id = diaries[0].id;
    const rows = checked(await db.from('journal_members').select('user_id,writer_slot,profiles(display_name)').eq('journal_id', id));
    const me = rows.find(row => row.user_id === session.user.id);
    if (!me) throw new Error('membership');
    if (scope !== sessionVersion) return;
    journal = id;
    user = me.user_id;
    members = new Map(rows.map(row => [row.user_id, row]));
    $('#account').textContent = me.profiles?.display_name || session.user.email;
    $('#entryText').classList.toggle('writerB', me.writer_slot === 'B');
    pinned = false;
    clearDraft();
    status('Ready');
    await refresh();
    if (scope !== sessionVersion) return;
    $('#auth').hidden = true;
    $('.layout').style.display = '';
    $('.top-actions').style.display = '';
    showView('today');
    subscribeToDiary();
  } catch (problem) {
    if (scope !== sessionVersion) return;
    hideArchive();
    authStatus(problem.message === 'membership' ? 'Sign in with one of the two invited accounts.' : 'Could not open the diary. Try again.');
  }
}

$('#login').onsubmit = async event => {
  event.preventDefault();
  if (!db) return;
  const data = new FormData(event.target);
  authStatus('Signing in…');
  try {
    checked(await db.auth.signInWithPassword({ email: data.get('email'), password: data.get('password') }));
    event.target.reset();
  } catch { authStatus('Sign-in failed. Check your email and password.'); }
};
$('#reset').onclick = async () => {
  const email = $('#login').elements.email;
  if (!db || !email.value || !email.reportValidity()) { email.focus(); return; }
  try {
    checked(await db.auth.resetPasswordForEmail(email.value, { redirectTo: location.origin + location.pathname }));
    authStatus('If the account is eligible, a reset email will arrive.');
  } catch { authStatus('Could not request a reset. Try again later.'); }
};
$('#password').onsubmit = async event => {
  event.preventDefault();
  try {
    checked(await db.auth.updateUser({ password: new FormData(event.target).get('password') }));
    setup = false;
    event.target.reset();
    await openSession(checked(await db.auth.getSession()).session);
  } catch { authStatus('Could not set the password. Try again or request a new link.'); }
};
$('#logout').onclick = async () => {
  try { checked(await db.auth.signOut({ scope: 'local' })); }
  catch { toast('Could not sign out. Try again.'); }
};
$('#export').onclick = async () => {
  const scope = sessionVersion;
  try {
    await refresh();
    if (!journal || scope !== sessionVersion) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'journals-archive.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { toast('Could not export the archive.'); }
};
for (const event of ['focus', 'online']) {
  window.addEventListener(event, () => refresh().catch(() => toast('Could not refresh your diary.')));
}
if (db) {
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') setup = true;
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    if (event === 'SIGNED_IN' && user === session?.user.id && journal && !setup) return;
    setTimeout(() => openSession(session), 0);
  });
} else {
  authStatus('Could not load the sign-in service. Check your connection and reload.');
}


