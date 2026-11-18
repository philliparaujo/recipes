// Browser-only helpers shared by every page. Loaded after data.js and shared.js.
// "Owned" what-if changes made in the catalog live in localStorage only; they
// never touch the YAML files.

const OWNED_KEY = "recipes.owned.v1";

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OWNED_KEY)) || {};
  } catch {
    return {};
  }
}

function saveOverrides(ov) {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify(ov));
  } catch {
    /* private mode or blocked storage: changes just last for this page */
  }
}

function showOverrideBanner() {
  const el = document.getElementById("ovbanner");
  if (!el) return;
  const n = Object.keys(loadOverrides()).length;
  el.hidden = n === 0;
  if (!n) return;
  el.innerHTML = `Using ${n} local "owned" change${n === 1 ? "" : "s"} from the catalog (your YAML is unchanged). <button type="button" id="ovreset">Reset</button>`;
  document.getElementById("ovreset").addEventListener("click", () => {
    saveOverrides({});
    location.reload();
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  return Promise.resolve();
}

// YAML values, captured before local overrides change them (the catalog compares against these).
const BASE_OWNED = {};
for (const item of [...Object.values(DATA.food), ...Object.values(DATA.cookware)]) BASE_OWNED[item.id] = item.owned;

applyOverrides(DATA, loadOverrides());
showOverrideBanner();
