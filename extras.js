/*
 * The surprises after the letter: a cake to blow out, a jar of notes, coupons
 * that WhatsApp you, and a scratch-off postcard. Each one only shows up if its
 * content was sealed (see seal.mjs). Helpers come from app.js via window.Pixel.
 */
(() => {
  'use strict';

  const { $, sprite, PAL, HEART, sound, sleep, reduceMotion, confetti, bytes, appendWithHearts } = window.Pixel;

  // Builds an SVG out of rectangles; px(x, y, w, h, colour, opacity?).
  function pixels(W, H, draw, cls = '') {
    const out = [];
    const px = (x, y, w, h, c, opacity) =>
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${PAL[c] || c}"${opacity ? ` fill-opacity="${opacity}"` : ''}/>`);
    draw(px, out);
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">${out.join('')}</svg>`;
  }

  // Fills a shape given as [x0, x1] spans per row, outlining its edge in ink.
  function shape(px, rows, fill) {
    const inside = (x, y) => y >= 0 && y < rows.length && x >= rows[y][0] && x <= rows[y][1];
    rows.forEach(([x0, x1], y) => {
      for (let x = x0; x <= x1; x++) {
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        px(x, y, 1, 1, edge ? 'K' : fill);
      }
    });
  }

  function onceVisible(el, fn, threshold = 0.5, rootMargin = '0px') {
    if (!('IntersectionObserver' in window)) return fn();
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fn();
    }, { threshold, rootMargin });
    io.observe(el);
  }

  function restart(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  const STAR = [
    '...YY...',
    '...YY...',
    'YYYYYYYY',
    '.YYYYYY.',
    '..YYYY..',
    '.YY..YY.',
    'YY....YY',
  ];

  /* ================= the cake ================= */

  const CANDLE_COLOURS = ['B', 'Y', 'M', 'R', 'V'];

  // 64 × 52 two-tier cake; candles alternate between a back and a front row.
  function cakeSVG(count) {
    const drip = (x) => [3, 2, 1, 1, 2, 3, 4, 2, 1, 1, 1, 2][x % 12];
    const start = 32 - (count - 1);
    return pixels(64, 52, (px, out) => {
      px(0, 49, 64, 1, 'S');
      px(1, 50, 62, 1, 's');
      px(2, 51, 60, 1, 'K');
      px(0, 49, 1, 1, 'K');
      px(63, 49, 1, 1, 'K');

      px(2, 34, 60, 15, 'K'); // bottom tier
      px(3, 35, 58, 2, 'W');
      px(3, 37, 58, 11, 'V');
      px(58, 37, 3, 11, 'v');
      for (let x = 3; x < 61; x++) px(x, 37, 1, drip(x + 5), 'W');
      for (let x = 5; x < 58; x += 3) px(x, 42 + (x % 2), 1, 1, ['R', 'Y', 'B', 'M'][x % 4]);
      for (let x = 3; x < 61; x++) if (x % 3) px(x, 46, 1, 1, 'W');

      px(6, 18, 52, 17, 'K'); // top tier
      px(7, 19, 50, 4, 'W');
      px(7, 23, 50, 11, 'P');
      px(54, 23, 3, 11, 'p');
      for (let x = 7; x < 57; x++) px(x, 23, 1, drip(x), 'W');
      for (let x = 10; x < 52; x += 8) {
        px(x, 28, 1, 1, 'R');
        px(x + 2, 28, 1, 1, 'R');
        px(x, 29, 3, 1, 'R');
        px(x + 1, 30, 1, 1, 'R');
      }

      for (let i = 0; i < count; i++) {
        const x = start + i * 2;
        const top = i % 2 ? 16 : 14;
        const colour = CANDLE_COLOURS[i % CANDLE_COLOURS.length];
        out.push(`<g class="candle" style="--d:${((i * 0.137) % 0.5).toFixed(2)}s">`);
        for (let y = 0; y < 6; y++) px(x, top + y, 1, 1, y % 2 ? 'W' : colour);
        px(x, top - 1, 1, 1, 'K');
        out.push('<g class="lean"><g class="flame">');
        px(x, top - 4, 1, 1, 'Y');
        px(x - 1, top - 3, 3, 1, 'Y');
        px(x, top - 3, 1, 2, 'O');
        out.push('</g></g><g class="smoke">');
        px(x, top - 3, 1, 1, 'S');
        px(x + 1, top - 5, 1, 1, 's');
        px(x, top - 7, 1, 1, 'S');
        out.push('</g></g>');
      }
    }, 'cake-art');
  }

  function buildCake(count) {
    const art = $('#cake');
    const msg = $('#cakeMsg');
    const micBtn = $('#micBtn');
    const relight = $('#relightBtn');
    const hintText = msg.textContent;
    $('#cakeSection').hidden = false;
    art.innerHTML = cakeSVG(count);
    const svg = art.querySelector('svg');
    const candles = [...svg.querySelectorAll('.candle')];

    let lit = new Set(candles);
    let holding = false;
    let micBlowing = false;
    let mic = null;
    let raf = 0;
    let lastPuff = 0;
    let songUntil = 0;

    const blowing = () => holding || (micBlowing && performance.now() > songUntil);
    function loop(now) {
      const b = blowing();
      svg.classList.toggle('windy', b);
      if (b && now - lastPuff > 85) {
        lastPuff = now;
        puff();
      }
      raf = lit.size && (holding || mic) ? requestAnimationFrame(loop) : 0;
      if (!raf) svg.classList.remove('windy');
    }
    const run = () => { if (!raf && lit.size) raf = requestAnimationFrame(loop); };

    function puff() {
      const left = [...lit];
      const candle = left[Math.floor(Math.random() * left.length)];
      candle.classList.add('out');
      lit.delete(candle);
      if (!mic) sound.puff(); // with the mic on, our own sounds could count as blowing
      if (!lit.size) celebrate();
    }

    function celebrate() {
      holding = false;
      stopMic();
      msg.textContent = "maak 'n wens!";
      micBtn.hidden = true;
      relight.hidden = false;
      sound.tada();
      confetti(art);
    }

    relight.addEventListener('click', () => {
      candles.forEach((c) => c.classList.remove('out'));
      lit = new Set(candles);
      msg.textContent = hintText;
      relight.hidden = true;
      micBtn.hidden = false;
      micBtn.disabled = false;
    });

    // Holding a finger (or Space) on the cake blows too: no microphone needed.
    art.addEventListener('pointerdown', () => {
      if (!lit.size) return;
      holding = true;
      sound.wake();
      run();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) art.addEventListener(type, () => { holding = false; });
    art.addEventListener('contextmenu', (e) => e.preventDefault());
    art.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && lit.size) {
        e.preventDefault();
        holding = true;
        run();
      }
    });
    art.addEventListener('keyup', () => { holding = false; });

    micBtn.addEventListener('click', async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        msg.textContent = 'die mikrofoon werk nie hier nie, hou eerder jou vinger op die koek';
        return;
      }
      micBtn.disabled = true;
      const ctx = new (window.AudioContext || window.webkitAudioContext)(); // created inside the tap, for iOS
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        });
        await ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let frames = 0;
        let floor = 0;
        mic = { stream, ctx };
        micBtn.hidden = true;
        msg.textContent = 'blaas!';
        const listen = () => {
          if (!mic) return;
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const level = Math.sqrt(sum / buf.length);
          if (frames < 20) {
            floor += level / 20; // the first third of a second: learn how loud the room is
            frames++;
          } else {
            micBlowing = level > Math.min(0.3, Math.max(0.09, floor * 4));
          }
          requestAnimationFrame(listen);
        };
        listen();
        run();
      } catch {
        ctx.close();
        micBtn.disabled = false;
        msg.textContent = 'geen mikrofoon nie? hou eerder jou vinger op die koek';
      }
    });

    function stopMic() {
      if (!mic) return;
      mic.stream.getTracks().forEach((t) => t.stop());
      mic.ctx.close();
      mic = null;
      micBlowing = false;
    }

    // Sing first, then blow. The mic ignores the song so it can't blow the candles out.
    onceVisible(art, () => { songUntil = performance.now() + sound.birthday() * 1000; }, 0.6);
  }

  /* ================= the jar of notes ================= */

  const NOTE_COLOURS = ['P', 'Y', 'M', 'B', 'V', 'W'];

  function jarRows() {
    return Array.from({ length: 36 }, (_, y) => {
      if (y < 3) return [8, 27]; // neck
      if (y === 3) return [5, 30];
      if (y === 4) return [3, 32];
      if (y === 5) return [2, 33];
      if (y < 33) return [1, 34];
      if (y === 33) return [2, 33];
      if (y === 34) return [3, 32];
      return [5, 30];
    });
  }

  // Up to 27 note spots, filled from the bottom of the jar.
  const NOTE_SPOTS = (() => {
    const spots = [];
    for (let row = 0; spots.length < 27; row++) {
      for (const x of row % 2 ? [6, 12, 18, 24] : [3, 9, 15, 21, 27]) {
        spots.push({ x, y: 29 - row * 4 + ((x * 7 + row) % 3) - 1 });
      }
    }
    return spots;
  })();

  function jarSVG(notes) {
    return pixels(36, 36, (px) => {
      shape(px, jarRows(), 'G');
      NOTE_SPOTS.slice(0, notes).forEach(({ x, y }, i) => {
        px(x, y, 5, 3, NOTE_COLOURS[(i * 5) % NOTE_COLOURS.length]);
        px(x, y + 2, 5, 1, 'K', 0.15);
      });
      px(4, 8, 1, 20, 'W', 0.7); // glass shine
      px(6, 7, 1, 3, 'W', 0.7);
      px(30, 10, 1, 14, 'W', 0.35);
    }, 'jar-art');
  }

  function lidSVG() {
    const rows = [[1, 22], [0, 23], [0, 23], [0, 23], [0, 23], [0, 23], [1, 22]];
    return pixels(24, 7, (px) => {
      shape(px, rows, 'R');
      px(2, 1, 20, 1, 'P');
      for (let x = 2; x < 22; x += 3) px(x, 2, 1, 4, 'r');
    }, 'lid-art');
  }

  function buildJar(notes) {
    const jar = $('#jar');
    const lid = $('#jarLid');
    const slot = $('#cardSlot');
    const count = $('#jarCount');
    const hint = $('#jarHint');
    const total = notes.length;
    $('#jarSection').hidden = false;
    $('#jarTotal').textContent = total;
    lid.innerHTML = lidSVG();

    let drawn = 0;
    let busy = false;
    const paint = () => {
      $('#jarBody').innerHTML = jarSVG(Math.min(total - drawn, NOTE_SPOTS.length));
      count.textContent = drawn ? `${drawn} / ${total}` : '';
    };

    function showCard(i) {
      for (const old of slot.querySelectorAll('.love-card')) {
        if (reduceMotion) { old.remove(); continue; }
        old.classList.add('leave');
        old.addEventListener('animationend', () => old.remove(), { once: true });
      }
      const card = document.createElement('div');
      card.className = 'love-card';
      if (i === null) {
        card.classList.add('placeholder');
        card.textContent = 'tik op die deksel';
      } else {
        const num = document.createElement('span');
        num.className = 'love-num';
        num.textContent = `#${i + 1}`;
        const text = document.createElement('p');
        appendWithHearts(text, notes[i]);
        card.append(num, text);
        // the same colour as the note that just left the jar (the top one)
        const top = Math.min(total - i, NOTE_SPOTS.length) - 1;
        card.style.background = PAL[NOTE_COLOURS[(top * 5) % NOTE_COLOURS.length]];
        card.insertAdjacentHTML('beforeend', sprite(HEART, 'love-heart'));
        // start the card inside the jar's mouth, so it looks like it comes out of it
        const s = slot.getBoundingClientRect();
        const j = jar.getBoundingClientRect();
        card.style.setProperty('--from', `${j.top + j.height * 0.15 - (s.top + s.height / 2)}px`);
        card.style.setProperty('--tilt', `${[-3, 2, -1.5, 3, -2][i % 5]}deg`);
      }
      slot.append(card);
    }

    jar.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      sound.wake();
      sound.lid();
      restart(lid, 'pop');
      if (drawn >= total) { // empty: put all the notes back
        drawn = 0;
        hint.textContent = '';
        paint();
        showCard(null);
      } else {
        showCard(drawn++);
        paint();
        if (drawn === total) hint.textContent = 'tik weer om van voor af te begin';
      }
      await sleep(450);
      busy = false;
    });

    paint();
    showCard(null);
  }

  /* ================= coupons ================= */

  // koepons.txt lines: "title" or "title | small print". A line starting with
  // [wildcard] becomes the rainbow coupon she fills in herself.
  function buildCoupons(lines, phone, message) {
    const list = $('#coupons');
    const USED = 'letter-coupons';
    const WISH = 'letter-wish';
    const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
    const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
    const used = load(USED, []);
    const waLink = (text) => {
      const msg = message.includes('{koepon}') ? message.replace('{koepon}', text) : `${message} ${text}`;
      return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    };
    $('#couponSection').hidden = false;

    lines.forEach((line, i) => {
      const [first, fine = ''] = line.split(/\s+\|\s+/);
      const wild = /^\[wildcard\]/i.test(first);
      const title = first.replace(/^\[wildcard\]\s*/i, '');
      const key = wild ? '[wildcard]' : title;

      const coupon = document.createElement('article');
      coupon.className = `coupon${wild ? ' wildcard' : ''}`;
      const main = document.createElement('div');
      main.className = 'coupon-main';
      const label = document.createElement('span');
      label.className = 'coupon-label';
      label.textContent = wild ? 'wildcard' : `koepon #${i + 1}`;
      const text = document.createElement('p');
      text.className = 'coupon-text';
      text.textContent = title;
      main.append(label, text);

      const link = document.createElement('a');
      link.className = 'btn coupon-use';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'ruil in';

      let wish = null;
      if (wild) {
        const ask = document.createElement('label');
        ask.className = 'wild-ask';
        ask.htmlFor = 'wildWish';
        ask.textContent = 'wat wil jy hê?';
        wish = document.createElement('input');
        wish.className = 'pw wild-wish';
        wish.id = 'wildWish';
        wish.placeholder = 'tik jou wens hier...';
        wish.maxLength = 200;
        wish.value = load(WISH, '');
        main.append(ask, wish);
        main.insertAdjacentHTML('afterbegin', `${sprite(STAR, 'sparkle s1')}${sprite(STAR, 'sparkle s2')}${sprite(STAR, 'sparkle s3')}`);
      }
      if (fine) {
        const small = document.createElement('p');
        small.className = 'coupon-fine';
        small.textContent = fine;
        main.append(small);
      }
      if (wild) main.append(link);
      coupon.append(main);
      if (!wild) coupon.append(link);
      coupon.insertAdjacentHTML('beforeend', '<span class="coupon-stamp" aria-hidden="true">ingeruil</span>');

      const refresh = () => { link.href = waLink(wild ? `Wildcard: ${wish.value.trim()}` : title); };
      const markUsed = () => {
        coupon.classList.add('used');
        link.textContent = 'stuur weer';
      };
      refresh();
      if (used.includes(key)) markUsed();
      wish?.addEventListener('input', () => { refresh(); save(WISH, wish.value); });

      link.addEventListener('click', (e) => {
        if (wild && !wish.value.trim()) { // nothing to send yet
          e.preventDefault();
          restart(wish, 'nudge');
          wish.focus();
          return;
        }
        sound.ding();
        setTimeout(() => {
          markUsed();
          if (!used.includes(key)) used.push(key);
          save(USED, used);
        }, 400);
      });
      list.append(coupon);
    });
  }

  /* ================= scratch-off postcard ================= */

  // A little postage stamp: perforated edge, night sky, star, mountain.
  function stampSVG() {
    return pixels(16, 20, (px) => {
      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 16; x++) {
          if (x === 0 || y === 0 || x === 15 || y === 19) {
            if ((x + y) % 2 === 0) px(x, y, 1, 1, 'W');
          } else {
            px(x, y, 1, 1, x === 1 || y === 1 || x === 14 || y === 18 ? 'W' : '#241d4b');
          }
        }
      }
      STAR.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && px(4 + x, 3 + y, 1, 1, 'Y')));
      px(3, 11, 1, 1, 'W');
      px(12, 4, 1, 1, 'W');
      px(4, 13, 8, 1, '#4a3a7a'); // mountain
      px(2, 14, 12, 4, '#4a3a7a');
    }, 'stamp-art');
  }

  // The default postcard picture, drawn pixel by pixel so nothing is downloaded.
  // (Kept vague on purpose: this file is public and the destination is a surprise.)
  function drawCapeTown(canvas) {
    const W = 160;
    const H = 100;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const set = (x, y, hex) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const [r, g, b] = rgb(hex);
      const i = (y * W + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    };
    let seed = 3010; // fixed seed: the same picture every time
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const dither = (x, y, f) => f * 16 > BAYER[(y % 4) * 4 + (x % 4)];

    // sky, dithered from deep night into a pink glow at the horizon
    const SKY = ['#120f2b', '#191539', '#221c49', '#2e2459', '#3d2c69', '#553677', '#744283', '#9a5088'];
    for (let y = 0; y < H; y++) {
      const t = Math.min(y / 72, 1) * (SKY.length - 1);
      const i = Math.min(Math.floor(t), SKY.length - 2);
      for (let x = 0; x < W; x++) set(x, y, dither(x, y, t - i) ? SKY[i + 1] : SKY[i]);
    }
    // Milky Way
    for (let y = 0; y < 72; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.abs(y - (55 - x * 0.32));
        if (d < 13 && rand() < (1 - d / 13) ** 2 * 0.45) set(x, y, rand() < 0.5 ? '#5d4f96' : '#7a6bb3');
      }
    }
    for (let i = 0; i < 150; i++) {
      const b = rand();
      set(rand() * W, rand() * 64, b > 0.85 ? '#ffffff' : b > 0.5 ? '#d9d4ff' : '#9c93d8');
    }
    const bright = (x, y, core = '#ffffff') => {
      set(x, y, core);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) set(x + dx, y + dy, '#b9b0ff');
    };
    bright(128, 9, '#ffd6c2'); // Southern Cross: Gacrux
    bright(130, 30); // Acrux
    bright(121, 20); // Mimosa
    set(137, 17, '#ffffff'); // Delta Crucis
    set(133, 24, '#d9d4ff'); // Epsilon Crucis
    bright(102, 34, '#fff4d6'); // the Pointers: Alpha Centauri
    bright(112, 30); // Beta Centauri
    // crescent moon
    for (let y = 6; y < 26; y++) {
      for (let x = 12; x < 32; x++) {
        const a = (x - 22) ** 2 + (y - 15) ** 2;
        if (a <= 49 && (x - 26) ** 2 + (y - 12) ** 2 > 42) set(x, y, a > 36 ? '#f3e6b3' : '#fff6d8');
      }
    }
    // shooting star
    for (let k = 0; k <= 16; k++) set(58 + k, 10 + k / 2, k > 12 ? '#ffffff' : k > 6 ? '#c9c2f5' : '#8a80c9');

    // the mountain ridge
    const RIDGE = [[0, 58], [10, 49], [17, 41], [19, 40], [21, 42], [26, 49], [30, 45], [35, 38], [38, 37],
      [112, 37], [114, 40], [118, 50], [122, 53], [128, 50], [132, 46], [135, 45], [138, 47], [142, 53], [150, 56], [160, 59]];
    const ridge = (x) => {
      for (let i = 1; i < RIDGE.length; i++) {
        const [x0, y0] = RIDGE[i - 1];
        const [x1, y1] = RIDGE[i];
        if (x <= x1) return Math.round(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
      }
      return 59;
    };
    for (let x = 0; x < W; x++) {
      const top = ridge(x);
      for (let y = top; y < 84; y++) {
        let c = y === top ? '#5a4886' : dither(x, y, (y - 50) / 30) ? '#1d1733' : '#2a2146';
        if (x > 38 && x < 112 && y < 52 && x % 6 === 0 && rand() < 0.7) c = '#221a3c'; // cliff lines
        if (y > 62 && rand() < 0.07) c = rand() < 0.6 ? '#ffd166' : '#ff9f5a'; // city lights
        set(x, y, c);
      }
    }
    // the "tablecloth" of cloud on top
    for (let x = 44; x < 106; x++) {
      const h = 1 + Math.round(Math.sin(x * 0.45) + 1);
      for (let y = 37 - h; y < 37; y++) set(x, y, '#a99fd0');
      if (x % 9 < 3) for (let y = 37; y < 37 + (x % 9) + 2; y++) set(x, y, '#8d83bb');
    }

    // garden and trees
    for (let y = 84; y < H; y++) for (let x = 0; x < W; x++) set(x, y, dither(x, y, 0.5) ? '#1b2a36' : '#223544');
    for (const [tx, ty, r] of [[12, 80, 10], [30, 85, 8], [138, 80, 11], [153, 86, 8]]) {
      for (let y = ty - r; y <= ty + r; y++) {
        for (let x = tx - r; x <= tx + r; x++) {
          const d = (x - tx) ** 2 + (y - ty) ** 2;
          if (d <= r * r) set(x, y, d < (r * r) / 3 && x < tx && y < ty ? '#2b5550' : '#1d3a3a');
        }
      }
    }

    // the building, lit up
    for (let y = 74; y < 92; y++) for (let x = 50; x < 111; x++) set(x, y, y < 76 ? '#e3d8c6' : '#b8aa95');
    for (const cx of [54, 62, 70, 90, 98, 106]) {
      for (let y = 76; y < 90; y++) {
        set(cx, y, '#ece3d3');
        set(cx + 1, y, '#a89a86');
      }
    }
    for (const wx of [57, 65, 93, 101]) for (let y = 79; y < 84; y++) for (let x = wx; x < wx + 3; x++) set(x, y, '#ffd166');
    for (let y = 81; y < 92; y++) for (let x = 76; x < 85; x++) set(x, y, y === 81 && (x === 76 || x === 84) ? '#b8aa95' : '#3a2a3e');
    for (let x = 48; x < 113; x++) for (let y = 90; y < 93; y++) set(x, y, '#9d907e');
    // the dome
    for (let x = 64; x < 97; x++) for (let y = 71; y < 74; y++) set(x, y, '#d8cdbb');
    for (let y = 58; y < 71; y++) {
      for (let x = 64; x < 97; x++) {
        const d = (x - 80) ** 2 + ((y - 71) * 1.15) ** 2;
        if (d > 196) continue;
        let c = d > 170 ? '#5b5f80' : x < 76 ? '#e9edf8' : x > 86 ? '#8f98b8' : '#c7cfe6';
        if (x === 80 || x === 81) c = '#2a2352'; // the slit
        set(x, y, c);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function coat(wrap, canvas) {
    const CELL = 8;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    wrap.classList.add('coated');
    const cols = Math.ceil(w / CELL);
    const rows = Math.ceil(h / CELL);

    const SILVER = ['#cfcbdc', '#c3bfd2', '#d9d6e4', '#b8b3c8'];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const r = Math.random();
        ctx.fillStyle = r < 0.02 ? '#ffffff' : SILVER[Math.floor(r * SILVER.length)];
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    const label = () => {
      const size = Math.max(12, Math.min(22, Math.floor(w / 16)));
      const s = Math.round(size / 4);
      const hx = w / 2 - (HEART[0].length * s) / 2;
      const hy = h / 2 - size - HEART.length * s - 6;
      HEART.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(hx + x * s, hy + y * s, s, s);
      }));
      ctx.font = `${size}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('krap hier!', w / 2 + 2, h / 2 + 2);
      ctx.fillStyle = '#6d6784';
      ctx.fillText('krap hier!', w / 2, h / 2);
    };
    document.fonts?.load('20px "Press Start 2P"').then(label, label) ?? label();

    const cleared = new Uint8Array(cols * rows);
    let clearedCount = 0;
    let last = null;
    let lastSound = 0;
    let done = false;
    const R = 2; // brush radius, in cells

    function scratchAt(x, y) {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          if (dx * dx + dy * dy > R * R + 1 || gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
          if (cleared[gy * cols + gx]) continue;
          cleared[gy * cols + gx] = 1;
          clearedCount++;
          ctx.clearRect(gx * CELL, gy * CELL, CELL, CELL);
        }
      }
    }
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * w) / r.width, y: ((e.clientY - r.top) * h) / r.height };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (done) return;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      sound.wake();
      last = point(e);
      scratchAt(last.x, last.y);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last || done) return;
      const p = point(e);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - last.x, p.y - last.y) / (CELL / 2)));
      for (let s = 1; s <= steps; s++) {
        scratchAt(last.x + ((p.x - last.x) * s) / steps, last.y + ((p.y - last.y) * s) / steps);
      }
      last = p;
      if (performance.now() - lastSound > 70) {
        lastSound = performance.now();
        sound.scratch();
      }
      if (clearedCount / (cols * rows) > 0.5) reveal();
    });
    const lift = () => { last = null; };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('keydown', (e) => { // keyboard can't scratch, so Enter reveals it
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        reveal();
      }
    });

    function reveal() {
      if (done) return;
      done = true;
      canvas.classList.add('gone');
      setTimeout(() => canvas.remove(), 700);
      $('#scratchHint').textContent = 'Ek sal jou optel natuurlik';
      sound.tada();
      confetti(wrap);
    }
  }

  function buildPostcard(pc) {
    $('#postcardSection').hidden = false;
    $('#pcGreeting').textContent = pc.greeting || '';
    $('#pcText').textContent = pc.text || '';
    $('#pcPlace').textContent = pc.place || '';
    $('#pcWhen').textContent = pc.when || '';
    $('#pcTo').textContent = pc.to ? `aan: ${pc.to}` : '';
    $('#pcPostmark').textContent = pc.postmark || '';
    $('#pcStamp').innerHTML = stampSVG();

    const art = $('#pcArt');
    if (pc.image) {
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([bytes(pc.image.data)], { type: pc.image.type }));
      img.alt = pc.place || '';
      img.className = 'pc-art pc-photo';
      art.replaceWith(img);
    } else {
      art.setAttribute('aria-label', pc.place || '');
      drawCapeTown(art);
    }
    // Coat it just before it scrolls into view, once the card has its final size.
    const wrap = $('#postcardWrap');
    onceVisible(wrap, () => coat(wrap, $('#scratch')), 0, '0px 0px 600px 0px');
  }

  /* ================= go ================= */

  window.Extras = {
    build(data) {
      if (data.candles !== 0) buildCake(Math.max(1, Math.min(24, data.candles || 23)));
      if (data.reasons?.length) buildJar(data.reasons);
      if (data.coupons?.length && data.whatsapp) buildCoupons(data.coupons, data.whatsapp, data.whatsappMessage || '{koepon}');
      if (data.postcard) buildPostcard(data.postcard);
    },
  };
})();
