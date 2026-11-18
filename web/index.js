// Recipe list: filter by ingredient (include / exclude), sort, shopping list.
// Cards are rendered with the same cardHtml the build uses for the first paint.

const INDEX_KEY = "recipes.index.v1";
const DEFAULT_DIR = { title: "asc", cost: "asc", costPer100: "asc", calories: "asc", protein: "desc", proteinPerDollar: "desc", time: "asc" };
const DIR_TEXT = {
  asc: "↑ low to high",
  desc: "↓ high to low",
};

const state = { sort: "title", dir: null, inc: [], exc: [], any: false, makeable: false, picked: [] };
try {
  Object.assign(state, JSON.parse(localStorage.getItem(INDEX_KEY)) || {});
} catch {
  /* ignore unreadable saved state */
}
const saveState = () => {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
};
const byId = (id) => document.getElementById(id);
const listEl = byId("list");

function chipState(id) {
  return state.inc.includes(id) ? "inc" : state.exc.includes(id) ? "exc" : "off";
}

function paintChips() {
  for (const chip of document.querySelectorAll(".chip-btn")) {
    const s = chipState(chip.dataset.id);
    chip.dataset.state = s;
    chip.textContent = (s === "inc" ? "✓ " : s === "exc" ? "✕ " : "") + chip.dataset.name;
    chip.setAttribute("aria-label", `${chip.dataset.name}: ${s === "inc" ? "included" : s === "exc" ? "excluded" : "not filtered"}`);
  }
}

function compare(a, b, key, dir) {
  let result;
  if (key === "title") result = a.keys.title.localeCompare(b.keys.title);
  else {
    const x = a.keys[key];
    const y = b.keys[key];
    result = x === y ? 0 : x < y ? -1 : 1;
  }
  return dir === "desc" ? -result : result;
}

function render() {
  const pref = { inc: state.inc, exc: state.exc };
  const models = RECIPES.map((r) => recipeModel(DATA, r, pref));
  const visible = models.filter((m) => {
    const incOk = state.inc.length === 0 || (state.any ? state.inc.some((f) => m.used.has(f)) : state.inc.every((f) => m.used.has(f)));
    const excOk = !state.exc.some((f) => m.used.has(f));
    const canMake = !state.makeable || m.sug.status !== "blocked";
    return incOk && excOk && canMake;
  });
  const dir = state.dir || DEFAULT_DIR[state.sort];
  visible.sort((a, b) => compare(a, b, state.sort, dir) || a.keys.title.localeCompare(b.keys.title));

  state.picked = state.picked.filter((id) => RECIPES.some((r) => r.id === id));
  listEl.innerHTML = visible.length
    ? visible.map((m) => cardHtml(DATA, m, state.picked)).join("")
    : `<p class="empty">No recipes match these filters. Try clearing an exclusion or switching Match to "any included".</p>`;
  byId("count").textContent = `${visible.length} of ${RECIPES.length} recipes`;
  byId("dir").textContent = DIR_TEXT[dir];
  byId("sort").value = state.sort;
  byId("any").value = state.any ? "any" : "all";
  byId("makeable").checked = state.makeable;
  paintChips();

  // Shopping list uses the selections currently shown on the cards.
  const entries = models.filter((m) => state.picked.includes(m.recipe.id)).map((m) => ({ recipe: m.recipe, selection: m.selection, scale: 1 }));
  const shopping = byId("shopping");
  shopping.hidden = entries.length === 0;
  if (entries.length) {
    const list = shoppingList(DATA, entries);
    byId("shoplist").innerHTML = `<p class="meta">${entries.map((e) => e.recipe.title).join(" · ")}</p>${shoppingHtml(DATA, list)}`;
    byId("copylist").onclick = () =>
      copyText(shoppingText(DATA, list)).then(() => {
        byId("copied").textContent = "Copied";
        setTimeout(() => (byId("copied").textContent = ""), 2000);
      });
  }
  const bar = byId("listbar");
  bar.hidden = entries.length === 0;
  if (entries.length) bar.textContent = `🛒 Shopping list · ${entries.length} recipe${entries.length === 1 ? "" : "s"} · view ↓`;
  const active = state.inc.length + state.exc.length;
  byId("filtersum").textContent = active ? `Filter by ingredient (${active} active)` : "Filter by ingredient";
  saveState();
}

function toggleList(arr, id, on) {
  const i = arr.indexOf(id);
  if (on && i < 0) arr.push(id);
  if (!on && i >= 0) arr.splice(i, 1);
}

document.querySelector(".filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip-btn");
  if (!chip) return;
  const s = chipState(chip.dataset.id);
  toggleList(state.inc, chip.dataset.id, s === "off");
  toggleList(state.exc, chip.dataset.id, s === "inc");
  render();
});
byId("chipsearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  for (const chip of document.querySelectorAll(".chip-btn")) chip.hidden = q !== "" && !chip.dataset.name.toLowerCase().includes(q);
});
byId("sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  state.dir = null;
  render();
});
byId("dir").addEventListener("click", () => {
  state.dir = (state.dir || DEFAULT_DIR[state.sort]) === "asc" ? "desc" : "asc";
  render();
});
byId("any").addEventListener("change", (e) => {
  state.any = e.target.value === "any";
  render();
});
byId("makeable").addEventListener("change", (e) => {
  state.makeable = e.target.checked;
  render();
});
byId("clearfilters").addEventListener("click", () => {
  state.inc = [];
  state.exc = [];
  byId("chipsearch").value = "";
  for (const chip of document.querySelectorAll(".chip-btn")) chip.hidden = false;
  render();
});
listEl.addEventListener("change", (e) => {
  if (!e.target.classList.contains("pickrecipe")) return;
  toggleList(state.picked, e.target.value, e.target.checked);
  render();
});
byId("clearlist").addEventListener("click", () => {
  state.picked = [];
  render();
});

// Phones: start with the long ingredient filter collapsed unless a filter is active.
if (window.matchMedia("(max-width: 640px)").matches && state.inc.length + state.exc.length === 0) byId("filters").open = false;

render();
