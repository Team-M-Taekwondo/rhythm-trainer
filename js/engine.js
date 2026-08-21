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

  // Wall-clock wait (setTimeout), NOT the audio clock — on mobile the
  // AudioContext can get suspended/interrupted (iOS does this around speech),
  // which would freeze an audio-clock timer and hang the whole sequence.
  // Pause is handled explicitly: each active wait registers a controller in
  // player.waiters so Pause can freeze it and Resume can restart it. Stop/Skip
  // resolve it immediately (the caller then sees stopped() and bails).
  function wait(seconds, player) {
    return new Promise((resolve) => {
      if (stopped(player)) return resolve();
      let remaining = Math.max(0, seconds * 1000);
      let startedAt = 0;
      let timer = null;
      let settled = false;
      const ctl = {};
      function done() {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const i = player.waiters.indexOf(ctl);
        if (i >= 0) player.waiters.splice(i, 1);
        resolve();
      }
      function arm() {
        if (settled) return;
        startedAt = Date.now();
        timer = setTimeout(done, remaining);
      }
      ctl.pause = function () {
        if (settled || timer == null) return;
        clearTimeout(timer);
        timer = null;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      };
      ctl.resume = function () {
        if (!settled && timer == null) arm();
      };
      ctl.finish = done; // Stop/Skip resolve immediately
      player.waiters.push(ctl);
      if (!player.paused) arm();
    });
  }

  // Run the metronome over a counts array; resolves when finished.
  // A count marked `tension` (5 or 8) is stretched into a slow Korean count
  // (하나…) — one beat + spoken number per second — for slow-motion movements.
  function runCounts(counts, soundId, player, cb, settings) {
    return new Promise((resolve) => {
      if (stopped(player) || !counts.length) return resolve();

      // Expand counts into a flat event list with RELATIVE times (rt from 0),
      // so we can (re)schedule from any offset when the user scrubs.
      const events = [];
      let acc = 0;
      counts.forEach((c) => {
        if (c.tension === 5 || c.tension === 8) {
          const N = c.tension;
          for (let k = 1; k <= N; k++) {
            events.push({ rt: acc, kind: "tension", n: c.n, k: k, N: N });
            acc += 1.0; // one second per tension count
          }
          acc += Math.max(0, (c.duration || N) - N);
        } else {
          events.push({ rt: acc, kind: "beat", n: c.n, accent: c.accent, mark: c.mark, cd: c.cd });
          acc += Math.max(0.1, c.duration);
        }
      });
      const total = acc; // full metronome duration in seconds

      let metroBus = null; // sub-bus so a seek can cancel scheduled beats
      let startT = 0; // ctx time that maps to rt = 0 (shifts when seeking)
      let idx = -1;
      let done = false;
      const speechTimers = [];
      const finish = () => {
        if (done) return;
        done = true;
        player.seek = null;
        if (metroBus) try { metroBus.disconnect(); } catch (e) {}
        resolve();
      };

      // Schedule every beat/tension at or after `offset` seconds, starting ~now.
      function scheduleFrom(offset) {
        offset = Math.max(0, Math.min(total, offset));
        if (metroBus) try { metroBus.disconnect(); } catch (e) {}
        speechTimers.forEach((id) => clearTimeout(id));
        speechTimers.length = 0;
        metroBus = MT.createBus();
        // Route through the run bus (not master) so Stop/Skip still silence it.
        try { metroBus.disconnect(); } catch (e) {}
        metroBus.connect(player.bus);
        const t0 = MT.now() + 0.12;
        startT = t0 - offset;
        events.forEach((e) => {
          if (e.rt < offset - 1e-6) return;
          const at = startT + e.rt;
          if (e.kind === "beat" && e.mark) {
            MT.playMilestone(at, metroBus); // every-10th-rep marker
          } else {
            MT.playSound(soundId, at, e.kind === "beat" ? e.accent : e.k === 1, metroBus);
          }
          if (settings && settings.voice && e.kind === "tension") {
            const id = setTimeout(() => {
              if (!player.cancelled) MT.speak(MT.KO_NUMBERS_8[e.k - 1], { rate: 1.0 });
            }, Math.max(0, (at - MT.now()) * 1000));
            speechTimers.push(id);
            player.timers.push(id);
          }
          // Drill end-of-set countdown: the last 4 reps are spoken in Korean
          // (넷/셋/둘/하나) on the beat, so athletes hear the set closing out.
          if (settings && settings.voice && e.kind === "beat" && e.cd) {
            const id = setTimeout(() => {
              if (!player.cancelled) MT.speak(MT.KO_NUMBERS[e.cd - 1], { rate: 1.0 });
            }, Math.max(0, (at - MT.now()) * 1000));
            speechTimers.push(id);
            player.timers.push(id);
          }
        });
        idx = -1; // re-announce the count at the new position
      }
      scheduleFrom(0); // start from the beginning (t0 already builds in a lead-in)
      player.seek = (frac) => scheduleFrom(Math.max(0, Math.min(1, frac)) * total);

      function tick() {
        if (stopped(player)) return finish();
        const now = MT.now();
        const rt = now - startT;
        let cur = -1;
        for (let i = 0; i < events.length; i++) {
          if (rt >= events[i].rt - 1e-6) cur = i;
          else break;
        }
        if (cur !== idx && cur >= 0) {
          idx = cur;
          const e = events[cur];
          if (e.kind === "tension") cb.onTension(e.k, e.N, e.n);
          else cb.onCount(e.n, counts.length);
        }
        cb.onProgress(Math.min(1, Math.max(0, rt / total)));
        if (rt >= total) return finish();
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
      // A speed match can redirect this division to the U30 base clip at an
      // adjusted rate (see MT.resolveClip); otherwise it's the item's own clip.
      const clip = MT.resolveClip
        ? MT.resolveClip(item.section, item.division, item.id)
        : { section: item.section, division: item.division, id: item.id, rate: 1 };
      if (!clip) return resolve();
      const rate = clip.rate || 1;
      // Segment plan: the recording at the match speed, except the count
      // sections baked into the audio, which stay at the sample's own speed.
      const plan = MT.clipPlan
        ? MT.clipPlan(clip.section, clip.division, clip.id, rate)
        : { segments: [], duration: MT.clipDuration(clip.section, clip.division, clip.id) / rate };
      // Heard duration — shorter than the recording wherever the match speeds it up.
      const dur = plan.duration;
      if (!dur) return resolve();
      let handle = null;
      let playStart = 0; // ctx time that maps to heard 0 (shifts on seek)
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        player.seek = null;
        resolve();
      };
      // (Re)start from `offset` HEARD seconds. Web Audio can't seek a live
      // source, so we drop the old sources and schedule the plan again from
      // that point. Aborting the old handle keeps its end callback quiet.
      function startAt(offset) {
        offset = Math.max(0, Math.min(dur - 0.05, offset));
        if (handle) handle.stop();
        handle = MT.playPlanAt(clip.section, clip.division, clip.id, player.bus, plan, offset, finish);
        player.clipSrc = handle;
        playStart = handle ? handle.startedAt : MT.now() - offset;
      }
      startAt(0);
      if (!handle) return resolve();
      player.seek = (frac) => startAt(Math.max(0, Math.min(1, frac)) * dur);

      (function tick() {
        if (stopped(player)) {
          if (handle) handle.stop();
          return finish();
        }
        const elapsed = Math.min(dur, Math.max(0, MT.now() - playStart));
        cb.onProgress(elapsed / dur);
        if (cb.onClip) cb.onClip(elapsed, dur);
        if (elapsed >= dur - 0.02) return finish();
        requestAnimationFrame(tick);
      })();
    });
  }

  // Spoken get-ready countdown number (Korean Yuna, native numbers 하나…다섯) in
  // place of beeps — only 1–5 are voiced. Fire-and-forget so it overlaps the 1s
  // wait. Speech (not Web Audio) keeps a following spoken cue audible on iOS.
  function sayCountdown(r, settings) {
    if (settings && settings.voice && r >= 1 && r <= 5) {
      MT.speak(MT.KO_NUMBERS[r - 1]); // Korean Yuna, natural tuning
    }
  }

  /* ---- Drill flow: no Joonbi/Baro. Spoken 3-2-1 countdown → Sijak → reps →
     rest (spoken countdown in the last 5s) → Sijak → next set. ---- */
  // cue: which command opens the first set — "sijak" (drills) or "joonbi"
  // (general counting, where the instructor calls the start themselves).
  async function drillCountdown(player, cb, settings, cue) {
    for (let n = 3; n >= 1; n--) {
      if (stopped(player)) return;
      cb.onPhase("countdown", "", n);
      sayCountdown(n, settings);
      await wait(1, player);
    }
    if (stopped(player)) return;
    if (cue === "joonbi") {
      cb.onPhase("joonbi", "Joonbi");
      await say(MT.CUES.joonbi.say, player, settings, STYLE.joonbi);
    } else {
      cb.onPhase("sijak", "Sijak");
      await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
    }
  }
  // cue: which command opens the next set — "sijak" (drills) or "joonbi"
  // (general counting, where the instructor calls the start themselves).
  async function drillRest(seconds, player, cb, settings, cue) {
    for (let r = seconds; r > 0; r--) {
      if (stopped(player)) return;
      cb.onPhase("rest", "Rest", r);
      sayCountdown(r, settings);
      await wait(1, player);
    }
    if (stopped(player)) return;
    if (cue === "joonbi") {
      cb.onPhase("joonbi", "Joonbi");
      await say(MT.CUES.joonbi.say, player, settings, STYLE.joonbi);
    } else {
      cb.onPhase("sijak", "Sijak");
      await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
    }
  }
  // Rest countdown with no trailing "Sijak" — used after the final set.
  async function drillFinalRest(seconds, player, cb, settings) {
    for (let r = seconds; r > 0; r--) {
      if (stopped(player)) return;
      cb.onPhase("rest", "Rest", r);
      sayCountdown(r, settings);
      await wait(1, player);
    }
  }
  async function runDrill(session, player, cb, settings) {
    const drill = session.items[0];
    // The drill has no spoken cue to revive the audio clock, so make sure it's
    // running before the (audio-clock-driven) countdown/metronome start.
    if (MT.resumeAudio) MT.resumeAudio();
    for (let s = 0; s < session.sets; s++) {
      if (player.cancelled) return;
      player.skip = false; // each set starts fresh; a Skip advances to here
      cb.onItem({ set: s + 1, sets: session.sets, item: 1, items: 1, name: drill.name });
      if (s === 0) await drillCountdown(player, cb, settings);
      if (player.cancelled) return;
      cb.onPhase("go", drill.name);
      // First count lands one tempo interval after "Sijak", so the set opens
      // at the same pace it runs.
      await wait(drill.counts.length ? drill.counts[0].duration : 0, player);
      await runCounts(drill.counts, drill.sound, player, cb, settings);
      if (player.cancelled) return;
      if (s < session.sets - 1) await drillRest(session.restSeconds, player, cb, settings);
    }
    if (player.cancelled) return;
    if (session.endMode === "chime") {
      // Standing drills: no rest after the final set — the finish chime rings
      // right away so it's obvious the drill is over.
      cb.onPhase("done", "Complete");
      MT.playFinishChime();
      await wait(2.4, player); // let the bell ring out before onDone
      return;
    }
    // Default (ground/custom): run the selected rest time, then announce completion.
    if (session.restSeconds > 0) await drillFinalRest(session.restSeconds, player, cb, settings);
    if (player.cancelled) return;
    cb.onPhase("done", "Complete");
    await say("The drill has completed", player, settings, { lang: "en-US", absolute: true, rate: 0.95, pitch: 1.0 });
  }

  /* ---- Counting drill: spoken Korean counting for instructor-called drills.
     3-2-1 → Joonbi → count 1..target (decade style: 11→둘, 21→셋 …) at the
     chosen interval → rest with spoken countdown → Joonbi → next set. Ends with
     the chime, no rest after the final set. ---- */
  async function runCounting(session, player, cb, settings) {
    if (MT.resumeAudio) MT.resumeAudio();
    for (let s = 0; s < session.sets; s++) {
      if (player.cancelled) return;
      player.skip = false; // a Skip advances to the next set
      cb.onItem({ set: s + 1, sets: session.sets, item: 1, items: 1, name: "Counting" });
      if (s === 0) await drillCountdown(player, cb, settings, "joonbi");
      if (player.cancelled) return;
      cb.onPhase("go", "Counting");
      // First count comes a fixed 1s after "Joonbi" (drills use their tempo).
      await wait(1, player);
      for (let n = 1; n <= session.target; n++) {
        if (stopped(player)) break;
        cb.onCount(n, session.target);
        cb.onProgress(n / session.target);
        if (settings.voice) MT.speak(MT.countWord(n), { rate: 1.0 }); // fire-and-forget: keeps the interval steady
        await wait(session.interval, player);
      }
      if (player.cancelled) return;
      if (s < session.sets - 1) await drillRest(session.restSeconds, player, cb, settings, "joonbi");
    }
    if (player.cancelled) return;
    cb.onPhase("done", "Complete");
    MT.playFinishChime();
    await wait(2.4, player);
  }

  // One full poomsae: [announce] → Joonbi → count → Sijak → clip/metronome →
  // Baro → relax → recovery count. Caller handles onItem and any rest.
  async function runPoomsaeItem(item, player, cb, settings) {
    if (item.announce) {
      cb.onPhase("announce", item.name, item.id);
      await sayName(item, player, settings);
      await wait(GAP, player);
    }
    if (stopped(player)) return;
    cb.onPhase("joonbi", "Joonbi");
    await say(MT.CUES.joonbi.say, player, settings, STYLE.joonbi);
    if (stopped(player)) return;
    await wait(0.5, player); // brief beat before the count-in
    await countIn(player, cb, settings);
    if (stopped(player)) return;
    cb.onPhase("sijak", "Sijak");
    await say(MT.CUES.sijak.say, player, settings, STYLE.sijak);
    if (stopped(player)) return;
    cb.onPhase("go", item.name);
    if (item.section && MT.resolveClip && MT.resolveClip(item.section, item.division, item.id)) {
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
    await wait(0.5, player); // brief beat before the recovery count-in
    // Recovery 5-count after Baro, then the "at ease" (suh) command.
    await countIn(player, cb, settings);
    if (stopped(player)) return;
    await wait(0.5, player); // brief beat before the at-ease call
    cb.onPhase("relax", "Suh");
    await say(MT.CUES.swieo.say, player, settings, STYLE.swieo);
  }

  // Switch time between Mixed rounds — spoken countdown the last 5s.
  async function switchTimer(seconds, nextLabel, player, cb, settings) {
    for (let r = seconds; r > 0; r--) {
      if (stopped(player)) return;
      cb.onPhase("switch", nextLabel, r);
      sayCountdown(r, settings);
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
        id: item.id,
        section: "black",
        division: div,
      });
      await runPoomsaeItem(item, player, cb, settings);
      if (player.cancelled) return;
      if (r < session.rounds - 1) {
        await switchTimer(session.switchSeconds, labelOf(order[(r + 1) % order.length]), player, cb, settings);
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
    const player = { cancelled: false, skip: false, paused: false, seek: null, timers: [], waiters: [], bus: MT.createBus() };
    MT._current = player;
    MT.unlockAudio();

    if (session.kind === "drill" || session.kind === "mixed" || session.kind === "count") {
      if (session.kind === "drill") await runDrill(session, player, cb, settings);
      else if (session.kind === "count") await runCounting(session, player, cb, settings);
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
          id: item.id,
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
            // Spoken countdown the last 5 seconds so athletes get ready for the next poomsae.
            sayCountdown(r, settings);
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
    p.waiters.slice().forEach((w) => w.finish());
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
    p.waiters.slice().forEach((w) => w.pause());
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
    p.waiters.slice().forEach((w) => w.resume());
    try {
      if (window.speechSynthesis) window.speechSynthesis.resume();
    } catch (e) {}
    return false;
  };
  MT.isPaused = function () {
    return !!(MT._current && MT._current.paused);
  };

  // Scrub the current poomsae/clip. `frac` is 0..1 of the current item.
  // Only meaningful during the performance ("go") phase — canSeek() reflects that.
  MT.canSeek = function () {
    return !!(MT._current && MT._current.seek);
  };
  MT.seekCurrent = function (frac) {
    const p = MT._current;
    if (p && p.seek) p.seek(Math.max(0, Math.min(1, frac)));
  };

  // Skip the current poomsae / round / set and advance to the next one now.
  MT.skipSession = function () {
    const p = MT._current;
    if (!p || p.cancelled) return;
    if (p.paused) MT.resumeSession(); // so the next item can actually play
    p.skip = true;
    p.waiters.slice().forEach((w) => w.finish()); // release any active wait now
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
      const n = i + 1;
      const left = drill.reps - n + 1; // reps remaining including this one
      counts.push({
        n,
        duration: drill.duration,
        accent: false,
        // Mark the LAST rep so the milestone triple-beep fires at the end of the set.
        mark: n === drill.reps,
        // Spoken Korean countdown (4-3-2-1) over the final four reps.
        cd: left <= 4 ? left : 0,
      });
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
