// Static site build: reads YAML data files, validates against CLAUDE.md §5,
// then emits plain HTML/JS/CSS to _site/. Validation failures abort the build.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  UNIT_FAMILIES, esc, fmtCost, fmtRate, fmtQty, fmtNutrition, unitLabel, fmtPackage, fmtNum, shortName,
  rate, convertUnit, defaultSelection, recipeModel, cardHtml, detailHtml, pickersHtml, statusBadge, ownedBadge,
} from "./shared.mjs";

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, "_site");

const FOOD_CATEGORIES = ["protein", "dairy", "vegetable", "fruit", "grain", "pasta", "sauce", "fat", "spice", "pantry", "other"];
const COOKWARE_CATEGORIES = ["pot", "pan", "appliance", "tool", "bakeware"];
const MAIN_FOOD_CATEGORIES = new Set(["protein", "dairy", "vegetable", "fruit", "grain", "pasta", "sauce"]);
const UNITS = new Set(Object.keys(UNIT_FAMILIES));
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const FOOD_KEYS = new Set(["id", "display_name", "brand", "category", "package", "owned", "cost_per_unit", "nutrition", "estimated", "count_label", "notes", "made_from", "makes", "on_hand"]);
const COOKWARE_KEYS = new Set(["id", "category", "name", "short_name", "size", "material", "owned", "tags", "notes"]);
const RECIPE_KEYS = new Set(["id", "title", "summary", "servings", "cookware", "ingredients", "method", "notes", "total_minutes"]);
const ING_KEYS = new Set(["id", "label", "food", "options", "optional", "amount", "unit", "prep_minutes", "cook_minutes", "cookware", "seasonings"]);
const OPT_KEYS = new Set(["food", "amount", "unit", "prep_minutes", "cook_minutes", "cookware", "seasonings"]);

const errors = [];
const fail = (msg) => errors.push(msg);

function loadDir(dir) {
  const full = path.join(ROOT, dir);
  const out = {};
  if (!fs.existsSync(full)) return out;
  for (const file of fs.readdirSync(full)) {
    if (!file.endsWith(".yaml")) continue;
    const data = yaml.load(fs.readFileSync(path.join(full, file), "utf8"));
    if (!data || !data.id) {
      fail(`${dir}/${file}: missing id`);
      continue;
    }
    out[data.id] = { ...data, __file: `${dir}/${file}` };
  }
  return out;
}

const cookware = loadDir("cookware");
const food = loadDir("food");
const recipes = loadDir("recipes");

function checkKeys(obj, allowed, ctx) {
  for (const k of Object.keys(obj)) {
    if (k !== "__file" && !allowed.has(k)) fail(`${ctx}: unknown field "${k}"`);
  }
}
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

// ---- unique kebab-case ids across ALL stores ----
{
  const seen = new Map();
  for (const store of [cookware, food, recipes]) {
    for (const [id, item] of Object.entries(store)) {
      if (!KEBAB.test(id)) fail(`${item.__file}: id "${id}" is not kebab-case`);
      if (seen.has(id)) fail(`duplicate id "${id}": ${seen.get(id)} and ${item.__file}`);
      else seen.set(id, item.__file);
    }
  }
}

// {unit, ...numeric fields}: required fields must be non-negative numbers, optional ones too if present.
function checkRate(r, ctx, required, optional = []) {
  if (!r || typeof r !== "object" || !UNITS.has(r.unit)) {
    fail(`${ctx}: must be an object with a unit in [${[...UNITS].join(", ")}] and ${required.join(", ")}`);
    return;
  }
  for (const k of Object.keys(r)) if (k !== "unit" && !required.includes(k) && !optional.includes(k)) fail(`${ctx}: unknown field "${k}"`);
  for (const k of required) if (!isNum(r[k]) || r[k] < 0) fail(`${ctx}.${k}: must be a non-negative number`);
  for (const k of optional) if (r[k] !== undefined && (!isNum(r[k]) || r[k] < 0)) fail(`${ctx}.${k}: must be a non-negative number`);
}

function checkEquipmentRef(ref, ctx) {
  if (typeof ref !== "string") return fail(`${ctx}: equipment reference must be a string`);
  if (ref.startsWith("category:")) {
    const cat = ref.slice(9);
    if (!COOKWARE_CATEGORIES.includes(cat)) return fail(`${ctx}: unknown cookware category "${cat}"`);
    if (!Object.values(cookware).some((c) => c.category === cat)) fail(`${ctx}: no cookware matches "${ref}"`);
  } else if (ref.startsWith("tag:")) {
    if (!Object.values(cookware).some((c) => (c.tags || []).includes(ref.slice(4)))) fail(`${ctx}: no cookware matches "${ref}"`);
  } else if (!cookware[ref]) {
    fail(`${ctx}: unknown cookware id "${ref}"`);
  }
}

// ---- food ----
for (const [id, f] of Object.entries(food)) {
  const ctx = `food/${id}`;
  checkKeys(f, FOOD_KEYS, ctx);
  if (!f.display_name) fail(`${ctx}: missing display_name`);
  if (f.brand !== undefined && (typeof f.brand !== "string" || !f.brand)) fail(`${ctx}: brand must be non-empty text`);
  if (!FOOD_CATEGORIES.includes(f.category)) fail(`${ctx}: unknown category "${f.category}"`);
  if (f.count_label !== undefined && (!f.count_label || typeof f.count_label.one !== "string" || typeof f.count_label.other !== "string")) {
    fail(`${ctx}: count_label must be {one, other}, e.g. {one: egg, other: eggs}`);
  }
  if (f.package !== undefined) {
    const { equals, ...pkg } = f.package && typeof f.package === "object" ? f.package : {};
    checkRate(f.package && typeof f.package === "object" ? pkg : f.package, `${ctx}.package`, ["amount"]);
    if (equals !== undefined) {
      checkRate(equals, `${ctx}.package.equals`, ["amount"]);
      if (equals && UNITS.has(equals.unit) && UNITS.has(pkg.unit) && convertUnit(1, equals.unit, pkg.unit) !== null) {
        fail(`${ctx}.package.equals: must be in a different unit family than the package (e.g. oz vs tsp)`);
      }
    }
  }
  if (f.on_hand !== undefined) checkRate(f.on_hand, `${ctx}.on_hand`, ["amount"]);

  if (f.made_from !== undefined) {
    // Composite: price, nutrition and ownership are derived from the components.
    for (const k of ["owned", "cost_per_unit", "nutrition", "package", "estimated"]) {
      if (f[k] !== undefined) fail(`${ctx}: composite items derive "${k}"; remove it`);
    }
    if (!Array.isArray(f.made_from) || f.made_from.length === 0) fail(`${ctx}: made_from must be a non-empty list`);
    if (!f.makes || !isNum(f.makes.amount) || f.makes.amount <= 0 || !UNITS.has(f.makes.unit)) fail(`${ctx}: makes must be {amount, unit} (what the components make)`);
    for (const [i, c] of (Array.isArray(f.made_from) ? f.made_from : []).entries()) {
      const cc = `${ctx}.made_from[${i}]`;
      if (!food[c?.food]) fail(`${cc}: unknown food "${c?.food}"`);
      else if (food[c.food].made_from) fail(`${cc}: components cannot themselves be composite`);
      if (!isNum(c?.amount) || c.amount <= 0 || !UNITS.has(c?.unit)) fail(`${cc}: needs a positive numeric amount and a valid unit`);
    }
  } else {
    if (typeof f.owned !== "boolean") fail(`${ctx}: owned must be true or false`);
    if (f.makes !== undefined) fail(`${ctx}: makes only applies with made_from`);
    if (f.cost_per_unit !== undefined) checkRate(f.cost_per_unit, `${ctx}.cost_per_unit`, ["amount"]);
    if (f.nutrition !== undefined) checkRate(f.nutrition, `${ctx}.nutrition`, ["calories", "protein_g"], ["fat_g", "carbs_g"]);
    if (f.estimated !== undefined) {
      if (!Array.isArray(f.estimated)) fail(`${ctx}: estimated must be a list`);
      for (const k of f.estimated || []) {
        if (!["cost_per_unit", "nutrition", "package"].includes(k)) fail(`${ctx}.estimated: "${k}" is not cost_per_unit, nutrition or package`);
        else if (f[k] === undefined) fail(`${ctx}.estimated: lists "${k}" but the item has no ${k}`);
      }
    }
    const usesCount = [f.package, f.cost_per_unit, f.nutrition, f.on_hand].some((x) => x && x.unit === "unit");
    if (usesCount && !f.count_label) fail(`${ctx}: uses the count unit "unit", so it needs a count_label`);
  }
  if (f.notes !== undefined && !Array.isArray(f.notes)) fail(`${ctx}: notes must be a list`);
}

// ---- derive composite foods (after base items validated) ----
function deriveComposites() {
  for (const f of Object.values(food)) {
    if (!f.made_from || !Array.isArray(f.made_from) || !f.makes) continue;
    const ctx = `food/${f.id}`;
    let cost = 0;
    const nut = { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
    let fatOk = true;
    let carbsOk = true;
    let ok = true;
    const est = new Set();
    for (const c of f.made_from) {
      const base = food[c.food];
      if (!base || base.made_from) continue;
      const price = base.cost_per_unit ? rate(c.amount, c.unit, base.cost_per_unit.amount, base.cost_per_unit.unit) : null;
      if (price === null) {
        fail(`${ctx}: cannot price component "${c.food}" (needs a cost_per_unit in a unit convertible from ${c.unit})`);
        ok = false;
      } else cost += price;
      const factor = base.nutrition ? convertUnit(c.amount, c.unit, base.nutrition.unit) : null;
      if (factor === null) {
        fail(`${ctx}: cannot compute nutrition for component "${c.food}"`);
        ok = false;
      } else {
        nut.calories += factor * base.nutrition.calories;
        nut.protein_g += factor * base.nutrition.protein_g;
        if (base.nutrition.fat_g === undefined) fatOk = false;
        else nut.fat_g += factor * base.nutrition.fat_g;
        if (base.nutrition.carbs_g === undefined) carbsOk = false;
        else nut.carbs_g += factor * base.nutrition.carbs_g;
      }
      for (const e of base.estimated || []) if (e !== "package") est.add(e);
    }
    if (!ok) continue;
    const m = f.makes.amount;
    const r1 = (x) => Math.round((x / m) * 10) / 10;
    f.cost_per_unit = { amount: Math.round((cost / m) * 10000) / 10000, unit: f.makes.unit };
    f.nutrition = { unit: f.makes.unit, calories: r1(nut.calories), protein_g: r1(nut.protein_g) };
    if (fatOk) f.nutrition.fat_g = r1(nut.fat_g);
    if (carbsOk) f.nutrition.carbs_g = r1(nut.carbs_g);
    f.estimated = [...est];
    f.notes = [
      ...(f.notes || []),
      `Made from ${f.made_from.map((c) => `${fmtQty(c.amount, c.unit, food[c.food])} ${shortName(food[c.food]).toLowerCase()}`).join(" + ")}.`,
    ];
  }
}

// ---- cookware ----
for (const [id, c] of Object.entries(cookware)) {
  const ctx = `cookware/${id}`;
  checkKeys(c, COOKWARE_KEYS, ctx);
  if (!COOKWARE_CATEGORIES.includes(c.category)) fail(`${ctx}: unknown category "${c.category}"`);
  if (!c.name) fail(`${ctx}: missing name`);
  if (typeof c.owned !== "boolean") fail(`${ctx}: owned must be true or false`);
}

// ---- recipes ----
function checkSeasonings(list, ctx) {
  for (const [i, s] of (list || []).entries()) {
    const c = `${ctx}.seasonings[${i}]`;
    if (!food[s?.food]) fail(`${c}: unknown food "${s?.food}"`);
    if (!isNum(s?.amount) || s.amount <= 0 || !UNITS.has(s?.unit)) fail(`${c}: needs a positive numeric amount and a valid unit`);
    else if (s.unit === "unit" && food[s.food] && !food[s.food].count_label) fail(`${c}: "${s.food}" needs a count_label to be used by count`);
  }
}
function checkMinutes(o, ctx) {
  for (const k of ["prep_minutes", "cook_minutes"]) {
    if (o[k] !== undefined && (!isNum(o[k]) || o[k] < 0)) fail(`${ctx}.${k}: must be a non-negative number`);
  }
}

for (const [id, r] of Object.entries(recipes)) {
  const ctx = `recipe/${id}`;
  checkKeys(r, RECIPE_KEYS, ctx);
  if (!r.title) fail(`${ctx}: missing title`);
  if (!Number.isInteger(r.servings) || r.servings < 1) fail(`${ctx}: servings must be a positive integer`);
  if (r.total_minutes !== undefined && (!isNum(r.total_minutes) || r.total_minutes <= 0)) fail(`${ctx}: total_minutes must be a positive number`);
  for (const ref of r.cookware || []) checkEquipmentRef(ref, `${ctx}.cookware`);
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) {
    fail(`${ctx}: needs a non-empty ingredients list`);
    continue;
  }
  const ingOptions = new Map(); // ingredient id -> {foods:Set, optional}
  for (const ing of r.ingredients) {
    const ic = `${ctx}.ingredient[${ing.id}]`;
    checkKeys(ing, ING_KEYS, ic);
    if (!ing.id || !KEBAB.test(ing.id)) fail(`${ic}: id must be kebab-case`);
    if (ingOptions.has(ing.id)) fail(`${ic}: duplicate ingredient id`);
    if (ing.optional !== undefined && typeof ing.optional !== "boolean") fail(`${ic}: optional must be true or false`);
    if ((ing.food === undefined) === (ing.options === undefined)) fail(`${ic}: declare exactly one of food or options`);
    if (ing.options !== undefined && (!Array.isArray(ing.options) || ing.options.length === 0)) fail(`${ic}: options must be a non-empty list`);
    for (const ref of ing.cookware || []) checkEquipmentRef(ref, ic);
    checkSeasonings(ing.seasonings, ic);
    checkMinutes(ing, ic);
    const opts = ing.options ?? [{ food: ing.food }];
    const seen = new Set();
    for (const o of Array.isArray(opts) ? opts : []) {
      const oc = `${ic}.option[${o?.food}]`;
      checkKeys(o, OPT_KEYS, oc);
      if (!food[o?.food]) fail(`${oc}: unknown food "${o?.food}"`);
      if (seen.has(o?.food)) fail(`${oc}: duplicate option`);
      seen.add(o?.food);
      const amount = o.amount ?? ing.amount;
      const unit = o.unit ?? ing.unit;
      if (!isNum(amount) || amount <= 0 || !UNITS.has(unit)) fail(`${oc}: needs a positive numeric amount and a valid unit (on the option or the ingredient)`);
      else if (unit === "unit" && food[o?.food] && !food[o.food].count_label) fail(`${oc}: "${o.food}" needs a count_label to be used by count`);
      for (const ref of o.cookware || []) checkEquipmentRef(ref, oc);
      checkSeasonings(o.seasonings, oc);
      checkMinutes(o, oc);
    }
    ingOptions.set(ing.id, { foods: seen, optional: !!ing.optional });
  }

  // method: list of steps; a step is text or {text, only_if: {ingredient: food|"none"}}.
  if (r.method !== undefined) {
    if (!Array.isArray(r.method)) fail(`${ctx}: method must be a list of steps`);
    for (const [i, step] of (Array.isArray(r.method) ? r.method : []).entries()) {
      const mc = `${ctx}.method[${i}]`;
      const isObj = step && typeof step === "object";
      const text = isObj ? step.text : step;
      if (typeof text !== "string" || !text.trim()) {
        fail(`${mc}: step needs text`);
        continue;
      }
      if (isObj) {
        for (const k of Object.keys(step)) if (k !== "text" && k !== "only_if") fail(`${mc}: unknown field "${k}"`);
        for (const [ingId, val] of Object.entries(step.only_if || {})) {
          const info = ingOptions.get(ingId);
          if (!info) fail(`${mc}.only_if: unknown ingredient "${ingId}"`);
          else if (val === "none" ? !info.optional : !info.foods.has(val)) fail(`${mc}.only_if: "${val}" is not a choice for ingredient "${ingId}"`);
        }
      }
      for (const tok of text.match(/\{\{[^}]*\}\}/g) || []) {
        const m = /^\{\{food:([a-z0-9-]+)\}\}$/.exec(tok);
        if (!m) fail(`${mc}: unknown token ${tok} (only {{food:<ingredient-id>}} is allowed)`);
        else if (!ingOptions.has(m[1])) fail(`${mc}: token ${tok} names an unknown ingredient`);
      }
    }
  }
  if (r.notes !== undefined && !Array.isArray(r.notes)) fail(`${ctx}: notes must be a list`);
}

if (!errors.length) deriveComposites();

if (errors.length) {
  console.error(`Validation failed (${[...new Set(errors)].length} error(s)):`);
  for (const e of new Set(errors)) console.error(`  - ${e}`);
  process.exit(1);
}

// ---- normalize recipes: apply ingredient-level defaults to every option ----
function normalizeRecipe(r) {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary || "",
    servings: r.servings,
    total_minutes: r.total_minutes,
    cookware: r.cookware || [],
    method: r.method || [],
    notes: r.notes || [],
    ingredients: r.ingredients.map((ing) => ({
      id: ing.id,
      label: ing.label || ing.id,
      optional: !!ing.optional,
      options: (ing.options ?? [{ food: ing.food }]).map((o) => ({
        food: o.food,
        amount: o.amount ?? ing.amount,
        unit: o.unit ?? ing.unit,
        prep_minutes: o.prep_minutes ?? ing.prep_minutes ?? 0,
        cook_minutes: o.cook_minutes ?? ing.cook_minutes ?? 0,
        cookware: [...(ing.cookware || []), ...(o.cookware || [])],
        seasonings: [...(ing.seasonings || []), ...(o.seasonings || [])],
      })),
    })),
  };
}

const strip = ({ __file, ...rest }) => rest;
const data = {
  food: Object.fromEntries(Object.entries(food).map(([k, v]) => [k, strip(v)])),
  cookware: Object.fromEntries(Object.entries(cookware).map(([k, v]) => [k, strip(v)])),
};
const norm = Object.values(recipes).map(normalizeRecipe).sort((a, b) => a.title.localeCompare(b.title));

// ---- where is each item used? (so unused catalog entries are visible) ----
const foodUsedIn = {};
const cookwareUsedIn = {};
{
  const addFood = (id, title) => {
    (foodUsedIn[id] ||= new Set()).add(title);
    for (const c of food[id].made_from || []) addFood(c.food, title);
  };
  const addRef = (ref, title) => {
    for (const c of Object.values(cookware)) {
      const hit = ref.startsWith("category:") ? c.category === ref.slice(9) : ref.startsWith("tag:") ? (c.tags || []).includes(ref.slice(4)) : c.id === ref;
      if (hit) (cookwareUsedIn[c.id] ||= new Set()).add(title);
    }
  };
  for (const r of norm) {
    r.cookware.forEach((ref) => addRef(ref, r.title));
    for (const ing of r.ingredients)
      for (const o of ing.options) {
        addFood(o.food, r.title);
        o.seasonings.forEach((s) => addFood(s.food, r.title));
        o.cookware.forEach((ref) => addRef(ref, r.title));
      }
  }
}

// =====================================================================
// Output
// =====================================================================

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const write = (name, text) => fs.writeFileSync(path.join(OUT, name), text, "utf8");

// The browser runs the same logic as Node: shared.mjs with `export` stripped.
write("shared.js", fs.readFileSync(path.join(ROOT, "shared.mjs"), "utf8").replace(/^export /gm, ""));
write("data.js", `const DATA = ${JSON.stringify(data)};\nconst RECIPES = ${JSON.stringify(norm)};\n`);
for (const f of fs.readdirSync(path.join(ROOT, "web"))) fs.copyFileSync(path.join(ROOT, "web", f), path.join(OUT, f));

function page(filename, title, body, scripts = [], wide = false) {
  const tags = ["data.js", "shared.js", "common.js", ...scripts].map((s) => `<script src="${s}"></script>`).join("\n");
  write(
    filename,
    `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#161616" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Recipes">
<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="icon.svg">
<title>${esc(title)}</title><link rel="stylesheet" href="style.css"></head>
<body${wide ? ' class="wide"' : ""}>
<nav><a href="index.html">Recipes</a><a href="catalog.html">Catalog</a></nav>
<div id="ovbanner" class="banner" hidden></div>
${body}
${tags}
</body></html>
`
  );
}

// ---- Recipe list ----
{
  const foodsUsed = new Set();
  for (const r of norm) for (const ing of r.ingredients) for (const o of ing.options) [o.food, ...o.seasonings.map((s) => s.food)].forEach((f) => foodsUsed.add(f));
  const chip = (id) => `<button type="button" class="chip-btn" data-id="${id}" data-name="${esc(shortName(data.food[id]))}" data-state="off">${esc(shortName(data.food[id]))}</button>`;
  const sorted = [...foodsUsed].sort((a, b) => shortName(data.food[a]).localeCompare(shortName(data.food[b])));
  const main = sorted.filter((id) => MAIN_FOOD_CATEGORIES.has(data.food[id].category));
  const basics = sorted.filter((id) => !MAIN_FOOD_CATEGORIES.has(data.food[id].category));
  const cards = norm.map((r) => cardHtml(data, recipeModel(data, r), [])).join("\n");
  page(
    "index.html",
    "Recipes",
    `<h1>Recipes</h1>
<div class="controls">
  <label>Sort <select id="sort">
    <option value="title">Name</option>
    <option value="cost">Cost / serving</option>
    <option value="costPer100">Cost per 100 kcal</option>
    <option value="calories">Calories / serving</option>
    <option value="protein">Protein / serving</option>
    <option value="proteinPerDollar">Protein per dollar</option>
    <option value="time">Time</option>
  </select></label>
  <button type="button" id="dir" aria-label="Toggle sort direction"></button>
  <label><input type="checkbox" id="makeable"> Hide recipes I can't make</label>
</div>
<details class="filters" id="filters" open><summary id="filtersum">Filter by ingredient</summary>
  <p class="meta">Tap an ingredient once to include it (✓), twice to exclude it (✕). Recipes show the numbers for the swaps that match.</p>
  <div class="controls">
    <input type="search" id="chipsearch" placeholder="Search ingredients" aria-label="Search ingredients">
    <label>Match <select id="any"><option value="all">all included</option><option value="any">any included</option></select></label>
    <button type="button" id="clearfilters">Clear filters</button>
  </div>
  <div class="chips" id="chips-main">${main.map(chip).join("")}</div>
  <details><summary>Seasonings and basics (${basics.length})</summary><div class="chips" id="chips-basics">${basics.map(chip).join("")}</div></details>
</details>
<p class="meta" id="count" aria-live="polite"></p>
<p class="meta">Values are per serving. Open a recipe to see which prices and nutrition values are estimates.</p>
<div id="list">${cards}</div>
<section id="shopping" hidden>
  <h2>Shopping list</h2>
  <div id="shoplist"></div>
  <div class="controls"><button type="button" id="copylist">Copy as text</button><button type="button" id="clearlist">Clear list</button><span class="meta" id="copied" aria-live="polite"></span></div>
</section>
<a id="listbar" class="bottombar" href="#shopping" hidden></a>`,
    ["index.js"]
  );
}

// ---- Recipe pages ----
for (const r of norm) {
  const sel = defaultSelection(r);
  page(
    `recipe-${r.id}.html`,
    r.title,
    `<main data-recipe="${r.id}">
<h1>${esc(r.title)}</h1>
<p class="meta">${esc(r.summary)}</p>
<section class="swap-box">
  <h2>Swap and scale</h2>
  <div id="pickers">${pickersHtml(data, r, sel)}</div>
  <div class="pick"><label for="servings">Servings</label><input id="servings" type="number" min="1" step="1" value="${r.servings}"></div>
  <button type="button" id="reset">Reset to defaults</button>
</section>
<div id="detail">${detailHtml(data, r, sel)}</div>
<div id="minibar" class="bottombar" role="status" aria-live="polite" hidden></div>
</main>`,
    ["recipe.js"]
  );
}

// ---- Catalog ----
{
  const th = (label, type) => `<th scope="col" data-type="${type}" tabindex="0" role="button" aria-label="Sort by ${esc(label)}">${label}</th>`;
  const unusedBadge = (set) => (set && set.size ? `${set.size}` : `<span class="badge no">unused</span>`);
  const usedTitle = (set) => (set ? esc([...set].join(", ")) : "");

  const recipeRows = norm.map((r) => {
    const m = recipeModel(data, r);
    const p = m.res.perServing;
    return `<tr><td data-v="${esc(r.title)}"><a href="recipe-${r.id}.html">${esc(r.title)}</a></td><td data-v="${p.cost}">${fmtCost(p.cost)}</td><td data-v="${p.calories}">${Math.round(p.calories)}</td><td data-v="${p.protein}">${Math.round(p.protein)} g</td><td data-v="${m.res.time}">${fmtNum(m.res.time)} min</td><td class="status-cell" data-status="${r.id}">${statusBadge(m.sug)}</td></tr>`;
  });

  const foodRows = Object.values(data.food)
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .map((f) => {
      const est = (k) => ((f.estimated || []).includes(k) ? "~" : "");
      const ownedCell = f.made_from
        ? `<span class="derived-owned" data-id="${f.id}">${ownedBadge(false)}</span> <span class="meta">derived</span>`
        : `<label class="owned-toggle-label"><input type="checkbox" class="owned-toggle" data-id="${f.id}"${f.owned ? " checked" : ""}> <span class="owned-text">${f.owned ? "owned" : "not owned"}</span></label>`;
      return `<tr data-cat="${f.category}" data-search="${esc((f.display_name + " " + (f.brand || "") + " " + f.category).toLowerCase())}">
<td data-v="${esc(f.display_name)}"><strong>${esc(f.display_name)}</strong>${f.brand ? ` <span class="brand">${esc(f.brand)}</span>` : ""}${f.made_from ? ` <span class="chip chip-opt">homemade</span>` : ""}</td>
<td data-v="${f.category}">${f.category}</td>
<td data-v="${f.owned ? 1 : 0}">${ownedCell}</td>
<td>${esc(f.package ? est("package") + fmtPackage(f) : "—")}</td>
<td data-v="${f.cost_per_unit ? f.cost_per_unit.amount : -1}">${f.cost_per_unit ? `${est("cost_per_unit")}${fmtRate(f.cost_per_unit.amount)}/${unitLabel(f.cost_per_unit.unit, f)}` : "—"}</td>
<td>${f.nutrition ? est("nutrition") + esc(fmtNutrition(f.nutrition, f)) : "—"}</td>
<td data-v="${foodUsedIn[f.id] ? foodUsedIn[f.id].size : 0}" title="${usedTitle(foodUsedIn[f.id])}">${unusedBadge(foodUsedIn[f.id])}</td></tr>`;
    });

  const cwRows = Object.values(data.cookware)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (c) => `<tr data-cat="${c.category}" data-search="${esc((c.name + " " + c.category + " " + (c.tags || []).join(" ")).toLowerCase())}">
<td data-v="${esc(c.name)}"><strong>${esc(c.name)}</strong></td><td data-v="${c.category}">${c.category}</td>
<td data-v="${c.owned ? 1 : 0}"><label class="owned-toggle-label"><input type="checkbox" class="owned-toggle" data-id="${c.id}"${c.owned ? " checked" : ""}> <span class="owned-text">${c.owned ? "owned" : "not owned"}</span></label></td>
<td>${esc(c.size || "—")}</td><td>${esc((c.tags || []).join(", ") || "—")}</td>
<td data-v="${cookwareUsedIn[c.id] ? cookwareUsedIn[c.id].size : 0}" title="${usedTitle(cookwareUsedIn[c.id])}">${unusedBadge(cookwareUsedIn[c.id])}</td></tr>`
    );

  const catOptions = (list) => `<option value="">All categories</option>${list.map((c) => `<option>${c}</option>`).join("")}`;
  const tools = (table, cats) =>
    `<div class="controls"><input type="search" class="tfilter" data-table="${table}" placeholder="Search" aria-label="Search ${table}"><select class="catfilter" data-table="${table}" aria-label="Category">${catOptions(cats)}</select></div>`;

  page(
    "catalog.html",
    "Catalog",
    `<h1>Catalog</h1>
<p class="meta">Tick "owned" to try a what-if on this device (kept in this browser only, never written to your YAML). To make a change permanent, edit the YAML file or use the generator at the bottom. Click a column heading to sort. A ~ marks an estimate.</p>
<h2>Recipes</h2>
<div class="scroll"><table id="t-recipes" data-sortable><thead><tr>${th("Recipe", "text")}${th("Cost/serving", "num")}${th("kcal/serving", "num")}${th("Protein/serving", "num")}${th("Time", "num")}${th("Status", "text")}</tr></thead><tbody>${recipeRows.join("")}</tbody></table></div>
<h2>Food</h2>${tools("t-food", FOOD_CATEGORIES)}
<div class="scroll"><table id="t-food" data-sortable><thead><tr>${th("Food", "text")}${th("Category", "text")}${th("Owned", "num")}${th("Package", "text")}${th("Price", "num")}${th("Nutrition", "text")}${th("Used in", "num")}</tr></thead><tbody>${foodRows.join("")}</tbody></table></div>
<h2>Cookware</h2>${tools("t-cookware", COOKWARE_CATEGORIES)}
<div class="scroll"><table id="t-cookware" data-sortable><thead><tr>${th("Item", "text")}${th("Category", "text")}${th("Owned", "num")}${th("Size", "text")}${th("Tags", "text")}${th("Used in", "num")}</tr></thead><tbody>${cwRows.join("")}</tbody></table></div>
<details class="generator"><summary>Add a new item (generates YAML)</summary>
  <p class="meta">Fills in a YAML file for you to save in the repo, then run the build.</p>
  <div id="gen" data-food-cats="${FOOD_CATEGORIES.join(",")}" data-cookware-cats="${COOKWARE_CATEGORIES.join(",")}" data-units="${[...UNITS].join(",")}"></div>
</details>`,
    ["catalog.js"],
    true
  );
}

console.log(`Built ${norm.length} recipe(s), ${Object.keys(food).length} food item(s), ${Object.keys(cookware).length} cookware item(s) -> _site/`);
