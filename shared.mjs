// Logic shared by build.js (Node) and the browser. The build emits this file to
// _site/shared.js with the `export` keywords stripped, so keep it free of imports
// and Node APIs. Everything here is a pure function of its arguments.
//
// data      = { food: {id: foodItem}, cookware: {id: cookwareItem} }
// recipe    = normalized recipe (see normalizeRecipe in build.js)
// selection = { [ingredientId]: foodId | null }  -- missing keys use the default

export const UNIT_FAMILIES = {
  pinch: { family: "volume", perMl: 0.308058 }, // 1/16 tsp
  tsp: { family: "volume", perMl: 4.92892 },
  tbsp: { family: "volume", perMl: 14.7868 },
  cup: { family: "volume", perMl: 236.588 },
  qt: { family: "volume", perMl: 946.353 },
  ml: { family: "volume", perMl: 1 },
  l: { family: "volume", perMl: 1000 },
  oz: { family: "weight", perGram: 28.3495 },
  lb: { family: "weight", perGram: 453.592 },
  g: { family: "weight", perGram: 1 },
  kg: { family: "weight", perGram: 1000 },
  unit: { family: "count", perGram: 1 },
};

// Converts within a family only (volume never converts to weight: no densities).
export function convertUnit(amount, fromUnit, toUnit) {
  if (fromUnit === toUnit) return amount;
  const from = UNIT_FAMILIES[fromUnit];
  const to = UNIT_FAMILIES[toUnit];
  if (!from || !to || from.family !== to.family || from.family === "count") return null;
  const base = from.family === "volume" ? "perMl" : "perGram";
  return (amount * from[base]) / to[base];
}

// ---------------------------------------------------------------- formatting

export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

const FRACTIONS = [[1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"]];
const FRACTION_UNITS = new Set(["tsp", "tbsp", "cup", "qt", "pinch"]);
const PLURAL_UNITS = { pinch: "pinches" };

export function fmtAmount(amount, unit) {
  if (FRACTION_UNITS.has(unit)) {
    const whole = Math.floor(amount + 1e-9);
    const frac = amount - whole;
    if (frac < 0.01) return String(whole);
    for (const [v, ch] of FRACTIONS) if (Math.abs(frac - v) < 0.012) return (whole || "") + ch;
  }
  return fmtNum(amount);
}

// "4 eggs", "1/4 tsp", "2 pinches", "1.3 lb". `food` supplies count_label for the count unit.
export function fmtQty(amount, unit, food) {
  if (unit === "unit") {
    const l = food && food.count_label;
    const label = l ? (Math.abs(amount - 1) < 1e-9 ? l.one : l.other) : "unit";
    return `${fmtNum(amount)} ${label}`;
  }
  const u = amount > 1.0001 && PLURAL_UNITS[unit] ? PLURAL_UNITS[unit] : unit;
  return `${fmtAmount(amount, unit)} ${u}`;
}

// Totals read better in the bigger spoon or cup (6.84 tsp -> 2¼ tbsp), rounded to an eighth.
export function fmtTotal(amount, unit, food) {
  let a = amount;
  let u = unit;
  if (u === "pinch" && a >= 16) { a /= 16; u = "tsp"; }
  if (u === "tsp" && a >= 3) { a /= 3; u = "tbsp"; }
  if (u === "tbsp" && a >= 4) { a /= 16; u = "cup"; }
  if (FRACTION_UNITS.has(u)) a = Math.round(a * 8) / 8;
  return fmtQty(a, u, food);
}

export function fmtCost(amount) {
  return `$${amount.toFixed(2)}`;
}

// Per-unit prices keep their third decimal ($0.249/oz), unlike totals.
export function fmtRate(amount) {
  const s = amount.toFixed(3);
  return `$${s.endsWith("0") ? s.slice(0, -1) : s}`;
}

function fmtSigned(n, f) {
  return `${n < 0 ? "-" : "+"}${f(Math.abs(n))}`;
}

// "unit" reads as the food's own noun (egg, slice) when it has a count_label.
export function unitLabel(unit, food) {
  return unit === "unit" && food && food.count_label ? food.count_label.one : unit;
}

export function fmtNutrition(n, food) {
  if (!n) return "—";
  const parts = [`${fmtNum(n.calories)} kcal`, `${fmtNum(n.protein_g)} g protein`];
  if (n.fat_g !== undefined) parts.push(`${fmtNum(n.fat_g)} g fat`);
  if (n.carbs_g !== undefined) parts.push(`${fmtNum(n.carbs_g)} g carbs`);
  return `${parts.join(" · ")} per ${unitLabel(n.unit, food)}`;
}

export function fmtPackage(f) {
  if (!f.package) return "—";
  const eq = f.package.equals;
  return fmtQty(f.package.amount, f.package.unit, f) + (eq ? ` (≈ ${fmtQty(eq.amount, eq.unit, f)})` : "");
}

// The package, expressed in a unit family that can measure every one of `units`
// and that can be priced (a package may carry an `equals` in the other family, e.g. 2.5 oz ≈ 31 tsp).
export function packageFor(f, units) {
  if (!f.package || !f.cost_per_unit) return null;
  for (const p of [f.package, f.package.equals]) {
    if (!p) continue;
    if (convertUnit(1, p.unit, f.cost_per_unit.unit) === null) continue;
    if (units.every((u) => convertUnit(1, u, p.unit) !== null)) return p;
  }
  return null;
}

// "Ground Beef (91/9)" -> "Ground Beef"
export function shortName(f) {
  return f.display_name.replace(/\s*\([^)]*\)/g, "").trim();
}

// ----------------------------------------------------------------- ownership

export function isOwned(data, id) {
  const f = data.food[id];
  if (f.made_from) return f.made_from.every((c) => isOwned(data, c.food));
  return !!f.owned;
}

// overrides = { [id]: boolean }, kept in the browser only (never written to YAML).
export function applyOverrides(data, overrides) {
  for (const [id, owned] of Object.entries(overrides || {})) {
    if (data.food[id] && !data.food[id].made_from) data.food[id].owned = owned;
    else if (data.cookware[id]) data.cookware[id].owned = owned;
  }
}

export function refMatches(ref, cw) {
  if (ref.startsWith("category:")) return cw.category === ref.slice(9);
  if (ref.startsWith("tag:")) return (cw.tags || []).includes(ref.slice(4));
  return ref === cw.id;
}

function refOwned(data, ref) {
  return Object.values(data.cookware).some((c) => c.owned && refMatches(ref, c));
}

function refName(data, ref) {
  if (ref.startsWith("category:")) return `any ${ref.slice(9)}`;
  if (ref.startsWith("tag:")) return `any ${ref.slice(4)}`;
  const c = data.cookware[ref];
  return c ? c.short_name || c.name : ref;
}

// ----------------------------------------------------------------- selection

export function defaultFood(ing) {
  return ing.optional ? null : ing.options[0].food;
}

export function defaultSelection(recipe) {
  const sel = {};
  for (const ing of recipe.ingredients) sel[ing.id] = defaultFood(ing);
  return sel;
}

function chosen(ing, selection) {
  return ing.id in selection ? selection[ing.id] : defaultFood(ing);
}

export function isSwappable(ing) {
  return ing.options.length > 1 || ing.optional;
}

// ------------------------------------------------------------------- resolve

export function rate(amount, unit, perAmount, perUnit) {
  if (perAmount === undefined) return null;
  const converted = convertUnit(amount, unit, perUnit);
  return converted === null ? null : converted * perAmount;
}

const MACROS = [["calories", "calories"], ["protein", "protein_g"], ["fat", "fat_g"], ["carbs", "carbs_g"]];

export function resolve(data, recipe, selection, scale = 1) {
  const usages = [];
  const refs = new Set(recipe.cookware);
  let prep = 0;
  let cook = 0;

  for (const ing of recipe.ingredients) {
    const foodId = chosen(ing, selection);
    if (foodId === null || foodId === undefined) continue;
    const opt = ing.options.find((o) => o.food === foodId);
    if (!opt) continue;
    usages.push({ food: opt.food, amount: opt.amount * scale, unit: opt.unit, ing, kind: "main" });
    for (const s of opt.seasonings) usages.push({ food: s.food, amount: s.amount * scale, unit: s.unit, ing, kind: "seasoning" });
    for (const r of opt.cookware) refs.add(r);
    prep += opt.prep_minutes || 0;
    cook = Math.max(cook, opt.cook_minutes || 0);
  }

  const byFood = new Map();
  for (const u of usages) {
    if (!byFood.has(u.food)) byFood.set(u.food, []);
    byFood.get(u.food).push(u);
  }

  const totals = { cost: 0, costPartial: false, purchase: 0, purchasePartial: false, proRataInPurchase: 0 };
  for (const [k] of MACROS) {
    totals[k] = 0;
    totals[k + "Partial"] = false;
  }
  const lines = [];
  const short = [];

  for (const [foodId, list] of byFood) {
    const f = data.food[foodId];
    const first = list[0];
    const line = { food: f, usages: list, total: null, cost: 0, costPartial: false, nutrition: {}, roles: [], swappable: false, optional: false, buy: null };
    for (const [k] of MACROS) line.nutrition[k] = 0;

    let sum = 0;
    for (const u of list) {
      const v = convertUnit(u.amount, u.unit, first.unit);
      if (v === null) {
        sum = null;
        break;
      }
      sum += v;
    }
    if (sum !== null) line.total = { amount: sum, unit: first.unit };

    for (const u of list) {
      const c = f.cost_per_unit ? rate(u.amount, u.unit, f.cost_per_unit.amount, f.cost_per_unit.unit) : null;
      if (c === null) line.costPartial = true;
      else line.cost += c;
      const factor = f.nutrition ? convertUnit(u.amount, u.unit, f.nutrition.unit) : null;
      for (const [k, field] of MACROS) {
        if (factor === null || f.nutrition[field] === undefined) totals[k + "Partial"] = true;
        else line.nutrition[k] += factor * f.nutrition[field];
      }
      if (!line.roles.includes(u.ing.label)) line.roles.push(u.ing.label);
      if (u.kind === "main" && isSwappable(u.ing)) {
        if (u.ing.optional) line.optional = true;
        if (u.ing.options.length > 1) line.swappable = true;
      }
    }
    totals.cost += line.cost;
    totals.costPartial ||= line.costPartial;
    for (const [k] of MACROS) totals[k] += line.nutrition[k];

    // Full packages: what you would actually pay at the register for this much.
    const pk = packageFor(f, list.map((u) => u.unit));
    if (pk) {
      const need = list.reduce((s, u) => s + convertUnit(u.amount, u.unit, pk.unit), 0);
      const pkgPrice = rate(pk.amount, pk.unit, f.cost_per_unit.amount, f.cost_per_unit.unit);
      if (pkgPrice !== null) {
        const n = Math.max(1, Math.ceil(need / pk.amount - 1e-9));
        line.buy = { n, cost: n * pkgPrice };
      }
    }
    if (line.buy) totals.purchase += line.buy.cost;
    else {
      totals.purchase += line.cost;
      totals.proRataInPurchase++;
      totals.purchasePartial ||= line.costPartial;
    }

    if (f.on_hand && line.total) {
      const have = convertUnit(f.on_hand.amount, f.on_hand.unit, line.total.unit);
      if (have !== null && line.total.amount > have + 1e-9) {
        short.push(`${shortName(f)} (need ${fmtQty(line.total.amount, line.total.unit, f)}, have ${fmtQty(have, line.total.unit, f)})`);
      }
    }
    lines.push(line);
  }

  const all = [...refs];
  const concrete = all.filter((r) => !r.includes(":"));
  const cookwareLines = [];
  for (const ref of all) {
    if (ref.includes(":") && concrete.some((id) => refMatches(ref, data.cookware[id]))) continue;
    cookwareLines.push({ ref, name: refName(data, ref), owned: refOwned(data, ref), notes: ref.includes(":") ? [] : data.cookware[ref].notes || [] });
  }

  const missing = [
    ...lines.filter((l) => !isOwned(data, l.food.id)).map((l) => shortName(l.food)),
    ...cookwareLines.filter((c) => !c.owned).map((c) => c.name),
    ...short,
  ];

  const itemNotes = [];
  const seen = new Set(recipe.notes);
  for (const [name, text] of [
    ...lines.flatMap((l) => (l.food.notes || []).map((n) => [shortName(l.food), n])),
    ...cookwareLines.flatMap((c) => c.notes.map((n) => [c.name, n])),
  ]) {
    if (!seen.has(text)) {
      seen.add(text);
      itemNotes.push({ name, text });
    }
  }

  const servings = recipe.servings * scale;
  const per = {};
  for (const k of ["cost", "purchase", ...MACROS.map(([k]) => k)]) per[k] = totals[k] / servings;
  return {
    lines,
    cookware: cookwareLines,
    notes: recipe.notes,
    itemNotes,
    missing,
    makeable: missing.length === 0,
    prep,
    cook,
    time: recipe.total_minutes !== undefined ? recipe.total_minutes : prep + cook,
    timeIsEstimate: recipe.total_minutes === undefined,
    totals,
    servings,
    perServing: per,
    estimatedCost: lines.filter((l) => (l.food.estimated || []).includes("cost_per_unit")).map((l) => shortName(l.food)),
    estimatedNutrition: lines.filter((l) => (l.food.estimated || []).includes("nutrition")).map((l) => shortName(l.food)),
  };
}

// ------------------------------------------------- availability and fix hints

function optionFeasible(data, o) {
  return isOwned(data, o.food) && o.seasonings.every((s) => isOwned(data, s.food)) && o.cookware.every((r) => refOwned(data, r));
}

// status: "now" | "swap" (fixable by choosing other options) | "blocked".
export function suggest(data, recipe, selection) {
  const res = resolve(data, recipe, selection);
  if (res.makeable) return { status: "now", fixes: [], blockers: [], res };
  const fixes = [];
  const blockers = recipe.cookware.filter((r) => !refOwned(data, r)).map((r) => refName(data, r));
  for (const ing of recipe.ingredients) {
    const cur = chosen(ing, selection);
    if (cur === null || cur === undefined) continue;
    const curOpt = ing.options.find((o) => o.food === cur);
    if (!curOpt || optionFeasible(data, curOpt)) continue;
    const alt = ing.options.find((o) => optionFeasible(data, o));
    if (alt) fixes.push({ ing: ing.id, label: ing.label, food: alt.food });
    else if (ing.optional) fixes.push({ ing: ing.id, label: ing.label, food: null });
    else {
      const names = [curOpt.food, ...curOpt.seasonings.map((s) => s.food)].filter((id) => !isOwned(data, id)).map((id) => shortName(data.food[id]));
      blockers.push(...names, ...curOpt.cookware.filter((r) => !refOwned(data, r)).map((r) => refName(data, r)));
    }
  }
  if (!fixes.length && !blockers.length) blockers.push(...res.missing);
  return { status: blockers.length ? "blocked" : "swap", fixes, blockers: [...new Set(blockers)], res };
}

export function availability(data, recipe) {
  return suggest(data, recipe, defaultSelection(recipe)).status;
}

export function applyFixes(selection, fixes) {
  const next = { ...selection };
  for (const f of fixes) next[f.ing] = f.food;
  return next;
}

// ------------------------------------------------------------------- method

export function methodSteps(data, recipe, selection) {
  const sel = (id) => {
    const ing = recipe.ingredients.find((i) => i.id === id);
    return ing ? chosen(ing, selection) : null;
  };
  const steps = [];
  for (const step of recipe.method) {
    const text = typeof step === "string" ? step : step.text;
    const cond = typeof step === "string" ? null : step.only_if;
    if (cond && !Object.entries(cond).every(([ing, val]) => (val === "none" ? sel(ing) === null : sel(ing) === val))) continue;
    steps.push(
      text.replace(/\{\{food:([a-z0-9-]+)\}\}/g, (_, id) => {
        const cur = sel(id);
        return cur ? shortName(data.food[cur]).toLowerCase() : "";
      })
    );
  }
  return steps;
}

// ------------------------------------------------------------------- pickers

// Options for one ingredient's dropdown, each labelled with its effect on the
// price and calories per serving relative to what is selected now.
export function pickerOptions(data, recipe, selection, ing) {
  const base = resolve(data, recipe, selection);
  const cur = chosen(ing, selection);
  const entries = [...(ing.optional ? [{ food: null }] : []), ...ing.options.map((o) => ({ food: o.food }))];
  return entries.map(({ food }) => {
    const r = resolve(data, recipe, { ...selection, [ing.id]: food });
    const name = food === null ? "None" : shortName(data.food[food]) + (isOwned(data, food) ? "" : " (not owned)");
    const dc = r.perServing.cost - base.perServing.cost;
    const dk = r.perServing.calories - base.perServing.calories;
    const delta = food === cur ? "" : Math.abs(dc) < 0.005 && Math.abs(dk) < 0.5 ? " · no change" : ` · ${fmtSigned(dc, fmtCost)} · ${fmtSigned(Math.round(dk), (x) => x)} kcal`;
    return { value: food === null ? "" : food, label: name + delta, selected: food === cur };
  });
}

export function pickersHtml(data, recipe, selection) {
  return recipe.ingredients
    .filter(isSwappable)
    .map((ing) => {
      const list = pickerOptions(data, recipe, selection, ing);
      const opts = list.map((o) => `<option value="${esc(o.value)}"${o.selected ? " selected" : ""}>${esc(o.label)}</option>`).join("");
      // Optional ingredients: say what the other choices do without opening the menu.
      const hint = ing.optional
        ? `<div class="pick-hint meta">${list.filter((o) => !o.selected).map((o) => esc(o.label)).join(" · or ")} (per serving)</div>`
        : "";
      return `<div class="pick"><label for="pick-${ing.id}">${esc(ing.label)}${ing.optional ? ' <span class="meta">(optional)</span>' : ""}</label><div><select id="pick-${ing.id}" data-ing="${ing.id}">${opts}</select>${hint}</div></div>`;
    })
    .join("");
}

// ------------------------------------------------------------------- html bits

export function ownedBadge(owned) {
  return owned ? `<span class="badge ok">✓ owned</span>` : `<span class="badge no">✗ not owned</span>`;
}

export function statusBadge(sug) {
  if (sug.status === "now") return `<span class="badge ok">✓ Makeable now</span>`;
  if (sug.status === "swap") return `<span class="badge swap">↔ Makeable with swaps</span>`;
  return `<span class="badge no">✗ Missing items</span>`;
}

function statusDetail(data, recipe, sug) {
  if (sug.status === "swap") {
    const swaps = sug.fixes.map((f) => `${esc(f.label)} → ${f.food ? esc(shortName(data.food[f.food])) : "none"}`).join(", ");
    return `Swap needed: ${swaps}`;
  }
  if (sug.status === "blocked") {
    const names = sug.blockers.slice(0, 3).map(esc).join(", ");
    return `Missing: ${names}${sug.blockers.length > 3 ? ` +${sug.blockers.length - 3} more` : ""}`;
  }
  return "";
}

function tile(label, value, cls = "") {
  return `<div class="stat ${cls}"><span class="stat-v">${value}</span><span class="stat-l">${label}</span></div>`;
}

const ge = (partial) => (partial ? "≥ " : "");
const plural = (n, one, other) => `${fmtNum(n)} ${n === 1 ? one : other}`;

// The part of a recipe page that changes with the selection.
export function detailHtml(data, recipe, selection, scale = 1) {
  const r = resolve(data, recipe, selection, scale);
  const t = r.totals;
  const p = r.perServing;
  const sug = suggest(data, recipe, selection);

  const macro = (k, label, unit) => tile(label, `${t[k + "Partial"] ? "≥ " : ""}${Math.round(p[k])}${unit}`);
  const stats = `<div class="stats">
  ${tile("cost / serving", `${ge(t.costPartial)}${fmtCost(p.cost)}`, "stat-main")}
  ${macro("calories", "calories", "")}
  ${macro("protein", "protein", " g")}
  ${macro("fat", "fat", " g")}
  ${macro("carbs", "carbs", " g")}
</div>`;

  const prepCook = [r.prep ? `prep ${fmtNum(r.prep)}` : "", r.cook ? `longest cook ${fmtNum(r.cook)}` : ""].filter(Boolean).join(" + ");
  const timeText = r.timeIsEstimate
    ? `<span title="Estimate: prep minutes are summed and cook time is the longest item, so steps that overlap are counted twice. A recipe can set total_minutes to override.">about ${fmtNum(r.time)} min (${prepCook})</span>`
    : `${fmtNum(r.time)} min`;
  const buy = r.totals.purchase;
  const summary = `<p class="meta">Total ${ge(t.costPartial)}${fmtCost(t.cost)} for ${plural(r.servings, "serving", "servings")} · ${timeText}</p>
<p class="meta">Buying everything in full packages (every jar and bag, owned or not): ${ge(r.totals.purchasePartial)}${fmtCost(buy)}${r.totals.proRataInPurchase ? ` (${r.totals.proRataInPurchase} item${r.totals.proRataInPurchase === 1 ? "" : "s"} without a package size counted pro-rata)` : ""}</p>
${
  r.estimatedCost.length || r.estimatedNutrition.length
    ? `<p class="meta est-note">~ marks estimates. Estimated prices: ${r.estimatedCost.length} of ${r.lines.length} ingredients${r.estimatedCost.length ? ` (${r.estimatedCost.slice(0, 5).map(esc).join(", ")}${r.estimatedCost.length > 5 ? ` +${r.estimatedCost.length - 5} more` : ""})` : ""}. Nutrition: all values are estimates, not label data.</p>`
    : ""
}`;

  const banner =
    sug.status === "now"
      ? `<div class="status ok">${statusBadge(sug)} with this selection.</div>`
      : `<div class="status ${sug.status === "swap" ? "swap" : "no"}">${statusBadge(sug)} ${statusDetail(data, recipe, sug)}${
          sug.status === "swap" ? ` <button type="button" id="applyfix">Apply these swaps</button>` : ""
        }</div>`;

  const ingredients = r.lines
    .map((l) => {
      const f = l.food;
      const owned = isOwned(data, f.id);
      const est = (f.estimated || []).includes("cost_per_unit");
      const qty = l.usages.map((u) => fmtQty(u.amount, u.unit, f)).join(" + ");
      const total = l.usages.length > 1 && l.total ? ` = ${fmtTotal(l.total.amount, l.total.unit, f)}` : "";
      const cost = f.cost_per_unit ? `${l.costPartial ? "≥ " : ""}${est ? "~" : ""}${fmtCost(l.cost)}` : "no price";
      const n = l.nutrition;
      const nutEst = (f.estimated || []).includes("nutrition") ? "~" : "";
      const nut = Math.round(n.calories) >= 1 || Math.round(n.protein) >= 1 ? `${nutEst}${Math.round(n.calories)} kcal · ${nutEst}${Math.round(n.protein)} g protein` : "";
      const chips = [
        l.swappable ? `<span class="chip chip-swap">swappable</span>` : "",
        l.optional ? `<span class="chip chip-opt">optional</span>` : "",
        est ? `<span class="chip chip-est" title="This price is an estimate">est. price</span>` : "",
      ].join("");
      const buyText = l.buy ? ` · buy ${l.buy.n} × ${fmtPackage(f)} = ${fmtCost(l.buy.cost)}` : "";
      return `<li class="ing${owned ? "" : " unowned"}"><div class="ing-main">${ownedBadge(owned)} <strong>${esc(f.display_name)}</strong>${f.brand ? ` <span class="brand">${esc(f.brand)}</span>` : ""} <span class="qty">${esc(qty + total)}</span> ${chips}<span class="cost">${cost}</span></div><div class="meta">for ${l.roles.map(esc).join(", ")}${nut ? ` · ${nut}` : ""}${buyText}</div></li>`;
    })
    .join("");

  const cookware = r.cookware.map((c) => `<li>${ownedBadge(c.owned)} ${esc(c.name)}</li>`).join("");

  const method = methodSteps(data, recipe, selection);
  const methodHtml = method.length ? `<h2>Method</h2><ol class="method">${method.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : "";

  const notesHtml =
    r.notes.length || r.itemNotes.length
      ? `<h2>Notes</h2>${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}${
          r.itemNotes.length
            ? `<h3>Care and ingredient notes</h3><ul>${r.itemNotes.map((n) => `<li><strong>${esc(n.name)}:</strong> ${esc(n.text)}</li>`).join("")}</ul>`
            : ""
        }`
      : "";

  return `${stats}${summary}${banner}
<h2>Ingredients</h2>
<ul class="plain">${ingredients}</ul>
<h2>Cookware</h2>
<ul class="plain">${cookware || '<li class="meta">None</li>'}</ul>
${methodHtml}${notesHtml}`;
}

// ------------------------------------------------------------- list-page cards

// Picks the selection a recipe should show for the current filters: included
// foods are chosen where an ingredient offers them, excluded ones are avoided.
export function recipeModel(data, recipe, pref = {}) {
  const inc = new Set(pref.inc || []);
  const exc = new Set(pref.exc || []);
  const selection = defaultSelection(recipe);
  const changed = [];
  for (const ing of recipe.ingredients) {
    let cur = selection[ing.id];
    const incOpt = ing.options.find((o) => inc.has(o.food));
    if (incOpt) cur = incOpt.food;
    else if (cur !== null && exc.has(cur)) {
      const alt = ing.options.find((o) => !exc.has(o.food));
      cur = alt ? alt.food : ing.optional ? null : cur;
    }
    if (cur !== defaultFood(ing)) changed.push({ ing: ing.id, label: ing.label, food: cur });
    selection[ing.id] = cur;
  }
  const sug = suggest(data, recipe, selection);
  const res = sug.res;
  const used = new Set(res.lines.map((l) => l.food.id));
  const p = res.perServing;
  return {
    recipe,
    selection,
    changed,
    sug,
    res,
    used,
    keys: {
      title: recipe.title,
      cost: p.cost,
      costPer100: p.calories > 0 ? (p.cost / p.calories) * 100 : Infinity,
      calories: p.calories,
      protein: p.protein,
      proteinPerDollar: p.cost > 0 ? p.protein / p.cost : 0,
      time: res.time,
    },
  };
}

export function cardHtml(data, m, picked) {
  const { recipe, res, sug } = m;
  const t = res.totals;
  const p = res.perServing;
  const hash = m.changed.map((c) => `${c.ing}=${c.food ?? ""}`).join("&");
  const variations = recipe.ingredients
    .filter(isSwappable)
    .map((ing) => {
      const cur = m.selection[ing.id];
      const names = ing.options.map((o) => (o.food === cur ? `<strong>${esc(shortName(data.food[o.food]))}</strong>` : esc(shortName(data.food[o.food]))));
      if (ing.optional) names.push(cur === null ? "<strong>none</strong>" : "none");
      return `<div class="meta"><span class="vlabel">${esc(ing.label)}:</span> ${names.join(" / ")}</div>`;
    })
    .join("");
  const using = m.changed.length ? `<div class="meta using">Showing with: ${m.changed.map((c) => (c.food ? esc(shortName(data.food[c.food])) : "no " + esc(c.label.toLowerCase()))).join(", ")}</div>` : "";
  const detail = statusDetail(data, recipe, sug);
  const cookware = res.cookware.map((c) => (c.owned ? esc(c.name) : `<span class="no-text">${esc(c.name)} ✗</span>`)).join(", ");
  return `<article class="card" data-id="${recipe.id}">
  <div class="card-head"><a class="card-title" href="recipe-${recipe.id}.html${hash ? "#" + hash : ""}">${esc(recipe.title)}</a> ${statusBadge(sug)}</div>
  ${detail ? `<div class="meta status-detail">${detail}</div>` : ""}
  <div class="stats compact">
    ${tile("cost / serving", `${ge(t.costPartial)}${fmtCost(p.cost)}`, "stat-main")}
    ${tile("calories", `${ge(t.caloriesPartial)}${Math.round(p.calories)}`)}
    ${tile("protein", `${ge(t.proteinPartial)}${Math.round(p.protein)} g`)}
    ${tile(res.timeIsEstimate ? "minutes (est.)" : "minutes", fmtNum(res.time))}
  </div>
  <div class="meta">Cookware: ${cookware || "none"}</div>
  ${variations}${using}
  <div class="meta summary">${esc(recipe.summary)}</div>
  <label class="addlist"><input type="checkbox" class="pickrecipe" value="${recipe.id}"${picked && picked.includes(recipe.id) ? " checked" : ""}> Add to shopping list</label>
</article>`;
}

// -------------------------------------------------------------- shopping list

// Whole packages needed to cover `amount unit` of `f`, with their price; null if unknowable.
function packagePlan(f, amount, unit) {
  const pk = packageFor(f, [unit]);
  if (!pk) return null;
  const inPkg = convertUnit(amount, unit, pk.unit);
  const price = rate(pk.amount, pk.unit, f.cost_per_unit.amount, f.cost_per_unit.unit);
  if (inPkg === null || price === null) return null;
  const packages = inPkg <= 1e-9 ? 0 : Math.ceil(inPkg / pk.amount - 1e-9);
  return { packages, cost: packages * price };
}

// entries: [{ recipe, selection, scale }]. Amounts are totalled per food across
// recipes, reduced by `on_hand` when known, and rounded up to whole packages.
export function shoppingList(data, entries) {
  const byFood = new Map();
  for (const e of entries) {
    const res = resolve(data, e.recipe, e.selection, e.scale || 1);
    for (const l of res.lines) {
      if (!byFood.has(l.food.id)) byFood.set(l.food.id, []);
      byFood.get(l.food.id).push(...l.usages);
    }
  }
  const lines = [];
  let toBuy = 0;
  let all = 0;
  let partial = false;
  for (const [id, list] of byFood) {
    const f = data.food[id];
    const first = list[0];
    const converted = list.map((u) => convertUnit(u.amount, u.unit, first.unit));
    const total = converted.includes(null) ? null : converted.reduce((a, b) => a + b, 0);
    const owned = isOwned(data, id);
    let need = total;
    if (total !== null && f.on_hand) {
      const have = convertUnit(f.on_hand.amount, f.on_hand.unit, first.unit);
      if (have !== null) need = Math.max(0, total - have);
    }
    const plan = total === null ? null : packagePlan(f, need, first.unit);
    const fullPlan = total === null ? null : packagePlan(f, total, first.unit);
    const prorata = list.map((u) => (f.cost_per_unit ? rate(u.amount, u.unit, f.cost_per_unit.amount, f.cost_per_unit.unit) : null));
    const proRataCost = prorata.includes(null) ? null : prorata.reduce((a, b) => a + b, 0);
    const cost = plan ? plan.cost : proRataCost;
    const fullCost = fullPlan ? fullPlan.cost : proRataCost;
    if (cost === null || fullCost === null) partial = true;
    if (fullCost !== null) all += fullCost;
    if (!owned && cost !== null) toBuy += cost;
    lines.push({ food: f, owned, total: total === null ? null : { amount: total, unit: first.unit }, usages: list, need, packages: plan ? plan.packages : null, cost });
  }
  lines.sort((a, b) => Number(a.owned) - Number(b.owned) || a.food.display_name.localeCompare(b.food.display_name));
  return { lines, toBuy, all, partial };
}

export function shoppingHtml(data, list) {
  if (!list.lines.length) return "";
  const rows = list.lines
    .map((l) => {
      const f = l.food;
      const qty = l.total ? fmtTotal(l.total.amount, l.total.unit, f) : l.usages.map((u) => fmtQty(u.amount, u.unit, f)).join(" + ");
      const pk = l.packages !== null && f.package ? ` · ${l.packages === 0 ? "enough on hand" : `${l.packages} × ${fmtPackage(f)}`}` : "";
      return `<li class="ing${l.owned ? "" : " unowned"}"><div class="ing-main">${ownedBadge(l.owned)} <strong>${esc(f.display_name)}</strong> <span class="qty">${esc(qty)}</span><span class="cost">${l.cost === null ? "no price" : fmtCost(l.cost)}</span></div><div class="meta">${l.owned ? "in your pantry" : "to buy"}${pk}</div></li>`;
    })
    .join("");
  return `<ul class="plain">${rows}</ul>
<p><strong>To buy (not owned): ${ge(list.partial)}${fmtCost(list.toBuy)}</strong></p>
<p class="meta">Everything above bought fresh in full packages: ${ge(list.partial)}${fmtCost(list.all)}</p>`;
}

export function shoppingText(data, list) {
  return list.lines
    .map((l) => {
      const f = l.food;
      const qty = l.total ? fmtTotal(l.total.amount, l.total.unit, f) : l.usages.map((u) => fmtQty(u.amount, u.unit, f)).join(" + ");
      return `${l.owned ? "[have]" : "[buy] "} ${f.display_name}${f.brand ? ` - ${f.brand}` : ""}: ${qty}${l.packages ? ` (${l.packages} × ${fmtPackage(f)})` : ""}`;
    })
    .join("\n");
}
