'use strict';

const $ = (sel) => document.querySelector(sel);
const grid = $('#calendarGrid');
const playerDialog = $('#playerDialog');
const adminDialog = $('#adminDialog');
const mediaMount = $('#mediaMount');
const icons = ['🎵', '🎤', '🎶', '🎸', '🪩', '🎧', '⭐', '🎺', '🎄', '💃', '✨', '🥁', '🎙️', '💿', '🎹', '🎷', '🕺', '🏆', '🎻', '🌙', '💋', '♥️', '👑', '🎁'];
const palettes = ['red', 'gold', 'green', 'cream', 'green', 'red', 'cream', 'gold'];
const STORAGE_KEY = 'avvento-opened-days';
const EVENT_YEAR_DEFAULT = 2026;

let doors = [];
let adminDoors = [];
let activeDay = null;
let toastTimer = null;
let openingInProgress = false;
let lockByDate = true;
let eventYear = EVENT_YEAR_DEFAULT;
let calendarToday = null;
let staticMode = false;
let staticCatalog = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;'
  }[c]));
}

function romeDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
}

function demoUnlocked() {
  return new URLSearchParams(location.search).has('demo');
}

function isDayUnlocked(day) {
  // Ad ogni refresh: conta solo la data odierna (Europe/Rome), non aperture di prova.
  if (!lockByDate || demoUnlocked()) return true;
  const { year, month, day: today } = calendarToday || romeDate();
  if (year > eventYear) return true;
  if (year < eventYear) return false;
  return month === 12 && today >= day;
}

function readOpenedMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeOpenedMap(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function toPublicDoor(raw) {
  const unlocked = isDayUnlocked(raw.day);
  if (!unlocked) {
    return {
      day: raw.day,
      title: null,
      artist: null,
      type: raw.type === 'finale' ? 'finale' : 'song',
      opened: false,
      openedAt: null,
      unlocked: false,
      slogan: null,
      youtubeId: '',
      audioUrl: null,
      hasMedia: false
    };
  }
  const openedAt = raw.openedAt || null;
  const opened = Boolean(openedAt);
  return {
    day: raw.day,
    title: raw.title,
    artist: raw.artist,
    type: raw.type || 'song',
    opened,
    openedAt,
    unlocked: true,
    slogan: opened ? (raw.slogan || null) : null,
    youtubeId: raw.youtubeId || '',
    audioUrl: raw.audioFile ? `/media/${encodeURIComponent(raw.audioFile)}` : null,
    hasMedia: Boolean(raw.audioFile || raw.youtubeId)
  };
}

function pruneOpenedMap() {
  const map = readOpenedMap();
  let changed = false;
  for (const key of Object.keys(map)) {
    const day = Number(key);
    if (!Number.isInteger(day) || !isDayUnlocked(day)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writeOpenedMap(map);
  return map;
}

function buildStaticPayload() {
  // Ricalcola sempre la data a ogni refresh/avvio.
  calendarToday = romeDate();
  lockByDate = !demoUnlocked();
  eventYear = EVENT_YEAR_DEFAULT;
  const openedMap = pruneOpenedMap();
  const all = staticCatalog.map((item) => {
    const openedAt = isDayUnlocked(item.day) ? (openedMap[String(item.day)] || null) : null;
    return toPublicDoor({ ...item, openedAt, audioFile: null });
  });
  return {
    doors: all,
    lockByDate,
    eventYear,
    today: calendarToday
  };
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
  if (!doors.length) {
    const empty = document.createElement('div');
    empty.className = 'loading-grid';
    empty.textContent = 'Nessuna casella da mostrare.';
    fragment.appendChild(empty);
  } else {
    doors.forEach((door) => {
      const button = document.createElement('button');
      button.type = 'button';
      const locked = !door.unlocked;
      button.className = 'door'
        + (door.opened ? ' opened' : '')
        + (locked ? ' locked' : '');
      button.dataset.color = palettes[(door.day - 1) % palettes.length];
      button.dataset.finale = String(door.type === 'finale');
      button.dataset.day = String(door.day);
      button.setAttribute(
        'aria-label',
        `${door.day} dicembre: ${
          door.opened ? 'casella già aperta' : locked ? 'casella ancora bloccata' : 'apri la casella'
        }${door.opened && door.title ? ` - ${door.title}` : ''}`
      );
      if (locked) {
        button.setAttribute('aria-disabled', 'true');
        button.innerHTML = `
          <span class="door-number">${door.day}</span>
          <span class="door-symbol" aria-hidden="true">🔒</span>
          <span class="door-bottom">${door.type === 'finale' ? 'Gran finale' : 'In arrivo'}</span>`;
      } else if (door.opened) {
        button.innerHTML = `
          <span class="door-number">${door.day}</span>
          <span class="door-symbol" aria-hidden="true">${door.type === 'finale' ? '🎄' : '♫'}</span>
          <span class="door-title">${escapeHtml(door.title)}</span>
          <span class="door-slogan">${escapeHtml(door.slogan || 'Slogan non ancora inserito')}</span>
          <span class="door-bottom">${door.type === 'finale' ? 'Buon Natale!' : '♪ Riascolta'}</span>`;
      } else {
        button.innerHTML = `
          <span class="door-number">${door.day}</span>
          <span class="door-symbol" aria-hidden="true">${icons[door.day - 1]}</span>
          <span class="door-bottom">${door.type === 'finale' ? 'Gran finale' : 'Scopri'}</span>`;
      }
      button.addEventListener('click', () => openDoor(door.day));
      fragment.appendChild(button);
    });
  }
  grid.replaceChildren(fragment);
  const count = doors.filter(d => d.type !== 'finale' && d.opened).length;
  const unlockedSongs = doors.filter(d => d.type !== 'finale' && d.unlocked).length;
  $('#progressLabel').textContent = count === 23
    ? 'Tutte le canzoni scoperte! 🎉'
    : lockByDate && unlockedSongs > 0 && unlockedSongs < 23
      ? `${count} scoperte · oggi puoi aprire fino al giorno ${unlockedSongs}`
      : lockByDate && unlockedSongs === 0
        ? `In attesa del 1 dicembre ${eventYear}`
        : `${count} canzon${count === 1 ? 'e scoperta' : 'i scoperte'}`;
  $('#progressFraction').textContent = `${count} / 23`;
  $('#progressFill').style.width = `${count / 23 * 100}%`;
  $('#progressTrack').setAttribute('aria-valuenow', String(count));
  const tip = document.querySelector('.legend-tip');
  if (tip) {
    tip.textContent = lockByDate && !demoUnlocked()
      ? '♪ I giorni futuri restano chiusi'
      : '♪ Clicca su un numero per ascoltare';
  }
}

function applyCalendarResult(result) {
  doors = result.doors;
  lockByDate = Boolean(result.lockByDate);
  eventYear = Number(result.eventYear) || eventYear;
  calendarToday = result.today || romeDate();
  renderDoors();
  if (activeDay) {
    const current = doors.find(d => d.day === activeDay);
    if (current && current.opened) updatePlayerText(current);
    else if (!current) closePlayer();
  }
}

async function loadStaticCatalog() {
  const response = await fetch('calendar-data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Dati del calendario non trovati.');
  staticCatalog = await response.json();
  if (!Array.isArray(staticCatalog) || !staticCatalog.length) {
    throw new Error('Dati del calendario non validi.');
  }
}

async function refreshCalendar(silent = false) {
  try {
    if (staticMode) {
      // Modalità Pages: ricontrolla sempre la data odierna.
      applyCalendarResult(buildStaticPayload());
      return;
    }
    const result = await api('/api/calendar');
    staticMode = false;
    // Il backend ricalcola unlocked con la data di oggi a ogni richiesta.
    applyCalendarResult(result);
  } catch (e) {
    try {
      if (!staticCatalog.length) await loadStaticCatalog();
      staticMode = true;
      applyCalendarResult(buildStaticPayload());
      if (!silent && demoUnlocked()) {
        toast('Anteprima demo: tutte le caselle sono visibili.');
      }
    } catch (fallbackError) {
      if (!silent) {
        grid.innerHTML = '<div class="loading-grid">Impossibile caricare il calendario.</div>';
        toast(fallbackError.message || e.message);
      }
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
  if (door.audioUrl && !staticMode) {
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
    toast(`La casella ${day} si sblocca il ${day} dicembre ${eventYear}.`);
    return;
  }
  if (door.type !== 'finale' && !door.hasMedia && !door.opened) {
    toast('L’organizzatore deve ancora associare una canzone a questa casella.');
    return;
  }
  activeDay = day;
  playerDialog.showModal();
  updatePlayerText(door, !door.opened);
  createPlayer(door);
  if (door.opened) return;
  openingInProgress = true;
  try {
    if (staticMode) {
      const openedAt = new Date().toISOString();
      const map = readOpenedMap();
      map[String(day)] = openedAt;
      writeOpenedMap(map);
      const raw = staticCatalog.find((d) => d.day === day) || {};
      const updated = toPublicDoor({ ...raw, openedAt, audioFile: null });
      doors = doors.map((d) => d.day === day ? updated : d);
      renderDoors();
      updatePlayerText(updated);
    } else {
      const result = await api(`/api/doors/${day}/open`, { method:'POST' });
      doors = doors.map(d => d.day === day ? result.door : d);
      renderDoors();
      updatePlayerText(result.door);
    }
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
  mediaMount.replaceChildren();
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
  if (staticMode) {
    toast('Su GitHub Pages la gestione è disattivata. Avvia node server.js in locale per modificare slogan e canzoni.');
    return;
  }
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
setInterval(() => { if (!document.hidden) refreshCalendar(true); }, 15000);
