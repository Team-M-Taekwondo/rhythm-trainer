/* ============================================================
   MTEAM Tempo Trainer — data layer
   Everything here is plain data + defaults. No build step.
   window.MT is the shared namespace across all scripts.
   ============================================================ */
(function () {
  const MT = (window.MT = window.MT || {});

  // Tempo grid the team uses, in seconds: 0.5 → 8 in half-second steps.
  MT.TEMPOS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
  // Finer grid for drills: 0.1 → 8.0 in 0.1-second steps,
  // then 8.5 → 20 in half-second steps for slow-tempo drills.
  MT.DRILL_TEMPOS = (function () {
    const a = [];
    for (let i = 1; i <= 80; i++) a.push(i / 10);
    for (let v = 8.5; v <= 20; v += 0.5) a.push(v);
    return a;
  })();

  // Korean voice cues. Native Korean numbers are used for counting in TKD.
  MT.CUES = {
    joonbi: { ko: "준비", say: "준비" },      // get ready
    sijak: { ko: "시작", say: "시작" },       // start
    baro: { ko: "바로", say: "바로" },         // return / finish
    swieo: { ko: "쉬어", say: "서" },          // at ease / relax — pronounced "suh", said after the recovery count
  };
  // hana, dul, set, net, daseot
  MT.KO_NUMBERS = ["하나", "둘", "셋", "넷", "다섯"];
  // 1..8 for tension movements: hana … yeodeol
  MT.KO_NUMBERS_8 = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟"];
  // 1..10 for the Counting drill: hana … yeol
  MT.KO_NUMBERS_10 = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];

  // Counting-drill word for rep n. Counts run in tens: 1–10 normally, then each
  // new ten leads with its decade number instead of "1" (11→둘, 21→셋, 31→넷…)
  // and every ten closes on 열. Only the words 1–10 are ever needed.
  MT.countWord = function (n) {
    const ones = n % 10;
    if (ones === 0) return MT.KO_NUMBERS_10[9]; // 10 / 20 / 30 … all close on 열
    if (ones === 1 && n > 10) return MT.KO_NUMBERS_10[Math.ceil(n / 10) - 1];
    return MT.KO_NUMBERS_10[ones - 1];
  };

  // Seconds → "M:SS" (or "H:MM:SS") for the session-time estimates.
  MT.fmtTime = function (sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + s : m + ":" + s;
  };

  // Available metronome sounds (synthesized in audio.js — no files needed).
  MT.SOUNDS = [
    { id: "woodblock", label: "Wood block" },
    { id: "beep", label: "Digital beep" },
    { id: "drum", label: "Drum" },
    { id: "click", label: "Soft click" },
    { id: "clave", label: "Clave" },
  ];

  /* -------------------- Preset drills --------------------
     The team's common training drills, variables pre-set. Levels change only
     the tempo: Color +0.1s, Black as listed, Competition Black −0.1s.
     Every drill ends the same way: no rest after the last set, just the
     finish chime — that's how athletes know the cycle is over.
     kick: true shows the kick-hold option on the config screen. */
  MT.PRESET_LEVELS = [
    { id: "comp", label: "Comp. Black", delta: -0.1 },
    { id: "black", label: "Black Belts", delta: 0 },
    { id: "color", label: "Color Belts", delta: 0.1 },
  ];
  MT.PRESET_DRILLS = [
    { id: "front",  group: "Ground drills",   name: "Front Kicks",       tempo: 0.9, reps: 15, rest: 10, sets: 4, kick: true },
    { id: "round",  group: "Ground drills",   name: "Round House Kicks", tempo: 0.9, reps: 15, rest: 10, sets: 4, kick: true },
    { id: "side",   group: "Ground drills",   name: "Side Kicks",        tempo: 1.1, reps: 15, rest: 10, sets: 4, kick: true },
    { id: "horse",  group: "Standing drills", name: "Horse Stance · Side to Side · Blocks/Attacks", tempo: 1.4, reps: 20, rest: 10, sets: 4 },
    { id: "inplace", group: "Standing drills", name: "All Stances · In Place · Blocks/Attacks",     tempo: 1.0, reps: 20, rest: 10, sets: 4 },
    { id: "udblock", group: "Standing drills", name: "All Stances · Up/Down · Blocks",              tempo: 1.5, reps: 20, rest: 10, sets: 4 },
    { id: "udattack", group: "Standing drills", name: "All Stances · Up/Down · Attacks",            tempo: 1.4, reps: 20, rest: 10, sets: 4 },
  ];

  /* Counting-drill levels. Interval presets are stored at the COMPETITION
     BLACK BELT reference tempo; the other levels add a fixed amount:
     Comp. Black as listed, Black Belt +0.5s, Color Belt +1.0s.
     New counting presets should always be entered at the comp reference. */
  MT.COUNT_LEVELS = [
    { id: "comp", label: "Comp. Black", delta: 0 },
    { id: "black", label: "Black Belts", delta: 0.5 },
    { id: "color", label: "Color Belts", delta: 1.0 },
  ];
  // Counting drill: seconds between counts at the comp reference.
  // Presets match the common kicks.
  MT.COUNT_INTERVALS = [
    { v: 2.0, label: "Front kick" },
    { v: 2.3, label: "Round house" },
    { v: 2.5, label: "Side kick" },
  ];

  // Belt sections. Divisions apply to Black Belt only.
  MT.SECTIONS = [
    { id: "color", label: "Color Belt" },
    { id: "black", label: "Black Belt" },
  ];
  MT.DIVISIONS = [
    { id: "youth", label: "Youth" },
    { id: "cadet", label: "Cadet" },
    { id: "junior", label: "Junior" },
    { id: "u30", label: "U30" },
    { id: "o30", label: "O30" },
    { id: "mixed", label: "Mixed" },
  ];
  // Real divisions that hold their own clips (excludes the special "Mixed").
  MT.CLIP_DIVISIONS = ["youth", "cadet", "junior", "u30", "o30"];
  // Allowed poomsae ids per black-belt division.
  //  1-8 Taegeuk · 9 Koryo · 10 Keumgang · 11 Taebaek · 12 Pyeongwon
  //  13 Sipjin · 14 Jitae · 15 Chonkwon
  //  Only O30 performs Chonkwon (15); U30 stops at Jitae (14).
  MT.DIVISION_POOMSAE = {
    youth: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    cadet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    junior: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    u30: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    o30: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  };

  // Mixed-rotation pools — narrower than the full training lists above.
  // Each division draws its random poomsae from this range in Mixed mode only.
  MT.MIXED_POOMSAE = {
    youth: [4, 5, 6, 7, 8, 9, 10], //  T4 → Keumgang
    cadet: [4, 5, 6, 7, 8, 9, 10, 11], //  T4 → Taebaek
    junior: [5, 6, 7, 8, 9, 10, 11, 12], //  T5 → Pyeongwon
    u30: [7, 8, 9, 10, 11, 12, 13, 14], //  T7 → Jitae
    o30: [8, 9, 10, 11, 12, 13, 14, 15], //  T8 → Chonkwon
  };

  // Color-belt rank ladder for the Poomsae Randomizer. Each rank knows the
  // highest Taegeuk that rank has learned; the draw is "that Taegeuk and below".
  MT.COLOR_RANKS = [
    { id: "yellow", label: "Yellow", max: 1 },
    { id: "yellow1", label: "Yellow · 1 stripe", max: 2 },
    { id: "green", label: "Green", max: 3 },
    { id: "green1", label: "Green · 1 stripe", max: 4 },
    { id: "blue", label: "Blue", max: 5 },
    { id: "blue1", label: "Blue · 1 stripe", max: 6 },
    { id: "red", label: "Red", max: 7 },
    { id: "red1", label: "Red · 1 stripe", max: 8 },
  ];

  // Poomsae ids the randomizer can draw for a given belt/rank-or-division.
  //  Color: Taegeuk 1..rank.max  ·  Black: that division's compulsory (Mixed) set.
  MT.randomizerIdsFor = function (section, key, forms) {
    const all = forms || [];
    if (section === "black") {
      const pool = MT.MIXED_POOMSAE[key] || [];
      const ids = all.map((f) => f.id);
      return pool.filter((id) => ids.indexOf(id) !== -1);
    }
    const rank = MT.COLOR_RANKS.find((r) => r.id === key);
    const max = rank ? rank.max : 8;
    return all.filter((f) => f.id <= max).map((f) => f.id);
  };

  // Available poomsae ids for a belt section (+ division for black belt).
  // Color belt = Taegeuk 1–8; Black belt = the division's allowed list.
  MT.poomsaeIdsFor = function (section, division, forms) {
    const ids = (forms || []).map((f) => f.id);
    if (section === "color") return ids.filter((id) => id <= 8);
    const allowed = MT.DIVISION_POOMSAE[division];
    return allowed ? ids.filter((id) => allowed.indexOf(id) !== -1) : ids;
  };

  // Per-clip metadata (e.g. whether the clip already contains its own intro).
  const CLIPMETA_KEY = "mteam.clipmeta.v1";
  MT.getClipMeta = function (key) {
    try {
      return JSON.parse(localStorage.getItem(CLIPMETA_KEY) || "{}")[key] || {};
    } catch (e) {
      return {};
    }
  };
  MT.setClipMeta = function (key, meta) {
    let all = {};
    try {
      all = JSON.parse(localStorage.getItem(CLIPMETA_KEY) || "{}");
    } catch (e) {}
    const merged = Object.assign({}, all[key], meta);
    // A null/undefined value clears that field; an empty record is dropped.
    Object.keys(merged).forEach((k) => {
      if (merged[k] == null) delete merged[k];
    });
    if (Object.keys(merged).length) all[key] = merged;
    else delete all[key];
    localStorage.setItem(CLIPMETA_KEY, JSON.stringify(all));
  };
  MT.getAllClipMeta = function () {
    try {
      return JSON.parse(localStorage.getItem(CLIPMETA_KEY) || "{}");
    } catch (e) {
      return {};
    }
  };

  // Approximate official movement counts — PLACEHOLDER rhythm.
  // Every count defaults to 1.0s; calibrate real rhythm in the Rhythm Editor
  // or from the reference videos. `accent` marks a hold/kihap emphasis.
  // [ display name, movements, Korean spelling for TTS pronunciation ]
  const FORM_DEFS = [
    ["Taegeuk Il Jang", 20, "태극 일장"],
    ["Taegeuk I Jang", 20, "태극 이장"],
    ["Taegeuk Sam Jang", 20, "태극 삼장"],
    ["Taegeuk Sa Jang", 20, "태극 사장"],
    ["Taegeuk O Jang", 20, "태극 오장"],
    ["Taegeuk Yuk Jang", 19, "태극 육장"],
    ["Taegeuk Chil Jang", 25, "태극 칠장"],
    ["Taegeuk Pal Jang", 24, "태극 팔장"],
    ["Koryo", 30, "고려"],
    ["Keumgang", 27, "금강"],
    ["Taebaek", 26, "태백"],
    ["Pyeongwon", 25, "평원"],
    ["Sipjin", 31, "십진"],
    ["Jitae", 28, "지태"],
    ["Chonkwon", 27, "천권"],
  ];

  // Calibrated rhythms baked in as shipped defaults (tapped from reference video).
  // durations: seconds per count; accents: 1-based count numbers to emphasize.
  // Forms not listed here default to an even 1s per count until calibrated.
  const CALIBRATED = {
    1: {
      sound: "woodblock",
      durations: [1, 1, 1, 1, 0.5, 1, 1, 1.5, 1, 1, 0.5, 1, 1, 1, 1.5, 1, 1, 1.5, 1, 1.5],
      accents: [20],
    },
    6: {
      sound: "woodblock",
      durations: [1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 1, 1, 1.5, 0.5, 1, 1, 1.5, 6, 1, 1.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 1, 0.5, 1],
      accents: [19],
      tensions: [{ n: 17, sec: 5 }],
    },
  };

  function makeCounts(movements, cal) {
    // tensions: [{ n, sec }] — a count that is a slow 5s/8s "tension" movement.
    const tset = {};
    if (cal && cal.tensions) cal.tensions.forEach((t) => (tset[t.n] = t.sec));
    const counts = [];
    for (let i = 0; i < movements; i++) {
      const n = i + 1;
      const duration = cal && cal.durations[i] != null ? cal.durations[i] : 1.0;
      const accent = !!(cal && cal.accents && cal.accents.indexOf(n) !== -1);
      counts.push({ n, duration, accent, tension: tset[n] || 0 });
    }
    return counts;
  }

  MT.buildDefaultForms = function () {
    return FORM_DEFS.map(([name, movDefault, spoken], idx) => {
      const id = idx + 1;
      const cal = CALIBRATED[id];
      // A calibrated poomsae's length comes from its tapped durations; the
      // FORM_DEFS number is just a starting estimate until calibrated.
      const movements = cal && cal.durations ? cal.durations.length : movDefault;
      return {
        id,
        name,
        spoken: spoken || name, // Korean spelling for correct TTS pronunciation
        movements,
        sound: cal && cal.sound ? cal.sound : "woodblock",
        counts: makeCounts(movements, cal),
      };
    });
  };

  // Persistence — user edits (calibrated rhythms) live in localStorage so they
  // survive reloads without a backend. Defaults ship in the repo.
  const STORE_KEY = "mteam.forms.v1";

  MT.loadForms = function () {
    const defaults = MT.buildDefaultForms();
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!saved) return defaults;
      // Merge saved edits onto defaults by id so new default forms still appear.
      return defaults.map((f) => {
        const s = saved.find((x) => x.id === f.id);
        return s ? { ...f, ...s } : f;
      });
    } catch (e) {
      return defaults;
    }
  };

  MT.saveForm = function (form) {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch (e) {
      saved = [];
    }
    saved = saved.filter((x) => x.id !== form.id);
    saved.push(form);
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  };

  MT.resetForm = function (id) {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch (e) {
      saved = [];
    }
    saved = saved.filter((x) => x.id !== id);
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
  };

  // App settings (voice on/off, chosen voice, count-in beat length).
  // v3: natural pitch (no artificial deepening) + slightly slower rate so Yuna
  // annunciates clearly instead of sounding choppy/robotic.
  const SETTINGS_KEY = "mteam.settings.v3";
  MT.defaultSettings = { voice: true, voiceURI: "", countBeat: 1.0, rate: 0.8, pitch: 1.0 };

  MT.loadSettings = function () {
    try {
      return { ...MT.defaultSettings, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")) };
    } catch (e) {
      return { ...MT.defaultSettings };
    }
  };
  MT.saveSettings = function (s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  };
})();
