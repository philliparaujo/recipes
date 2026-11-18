// Catalog: sortable and filterable tables, local "owned" what-if toggles, and a
// YAML generator for new items. Nothing here writes to the repo's YAML files.

const ownedNow = (id) => (id in DATA.food ? isOwned(DATA, id) : DATA.cookware[id].owned);

// ---- owned toggles ----
function refreshOwned() {
  for (const cb of document.querySelectorAll(".owned-toggle")) {
    const owned = ownedNow(cb.dataset.id);
    cb.checked = owned;
    cb.closest("td").dataset.v = owned ? 1 : 0;
    cb.nextElementSibling.textContent = owned ? "owned" : "not owned";
  }
  for (const el of document.querySelectorAll(".derived-owned")) el.innerHTML = ownedBadge(isOwned(DATA, el.dataset.id));
  for (const cell of document.querySelectorAll(".status-cell")) {
    const recipe = RECIPES.find((r) => r.id === cell.dataset.status);
    cell.innerHTML = statusBadge(suggest(DATA, recipe, defaultSelection(recipe)));
  }
  showOverrideBanner();
}

for (const cb of document.querySelectorAll(".owned-toggle")) {
  cb.addEventListener("change", () => {
    const id = cb.dataset.id;
    const ov = loadOverrides();
    if (cb.checked === BASE_OWNED[id]) delete ov[id];
    else ov[id] = cb.checked;
    saveOverrides(ov);
    const target = DATA.food[id] || DATA.cookware[id];
    target.owned = cb.checked;
    refreshOwned();
  });
}
refreshOwned();

// ---- sort and filter ----
for (const table of document.querySelectorAll("table[data-sortable]")) {
  // Phones show each row as a card; every cell needs its column name for that layout.
  const heads = [...table.tHead.rows[0].cells].map((h) => h.textContent.trim());
  for (const row of table.tBodies[0].rows) [...row.cells].forEach((c, i) => (c.dataset.label = heads[i]));
  const body = table.tBodies[0];
  const sortBy = (th) => {
    const col = th.cellIndex;
    const asc = th.getAttribute("aria-sort") !== "ascending";
    for (const other of table.tHead.rows[0].cells) other.removeAttribute("aria-sort");
    th.setAttribute("aria-sort", asc ? "ascending" : "descending");
    const num = th.dataset.type === "num";
    const key = (row) => {
      const cell = row.cells[col];
      const v = cell.dataset.v !== undefined ? cell.dataset.v : cell.textContent.trim();
      return num ? parseFloat(v) : v.toLowerCase();
    };
    const rows = [...body.rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x === y ? 0 : x < y ? -1 : 1) * (asc ? 1 : -1);
    });
    for (const row of rows) body.appendChild(row);
  };
  for (const th of table.tHead.rows[0].cells) {
    th.addEventListener("click", () => sortBy(th));
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        sortBy(th);
      }
    });
  }
}

function applyTableFilter(tableId) {
  const q = document.querySelector(`.tfilter[data-table="${tableId}"]`).value.trim().toLowerCase();
  const cat = document.querySelector(`.catfilter[data-table="${tableId}"]`).value;
  for (const row of document.getElementById(tableId).tBodies[0].rows) {
    row.hidden = (q !== "" && !row.dataset.search.includes(q)) || (cat !== "" && row.dataset.cat !== cat);
  }
}
for (const el of document.querySelectorAll(".tfilter, .catfilter")) {
  el.addEventListener("input", () => applyTableFilter(el.dataset.table));
}

// ---- YAML generator ----
{
  const root = document.getElementById("gen");
  const foodCats = root.dataset.foodCats.split(",");
  const cookCats = root.dataset.cookwareCats.split(",");
  const units = root.dataset.units.split(",");
  const opt = (list) => list.map((x) => `<option>${x}</option>`).join("");
  const num = (name, label) => `<label>${label} <input type="number" step="any" min="0" name="${name}"></label>`;
  const unit = (name) => `<select name="${name}">${opt(units)}</select>`;

  root.innerHTML = `
<label>Type <select name="type"><option value="food">Food</option><option value="cookware">Cookware</option></select></label>
<label>Id (kebab-case) <input type="text" name="id" placeholder="ground-turkey-93-7"></label>
<label>Name <input type="text" name="name"></label>
<label>Category <select name="category"></select></label>
<div data-for="food">
  <label>Brand (optional) <input type="text" name="brand"></label>
  <div class="row"><label>Package <input type="number" step="any" min="0" name="pkg"> ${unit("pkgUnit")}</label></div>
  <div class="row"><label>Same package in the other unit family, optional (e.g. 2.5 oz ≈ 31 tsp) <input type="number" step="any" min="0" name="pkgEq"> ${unit("pkgEqUnit")}</label></div>
  <div class="row"><label>Price per <input type="number" step="any" min="0" name="cost"> $ / ${unit("costUnit")}</label></div>
  <div class="row"><span>Nutrition per ${unit("nutUnit")}:</span>${num("cal", "kcal")}${num("pro", "protein g")}${num("fat", "fat g")}${num("carb", "carbs g")}</div>
  <label><input type="checkbox" name="est" checked> Price and nutrition are estimates</label>
  <label><input type="checkbox" name="owned" checked> Owned</label>
</div>
<div data-for="cookware" hidden>
  <label>Short name <input type="text" name="short"></label>
  <label>Tags (comma separated) <input type="text" name="tags"></label>
  <label><input type="checkbox" name="cwowned" checked> Owned</label>
</div>
<p><strong>Save as:</strong> <code id="gen-path"></code></p>
<textarea id="gen-out" readonly aria-label="Generated YAML"></textarea>
<div class="controls"><button type="button" id="gen-copy">Copy YAML</button></div>`;

  const f = (n) => root.querySelector(`[name="${n}"]`);
  const q = (s) => JSON.stringify(s);
  const filled = (n) => f(n).value !== "";

  function generate() {
    const type = f("type").value;
    const isFood = type === "food";
    root.querySelector('[data-for="food"]').hidden = !isFood;
    root.querySelector('[data-for="cookware"]').hidden = isFood;
    const cats = isFood ? foodCats : cookCats;
    const catSel = f("category");
    if (catSel.dataset.type !== type) {
      catSel.innerHTML = opt(cats);
      catSel.dataset.type = type;
    }
    const id = f("id").value.trim();
    const lines = [`id: ${id}`];
    if (isFood) {
      lines.push(`display_name: ${q(f("name").value)}`);
      if (f("brand").value) lines.push(`brand: ${q(f("brand").value)}`);
      lines.push(`category: ${catSel.value}`);
      if (filled("pkg")) lines.push(`package: { amount: ${f("pkg").value}, unit: ${f("pkgUnit").value}${filled("pkgEq") ? `, equals: { amount: ${f("pkgEq").value}, unit: ${f("pkgEqUnit").value} }` : ""} }`);
      lines.push(`owned: ${f("owned").checked}`);
      if (filled("cost")) lines.push(`cost_per_unit: { amount: ${f("cost").value}, unit: ${f("costUnit").value} }`);
      if (filled("cal") && filled("pro")) {
        const extra = [filled("fat") ? `, fat_g: ${f("fat").value}` : "", filled("carb") ? `, carbs_g: ${f("carb").value}` : ""].join("");
        lines.push(`nutrition: { unit: ${f("nutUnit").value}, calories: ${f("cal").value}, protein_g: ${f("pro").value}${extra} }`);
      }
      if (f("est").checked) {
        const est = [filled("cost") ? "cost_per_unit" : "", filled("cal") && filled("pro") ? "nutrition" : ""].filter(Boolean);
        if (est.length) lines.push(`estimated: [${est.join(", ")}]`);
      }
    } else {
      lines.push(`category: ${catSel.value}`, `name: ${q(f("name").value)}`);
      if (f("short").value) lines.push(`short_name: ${q(f("short").value)}`);
      lines.push(`owned: ${f("cwowned").checked}`);
      const tags = f("tags").value.split(",").map((t) => t.trim()).filter(Boolean);
      if (tags.length) lines.push(`tags: [${tags.join(", ")}]`);
    }
    document.getElementById("gen-out").value = lines.join("\n") + "\n";
    document.getElementById("gen-path").textContent = `${isFood ? "food" : "cookware"}/${id || "<id>"}.yaml`;
  }
  root.addEventListener("input", generate);
  root.addEventListener("change", generate);
  document.getElementById("gen-copy").addEventListener("click", () => copyText(document.getElementById("gen-out").value));
  generate();
}
