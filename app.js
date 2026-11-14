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

const bucket = () => db.storage.from('journal-photos');
let draftPhotos = [];
let processingPhotos = false;
const imageUrls = new Map();

function clearImageUrls() {
  for (const url of imageUrls.keys()) URL.revokeObjectURL(url);
  imageUrls.clear();
}

function releaseRemovedImages() {
  for (const [url, image] of imageUrls) {
    if (image.isConnected) continue;
    URL.revokeObjectURL(url);
    imageUrls.delete(url);
  }
}

async function showPhoto(container, photo) {
  const img = document.createElement('img');
  img.alt = 'Journal photograph';
  container.append(img);
  try {
    const blob = photo.blob || checked(await bucket().download(photo.object_path));
    if (!img.isConnected) return;
    const url = URL.createObjectURL(blob);
    imageUrls.set(url, img);
    img.src = url;
  } catch {
    if (img.isConnected) img.replaceWith('Photograph unavailable');
  }
}

function renderDraftPhotos() {
  $('#pending').replaceChildren();
  draftPhotos.forEach((photo, index) => {
    const preview = document.createElement('div');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'action';
    remove.textContent = 'Remove';
    remove.onclick = () => {
      if (busy || processingPhotos) return;
      draftPhotos.splice(index, 1);
      renderDraftPhotos();
    };
    $('#pending').append(preview);
    void showPhoto(preview, photo);
    preview.append(remove);
  });
}

async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob || blob.size > 5242880) throw new Error('invalid_photo');
  return blob;
}

$('#photoInput').onchange = async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!journal || busy || processingPhotos) return;
  if (files.length + draftPhotos.length > 8) {
    status('Choose up to eight photographs per entry.');
    return;
  }
  const scope = sessionVersion;
  processingPhotos = true;
  status('Preparing photographs…');
  let failed = false;
  try {
    for (const file of files) {
      try {
        const blob = await compressPhoto(file);
        if (scope !== sessionVersion) return;
        draftPhotos.push({ id: crypto.randomUUID(), blob });
      } catch { failed = true; }
    }
    renderDraftPhotos();
    status(failed ? 'Some photographs could not be opened.' : 'Photographs ready to save.');
  } finally { processingPhotos = false; }
};

async function uploadDraftPhotos(scope) {
  for (const photo of draftPhotos) {
    if (!photo.blob || photo.uploaded) continue;
    if (scope !== sessionVersion) throw new Error('session_changed');
    const path = journal + '/' + user + '/' + photo.id + '.jpg';
    const result = await bucket().upload(path, photo.blob, { contentType: 'image/jpeg' });
    if (result.error && String(result.error.statusCode) !== '409') checked(result);
    photo.uploaded = true;
  }
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
  releaseRemovedImages();
  records.forEach((item, index) => {
    const card = $('#entries').children[index];
    card.dataset.entry = item.id;
    if (!item.photos.length) return;
    const gallery = document.createElement('div');
    gallery.className = 'photos';
    card.append(gallery);
    for (const photo of item.photos) {
      const frame = document.createElement('figure');
      frame.className = 'photo';
      gallery.append(frame);
      void showPhoto(frame, photo);
    }
  });
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
  draftPhotos = [];
  renderDraftPhotos();
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
    const page = checked(await db.from('entries').select('*,entry_photos(id,object_path,position)').eq('journal_id', diary).order('id').range(start, start + 499));
    rows.push(...page);
    if (page.length < 500) break;
  }
  if (version !== refreshVersion || diary !== journal) return;
  entries = rows.map(row => ({
    ...row, photos: [...row.entry_photos].sort((a, b) => a.position - b.position), date: row.entry_date, created: Date.parse(row.created_at), text: row.body,
    name: members.get(row.author_id)?.profiles?.display_name || 'Writer',
    writer: members.get(row.author_id)?.writer_slot || 'A'
  }));
  if (!pinned && !edit && !draftPhotos.length && !processingPhotos && !$('#entryText').value.trim()) selected = iso(new Date());
  renderEntries();
  if ($('#view-calendar').classList.contains('active')) renderCalendar();
  if ($('#view-memories').classList.contains('active')) renderMemories();
}

async function write(params) {
  const signature = JSON.stringify(params);
  if (pending && pending.signature !== signature) {
    const previous = pending;
    const result = await db.rpc('write_photo_entry', previous.params);
    if (!result.error || result.error.code === 'P0001' || result.error.code === '42501') pending = null;
    checked(result);
    await refresh();
    throw new Error('previous_save_confirmed');
  }
  pending ||= { signature, params: { ...params, p_request: crypto.randomUUID() } };
  const result = await db.rpc('write_photo_entry', pending.params);
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
  if (!journal || busy || processingPhotos || (!body && !draftPhotos.length)) return;
  const scope = sessionVersion;
  busy = true;
  $('#entryText').disabled = true;
  status('Saving…');
  try {
    const params = edit
      ? { p_journal: journal, p_action: 'edit', p_body: body, p_entry: edit.id, p_revision: edit.revision }
      : { p_journal: journal, p_action: 'create', p_body: body, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, p_date: pinned ? selected : null, p_expected_date: selected };
    await uploadDraftPhotos(scope);
    if (scope !== sessionVersion) return;
    params.p_photos = draftPhotos.map(photo => photo.id);
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
  if (!item || busy || processingPhotos) return;
  if (button.dataset.action === 'edit') {
    if ($('#entryText').value.trim() && !confirm('Replace the current draft?')) return;
    edit = item;
    draftPhotos = item.photos.slice();
    renderDraftPhotos();
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
  clearImageUrls();
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
function photoDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

$('#export').onclick = async () => {
  const scope = sessionVersion;
  const button = $('#export');
  button.disabled = true;
  try {
    await refresh();
    if (!journal || scope !== sessionVersion) return;
    const archive = [];
    for (const entry of entries.slice()) {
      if (scope !== sessionVersion) return;
      const versions = [];
      for (let start = 0; ; start += 500) {
        const page = checked(await db.from('entry_versions').select('*')
          .eq('entry_id', entry.id).order('revision').range(start, start + 499));
        versions.push(...page);
        if (page.length < 500) break;
      }
      const photos = [];
      for (const photo of entry.photos) {
        if (scope !== sessionVersion) return;
        const blob = checked(await bucket().download(photo.object_path));
        photos.push({ ...photo, data_url: await photoDataUrl(blob) });
      }
      archive.push({
        id: entry.id, author_id: entry.author_id, author_name: entry.name,
        writer_slot: entry.writer, body: entry.body, entry_date: entry.entry_date,
        author_timezone: entry.author_timezone, author_utc_offset_minutes: entry.author_utc_offset_minutes,
        created_at: entry.created_at, updated_at: entry.updated_at, revision: entry.revision,
        versions, photos
      });
    }
    if (scope !== sessionVersion) return;
    const backup = { format: 'journals-backup', version: 1, exported_at: new Date().toISOString(), entries: archive };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'journals-backup-' + iso(new Date()) + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Journal backup downloaded.');
  } catch {
    if (scope === sessionVersion) toast('Backup could not be completed. Please retry.');
  } finally {
    button.disabled = false;
  }
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





