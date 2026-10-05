const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const code = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const snippet = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const drawer = code.slice(code.indexOf("  let drawerMap ="), code.indexOf('  $("#drawerClose")'));

function setup(url, withTag = true) {
  const elements = {};
  const context = {
    location: new URL(url),
    document: { referrer: "https://example.org/?q=private#fragment", body: { style: {} } },
    history: {
      replaceState(_state, _unused, url) {
        context.location = new URL(url, context.location);
      },
    },
    URLSearchParams,
    ideas: [{
      id: 0, ref: "733619-2", cycle: "12", title: "Private title",
      desc: "Private description", status: "Private notes",
      outcome: "review", location: "Private location", committee: "Community Resources",
      win: null, sourceUrl: null, ll: null,
    }],
    OUTCOMES: { review: {} },
    projById: {},
    cycleByNum: { "12": { label: "PB12", dates: "" } },
    badgeHTML: () => "",
    safeHttpUrl: () => null,
    esc: value => value,
    $: selector => elements[selector] ||= {},
  };
  context.window = context;
  vm.createContext(context);
  if (withTag) vm.runInContext(snippet, context);
  vm.runInContext(drawer, context);
  return { context, elements };
}

function queued(context) {
  return JSON.parse(JSON.stringify(context.dataLayer.map(entry => Array.from(entry))));
}

test("async tag loads the approved GA4 stream once", () => {
  assert.equal((html.match(/googletagmanager\.com\/gtag\/js/g) || []).length, 1);
  assert.match(html, /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-81F2NCLW2S"><\/script>/);
  assert(!html.includes("G-50H1LH4Y8Q"));
});

for (const url of [
  "https://cambridgeitd.github.io/pb-ideas-explorer/?idea=0&q=private#fragment",
  "https://pb-ideas-explorer.data.cambridgema.gov/?idea=0&q=private#fragment",
]) {
  test(`initialization and idea event work at ${new URL(url).pathname}`, () => {
    const { context, elements } = setup(url);
    const initial = queued(context);
    assert.equal(initial.length, 2);
    assert.equal(initial[0][0], "js");
    assert.deepEqual(initial[1], ["config", "G-81F2NCLW2S", {
      page_location: new URL(url).origin + new URL(url).pathname,
      page_referrer: "https://example.org/",
    }]);
    context.__openIdea(0);
    const events = queued(context);
    assert.equal(events.length, 3);
    assert.deepEqual(events[2], ["event", "view_idea", {
      send_to: "G-81F2NCLW2S", idea_index: 0, pb_cycle: 12, idea_ref: "733619-2",
      page_location: new URL(url).origin + new URL(url).pathname,
      page_referrer: "https://example.org/",
    }]);
    assert(!JSON.stringify(events).toLowerCase().includes("private"));
    assert(elements["#drawerBody"].innerHTML.includes("Private description"));
    assert.equal(elements["#drawer"].hidden, false);
    assert.equal(context.location.searchParams.get("idea"), "0");
  });
}

test("opening and closing drawers works when the tag is absent", () => {
  const { context, elements } = setup("https://example.org/?idea=0", false);
  context.__openIdea(0);
  assert.equal(elements["#drawer"].hidden, false);
  vm.runInContext("closeDrawer()", context);
  assert.equal(elements["#drawer"].hidden, true);
  assert.equal(context.location.searchParams.get("idea"), null);
});

test("blocked async script leaves a non-blocking queue; close/invalid IDs send nothing", () => {
  const { context } = setup("https://example.org/");
  context.__openIdea(0);
  vm.runInContext("closeDrawer()", context);
  context.__openIdea(999);
  assert.equal(queued(context).length, 3);
});

test("filter URL updates do not explicitly send or reinitialize analytics", () => {
  const { context } = setup("https://example.org/");
  context.state = { q: "private query", cycles: new Set(["12"]), themes: new Set(), outcomes: new Set() };
  const writeURL = code.slice(code.indexOf("  function writeURL()"), code.indexOf("  function filtered()"));
  vm.runInContext(writeURL + "\nwriteURL();", context);
  assert.equal(queued(context).length, 2);
  assert.equal(context.location.searchParams.get("q"), "private query");
  assert(!code.includes('"page_view"'));
});
