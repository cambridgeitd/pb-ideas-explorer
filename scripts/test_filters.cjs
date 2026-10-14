const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const filtering = code.slice(code.indexOf("  // Pre-computed"), code.indexOf("  // ---------- dropdown"));

function setup(query = "") {
  const ideas = [
    { id: 0, ref: "shared", cycle: "13", committee: "Facilities, Parks & Recreation", theme: "parks", outcome: "in_review", title: "Garden", desc: "", location: "", impact: "Butterfly habitat" },
    { id: 1, ref: "shared", cycle: "13", committee: "Transportation, Streets, and Sidewalks", theme: "streets", outcome: "in_review", title: "Garden", desc: "", location: "" },
    { id: 2, ref: "old", cycle: "12", committee: "Community Resources", theme: "community", outcome: "won", title: "Library", desc: "", location: "" },
  ];
  const context = {
    ideas, URLSearchParams, location: new URL("https://example.org/" + query),
    history: { replaceState(_state, _title, url) { context.location = new URL(url, context.location); } },
    document: { querySelector: () => ({}) },
  };
  vm.createContext(context);
  vm.runInContext(filtering + "\nreadURL();", context);
  const ids = () => Array.from(vm.runInContext("filtered().map(i => i.id)", context));
  return { context, ids };
}

test("exact committees round-trip with commas, spaces and ampersands", () => {
  const names = ["Facilities, Parks & Recreation", "Transportation, Streets, and Sidewalks"];
  const params = new URLSearchParams({ cycle: "13", idea: "1" });
  names.forEach(name => params.append("committee", name));
  const { context, ids } = setup("?" + params);
  assert.deepEqual(ids(), [0, 1]);
  vm.runInContext("writeURL(); readURL();", context);
  assert.deepEqual(context.location.searchParams.getAll("committee"), names);
  assert.deepEqual(ids(), [0, 1]);
});

test("committee filter selects the correct cross-listed row without collapsing either", () => {
  for (const [name, expected] of [["Facilities, Parks & Recreation", 0], ["Transportation, Streets, and Sidewalks", 1]]) {
    const { ids } = setup("?" + new URLSearchParams({ cycle: "13", committee: name }));
    assert.deepEqual(ids(), [expected]);
  }
});

test("impact text is searchable, while historical records need no impact field", () => {
  assert.deepEqual(setup("?q=butterfly").ids(), [0]);
  assert.deepEqual(setup("?q=library").ids(), [2]);
  assert.deepEqual(setup("?cycle=12&outcome=won").ids(), [2]);
});

test("committee and theme filters intersect, with reset clearing committees", () => {
  const { context, ids } = setup("?" + new URLSearchParams({
    committee: "Facilities, Parks & Recreation", theme: "streets",
  }));
  assert.deepEqual(ids(), []);
  vm.runInContext("state.themes.clear();", context);
  assert.deepEqual(ids(), [0]);
  vm.runInContext("state.committees.clear(); writeURL();", context);
  assert.deepEqual(ids(), [0, 1, 2]);
  assert.equal(context.location.searchParams.has("committee"), false);
});
