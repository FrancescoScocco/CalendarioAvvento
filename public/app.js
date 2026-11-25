'use strict';

const $ = (sel) => document.querySelector(sel);
const grid = $('#calendarGrid');
const playerDialog = $('#playerDialog');
const adminDialog = $('#adminDialog');
const mediaMount = $('#mediaMount');
const icons = ['🎵', '🎤', '🎶', '🎸', '🪩', '🎧', '⭐', '🎺', '🎄', '💃', '✨', '🥁', '🎙️', '💿', '🎹', '🎷', '🕺', '🏆', '🎻', '🌙', '💋', '♥️', '👑', '🎁'];
const palettes = ['red', 'gold', 'green', 'cream', 'green', 'red', 'cream', 'gold'];
let doors = [];
let adminDoors = [];
let activeDay = null;
let toastTimer = null;
let openingInProgress = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;'
  }[c]));
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Errore HTTP ${response.status}`);
  return result;
}

function jsonOptions(method, body) {
  return { method, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) };
}

function toast(text) {
  const box = $('#toast');
  box.textContent = text;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 4200);
}

function renderDoors() {
  const fragment = document.createDocumentFragment();
  doors.forEach((door) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'door' + (door.opened ? ' opened' : '') + (!door.unlocked ? ' locked' : '');
    button.dataset.color = palettes[(door.day - 1) % palettes.length];
    button.dataset.finale = String(door.type === 'finale');
    button.dataset.day = String(door.day);
    button.setAttribute('aria-label', `${door.day} dicembre: ${door.opened ? 'casella già aperta' : door.unlocked ? 'apri la casella' : 'casella bloccata'}${door.opened ? ' - ' + door.title : ''}`);
    if (door.opened) {
      button.innerHTML = `
        <span class="door-number">${door.day}</span>
        <span class="door-symbol" aria-hidden="true">${door.type === 'finale' ? '🎄' : '♫'}</span>
        <span class="door-title">${escapeHtml(door.title)}</span>
        <span class="door-slogan">${escapeHtml(door.slogan || 'Slogan non ancora inserito')}</span>
        <span class="door-bottom">${door.type === 'finale' ? 'Buon Natale!' : '♪ Riascolta'}</span>`;
    } else {
      button.innerHTML = `
        <span class="door-number">${door.day}</span>
        <span class="door-symbol" aria-hidden="true">${door.unlocked ? icons[door.day - 1] : '🔒'}</span>
        <span class="door-bottom">${door.type === 'finale' ? 'Gran finale' : door.unlocked ? 'Scopri' : 'In arrivo'}</span>`;
    }
    button.addEventListener('click', () => openDoor(door.day));
    fragment.appendChild(button);
  });
  grid.replaceChildren(fragment);
  const count = doors.filter(d => d.type !== 'finale' && d.opened).length;
  $('#progressLabel').textContent = count === 23 ? 'Tutte le canzoni scoperte! 🎉' : `${count} canzon${count === 1 ? 'e scoperta' : 'i scoperte'}`;
  $('#progressFraction').textContent = `${count} / 23`;
  $('#progressFill').style.width = `${count / 23 * 100}%`;
  $('#progressTrack').setAttribute('aria-valuenow', String(count));
}

async function refreshCalendar(silent = false) {
  try {
    const result = await api('/api/calendar');
    doors = result.doors;
    renderDoors();
    if (activeDay) {
      const current = doors.find(d => d.day === activeDay);
      if (current && current.opened) updatePlayerText(current);
    }
  } catch (e) {
    if (!silent) {
      grid.innerHTML = '<div class="loading-grid">Impossibile connettersi al backend. Avvia il progetto con <strong>node server.js</strong>.</div>';
      toast(e.message);
    }
  }
}

function updatePlayerText(door, pending = false) {
  $('#playerDay').textContent = `${door.day} DICEMBRE`;
  $('#playerTitle').textContent = door.title;
  $('#playerArtist').textContent = door.artist || '';
  $('#playerSlogan').textContent = pending
    ? 'Apriamo la sorpresa…'
    : door.slogan || (door.type === 'finale' ? 'Buon Natale!' : 'Lo slogan non è stato ancora inserito dall’organizzatore.');
}

function createPlayer(door) {
  mediaMount.replaceChildren();
  const hint = $('#playerHint');
  hint.textContent = '';
  if (door.type === 'finale') {
    const stars = document.createElement('div');
    stars.textContent = '🎄 ✨ 🎁 ✨ 🎄';
    stars.style.fontSize = '36px';
    mediaMount.append(stars);
    return;
  }
  // File audio locale: riproduzione su click, con i controlli nativi.
  if (door.audioUrl) {
    const audio = document.createElement('audio');
    audio.className = 'audio-player';
    audio.src = door.audioUrl;
    audio.controls = true;
    audio.autoplay = true;
    audio.preload = 'auto';
    mediaMount.append(audio);
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => { hint.textContent = 'Se l’audio non parte automaticamente, premi ▶ nel lettore.'; });
    }
    return;
  }
  // YouTube è servito dal sito originale, senza scaricare o distribuire il brano.
  if (door.youtubeId) {
    const shell = document.createElement('div');
    shell.className = 'video-shell';
    const frame = document.createElement('iframe');
    frame.title = `Riproduci ${door.title}`;
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(door.youtubeId)}?autoplay=1&playsinline=1&rel=0`;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    shell.appendChild(frame);
    mediaMount.appendChild(shell);
    hint.append('Se l’avvio automatico viene bloccato, premi ▶ nel video. ');
    const link = document.createElement('a');
    link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(door.youtubeId)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Apri su YouTube';
    hint.append(link);
    return;
  }
  hint.textContent = 'Il brano non è ancora stato configurato. L’organizzatore può aggiungere un link YouTube o un file audio.';
}

async function openDoor(day) {
  if (openingInProgress) return;
  const door = doors.find(d => d.day === day);
  if (!door) return;
  if (!door.unlocked) {
    toast(`La casella ${day} si sblocca il ${day} dicembre.`);
    return;
  }
  if (door.type !== 'finale' && !door.hasMedia && !door.opened) {
    toast('L’organizzatore deve ancora associare una canzone a questa casella.');
    return;
  }
  activeDay = day;
  playerDialog.showModal();
  updatePlayerText(door, !door.opened);
  createPlayer(door); // Crea subito il lettore, direttamente al click dell’utente.
  if (door.opened) return;
  openingInProgress = true;
  try {
    const result = await api(`/api/doors/${day}/open`, { method:'POST' });
    doors = doors.map(d => d.day === day ? result.door : d);
    renderDoors();
    updatePlayerText(result.door);
  } catch (e) {
    toast(`Casella non aperta: ${e.message}`);
    playerDialog.close();
    await refreshCalendar(true);
  } finally { openingInProgress = false; }
}

function closePlayer() { if (playerDialog.open) playerDialog.close(); }
$('#closePlayer').addEventListener('click', closePlayer);
$('#returnCalendar').addEventListener('click', closePlayer);
playerDialog.addEventListener('close', () => {
  activeDay = null;
  mediaMount.replaceChildren(); // Interrompe audio/video; NON richiude la casella.
});
playerDialog.addEventListener('click', (e) => { if (e.target === playerDialog) closePlayer(); });

function getSelectedAdminDoor() {
  return adminDoors.find(d => d.day === Number($('#daySelect').value));
}

function fillEditor() {
  const door = getSelectedAdminDoor();
  if (!door) return;
  $('#songTitleInput').value = door.title || '';
  $('#songArtistInput').value = door.artist || '';
  $('#songSloganInput').value = door.slogan || '';
  $('#sloganCounter').textContent = String((door.slogan || '').length);
  $('#youtubeInput').value = door.youtubeId ? `https://www.youtube.com/watch?v=${door.youtubeId}` : '';
  $('#youtubeField').hidden = door.type === 'finale';
  $('#uploadBox').hidden = door.type === 'finale';
  $('#openState').textContent = door.openedAt
    ? `✓ Casella aperta definitivamente il ${new Date(door.openedAt).toLocaleString('it-IT')}.`
    : '◌ Casella ancora da aprire.';
  $('#audioInput').value = '';
  $('#removeAudio').hidden = !door.audioFile;
  $('#audioStatus').textContent = door.audioFile
    ? '✓ Audio caricato: verrà riprodotto al posto del video YouTube.'
    : door.youtubeId ? '♫ È presente un link video YouTube.' : '⚠ Nessun audio associato. Prima di aprire la casella, aggiungi un brano.';
}

async function loadAdminEditor() {
  const result = await api('/api/admin/doors');
  adminDoors = result.doors;
  $('#loginForm').hidden = true;
  $('#adminEditor').hidden = false;
  const select = $('#daySelect');
  const previous = Number(select.value) || 1;
  select.replaceChildren();
  for (const d of adminDoors) {
    const opt = document.createElement('option');
    opt.value = String(d.day);
    opt.textContent = `${String(d.day).padStart(2, '0')} · ${d.title}`;
    select.append(opt);
  }
  select.value = String(previous);
  fillEditor();
}

async function openAdmin() {
  adminDialog.showModal();
  try {
    const result = await api('/api/admin/me');
    if (result.loggedIn) await loadAdminEditor();
    else {
      $('#loginForm').hidden = false;
      $('#adminEditor').hidden = true;
      $('#passwordInput').focus();
    }
  } catch(e) { toast(e.message); }
}
$('#adminButton').addEventListener('click', openAdmin);
$('#closeAdmin').addEventListener('click', () => adminDialog.close());
adminDialog.addEventListener('click', (e) => { if (e.target === adminDialog) adminDialog.close(); });
$('#daySelect').addEventListener('change', fillEditor);
$('#songSloganInput').addEventListener('input', (e) => { $('#sloganCounter').textContent = String(e.target.value.length); });

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    await api('/api/admin/login', jsonOptions('POST', { password:$('#passwordInput').value }));
    $('#passwordInput').value = '';
    await loadAdminEditor();
    toast('Accesso effettuato. Puoi modificare slogan e canzoni.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#songForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const door = getSelectedAdminDoor();
  if (!door) return;
  const button = $('#saveSong');
  button.disabled = true;
  try {
    await api(`/api/admin/doors/${door.day}`, jsonOptions('PATCH', {
      title: $('#songTitleInput').value,
      artist: $('#songArtistInput').value,
      slogan: $('#songSloganInput').value,
      youtubeUrl: door.type === 'finale' ? '' : $('#youtubeInput').value
    }));
    await loadAdminEditor();
    await refreshCalendar(true);
    toast(`Casella ${door.day} aggiornata e salvata sul server.`);
  } catch(error) { toast(error.message); }
  finally { button.disabled = false; }
});

$('#uploadAudio').addEventListener('click', async () => {
  const door = getSelectedAdminDoor();
  const file = $('#audioInput').files[0];
  if (!door || !file) return toast('Seleziona un file audio prima di caricarlo.');
  if (file.size > 30 * 1024 * 1024) return toast('Il file supera il limite di 30 MB.');
  const button = $('#uploadAudio');
  button.disabled = true;
  button.textContent = 'Caricamento…';
  try {
    await api(`/api/admin/doors/${door.day}/audio`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name)
      },
      body: file
    });
    await loadAdminEditor();
    await refreshCalendar(true);
    toast(`Audio caricato per la casella ${door.day}.`);
  } catch(error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Carica audio'; }
});

$('#removeAudio').addEventListener('click', async () => {
  const door = getSelectedAdminDoor();
  if (!door) return;
  try {
    await api(`/api/admin/doors/${door.day}/audio`, { method:'DELETE' });
    await loadAdminEditor();
    await refreshCalendar(true);
    toast('Audio eliminato. Verrà usato YouTube, se configurato.');
  } catch(error) { toast(error.message); }
});

$('#logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method:'POST' });
    $('#adminEditor').hidden = true;
    $('#loginForm').hidden = false;
    toast('Uscita dalla gestione effettuata.');
  } catch(error) { toast(error.message); }
});

refreshCalendar();
// Condivisione delle aperture: altre persone vedranno le caselle scoperte.
setInterval(() => { if (!document.hidden) refreshCalendar(true); }, 15000);
