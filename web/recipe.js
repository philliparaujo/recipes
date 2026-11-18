// Recipe page: swap pickers, serving scale, reset, and "apply suggested swaps".
// The selection lives in the URL hash so a swapped version can be shared.

const recipe = RECIPES.find((r) => r.id === document.querySelector("main").dataset.recipe);
const pickersEl = document.getElementById("pickers");
const detailEl = document.getElementById("detail");
const servingsEl = document.getElementById("servings");

let selection = defaultSelection(recipe);
let scale = 1;

for (const part of location.hash.slice(1).split("&")) {
  const [key, value = ""] = part.split("=");
  if (key === "s") {
    const n = parseFloat(value);
    if (n >= 1) scale = n / recipe.servings;
    continue;
  }
  const ing = recipe.ingredients.find((i) => i.id === key);
  if (!ing) continue;
  if (value === "" && ing.optional) selection[key] = null;
  else if (ing.options.some((o) => o.food === value)) selection[key] = value;
}

function render(focusId) {
  pickersEl.innerHTML = pickersHtml(DATA, recipe, selection);
  servingsEl.value = fmtNum(recipe.servings * scale);
  detailEl.innerHTML = detailHtml(DATA, recipe, selection, scale);
  const base = defaultSelection(recipe);
  const parts = recipe.ingredients.filter((i) => selection[i.id] !== base[i.id]).map((i) => `${i.id}=${selection[i.id] ?? ""}`);
  if (scale !== 1) parts.push(`s=${fmtNum(recipe.servings * scale)}`);
  history.replaceState(null, "", parts.length ? "#" + parts.join("&") : location.pathname + location.search);
  if (focusId) document.getElementById(focusId)?.focus();
  watchStats();
}

// Phones: keep cost / calories / protein in view (bottom bar) once the stat tiles scroll away,
// so you can change a swap and see the effect without scrolling back up.
const minibar = document.getElementById("minibar");
let observer = null;
function watchStats() {
  const stats = detailEl.querySelector(".stats");
  if (!stats || !("IntersectionObserver" in window)) return;
  const vals = [...stats.querySelectorAll(".stat")].slice(0, 3).map((s) => `<span><strong>${s.querySelector(".stat-v").textContent}</strong> ${s.querySelector(".stat-l").textContent}</span>`);
  minibar.innerHTML = vals.join("");
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(([entry]) => {
    minibar.hidden = entry.isIntersecting;
  });
  observer.observe(stats);
}

pickersEl.addEventListener("change", (e) => {
  if (!e.target.dataset.ing) return;
  selection[e.target.dataset.ing] = e.target.value || null;
  render(e.target.id);
});
servingsEl.addEventListener("change", () => {
  const n = parseFloat(servingsEl.value);
  scale = n >= 1 ? n / recipe.servings : 1;
  render("servings");
});
document.getElementById("reset").addEventListener("click", () => {
  selection = defaultSelection(recipe);
  scale = 1;
  render();
});
detailEl.addEventListener("click", (e) => {
  if (e.target.id !== "applyfix") return;
  selection = applyFixes(selection, suggest(DATA, recipe, selection).fixes);
  render();
});

render();
