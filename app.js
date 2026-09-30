/*
 * A pixel-art letter: password lock -> tear the envelope open -> letter + photos.
 * The letter and photos are encrypted in sealed.js (made by seal.mjs). The
 * password she types is the key, so nothing readable is in the repo.
 */
(() => {
  'use strict';

  // Shown one after another when the password is wrong.
  const NOPE = [
    'hmm, nie heeltemal nie. probeer weer?',
    "nee! is jy seker jy's pookie?",
    'die slot sê nee, snokkel',
    "amper (dalk). probeer nog 'n keer?",
    'spooks... dis nie reg nie',
  ];

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel) => document.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 60) : ms));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const buzz = (ms) => navigator.userActivation?.hasBeenActive !== false && navigator.vibrate?.(ms);
  // Move focus along for keyboard users only; on phones it just draws a focus ring.
  const focusIfKeyboard = (el) => matchMedia('(pointer: fine)').matches && el.focus({ preventScroll: true });

  /* ---------- pixel sprites: one character per pixel, '.' is empty ---------- */

  const PAL = {
    K: '#4a2638', W: '#ffffff', R: '#ff4d7d', r: '#d93462', P: '#ffc3d6', p: '#f497b6',
    S: '#ece7f6', s: '#aaa1c0', C: '#fff4de', c: '#f0d6ae', F: '#fffaf0',
    B: '#8ecae6', Y: '#ffd166', O: '#ff9f1c', M: '#9be3c7', V: '#dccbf7', v: '#b9a3e3', G: '#e4f3ff',
  };

  const HEART = [
    '.KK...KK.',
    'KRRK.KRRK',
    'KRWRKRRRK',
    'KRRRRRRrK',
    '.KRRRRrK.',
    '..KRRrK..',
    '...KrK...',
    '....K....',
  ];
  const SHACKLE = [
    '...KKKKKKK...',
    '..KSSSSSSSK..',
    '.KSSKKKKKSSK.',
    '.KSK.....KsK.',
    '.KSK.....KsK.',
    '.KSK.....KsK.',
    '.KsK.....KsK.',
  ];
  const LOCK = [
    'KKKKKKKKKKKKK',
    'KPPPPPPPPPPPK',
    'KPWPRRPRRPPPK',
    'KPPRWRRRRRPPK',
    'KPPPRRRRRPPPK',
    'KPPPPRRRPPPPK',
    'KPPPPPRPPPPPK',
    'KPPPPPPPPPPPK',
    'KpppppppppppK',
    'KKKKKKKKKKKKK',
  ];
  const STRIP = [ // one segment of the tear strip
    'KKKKKK',
    'CCCCCC',
    'CppCCC',
    'CCppCC',
    'CppCCC',
    'CCCCCC',
    'cccccc',
  ];
  const SPEAKER_ON = [
    '....K.....',
    '...KK...K.',
    'KKKWK.K..K',
    'KWWWK..K.K',
    'KWWWK..K.K',
    'KKKWK.K..K',
    '...KK...K.',
    '....K.....',
  ];
  const SPEAKER_OFF = [
    '....K.....',
    '...KK.....',
    'KKKWK.K..K',
    'KWWWK..KK.',
    'KWWWK..KK.',
    'KKKWK.K..K',
    '...KK.....',
    '....K.....',
  ];

  function sprite(rows, cls = '') {
    const w = rows[0].length;
    let rects = '';
    rows.forEach((row, y) => {
      for (let x = 0; x < w; ) {
        const ch = row[x];
        let run = 1;
        while (row[x + run] === ch) run++;
        if (ch !== '.') rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PAL[ch]}"/>`;
        x += run;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }
  const spriteURL = (rows) => `url("data:image/svg+xml,${encodeURIComponent(sprite(rows))}")`;

  // Envelope body below the tear strip: 60 × 37 pixels with a stepped V flap.
  function envelopeSVG() {
    const W = 60, H = 37, out = [];
    const px = (x, y, w, h, ch) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${PAL[ch]}"/>`);
    px(1, 0, W - 2, H - 1, 'C');
    px(1, H - 3, W - 2, 2, 'c');
    for (let x = 1; x < W - 1; x++) {
      const y = Math.round(19 * (1 - Math.abs(x + 0.5 - W / 2) / (W / 2 - 1)));
      if (y) px(x, 1, 1, y, 'F');
      px(x, y + 1, 1, 1, 'K');
      px(x, y + 2, 1, 1, 'c');
    }
    px(0, 0, 1, H - 1, 'K');
    px(W - 1, 0, 1, H - 1, 'K');
    px(1, H - 1, W - 2, 1, 'K');
    for (let x = 1; x < W - 1; x++) if (x % 3) px(x, 0, 1, 1, 'K'); // perforation
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">${out.join('')}</svg>`;
  }

  /* ---------- 8-bit sounds ---------- */

  const sound = (() => {
    let ctx = null;
    let on = true;
    try { on = localStorage.getItem('letter-sound') !== 'off'; } catch {}

    const wake = () => {
      try {
        ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch {}
    };
    const tone = (freq, dur, { type = 'square', vol = 0.05, at = 0, slide } = {}) => {
      if (!on || !ctx) return;
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };
    const noise = (dur, { vol = 0.14, freq = 2400 } = {}) => {
      if (!on || !ctx) return;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = buf;
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 0.7;
      gain.gain.value = vol;
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start();
    };

    return {
      wake,
      tone,
      noise,
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem('letter-sound', on ? 'on' : 'off'); } catch {}
        if (on) { wake(); tone(880, 0.08); }
      },
      key: () => tone(1100 + Math.random() * 400, 0.025, { vol: 0.02 }),
      nope: () => { tone(220, 0.12); tone(160, 0.2, { at: 0.12 }); },
      unlock: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { at: i * 0.08 })),
      rip: () => noise(0.05 + Math.random() * 0.05, { freq: 1600 + Math.random() * 1800 }),
      ripBig: () => noise(0.35, { vol: 0.2, freq: 2200 }),
      slide: () => tone(280, 0.4, { type: 'triangle', slide: 900, vol: 0.07 }),
      open: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.1, { at: i * 0.06, vol: 0.04 })),
      pop: () => tone(600 + Math.random() * 600, 0.09, { type: 'triangle', vol: 0.06, slide: 1500 }),
      puff: () => noise(0.12, { vol: 0.08, freq: 900 }),
      tada: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i === 4 ? 0.45 : 0.1, { at: i * 0.09, vol: 0.05 })),
      scratch: () => noise(0.04, { vol: 0.05, freq: 3200 + Math.random() * 1500 }),
      ding: () => { tone(1319, 0.12, { vol: 0.05 }); tone(1760, 0.25, { at: 0.1, vol: 0.05 }); },
      lid: () => tone(420, 0.14, { type: 'triangle', slide: 820, vol: 0.07 }),
      // Chiptune "Happy Birthday" (public domain). Returns how long it plays, in seconds.
      birthday() {
        if (!on || !ctx) return 0;
        const [G4, A4, B4, C5, D5, E5, F5, G5] = [392, 440, 494, 523, 587, 659, 698, 784];
        const song = [
          [G4, 0.75], [G4, 0.25], [A4, 1], [G4, 1], [C5, 1], [B4, 2],
          [G4, 0.75], [G4, 0.25], [A4, 1], [G4, 1], [D5, 1], [C5, 2],
          [G4, 0.75], [G4, 0.25], [G5, 1], [E5, 1], [C5, 1], [B4, 1], [A4, 2],
          [F5, 0.75], [F5, 0.25], [E5, 1], [C5, 1], [D5, 1], [C5, 2.5],
        ];
        const beat = 0.34;
        let at = 0;
        for (const [f, beats] of song) {
          tone(f, beats * beat * 0.9, { at, vol: 0.045 });
          at += beats * beat;
        }
        return at;
      },
    };
  })();

  /* ---------- elements ---------- */

  const scene = $('#scene');
  const strip = $('#strip');
  const lock = $('#lock');
  const miniLetter = $('#miniLetter');
  const form = $('#lockForm');
  const input = $('#pw');
  const openBtn = $('#openBtn');
  const msg = $('#msg');
  const tearHint = $('#tearHint');
  const reader = $('#reader');
  const paper = $('#paper');
  const muteBtn = $('#mute');
  const lightbox = $('#lightbox');
  const lbImg = $('#lbImg');
  const lbCap = $('#lbCap');

  /* ---------- sizing: whole-pixel envelope units so the art stays crisp ---------- */

  let lastWidth = 0;
  function fit() {
    if (innerWidth === lastWidth) return; // ignore height-only changes (mobile keyboard)
    lastWidth = innerWidth;
    const room = Math.min(innerWidth - 48, 480, ((innerHeight - 300) * 60) / 44);
    document.documentElement.style.setProperty('--u', `${clamp(Math.floor(room / 60), 3, 8)}px`);
  }

  /* ---------- decryption (must match seal.mjs) ---------- */

  const sealed = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `sealed.js?${Date.now()}`; // always the latest seal, never a cached one
    s.onload = () => (window.SEALED ? resolve(window.SEALED) : reject(new Error('empty')));
    s.onerror = () => reject(new Error('missing'));
    document.head.append(s);
  });
  sealed.catch(() => {});

  // Must match seal.mjs. Phones capitalise, and a date can be typed many ways:
  // 2003/10/30, 30-10-2003, 30 Oktober 2003 and 30102003 all become 2003-10-30.
  const MONTHS = [/^jan/, /^feb/, /^ma[ar]/, /^apr/, /^(may|mei)/, /^jun/, /^jul/, /^aug/, /^sep/, /^o[ck]t/, /^nov/, /^de[cs]/];
  const isDate = ([, m, d]) => +m >= 1 && +m <= 12 && +d >= 1 && +d <= 31;
  function asDate(s) {
    const parts = s
      .replace(/(\d)(st|nd|rd|th|ste|de)\b/g, '$1')
      .replace(/[a-z]+/g, (w) => {
        const i = MONTHS.findIndex((re) => re.test(w));
        return i < 0 ? ` ${w} ` : ` ${i + 1} `;
      })
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    let ymd = null;
    if (parts.length === 1 && /^\d{8}$/.test(parts[0])) {
      const n = parts[0];
      ymd = [n.slice(0, 4), n.slice(4, 6), n.slice(6)];
      if (!isDate(ymd)) ymd = [n.slice(4), n.slice(2, 4), n.slice(0, 2)];
    } else if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
      if (parts[0].length === 4) ymd = parts;
      else if (parts[2].length === 4) ymd = +parts[1] > 12 ? [parts[2], parts[0], parts[1]] : [parts[2], parts[1], parts[0]];
    }
    return ymd && isDate(ymd) ? ymd.map((p, i) => String(+p).padStart(i ? 2 : 4, '0')).join('-') : null;
  }
  const normalize = (pw) => {
    const s = pw.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
    return asDate(s) ?? s;
  };

  function bytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  let cipher = null;
  async function decrypt(box, password) {
    cipher ??= bytes(box.data);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalize(password)), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes(box.salt), iterations: box.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(box.iv) }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* ---------- lock screen ---------- */

  let typing = true;
  async function typeNames() {
    const el = $('#name');
    const names = el.dataset.names.split(',').map((s) => s.trim()).filter(Boolean);
    if (reduceMotion || names.length < 2) return;
    let i = 0;
    while (typing) {
      await sleep(1800);
      for (let k = names[i].length - 1; k >= 0 && typing; k--) { el.textContent = names[i].slice(0, k); await sleep(50); }
      i = (i + 1) % names.length;
      await sleep(260);
      for (let k = 1; k <= names[i].length && typing; k++) { el.textContent = names[i].slice(0, k); await sleep(110); }
    }
  }

  function restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }

  function nope(text) {
    msg.textContent = text;
    sound.nope();
    restart(form, 'nope');
    restart(lock, 'nope');
    input.select();
  }

  let attempts = 0;
  let busy = false;
  let unlocked = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || unlocked) return;
    sound.wake();
    if (!input.value.trim()) return nope('tik eers die password :)');

    busy = true;
    openBtn.disabled = true;
    const label = openBtn.textContent;
    openBtn.textContent = '...';
    try {
      const box = await sealed.catch(() => null);
      if (!box) return nope('no letter sealed yet (run: node seal.mjs)');
      if (!window.crypto?.subtle) return nope('this only opens over https or localhost');
      let data;
      try {
        data = await decrypt(box, input.value);
      } catch {
        return nope(NOPE[attempts++ % NOPE.length]);
      }
      unlocked = true;
      onUnlock(data);
    } finally {
      busy = false;
      openBtn.disabled = false;
      openBtn.textContent = label;
    }
  });

  async function onUnlock(data) {
    typing = false;
    msg.textContent = '';
    input.blur();
    sound.unlock();
    buildReader(data);
    scene.classList.add('unlocked');
    lock.classList.remove('nope');
    lock.classList.add('opening');
    await sleep(600);
    lock.classList.add('falling');
    await sleep(900);
    lock.hidden = true;
    armStrip();
  }

  function showHint(html) {
    tearHint.innerHTML = html;
    tearHint.classList.toggle('show', !!html);
  }

  /* ---------- tearing the strip ---------- */

  const SEGMENTS = 10;
  const segs = [];
  let armed = false;
  let torn = 0;
  let tick = 0;

  function buildStrip() {
    strip.style.setProperty('--seg', spriteURL(STRIP));
    let parent = strip;
    for (let i = SEGMENTS - 1; i >= 0; i--) {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.dataset.bend = 12 + ((i * 7) % 6); // slightly uneven, like real paper
      parent.append(seg);
      parent = seg;
      segs[i] = seg;
    }
    segs[0].classList.add('first');
    segs[SEGMENTS - 1].classList.add('last');
  }

  function armStrip() {
    armed = true;
    strip.classList.add('armed');
    strip.tabIndex = 0;
    focusIfKeyboard(strip);
    showHint(`${sprite(HEART, 'ico')} skeur dit nou oop! trek al langs die boonste hoek.`);
  }

  function setTear(p) {
    torn = p > 0.99 ? 1 : clamp(p, 0, 1); // 0.1 × 10 is 0.9999…, still counts as torn
    strip.classList.add('started');
    segs.forEach((seg, i) => {
      const t = clamp(torn * SEGMENTS - i, 0, 1);
      seg.style.transform = t ? `rotate(${(t * seg.dataset.bend).toFixed(2)}deg)` : '';
    });
    strip.setAttribute('aria-valuenow', Math.round(torn * 100));
    const next = Math.floor(torn * SEGMENTS * 2);
    if (next > tick) {
      tick = next;
      sound.rip();
      buzz(8);
    }
    if (torn >= 1) finishTear();
  }

  let dragging = false;
  let lastX = 0;
  strip.addEventListener('pointerdown', (e) => {
    if (!armed) return;
    e.preventDefault();
    sound.wake();
    dragging = true;
    lastX = e.clientX;
    try { strip.setPointerCapture(e.pointerId); } catch {}
  });
  strip.addEventListener('pointermove', (e) => {
    if (!dragging || !armed) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (dx > 0) setTear(torn + dx / strip.getBoundingClientRect().width);
  });
  const stopDrag = () => { dragging = false; };
  strip.addEventListener('pointerup', stopDrag);
  strip.addEventListener('pointercancel', stopDrag);
  strip.addEventListener('keydown', (e) => {
    if (!armed || !['ArrowRight', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    sound.wake();
    setTear(torn + 0.1);
  });

  async function finishTear() {
    if (!armed) return;
    armed = false;
    dragging = false;
    strip.classList.add('gone');
    strip.removeAttribute('tabindex');
    sound.ripBig();
    buzz(30);
    showHint('');
    setTimeout(() => { strip.hidden = true; }, 900);
    await sleep(400);
    miniLetter.classList.add('out');
    sound.slide();
    await sleep(1000);
    miniLetter.classList.add('ready');
    miniLetter.tabIndex = 0;
    miniLetter.setAttribute('role', 'button');
    miniLetter.setAttribute('aria-label', 'Read the letter');
    focusIfKeyboard(miniLetter);
    showHint(`kliek op die brief om dit te lees! ${sprite(HEART, 'ico')}`);
  }

  miniLetter.addEventListener('click', () => miniLetter.classList.contains('ready') && openReader());
  miniLetter.addEventListener('keydown', (e) => {
    if (miniLetter.classList.contains('ready') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openReader();
    }
  });

  /* ---------- the letter ---------- */

  const revealer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('seen');
        revealer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px' })
    : null;

  function buildReader(data) {
    renderLetter(data.letter);
    buildPhotos(data.photos || []);
    window.Extras?.build(data);
    renderCountdown();
  }

  // "<3" and ❤️ become little pixel hearts.
  function appendWithHearts(el, text) {
    text.split(/<3|\u2764\uFE0F?|\u2665\uFE0F?/).forEach((chunk, i) => {
      if (i) el.insertAdjacentHTML('beforeend', sprite(HEART, 'ico'));
      if (chunk) el.append(chunk);
    });
  }

  // Blank line = new paragraph, single newline = line break, "<3" or ❤️ = pixel heart.
  function renderLetter(text) {
    const box = $('#letter');
    box.textContent = '';
    for (const para of text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.className = 'reveal';
      para.split('\n').forEach((line, i) => {
        if (i) p.append(document.createElement('br'));
        appendWithHearts(p, line);
      });
      box.append(p);
    }
  }

  let reading = false;
  async function openReader() {
    if (reading) return;
    reading = true;
    sound.open();
    showHint('');
    scene.classList.add('leaving');
    await sleep(450);
    scene.hidden = true;
    reader.hidden = false;
    window.scrollTo(0, 0);
    paper.classList.add('unfold');
    document.querySelectorAll('.reveal').forEach((el) => (revealer ? revealer.observe(el) : el.classList.add('seen')));
  }

  /* ---------- photos: pixel polaroids that sharpen as you scroll to them ---------- */

  const TILTS = [-2.4, 1.8, -1.2, 2.2, -1.8, 1.1];
  let photos = [];
  let shown = 0;
  const scratch = document.createElement('canvas');

  function draw(item, cells) {
    const { img, canvas, crop } = item;
    const ctx = canvas.getContext('2d');
    if (!cells) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, crop.sx, crop.sy, crop.s, crop.s, 0, 0, canvas.width, canvas.height);
      return;
    }
    scratch.width = scratch.height = cells;
    const sctx = scratch.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, crop.sx, crop.sy, crop.s, crop.s, 0, 0, cells, cells);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, cells, cells, 0, 0, canvas.width, canvas.height);
  }

  async function sharpen(item) {
    for (const cells of [6, 10, 16, 28, 48, 96]) {
      draw(item, cells);
      await sleep(120);
    }
    draw(item, 0);
  }

  const photoWatcher = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        photoWatcher.unobserve(entry.target);
        sharpen(photos.find((p) => p.fig === entry.target));
      }
    }, { threshold: 0.4 })
    : null;

  async function buildPhotos(list) {
    if (!list.length) return;
    $('#photos').hidden = false;
    const grid = $('#polaroids');
    photos = list.map((p, i) => {
      const url = URL.createObjectURL(new Blob([bytes(p.data)], { type: p.type }));
      const fig = document.createElement('figure');
      fig.className = 'polaroid';
      fig.style.setProperty('--tilt', `${TILTS[i % TILTS.length]}deg`);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'polaroid-btn';
      btn.setAttribute('aria-label', p.caption ? `Open photo: ${p.caption}` : `Open photo ${i + 1}`);
      btn.addEventListener('click', () => openPhoto(i));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const cap = document.createElement('figcaption');
      cap.textContent = p.caption;
      btn.append(canvas);
      fig.append(btn, cap);
      grid.append(fig);
      return { url, caption: p.caption, fig, canvas };
    });
    lightbox.classList.toggle('single', photos.length < 2);

    for (const item of photos) {
      const img = new Image();
      img.src = item.url;
      try { await img.decode(); } catch { continue; }
      const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
      // square crop; for portrait photos aim a little above centre, where faces usually are
      item.crop = { sx: (w - s) / 2, sy: h > w ? (h - s) * 0.3 : 0, s };
      item.img = img;
      item.canvas.width = item.canvas.height = Math.min(s, 1000);
      draw(item, 6);
      if (photoWatcher) photoWatcher.observe(item.fig);
      else draw(item, 0);
    }
  }

  function openPhoto(i) {
    shown = (i + photos.length) % photos.length;
    const p = photos[shown];
    lbImg.src = p.url;
    lbImg.alt = p.caption || `photo ${shown + 1}`;
    lbCap.textContent = p.caption;
    if (!lightbox.open) lightbox.showModal();
  }
  $('#lbPrev').addEventListener('click', () => openPhoto(shown - 1));
  $('#lbNext').addEventListener('click', () => openPhoto(shown + 1));
  $('#lbClose').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
  lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') openPhoto(shown - 1);
    if (e.key === 'ArrowRight') openPhoto(shown + 1);
  });
  let swipeX = null;
  lbImg.addEventListener('pointerdown', (e) => { swipeX = e.clientX; });
  lbImg.addEventListener('pointerup', (e) => {
    if (swipeX !== null && Math.abs(e.clientX - swipeX) > 40) openPhoto(shown + (e.clientX < swipeX ? 1 : -1));
    swipeX = null;
  });

  /* ---------- ending ---------- */

  function renderCountdown() {
    const m = ($('#ending').dataset.togetherSince || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;
    const start = new Date(+m[1], m[2] - 1, +m[3]);
    const oneYear = new Date(+m[1] + 1, m[2] - 1, +m[3]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = (a, b) => Math.round((b - a) / 864e5);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const together = days(start, today);
    const left = days(today, oneYear);
    $('#countdown').textContent =
      left > 0 ? `${plural(together, 'day')} of us. one year in ${plural(left, 'day')}!`
      : left === 0 ? 'one year of us. today!'
      : `${plural(together, 'day')} of us, and counting`;
  }

  function burst(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 14; i++) {
      const h = document.createElement('div');
      h.className = 'burst';
      h.innerHTML = sprite(HEART);
      const a = Math.random() * Math.PI * 2;
      const d = 70 + Math.random() * 110;
      h.style.cssText = `left:${cx}px;top:${cy}px;--s:${12 + Math.round(Math.random() * 3) * 6}px;` +
        `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 50}px;--r:${(Math.random() - 0.5) * 90}deg`;
      h.addEventListener('animationend', () => h.remove());
      document.body.append(h);
    }
    [0, 70, 140].forEach((t) => setTimeout(sound.pop, t));
  }

  // Pixel confetti thrown up from an element, falling with a bit of gravity.
  function confetti(el, n = 70) {
    if (reduceMotion) return;
    const r = el.getBoundingClientRect();
    const colors = [PAL.R, PAL.Y, PAL.B, PAL.M, PAL.V, PAL.P, PAL.O];
    const bits = Array.from({ length: n }, (_, i) => {
      const d = document.createElement('div');
      d.className = 'confetti';
      d.style.background = colors[i % colors.length];
      document.body.append(d);
      return {
        d,
        x: r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.6,
        y: r.top + r.height * 0.4,
        vx: (Math.random() - 0.5) * 10,
        vy: -7 - Math.random() * 9,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 24,
      };
    });
    const start = performance.now();
    (function step(now) {
      const t = now - start;
      for (const b of bits) {
        b.vy += 0.38;
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.vr;
        b.d.style.transform = `translate(${b.x}px, ${b.y}px) rotate(${b.rot}deg)`;
        if (t > 1700) b.d.style.opacity = Math.max(0, 1 - (t - 1700) / 600);
      }
      if (t < 2300) requestAnimationFrame(step);
      else bits.forEach((b) => b.d.remove());
    })(start);
  }

  // Shared with extras.js (cake, jar, coupons, postcard).
  window.Pixel = { $, sprite, PAL, HEART, sound, sleep, reduceMotion, confetti, bytes, appendWithHearts };

  /* ---------- decoration ---------- */

  function floaties() {
    if (reduceMotion) return;
    const layer = $('#floaties');
    for (let i = 0; i < 14; i++) {
      const el = document.createElement('div');
      el.className = 'floaty';
      el.innerHTML = sprite(HEART);
      el.style.cssText = `left:${Math.random() * 96}%;--s:${12 + Math.round(Math.random() * 3) * 6}px;` +
        `--d:${14 + Math.random() * 14}s;--delay:${-Math.random() * 28}s;--sway:${(Math.random() - 0.5) * 90}px;` +
        `opacity:${(0.25 + Math.random() * 0.35).toFixed(2)}`;
      layer.append(el);
    }
  }

  function paintMute() {
    muteBtn.innerHTML = sprite(sound.on ? SPEAKER_ON : SPEAKER_OFF);
    muteBtn.setAttribute('aria-label', sound.on ? 'Mute sounds' : 'Turn sounds on');
  }

  /* ---------- go ---------- */

  fit();
  addEventListener('resize', fit);
  document.querySelector('link[rel=icon]').href = `data:image/svg+xml,${encodeURIComponent(sprite(HEART))}`;
  $('#envBody').innerHTML = envelopeSVG();
  $('#seal').innerHTML = sprite(HEART);
  $('#miniHeart').innerHTML = sprite(HEART);
  lock.innerHTML = sprite(SHACKLE, 'shackle') + sprite(LOCK);
  $('#bigHeart').innerHTML = sprite(HEART);
  buildStrip();
  floaties();
  paintMute();
  typeNames();

  addEventListener('pointerdown', sound.wake, { once: true });
  addEventListener('keydown', sound.wake, { once: true });
  input.addEventListener('input', sound.key);
  muteBtn.addEventListener('click', () => { sound.toggle(); paintMute(); });
  $('#bigHeart').addEventListener('click', (e) => burst(e.currentTarget));
  $('#again').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
})();
