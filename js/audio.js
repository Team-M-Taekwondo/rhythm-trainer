/* ============================================================
   MTEAM Tempo Trainer — audio layer
   - Web Audio API for sample-accurate metronome sounds
   - SpeechSynthesis for Korean voice cues (swappable for clips later)
   ============================================================ */
(function () {
  const MT = (window.MT = window.MT || {});

  // Debug hook — app.js replaces this with an on-screen logger when ?debug=1.
  MT._log = MT._log || function () {};
  function dlog(m) {
    try {
      MT._log(m);
    } catch (e) {}
  }

  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let keepAliveSrc = null;

  function ensureContext() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    // white-noise buffer reused for percussive attacks
    const len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // iOS Safari: SpeechSynthesis puts the AudioContext into "interrupted"
    // WHILE it speaks, then drops it to "suspended" once the speech ends. Only
    // auto-resume from "suspended" — resuming during "interrupted" would grab
    // the audio session back mid-word and silence the speech (e.g. the drill's
    // "Sijak"). "suspended" is exactly when the metronome should come back.
    ctx.onstatechange = function () {
      dlog("ctx→" + ctx.state);
      if (ctx.state === "suspended" && MT._current && !MT._current.paused) {
        ctx.resume().catch(function () {});
      }
    };
    return ctx;
  }

  // A silent, looping source that keeps the audio session "live." On iOS this
  // makes the context far more resilient to being torn down by speech.
  function startKeepAliveSource() {
    if (!ctx || keepAliveSrc) return;
    try {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0; // fully silent
      src.connect(g).connect(ctx.destination);
      src.start();
      keepAliveSrc = src;
    } catch (e) {}
  }

  // Must be called from a user gesture (button tap) to unlock audio on mobile.
  MT.unlockAudio = function () {
    ensureContext();
    if (ctx.state !== "running") {
      ctx.resume().then(function () { MT.decodePendingClips && MT.decodePendingClips(); }).catch(function () {});
    }
    // NOTE: intentionally NOT starting a continuous keep-alive source here. On
    // iOS a permanently-running Web Audio source holds the audio session, which
    // blocks SpeechSynthesis (spoken cues like the drill "Sijak" go silent). The
    // metronome stays alive instead via resume-on-each-beat + the "suspended"
    // statechange handler, which don't fight speech.
    // Decode any repo clips that couldn't decode while the context was suspended
    // (iOS). Runs now and again after resume() settles above.
    if (MT.decodePendingClips) MT.decodePendingClips();
    // NOTE: no empty-utterance "speech warm-up" here on purpose — on iOS it
    // interrupts the AudioContext right at unlock, and the drill (which has no
    // spoken cues to trigger recovery) then hangs with a silent metronome. The
    // zero-width space prepended in MT.speak already prevents first-syllable clipping.
  };

  MT.now = function () {
    ensureContext();
    return ctx.currentTime;
  };

  function noiseSource(t, dur, filterType, freq, q, gainPeak, bus) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    if (q) filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainPeak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(bus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(t, dur, type, f0, f1, gainPeak, bus) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Each voice: (time, accent, bus). Gains sit a bit hot on purpose — the
  // tempo sound has to cut through a noisy gym floor.
  const VOICES = {
    woodblock(t, accent, bus) {
      const f = accent ? 1250 : 1000;
      tone(t, 0.05, "triangle", f, f * 0.6, accent ? 1.0 : 0.75, bus);
      noiseSource(t, 0.02, "bandpass", f * 1.6, 8, accent ? 0.6 : 0.4, bus);
    },
    beep(t, accent, bus) {
      tone(t, 0.09, "sine", accent ? 1320 : 880, null, accent ? 1.0 : 0.7, bus);
    },
    drum(t, accent, bus) {
      tone(t, 0.18, "sine", accent ? 220 : 170, 55, accent ? 1.0 : 0.95, bus);
      noiseSource(t, 0.05, "lowpass", 900, 0, accent ? 0.6 : 0.45, bus);
    },
    click(t, accent, bus) {
      noiseSource(t, 0.015, "highpass", accent ? 3500 : 2600, 0, accent ? 0.75 : 0.5, bus);
    },
    clave(t, accent, bus) {
      tone(t, 0.04, "square", accent ? 2200 : 1800, null, accent ? 0.7 : 0.5, bus);
    },
  };

  // Finish chime — an unmistakable "drill over" bell: a slow rising major
  // triad with long ringing decays, much bigger than the milestone triple-beep.
  MT.playFinishChime = function (bus) {
    ensureContext();
    keepAlive();
    const out = bus || master;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const at = ctx.currentTime + 0.05 + i * 0.28;
      [1, 2.01, 3.02].forEach((h, hi) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f * h, at);
        const g = ctx.createGain();
        const peak = (hi === 0 ? 0.9 : hi === 1 ? 0.25 : 0.12) * (i === notes.length - 1 ? 1.1 : 0.9);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(Math.min(1, peak), at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + (i === notes.length - 1 ? 2.2 : 1.2));
        o.connect(g).connect(out);
        o.start(at);
        o.stop(at + 2.4);
      });
    });
  };

  // Milestone marker for the drill — a bright ascending triple-beep on every
  // 10th rep so athletes can hear the tens without counting in their head.
  MT.playMilestone = function (t, bus) {
    ensureContext();
    keepAlive();
    const out = bus || master;
    [880, 1175, 1568].forEach((f, i) => {
      const at = t + i * 0.12;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(f, at);
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 5200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.95, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
      o.connect(filt).connect(g).connect(out);
      o.start(at);
      o.stop(at + 0.15);
    });
  };

  // Play one metronome hit. bus defaults to master.
  MT.playSound = function (soundId, t, accent, bus) {
    ensureContext();
    keepAlive();
    const v = VOICES[soundId] || VOICES.woodblock;
    v(t, !!accent, bus || master);
  };

  // iOS suspends/interrupts the AudioContext around speech; resume it before we
  // schedule audio so the metronome/clips actually play. Skip if the run was
  // deliberately paused (don't fight Pause).
  function keepAlive() {
    if (ctx && ctx.state !== "running" && !(MT._current && MT._current.paused)) {
      try { ctx.resume(); } catch (e) {}
    }
  }

  // High-pitched "digital countdown" blip for the last-5-seconds get-ready
  // beeps (rest between poomsae, Mixed switch, drill rest/countdown). Much
  // higher than the metronome beep so it cuts through; the final beep (isFinal,
  // the "1" before Go) is higher, louder and a touch longer.
  MT.playCountdownBeep = function (t, isFinal, bus) {
    ensureContext();
    keepAlive();
    const out = bus || master;
    const freq = isFinal ? 2640 : 1900;
    const dur = isFinal ? 0.15 : 0.08;
    const peak = isFinal ? 0.95 : 0.6;
    const o = ctx.createOscillator();
    o.type = "square"; // square → crisp, electronic timer character
    o.frequency.setValueAtTime(freq, t);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass"; // tame the square's harsh upper harmonics
    filt.frequency.value = isFinal ? 5400 : 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(filt).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  // Pause / resume the whole audio timeline (used by the run screen's Pause).
  // Suspending freezes ctx.currentTime, so every rAF loop that polls MT.now()
  // holds in place until we resume.
  MT.suspendAudio = function () {
    ensureContext();
    return ctx.state === "running" ? ctx.suspend() : Promise.resolve();
  };
  MT.resumeAudio = function () {
    ensureContext();
    // Resume from "suspended" and iOS's "interrupted" state alike.
    return ctx.state !== "running" ? ctx.resume().catch(() => {}) : Promise.resolve();
  };

  // A "bus" that a whole run routes through, so Stop can silence everything
  // instantly (including already-scheduled hits).
  MT.createBus = function () {
    ensureContext();
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(master);
    return g;
  };

  /* -------------------- Bundled voice clips --------------------
     Pre-recorded audio for the small fixed vocabulary (numbers, commands,
     poomsae names). When a clip exists in audio/voice/, MT.speak plays it
     through Web Audio instead of SpeechSynthesis — identical natural sound on
     every device, and no iOS speech-engine fights with the metronome.
     Missing files are skipped silently and TTS covers them (fallback).
     Generate the set with tools/generate-voice.sh. */
  const VOICE_FILES = {
    "하나": "n1", "둘": "n2", "셋": "n3", "넷": "n4", "다섯": "n5",
    "여섯": "n6", "일곱": "n7", "여덟": "n8", "아홉": "n9", "열": "n10",
    "준비": "joonbi", "시작": "sijak", "바로": "baro", "서": "suh",
    "태극 일장": "p1", "태극 이장": "p2", "태극 삼장": "p3", "태극 사장": "p4",
    "태극 오장": "p5", "태극 육장": "p6", "태극 칠장": "p7", "태극 팔장": "p8",
    "고려": "p9", "금강": "p10", "태백": "p11", "평원": "p12",
    "십진": "p13", "지태": "p14", "천권": "p15",
    "The drill has completed": "complete",
  };
  const VOICE_CACHE = new Map(); // file key -> AudioBuffer
  const VOICE_PENDING = new Map(); // file key -> ArrayBuffer (fetched, not decoded)
  let voiceSrc = null; // currently playing clip (so cancelSpeech can stop it)

  MT.loadVoiceClips = async function () {
    ensureContext();
    const keys = Array.from(new Set(Object.values(VOICE_FILES)));
    await Promise.all(
      keys.map(async (k) => {
        if (VOICE_CACHE.has(k) || VOICE_PENDING.has(k)) return;
        try {
          const r = await fetch("audio/voice/" + k + ".m4a");
          if (r.ok) VOICE_PENDING.set(k, await r.arrayBuffer());
        } catch (e) {}
      })
    );
    await decodeVoicePending();
  };

  // Like the repo clips: iOS can't decode while suspended, so retry on unlock.
  async function decodeVoicePending() {
    if (!ctx || !VOICE_PENDING.size) return;
    for (const [k, buf] of Array.from(VOICE_PENDING.entries())) {
      try {
        VOICE_CACHE.set(k, await ctx.decodeAudioData(buf.slice(0)));
        VOICE_PENDING.delete(k);
      } catch (e) {}
    }
  }

  function playVoiceClip(text) {
    const key = VOICE_FILES[text];
    const buf = key && VOICE_CACHE.get(key);
    if (!buf) return null;
    keepAlive();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 1.0;
    src.connect(g).connect(master);
    src.start();
    voiceSrc = src;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (voiceSrc === src) voiceSrc = null;
        resolve();
      };
      src.onended = finish;
      setTimeout(finish, buf.duration * 1000 + 800); // safety net
    });
  }

  /* -------------------- Voice cues -------------------- */

  // Rank Korean voices by likely quality. Network / named / "enhanced" voices
  // sound far more natural than the built-in "compact" ones.
  function scoreVoice(v) {
    const n = (v.name || "").toLowerCase();
    let s = 0;
    if (v.localService === false) s += 3; // network voices tend to be better for ko
    if (/yuna/.test(n)) s += 4; // Apple's Korean voice
    if (/siri/.test(n)) s += 4;
    if (/google/.test(n)) s += 3;
    if (/(premium|enhanced|neural|natural|wavenet)/.test(n)) s += 4;
    if (/compact/.test(n)) s -= 4;
    return s;
  }

  MT.getKoreanVoices = function () {
    const all = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const ko = all
      .filter((v) => (v.lang || "").toLowerCase().startsWith("ko"))
      .sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return { all, ko };
  };

  let chosenVoiceURI = "";
  MT.setVoiceURI = function (uri) {
    chosenVoiceURI = uri || "";
  };

  // Global voice tuning (rate/pitch) from settings.
  const tuning = { rate: 0.95, pitch: 1.0 };
  MT.setVoiceTuning = function (t) {
    if (!t) return;
    if (typeof t.rate === "number") tuning.rate = t.rate;
    if (typeof t.pitch === "number") tuning.pitch = t.pitch;
  };

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const all = window.speechSynthesis.getVoices();
    if (chosenVoiceURI) {
      const m = all.find((v) => v.voiceURI === chosenVoiceURI);
      if (m) return m;
    }
    // Auto: highest-scoring Korean voice available.
    const ko = all
      .filter((v) => (v.lang || "").toLowerCase().startsWith("ko"))
      .sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return ko[0] || null;
  }

  // Best-quality voice for a given language (e.g. "en-US" → the nicest English
  // voice, not the robotic compact default). Korean falls back to pickVoice so
  // it still honours the user's chosen Yuna voice.
  function pickVoiceForLang(lang) {
    if (!window.speechSynthesis) return null;
    if (!lang || lang.toLowerCase().indexOf("ko") === 0) return pickVoice();
    const prefix = lang.toLowerCase().slice(0, 2);
    const matches = window.speechSynthesis
      .getVoices()
      .filter((v) => (v.lang || "").toLowerCase().slice(0, 2) === prefix)
      .sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return matches[0] || null;
  }

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // iOS/Safari drops the very FIRST spoken utterance after audio engages. We
  // absorb that by queuing one silent utterance right before the first real one
  // (lazily, not at unlock — doing it at unlock would interrupt the AudioContext
  // and silence the drill's countdown beeps). Runs once per page load.
  let speechPrimed = false;
  function primeSpeechOnce() {
    if (speechPrimed || !window.speechSynthesis) return;
    speechPrimed = true;
    try {
      const p = new SpeechSynthesisUtterance("​"); // zero-width space, silent
      p.volume = 0;
      window.speechSynthesis.speak(p);
    } catch (e) {}
  }

  // Returns a promise that resolves when speech ends (or a safety timeout fires).
  // opts.rate / opts.pitch are per-call multipliers on top of the global tuning.
  MT.speak = function (text, opts) {
    opts = opts || {};
    // Bundled clip first — natural, consistent, and Web-Audio friendly.
    if (text && VOICE_FILES[text]) {
      ensureContext();
      const p = playVoiceClip(text);
      if (p) return p;
    }
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text) return resolve();
      primeSpeechOnce(); // absorb iOS's first-utterance drop
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const ss = window.speechSynthesis;
      dlog(
        'speak "' + text + '" ctx=' + (ctx ? ctx.state : "?") +
        " ss[spk=" + ss.speaking + " pend=" + ss.pending + " paused=" + ss.paused + "]" +
        " voices=" + ss.getVoices().length
      );
      // Leading zero-width space avoids some voices clipping the first syllable.
      const u = new SpeechSynthesisUtterance("​" + text);
      const v = pickVoiceForLang(opts.lang);
      if (v) u.voice = v;
      dlog("  voice=" + (v ? v.name : "NONE") + " lang=" + (opts.lang || "ko-KR"));
      u.lang = opts.lang || (v ? v.lang : "ko-KR");
      // opts.absolute uses rate/pitch as-is (natural), skipping the deep/slow
      // Yuna tuning — used for the English countdown so it isn't fast/robotic.
      u.rate = opts.absolute
        ? clamp(opts.rate || 1.0, 0.5, 2.0)
        : clamp(tuning.rate * (opts.rate || 1.0), 0.5, 2.0);
      u.pitch = opts.absolute
        ? clamp(opts.pitch || 1.0, 0.5, 2.0)
        : clamp(tuning.pitch * (opts.pitch || 1.0), 0.5, 2.0);
      u.volume = 1.0;
      u.onstart = function () { dlog('  ▶ start "' + text + '"'); };
      u.onend = function () { dlog('  ■ end "' + text + '"'); finish(); };
      u.onerror = function (e) { dlog("  ✕ error " + (e && e.error)); finish(); };
      // safety: never hang the sequence if the engine drops the event
      setTimeout(finish, 2500);
      ss.speak(u);
    });
  };

  MT.cancelSpeech = function () {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (voiceSrc) {
      try { voiceSrc.stop(); } catch (e) {}
      voiceSrc = null;
    }
  };

  /* ============================================================
     Audio clip store — real performance audio per (section,
     division, poomsae). When a clip exists, the drill plays it
     instead of the metronome. Stored in IndexedDB, cached as
     AudioBuffers for instant, sample-accurate playback.
     ============================================================ */
  const CLIP_CACHE = new Map(); // key -> AudioBuffer
  const CLIP_DB = "mteam-clips";
  const CLIP_STORE = "clips";

  function clipKey(section, division, id) {
    return section + "|" + (division || "") + "|" + id;
  }
  MT.clipKey = clipKey;

  function openClipDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(CLIP_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(CLIP_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function clipPut(k, blob) {
    return openClipDB().then(
      (db) =>
        new Promise((res, rej) => {
          const t = db.transaction(CLIP_STORE, "readwrite");
          t.objectStore(CLIP_STORE).put(blob, k);
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
        })
    );
  }
  function clipGetAll() {
    return openClipDB().then(
      (db) =>
        new Promise((res, rej) => {
          const t = db.transaction(CLIP_STORE, "readonly");
          const s = t.objectStore(CLIP_STORE);
          const ks = s.getAllKeys();
          const vs = s.getAll();
          t.oncomplete = () => res({ keys: ks.result, vals: vs.result });
          t.onerror = () => rej(t.error);
        })
    );
  }
  function clipDel(k) {
    return openClipDB().then(
      (db) =>
        new Promise((res, rej) => {
          const t = db.transaction(CLIP_STORE, "readwrite");
          t.objectStore(CLIP_STORE).delete(k);
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
        })
    );
  }

  // Load all saved clips into memory once at startup.
  MT.loadClips = async function () {
    if (!window.indexedDB) return;
    ensureContext();
    try {
      const { keys, vals } = await clipGetAll();
      for (let i = 0; i < keys.length; i++) {
        try {
          const buf = await ctx.decodeAudioData(await vals[i].arrayBuffer());
          CLIP_CACHE.set(keys[i], buf);
        } catch (e) {}
      }
    } catch (e) {}
  };

  MT.hasClip = function (section, division, id) {
    return CLIP_CACHE.has(clipKey(section, division, id));
  };
  // All stored clip blobs (original uploaded files) for export.
  MT.getAllClipBlobs = function () {
    if (!window.indexedDB) return Promise.resolve([]);
    return clipGetAll().then(({ keys, vals }) =>
      keys.map((k, i) => ({ key: k, blob: vals[i] }))
    );
  };
  MT.clipDuration = function (section, division, id) {
    const b = CLIP_CACHE.get(clipKey(section, division, id));
    return b ? b.duration : 0;
  };
  MT.saveClip = async function (section, division, id, blob) {
    ensureContext();
    const k = clipKey(section, division, id);
    await clipPut(k, blob);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    CLIP_CACHE.set(k, buf);
  };
  MT.deleteClip = async function (section, division, id) {
    const k = clipKey(section, division, id);
    await clipDel(k);
    CLIP_CACHE.delete(k);
  };

  // Repo clips fetched but not yet decoded. On iOS Safari, decodeAudioData
  // fails while the AudioContext is suspended (i.e. before the first user tap),
  // so we fetch at load time (fetch works fine suspended) and decode later,
  // once the context is unlocked. Otherwise the team's audio silently fails to
  // load on iPhones and every poomsae falls back to the metronome.
  const REPO_PENDING = new Map(); // key -> ArrayBuffer

  // Clips shipped in the repo (data/clips.json + audio files). This is how the
  // whole team gets the audio — no browser upload needed.
  MT.loadRepoClips = async function () {
    ensureContext();
    let manifest;
    try {
      const res = await fetch("data/clips.json?ts=" + Date.now());
      if (!res.ok) return;
      manifest = await res.json();
    } catch (e) {
      return;
    }
    const list = (manifest && manifest.clips) || [];
    for (const c of list) {
      const k = clipKey(c.section, c.division || "", c.poomsae);
      if (!c.file || CLIP_CACHE.has(k) || REPO_PENDING.has(k)) continue; // don't clobber a local upload
      try {
        const r = await fetch(c.file);
        if (!r.ok) continue;
        REPO_PENDING.set(k, await r.arrayBuffer());
      } catch (e) {}
    }
    await decodePending();
  };

  // Decode any fetched-but-undecoded repo clips into the cache. Safe to call
  // repeatedly (decodes only what's still pending). decodeAudioData detaches
  // its input, so hand it a copy and keep the original for a later retry.
  async function decodePending() {
    if (!ctx || !REPO_PENDING.size) return;
    for (const [k, buf] of Array.from(REPO_PENDING.entries())) {
      if (CLIP_CACHE.has(k)) {
        REPO_PENDING.delete(k);
        continue;
      }
      try {
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        CLIP_CACHE.set(k, decoded);
        REPO_PENDING.delete(k);
      } catch (e) {
        // Still suspended/failed — leave pending; retry on the next unlock.
      }
    }
  }
  MT.decodePendingClips = function () {
    decodeVoicePending();
    return decodePending();
  };

  // Start playing a stored clip through `bus`; returns the source node
  // (caller manages onended / stop), or null if there's no clip.
  MT.playClip = function (section, division, id, bus) {
    return MT.playClipAt(section, division, id, bus, 0);
  };

  // Same as playClip but starts at `offset` seconds into the clip (used for
  // scrubbing — Web Audio sources can't be seeked, so we restart at an offset).
  // `rate` speeds up (>1) or slows down (<1) playback — used by speed matches.
  // `offset` is in BUFFER seconds (the recording's own timeline), not heard time.
  MT.playClipAt = function (section, division, id, bus, offset, rate) {
    ensureContext();
    keepAlive();
    const buf = CLIP_CACHE.get(clipKey(section, division, id));
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (rate && rate !== 1) src.playbackRate.value = rate;
    src.connect(bus || master);
    src.start(0, Math.max(0, Math.min(buf.duration, offset || 0)));
    return src;
  };

  /* -------------------- Speed matches (U30 base) --------------------
     Divisions other than U30 can reuse the U30 recording at an adjusted
     speed instead of needing their own upload. A match maps a
     (section, division, poomsae) to a playback speed on the U30 clip —
     the U30 audio itself is never changed. Admin-set matches live in
     localStorage (clip meta, field "speed"); published matches ship in
     data/tempomap.json. A local match wins over the published one, and
     any match wins over that division's own uploaded/shipped clip. */
  const REPO_TEMPO = new Map(); // clipKey -> speed (e.g. 1.05 = 5% faster)

  MT.loadTempoMap = async function () {
    try {
      const res = await fetch("data/tempomap.json?ts=" + Date.now());
      if (!res.ok) return;
      const m = await res.json();
      ((m && m.matches) || []).forEach((c) => {
        const s = Number(c.speed);
        if (s > 0) REPO_TEMPO.set(clipKey(c.section, c.division || "", c.poomsae), s);
      });
    } catch (e) {}
  };
  MT.repoTempoSpeed = function (key) {
    return REPO_TEMPO.get(key) || 0;
  };
  MT.getRepoTempoMatches = function () {
    return Array.from(REPO_TEMPO.entries());
  };

  // The speed match for (section, division, id), or 0 when there is none.
  MT.matchSpeed = function (section, division, id) {
    if (section === "black" && division === "u30") return 0; // U30 IS the base
    const key = clipKey(section, division, id);
    const m = MT.getClipMeta ? MT.getClipMeta(key) : null;
    if (m && Number(m.speed) > 0) return Number(m.speed);
    return REPO_TEMPO.get(key) || 0;
  };

  // What actually plays for (section, division, id): a speed match redirects
  // to the U30 base clip at its rate; otherwise the division's own clip at 1×.
  MT.resolveClip = function (section, division, id) {
    const speed = MT.matchSpeed(section, division, id);
    if (speed && CLIP_CACHE.has(clipKey("black", "u30", id))) {
      return { section: "black", division: "u30", id, rate: speed };
    }
    if (CLIP_CACHE.has(clipKey(section, division, id))) {
      return { section, division, id, rate: 1 };
    }
    return null;
  };

  // Preview an unsaved uploaded file (Blob); returns { source, duration }.
  MT.previewClipBlob = async function (blob, bus) {
    ensureContext();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(bus || master);
    src.start();
    return { source: src, duration: buf.duration };
  };
})();
