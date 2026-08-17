/* ============================================================
   MTEAM Tempo Trainer — UI controller
   Wires screens, builds sessions, and renders the run view.
   ============================================================ */
(function () {
  const MT = window.MT;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let forms = MT.loadForms();
  let settings = MT.loadSettings();

  /* -------------------- admin gate --------------------
     Editor + Settings are admin-only. Unlock a device with ?admin=1
     (persists), lock it again with ?admin=0. The team uses the plain URL
     and never sees them. (Client-side gate — obscurity, not hard security.) */
  const _params = new URLSearchParams(location.search);
  if (_params.get("admin") === "1") localStorage.setItem("mteam.admin", "1");
  if (_params.get("admin") === "0") localStorage.removeItem("mteam.admin");
  const isAdmin = localStorage.getItem("mteam.admin") === "1";
  document.body.classList.toggle("admin", isAdmin);

  /* -------------------- debug overlay (?debug=1) --------------------
     Shows a live log of audio-context state + speech events on-screen, so we
     can see what iOS is doing to the spoken cues on a real device. */
  if (_params.get("debug") === "1") {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;top:0;left:0;right:0;max-height:38vh;overflow:hidden;z-index:99999;" +
      "background:rgba(0,0,0,.86);color:#7CFC00;font:11px/1.3 ui-monospace,Menlo,monospace;" +
      "padding:6px 8px;white-space:pre-wrap;pointer-events:none;";
    const add = () => document.body.appendChild(box);
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
    const lines = [];
    let n = 0;
    const t0 = performance.now();
    MT._log = function (m) {
      n++;
      lines.push(n + " +" + Math.round(performance.now() - t0) + "ms " + m);
      if (lines.length > 40) lines.shift();
      box.textContent = lines.join("\n");
    };
    MT._log(
      "debug on · SS=" + (window.speechSynthesis ? "yes" : "no") +
      " voices=" + (window.speechSynthesis ? speechSynthesis.getVoices().length : 0)
    );
  }

  /* -------------------- brand logo on every screen --------------------
     Home has the big logo; stamp a small MTEAM mark into every other screen's
     header so the brand shows across the whole app. */
  (function stampLogos() {
    const mk = (cls) => {
      const img = document.createElement("img");
      img.className = cls;
      img.src = "assets/logo1.JPG";
      img.alt = "MTEAM";
      img.onerror = function () {
        this.onerror = null;
        this.src = "assets/logo-light.svg";
        this.classList.add("logo-fallback");
      };
      return img;
    };
    $$(".topbar").forEach((bar) => bar.appendChild(mk("topbar-logo")));
    const runTop = $(".run-top");
    if (runTop) runTop.insertBefore(mk("run-top-logo"), runTop.querySelector(".run-meta"));
  })();

  /* -------------------- home button on every screen --------------------
     Quick way back to the home screen from anywhere (the run screen already
     has its own exit ×). Routed through the same data-goto click handler. */
  (function stampHomeButtons() {
    $$(".topbar").forEach((bar) => {
      const b = document.createElement("button");
      b.className = "icon-btn home-btn";
      b.dataset.goto = "home";
      b.setAttribute("aria-label", "Home");
      b.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>';
      bar.appendChild(b);
    });
  })();

  /* -------------------- screen routing -------------------- */
  function show(name) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.dataset.screen === name));
    window.scrollTo(0, 0);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-goto]");
    if (t) {
      const dest = t.dataset.goto;
      // Block admin-only screens for the team.
      if (!isAdmin && (dest === "editor" || dest === "settings")) return;
      if (dest === "editor") renderEditor();
      if (dest === "settings") renderSettings();
      if (dest === "build-forms") renderFormsBuilder();
      if (dest === "build-drill") renderDrillBuilder();
      if (dest === "preset-drills") renderPresetList();
      if (dest === "build-count") renderCountBuilder();
      if (dest === "randomizer") renderRandomizer();
      show(dest);
    }
  });

  /* -------------------- helpers -------------------- */
  function fillTempoSelect(sel, value, suffix, tempos) {
    const list = tempos || MT.TEMPOS;
    const suf = suffix != null ? suffix : " s";
    sel.innerHTML = list.map((v) => `<option value="${v}">${v}${suf}</option>`).join("");
    sel.value = value != null ? value : 1;
  }
  /* -------------------- FORMS builder -------------------- */
  let formsSection = "black";
  let formsDivision = "cadet";
  function sectionForms(section, division) {
    const all = MT.loadForms();
    const ids = MT.poomsaeIdsFor(section, division, all);
    return all.filter((f) => ids.indexOf(f.id) !== -1);
  }
  function renderFormsBuilder() {
    forms = MT.loadForms();
    $$("#forms-section .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.section === formsSection)
    );
    $("#forms-division-wrap").hidden = formsSection !== "black";
    $("#forms-division").innerHTML = MT.DIVISIONS.map(
      (d) => `<option value="${d.id}">${d.label}</option>`
    ).join("");
    $("#forms-division").value = formsDivision;

    // Mixed mode: swap the normal poomsae panels for the rotation config.
    const isMixed = formsSection === "black" && formsDivision === "mixed";
    $("#panel-choose").hidden = isMixed;
    $("#panel-rest").hidden = isMixed;
    $("#mixed-config").hidden = !isMixed;
    if (isMixed) {
      if (!$("#mixed-divisions").children.length) {
        $("#mixed-divisions").innerHTML = MT.CLIP_DIVISIONS.map((id) => {
          const label = (MT.DIVISIONS.find((d) => d.id === id) || {}).label || id;
          return `<label class="check-item"><input type="checkbox" value="${id}" checked /><span class="ci-name">${label}</span></label>`;
        }).join("");
      }
      return;
    }

    const secForms = sectionForms(formsSection, formsDivision);
    $("#forms-checklist").innerHTML = secForms
      .map(
        (f) => `
      <label class="check-item">
        <input type="checkbox" value="${f.id}" />
        <span class="ci-name">${f.id}. ${f.name}</span>
        <span class="ci-meta">${f.movements} Pooms</span>
      </label>`
      )
      .join("");

    const opts = secForms
      .map((f) => `<option value="${f.id}">${f.id} · ${f.name}</option>`)
      .join("");
    $("#rand-from").innerHTML = opts;
    $("#rand-to").innerHTML = opts;
    $("#rand-from").value = secForms[0].id;
    $("#rand-to").value = secForms[secForms.length - 1].id;
  }
  $$("#forms-section .seg-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      formsSection = btn.dataset.section;
      renderFormsBuilder();
    })
  );
  $("#forms-division").addEventListener("change", (e) => {
    formsDivision = e.target.value;
    renderFormsBuilder();
  });

  $$("#forms-mode .seg-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$("#forms-mode .seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const random = btn.dataset.mode === "random";
      $("#forms-random").classList.toggle("hidden", !random);
      $("#forms-pick").classList.toggle("hidden", random);
    })
  );

  $("#start-forms").addEventListener("click", () => {
    MT.unlockAudio();

    // Mixed rotation session.
    if (formsSection === "black" && formsDivision === "mixed") {
      const divisions = $$("#mixed-divisions input:checked").map((c) => c.value);
      if (!divisions.length) return alert("Pick at least one division for the rotation.");
      startRun({
        kind: "mixed",
        divisions,
        rounds: Math.max(1, Number($("#mixed-rounds").value) || 1),
        switchSeconds: Math.max(0, Number($("#mixed-switch").value) || 0),
      });
      return;
    }

    const mode = $("#forms-mode .seg-btn.active").dataset.mode;
    let config;
    if (mode === "pick") {
      const ids = $$("#forms-checklist input:checked").map((c) => Number(c.value));
      if (!ids.length) return alert("Pick at least one poomsae.");
      config = { mode: "pick", ids };
    } else {
      const from = Number($("#rand-from").value);
      const to = Number($("#rand-to").value);
      if (from > to) return alert("'From' must be ≤ 'To'.");
      config = {
        mode: "random",
        from,
        to,
        count: Math.max(1, Number($("#rand-count").value) || 1),
        noRepeat: $("#rand-norepeat").checked,
      };
    }
    config.section = formsSection;
    config.division = formsSection === "black" ? formsDivision : "";
    const items = MT.buildFormItems(config, MT.loadForms());
    startRun({
      items,
      sets: 1,
      restSeconds: Math.max(0, Number($("#forms-rest").value) || 0),
    });
  });

  /* -------------------- DRILL builder -------------------- */
  let drillSound = "woodblock";
  function renderDrillBuilder() {
    fillTempoSelect($("#drill-tempo"), 0.8, "", MT.DRILL_TEMPOS);
    renderDrillSoundChips();
  }
  function renderDrillSoundChips() {
    $("#drill-sound-chips").innerHTML = MT.SOUNDS.map(
      (s) =>
        `<button class="sound-chip ${s.id === drillSound ? "active" : ""}" data-sound="${s.id}">${s.label}</button>`
    ).join("");
  }
  $("#drill-sound-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".sound-chip");
    if (!chip) return;
    drillSound = chip.dataset.sound;
    renderDrillSoundChips();
    playSoundSample(drillSound);
  });

  $("#start-drill").addEventListener("click", () => {
    MT.unlockAudio();
    const tempo = Number($("#drill-tempo").value);
    const drill = {
      name: "Drill",
      reps: Math.max(1, Number($("#drill-reps").value) || 1),
      duration: tempo,
      sound: drillSound,
    };
    startRun({
      kind: "drill",
      items: [MT.drillToItem(drill)],
      sets: Math.max(1, Number($("#drill-sets").value) || 1),
      restSeconds: Math.max(0, Number($("#drill-rest").value) || 0),
      tempoLabel: tempo.toFixed(1) + "s / rep",
    });
  });

  /* -------------------- PRESET DRILLS (Team Presets) -------------------- */
  let presetLevel = "black";
  let presetDrill = null; // the preset opened on the config screen

  const levelDelta = () =>
    (MT.PRESET_LEVELS.find((l) => l.id === presetLevel) || {}).delta || 0;
  // Level moves tempo only; snap to the 0.1s grid the tempo select uses.
  const levelTempo = (base) => Math.max(0.1, Math.round((base + levelDelta()) * 10) / 10);

  function renderLevelSeg(sel) {
    $(sel).innerHTML = MT.PRESET_LEVELS.map(
      (l) =>
        `<button class="seg-btn ${l.id === presetLevel ? "active" : ""}" data-level="${l.id}">${l.label}</button>`
    ).join("");
  }
  function renderPresetList() {
    renderLevelSeg("#preset-level");
    const groups = [];
    MT.PRESET_DRILLS.forEach((d) => {
      let g = groups.find((x) => x.name === d.group);
      if (!g) groups.push((g = { name: d.group, drills: [] }));
      g.drills.push(d);
    });
    $("#preset-list").innerHTML = groups
      .map(
        (g) => `
      <div class="panel">
        <h2>${g.name}</h2>
        <div class="checklist">
          ${g.drills
            .map(
              (d) => `
            <button class="preset-row" data-preset="${d.id}">
              <span class="pr-name">${d.name}</span>
              <span class="pr-meta">${levelTempo(d.tempo).toFixed(1)}s tempo · ${d.reps} reps · ${d.sets} sets · ${d.rest}s rest</span>
            </button>`
            )
            .join("")}
        </div>
      </div>`
      )
      .join("");
  }
  $("#preset-level").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (!b) return;
    presetLevel = b.dataset.level;
    renderPresetList();
  });
  $("#preset-list").addEventListener("click", (e) => {
    const row = e.target.closest("[data-preset]");
    if (!row) return;
    openPresetConfig(row.dataset.preset);
  });
  function openPresetConfig(id) {
    const d = MT.PRESET_DRILLS.find((x) => x.id === id);
    if (!d) return;
    presetDrill = d;
    $("#preset-title").textContent = d.name;
    renderLevelSeg("#preset-cfg-level");
    fillTempoSelect($("#preset-tempo"), levelTempo(d.tempo), "", MT.DRILL_TEMPOS);
    $("#preset-reps").value = d.reps;
    $("#preset-sets").value = d.sets;
    $("#preset-rest").value = d.rest;
    $("#preset-rounds").value = 1;
    show("preset-config");
  }
  $("#preset-cfg-level").addEventListener("click", (e) => {
    const b = e.target.closest("[data-level]");
    if (!b || !presetDrill) return;
    presetLevel = b.dataset.level;
    renderLevelSeg("#preset-cfg-level");
    $("#preset-tempo").value = levelTempo(presetDrill.tempo);
  });
  $("#start-preset").addEventListener("click", () => {
    if (!presetDrill) return;
    MT.unlockAudio();
    const tempo = Number($("#preset-tempo").value);
    const setsPerRound = Math.max(1, Number($("#preset-sets").value) || 1);
    const rounds = Math.max(1, Number($("#preset-rounds").value) || 1);
    startRun({
      kind: "drill",
      items: [
        MT.drillToItem({
          name: presetDrill.name,
          reps: Math.max(1, Number($("#preset-reps").value) || 1),
          duration: tempo,
          sound: "woodblock",
        }),
      ],
      sets: setsPerRound * rounds,
      setsPerRound,
      rounds,
      restSeconds: Math.max(0, Number($("#preset-rest").value) || 0),
      endMode: presetDrill.end,
      tempoLabel: tempo.toFixed(1) + "s / rep",
    });
  });

  /* -------------------- KOREAN COUNTING builder -------------------- */
  let countInterval = 2.0;
  function renderCountBuilder() {
    renderCountChips();
    fillTempoSelect($("#count-custom"), countInterval, "", MT.DRILL_TEMPOS);
  }
  function renderCountChips() {
    $("#count-intervals").innerHTML = MT.COUNT_INTERVALS.map(
      (i) =>
        `<button class="sound-chip ${Math.abs(i.v - countInterval) < 0.001 ? "active" : ""}" data-int="${i.v}">${i.v.toFixed(1)}s · ${i.label}</button>`
    ).join("");
  }
  $("#count-intervals").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-int]");
    if (!chip) return;
    countInterval = Number(chip.dataset.int);
    renderCountChips();
    $("#count-custom").value = countInterval;
  });
  $("#count-custom").addEventListener("change", (e) => {
    countInterval = Number(e.target.value);
    renderCountChips(); // active chip follows only if it matches a preset
  });
  $("#start-count").addEventListener("click", () => {
    MT.unlockAudio();
    startRun({
      kind: "count",
      target: Math.max(1, Number($("#count-target").value) || 10),
      interval: countInterval,
      sets: Math.max(1, Number($("#count-sets").value) || 1),
      restSeconds: Math.max(0, Number($("#count-rest").value) || 0),
      tempoLabel: countInterval.toFixed(1) + "s / count",
    });
  });

  /* -------------------- POOMSAE RANDOMIZER -------------------- */
  let rzSection = "black";
  let rzDivision = "youth";
  let rzRank = "yellow";

  function renderRandomizer() {
    $$("#rz-section .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.section === rzSection)
    );
    const isBlack = rzSection === "black";
    $("#rz-div-wrap").hidden = !isBlack;
    $("#rz-rank-wrap").hidden = isBlack;
    // Black → real divisions (Youth…O30); Color → belt-rank ladder.
    $("#rz-div").innerHTML = MT.CLIP_DIVISIONS.map((id) => {
      const d = MT.DIVISIONS.find((x) => x.id === id) || { id, label: id };
      return `<option value="${d.id}">${d.label}</option>`;
    }).join("");
    $("#rz-div").value = rzDivision;
    $("#rz-rank").innerHTML = MT.COLOR_RANKS.map(
      (r) => `<option value="${r.id}">${r.label}</option>`
    ).join("");
    $("#rz-rank").value = rzRank;
    updateRzPool();
    $("#rz-num").textContent = "—";
    $("#rz-name").textContent = "Tap Randomize";
  }

  function updateRzPool() {
    if (rzSection === "black") {
      const label = (MT.DIVISIONS.find((d) => d.id === rzDivision) || {}).label || rzDivision;
      $("#rz-pool").textContent = `Drawing from the ${label} compulsory set.`;
    } else {
      const rank = MT.COLOR_RANKS.find((r) => r.id === rzRank);
      $("#rz-pool").textContent = `Drawing from Taegeuk 1–${rank ? rank.max : 8}.`;
    }
  }

  $$("#rz-section .seg-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      rzSection = btn.dataset.section;
      renderRandomizer();
    })
  );
  $("#rz-div").addEventListener("change", (e) => {
    rzDivision = e.target.value;
    updateRzPool();
  });
  $("#rz-rank").addEventListener("change", (e) => {
    rzRank = e.target.value;
    updateRzPool();
  });
  $("#rz-go").addEventListener("click", () => {
    const forms = MT.loadForms();
    const key = rzSection === "black" ? rzDivision : rzRank;
    const ids = MT.randomizerIdsFor(rzSection, key, forms);
    if (!ids.length) return;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const f = forms.find((x) => x.id === id);
    if (!f) return;
    $("#rz-num").textContent = f.id;
    $("#rz-name").textContent = f.name;
    // Announce the poomsae name (respects the voice on/off setting).
    MT.unlockAudio();
    if (MT.loadSettings().voice) MT.speak(f.spoken || f.name);
    // quick pop animation
    const card = $("#rz-name").closest(".rz-result");
    if (card) {
      card.classList.remove("rz-pop");
      void card.offsetWidth; // reflow so the animation restarts
      card.classList.add("rz-pop");
    }
  });

  /* -------------------- RUN view -------------------- */
  const PHASE_LABELS = {
    announce: "Next Poomsae",
    joonbi: "Joonbi",
    count: "Ready",
    sijak: "Sijak!",
    go: "Go",
    hold: "Hold",
    baro: "Baro",
    rest: "Rest",
    countdown: "Ready",
    switch: "Switch",
    relax: "Suh",
    done: "Complete",
  };

  /* -------- keep the screen awake during a session (Screen Wake Lock) -------- */
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }
  // The lock drops when the tab is hidden — re-acquire it when we come back,
  // but only while a run is still on screen.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && document.body.classList.contains("running")) {
      requestWakeLock();
    }
  });

  // Taegeuk 1–8 get their number appended on the run screen, so color belts who
  // don't know the Korean name can still recognize which poomsae it is.
  function poomTitle(name, id) {
    return id != null && id >= 1 && id <= 8 ? `${name} (${id})` : name;
  }

  function beltLabel(section, division) {
    if (!section) return "";
    const sec = section === "black" ? "Black Belt" : "Color Belt";
    if (section === "black" && division) {
      const d = (MT.DIVISIONS.find((x) => x.id === division) || {}).label || division;
      return sec + " · " + d;
    }
    return sec;
  }

  let currentSession = null;
  function startRun(session) {
    currentSession = session;
    show("run");
    document.body.classList.add("running");
    requestWakeLock(); // keep the screen on during training
    setPauseUI(false);
    const elCount = $("#run-count");
    const elMax = $("#run-countmax");
    const elPhase = $("#run-phase");
    const elTitle = $("#run-title");
    const elSet = $("#run-setinfo");
    const elItem = $("#run-iteminfo");
    const elBelt = $("#run-belt");
    const elProg = $("#run-progress");

    scrubbing = false;
    progressBar.classList.remove("scrubbable", "scrubbing");
    setBar(0);
    elCount.textContent = "0";
    elMax.textContent = "";
    // Show the tempo this session runs at (drills & counting).
    $("#run-tempo").textContent = session.tempoLabel || "";

    MT.runSession(session, {
      onItem(info) {
        // Preset drills run rounds × sets; show both when rounds are in play.
        const spr = session.setsPerRound;
        if (spr && session.rounds > 1) {
          const round = Math.ceil(info.set / spr);
          const setIn = ((info.set - 1) % spr) + 1;
          elSet.textContent = `Round ${round}/${session.rounds} · Set ${setIn}/${spr}`;
        } else {
          elSet.textContent = `Set ${info.set} / ${info.sets}`;
        }
        elItem.textContent =
          info.items > 1 ? `${info.item} / ${info.items}` : "";
        elTitle.textContent = poomTitle(info.name, info.id);
        elBelt.textContent = beltLabel(info.section, info.division);
      },
      onPhase(phase, label, num) {
        document.body.dataset.phase = phase;
        elPhase.textContent = PHASE_LABELS[phase] || label;
        // The bar is scrubbable only during the performance ("go") phase.
        // Counting sessions can't seek (speech-driven), so no thumb there.
        const seekable = phase === "go" && session.kind !== "count";
        progressBar.classList.toggle("scrubbable", seekable);
        if (!seekable) {
          scrubbing = false;
          progressBar.classList.remove("scrubbing");
        }
        if (!scrubbing) setBar(0);
        if (phase === "count") {
          elCount.textContent = num;
          elMax.textContent = "count-in";
        } else if (phase === "countdown") {
          elCount.textContent = num;
          elMax.textContent = "get ready";
        } else if (phase === "rest") {
          elCount.textContent = num;
          elMax.textContent = "seconds";
          elTitle.textContent = "Rest";
        } else if (phase === "switch") {
          elCount.textContent = num;
          elMax.textContent = "switch";
          elTitle.textContent = label + " up next";
        } else if (phase === "announce") {
          elCount.textContent = "";
          elMax.textContent = "";
          elTitle.textContent = poomTitle(label, num);
        } else if (phase === "go") {
          elCount.textContent = "1";
        } else if (phase === "done") {
          elCount.textContent = "✓";
          elMax.textContent = "";
          elTitle.textContent = "Well done";
        } else if (
          phase === "joonbi" ||
          phase === "sijak" ||
          phase === "baro" ||
          phase === "relax"
        ) {
          elCount.textContent = "";
          elMax.textContent = "";
        }
      },
      onCount(n, total) {
        document.body.dataset.phase = "go";
        elCount.textContent = n;
        elMax.textContent = `of ${total}`;
      },
      onTension(k, N, formN) {
        document.body.dataset.phase = "tension";
        elPhase.textContent = `SLOW · ${N}s`;
        elCount.textContent = k;
        elMax.textContent = `hold ${k} / ${N}`;
      },
      onClip(elapsed, dur) {
        document.body.dataset.phase = "go";
        elPhase.textContent = "GO";
        elCount.textContent = Math.max(0, Math.ceil(dur - elapsed));
        elMax.textContent = "audio";
      },
      onProgress(p) {
        if (!scrubbing) setBar(p);
      },
      onDone() {
        elPhase.textContent = "Complete";
        elTitle.textContent = "Well done";
        elCount.textContent = "✓";
        elMax.textContent = "";
        document.body.dataset.phase = "done";
        releaseWakeLock(); // session over — let the screen sleep normally again
      },
    });
  }

  function exitRun() {
    MT.stopSession();
    releaseWakeLock();
    document.body.classList.remove("running");
    document.body.dataset.phase = "";
    show("home");
  }
  function restartRun() {
    if (!currentSession) return;
    MT.stopSession();
    // brief tick so the stopped run fully unwinds before restarting
    setTimeout(() => startRun(currentSession), 120);
  }
  function setPauseUI(paused) {
    const b = $("#run-pause");
    if (!b) return;
    b.textContent = paused ? "Resume" : "Pause";
    b.classList.toggle("paused", paused);
  }
  $("#run-pause").addEventListener("click", () => {
    if (MT.isPaused()) {
      MT.resumeSession();
      setPauseUI(false);
    } else {
      MT.pauseSession();
      setPauseUI(MT.isPaused());
    }
  });
  $("#run-skip").addEventListener("click", () => {
    MT.skipSession(); // advances to the next poomsae/round/set (auto-resumes)
    setPauseUI(false);
  });
  $("#run-stop").addEventListener("click", exitRun);
  $("#run-exit").addEventListener("click", exitRun);
  $("#run-restart").addEventListener("click", restartRun);

  /* -------- scrubbable progress bar (YouTube-style seek) -------- */
  const progressBar = $("#run-progressbar");
  const elThumb = $("#run-thumb");
  let scrubbing = false;
  function setBar(frac) {
    frac = Math.max(0, Math.min(1, frac));
    $("#run-progress").style.width = frac * 100 + "%";
    if (elThumb) elThumb.style.left = frac * 100 + "%";
  }
  function fracFromPointer(e) {
    const r = progressBar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  progressBar.addEventListener("pointerdown", (e) => {
    if (!MT.canSeek || !MT.canSeek()) return; // only seekable during the poomsae
    scrubbing = true;
    progressBar.classList.add("scrubbing");
    try { progressBar.setPointerCapture(e.pointerId); } catch (_) {}
    setBar(fracFromPointer(e));
    e.preventDefault();
  });
  progressBar.addEventListener("pointermove", (e) => {
    if (scrubbing) setBar(fracFromPointer(e));
  });
  function endScrub(e) {
    if (!scrubbing) return;
    scrubbing = false;
    progressBar.classList.remove("scrubbing");
    const f = fracFromPointer(e);
    setBar(f);
    MT.seekCurrent(f); // jump the clip/metronome to here (works live or paused)
  }
  progressBar.addEventListener("pointerup", endScrub);
  progressBar.addEventListener("pointercancel", endScrub);

  /* -------------------- EDITOR -------------------- */
  let editorForm = null;
  let editorSection = "black";
  let editorDivision = "cadet";
  const editorDiv = () => (editorSection === "black" ? editorDivision : "");

  function renderEditor() {
    forms = MT.loadForms();
    $$("#editor-section .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.section === editorSection)
    );
    $("#editor-division-wrap").hidden = editorSection !== "black";
    $("#editor-division").innerHTML = MT.DIVISIONS.filter((d) => d.id !== "mixed")
      .map((d) => `<option value="${d.id}">${d.label}</option>`)
      .join("");
    if (editorDivision === "mixed") editorDivision = "youth";
    $("#editor-division").value = editorDivision;

    renderEditorPoomsaeList();
  }
  function renderEditorPoomsaeList() {
    const secForms = sectionForms(editorSection, editorDivision);
    const sel = $("#editor-form");
    sel.innerHTML = secForms
      .map((f) => `<option value="${f.id}">${f.id} · ${f.name}</option>`)
      .join("");
    loadEditorForm(Number(sel.value));
  }
  $$("#editor-section .seg-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      editorSection = btn.dataset.section;
      renderEditor();
    })
  );
  $("#editor-division").addEventListener("change", (e) => {
    editorDivision = e.target.value;
    renderEditorPoomsaeList();
  });

  function loadEditorForm(id) {
    editorForm = JSON.parse(JSON.stringify(forms.find((f) => f.id === id)));
    updateClipUI();
  }

  /* ---- Audio clip (per section/division/poomsae) ---- */
  let clipPreviewSrc = null;
  function stopClipPreview() {
    if (clipPreviewSrc) {
      try {
        clipPreviewSrc.stop();
      } catch (e) {}
    }
    clipPreviewSrc = null;
    $("#clip-play").textContent = "Play";
  }
  function updateClipUI() {
    const has = editorForm && MT.hasClip(editorSection, editorDiv(), editorForm.id);
    $("#clip-status").textContent = has
      ? "✓ Clip saved (" +
        MT.clipDuration(editorSection, editorDiv(), editorForm.id).toFixed(1) +
        "s) — the drill plays this audio for " +
        (editorSection === "black" ? "Black · " + editorDivision : "Color Belt") +
        "."
      : "No clip yet — upload the poomsae audio to use it in the drill.";
    $("#clip-play").disabled = !has;
    $("#clip-delete").disabled = !has;
    stopClipPreview();
  }
  $("#clip-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f || !editorForm) return;
    $("#clip-status").textContent = "Saving clip…";
    try {
      await MT.saveClip(editorSection, editorDiv(), editorForm.id, f);
      updateClipUI();
    } catch (err) {
      $("#clip-status").textContent = "Couldn't read that audio file — try mp3/m4a/wav.";
    }
    e.target.value = "";
  });
  $("#clip-play").addEventListener("click", () => {
    if (clipPreviewSrc) {
      stopClipPreview();
      return;
    }
    MT.unlockAudio();
    const src = MT.playClip(editorSection, editorDiv(), editorForm.id, null);
    if (src) {
      clipPreviewSrc = src;
      $("#clip-play").textContent = "Stop";
      src.onended = stopClipPreview;
    }
  });
  $("#clip-delete").addEventListener("click", async () => {
    if (editorForm && MT.hasClip(editorSection, editorDiv(), editorForm.id)) {
      await MT.deleteClip(editorSection, editorDiv(), editorForm.id);
    }
    updateClipUI();
  });

  function playSoundSample(soundId) {
    MT.unlockAudio();
    const t = MT.now() + 0.05;
    MT.playSound(soundId, t, false); // normal beat
    MT.playSound(soundId, t + 0.3, true); // accented variant
  }


  $("#editor-form").addEventListener("change", (e) =>
    loadEditorForm(Number(e.target.value))
  );
  $("#editor-save").addEventListener("click", () => {
    MT.saveForm(editorForm);
    forms = MT.loadForms();
    flash("#editor-save", "Saved ✓");
  });
  // Test tempo: run this one poomsae the full way (Joonbi → count → Sijak →
  // clip/rhythm → Baro → count) on the run screen, exactly as a real session.
  $("#editor-test").addEventListener("click", () => {
    if (!editorForm) return;
    MT.unlockAudio();
    const item = {
      type: "form",
      id: editorForm.id,
      name: editorForm.name,
      spoken: editorForm.spoken || editorForm.name,
      sound: editorForm.sound,
      counts: editorForm.counts,
      announce: false,
      section: editorSection,
      division: editorDiv(),
    };
    startRun({ items: [item], sets: 1, restSeconds: 0 });
  });

  /* -------------------- Export for GitHub (admin) --------------------
     Packages the uploaded clips + tension config into a zip that mirrors
     the repo (audio/… + data/clips.json). Unzip into the project, push. */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  const _u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
  const _u32 = (n) =>
    new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);
  function makeZip(files) {
    const enc = new TextEncoder();
    const pieces = [];
    let offset = 0;
    const push = (a) => {
      pieces.push(a);
      offset += a.length;
    };
    const records = [];
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const localOffset = offset;
      push(_u32(0x04034b50)); push(_u16(20)); push(_u16(0)); push(_u16(0));
      push(_u16(0)); push(_u16(0)); push(_u32(crc)); push(_u32(data.length));
      push(_u32(data.length)); push(_u16(name.length)); push(_u16(0)); push(name); push(data);
      records.push({ name, crc, size: data.length, localOffset });
    }
    const cd = [];
    let cdSize = 0;
    const cpush = (a) => {
      cd.push(a);
      cdSize += a.length;
    };
    for (const r of records) {
      cpush(_u32(0x02014b50)); cpush(_u16(20)); cpush(_u16(20)); cpush(_u16(0)); cpush(_u16(0));
      cpush(_u16(0)); cpush(_u16(0)); cpush(_u32(r.crc)); cpush(_u32(r.size)); cpush(_u32(r.size));
      cpush(_u16(r.name.length)); cpush(_u16(0)); cpush(_u16(0)); cpush(_u16(0)); cpush(_u16(0));
      cpush(_u32(0)); cpush(_u32(r.localOffset)); cpush(r.name);
    }
    const cdOffset = offset;
    const end = [
      _u32(0x06054b50), _u16(0), _u16(0), _u16(records.length), _u16(records.length),
      _u32(cdSize), _u32(cdOffset), _u16(0),
    ];
    return new Blob([...pieces, ...cd, ...end], { type: "application/zip" });
  }
  function extFor(type) {
    type = type || "";
    if (/mpeg|mp3/.test(type)) return "mp3";
    if (/wav/.test(type)) return "wav";
    if (/mp4|m4a|aac/.test(type)) return "m4a";
    if (/ogg/.test(type)) return "ogg";
    if (/webm/.test(type)) return "webm";
    return "audio";
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }
  async function buildExportZip() {
    const clips = await MT.getAllClipBlobs();
    const files = [];
    const manifest = { clips: [] };
    for (const { key, blob } of clips) {
      const [section, division, idStr] = key.split("|");
      const id = Number(idStr);
      const ext = extFor(blob.type);
      const parts = ["audio", section];
      if (division) parts.push(division);
      parts.push(id + "." + ext);
      const file = parts.join("/");
      files.push({ name: file, data: new Uint8Array(await blob.arrayBuffer()) });
      manifest.clips.push({ section, division, poomsae: id, file });
    }
    files.push({
      name: "data/clips.json",
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n"),
    });
    return { blob: makeZip(files), count: clips.length, manifest };
  }
  async function exportForGitHub() {
    $("#export-status").textContent = "Packaging…";
    try {
      const { blob, count } = await buildExportZip();
      if (!count) {
        $("#export-status").textContent = "No clips uploaded yet — nothing to export.";
        return;
      }
      downloadBlob(blob, "mteam-rhythm-data.zip");
      $("#export-status").textContent =
        "Exported " + count + " clip(s) → mteam-rhythm-data.zip. Unzip into the project folder, then push.";
    } catch (e) {
      $("#export-status").textContent = "Export failed: " + e.message;
    }
  }
  if ($("#export-github")) $("#export-github").addEventListener("click", exportForGitHub);

  /* -------------------- SETTINGS -------------------- */
  function renderSettings() {
    settings = MT.loadSettings();
    $("#set-voice").checked = settings.voice;
    $("#set-countbeat").value = settings.countBeat;
    $("#set-rate").value = settings.rate;
    $("#set-pitch").value = settings.pitch;
    $("#set-rate-val").textContent = Number(settings.rate).toFixed(2) + "×";
    $("#set-pitch-val").textContent = Number(settings.pitch).toFixed(2) + "×";
    populateVoices();
  }
  function populateVoices() {
    const { all, ko } = MT.getKoreanVoices();
    const sel = $("#set-voicepick");
    const list = ko.length ? ko : all;
    sel.innerHTML =
      `<option value="">Auto (best Korean)</option>` +
      list
        .map((v, i) => {
          const tag = ko.length && i === 0 ? " — recommended" : "";
          return `<option value="${v.voiceURI}">${v.name} (${v.lang})${tag}</option>`;
        })
        .join("");
    sel.value = settings.voiceURI || "";
    if (!ko.length) {
      $("#voice-hint").textContent =
        "No Korean voice found on this device — cues may sound off. Install a Korean voice in your OS settings (see your device's Text-to-Speech / Spoken Content options).";
    }
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
      if ($(".screen[data-screen='settings']").classList.contains("active")) populateVoices();
    };
  }
  $("#set-voice").addEventListener("change", (e) => {
    settings.voice = e.target.checked;
    MT.saveSettings(settings);
  });
  $("#set-voicepick").addEventListener("change", (e) => {
    settings.voiceURI = e.target.value;
    MT.setVoiceURI(settings.voiceURI);
    MT.saveSettings(settings);
  });
  $("#set-countbeat").addEventListener("change", (e) => {
    settings.countBeat = Math.max(0.5, Number(e.target.value) || 1);
    MT.saveSettings(settings);
  });
  $("#set-rate").addEventListener("input", (e) => {
    settings.rate = Number(e.target.value);
    $("#set-rate-val").textContent = settings.rate.toFixed(2) + "×";
    MT.setVoiceTuning(settings);
    MT.saveSettings(settings);
  });
  $("#set-pitch").addEventListener("input", (e) => {
    settings.pitch = Number(e.target.value);
    $("#set-pitch-val").textContent = settings.pitch.toFixed(2) + "×";
    MT.setVoiceTuning(settings);
    MT.saveSettings(settings);
  });
  $("#set-testvoice").addEventListener("click", async () => {
    MT.unlockAudio();
    MT.setVoiceURI(settings.voiceURI);
    MT.setVoiceTuning(settings);
    await MT.speak(MT.CUES.joonbi.say, { rate: 0.9 });
    for (const n of MT.KO_NUMBERS) await MT.speak(n, { rate: 1.05 });
    await MT.speak(MT.CUES.sijak.say, { rate: 1.08, pitch: 1.04 });
    await new Promise((r) => setTimeout(r, 400));
    await MT.speak(MT.CUES.baro.say, { rate: 1.0, pitch: 0.97 });
  });

  /* -------------------- misc -------------------- */
  function flash(sel, text) {
    const el = $(sel);
    const old = el.textContent;
    el.textContent = text;
    setTimeout(() => (el.textContent = old), 1200);
  }

  // Initialize voice choice + tuning on load, and preload recorded name clips.
  MT.setVoiceURI(settings.voiceURI);
  MT.setVoiceTuning(settings);
  // Load the team's shipped clips from the repo, then the admin's local
  // uploads (which take precedence for authoring/preview).
  if (MT.loadClips) MT.loadClips().then(() => MT.loadRepoClips && MT.loadRepoClips());
  else if (MT.loadRepoClips) MT.loadRepoClips();
  // Bundled voice clips (numbers/commands/names) — natural Yuna recordings.
  if (MT.loadVoiceClips) MT.loadVoiceClips();
})();
