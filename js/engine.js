/* ============================================================
   MTEAM Tempo Trainer — session engine
   Async state machine that runs the full training flow and drives
   the UI through callbacks. Metronome timing is Web-Audio accurate;
   voice cues and rests use awaited timers.

   Flow per item:
     [announce name] -> Joonbi -> count-in 1..5 -> Sijak
       -> metronome over the item's counts
       -> 2s pause -> Baro -> count-in 1..5 -> [rest]
   ============================================================ */
(function () {
  const MT = (window.MT = window.MT || {});

  MT._current = null; // the currently running player (for Stop)

  function wait(seconds, player) {
    return new Promise((resolve) => {
      if (player.cancelled) return resolve();
      const id = setTimeout(resolve, seconds * 1000);
      player.timers.push(id);
    });
  }

  // Run the metronome over a counts array; resolves when finished.
  // A count marked `tension` (5 or 8) is stretched into a slow Korean count
  // (하나…) — one beat + spoken number per second — for slow-motion movements.
  function runCounts(counts, soundId, player, cb, settings) {
    return new Promise((resolve) => {
      if (player.cancelled || !counts.length) return resolve();
      const startT = MT.now() + 0.15;

      // Expand counts into a flat event list (tension counts → N sub-beats).
      const events = [];
      let acc = startT;
      counts.forEach((c) => {
        if (c.tension === 5 || c.tension === 8) {
          const N = c.tension;
          for (let k = 1; k <= N; k++) {
            events.push({ t: acc, kind: "tension", n: c.n, k: k, N: N });
            acc += 1.0; // one second per tension count
          }
          // Preserve the "preset" time tapped beyond the count: the count's
          // total duration = counting seconds + reset/preset before the next poom.
          acc += Math.max(0, (c.duration || N) - N);
        } else {
          events.push({ t: acc, kind: "beat", n: c.n, accent: c.accent });
          acc += Math.max(0.1, c.duration);
        }
      });
      const endT = acc;

      // Schedule every beat up front, routed through the run bus.
      events.forEach((e) =>
        MT.playSound(soundId, e.t, e.kind === "beat" ? e.accent : e.k === 1, player.bus)
      );

      // Schedule the spoken tension numbers (speech isn't sample-accurate, so
      // fire via timers relative to now).
      if (settings && settings.voice) {
        events.forEach((e) => {
          if (e.kind !== "tension") return;
          const id = setTimeout(() => {
            if (!player.cancelled) MT.speak(MT.KO_NUMBERS_8[e.k - 1], { rate: 1.0 });
          }, Math.max(0, (e.t - MT.now()) * 1000));
          player.timers.push(id);
        });
      }

      let idx = -1;
      function tick() {
        if (player.cancelled) return resolve();
        const now = MT.now();
        let cur = 0;
        for (let i = 0; i < events.length; i++) {
          if (now >= events[i].t) cur = i;
          else break;
        }
        if (cur !== idx && now >= events[0].t) {
          idx = cur;
          const e = events[cur];
          if (e.kind === "tension") cb.onTension(e.k, e.N, e.n);
          else cb.onCount(e.n, counts.length);
        }
        cb.onProgress(Math.min(1, (now - startT) / (endT - startT)));
        if (now >= endT) return resolve();
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // Spoken count-in: numbers 1..5, one per beat.
  async function countIn(player, cb, settings) {
    for (let i = 0; i < 5; i++) {
      if (player.cancelled) return;
      cb.onPhase("count", MT.KO_NUMBERS[i], i + 1);
      const started = MT.now();
      if (settings.voice) MT.speak(MT.KO_NUMBERS[i], { rate: 1.0 });
      const elapsed = MT.now() - started;
      await wait(Math.max(0, settings.countBeat - elapsed), player);
    }
  }

  async function say(text, player, settings, opts) {
    if (player.cancelled) return;
    if (settings.voice) await MT.speak(text, opts);
    else await wait(0.6, player);
  }

  // Announce a form name — Yuna, using the Korean spelling for correct pronunciation.
  async function sayName(item, player, settings) {
    if (player.cancelled) return;
    if (settings.voice) await MT.speak(item.spoken || item.name);
    else await wait(0.6, player);
  }

  // Commands are spoken with the same clean, uniform Yuna voice as the form
  // names — no per-cue pitch/rate shaping (which sounded processed).
  const STYLE = {
    joonbi: {},
    sijak: {},
    baro: {},
  };

  // Beat of silence between phases (seconds).
  const GAP = 1.0;

  // Play the poomsae's real audio clip; resolves when it ends or is stopped.
  // Yuna counts over the audio during the clip's tension markers, so the
  // slow-count movements sound the same as in metronome mode.
  function playClip(item, player, cb) {
    return new Promise((resolve) => {
      if (player.cancelled) return resolve();
      const settings = MT.loadSettings();
      const src = MT.playClip(item.section, item.division, item.id, player.bus);
      if (!src) return resolve();
      player.clipSrc = src;
      const dur = src.buffer.duration;
      const startT = MT.now();
      const tensions =
        (MT.clipTensions && MT.clipTensions(item.section, item.division, item.id)) || [];
      let done = false;
      let lastSpoken = "";
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      src.onended = finish;
      (function tick() {
        if (player.cancelled) {
          try {
            src.stop();
          } catch (e) {}
          return finish();
        }
        const now = MT.now();
        const ct = now - startT; // time into the clip
        cb.onProgress(Math.min(1, ct / dur));

        // Is a tension window active right now?
        let m = null;
        for (let i = 0; i < tensions.length; i++) {
          const tm = tensions[i];
          if (ct >= tm.t && ct < tm.t + tm.sec) {
            m = tm;
            m._i = i;
            break;
          }
        }
        if (m) {
          const k = Math.min(m.sec, Math.floor(ct - m.t) + 1);
          const key = m._i + ":" + k;
          if (key !== lastSpoken) {
            lastSpoken = key;
            if (settings.voice) MT.speak(MT.KO_NUMBERS_8[k - 1], { rate: 1.0 });
            if (cb.onTension) cb.onTension(k, m.sec, 0);
          }
        } else {
          lastSpoken = "";
          if (cb.onClip) cb.onClip(ct, dur);
        }
        if (now < startT + dur) requestAnimationFrame(tick);
      })();
    });
  }

  /* ---- Drill flow: no Joonbi/Baro. 3-beep countdown → Sijak → reps →
     rest (beeps in the last 5s) → Sijak → next set. ---- */
  async function drillCountdown(player, cb, settings) {
    for (let n = 3; n >= 1; n--) {
      if (player.cancelled) return;
      cb.onPhase("countdown", "", n);
      MT.playSound("beep", MT.now() + 0.02, true, player.bus);
      await wait(1, player);
    }
    if (player.cancelled) return;
    cb.onPhase("sijak", "Sijak");
    await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
  }
  async function drillRest(seconds, player, cb, settings) {
    for (let r = seconds; r > 0; r--) {
      if (player.cancelled) return;
      cb.onPhase("rest", "Rest", r);
      if (r <= 5) MT.playSound("beep", MT.now() + 0.02, false, player.bus);
      await wait(1, player);
    }
    if (player.cancelled) return;
    cb.onPhase("sijak", "Sijak");
    await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
  }
  async function runDrill(session, player, cb, settings) {
    const drill = session.items[0];
    for (let s = 0; s < session.sets; s++) {
      if (player.cancelled) return;
      cb.onItem({ set: s + 1, sets: session.sets, item: 1, items: 1, name: drill.name });
      if (s === 0) await drillCountdown(player, cb, settings);
      if (player.cancelled) return;
      cb.onPhase("go", drill.name);
      await runCounts(drill.counts, drill.sound, player, cb, settings);
      if (player.cancelled) return;
      if (s < session.sets - 1) await drillRest(session.restSeconds, player, cb, settings);
    }
  }

  // session = {
  //   items: [{ type, name, sound, counts, announce, section, division }],
  //   sets, restSeconds, kind: 'drill' | undefined
  // }
  MT.runSession = async function (session, cb) {
    const settings = MT.loadSettings();
    const player = { cancelled: false, timers: [], bus: MT.createBus() };
    MT._current = player;
    MT.unlockAudio();

    if (session.kind === "drill") {
      await runDrill(session, player, cb, settings);
      const wc = player.cancelled;
      try {
        player.bus.disconnect();
      } catch (e) {}
      if (MT._current === player) MT._current = null;
      if (!wc) cb.onDone();
      return;
    }

    const totalItems = session.items.length;

    for (let s = 0; s < session.sets; s++) {
      for (let it = 0; it < totalItems; it++) {
        if (player.cancelled) break;
        const item = session.items[it];
        cb.onItem({
          set: s + 1,
          sets: session.sets,
          item: it + 1,
          items: totalItems,
          name: item.name,
          section: item.section,
          division: item.division,
        });

        // Announce the form name, then a 1s beat before Joonbi.
        if (item.announce) {
          cb.onPhase("announce", item.name);
          await sayName(item, player, settings);
          await wait(GAP, player);
        }

        // Joonbi, then a 1s beat before the count-in.
        cb.onPhase("joonbi", "Joonbi");
        await say(MT.CUES.joonbi.say, player, settings, STYLE.joonbi);
        await wait(GAP, player);

        // Count-in 1..5
        await countIn(player, cb, settings);
        if (player.cancelled) break;

        // Sijak — the poomsae starts immediately after.
        cb.onPhase("sijak", "Sijak");
        await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
        if (player.cancelled) break;

        // Play the real audio clip if one exists; otherwise the metronome.
        cb.onPhase("go", item.name);
        if (item.section && MT.hasClip && MT.hasClip(item.section, item.division, item.id)) {
          await playClip(item, player, cb);
        } else {
          await runCounts(item.counts, item.sound, player, cb, settings);
        }
        if (player.cancelled) break;

        // 1s pause after the last movement, then Baro
        cb.onPhase("hold", "—");
        await wait(1, player);
        cb.onPhase("baro", "Baro");
        await say(MT.CUES.baro.say, player, settings, STYLE.baro);

        // Recovery count 1..5 back into ready stance — poomsae only,
        // after a 0.5s beat. Drills don't get the recovery count.
        if (item.type !== "drill") {
          await wait(0.5, player);
          await countIn(player, cb, settings);
          if (player.cancelled) break;
        }

        // Rest, unless this is the very last item of the very last set
        const isLast = s === session.sets - 1 && it === totalItems - 1;
        if (!isLast && session.restSeconds > 0) {
          for (let r = session.restSeconds; r > 0; r--) {
            if (player.cancelled) break;
            cb.onPhase("rest", "Rest", r);
            await wait(1, player);
          }
        }
      }
      if (player.cancelled) break;
    }

    const wasCancelled = player.cancelled;
    try {
      player.bus.disconnect();
    } catch (e) {}
    if (MT._current === player) MT._current = null;
    if (!wasCancelled) cb.onDone();
  };

  MT.stopSession = function () {
    const p = MT._current;
    if (!p) return;
    p.cancelled = true;
    p.timers.forEach((id) => clearTimeout(id));
    MT.cancelSpeech();
    if (p.clipSrc) {
      try {
        p.clipSrc.stop();
      } catch (e) {}
      p.clipSrc = null;
    }
    try {
      p.bus.disconnect();
    } catch (e) {}
    MT._current = null;
  };

  // Expand a drill definition into a runnable item with a counts array.
  MT.drillToItem = function (drill) {
    const counts = [];
    for (let i = 0; i < drill.reps; i++) {
      counts.push({ n: i + 1, duration: drill.duration, accent: false });
    }
    return {
      type: "drill",
      name: drill.name,
      sound: drill.sound,
      counts,
      announce: false,
    };
  };

  // Build the list of form items for a session, resolving random mode.
  MT.buildFormItems = function (config, forms) {
    const mk = (f) => ({
      type: "form",
      id: f.id,
      name: f.name,
      spoken: f.spoken || f.name,
      sound: f.sound,
      counts: f.counts,
      announce: true,
      section: config.section,
      division: config.division,
    });
    if (config.mode === "pick") {
      return config.ids.map((id) => mk(forms.find((x) => x.id === id)));
    }
    // random from range [from, to], draw `count`
    const pool = forms.filter((f) => f.id >= config.from && f.id <= config.to);
    const drawn = [];
    let bag = [];
    for (let i = 0; i < config.count; i++) {
      if (config.noRepeat) {
        if (bag.length === 0) bag = shuffle(pool.slice());
        drawn.push(bag.pop());
      } else {
        drawn.push(pool[Math.floor(Math.random() * pool.length)]);
      }
    }
    return drawn.map(mk);
  };

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
})();
