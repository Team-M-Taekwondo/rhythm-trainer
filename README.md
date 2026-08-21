# MTEAM Tempo Trainer

A zero-build web app for running Taekwondo **poomsae** and **kick/punch drills**
to a set tempo, with Korean voice cues (`Joonbi → count → Sijak → … → Baro → count`).

Built as plain HTML/CSS/JavaScript with the **Web Audio API** — no framework, no build
step, no dependencies. Just static files you can host for free on GitHub Pages.

## Features

- **15 forms** (Taegeuk Il–Pal Jang, Koryo, Keumgang, Taebaek, Pyeongwon, Sipjin, Jitae, Chonkwon), each with its own per-count rhythm.
- **Forms session** — pick forms manually or draw at random from a range you set. In random mode the form name is announced out loud before each one.
- **Drill mode** — N reps at one tempo (e.g. 20 kicks at 2 s), in sets.
- **Sets & rest** — configurable number of rounds and rest between items.
- **Tempo grid** — 0.5 s → 8 s in half-second steps.
- **Selectable metronome sound per form/drill** — wood block, beep, drum, click, clave.
- **Rhythm Editor** — calibrate each form: set every count's duration, mark accents/holds, "set all", tap-tempo, and preview. Saved in the browser.
- **Count sections** — mark the stretches of a recording where the audio counts out loud in Korean (Taegeuk Pal Jang's two 8-count sections, say). A division's speed match speeds up everything else but leaves those at the recording's own speed, so the count never changes.
- **Korean voice cues** via the device's built-in speech (swappable for recorded coach clips later).
- **Installable PWA** — works offline once loaded; responsive from phone to laptop.

## Run it locally

Because scripts are loaded as plain files, you can open `index.html` directly in a
browser, or (recommended) serve the folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create a repo on the team's GitHub account and push this folder to it.
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`.
3. Your app will be live at `https://<org>.github.io/<repo>/`.

No build action is required — the files are served as-is.

## To finish / calibrate

- **Rhythms are placeholders** (every count = 1 s). Use the Rhythm Editor (or the
  reference videos) to set each form's real tempo. Edits persist per browser; to ship
  them as defaults for everyone, paste the values into `js/data.js`.
- **Voice**: this build uses the browser's Korean TTS. To use recorded coach clips,
  drop audio files in `assets/` and swap the `MT.speak(...)` calls in `js/audio.js`
  for clip playback (the interface is isolated there).
- **Logo**: `assets/logo-light.svg` is a placeholder. Replace with the real MTEAM
  mark (white version for the dark UI).

## Project layout

```
index.html            app shell + all screens
css/styles.css        styling (black + gold gym mode)
js/data.js            forms, tempos, cues, persistence
js/audio.js           synthesized metronome sounds + Korean voice
js/engine.js          session state machine (the training flow)
js/app.js             UI wiring for every screen
manifest.webmanifest  PWA metadata
```
