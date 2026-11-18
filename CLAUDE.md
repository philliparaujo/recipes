# CLAUDE.md

## Project goal

A static recipes website (GitHub Pages target) that works on desktop and mobile. It is **high level**: a recipe is an ingredient list, not a sequence of steps. The site answers:

- What does this cost, per recipe and per serving? What would I actually pay at the register?
- How many calories, protein, fat and carbs?
- Which cookware does it need, and roughly how long does it take?
- What can I make with what I own, and what happens to all of the above if I swap an ingredient?

Two inventories drive everything: **food** (with price and nutrition per unit) and **cookware**. Recipes reference them by `id` only.

## The one invariant

**A variation is a choice inside one recipe file, never a second recipe file.** If "the chicken version" seems to need a copy of a recipe, add an option to the ingredient instead.

## Status

`build.js` (plain Node + `js-yaml`; `npm install && npm run build`) reads `cookware/`, `food/`, `recipes/`, validates (§5), and emits to `_site/`:

- `index.html` — recipe list. Filter by ingredient (tap once to include, twice to exclude; match all/any; search), hide unmakeable, sort by name / cost / cost per 100 kcal / calories / protein / protein per dollar / time with a direction toggle. Cards show the numbers for the swaps that match the filter. Check recipes to build a **shopping list** (copyable). Filter and sort state persist in the browser.
- `recipe-<id>.html` — one page per recipe: swap pickers (each option shows its price and calorie change), servings scaler, reset, and "apply these swaps" when something is missing. The selection lives in the URL hash.
- `catalog.html` — recipes, food and cookware as sortable, searchable tables with "used in" counts, estimate markers, an owned what-if toggle, and a YAML generator for new items.

Source layout: `shared.mjs` holds all resolve/format logic and is used by the build and the browser (emitted to `_site/shared.js` with `export` stripped, so keep it import-free and free of Node APIs). Browser-only code and CSS live in `web/` and are copied into `_site/`.

Phone layout (<= 640px): catalog tables become stacked cards (headings become sort pills), the ingredient filter starts collapsed, a floating bar shows live cost / calories / protein on recipe pages and a shopping-list shortcut on the list page, and every control is at least 44px. A web manifest and icon allow adding the site to a home screen (no service worker, so it is not offline).

Deployment: `.github/workflows/pages.yml` builds and publishes `_site/` to GitHub Pages on every push to `main` (repo Settings > Pages > Source must be "GitHub Actions").

Not started: images.

## Guidelines

- Plain YAML files in the repo; no database. The site never writes YAML (it is static); the catalog's owned toggles are a local what-if in `localStorage`, and the generator only prints YAML to paste.
- **Strict schemas, enforced.** Unknown fields are build errors.
- **IDs are the glue.** Every record has a stable kebab-case `id`, unique across all stores. References are by `id` only. Do not rename an id casually; if a recipe's name stops matching its id, rename both and check nothing references the old one.
- **Derived, never hand-written:** ingredient list, totals, cookware list, notes, makeable status, composite food prices.
- **Estimates are marked, not hidden.** Anything that is not from a receipt or label goes in the item's `estimated` list.
- Mobile-first and minimal. Vanilla JS only. Controls must be usable one-handed (44px targets), and status is always icon + text, never colour alone.

## Data model

### 1. Equipment references

Exactly three forms, anywhere cookware is referenced:

| Form | Meaning |
|---|---|
| `<cookware-id>` | this specific item |
| `category:<category>` | any owned item of that category |
| `tag:<tag>` | any owned item carrying that tag |

Categories: `pot`, `pan`, `appliance`, `tool`, `bakeware`. When a selection requires a concrete item (`frypan-10-5in`), a `category:pan` is satisfied by it and not listed separately.

### 2. Cookware

```yaml
id: frypan-10-5in
category: pan
name: '10.5" Frypan'
short_name: "frypan"
size: "10.5 inch"
material: nonstick
owned: true
tags: [stovetop, nonstick]
notes: ["Never use metal utensils on this pan."]   # shown under "Care and ingredient notes"
```

### 3. Food

Distinct variants are distinct items ("80/20" and "91/9" beef are two records). There is no `variants` field. A food item says nothing about how it is cooked.

```yaml
id: ground-beef-91-9
display_name: "Ground Beef (91/9)"      # no brand in the name
brand: "Kirkland"                       # optional, shown muted
category: protein    # protein dairy vegetable fruit grain pasta sauce fat spice pantry other
package: { amount: 1, unit: lb }
owned: true
cost_per_unit: { amount: 5.75, unit: lb }
nutrition: { unit: oz, calories: 43, protein_g: 5.8, fat_g: 2.5, carbs_g: 0 }   # per 1 `unit`; fat_g/carbs_g optional
estimated: [cost_per_unit, nutrition]   # which fields are guesses (cost_per_unit | nutrition | package)
count_label: { one: slice, other: slices }   # required if any of package/cost/nutrition use unit "unit"
on_hand: { amount: 2, unit: lb }        # optional; recipes needing more are not makeable
notes: []
```

- **Units** convert only within a family: `pinch/tsp/tbsp/cup/qt/ml/l` (volume) and `oz/lb/g/kg` (weight). Volume never converts to weight (no densities). `unit` is a count (eggs, slices) and converts only to itself, so price an egg per `unit`, not per oz. If a conversion is impossible or a field is missing, that ingredient is left out of the total and the total shows "≥". Omit a field rather than guess, unless the user asks for a guess, in which case add it to `estimated`.
- **`package`** is the size you buy. It powers "buying full packages" and the shopping list. It must be a real quantity, never a word like "jar". If the package is in a different unit family from how it is priced and used (a 2.5 oz spice jar used by the tsp), add `equals: { amount: 31, unit: tsp }` inside `package`; without it that item is counted pro-rata in "buying full packages". The `equals` amount is a conversion guess, so list `package` in `estimated`.
- **Composite foods** (homemade sauces and mixes) are derived, so they stay in sync when component prices change:

```yaml
id: smoky-mayo
display_name: "Smoky Mayo"
category: sauce
made_from:
  - { food: mayo, amount: 1, unit: tbsp }
  - { food: paprika, amount: 0.25, unit: tsp }
makes: { amount: 1, unit: tbsp }
```

  A composite must not declare `owned`, `cost_per_unit`, `nutrition`, `package` or `estimated`. They are derived (owned = all components owned; estimated if any component is), and its recipe is added to the notes of any recipe that uses it. Components cannot themselves be composite. The reason composites exist: an ingredient's options cannot repeat the same food, so "spicy" and "smoky" mayo must be two foods.

### 4. Recipes

```yaml
id: sourdough-melt-with-fried-egg
title: "..."
summary: "..."
servings: 1
cookware: [dutch-oven-5qt-covered]      # recipe-wide, optional
total_minutes: 40                       # optional override; otherwise estimated (see below)
ingredients:
  - id: meat
    label: Meat
    amount: 3
    unit: oz
    options:                            # the foods you allow; first is the default
      - food: roast-beef-sliced
      - food: ham-sliced
        amount: 4                       # an option may replace amount/unit/minutes
        unit: unit
  - id: heat
    optional: true                      # adds a "None" choice and makes it the default
    amount: 0.25
    unit: tsp
    options: [{ food: red-pepper-flakes }]
  - id: cheese
    food: havarti-sliced                # fixed ingredient: shorthand for a single option
    amount: 2
    unit: oz
method:                                 # optional list of steps
  - "Layer the {{food:meat}} and cheese."          # token: the selected food's short name
  - text: "Add the red pepper flakes."
    only_if: { heat: red-pepper-flakes }           # shown only for that choice ("none" for no choice)
notes: ["..."]
```

- **Interchangeability is explicit.** An ingredient allows exactly the foods listed in `options`.
- **Ingredient-level fields apply to every option**: `amount`, `unit`, `prep_minutes`, `cook_minutes`, `cookware`, `seasonings`. An option may replace the scalars; its `cookware` and `seasonings` are **added** to the ingredient's.
- **Seasonings** belong to the option (`{food, amount, unit}`), so they swap with it. A seasoning that is itself a choice is its own `optional` ingredient.
- **Method text must not contradict a swap.** Use `{{food:<ingredient-id>}}` for a food that can change and `only_if` for steps that depend on a choice. These are the only template features.
- **Amounts** use nice values: ⅓ is `0.33`, ⅔ is `0.67`, ⅛ is `0.125`. The page shows them as fractions and the count unit as the food's noun ("4 eggs").
- **Times:** prep is summed and cook is the longest item, shown as an estimate (overlapping steps are double counted). Set `total_minutes` when you know the real elapsed time.
- **Servings** is the recipe's yield; the page can scale it. Quantities are scaled linearly.

Derived from the current selection: ingredient lines (one per distinct food with every usage and a total), cost, calories, protein, fat, carbs (total and per serving), the cost of full packages, cookware, notes (recipe notes first, then food and cookware notes labelled by item and deduped), ownership, and swap hints.

### 5. Validation (build fails, not warns)

1. Every `id` is kebab-case and unique across cookware, food and recipes.
2. Unknown fields are rejected everywhere (food, cookware, recipes, ingredients, options, method steps). This catches leftovers like `slots`, `steps`, `variant_axes`, `preparations`, `variants`, `text_override`.
3. Closed `category` sets; `owned` is a boolean (not on composites).
4. `package`, `cost_per_unit`, `nutrition`, `on_hand` are structured with non-negative numbers and a unit from the accepted set; `estimated` lists only fields the item has.
5. Count unit: an item priced, packaged or measured per `unit`, or used by count in a recipe, needs a `count_label`.
6. Composites: components exist, are not composite, can all be priced and nutrition-derived; `makes` is present.
7. A recipe has an integer `servings` ≥ 1, a non-empty `ingredients` list with unique ids, and optionally a positive `total_minutes`.
8. Each ingredient declares exactly one of `food` or `options`; no duplicate foods; every option resolves to a positive `amount` and valid `unit`.
9. Every food, seasoning and cookware reference resolves; every `category:`/`tag:` matches a cookware item.
10. `method` is a list of steps; tokens are only `{{food:<ingredient-id>}}` for an existing ingredient; `only_if` names real ingredients and real choices (`none` only for optional ones).

### 6. "What can I make"

A recipe is **makeable now** if its current selection uses only owned food (and `on_hand` quantities, when given) and owned cookware. It is **makeable with swaps** if choosing other options (or dropping optional ones) fixes it, and the page offers "Apply these swaps". Otherwise it is **blocked** and names what is missing. The catalog's owned toggle recomputes this live as a what-if.

## Rejected

- A `variants` field on food items: separately ownable things must be separate records.
- Structured step-by-step recipes (prep blocks, roles, vessel state, general template tokens). Free-text `method` with one token and `only_if` covers it.
- Tag/category-based swappability: the user wants to choose each ingredient's alternatives explicitly.
- Editing YAML from the site: it is static. Use local what-if toggles and the YAML generator.
