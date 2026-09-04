#!/usr/bin/env python3
"""Build the JSON data files for the PB Ideas Explorer.

Ideas come from the published Cambridge Open Data dataset
"Participatory Budgeting Ideas Submitted by Community Members" (54vd-wdqj),
which is maintained by the annual PB ETL in the odp-etl-py project
(proj/budget/pb). Ballot projects still come from the local CSVs in
source-data/. Outputs:

  data/ideas.json     one record per submitted idea
  data/projects.json  one record per ballot project (with locations)
  data/meta.json      cycles, themes, outcomes, build info

The Open Data export is cached at source-data/pb_ideas_open_data.csv and
downloaded automatically on first run. After the annual ETL updates the
portal, rebuild with:

  python scripts/build_data.py --refresh
"""
import argparse
import csv
import json
import re
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source-data"
OUT = ROOT / "data"

IDEAS_EXPORT_URL = (
    "https://data.cambridgema.gov/api/views/54vd-wdqj/rows.csv?accessType=DOWNLOAD"
)
IDEAS_CACHE = SRC / "pb_ideas_open_data.csv"

# ---------------------------------------------------------------------------
# Themes: committee names changed across cycles; map them to stable themes.
# ---------------------------------------------------------------------------
THEMES = {
    "streets": {
        "label": "Streets, Sidewalks & Transit",
        "color": "#2294d6",
        "description": "Transportation and public ways, including streets, sidewalks, transit, biking, and pedestrian safety.",
    },
    "parks": {
        "label": "Parks, Recreation & Facilities",
        "color": "#e6730f",
        "description": "Parks, recreation, public facilities, and shared indoor and outdoor spaces.",
    },
    "env": {
        "label": "Environment, Health & Safety",
        "color": "#1a892b",
        "description": "Environmental sustainability, public health, cleanliness, and safety.",
    },
    "community": {
        "label": "Community & Culture",
        "color": "#473e81",
        "description": "Arts, culture, community resources, public services, and neighborhood connections.",
    },
    "youth": {
        "label": "Youth & Education",
        "color": "#b98f00",
        "description": "Ideas focused on young people, education, learning, and youth programs.",
    },
    "other": {
        "label": "Uncategorized",
        "color": "#6b7075",
        "description": "Ideas without a recorded committee or a clear cross-cycle theme.",
    },
}

COMMITTEE_TO_THEME = {
    "Streetsmarts": "streets",
    "Streets, Sidewalks & Transit": "streets",
    "Transportation, Streets, and Sidewalks": "streets",
    "Parks & Recreation": "parks",
    "Parks, Recreation & Education": "parks",
    "Facilities, Parks, and Recreation": "parks",
    "Environment": "env",
    "Environment, Health & Safety": "env",
    "Health, Environment & Safety": "env",
    "Culture & Community Facilities": "community",
    "Community Resources": "community",
    "'Bridge Builders": "community",
    "Youth": "youth",
    "Youth & Education": "youth",
    "Youth & Technology": "youth",
    "Youth and Technology": "youth",
    "": "other",
}

# ---------------------------------------------------------------------------
# Outcomes: derived from Idea Status (only populated for some cycles),
# free-text Project Status, and the Winning Project ID link.
# ---------------------------------------------------------------------------
OUTCOMES = {
    "ineligible": {
        "label": "Not eligible",
        "color": "#9b2743",
        "order": 7,
        "processOrder": 1,
        "rank": 7,
        "description": "Did not meet PB rules, such as capital funding, ownership, cost, or scope requirements.",
    },
    "referred": {
        "label": "Referred to City staff",
        "color": "#e6730f",
        "order": 5,
        "processOrder": 2,
        "rank": 5,
        "description": "Was directed to City staff or another process rather than continuing through PB.",
    },
    "underway": {
        "label": "Already underway by the City",
        "color": "#473e81",
        "order": 4,
        "processOrder": 3,
        "rank": 4,
        "description": "The need was already funded, planned, or being addressed by the City.",
    },
    "not_advanced": {
        "label": "Not advanced",
        "color": "#6b7075",
        "order": 6,
        "processOrder": 4,
        "rank": 6,
        "description": "Was reviewed but did not move forward to the shortlist.",
    },
    "shortlist": {
        "label": "Shortlisted",
        "color": "#b98f00",
        "order": 3,
        "processOrder": 5,
        "rank": 3,
        "description": "Was selected for further development or feasibility review but did not reach the ballot.",
    },
    "ballot": {
        "label": "Made the ballot",
        "color": "#2294d6",
        "order": 2,
        "processOrder": 6,
        "rank": 2,
        "description": "Helped shape a proposal that appeared on the PB ballot but did not win funding.",
    },
    "won": {
        "label": "Inspired a winning project",
        "color": "#1a892b",
        "order": 1,
        "processOrder": 7,
        "rank": 1,
        "description": "Helped shape a ballot proposal that won funding.",
    },
    "review": {
        "label": "No recorded outcome",
        "color": "#bcbcbc",
        "order": 8,
        "processOrder": 8,
        "rank": 8,
        "description": "The available data does not say where the idea ended in the PB process.",
    },
}

WON_RE = re.compile(r"ultimately won|won funding|and won|winning project|inspired a winning")
UNDERWAY_RE = re.compile(
    r"already (?:in the city|underway|being|planned|exists?|installed|completed|happening|done|impl)"
    r"|regular part of the city|included in the city'?s budget|funded through previous"
    r"|city (?:currently|already) has|in the process of being implemented"
    r"|has been put tor?wards|city'?s (?:fy\d+ )?budget has|funded (?:in|from) a previous"
)
REFERRED_RE = re.compile(r"can be sent to|was shared with|referred to|please contact|forwarded to")
INELIGIBLE_RE = re.compile(
    r"not eligible|ineligible|not a capital|policy (?:request|change)|cannot be funded"
    r"|not on city|not city[- ]owned|private(?:ly owned)? property"
)
NOT_ADVANCED_RE = re.compile(
    r"not advanced|high priority|did not rank|did not identify|outside the scope"
    r"|did not feel|did not move|low impact|out of the scope|did not choose|chose not to"
)


def derive_outcome(row):
    win_id = row.get("Winning Project ID", "").strip()
    ist = row.get("Idea Status", "").strip().lower()
    pst = row.get("Project Status", "").strip().lower()

    if "previously winning" in ist:
        return "not_advanced"
    if (
        win_id
        or "winning project" in ist
        or "winning ballot" in ist
        or (WON_RE.search(pst) and "previous" not in pst)
    ):
        return "won"
    if "shortlist" in ist or "shortlist" in pst or "short list" in pst:
        return "shortlist"
    if "inspired a ballot" in ist or ist == "ballot project" or "advanced to ballot" in ist or (
        re.search(
            r"(?:made it (?:on)?to|moved to|advanced to|added (?:on)?to) the (?:\w+ )?ballot"
            r"|advanced to (?:final )?ballot|added but did not win",
            pst,
        )
    ):
        return "ballot"
    if (
        "already in the city" in ist
        or "already funded" in ist
        or "existing budget funding" in ist
        or "ongoing effort" in ist
        or UNDERWAY_RE.search(pst)
    ):
        return "underway"
    if INELIGIBLE_RE.search(pst):
        return "ineligible"
    if ist.startswith("not advanced") or NOT_ADVANCED_RE.search(pst):
        return "not_advanced"
    if REFERRED_RE.search(pst):
        return "referred"
    if row.get("PB Cycle", "").strip() in {"11", "12"} and pst:
        return "not_advanced"
    return "review"


CYCLE_META = {
    "1":  {"label": "PB1",  "dates": "Oct 2014 – Apr 2015", "voteYear": 2015},
    "2":  {"label": "PB2",  "dates": "Jun – Dec 2015", "voteYear": 2015},
    "3":  {"label": "PB3",  "dates": "Jun – Dec 2016", "voteYear": 2016},
    "4":  {"label": "PB4",  "dates": "Jun – Dec 2017", "voteYear": 2017},
    "5":  {"label": "PB5",  "dates": "Jun – Dec 2018", "voteYear": 2018},
    "6":  {"label": "PB6",  "dates": "Jun – Dec 2019", "voteYear": 2019},
    "7":  {"label": "PB7",  "dates": "Sep 2020 – Jan 2021", "voteYear": 2021},
    "8":  {"label": "PB8",  "dates": "Jun – Dec 2021", "voteYear": 2021},
    "9":  {"label": "PB9",  "dates": "Jun – Dec 2022", "voteYear": 2022},
    "10": {"label": "PB10", "dates": "Sep 2023 – Mar 2024", "voteYear": 2024},
    "11": {"label": "PB11", "dates": "Aug 2024 – Mar 2025", "voteYear": 2025},
    "12": {"label": "PB12", "dates": "Sep 2025 – Mar 2026", "voteYear": 2026},
}

COORD_LINE = re.compile(r"\s*\(\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)\s*$")


def clean_location(text):
    return COORD_LINE.sub("", text.replace("\r", "").strip()).strip()


def num(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def read_ideas(refresh=False):
    """The published Open Data ideas export, in portal (= upload) row order.

    Row order matters: idea deep-link IDs are row indexes. The annual ETL
    uploads cycles in order, and the portal export preserves upload order.
    """
    if refresh or not IDEAS_CACHE.exists():
        SRC.mkdir(exist_ok=True)
        print(f"Downloading ideas from {IDEAS_EXPORT_URL} ...")
        with urllib.request.urlopen(IDEAS_EXPORT_URL, timeout=300) as resp:
            IDEAS_CACHE.write_bytes(resp.read())
        print(f"Saved {IDEAS_CACHE} ({IDEAS_CACHE.stat().st_size/1024:.0f} KB)")
    return read_csv(IDEAS_CACHE)


def project_cycle(raw):
    m = re.search(r"Cycle\s*(\d+)", raw)
    return m.group(1) if m else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true",
                        help="re-download the ideas export from Open Data")
    args = parser.parse_args()

    ideas_raw = read_ideas(refresh=args.refresh)
    projects_raw = read_csv(SRC / "pb_projects.csv")
    locations_raw = read_csv(SRC / "pb_project_locations.csv")

    locs_by_id = {}
    for r in locations_raw:
        pid = r["Winning Project ID"].strip()
        lat, lng = num(r["Latitude"]), num(r["Longitude"])
        if pid and lat is not None and lng is not None:
            locs_by_id.setdefault(pid, []).append([round(lat, 6), round(lng, 6)])

    projects = []
    for r in projects_raw:
        cyc = project_cycle(r["PB Cycle"])
        pid = r["Winning Project ID"].strip()
        projects.append({
            "id": pid or None,
            "cycle": cyc,
            "name": r["Project"].strip(),
            "votes": int(v) if (v := r["Total Votes"].strip()) and v.isdigit() else None,
            "won": r["Winning project"].strip().lower() == "yes",
            "cost": int(c) if (c := r["Project Cost"].strip()) and c.isdigit() else None,
            "locationText": r["Location Description"].strip(),
            "desc": r["Short Project Description"].strip(),
            "locations": locs_by_id.get(pid, []),
        })

    ideas = []
    for i, r in enumerate(ideas_raw):
        committee = r["Committee"].strip()
        theme = COMMITTEE_TO_THEME.get(committee)
        if theme is None:
            raise SystemExit(f"Unmapped committee: {committee!r} — update COMMITTEE_TO_THEME")
        lat, lng = num(r["Latitude"]), num(r["Longitude"])
        rec = {
            "id": i,
            "ref": r["Idea #"].strip(),
            "cycle": r["PB Cycle"].strip(),
            "title": r["Project Title"].strip(),
            "desc": r["Project Description"].replace("\r", "").strip(),
            "theme": theme,
            "committee": committee,
            "outcome": derive_outcome(r),
            "status": r["Project Status"].replace("\r", "").strip(),
            "ideaStatus": r["Idea Status"].strip(),
            "location": clean_location(r["Location"]),
            "ll": [round(lat, 6), round(lng, 6)] if lat is not None and lng is not None else None,
            "win": r["Winning Project ID"].strip() or None,
            "sourceUrl": r.get("Link to Other Information", "").strip() or None,
        }
        ideas.append(rec)

    cycles_present = sorted({i["cycle"] for i in ideas} | {p["cycle"] for p in projects if p["cycle"]}, key=int)
    meta = {
        "built": date.today().isoformat(),
        "counts": {"ideas": len(ideas), "projects": len(projects),
                   "winners": sum(1 for p in projects if p["won"])},
        "cycles": [{"num": c, **CYCLE_META.get(c, {"label": f"PB{c}", "dates": "", "voteYear": None})}
                   for c in cycles_present],
        "themes": THEMES,
        "outcomes": OUTCOMES,
        "ideaStatusCycles": sorted({i["cycle"] for i in ideas if i["ideaStatus"]}, key=int),
    }

    OUT.mkdir(exist_ok=True)
    for name, obj in [("ideas.json", ideas), ("projects.json", projects), ("meta.json", meta)]:
        p = OUT / name
        p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{name}: {p.stat().st_size/1024:.0f} KB")

    from collections import Counter
    print("outcomes:", dict(Counter(i["outcome"] for i in ideas)))
    print("themes:", dict(Counter(i["theme"] for i in ideas)))
    print("geocoded:", sum(1 for i in ideas if i["ll"]))


if __name__ == "__main__":
    main()
