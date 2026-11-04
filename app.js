"use strict";

const product = globalThis.ElectionProductProfile;
if (!product) throw new Error("產品設定未載入");
const MANIFEST_PATH = "data/manifest.json";
const HIERARCHY_SEARCH_LIMIT = 200;
const core = globalThis.ElectionViewerCore;
if (!core) throw new Error("離線 viewer core 未載入");
const requestGate = new core.RequestGate();
const newsRequestGate = new core.RequestGate();
const preparedDatasetCache = new core.BoundedLruCache(2);
const countyNewsCache = new core.BoundedLruCache(6);
const historyRequestGate = new core.RequestGate();
const historyCache = new core.BoundedLruCache(2);
let historyController = null;
let historyShard = null;
let historyPointer = null;
let presidentHistoryPointer = null;
let historyChartObserver = null;
let historyMetric = "votes_per_elector";
const state = {
  manifest: null,
  topology: null,
  features: [],
  mapHierarchy: null,
  mapRegions: [],
  mapLevel: "county",
  mapLevelKind: "county",
  mapPath: [],
  hierarchyRegions: [],
  hierarchyLevel: "county",
  hierarchyLevelKind: "county",
  hierarchyPath: [],
  nationalBounds: null,
  nationalFullBounds: null,
  bounds: null,
  fullBounds: null,
  useFullBounds: false,
  shard: null,
  election: null,
  areaColumn: {},
  optionColumn: {},
  votesByArea: [],
  nationalTotals: [],
  areaIndexesByMapId: new Map(),
  selectedAreaIndexes: [],
  selectedLabel: "",
  view: "map",
  viewport: { width: 1, height: 1, pixelRatio: 1 },
  mapTheme: "light",
  mapView: { zoom: 1, panX: 0, panY: 0 },
  mapPointers: new Map(),
  mapGesture: null,
  suppressMapClickUntil: 0,
  mapInteractionEnabled: false,
  selectedFocus: null,
  navigationIntent: null,
  activeDatasetController: null,
  compositeSources: null,
  newsManifest: null,
  newsManifestPromise: null,
  newsManifestError: null,
  activeNewsController: null,
  selectedNewsCountyKey: null,
  hierarchyRenderGeneration: 0,
};

const yearSelect = document.getElementById("year-select");
const electionSelect = document.getElementById("election-select");
const countySelect = document.getElementById("county-select");
const electionHeading = document.getElementById("election-heading");
const datasetStatus = document.getElementById("dataset-status");
const sourceNote = document.getElementById("source-note");
const coverageNote = document.getElementById("coverage-note");
const mapButton = document.getElementById("map-view-button");
const listButton = document.getElementById("list-view-button");
const mapView = document.getElementById("map-view");
const listView = document.getElementById("list-view");
const mapCanvas = document.getElementById("map-canvas");
const mapControlButtons = [...document.querySelectorAll(".map-navigation-controls button")];
const mapThemeButtons = [...document.querySelectorAll("[data-map-theme-toggle]")];
const mapLoading = document.getElementById("map-loading");
const mapLegend = document.getElementById("map-legend");
const resetMapButton = document.getElementById("reset-map-button");
const fullMapButton = document.getElementById("full-map-button");
const mapBackButton = document.getElementById("map-back-button");
const mapHomeButton = document.getElementById("map-home-button");
const mapBreadcrumb = document.getElementById("map-breadcrumb");
const mapLevelNote = document.getElementById("map-level-note");
const hierarchy = document.getElementById("hierarchy");
const hierarchySearch = document.getElementById("hierarchy-search");
const listBackButton = document.getElementById("list-back-button");
const listHomeButton = document.getElementById("list-home-button");
const listBreadcrumb = document.getElementById("list-breadcrumb");
const listLevelNote = document.getElementById("list-level-note");
const detailPanel = document.getElementById("detail-panel");
const countyNewsPanel = document.getElementById("county-news-panel");
const countyNewsTitle = document.getElementById("county-news-title");
const countyNewsMeta = document.getElementById("county-news-meta");
const countyNewsContent = document.getElementById("county-news-content");
const historyCounty = document.getElementById("history-county");
const historyTown = document.getElementById("history-town");
const historyVillage = document.getElementById("history-village");
const historyStatus = document.getElementById("history-status");
const historyContent = document.getElementById("history-content");
const historyRetry = document.getElementById("history-retry");

function updateMapThemeControls() {
  const dark = state.mapTheme === "dark";
  document.documentElement.dataset.theme = state.mapTheme;
  document.body.dataset.mapTheme = state.mapTheme;
  const topbarThemeBtn = document.getElementById("theme-toggle-btn");
  if (topbarThemeBtn) {
    topbarThemeBtn.textContent = dark ? "☀️ 淺色" : "🌙 深色";
    topbarThemeBtn.setAttribute("aria-label", dark ? "切換淺色主題" : "切換深色主題");
    topbarThemeBtn.setAttribute("aria-pressed", String(dark));
  }
  mapThemeButtons.forEach((button) => {
    button.textContent = dark ? "切換亮色地圖" : "切換暗色地圖";
    button.setAttribute("aria-label", dark ? "切換亮色地圖" : "切換暗色地圖");
    button.setAttribute("aria-pressed", String(dark));
  });
}

function toggleMapTheme() {
  state.mapTheme = state.mapTheme === "dark" ? "light" : "dark";
  try { localStorage.setItem("twvote:theme", state.mapTheme); } catch (_) {}
  updateMapThemeControls();
  renderMap();
  renderObservationMap();
}

mapThemeButtons.forEach((button) => button.addEventListener("click", toggleMapTheme));
const topbarThemeBtn = document.getElementById("theme-toggle-btn");
if (topbarThemeBtn) topbarThemeBtn.addEventListener("click", toggleMapTheme);
updateMapThemeControls();

function historyOptions(select, values, placeholder) {
  clear(select);
  const empty = element("option", "", placeholder);
  empty.value = "";
  select.appendChild(empty);
  values.forEach((value) => {
    const option = element("option", "", value);
    option.value = value;
    select.appendChild(option);
  });
}

function initializeHistory() {
  try {
    if (!state.manifest.mayor_history) {
      historyStatus.textContent = "此 release 未包含預先計算的歷史比較資料。";
      return;
    }
    core.validateHistoryPointer(state.manifest.mayor_history, state.manifest.source.database_sha256);
    historyPointer = state.manifest.mayor_history;
    if (state.manifest.president_history) {
      core.validateHistoryPointer(state.manifest.president_history, state.manifest.source.database_sha256);
      presidentHistoryPointer = state.manifest.president_history;
    }
    historyOptions(historyCounty, [...new Set([...historyPointer.counties, ...(presidentHistoryPointer?.counties || [])].map((entry) => entry.name))].sort(), "請選擇縣市");
    historyCounty.disabled = false;
    historyStatus.textContent = "請選擇歷史來源範圍；也可從地圖或地區清單的詳情開啟。";
  } catch (error) {
    historyPointer = null;
    presidentHistoryPointer = null;
    historyStatus.textContent = `歷史資料驗證失敗：${error.message}`;
  }
}

async function fetchHistory(entry, signal) {
  const entries = [historyPointer, presidentHistoryPointer].filter(Boolean).map((pointer) =>
    ({pointer, entry:pointer.counties.find((county) => county.name === entry.name)}));
  const revision = presidentHistoryPointer?.revision;
  const sourcesPromise = revision ? fetchJson(`data/${revision.file}`, signal, revision.sha256) : Promise.resolve(null);
  const mayorRevision=historyPointer?.revision;
  const mayorSourcesPromise=mayorRevision ? fetchJson(`data/${mayorRevision.file}`,signal,mayorRevision.sha256) : Promise.resolve(null);
  const [shards, sourceRecord, mayorSourceRecord] = await Promise.all([Promise.all(entries.map(async ({pointer, entry:source}) => {
    if (!source) return null;
    const shard = await fetchJson(`data/${source.file}`, signal, source.sha256);
    core.validateHistoryShard(shard, source, pointer);
    return shard;
  })), sourcesPromise, mayorSourcesPromise]);
  if (sourceRecord) core.validatePresidentRevision(sourceRecord);
  if (mayorSourceRecord) core.validateMayorRevision(mayorSourceRecord);
  const presidential = shards.find((shard) => shard?.schema.startsWith("election-president-history-"));
  if (presidential && sourceRecord) {
    const audited = sourceRecord.schema === "cec-president-source-audit-v2";
    presidential.areas.forEach((area) => area.periods.forEach((period) => period.elections.forEach((election) => {
      if (audited !== (election.source_revision === "cec-president-full-audit")) throw new Error("總統查核來源與年份標記不一致");
    })));
  }
  const mayor=shards.find(shard=>shard?.schema.startsWith("election-mayor-history-"));
  if(mayorSourceRecord && mayor) mayor.areas.forEach(area=>area.periods.forEach(period=>period.elections.forEach(election=>{
    if(election.source_revision!=="cec-mayor-full-audit" || !mayorSourceRecord.coverage.some(r=>r.election_id===election.id && r.county===area.names[0])) throw new Error("首長查核來源與年份標記不一致");
  })));
  return {county:entry.name, areas:core.combineHistoryAreas(shards[0], shards[1], mayorSourceRecord), sourceRecord, mayorSourceRecord};
}

let cachedMayorAuditRecord = null;
let mayorAuditRecordPromise = null;

function fetchMayorAuditRecord(signal) {
  if (cachedMayorAuditRecord) return Promise.resolve(cachedMayorAuditRecord);
  if (mayorAuditRecordPromise) return mayorAuditRecordPromise;
  const revision = historyPointer?.revision;
  if (!revision) return Promise.resolve(null);
  mayorAuditRecordPromise = fetchJson(`data/${revision.file}`, signal, revision.sha256)
    .then((record) => {
      core.validateMayorRevision(record);
      cachedMayorAuditRecord = record;
      return record;
    })
    .catch((error) => {
      mayorAuditRecordPromise = null;
      throw error;
    });
  return mayorAuditRecordPromise;
}

async function fetchMayorHistoryForSwing(entry, signal) {
  const source = historyPointer?.counties.find((county) => county.name === entry.name);
  if (!source) return null;
  const [shard, mayorSourceRecord] = await Promise.all([
    fetchJson(`data/${source.file}`, signal, source.sha256).then((value) => {
      core.validateHistoryShard(value, source, historyPointer);
      return value;
    }),
    fetchMayorAuditRecord(signal),
  ]);
  if (mayorSourceRecord) shard.areas.forEach((area) => area.periods.forEach((period) => period.elections.forEach((election) => {
    if (election.source_revision !== "cec-mayor-full-audit"
      || !mayorSourceRecord.coverage.some((record) => record.election_id === election.id && record.county === area.names[0])) {
      throw new Error("首長查核來源與年份標記不一致");
    }
  })));
  return shard;
}

const swingCache = new Map();
const swingScopeCache = new Map();
const swingLoadPromises = new Map();

let historySummaryIndexPromise = null;
function loadHistorySummaryIndex() {
  if (!historySummaryIndexPromise) {
    const pointer = state.manifest.history_summary;
    historySummaryIndexPromise = fetchJson(`data/${pointer.file}`, null, pointer.sha256).then(index => {
      if (index.schema !== "history-summary-index-v1") throw new Error("歷史摘要版本不符");
      return index;
    }).catch(error => { historySummaryIndexPromise = null; throw error; });
  }
  return historySummaryIndexPromise;
}
function reviveSummary(value) {
  if (!value || typeof value !== "object") return value;
  if (value.$map) return new Map(value.$map.map(([key,v])=>[key,reviveSummary(v)]));
  if (value.$set) return new Set(value.$set.map(reviveSummary));
  if (Array.isArray(value)) return value.map(reviveSummary);
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,reviveSummary(v)]));
}
async function ensureCountySwingData(countyName) {
  if (!countyName) return null;
  const baseline = observation.yearBaseline || "default";
  const threshold = observation.swingMarginThreshold || 0.03;
  const key = `${countyName}:${baseline}:${threshold}`;
  const cached = swingScopeCache.get(countyName);
  if (cached?.key === key) return cached;
  if (swingLoadPromises.has(key)) return swingLoadPromises.get(key);
  const task = (async () => {
    try {
      const index = await loadHistorySummaryIndex();
      const pointer = index.counties[countyName]?.variants[`${baseline}:${threshold}`];
      if (!pointer) throw new Error("此範圍沒有歷史摘要");
      const raw = await fetchJson(`data/${pointer.file}`, null, pointer.sha256);
      if (raw.schema !== "history-swing-summary-v1" || raw.county !== countyName) throw new Error("歷史摘要範圍不符");
      const data = {...reviveSummary(raw), key};
      swingScopeCache.delete(countyName); swingScopeCache.set(countyName,data); swingCache.set(countyName,data.villages);
      while (swingScopeCache.size > 3) { const old = swingScopeCache.keys().next().value; swingScopeCache.delete(old); swingCache.delete(old); }
      return data;
    } catch(error) { return null; }
    finally { swingLoadPromises.delete(key); }
  })();
  swingLoadPromises.set(key,task);
  return task;
}
async function loadLocalHistorySummary(names, signal = null) {
  const index = await loadHistorySummaryIndex();
  const pointer = index.counties[names[0]]?.local;
  if (!pointer) throw new Error("此範圍沒有歷史摘要");
  const data = await fetchJson(`data/${pointer.file}`, signal, pointer.sha256);
  if (data.schema !== "history-local-summary-v1" || data.county !== names[0]) throw new Error("歷史摘要範圍不符");
  return data.areas[JSON.stringify(names)] || [2014,2018,2022].map(year=>({year,error:"資料不足，無法繪圖。"}));
}

async function ensureCountySwingAnalysis(countyName) {
  const data = await ensureCountySwingData(countyName);
  return data?.villages || null;
}

function appendMayorCoverageNote(parent, year, names) {
  const info = core.mayorCoverageInfo(historyShard?.mayorSourceRecord, year, names[0]);
  if (!info.counties.length) return;
  const coverage = info.counties.length <= 5 ? info.counties.join("、")
    : `${info.counties.length} 縣市${year === 2001 ? "（不含當時的臺北市、高雄市）" : ""}`;
  const originalCity = info.scope && year < 2010 && ["臺中市","臺南市","高雄市"].includes(names[0]);
  parent.appendChild(element("p", "history-chart-note", `${year} 年首長選舉範圍：${coverage}。${info.scope
    ? `本表為當年的${names[0]}${originalCity ? "（縣市合併前）" : ""}；原始資料層級為${info.scope.source_grain === "township" ? "鄉鎮市區" : info.scope.source_grain === "village" ? "村里" : "投開票所"}。`
    : "所選縣市名稱不在當屆選舉範圍內，故無該年度紀錄。"}`));
  if (info.historicalCounty) {
    const button = element("button", "history-link", `查看${info.historicalCounty}（${year} 原始範圍）`);
    button.type = "button";
    const shardAtRender = historyShard;
    button.addEventListener("click", () => {
      if (historyShard !== shardAtRender) return;
      historyCounty.value = info.historicalCounty;
      loadHistoryCounty([info.historicalCounty], false, year);
    });
    parent.appendChild(button);
  }
}

function appendHistorySourceNote(parent, election, names) {
  if (!election?.source_revision) return;
  if(election.source_revision==="cec-mayor-full-audit") {
    const source=historyShard.mayorSourceRecord, scope=source.coverage.find(r=>r.election_id===election.id && r.county===names[0]);
    const corrections=source.corrections.filter(r=>r.election_id===election.id && names.every((n,i)=>r.names[i]===n));
    const details=element("details","history-source-note");details.appendChild(element("summary","",`${scope.year} 縣市首長查核與來源`));
    const early = scope.source_grain !== "station";
    const note=element("p","detail-meta",`已核對${early ? "保存的中選會 CSV、官方細分統計與當年縣市合計" : "中選會原始票所、縣市及全國合計"}，票數與選舉人數分母一致。${early ? "早期附件下載清單無法取得；保存檔的 SHA 與既有來源清單一致，逐筆數值已與官方統計交叉核對。" : ""}${scope.source_grain === "township" ? "2001 原始資料只有鄉鎮層級，不分配到村里。" : ""}${corrections.length ? `此範圍涉及 ${corrections.length} 筆來源或數值修正。` : "此範圍沒有新增來源或數值修正。"}${election.kind==="rerun" ? "嘉義市重行選舉：2022-12-18。" : ""}`);
    const key=`${scope.year}${election.kind==="rerun"?"-rerun":""}-${scope.type}`;
    const originals=source.sources.filter(s=>s.file.startsWith(`${key}-original-`));
    originals.forEach(s=>{const a=element("a","","中選會原始檔（外部連結，新分頁）");a.href=s.url;a.target="_blank";a.rel="noopener noreferrer";note.appendChild(document.createTextNode(" "));note.appendChild(a);});
    if (early) ["profiles", "tickets"].forEach((kind) => {
      const official = source.sources.find((s) => s.file === `${key}-C-${kind}.json`);
      if (!official?.url) return;
      const a = element("a", "", `中選會${kind === "profiles" ? "選舉概況" : "得票統計"}（外部連結，新分頁）`);
      a.href = official.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      note.appendChild(document.createTextNode(" ")); note.appendChild(a);
    });
    const record=element("a","","來源與逐筆修正紀錄（JSON）");record.href="data/history/mayor-sources.json";record.download="mayor-sources.json";
    note.appendChild(document.createTextNode(" · "));note.appendChild(record);details.appendChild(note);parent.appendChild(details);return;
  }
  const imported = election.source_revision === "cec-1996-original";
  const audited = election.source_revision === "cec-president-full-audit";
  const year = audited ? Number(election.id.split("_")[1]) : imported ? 1996 : 2004;
  const scopeCorrections = audited ? historyShard.sourceRecord.corrections.filter((record) => record.year === year
    && names.every((name, index) => record.names[index] === name)) : [];
  const details = element("details", "history-source-note");
  details.appendChild(element("summary", "", audited ? `${year} 中選會查核與來源` : imported ? "1996 中選會資料來源" : "2004 臺東修正依據與來源"));
  const note = element("p", "detail-meta", audited
    ? `已核對中選會原始投開票所、縣市及全國合計，票數與選舉人數分母一致。${scopeCorrections.length ? `此選取範圍涉及 ${scopeCorrections.length} 筆修正紀錄；原值、修正值與原始檔列號皆已保留。` : "此選取範圍沒有新增數值修正。"}`
    : imported
    ? "1996：依中選會原始投開票所明細補入，票數與選舉人數已核對官方縣市合計。"
    : "2004 臺東：依中選會原始投開票所明細重建，修正 7 筆票數不一致與 14 筆錯置、缺分母紀錄。候選人票數及選舉人數已核對官方縣級合計。");
  const official = element("a", "", "中選會原始檔（外部連結，新分頁）");
  const source = historyShard.sourceRecord.sources.find((item) => item.file === `${year}-official.zip`);
  official.href = source.url;
  official.target = "_blank"; official.rel = "noopener noreferrer";
  const record = element("a", "", "來源與逐筆修正紀錄（JSON）");
  record.href = "data/history/president-sources.json";record.download = "president-sources.json";
  note.appendChild(document.createTextNode(" "));note.appendChild(official);
  note.appendChild(document.createTextNode(" · "));note.appendChild(record);
  details.appendChild(note);parent.appendChild(details);
}

function rerunDateLabel(date) {
  return date ? `投票日期 ${date}` : "確切投票日期未收錄";
}

async function loadHistoryCounty(names = [historyCounty.value], refresh = false, selectedYear = null) {
  const generation = historyRequestGate.begin();
  if (historyController) historyController.abort();
  historyController = null;
  historyShard = null;
  clearHistoryContent();
  historyOptions(historyTown, [], "全縣市");
  historyOptions(historyVillage, [], "全鄉鎮市區");
  historyTown.disabled = true;
  historyVillage.disabled = true;
  historyRetry.disabled = true;
  historyRetry.hidden = true;
  const entry = historyPointer?.counties.find((county) => county.name === names[0])
    || presidentHistoryPointer?.counties.find((county) => county.name === names[0]);
  if (!entry) {
    historyCounty.value = "";
    historyStatus.textContent = "請選擇縣市。";
    return;
  }
  historyCounty.value = entry.name;
  historyStatus.textContent = `載入 ${entry.name} 的歷史資料…`;
  const controller = new AbortController();
  historyController = controller;
  try {
    let shard = refresh ? null : historyCache.get(entry.name);
    if (!shard) shard = await fetchHistory(entry, controller.signal);
    if (!historyRequestGate.isCurrent(generation)) return;
    historyShard = shard;
    historyCache.set(entry.name, shard);
    const analysis = core.analyzeMayorSwing(shard.areas);
    swingCache.set(entry.name, analysis);
    if (typeof state !== "undefined") state.swingAnalysis = analysis;
    historyOptions(historyTown, shard.areas.filter((area) => area.names.length === 2).map((area) => area.names[1]), "全縣市");
    historyTown.disabled = false;
    if (names[1]) {
      if (![...historyTown.options].some((option) => option.value === names[1])) {
        historyStatus.textContent = `${names.join("／")}：查無對應之歷史開票範圍，請選擇其他行政區。`;
        return;
      }
      historyTown.value = names[1];
    }
    updateHistoryVillages(names[2] || "", selectedYear);
  } catch (error) {
    if (!historyRequestGate.isCurrent(generation)) return;
    historyShard = null;
    clearHistoryContent();
    historyStatus.textContent = `歷史資料無法顯示：${error.message}。可按「重新載入」重試。`;
  } finally {
    if (historyRequestGate.isCurrent(generation)) {
      historyController = null;
      historyRetry.disabled = false;
      historyRetry.hidden = Boolean(historyShard);
    }
  }
}

function updateHistoryVillages(village = "", selectedYear = null) {
  if (!historyShard) return;
  historyOptions(historyVillage, historyShard.areas.filter((area) => area.names.length === 3
    && area.names[1] === historyTown.value && area.periods.some((p) => p.elections.length)).map((area) => area.names[2]), "全鄉鎮市區");
  historyVillage.disabled = !historyTown.value || historyVillage.options.length === 1;
  if (village && ![...historyVillage.options].some((option) => option.value === village)) {
    const limited = historyShard.areas.find((area) => area.names.length === 3
      && area.names[1] === historyTown.value && area.names[2] === village
      && area.granularity_limits.length);
    if (limited) {
      historyVillage.value = "";
      renderHistory(selectedYear);
      historyStatus.textContent += `｜${village} 歷屆邊界多次調整，改以全鄉鎮合計呈現。`;
      return;
    }
    clearHistoryContent();
    historyStatus.textContent = `${historyCounty.value}／${historyTown.value}／${village}：歷屆查無完全一致之對應村里，不估算合併或重劃前後票數。`;
    return;
  }
  historyVillage.value = village;
  renderHistory(selectedYear);
}

function clearHistoryContent() {
  if (historyChartObserver) historyChartObserver.disconnect();
  historyChartObserver = null;
  clear(historyContent);
}

function historyPartyLabel(party) {
  return party ? `${party}（合計）` : "黨籍未收錄（合計）";
}

function historySeriesStyle(party, type = "mayor") {
  let hash = 0;
  for (const character of party) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  const color = party === "中國國民黨" ? "#2563ae" : party === "民主進步黨" ? "#28794d"
    : party === "台灣民眾黨" ? "#168389" : `hsl(${hash % 360} 50% 38%)`;
  return { color, dash: type === "president" ? [6, 3] : [], marker: type === "president" ? 3 : 0 };
}

function historyMarker(context, x, y, marker) {
  context.beginPath();
  if (marker === 0) context.arc(x, y, 4, 0, Math.PI * 2);
  else if (marker === 1) context.rect(x - 4, y - 4, 8, 8);
  else if (marker === 2) {
    context.moveTo(x, y - 5); context.lineTo(x + 5, y);
    context.lineTo(x, y + 5); context.lineTo(x - 5, y); context.closePath();
  } else {
    context.moveTo(x, y - 5); context.lineTo(x + 5, y + 4);
    context.lineTo(x - 5, y + 4); context.closePath();
  }
  context.fill();
}

function appendHistoryGranularityNote(parent, area, year) {
  const limits = area.granularity_limits.filter((limit) => limit.year === year);
  if (!limits.length) return false;
  const types = [...new Set(limits.flatMap((limit) => limit.elections.map((race) =>
    race.type === "president" ? "總統" : "縣市首長")))];
  parent.appendChild(element("p", "quality-note", `${year} 年${types.join("／")}選舉無法唯一對位至村里圖資，只提供鄉鎮層級合計；村里數值留空。`));
  const button = element("button", "history-town-fallback", "查看鄉鎮合計");
  button.type = "button";
  const shardAtRender = historyShard;
  button.addEventListener("click", () => {
    if (historyShard !== shardAtRender) return;
    historyVillage.value = "";
    renderHistory(year);
    historyTown.focus();
  });
  parent.appendChild(button);
  limits.forEach((limit) => limit.elections.forEach((race) => appendHistorySourceNote(parent, race, limit.source_names || area.names)));
  return true;
}

function renderHistoryChart(area, selectedYear = null) {
  const chart = area.chart;
  const board = element("section", "history-chart");
  const toolbar = element("div", "history-chart-toolbar");
  const label = element("label", "", "顯示指標");
  const select = element("select"); select.id = "history-metric";
  [["votes_per_elector", "催票率（%）"], ["votes", "各黨得票數（票）"], ["electorate", "選舉人數（人）"]].forEach(([value, text]) => {
    const option = element("option", "", text); option.value = value; select.appendChild(option);
  });
  select.value = historyMetric; label.appendChild(select); toolbar.appendChild(label);
  const unit = element("span", "history-chart-unit"); toolbar.appendChild(unit); board.appendChild(toolbar);
  board.appendChild(element("p", "history-type-key", "● 縣市首長 · 實線　▲ 總統 · 虛線"));
  const filters = element("details", "history-series-filters");
  filters.appendChild(element("summary", "", "選擇顯示的政黨與選舉種類"));
  const legend = element("div", "history-chart-legend"); legend.setAttribute("role", "group"); legend.setAttribute("aria-label", "顯示的黨籍與選舉種類；可取消勾選");
  const seriesKey = (s) => JSON.stringify([s.type, s.party]);
  const typeLabel = (type) => type === "president" ? "總統" : "縣市首長";
  const visible = new Set(chart.series.map(seriesKey));
  chart.series.forEach((series) => {
    const item = element("label"); const input = element("input"); input.type = "checkbox"; input.checked = true;
    const swatch = element("canvas", "history-chart-swatch"); swatch.width = 40; swatch.height = 16; swatch.setAttribute("aria-hidden", "true");
    const ctx = swatch.getContext("2d"); const style = historySeriesStyle(series.party, series.type);
    ctx.strokeStyle = style.color; ctx.fillStyle = style.color; ctx.lineWidth = 2; ctx.setLineDash(style.dash);
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(40, 8); ctx.stroke(); historyMarker(ctx, 20, 8, style.marker);
    item.append(input, swatch, element("span", "", `${typeLabel(series.type)}・${historyPartyLabel(series.party)}`));
    input.addEventListener("change", () => {
      if (input.checked) visible.add(seriesKey(series)); else visible.delete(seriesKey(series));
      update();
    }); legend.appendChild(item);
  });
  filters.appendChild(legend); board.appendChild(filters);
  const partyKey = element("div", "history-party-key");
  partyKey.setAttribute("aria-label", "政黨顏色，依原始名稱");
  [...new Set(chart.series.map((s) => s.party))].forEach((party) => {
    const item = element("span", "legend-item"); const swatch = element("span", "swatch");
    swatch.style.backgroundColor = historySeriesStyle(party).color;
    item.append(swatch, element("span", "", party || "黨籍未收錄")); partyKey.appendChild(item);
  }); board.appendChild(partyKey);
  const canvas = element("canvas", "history-line-chart"); canvas.id = "history-line-chart";
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-describedby", "history-chart-values"); board.appendChild(canvas);
  const years = element("div", "history-chart-years"); years.setAttribute("role", "group"); years.setAttribute("aria-label", "選擇年份查看圖表數值，新到舊");
  let selected = Math.max(0, chart.years.indexOf(selectedYear));
  const yearButtons = chart.years.map((year, index) => {
    const button = element("button", "", `${year} 年`); button.type = "button";
    button.addEventListener("click", () => { selected = index; update(); }); years.appendChild(button); return button;
  }); board.appendChild(years);
  const values = element("div", "history-chart-values"); values.id = "history-chart-values"; values.setAttribute("aria-live", "polite"); board.appendChild(values);
  board.appendChild(element("p", "history-chart-note", "折線依政黨得票走勢繪製，無黨籍包含所有獨立參選人合計。若該年度村里邊界異動，請參考鄉鎮合計。"));
  historyContent.appendChild(board);
  let plot = null;
  const formatted = (value) => value === null || value === undefined ? "—" : historyMetric === "votes_per_elector" ? `${(value * 100).toFixed(2)}%` : formatNumber(value);
  const displayedSeries = () => historyMetric === "electorate" ? chart.electorate_by_type
    : chart.series.filter((s) => visible.has(seriesKey(s))).map((s) => ({...s, values:s[historyMetric]}));
  const xFraction = (year) => (chart.years[0] - year) / Math.max(1, chart.years[0] - chart.years.at(-1));
  function draw() {
    if (!canvas.isConnected) return;
    const width = Math.max(260, canvas.getBoundingClientRect().width);
    const height = 280; const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = height * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const displayed = displayedSeries();
    const rawMax = Math.max(0, ...displayed.flatMap((s) => s.values.filter((v) => v !== null)));
    const scale = rawMax > 0 ? 10 ** Math.floor(Math.log10(rawMax)) : 1;
    const maximum = historyMetric === "votes_per_elector" ? 1 : Math.max(1, Math.ceil(rawMax / scale) * scale);
    ctx.font = "13px system-ui, sans-serif"; ctx.textBaseline = "middle";
    const tickLabel = (value) => historyMetric === "votes_per_elector" ? `${Math.round(value * 100)}%` : formatNumber(Math.round(value));
    const widestTick = Math.max(...[0, 1, 2, 3, 4].map((step) => ctx.measureText(tickLabel(maximum * step / 4)).width));
    plot = { left: Math.max(width > 600 ? 80 : 65, Math.ceil(widestTick) + 16), right: width - 20, top: 18, bottom: 235 };
    const x = (year) => plot.left + xFraction(year) * (plot.right - plot.left);
    const y = (value) => plot.bottom - value / maximum * (plot.bottom - plot.top);
    for (let step = 0; step <= 4; step += 1) {
      const value = maximum * step / 4; const position = y(value);
      ctx.strokeStyle = "#e1e7ed"; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(plot.left, position); ctx.lineTo(plot.right, position); ctx.stroke();
      ctx.fillStyle = "#526174"; ctx.textAlign = "right"; ctx.fillText(tickLabel(value), plot.left - 10, position);
    }
    ctx.strokeStyle = "#8492a2"; ctx.beginPath(); ctx.moveTo(plot.left, plot.top); ctx.lineTo(plot.left, plot.bottom); ctx.lineTo(plot.right, plot.bottom); ctx.stroke();
    ctx.strokeStyle = "#b6c2cf"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x(chart.years[selected]), plot.top); ctx.lineTo(x(chart.years[selected]), plot.bottom); ctx.stroke();
    displayed.forEach((series) => {
      const style = historySeriesStyle(series.party, series.type);
      ctx.strokeStyle = style.color; ctx.fillStyle = style.color; ctx.lineWidth = 2.5; ctx.setLineDash(style.dash);
      core.historyLineSegments(series.values).forEach((segment) => {
        ctx.beginPath(); segment.forEach(([index, value], position) => {
          if (!position) ctx.moveTo(x(series.years[index]), y(value)); else ctx.lineTo(x(series.years[index]), y(value));
        }); ctx.stroke(); segment.forEach(([index, value]) => historyMarker(ctx, x(series.years[index]), y(value), style.marker));
      });
    });
    ctx.setLineDash([]); ctx.fillStyle = "#526174"; ctx.textAlign = "center";
    // Calendar spacing is preserved. Narrow screens label endpoints and every
    // other cycle; every year remains available as an accessible button below.
    let lastTick = -Infinity;
    chart.years.forEach((year, index) => {
      const position = x(year); const reservedLast = x(chart.years.at(-1));
      if (index === 0 || index === chart.years.length - 1 || (position - lastTick >= 38 && reservedLast - position >= 38)) {
        ctx.fillText(String(year), position, 257); lastTick = position;
      }
    });
    if (!displayed.some((s) => s.values.some((v) => v !== null))) ctx.fillText("沒有可顯示的數值", (plot.left + plot.right) / 2, 120);
  }
  function update() {
    historyMetric = select.value; filters.hidden = historyMetric === "electorate";
    unit.textContent = historyMetric === "votes_per_elector" ? "催票率（實得票數 ÷ 選舉人數）" : historyMetric === "votes" ? "單位：得票數" : "單位：選舉人數";
    canvas.setAttribute("aria-label", `${area.names.join("／")}，${select.selectedOptions[0].textContent}折線圖，年份 ${chart.years.join("、")}；圓點為縣市首長，三角形為總統。選擇下方年份可讀取數值。`);
    yearButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === selected)));
    clear(values);
    const source = area.periods.find((p) => p.year === chart.years[selected]);
    const status = chart.status[selected];
    const race = source.elections[0];
    const limited = area.granularity_limits.some((limit) => limit.year === chart.years[selected]);
    values.appendChild(element("strong", "", `${chart.years[selected]} 年｜${status === "multiple" ? "同年多場選舉，請看明細" : status === "missing" ? limited ? "該年度僅提供鄉鎮層級數據" : "該年度查無對應區域紀錄" : `${typeLabel(race.type)}選舉${race.kind === "rerun" ? "（重行選舉）" : ""}｜選舉人數 ${race.electorate === null ? "缺漏" : formatNumber(race.electorate)} 人`}`));
    appendHistoryGranularityNote(values, area, chart.years[selected]);
    appendMayorCoverageNote(values, chart.years[selected], area.names);
    if (race?.invalid_vote_area_count) values.appendChild(element("p", "quality-note", `${race.invalid_vote_area_count} 個來源單位的票數不一致，得票與催票率留空；請展開該年明細。`));
    if (status === "available") {
      const numbers = element("dl", "history-chart-numbers");
      displayedSeries().filter((s) => s.years.includes(chart.years[selected])).forEach((s) => {
        const item = element("div"); const index = s.years.indexOf(chart.years[selected]);
        item.append(element("dt", "", `${typeLabel(s.type)}・${historyMetric === "electorate" ? s.party : historyPartyLabel(s.party)}`), element("dd", "", formatted(s.values[index]))); numbers.appendChild(item);
      }); values.appendChild(numbers);
      values.appendChild(element("p", "history-chart-note", "「—」表示該年度無該黨參選紀錄或數據不足。點選年份可切換數值，下方可展開詳細得票清單。"));
    }
    appendHistorySourceNote(values, race, area.names);
    draw();
  }
  canvas.addEventListener("pointermove", (event) => {
    if (!plot) return;
    const position = event.clientX - canvas.getBoundingClientRect().left;
    if (position < plot.left || position > plot.right) return;
    const fraction = (position - plot.left) / (plot.right - plot.left);
    const index = chart.years.reduce((best,year,i) => Math.abs(xFraction(year)-fraction) < Math.abs(xFraction(chart.years[best])-fraction) ? i : best, 0);
    if (index !== selected) { selected = index; update(); }
  });
  select.addEventListener("change", update);
  historyChartObserver = new ResizeObserver(draw); historyChartObserver.observe(canvas); update();
}

function renderHistory(selectedYear = null) {
  clearHistoryContent();
  const names = [historyCounty.value, historyTown.value, historyVillage.value].filter(Boolean);
  const area = historyShard?.areas.find((candidate) => JSON.stringify(candidate.names) === JSON.stringify(names));
  if (!area) { historyStatus.textContent = "此歷史來源範圍無收錄資料。"; return; }
  document.getElementById("history-heading").textContent = `${names[names.length - 1]}・歷屆變化`;
  historyStatus.textContent = `${names.join("／")}｜歷屆開票數據對照`;
  if (area.granularity_limits.length) historyStatus.textContent += "｜部分年份僅提供鄉鎮層級，請選年份查看。";
  else if (names.length === 2 && historyVillage.disabled) historyStatus.textContent += "｜此範圍僅提供鄉鎮層級。";
  renderHistoryChart(area, selectedYear);
  historyContent.appendChild(element("h3", "history-details-heading", "各年候選人明細（新到舊）"));
  [...area.periods].reverse().forEach((period) => {
    const card = element("details", "history-period");
    const missing = !period.elections.length;
    const limited = area.granularity_limits.some((limit) => limit.year === period.year);
    card.appendChild(element("summary", "", `${period.year} 年${limited ? " · 部分或全部選舉僅提供鄉鎮層級" : missing ? " · 未收錄此年同名範圍" : " · 展開候選人票數與資料限制"}`));
    appendHistoryGranularityNote(card, area, period.year);
    appendMayorCoverageNote(card, period.year, area.names);
    if (missing && !limited) card.appendChild(element("p", "history-missing", "該年度查無對應行政區之開票紀錄，可能因歷史行政區劃整併或調整所致。"));
    period.elections.forEach((election) => {
      card.appendChild(element("h4", "", `${election.name}${election.kind === "rerun" ? "（重行選舉）" : ""}`));
      card.appendChild(element("p", "detail-meta", election.date || "確切投票日期未收錄"));
      appendHistorySourceNote(card, election, area.names);
      if (election.invalid_vote_area_count) card.appendChild(element("p", "quality-note", `數據異常：有 ${election.invalid_vote_area_count} 個開票所之得票合計與官方有效票不符，為求精確該項暫不計入。`));
      const counts = element("dl", "metric-grid");
      counts.appendChild(metric("選舉人數", election.electorate === null ? "資料不完整" : formatNumber(election.electorate)));
      counts.appendChild(metric("來源地理單位", formatNumber(election.source_area_count)));
      card.appendChild(counts);
      const table = element("table", "result-table");
      const caption = element("caption", "", `${period.year} 年候選人票數與選舉人數比率`);
      const head = element("thead"); const row = element("tr");
      ["候選人／黨籍", "得票數", "催票率"].forEach((label) => {
        const cell = element("th", "", label); cell.scope = "col"; row.appendChild(cell);
      });
      head.appendChild(row);
      const body = element("tbody");
      election.candidates.forEach((candidate) => {
        const tr = element("tr"); const name = element("th", "", `${candidate.number ? `${candidate.number}．` : ""}${candidate.name}`);
        name.scope = "row";
        name.appendChild(element("div", "option-party", candidate.party || "黨籍未收錄"));
        tr.append(name, element("td", "", candidate.votes === null ? "資料不完整" : formatNumber(candidate.votes)),
          element("td", "", candidate.votes_per_elector === null ? "無法計算" : `${(candidate.votes_per_elector * 100).toFixed(2)}%`));
        body.appendChild(tr);
      });
      table.append(caption, head, body); card.appendChild(table);
      const quality = element("details");
      const unresolved = election.unmapped_area_count;
      quality.appendChild(element("summary", "", `資料範圍與區界限制${unresolved ? `（${unresolved} 個來源單位未對位地圖）` : "（跨年區界未驗證）"}`));
      quality.appendChild(element("p", "", `本表包含全部已收錄的同名來源單位；${unresolved} 個未對位地圖。地理對位：${Object.entries(election.resolution_status_counts).map(([status, count]) => `${status} ${count}`).join("、")}。同名比較未校正歷史區界，不代表區界沒有改變。`));
      quality.appendChild(element("p", "", `選舉資料識別：${election.id}。${election.missing_electorate_count} 個來源單位缺選舉人數；比率分母缺漏或為零、或候選人票數缺漏時，不顯示百分比。`));
      card.appendChild(quality);
    });
    historyContent.appendChild(card);
  });
}

function appendHistoryLink(indexes, focus) {
  if (!historyPointer || !indexes.length || !focus) return;
  const areas = indexes.map((index) => state.shard.areas[index]);
  const names = ["county_name", "township_name", "village_name"].map((key) => String(areaValue(areas[0], key) || ""));
  let selected = null;
  if (focus.kind === "region" && focus.region?.key === focus.county?.key) selected = names.slice(0, 1);
  else if (areas.length === 1 && names.every(Boolean)) selected = names;
  else if (focus.region?.label === names[1] && areas.every((area) => String(areaValue(area, "township_name")) === names[1])) selected = names.slice(0, 2);
  if (!selected) return;
  const button = element("button", "history-link", "比較歷屆變化");
  button.type = "button";
  const shardAtRender = state.shard;
  button.addEventListener("click", async () => {
    if (!state.mapInteractionEnabled || state.shard !== shardAtRender) return;
    const panel = document.getElementById("history-panel");
    panel.classList.remove("hidden");
    document.body.classList.add("history-open");
    const heading = document.getElementById("history-heading");
    heading.textContent = `${selected[selected.length - 1]}・歷屆變化`;
    window.scrollTo(0, 0); heading.focus({ preventScroll: true });
    await loadHistoryCounty(selected);
  });
  detailPanel.appendChild(button);
}

historyCounty?.addEventListener("change", () => loadHistoryCounty());
historyTown?.addEventListener("change", () => updateHistoryVillages());
historyVillage?.addEventListener("change", renderHistory);
historyRetry?.addEventListener("click", () => loadHistoryCounty([historyCounty.value, historyTown.value, historyVillage.value], true));

function releaseMapPointerCaptures() {
  for (const pointerId of state.mapPointers.keys()) {
    if (mapCanvas.hasPointerCapture(pointerId)) mapCanvas.releasePointerCapture(pointerId);
  }
  state.mapPointers.clear();
  state.mapGesture = null;
}

function releaseActivePointerCapture() {
  return releaseMapPointerCaptures();
}

function setMapInteractionEnabled(enabled) {
  state.mapInteractionEnabled = Boolean(enabled);
  if (mapCanvas) {
    mapCanvas.style.pointerEvents = enabled ? "auto" : "none";
    mapCanvas.setAttribute("aria-disabled", String(!enabled));
    mapCanvas.tabIndex = enabled ? 0 : -1;
  }
  if (resetMapButton) resetMapButton.disabled = !enabled;
  if (fullMapButton) fullMapButton.disabled = !enabled;
  if (mapBackButton) mapBackButton.disabled = !enabled;
  if (mapHomeButton) mapHomeButton.disabled = !enabled;
  mapControlButtons.forEach((button) => { button.disabled = !enabled; });
  if (listBackButton) listBackButton.disabled = !enabled;
  if (listHomeButton) listHomeButton.disabled = !enabled;
  if (hierarchySearch) hierarchySearch.disabled = !enabled;
  if (countySelect) {
    countySelect.disabled = !enabled;
    if (!enabled) countySelect.value = "";
  }
  if (!enabled) {
    releaseMapPointerCaptures();
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clear(node) {
  node.querySelectorAll?.(".collapsible-card").forEach(card => card.dispose?.());
  while (node.firstChild) node.removeChild(node.firstChild);
}

const newsTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Taipei",
});

function cancelActiveNewsRequest() {
  if (state.activeNewsController) state.activeNewsController.abort();
  state.activeNewsController = null;
}

function clearCountyNewsSelection() {
  newsRequestGate.invalidate();
  cancelActiveNewsRequest();
  state.selectedNewsCountyKey = null;
  clear(countyNewsContent);
  countyNewsTitle.textContent = "縣市選舉新聞";
  countyNewsMeta.textContent = "";
  countyNewsPanel.classList.add("hidden");
}

function newsCountyName(focus) {
  if (focus?.kind === "source") return String(focus.countyLabel || "");
  return String(focus?.county?.label || "");
}

function renderCountyNews(entry, shard, manifest) {
  clear(countyNewsContent);
  countyNewsPanel.classList.remove("hidden");
  countyNewsTitle.textContent = `${entry.name}選舉新聞`;
  countyNewsMeta.textContent = `快照 ${newsTimeFormatter.format(new Date(manifest.generated_at))}｜${shard.count.toLocaleString("zh-TW")} 則｜新到舊`;
  if (!shard.items.length) {
    countyNewsContent.appendChild(element("p", "news-status", "此快照沒有明確分類到本縣市的選舉新聞。"));
    return;
  }
  const table = element("table", "news-table");
  const head = element("thead");
  const headRow = element("tr");
  ["時間", "來源", "標題"].forEach((label) => headRow.appendChild(element("th", "", label)));
  head.appendChild(headRow);
  const body = element("tbody");
  shard.items.forEach((item) => {
    const row = element("tr");
    const timeCell = element("td");
    timeCell.dataset.label = "時間";
    const time = element("time", "", newsTimeFormatter.format(new Date(item.published_at)));
    time.dateTime = item.published_at;
    timeCell.appendChild(time);
    const sourceCell = element("td", "", item.source);
    sourceCell.dataset.label = "來源";
    const titleCell = element("td");
    titleCell.dataset.label = "標題";
    const link = element("a", "", item.title);
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${item.title}（開啟原文，新分頁，離開離線工具）`);
    titleCell.appendChild(link);
    row.append(timeCell, sourceCell, titleCell);
    body.appendChild(row);
  });
  table.append(head, body);
  countyNewsContent.appendChild(table);
}

async function loadCountyNews(countyName) {
  if (!countyName || !state.newsManifestPromise) {
    clearCountyNewsSelection();
    return;
  }
  cancelActiveNewsRequest();
  const controller = new AbortController();
  state.activeNewsController = controller;
  const generation = newsRequestGate.begin();
  state.selectedNewsCountyKey = String(countyName);
  countyNewsPanel.classList.remove("hidden");
  countyNewsTitle.textContent = `${countyName}選舉新聞`;
  countyNewsMeta.textContent = "RSS 靜態快照";
  clear(countyNewsContent);
  countyNewsContent.appendChild(element("p", "news-status", "正在載入本縣市新聞快照…"));
  try {
    const manifest = state.newsManifest || await state.newsManifestPromise;
    if (!newsRequestGate.isCurrent(generation)) return;
    if (!manifest) throw state.newsManifestError || new Error("新聞快照manifest不可用");
    const entry = core.newsManifestCounty(manifest, countyName);
    if (!entry) throw new Error(`新聞快照沒有縣市：${countyName}`);
    state.selectedNewsCountyKey = entry.key;
    let shard = countyNewsCache.get(entry.key);
    if (!shard) {
      shard = await fetchJson(`data/${entry.file}`, controller.signal);
      if (!newsRequestGate.isCurrent(generation)) return;
      core.validateNewsShard(shard, entry, manifest);
      countyNewsCache.set(entry.key, shard);
    }
    if (!newsRequestGate.isCurrent(generation)) return;
    renderCountyNews(entry, shard, manifest);
  } catch (error) {
    if (newsRequestGate.isCurrent(generation)) {
      clear(countyNewsContent);
      countyNewsContent.appendChild(element("p", "news-status error", `新聞快照載入失敗：${error.message}`));
    }
  } finally {
    if (state.activeNewsController === controller) state.activeNewsController = null;
  }
}

let dataRepository = null;
function fetchJson(path, signal = null, expectedSha256 = null) {
  if (!dataRepository) dataRepository = new globalThis.ElectionDataRepository.DataRepository(fetchJsonDirect);
  return dataRepository.loadResource({release: state.manifest?.source?.database_sha256 || "bootstrap",path,sha256:expectedSha256,signal});
}
async function fetchJsonDirect(path, signal = null, expectedSha256 = null) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, {once:true});
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  try { return await fetchJsonUnchecked(path, controller.signal, expectedSha256); }
  catch (error) { if (timedOut) throw new Error("連線逾時，請重試"); if (error instanceof SyntaxError) throw new Error("資料不是有效 JSON，請重試或重新整理"); throw error; }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
async function fetchJsonUnchecked(path, signal = null, expectedSha256 = null) {
  const localPath = core.localDataPath(path);
  const options = { cache: expectedSha256 ? "default" : "no-cache" };
  if (signal) options.signal = signal;
  let response;
  try { response = await fetch(expectedSha256 ? `${localPath}?sha256=${expectedSha256}` : localPath, options); }
  catch (error) { if (error.name === "AbortError") throw error; throw new Error("無法連線或下載中斷，請檢查網路後重試"); }
  if (!response.ok) throw new Error(`無法載入本地檔案 ${localPath}（${response.status}）`);
  if (expectedSha256 !== null) {
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("資料 SHA-256 格式錯誤");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error("歷史縣市資料超過大小限制");
    if (!globalThis.crypto?.subtle) throw new Error("目前連線環境無法驗證資料，請使用本機 loopback 或安全連線");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    if (digest !== expectedSha256) throw Object.assign(new Error("資料版本不一致，請重新整理以取得新版本（SHA-256 不符）"), {code:"DATA_VERSION"});
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  return response.json();
}

function number(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function formatNumber(value) {
  return Math.round(number(value)).toLocaleString("zh-TW");
}

function formatPercent(value) {
  return `${number(value).toFixed(2)}%`;
}

function activeBounds() {
  return state.useFullBounds ? state.fullBounds : state.bounds;
}

function mapProjection(point) {
  const [minX, minY, maxX, maxY] = activeBounds();
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const padding = 22;
  const baseScale = Math.min(
    (state.viewport.width - padding * 2) / Math.max(maxX - minX, 0.0001),
    (state.viewport.height - padding * 2) / Math.max(maxY - minY, 0.0001),
  );
  const scale = baseScale * state.mapView.zoom;
  return [
    state.viewport.width / 2 + state.mapView.panX + (point[0] - centerX) * scale,
    state.viewport.height / 2 + state.mapView.panY + (centerY - point[1]) * scale,
  ];
}

function inverseProjection(x, y) {
  const [minX, minY, maxX, maxY] = activeBounds();
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const padding = 22;
  const baseScale = Math.min(
    (state.viewport.width - padding * 2) / Math.max(maxX - minX, 0.0001),
    (state.viewport.height - padding * 2) / Math.max(maxY - minY, 0.0001),
  );
  const scale = baseScale * state.mapView.zoom;
  return [
    centerX + (x - state.viewport.width / 2 - state.mapView.panX) / scale,
    centerY - (y - state.viewport.height / 2 - state.mapView.panY) / scale,
  ];
}

function mapZoomBy(factor, point = [state.viewport.width / 2, state.viewport.height / 2]) {
  if (!state.mapInteractionEnabled || !Number.isFinite(factor) || factor <= 0) return;
  const anchor = inverseProjection(point[0], point[1]);
  state.mapView.zoom = Math.max(0.65, Math.min(14, state.mapView.zoom * factor));
  const projected = mapProjection(anchor);
  state.mapView.panX += point[0] - projected[0];
  state.mapView.panY += point[1] - projected[1];
  renderMap();
}

function mapPanBy(dx, dy) {
  if (!state.mapInteractionEnabled) return;
  state.mapView.panX += dx;
  state.mapView.panY += dy;
  renderMap();
}

function updateMapZoomControls() {
  const zoomIn = document.getElementById("map-control-zoom-in");
  const zoomOut = document.getElementById("map-control-zoom-out");
  if (zoomIn) zoomIn.disabled = !state.mapInteractionEnabled || state.mapView.zoom >= 14;
  if (zoomOut) zoomOut.disabled = !state.mapInteractionEnabled || state.mapView.zoom <= 0.65;
}

function optionLabel(option) {
  const name = String(option[state.optionColumn.option_name] || "");
  if (name === "Agree") return "同意";
  if (name === "Disagree") return "不同意";
  return name || "未命名選項";
}

function optionColor(option, index) {
  const name = optionLabel(option);
  const party = String(option[state.optionColumn.party_name] || "");
  if (name === "同意") return "#25834a";
  if (name === "不同意") return "#bd4747";
  if (party.includes("民主進步")) return "#218b57";
  if (party.includes("中國國民")) return "#3f5ab5";
  if (party.includes("台灣民眾") || party.includes("臺灣民眾")) return "#299ca4";
  if (party.includes("時代力量")) return "#d6a322";
  let hash = index + 17;
  for (const character of `${party}${name}`) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return `hsl(${hash} 52% 46%)`;
}

function mapResult(areaIndexes) {
  if (!state.shard) return { kind: "missing", optionIndex: -1, votes: [] };
  return core.resultForAreas(areaIndexes, state.votesByArea, state.shard.options.length);
}

function mapMobilization(result, indexes) {
  if (!state.shard || !["winner", "tie", "zero"].includes(result.kind)) return null;
  return core.mobilizationRate(Math.max(0, ...result.votes), indexes.map((i) => areaValue(state.shard.areas[i], "electorate")));
}

function mapRegionLabel(region) {
  return state.compositeSources && region.level === "county" && region.label === "嘉義市" ? "嘉義市＊" : region.label;
}

function mapResultColor(result) {
  if (result.kind === "winner") {
    return optionColor(state.shard.options[result.optionIndex], result.optionIndex);
  }
  if (result.kind === "tie") return "#7d6b91";
  if (result.kind === "zero") return "#a8b2bd";
  if (result.kind === "missing") return "#ffffff";
  return (typeof state !== "undefined" && state?.mapTheme === "dark") ? "#374451" : "#ffffff";
}

function resizeCanvas() {
  // The observation shell has no legacy map-canvas. Resize its active map instead.
  if (!mapCanvas) {
    if (typeof drawObservationMap === "function") drawObservationMap();
    return;
  }
  const rectangle = mapCanvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  state.viewport = { width: Math.max(1, rectangle.width), height: Math.max(1, rectangle.height), pixelRatio: ratio };
  mapCanvas.width = Math.round(state.viewport.width * ratio);
  mapCanvas.height = Math.round(state.viewport.height * ratio);
  renderMap();
  if (typeof drawObservationMap === "function") drawObservationMap();
}

function tracePolygon(context, polygon) {
  polygon.forEach((ring) => {
    ring.forEach((point, index) => {
      const projected = mapProjection(point);
      if (index === 0) context.moveTo(projected[0], projected[1]);
      else context.lineTo(projected[0], projected[1]);
    });
    context.closePath();
  });
}

function regionIsSelected(region, selectedAreaIndexes) {
  const focus = state.selectedFocus;
  if (focus?.kind === "region") {
    return String(focus.region?.key || "") === String(region.key || "")
      || (
        !focus.region?.key
        && String(focus.region?.label || "") === String(region.label || "")
      );
  }
  return (region.mapAreaIndexes || []).some((areaIndex) => selectedAreaIndexes.has(areaIndex));
}

function updateMapNavigation(warning = "") {
  const labels = state.mapPath.map((region) => region.label);
  const suffix = state.mapLevel === "county"
    ? "縣市選區"
    : state.mapLevel === "second"
      ? (state.mapLevelKind === "electoral-district" ? "當次選舉區" : "鄉鎮市區行政區")
      : "村里";
  mapBreadcrumb.textContent = state.mapLevel === "county" ? "全國" : ["全國", ...labels, suffix].join("／");
  mapBackButton.hidden = state.mapLevel === "county";
  mapHomeButton.hidden = state.mapLevel === "county";
  fullMapButton.hidden = core.sameBounds(state.bounds, state.fullBounds);
  mapLevelNote.classList.toggle("warning", Boolean(warning));
  if (warning) mapLevelNote.textContent = warning;
  else if (state.mapLevel === "county") mapLevelNote.textContent = "先點選縣市，再逐層查看選舉區與村里。";
  else if (state.mapLevel === "second") mapLevelNote.textContent = "目前顯示當次選舉區；點選選舉區後查看村里級資料。";
  else mapLevelNote.textContent = "目前顯示村里級資料；點選村里查看投票詳情。";
  mapCanvas.dataset.mapLevel = state.mapLevel;
  mapCanvas.dataset.mapLevelKind = state.mapLevelKind;
  mapCanvas.dataset.mapRegionCount = String(state.mapRegions.length);
  mapCanvas.setAttribute("aria-label", `${mapBreadcrumb.textContent}選舉結果地圖`);
}

function setMapRegions(regions, level, levelKind, path, warning = "") {
  state.mapRegions = regions;
  state.mapLevel = level;
  state.mapLevelKind = levelKind;
  state.mapPath = path;
  state.useFullBounds = false;
  state.mapView = { zoom: 1, panX: 0, panY: 0 };
  if (level === "county") {
    state.bounds = state.nationalBounds;
    state.fullBounds = state.nationalFullBounds;
  } else if (regions.length) {
    const regionBounds = core.deriveBounds(regions);
    state.bounds = regionBounds.primaryBounds;
    state.fullBounds = regionBounds.fullBounds;
  }
  const supplementalCount = regions.reduce(
    (total, region) => total + (region.supplementalAreaIndexes || []).length,
    0,
  );
  const supplementalWarning = supplementalCount
    ? `${supplementalCount.toLocaleString("zh-TW")} 筆包內來源無法唯一對位，未納入地圖；包內完整合計請用地區清單。`
    : "";
  const omittedWarning = state.election?.omitted_unmapped_area_count > 0
    ? `另 ${state.election.omitted_unmapped_area_count} 筆原始來源未打包；縣市首長／總統原始合計請看歷屆變化。` : "";
  updateMapNavigation([warning, supplementalWarning, omittedWarning].filter(Boolean).join(" "));
  renderLegend();
  renderMap();
}

function showCountyLevel() {
  if (!state.mapHierarchy) return;
  setMapRegions(state.mapHierarchy.counties, "county", "county", []);
}

function showSecondLevel(county) {
  const second = state.mapHierarchy.secondLevel(county.key);
  if (!second.regions.length) return false;
  setMapRegions(second.regions, "second", second.kind, [county], second.warning);
  return true;
}

function showVillageLevel(parent) {
  if (!core.canDrillToVillage(parent)) {
    updateMapNavigation("該區村里劃分調整頻繁，僅顯示鄉鎮層級；完整合計請參考地區清單。");
    return false;
  }
  const villages = state.mapHierarchy.villages(parent);
  if (!villages.length) return false;
  const fallbackWarning = parent.level === "township-fallback"
    ? "此資料集尚未提供更細的選舉區邊界；目前由 2025 鄉鎮市區行政區進入村里級資料。"
    : "";
  const supplementalCount = (parent.supplementalAreaIndexes || []).length;
  const supplementalWarning = supplementalCount
    ? `本層另有 ${supplementalCount.toLocaleString("zh-TW")} 筆跨村里資料未納入地圖填色，完整合計請參考清單。`
    : "";
  const warning = [fallbackWarning, supplementalWarning].filter(Boolean).join(" ");
  setMapRegions(villages, "village", "village", [...state.mapPath, parent], warning);
  const countyName = state.mapPath[0]?.label;
  if (countyName) {
    if (swingCache.has(countyName)) {
      state.swingAnalysis = swingCache.get(countyName);
    } else {
      ensureCountySwingAnalysis(countyName).then((analysis) => {
        if (analysis) {
          if (typeof state !== "undefined") state.swingAnalysis = analysis;
          if (state.mapLevel === "village") renderMap();
        }
      });
    }
  }
  return true;
}

function renderMap() {
  updateMapZoomControls();
  if (!state.mapRegions.length || !state.bounds) return;
  const context = mapCanvas.getContext("2d");
  const ratio = state.viewport.pixelRatio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, state.viewport.width, state.viewport.height);
  const dark = state.mapTheme === "dark";
  context.fillStyle = dark ? "#101820" : "#e9f0f2";
  context.fillRect(0, 0, state.viewport.width, state.viewport.height);
  const selected = new Set(state.selectedAreaIndexes);

  state.mapRegions.forEach((region) => {
    const areaIndexes = region.mapAreaIndexes || [];
    const result = mapResult(areaIndexes);
    const isSelected = regionIsSelected(region, selected);
    context.beginPath();
    region.polygons.forEach((polygon) => tracePolygon(context, polygon));
    const opacity = core.mobilizationOpacity(mapMobilization(result, areaIndexes));
    context.fillStyle = opacity === null && result.kind === "winner" ? (dark ? "#34414e" : "#c8cfd5") : mapResultColor(result);
    context.globalAlpha = opacity === null ? 1 : opacity;
    context.fill("evenodd");
    context.globalAlpha = 1;
    let swingStatus = null;
    if (state.mapLevel === "village" && state.mapPath.length >= 2) {
      const countyName = state.mapPath[0]?.label || "";
      const townName = state.mapPath[1]?.label || "";
      const villageKey = `${countyName}／${townName}／${region.label}`;
      const swingData = state.swingAnalysis?.get(villageKey);
      swingStatus = swingData?.status || null;
    }
    const boundary = core.mapBoundaryStyle(state.mapLevel, isSelected, swingStatus, state.mapTheme);
    context.lineJoin = "round";
    if (boundary.striped) {
      context.strokeStyle = boundary.outerColor;
      context.lineWidth = boundary.outerWidth;
      context.setLineDash([]);
      context.stroke();
      context.strokeStyle = boundary.stripeColor;
      context.lineWidth = boundary.outerWidth;
      context.setLineDash(boundary.dash || [6, 6]);
      context.stroke();
      context.setLineDash([]);
    } else {
      context.strokeStyle = boundary.outerColor;
      context.lineWidth = boundary.outerWidth;
      context.setLineDash([]);
      context.stroke();
      if (boundary.innerColor && boundary.innerWidth) {
        context.strokeStyle = boundary.innerColor;
        context.lineWidth = boundary.innerWidth;
        context.stroke();
      }
    }
  });

  const labelFontSize = state.mapLevel === "village" ? 10 : 11;
  context.font = `700 ${labelFontSize}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const labelCandidates = state.mapRegions.map((region) => {
    const placement = core.labelPlacement(region.polygons, region.hitPolygons || region.polygons);
    const center = mapProjection(placement.anchor);
    const topLeft = mapProjection([placement.bbox[0], placement.bbox[3]]);
    const bottomRight = mapProjection([placement.bbox[2], placement.bbox[1]]);
    const width = context.measureText(mapRegionLabel(region)).width + (state.mapLevel === "village" ? 6 : 8);
    const halfHeight = state.mapLevel === "village" ? 7 : 8;
    const isSelected = String(state.selectedLabel || "").split("／").at(-1) === region.label;
    return {
      region,
      center,
      priority: isSelected ? Number.MAX_SAFE_INTEGER : Math.abs(
        (bottomRight[0] - topLeft[0]) * (bottomRight[1] - topLeft[1]),
      ),
      box: [center[0] - width / 2, center[1] - halfHeight, center[0] + width / 2, center[1] + halfHeight],
    };
  }).filter(({ center }) => (
    center[0] >= 0
    && center[0] <= state.viewport.width
    && center[1] >= 0
    && center[1] <= state.viewport.height
  ));
  const visibleLabels = core.selectNonOverlappingLabels(labelCandidates);
  mapCanvas.dataset.mapLabelCount = String(visibleLabels.length);
  visibleLabels.forEach(({ region, center }) => {
    context.lineWidth = state.mapLevel === "village" ? 2.6 : 3.2;
    context.strokeStyle = dark ? "rgba(12,18,25,0.96)" : "rgba(255,255,255,0.94)";
    context.strokeText(mapRegionLabel(region), center[0], center[1]);
    context.fillStyle = dark ? "#f1f5f9" : "#162331";
    context.fillText(mapRegionLabel(region), center[0], center[1]);
  });
}

function mapLegendEntry(result) {
  if (result.kind === "winner") {
    const option = state.shard.options[result.optionIndex];
    const party = String(optionValue(option, "party_name") || "");
    const label = party.startsWith("無黨籍") ? `無黨籍・${optionLabel(option)}` : party || optionLabel(option);
    return { label, color: mapResultColor(result) };
  }
  const labels = { tie: "平票", zero: "零票／無有效結果", missing: "未收錄此地區資料" };
  return { label: labels[result.kind], color: mapResultColor(result) };
}

function renderLegend() {
  clear(mapLegend);
  if (!state.shard) return;
  const seen = new Set();
  state.mapRegions.forEach((region) => {
    const entry = mapLegendEntry(mapResult(region.mapAreaIndexes || []));
    const key = `${entry.color}:${entry.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    const item = element("span", "legend-item");
    const swatch = element("span", "swatch"); swatch.style.backgroundColor = entry.color;
    item.append(swatch, element("span", "", entry.label)); mapLegend.appendChild(item);
  });
  mapLegend.setAttribute("aria-label", "各範圍可對位資料中得票最多者的黨籍或選項；平票與缺漏另標示");
  const scale = element("div", "mobilization-scale");
  scale.appendChild(element("strong", "", "催票率深淺 · 每 10 個百分點一級"));
  const bands = element("div", "mobilization-bands");
  for (let bin = 0; bin < 10; bin += 1) {
    const item = element("span"); const swatch = element("span", "swatch");
    swatch.style.backgroundColor = "#3f5ab5"; swatch.style.opacity = String((bin + 1) / 10);
    item.append(swatch, element("span", "", `${bin * 10}–${bin === 9 ? "" : "<"}${(bin + 1) * 10}%`)); bands.appendChild(item);
  }
  scale.append(bands, element("p", "", "顏色：得票最多者的黨籍；深淺：其得票數 ÷ 選舉人數。灰色含無資料、無結果或分母缺漏，請點選查看。"));
  if (state.compositeSources) scale.appendChild(element("p", "rerun-note", `＊嘉義市：2022 重行選舉，已納入同一張總覽；${rerunDateLabel(state.compositeSources[1].date)}。`));
  mapLegend.appendChild(scale);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > point[1] !== yj > point[1]
      && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function featureContains(feature, point) {
  const [minX, minY, maxX, maxY] = feature.bbox;
  if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) return false;
  const hitPolygons = feature.hitPolygons || feature.polygons;
  return hitPolygons.some((polygon) => {
    if (!polygon.length || !pointInRing(point, polygon[0])) return false;
    return !polygon.slice(1).some((hole) => pointInRing(point, hole));
  });
}

function areaValue(area, name) {
  return area[state.areaColumn[name]];
}

function optionValue(option, name) {
  return option[state.optionColumn[name]];
}

function aggregateAreas(indexes) {
  const optionVotes = Array(state.shard.options.length).fill(0);
  let validVotes = 0;
  let invalidVotes = 0;
  let totalVotes = 0;
  let electorate = 0;
  let missingElectorate = false;
  const statuses = new Set();
  indexes.forEach((areaIndex) => {
    const area = state.shard.areas[areaIndex];
    validVotes += number(areaValue(area, "valid_votes"));
    invalidVotes += number(areaValue(area, "invalid_votes"));
    totalVotes += number(areaValue(area, "total_votes"));
    const count = areaValue(area, "electorate");
    if (count === null || !Number.isSafeInteger(count) || count < 0) missingElectorate = true;
    else electorate += count;
    statuses.add(String(areaValue(area, "resolution_status") || "unknown"));
    (state.votesByArea[areaIndex] || []).forEach((votes, optionIndex) => {
      optionVotes[optionIndex] += number(votes);
    });
  });
  return { optionVotes, validVotes, invalidVotes, totalVotes, electorate:missingElectorate ? null : electorate, statuses: [...statuses].sort() };
}

function metric(label, value) {
  const wrapper = element("div", "metric");
  wrapper.append(element("dt", "", label), element("dd", "", value));
  return wrapper;
}

function regionReference(region) {
  if (!region) return null;
  const anchorFeatureIndex = Array.isArray(region.featureIndexes)
    && Number.isInteger(region.featureIndexes[0])
    ? region.featureIndexes[0]
    : null;
  return {
    key: String(region.key || ""),
    label: String(region.label || ""),
    anchorFeatureIndex,
  };
}

function regionFocus(region, scope, path) {
  const entries = Array.isArray(path) ? path : [];
  const county = region.level === "county" ? region : entries[0];
  const parent = region.level === "village"
    ? entries[1]
    : (region.level === "county" ? null : region);
  return {
    kind: "region",
    scope,
    region: regionReference(region),
    county: regionReference(county),
    parent: regionReference(parent),
  };
}

function appendRerunLink() {
  if (state.election?.id !== "mayor_2022") return;
  const rerun = state.manifest.elections.find((entry) => entry.year === 2022
    && entry.type === "mayor" && entry.id !== "mayor_2022"
    && entry.counties.length === 1 && entry.counties[0] === "嘉義市");
  if (!rerun) return;
  detailPanel.appendChild(element("p", "rerun-note", state.compositeSources ? "嘉義市已納入 · 2022 重行選舉" : "嘉義市 2022 市長重行選舉另列。"));
  const button = element("button", "rerun-link", "查看嘉義市（重行選舉）");
  button.type = "button"; button.id = "rerun-election-button";
  const shardAtRender = state.shard;
  button.addEventListener("click", async () => {
    if (!state.mapInteractionEnabled || state.shard !== shardAtRender) return;
    if (!state.compositeSources) {
      electionSelect.value = rerun.id;
      await loadElection(rerun.id);
      if (!state.mapInteractionEnabled || state.election?.id !== rerun.id) return;
    }
    const county = state.mapHierarchy.counties.find((entry) => entry.label === "嘉義市");
    if (county) selectMapRegion(county, []);
  });
  detailPanel.appendChild(button);
}

function renderNationalOverview() {
  detailPanel.append(element("h2", "", "全國概況"), element("p", "overview-intro", "地圖以得票最多者的黨籍著色，以其催票率表示深淺。催票率＝得票數 ÷ 選舉人數。"));
  const groups = new Map();
  state.mapHierarchy.counties.forEach((county) => {
    const entry = mapLegendEntry(mapResult(county.mapAreaIndexes || []));
    const key = `${entry.color}:${entry.label}`;
    const group = groups.get(key) || { ...entry, count: 0 };
    group.count += 1; groups.set(key, group);
  });
  const distribution = element("div", "overview-distribution");
  distribution.setAttribute("aria-label", "縣市地圖著色分布；不是正式當選席次統計");
  groups.forEach((group) => {
    const row = element("div", "overview-party"); const swatch = element("span", "swatch");
    swatch.style.backgroundColor = group.color;
    row.append(swatch, element("span", "", group.label), element("strong", "", `${group.count} 縣市`));
    distribution.appendChild(row);
  });
  detailPanel.appendChild(distribution);
  const steps = element("ol", "overview-steps");
  ["點地圖或選「查看縣市」，進入地區。", "再點選區或村里，查看得票與催票率。", "開啟歷屆變化，比較縣市首長與總統選舉。"].forEach((text) => steps.appendChild(element("li", "", text)));
  detailPanel.appendChild(steps);
  appendRerunLink();
}

function renderDetail(indexes, label, mapScope = null, focus = null) {
  clear(detailPanel);
  state.selectedAreaIndexes = [...indexes];
  state.selectedLabel = label;
  state.selectedFocus = focus;
  countySelect.value = focus?.county?.key || state.mapHierarchy?.counties.find((county) => county.label === focus?.countyLabel)?.key || "";
  const countyName = newsCountyName(focus);
  if (countyName) loadCountyNews(countyName);
  else clearCountyNewsSelection();
  if (!indexes.length || !state.shard) {
    if (state.shard && !label) renderNationalOverview();
    else {
      const message = mapScope?.sourceAreaCount
        ? "此範圍沒有可唯一對位的地圖資料；完整來源請用地區清單。"
        : "此地區在目前選舉沒有可調閱的投票紀錄。";
      detailPanel.append(element("h2", "", label || "投票資料"), element("p", "", message));
      if (label === "嘉義市") appendRerunLink();
    }
    renderMap();
    return;
  }
  const aggregate = aggregateAreas(indexes);
  const detailLabel = mapScope && (mapScope.isPartial || state.election.omitted_unmapped_area_count > 0) ? `${label}（地圖可唯一對位資料）` : label;
  detailPanel.append(element("h2", "", detailLabel));
  const isRerun = state.compositeSources && indexes.every((i) => String(areaValue(state.shard.areas[i], "county_name")) === "嘉義市") || /^mayor_rerun_2022_/.test(state.election.id);
  const detailElection = isRerun && state.compositeSources ? state.compositeSources[1] : state.election;
  if (isRerun) detailPanel.appendChild(element("p", "rerun-note", `2022 嘉義市長重行選舉 · ${rerunDateLabel(detailElection.date)}`));
  appendHistoryLink(indexes, focus);
  const sourceCount = mapScope?.sourceAreaCount || indexes.length;
  const countLabel = mapScope?.isPartial
    ? `${indexes.length} 個可唯一對位來源地理單位｜完整來源共 ${sourceCount} 個`
    : `${indexes.length} 個來源地理單位`;
  detailPanel.append(element("p", "detail-meta", `${detailElection.year}｜${detailElection.name}｜${countLabel}`));
  if (isRerun) detailPanel.appendChild(element("p", "detail-meta", `來源資料識別：${detailElection.id}`));
  const omitted = detailElection.omitted_unmapped_area_count;
  if (omitted > 0) detailPanel.appendChild(element("p", "quality-note", `${isRerun ? "嘉義市" : "此資料集全體"}另有 ${omitted} 個未對位來源未打包於地圖／清單。以下為已打包來源；縣市首長與總統的完整同名來源合計可由「歷屆變化」查看。`));

  if (mapScope?.isPartial) {
    const supplemental = aggregateAreas(mapScope.supplementalAreaIndexes);
    const disclosure = element("div", "quality-note map-detail-scope");
    disclosure.appendChild(element("strong", "", "地圖可唯一對位資料："));
    disclosure.appendChild(document.createTextNode("這不是完整區域總計。"));
    disclosure.appendChild(document.createElement("br"));
    disclosure.appendChild(document.createTextNode(
      `另有 ${mapScope.supplementalAreaIndexes.length.toLocaleString("zh-TW")} 個非幾何來源地理單位未納入地圖著色與地圖詳情（總投票數 ${formatNumber(supplemental.totalVotes)}、有效票 ${formatNumber(supplemental.validVotes)}）。完整區域總計請由地區清單查看。`,
    ));
    detailPanel.appendChild(disclosure);
  }

  const metrics = element("dl", "metric-grid");
  metrics.append(
    metric("選舉人數", aggregate.electorate === null ? "資料不完整" : formatNumber(aggregate.electorate)),
    metric("總投票數", formatNumber(aggregate.totalVotes)),
    metric("有效票", formatNumber(aggregate.validVotes)),
    metric("投票率", aggregate.electorate > 0 ? formatPercent(aggregate.totalVotes * 100 / aggregate.electorate) : "無法計算"),
  );
  detailPanel.appendChild(metrics);

  const ranking = aggregate.optionVotes
    .map((votes, optionIndex) => ({ votes, optionIndex }))
    .filter((entry) => entry.votes > 0)
    .sort((a, b) => b.votes - a.votes);
  const table = element("table", "result-table");
  const head = element("thead");
  const headRow = element("tr");
  ["選項／候選人", "得票", "得票率", "催票率"].forEach((labelText) => headRow.appendChild(element("th", "", labelText)));
  head.appendChild(headRow);
  const body = element("tbody");
  ranking.forEach((entry) => {
    const option = state.shard.options[entry.optionIndex];
    const row = element("tr");
    const nameCell = element("td");
    nameCell.appendChild(element("div", "", optionLabel(option)));
    const party = String(optionValue(option, "party_name") || "");
    const mate = String(optionValue(option, "running_mate") || "");
    if (party || mate) nameCell.appendChild(element("div", "option-party", [party, mate].filter(Boolean).join("／")));
    row.append(
      nameCell,
      element("td", "", formatNumber(entry.votes)),
      element("td", "", formatPercent(aggregate.validVotes ? entry.votes * 100 / aggregate.validVotes : 0)),
      element("td", "", aggregate.electorate > 0 ? formatPercent(entry.votes * 100 / aggregate.electorate) : "無法計算"),
    );
    body.appendChild(row);
  });
  table.append(head, body);
  detailPanel.appendChild(table);
  detailPanel.appendChild(element("p", "detail-meta", "得票率分母為有效票數；催票率分母為選舉人數。"));

  const note = element("div", "quality-note");
  note.appendChild(element("strong", "", "地理對位："));
  note.appendChild(document.createTextNode(aggregate.statuses.join("、") || "unknown"));
  note.appendChild(document.createElement("br"));
  note.appendChild(document.createTextNode("地圖使用 2025 村里界；跨村里或 unresolved 紀錄應回查原始行政區。"));
  detailPanel.appendChild(note);
  renderMap();
}

function selectedAreaLabel(area) {
  return [
    areaValue(area, "county_name"),
    areaValue(area, "township_name"),
    areaValue(area, "village_name"),
  ].filter(Boolean).join("／");
}

function selectArea(areaIndex) {
  if (!state.mapInteractionEnabled) return;
  const area = state.shard.areas[areaIndex];
  renderDetail(
    [areaIndex],
    selectedAreaLabel(area),
    null,
    {
      kind: "source",
      sourceAreaId: String(areaValue(area, "source_area_id") || ""),
      countyLabel: String(areaValue(area, "county_name") || ""),
    },
  );
  document.querySelectorAll(".area-button.selected").forEach((button) => button.classList.remove("selected"));
  const selectedButton = document.querySelector(`[data-area-index="${areaIndex}"]`);
  if (selectedButton) selectedButton.classList.add("selected");
}

function updateHierarchyNavigation(warning = "") {
  const labels = state.hierarchyPath.map((region) => region.label);
  const suffix = state.hierarchyLevel === "county"
    ? "縣市選區"
    : state.hierarchyLevel === "second"
      ? (state.hierarchyLevelKind === "electoral-district" ? "當次選舉區" : "鄉鎮市區行政區")
      : "村里";
  listBreadcrumb.textContent = ["全國", ...labels, suffix].join("／");
  listBackButton.hidden = state.hierarchyLevel === "county";
  listLevelNote.classList.toggle("warning", Boolean(warning));
  if (warning) listLevelNote.textContent = warning;
  else if (state.hierarchyLevel === "county") listLevelNote.textContent = "先選擇縣市，再逐層查看選舉區與村里。";
  else if (state.hierarchyLevel === "second") listLevelNote.textContent = "目前顯示當次選舉區；選擇選舉區後查看村里級資料。";
  else listLevelNote.textContent = "目前顯示村里級資料；選擇村里查看投票詳情。";
}

function setHierarchyRegions(regions, level, levelKind, path, warning = "") {
  state.hierarchyRegions = regions;
  state.hierarchyLevel = level;
  state.hierarchyLevelKind = levelKind;
  state.hierarchyPath = path;
  updateHierarchyNavigation(warning);
  renderHierarchy(hierarchySearch.value);
}

function showHierarchyCountyLevel() {
  if (!state.mapHierarchy) return;
  setHierarchyRegions(state.mapHierarchy.counties, "county", "county", []);
}

function showHierarchySecondLevel(county) {
  const second = state.mapHierarchy.secondLevel(county.key);
  if (!second.regions.length) return false;
  setHierarchyRegions(second.regions, "second", second.kind, [county], second.warning);
  return true;
}

function showHierarchyVillageLevel(parent) {
  if (!core.canDrillToVillage(parent)) {
    updateHierarchyNavigation("該區村里劃分調整頻繁，僅顯示鄉鎮層級；請選擇鄉鎮查看合計。");
    return false;
  }
  const villages = state.mapHierarchy.villages(parent);
  const supplemental = state.mapHierarchy.supplemental(parent);
  const regions = supplemental ? [...villages, supplemental] : villages;
  if (!regions.length) return false;
  const fallbackWarning = parent.level === "township-fallback"
    ? "此資料集尚未提供更細的選舉區邊界；目前由 2025 鄉鎮市區行政區進入村里級資料。"
    : "";
  const supplementalWarning = supplemental
    ? `${supplemental.areaIndexes.length.toLocaleString("zh-TW")} 筆來源資料列於「未能唯一對位至 2025 村里」，不會重複分派到村里。`
    : "";
  setHierarchyRegions(
    regions,
    "village",
    "village",
    [...state.hierarchyPath, parent],
    [fallbackWarning, supplementalWarning].filter(Boolean).join(" "),
  );
  return true;
}

function hierarchySearchLabel(area) {
  return [
    selectedAreaLabel(area),
    areaValue(area, "electoral_district_name"),
  ].filter(Boolean).join("／");
}

function openCounty(county) {
  if (!state.mapInteractionEnabled || !county) return;
  hierarchySearch.value = "";
  countySelect.value = county.key;
  showCountyLevel();
  showHierarchyCountyLevel();
  showHierarchySecondLevel(county);
  const mapScope = state.view === "map" ? core.mapDetailScope(county) : null;
  renderDetail(mapScope ? mapScope.areaIndexes : county.areaIndexes, county.label, mapScope, regionFocus(county, state.view, []));
}

function populateCountySelect() {
  clear(countySelect);
  const placeholder = element("option", "", "全國");
  placeholder.value = "";
  countySelect.appendChild(placeholder);
  [...state.mapHierarchy.counties].sort((a, b) => Number(Boolean(b.areaIndexes.length)) - Number(Boolean(a.areaIndexes.length))).forEach(county => {
    const option = element("option", "", `${state.compositeSources && county.label === "嘉義市" ? "嘉義市（重行選舉）" : county.label}${county.areaIndexes.length ? "" : "（此投票項目未收錄）"}`);
    option.value = county.key;
    countySelect.appendChild(option);
  });
}

function renderHierarchySearch(search, renderGeneration, offset = 0) {
  const entries = [
    ...state.mapHierarchy.counties.filter(county => county.areaIndexes.length).map(county => ({ label: county.label, kind: "county", county })),
    ...state.shard.areas.map((area, index) => ({ index, label: hierarchySearchLabel(area), kind: "area" })),
  ];
  const page = core.searchPage(entries, search, offset, HIERARCHY_SEARCH_LIMIT);
  if (!page.total) {
    hierarchy.appendChild(element("p", "empty-state", "找不到符合的地名。請縮短關鍵字，或改選其他投票項目。"));
    return;
  }
  hierarchy.appendChild(element("p", "search-summary", `符合 ${page.total.toLocaleString("zh-TW")} 筆；顯示第 ${offset + 1}–${offset + page.entries.length} 筆（含縣市總計）。`));
  page.entries.forEach(entry => {
    const button = element("button", "hierarchy-region-button");
    button.type = "button";
    button.disabled = !state.mapInteractionEnabled;
    if (entry.kind === "area") button.dataset.areaIndex = String(entry.index);
    button.append(element("span", "", entry.label), element("span", "hierarchy-region-meta", entry.kind === "county" ? "縣市總計・查看行政區／選區" : core.mapLinkageLabel(areaValue(state.shard.areas[entry.index], "map_area_ids"))));
    button.addEventListener("click", () => {
      if (renderGeneration !== state.hierarchyRenderGeneration || !state.mapInteractionEnabled) return;
      if (entry.kind === "county") openCounty(entry.county);
      else selectArea(entry.index);
    });
    hierarchy.appendChild(button);
  });
  const pager = element("div", "search-pagination");
  for (const [label, next] of [["上一頁", offset - HIERARCHY_SEARCH_LIMIT], ["下一頁", offset + HIERARCHY_SEARCH_LIMIT]]) {
    if (next < 0 || next >= page.total) continue;
    const button = element("button", "", label);
    button.type = "button";
    button.addEventListener("click", () => {
      if (renderGeneration !== state.hierarchyRenderGeneration || !state.mapInteractionEnabled) return;
      clear(hierarchy);
      renderHierarchySearch(search, ++state.hierarchyRenderGeneration, next);
      hierarchy.scrollTop = 0;
      hierarchy.querySelector("button")?.focus();
    });
    pager.appendChild(button);
  }
  hierarchy.appendChild(pager);
}

function renderHierarchy(searchValue = "") {
  const renderGeneration = state.hierarchyRenderGeneration + 1;
  state.hierarchyRenderGeneration = renderGeneration;
  clear(hierarchy);
  if (!state.shard || !state.mapHierarchy) {
    hierarchy.appendChild(element("p", "empty-state", "請先選擇有資料的投票項目。"));
    return;
  }
  const search = searchValue.trim().toLocaleLowerCase("zh-Hant");
  hierarchy.dataset.hierarchyMode = search ? "search" : "drilldown";
  hierarchy.dataset.hierarchyLevel = state.hierarchyLevel;
  if (search) {
    renderHierarchySearch(search, renderGeneration);
    return;
  }
  hierarchy.dataset.hierarchyRegionCount = String(state.hierarchyRegions.length);
  state.hierarchyRegions.forEach((region) => {
    const button = element("button", "hierarchy-region-button");
    button.type = "button";
    button.disabled = !state.mapInteractionEnabled
      || (!region.areaIndexes.length && state.hierarchyLevel !== "county");
    button.append(
      element("span", "", region.label),
      element(
        "span",
        "hierarchy-region-meta",
        region.areaIndexes.length
          ? `${region.areaIndexes.length.toLocaleString("zh-TW")} 個來源地理單位`
          : "目前資料集無資料",
      ),
    );
    button.addEventListener("click", () => {
      if (renderGeneration !== state.hierarchyRenderGeneration) return;
      if (!state.mapInteractionEnabled) return;
      const label = [...state.hierarchyPath.map((entry) => entry.label), region.label].join("／");
      renderDetail(
        region.areaIndexes,
        label,
        null,
        regionFocus(region, "list", state.hierarchyPath),
      );
      if (state.hierarchyLevel === "county") showHierarchySecondLevel(region);
      else if (state.hierarchyLevel === "second") showHierarchyVillageLevel(region);
    });
    hierarchy.appendChild(button);
  });
}

function prepareShard(shard) {
  const areaColumn = Object.fromEntries(shard.area_columns.map((name, index) => [name, index]));
  const optionColumn = Object.fromEntries(shard.option_columns.map((name, index) => [name, index]));
  const votesByArea = Array.from(
    { length: shard.areas.length },
    () => Array(shard.options.length).fill(0),
  );
  const nationalTotals = Array(shard.options.length).fill(0);
  shard.votes.forEach(([areaIndex, optionIndex, votes]) => {
    votesByArea[areaIndex][optionIndex] += number(votes);
    nationalTotals[optionIndex] += number(votes);
  });
  const areaIndexesByMapId = core.buildMapAreaIndexes(shard.areas, areaColumn.map_area_ids);
  const mapHierarchy = core.buildMapHierarchy(
    state.features,
    shard.areas,
    areaColumn,
    areaIndexesByMapId,
  );
  return {
    shard,
    areaColumn,
    optionColumn,
    votesByArea,
    nationalTotals,
    areaIndexesByMapId,
    mapHierarchy,
  };
}

function applyPreparedDataset(prepared) {
  state.compositeSources = prepared.compositeSources || null;
  state.shard = prepared.shard;
  state.areaColumn = prepared.areaColumn;
  state.optionColumn = prepared.optionColumn;
  state.votesByArea = prepared.votesByArea;
  state.nationalTotals = prepared.nationalTotals;
  state.areaIndexesByMapId = prepared.areaIndexesByMapId;
  state.mapHierarchy = prepared.mapHierarchy;
  state.selectedAreaIndexes = [];
  state.selectedLabel = "";
  state.selectedFocus = null;
  state.useFullBounds = false;
  state.mapView = { zoom: 1, panX: 0, panY: 0 };
  populateCountySelect();
  setMapInteractionEnabled(true);
  renderLegend();
}

function hydrateShard(shard) {
  const prepared = prepareShard(shard);
  applyPreparedDataset(prepared);
  return prepared;
}

function copyFocus(focus) {
  if (!focus) return null;
  return {
    ...focus,
    region: focus.region ? { ...focus.region } : null,
    county: focus.county ? { ...focus.county } : null,
    parent: focus.parent ? { ...focus.parent } : null,
  };
}

function captureSurfaceIntent(level, path, previous) {
  const captured = core.captureNavigationIntent(level, path);
  const previousAnchor = previous?.parent?.anchorFeatureIndex;
  const currentParent = Array.isArray(path) ? path[1] : null;
  const sameCounty = captured.county?.key && captured.county.key === previous?.county?.key;
  if (
    captured.level === "village"
    && previous?.level === "village"
    && sameCounty
    && Number.isInteger(previousAnchor)
    && Array.isArray(currentParent?.featureIndexes)
    && currentParent.featureIndexes.includes(previousAnchor)
  ) {
    captured.parent.anchorFeatureIndex = previousAnchor;
  }
  return captured;
}

function captureDatasetIntent() {
  if (!state.mapInteractionEnabled || !state.mapHierarchy) return state.navigationIntent;
  return {
    map: captureSurfaceIntent(state.mapLevel, state.mapPath, state.navigationIntent?.map),
    hierarchy: captureSurfaceIntent(
      state.hierarchyLevel,
      state.hierarchyPath,
      state.navigationIntent?.hierarchy,
    ),
    selection: copyFocus(state.selectedFocus),
    view: state.view,
  };
}

function restoreMapIntent() {
  // A new election starts with nationwide coverage, even after a prior drilldown.
  showCountyLevel();
}

function restoreHierarchyIntent(intent) {
  const resolved = core.resolveNavigationIntent(state.mapHierarchy, intent);
  showHierarchyCountyLevel();
  if (resolved.level === "second") showHierarchySecondLevel(resolved.county);
  if (resolved.level === "village") {
    showHierarchySecondLevel(resolved.county);
    showHierarchyVillageLevel(resolved.parent);
  }
}

function restoreSelectedFocus(focus) {
  if (!focus) {
    renderDetail([], "");
    return;
  }
  if (focus.kind === "source") {
    const sourceColumn = state.areaColumn.source_area_id;
    const sourceIndex = state.shard.areas.findIndex(
      (area) => String(area[sourceColumn] || "") === String(focus.sourceAreaId || ""),
    );
    if (sourceIndex >= 0) {
      const area = state.shard.areas[sourceIndex];
      renderDetail([sourceIndex], selectedAreaLabel(area), null, copyFocus(focus));
      return;
    }
  }
  const county = core.findRegionByReference(state.mapHierarchy.counties, focus.county || focus.region);
  if (!county) {
    renderDetail([], "");
    return;
  }
  let target = county;
  const path = [];
  const second = state.mapHierarchy.secondLevel(county.key);
  const parent = focus.parent
    ? core.findRegionByReference(second.regions, focus.parent)
    : null;
  if (parent) {
    target = parent;
    path.push(county);
    const village = core.findRegionByReference(state.mapHierarchy.villages(parent), focus.region);
    if (village) {
      target = village;
      path.push(parent);
    }
  }
  const labels = [...path.map((entry) => entry.label), target.label];
  const mapScope = focus.scope === "map" ? core.mapDetailScope(target) : null;
  const indexes = mapScope ? mapScope.areaIndexes : target.areaIndexes;
  const restoredFocus = regionFocus(target, focus.scope, path);
  const previousAnchor = focus.parent?.anchorFeatureIndex;
  if (
    restoredFocus.parent
    && Number.isInteger(previousAnchor)
    && Array.isArray(parent?.featureIndexes)
    && parent.featureIndexes.includes(previousAnchor)
  ) {
    restoredFocus.parent.anchorFeatureIndex = previousAnchor;
  }
  renderDetail(indexes, labels.join("／"), mapScope, restoredFocus);
}

function restoreDatasetIntent(intent) {
  const desired = intent || state.navigationIntent;
  hierarchySearch.value = "";
  if (!desired) {
    showCountyLevel();
    showHierarchyCountyLevel();
    renderDetail([], "");
  } else {
    restoreMapIntent(desired.map);
    restoreHierarchyIntent(desired.hierarchy);
    restoreSelectedFocus(desired.selection);
    if (desired.view === "list" || desired.view === "map") switchView(desired.view);
  }
  state.navigationIntent = captureDatasetIntent();
}

function clearMapCanvas() {
  const context = mapCanvas.getContext("2d");
  const ratio = state.viewport.pixelRatio || 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, state.viewport.width, state.viewport.height);
  context.fillStyle = state.mapTheme === "dark" ? "#101820" : "#e9f0f2";
  context.fillRect(0, 0, state.viewport.width, state.viewport.height);
}

function resetDatasetState() {
  setMapInteractionEnabled(false);
  hierarchySearch.placeholder = "輸入縣市、選舉區、鄉鎮市區或村里";
  state.shard = null;
  state.election = null;
  state.compositeSources = null;
  state.areaColumn = {};
  state.optionColumn = {};
  state.votesByArea = [];
  state.nationalTotals = [];
  state.areaIndexesByMapId = new Map();
  state.selectedAreaIndexes = [];
  state.selectedLabel = "";
  state.selectedFocus = null;
  state.mapHierarchy = null;
  state.mapRegions = [];
  state.hierarchyRegions = [];
  clearMapCanvas();
  clear(mapLegend);
  clear(hierarchy);
  hierarchy.appendChild(element("p", "empty-state", "正在載入新的投票資料…"));
  clear(detailPanel);
  detailPanel.append(element("h2", "", "投票資料"), element("p", "", "正在載入目前區域的新資料…"));
}

function cancelActiveDatasetRequest() {
  if (state.activeDatasetController) state.activeDatasetController.abort();
  state.activeDatasetController = null;
}

async function loadElection(electionId, initialShardPromise = null) {
  const metadata = state.manifest.elections.find((entry) => entry.id === electionId);
  if (!metadata) return;
  const intent = captureDatasetIntent();
  state.navigationIntent = intent;
  cancelActiveDatasetRequest();
  const controller = new AbortController();
  state.activeDatasetController = controller;
  const generation = requestGate.begin();
  resetDatasetState();
  mapLoading.textContent = "正在載入投票資料並還原目前區域…";
  mapLoading.classList.remove("hidden");
  datasetStatus.textContent = `載入 ${metadata.year} ${metadata.name}…`;
  electionSelect.disabled = true;
  try {
    let prepared = preparedDatasetCache.get(electionId);
    if (prepared) {
      state.election = prepared.displayElection || metadata;
      applyPreparedDataset(prepared);
    } else {
      const shard = await (initialShardPromise || fetchJson(`data/${metadata.file}`, controller.signal));
      if (!requestGate.isCurrent(generation)) return;
      core.validateShard(shard, metadata);
      let display = shard;
      const rerun = metadata.id === "mayor_2022" ? state.manifest.elections.find((entry) => /^mayor_rerun_2022_[0-9]+$/.test(entry.id)) : null;
      if (rerun) {
        const supplement = await fetchJson(`data/${rerun.file}`, controller.signal);
        if (!requestGate.isCurrent(generation)) return;
        display = core.combineMayor2022(shard, metadata, supplement, rerun);
      }
      prepared = prepareShard(display);
      if (rerun) {
        prepared.compositeSources = [metadata, rerun];
        prepared.displayElection = {...metadata, counties:[...metadata.counties, "嘉義市"],
          omitted_unmapped_area_count:metadata.omitted_unmapped_area_count + rerun.omitted_unmapped_area_count};
      }
      state.election = prepared.displayElection || metadata;
      applyPreparedDataset(prepared);
      preparedDatasetCache.set(electionId, prepared);
    }
    if (!requestGate.isCurrent(generation)) return;
    const searchExamples = core.hierarchySearchExamples(state.shard);
    hierarchySearch.placeholder = searchExamples.length
      ? `例如：${searchExamples.join("、")}` : "輸入縣市、選舉區、鄉鎮市區或村里";
    restoreDatasetIntent(intent);
    mapLoading.classList.add("hidden");
    electionSelect.disabled = false;
    if (state.activeDatasetController === controller) state.activeDatasetController = null;
    electionHeading.textContent = metadata.id === `mayor_${metadata.year}`
      ? `${metadata.year} 縣市長選舉` : `${metadata.year} ${metadata.name.replace(new RegExp(`^${metadata.year}(?:年)?\\s*`), "")}`;
    datasetStatus.textContent = `已載入 · ${state.election.counties.length} 縣市${state.compositeSources ? " · 含嘉義市重行選舉" : ""}`;
  } catch (error) {
    if (requestGate.isCurrent(generation)) {
      resetDatasetState();
      clearCountyNewsSelection();
      mapLoading.classList.add("hidden");
      electionSelect.disabled = false;
      showFatalError(error);
    }
    if (state.activeDatasetController === controller) state.activeDatasetController = null;
    return;
  }
}

function preferredElectionId(year) {
  const ids = state.manifest.years.find((entry) => entry.year === year)?.election_ids || [];
  const previousType = state.election?.type;
  const sameFamily = previousType ? `${previousType}_${year}` : "";
  return [sameFamily, `mayor_${year}`, `president_${year}`, ids[0]].find((id) => id && ids.includes(id)) || "";
}

function initialElectionId() {
  const defaultYear = state.manifest.years.find((entry) => entry.year === 2022);
  if (defaultYear?.election_ids.includes("mayor_2022")) return "mayor_2022";
  const latest = [...state.manifest.years].sort((a, b) => b.year - a.year).find((entry) => entry.available && entry.election_ids.length);
  return latest ? preferredElectionId(latest.year) : "";
}

function populateElectionSelect(year, load = true, preferredId = "") {
  clear(electionSelect);
  const ids = state.manifest.years.find((entry) => entry.year === year).election_ids;
  if (!ids.length) {
    state.navigationIntent = captureDatasetIntent();
    cancelActiveDatasetRequest();
    requestGate.invalidate();
    const option = element("option", "", `${year} 年無收錄投票資料`);
    option.value = "";
    electionSelect.appendChild(option);
    electionSelect.disabled = true;
    resetDatasetState();
    mapLoading.classList.add("hidden");
    electionHeading.textContent = `${year} 年`;
    datasetStatus.textContent = `${year} 年未收錄投票資料。`;
    clear(detailPanel); clear(hierarchy);
    detailPanel.append(element("h2", "", "此年未收錄資料"), element("p", "", "請選擇其他年份。缺漏紀錄不會補成零票。"));
    hierarchy.appendChild(element("p", "empty-state", "此年未收錄資料，請選擇其他年份。"));
    return;
  }
  ids.forEach((id) => {
    const metadata = state.manifest.elections.find((entry) => entry.id === id);
    const option = element("option", "", metadata.name);
    option.value = metadata.id;
    electionSelect.appendChild(option);
  });
  const selected = ids.includes(preferredId) ? preferredId : preferredElectionId(year);
  electionSelect.value = selected;
  electionSelect.disabled = false;
  if (load) loadElection(selected);
}

function populateYearSelect(load = true) {
  clear(yearSelect);
  coverageNote.textContent = core.unavailableYearsText(state.manifest.years);
  [...state.manifest.years].sort((a, b) => b.year - a.year).forEach((entry) => {
    const label = entry.available ? String(entry.year) : `${entry.year}（無收錄投票）`;
    const option = element("option", "", label);
    option.value = String(entry.year);
    yearSelect.appendChild(option);
  });
  const initialId = initialElectionId();
  const initial = state.manifest.elections.find((entry) => entry.id === initialId);
  if (!initial) throw new Error("沒有可載入的投票資料");
  yearSelect.value = String(initial.year);
  yearSelect.disabled = false;
  populateElectionSelect(initial.year, load, initialId);
  electionSelect.value = initialId;
  return initialId;
}

function switchView(view) {
  if (state.mapInteractionEnabled && view !== state.view) {
    if (view === "map") restoreMapIntent(core.captureNavigationIntent(state.hierarchyLevel, state.hierarchyPath));
    else restoreHierarchyIntent(core.captureNavigationIntent(state.mapLevel, state.mapPath));
  }
  state.view = view;
  const mapActive = view === "map";
  mapButton.classList.toggle("active", mapActive);
  listButton.classList.toggle("active", !mapActive);
  mapButton.setAttribute("aria-pressed", String(mapActive));
  listButton.setAttribute("aria-pressed", String(!mapActive));
  mapView.classList.toggle("hidden", !mapActive);
  listView.classList.toggle("hidden", mapActive);
  if (mapActive) requestAnimationFrame(resizeCanvas);
}

function showFatalError(error) {
  datasetStatus.textContent = `載入失敗：${error.message}`;
  clear(detailPanel);
  detailPanel.append(element("h2", "", "無法開啟本地資料"), element("p", "", error.message));
}

function mapPointFromEvent(event) {
  const rectangle = mapCanvas.getBoundingClientRect();
  return [event.clientX - rectangle.left, event.clientY - rectangle.top];
}

function selectMapRegion(region, path = state.mapPath) {
  if (!state.mapInteractionEnabled) return;
  const geographicLabel = [...path.map((entry) => entry.label), region.label].join("／");
  const mapScope = core.mapDetailScope(region);
  renderDetail(mapScope.areaIndexes, geographicLabel, mapScope, regionFocus(region, "map", path));
  if (region.level === "county") showSecondLevel(region);
  else if (state.mapLevel === "second") showVillageLevel(region);
}

mapCanvas?.addEventListener("click", (event) => {
  if (!state.mapInteractionEnabled) return;
  if (Date.now() < state.suppressMapClickUntil) {
    state.suppressMapClickUntil = 0;
    return;
  }
  const screen = mapPointFromEvent(event);
  const geographic = inverseProjection(screen[0], screen[1]);
  const region = state.mapRegions.find((candidate) => featureContains(candidate, geographic));
  if (region) selectMapRegion(region);
});

countySelect?.addEventListener("change", () => {
  if (!state.mapInteractionEnabled) return;
  const county = state.mapHierarchy?.counties.find(entry => entry.key === countySelect.value);
  if (county) openCounty(county);
  else {
    hierarchySearch.value = "";
    showCountyLevel(); showHierarchyCountyLevel(); renderDetail([], "");
  }
});

document.getElementById("history-close")?.addEventListener("click", () => {
  document.getElementById("history-panel")?.classList.add("hidden");
  document.body.classList.remove("history-open");
  document.querySelector(".control-card")?.scrollIntoView({ block: "start" });
  countySelect?.focus({ preventScroll: true });
});

mapCanvas?.addEventListener("wheel", (event) => {
  if (!state.mapInteractionEnabled) return;
  event.preventDefault();
  mapZoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18, mapPointFromEvent(event));
}, { passive: false });

mapCanvas?.addEventListener("pointerdown", (event) => {
  if (!state.mapInteractionEnabled) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (state.mapPointers.size >= 2) return;
  state.suppressMapClickUntil = 0;
  state.mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  mapCanvas.setPointerCapture(event.pointerId);
  if (state.mapPointers.size === 1) {
    state.mapGesture = {
      kind: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      panX: state.mapView.panX, panY: state.mapView.panY, moved: false,
    };
  } else {
    const [first, second] = [...state.mapPointers.values()];
    const midpoint = [(first.x + second.x) / 2, (first.y + second.y) / 2];
    const localMidpoint = mapPointFromEvent({ clientX: midpoint[0], clientY: midpoint[1] });
    state.mapGesture = {
      kind: "pinch",
      pointerIds: [...state.mapPointers.keys()],
      startDistance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
      startMidpoint: midpoint,
      startZoom: state.mapView.zoom,
      panX: state.mapView.panX,
      panY: state.mapView.panY,
      anchor: inverseProjection(localMidpoint[0], localMidpoint[1]),
      moved: false,
    };
  }
});
mapCanvas?.addEventListener("pointermove", (event) => {
  if (!state.mapInteractionEnabled || !state.mapPointers.has(event.pointerId)) return;
  state.mapPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const gesture = state.mapGesture;
  if (!gesture) return;
  if (gesture.kind === "pan") {
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 4) gesture.moved = true;
    if (gesture.moved) {
      state.mapView.panX = gesture.panX + dx;
      state.mapView.panY = gesture.panY + dy;
      renderMap();
    }
    return;
  }
  const first = state.mapPointers.get(gesture.pointerIds[0]);
  const second = state.mapPointers.get(gesture.pointerIds[1]);
  if (!first || !second) return;
  const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
  const midpoint = [(first.x + second.x) / 2, (first.y + second.y) / 2];
  if (Math.abs(distance - gesture.startDistance) > 4 || Math.hypot(midpoint[0] - gesture.startMidpoint[0], midpoint[1] - gesture.startMidpoint[1]) > 4) gesture.moved = true;
  if (!gesture.moved) return;
  const localMidpoint = mapPointFromEvent({ clientX: midpoint[0], clientY: midpoint[1] });
  state.mapView.zoom = Math.max(0.65, Math.min(14, gesture.startZoom * distance / gesture.startDistance));
  state.mapView.panX = gesture.panX;
  state.mapView.panY = gesture.panY;
  const projected = mapProjection(gesture.anchor);
  state.mapView.panX += localMidpoint[0] - projected[0];
  state.mapView.panY += localMidpoint[1] - projected[1];
  renderMap();
});
function finishMapPointer(event, canceled = false) {
  if (!state.mapPointers.has(event.pointerId)) return;
  const gesture = state.mapGesture;
  if (gesture?.moved || gesture?.kind === "pinch" || canceled) state.suppressMapClickUntil = Date.now() + 500;
  state.mapPointers.delete(event.pointerId);
  if (mapCanvas?.hasPointerCapture?.(event.pointerId)) mapCanvas.releasePointerCapture(event.pointerId);
  if (gesture?.kind === "pinch") {
    const [remainingId, remaining] = state.mapPointers.entries().next().value || [];
    state.mapGesture = remaining ? {
      kind: "pan", pointerId: remainingId, x: remaining.x, y: remaining.y,
      panX: state.mapView.panX, panY: state.mapView.panY, moved: true,
    } : null;
  } else if (state.mapPointers.size) {
    const [remainingId, remaining] = state.mapPointers.entries().next().value;
    state.mapGesture = {
      kind: "pan", pointerId: remainingId, x: remaining.x, y: remaining.y,
      panX: state.mapView.panX, panY: state.mapView.panY, moved: true,
    };
  } else state.mapGesture = null;
}
mapCanvas?.addEventListener("pointerup", (event) => finishMapPointer(event));
mapCanvas?.addEventListener("pointercancel", (event) => finishMapPointer(event, true));
mapCanvas?.addEventListener("lostpointercapture", (event) => finishMapPointer(event, true));

function resetHistoricalMapView() {
  if (!state.mapInteractionEnabled) return;
  state.useFullBounds = false;
  state.mapView = { zoom: 1, panX: 0, panY: 0 };
  renderMap();
}
resetMapButton?.addEventListener("click", resetHistoricalMapView);
document.getElementById("map-control-zoom-in")?.addEventListener("click", () => mapZoomBy(1.25));
document.getElementById("map-control-zoom-out")?.addEventListener("click", () => mapZoomBy(1 / 1.25));
document.getElementById("map-control-pan-up")?.addEventListener("click", () => mapPanBy(0, 60));
document.getElementById("map-control-pan-left")?.addEventListener("click", () => mapPanBy(60, 0));
document.getElementById("map-control-pan-right")?.addEventListener("click", () => mapPanBy(-60, 0));
document.getElementById("map-control-pan-down")?.addEventListener("click", () => mapPanBy(0, -60));
document.getElementById("map-control-reset")?.addEventListener("click", resetHistoricalMapView);
mapBackButton?.addEventListener("click", () => {
  if (!state.mapInteractionEnabled) return;
  if (state.mapLevel === "village" && state.mapPath[0]) showSecondLevel(state.mapPath[0]);
  else showCountyLevel();
});
mapHomeButton?.addEventListener("click", () => {
  if (!state.mapInteractionEnabled) return;
  showCountyLevel();
  showHierarchyCountyLevel();
  renderDetail([], "");
});
listBackButton?.addEventListener("click", () => {
  if (!state.mapInteractionEnabled) return;
  if (hierarchySearch) hierarchySearch.value = "";
  if (state.hierarchyLevel === "village" && state.hierarchyPath[0]) {
    showHierarchySecondLevel(state.hierarchyPath[0]);
  } else {
    showHierarchyCountyLevel();
  }
});
listHomeButton?.addEventListener("click", () => {
  if (!state.mapInteractionEnabled) return;
  if (hierarchySearch) hierarchySearch.value = "";
  showHierarchyCountyLevel();
  showCountyLevel();
  renderDetail([], "");
});
fullMapButton?.addEventListener("click", () => {
  if (!state.mapInteractionEnabled) return;
  state.useFullBounds = true;
  state.mapView = { zoom: 1, panX: 0, panY: 0 };
  renderMap();
});
mapButton?.addEventListener("click", () => switchView("map"));
listButton?.addEventListener("click", () => switchView("list"));
yearSelect?.addEventListener("change", () => populateElectionSelect(Number(yearSelect.value)));
electionSelect?.addEventListener("change", () => {
  if (electionSelect.value) loadElection(electionSelect.value);
});
hierarchySearch?.addEventListener("input", () => {
  if (!state.mapInteractionEnabled) return;
  renderHierarchy(hierarchySearch.value);
});
window.addEventListener("resize", () => requestAnimationFrame(resizeCanvas));

async function initialize() {
  try {
    const manifest = await fetchJson(MANIFEST_PATH);
    if (manifest.schema !== "election-machine-offline-v1") throw new Error("離線 manifest schema 不相容");
    state.manifest = manifest;
    if (manifest.mayor_history) {
      core.validateHistoryPointer(manifest.mayor_history, manifest.source.database_sha256);
      historyPointer = manifest.mayor_history;
    }
    if (manifest.president_history) {
      core.validateHistoryPointer(manifest.president_history, manifest.source.database_sha256);
      presidentHistoryPointer = manifest.president_history;
    }

    const urlTheme = new URLSearchParams(window.location.search).get("theme");
    let savedTheme; try { savedTheme = localStorage.getItem("twvote:theme"); } catch (_) {}
    state.mapTheme = ["light","dark"].includes(urlTheme) ? urlTheme : ["light","dark"].includes(savedTheme) ? savedTheme : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    updateMapThemeControls();

    // Map and the active office summary have independent loading pipelines.
    const countyPipeline = fetchJson(`data/${manifest.geography.county_topology.file}`, null, manifest.geography.county_topology.sha256).then(async countyTopology => {
      await new Promise(resolve => setTimeout(resolve, 0));
      state.topology = countyTopology;
      const decoded = core.decodeTopology(countyTopology);
      state.features = decoded.features;
      observation.geography = core.buildObservationGeography(decoded.features);
      state.nationalBounds = decoded.primaryBounds; state.nationalFullBounds = decoded.fullBounds;
      state.bounds = decoded.primaryBounds; state.fullBounds = decoded.fullBounds;
      renderObservationMap();
    });
    const obsPipeline = initializeObservation(manifest.observation_2026);
    const initialization = await Promise.allSettled([countyPipeline, obsPipeline]);
    const failure = initialization.find(result => result.status === "rejected");
    if (failure) throw failure.reason;

    // 處理初始 hash 路由
    await handleHashRoute();
    window.addEventListener("hashchange", handleHashRoute);
    window.dispatchEvent(new Event("observation-ready"));
  } catch (error) {
    if (mapLoading) mapLoading.classList.add("hidden");
    observation.mapError = "網站資料未能載入，請重新載入。";
    renderObservationMap();
    const host = document.getElementById("contest-board-container");
    host.classList.remove("hidden"); observationDetail.classList.add("hidden"); clear(host);
    host.appendChild(element("p", "observation-error", `網站資料載入失敗：${error.message}`));
    const retry = element("button", "detail-card-action", "重新載入網站"); retry.type="button"; retry.addEventListener("click",()=>window.location.reload()); host.appendChild(retry);
    document.getElementById("observation-inspector").dataset.detent="expanded";
  }
}

const townGeographyCache = new Map(), townGeographyPending = new Map();
let townIndexPromise = null;
function loadedTownships(county) { return townGeographyCache.get(county)?.townships(county) || []; }
function loadTownGeography(county = observation.county) {
  if (!county) return Promise.resolve();
  if (townGeographyCache.has(county)) { const value=townGeographyCache.get(county); townGeographyCache.delete(county); townGeographyCache.set(county,value); return Promise.resolve(); }
  if (townGeographyPending.has(county)) return townGeographyPending.get(county);
  const task = (async () => {
    if (!townIndexPromise) { const pointer=state.manifest.geography.town_index; townIndexPromise=fetchJson(`data/${pointer.file}`,null,pointer.sha256).then(index=>{if(index.schema!=="town-shards-v1")throw new Error("鄉鎮索引版本不符");return index;}).catch(error=>{townIndexPromise=null;throw error;}); }
    const index=await townIndexPromise, entry=Object.values(index.counties).find(c=>c.name===county);
    if (!entry) throw new Error("此縣市沒有鄉鎮圖資");
    const pointer=entry.resource, topology=await fetchJson(`data/${pointer.file}`,null,pointer.sha256);
    await new Promise(resolve=>setTimeout(resolve,0));
    const decoded=core.decodeTopology(topology);
    if(decoded.features.length!==pointer.featureCount)throw new Error("鄉鎮圖資數量不符");
    townGeographyCache.set(county,core.buildObservationGeography(decoded.features));
    while(townGeographyCache.size>3) { const oldest=[...townGeographyCache.keys()].find(key=>key!==observation.county); townGeographyCache.delete(oldest); }
    observation.geography={counties:observation.geography?.counties||[],townships:loadedTownships,villages:loadedVillages};
    if (observation.county===county) {
      observation.mapError=null;
      if(observation.district&&!observation.township)refreshObservationDetail(()=>renderObservationDistrict(observation.district));
      renderObservationNavigation(); renderObservationMap();
    }
  })().catch(error=>{if(observation.county===county){observation.mapError="鄉鎮圖資載入失敗，請重試。";showRouteError(error);renderObservationMap();}}).finally(()=>townGeographyPending.delete(county));
  townGeographyPending.set(county,task);return task;
}

// The observation view has its own request generation and clears stale data first.
const observation = {
  geography: null, mapError: null, countyError: null, mapKey: "", mapRegions: [], mapZoom: 1, mapPan: [0, 0], mapHover: null, mapPointers: new Map(), mapGesture: null, mapFull: false, renderGeneration: 0, manifest: null, shard: null, county: null, office: null, township: null, district: null, village: null, swingAnalysis: null, swingData: null, nationalSwing: new Map(), nationalSwingReady: false, nationalSwingFailureCount: 0, nationalSwingPromise: null, controller: null, gate: new core.RequestGate(), cache: new core.BoundedLruCache(3),
  cardOpenState: {}, cardStateDistrict: null,
  activeFilters: new Set(["close_swing", "close_only"]),
  councilorLens: "councilor", councilMapLayer: "competition",
  swingMarginThreshold: 0.03,
  yearBaseline: "default",
};
const observationPanel = document.getElementById("observation-panel");
const observationNavigation = document.getElementById("observation-navigation");
const observationDetail = document.getElementById("observation-detail");
const observationFilterBar = document.getElementById("observation-filter-bar");
const observationSearch = document.getElementById("observation-search");
const observationBreadcrumb = document.getElementById("observation-breadcrumb");
const observationMeta = document.getElementById("observation-meta");
const observationMode = document.getElementById("observation-mode");
const historyMode = document.getElementById("history-mode");
const viewModeGuide = document.getElementById("view-mode-guide");
const observationOffice = document.getElementById("observation-office");
const observationMapCanvas = document.getElementById("observation-map");
const observationMapBack = document.getElementById("observation-map-back");
const observationMapFull = document.getElementById("observation-map-full");
const observationMapHover = document.getElementById("observation-map-hover");
const observationMapStatus = document.getElementById("observation-map-status");
const observationList = document.getElementById("observation-list");
const observationIslands = document.getElementById("observation-islands");

function setObservationMode(active) {
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("observation-stage-active", active);
  }
  observationPanel.classList.toggle("hidden", !active);
  document.getElementById("historical-workspace").classList.toggle("hidden", active);
  observationMode.setAttribute("aria-pressed", String(active));
  historyMode.setAttribute("aria-pressed", String(!active));
  observationMode.classList.toggle("active", active);
  historyMode.classList.toggle("active", !active);
  viewModeGuide.textContent = active
    ? "查看 2026 選前名冊與歷年比較；要瀏覽過去各次選舉結果，請切換至「歷屆選情」。"
    : "查看過去選情：先選年份與選舉資料集，再點選地圖或切換地區清單；上方可返回 2026 選舉觀察。";
  if (!active) {
    if (observation.county && countySelect && state.mapHierarchy) {
      const match = state.mapHierarchy.counties.find(c => c.label === observation.county);
      if (match && countySelect.value !== match.key) {
        countySelect.value = match.key;
        openCounty(match);
      }
    }
    requestAnimationFrame(resizeCanvas);
  } else {
    if (countySelect?.value && state.mapHierarchy) {
      const countyObj = state.mapHierarchy.counties.find(c => c.key === countySelect.value);
      if (countyObj && observation.county !== countyObj.label) {
        loadObservationCounty(countyObj.label);
      }
    }
    requestAnimationFrame(drawObservationMap);
  }
}
observationMode?.addEventListener("click", () => setObservationMode(true));
historyMode?.addEventListener("click", () => setObservationMode(false));
observationSearch?.addEventListener("input", renderObservationNavigation);

function observationSource(id, page = null, pageTitle = "名冊") {
  const source = observation.manifest.sources.find(s => s.id === id);
  const link = element("a", "observation-source", `${page ? `${pageTitle}第 ${page} 頁` : source.title}（外部來源，新分頁）`);
  link.setAttribute("aria-label", `${source.title}${page ? `，第 ${page} 頁` : ""}（外部來源，新分頁）`);
  link.href = source.url + (page ? `#page=${page}` : "");
  link.target = "_blank"; link.rel = "noopener noreferrer";
  return link;
}
function observationNumber(value) { return value === null ? "未有可用資料" : value.toLocaleString("zh-TW"); }
function observationPercent(value) { return value === null ? "—" : `${value.toFixed(2)}%`; }
function observationTable(caption, headers, rows) {
  const wrap = element("div", "observation-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", caption);
  const table = element("table", "observation-table");
  table.appendChild(element("caption", "", caption));
  const head = element("thead"), tr = element("tr");
  headers.forEach(text => { const th = element("th", "", text); th.scope = "col"; tr.appendChild(th); });
  head.appendChild(tr); const body = element("tbody");
  rows.forEach(row => {
    const tr = element("tr");
    row.forEach((value, i) => { const cell = element(i === 0 ? "th" : "td", "", value instanceof Node ? null : value); if (i === 0) cell.scope = "row"; if (value instanceof Node) cell.appendChild(value); tr.appendChild(cell); });
    body.appendChild(tr);
  });
  table.append(head, body); wrap.appendChild(table); return wrap;
}
function observationMetric(label, value, note) {
  const card = element("div", "observation-metric");
  card.append(element("span", "", label), element("strong", "", value), element("small", "", note));
  return card;
}

function swingDisplayLabel(record, areaLabel = "選區") {
  if (!record) return `${areaLabel}歷史資料載入中`;
  if (record.status === "close_swing") return `${areaLabel}本級激戰搖擺`;
  if (record.isSwing) return `${areaLabel}本級搖擺`;
  if (record.closeSwingVillageCount) return `含 ${record.closeSwingVillageCount} 個激戰搖擺村里`;
  if (record.swingVillageCount) return `含 ${record.swingVillageCount} 個搖擺村里`;
  return `${areaLabel}本級未達搖擺條件`;
}

let retainedObservationCards = null;
function refreshObservationDetail(render) {
  const scroll = observationDetail.scrollTop, focused = document.activeElement;
  const headingFocused=observationDetail.contains(focused) && focused.matches(".hero-summary h2");
  const retained = new Map();
  observationDetail.querySelectorAll(".collapsible-card").forEach(card => {
    if (["ready", "loading", "error"].includes(card.dataset.state)) { retained.set(card.dataset.key, card); card.remove(); }
  });
  retainedObservationCards = retained;
  try { render(); }
  finally { retainedObservationCards = null; for (const card of retained.values()) card.dispose?.(); }
  observationDetail.scrollTop = scroll;
  if (focused?.isConnected && observationDetail.contains(focused)) focused.focus({preventScroll:true});
  else if(headingFocused && document.activeElement===document.body) {const heading=observationDetail.querySelector(".hero-summary h2");if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
}

function createCollapsibleCard({ id, icon = "", title = "", previewPills = [], defaultOpen = false, contentFn }) {
  const key = JSON.stringify([state.manifest?.source?.database_sha256, observation.office, observation.county, observation.district, observation.township, observation.village, observation.councilorLens, observation.yearBaseline, observation.swingMarginThreshold, id]);
  if (retainedObservationCards?.has(key)) { const card=retainedObservationCards.get(key); retainedObservationCards.delete(key); return card; }
  const card = element("div", "collapsible-card");
  card.id = `card-${id}`;
  card.dataset.cardId = id;
  card.dataset.key = key;
  card.dataset.state = "idle";

  if (observation.cardOpenState[id] === undefined) {
    observation.cardOpenState[id] = defaultOpen;
  }
  const isOpen = Boolean(observation.cardOpenState[id]);

  const accentBar = element("div", "card-accent-bar");
  card.appendChild(accentBar);

  const header = element("button", "card-header");
  header.type = "button";
  header.id = `card-header-${id}`;
  header.setAttribute("aria-expanded", String(isOpen));
  header.setAttribute("aria-controls", `card-body-${id}`);

  const titleGroup = element("div", "card-title-group");
  if (icon) titleGroup.appendChild(element("span", "card-icon", icon));
  titleGroup.appendChild(element("span", "card-title", title));
  header.appendChild(titleGroup);

  const pillsWrap = element("div", "card-preview-pills");
  previewPills.forEach((p) => {
    if (!p) return;
    const text = typeof p === "string" ? p : p.text;
    const cls = typeof p === "object" && p.cls ? `preview-pill ${p.cls}` : "preview-pill";
    pillsWrap.appendChild(element("span", cls, text));
  });
  header.appendChild(pillsWrap);

  const trigger = element("div", "card-collapse-trigger");
  const triggerText = element("span", "collapse-text", isOpen ? "收合" : "展開詳情");
  const chevron = element("span", "collapse-chevron", "▾");
  trigger.append(triggerText, chevron);
  header.appendChild(trigger);

  card.appendChild(header);

  const body = element("div", "card-body");
  body.id = `card-body-${id}`;
  let controller = null, attempt = 0, disposed = false, slowTimer = null;
  card.dispose = () => { disposed = true; attempt++; controller?.abort(); clearTimeout(slowTimer); };
  function buildContent() {
    if (disposed || ["loading", "ready", "empty"].includes(card.dataset.state)) return;
    const token = ++attempt;
    controller = new AbortController();
    clear(body); card.dataset.state = "loading"; body.setAttribute("aria-busy", "true");
    const status = element("p", "observation-note", "正在載入…"); body.appendChild(status);
    slowTimer = setTimeout(() => { if (card.dataset.state === "loading" && token === attempt) status.textContent = "載入比平常久；可先收合或切換選區，稍後重試。"; }, 8000);
    const context = {signal: controller.signal, isCurrent: () => !disposed && token === attempt && !controller.signal.aborted};
    // Existing synchronous cards can render directly; asynchronous cards return a promise.
    let result;
    try { result = contentFn?.(body, context); }
    catch(error) { fail(error); return; }
    Promise.resolve(result).then(value => {
      if (!context.isCurrent()) return;
      status.remove(); body.removeAttribute("aria-busy"); clearTimeout(slowTimer);
      card.dataset.state = value === "empty" || !body.childNodes.length ? "empty" : "ready";
      if (card.dataset.state === "empty" && !body.childNodes.length) body.appendChild(element("p", "observation-note", "此範圍沒有可用資料。"));
    }, fail);
    function fail(error) {
      if (!context.isCurrent()) return;
      clearTimeout(slowTimer); body.removeAttribute("aria-busy"); card.dataset.state="error"; clear(body);
      body.appendChild(element("p", "observation-error", `資料載入失敗：${error.message || "請重試"}`));
      const retry=element("button", "detail-card-action", "重試此卡片"); retry.type="button"; retry.addEventListener("click",buildContent); body.appendChild(retry);
    }
  }
  body.hidden = !isOpen;
  card.appendChild(body);
  if (isOpen) buildContent();

  function toggle() {
    const next = !observation.cardOpenState[id];
    observation.cardOpenState[id] = next;
    header.setAttribute("aria-expanded", String(next));
    triggerText.textContent = next ? "收合" : "展開詳情";
    body.hidden = !next;
    if (next) buildContent();
    card.classList.toggle("open", next);
  }

  header.addEventListener("click", toggle);

  if (isOpen) card.classList.add("open");
  return card;
}

function renderStackedBar(container, historyItem, partyUniverse = null) {
  if (!historyItem || !historyItem.electorate || historyItem.electorate <= 0) return;
  const electorate = historyItem.electorate;
  const totalVotes = historyItem.total_votes || 0;
  const validVotes = historyItem.valid_votes || 0;
  const invalidVotes = Math.max(0, totalVotes - validVotes);
  const unvoted = Math.max(0, electorate - totalVotes);

  const wrap = element("div", "stacked-bar-wrap");
  const header = element("div", "stacked-bar-header");
  header.append(
    element("span", "", `${historyItem.year} 年全體選民催票動員空間（100% 選民）`),
    element("span", "", `總選舉人 ${observationNumber(electorate)} 人`)
  );
  wrap.appendChild(header);

  const bar = element("div", "stacked-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `${historyItem.year} 年全體選民動員分佈橫向堆疊圖`);

  const partyColors = {
    "民主進步黨": "#1b9431",
    "中國國民黨": "#002f9e",
    "台灣民眾黨": "#28c7c7",
    "時代力量": "#f5c518",
    "無黨籍": "#6b7280",
    "無黨籍及未經政黨推薦": "#6b7280",
    "無黨籍（未經政黨推薦）": "#6b7280",
    "親民黨": "#f47820",
    "台灣基進": "#a73f24",
  };

  const otherPalette = ["#9c27b0", "#d35400", "#ad1457", "#00838f", "#8d6e00", "#6d4c41", "#546e7a", "#ec407a", "#7c4dff", "#b26a00"];
  const otherParties = [...new Set((partyUniverse || historyItem.parties || []).filter(p => !partyColors[p.name] && !/^無黨籍/.test(p.name)).map(p => p.name))].sort();
  const segments = [];
  (historyItem.parties || []).forEach((party) => {
    const pct = party.electorate_share_pct ?? (party.votes ? (party.votes / electorate) * 100 : 0);
    if (pct > 0) {
      const color = /^無黨籍/.test(party.name) ? "#6b7280" : (partyColors[party.name] || otherPalette[otherParties.indexOf(party.name) % otherPalette.length]);
      segments.push({ label: party.name, pct, color, omitted: pct <= 0.1 });
    }
  });

  const invalidPct = (invalidVotes / electorate) * 100;
  if (invalidPct > 0) segments.push({ label: "無效票", pct: invalidPct, color: "#94a3b8" });

  const unvotedPct = (unvoted / electorate) * 100;
  if (unvotedPct > 0) segments.push({ label: "未投票選民", pct: unvotedPct, color: "#ffffff", outline: true });

  const legend = element("div", "stacked-legend");
  segments.forEach((seg) => {
    const segEl = element("div", "stacked-segment");
    segEl.style.width = `${seg.pct.toFixed(2)}%`;
    segEl.style.backgroundColor = seg.omitted ? "transparent" : seg.color;
    if (seg.outline) segEl.style.boxShadow = "inset 0 0 0 1px #111";
    segEl.title = `${seg.label}: ${seg.pct.toFixed(2)}% 全體選民`;
    bar.appendChild(segEl);

    if (seg.omitted) return;
    const legItem = element("span", "stacked-legend-item");
    const dot = element("span", "stacked-legend-dot");
    dot.style.backgroundColor = seg.color;
    if (seg.outline) dot.style.border = "1px solid #111";
    legItem.append(dot, `${seg.label} ${seg.pct.toFixed(1)}%`);
    legend.appendChild(legItem);
  });

  wrap.append(bar, legend);
  if (segments.some(seg => seg.omitted)) wrap.appendChild(element("p", "observation-note", "催票率不超過 0.1% 的政黨保留空白，詳細數值列於下方表格。"));
  container.appendChild(wrap);
}

function renderObservationFilterBar() {
  if (!observationFilterBar) return;
  clear(observationFilterBar);

  if (observation.office === "village_chief") {
    observationFilterBar.hidden = true;
    return;
  }
  observationFilterBar.hidden = false;

  const filtersWrap = element("div", "filter-pill-group");
  const filters = [
    { id: "close_swing", icon: "🔥", label: "核心搖擺激戰" },
    { id: "close_only", icon: "⚔️", label: "傳統版圖激戰" },
    { id: "swing_only", icon: "🔄", label: "歷屆搖擺" },
    { id: "solid", icon: "🛡️", label: "穩定基本盤" },
  ];

  const bellwethers = observation.county ? observation.swingData?.bellwethers : null;
  const bellwetherCount = bellwethers ? bellwethers.size || bellwethers.length || 0 : 0;
  if (bellwetherCount > 0) {
    filters.push({ id: "bellwether", icon: "🎯", label: `指標村里 (${bellwetherCount})` });
  }

  filters.forEach((f) => {
    const btn = element("button", "filter-pill", `${f.icon} ${f.label}`);
    btn.type = "button";
    btn.dataset.filter = f.id;
    const isActive = observation.activeFilters.has(f.id);
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    btn.addEventListener("click", () => {
      if (observation.activeFilters.has(f.id)) {
        observation.activeFilters.delete(f.id);
      } else {
        observation.activeFilters.add(f.id);
      }
      renderObservationFilterBar();
      drawObservationMap();
      if (observation.district && !observation.township && !observation.village) renderObservationDistrict(observation.district);
      else if (observation.township && !observation.village) renderObservationTownship(observation.township);
      else if (observation.village) renderObservationVillage(observation.village);
      else if (observation.district) renderObservationDistrict(observation.district);
      else observationOverview();
    });
    filtersWrap.appendChild(btn);
  });
  observationFilterBar.appendChild(filtersWrap);

  const thresholdWrap = element("div", "filter-threshold-group");
  thresholdWrap.appendChild(element("span", "filter-label", "激戰門檻:"));
  const thresholds = [
    { value: 0.015, label: "≤1.5%" },
    { value: 0.03, label: "≤3% (預設)" },
    { value: 0.05, label: "≤5%" },
  ];
  thresholds.forEach((t) => {
    const tBtn = element("button", "threshold-pill", t.label);
    tBtn.type = "button";
    const isActive = Math.abs(observation.swingMarginThreshold - t.value) < 0.001;
    tBtn.classList.toggle("is-active", isActive);
    tBtn.setAttribute("aria-pressed", String(isActive));
    tBtn.addEventListener("click", () => {
      observation.swingMarginThreshold = t.value;
      if (observation.county) {
        swingScopeCache.delete(observation.county);
        ensureCountySwingData(observation.county).then((data) => {
          observation.swingData = data;
          observation.swingAnalysis = data?.villages;
          renderObservationFilterBar();
          drawObservationMap();
          if (observation.district) renderObservationDistrict(observation.district);
          else if (observation.village) renderObservationVillage(observation.village);
        });
      } else {
        renderObservationFilterBar();
      }
    });
    thresholdWrap.appendChild(tBtn);
  });
  observationFilterBar.appendChild(thresholdWrap);

  const isSixMetro = ["臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市"].includes(observation.county);
  if (isSixMetro) {
    const baselineWrap = element("div", "filter-baseline-group");
    baselineWrap.appendChild(element("span", "filter-label", "基準年:"));
    const baselines = [
      { id: "default", label: "近三屆 2014–2022" },
      { id: "extended", label: "四屆 2010–2022" },
    ];
    baselines.forEach((b) => {
      const bBtn = element("button", "baseline-pill", b.label);
      bBtn.type = "button";
      const isActive = (observation.yearBaseline || "default") === b.id;
      bBtn.classList.toggle("is-active", isActive);
      bBtn.setAttribute("aria-pressed", String(isActive));
      bBtn.addEventListener("click", () => {
        observation.yearBaseline = b.id;
        swingScopeCache.delete(observation.county);
        ensureCountySwingData(observation.county).then((data) => {
          observation.swingData = data;
          observation.swingAnalysis = data?.villages;
          renderObservationFilterBar();
          drawObservationMap();
          if (observation.district) renderObservationDistrict(observation.district);
        });
      });
      baselineWrap.appendChild(bBtn);
    });
    observationFilterBar.appendChild(baselineWrap);
  }
}

function observationSwingCounts(records) {
  const values = [...records].filter(Boolean);
  const comparable = values.filter((record) => record.comparable ?? record.isComplete).length;
  return {
    total: values.length,
    comparable,
    direct: values.filter((record) => (record.comparable ?? record.isComplete) && record.isSwing).length,
    containing: values.filter((record) => record.swingVillageCount > 0).length,
    close: values.filter((record) => record.displayStatus === "close_swing").length,
  };
}

function observationAllSwingScopes() {
  return [...observation.nationalSwing.values()];
}

function loadNationalSwingSummary() {
  if (!observation.manifest || !historyPointer || observation.nationalSwingPromise) return observation.nationalSwingPromise;
  const manifest = observation.manifest;
  observation.nationalSwingPromise = Promise.all(manifest.counties.map(async (county) => {
    const data = await ensureCountySwingData(county.name);
    return [county.name, data?.scopes || null];
  })).then((rows) => {
    if (observation.manifest !== manifest) return;
    observation.nationalSwing = new Map(rows.filter(([, scopes]) => scopes).map(([name, scopes]) => [name, scopes]));
    observation.nationalSwingFailureCount = rows.filter(([, scopes]) => !scopes).length;
    observation.nationalSwingReady = true;
    if (observation.county) {
      observation.swingData = observation.nationalSwing.has(observation.county)
        ? { villages: swingCache.get(observation.county), scopes: observation.nationalSwing.get(observation.county) }
        : observation.swingData;
    }
  }).catch(() => {
    if (observation.manifest !== manifest) return;
    observation.nationalSwingFailureCount = manifest.counties.length;
    observation.nationalSwingReady = true;
  }).then(() => {
    if (observation.manifest !== manifest) return;
    renderObservationMap();
    if (!observation.county) observationOverview();
    else if (observation.district && !observation.township && !observation.village) renderObservationDistrict(observation.district);
    else if (observation.township && !observation.village) renderObservationTownship(observation.township);
    else if (observation.village) renderObservationVillage(observation.village);
    else if (observation.district) renderObservationDistrict(observation.district);
    else observationOverview();
  }).finally(() => {
    observation.nationalSwingPromise = null;
  });
  return observation.nationalSwingPromise;
}

function appendObservationSwingSummary(parent) {
  const section = element("section", "swing-summary");
  section.appendChild(element("h3", "", "歷屆搖擺區域"));
  section.appendChild(element("p", "swing-summary-note", product.council ? "以歷屆首長得票走勢對照議員選區，協助觀察哪些選區較具搖擺特性。此為歷史資料，評估最新選情時應考量現況變數。" : "本區彙整歷屆縣市長得票走勢，協助觀察哪些選區板塊較具搖擺特性。此為 2022 年（四年前）之歷史開票數據，評估最新選情時，仍應綜合考量當前政治局勢與現實變數。"));

  if (!observation.county) {
    if (!historyPointer) {
      section.appendChild(element("p", "swing-summary-note", "本版本沒有可驗證的首長歷史資料，無法計算搖擺區域。"));
      parent.appendChild(section);
      return;
    }
    if (!observation.nationalSwingReady) {
      section.appendChild(element("p", "swing-summary-loading", "正在計算全國縣市與鄉鎮市區…"));
      parent.appendChild(section);
      return;
    }
    const scopes = observationAllSwingScopes();
    const countyRecords = scopes.flatMap((scope) => [...scope.counties.values()]);
    const townshipRecords = scopes.flatMap((scope) => [...scope.townships.values()]);
    const districtRecords = scopes.flatMap((scope) => [...scope.councilDistricts.values()]);
    const completeScopeDistricts = districtRecords.filter((record) => record.scopeComplete);
    const c = observationSwingCounts(countyRecords), t = observationSwingCounts(townshipRecords), d = observationSwingCounts(completeScopeDistricts);
    const supportedDistricts = d.comparable;
    const incompleteScopeDistricts = districtRecords.filter((record) => !record.scopeComplete).length;
    const incompleteHistoryDistricts = districtRecords.filter((record) => record.scopeComplete && !record.comparable).length;
    const grid = element("div", "observation-metrics-grid");
    grid.append(
      observationMetric("搖擺縣市", `${c.direct} / ${c.comparable}`, `四屆可比較 ${c.comparable} / ${c.total} · 含搖擺村里 ${c.containing} 市 · 激戰 ${c.close} 市`),
      observationMetric("搖擺鄉鎮市區", `${t.direct} / ${t.comparable}`, `四屆可比較 ${t.comparable} / ${t.total} · 含搖擺村里 ${t.containing} 區 · 激戰 ${t.close} 區`),
      ...(product.council ? [observationMetric("搖擺議員選區", `${d.direct} / ${supportedDistricts}`, `${d.containing} 個含搖擺村里 · 四屆可比較 ${supportedDistricts} / ${completeScopeDistricts.length} 個完整地域範圍`)] : []),
    );
    section.appendChild(grid);
    const countiesWithSwing = countyRecords.filter((record) => record.displayStatus).sort((a, b) => a.county.localeCompare(b.county, "zh-Hant"));
    section.appendChild(element("h4", "", "搖擺縣市或含搖擺村里的縣市"));
    if (countiesWithSwing.length) {
      const list = element("div", "swing-summary-list");
      countiesWithSwing.forEach((record) => {
        const button = element("button", "swing-summary-button", `${record.county} · ${swingDisplayLabel(record, "縣市")}`);
        button.type = "button";
        button.addEventListener("click", () => observationNavigate("county", record.county));
        list.appendChild(button);
      });
      section.appendChild(list);
    } else section.appendChild(element("p", "swing-summary-note", "目前沒有縣市達到本級或所含村里搖擺條件。"));
    if (observation.nationalSwingFailureCount) section.appendChild(element("p", "observation-caution", `${observation.nationalSwingFailureCount} 個縣市的歷史資料載入或驗證失敗；以上全國統計只涵蓋已成功核對的縣市。`));
    if (product.council && (incompleteScopeDistricts || incompleteHistoryDistricts)) section.appendChild(element("p", "swing-summary-note", `${incompleteScopeDistricts} 個議員選區含未能完整機讀的部分鄉鎮範圍；另有 ${incompleteHistoryDistricts} 區的首長歷史資料未涵蓋全部四屆。這些選區不列入本級四屆變化判定。`));
    parent.appendChild(section);
    return;
  }

  const scopes = observation.swingData?.scopes;
  if (!scopes) {
    section.appendChild(element("p", "swing-summary-loading", "正在核對本縣市歷史票數…"));
    parent.appendChild(section);
    return;
  }
  const countyRecord = scopes.counties.get(observation.county);
  const townshipRecords = [...scopes.townships.values()];
  const districtRecords = [...scopes.councilDistricts.values()];
  const visibleTownships = observation.township
    ? townshipRecords.filter((record) => record.township === observation.township)
    : townshipRecords;
  const visibleDistricts = observation.township
    ? districtRecords.filter((record) => record.townships.includes(observation.township)
      || observationDistrictLocation({id:record.districtId,county:record.county,office:record.office})?.partial_townships?.includes(observation.township))
    : districtRecords;
  const incompleteDistrictScopes = visibleDistricts.filter((record) => !record.scopeComplete).length;
  const incompleteDistrictHistories = visibleDistricts.filter((record) => record.scopeComplete && !record.comparable).length;
  const grid = element("div", "observation-metrics-grid");
  if (observation.township) {
    const record = visibleTownships[0];
    const comparableDistricts = visibleDistricts.filter((district) => district.scopeComplete && district.comparable).length;
    const directDistricts = visibleDistricts.filter((district) => district.scopeComplete && district.comparable && district.isSwing).length;
    const nestedDistricts = visibleDistricts.filter((district) => district.scopeComplete && district.swingVillageCount > 0).length;
    const closeDistricts = visibleDistricts.filter((district) => district.scopeComplete && district.displayStatus === "close_swing").length;
    grid.append(
      observationMetric("本級勝選黨籍變化", record?.isComplete ? `${record.partyChanges} 次` : "資料不足", record?.isSwing ? "本鄉鎮達搖擺條件" : "超過 2 次才列本級搖擺"),
      observationMetric("搖擺村里", `${record?.swingVillageCount || 0} 個`, `其中激戰村里 ${record?.closeSwingVillageCount || 0} 個`),
      ...(product.council ? [observationMetric("搖擺議員選區", `${directDistricts} / ${comparableDistricts}`, `${nestedDistricts} 區含搖擺村里 · 激戰 ${closeDistricts} 區 · 依公告範圍對照`)] : []),
    );
  } else {
    const comparableTownships = visibleTownships.filter((record) => record.isComplete).length;
    const directTownships = visibleTownships.filter((record) => record.isComplete && record.isSwing).length;
    const nestedTownships = visibleTownships.filter((record) => record.swingVillageCount > 0).length;
    const comparableDistricts = visibleDistricts.filter((record) => record.scopeComplete && record.comparable).length;
    const directDistricts = visibleDistricts.filter((record) => record.scopeComplete && record.comparable && record.isSwing).length;
    const swingDistricts = visibleDistricts.filter((record) => record.scopeComplete && record.swingVillageCount > 0).length;
    const closeDistricts = visibleDistricts.filter((record) => record.scopeComplete && record.displayStatus === "close_swing").length;
    grid.append(
      observationMetric("縣市本級勝選黨籍變化", countyRecord?.isComplete ? `${countyRecord.partyChanges} 次` : "資料不足", countyRecord?.isSwing ? "符合搖擺條件" : `區內搖擺村里 ${countyRecord?.swingVillageCount || 0} 個`),
      observationMetric("搖擺鄉鎮市區", `${directTownships} / ${comparableTownships}`, `四屆可比較 ${comparableTownships} / ${visibleTownships.length} · ${nestedTownships} 個含搖擺村里`),
      ...(product.council ? [observationMetric("搖擺議員選區", `${directDistricts} / ${comparableDistricts}`, `四屆可比較 ${comparableDistricts} 區 · ${swingDistricts} 區含搖擺村里 · 激戰 ${closeDistricts} 區`)] : []),
    );
  }
  section.appendChild(grid);
  if (product.council && (incompleteDistrictScopes || incompleteDistrictHistories)) {
    section.appendChild(element("p", "swing-summary-note", `${incompleteDistrictScopes} 個相關議員選區含部分鄉鎮範圍，不能完整加總；另有 ${incompleteDistrictHistories} 個完整範圍選區缺少四屆歷史資料。這些選區不列入本級黨籍變化判定。`));
  }

  if (!observation.township) {
    const markedTownships = visibleTownships.filter((record) => record.displayStatus).sort((a, b) => a.township.localeCompare(b.township, "zh-Hant"));
    section.appendChild(element("h4", "", "搖擺鄉鎮市區與所含村里"));
    if (markedTownships.length) {
      const list = element("div", "swing-summary-list");
      markedTownships.forEach((record) => {
        const button = element("button", "swing-summary-button", `${record.township} · ${swingDisplayLabel(record, "鄉鎮市區")}`);
        button.type = "button";
        button.addEventListener("click", () => observationNavigate("township", record.township));
        list.appendChild(button);
      });
      section.appendChild(list);
    } else section.appendChild(element("p", "swing-summary-note", "目前沒有鄉鎮市區達到本級或所含村里搖擺條件。"));
  }

  if (!product.council) { parent.appendChild(section); return; }
  const markedDistricts = visibleDistricts.filter((record) => record.scopeComplete && record.displayStatus).sort((a, b) => a.districtId.localeCompare(b.districtId, "zh-Hant"));
  if (!observation.township) section.appendChild(element("h4", "", "搖擺議員選區與所含村里"));
  else section.appendChild(element("h4", "", "涵蓋此鄉鎮的搖擺議員選區與所含村里"));
  if (markedDistricts.length) {
    const districtsById = new Map((observation.shard?.districts || []).map((district) => [district.id, district]));
    const rows = markedDistricts.map((record) => {
      const district = districtsById.get(record.districtId);
      const link = element("button", "swing-summary-button", district?.name || record.districtId);
      link.type = "button";
      link.addEventListener("click", () => {
        if (observation.office !== record.office) observationNavigate("office", record.office);
        observationNavigate("district", record.districtId);
      });
      const detail = `${swingDisplayLabel(record, "選區")} · 本級更迭 ${record.comparable ? `${record.partyChanges} 次` : "資料不足"} · 含搖擺村里 ${record.swingVillageCount} 個（激戰 ${record.closeSwingVillageCount} 個）`;
      return [link, detail];
    });
    section.appendChild(observationTable("完整鄉鎮範圍內達標或含搖擺村里的議員選區", ["選區", "搖擺概況"], rows));
  } else section.appendChild(element("p", "swing-summary-note", observation.township ? "此鄉鎮未對應到達標或含搖擺村里的完整範圍議員選區。" : "本縣市目前沒有完整範圍議員選區達標或包含搖擺村里。"));
  parent.appendChild(section);
}
function observationDistrictLocation(district) {
  return observation.manifest?.councilor_locations?.find(l => l.district_id === district.id && l.county === district.county && l.office === district.office);
}
function observationDistrictLabel(district) {
  const location = observationDistrictLocation(district);
  let scope = "";
  if (location?.scope === "regional") scope = [...location.townships, ...(location.partial_townships || []).map(t=>`${t}（依村里劃分）`)].join("、") || "範圍請查公告";
  else if (location) {
    const kind = location.scope === "plains_indigenous" ? "平地原住民" : "山地原住民";
    scope = location.scope_text && location.scope_text !== `${location.county}之${kind}` ? location.scope_text : `全${location.county.endsWith("縣") ? "縣" : "市"}${kind}`;
  }
  return district.name + (scope ? ` · ${scope}` : "");
}
function observationScopedDistricts() {
  return observation.shard?.districts.filter(d => product.allowsOffice(d.office) && (!observation.office || d.office === observation.office) && (!observation.township || (()=>{
    if (["metro_mayor", "county_mayor"].includes(d.office)) return true;
    const location = observationDistrictLocation(d);
    return location ? location.scope === "regional" && (location.townships.includes(observation.township) || location.partial_townships?.includes(observation.township)) : d.township === observation.township;
  })())) || [];
}
function observationMapTarget(region) {
  return core.observationMapTarget(region, observation.office, observation.shard?.districts || [], observation.manifest?.councilor_locations || [], observation.district);
}
function observationOverview() {
  if (observation.township) {
    renderObservationTownship(observation.township);
    return;
  }
  clear(observationDetail);
  const m = observation.manifest;
  observationDetail.append(element("p", "eyebrow", observation.county ? "目前觀察" : "2026 / 11 / 28"), element("h2", "", observation.township || observation.county || "從一個縣市開始"));
  const row = element("div", "observation-metrics");
  const scoped = observation.shard ? observationScopedDistricts() : null;
  const entry = scoped ? {candidate_count:scoped.reduce((total,d)=>total+d.candidates.length,0),district_count:scoped.length} : {candidate_count:observation.mayorMetrics?.counties.reduce((sum,c)=>sum+c.cands_2026_count,0),district_count:observation.mayorMetrics?.counties.length};
  row.append(observationMetric("登記候選人數", `${observationNumber(entry.candidate_count)} 人`, `正式審定名冊 · 查核 ${m.as_of}`), observationMetric("名冊所列選區", `${observationNumber(entry.district_count)} 區`, observation.office ? "目前公職的名冊選區" : "縣市長選舉"));
  if (!observation.county) row.append(observationMetric("全國選舉人數預估", `約 ${observationNumber(m.national_electorate.value)} 人`, `官方估計 · ${m.national_electorate.as_of}`));
  observationDetail.appendChild(row);
  if (product.council && !observation.county) observationDetail.append(element("p", "observation-caution", `全國公告 ${observationNumber(m.official_district_count)} 個選區；目前已核實收錄 ${observationNumber(m.district_count)} 個選區候選人名冊。`));
  observationDetail.append(element("p", "", observation.township && scoped?.some(d=>observationDistrictLocation(d)?.partial_townships?.includes(observation.township)) ? "此行政區的議員選區依村里劃分。請由上方清單選擇名冊，再核對公告所列村里。" : "從地圖點選地區，查看候選人、人口資料，以及 2014、2018、2022 的投票率與政黨催票率。也可展開上方名稱清單查找。"));
  observationDetail.append(element("p", "", "候選人與推薦政黨依中選會審定名冊列示；歷屆開票數據提供長期趨勢觀察。"));
  appendObservationSwingSummary(observationDetail);
  observationDetail.appendChild(observationSource(m.national_electorate.source_id));
}
// 歷史名冊提供各黨票數；選舉資料提供有效票、無效票與投票總數。
function appendLocalHistoryCard(names) {
  if (!["metro_mayor", "county_mayor"].includes(observation.office)) return;
  const card = createCollapsibleCard({
    id: "local-history", icon: "📊", title: "歷屆投票率與政黨催票率（2014–2022）", defaultOpen: false,
    contentFn: async (body, context) => {
      const status = element("p", "observation-note", "正在載入歷屆開票數據…");
      body.appendChild(status);
      const entry = historyPointer?.counties.find(c => c.name === names[0]);
      if (!entry) { status.textContent = "此地區沒有可用的歷史資料。"; return; }
      const localResults = await loadLocalHistorySummary(names, context.signal);
          if (!context.isCurrent()) return;
          clear(body);
          body.appendChild(element("p", "observation-note", "本圖表呈現該行政區歷屆縣市長開票趨勢。催票率為政黨實得票數除以全體選舉人數，可觀察整體公民動員水準變化。"));
          const bars = element("div", "history-stacked-comparison");
          const partyUniverse = localResults.flatMap(item => item.parties || []);
          localResults.forEach(item => {
            if (item.error) bars.appendChild(element("p", "observation-missing", `${item.year} 年：${item.error}`));
            else renderStackedBar(bars, item, partyUniverse);
          });
          body.appendChild(bars);
          localResults.forEach(item => {
            const details = element("details");
            details.appendChild(element("summary", "", `查看 ${item.year} 年投票率與各黨催票率`));
            if (item.error) details.appendChild(element("p", "observation-missing", item.error));
            else {
              details.appendChild(element("p", "observation-note", `${item.year} 年投票率 ${(item.total_votes / item.electorate * 100).toFixed(2)}%（投票數 ${observationNumber(item.total_votes)} 人／選舉人 ${observationNumber(item.electorate)} 人）`));
              details.appendChild(observationTable(`${item.year} 年各黨催票率`, ["政黨", "得票數", "選舉人數", "催票率"], item.parties.map(p => [p.name, observationNumber(p.votes), observationNumber(item.electorate), `${p.electorate_share_pct.toFixed(2)}%`])));
            }
            body.appendChild(details);
          });

    }
  });
  observationDetail.appendChild(card);
}

function appendCouncilLocalHistory(names, parent) {
  const metric=observation.councilMetrics?.districts.find(d=>d.map_district_id===parent?.id);
  const labels={regional:"區域議員",plain_indigenous:"平地原住民議員",mountain_indigenous:"山地原住民議員"};
  observationDetail.appendChild(createCollapsibleCard({id:"council-local-history",icon:"📊",title:"議員歷史票數與投票率（2014–2022）",defaultOpen:false,contentFn:async(body,context)=>{
    const select=document.createElement("select");select.className="contest-sort-select";select.setAttribute("aria-label","歷史議員類別");
    for(const [value,label] of Object.entries(labels)){const option=element("option","",label);option.value=value;select.appendChild(option);}
    select.value=metric?.office_kind==="plains_indigenous"?"plain_indigenous":metric?.office_kind||"regional";
    if(!select.value)select.value="regional";
    body.append(select,element("p","observation-note","以下呈現歷史開票數據，區域與原住民議員分開計算。歷屆選區範圍若有調整，數據僅供板塊趨勢參考。"));
    const host=element("div","");body.appendChild(host);let generation=0;
    const load=async()=>{
      const token=++generation,scope=select.value;host.replaceChildren(element("p","observation-note","正在讀取議員歷史票數…"));
      try {
        const pointer=state.manifest.council_local_history;
        if(!pointer)throw new Error("尚未提供議員地方歷史索引");
        const index=await fetchJson(`data/${pointer.file}`,context.signal,pointer.sha256);
        if(index.schema!=="council-local-index-v1")throw new Error("議員歷史索引版本不符");
        const entry=index.areas[JSON.stringify([names[0],names[1],scope])];
        const resource=entry?.resource || entry?.villages?.[names[2]||""];
        if(!resource){if(token===generation&&context.isCurrent())host.replaceChildren(element("p","observation-missing","此類別查無對應之歷史開票紀錄。"));return;}
        const data=await fetchJson(`data/${resource.file}`,context.signal,resource.sha256);
        if(!context.isCurrent()||token!==generation)return;
        if(data.schema!=="council-local-records-v1"||data.county!==names[0]||data.town!==names[1]||data.scope!==scope)throw new Error("議員歷史資料範圍不符");
        host.replaceChildren();const records=data.records.filter(r=>(r.village||null)===(names[2]||null));
        for(const year of [2014,2018,2022]){
          const group=records.filter(r=>r.year===year);
          if(!group.length){host.appendChild(element("p","observation-missing",`${year} 年：此類別及行政區沒有可用資料，不是零票。`));continue;}
          for(const rec of group){
            host.appendChild(element("h4","",`${year} 年 ${labels[scope]} · 歷史${rec.district || "選區未註明"}`));
            if(rec.errors.length){host.appendChild(element("p","observation-missing",`來源未通過核對：${rec.errors.join("、")}；不繪圖或猜補。`));continue;}
            const t=rec.totals;
            if(names[2] && rec.excludedFacts)host.appendChild(element("p","observation-caution",`同名村里另有 ${rec.excludedFacts} 筆來源候選人紀錄無法精確對照，以下僅為已核對部分，並非完整村里總數。`));
            if(!names[2])host.appendChild(element("p","observation-note",`此歷史選區在同名鄉鎮的 ${rec.areaCount} 個可對照村里加總；不跨歷史選區合併。${rec.excludedFacts ? `另有 ${rec.excludedFacts} 筆無法對照的來源候選人紀錄未納入，並非完整鄉鎮總數。` : ""}`));
            host.appendChild(element("p","observation-note",`有效票 ${observationNumber(t.valid_votes)}／無效票 ${observationNumber(t.invalid_votes)}／投票數 ${observationNumber(t.total_votes)}／選舉人數 ${observationNumber(t.electorate)}；投票率 ${t.electorate ? (100*t.total_votes/t.electorate).toFixed(2)+"%" : "無法計算"}`));
            const parties=new Map();for(const c of rec.candidates)parties.set(c.party,(parties.get(c.party)||0)+c.votes);
            if(t.electorate>0)renderStackedBar(host,{year,...t,parties:[...parties].map(([name,votes])=>({name,votes,electorate_share_pct:100*votes/t.electorate}))},[...parties.keys()].map(name=>({name})));
            const details=document.createElement("details");details.appendChild(element("summary","",`查看 ${year} 年候選人票數（${rec.candidates.length} 人）`));
            details.appendChild(observationTable(`${year} 年議員票數`,["號次","候選人","政黨","得票","有效票占比","催票率"],[...rec.candidates].sort((a,b)=>b.votes-a.votes||Number(a.number)-Number(b.number)).map(c=>[c.number,c.name,c.party,observationNumber(c.votes),t.valid_votes?(100*c.votes/t.valid_votes).toFixed(2)+"%":"—",t.electorate?(100*c.votes/t.electorate).toFixed(2)+"%":"—"])));host.appendChild(details);
          }
        }
      } catch(error){if(token!==generation||!context.isCurrent())return;host.replaceChildren(element("p","observation-error",`議員歷史資料載入失敗：${error.message}`));const retry=element("button","detail-card-action","重試議員歷史資料");retry.type="button";retry.addEventListener("click",load);host.appendChild(retry);}
    };
    select.addEventListener("change",load);await load();
  }}));
}

// Administrative drill-down must never substitute mayor history for another office.
function renderOfficeLocalArea(town, village = null) {
  clear(observationDetail);
  const parent=observation.shard?.districts.find(d=>d.id===observation.district && d.office===observation.office);
  const hero=element("div","hero-summary");
  hero.append(element("p","eyebrow",observation.manifest?.offices[observation.office] || "行政區定位"),element("h2","",[observation.county,town,village].filter(Boolean).join(" ")));
  hero.appendChild(element("p","observation-note",["metro_councilor","county_councilor"].includes(observation.office)?"地圖可切換 2022 末席配對地方票差與 2026 候選人／席次；灰色表示未提供或無法唯一對照。展開歷史卡可查看逐屆票數。":"此層為行政區定位。目前未提供此公職經核對的地方歷史票數，不以其他公職資料代替。"));
  if(parent) {
    hero.appendChild(element("p","observation-note",`所屬選區：${parent.name}（選區整體，非此行政區數據）`));
    const back=element("button","observation-return",`查看 ${parent.name} 名冊與選區資料`);back.type="button";back.addEventListener("click",()=>observationNavigate("district",parent.id));hero.appendChild(back);
  }
  if(village){const back=element("button","observation-return",`返回 ${town}`);back.type="button";back.addEventListener("click",()=>observationNavigate("township",town));hero.appendChild(back);}
  observationDetail.appendChild(hero);
  if(["metro_councilor","county_councilor"].includes(observation.office))appendCouncilLocalHistory([observation.county,town,...(village?[village]:[])],parent);
  if(!village) {
    const villages=observation.geography?.villages(observation.county,town)||[];
    const card=createCollapsibleCard({id:"township-villages",title:`${town} 村里定位`,previewPills:[`共 ${villages.length} 村里`],defaultOpen:false,contentFn:body=>{
      for(const item of villages){const button=element("button","observation-return",item.label);button.type="button";button.addEventListener("click",()=>observationNavigate("village",item.label));body.appendChild(button);}
    }});observationDetail.appendChild(card);
  }
}

function renderObservationVillage(villageName) {
  if (!["metro_mayor", "county_mayor"].includes(observation.office)) return renderOfficeLocalArea(observation.township,villageName);
  const cardKey = `village:${observation.county}:${observation.township}:${villageName}`;
  if (observation.cardStateDistrict !== cardKey) { observation.cardStateDistrict = cardKey; observation.cardOpenState = {}; }
  clear(observationDetail);
  appendDetailCardActions();
  const county = observation.county;
  const township = observation.township;
  const villageKey = `${county}／${township}／${villageName}`;
  const swing = observation.swingAnalysis?.get(villageKey);
  const isMayor = ["metro_mayor", "county_mayor"].includes(observation.office);
  const mayorDistrict = observation.shard?.districts.find(d => ["metro_mayor", "county_mayor"].includes(d.office));
  const parentDistrict = observation.shard?.districts.find(d => d.id === observation.district) || (isMayor ? mayorDistrict : null);

  const heroControls = element("div", "hero-controls");
  heroControls.style.marginBottom = "0.75rem";
  if (parentDistrict) {
    const isMayorParent = ["metro_mayor", "county_mayor"].includes(parentDistrict.office);
    const backDist = element("button", "observation-return", isMayorParent ? `← 返回 ${parentDistrict.name || county}市長總覽` : `← 返回 ${parentDistrict.name || "議員選區"}`);
    backDist.type = "button";
    backDist.addEventListener("click", () => observationNavigate("district", parentDistrict.id));
    heroControls.appendChild(backDist);
  }
  if (township) {
    const backTown = element("button", "observation-return", `← 返回 ${township} 村里清單`);
    backTown.type = "button";
    backTown.addEventListener("click", () => observationNavigate("township", township));
    heroControls.appendChild(backTown);
  }
  if (heroControls.children.length) observationDetail.appendChild(heroControls);

  const title = element("h3", "", `${county} ${township} ${villageName}`);
  observationDetail.appendChild(title);
  appendLocalHistoryCard([county, township, villageName]);

  if (swing) {
    if (swing.status === "close_swing" || swing.quadrantStatus === "close_swing") {
      observationDetail.appendChild(element("div", "swing-badge badge-striped", `🔥 核心搖擺激戰村里（2022 催票率差距 ${swing.marginPct !== null ? swing.marginPct.toFixed(2) : "0"}% ≤ 3%）`));
    } else if (swing.status === "close_only" || swing.quadrantStatus === "close_only") {
      observationDetail.appendChild(element("div", "swing-badge badge-close-only", `⚔️ 傳統版圖激戰村里（2022 催票率差距 ${swing.marginPct !== null ? swing.marginPct.toFixed(2) : "0"}% ≤ 3%）`));
    } else if (swing.status === "swing" || swing.quadrantStatus === "swing_only") {
      observationDetail.appendChild(element("div", "swing-badge badge-yellow", `🔄 歷屆搖擺村里（歷屆政黨更迭 ${swing.partyChanges} 次）`));
    } else {
      observationDetail.appendChild(element("div", "swing-badge badge-solid", "🛡️ 穩定基本盤村里"));
    }
    if (swing.isBellwether) {
      observationDetail.appendChild(element("div", "swing-badge badge-bellwether", `🎯 指標村里（MAE ${(swing.mae * 100).toFixed(2)}% ≤ 2%）`));
    }

    const grid = element("div", "observation-metrics-grid");
    grid.append(
      observationMetric("歷屆政黨更迭", `${swing.partyChanges} 次`, swing.isSwing ? "符合搖擺紀錄" : "歷屆優勝黨籍更迭次數"),
      observationMetric("2022 領先差距", swing.marginPct !== null ? `${swing.marginPct.toFixed(2)}%` : "未有紀錄", swing.isClose2022 ? "催票率差距在 3% 以內" : "催票率差距高於 3%"),
    );
    observationDetail.appendChild(grid);

    if (swing.history && swing.history.length) {
      const rows = swing.history.map(h => [
        `${h.year} 年`,
        h.party || "無黨籍",
        h.candidate || "—",
        typeof h.votes === "number" ? h.votes.toLocaleString("zh-TW") : "—",
        h.electorate && typeof h.votes === "number" ? `${((h.votes / h.electorate) * 100).toFixed(2)}%` : "—"
      ]);
      observationDetail.appendChild(observationTable("歷屆市長選舉該村里第一高票紀錄", ["年份", "優勝政黨", "候選人", "得票數", "催票率"], rows));
    }
  } else {
    observationDetail.appendChild(element("p", "", "此村里未有完整歷屆政黨變化紀錄。"));
  }

  appendObservationSwingSummary(observationDetail);

  if (parentDistrict && ["metro_councilor", "county_councilor"].includes(parentDistrict.office)) {
    observationDetail.appendChild(element("h4", "", `所屬議員選區：${parentDistrict.name}`));
    const candRows = parentDistrict.candidates.map(c => [
      c.name ?? "姓名待核對",
      c.party === "無" ? "無黨籍" : c.party,
      c.gender || "—",
      c.registered_on || "—"
    ]);
    observationDetail.appendChild(observationTable(`${parentDistrict.name} 候選人名冊`, ["姓名", "推薦政黨", "性別", "登記日期"], candRows));
  } else {
    const mayorDistrict = observation.shard?.districts.find(d => ["metro_mayor", "county_mayor"].includes(d.office));
    if (mayorDistrict) {
      observationDetail.appendChild(element("h4", "", `${county}市長 候選人名冊`));
      const candRows = mayorDistrict.candidates.map(c => [
        c.number ? String(c.number) : "—",
        c.name,
        c.party || "無黨籍",
        c.gender || "—"
      ]);
      observationDetail.appendChild(observationTable(`${county}市長 候選人名冊`, ["號次", "姓名", "推薦政黨", "性別"], candRows));
    }
  }
}
function appendSwingDistrictDetail(parent, district) {
  if (!district || !["metro_councilor", "county_councilor"].includes(district.office)) return;
  const section = element("section", "swing-summary");
  section.appendChild(element("h3", "", "此議員選區的歷屆搖擺村里"));
  const record = observation.swingData?.scopes?.councilDistricts.get(district.id);
  if (!record) {
    section.appendChild(element("p", "swing-summary-loading", "正在載入選區範圍對照的歷史票數…"));
    parent.appendChild(section);
    return;
  }
  if (!record.scopeComplete) {
    section.appendChild(element("p", "swing-summary-note", "此選區含未能完整機讀的部分鄉鎮範圍，目前無法依整個選區計算；未將不完整範圍當作零票。"));
    parent.appendChild(section);
    return;
  }

  const sortSwingKeys = (keys) => {
    return [...keys].sort((aKey, bKey) => {
      const a = observation.swingData?.villages?.get(aKey);
      const b = observation.swingData?.villages?.get(bKey);
      const aClose = a?.isClose2022 ? 1 : 0;
      const bClose = b?.isClose2022 ? 1 : 0;
      if (bClose !== aClose) return bClose - aClose;
      const aChanges = a?.partyChanges ?? 0;
      const bChanges = b?.partyChanges ?? 0;
      if (bChanges !== aChanges) return bChanges - aChanges;
      const aMargin = a?.marginPct ?? 999;
      const bMargin = b?.marginPct ?? 999;
      if (aMargin !== bMargin) return aMargin - bMargin;
      return aKey.localeCompare(bKey, "zh-Hant");
    });
  };

  const makeVillageRows = (keys) => {
    return sortSwingKeys(keys).map((key) => {
      const village = observation.swingData?.villages?.get(key);
      const parts = key.split("／");
      const townName = parts[1] || "";
      const villName = parts[2] || "";
      const btn = element("button", "observation-table-link", `${townName} ${villName}`);
      btn.type = "button";
      btn.title = `檢視 ${townName} ${villName} 歷屆選情與村里詳情`;
      btn.addEventListener("click", () => {
        observation.district = district.id;
        observation.township = townName;
        observationNavigate("village", villName);
      });
      const badgeText = village?.isClose2022 ? "🔥 激戰搖擺村里" : "🔄 搖擺村里";
      const diffText = village ? `更迭 ${village.partyChanges} 次 · 2022 差距 ${observationPercent(village.marginPct)}` : "歷史明細未載入";
      return [btn, badgeText, diffText];
    });
  };

  if (!record.comparable) {
    section.appendChild(element("p", "swing-summary-note", "該選區歷屆首長資料因行政區劃變更有部分年份缺漏，不計入跨屆政黨變動，但仍列出所屬之搖擺村里。"));
    if (record.swingVillageKeys.length) {
      section.appendChild(observationTable("此議員選區可對應範圍內的搖擺村里", ["鄉鎮／村里", "分類", "黨籍變化與差距"], makeVillageRows(record.swingVillageKeys)));
    }
    parent.appendChild(section);
    return;
  }
  const grid = element("div", "observation-metrics-grid");
  grid.append(
    observationMetric("完整選區加總更迭", `${record.partyChanges} 次`, record.isSwing ? "本級符合超過 2 次" : "本級未超過 2 次"),
    observationMetric("2022 催票率差距", observationPercent(record.marginPct), record.isClose2022 ? "本級差距 ≤3%" : "本級差距高於 3%"),
    observationMetric("所含搖擺村里", `${record.swingVillageCount} 個`, `激戰村里 ${record.closeSwingVillageCount} 個`),
  );
  section.appendChild(grid);
  if (record.swingVillageKeys.length) {
    section.appendChild(observationTable("此議員選區範圍內的搖擺村里", ["鄉鎮／村里", "分類", "黨籍變化與差距"], makeVillageRows(record.swingVillageKeys)));
  } else section.appendChild(element("p", "swing-summary-note", "此選區完整範圍內沒有符合條件的搖擺村里。"));
  parent.appendChild(section);
}

function appendDetailCardActions() {
  const cardActions = element("div", "detail-card-actions");
  cardActions.setAttribute("aria-label", "選情卡片操作");
  [["全部展開", true], ["全部收合", false]].forEach(([label, open]) => {
    const button = element("button", "detail-card-action", label);
    button.type = "button";
    button.addEventListener("click", () => {
      observationDetail.querySelectorAll(".collapsible-card").forEach(card => {
        const header = card.querySelector(":scope > .card-header");
        if (header && (header.getAttribute("aria-expanded") === "true") !== open) header.click();
      });
    });
    cardActions.appendChild(button);
  });
  observationDetail.appendChild(cardActions);

}

function renderObservationTownship(townshipName) {
  if (!["metro_mayor", "county_mayor"].includes(observation.office)) return renderOfficeLocalArea(townshipName);
  const cardKey = `township:${observation.county}:${observation.district || ""}:${townshipName}`;
  if (observation.cardStateDistrict !== cardKey) { observation.cardStateDistrict = cardKey; observation.cardOpenState = {}; }
  clear(observationDetail);
  appendDetailCardActions();
  const county = observation.county;
  const isMayor = ["metro_mayor", "county_mayor"].includes(observation.office);
  const mayorDistrict = observation.shard?.districts.find(d => ["metro_mayor", "county_mayor"].includes(d.office));
  const parentDistrict = observation.shard?.districts.find(d => d.id === observation.district) || (isMayor ? mayorDistrict : null);

  const hero = element("div", "hero-summary");
  const heroHeader = element("div", "hero-header");
  const titleGroup = element("div", "hero-title-group");
  let eyebrowText = `${observation.manifest?.offices[observation.office] || ""} · 行政區觀察`;
  if (isMayor) eyebrowText = `${parentDistrict?.name || county}市長 · 行政區觀察`;
  else if (parentDistrict) eyebrowText = `${parentDistrict.name} · 涵蓋行政區`;

  titleGroup.append(
    element("p", "eyebrow", eyebrowText),
    element("h2", "", `${county} ${townshipName}`)
  );
  heroHeader.appendChild(titleGroup);

  const heroControls = element("div", "hero-controls");
  if (parentDistrict) {
    const isMayorParent = ["metro_mayor", "county_mayor"].includes(parentDistrict.office);
    const backBtnText = isMayorParent ? `← 返回 ${parentDistrict.name || county}市長總覽` : `← 返回 ${parentDistrict.name}`;
    const backToDist = element("button", "observation-return", backBtnText);
    backToDist.type = "button";
    backToDist.addEventListener("click", () => {
      observationNavigate("district", parentDistrict.id);
    });
    heroControls.appendChild(backToDist);
  }
  heroHeader.appendChild(heroControls);
  hero.appendChild(heroHeader);

  const scopeKey = `${county}／${townshipName}`;
  const tSwing = observation.swingData?.scopes?.townships.get(scopeKey);
  const villageList = observation.geography?.villages(county, townshipName) || [];

  const kpiGrid = element("div", "kpi-grid");
  const kpi1 = element("div", "kpi-card");
  kpi1.append(
    element("span", "kpi-label", "轄下村里"),
    element("strong", "kpi-val", `${villageList.length} 里`),
    element("small", "kpi-sub", "2025 行政區定位圖")
  );

  const kpi2 = element("div", "kpi-card");
  kpi2.append(
    element("span", "kpi-label", "本級政黨更迭"),
    element("strong", "kpi-val", tSwing?.isComplete ? `${tSwing.partyChanges} 次` : "資料不足"),
    element("small", "kpi-sub", tSwing?.isSwing ? "達搖擺條件" : "歷屆勝選政黨變化")
  );

  const kpi3 = element("div", "kpi-card");
  kpi3.append(
    element("span", "kpi-label", "搖擺村里"),
    element("strong", "kpi-val", tSwing ? `${tSwing.swingVillageCount ?? 0} 個` : "未載入"),
    element("small", "kpi-sub", tSwing ? `其中激戰 ${tSwing.closeSwingVillageCount ?? 0} 個` : "展開歷史資料檢視")
  );

  const kpi4 = element("div", "kpi-card");
  kpi4.append(
    element("span", "kpi-label", "2022 催票率差距"),
    element("strong", "kpi-val", tSwing?.marginPct != null ? `${tSwing.marginPct.toFixed(2)}%` : "—"),
    element("small", "kpi-sub", tSwing?.isClose2022 ? "差距 ≤3% 激戰" : "版圖勝差")
  );
  kpiGrid.append(kpi1,kpi2,kpi3,kpi4);
  hero.appendChild(kpiGrid);
  observationDetail.appendChild(hero);
  appendLocalHistoryCard([county, townshipName]);

  if (parentDistrict) {
    const isMayorParent = ["metro_mayor", "county_mayor"].includes(parentDistrict.office);
    const candTitle = isMayorParent ? `${parentDistrict.name || county}市長 候選人名冊` : `${parentDistrict.name} 候選人名冊`;
    const candCard = createCollapsibleCard({
      id: "district-cand",
      icon: "👤",
      title: candTitle,
      previewPills: [`${parentDistrict.candidates.length} 人參選`],
      defaultOpen: false,
      contentFn: (body) => {
        const candidates = [...parentDistrict.candidates].sort((a,b)=>a.registered_on.localeCompare(b.registered_on)||(a.name||"").localeCompare(b.name||"","zh-Hant"));
        body.appendChild(element("p", "observation-note", "候選人資格經審定公告，名冊依官方正式登記資料列示。排序為登記日期、姓名："));
        body.appendChild(observationTable(candTitle, ["姓名", "推薦政黨", "登記日期"], candidates.map(c=>[c.name ?? "姓名待核對", c.party === "無" ? "無黨籍" : c.party, c.registered_on])));
      }
    });
    observationDetail.appendChild(candCard);
  }

  const villCard = createCollapsibleCard({
    id: "township-villages",
    icon: "🗺️",
    title: `${townshipName} 村里選情與歷史資料`,
    previewPills: [`共 ${villageList.length} 村里`],
    defaultOpen: false,
    contentFn: (body) => {
      body.appendChild(element("p", "observation-note", "點擊任一村里名稱進入檢視該村里歷屆首長得票紀錄與選情指標："));
      const sortedVillages = [...villageList].sort((a, b) => {
        const aKey = `${county}／${townshipName}／${a.label}`;
        const bKey = `${county}／${townshipName}／${b.label}`;
        const aSw = observation.swingAnalysis?.get(aKey);
        const bSw = observation.swingAnalysis?.get(bKey);
        const aClose = aSw?.isClose2022 ? 1 : 0;
        const bClose = bSw?.isClose2022 ? 1 : 0;
        if (bClose !== aClose) return bClose - aClose;
        const aCh = aSw?.partyChanges ?? 0;
        const bCh = bSw?.partyChanges ?? 0;
        if (bCh !== aCh) return bCh - aCh;
        const aM = aSw?.marginPct ?? 999;
        const bM = bSw?.marginPct ?? 999;
        if (aM !== bM) return aM - bM;
        return a.label.localeCompare(b.label, "zh-Hant");
      });
      const rows = sortedVillages.map(v => {
        const vKey = `${county}／${townshipName}／${v.label}`;
        const sw = observation.swingAnalysis?.get(vKey);
        const btn = element("button", "observation-table-link", v.label);
        btn.type = "button";
        btn.title = `檢視 ${v.label} 歷屆選情`;
        btn.addEventListener("click", () => {
          observationNavigate("village", v.label);
        });
        let badgeText = sw ? "歷史差距較大" : "歷史資料未載入";
        if (sw?.quadrantStatus === "close_swing" || sw?.status === "close_swing") badgeText = "🔥 激戰搖擺";
        else if (sw?.quadrantStatus === "close_only" || sw?.status === "close_only") badgeText = "⚔️ 傳統激戰";
        else if (sw?.quadrantStatus === "swing_only" || sw?.status === "swing") badgeText = "🔄 歷屆搖擺";
        if (sw?.isBellwether) badgeText += " · 🎯指標村里";
        const gapText = sw ? `更迭 ${sw.partyChanges} 次 · 差距 ${observationPercent(sw.marginPct)}` : "未有歷史紀錄";
        return [btn, badgeText, gapText];
      });
      body.appendChild(observationTable(`${townshipName} 村里清單`, ["村里名稱", "選情分類", "黨籍變化與差距"], rows));
    }
  });
  observationDetail.appendChild(villCard);
  observationDetail.appendChild(createCollapsibleCard({
    id: "township-summary", icon: "📊", title: "歷屆搖擺區域", defaultOpen: false,
    contentFn: (body) => appendObservationSwingSummary(body)
  }));
}

let villageIndexPromise = null;
const villageGeometryCache = new Map();
const villageGeometryPending = new Map();
function loadedVillages(county, town) {
  for (const geography of villageGeometryCache.values()) {
    const villages = geography.villages(county, town);
    if (villages.length) return villages;
  }
  return [];
}
async function ensureVillageGeography(county = observation.county, town = observation.township) {
  if (!county || !town) throw new Error("請先選擇縣市及鄉鎮");
  if (!villageIndexPromise) {
    const pointer = state.manifest.geography.village_index;
    villageIndexPromise = fetchJson(`data/${pointer.file}`, null, pointer.sha256).then(index => {
      if (index.schema !== "village-shards-v1" || !index.counties) throw new Error("村里索引格式錯誤");
      return index;
    }).catch(error => { villageIndexPromise = null; throw error; });
  }
  const index = await villageIndexPromise;
  const countyEntry = Object.values(index.counties).find(c => c.name === county);
  const resource = countyEntry?.resource || Object.values(countyEntry?.towns || {}).find(t => t.name === town)?.resource;
  if (!resource) throw new Error("找不到此行政區圖資");
  const key = resource.sha256;
  if (villageGeometryCache.has(key)) {
    const value = villageGeometryCache.get(key);
    villageGeometryCache.delete(key); villageGeometryCache.set(key,value);
    return value;
  }
  if (!villageGeometryPending.has(key)) {
    const pending = fetchJson(`data/${resource.file}`, null, resource.sha256).then(async topology => {
      await new Promise(resolve => setTimeout(resolve, 0));
      const decoded = core.decodeTopology(topology);
      if (decoded.features.length !== resource.featureCount) throw new Error("村里圖資數量不符");
      const geography = core.buildObservationGeography(decoded.features);
      villageGeometryCache.set(key, geography);
      while (villageGeometryCache.size > 2) villageGeometryCache.delete(villageGeometryCache.keys().next().value);
      return geography;
    }).finally(() => villageGeometryPending.delete(key));
    villageGeometryPending.set(key,pending);
  }
  return villageGeometryPending.get(key);
}

function observationNavigate(level, value = null, fromRoute = false) {
  if (level === "office" && !product.allowsOffice(value)) return;
  if (level === "district" && !observation.shard?.districts.some(d => d.id === value && product.allowsOffice(d.office))) return;
  if (!fromRoute) {
    const selectedOffice = level === "office" ? value : observation.activeOffice || "mayor";
    const office = ["metro_councilor", "county_councilor"].includes(selectedOffice) ? "council" : ["metro_mayor", "county_mayor"].includes(selectedOffice) ? "mayor" : selectedOffice;
    const county = level === "home" ? null : level === "county" ? value : observation.county;
    const district = ["home","county","office"].includes(level) ? null : level === "district" ? value : observation.district;
    const town = ["home","county","office","district"].includes(level) ? null : level === "township" ? value : observation.township;
    const village = level === "village" ? value : null;
    const code = (regions, label) => { const r = regions?.find(r => r.label === label); return r ? JSON.parse(r.key)[2] : null; };
    const countyCode = code(observation.geography?.counties, county);
    const townCode = code(observation.geography?.townships(county), town);
    const villageCode = code(observation.geography?.villages(county,town), village);
    const route = globalThis.ElectionNavigation.serialize({office,county:countyCode,district,town:townCode,village:villageCode});
    if (window.location.hash === route) return handleHashRoute();
    navigateObservationHash(route);
    return;
  }
  observationSearch.value = "";
  if (observation.bottomSheet && typeof window !== "undefined" && window.innerWidth < 1024) {
    // Final surface is committed once by the route handler.
  }
  if (level !== "home" && observation.inspectorCollapsed && typeof document !== "undefined") {
    observation.inspectorCollapsed = false;
    document.querySelector(".observation-inspector")?.classList.remove("collapsed");
    document.getElementById("inspector-expand-btn")?.classList.add("hidden");
  }
  if (level === "home") {
    observation.cardStateDistrict = null;
    observation.gate.invalidate(); observation.controller?.abort();
    observation.countyError = null; observation.county = null; observation.shard = null; observation.office = null; observation.township = null; observation.district = null; observation.village = null; observation.swingData = null; observation.swingAnalysis = null;
    observationOverview(); renderObservationNavigation(); return;
  }
  if (level === "county") { switchToDetailTab(); return loadObservationCounty(value); }
  if (!observation.shard) return;
  if (level === "office") { observation.office = value; observation.township = null; observation.district = null; observation.village = null; }
  if (level === "district") { observation.district = value; observation.township = null; observation.village = null; }
  if (level === "township") {
    observation.cardStateDistrict = null;
    switchToDetailTab();
    observation.township = value;
    observation.village = null;
    if (observation.district) {
      const curDist = observation.shard.districts.find(d => d.id === observation.district);
      const isMayorDist = ["metro_mayor", "county_mayor"].includes(curDist?.office);
      const loc = observationDistrictLocation(curDist);
      const inDist = isMayorDist || (loc ? (loc.townships.includes(value) || loc.partial_townships?.includes(value)) : (curDist?.township === value));
      if (!inDist) observation.district = null;
    } else if (["metro_mayor", "county_mayor"].includes(observation.office)) {
      const mayorDist = observation.shard?.districts.find(d => ["metro_mayor", "county_mayor"].includes(d.office));
      if (mayorDist) observation.district = mayorDist.id;
    }
  }
  if (level === "village") {
    switchToDetailTab();
    observation.village = value;
    renderObservationVillage(value);
    renderObservationNavigation();
    return;
  }
  if (level === "township" || (observation.township && !observation.village && level !== "district")) {
    renderObservationTownship(observation.township);
    renderObservationNavigation();
    return;
  }
  if (!observation.district && observation.office) {
    const matches = observationScopedDistricts();
    if (matches.length === 1 && !observationDistrictLocation(matches[0])?.partial_townships?.includes(observation.township)) observation.district = matches[0].id;
  }
  if (observation.district) renderObservationDistrict(observation.district, ["district", "township"].includes(level));
  else observationOverview();
  renderObservationNavigation();
  if (level === "township" && !observation.district && ["metro_councilor","county_councilor"].includes(observation.office)) {
    observationDetail.appendChild(element("p", "observation-note", "此行政區可能涵蓋多個選區，可展開下方名稱清單選擇。"));
  }
}
function renderObservationNavigation() {
  if (!observation.manifest) return;
  renderObservationMap();
  clear(observationBreadcrumb); clear(observationNavigation);
  const generation = observation.gate.generation;
  const renderGeneration = ++observation.renderGeneration;
  const crumb = (label, level, value) => {
    const button = element("button", "observation-crumb", label); button.type = "button";
    button.addEventListener("click", () => { if (generation === observation.gate.generation && renderGeneration === observation.renderGeneration) observationNavigate(level, value); }); observationBreadcrumb.appendChild(button);
  };
  crumb("全國", "home");
  if (observation.county) crumb(observation.county, "county", observation.county);
  if (observation.office) crumb(observation.manifest.offices[observation.office], "office", observation.office);
  if (observation.district) {
    const dist = observation.shard?.districts.find(d => d.id === observation.district);
    const distName = dist ? dist.name || dist.id : "選區";
    if (observation.township || observation.village) crumb(distName, "district", observation.district);
    else observationBreadcrumb.appendChild(element("span", "observation-current", distName));
  }
  if (observation.township) {
    if (observation.village) {
      crumb(observation.township, "township", observation.township);
      observationBreadcrumb.appendChild(element("span", "observation-current", observation.village));
    } else {
      observationBreadcrumb.appendChild(element("span", "observation-current", observation.township));
    }
  }
  observationBreadcrumb.lastElementChild?.setAttribute('aria-current','location');
  requestAnimationFrame(()=>{if(renderGeneration===observation.renderGeneration)observationBreadcrumb.scrollLeft=observationBreadcrumb.scrollWidth;});
  let choices = [];
  if (!observation.county) choices = observation.manifest.counties.map(c => ({label:c.name, count:observation.mayorMetrics?.counties.find(m=>m.county===c.name)?.cands_2026_count ?? 0, level:"county", value:c.name}));
  else if (!observation.shard) { observationNavigation.appendChild(element("p", "", "正在核對本縣市資料…")); return; }
  else if (!observation.office) choices = Object.entries(observation.manifest.offices).filter(([id]) => product.allowsOffice(id) && observation.shard.districts.some(d => d.office === id)).map(([id,label]) => ({label, count:observation.shard.districts.filter(d=>d.office===id).reduce((s,d)=>s+d.candidates.length,0), level:"office", value:id}));
  else if (observation.township) {
    const villageRegions = observation.geography?.villages(observation.county, observation.township) || [];
    choices = villageRegions.map(r => {
      const vKey = `${observation.county}／${observation.township}／${r.label}`;
      const swing = observation.swingAnalysis?.get(vKey);
      let badge = "";
      if (swing?.quadrantStatus === "close_swing" || swing?.status === "close_swing") badge = " · 🔥激戰";
      else if (swing?.quadrantStatus === "close_only" || swing?.status === "close_only") badge = " · ⚔️緊繃";
      else if (swing?.quadrantStatus === "swing_only" || swing?.status === "swing") badge = " · 🔄搖擺";
      if (swing?.isBellwether) badge += " · 🎯指標村里";
      return {
        label: r.label,
        searchText: `${r.label} ${badge}`,
        scope: swing?.isClose2022 ? "close" : (swing?.isSwing ? "swing" : "solid"),
        count: swing?.partyChanges || 0,
        level: "village",
        value: r.label
      };
    });
    document.getElementById("observation-list-title").textContent = `${observation.township} 村里清單與搜尋`;
  } else if (observation.district && ["metro_mayor", "county_mayor", "metro_councilor", "county_councilor"].includes(observation.office)) {
    const isMayor = ["metro_mayor", "county_mayor"].includes(observation.office);
    const curDist = observation.shard?.districts.find(d => d.id === observation.district);
    const loc = curDist && !isMayor ? observationDistrictLocation(curDist) : null;
    const coveredTownships = isMayor
      ? (observation.geography?.townships(observation.county).map(t => t.label) || [])
      : (loc ? [...(loc.townships || []), ...(loc.partial_townships || []).map(t => `${t}（部分村里）`)] : (curDist?.township ? [curDist.township] : []));
    choices = coveredTownships.map(tRaw => {
      const cleanName = tRaw.replace("（部分村里）", "");
      const tRecord = observation.swingData?.scopes?.townships.get(`${observation.county}／${cleanName}`);
      let note = "";
      if (tRecord?.closeSwingVillageCount > 0) note = `🔥 激戰村里 ${tRecord.closeSwingVillageCount} 個`;
      else if (tRecord?.swingVillageCount > 0) note = `🔄 搖擺村里 ${tRecord.swingVillageCount} 個`;
      return {
        label: tRaw,
        searchText: `${tRaw} ${cleanName}`,
        scope: "township",
        count: tRecord?.swingVillageCount || 0,
        note,
        level: "township",
        value: cleanName
      };
    });
    document.getElementById("observation-list-title").textContent = isMayor ? `${observation.county} 各行政區清單與選情搜尋` : `${curDist?.name || "選區"} 涵蓋行政區清單`;
  } else {
    const districts = observationScopedDistricts();
    if (!observation.township && districts.some(d => d.township)) choices = [...new Set(districts.map(d => d.township))].sort((a,b)=>a.localeCompare(b,"zh-Hant")).map(t => ({label:t, count:districts.filter(d=>d.township===t).reduce((s,d)=>s+d.candidates.length,0), level:"township", value:t}));
    else choices = districts.map(d => {
      const location = observationDistrictLocation(d), label = observationDistrictLabel(d);
      return {label, searchText:`${label} ${location?.scope_text || ""}`, scope:location?.scope, count:d.candidates.length, level:"district", value:d.id};
    });
  }
  const query = core.normalizeSearch(observationSearch.value);
  choices = choices.filter(c=>core.normalizeSearch(c.searchText || c.label).includes(query));
  observationNavigation.appendChild(element("p", "observation-count", `${choices.length} 個項目 · 依名稱排列`));
  const list = element("ul", "observation-choices");
  let previousGroup = null;
  choices.sort((a,b)=>Number(Boolean(a.scope && a.scope!=="regional"))-Number(Boolean(b.scope && b.scope!=="regional")) || a.label.localeCompare(b.label,"zh-Hant",{numeric:true})).forEach(c => {
    if (c.scope) {
      const group = c.scope === "regional" ? "區域議員選區" : "原住民選區（依身分別查閱）";
      if (group !== previousGroup) { const item=element("li","observation-choice-group"); item.appendChild(element("h3","",group)); list.appendChild(item); previousGroup=group; }
    }
    const li = element("li"), button = element("button", "observation-choice"); button.type = "button";
    button.append(element("span", "", c.label), element("small", "", c.note ? `${c.note}　›` : `${c.count.toLocaleString("zh-TW")} 人參選　›`));
    if (c.value === observation.district) button.setAttribute("aria-current", "true");
    button.addEventListener("click",()=>{if(generation===observation.gate.generation && renderGeneration===observation.renderGeneration) { observationList.open = false; observationNavigate(c.level,c.value); }});
    li.appendChild(button); list.appendChild(li);
  });
  if (!choices.length) list.appendChild(element("li", "", "沒有符合的項目。請清除篩選或返回上一層。"));
  observationNavigation.appendChild(list);
}
function renderCouncilPreview(metric) {
  clear(observationDetail);
  const hero=element("div","hero-summary");
  hero.dataset.preview="true";
  hero.append(element("p","eyebrow","議員選區"),element("h2","",`${metric.county} 第${metric.district_no}選區`));
  const grid=element("div","kpi-grid"), current=element("div","kpi-card"), historical=element("div","kpi-card");
  const seats=metric.seats?.["2026"], margin=metric.margin?.["2022"];
  current.append(element("span","kpi-label","2026 候選人與席次"),element("strong","kpi-val",seats&&metric.cands_2026!=null?`${metric.cands_2026} 人選 ${seats} 席`:"名冊或席次待核對"),element("small","kpi-sub","審定名冊 2026-10-16 · 不代表當選機率"));
  historical.append(element("span","kpi-label","2022 末席差距"),element("strong","kpi-val",margin?.votes!=null?`${margin.votes.toLocaleString("zh-TW")} 票`:"—"),element("small","kpi-sub",margin?.pct!=null?`占該屆有效票 ${margin.pct}%`:"無可比較差距"));
  for(const note of globalThis.ElectionContestBoard.councilStatus(metric))historical.appendChild(element("small","kpi-sub",note));
  grid.append(current,historical);hero.appendChild(grid);observationDetail.append(hero,element("p","observation-note","摘要已就緒，正在準備名冊與詳細資料…"));
}
async function loadObservationCounty(name) {
  observation.cardStateDistrict = null;
  switchToDetailTab();

  if (observation.inspectorCollapsed) {
    observation.inspectorCollapsed = false;
    document.getElementById("observation-inspector")?.classList.remove("collapsed");
    document.getElementById("inspector-expand-btn")?.classList.add("hidden");
  }
  observation.controller?.abort(); const controller = new AbortController(); observation.controller = controller;
  const generation = observation.gate.begin();
  observation.countyError = null;
  observation.county = name; observation.office = null; observation.township = null; observation.district = null; observation.village = null; observation.shard = null; observation.swingData = null; observation.swingAnalysis = null;
  clear(observationDetail); observationDetail.appendChild(element("p", "", "正在載入本縣市名冊與摘要…")); renderObservationNavigation();
  if (observation.activeOffice === "council") {
    const route=globalThis.ElectionNavigation.parse(window.location.hash);
    const metric=observation.councilMetrics?.districts.find(d=>d.county===name&&(route.district?d.map_district_id===route.district:d.office_kind===route.scope&&d.district_no===route.no));
    if(metric)renderCouncilPreview(metric);
  }
  try {
    const entry = observation.manifest.counties.find(c => c.name === name);
    if (!entry) throw new Error("觀察資料沒有此縣市");
    let shard = observation.cache.get(name);
    if (!shard) { shard = await fetchJson(`data/${entry.file}`, controller.signal, entry.sha256); core.validateObservationShard(shard, entry, observation.manifest); }
    if (!observation.gate.isCurrent(generation)) return;
    observation.cache.set(name, shard); observation.shard = shard;
    const offices = observation.activeOffice === "council" ? ["metro_councilor", "county_councilor"] : observation.activeOffice === "mayor" ? ["metro_mayor", "county_mayor"] : [observation.activeOffice];
    const office = shard.districts.find(d => offices.includes(d.office))?.office;
    if (!office) throw new Error("此縣市沒有目前選取的公職，請選擇其他縣市");
    observationNavigate("office", office, true);
    if (observation.activeOffice !== "council") ensureCountySwingData(name).then((data) => {
      if (!observation.gate.isCurrent(generation) || observation.county !== name || !data) return;
      observation.swingData = data;
      observation.swingAnalysis = data.villages;
      if (observation.mapReady) renderObservationMap();
      refreshObservationDetail(() => {
      if (observation.district && !observation.township && !observation.village) renderObservationDistrict(observation.district);
      else if (observation.township && !observation.village) renderObservationTownship(observation.township);
      else if (observation.village) renderObservationVillage(observation.village);
      else if (observation.district) renderObservationDistrict(observation.district);
      else observationOverview();
      });
    });
  } catch(error) {
    if (!observation.gate.isCurrent(generation)) return;
    observation.countyError = "名冊載入或驗證失敗，請在資料區重新載入。";
    observation.shard = null; renderObservationMap(); clear(observationDetail); clear(observationNavigation);
    observationDetail.appendChild(element("p", "observation-error", `本縣市資料未通過載入或驗證：${error.message}`));
    const retry = element("button", "", "重新載入本縣市"); retry.type = "button"; retry.addEventListener("click", ()=>{if(observation.gate.isCurrent(generation)) loadObservationCounty(name);}); observationDetail.appendChild(retry);
  }
}
function renderObservationDistrict(id, reveal = false) {
  const d = observation.shard?.districts.find(x => x.id === id);
  if (!d) return;
  if (observation.cardStateDistrict !== id) {
    observation.cardStateDistrict = id;
    observation.cardOpenState = {};
  }
  clear(observationDetail);

  const history = [...(d.history || [])].sort((a,b)=>a.year-b.year);
  const h2022 = history.find(h => h.year === 2022);
  const years = observation.manifest.history_years;
  const isCouncilor = ["metro_councilor", "county_councilor"].includes(d.office);
  const isVillageChief = d.office === "village_chief";
  const councilMetric = isCouncilor ? observation.councilMetrics?.districts.find(item => item.map_district_id === d.id) : null;
  const swingRecord = observation.swingData?.scopes?.councilDistricts.get(d.id)
    || (d.township ? observation.swingData?.scopes?.townships.get(`${d.county}／${d.township}`) : null)
    || observation.swingData?.scopes?.counties.get(d.county);

  // --- Tier 1: Fixed Hero Summary & KPI Cards ---
  const hero = element("div", "hero-summary");
  const heroHeader = element("div", "hero-header");
  const titleGroup = element("div", "hero-title-group");
  titleGroup.append(
    element("p", "eyebrow", observation.manifest.offices[d.office] || d.office),
    element("h2", "", d.name)
  );
  heroHeader.appendChild(titleGroup);

  const heroControls = element("div", "hero-controls");
  const back = element("button", "observation-return", "回到地圖選區");
  back.type = "button";
  back.addEventListener("click", () => {
    if (window.innerWidth < 1024) observation.bottomSheet?.setDetent("summary");
    observationMapCanvas.focus({ preventScroll: true });
    observationMapCanvas.scrollIntoView({ block: "center" });
  });
  heroControls.appendChild(back);

  heroHeader.appendChild(heroControls);
  hero.appendChild(heroHeader);

  // SNTV Notice & Dual-Lens Toggle for Councilors
  if (isCouncilor) {
    const advanced = element("details", "metric-method"); advanced.appendChild(element("summary", "", "選舉制度與其他歷史視角"));
    const sntvNotice = element("div", "sntv-notice", "💡 議員採多席次單記不可讓渡制（SNTV），分析重點在於「當選邊緣（最後一席與落選頭差距）」與「各黨得票板塊分佈」。");
    advanced.appendChild(sntvNotice);

    const dualLens = element("div", "dual-lens-toggle");
    const lensCouncilor = element("button", `dual-lens-btn ${observation.councilorLens === "councilor" ? "active" : ""}`, "議員本職選情（預設）");
    lensCouncilor.type = "button";
    lensCouncilor.addEventListener("click", () => {
      observation.councilorLens = "councilor";
      renderObservationDistrict(id);
    });
    const lensMayor = element("button", `dual-lens-btn ${observation.councilorLens === "mayor_base" ? "active" : ""}`, "選區內縣市長基本盤");
    lensMayor.type = "button";
    lensMayor.addEventListener("click", async () => {
      const generation = routeGeneration, county = observation.county;
      lensMayor.disabled = true; lensMayor.textContent = "正在載入歷史摘要…";
      const data = await ensureCountySwingData(county);
      if (generation !== routeGeneration || !lensMayor.isConnected) return;
      lensMayor.disabled = false;
      if (!data) { lensMayor.textContent = "歷史摘要載入失敗，按此重試"; return; }
      observation.swingData = data; observation.swingAnalysis = data.villages;
      observation.councilorLens = "mayor_base";
      renderObservationDistrict(id);
    });
    dualLens.append(lensCouncilor, lensMayor);
    advanced.appendChild(dualLens);
    const swing = councilMetric?.seat_swing;
    advanced.appendChild(element("p", "observation-note", `席次結構變動指數：${swing?.rate != null ? (swing.rate * 100).toFixed(1) + "%" : "資料不足"}。每兩屆的 Σ｜各政黨席次差｜÷2，累加 2014→2018 與 2018→2022，再除以三屆平均席次。可超過 100%，0.5 是計算值，不是半席當選或選民換黨比例。`));
    hero.appendChild(advanced);
  }

  // 4 KPI Cards
  const kpiGrid = element("div", "kpi-grid");
  const kpi1 = element("div", "kpi-card");
  kpi1.append(
    element("span", "kpi-label", "2026 候選人"),
    element("strong", "kpi-val", isVillageChief && d.candidates.length === 1 ? "1 人同額" : `${d.candidates.length} 人`),
    element("small", "kpi-sub", isVillageChief ? (d.candidates.length === 1 ? "同額登記" : "競爭登記") : (isCouncilor ? "多席次登記" : "正式審定名冊"))
  );

  const kpi2 = element("div", "kpi-card");
  kpi2.append(
    element("span", "kpi-label", "2022 投票率"),
    element("strong", "kpi-val", h2022?.turnout_pct != null ? observationPercent(h2022.turnout_pct) : "—"),
    element("small", "kpi-sub", h2022 ? `投票數 ${observationNumber(h2022.total_votes)}` : "同名選區無紀錄")
  );

  const kpi3 = element("div", "kpi-card");
  if (isCouncilor && observation.councilorLens === "councilor") {
    kpi3.append(
      element("span", "kpi-label", "當選邊緣票差"),
      element("strong", "kpi-val", councilMetric?.margin?.["2022"]?.votes != null ? `${councilMetric.margin["2022"].votes.toLocaleString("zh-TW")} 票` : "—"),
      element("small", "kpi-sub", councilMetric?.margin?.["2022"]?.pct != null ? `有效票差 ${councilMetric.margin["2022"].pct}%` : "末席差距資料不足")
    );
  } else {
    kpi3.append(
      element("span", "kpi-label", "2022 催票率勝差"),
      element("strong", "kpi-val", swingRecord?.marginPct != null ? `${swingRecord.marginPct.toFixed(2)}%` : "—"),
      element("small", "kpi-sub", swingRecord?.isClose2022 ? "差距 ≤3% 激戰" : "版圖差距")
    );
  }

  const kpi4 = element("div", "kpi-card");
  let quadrantText = "🛡️ 穩定基本盤";
  let quadrantSub = "未換黨且非激戰";
  if (isVillageChief) {
    quadrantText = d.candidates.length === 1 ? "🤝 同額登記" : "🗳️ 基層單一席次";
    quadrantSub = "村里長選舉";
  } else if (swingRecord?.quadrantStatus === "close_swing" || swingRecord?.status === "close_swing") {
    quadrantText = "🔥 核心搖擺激戰";
    quadrantSub = "政黨更迭且差距 ≤3%";
  } else if (swingRecord?.quadrantStatus === "close_only" || swingRecord?.status === "close_only") {
    quadrantText = "⚔️ 傳統版圖激戰";
    quadrantSub = "未換黨但差距 ≤3%";
  } else if (swingRecord?.quadrantStatus === "swing_only" || swingRecord?.status === "swing") {
    quadrantText = "🔄 歷屆搖擺";
    quadrantSub = "政黨更迭但差距 >3%";
  }
  if (isCouncilor && observation.councilorLens === "councilor") {
    const seats = councilMetric?.seats?.["2026"];
    kpi2.replaceChildren(element("span", "kpi-label", "2026 參選競爭"), element("strong", "kpi-val", seats ? `${d.candidates.length} 人搶 ${seats} 席` : "應選席次資料不足"), element("small", "kpi-sub", councilMetric?.competition?.ratio_2026 != null ? `平均每席 ${councilMetric.competition.ratio_2026} 人競爭` : ""));
    quadrantText = councilMetric?.seat_swing?.rate != null ? `${(councilMetric.seat_swing.rate * 100).toFixed(1)}%` : "—";
    quadrantSub = councilMetric?.seat_swing?.total != null ? `三屆席次變動 ${councilMetric.seat_swing.total} 席` : "歷史資料不足";
  }
  kpi4.append(
    element("span", "kpi-label", isCouncilor && observation.councilorLens === "councilor" ? "席次搖擺度" : "選情分類"),
    element("strong", "kpi-val", quadrantText),
    element("small", "kpi-sub", quadrantSub)
  );
  if (isCouncilor && observation.councilorLens === "councilor") {
    kpi2.querySelector(".kpi-label").textContent = "2026 候選人與席次";
    kpi2.querySelector(".kpi-val").textContent = councilMetric?.seats?.["2026"] ? `${d.candidates.length} 人選 ${councilMetric.seats["2026"]} 席` : `${d.candidates.length} 人參選 · 席次待核對`;
    kpi2.querySelector(".kpi-sub").textContent = "中選會 2026-10-16 公告名冊";
    kpi3.querySelector(".kpi-label").textContent = "2022 末席差距";
    kpi3.querySelector(".kpi-sub").textContent = councilMetric?.margin?.["2022"]?.pct != null ? `占該屆有效票 ${councilMetric.margin["2022"].pct}%` : "資料不足或同額，無法比較";
    for (const text of globalThis.ElectionContestBoard.councilStatus(councilMetric || {})) kpi3.appendChild(element("small", "kpi-sub", text));
    if (d.candidates.length === councilMetric?.seats?.["2026"]) kpi2.appendChild(element("small", "kpi-sub", "參選人數與應選席次相同（同額競選）"));
    kpiGrid.append(kpi2,kpi3);
  } else kpiGrid.append(kpi1,kpi2,kpi3,kpi4);
  hero.insertBefore(kpiGrid, hero.querySelector(".metric-method"));

  observationDetail.appendChild(hero);

  const isMayor = ["metro_mayor", "county_mayor"].includes(d.office);
  if (isCouncilor || isMayor) {
    const location = isCouncilor ? observationDistrictLocation(d) : null;
    const districtTownships = isCouncilor
      ? (location ? [...(location.townships || []), ...(location.partial_townships || []).map(t => `${t}（部分村里）`)] : (d.township ? [d.township] : []))
      : (observation.geography?.townships(d.county).map(t => t.label) || []);
    if (districtTownships.length) {
      observationDetail.appendChild(createCollapsibleCard({
        id: "townships", icon: "📍", title: "涵蓋行政區",
        previewPills: [`${districtTownships.length} 個行政區`], defaultOpen: false,
        contentFn: (body) => {
          body.appendChild(element("p", "observation-note", "點選行政區查看選情與村里資料。"));
          const townBtns = element("div", "district-townships-buttons");
          districtTownships.forEach(tRaw => {
            const cleanName = tRaw.replace("（部分村里）", "");
            const tRec = observation.swingData?.scopes?.townships.get(`${d.county}／${cleanName}`);
            let badge = "";
            if (tRec?.closeSwingVillageCount > 0) badge = ` · 🔥 ${tRec.closeSwingVillageCount}`;
            else if (tRec?.swingVillageCount > 0) badge = ` · 🔄 ${tRec.swingVillageCount}`;
            const btn = element("button", "district-township-btn");
            btn.type = "button"; btn.textContent = `${tRaw}${badge} ›`;
            btn.title = `檢視 ${cleanName} 轄下村里資料`;
            btn.addEventListener("click", () => { observation.district = d.id; observationNavigate("township", cleanName); });
            townBtns.appendChild(btn);
          });
          body.appendChild(townBtns);
        }
      }));
    }
  }

  // --- Tier 2: Five Collapsible Cards ---

  // Card 1: 2026 候選人名冊
  const rosterPills = isVillageChief
    ? [d.candidates.length === 1 ? "1 人同額登記" : `${d.candidates.length} 人競選`]
    : [`${d.candidates.length} 人參選`, `${new Set(d.candidates.map(c => c.party)).size} 個政黨`];
  const rosterCard = createCollapsibleCard({
    id: "roster",
    icon: "👤",
    title: "2026 候選人名冊",
    previewPills: rosterPills,
    defaultOpen: false,
    contentFn: (body) => {
      const candidates = [...d.candidates].sort((a,b)=>a.registered_on.localeCompare(b.registered_on)||(a.name||"").localeCompare(b.name||"","zh-Hant"));
      body.appendChild(element("p", "observation-note", "名冊依中選會正式登記公告列示，排序依登記日期及姓名："));
      if (d.candidates.some(c=>c.name_status==="unreadable")) {
        body.appendChild(element("p", "observation-caution", "少數候選人姓名於官方公告字形罕見，為求正確不作臆測，請點選來源公報核對。"));
      }
      const table = observationTable("正式登記候選人名冊", ["姓名", "推薦政黨", "登記日期", "來源"], candidates.map(c=>[c.name ?? "姓名待核對（原始 PDF 字形缺漏）", c.party === "無" ? "無黨籍（未經政黨推薦）" : c.party, c.registered_on, observationSource(d.source_id,c.source_page)]));
      table.querySelectorAll("tbody tr").forEach((row,i) => { row.dataset.candidate = String(d.candidates.indexOf(candidates[i])); row.tabIndex = -1; row.classList.toggle("search-selected-candidate", routeCandidateIndex() === row.dataset.candidate); });
      body.appendChild(table);
    }
  });
  observationDetail.appendChild(rosterCard);

  // Card 2: 搖擺與激戰選區深度分析 (D5: 村里長不計算、不渲染此卡)
  if (!isVillageChief) {
    const swingPills = [];
    if (isCouncilor && observation.councilorLens === "councilor") swingPills.push({ text: "末席差距與競爭強度" });
    else if (swingRecord?.quadrantStatus === "close_swing" || swingRecord?.status === "close_swing") swingPills.push({ text: "🔥 核心激戰", cls: "pill-close-swing" });
    else if (swingRecord?.quadrantStatus === "close_only" || swingRecord?.status === "close_only") swingPills.push({ text: "⚔️ 傳統激戰", cls: "pill-close-only" });
    else if (swingRecord?.quadrantStatus === "swing_only" || swingRecord?.status === "swing") swingPills.push({ text: "🔄 歷屆搖擺", cls: "pill-swing-only" });
    else swingPills.push({ text: "🛡️ 穩定基本盤" });

    const swingCard = createCollapsibleCard({
      id: "swing",
      icon: "🔥",
      title: isCouncilor && observation.councilorLens === "councilor" ? "議員選情指標" : "搖擺與激戰選區深度分析",
      previewPills: swingPills,
      defaultOpen: false,
      contentFn: (body) => {
        if (isCouncilor && observation.councilorLens === "councilor") {
          body.appendChild(element("p", "observation-note", "議員選區採多席次單記不可讓渡制（SNTV），分析焦點為「2022 當選邊緣差距」與「各黨催票板塊」："));
          if (councilMetric) {
            const margin = councilMetric.margin?.["2022"];
            const cGrid = element("div", "observation-metrics-grid");
            cGrid.append(
              observationMetric("2022 末席票數差", margin?.votes != null ? `${margin.votes.toLocaleString("zh-TW")} 票` : "—", margin?.last_win && margin?.first_lose ? `${margin.last_win}／${margin.first_lose}` : "資料不足或同額"),
              observationMetric("2022 末席差距占有效票", margin?.pct != null ? `${margin.pct}%` : "—", margin?.women_quota_applied ? "含婦女保障名額" : "最後常態當選席與落選頭"),
              observationMetric("2026 參選競爭", councilMetric.seats?.["2026"] ? `${d.candidates.length} 人搶 ${councilMetric.seats["2026"]} 席` : "—", councilMetric.competition?.ratio_2026 != null ? `平均每席 ${councilMetric.competition.ratio_2026} 人競爭` : "應選席次資料不足")
            );
            body.appendChild(cGrid);
          } else body.appendChild(element("p", "observation-note", "本選區指標資料尚未完成對照。"));
        } else {
          appendSwingDistrictDetail(body, d);
          if (isMayor) appendObservationSwingSummary(body);
        }
      }
    });
    observationDetail.appendChild(swingCard);
  }


  // Card 3: 歷屆投票率與政黨催票率
  const historyPills = [
    h2022?.turnout_pct != null ? `2022 投票率 ${observationPercent(h2022.turnout_pct)}` : null,
    !isCouncilor && swingRecord?.marginPct != null ? `勝差 ${swingRecord.marginPct.toFixed(1)}%` : null
  ].filter(Boolean);
  const historyCard = createCollapsibleCard({
    id: "history",
    icon: "📊",
    title: "歷屆投票率與政黨催票率（2014–2022）",
    previewPills: historyPills,
    defaultOpen: false,
    contentFn: (body) => {
      if (isMayor || isCouncilor) {
        if (isCouncilor) {
          const cmp = councilMetric?.comparability;
          const labels = { comparable: "範圍及席次一致", seats_changed: "範圍一致、席次變動", redistricted: "範圍不同", na: "資料不足" };
          body.appendChild(element("p", "observation-caution", `各圖使用當屆同名議員選區；選區範圍和席次可能改變。2014→2018：${labels[cmp?.["2014_2018"]] || "資料不足"}；2018→2022：${labels[cmp?.["2018_2022"]] || "資料不足"}；2022→2026：${labels[cmp?.["2022_2026"]] || "資料不足"}。範圍不同或資料不足時，請避免將差異直接解讀為支持變化。`));
        }
        const bars = element("div", "history-stacked-comparison");
        [2014, 2018, 2022].forEach(year => {
          const item = history.find(h => h.year === year);
          if (item && item.electorate > 0) renderStackedBar(bars, item, history.flatMap(h => h.parties));
          else bars.appendChild(element("p", "observation-missing", `${year} 年資料不足，無法繪圖。`));
        });
        body.appendChild(bars);
      } else if (h2022) renderStackedBar(body, h2022);
      body.appendChild(element("p", "observation-caution", "比對各年度同名選區歷史開票與催票率數據，供觀察歷屆政黨版圖與動員趨勢。"));
      const chart = element("div", "observation-trend");
      years.forEach(year=>{
        const h=history.find(h=>h.year===year), row=element("div","observation-trend-row"), progress=element("progress");
        progress.max=100; progress.value=h?.turnout_pct??0; progress.setAttribute("aria-label", `${year} 投票率 ${observationPercent(h?.turnout_pct??null)}`);
        row.append(element("strong","",year), ...(h?.turnout_pct!=null ? [progress] : [element("span","observation-missing","無可用資料")]), element("span","",observationPercent(h?.turnout_pct??null))); chart.appendChild(row);
      });
      body.appendChild(chart);
      let prior = null;
      const turnoverRows = years.map(year=>{
        const h=history.find(h=>h.year===year);
        const change=h?.turnout_pct!=null&&prior?.turnout_pct!=null ? `${h.turnout_pct-prior.turnout_pct>=0?"+":""}${(h.turnout_pct-prior.turnout_pct).toFixed(2)} 個百分點` : "—";
        prior=h;
        return [year,h?.date||"未納入",observationNumber(h?.electorate??null),observationNumber(h?.total_votes??null),observationPercent(h?.turnout_pct??null),change];
      });
      const turnoutDetail = element("details");
      turnoutDetail.appendChild(element("summary", "", "查看歷屆投票率詳細表格"));
      turnoutDetail.appendChild(observationTable("投票率＝投票數（含無效票）÷ 選舉人數",["年度","投票日期","選舉人數","投票數","投票率","較前一屆"],turnoverRows));
      body.appendChild(turnoutDetail);
      body.appendChild(element("h3","","政黨催票率"));
      const electioneeringNote=element("p","observation-note","催票率（得票數 ÷ 選舉人數）以全體選舉人為分母，呈現政黨實際動員出全體選民支持的比例，較得票率更能跨屆客觀比較動員實力。延伸閱讀：");
      const electioneeringReference=element("a","","「得票率」如何誤導人：從催票率看藍綠政黨版圖重組趨勢（葉高華，菜市場政治學）");
      electioneeringReference.href=["https:",String.fromCharCode(47,47),"whogovernstw.org","/2020/01/17/kohuayap2/"].join("");
      electioneeringReference.target="_blank";
      electioneeringReference.rel="noopener noreferrer";
      electioneeringNote.appendChild(electioneeringReference);
      body.appendChild(electioneeringNote);
      const parties=[...new Set(history.flatMap(h=>h.parties.map(p=>p.name)))].sort((a,b)=>a.localeCompare(b,"zh-Hant"));
      const partyComparison = observationTable("各黨催票率（缺席或無資料以 — 表示）",["政黨",...years.map(y=>`${y} 催票率`),"2018 → 2022 變化"],parties.map(name=>{
        const values=years.map(y=>history.find(h=>h.year===y)?.parties.find(p=>p.name===name)?.electorate_share_pct??null);
        const delta=values[1]!==null&&values[2]!==null?values[2]-values[1]:null;
        return [name,...values.map(observationPercent),delta===null?"—":`${delta>=0?"+":""}${delta.toFixed(2)} 個百分點`];
      }));
      const compareDetails = element("details");
      compareDetails.appendChild(element("summary", "", "查看歷屆各黨催票率比較表"));
      compareDetails.appendChild(partyComparison);
      body.appendChild(compareDetails);
      [2014, 2018].forEach(year => {
        const h = history.find(item => item.year === year);
        const yearDetails = element("details");
        yearDetails.appendChild(element("summary", "", `查看 ${year} 年各黨票數與催票率`));
        if (h) yearDetails.appendChild(observationTable(`${year} 年各黨票數與分母`, ["政黨", "得票數", "有效票", "選舉人數", "得票率", "催票率"], h.parties.map(p => [p.name, observationNumber(p.votes), observationNumber(h.valid_votes), observationNumber(h.electorate), observationPercent(p.vote_share_pct), observationPercent(p.electorate_share_pct)])));
        else yearDetails.appendChild(element("p", "observation-missing", "此年度資料不足。"));
        body.appendChild(yearDetails);
      });
      const details=element("details");details.appendChild(element("summary","","查看 2022 年各黨票數與分母"));
      details.appendChild(observationTable("歷史政黨原始總數",["年度／政黨","得票數","有效票","選舉人數","得票率","催票率"],history.filter(h => h.year === 2022).flatMap(h=>h.parties.map(p=>[`${h.year}／${p.name}`,observationNumber(p.votes),observationNumber(h.valid_votes),observationNumber(h.electorate),observationPercent(p.vote_share_pct),observationPercent(p.electorate_share_pct)]))));
      body.appendChild(details);
    }
  });
  if (isMayor || isCouncilor) observationDetail.insertBefore(historyCard, hero.nextSibling);
  else observationDetail.appendChild(historyCard);

  // Card 4: 行政區與選區快速跳轉
  const jumpCard = createCollapsibleCard({
    id: "jump",
    icon: "🧭",
    title: "行政區與選區快速跳轉",
    previewPills: [`${observation.shard.districts.filter(d => product.allowsOffice(d.office)).length} 個選區`],
    defaultOpen: false,
    contentFn: (body) => {
      const list = element("div", "swing-summary-list");
      observation.shard.districts.filter(d => product.allowsOffice(d.office)).forEach((other) => {
        const btn = element("button", `swing-summary-button ${other.id === d.id ? "active" : ""}`, other.name || other.id);
        btn.type = "button";
        btn.addEventListener("click", () => { observationNavigate("office", other.office); observationNavigate("district", other.id); });
        list.appendChild(btn);
      });
      body.appendChild(list);
    }
  });
  observationDetail.appendChild(jumpCard);

  // Card 5: 資料說明與官方來源
  const notesCard = createCollapsibleCard({
    id: "notes",
    icon: "ⓘ",
    title: "資料說明與官方來源",
    previewPills: ["中選會公報與歷屆資料庫"],
    defaultOpen: false,
    contentFn: (body) => {
      body.appendChild(element("p", "observation-note", "催票率（得票數 ÷ 選舉人數）：反映候選人在整體選民中的實質動員強度，較不易受單屆投票率波動影響。"));
      body.appendChild(element("p", "observation-note", `候選人名冊公告基準日：${observation.manifest.as_of}。`));
      if (isCouncilor) {
        body.appendChild(element("p", "observation-note", "議員為多席次選舉，地圖以選區涵蓋之鄉鎮市區定位；激戰指標採「2022 最低票當選與落選頭差距」。"));
      }
      const location = observationDistrictLocation(d);
      if (location) {
        if (location.scope_text) body.appendChild(element("p","observation-note",`公告範圍：${location.scope_text}`));
        (location.source_pages || [location.source_page]).forEach(page=>body.appendChild(observationSource(location.source_id,page,"選區公告")));
      }
      if (d.population) body.appendChild(observationSource(d.population.source_id, null, "人口統計"));
      (observation.manifest?.sources || []).filter(src => product.council || !/cec-roster-[1345678]$|cec-63626/.test(src.id)).forEach(src => {
        body.appendChild(observationSource(src.id, null, src.id === "cec-65213" ? "候選人資格審定公告" : src.title));
      });
      d.history_issues.forEach(issue=>body.appendChild(element("p","observation-error",issue)));
    }
  });
  observationDetail.appendChild(notesCard);

  if (reveal && window.matchMedia("(max-width: 1023px)").matches) hero.scrollIntoView({ block: "start" });
}
async function initializeObservation(pointer) {
  if (!pointer) return;
  try {
    const manifest = await fetchJson(`data/${pointer.manifest}`, null, pointer.sha256);
    core.validateObservationManifest(manifest, pointer);
    observation.manifest = manifest;
    renderObservationMap();
    observation.activeOffice = "mayor"; // 預設為縣市長

    // Initial council routes must not fetch the other office summary.
    if (!product.council || !window.location.hash.startsWith("#/council")) try {
      observation.mayorMetrics = await fetchJson(`data/${pointer.mayor_metrics.file}`, null, pointer.mayor_metrics.sha256);
    } catch (error) { observation.mayorMetrics = null; }

    // 初始化拉鋸榜元件 ContestBoard
    const boardContainer = document.getElementById("contest-board-container");
    if (boardContainer && globalThis.ElectionContestBoard) {
      observation.contestBoard = new globalThis.ElectionContestBoard.ContestBoard({
        container: boardContainer,
        mode: "mayor",
        onSelectMayor: (countyName) => {
          navigateObservationHash(`#/mayor/${encodeURIComponent(countyName)}`);
        },
        onSelectCouncil: (district) => {
          navigateObservationHash(`#/council/${encodeURIComponent(district.county)}/${encodeURIComponent(district.office_kind)}/${encodeURIComponent(district.district_no)}`);
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
        navigateObservationHash("#/mayor");
      });
      tabCouncil.addEventListener("click", () => {
        navigateObservationHash("#/council");
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
          observationNavigate("home");
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
    if (inspector && globalThis.ElectionUIShell) {
      observation.bottomSheet = globalThis.ElectionUIShell.createBottomSheet(inspector, inspector.querySelector(".sheet-grabber-bar"), { onDetentChange: () => requestAnimationFrame(renderObservationMap) });
    }
    document.getElementById("mobile-summary-open")?.addEventListener("click", () => observation.bottomSheet?.setDetent("expanded"));
    document.getElementById("inspector-reading-btn")?.addEventListener("click", (event) => {
      inspector.classList.toggle("reading"); event.currentTarget.textContent = inspector.classList.contains("reading") ? "返回分欄" : "展開閱讀"; renderObservationMap();
    });
    collapseBtn?.addEventListener("click", () => {
      if (window.innerWidth < 1024) observation.bottomSheet?.setDetent("summary");
      else { inspector.classList.toggle("reading"); renderObservationMap(); }
    });
    if (typeof ResizeObserver !== "undefined") {
      const resize = new ResizeObserver(() => {
        const height = Math.ceil(document.querySelector(".topbar").getBoundingClientRect().height);
        document.documentElement.style.setProperty("--toolbar-height", `${height}px`);
        requestAnimationFrame(renderObservationMap);
      });
      resize.observe(document.querySelector(".topbar"));
      resize.observe(document.querySelector(".observation-map-card"));
    }

    inspector.addEventListener("scroll", saveObservationView, true);
    inspector.addEventListener("focusin", saveObservationView);

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
          (kind) => loadGlobalSearchIndex(kind),
          (item) => {
            if (item?.route) navigateObservationHash(item.route);
          }
        );
        if (trigger) trigger.addEventListener("click", () => observation.spotlight.open());
      }
    }

    observationOverview();
  } catch (err) {
    observation.mapError = "審定名冊載入失敗";
    throw err;
  }
}

const globalSearchPromises = new Map();
function loadGlobalSearchIndex(kind = "places") {
  if (!globalSearchPromises.has(kind)) globalSearchPromises.set(kind, (async () => {
    const index = state.manifest.search_index;
    if (!index || index.schema !== "search-index-v1") throw new Error("搜尋索引版本不符");
    const pointers = kind === "candidates" ? index.candidates : [index.places];
    const records = [];
    let next = 0;
    async function worker() {
      while (next < pointers.length) {
        const pointer = pointers[next++];
        const data = await fetchJson(`data/${pointer.file}`, null, pointer.sha256);
        if (data.schema !== "search-records-v1" || data.release !== index.release || data.columns?.join(",") !== "id,name,sublabel,route,kind,aliases,countyId,office,districtId,townId,villageId,candidateId" || !Array.isArray(data.records) || data.records.length !== pointer.recordCount) throw new Error("搜尋索引不完整");
        records.push(...data.records.map(([id,label,sublabel,route,kind,aliases,countyId,office,districtId,townId,villageId,candidateId]) => ({id,label,sublabel,route,kind,aliases,countyId,office,districtId,townId,villageId,candidateId,release:data.release})));
      }
    }
    await Promise.all([worker(),worker()]);
    return records.filter(product.acceptSearch);
  })().catch(error => { globalSearchPromises.delete(kind); throw error; }));
  return globalSearchPromises.get(kind);
}

// Store presentation state per browser history entry; URLs remain shareable IDs.
let renderedObservationHash = null;
function saveObservationView() {
  if (renderedObservationHash !== window.location.hash) return;
  const board = observation.contestBoard, active = document.activeElement;
  const view = {
    councilMapLayer:observation.councilMapLayer||"competition",councilMapScope:councilMapScope(),
    detent: observation.bottomSheet?.getDetent(),
    tab: document.getElementById("observation-detail").classList.contains("hidden") ? "board" : "detail",
    boardScroll: document.getElementById("contest-board-container").scrollTop,
    detailScroll: observationDetail.scrollTop,
    sort: board?.councilSort, county: board?.selectedCounty, scope: board?.councilScope, includeIncomparable: board?.includeIncomparable, count: board?.visibleCount,
    zoom: observation.mapZoom, pan: [...observation.mapPan], search: observationSearch.value,
    focusId: active?.id, focusKey: active?.dataset?.key,
    cards: [...observationDetail.querySelectorAll(".card-header[aria-expanded='true']")].map(n => n.closest(".collapsible-card")?.id).filter(Boolean)
  };
  window.history.replaceState({...window.history.state, observationView: view}, "");
}
function navigateObservationHash(route) {
  const opener=document.activeElement;
  const fromList=!!opener?.closest?.(".contest-item");
  saveObservationView();
  if (window.location.hash !== route) window.history.pushState({}, "", route);
  const pending=handleHashRoute(), generation=routeGeneration;
  return Promise.resolve(pending).then(() => {
    if(fromList && generation===routeGeneration && (document.activeElement===opener || document.activeElement===document.body)) {
      const heading=observationDetail.querySelector(".hero-summary h2");
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    }
  });
}
function restoreObservationView(view) {
  renderedObservationHash = window.location.hash;
  if (!view) { saveObservationView(); return; }
  renderedObservationHash = null;
  observation.councilMapLayer=view.councilMapLayer||"competition";observation.councilMapScope=view.councilMapScope||"regional";
  const board = observation.contestBoard;
  if (board) { board.councilSort = view.sort || "competition"; board.selectedCounty = view.county || ""; board.councilScope = view.scope || "all"; board.includeIncomparable = !!view.includeIncomparable; board.visibleCount = view.count || 20; board.render(); }
  document.getElementById(view.tab === "board" ? "tab-contest-board" : "tab-inspector-detail")?.click();
  observation.bottomSheet?.setDetent(view.detent || "summary");
  observation.mapZoom = view.zoom || 1; observation.mapPan = view.pan || [0,0];
  observationSearch.value = view.search || ""; renderObservationNavigation();
  for (const id of view.cards || []) { const header = document.getElementById(id)?.querySelector(".card-header"); if (header?.getAttribute("aria-expanded") === "false") header.click(); }
  requestAnimationFrame(() => {
    document.getElementById("contest-board-container").scrollTop = view.boardScroll || 0;
    observationDetail.scrollTop = view.detailScroll || 0;
    const target = view.focusId ? document.getElementById(view.focusId) : view.focusKey ? document.querySelector(`[data-key="${CSS.escape(view.focusKey)}"]`) : null;
    target?.focus({preventScroll: true}); renderObservationMap();
    renderedObservationHash = window.location.hash; saveObservationView();
  });
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
        label: `${d.county} 第${d.district_no}選區`,
        sublabel: `${({regional:"區域議員", plain_indigenous:"平地原住民議員", plains_indigenous:"平地原住民議員", mountain_indigenous:"山地原住民議員"})[d.office_kind] || "議員選區"} · 應選 ${d.seats?.["2026"] ?? "—"} 席`,
        route: `#/council/${encodeURIComponent(d.county)}/${encodeURIComponent(d.office_kind)}/${encodeURIComponent(d.district_no)}`
      });
    });
  }
  return items;
}

// Hash 路由處理器
let routeGeneration = 0;
let councilMetricsPending = null;
async function ensureCouncilMetrics() {
  if (observation.councilMetrics) return observation.councilMetrics;
  if (!councilMetricsPending) {
    const pointer = state.manifest.observation_2026.council_metrics;
    councilMetricsPending = fetchJson(`data/${pointer.file}`, null, pointer.sha256)
      .then(data => { if (data.schema !== "council-metrics-v1" || !Array.isArray(data.districts)) throw Object.assign(new Error("資料版本不一致，請重新整理以取得新版本（議員 schema 不符）"), {code:"DATA_VERSION"}); observation.councilMetrics = data; return data; })
      .finally(() => { councilMetricsPending = null; });
  }
  return councilMetricsPending;
}
function routeCandidateIndex() {
  const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const pin = query.get("roster");
  const pointer = observation.manifest?.counties.find(c => c.name === observation.county);
  // A roster position is meaningful only for the exact immutable source shard.
  return pin && pin === pointer?.sha256 ? query.get("candidate") : null;
}
function showRouteError(error) {
  const host = document.getElementById("contest-board-container");
  if (!host) return;
  host.replaceChildren();
  host.appendChild(element("p", "observation-error", `資料未能載入：${error.message}`));
  const retry = element("button", "", "重試目前頁面");
  retry.type = "button";
  if (error.code === "DATA_VERSION") { retry.textContent="重新整理取得新版本"; retry.addEventListener("click",()=>window.location.reload()); }
  else retry.addEventListener("click", handleHashRoute);
  host.appendChild(retry);
  const home = element("button", "", "返回首頁"); home.type = "button";
  home.addEventListener("click", () => { navigateObservationHash("#/mayor"); }); host.appendChild(home);
  document.getElementById("tab-contest-board")?.click();
  observation.bottomSheet?.setDetent("expanded");
  host.firstElementChild?.setAttribute("role", "status");
}
async function handleHashRoute() {
  const generation = ++routeGeneration;
  const savedView = window.history?.state?.observationView;
  const desiredSurface = observation.nextSurface; observation.nextSurface = null;
  observation.gate.invalidate();
  observation.controller?.abort();
  const hash = window.location.hash || "#/mayor";
  let parsed;
  try { parsed = globalThis.ElectionNavigation.parse(hash); }
  catch(error) { showRouteError(new Error("網址編碼或層級無效；請返回首頁")); return; }
  const redirect = product.redirectRoute(parsed, globalThis.ElectionNavigation);
  if (redirect) { window.history.replaceState({}, "", redirect); return handleHashRoute(); }
  const primary = parsed.office;
  const countyName = parsed.canonical ? observation.geography?.counties.find(c => JSON.parse(c.key)[2] === parsed.county)?.label : parsed.county;
  if (parsed.county && !countyName) { showRouteError(new Error("找不到此縣市")); return; }
  if (countyName && state.manifest?.geography) loadTownGeography(countyName);
  observation.bottomSheet?.setDetent(desiredSurface || (parsed.county ? "expanded" : "summary"));
  const parts = [primary,countyName,parsed.scope,parsed.no];
  const query = new URLSearchParams();
  if (parsed.district) query.set("district",parsed.district);
  if (parsed.town) query.set("town",parsed.town);
  if (parsed.village) query.set("village",parsed.village);
  if (!["mayor", "council"].includes(primary) && !observation.manifest?.offices?.[primary]) {
    showRouteError(new Error("未知公職；請返回首頁")); return;
  }

  const tabMayor = document.getElementById("tab-mayor");
  const tabCouncil = document.getElementById("tab-council");

  if (primary === "council") {
    observation.activeOffice = "council";
    if (tabMayor) { tabMayor.classList.remove("active"); tabMayor.setAttribute("aria-pressed", "false"); }
    if (tabCouncil) { tabCouncil.classList.add("active"); tabCouncil.setAttribute("aria-pressed", "true"); }

    observation.contestBoard?.setMode("council");
    try {
      const data = await ensureCouncilMetrics();
      if (generation !== routeGeneration || window.location.hash !== hash) return;
      observation.contestBoard?.setCouncilData(data);
    } catch (error) {
      if (generation === routeGeneration) showRouteError(error);
      return;
    }

    const county = parts[1];
    const scope = parts[2];
    const distNo = parts[3];

    if (county) {
      await observationNavigate("county", county, true);
      if (generation !== routeGeneration || window.location.hash !== hash || observation.county !== county) return;
      if (distNo) {
        const metric = observation.councilMetrics?.districts.find(d => d.county === county && d.office_kind === scope && d.district_no === distNo);
        if (metric && observation.shard?.districts.some(d => d.id === metric.map_district_id)) {
          observationNavigate("district", metric.map_district_id, true);
          switchToDetailTab();
        } else { showRouteError(new Error("找不到此議員選區")); return; }
      }
    } else {
      observationNavigate("home", null, true);
      document.getElementById("tab-contest-board")?.click();
    }
  } else {
    if (!observation.mayorMetrics && primary === "mayor") {
      try {
        const pointer = state.manifest.observation_2026.mayor_metrics;
        const data = await fetchJson(`data/${pointer.file}`, null, pointer.sha256);
        if (generation !== routeGeneration) return;
        if (!Array.isArray(data.counties)) throw new Error("縣市長資料格式錯誤");
        observation.mayorMetrics = data;
        observation.contestBoard?.setMayorData(data);
      } catch(error) { if (generation === routeGeneration) showRouteError(error); return; }
    }
    // 正確保留其他公職 enum
    observation.activeOffice = primary;
    if (tabMayor) { if (primary === "mayor") tabMayor.classList.add("active"); else tabMayor.classList.remove("active"); tabMayor.setAttribute("aria-pressed", String(primary === "mayor")); }
    if (tabCouncil) { tabCouncil.classList.remove("active"); tabCouncil.setAttribute("aria-pressed", "false"); }

    if (observation.contestBoard) {
      observation.contestBoard.setMode("mayor");
    }

    const county = parts[1];
    if (county) {
      await observationNavigate("county", county, true);
    } else {
      observationNavigate("home", null, true);
      document.getElementById("tab-contest-board")?.click();
    }
  }
  if (generation !== routeGeneration) return;
  if (query.size && observation.shard) {
    let district = query.get("district"), town = query.get("town"), village = query.get("village");
    if (district) {
      if (!observation.shard.districts.some(d => d.id === district && d.office === observation.office)) { showRouteError(new Error("找不到此公職選區")); return; }
      observationNavigate("district", district, true);
    }
    if (town) {
      await loadTownGeography();
      if (generation !== routeGeneration) return;
      if (parsed.canonical) town = observation.geography?.townships(observation.county).find(t => JSON.parse(t.key)[2] === town)?.label;
      if (!town || !observation.geography?.townships(observation.county).some(t => t.label === town)) { showRouteError(new Error("找不到此鄉鎮市區")); return; }
      try { await ensureVillageGeography(observation.county, town); }
      catch(error) { if (generation === routeGeneration) showRouteError(error); return; }
      if (generation !== routeGeneration) return;
      observation.geography.villages = loadedVillages;
      observation.mapError = null;
      if (parsed.canonical && village) village = loadedVillages(observation.county,town).find(v => JSON.parse(v.key)[2] === village)?.label;
      if (parsed.village && !village) { showRouteError(new Error("找不到此村里代碼")); return; }
      observationNavigate("township", town, true);
    }
    if (village) {
      if (!town || !observation.geography?.villages(observation.county,town).some(v => v.label === village)) { showRouteError(new Error("找不到此村里")); return; }
      observationNavigate("village", village, true);
    }
  }
  if (observation.county && observation.shard && !parsed.canonical) {
    const code = (regions,label) => { const r=regions?.find(r=>r.label===label); return r ? JSON.parse(r.key)[2] : null; };
    const canonical = globalThis.ElectionNavigation.serialize({office:primary,county:code(observation.geography?.counties,observation.county),district:observation.district,town:code(observation.geography?.townships(observation.county),observation.township),village:code(observation.geography?.villages(observation.county,observation.township),observation.village)});
    window.history.replaceState(window.history.state, "", canonical);
  }
  const candidate = routeCandidateIndex();
  if (candidate === null && new URLSearchParams(hash.split("?")[1] || "").has("candidate")) {
    observationDetail.prepend(element("p", "observation-note", "候選人連結的名冊版本已變動或未標版本；請重新搜尋姓名。已開啟原選區，不指定候選人。"));
  }
  if (candidate !== null && observation.district) {
    const card = document.getElementById("card-roster");
    const header = card?.querySelector(".card-header");
    if (header?.getAttribute("aria-expanded") !== "true") header?.click();
    const row = [...(card?.querySelectorAll("[data-candidate]") || [])].find(row=>row.dataset.candidate===candidate);
    if (row) { row.classList.add("search-selected-candidate"); row.focus({preventScroll:true}); row.scrollIntoView({block:"center"}); }
  }
  observation.bottomSheet?.setDetent(desiredSurface || (observation.county ? "expanded" : "summary"));
  if (typeof restoreObservationView === "function") restoreObservationView(savedView);
  renderObservationMap();
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

const observationIslandNames = ["澎湖縣", "金門縣", "連江縣"];

function releaseObservationMapPointers() {
  for (const pointerId of observation.mapPointers.keys()) {
    if (observationMapCanvas?.hasPointerCapture?.(pointerId)) observationMapCanvas.releasePointerCapture(pointerId);
  }
  observation.mapPointers.clear();
  observation.mapGesture = null;
}

function observationMapBackAction() {
  if (observation.village) {
    observationNavigate("township", observation.township);
  } else if (observation.township) {
    if (observation.district) observationNavigate("district", observation.district);
    else observationNavigate("office", observation.office);
  } else if (observation.district) {
    observationNavigate("office", observation.office);
  } else if (observation.county) {
    observationNavigate("home");
  }
}

function observationMapAction(region) {
  if (!observation.mapReady) return;
  const target = observationMapTarget(region);
  if (target && !(target.level === "county" && observation.county)) { observation.nextSurface = "summary"; observationNavigate(target.level, target.value); }
}
function updateMobileSummary() {
  const title = document.getElementById("mobile-summary-title"), value = document.getElementById("mobile-summary-value"), open = document.getElementById("mobile-summary-open");
  if (!title || !value) return;
  const district = observation.shard?.districts.find(d=>d.id===observation.district);
  const metric = observation.councilMetrics?.districts.find(d=>d.map_district_id===observation.district);
  title.textContent = observation.village || observation.township || district?.name || observation.county || (observation.activeOffice === "council" ? "全國議員選區" : "全國縣市長");
  value.textContent = district ? (metric?.seats?.["2026"] ? `2026：${district.candidates.length} 人選 ${metric.seats["2026"]} 席` : `2026：${district.candidates.length} 人參選`) : "點選地圖或搜尋地區，再查看名冊與歷史";
  open.textContent = observation.county ? "查看詳情" : "查看清單";
}
const councilMapCache=new Map(), councilMapPending=new Map(), councilMapErrors=new Map();
let councilMapIndexPromise=null;
function councilMapScope(){return observation.councilMapScope || "regional";}
function loadCouncilMapCounty(county){
  if(councilMapCache.has(county)||councilMapPending.has(county)||councilMapErrors.has(county))return;
  const job=(async()=>{
    const pointer=state.manifest.council_map_layers;
    if(!pointer)throw new Error("缺少議員地圖索引");
    if(!councilMapIndexPromise)councilMapIndexPromise=fetchJson(`data/${pointer.file}`,null,pointer.sha256).catch(e=>{councilMapIndexPromise=null;throw e;});
    const index=await councilMapIndexPromise;if(index.schema!=="council-map-index-v1")throw new Error("地圖索引版本不符");
    const part=index.counties[county];if(!part)throw new Error("此縣市沒有議員地方票差資料");
    const data=await fetchJson(`data/${part.file}`,null,part.sha256);if(data.schema!=="council-map-county-v1"||data.county!==county)throw new Error("地圖資料範圍不符");
    councilMapCache.set(county,data);while(councilMapCache.size>3){const old=[...councilMapCache.keys()].find(c=>c!==observation.county);councilMapCache.delete(old);}
  })().catch(e=>councilMapErrors.set(county,e.message)).finally(()=>{councilMapPending.delete(county);if(observation.activeOffice==="council"&&observation.county===county)renderObservationMap();});
  councilMapPending.set(county,job);
}
function councilLayerRecord(region){
  const scope=councilMapScope(),layer=observation.councilMapLayer||"competition";
  const kind=d=>(d.office_kind==="plains_indigenous"?"plain_indigenous":d.office_kind);
  const metrics=(observation.councilMetrics?.districts||[]).filter(d=>d.county===region.county&&kind(d)===scope);
  if(layer==="competition") {
    let matches=metrics;
    if(region.level!=="county") {
      const town=region.township||region.label;
      matches=metrics.filter(d=>{
        const location=observation.manifest?.councilor_locations.find(l=>l.district_id===d.map_district_id);
        if(location?.townships.includes(town))return true;
        // Only parse an explicit single-town village list; multi-town prose remains unassigned.
        if(region.level==="village" && location?.partial_townships?.length===1 && location.partial_townships[0]===town && location.scope_text.startsWith(town)) {
          const names=location.scope_text.slice(town.length).split(/[、，,]/).map(n=>n.trim());return names.includes(region.label);
        }
        return false;
      });
      if(matches.length!==1)return {reason:"多選區或邊界未唯一核對，維持灰色定位"};
    }
    if(!matches.length||matches.some(d=>!Number.isFinite(d.cands_2026)||!(d.seats?.[2026]>0)))return null;
    const candidates=matches.reduce((n,d)=>n+d.cands_2026,0),seats=matches.reduce((n,d)=>n+d.seats[2026],0);
    return {value:candidates/seats,label:`2026 ${candidates} 人／${seats} 席＝${(candidates/seats).toFixed(2)} 人／席（${region.level==="county"?"全縣市此類別加總":`所屬選區第 ${matches[0].district_no} 區整體，非村里席次`}）`};
  }
  if(region.level==="county")return {reason:"縣市有多個議員選區，不合成單一末席票差"};
  const town=region.township||region.label,village=region.level==="village"?region.label:null;
  const rows=councilMapCache.get(region.county)?.areas[JSON.stringify([town,village,scope])];
  if(!rows||rows.length!==1)return {reason:rows?.length>1?"涵蓋多個歷史選區，不混合末席配對":"尚無可用地方票差"};
  const r=rows[0];if(r.status!=="ok")return {reason:`未著色：${({uncontested:"同額／無落選者",quota_only:"僅婦保席次",ambiguous_tie:"末席配對同票未能唯一判定",incomplete:"來源範圍不完整",zero_denominator:"有效票為零",missing_pair:"地方缺配對票數"})[r.status]||"來源不足"}`};
  return {value:r.pct,label:`2022 ${r.district}：${r.winner}－${r.loser}，本地 ${r.numerator}／${r.denominator} 有效票＝${r.pct.toFixed(2)}%；${r.womenQuota?"常態席次口徑，另有婦保；":""}負值表示落選頭在此地票數較多`};
}
function renderCouncilLayerControls(legend){
  let controls=document.getElementById("council-layer-controls");
  if(!controls){controls=element("div","council-layer-controls");controls.id="council-layer-controls";(document.getElementById("map-dock-layers")||legend.parentElement).appendChild(controls);
    for(const [key,label,options] of [["councilMapLayer","議員地圖指標",[["margin","2022 末席配對地方票差"],["competition","2026 候選人／席次"]]],["councilMapScope","地圖議員類別",[["regional","區域議員"],["plain_indigenous","平地原住民議員"],["mountain_indigenous","山地原住民議員"]]]]){
      const select=document.createElement("select");select.id=key;select.setAttribute("aria-label",label);for(const [v,l] of options){const o=element("option","",l);o.value=v;select.appendChild(o);}select.addEventListener("change",()=>{observation[key]=select.value;renderObservationMap();saveObservationView();});controls.appendChild(select);
    }
  }
  controls.hidden=observation.activeOffice!=="council";
  if(!controls.hidden){document.getElementById("councilMapLayer").value=observation.councilMapLayer||"competition";document.getElementById("councilMapScope").value=councilMapScope();}
}
function renderObservationMap() {
  if(observation.activeOffice==="council" && observation.district && observation.layerDistrict!==observation.district){
    observation.layerDistrict=observation.district;
    const metric=observation.councilMetrics?.districts.find(d=>d.map_district_id===observation.district);
    if(metric)observation.councilMapScope=metric.office_kind==="plains_indigenous"?"plain_indigenous":metric.office_kind;
  }
  updateMobileSummary();
  const dockActive=document.getElementById("map-dock-active");if(dockActive)dockActive.textContent=observation.activeOffice==="council"?(observation.councilMapLayer==="competition"?"2026 人數／席次":"2022 配對票差"):observation.activeOffice==="mayor"?"2022 縣市長票差":"行政區定位";
  const layerGroup=document.getElementById("map-dock-layers");if(layerGroup)layerGroup.hidden=observation.activeOffice!=="council";
  const legend = document.getElementById("map-legend-bar");
  if (legend) {
    renderCouncilLayerControls(legend);
    const council = observation.activeOffice === "council";
    legend.replaceChildren();
    if(council){
      const competition=observation.councilMapLayer==="competition";
      legend.appendChild(element("strong","",competition?"2026 候選人／席次（人／席）":"2022 議員末席配對地方票差占有效票"));
      const colors=state.mapTheme==="dark"?["#fbbf24","#d97706","#9a3412","#4c315b"]:["#9a3412","#d97706","#fcd34d","#e9dcf0"];
      const bins=competition?[["≤1",colors[3]],[">1–1.5",colors[2]],[">1.5–2",colors[1]],[">2",colors[0]]]:[["<0（地方逆轉）",state.mapTheme==="dark"?"#a21caf":"#d946ef"],["0–1%",colors[0]],[">1–3%",colors[1]],[">3–6%",colors[2]],[">6%",colors[3]]];
      for(const [label,color] of [...bins,["灰色：未提供／無法唯一對照",state.mapTheme==="dark"?"#737373":"#d4d4d4"]]){const item=element("span","swing-legend-item"),swatch=element("span","swing-indicator");swatch.style.background=color;item.append(swatch,document.createTextNode(label));legend.appendChild(item);}
      legend.appendChild(element("small","",competition?"縣市顯示加總比；鄉鎮／村里顯示所屬選區整體比例。":"以該選區最後一位常態當選者與落選頭計算票差，供基層競爭強度參考。"));
      if(!competition&&observation.county){loadCouncilMapCounty(observation.county);if(councilMapErrors.has(observation.county)){const retry=element("button","detail-card-action","票差載入失敗，重試");retry.addEventListener("click",()=>{councilMapErrors.delete(observation.county);renderObservationMap();});legend.appendChild(retry);}else if(!councilMapCache.has(observation.county))legend.appendChild(element("span","","票差載入中…"));}
    } else if(observation.activeOffice!=="mayor")legend.appendChild(element("span","","灰色僅供行政區定位；此公職未提供比較指標"));
    else {legend.appendChild(element("strong","","地圖：2022 縣市長票差占選舉人數"));["≤1%",">1–3%",">3–6%",">6%","無可比較資料"].forEach((label,i)=>{const item=element("span","swing-legend-item");item.append(element("span",`swing-indicator legend-tone-${i===4?"stripe":4-i}`),document.createTextNode(label));legend.appendChild(item);});}
  }

  const explanation=document.getElementById('map-metric-explanation');
  if(explanation)explanation.textContent=legend?.querySelector('small')?.textContent || (observation.activeOffice==='mayor'?'2022 縣市長票差占選舉人數比例':'灰色代表僅供行政區定位');

  let readout=document.getElementById("council-layer-summary");
  if(observation.activeOffice==="council" && observation.county){
    if(!readout){readout=element("p","observation-note");readout.id="council-layer-summary";readout.setAttribute("role","status");observationDetail.querySelector(".hero-summary")?.appendChild(readout);}
    let record=councilLayerRecord({county:observation.county,level:observation.village?"village":observation.township?"township":"county",township:observation.township,label:observation.village||observation.township||observation.county});
    if(observation.district&&!observation.township){const d=observation.councilMetrics?.districts.find(d=>d.map_district_id===observation.district);if(d && (d.office_kind==="plains_indigenous"?"plain_indigenous":d.office_kind)===councilMapScope()){const competition=observation.councilMapLayer==="competition",m=d.margin?.[2022];record={label:competition?`2026 本選區 ${d.cands_2026} 人／${d.seats[2026]} 席＝${(d.cands_2026/d.seats[2026]).toFixed(2)} 人／席`:`2022 本選區末席票差：${m?.pct==null?"無法計算":m.pct+"%"}（${m?.last_win||"—"}－${m?.first_lose||"—"}）`};}}
    readout.textContent=`目前圖層：${record?.label||record?.reason||"資料未載入／無可用指標"}`;
    let toggle=document.getElementById("council-layer-toggle");if(!toggle){toggle=element("button","detail-card-action");toggle.id="council-layer-toggle";toggle.type="button";toggle.addEventListener("click",()=>{observation.councilMapLayer=observation.councilMapLayer==="competition"?"margin":"competition";renderObservationMap();saveObservationView();});readout.after(toggle);}
    toggle.textContent=observation.councilMapLayer==="competition"?"切換為 2022 末席配對地方票差":"切換為 2026 候選人／席次";
  }else readout?.remove();
  const {county, office, township, geography, shard, manifest} = observation;
  const key = JSON.stringify([county, office, township]);
  if (key !== observation.mapKey) {
    observation.mapKey = key; observation.mapZoom = 1; observation.mapPan = [0,0]; observation.mapFull = false; observation.mapHover = null;
    releaseObservationMapPointers();
    if (observationMapHover) observationMapHover.textContent = "";

  }
  observation.mapReady = Boolean(geography && manifest && (!county || shard));
  if (observationMapCanvas) {
    observationMapCanvas.setAttribute("aria-disabled", String(!observation.mapReady));
    observationMapCanvas.tabIndex = observation.mapReady ? 0 : -1;
  }
  for (const id of ["zoom-in", "zoom-out", "reset", "pan-up", "pan-left", "pan-center", "pan-right", "pan-down"]) {
    const btn = document.getElementById(`observation-map-${id}`);
    if (btn) btn.disabled = !observation.mapReady;
  }
  if (observationMapBack) observationMapBack.disabled = !county;
  if (observationOffice) {
    clear(observationOffice);
    if (shard) {
      Object.entries(manifest.offices).filter(([id])=>product.allowsOffice(id) && shard.districts.some(d=>d.office===id)).forEach(([id,label])=>{
        const option=element("option","",label); option.value=id; observationOffice.appendChild(option);
      });
      observationOffice.value=office || "";
    } else { const option=element("option","",county ? "名冊載入中…" : "先在地圖選擇縣市"); option.value=""; observationOffice.appendChild(option); }
    observationOffice.disabled=!shard;
  }
  const listTitle = document.getElementById("observation-list-title");
  if (listTitle) {
    listTitle.textContent = !county ? "以名稱尋找縣市" : !office ? "以名稱選擇公職" : township || !shard?.districts.some(d=>d.office===office && d.township) ? "選區清單與名稱搜尋" : "以名稱尋找鄉鎮市區";
  }
  if (observationIslands) clear(observationIslands);
  observation.mapRegions=[];
  if (!observation.mapReady) {
    if (observationMapStatus) {
      observationMapStatus.textContent=observation.mapError || (county && observation.countyError) || (county ? "正在載入候選人名冊…" : "正在載入行政區圖資…");
    }
    if (observationMapFull) observationMapFull.hidden=true;
    drawObservationMap(); return;
  }
  if (!county) {
    observation.mapRegions=geography.counties.filter(r=>manifest.counties.some(c=>c.name===r.county));
    const generation=observation.gate.generation;
    if (observationIslands) {
      observationIslandNames.forEach(name=>{
        const region=observation.mapRegions.find(r=>r.county===name);
        if (!region) return;
        const button=element("button","observation-island"); button.type="button"; button.setAttribute("aria-label",`在地圖開啟${name}`);
        const mini=element("canvas"); mini.width=120; mini.height=66; mini.setAttribute("aria-hidden","true");
        button.append(mini,element("span","",name));
        button.addEventListener("click",()=>{if(observation.gate.isCurrent(generation) && !observation.county) observationMapAction(region);});
        observationIslands.appendChild(button);
        const projection=observationProjection(core.labelPlacement(region.polygons,region.hitPolygons).bbox,120,66,1,[0,0],5);
        paintObservationRegion(mini.getContext("2d"),region,projection,core.observationRegionFill(region,null,{theme:state.mapTheme,mode:observation.activeOffice||"mayor",mayorMetrics:observation.mayorMetrics,...(observation.activeOffice==="council"?{councilLayer:observation.councilMapLayer||"competition",councilLayerRecord:councilLayerRecord(region)}:{})}).fill,false,null,state.mapTheme,{zoom:1,viewportWidth:mini.width,viewportHeight:mini.height});
      });
    }
    observation.mapBounds=[119.7,21.8,122.15,25.45];
    if (observationMapStatus) observationMapStatus.textContent="2025 行政區定位圖 · 點選縣市；離島另設入口";
  } else {
    const districts=shard.districts.filter(d=>d.office===office);
    const isMayorOffice = ["metro_mayor", "county_mayor"].includes(office);
    const isCouncilorOffice = ["metro_councilor", "county_councilor"].includes(office);
    if (township && (office==="village_chief" || isMayorOffice || isCouncilorOffice)) observation.mapRegions=geography.villages(county,township);
    else if (township) observation.mapRegions=geography.townships(county).filter(r=>r.label===township);
    else if (districts.some(d=>d.township) || isMayorOffice || (manifest.councilor_locations || []).some(l=>l.county===county && l.office===office && l.scope==="regional" && (l.townships.length || l.partial_townships?.length))) observation.mapRegions=geography.townships(county);
    else observation.mapRegions=geography.counties.filter(r=>r.county===county);
    if (observation.mapRegions.length) {
      const bounds=core.deriveBounds(observation.mapRegions);
      observation.mapBounds=observation.mapFull ? bounds.fullBounds : bounds.primaryBounds;
      if (observationMapFull) {
        observationMapFull.hidden=core.sameBounds(bounds.fullBounds,bounds.primaryBounds);
        observationMapFull.textContent=observation.mapFull ? "主要區域" : "含遠方島嶼";
      }
    }
    if (observationMapStatus) {
      if (office==="village_chief") observationMapStatus.textContent=township ? `${county} ${township} · 點村里查看名冊；灰色表示未能唯一對應` : `${county} · 點鄉鎮市區，繼續找到村里`;
      else if (isMayorOffice) observationMapStatus.textContent=township ? `${county} ${township} · 檢閱村里選情；黃邊為搖擺選區，紅黃相間為 2022 催票率差距 3% 內激戰區` : `${county} · 點鄉鎮市區檢閱村里圖資與搖擺分析`;
      else if ((manifest.councilor_locations || []).some(l=>l.county===county && l.office===office && l.scope==="regional" && (l.townships.length || l.partial_townships?.length))) {
        observationMapStatus.textContent = township
          ? `${county} ${township} · 檢閱村里選情與歷史資料；點選村里查看詳情`
          : (observation.district
            ? `${observation.shard?.districts.find(d=>d.id===observation.district)?.name || "議員選區"} · 點選涵蓋鄉鎮市區進入村里圖資`
            : "點行政區查看對應議員名冊；部分村里會先列出相關選區，原住民選區另列。");
      }
      else if (["metro_councilor","county_councilor","township_representative","indigenous_district_representative"].includes(office)) observationMapStatus.textContent=township || !districts.some(d=>d.township) ? "此公職的 2026 選區邊界尚未核實，請由選區清單選擇；地圖僅定位。" : "先點鄉鎮市區定位，再由清單選代表選區。";
      else observationMapStatus.textContent=township || isMayorOffice ? "已開啟此地區名冊 · 切換觀察公職，繼續探索其他選區" : "點鄉鎮市區查看名冊";
    }
  }
  if (county && office === "village_chief") {
    const linked = new Set(observation.mapRegions.map(r=>core.observationMapTarget(r,office,shard.districts)).filter(Boolean).map(t=>t.value));
    const missing = township
      ? shard.districts.filter(d=>d.office===office && d.township===township && !linked.has(d.id)).length
      : new Set(shard.districts.filter(d=>d.office===office && !linked.has(d.township)).map(d=>d.township)).size;
    if (missing) {
      if (observationMapStatus) observationMapStatus.textContent += `；${missing} 個${township ? "選區" : "鄉鎮市區"}無法唯一定位，請由名稱清單查閱。`;
    }
  }
  if (observation.activeOffice === "mayor" && !county && observation.nationalSwingReady) {
    const countyRecords = [...observation.nationalSwing.values()].flatMap(scopes => [...scopes.counties.values()]);
    if (observationMapStatus) observationMapStatus.textContent += ` · 黃邊標出本級搖擺或含搖擺村里的縣市（${countyRecords.filter(record => record.displayStatus).length} 個）`;
  } else if (observation.activeOffice === "mayor" && county && observation.swingData?.scopes) {
    const scopes = observation.swingData.scopes;
    if (township) {
      const record = scopes.townships.get(`${county}／${township}`);
      if (record && observationMapStatus) observationMapStatus.textContent += ` · ${swingDisplayLabel(record,"鄉鎮市區")} · 含激戰村里 ${record.closeSwingVillageCount} 個`;
    } else {
      const records = [...scopes.townships.values()];
      if (observationMapStatus) observationMapStatus.textContent += ` · 搖擺鄉鎮 ${records.filter(record => record.isSwing).length} 個；含搖擺村里的鄉鎮 ${records.filter(record => record.swingVillageCount).length} 個`;
    }
    if (["metro_councilor", "county_councilor"].includes(office)) {
      const districts = [...scopes.councilDistricts.values()];
      const matching = township ? districts.filter(record => record.townships.includes(township)
        || observationDistrictLocation({id:record.districtId,county:record.county,office:record.office})?.partial_townships?.includes(township)) : districts;
      const marked = matching.filter(record => record.scopeComplete && record.displayStatus);
      const direct = matching.filter(record => record.scopeComplete && record.comparable && record.isSwing).length;
      const nested = matching.filter(record => record.scopeComplete && record.swingVillageCount > 0).length;
      const incomplete = matching.filter(record => !record.scopeComplete).length;
      if (observationMapStatus) {
        observationMapStatus.textContent += ` · ${marked.length} 個搖擺議員選區（本級 ${direct} 區、含搖擺村里 ${nested} 區${incomplete ? `；${incomplete} 區範圍不完整` : ""}）`;
        observationMapStatus.textContent += "；圖上仍以 2025 行政區定位，未畫議員選區界線";
      }
    }
  }
  if (!county && observationMapFull) observationMapFull.hidden=true;
  if (observationMapCanvas) observationMapCanvas.setAttribute("aria-label",`${county || "全國"}${township ? "／"+township : ""}，2025 行政區定位地圖`);
  requestAnimationFrame(drawObservationMap);
}
function observationProjection(bounds,width,height,zoom=1,pan=[0,0],padding=28) {
  const thumbnail = padding === 5;
  const mobile = !thumbnail && window.innerWidth < 1024;
  const panel = document.getElementById('observation-inspector');
  const landscape = mobile && innerHeight <= 500 && innerWidth > innerHeight;
  const occupied = mobile && !landscape ? Math.min(panel?.dataset.detent === 'summary' ? panel.getBoundingClientRect().height : 150, height * .45) : 0;
  const padX = thumbnail ? padding : 18;
  const padY = thumbnail ? padding : occupied / 2 + 18;
  const ox = 0, oy = -occupied / 2;
  const cosine=Math.cos((bounds[1]+bounds[3])*Math.PI/360);
  const scale=Math.min(Math.max(width-padX*2,12)/Math.max((bounds[2]-bounds[0])*cosine,1e-6),Math.max(height-padY*2,12)/Math.max(bounds[3]-bounds[1],1e-6))*zoom;
  const cx=(bounds[0]+bounds[2])/2,cy=(bounds[1]+bounds[3])/2;
  const originX = width/2 + ox + pan[0];
  const originY = height/2 + oy + pan[1];
  return {
    project: point=>[originX+(point[0]-cx)*cosine*scale,originY-(point[1]-cy)*scale],
    invert: point=>[cx+(point[0]-originX)/(cosine*scale),cy-(point[1]-originY)/scale],
    opticalOrigin: [originX, originY],
  };
}
function observationMapZoomAt(factor,point) {
  if (!observation.mapReady || !Number.isFinite(factor) || factor <= 0) return;
  const rect=observationMapCanvas.getBoundingClientRect();
  const local=point || [rect.width/2,rect.height/2];
  const current=observation.mapProjection || observationProjection(observation.mapBounds,rect.width,rect.height,observation.mapZoom,observation.mapPan);
  const anchor=current.invert(local);
  observation.mapZoom=Math.max(1,Math.min(6,observation.mapZoom*factor));
  const next=observationProjection(observation.mapBounds,rect.width,rect.height,observation.mapZoom,observation.mapPan);
  const projected=next.project(anchor);
  observation.mapPan=[observation.mapPan[0]+local[0]-projected[0],observation.mapPan[1]+local[1]-projected[1]];
  drawObservationMap();
}
function observationMapPanBy(dx,dy) {
  if (!observation.mapReady) return;
  observation.mapPan=[observation.mapPan[0]+dx,observation.mapPan[1]+dy];
  drawObservationMap();
}
function observationSwingRecord(region) {
  if (!region || observation.activeOffice !== "mayor") return null;
  if (region.level === "county") return observation.nationalSwing.get(region.county)?.counties.get(region.county) || null;
  if (region.level === "township") return observation.swingData?.scopes?.townships.get(`${region.county}／${region.township || region.label}`) || null;
  if (region.level === "village") return observation.swingAnalysis?.get(`${region.county}／${region.township}／${region.label}`) || null;
  return null;
}

function observationSwingStatusText(record, level) {
  const noun = level === "county" ? "縣市" : level === "township" ? "鄉鎮市區" : "村里";
  if (!record) return "";
  const parts = [];
  if (record.isSwing) parts.push(`本級更迭 ${record.partyChanges} 次`);
  if (record.swingVillageCount) parts.push(`含搖擺村里 ${record.swingVillageCount} 個`);
  if (record.closeSwingVillageCount) parts.push(`含激戰村里 ${record.closeSwingVillageCount} 個`);
  if (!parts.length && record.isComplete) parts.push("本級未達搖擺條件");
  if (record.status === "close_swing") parts.push(`本級 2022 差距 ${record.marginPct.toFixed(2)}%`);
  else if (record.status === "swing") parts.push(`${noun}本級搖擺`);
  return parts.join(" · ");
}

function paintObservationRegion(context,region,projector,fill,active,swingStatus=null,theme="light",options={}) {
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
  } else {
    context.fillStyle = fill;
    context.fill("evenodd");
  }
  context.lineJoin="round";

  const boundary = core.mapBoundaryStyle(region.level || "second", active, swingStatus, theme, options);
  if (boundary.striped) {
    context.strokeStyle = boundary.outerColor;
    context.lineWidth = boundary.outerWidth;
    context.setLineDash([]);
    context.stroke();
    context.strokeStyle = boundary.stripeColor || "#facc15";
    context.lineWidth = boundary.outerWidth;
    context.setLineDash(boundary.dash || [6, 6]);
    context.stroke();
    context.setLineDash([]);
  } else {
    context.strokeStyle = boundary.outerColor;
    context.lineWidth = boundary.outerWidth;
    context.setLineDash(boundary.dash || []);
    context.stroke();
    context.setLineDash([]);
  }
  if (boundary.interaction) {
    context.strokeStyle = boundary.innerColor;
    context.lineWidth = boundary.innerWidth;
    context.stroke();
  }
}
function drawObservationMap() {
  if (observationPanel.classList.contains("hidden")) return;
  const canvas=observationMapCanvas, rect=canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dark=state.mapTheme==="dark";
  const ratio=window.devicePixelRatio || 1; canvas.width=Math.round(rect.width*ratio); canvas.height=Math.round(rect.height*ratio);
  const context=canvas.getContext("2d"); context.setTransform(ratio,0,0,ratio,0,0);
  if (typeof context.createRadialGradient === "function") {
    const bgGrad = context.createRadialGradient(rect.width * 0.38, rect.height * 0.48, 40, rect.width * 0.5, rect.height * 0.5, Math.max(rect.width, rect.height) * 0.85);
    if (dark) {
      bgGrad.addColorStop(0, "#15263d");
      bgGrad.addColorStop(0.55, "#0d1624");
      bgGrad.addColorStop(1, "#070b12");
    } else {
      bgGrad.addColorStop(0, "#f2f8fa");
      bgGrad.addColorStop(0.6, "#e3eef2");
      bgGrad.addColorStop(1, "#d5e3e9");
    }
    context.fillStyle = bgGrad;
    context.fillRect(0, 0, rect.width, rect.height);
    const bloom1 = context.createRadialGradient(rect.width * 0.78, rect.height * 0.28, 20, rect.width * 0.78, rect.height * 0.28, Math.min(rect.width, rect.height) * 0.48);
    bloom1.addColorStop(0, dark ? "rgba(56, 189, 248, 0.16)" : "rgba(2, 132, 199, 0.11)");
    bloom1.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = bloom1;
    context.fillRect(0, 0, rect.width, rect.height);
    const bloom2 = context.createRadialGradient(rect.width * 0.22, rect.height * 0.72, 20, rect.width * 0.22, rect.height * 0.72, Math.min(rect.width, rect.height) * 0.45);
    bloom2.addColorStop(0, dark ? "rgba(168, 85, 247, 0.13)" : "rgba(124, 58, 237, 0.08)");
    bloom2.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = bloom2;
    context.fillRect(0, 0, rect.width, rect.height);
    context.beginPath();
    const gridStep = 56;
    for (let x = gridStep; x < rect.width; x += gridStep) {
      context.moveTo(x, 0);
      context.lineTo(x, rect.height);
    }
    for (let y = gridStep; y < rect.height; y += gridStep) {
      context.moveTo(0, y);
      context.lineTo(rect.width, y);
    }
    context.strokeStyle = dark ? "rgba(148, 163, 184, 0.055)" : "rgba(15, 23, 42, 0.045)";
    context.lineWidth = 1;
    context.stroke();
  } else {
    context.fillStyle=dark?"#101820":"#edf4f2"; context.fillRect(0,0,rect.width,rect.height);
  }
  if (!observation.mapReady || !observation.mapRegions.length) {
    context.font="14px system-ui";context.textAlign="center";context.fillStyle=dark?"#c1ccd8":"#526176";context.fillText(observation.mapError || observation.countyError || "資料載入後顯示地圖",rect.width/2,rect.height/2);return;
  }
  const projection=observationProjection(observation.mapBounds,rect.width,rect.height,observation.mapZoom,observation.mapPan);
  observation.mapProjection=projection;
  const regions=observation.mapRegions.filter(r=>observation.county || !observationIslandNames.includes(r.county));
  const swingMap = observation.activeOffice === "mayor" ? observation.swingAnalysis : null;
  const interactionPriority=region=>{
    const target=observationMapTarget(region);
    return observation.mapHover===region.key ? 2 :
      (target?.level==='district'&&target.value===observation.district)||(target?.level==='village'&&target.value===observation.village) ? 1 : 0;
  };
  regions.sort((a,b)=>interactionPriority(a)-interactionPriority(b));
  regions.forEach(region=>{
    const target=observationMapTarget(region);
    const selected=(target?.level==="district" && target.value===observation.district)
      || (target?.level==="village" && target.value===observation.village);
    const hover=observation.mapHover===region.key;
    const swingData = observationSwingRecord(region) || (region.level === "village" && swingMap ? swingMap.get(`${region.county}／${region.township}／${region.label}`) : null);
    let effectiveSwingStatus = null;
    if (observation.office !== "village_chief") {
      const statusKey = swingData?.quadrantStatus || swingData?.status;
      if (statusKey && (observation.activeFilters.has(statusKey) || (statusKey === "swing" && observation.activeFilters.has("swing_only")))) {
        effectiveSwingStatus = statusKey;
      } else if (observation.activeFilters.has("bellwether") && swingData?.isBellwether) {
        effectiveSwingStatus = "bellwether";
      }
    }
    const fillResult = typeof core.observationRegionFill === "function" ? core.observationRegionFill(region, swingData, {
      theme: state.mapTheme,
      selected: Boolean(selected),
      hover: Boolean(hover),
      mode: observation.activeOffice || "mayor",
      mayorMetrics: observation.mayorMetrics,
      councilMetrics: observation.councilMetrics,
      councilorLocations: observation.manifest?.councilor_locations,
      ...(observation.activeOffice==="council"?{councilLayer:observation.councilMapLayer||"competition",councilLayerRecord:councilLayerRecord(region)}:{}),
      isTargetable: Boolean(target),
    }) : null;
    const fill = fillResult ? fillResult.fill : (selected || hover ? (dark ? "#596777" : "#eacb88")
      : target || region.level === "county" ? (dark ? "#384856" : "#b4d1ce")
        : (dark ? "#293541" : "#dce3e2"));
    paintObservationRegion(context,region,projection,fill,selected || hover,effectiveSwingStatus,state.mapTheme,{ zoom: observation.mapZoom, viewportWidth: rect.width, viewportHeight: rect.height, featurePixels: Math.min(Math.abs(projection.project([region.bbox[0],region.bbox[1]])[0]-projection.project([region.bbox[2],region.bbox[3]])[0]),Math.abs(projection.project([region.bbox[0],region.bbox[1]])[1]-projection.project([region.bbox[2],region.bbox[3]])[1])) });
  });
  context.font="600 12px system-ui";context.textAlign="center";context.textBaseline="middle";
  const candidates=regions.map(region=>{
    const place=core.labelPlacement(region.polygons,region.hitPolygons),center=projection.project(place.anchor),w=context.measureText(region.label).width+8;
    const extent=projection.project([place.bbox[2],place.bbox[3]]),start=projection.project([place.bbox[0],place.bbox[1]]);
    return {region,center,fits:Math.abs(extent[0]-start[0])>=w && Math.abs(extent[1]-start[1])>=20,priority:observation.mapHover===region.key ? Infinity : place.area,box:[center[0]-w/2,center[1]-9,center[0]+w/2,center[1]+9]};
  }).filter(c=>c.fits && c.center[0]>15 && c.center[0]<rect.width-15 && c.center[1]>15 && c.center[1]<rect.height-15);
  core.selectNonOverlappingLabels(candidates).forEach(({region,center})=>{context.strokeStyle=dark?"#111820":"#fff";context.lineWidth=1.8;context.strokeText(region.label,...center);context.fillStyle=dark?"#f1f5f9":"#203f43";context.fillText(region.label,...center);});
  const zoomInBtn = document.getElementById("observation-map-zoom-in");
  if (zoomInBtn) zoomInBtn.disabled = observation.mapZoom >= 6;
  const zoomOutBtn = document.getElementById("observation-map-zoom-out");
  if (zoomOutBtn) zoomOutBtn.disabled = observation.mapZoom <= 1;
  if (!performance.getEntriesByName("observation-first-map").length && document.querySelector(".contest-item")) performance.mark("observation-first-map");
}
function observationRegionAt(event) {
  if (!observation.mapReady || !observation.mapProjection) return null;
  const rect=observationMapCanvas.getBoundingClientRect(),point=observation.mapProjection.invert([event.clientX-rect.left,event.clientY-rect.top]);
  // Some generalized county boundaries overlap slightly around dense metro
  // areas. Prefer the smallest containing region so Taipei City remains
  // clickable inside the broader New Taipei geometry.
  return observation.mapRegions
    .filter(r=>(observation.county || !observationIslandNames.includes(r.county)) && point[0]>=r.bbox[0] && point[0]<=r.bbox[2] && point[1]>=r.bbox[1] && point[1]<=r.bbox[3] && r.hitPolygons.some(p=>core.pointInPolygon(point,p)))
    .sort((a,b)=>((a.bbox[2]-a.bbox[0])*(a.bbox[3]-a.bbox[1]))-((b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1])))[0] || null;
}
function observationHoverRegion(region, event = null) {
  observation.mapHover=region?.key || null;
  const target=region && observationMapTarget(region);
  const district=target?.level==="district" && observation.shard?.districts.find(d=>d.id===target.value);
  const swingData = observationSwingRecord(region);
  let swingText = "";
  if (swingData?.displayStatus || swingData?.status) {
    const marker = (swingData.displayStatus || swingData.status) === "close_swing" ? "🔴🟡" : "🟡";
    swingText = ` · ${marker} ${observationSwingStatusText(swingData, region.level)}`;
  }
  const districtSwing = product.council && observation.activeOffice === "mayor" && target?.level === "district" ? observation.swingData?.scopes?.councilDistricts.get(target.value) : null;
  const districtSwingText = districtSwing?.displayStatus ? ` · 議員選區${swingDisplayLabel(districtSwing, "")}` : "";
  if (observationMapHover) {
    observationMapHover.textContent=region ? `${region.label}${district ? ` · ${district.name} · ${district.candidates.length} 人登記` : target?.level==="township" && ["metro_councilor","county_councilor"].includes(observation.office) ? (observation.district ? " · 點選進入檢視轄下村里" : " · 按村里劃分，點選選區清單") : target?.level==="village" ? " · 點選檢視村里選情" : target && !(target.level==="county" && observation.county) ? " · 點選查看" : " · 行政區定位"}${swingText}` : "";
    if(region && observation.activeOffice==="council"){const record=councilLayerRecord(region);observationMapHover.textContent+=` · ${record?.label||record?.reason||"無可用指標"}`;}
    if (region && districtSwingText) observationMapHover.textContent += districtSwingText;
  }
  if (observationMapCanvas) observationMapCanvas.style.cursor=target ? "pointer" : "grab";
  drawObservationMap();
}
observationOffice?.addEventListener("change",()=>observationNavigate("office",observationOffice.value));
observationMapBack?.addEventListener("click",observationMapBackAction);
observationMapFull?.addEventListener("click",()=>{observation.mapFull=!observation.mapFull;observation.mapZoom=1;observation.mapPan=[0,0];renderObservationMap();});
for (const [id,factor] of [["zoom-in",1.4],["zoom-out",1/1.4]]) {
  document.getElementById(`observation-map-${id}`)?.addEventListener("click",()=>observationMapZoomAt(factor));
}
document.getElementById("observation-map-reset")?.addEventListener("click",()=>{observation.mapZoom=1;observation.mapPan=[0,0];observation.mapHover=null;if (observationMapHover) observationMapHover.textContent="";drawObservationMap();});
for (const [id,dx,dy] of [["pan-up",0,48],["pan-left",48,0],["pan-right",-48,0],["pan-down",0,-48]]) {
  document.getElementById(`observation-map-${id}`)?.addEventListener("click",()=>observationMapPanBy(dx,dy));
}
document.getElementById("observation-map-pan-center")?.addEventListener("click",()=>{if(!observation.mapReady)return;observation.mapPan=[0,0];drawObservationMap();});
function observationMapPointFromEvent(event) {
  const rect=observationMapCanvas.getBoundingClientRect();
  return [event.clientX-rect.left,event.clientY-rect.top];
}
observationMapCanvas.addEventListener("wheel",event=>{
  if(!observation.mapReady)return;
  event.preventDefault();
  observationMapZoomAt(event.deltaY<0?1.18:1/1.18,observationMapPointFromEvent(event));
},{passive:false});
observationMapCanvas.addEventListener("pointerdown",event=>{
  if(!observation.mapReady || (event.pointerType==="mouse" && event.button!==0) || observation.mapPointers.size>=2)return;
  observationMapCanvas.setPointerCapture(event.pointerId);
  observation.mapPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(observation.mapPointers.size===1) observation.mapGesture={kind:"pan",pointerId:event.pointerId,x:event.clientX,y:event.clientY,pan:[...observation.mapPan],moved:false};
  else {
    const [first,second]=[...observation.mapPointers.values()],midpoint=[(first.x+second.x)/2,(first.y+second.y)/2],local=observationMapPointFromEvent({clientX:midpoint[0],clientY:midpoint[1]});
    const projection=observation.mapProjection || observationProjection(observation.mapBounds,observationMapCanvas.clientWidth,observationMapCanvas.clientHeight,observation.mapZoom,observation.mapPan);
    observation.mapGesture={kind:"pinch",pointerIds:[...observation.mapPointers.keys()],distance:Math.max(1,Math.hypot(first.x-second.x,first.y-second.y)),midpoint,zoom:observation.mapZoom,pan:[...observation.mapPan],anchor:projection.invert(local),moved:false};
  }
});
observationMapCanvas.addEventListener("pointermove",event=>{
  if(!observation.mapPointers.has(event.pointerId)){if(event.pointerType==="mouse" && observation.mapPointers.size===0)observationHoverRegion(observationRegionAt(event), event);return;}
  observation.mapPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  const gesture=observation.mapGesture;if(!gesture)return;
  if(gesture.kind==="pan"){
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    gesture.moved=gesture.moved || Math.hypot(dx,dy)>6;
    if(gesture.moved){observation.mapPan=[gesture.pan[0]+dx,gesture.pan[1]+dy];drawObservationMap();}
    return;
  }
  const first=observation.mapPointers.get(gesture.pointerIds[0]),second=observation.mapPointers.get(gesture.pointerIds[1]);if(!first||!second)return;
  const distance=Math.max(1,Math.hypot(first.x-second.x,first.y-second.y)),midpoint=[(first.x+second.x)/2,(first.y+second.y)/2];
  gesture.moved=gesture.moved || Math.abs(distance-gesture.distance)>6 || Math.hypot(midpoint[0]-gesture.midpoint[0],midpoint[1]-gesture.midpoint[1])>6;
  if(!gesture.moved)return;
  const rect=observationMapCanvas.getBoundingClientRect(),local=observationMapPointFromEvent({clientX:midpoint[0],clientY:midpoint[1]});
  observation.mapZoom=Math.max(1,Math.min(6,gesture.zoom*distance/gesture.distance));
  observation.mapPan=[...gesture.pan];
  const projected=observationProjection(observation.mapBounds,rect.width,rect.height,observation.mapZoom,observation.mapPan).project(gesture.anchor);
  observation.mapPan=[observation.mapPan[0]+local[0]-projected[0],observation.mapPan[1]+local[1]-projected[1]];
  drawObservationMap();
});
function finishObservationMapPointer(event,canceled=false){
  if(!observation.mapPointers.has(event.pointerId))return;
  const gesture=observation.mapGesture;
  const activate=!canceled && gesture?.kind==="pan" && !gesture.moved && observation.mapPointers.size===1;
  const region=activate ? observationRegionAt(event) : null;
  observation.mapPointers.delete(event.pointerId);
  if(observationMapCanvas.hasPointerCapture(event.pointerId))observationMapCanvas.releasePointerCapture(event.pointerId);
  if(gesture?.kind==="pinch"){
    const [remainingId,remaining]=observation.mapPointers.entries().next().value || [];
    observation.mapGesture=remaining?{kind:"pan",pointerId:remainingId,x:remaining.x,y:remaining.y,pan:[...observation.mapPan],moved:true}:null;
  } else if(observation.mapPointers.size){
    const [remainingId,remaining]=observation.mapPointers.entries().next().value;
    observation.mapGesture={kind:"pan",pointerId:remainingId,x:remaining.x,y:remaining.y,pan:[...observation.mapPan],moved:true};
  } else observation.mapGesture=null;
  if(region)observationMapAction(region);
}
observationMapCanvas.addEventListener("pointerup",event=>finishObservationMapPointer(event));
observationMapCanvas.addEventListener("pointercancel",event=>finishObservationMapPointer(event,true));
observationMapCanvas.addEventListener("lostpointercapture",event=>finishObservationMapPointer(event,true));
observationMapCanvas.addEventListener("pointerleave",()=>{if(!observation.mapPointers.size)observationHoverRegion(null);});
observationMapCanvas.addEventListener("keydown",event=>{
  if(!observation.mapReady)return;
  if(event.key==="Escape"){event.preventDefault();observationMapBackAction();return;}
  const regions=observation.mapRegions.filter(r=>observationMapTarget(r));
  if(!regions.length)return;
  const index=regions.findIndex(r=>r.key===observation.mapHover);
  if(["ArrowDown","ArrowRight","ArrowUp","ArrowLeft"].includes(event.key)){
    event.preventDefault();const next=regions[(index+(["ArrowDown","ArrowRight"].includes(event.key)?1:-1)+regions.length)%regions.length];
    // Focused regions must remain visible, including inset counties and small villages.
    if(observation.county){const point=observation.mapProjection.project(core.labelPlacement(next.polygons,next.hitPolygons).anchor),rect=observationMapCanvas.getBoundingClientRect();observation.mapPan=[observation.mapPan[0]+rect.width/2-point[0],observation.mapPan[1]+rect.height/2-point[1]];}
    observationHoverRegion(next);
  } else if(event.key==="Enter" || event.key===" "){event.preventDefault();if(index>=0)observationMapAction(regions[index]);}
});
window.addEventListener("resize",()=>requestAnimationFrame(drawObservationMap));

function initializeMapDock(){
  const header=document.querySelector('.topbar'),map=document.querySelector('.observation-map-card');
  const bar=element('section','map-command-bar');bar.id='map-command-bar';bar.dataset.tourAnchor='map-controls';bar.setAttribute('aria-label','地圖圖例與控制');
  const row=element('div','map-command-row');bar.appendChild(row);
  row.appendChild(document.querySelector('.observation-map-toolbar'));
  row.appendChild(document.querySelector('.observation-map-tools'));
  const islands=document.getElementById('observation-islands-wrapper');
  const islandMenu=document.createElement('details');islandMenu.className='header-islands';
  islandMenu.append(element('summary','','離島'),islands);row.appendChild(islandMenu);
  const dock=document.createElement('details');dock.id='map-dock';
  const summary=element('summary','','圖層與說明');dock.appendChild(summary);
  const content=element('div','map-dock-content');dock.appendChild(content);
  const active=element('strong','','');active.id='map-dock-active';content.appendChild(active);const explanation=element('p','');explanation.id='map-metric-explanation';content.appendChild(explanation);
  const layers=document.createElement('details');layers.id='map-dock-layers';layers.open=true;layers.appendChild(element('summary','','切換圖層'));content.appendChild(layers);
  const tools=document.createElement('details');tools.id='map-dock-tools';tools.open=true;tools.append(element('summary','','篩選與資料狀態'),document.getElementById('observation-filter-bar'),document.getElementById('observation-map-status'));content.appendChild(tools);
  row.appendChild(dock);
  const legend=document.createElement('details');legend.id='map-dock-legend';legend.open=true;
  legend.append(element('summary','sr-only','色彩圖例'),document.getElementById('map-legend-bar'));bar.appendChild(legend);
  bar.appendChild(document.getElementById('observation-map-hover'));header.appendChild(bar);
  for(const menu of [dock,islandMenu])menu.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}});
  map.addEventListener('pointerdown',()=>{dock.open=false;islandMenu.open=false;});
  const panel=document.getElementById('observation-inspector');
  function sync(){
    const landscape=innerWidth<1024&&innerHeight<=500&&innerWidth>innerHeight;
    map.inert=(innerWidth<1024&&!landscape&&panel.dataset.detent==='expanded')||panel.classList.contains('reading');
    islandMenu.hidden=!!observation.county;
    requestAnimationFrame(drawObservationMap);
  }
  new MutationObserver(sync).observe(panel,{attributes:true,attributeFilter:['data-detent','class']});
  new MutationObserver(sync).observe(document.getElementById('observation-islands'),{childList:true});
  window.addEventListener('resize',sync);sync();
}
initializeMapDock();
setMapInteractionEnabled(false);
initialize();
