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
- **Clustered map** of the ~5,700 geocoded ideas, colored by theme
- **Card list** (replacing the old data table) with a detail drawer showing the full description, staff outcome notes, a mini-map, and — when the idea inspired a winning ballot project — that project's votes, cost, and locations

## Data

Raw data lives in `source-data/`:

| File | Source |
|---|---|
| `pb_ideas.csv` | [Participatory Budgeting Ideas](https://data.cambridgema.gov/Budget-Finance/Participatory-Budgeting-Ideas/54vd-wdqj) on Cambridge Open Data |
| `pb11_ideas.xlsx` / `pb12_ideas.xlsx` | PB11 and PB12 idea exports from the Budget Office |
| `pb11_ideas.csv` / `pb12_ideas.csv` | Normalized versions of the Budget Office workbooks |
| `pb_projects.csv` | Ballot projects, results, and costs (Budget Office) |
| `pb_project_locations.csv` | Locations of winning projects (Budget Office) |

`scripts/import_idea_workbooks.py` normalizes the PB11 and PB12 workbooks. `scripts/build_data.py`
combines those normalized files with the Open Data export and transforms everything into the
compact JSON in `data/` that the site loads. The build also:

- **Normalizes themes** — committee names changed nearly every cycle (17 variants), so they are mapped to six stable themes for cross-cycle comparison; the original committee name is preserved and shown in the detail view.
- **Derives outcomes** — the `Idea Status` column is only populated for some cycles, so a rules-based classifier also reads the free-text `Project Status` staff notes to assign each idea one of eight outcome categories (inspired a winning project, made the ballot, shortlisted, already underway, referred to City staff, not advanced, not eligible, no recorded outcome).

### Refreshing the data

```sh
curl -L "https://data.cambridgema.gov/api/views/54vd-wdqj/rows.csv?accessType=DOWNLOAD" -o source-data/pb_ideas.csv
pip install -r requirements-import.txt
python scripts/import_idea_workbooks.py
python scripts/build_data.py
```

Then commit and push — GitHub Pages redeploys automatically.

## Development

No build step for the site itself. Serve the folder and open it:

```sh
python -m http.server 8000
```

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
scripts/build_data.py CSV → JSON pipeline (run after data updates)
source-data/          Raw CSVs
```
