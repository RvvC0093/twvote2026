/**
 * contest_board.js - 2026 臺灣選舉拉鋸榜元件 (v57)
 * 支援縣市長拉鋸榜與議員指標榜（末席差距、席次搖擺、競爭強度）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ElectionContestBoard = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PARTY_COLORS = {
    "民主進步黨": "#1b9438",
    "中國國民黨": "#000095",
    "台灣民眾黨": "#28c8c8",
    "時代力量": "#f1be00",
    "台灣基進": "#a73f24",
    "親民黨": "#f47820",
    "無黨籍及未經政黨推薦": "#888888",
    "無黨籍": "#888888",
  };

  function getPartyColor(party) {
    if (!party) return "#888888";
    return PARTY_COLORS[party] || "#777777";
  }

  function historicalComparable(d) {
    return ["comparable", "seats_changed"].includes(d.comparability?.["2022_2026"]);
  }
  function councilStatus(d) {
    const m = d.margin?.["2022"], cmp = d.comparability?.["2022_2026"];
    const notes = [];
    if (cmp === "redistricted") notes.push("2022 舊選區資料，不能直接代表目前範圍");
    else if (cmp === "seats_changed") notes.push("範圍一致，席次總額調整");
    else if (cmp !== "comparable") notes.push("歷史範圍尚無法核對");
    if (d.partial_townships?.length) notes.push("僅涵蓋部分行政區，請查看涵蓋範圍");
    if (m?.uncontested) notes.push("2022 同額，沒有落選者可計算末席差距");
    else if (m?.numerator == null || !(m?.denominator > 0)) notes.push("2022 票數或有效票資料不足");
    if (m?.fallback_quota_only) notes.push("僅有婦保當選者；差距沿用來源 fallback，須審慎閱讀");
    else if (m?.women_quota_applied) notes.push("2022 適用婦保；末席差距依一般當選席計算");
    return notes;
  }
  function compareCouncil(a, b, sort) {
    const stable = () => String(a.county_code || a.county).localeCompare(String(b.county_code || b.county)) || String(a.office_kind).localeCompare(String(b.office_kind)) || String(a.district_no).localeCompare(String(b.district_no), undefined, {numeric:true}) || String(a.map_district_id).localeCompare(String(b.map_district_id));
    const value = d => {
      if (sort === "margin") { const m=d.margin?.["2022"]; return m?.numerator != null && m.denominator > 0 && !m.uncontested ? m.numerator / m.denominator : null; }
      if (sort === "swing") return d.seat_swing?.rate ?? null;
      return d.cands_2026 != null && d.seats?.["2026"] > 0 ? d.cands_2026 / d.seats["2026"] : null;
    };
    if (sort !== "competition" && historicalComparable(a) !== historicalComparable(b)) return historicalComparable(a) ? -1 : 1;
    const av=value(a), bv=value(b);
    if(av == null || bv == null) return av == null && bv == null ? stable() : av == null ? 1 : -1;
    return (sort === "margin" ? av-bv : bv-av) || stable();
  }

  function ContestBoard(options = {}) {
    this.container = options.container || null;
    this.mode = options.mode || "mayor"; // "mayor" | "council"
    this.mayorData = null;
    this.councilData = null;
    this.selectedCounty = "";
    this.visibleCount = 20;
    this.councilScope = "all";
    this.includeIncomparable = false;
    this.councilSort = "competition"; // "margin" | "swing" | "competition"
    this.onSelectMayor = options.onSelectMayor || null;
    this.onSelectCouncil = options.onSelectCouncil || null;
    this.onHoverItem = options.onHoverItem || null;
    this.activeKey = null;
  }

  ContestBoard.prototype.setMayorData = function (data) {
    this.mayorData = data;
    if (this.mode === "mayor") this.render();
  };

  ContestBoard.prototype.setCouncilData = function (data) {
    this.councilData = data;
    if (this.mode === "council") this.render();
  };

  ContestBoard.prototype.setMode = function (mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.render();
  };

  ContestBoard.prototype.setCountyFilter = function (county) {
    this.selectedCounty = county || "";
    this.render();
  };

  ContestBoard.prototype.setActiveKey = function (key) {
    this.activeKey = key;
    if (!this.container) return;
    const items = this.container.querySelectorAll(".contest-item");
    items.forEach((item) => {
      if (item.dataset.key === key) {
        item.classList.add("active");
        item.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      } else {
        item.classList.remove("active");
      }
    });
  };

  ContestBoard.prototype.render = function () {
    if (!this.container) return;
    const active = document.activeElement;
    const focusLabel = this.container.contains(active) ? active.getAttribute("aria-label") : null;
    const scroll = this.container.scrollTop;
    this.container.replaceChildren();

    const wrap = document.createElement("div");
    wrap.className = "contest-board-wrap";

    if (this.mode === "mayor") {
      this.renderMayor(wrap);
    } else {
      this.renderCouncil(wrap);
    }

    this.container.appendChild(wrap);
    if (focusLabel) {
      const target = [...this.container.querySelectorAll("[aria-label]")].find(node => node.getAttribute("aria-label") === focusLabel);
      target?.focus({preventScroll:true});
      this.container.scrollTop = scroll;
    }
  };

  ContestBoard.prototype.renderMayor = function (parent) {
    const header = document.createElement("div");
    header.className = "contest-board-header";

    const title = document.createElement("h3");
    title.className = "contest-board-title";
    title.textContent = "縣市長拉鋸榜";
    header.appendChild(title);

    const sub = document.createElement("p");
    sub.className = "contest-board-sub";
    sub.textContent = "依 2022 催票率差距排序，呈現 22 縣市拉鋸與政黨輪替";
    header.appendChild(sub);
    parent.appendChild(header);

    if (!this.mayorData || !this.mayorData.counties) {
      const loading = document.createElement("div");
      loading.className = "contest-board-loading";
      loading.textContent = "正在載入縣市長選情…";
      parent.appendChild(loading);
      return;
    }

    const list = document.createElement("div");
    list.className = "contest-list";

    this.mayorData.counties.forEach((c, idx) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "contest-item contest-item-mayor";
      item.dataset.key = c.county;
      if (this.activeKey === c.county) item.classList.add("active");

      const rank = document.createElement("span");
      rank.className = "contest-rank";
      rank.textContent = String(idx + 1);

      const main = document.createElement("div");
      main.className = "contest-main";

      const nameRow = document.createElement("div");
      nameRow.className = "contest-name-row";

      const name = document.createElement("strong");
      name.className = "contest-name";
      name.textContent = c.county;
      nameRow.appendChild(name);

      const badge = document.createElement("span");
      badge.className = `contest-badge contest-badge-${c.band}`;
      badge.textContent = c.label;
      nameRow.appendChild(badge);

      main.appendChild(nameRow);

      const metaRow = document.createElement("div");
      metaRow.className = "contest-meta-row";

      // 2022 勝方
      if (c.winner_2022) {
        const winnerPill = document.createElement("span");
        winnerPill.className = "contest-winner-pill";
        const dot = document.createElement("span");
        dot.className = "party-dot";
        dot.style.backgroundColor = getPartyColor(c.winner_2022.party);
        winnerPill.appendChild(dot);
        winnerPill.appendChild(document.createTextNode(c.winner_2022.name));
        metaRow.appendChild(winnerPill);
      }

      // 輪替次數
      const turnoverSpan = document.createElement("span");
      turnoverSpan.className = "contest-meta-text";
      turnoverSpan.textContent = `輪替 ${c.turnover_count} 次`;
      metaRow.appendChild(turnoverSpan);

      // 2026 候選人數
      const candSpan = document.createElement("span");
      candSpan.className = "contest-meta-text";
      candSpan.textContent = `2026: ${c.cands_2026_count} 人參選`;
      if (this.councilSort !== "competition") metaRow.appendChild(candSpan);

      main.appendChild(metaRow);

      const val = document.createElement("div");
      val.className = "contest-val";
      const valNum = document.createElement("span");
      valNum.className = "contest-val-number";
      valNum.textContent = c.margin_2022_pct != null ? `${c.margin_2022_pct}%` : "—";
      const valLabel = document.createElement("span");
      valLabel.className = "contest-val-label";
      valLabel.textContent = "2022 差距";
      val.appendChild(valNum);
      val.appendChild(valLabel);

      item.appendChild(rank);
      item.appendChild(main);
      item.appendChild(val);

      item.addEventListener("click", () => {
        if (typeof this.onSelectMayor === "function") {
          this.onSelectMayor(c.county);
        }
      });

      item.addEventListener("mouseenter", () => {
        if (typeof this.onHoverItem === "function") {
          this.onHoverItem(c.county, "mayor");
        }
      });
      item.addEventListener("mouseleave", () => {
        if (typeof this.onHoverItem === "function") {
          this.onHoverItem(null, "mayor");
        }
      });

      list.appendChild(item);
    });

    parent.appendChild(list);
  };

  ContestBoard.prototype.renderCouncil = function (parent) {
    const header = document.createElement("div");
    header.className = "contest-board-header";

    const title = document.createElement("h3");
    title.className = "contest-board-title";
    title.textContent = "議員選情榜";
    header.appendChild(title);

    // 控制列：分頁 (區域/原住民) + 排序 (末席差距/席次搖擺/競爭強度) + 縣市篩選
    const controlBar = document.createElement("div");
    controlBar.className = "contest-control-bar";

    // Scope 分頁 (區域 | 原住民)
    const scopeSelect = document.createElement("select");
    scopeSelect.className = "contest-sort-select"; scopeSelect.setAttribute("aria-label", "議員公職範圍");
    for (const [value,label] of [["all","全部議員"],["regional","區域議員"],["plain_indigenous","平地原住民議員"],["mountain_indigenous","山地原住民議員"]]) {
      const option = document.createElement("option"); option.value=value; option.textContent=label; scopeSelect.appendChild(option);
    }
    scopeSelect.value=this.councilScope;
    scopeSelect.addEventListener("change", e => { this.councilScope=e.target.value; this.visibleCount=20; this.render(); });
    controlBar.appendChild(scopeSelect);

    // 排序選單
    const sortSelect = document.createElement("select");
    sortSelect.className = "contest-sort-select";
    sortSelect.setAttribute("aria-label", "議員指標排序");
    const optMargin = document.createElement("option");
    optMargin.value = "margin";
    optMargin.textContent = "2022 末席差距";
    const optSwing = document.createElement("option");
    optSwing.value = "swing";
    optSwing.textContent = "歷屆席次結構變動指數（進階）";
    const optComp = document.createElement("option");
    optComp.value = "competition";
    optComp.textContent = "2026 每席參選人數（預設）";
    sortSelect.appendChild(optMargin);
    sortSelect.appendChild(optSwing);
    sortSelect.appendChild(optComp);
    sortSelect.value = this.councilSort;
    sortSelect.addEventListener("change", (e) => {
      this.councilSort = e.target.value;
      this.visibleCount = 20;
      this.render();
    });
    controlBar.appendChild(sortSelect);

    // 縣市篩選選單
    const countySelect = document.createElement("select");
    countySelect.className = "contest-county-select";
    countySelect.setAttribute("aria-label", "篩選縣市");
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "全國";
    countySelect.appendChild(allOpt);

    if (this.councilData && this.councilData.districts) {
      const counties = Array.from(new Set(this.councilData.districts.map((d) => d.county))).filter(Boolean);
      counties.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        countySelect.appendChild(opt);
      });
    }
    countySelect.value = this.selectedCounty;
    countySelect.addEventListener("change", (e) => {
      this.selectedCounty = e.target.value;
      this.visibleCount = 20;
      this.render();
    });
    controlBar.appendChild(countySelect);

    header.appendChild(controlBar);
    parent.appendChild(header);

    if (!this.councilData || !this.councilData.districts) {
      const loading = document.createElement("div");
      loading.className = "contest-board-loading";
      loading.textContent = "正在載入議員指標資料…";
      parent.appendChild(loading);
      return;
    }

    let districts = this.councilData.districts.filter(d => (this.councilScope === "all" || (d.office_kind === "plains_indigenous" ? "plain_indigenous" : d.office_kind) === this.councilScope) && (!this.selectedCounty || d.county === this.selectedCounty));
    if (this.councilSort !== "competition") {
      const label = document.createElement("label"); label.className="contest-comparability";
      const check = document.createElement("input"); check.type="checkbox"; check.setAttribute("aria-label", "包含不可直接比較選區"); check.checked=this.includeIncomparable;
      check.addEventListener("change",()=>{this.includeIncomparable=check.checked;this.visibleCount=20;this.render();});
      label.append(check, "包含不可直接比較選區（另列）"); header.appendChild(label);
      if(!this.includeIncomparable) districts = districts.filter(historicalComparable);
    }
    districts.sort((a,b)=>compareCouncil(a,b,this.councilSort));
    if (!districts.length) { const empty=document.createElement("p");empty.className="contest-board-tip";empty.textContent=this.councilSort !== "competition" && !this.includeIncomparable ? "此條件沒有可直接比較的歷史選區；可勾選上方選項查看舊範圍資料，或改看 2026 參選人數。" : "此條件沒有選區，請調整公職範圍或縣市。";parent.appendChild(empty); }


    // 如果沒有選縣市，預設取前 20 名
    const count = this.selectedCounty ? districts.length : this.visibleCount;
    const isLimited = districts.length > count;
    const displayList = districts.slice(0, count);

    const countLabel=document.createElement("p"); countLabel.className="contest-board-tip"; countLabel.textContent=`符合條件 ${districts.length} 區，顯示 ${displayList.length} 區`; parent.appendChild(countLabel);
    const list = document.createElement("div");
    list.className = "contest-list";

    displayList.forEach((d, idx) => {
      if (this.councilSort !== "competition" && !historicalComparable(d) && (idx===0 || historicalComparable(displayList[idx-1]))) {
        const group=document.createElement("h4"); group.textContent="不可直接比較的歷史選區"; list.appendChild(group);
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "contest-item contest-item-council";
      item.dataset.key = d.key;
      if (this.activeKey === d.key) item.classList.add("active");

      const rank = document.createElement("span");
      rank.className = "contest-rank";
      rank.textContent = String(idx + 1);

      const main = document.createElement("div");
      main.className = "contest-main";

      const nameRow = document.createElement("div");
      nameRow.className = "contest-name-row";

      const name = document.createElement("strong");
      name.className = "contest-name";
      const distName = d.district_name || ("第" + d.district_no + "選區");
      name.textContent = `${d.county} ${distName}`;
      nameRow.appendChild(name);

      // 分級標籤
      const badge = document.createElement("span");
      const m = d.margin?.["2022"];
      if (m?.uncontested) {
        badge.className = "contest-badge contest-badge-uncontested";
        badge.textContent = "同額";
      } else if (m?.pct != null) {
        if (m.pct <= 1) {
          badge.className = "contest-badge contest-badge-tight";
          badge.textContent = "極接近";
        } else if (m.pct <= 3) {
          badge.className = "contest-badge contest-badge-close";
          badge.textContent = "接近";
        } else if (m.pct <= 6) {
          badge.className = "contest-badge contest-badge-normal";
          badge.textContent = "普通";
        } else {
          badge.className = "contest-badge contest-badge-loose";
          badge.textContent = "寬鬆";
        }
      } else {
        badge.className = "contest-badge contest-badge-na";
        badge.textContent = "資料不足";
      }
      if (this.councilSort === "margin") nameRow.appendChild(badge);

      main.appendChild(nameRow);

      const metaRow = document.createElement("div");
      metaRow.className = "contest-meta-row";

      const seats = d.seats?.["2026"] ?? d.seats_2026 ?? "—";
      const seatSpan = document.createElement("span");
      seatSpan.className = "contest-meta-text";
      seatSpan.textContent = `應選 ${seats} 席`;
      if (this.councilSort !== "competition") metaRow.appendChild(seatSpan);

      const cands = d.competition?.cands_2026 ?? d.cands_2026 ?? "—";
      const candSpan = document.createElement("span");
      candSpan.className = "contest-meta-text";
      candSpan.textContent = `參選 ${cands} 人`;
      if (this.councilSort !== "competition") metaRow.appendChild(candSpan);

      if (this.councilSort === "swing" && d.seat_swing?.total != null) {
        const swingSpan = document.createElement("span");
        swingSpan.className = "contest-meta-text";
        swingSpan.textContent = `席次變更 ${d.seat_swing.total} 席`;
        metaRow.appendChild(swingSpan);
      }

      const scopeText = document.createElement("span"); scopeText.className="contest-meta-text"; scopeText.textContent={regional:"區域",plain_indigenous:"平地原住民",mountain_indigenous:"山地原住民"}[d.office_kind] || d.office_kind; metaRow.appendChild(scopeText);
      for (const text of councilStatus(d)) { const note=document.createElement("span");note.className="contest-meta-text";note.textContent=text;metaRow.appendChild(note); }
      main.appendChild(metaRow);

      // 數值欄位（依當前排序顯示）
      const val = document.createElement("div");
      val.className = "contest-val";
      const valNum = document.createElement("span");
      valNum.className = "contest-val-number";
      const valLabel = document.createElement("span");
      valLabel.className = "contest-val-label";

      if (this.councilSort === "margin") {
        valNum.textContent = m?.pct != null ? `${m.pct}%` : (m?.uncontested ? "同額" : "—");
        valLabel.textContent = "末席差距";
      } else if (this.councilSort === "swing") {
        valNum.textContent = d.seat_swing?.rate != null ? `${(d.seat_swing.rate * 100).toFixed(1)}%` : "—";
        valLabel.textContent = "席次結構變動指數";
      } else {
        valNum.textContent = d.cands_2026 != null && d.seats?.["2026"] ? `${d.cands_2026} 人選 ${d.seats["2026"]} 席` : "—";
        valLabel.textContent = d.competition?.ratio_2026 != null ? `每席 ${d.competition.ratio_2026} 人` : "資料不足";
      }
      val.appendChild(valNum);
      val.appendChild(valLabel);

      item.appendChild(rank);
      item.appendChild(main);
      item.appendChild(val);

      item.addEventListener("click", () => {
        if (typeof this.onSelectCouncil === "function") {
          this.onSelectCouncil(d);
        }
      });

      item.addEventListener("mouseenter", () => {
        if (typeof this.onHoverItem === "function") {
          this.onHoverItem(d.key, "council");
        }
      });
      item.addEventListener("mouseleave", () => {
        if (typeof this.onHoverItem === "function") {
          this.onHoverItem(null, "council");
        }
      });

      list.appendChild(item);
    });

    if (isLimited) {
      const tip = document.createElement("button");
      tip.type = "button";
      tip.className = "contest-board-tip";
      tip.textContent = `顯示更多（目前 ${displayList.length}／${districts.length} 區）`;
      tip.addEventListener("click", () => {
        const scroll = this.container.scrollTop;
        this.visibleCount += 20; this.render(); this.container.scrollTop = scroll;
        this.container.querySelectorAll(".contest-item")[count]?.focus({preventScroll: true});
      });
      list.appendChild(tip);
    }

    parent.appendChild(list);
  };

  return {
    ContestBoard,
    getPartyColor,
    compareCouncil, historicalComparable, councilStatus,
  };
});
