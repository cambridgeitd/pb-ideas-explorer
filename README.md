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

Ideas come straight from Cambridge Open Data:
[Participatory Budgeting Ideas Submitted by Community Members](https://data.cambridgema.gov/Budget-Finance/Participatory-Budgeting-Ideas-Submitted-by-Communi/54vd-wdqj)
(dataset `54vd-wdqj`, PB1–PB12). That dataset is maintained by the annual PB
ETL in the City's internal `odp-etl-py` project (`proj/budget/pb`), which
normalizes the Budget Office idea workbooks and replaces the portal dataset
once a year when a PB cycle finishes.

`scripts/build_data.py` downloads the portal export (cached at
`source-data/pb_ideas_open_data.csv`, not committed) and combines it with two
local Budget Office files that are not yet on the portal:

| File | Source |
|---|---|
| `pb_projects.csv` | Ballot projects, results, and costs (Budget Office) |
| `pb_project_locations.csv` | Locations of winning projects (Budget Office) |

The build transforms everything into the compact JSON in `data/` that the site loads. It also:

- **Normalizes themes** — committee names changed nearly every cycle (17 variants), so they are mapped to six stable themes for cross-cycle comparison; the original committee name is preserved and shown in the detail view.
- **Derives outcomes** — the `Idea Status` column is only populated for some cycles, so a rules-based classifier also reads the free-text `Project Status` staff notes to assign each idea one of eight outcome categories (inspired a winning project, made the ballot, shortlisted, already underway, referred to City staff, not advanced, not eligible, no recorded outcome).

### Refreshing the data

Once a year, after the PB ETL (odp-etl-py `proj/budget/pb`) updates the Open
Data dataset:

```sh
python scripts/build_data.py --refresh
```

Then commit and push — GitHub Pages redeploys automatically.

## Development

No build step for the site itself. Serve the folder and open it:

```sh
python -m http.server 8000
```

### Map tiles

The explorer uses [Stadia Maps Alidade Smooth](https://docs.stadiamaps.com/map-styles/alidade-smooth/)
for its quiet, marker-friendly basemap. Localhost works without credentials. For production,
register `cambridgeitd.github.io` as an authorized domain in the Stadia Maps client dashboard;
domain authentication avoids storing an API key in this public repository.

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
scripts/build_data.py Open Data + local CSVs → JSON pipeline (run after data updates)
source-data/          Local project CSVs and the cached Open Data export (not committed)
```
