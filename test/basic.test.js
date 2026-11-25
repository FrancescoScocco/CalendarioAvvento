'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseYouTubeId, publicDoor, isUnlocked } = require('../server');

test('Contiene 23 canzoni e una sorpresa finale', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8'));
  assert.equal(seed.length, 24);
  assert.equal(seed.filter(x => x.type !== 'finale').length, 23);
  assert.equal(seed[23].type, 'finale');
});

test('Riconosce video YouTube validi, ma non siti falsi', () => {
  assert.equal(parseYouTubeId('https://youtu.be/4fndeDfaWCg'), '4fndeDfaWCg');
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=4fndeDfaWCg&t=15'), '4fndeDfaWCg');
  assert.equal(parseYouTubeId('https://youtube.com/shorts/4fndeDfaWCg'), '4fndeDfaWCg');
  assert.equal(parseYouTubeId('https://example.com/watch?v=4fndeDfaWCg'), null);
  assert.equal(parseYouTubeId(''), '');
});

test('Uno slogan non compare pubblicamente prima dell’apertura', () => {
  const song = {day: 1, title: 'Test', artist: 'Tester', type:'song', openedAt:null,
    slogan:'Segreto!', audioFile:null, youtubeId:'4fndeDfaWCg'};
  const closed = publicDoor(song);
  assert.equal(closed.slogan, null);
  if (!closed.unlocked) {
    // Prima di dicembre la card è bloccata: niente spoiler, nemmeno con openedAt di prova.
    assert.equal(closed.title, null);
    assert.equal(publicDoor({...song, openedAt:'2026-11-20T15:00:00Z'}).slogan, null);
    return;
  }
  assert.equal(publicDoor({...song, openedAt:'2026-12-01T15:00:00Z'}).slogan, 'Segreto!');
});

test('Una apertura di prova non sblocca un giorno futuro rispetto a oggi', () => {
  // A novembre 2026 il giorno 10 deve restare chiuso anche con openedAt.
  const { year, month } = (() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    return Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  })();
  if (year < 2026 || (year === 2026 && month < 12)) {
    assert.equal(isUnlocked(10), false);
    assert.equal(publicDoor({
      day: 1, title: 'X', artist: '', type: 'song', openedAt: '2026-11-20T09:00:00Z',
      slogan: 'No', audioFile: null, youtubeId: 'abcdefghijk'
    }).unlocked, false);
  }
});

test('Una casella bloccata non espone titolo, slogan o media', () => {
  const door = publicDoor({
    day: 24, title: 'Segreta', artist: 'Band', type: 'song', openedAt: null,
    slogan: 'Non spoilerare', audioFile: 'x.mp3', youtubeId: 'abcdefghijk'
  });
  // A novembre (o per giorni futuri) la card resta senza spoiler.
  if (!door.unlocked) {
    assert.equal(door.title, null);
    assert.equal(door.slogan, null);
    assert.equal(door.youtubeId, '');
    assert.equal(door.hasMedia, false);
  } else {
    assert.equal(door.slogan, null);
    assert.equal(door.title, 'Segreta');
  }
});
