/* Small shared helpers used by the game menu, rooms and every game: text, storage, sounds, game list. */
const Core = (() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Pause for animations. A hidden page jumps straight ahead so it never holds anyone up.
  const sleep = ms => new Promise(r => setTimeout(r, document.hidden ? 0 : ms));
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // Sounds are made by the browser itself, so there are no sound files to upload.
  const sfx = (() => {
    let ctx = null, muted = lsGet('gn-muted') === true;
    const C = () => {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    };
    function tone(f, d, type, v, when, slide) {
      if (muted) return;
      const c = C(); if (!c) return;
      const t = c.currentTime + (when || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
      g.gain.setValueAtTime(v || .12, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + d + .02);
    }
    const run = (notes, gap, d, type, v) => notes.forEach((f, i) => tone(f, d, type, v, i * gap));
    return {
      tick() { tone(1100, .04, 'square', .04); },
      hop() { tone(540, .09, 'triangle', .1, 0, 330); },
      climb() { run([392, 440, 494, 587, 659, 784], .09, .12, 'triangle', .12); },
      slide() { tone(900, .9, 'sawtooth', .06, 0, 150); },
      nope() { tone(220, .25, 'sawtooth', .06, 0, 150); },
      pop() { tone(700, .12, 'sine', .1, 0, 1200); },
      turn() { run([660, 880], .1, .16, 'sine', .1); },
      win() { run([523, 659, 784, 1047, 784, 1047], .13, .24, 'triangle', .14); },
      toggle() { muted = !muted; lsSet('gn-muted', muted); return muted; },
      get muted() { return muted; },
    };
  })();

  // Every game registers itself here. `soon` entries are placeholders shown on the menu.
  const games = [];
  const register = g => games.push(g);
  const game = id => games.find(g => g.id === id);

  return { $, esc, sleep, lsGet, lsSet, lsDel, toast, sfx, games, register, game };
})();
