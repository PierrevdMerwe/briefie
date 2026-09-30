#!/usr/bin/env node
/*
 * Seals your letter + photos into sealed.js, encrypted with a password.
 *
 *   node seal.mjs
 *
 * Reads everything in private/ (letter.txt, photos/, 23-dinge.txt, koepons.txt,
 * settings.json, postcard.jpg), asks for a password, and writes sealed.js.
 * Options: --letter <file>  --photos <dir>  --out <file>
 * LETTER_PASSWORD=... skips the prompt (but ends up in your shell history).
 */
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    letter: { type: 'string', default: path.join(here, 'private', 'letter.txt') },
    photos: { type: 'string', default: path.join(here, 'private', 'photos') },
    out: { type: 'string', default: path.join(here, 'sealed.js') },
  },
});

const ITERATIONS = 250_000;
const MAX_SIDE = 1600; // px, longest edge after resizing
const PHOTO = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

// Must match app.js. Phones capitalise, and a date can be typed many ways:
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
const rel = (p) => {
  const r = path.relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});

async function main() {
  const letter = (await readFile(opts.letter, 'utf8').catch(() => {
    throw new Error(`couldn't read ${rel(opts.letter)}. Write your letter there first.`);
  })).trim();
  if (!letter) throw new Error(`${rel(opts.letter)} is empty`);
  console.log(`letter: ${rel(opts.letter)} (${letter.split(/\s+/).length} words)`);

  const dir = path.dirname(opts.letter);
  const photos = await loadPhotos(opts.photos);
  const extras = await loadExtras(dir);
  const password = await getPassword();

  const box = await encrypt(JSON.stringify({ letter, photos, ...extras }), password);
  const js = `// Made by seal.mjs. Encrypted with your password, so it's safe to commit.\nwindow.SEALED = ${JSON.stringify(box)};\n`;
  await writeFile(opts.out, js);

  const mb = Buffer.byteLength(js) / 1024 / 1024;
  console.log(`\n✓ sealed → ${rel(opts.out)} (${mb.toFixed(1)} MB)`);
  if (mb > 15) console.log('  that is pretty big for a phone; fewer or smaller photos will load faster.');
}

async function loadPhotos(dir) {
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => PHOTO.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) {
    console.log(`photos: none in ${rel(dir)}`);
    return [];
  }
  console.log(`photos: ${files.length} in ${rel(dir)}`);

  const useSips = process.platform === 'darwin'; // macOS: resize + convert HEIC for free
  const tmp = await mkdtemp(path.join(tmpdir(), 'seal-'));
  try {
    const photos = [];
    for (const [i, file] of files.entries()) {
      const { data, type } = await encodeImage(path.join(dir, file), path.join(tmp, `${i}.jpg`), useSips);
      const caption = captionFor(file);
      photos.push({ caption, type, data: data.toString('base64') });
      console.log(`  ${file}  →  ${caption ? `"${caption}"` : '(no caption)'}, ${Math.round(data.length / 1024)} KB`);
    }
    return photos;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function encodeImage(src, dest, useSips) {
  const ext = path.extname(src).toLowerCase();
  if (useSips && ext !== '.gif') {
    toJpeg(src, dest);
    return { data: await readFile(dest), type: 'image/jpeg' };
  }
  if (MIME[ext]) return { data: await readFile(src), type: MIME[ext] };
  throw new Error(`${path.basename(src)}: can't convert HEIC on this machine. Export it as a JPG first.`);
}

// The surprises after the letter. Each file is optional; a missing one hides its section.
async function loadExtras(dir) {
  const settingsFile = path.join(dir, 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`${rel(settingsFile)} isn't valid JSON: ${err.message}`);
  }

  const reasons = await readList(path.join(dir, '23-dinge.txt'));
  const placeholders = reasons.filter((r) => /^\(ding \d+\)$/.test(r)).length;
  console.log(`23 dinge: ${reasons.length}${placeholders ? ` (${placeholders} still placeholders)` : ''}`);

  const coupons = await readList(path.join(dir, 'koepons.txt'));
  const whatsapp = whatsappNumber(settings.whatsapp);
  console.log(`koepons: ${coupons.length}${whatsapp ? `, sent to WhatsApp +${whatsapp} (wa.me/${whatsapp})` : ' (no whatsapp number in settings.json, so hidden)'}`);

  let postcard = settings.postcard || null;
  if (postcard) {
    const file = (await readdir(dir)).find((f) => /^postcard\.(jpe?g|png|webp|heic|heif)$/i.test(f));
    if (file) {
      const tmp = await mkdtemp(path.join(tmpdir(), 'seal-'));
      try {
        const { data, type } = await encodeImage(path.join(dir, file), path.join(tmp, 'postcard.jpg'), process.platform === 'darwin');
        postcard = { ...postcard, image: { type, data: data.toString('base64') } };
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
    console.log(`postcard: "${postcard.greeting || ''}" with ${file ? `your photo (${file})` : 'the pixel-art picture'}`);
  }

  return {
    candles: settings.candles ?? 23,
    reasons,
    coupons,
    whatsapp,
    whatsappMessage: settings.whatsappMessage,
    postcard,
  };
}

// One item per line; blank lines and # comments are skipped, "1." style numbering is dropped.
async function readList(file) {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^(\d+[.)]|[-*])\s+/, ''));
}

// wa.me wants the country code without "+" or the local leading 0: +27 073… → 2773…
function whatsappNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('270')) digits = `27${digits.slice(3)}`;
  else if (digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  return digits;
}

function toJpeg(src, dest) {
  const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' });
  const side = Math.max(...[...info.matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1])));
  const resize = side > MAX_SIDE ? ['-Z', String(MAX_SIDE)] : [];
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', ...resize, src, '--out', dest], { stdio: 'ignore' });
}

// "03-our first date.jpg" → "our first date"; "IMG_1234.jpg" or "04.jpg" → no caption
function captionFor(file) {
  const name = path.parse(file).name.replace(/^\d+\s*[-_.)]*\s*/, '').replace(/[-_]+/g, ' ').trim();
  return /^(img|dsc|pxl|photo|image)?\s*\d*$/i.test(name) ? '' : name;
}

async function getPassword() {
  if (process.env.LETTER_PASSWORD) return process.env.LETTER_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('run this in a terminal (or set LETTER_PASSWORD)');
  console.log('\nPick the password she will type. Capitals, extra spaces and date formats are ignored.');
  for (;;) {
    const first = await askHidden('password: ');
    if (!normalize(first)) {
      console.log('  (empty, try again)');
      continue;
    }
    const second = await askHidden('again:    ');
    if (normalize(first) === normalize(second)) {
      if (normalize(first).length < 5) console.log('  (short passwords are easy to guess, but it is your call)');
      return first;
    }
    console.log("  those didn't match, try again");
  }
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    rl._writeToOutput = () => {}; // don't echo what's typed
  });
}

async function encrypt(text, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', enc.encode(normalize(password)), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  return { v: 1, iter: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
}
