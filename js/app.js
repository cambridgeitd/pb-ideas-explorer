/* PB Ideas Explorer — City of Cambridge
   Static single-page app. Loads data/*.json, renders filters, a stacked
   cycle chart, a clustered Leaflet map, and a card list with a detail drawer.
   Filter state is mirrored to the URL for shareable links. */
(async function () {
  "use strict";

  const [meta, ideas, projects] = await Promise.all(
    ["data/meta.json", "data/ideas.json", "data/projects.json"].map((u) =>
      fetch(u).then((r) => r.json())
    )
  );

  const THEMES = meta.themes;
  const OUTCOMES = meta.outcomes;
  const CYCLES = meta.cycles.filter((c) => ideas.some((i) => i.cycle === c.num));
  const cycleByNum = Object.fromEntries(meta.cycles.map((c) => [c.num, c]));
  const projById = {};
  for (const p of projects) if (p.id) projById[p.id] = p;

  // Pre-computed lowercase haystack for fast search
  for (const i of ideas) {
    i._hay = (i.title + " " + i.desc + " " + i.location).toLowerCase();
  }

  // ---------- state ----------
  const state = { q: "", cycles: new Set(), themes: new Set(), outcomes: new Set() };
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function readURL() {
    const p = new URLSearchParams(location.search);
    state.q = p.get("q") || "";
    state.cycles = new Set((p.get("cycle") || "").split(",").filter(Boolean));
    state.themes = new Set((p.get("theme") || "").split(",").filter(Boolean));
    state.outcomes = new Set((p.get("outcome") || "").split(",").filter(Boolean));
    return p.get("idea");
  }
  function writeURL() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cycles.size) p.set("cycle", [...state.cycles].join(","));
    if (state.themes.size) p.set("theme", [...state.themes].join(","));
    if (state.outcomes.size) p.set("outcome", [...state.outcomes].join(","));
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    return ideas.filter((i) => {
      if (state.cycles.size && !state.cycles.has(i.cycle)) return false;
      if (state.themes.size && !state.themes.has(i.theme)) return false;
      if (state.outcomes.size && !state.outcomes.has(i.outcome)) return false;
      if (terms.length && !terms.every((t) => i._hay.includes(t))) return false;
      return true;
    });
  }

  // ---------- dropdown filters ----------
  function buildDropdowns() {
    const counts = { cycle: {}, theme: {}, outcome: {} };
    for (const i of ideas) {
      counts.cycle[i.cycle] = (counts.cycle[i.cycle] || 0) + 1;
      counts.theme[i.theme] = (counts.theme[i.theme] || 0) + 1;
      counts.outcome[i.outcome] = (counts.outcome[i.outcome] || 0) + 1;
    }
    const defs = {
      cycle: CYCLES.map((c) => ({
        key: c.num,
        html: `${c.label} <small>${esc(c.dates)}</small>`,
        n: counts.cycle[c.num] || 0,
      })).reverse(),
      theme: Object.entries(THEMES)
        .filter(([k]) => counts.theme[k])
        .map(([k, t]) => ({
          key: k,
          html: `<span class="swatch" style="background:${t.color}"></span>${esc(t.label)}`,
          n: counts.theme[k],
        })),
      outcome: Object.entries(OUTCOMES)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([k, o]) => ({
          key: k,
          html: `<span class="swatch" style="background:${o.color}"></span>${esc(o.label)}`,
          n: counts.outcome[k] || 0,
        })),
    };
    for (const dd of document.querySelectorAll(".dd")) {
      const kind = dd.dataset.dd;
      const menu = dd.querySelector(".dd-menu");
      menu.innerHTML = defs[kind]
        .map(
          (d) =>
            `<button class="dd-item" data-key="${d.key}" role="menuitemcheckbox">
              <span class="box">✓</span>${d.html}<span class="n">${d.n.toLocaleString()}</span>
            </button>`
        )
        .join("");
      dd.querySelector(".dd-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        const was = dd.classList.contains("open");
        closeDropdowns();
        dd.classList.toggle("open", !was);
      });
      menu.addEventListener("click", (e) => {
        const item = e.target.closest(".dd-item");
        if (!item) return;
        e.stopPropagation();
        const set = state[kind + "s"];
        set.has(item.dataset.key) ? set.delete(item.dataset.key) : set.add(item.dataset.key);
        update();
      });
    }
    document.addEventListener("click", closeDropdowns);
  }
  function closeDropdowns() {
    document.querySelectorAll(".dd.open").forEach((d) => d.classList.remove("open"));
  }
  function syncDropdowns() {
    for (const dd of document.querySelectorAll(".dd")) {
      const set = state[dd.dataset.dd + "s"];
      dd.querySelectorAll(".dd-item").forEach((it) =>
        it.classList.toggle("checked", set.has(it.dataset.key))
      );
      dd.querySelector(".dd-count").textContent = set.size ? set.size : "";
    }
  }

  // ---------- active chips ----------
  function renderChips() {
    const chips = [];
    if (state.q.trim())
      chips.push(`<button class="chip search-chip" data-kind="q">“${esc(state.q.trim())}” <span class="x">✕</span></button>`);
    for (const c of state.cycles)
      chips.push(`<button class="chip" data-kind="cycles" data-key="${c}">${cycleByNum[c]?.label || "PB" + c} <span class="x">✕</span></button>`);
    for (const t of state.themes)
      chips.push(`<button class="chip" data-kind="themes" data-key="${t}" style="background:${THEMES[t].color}">${esc(THEMES[t].label)} <span class="x">✕</span></button>`);
    for (const o of state.outcomes)
      chips.push(`<button class="chip" data-kind="outcomes" data-key="${o}" style="background:${OUTCOMES[o].color}">${esc(OUTCOMES[o].label)} <span class="x">✕</span></button>`);
    const row = $("#activeChips");
    row.innerHTML = chips.join("");
    row.hidden = !chips.length;
    $("#resetBtn").hidden = !chips.length;
  }
  $("#activeChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.dataset.kind === "q") {
      state.q = "";
      $("#search").value = "";
    } else state[chip.dataset.kind].delete(chip.dataset.key);
    update();
  });
  $("#resetBtn").addEventListener("click", () => {
    state.q = "";
    $("#search").value = "";
    state.cycles.clear();
    state.themes.clear();
    state.outcomes.clear();
    update();
  });

  // ---------- chart ----------
  let chartMode = "theme";
  let chartScale = "count";
  const cycleTotalsAll = {};
  for (const i of ideas) cycleTotalsAll[i.cycle] = (cycleTotalsAll[i.cycle] || 0) + 1;
  const fmtPct = (v) =>
    v >= 99.95 ? "100%" : v >= 10 ? Math.round(v) + "%" : v > 0 ? v.toFixed(1) + "%" : "0%";
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.style.display = "none";
  document.body.appendChild(tip);

  function renderChart(rows) {
    const groups = chartMode === "theme" ? THEMES : OUTCOMES;
    const keys =
      chartMode === "theme"
        ? Object.keys(THEMES)
        : Object.entries(OUTCOMES).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
    // counts[cycle][key]
    const counts = {};
    for (const c of CYCLES) counts[c.num] = {};
    for (const i of rows) {
      const k = chartMode === "theme" ? i.theme : i.outcome;
      counts[i.cycle][k] = (counts[i.cycle][k] || 0) + 1;
    }
    const totals = CYCLES.map((c) => Object.values(counts[c.num]).reduce((a, b) => a + b, 0));
    const pct = chartScale === "pct";
    // In % mode a bar's height is the share of ALL ideas submitted that cycle
    // which matched the current filters — normalizing for cycle size.
    const values = CYCLES.map((c, ci) => (pct ? (totals[ci] / cycleTotalsAll[c.num]) * 100 : totals[ci]));
    const max = Math.max(pct ? 0.0001 : 1, ...values);
    const hasFilters =
      state.q.trim() || state.cycles.size || state.themes.size || state.outcomes.size;
    $("#chartHint").textContent = !pct
      ? "Each bar is one PB cycle — click a bar to filter to that cycle."
      : hasFilters
        ? "Bars show what share of each cycle's submitted ideas match your current filters — a fair comparison across cycles of different sizes."
        : "Without a search or filter, every cycle is 100% of itself — the stacked segments show each cycle's mix. Add a search (e.g. “dog park”) to track its share of ideas over time.";
    const W = 640, H = 260, padL = 8, padB = 40, padT = 18;
    const bw = (W - padL * 2) / CYCLES.length;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ideas per cycle">`;
    CYCLES.forEach((c, ci) => {
      const x = padL + ci * bw;
      const selCls = state.cycles.has(c.num) ? " cycle-selected" : "";
      svg += `<g class="bar${selCls}" data-cycle="${c.num}" data-total="${totals[ci]}" data-all="${cycleTotalsAll[c.num]}">`;
      let y = H - padB;
      for (const k of keys) {
        const v = counts[c.num][k] || 0;
        if (!v) continue;
        const scaled = pct ? (v / cycleTotalsAll[c.num]) * 100 : v;
        const h = ((H - padB - padT) * scaled) / max;
        y -= h;
        svg += `<rect class="bar-seg" x="${(x + bw * 0.13).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.74).toFixed(1)}" height="${Math.max(h, 0.75).toFixed(1)}" fill="${groups[k].color}" data-k="${k}" data-v="${v}"></rect>`;
      }
      if (totals[ci])
        svg += `<text class="total-label" x="${x + bw / 2}" y="${y - 5}">${pct ? fmtPct(values[ci]) : totals[ci].toLocaleString()}</text>`;
      svg += `<text class="axis-label" x="${x + bw / 2}" y="${H - padB + 16}">${c.label}</text>`;
      svg += `<text class="axis-sub" x="${x + bw / 2}" y="${H - padB + 29}">${(c.dates.match(/\d{4}/g) || []).pop() || ""}</text>`;
      svg += `<rect class="bar-hit" x="${x}" y="0" width="${bw}" height="${H}" fill="transparent" style="cursor:pointer"></rect>`;
      svg += `</g>`;
    });
    svg += "</svg>";
    $("#chart").innerHTML = svg;
    $("#chartLegend").innerHTML = keys
      .map((k) => `<span><i style="background:${groups[k].color}"></i>${esc(groups[k].label)}</span>`)
      .join("");

    const svgEl = $("#chart svg");
    svgEl.addEventListener("click", (e) => {
      const g = e.target.closest("g.bar");
      if (!g) return;
      const c = g.dataset.cycle;
      state.cycles.has(c) ? state.cycles.delete(c) : state.cycles.add(c);
      update();
    });
    svgEl.addEventListener("mousemove", (e) => {
      const g = e.target.closest("g.bar");
      if (!g) return (tip.style.display = "none");
      const c = cycleByNum[g.dataset.cycle];
      const all = +g.dataset.all;
      const tot = +g.dataset.total;
      const rowsHtml = [...g.querySelectorAll(".bar-seg")]
        .reverse()
        .map(
          (r) =>
            `<div><span style="color:${r.getAttribute("fill")}">●</span> ${esc(groups[r.dataset.k].label)}: <b>${(+r.dataset.v).toLocaleString()}</b>${chartScale === "pct" ? ` <span style="color:#8a8d92">(${fmtPct(((+r.dataset.v) / all) * 100)})</span>` : ""}</div>`
        )
        .join("");
      const summary = `<div style="margin-top:5px;color:#6b7075">${tot.toLocaleString()} of ${all.toLocaleString()} ideas that cycle (${fmtPct((tot / all) * 100)})</div>`;
      tip.innerHTML = `<b>${c.label}</b> · ${esc(c.dates)}${rowsHtml ? "<hr style='border:0;border-top:1px solid #eee;margin:5px 0'>" + rowsHtml + summary : "<div>No matching ideas</div>"}`;
      tip.style.display = "block";
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tw - 8) + "px";
      tip.style.top = e.clientY + 14 + "px";
    });
    svgEl.addEventListener("mouseleave", () => (tip.style.display = "none"));
  }
  document.querySelectorAll(".seg-btn[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      chartMode = b.dataset.mode;
      document.querySelectorAll(".seg-btn[data-mode]").forEach((x) => x.classList.toggle("active", x === b));
      renderChart(current);
    })
  );
  document.querySelectorAll(".seg-btn[data-scale]").forEach((b) =>
    b.addEventListener("click", () => {
      chartScale = b.dataset.scale;
      document.querySelectorAll(".seg-btn[data-scale]").forEach((x) => x.classList.toggle("active", x === b));
      renderChart(current);
    })
  );

  // ---------- map ----------
  const map = L.map("map", { scrollWheelZoom: true }).setView([42.3765, -71.111], 13);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);
  const cluster = L.markerClusterGroup({
    // Small radius + earlier cutoff so individual dots (nicer than numbered
    // boxes) take over as soon as the map is only moderately zoomed in.
    maxClusterRadius: 20,
    disableClusteringAtZoom: 15,
    showCoverageOnHover: false,
  });
  map.addLayer(cluster);
  window.__map = map; // debug/testing handle

  function renderMap(rows) {
    cluster.clearLayers();
    const markers = [];
    let located = 0;
    for (const i of rows) {
      if (!i.ll) continue;
      located++;
      const m = L.circleMarker(i.ll, {
        radius: 6,
        weight: 1.5,
        color: "#fff",
        fillColor: THEMES[i.theme].color,
        fillOpacity: 0.92,
      });
      m.bindPopup(
        `<div class="map-pop"><b>${esc(i.title)}</b>
         <div class="pop-badges">${badgeHTML(i, true)}</div>
         <button onclick="window.__openIdea(${i.id})">See details →</button></div>`,
        { maxWidth: 260 }
      );
      markers.push(m);
    }
    cluster.addLayers(markers);
    $("#mapNote").textContent = `${located.toLocaleString()} of ${rows.length.toLocaleString()} shown ideas have a location`;
  }

  // ---------- cards ----------
  const PAGE = 30;
  let shown = PAGE;
  let current = [];
  const outcomeRank = Object.fromEntries(Object.entries(OUTCOMES).map(([k, o]) => [k, o.order]));

  function badgeHTML(i, compact) {
    const t = THEMES[i.theme], o = OUTCOMES[i.outcome];
    let h = `<span class="badge cycle-badge">${cycleByNum[i.cycle]?.label || "PB" + i.cycle}</span>
      <span class="badge"><span class="dot" style="background:${t.color}"></span>${esc(t.label)}</span>`;
    if (i.outcome !== "review")
      h += `<span class="badge outcome-badge" style="background:${o.color}">${esc(o.label)}</span>`;
    if (!compact && i.location)
      h += `<span class="badge loc-badge">📍 ${esc(i.location.split("\n")[0].slice(0, 60))}</span>`;
    return h;
  }

  function highlight(text) {
    const q = state.q.trim().toLowerCase();
    if (!q) return esc(text);
    let out = esc(text);
    for (const term of new Set(q.split(/\s+/).filter((t) => t.length > 1))) {
      out = out.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
    }
    return out;
  }

  function renderCards(rows) {
    const sort = $("#sortSel").value;
    rows = rows.slice();
    if (sort === "new") rows.sort((a, b) => +b.cycle - +a.cycle || a.id - b.id);
    else if (sort === "old") rows.sort((a, b) => +a.cycle - +b.cycle || a.id - b.id);
    else rows.sort((a, b) => outcomeRank[a.outcome] - outcomeRank[b.outcome] || +b.cycle - +a.cycle);
    current = rows;

    const page = rows.slice(0, shown);
    $("#cards").innerHTML = page
      .map(
        (i) => `<article class="card" data-id="${i.id}" style="border-left-color:${THEMES[i.theme].color}" tabindex="0" role="button" aria-label="${esc(i.title)}">
          <h3>${highlight(i.title)}</h3>
          <p class="desc">${highlight(i.desc.slice(0, 260))}</p>
          <div class="badges">${badgeHTML(i)}</div>
        </article>`
      )
      .join("");
    $("#moreBtn").hidden = rows.length <= shown;
    $("#moreBtn").textContent = `Show more ideas (${(rows.length - shown).toLocaleString()} remaining)`;
    $("#noResults").hidden = rows.length > 0;
    $("#listTitle").textContent =
      rows.length === ideas.length ? "All ideas" : `Matching ideas (${rows.length.toLocaleString()})`;
  }
  $("#moreBtn").addEventListener("click", () => {
    shown += PAGE * 2;
    renderCards(current);
  });
  $("#sortSel").addEventListener("change", () => {
    shown = PAGE;
    renderCards(current);
  });
  $("#cards").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openDrawer(+card.dataset.id);
  });
  $("#cards").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".card");
    if (card) openDrawer(+card.dataset.id);
  });

  // ---------- drawer ----------
  let drawerMap = null;
  function openDrawer(id) {
    const i = ideas[id];
    if (!i) return;
    const o = OUTCOMES[i.outcome];
    const proj = i.win ? projById[i.win] : null;
    let html = `<div class="badges">${badgeHTML(i, true)}</div>
      <h2 id="drawerTitle">${esc(i.title)}</h2>
      <div class="drawer-sec"><h3>Idea</h3><p>${esc(i.desc) || "<em>No description recorded.</em>"}</p></div>`;
    if (i.status && i.status.toLowerCase() !== "to be determined")
      html += `<div class="drawer-sec"><h3>What happened</h3><div class="status-quote">${esc(i.status)}</div></div>`;
    else
      html += `<div class="drawer-sec"><h3>What happened</h3><p><em>No outcome was recorded for this idea.</em></p></div>`;
    if (proj) {
      html += `<div class="drawer-sec"><h3>Winning ballot project it inspired</h3>
        <div class="win-card"><b>${esc(proj.name)}</b> <span style="color:#666">(${cycleByNum[proj.cycle]?.label || ""})</span>
        <p style="margin:6px 0 0;font-size:13.5px">${esc(proj.desc)}</p>
        <div class="win-facts">
          ${proj.votes != null ? `<span><strong>${proj.votes.toLocaleString()}</strong> votes</span>` : ""}
          ${proj.cost != null ? `<span><strong>$${proj.cost.toLocaleString()}</strong> funded</span>` : ""}
          ${proj.locations.length ? `<span><strong>${proj.locations.length}</strong> location${proj.locations.length > 1 ? "s" : ""}</span>` : ""}
        </div></div></div>`;
    }
    html += `<div class="drawer-sec"><h3>Details</h3><p>
      <strong>Cycle:</strong> ${cycleByNum[i.cycle]?.label || "PB" + i.cycle} (${esc(cycleByNum[i.cycle]?.dates || "")})<br>
      <strong>Committee:</strong> ${esc(i.committee || "—")}<br>
      ${i.location ? `<strong>Location:</strong> ${esc(i.location.split("\n")[0])}<br>` : ""}
      <strong>Idea #:</strong> ${esc(i.ref)}</p></div>`;
    if (i.ll || (proj && proj.locations.length)) html += `<div class="drawer-sec"><h3>On the map</h3><div id="drawerMap"></div></div>`;

    $("#drawerBody").innerHTML = html;
    $("#drawer").hidden = false;
    $("#drawerScrim").hidden = false;
    $("#drawer").scrollTop = 0;
    document.body.style.overflow = "hidden";

    if (i.ll || (proj && proj.locations.length)) {
      if (drawerMap) drawerMap.remove();
      drawerMap = L.map("drawerMap", { scrollWheelZoom: false, dragging: !L.Browser.mobile });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(drawerMap);
      const pts = [];
      if (i.ll) {
        L.circleMarker(i.ll, { radius: 8, weight: 2, color: "#fff", fillColor: THEMES[i.theme].color, fillOpacity: 1 })
          .addTo(drawerMap)
          .bindTooltip("Idea location");
        pts.push(i.ll);
      }
      if (proj)
        for (const ll of proj.locations) {
          L.circleMarker(ll, { radius: 7, weight: 2, color: "#fff", fillColor: "#1a892b", fillOpacity: 1 })
            .addTo(drawerMap)
            .bindTooltip("Winning project location");
          pts.push(ll);
        }
      drawerMap.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 16 });
    }
    const p = new URLSearchParams(location.search);
    p.set("idea", i.id);
    history.replaceState(null, "", "?" + p.toString());
  }
  window.__openIdea = openDrawer;

  function closeDrawer() {
    $("#drawer").hidden = true;
    $("#drawerScrim").hidden = true;
    document.body.style.overflow = "";
    const p = new URLSearchParams(location.search);
    p.delete("idea");
    history.replaceState(null, "", p.toString() ? "?" + p.toString() : location.pathname);
  }
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerScrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
  });

  // ---------- search ----------
  let debounce;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = e.target.value;
      update();
    }, 160);
  });

  // ---------- master update ----------
  function update() {
    shown = PAGE;
    writeURL();
    syncDropdowns();
    renderChips();
    const rows = filtered();
    $("#resultCount").textContent = `${rows.length.toLocaleString()} of ${ideas.length.toLocaleString()} ideas`;
    renderChart(rows);
    renderMap(rows);
    renderCards(rows);
  }

  // ---------- init ----------
  $("#introTotal").textContent = ideas.length.toLocaleString();
  $("#builtDate").textContent = meta.built;
  buildDropdowns();
  const deepIdea = readURL();
  $("#search").value = state.q;
  update();
  if (deepIdea != null && ideas[+deepIdea]) openDrawer(+deepIdea);
})();
