const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const filtering = code.slice(code.indexOf("  // Pre-computed"), code.indexOf("  // ---------- dropdown"));

function setup(query = "", records) {
  const ideas = records || [
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
  vm.runInContext(code.slice(code.indexOf("  function highlight("), code.indexOf("  function renderCards(")), context);
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

function search(query, fields) {
  const records = fields.map((values, id) => ({
    id, cycle: "13", committee: "Environment", theme: "env", outcome: "in_review",
    title: "", desc: "", location: "", ...values,
  }));
  return setup("?" + new URLSearchParams({ q: query }), records);
}

test("whole words do not match substrings, prefixes, suffixes or plurals", () => {
  const { ids } = search("tree", [
    { title: "A TREE by the library" }, { title: "street" }, { title: "trees" },
    { title: "treehouse" }, { title: "(tree)" }, { title: "tree-lined" },
    { title: "tree_planting" }, { title: "tree2" },
  ]);
  assert.deepEqual(ids(), [0, 4, 5]);
});

test("multiple words form a consecutive phrase within one field", () => {
  const { ids } = search("  Dog   Park ", [
    { title: "New DOG PARK nearby" }, { title: "Dog playground and park" },
    { title: "Park for a dog" }, { title: "dog", desc: "park" },
    { desc: "dog\n\tpark" }, { location: "dog park" }, { impact: "A dog park for all." },
    { title: "dog parks" }, { title: "bulldog park" },
  ]);
  assert.deepEqual(ids(), [0, 4, 5, 6]);
});

test("Unicode word boundaries do not split accented or non-Latin words", () => {
  assert.deepEqual(search("café", [
    { title: "CAFÉ nearby" }, { title: "caféteria" }, { title: "décafé" },
  ]).ids(), [0]);
  assert.deepEqual(search("école", [{ title: "ÉCOLE" }, { title: "préécole" }]).ids(), [0]);
  assert.deepEqual(search("tree", [{ title: "街tree" }, { title: "tree\u0301" }, { title: "tree!" }]).ids(), [2]);
});

test("query punctuation and regular-expression characters are literal", () => {
  assert.deepEqual(search("c++", [{ title: "Learn C++!" }, { title: "C++course" }, { title: "C" }]).ids(), [0]);
  assert.deepEqual(search("dog.park", [{ title: "dog.park" }, { title: "dog park" }]).ids(), [0]);
  assert.deepEqual(search("[park]", [{ title: "[park]" }, { title: "park" }]).ids(), [0]);
  assert.deepEqual(search("(", [{ title: "(" }, { title: "park" }]).ids(), [0]);
});

test("blank search retains every record and single-letter words are searchable", () => {
  assert.deepEqual(search(" \t ", [{ title: "one" }, { title: "two" }]).ids(), [0, 1]);
  assert.deepEqual(search("a", [{ title: "A park" }, { title: "Park" }, { title: "canal" }]).ids(), [0]);
});

test("highlighting marks whole phrases rather than partial or separate words", () => {
  const { context } = search("dog park", []);
  context.text = "Dog playground; DOG PARK and dog\npark, not dog parks.";
  assert.equal(vm.runInContext("highlight(text)", context),
    "Dog playground; <mark>DOG PARK</mark> and <mark>dog\npark</mark>, not dog parks.");
  const word = search("tree", []).context;
  word.text = "street tree trees treehouse";
  assert.equal(vm.runInContext("highlight(text)", word), "street <mark>tree</mark> trees treehouse");
});

test("highlighting escapes HTML without matching markup or generated entities", () => {
  const { context } = search("amp", []);
  context.text = 'Trees & <img src="x"> amp';
  assert.equal(vm.runInContext("highlight(text)", context),
    'Trees &amp; &lt;img src=&quot;x&quot;&gt; <mark>amp</mark>');
  const literal = search("<img", []).context;
  literal.text = '<img src="x" onerror="bad()">';
  assert.equal(vm.runInContext("highlight(text)", literal),
    '<mark>&lt;img</mark> src=&quot;x&quot; onerror=&quot;bad()&quot;&gt;');
});

test("snippet truncation cannot manufacture a whole-word match", () => {
  const { context } = search("tree", []);
  context.text = "treehouse";
  assert.equal(vm.runInContext("highlight(text, 4)", context), "tree");
  context.text = "tree by the road";
  assert.equal(vm.runInContext("highlight(text, 4)", context), "<mark>tree</mark>");
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
