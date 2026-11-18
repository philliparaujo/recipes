---
name: recipe-ops
description: Use whenever working in this repo — adding/editing recipes, cookware inventory, or food inventory. Governs both the communication style for these sessions and the mechanical checks to run before calling an edit done.
---

# Recipe ops

## Communication style

- Lead with the next action — say what you're about to do before doing it, not after.
- Number multi-step tasks (1., 2., 3. ...). Don't bury steps in prose.
- Restate state every turn: what inventory/recipe files are touched, what's still pending.
- Give specific time estimates in minutes when estimating effort (e.g. "~3 min"), never vague terms like "a bit" or "shortly."
- Make wins visible — when a build passes, say so plainly ("schema valid, build passed").
- Report errors matter-of-factly: what failed, where, no apology padding.
- Cap lists at 5 items. If there are more, say how many total and show the top 5.
- No preamble, no recap, no closers.
- Suppress tangents — note unrelated issues in one line at most.
- End every turn with exactly one concrete next step.

## The rule that overrides the rest

**A variation is a choice inside one recipe file, never a second recipe file.** "Make the chicken version" means add an option to the ingredient. See [CLAUDE.md](../../../CLAUDE.md) §4.

## Mechanical checks before marking an edit done

[CLAUDE.md](../../../CLAUDE.md) §5 is the authority. The ones that catch the most mistakes:

1. New/edited item has a kebab-case `id`, unique across **all** stores (cookware, food, recipes). If a name stops matching its id, rename both and grep for the old id.
2. Every food, seasoning and cookware reference resolves. Cookware refs are exactly `<id>`, `category:<c>` or `tag:<t>`.
3. `category` values come from the closed sets. Spices are `spice`, not `pantry`.
4. Food items: brand goes in `brand`, not in `display_name`. No `preparations` or `variants`. `package`, `cost_per_unit` and `nutrition` are structured with units. Anything guessed or based on an assumed package size must be listed in `estimated`. A package in a different unit family from its price/usage (oz jar, tsp price) carries `package.equals`.
5. Priced or used by count (eggs, slices, potatoes)? The unit is `unit` and the food needs a `count_label`. Volume and weight do not convert, so price an item in the family the recipes use.
6. Homemade mixes are composite foods (`made_from` + `makes`), never a hand-typed price.
7. Recipes: each ingredient has exactly one of `food` / `options`; alternatives are only the foods the user explicitly allows; every option has an `amount` and `unit` (own or inherited); amounts use nice fractions (`0.33`, `0.67`, `0.125`).
8. Seasonings, times and cookware sit on the ingredient option they belong to, so they swap with it.
9. `method` is a list. Anything that can change with a swap uses `{{food:<ingredient-id>}}` or `only_if`, so the text never contradicts the selection.
10. Run `npm run build` and report pass/fail plainly. For recipes with swaps, spot-check a swapped selection on the recipe page (the build validates structure and the default only).
