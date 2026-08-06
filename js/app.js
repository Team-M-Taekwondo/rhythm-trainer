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
      show(dest);
    }
  });

  /* -------------------- helpers -------------------- */
  function fillTempoSelect(sel, value, suffix) {
    const suf = suffix != null ? suffix : " s";
    sel.innerHTML = MT.TEMPOS.map(
      (v) => `<option value="${v}">${v}${suf}</option>`
    ).join("");
    sel.value = value != null ? value : 1;
  }
  /* -------------------- FORMS builder -------------------- */
  let formsSection = "color";
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

    const secForms = sectionForms(formsSection, formsDivision);
    $("#forms-checklist").innerHTML = secForms
      .map(
        (f) => `
      <label class="check-item">
        <input type="checkbox" value="${f.id}" />
        <span class="ci-name">${f.name}</span>
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
      sets: Math.max(1, Number($("#forms-sets").value) || 1),
      restSeconds: Math.max(0, Number($("#forms-rest").value) || 0),
    });
  });

  /* -------------------- DRILL builder -------------------- */
  let drillSound = "woodblock";
  function renderDrillBuilder() {
    fillTempoSelect($("#drill-tempo"), 2, "");
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
    const drill = {
      name: "Drill",
      reps: Math.max(1, Number($("#drill-reps").value) || 1),
      duration: Number($("#drill-tempo").value),
      sound: drillSound,
    };
    startRun({
      items: [MT.drillToItem(drill)],
      sets: Math.max(1, Number($("#drill-sets").value) || 1),
      restSeconds: Math.max(0, Number($("#drill-rest").value) || 0),
    });
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
  };

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
    const elCount = $("#run-count");
    const elMax = $("#run-countmax");
    const elPhase = $("#run-phase");
    const elTitle = $("#run-title");
    const elSet = $("#run-setinfo");
    const elItem = $("#run-iteminfo");
    const elBelt = $("#run-belt");
    const elProg = $("#run-progress");

    elProg.style.width = "0%";
    elCount.textContent = "0";
    elMax.textContent = "";

    MT.runSession(session, {
      onItem(info) {
        elSet.textContent = `Set ${info.set} / ${info.sets}`;
        elItem.textContent =
          info.items > 1 ? `${info.item} / ${info.items}` : "";
        elTitle.textContent = info.name;
        elBelt.textContent = beltLabel(info.section, info.division);
      },
      onPhase(phase, label, num) {
        document.body.dataset.phase = phase;
        elPhase.textContent = PHASE_LABELS[phase] || label;
        elProg.style.width = "0%";
        if (phase === "count") {
          elCount.textContent = num;
          elMax.textContent = "count-in";
        } else if (phase === "rest") {
          elCount.textContent = num;
          elMax.textContent = "seconds";
          elTitle.textContent = "Rest";
        } else if (phase === "announce") {
          elCount.textContent = "";
          elMax.textContent = "";
          elTitle.textContent = label;
        } else if (phase === "go") {
          elCount.textContent = "1";
        } else if (phase === "joonbi" || phase === "sijak" || phase === "baro") {
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
        elProg.style.width = Math.round(p * 100) + "%";
      },
      onDone() {
        elPhase.textContent = "Complete";
        elTitle.textContent = "Well done";
        elCount.textContent = "✓";
        elMax.textContent = "";
        document.body.dataset.phase = "done";
      },
    });
  }

  function exitRun() {
    MT.stopSession();
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
  $("#run-stop").addEventListener("click", exitRun);
  $("#run-exit").addEventListener("click", exitRun);
  $("#run-restart").addEventListener("click", restartRun);

  /* -------------------- EDITOR -------------------- */
  let editorForm = null;
  let editorSection = "color";
  let editorDivision = "cadet";
  const editorDiv = () => (editorSection === "black" ? editorDivision : "");

  function renderEditor() {
    forms = MT.loadForms();
    $$("#editor-section .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.section === editorSection)
    );
    $("#editor-division-wrap").hidden = editorSection !== "black";
    $("#editor-division").innerHTML = MT.DIVISIONS.map(
      (d) => `<option value="${d.id}">${d.label}</option>`
    ).join("");
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
  let clipPlayStart = 0;
  function clipTensionsNow() {
    return editorForm ? MT.clipTensions(editorSection, editorDiv(), editorForm.id) : [];
  }
  function renderClipTensions() {
    const list = clipTensionsNow()
      .slice()
      .sort((a, b) => a.t - b.t);
    $("#clip-tension-list").innerHTML = list.length
      ? list
          .map(
            (m) =>
              `<div class="clip-tension-item"><span>${m.sec}s tension @ ${m.t.toFixed(1)}s</span>` +
              `<button class="btn ghost cts-del" data-t="${m.t}" data-sec="${m.sec}">Remove</button></div>`
          )
          .join("")
      : `<p class="hint">No tension markers yet — play the clip and tap Mark.</p>`;
  }
  function setClipMarkButtons(on) {
    $("#clip-mark5").disabled = !on;
    $("#clip-mark8").disabled = !on;
  }
  function stopClipPreview() {
    if (clipPreviewSrc) {
      try {
        clipPreviewSrc.stop();
      } catch (e) {}
    }
    clipPreviewSrc = null;
    $("#clip-play").textContent = "Play";
    setClipMarkButtons(false);
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
    $("#clip-tensions").hidden = !has;
    if (has) renderClipTensions();
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
      clipPlayStart = MT.now();
      $("#clip-play").textContent = "Stop";
      setClipMarkButtons(true);
      src.onended = stopClipPreview;
    }
  });
  $("#clip-delete").addEventListener("click", async () => {
    if (editorForm && MT.hasClip(editorSection, editorDiv(), editorForm.id)) {
      await MT.deleteClip(editorSection, editorDiv(), editorForm.id);
    }
    updateClipUI();
  });
  function addClipTension(sec) {
    if (!clipPreviewSrc || !editorForm) return;
    const t = Math.round(Math.max(0, MT.now() - clipPlayStart) * 10) / 10;
    const arr = clipTensionsNow().slice();
    arr.push({ t, sec });
    MT.setClipTensions(editorSection, editorDiv(), editorForm.id, arr);
    renderClipTensions();
  }
  $("#clip-mark5").addEventListener("click", () => addClipTension(5));
  $("#clip-mark8").addEventListener("click", () => addClipTension(8));
  $("#clip-tension-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".cts-del");
    if (!btn || !editorForm) return;
    const t = Number(btn.dataset.t),
      sec = Number(btn.dataset.sec);
    const arr = clipTensionsNow().filter((m) => !(m.t === t && m.sec === sec));
    MT.setClipTensions(editorSection, editorDiv(), editorForm.id, arr);
    renderClipTensions();
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
      manifest.clips.push({
        section,
        division,
        poomsae: id,
        file,
        tensions: MT.clipTensions(section, division, id),
      });
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
})();
