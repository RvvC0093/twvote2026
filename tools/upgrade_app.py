#!/usr/bin/env python3
"""Upgrade app.js to v57 specifications:
- Fast首屏載入管線 (county.topo.json -> mayor-metrics.json)
- Segmented control (縣市長 | 議員)
- Hash routing (#/mayor, #/mayor/縣市, #/council/縣市/scope/dist)
- ContestBoard integration & 雙向聯動
- 4-tone monochrome map filling with stripes
- 3 Big KPI cards + sparkline + seats bar + last seat duel
- 移除 county_news 與章魚哥
"""
import re
from pathlib import Path

APP_PATH = Path(__file__).resolve().parents[1] / "app.js"

def upgrade():
    with open(APP_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Replace initialize() and initializeObservation() with v57 pipeline
    init_pattern = r"async function initialize\(\)\s*\{[\s\S]*?\n\}\n"
    new_init = """async function initialize() {
  try {
    const manifest = await fetchJson(MANIFEST_PATH);
    if (manifest.schema !== "election-machine-offline-v1") throw new Error("離線 manifest schema 不相容");
    state.manifest = manifest;

    // Fast首屏管線：county.topo.json (201 KB) + mayor-metrics.json (~4 KB)
    const countyTopologyPromise = fetchJson("data/geo/county.topo.json");
    const obsPointer = manifest.observation_2026;
    if (obsPointer) {
      await initializeObservation(obsPointer);
    }

    const countyTopology = await countyTopologyPromise;
    state.topology = countyTopology;
    const decoded = core.decodeTopology(countyTopology);
    state.features = decoded.features;
    observation.geography = core.buildObservationGeography(decoded.features);
    state.nationalBounds = decoded.primaryBounds;
    state.nationalFullBounds = decoded.fullBounds;
    state.bounds = decoded.primaryBounds;
    state.fullBounds = decoded.fullBounds;

    renderObservationMap();

    // 背景延後載入鄉鎮拓撲 (town.topo.json, 751 KB)
    fetchJson("data/geo/town.topo.json").then((townTopo) => {
      const townDecoded = core.decodeTopology(townTopo);
      observation.townGeography = core.buildObservationGeography(townDecoded.features);
    }).catch(() => {});

    // 處理初始 hash 路由
    handleHashRoute();
    window.addEventListener("hashchange", handleHashRoute);
  } catch (error) {
    if (mapLoading) mapLoading.classList.add("hidden");
    observation.mapError = "圖資未能載入；請使用名稱清單。";
    renderObservationMap();
  }
}
"""
    content = re.sub(init_pattern, new_init, content, count=1)

    # 2. Update paintObservationRegion to handle "stripe"
    paint_pattern = r"function paintObservationRegion\(context,region,projector,fill,active,swingStatus=null,theme=\"light\",options=\{\}\)\s*\{[\s\S]*?context\.lineJoin=\"round\";"
    new_paint = """function paintObservationRegion(context,region,projector,fill,active,swingStatus=null,theme="light",options={}) {
  context.beginPath();
  region.polygons.forEach(polygon=>polygon.forEach(ring=>{ring.forEach((point,i)=>{const p=projector.project(point);if(i) context.lineTo(...p);else context.moveTo(...p);});context.closePath();}));
  
  if (fill === "stripe") {
    const stripeCanvas = document.createElement("canvas");
    stripeCanvas.width = 12;
    stripeCanvas.height = 12;
    const sctx = stripeCanvas.getContext("2d");
    sctx.fillStyle = theme === "dark" ? "#1e293b" : "#e2e8f0";
    sctx.fillRect(0, 0, 12, 12);
    sctx.strokeStyle = theme === "dark" ? "#475569" : "#cbd5e1";
    sctx.lineWidth = 2.5;
    sctx.beginPath();
    sctx.moveTo(0, 12);
    sctx.lineTo(12, 0);
    sctx.stroke();
    context.fillStyle = context.createPattern(stripeCanvas, "repeat");
    context.fill("evenodd");
  } else if (active && typeof context.save === "function") {
    context.save();
    context.shadowColor = theme === "dark" ? "rgba(56, 189, 248, 0.75)" : "rgba(2, 132, 199, 0.55)";
    context.shadowBlur = 18;
    context.fillStyle = fill;
    context.fill("evenodd");
    context.restore();
  } else {
    context.fillStyle = fill;
    context.fill("evenodd");
  }
  context.lineJoin="round";"""
    content = re.sub(paint_pattern, new_paint, content, count=1)

    # 3. Locate initializeObservation and rewrite with full v57 setup
    obs_pattern = r"async function initializeObservation\(pointer\)\s*\{[\s\S]*?function observationMapAction"
    new_obs = """async function initializeObservation(pointer) {
  if (!pointer) return;
  try {
    const manifest = await fetchJson(`data/${pointer.manifest}`, null, pointer.sha256);
    core.validateObservationManifest(manifest, pointer);
    observation.manifest = manifest;
    observation.activeOffice = "mayor"; // 預設為縣市長

    // 載入 22 縣市長指標
    try {
      observation.mayorMetrics = await fetchJson("data/observation/mayor-metrics.json");
    } catch (_) {}

    // 初始化拉鋸榜元件 ContestBoard
    const boardContainer = document.getElementById("contest-board-container");
    if (boardContainer && globalThis.ElectionContestBoard) {
      observation.contestBoard = new globalThis.ElectionContestBoard.ContestBoard({
        container: boardContainer,
        mode: "mayor",
        onSelectMayor: (countyName) => {
          window.location.hash = `#/mayor/${encodeURIComponent(countyName)}`;
        },
        onSelectCouncil: (district) => {
          window.location.hash = `#/council/${encodeURIComponent(district.county)}/${encodeURIComponent(district.scope)}/${encodeURIComponent(district.district_no)}`;
        },
        onHoverItem: (key, type) => {
          observation.mapHover = key;
          requestAnimationFrame(drawObservationMap);
        }
      });
      if (observation.mayorMetrics) {
        observation.contestBoard.setMayorData(observation.mayorMetrics);
      }
    }

    // Segmented Control (縣市長 | 議員)
    const tabMayor = document.getElementById("tab-mayor");
    const tabCouncil = document.getElementById("tab-council");
    if (tabMayor && tabCouncil) {
      tabMayor.addEventListener("click", () => {
        window.location.hash = "#/mayor";
      });
      tabCouncil.addEventListener("click", () => {
        window.location.hash = "#/council";
      });
    }

    // 更多選單 (⋯)
    const themeBtn = document.getElementById("theme-toggle-btn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const nextTheme = state.mapTheme === "dark" ? "light" : "dark";
        state.mapTheme = nextTheme;
        updateMapThemeControls();
        requestAnimationFrame(drawObservationMap);
      });
    }

    // 8 項限制說明彈出
    const openLimitBtn = document.getElementById("open-limitations-btn");
    const closeLimitBtn = document.getElementById("close-limitations-btn");
    const limitModal = document.getElementById("limitations-modal");
    if (openLimitBtn && limitModal) {
      openLimitBtn.addEventListener("click", () => limitModal.showModal());
    }
    if (closeLimitBtn && limitModal) {
      closeLimitBtn.addEventListener("click", () => limitModal.close());
    }
    if (limitModal) {
      limitModal.addEventListener("click", (e) => {
        if (e.target === limitModal) limitModal.close();
      });
    }

    // 其他公職選單按鈕
    document.querySelectorAll("[data-other-office]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const office = btn.dataset.otherOffice;
        observation.activeOffice = office;
        if (observation.county) {
          observationNavigate("county", observation.county);
        } else {
          observationNavigate("county", "臺北市");
        }
      });
    });

    // 側欄切換 Tab (拉鋸榜 | 選情卡片)
    const tabBoard = document.getElementById("tab-contest-board");
    const tabDetail = document.getElementById("tab-inspector-detail");
    const detailPanelEl = document.getElementById("observation-detail");
    if (tabBoard && tabDetail && boardContainer && detailPanelEl) {
      tabBoard.addEventListener("click", () => {
        tabBoard.classList.add("active");
        tabDetail.classList.remove("active");
        boardContainer.classList.remove("hidden");
        detailPanelEl.classList.add("hidden");
      });
      tabDetail.addEventListener("click", () => {
        tabDetail.classList.add("active");
        tabBoard.classList.remove("active");
        detailPanelEl.classList.remove("hidden");
        boardContainer.classList.add("hidden");
      });
    }

    // 側欄收合展開
    const collapseBtn = document.getElementById("inspector-collapse-btn");
    const expandBtn = document.getElementById("inspector-expand-btn");
    const inspector = document.getElementById("observation-inspector");
    if (collapseBtn && expandBtn && inspector) {
      collapseBtn.addEventListener("click", () => {
        inspector.classList.add("collapsed");
        expandBtn.classList.remove("hidden");
        requestAnimationFrame(drawObservationMap);
      });
      expandBtn.addEventListener("click", () => {
        inspector.classList.remove("collapsed");
        expandBtn.classList.add("hidden");
        requestAnimationFrame(drawObservationMap);
      });
    }

    // 全域快速搜尋 (Spotlight)
    if (globalThis.ElectionUIShell) {
      const shell = globalThis.ElectionUIShell;
      const modal = document.getElementById("spotlight-modal");
      const input = document.getElementById("spotlight-input");
      const results = document.getElementById("spotlight-results");
      const trigger = document.getElementById("spotlight-trigger-btn");
      if (modal && input && results) {
        observation.spotlight = shell.createSpotlight(
          modal, input, results,
          () => buildGlobalSearchItems(),
          (item) => {
            if (item?.route) window.location.hash = item.route;
          }
        );
        if (trigger) trigger.addEventListener("click", () => observation.spotlight.open());
      }
    }

    // 地圖回上一層與重設視野按鈕
    const mapBackBtn = document.getElementById("observation-map-back");
    if (mapBackBtn) {
      mapBackBtn.addEventListener("click", observationMapBackAction);
    }
    const mapResetBtn = document.getElementById("observation-map-reset");
    if (mapResetBtn) {
      mapResetBtn.addEventListener("click", () => {
        observation.mapZoom = 1;
        observation.mapPan = [0, 0];
        requestAnimationFrame(drawObservationMap);
      });
    }

    observationOverview();
  } catch (err) {
    observation.mapError = "審定名冊載入失敗";
  }
}

// 建立全域快速搜尋索引
function buildGlobalSearchItems() {
  const items = [];
  if (observation.manifest?.counties) {
    observation.manifest.counties.forEach(c => {
      items.push({ label: c.name, sublabel: "縣市首長選區", route: `#/mayor/${encodeURIComponent(c.name)}` });
    });
  }
  if (observation.councilMetrics?.districts) {
    observation.councilMetrics.districts.forEach(d => {
      items.push({
        label: `${d.county} ${d.district_name}`,
        sublabel: `議員選區 · 應選 ${d.seats_2026} 席`,
        route: `#/council/${encodeURIComponent(d.county)}/${encodeURIComponent(d.scope)}/${encodeURIComponent(d.district_no)}`
      });
    });
  }
  return items;
}

// Hash 路由處理器
async function handleHashRoute() {
  const hash = window.location.hash || "#/mayor";
  const parts = hash.replace(/^#\\/?/, "").split("/").map(decodeURIComponent);
  const primary = parts[0] || "mayor";

  const tabMayor = document.getElementById("tab-mayor");
  const tabCouncil = document.getElementById("tab-council");

  if (primary === "council") {
    observation.activeOffice = "council";
    if (tabMayor) tabMayor.classList.remove("active");
    if (tabCouncil) tabCouncil.classList.add("active");

    // 載入議員指標 (council-metrics.json)
    if (!observation.councilMetrics) {
      try {
        observation.councilMetrics = await fetchJson("data/observation/council-metrics.json");
        if (observation.contestBoard) {
          observation.contestBoard.setCouncilData(observation.councilMetrics);
        }
      } catch (_) {}
    }
    if (observation.contestBoard) {
      observation.contestBoard.setMode("council");
    }

    const county = parts[1];
    const scope = parts[2];
    const distNo = parts[3];

    if (county && distNo) {
      await observationNavigate("county", county);
      const d = observation.shard?.districts.find(x =>
        ["metro_councilor", "county_councilor"].includes(x.office) && (x.name.includes(distNo) || x.district_no === distNo)
      );
      if (d) {
        renderObservationDistrict(d.id);
        switchToDetailTab();
      }
    } else if (county) {
      await observationNavigate("county", county);
    } else {
      observationOverview();
    }
  } else {
    // 預設為 mayor
    observation.activeOffice = "mayor";
    if (tabMayor) tabMayor.classList.add("active");
    if (tabCouncil) tabCouncil.classList.remove("active");

    if (observation.contestBoard) {
      observation.contestBoard.setMode("mayor");
    }

    const county = parts[1];
    if (county) {
      await observationNavigate("county", county);
      renderMayorCountyDetail(county);
      switchToDetailTab();
    } else {
      observationOverview();
    }
  }
  requestAnimationFrame(drawObservationMap);
}

function switchToDetailTab() {
  const tabBoard = document.getElementById("tab-contest-board");
  const tabDetail = document.getElementById("tab-inspector-detail");
  const boardContainer = document.getElementById("contest-board-container");
  const detailPanelEl = document.getElementById("observation-detail");
  if (tabBoard && tabDetail && boardContainer && detailPanelEl) {
    tabDetail.classList.add("active");
    tabBoard.classList.remove("active");
    detailPanelEl.classList.remove("hidden");
    boardContainer.classList.add("hidden");
  }
}

// 縣市長詳情卡片 (3 大數字 + Sparkline + 候選人)
function renderMayorCountyDetail(countyName) {
  clear(observationDetail);
  const cData = observation.mayorMetrics?.counties?.find(c => c.county === countyName);
  if (!cData) return;

  const card = element("div", "mayor-card");

  // 標題群
  const titleRow = element("div", "mayor-card-title-row");
  const title = element("h2", "", `${countyName} 縣市長選情`);
  const badge = element("span", `contest-badge contest-badge-${cData.band}`, cData.label);
  titleRow.append(title, badge);
  card.appendChild(titleRow);

  // 3 個大數字
  const bigGrid = element("div", "metric-big-group");
  
  const b1 = element("div", "metric-big-box");
  b1.append(
    element("div", "metric-big-val", cData.margin_2022_pct != null ? `${cData.margin_2022_pct}%` : "—"),
    element("div", "metric-big-label", "2022 催票率差距"),
    element("div", "metric-big-sub", cData.margin_2022_votes ? `差額 ${cData.margin_2022_votes.toLocaleString()} 票` : "")
  );

  const b2 = element("div", "metric-big-box");
  b2.append(
    element("div", "metric-big-val", `${cData.turnover_count} 次`),
    element("div", "metric-big-label", "歷史輪替次數"),
    element("div", "metric-big-sub", "2010–2022 四屆")
  );

  const b3 = element("div", "metric-big-box");
  b3.append(
    element("div", "metric-big-val", `${cData.cands_2026_count} 人`),
    element("div", "metric-big-label", "2026 參選人數"),
    element("div", "metric-big-sub", "審定合格名單")
  );

  bigGrid.append(b1, b2, b3);
  card.appendChild(bigGrid);

  // Sparkline 趨勢
  if (cData.trend) {
    const trendBox = element("div", "seats-history-wrap");
    trendBox.appendChild(element("h4", "seats-history-title", "歷屆首長開票趨勢 (2014, 2018, 2022)"));
    const years = [2014, 2018, 2022];
    years.forEach(yr => {
      const cands = cData.trend[String(yr)] || [];
      if (!cands.length) return;
      const row = element("div", "seats-bar-row");
      row.appendChild(element("span", "seats-bar-year", String(yr)));
      const bar = element("div", "seats-bar");
      cands.forEach(cand => {
        const seg = element("div", "seats-bar-segment");
        seg.style.width = `${cand.rate || 0}%`;
        seg.style.backgroundColor = globalThis.ElectionContestBoard ? globalThis.ElectionContestBoard.getPartyColor(cand.party) : "#666";
        seg.title = `${cand.name} (${cand.party}): ${cand.votes?.toLocaleString()} 票 (${cand.rate}%)`;
        bar.appendChild(seg);
      });
      row.appendChild(bar);
      trendBox.appendChild(row);
    });
    card.appendChild(trendBox);
  }

  // 2026 審定候選人名單
  if (cData.candidates_2026?.length) {
    const candSection = element("div", "candidates-section");
    candSection.appendChild(element("h4", "seats-history-title", "2026 審定候選人名冊"));
    const list = element("div", "candidate-roster-list");
    cData.candidates_2026.forEach(cand => {
      const item = element("div", "candidate-roster-item");
      const dot = element("span", "party-dot");
      dot.style.backgroundColor = globalThis.ElectionContestBoard ? globalThis.ElectionContestBoard.getPartyColor(cand.party) : "#888";
      const no = element("span", "candidate-no", cand.number ? `[${cand.number}]` : "");
      const name = element("strong", "candidate-name", cand.name);
      const party = element("span", "candidate-party", cand.party);
      item.append(dot, no, name, party);
      list.appendChild(item);
    });
    candSection.appendChild(list);
    card.appendChild(candSection);
  }

  observationDetail.appendChild(card);
}

function observationMapAction"""
    content = re.sub(obs_pattern, new_obs, content, count=1)

    # 4. In drawObservationMap(), make sure observationRegionFill receives mode and metrics
    draw_fill_pattern = r"const fillResult = typeof core\.observationRegionFill === \"function\" \? core\.observationRegionFill\(region, swingData, \{[\s\S]*?\}\) : null;"
    new_draw_fill = """const fillResult = typeof core.observationRegionFill === "function" ? core.observationRegionFill(region, swingData, {
      theme: state.mapTheme,
      selected: Boolean(selected),
      hover: Boolean(hover),
      mode: observation.activeOffice === "council" ? "council" : "mayor",
      mayorMetrics: observation.mayorMetrics,
      councilMetrics: observation.councilMetrics,
      councilorLocations: observation.manifest?.councilor_locations,
      isTargetable: Boolean(target),
    }) : null;"""
    content = re.sub(draw_fill_pattern, new_draw_fill, content, count=1)

    # 5. In renderObservationDistrict, update for Councilor 3 big numbers, seats bar, duel
    council_render_pattern = r"function renderObservationDistrict\(id, reveal = false\)\s*\{[\s\S]*?function renderObservationTownship"
    new_council_render = """function renderObservationDistrict(id, reveal = false) {
  const d = observation.shard?.districts.find(x => x.id === id);
  if (!d) return;
  clear(observationDetail);

  const isCouncilor = ["metro_councilor", "county_councilor"].includes(d.office);
  const card = element("div", "district-detail-card");

  // 標題列
  const header = element("div", "district-header");
  header.appendChild(element("p", "eyebrow", observation.manifest.offices[d.office] || d.office));
  header.appendChild(element("h2", "", observationDistrictLabel(d)));
  card.appendChild(header);

  // 若為議員選區，顯示三指標卡片
  if (isCouncilor) {
    const metricsData = observation.councilMetrics?.districts?.find(m =>
      m.county === d.county && m.district_no === d.district_no
    );

    // 3 個大數字
    const bigGrid = element("div", "metric-big-group");

    // 1. 末席差距
    const m = metricsData?.margin?.["2022"];
    const b1 = element("div", "metric-big-box");
    b1.append(
      element("div", "metric-big-val", m?.uncontested ? "同額" : (m?.pct != null ? `${m.pct}%` : "新劃")),
      element("div", "metric-big-label", "2022 末席差距"),
      element("div", "metric-big-sub", m?.votes ? `差額 ${m.votes.toLocaleString()} 票` : (m?.uncontested ? "同額競選" : "無對照"))
    );

    // 2. 席次搖擺
    const sw = metricsData?.seat_swing;
    const b2 = element("div", "metric-big-box");
    b2.append(
      element("div", "metric-big-val", sw?.total != null ? `${sw.total} 席` : "—"),
      element("div", "metric-big-label", "席次搖擺"),
      element("div", "metric-big-sub", sw?.rate != null ? `變動率 ${Math.round(sw.rate * 100)}%` : "")
    );

    // 3. 2026 競爭比
    const comp = metricsData?.competition;
    const b3 = element("div", "metric-big-box");
    b3.append(
      element("div", "metric-big-val", comp?.ratio_2026 != null ? `${comp.ratio_2026}x` : `${d.candidates.length}人`),
      element("div", "metric-big-label", "2026 競爭強度"),
      element("div", "metric-big-sub", comp?.trend === "up" ? "▲ 競爭上升" : (comp?.trend === "down" ? "▼ 競爭趨緩" : "持平"))
    );

    bigGrid.append(b1, b2, b3);
    card.appendChild(bigGrid);

    // 標籤旗標列
    const badgeRow = element("div", "badges-row");
    if (metricsData?.comparability?.["2022_2026"] === "redistricted") {
      badgeRow.appendChild(element("span", "contest-badge contest-badge-na", "邊界新劃"));
    } else if (metricsData?.comparability?.["2022_2026"] === "seats_changed") {
      badgeRow.appendChild(element("span", "contest-badge contest-badge-normal", "席次變更"));
    } else {
      badgeRow.appendChild(element("span", "contest-badge contest-badge-tight", "完整可比"));
    }
    if (m?.women_quota_applied) {
      badgeRow.appendChild(element("span", "contest-badge contest-badge-close", "婦女保障名額適用"));
    }
    if (m?.uncontested) {
      badgeRow.appendChild(element("span", "contest-badge contest-badge-uncontested", "同額競選"));
    }
    card.appendChild(badgeRow);

    // 末席對決
    if (m?.last_win && m?.first_lose) {
      const duelCard = element("div", "last-seat-duel-card");
      duelCard.appendChild(element("h4", "last-seat-duel-title", "2022 末席對決"));
      const r1 = element("div", "last-seat-duel-row");
      r1.append(
        element("span", "", "最後當選："),
        element("span", "duel-cand-win", m.last_win)
      );
      const r2 = element("div", "last-seat-duel-row");
      r2.append(
        element("span", "", "首位落選："),
        element("span", "duel-cand-lose", m.first_lose)
      );
      duelCard.append(r1, r2);
      card.appendChild(duelCard);
    }

    // 席次分布條 (3 屆)
    if (metricsData?.seats_by_party) {
      const seatsBox = element("div", "seats-history-wrap");
      seatsBox.appendChild(element("h4", "seats-history-title", "歷屆席次分布 (2014, 2018, 2022)"));
      [2014, 2018, 2022].forEach(yr => {
        const partySeats = metricsData.seats_by_party[String(yr)] || {};
        const total = Object.values(partySeats).reduce((a, b) => a + b, 0);
        if (!total) return;
        const row = element("div", "seats-bar-row");
        row.appendChild(element("span", "seats-bar-year", String(yr)));
        const bar = element("div", "seats-bar");
        Object.entries(partySeats).forEach(([party, count]) => {
          const seg = element("div", "seats-bar-segment");
          seg.style.width = `${(count / total) * 100}%`;
          seg.style.backgroundColor = globalThis.ElectionContestBoard ? globalThis.ElectionContestBoard.getPartyColor(party) : "#666";
          seg.title = `${party}: ${count} 席`;
          bar.appendChild(seg);
        });
        row.appendChild(bar);
        seatsBox.appendChild(row);
      });
      card.appendChild(seatsBox);
    }
  }

  // 2026 審定候選人名冊
  if (d.candidates?.length) {
    const candSec = element("div", "candidates-section");
    candSec.appendChild(element("h4", "seats-history-title", "2026 審定候選人名單"));
    const list = element("div", "candidate-roster-list");
    d.candidates.forEach(cand => {
      const item = element("div", "candidate-roster-item");
      const dot = element("span", "party-dot");
      dot.style.backgroundColor = globalThis.ElectionContestBoard ? globalThis.ElectionContestBoard.getPartyColor(cand.party) : "#888";
      const no = element("span", "candidate-no", cand.number ? `[${cand.number}]` : "");
      const name = element("strong", "candidate-name", cand.name);
      const party = element("span", "candidate-party", cand.party || "無黨籍");
      item.append(dot, no, name, party);
      list.appendChild(item);
    });
    candSec.appendChild(list);
    card.appendChild(candSec);
  }

  observationDetail.appendChild(card);
}

function renderObservationTownship"""
    content = re.sub(council_render_pattern, new_council_render, content, count=1)

    # 6. Save updated app.js
    with open(APP_PATH, "w", encoding="utf-8") as f:
        f.write(content)

    print("Successfully upgraded app.js to v57!")

if __name__ == "__main__":
    upgrade()
