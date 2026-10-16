/* Antena - logika radia.
   Zasady: jeden odtwarzacz <audio>, lista budowana raz (potem tylko klasy CSS),
   brak frameworków, zapytania o tytuł utworu tylko w czasie grania. */

"use strict";

const STATIONS = (window.STATIONS || []).filter((s) => s && s.u);
const invoke = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) || null;

const K = {
  vol: "antena.vol",
  mute: "antena.mute",
  last: "antena.last",
  fav: "antena.fav",
};

const el = {
  play: document.getElementById("play"),
  playIcon: document.getElementById("playIcon"),
  title: document.getElementById("title"),
  sub: document.getElementById("sub"),
  mute: document.getElementById("mute"),
  volume: document.getElementById("volume"),
  search: document.getElementById("search"),
  chips: document.getElementById("chips"),
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  state: document.getElementById("state"),
  count: document.getElementById("count"),
};

const ICON_PLAY = "M8 5v14l11-7z";
const ICON_PAUSE = "M7 5h4v14H7zM13 5h4v14h-4z";

// ---------------------------------------------------------------- stan

let cur = -1; // indeks wybranej stacji
let curRow = null;
let metaTimer = 0;
let metaBusy = false;
let shownTitle = "";
let filterText = "";
let filterGenre = "";
let onlyFavs = false;
let filterTimer = 0;

const favs = new Set(readJSON(K.fav, []));

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* brak miejsca / tryb prywatny - nie jest to krytyczne */
  }
}

// ---------------------------------------------------------------- odtwarzacz

const audio = new Audio();
audio.preload = "none"; // nic nie łączymy, dopóki użytkownik nie kliknie

const savedVol = Number(readJSON(K.vol, 80));
audio.volume = Math.min(1, Math.max(0, (isNaN(savedVol) ? 80 : savedVol) / 100));
audio.muted = readJSON(K.mute, false) === true;
el.volume.value = String(Math.round(audio.volume * 100));
el.mute.classList.toggle("on", audio.muted);

audio.addEventListener("playing", () => {
  setPlaying(true);
  const s = STATIONS[cur];
  if (s) setState(`Gra · ${s.k} ${s.b ? s.b + " kbps" : ""}`.trim());
  startMeta();
});

audio.addEventListener("pause", () => {
  setPlaying(false);
  stopMeta();
  if (cur >= 0 && !audio.error) setState("Zatrzymane");
});

audio.addEventListener("waiting", () => setState("Łączenie…"));
audio.addEventListener("stalled", () => setState("Łączenie…"));

audio.addEventListener("error", () => {
  setPlaying(false);
  stopMeta();
  if (curRow) curRow.classList.add("bad");
  setState("Błąd — stacja nie odpowiada");
});

function setPlaying(on) {
  document.body.classList.toggle("playing", on);
  el.playIcon.setAttribute("d", on ? ICON_PAUSE : ICON_PLAY);
  el.play.setAttribute("aria-label", on ? "Zatrzymaj" : "Odtwórz");
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = on ? "playing" : "paused";
    } catch {
      /* opcjonalne */
    }
  }
}

function setState(text) {
  el.state.textContent = text;
}

// ---------------------------------------------------------------- budowa listy

const rows = new Array(STATIONS.length);
const frag = document.createDocumentFragment();

STATIONS.forEach((s, i) => {
  const li = document.createElement("li");
  li.className = "row";
  li.dataset.i = String(i);

  const ic = document.createElement("span");
  ic.className = "ic";
  ic.textContent = "▶";

  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = s.n;
  nm.title = s.n;

  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = tagOf(s);

  const st = document.createElement("button");
  st.className = "st";
  st.type = "button";
  st.dataset.act = "fav";
  st.title = "Ulubione (klawisz f)";
  st.textContent = favs.has(i) ? "★" : "☆";

  li.append(ic, nm, tag, st);
  li.$q = (s.n + " " + s.g + " " + s.k + " " + (s.c || "")).toLowerCase();
  rows[i] = li;
  frag.append(li);
});

el.list.append(frag);

function tagOf(s) {
  const bits = [s.g];
  if (s.k) bits.push(s.k + (s.b ? " " + s.b : ""));
  return bits.join(" · ");
}

// ---------------------------------------------------------------- filtry

function buildChips() {
  const counts = new Map();
  for (const s of STATIONS) counts.set(s.g, (counts.get(s.g) || 0) + 1);

  const f = document.createDocumentFragment();
  const add = (label, value, sel) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (sel ? " sel" : "");
    b.textContent = label;
    b.dataset.g = value;
    f.append(b);
  };

  add("🎲 Losowa", "@random", false);
  add(`★ Ulubione (${favs.size})`, "@fav", onlyFavs);
  add(`Wszystkie (${STATIONS.length})`, "", !filterGenre && !onlyFavs);

  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pl"))
    .forEach(([g, n]) => add(`${g} (${n})`, g, filterGenre === g));

  el.chips.replaceChildren(f);
}

function applyFilter() {
  const q = filterText;
  let visible = 0;
  for (let i = 0; i < rows.length; i++) {
    const s = STATIONS[i];
    const ok =
      (!filterGenre || s.g === filterGenre) &&
      (!onlyFavs || favs.has(i)) &&
      (!q || rows[i].$q.indexOf(q) !== -1);
    const row = rows[i];
    if (ok === row.classList.contains("off")) row.classList.toggle("off", !ok);
    if (ok) visible++;
  }
  el.count.textContent = visible + " z " + STATIONS.length;
  el.empty.hidden = visible !== 0;
}

el.search.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    filterText = el.search.value.trim().toLowerCase();
    applyFilter();
  }, 120);
});

el.search.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    el.search.value = "";
    filterText = "";
    applyFilter();
    el.search.blur();
  }
});

el.chips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const g = chip.dataset.g;

  if (g === "@random") {
    const pool = [];
    for (let i = 0; i < STATIONS.length; i++) if (!rows[i].classList.contains("off")) pool.push(i);
    if (!pool.length) return;
    select(pool[Math.floor(Math.random() * pool.length)], true);
    return;
  }

  if (g === "@fav") onlyFavs = !onlyFavs;
  else filterGenre = filterGenre === g ? "" : g;

  if (onlyFavs && favs.size === 0) {
    onlyFavs = false;
    setState("Brak ulubionych — dodaj gwiazdką");
  }

  syncChips();
  applyFilter();
});

function syncChips() {
  for (const c of el.chips.children) {
    const g = c.dataset.g;
    const sel = g === "" ? !filterGenre && !onlyFavs : g === "@fav" ? onlyFavs : g === filterGenre;
    c.classList.toggle("sel", sel);
  }
}

// ---------------------------------------------------------------- wybór i odtwarzanie

el.list.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  const i = Number(row.dataset.i);
  if (e.target.dataset.act === "fav" || e.target.closest("[data-act=fav]")) {
    toggleFav(i);
    return;
  }
  if (i === cur) togglePlay();
  else select(i, true);
});

function toggleFav(i) {
  if (favs.has(i)) favs.delete(i);
  else favs.add(i);
  rows[i].querySelector(".st").textContent = favs.has(i) ? "★" : "☆";
  write(K.fav, [...favs]);
  const favChip = [...el.chips.children].find((c) => c.dataset.g === "@fav");
  if (favChip) favChip.textContent = `★ Ulubione (${favs.size})`;
  if (onlyFavs) applyFilter();
}

function select(i, play, scroll) {
  if (i < 0 || i >= STATIONS.length) return;
  const s = STATIONS[i];

  if (curRow) curRow.classList.remove("cur");
  cur = i;
  curRow = rows[i];
  curRow.classList.add("cur");
  curRow.classList.remove("bad");
  curRow.querySelector(".ic").textContent = "▶";

  shownTitle = "";
  stopMeta();
  audio.src = s.u;
  el.title.textContent = s.n;
  el.sub.textContent = tagOf(s) + (s.c ? " · " + s.c : "");
  setState("Łączenie…");
  updateMediaSession(s.n, s.n);
  write(K.last, i);

  if (play !== false) {
    audio.play().catch(() => {
      setPlaying(false);
      setState("Kliknij ▶ aby rozpocząć");
    });
  }

  if (scroll !== false) scrollTo(i);
}

function togglePlay() {
  if (cur < 0) {
    const last = Number(readJSON(K.last, 0));
    select(last >= 0 && last < STATIONS.length ? last : 0, true);
    return;
  }
  if (audio.paused) {
    setState("Łączenie…");
    audio.play().catch(() => setState("Nie można odtworzyć tej stacji"));
  } else {
    audio.pause();
  }
}

el.play.addEventListener("click", togglePlay);

function scrollTo(i) {
  const row = rows[i];
  if (!row || row.classList.contains("off")) return;
  const box = el.list.parentElement;
  const top = row.offsetTop;
  const h = box.clientHeight;
  if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + h) {
    box.scrollTop = top - h / 2 + row.offsetHeight / 2;
  }
}

/** Przejście do kolejnej widocznej (nieodfiltrowanej) stacji. */
function move(delta) {
  if (!STATIONS.length) return;
  let i = cur;
  for (let guard = 0; guard < STATIONS.length; guard++) {
    i = (i + delta + STATIONS.length) % STATIONS.length;
    if (!rows[i].classList.contains("off")) break;
  }
  select(i, true);
}

// ---------------------------------------------------------------- głośność

el.volume.addEventListener("input", () => {
  audio.volume = Number(el.volume.value) / 100;
  if (audio.volume > 0 && audio.muted) {
    audio.muted = false;
    el.mute.classList.remove("on");
  }
});

el.volume.addEventListener("change", () => {
  write(K.vol, Number(el.volume.value));
  write(K.mute, audio.muted);
});

el.mute.addEventListener("click", () => {
  audio.muted = !audio.muted;
  el.mute.classList.toggle("on", audio.muted);
  write(K.mute, audio.muted);
});

// ---------------------------------------------------------------- tytuł utworu (ICY)

function startMeta() {
  stopMeta();
  const at = cur;
  const s = STATIONS[at];
  if (!s) return;
  // pierwsze zapytanie chwilę po starcie, potem co 15 s (tylko w czasie grania)
  setTimeout(() => pollMeta(at), 1200);
  metaTimer = setInterval(() => pollMeta(at), 15000);
}

function stopMeta() {
  if (metaTimer) clearInterval(metaTimer);
  metaTimer = 0;
}

async function pollMeta(at) {
  if (!invoke || metaBusy || at !== cur || audio.paused) return;
  metaBusy = true;
  let info = null;
  try {
    info = await invoke("now_playing", { url: STATIONS[at].u });
  } catch {
    info = null;
  }
  metaBusy = false;
  if (at !== cur || audio.paused) return;

  const station = STATIONS[at];
  const title = info && info.title ? info.title : "";
  if (title === shownTitle) return;
  shownTitle = title;
  el.title.textContent = title || station.n;
  el.title.title = title || station.n;
  updateMediaSession(station.n, title || station.n);
}

// ---------------------------------------------------------------- integracja z systemem (MPRIS / klawisze multimediów)

function updateMediaSession(station, title) {
  if (!("mediaSession" in navigator)) return;
  try {
    if (typeof MediaMetadata === "function") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title,
        artist: station,
        album: "Antena",
      });
    }
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  } catch {
    /* opcjonalne */
  }
}

if ("mediaSession" in navigator) {
  const set = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* dana akcja nieobsługiwana */
    }
  };
  set("play", () => audio.play());
  set("pause", () => audio.pause());
  set("stop", () => audio.pause());
  set("nexttrack", () => move(1));
  set("previoustrack", () => move(-1));
}

// ---------------------------------------------------------------- klawiatura

document.addEventListener("keydown", (e) => {
  const typing = e.target === el.search;
  if (typing && e.key !== "Escape") return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      togglePlay();
      break;
    case "ArrowDown":
      e.preventDefault();
      move(1);
      break;
    case "ArrowUp":
      e.preventDefault();
      move(-1);
      break;
    case "f":
    case "F":
      if (cur >= 0) toggleFav(cur);
      break;
    case "m":
    case "M":
      el.mute.click();
      break;
    case "/":
      e.preventDefault();
      el.search.focus();
      el.search.select();
      break;
  }
});

// ---------------------------------------------------------------- start

buildChips();
applyFilter();

(function restore() {
  const last = Number(readJSON(K.last, -1));
  if (last >= 0 && last < STATIONS.length) {
    // nie odtwarzamy automatycznie i nie przewijamy listy - czekamy na kliknięcie
    select(last, false, false);
    setState("Gotowe do odtworzenia");
  } else {
    setState("Zatrzymane");
  }
})();

