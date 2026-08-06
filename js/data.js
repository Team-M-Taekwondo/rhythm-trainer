/* ============================================================
   MTEAM Tempo Trainer — data layer
   Everything here is plain data + defaults. No build step.
   window.MT is the shared namespace across all scripts.
   ============================================================ */
(function () {
  const MT = (window.MT = window.MT || {});

  // Tempo grid the team uses, in seconds: 0.5 → 8 in half-second steps.
  MT.TEMPOS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
  // Finer grid for drills: 0.1 → 8.0 in 0.1-second steps.
  MT.DRILL_TEMPOS = (function () {
    const a = [];
    for (let i = 1; i <= 80; i++) a.push(i / 10);
    return a;
  })();

  // Korean voice cues. Native Korean numbers are used for counting in TKD.
  MT.CUES = {
    joonbi: { ko: "준비", say: "준비" },      // get ready
    sijak: { ko: "시작", say: "시작" },       // start
    baro: { ko: "바로", say: "바로" },         // return / finish
  };
  // hana, dul, set, net, daseot
  MT.KO_NUMBERS = ["하나", "둘", "셋", "넷", "다섯"];
  // 1..8 for tension movements: hana … yeodeol
  MT.KO_NUMBERS_8 = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟"];

  // Available metronome sounds (synthesized in audio.js — no files needed).
  MT.SOUNDS = [
    { id: "woodblock", label: "Wood block" },
    { id: "beep", label: "Digital beep" },
    { id: "drum", label: "Drum" },
    { id: "click", label: "Soft click" },
    { id: "clave", label: "Clave" },
  ];

  // Belt sections. Divisions apply to Black Belt only.
  MT.SECTIONS = [
    { id: "color", label: "Color Belt" },
    { id: "black", label: "Black Belt" },
  ];
  MT.DIVISIONS = [
    { id: "cadet", label: "Cadet" },
    { id: "junior", label: "Junior" },
    { id: "senior", label: "Senior" },
    { id: "over30", label: "Over 30" },
  ];
  // Poomsae excluded from certain black-belt divisions (by id). Younger
  // divisions perform fewer of the advanced forms.
  //  12 Pyeongwon · 13 Sipjin · 14 Jitae · 15 Chonkwon
  MT.DIVISION_EXCLUDE = {
    cadet: [12, 13, 14, 15],
    junior: [13, 14, 15],
    // senior, over30: all poomsae
  };

  // Available poomsae ids for a belt section (+ division for black belt).
  // Color belt = Taegeuk 1–8; Black belt = all poomsae minus division limits.
  MT.poomsaeIdsFor = function (section, division, forms) {
    const ids = (forms || []).map((f) => f.id);
    if (section === "color") return ids.filter((id) => id <= 8);
    const excl = MT.DIVISION_EXCLUDE[division] || [];
    return ids.filter((id) => excl.indexOf(id) === -1);
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
    all[key] = Object.assign({}, all[key], meta);
    localStorage.setItem(CLIPMETA_KEY, JSON.stringify(all));
  };
  // Tension markers for a clip: [{ t: seconds into clip, sec: 5|8 }].
  // Yuna counts over the audio at these points during the drill.
  MT.clipTensions = function (section, division, id) {
    const key = MT.clipKey(section, division, id);
    const meta = MT.getClipMeta(key);
    // Admin's local marks (localStorage) win; otherwise use the repo's.
    if (Object.prototype.hasOwnProperty.call(meta, "tensions")) return meta.tensions || [];
    return (MT.repoTensions && MT.repoTensions(key)) || [];
  };
  MT.setClipTensions = function (section, division, id, arr) {
    MT.setClipMeta(MT.clipKey(section, division, id), { tensions: arr });
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
  // v2: slower, deeper voice defaults (less choppy, more bass-like).
  const SETTINGS_KEY = "mteam.settings.v2";
  MT.defaultSettings = { voice: true, voiceURI: "", countBeat: 1.0, rate: 0.82, pitch: 0.88 };

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
