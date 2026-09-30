# a letter for karla

A pixel-art envelope with a heart padlock. She types the password, the lock pops off, she drags along the top to tear the envelope open, taps the letter, and reads it. After the letter come the surprises:

1. **A cake with 23 candles.** A chiptune "Happy Birthday" plays, then she blows into the phone's microphone (or holds a finger on the cake) to blow them out.
2. **A jar of notes.** Each tap on the lid pulls out the next of the 23 things you love about her.
3. **Bederf-koepons.** Each "ruil in" button opens WhatsApp to you with that coupon already typed.
4. **A scratch-off postcard.** It reveals a surprise outing.
5. Photos, if you add any, as polaroids that sharpen from pixels as she scrolls to them.

Everything she sees after the password is **encrypted** inside `sealed.js`, including your WhatsApp number, and the password is the key. The repo and the site can be public: without the password, nobody can read any of it. The readable originals live in `private/`, which is gitignored.

## 1. Write it

- **`private/letter.txt`** holds your letter. A blank line starts a new paragraph, and `<3` turns into a little pixel heart.
- **`private/photos/`** holds your photos (jpg, png, or iPhone heic). They show in filename order, and the filename becomes the caption:
  - `01-first date at the pier.jpg` gets the caption "first date at the pier"
  - `02.jpg` or `IMG_4411.heic` gets no caption

Then the surprises. Each file is optional, and leaving one out hides its section:

- **`private/23-dinge.txt`** has one thing per line. It starts with 23 `(ding N)` placeholders, and `node seal.mjs` tells you how many are left.
- **`private/koepons.txt`** has one coupon per line.
- **`private/settings.json`** holds:
  - your WhatsApp number and the message the coupons send (`{koepon}` is replaced by the coupon's text)
  - the number of candles
  - the postcard text; `when` is optional, for the date of the outing
- **`private/postcard.jpg`** is optional. By default the postcard shows a pixel-art picture. Add a photo here to use that instead.

## 2. Seal it

```bash
node seal.mjs
```

It asks for the password twice and writes `sealed.js`. Re-run it every time you change the letter or photos.

- The password ignores capitals and extra spaces, because phones auto-capitalise. If it's a date, she can type it any way: `2003/10/30`, `30/10/2003`, `30 Oktober 2003` and `30102003` all work.
- On a Mac, photos are shrunk and HEIC is converted to JPG automatically.
- Pick something she'll know but a stranger won't guess. The nicknames are printed on the page, so don't use one of those.

## 3. Preview it

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly won't work, because the browser only allows the decryption over `localhost` or `https`. For the same reason, opening it on your phone via your laptop's IP won't work either. Test on your phone once it's on GitHub Pages.

## 4. Put it on GitHub Pages

The repo is public, so keep surprises out of everything except `private/`. Only `sealed.js` carries them, encrypted.

```bash
git init && git add . && git commit -m "a letter"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**. About a minute later it's live at `https://<you>.github.io/<repo>/`.

Before you send the link:

- Run `git status`. It should never list `private/`.
- Open the link on your phone and go through the whole thing once.

## Make it yours

| What | Where |
| --- | --- |
| Names the title cycles through | `data-names` in `index.html` |
| Password hint under the box | `<p class="hint">` in `index.html` (empty = no hint) |
| "happy birthday, pookie!" and "us, so far" | `index.html` |
| "N days of us · one year in N days" | `data-together-since="YYYY-MM-DD"` in `index.html` |
| Wrong-password messages | `NOPE` at the top of `app.js` |
| Section titles ("blaas jou kersies uit!", "bederf-koepons"…) | `index.html` |
| Colours | `:root` in `style.css` |
