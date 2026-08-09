/* ============================================================
   MTEAM Tempo Trainer — audio layer
   - Web Audio API for sample-accurate metronome sounds
   - SpeechSynthesis for Korean voice cues (swappable for clips later)
   ============================================================ */
(function () {
  const MT = (window.MT = window.MT || {});

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
    // iOS Safari: SpeechSynthesis interrupts the AudioContext. When the
    // interruption ends the context drops to "suspended" — auto-resume it (as
    // long as a session is running and not deliberately paused) so the
    // metronome/clips come back instead of hanging.
    ctx.onstatechange = function () {
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
    if (ctx.state !== "running") ctx.resume().catch(function () {});
    startKeepAliveSource();
    // also warm up speech synthesis
    try {
      const u = new SpeechSynthesisUtterance("");
      window.speechSynthesis.speak(u);
    } catch (e) {}
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

  // Each voice: (time, accent, bus)
  const VOICES = {
    woodblock(t, accent, bus) {
      const f = accent ? 1250 : 1000;
      tone(t, 0.05, "triangle", f, f * 0.6, accent ? 0.9 : 0.6, bus);
      noiseSource(t, 0.02, "bandpass", f * 1.6, 8, accent ? 0.5 : 0.3, bus);
    },
    beep(t, accent, bus) {
      tone(t, 0.09, "sine", accent ? 1320 : 880, null, accent ? 0.85 : 0.55, bus);
    },
    drum(t, accent, bus) {
      tone(t, 0.18, "sine", accent ? 220 : 170, 55, accent ? 1.0 : 0.8, bus);
      noiseSource(t, 0.05, "lowpass", 900, 0, accent ? 0.5 : 0.35, bus);
    },
    click(t, accent, bus) {
      noiseSource(t, 0.015, "highpass", accent ? 3500 : 2600, 0, accent ? 0.6 : 0.4, bus);
    },
    clave(t, accent, bus) {
      tone(t, 0.04, "square", accent ? 2200 : 1800, null, accent ? 0.55 : 0.4, bus);
    },
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

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // Returns a promise that resolves when speech ends (or a safety timeout fires).
  // opts.rate / opts.pitch are per-call multipliers on top of the global tuning.
  MT.speak = function (text, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text) return resolve();
      // Leading zero-width space avoids some voices clipping the first syllable.
      const u = new SpeechSynthesisUtterance("​" + text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = opts.lang || (v ? v.lang : "ko-KR");
      u.rate = clamp(tuning.rate * (opts.rate || 1.0), 0.5, 2.0);
      u.pitch = clamp(tuning.pitch * (opts.pitch || 1.0), 0.5, 2.0);
      u.volume = 1.0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      // safety: never hang the sequence if the engine drops the event
      setTimeout(finish, 2500);
      window.speechSynthesis.speak(u);
    });
  };

  MT.cancelSpeech = function () {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
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
      if (!c.file || CLIP_CACHE.has(k)) continue; // don't clobber a local upload
      try {
        const r = await fetch(c.file);
        if (!r.ok) continue;
        CLIP_CACHE.set(k, await ctx.decodeAudioData(await r.arrayBuffer()));
      } catch (e) {}
    }
  };

  // Start playing a stored clip through `bus`; returns the source node
  // (caller manages onended / stop), or null if there's no clip.
  MT.playClip = function (section, division, id, bus) {
    return MT.playClipAt(section, division, id, bus, 0);
  };

  // Same as playClip but starts at `offset` seconds into the clip (used for
  // scrubbing — Web Audio sources can't be seeked, so we restart at an offset).
  MT.playClipAt = function (section, division, id, bus, offset) {
    ensureContext();
    keepAlive();
    const buf = CLIP_CACHE.get(clipKey(section, division, id));
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(bus || master);
    src.start(0, Math.max(0, Math.min(buf.duration, offset || 0)));
    return src;
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
