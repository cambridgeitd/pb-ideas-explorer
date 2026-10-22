const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("header and browser title spell out Participatory Budgeting", () => {
  assert.match(html, /<h1>Participatory Budgeting Ideas Explorer<\/h1>/);
  assert.match(html, /<title>Participatory Budgeting Ideas Explorer — City of Cambridge<\/title>/);
});

test("closed collection links to the map without inviting submissions", () => {
  assert.match(html, /<a class="btn-map" href="https:\/\/pbideas\.cambridgema\.gov\/page\/overview" target="_blank" rel="noopener">View Idea Collection Map<\/a>/);
  assert.doesNotMatch(html, /submit an idea|be the first to submit/i);
  assert.match(html, /id="noResults"[^>]*>No ideas match your filters\. Try fewer filters or a broader search\.<\/p>/);
});
