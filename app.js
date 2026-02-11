// Offline Productivity (single-file local app)
// UI is in index.html, styles in style.css, logic here.

const TEMPLATES_KEY = "prod_templates_v1";

const DEFAULT_TEMPLATES = {
  important: [
    { id: "important-exercise", t: "Exercise" },
    { id: "important-study", t: "Study" },
    { id: "important-planning", t: "Planning" }
  ],
  moderate: [
    { id: "moderate-reading", t: "Reading" },
    { id: "moderate-revision", t: "Revision" }
  ]
};

function getTodayIso() {
  // Use local date (not UTC) so "today" matches the user's calendar day.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

let todayIso = getTodayIso();
let selectedDate = todayIso;

let db = JSON.parse(localStorage.getItem("prod")) || {};
let templates = loadTemplates();

const importantEl = document.getElementById("important");
const moderateEl = document.getElementById("moderate");
const dailyEl = document.getElementById("daily");
const dailyInputEl = document.getElementById("dailyInput");
const journalEl = document.getElementById("journal");
const dateStripEl = document.getElementById("dateStrip");
const impDonutEl = document.getElementById("impDonut");
const modDonutEl = document.getElementById("modDonut");
const dayDonutEl = document.getElementById("dayDonut");
const selectedDateLabelEl = document.getElementById("selectedDateLabel");
const todayHeadingEl = document.getElementById("todayHeading");
const calTitleEl = document.getElementById("calTitle");
const calendarGridEl = document.getElementById("calendarGrid");
const impTemplateListEl = document.getElementById("impTemplateList");
const modTemplateListEl = document.getElementById("modTemplateList");
const impTemplateInputEl = document.getElementById("impTemplateInput");
const modTemplateInputEl = document.getElementById("modTemplateInput");
const templateEditorEl = document.getElementById("templateEditor");
const readOnlyBannerEl = document.getElementById("readOnlyBanner");
const readOnlyDateEl = document.getElementById("readOnlyDate");
const addDailyBtnEl = document.getElementById("addDailyBtn");
const saveJournalBtnEl = document.getElementById("saveJournalBtn");

let calMonth = new Date(todayIso + "T00:00:00"); // tracks visible month

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function newId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function slug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "task";
}

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return clone(DEFAULT_TEMPLATES);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.important) || !Array.isArray(parsed.moderate)) {
      return clone(DEFAULT_TEMPLATES);
    }
    // Ensure {id,t} shape
    parsed.important = parsed.important
      .filter(x => x && typeof x.t === "string" && x.t.trim())
      .map((x, i) => ({ id: String(x.id || `important-${slug(x.t)}-${i}`), t: String(x.t).trim() }));
    parsed.moderate = parsed.moderate
      .filter(x => x && typeof x.t === "string" && x.t.trim())
      .map((x, i) => ({ id: String(x.id || `moderate-${slug(x.t)}-${i}`), t: String(x.t).trim() }));
    return parsed;
  } catch {
    return clone(DEFAULT_TEMPLATES);
  }
}

function saveTemplates() {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

function isEditableDate(date) {
  return date === todayIso;
}

function requireEditable() {
  if (!isEditableDate(selectedDate)) {
    alert("This date is read-only. You can only edit today's data.");
    return false;
  }
  return true;
}

function refreshTodayIfChanged() {
  const nowIso = getTodayIso();
  if (nowIso === todayIso) return;

  const prevToday = todayIso;
  todayIso = nowIso;

  // If user was viewing the old "today", move them to the new day automatically.
  if (selectedDate === prevToday) selectedDate = todayIso;

  // Keep calendar month sensible around midnight.
  const sel = new Date(selectedDate + "T00:00:00");
  if (sel.getFullYear() !== calMonth.getFullYear() || sel.getMonth() !== calMonth.getMonth()) {
    calMonth = new Date(sel.getFullYear(), sel.getMonth(), 1);
  }

  renderTemplateEditor();
  render();
  renderCandles();
  renderDonuts();
  renderCalendar();
}

function applyEditability() {
  const editable = isEditableDate(selectedDate);

  if (readOnlyBannerEl) readOnlyBannerEl.hidden = editable;
  if (readOnlyDateEl) readOnlyDateEl.textContent = selectedDate;

  if (dailyInputEl) dailyInputEl.disabled = !editable;
  if (addDailyBtnEl) addDailyBtnEl.disabled = !editable;

  if (journalEl) {
    journalEl.readOnly = !editable;
    journalEl.classList.toggle("is-readonly", !editable);
  }
  if (saveJournalBtnEl) saveJournalBtnEl.disabled = !editable;

  // Disable template editor when viewing past dates (prevents indirect edits to history).
  if (templateEditorEl) {
    templateEditorEl.classList.toggle("is-readonly", !editable);
    templateEditorEl.querySelectorAll("input, button").forEach((el) => {
      el.disabled = !editable;
    });
  }
}

function enableHorizontalDragScroll(el) {
  if (!el) return;

  let isDown = false;
  let startX = 0;
  let startScrollLeft = 0;
  let moved = false;
  let dragActive = false;

  el.style.cursor = "grab";

  // Desktop/trackpad (Chrome on Mac): make two-finger scroll over the strip move it horizontally,
  // and prevent the page from scrolling while the cursor is over the strip.
  el.addEventListener("wheel", (e) => {
    const canScrollX = el.scrollWidth > el.clientWidth + 1;
    if (!canScrollX) return;

    const dx = e.deltaX || 0;
    const dy = e.deltaY || 0;
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy; // "swipe" on trackpad often shows up as wheel deltas
    if (!delta) return;

    e.preventDefault();
    el.scrollLeft += delta;
  }, { passive: false });

  el.addEventListener("pointerdown", (e) => {
    // Only primary button for mouse; touch/pen are fine.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    isDown = true;
    moved = false;
    dragActive = false;
    startX = e.clientX;
    startScrollLeft = el.scrollLeft;
    try { el.setPointerCapture?.(e.pointerId); } catch {}
    el.style.cursor = "grabbing";
  });

  el.addEventListener("pointermove", (e) => {
    if (!isDown) return;
    const dx = e.clientX - startX;
    // Avoid swallowing clicks: only start dragging after a clear horizontal move.
    if (!dragActive) {
      if (Math.abs(dx) > 12) {
        dragActive = true;
        moved = true;
      } else {
        return;
      }
    }
    el.scrollLeft = startScrollLeft - dx;
  });

  const end = (e) => {
    if (!isDown) return;
    isDown = false;
    el.style.cursor = "grab";
    el.releasePointerCapture?.(e.pointerId);

    // If user was dragging, prevent accidental clicks on date items.
    if (moved) {
      const stopClick = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
      };
      el.addEventListener("click", stopClick, { capture: true, once: true });
    }
  };

  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("pointerleave", end);

  // iOS Safari can be finicky with pointer-based dragging inside overflow containers.
  // Add explicit touch swipe support that only captures when the gesture is horizontal.
  let tStartX = 0;
  let tStartY = 0;
  let tStartScrollLeft = 0;
  let tDragging = false;

  el.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    tStartX = t.clientX;
    tStartY = t.clientY;
    tStartScrollLeft = el.scrollLeft;
    tDragging = false;
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - tStartX;
    const dy = t.clientY - tStartY;

    // Only take over when it's clearly a horizontal swipe.
    if (!tDragging) {
      if (Math.abs(dx) > Math.abs(dy) + 4) tDragging = true;
      else return;
    }

    // Prevent vertical page scrolling while swiping the strip horizontally.
    e.preventDefault();
    el.scrollLeft = tStartScrollLeft - dx;
  }, { passive: false });
}

function init(date) {
  if (!db[date]) {
    // Only allow creating a new day record for today.
    if (!isEditableDate(date)) return;
    // Initialize from templates (permanent task lists)
    const important = (templates.important || []).map(x => ({ id: x.id, t: x.t, d: false }));
    const moderate = (templates.moderate || []).map(x => ({ id: x.id, t: x.t, d: false }));
    db[date] = {
      important,
      moderate,
      daily: [],
      journal: ""
    };
  }
}

function save() {
  localStorage.setItem("prod", JSON.stringify(db));
  render();
  renderCandles();
  renderDonuts();
  renderCalendar();
}

function toggle(type, i) {
  if (!requireEditable()) return;
  if (!db[selectedDate] || !db[selectedDate][type] || !db[selectedDate][type][i]) return;
  db[selectedDate][type][i].d = !db[selectedDate][type][i].d;
  save();
}

function addDaily() {
  if (!requireEditable()) return;
  const v = (dailyInputEl.value || "").trim();
  if (!v) return;
  init(selectedDate);
  db[selectedDate].daily.push({ t: v, d: false });
  dailyInputEl.value = "";
  save();
  dailyInputEl.focus();
}

function deleteDaily(i) {
  if (!requireEditable()) return;
  const item = db[selectedDate]?.daily?.[i];
  if (!item) return;
  const ok = confirm(`Delete daily task?\n\n${item.t}`);
  if (!ok) return;
  db[selectedDate].daily.splice(i, 1);
  save();
}

function ensureDbIds() {
  let changed = false;
  for (const date of Object.keys(db)) {
    const day = db[date];
    if (!day) continue;
    for (const type of ["important", "moderate"]) {
      const arr = day[type];
      if (!Array.isArray(arr)) continue;
      arr.forEach((x, i) => {
        if (!x) return;
        if (!x.id) {
          x.id = `${type}-${slug(x.t)}-${i}`;
          changed = true;
        }
      });
    }
  }
  if (changed) localStorage.setItem("prod", JSON.stringify(db));
}

function syncDayWithTemplates(date) {
  init(date);
  if (!db[date]) return;
  const day = db[date];

  for (const type of ["important", "moderate"]) {
    const templateArr = templates[type] || [];
    const existing = new Map((day[type] || []).map(x => [x.id, x]));
    day[type] = templateArr.map(t => {
      const prev = existing.get(t.id);
      return { id: t.id, t: t.t, d: prev ? !!prev.d : false };
    });
  }
}

function renderTemplateEditor() {
  if (!impTemplateListEl || !modTemplateListEl) return;
  const editable = isEditableDate(selectedDate);

  const renderList = (type, root) => {
    root.innerHTML = "";
    const arr = templates[type] || [];
    arr.forEach((item) => {
      const row = document.createElement("div");
      row.className = "template-item";

      const input = document.createElement("input");
      input.value = item.t;
      input.placeholder = "Task name…";
      input.disabled = !editable;
      input.addEventListener("input", () => {
        if (!requireEditable()) return;
        const v = input.value.trim();
        if (!v) return;
        item.t = v;
        saveTemplates();
        // Only update today's record; past days remain immutable.
        syncDayWithTemplates(todayIso);
        localStorage.setItem("prod", JSON.stringify(db));
        render();
        renderCandles();
        renderDonuts();
        renderCalendar();
      });

      const del = document.createElement("button");
      del.className = "icon-btn danger";
      del.textContent = "×";
      del.setAttribute("aria-label", `Delete ${item.t}`);
      del.disabled = !editable;
      del.onclick = () => {
        if (!requireEditable()) return;
        const ok = confirm(`Remove this ${type} task from the permanent list?\n\n${item.t}`);
        if (!ok) return;
        templates[type] = (templates[type] || []).filter(x => x.id !== item.id);
        saveTemplates();
        // Only update today's record; past days remain immutable.
        syncDayWithTemplates(todayIso);
        localStorage.setItem("prod", JSON.stringify(db));
        renderTemplateEditor();
        render();
        renderCandles();
        renderDonuts();
        renderCalendar();
      };

      row.appendChild(input);
      row.appendChild(del);
      root.appendChild(row);
    });
  };

  renderList("important", impTemplateListEl);
  renderList("moderate", modTemplateListEl);
}

function addTemplateTask(type) {
  if (!requireEditable()) return;
  const inputEl = type === "important" ? impTemplateInputEl : modTemplateInputEl;
  if (!inputEl) return;
  const v = (inputEl.value || "").trim();
  if (!v) return;

  templates[type] = templates[type] || [];
  templates[type].push({ id: newId(type), t: v });
  saveTemplates();

  inputEl.value = "";
  syncDayWithTemplates(todayIso);
  localStorage.setItem("prod", JSON.stringify(db));

  renderTemplateEditor();
  render();
  renderCandles();
  renderDonuts();
  renderCalendar();
  inputEl.focus();
}

function saveJournal() {
  if (!requireEditable()) return;
  init(selectedDate);
  db[selectedDate].journal = journalEl.value;
  save();
}

function completion(day) {
  const all = [...day.important, ...day.moderate, ...day.daily];
  if (!all.length) return 0;
  return Math.round((all.filter(x => x.d).length / all.length) * 100);
}

function render() {
  init(selectedDate);
  const editable = isEditableDate(selectedDate);
  const d = db[selectedDate] || { important: [], moderate: [], daily: [], journal: "" };

  if (selectedDateLabelEl) selectedDateLabelEl.textContent = selectedDate;

  if (todayHeadingEl) {
    let label = "Today";
    if (!sameDayISO(selectedDate, todayIso)) {
      if (selectedDate < todayIso) label = "Time gone";
      else label = "Time left";
    }
    todayHeadingEl.textContent = label;
  }

  importantEl.innerHTML = "";
  d.important.forEach((x, i) => {
    importantEl.innerHTML += `
      <div class="task">
        <input type="checkbox" ${x.d ? "checked" : ""} ${editable ? "" : "disabled"} onchange="toggle('important',${i})" />
        <div class="task-text">${x.t}</div>
      </div>`;
  });

  moderateEl.innerHTML = "";
  d.moderate.forEach((x, i) => {
    moderateEl.innerHTML += `
      <div class="task">
        <input type="checkbox" ${x.d ? "checked" : ""} ${editable ? "" : "disabled"} onchange="toggle('moderate',${i})" />
        <div class="task-text">${x.t}</div>
      </div>`;
  });

  dailyEl.innerHTML = "";
  d.daily.forEach((x, i) => {
    dailyEl.innerHTML += `
      <div class="task">
        <input type="checkbox" ${x.d ? "checked" : ""} ${editable ? "" : "disabled"} onchange="toggle('daily',${i})" />
        <div class="task-text">${x.t}</div>
        ${editable ? `<button class="icon-btn danger" onclick="deleteDaily(${i})" aria-label="Delete ${x.t}">×</button>` : ""}
      </div>`;
  });

  journalEl.value = d.journal || "";
  applyEditability();
}

function fmtMonthTitle(d) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameDayISO(isoA, isoB) {
  return isoA === isoB;
}

function isoFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function renderCalendar() {
  if (!calendarGridEl || !calTitleEl) return;

  calTitleEl.textContent = fmtMonthTitle(calMonth);
  calendarGridEl.innerHTML = "";

  const first = startOfMonth(calMonth);
  const firstWeekday = first.getDay(); // 0=Sun
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - firstWeekday);

  const datesWithData = new Set(Object.keys(db));

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = isoFromDate(d);

    const isOutside = d.getMonth() !== calMonth.getMonth();
    const isSelected = sameDayISO(iso, selectedDate);
    const isToday = sameDayISO(iso, todayIso);
    const hasData = datesWithData.has(iso);

    let pct = 0;
    if (hasData) pct = completion(db[iso]) / 100;

    const div = document.createElement("div");
    div.className = [
      "cal-day",
      isOutside ? "is-outside" : "",
      isSelected ? "is-selected" : "",
      isToday ? "is-today" : "",
      hasData ? "has-data" : ""
    ].filter(Boolean).join(" ");

    div.style.setProperty("--pct", String(pct));
    div.textContent = String(d.getDate());
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", `Select ${iso}`);
    div.onclick = () => selectDate(iso);

    calendarGridEl.appendChild(div);
  }
}

function renderCandles() {
  dateStripEl.innerHTML = "";

  // Always show a rolling 31-day window ending today (real-time),
  // even if some days have no saved data yet.
  const end = new Date(todayIso + "T00:00:00");
  for (let offset = 30; offset >= 0; offset--) {
    const d = new Date(end);
    d.setDate(end.getDate() - offset);
    const date = isoFromDate(d);

    const c = db[date] ? completion(db[date]) : 0;
    const isSelected = date === selectedDate;
    dateStripEl.innerHTML += `
      <div class="date-item ${isSelected ? "is-selected" : ""}" onclick="selectDate('${date}')" role="button" aria-label="Select ${date}">
        <div class="candle" aria-hidden="true">
          <div class="fill" style="height:${c}%"></div>
        </div>
        <div class="date-label">${date.slice(8, 10)}</div>
      </div>`;
  }
}

function donut(el, name, color, done, total) {
  const deg = total ? Math.round((done / total) * 360) : 0;
  el.style.background = `conic-gradient(${color} ${deg}deg, rgba(0,0,0,.10) 0deg)`;
  const pct = total ? Math.round((done / total) * 100) : 0;
  el.innerHTML = `
    <div class="donut-label">
      <div class="pct">${pct}%</div>
      <div class="name">${name}</div>
    </div>`;
}

function renderDonuts() {
  const d = db[selectedDate] || { important: [], moderate: [], daily: [] };
  donut(impDonutEl, "Important", "var(--pink)", d.important.filter(x => x.d).length, d.important.length);
  donut(modDonutEl, "Moderate", "var(--orange)", d.moderate.filter(x => x.d).length, d.moderate.length);
  donut(dayDonutEl, "Daily", "var(--green)", d.daily.filter(x => x.d).length, d.daily.length);
}

function selectDate(d) {
  selectedDate = d;
  // When selecting a day, bring the calendar to that day’s month.
  const sel = new Date(selectedDate + "T00:00:00");
  if (sel.getFullYear() !== calMonth.getFullYear() || sel.getMonth() !== calMonth.getMonth()) {
    calMonth = new Date(sel.getFullYear(), sel.getMonth(), 1);
  }
  render();
  renderCandles();
  renderDonuts();
  renderCalendar();
}

function prevCalMonth() {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
}

function nextCalMonth() {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
}

// Enter key adds daily task
dailyInputEl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addDaily();
});

// Expose handlers for inline HTML attributes (simple local-file setup)
window.toggle = toggle;
window.addDaily = addDaily;
window.deleteDaily = deleteDaily;
window.saveJournal = saveJournal;
window.selectDate = selectDate;
window.prevCalMonth = prevCalMonth;
window.nextCalMonth = nextCalMonth;
window.addTemplateTask = addTemplateTask;

init(todayIso);
ensureDbIds();
renderTemplateEditor();
render();
renderCandles();
renderDonuts();
renderCalendar();

enableHorizontalDragScroll(dateStripEl);

// Keep "today" real-time (midnight rollover, etc.)
setInterval(refreshTodayIfChanged, 30_000);