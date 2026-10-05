# PB Ideas Explorer

**Live site: https://cambridgeitd.github.io/pb-ideas-explorer/**

A static, no-server explorer for every idea Cambridge residents have submitted through
[Participatory Budgeting](https://www.cambridgema.gov/participatorybudgeting) since 2014.
It lets anyone quickly see trends across space and time — what has been proposed, where,
when, and what happened next — and check whether an idea like theirs has come up before,
ahead of [submitting a new one](https://pbideas.cambridgema.gov/page/overview).

This is a static reimplementation of the experimental Shiny app at
[cambridgeitd/pb-dashboard](https://github.com/cambridgeitd/pb-dashboard). Because it is
plain HTML/CSS/JS, it needs no R server and is hosted free on GitHub Pages.

## Features

- **Full-text search** across 11,000+ idea titles, descriptions, and locations, with term highlighting
- **Filters** by PB cycle, theme, and outcome — combined, shown as removable chips, and mirrored to the URL so any view is shareable/bookmarkable
- **Ideas-over-time chart**, stacked by theme or outcome; clicking a bar filters to that cycle
- **Plain-language category guide** explaining the normalized themes and the chronological PB outcome stages
- **Clustered map** of the ~5,700 geocoded ideas, colored by theme
- **Card list** (replacing the old data table) with a detail drawer showing the full description, staff outcome notes, a mini-map, and — when the idea inspired a winning ballot project — that project's votes, cost, and locations

## Data

Ideas and ballot projects come straight from Cambridge Open Data. Both
datasets are maintained by the annual PB ETL in the City's internal
`odp-etl-py` project (`proj/budget/pb`), which normalizes the Budget Office
workbooks and publishes updates when a PB cycle finishes.

`scripts/build_data.py` downloads complete exports at build time and caches
them in the gitignored `source-data/` directory:

| Cache | Source |
|---|---|
| `pb_ideas_open_data.csv` | [Ideas, PB1–PB12 (`54vd-wdqj`)](https://data.cambridgema.gov/d/54vd-wdqj) |
| `pb_projects_open_data.csv` | [Ballot projects, PB1–PB12 (`uhwd-9y6q`)](https://data.cambridgema.gov/d/uhwd-9y6q) |

No raw workbooks or private ETL checkout are needed to build the viewer.
The projects export has one row per ballot project. `Project ID Aliases`
and `Project Locations` are JSON arrays in text columns, preserving
multi-location links without counting a project's votes or cost repeatedly.
Unknown/TBD project locations remain empty; no map coordinates are invented.
Submitter names are never included in the viewer's JSON.

The build transforms everything into the compact JSON in `data/` that the site loads. It also:

- **Normalizes themes** — committee names changed nearly every cycle (17 variants), so they are mapped to six stable themes for cross-cycle comparison; the original committee name is preserved and shown in the detail view.
- **Derives outcomes** — the `Idea Status` column is only populated for some cycles, so a rules-based classifier also reads the free-text `Project Status` staff notes to assign each idea one of eight outcome categories (inspired a winning project, made the ballot, shortlisted, already underway, referred to City staff, not advanced, not eligible, no recorded outcome).

### Refreshing the data

Once a year, after the PB ETL (odp-etl-py `proj/budget/pb`) updates the Open
Data datasets:

```sh
python scripts/build_data.py --refresh
```

Then commit and push — GitHub Pages redeploys automatically.

Without `--refresh`, the build reuses cached exports (and downloads any
missing cache). Visitors load only static JSON, never Socrata. Invalid exports,
unresolved winning-project links, and unexpected changes to existing idea order
stop the build instead of silently breaking the site. The three PB12 idea IDs
changed from `.5` to `-2` are explicitly allowed, retaining their existing
numeric deep links.

## Development

No build step for the site itself. Serve the folder and open it:

```sh
python -m http.server 8000
```

### Analytics

Google Analytics 4 uses the City's existing **shinyapps/viz** property,
measurement ID **`G-81F2NCLW2S`** (not the Socrata stream). The async Google tag
initializes once per page load. Opening an idea drawer, including through a
deep link, sends `view_idea` with `idea_index`, `pb_cycle`, and the public
`idea_ref`. No submitter, idea content, or search text is included in this
custom event; its page URL and referrer omit query strings and fragments.
The viewer does not wait for Analytics and still works when it is blocked.
There is no hostname-specific configuration to change for the custom domain.

**Page-view caveat:** the app does not manually send page views or reconfigure
the tag on filter changes. However, GA4 Enhanced Measurement can automatically
count our `history.replaceState` calls as page views.
[Google documents that `send_page_view: false` does not disable those history events](https://developers.google.com/analytics/devguides/collection/ga4/views#disable_page_changes_based_on_browser_history_events).
Justin (or another property Editor) must untick **Page changes based on browser
history events** under the stream's Enhanced Measurement > Page views advanced
settings to reliably count only document loads. Until then, Views may include
filter/drawer changes; use `view_idea` for explicit idea opens. Automatic
Enhanced Measurement events (including site search) are controlled by that
shared stream's settings, separately from this site's custom event.

Run the Analytics regression checks with `node --test scripts/test_analytics.cjs`.

### Map tiles

The explorer uses [OpenStreetMap](https://www.openstreetmap.org/) tiles with
attribution. No API key or hostname allowlist is required.

## Data wishlist — to take this to the next level

Additional data that would improve the explorer, roughly in priority order:

1. **Idea status/outcome for all cycles** — several earlier cycles still lack `Idea Status`. Backfilling them (even coarsely: won / ballot / shortlisted / not advanced / ineligible) would replace the fragile text-pattern classifier with authoritative data.
2. **Idea → ballot project linkage for all cycles** — `Winning Project ID` links ideas only to *winning* projects. A link from each idea to the ballot proposal it fed into (winning or not) would show the full funnel: ideas → proposals → ballot → funded.
3. **Winning project implementation status** — planned / in construction / completed (+ completion date, actual cost, photo). This would let residents see PB deliver, and would be great on the map.
4. **Per-cycle context** — PB budget amount, number of voters, and vote method per cycle, for a "PB by the numbers" trend panel.
5. **Consistent geocoding** — many ideas have no coordinates; many are city-wide, but a flag distinguishing "city-wide" from "not geocoded" (and geocoding where possible) would make the map more honest and complete.
6. **Category tags for ideas** — the committee assignment is one-dimensional; multi-tags (e.g., "trees", "bike safety", "accessibility") would sharpen search and trends.
7. **Ballot project descriptions ↔ ideas counts** — how many ideas fed each proposal, to highlight the most-requested concepts each cycle.

## Repository layout

```
index.html            The site (single page)
css/style.css         Styles (cambridgema.gov-inspired palette and type)
js/app.js             All behavior: filters, chart, map, cards, drawer
data/                 Generated JSON the site loads (do not edit by hand)
scripts/build_data.py Open Data exports → JSON pipeline (run after data updates)
source-data/          Cached exports and retained legacy inputs (not committed)
```
