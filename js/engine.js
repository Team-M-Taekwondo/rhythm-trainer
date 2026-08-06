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

  // A stage should bail if the run was cancelled (Stop) or the current item
  // was skipped (Skip).
  function stopped(player) {
    return player.cancelled || player.skip;
  }

  // Wait driven by the audio clock (not wall-clock) so Pause — which suspends
  // the AudioContext and freezes MT.now() — freezes these waits too. Resolves
  // early on Stop/Skip.
  function wait(seconds, player) {
    return new Promise((resolve) => {
      if (stopped(player)) return resolve();
      const end = MT.now() + seconds;
      (function poll() {
        if (stopped(player)) return resolve();
        if (MT.now() >= end) return resolve();
        requestAnimationFrame(poll);
      })();
    });
  }

  // Run the metronome over a counts array; resolves when finished.
  // A count marked `tension` (5 or 8) is stretched into a slow Korean count
  // (하나…) — one beat + spoken number per second — for slow-motion movements.
  function runCounts(counts, soundId, player, cb, settings) {
    return new Promise((resolve) => {
      if (stopped(player) || !counts.length) return resolve();
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
        if (stopped(player)) return resolve();
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
      if (stopped(player)) return;
      cb.onPhase("count", MT.KO_NUMBERS[i], i + 1);
      const started = MT.now();
      if (settings.voice) MT.speak(MT.KO_NUMBERS[i], { rate: 1.0 });
      const elapsed = MT.now() - started;
      await wait(Math.max(0, settings.countBeat - elapsed), player);
    }
  }

  async function say(text, player, settings, opts) {
    if (stopped(player)) return;
    if (settings.voice) await MT.speak(text, opts);
    else await wait(0.6, player);
  }

  // Announce a form name — Yuna, using the Korean spelling for correct pronunciation.
  async function sayName(item, player, settings) {
    if (stopped(player)) return;
    if (settings.voice) await MT.speak(item.spoken || item.name);
    else await wait(0.6, player);
  }

  // Commands are spoken with the same clean, uniform Yuna voice as the form
  // names — no per-cue pitch/rate shaping (which sounded processed).
  const STYLE = {
    joonbi: {},
    sijak: {},
    baro: {},
    swieo: {},
  };

  // Beat of silence between phases (seconds).
  const GAP = 1.0;

  // Play the poomsae's real audio clip (counting is baked into the audio);
  // resolves when it ends or is stopped.
  function playClip(item, player, cb) {
    return new Promise((resolve) => {
      if (stopped(player)) return resolve();
      const src = MT.playClip(item.section, item.division, item.id, player.bus);
      if (!src) return resolve();
      player.clipSrc = src;
      const dur = src.buffer.duration;
      const startT = MT.now();
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      src.onended = finish;
      (function tick() {
        if (stopped(player)) {
          try {
            src.stop();
          } catch (e) {}
          return finish();
        }
        const now = MT.now();
        cb.onProgress(Math.min(1, (now - startT) / dur));
        if (cb.onClip) cb.onClip(now - startT, dur);
        if (now < startT + dur) requestAnimationFrame(tick);
      })();
    });
  }

  /* ---- Drill flow: no Joonbi/Baro. 3-beep countdown → Sijak → reps →
     rest (beeps in the last 5s) → Sijak → next set. ---- */
  async function drillCountdown(player, cb, settings) {
    for (let n = 3; n >= 1; n--) {
      if (stopped(player)) return;
      cb.onPhase("countdown", "", n);
      MT.playSound("beep", MT.now() + 0.02, true, player.bus);
      await wait(1, player);
    }
    if (stopped(player)) return;
    cb.onPhase("sijak", "Sijak");
    await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
  }
  async function drillRest(seconds, player, cb, settings) {
    for (let r = seconds; r > 0; r--) {
      if (stopped(player)) return;
      cb.onPhase("rest", "Rest", r);
      if (r <= 5) MT.playSound("beep", MT.now() + 0.02, false, player.bus);
      await wait(1, player);
    }
    if (stopped(player)) return;
    cb.onPhase("sijak", "Sijak");
    await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
  }
  async function runDrill(session, player, cb, settings) {
    const drill = session.items[0];
    for (let s = 0; s < session.sets; s++) {
      if (player.cancelled) return;
      player.skip = false; // each set starts fresh; a Skip advances to here
      cb.onItem({ set: s + 1, sets: session.sets, item: 1, items: 1, name: drill.name });
      if (s === 0) await drillCountdown(player, cb, settings);
      if (player.cancelled) return;
      cb.onPhase("go", drill.name);
      await runCounts(drill.counts, drill.sound, player, cb, settings);
      if (player.cancelled) return;
      if (s < session.sets - 1) await drillRest(session.restSeconds, player, cb, settings);
    }
  }

  // One full poomsae: [announce] → Joonbi → count → Sijak → clip/metronome →
  // Baro → relax → recovery count. Caller handles onItem and any rest.
  async function runPoomsaeItem(item, player, cb, settings) {
    if (item.announce) {
      cb.onPhase("announce", item.name);
      await sayName(item, player, settings);
      await wait(GAP, player);
    }
    if (stopped(player)) return;
    cb.onPhase("joonbi", "Joonbi");
    await say(MT.CUES.joonbi.say, player, settings, STYLE.joonbi);
    await countIn(player, cb, settings);
    if (stopped(player)) return;
    cb.onPhase("sijak", "Sijak");
    await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
    if (stopped(player)) return;
    cb.onPhase("go", item.name);
    if (item.section && MT.hasClip && MT.hasClip(item.section, item.division, item.id)) {
      await playClip(item, player, cb);
    } else {
      await runCounts(item.counts, item.sound, player, cb, settings);
    }
    if (stopped(player)) return;
    cb.onPhase("hold", "—");
    await wait(1, player);
    cb.onPhase("baro", "Baro");
    await say(MT.CUES.baro.say, player, settings, STYLE.baro);
    if (stopped(player)) return;
    // Recovery 5-count after Baro, then the "at ease" (suh) command.
    await countIn(player, cb, settings);
    if (stopped(player)) return;
    await wait(0.5, player); // brief beat before the at-ease call
    cb.onPhase("relax", "Suh");
    await say(MT.CUES.swieo.say, player, settings, STYLE.swieo);
  }

  // Switch time between Mixed rounds — counts down, beeps the last 5s.
  async function switchTimer(seconds, nextLabel, player, cb) {
    for (let r = seconds; r > 0; r--) {
      if (stopped(player)) return;
      cb.onPhase("switch", nextLabel, r);
      if (r <= 5) MT.playSound("beep", MT.now() + 0.02, false, player.bus);
      await wait(1, player);
    }
  }

  // Mixed: N rounds, each round one division performs a random poomsae,
  // rotating sequentially through the selected divisions, with a switch
  // timer (beeps last 5s) between rounds.
  async function runMixed(session, player, cb, settings) {
    const forms = MT.loadForms();
    const order = MT.CLIP_DIVISIONS.filter((id) => session.divisions.indexOf(id) !== -1);
    if (!order.length) return;
    const labelOf = (id) => (MT.DIVISIONS.find((d) => d.id === id) || {}).label || id;
    for (let r = 0; r < session.rounds; r++) {
      if (player.cancelled) return;
      player.skip = false; // each round starts fresh; a Skip advances to here
      const div = order[r % order.length];
      const allIds = forms.map((x) => x.id);
      const ids = (MT.MIXED_POOMSAE[div] || MT.poomsaeIdsFor("black", div, forms)).filter(
        (id) => allIds.indexOf(id) !== -1
      );
      const f = forms.find((x) => x.id === ids[Math.floor(Math.random() * ids.length)]);
      if (!f) continue;
      const item = {
        type: "form",
        id: f.id,
        name: f.name,
        spoken: f.spoken || f.name,
        sound: f.sound,
        counts: f.counts,
        announce: true,
        section: "black",
        division: div,
      };
      cb.onItem({
        set: r + 1,
        sets: session.rounds,
        item: 1,
        items: 1,
        name: item.name,
        section: "black",
        division: div,
      });
      await runPoomsaeItem(item, player, cb, settings);
      if (player.cancelled) return;
      if (r < session.rounds - 1) {
        await switchTimer(session.switchSeconds, labelOf(order[(r + 1) % order.length]), player, cb);
      }
    }
  }

  // session = {
  //   items: [...], sets, restSeconds,
  //   kind: 'drill' | 'mixed' | undefined,
  //   divisions, rounds, switchSeconds   // for 'mixed'
  // }
  MT.runSession = async function (session, cb) {
    const settings = MT.loadSettings();
    const player = { cancelled: false, skip: false, paused: false, timers: [], bus: MT.createBus() };
    MT._current = player;
    MT.unlockAudio();

    if (session.kind === "drill" || session.kind === "mixed") {
      if (session.kind === "drill") await runDrill(session, player, cb, settings);
      else await runMixed(session, player, cb, settings);
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
        player.skip = false; // each poomsae starts fresh; a Skip advances to here
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

        await runPoomsaeItem(item, player, cb, settings);
        if (player.cancelled) break;

        // Rest, unless this is the very last item of the very last set
        const isLast = s === session.sets - 1 && it === totalItems - 1;
        if (!isLast && session.restSeconds > 0) {
          for (let r = session.restSeconds; r > 0; r--) {
            if (stopped(player)) break;
            cb.onPhase("rest", "Rest", r);
            // Beep the last 5 seconds so athletes get ready for the next poomsae.
            if (r <= 5) MT.playSound("beep", MT.now() + 0.02, false, player.bus);
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
    // Leave the audio clock running for the next session even if Stop was hit
    // while paused.
    if (p.paused) {
      p.paused = false;
      MT.resumeAudio();
    }
    MT._current = null;
  };

  // Pause the whole run: suspend the audio clock (freezes every timed stage)
  // and pause any in-flight speech. Returns whether we're now paused.
  MT.pauseSession = function () {
    const p = MT._current;
    if (!p || p.cancelled || p.paused) return !!(p && p.paused);
    p.paused = true;
    try {
      if (window.speechSynthesis) window.speechSynthesis.pause();
    } catch (e) {}
    MT.suspendAudio();
    return true;
  };
  MT.resumeSession = function () {
    const p = MT._current;
    if (!p || p.cancelled || !p.paused) return false;
    p.paused = false;
    MT.resumeAudio();
    try {
      if (window.speechSynthesis) window.speechSynthesis.resume();
    } catch (e) {}
    return false;
  };
  MT.isPaused = function () {
    return !!(MT._current && MT._current.paused);
  };

  // Skip the current poomsae / round / set and advance to the next one now.
  MT.skipSession = function () {
    const p = MT._current;
    if (!p || p.cancelled) return;
    if (p.paused) MT.resumeSession(); // so the next item can actually play
    p.skip = true;
    // Silence whatever this item already scheduled: stop the clip and swap in a
    // fresh bus (the old one — with its queued beats — is disconnected).
    if (p.clipSrc) {
      try {
        p.clipSrc.stop();
      } catch (e) {}
      p.clipSrc = null;
    }
    try {
      p.bus.disconnect();
    } catch (e) {}
    p.bus = MT.createBus();
    MT.cancelSpeech();
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
