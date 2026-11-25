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
  assert.equal(publicDoor(song).slogan, null);
  assert.equal(publicDoor({...song, openedAt:'2026-12-01T15:00:00Z'}).slogan, 'Segreto!');
});

test('Le caselle aperte restano accessibili anche con il blocco data', () => {
  assert.equal(isUnlocked(10, '2026-12-10T10:00:00Z'), true);
});
