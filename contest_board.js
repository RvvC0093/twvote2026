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

  function ContestBoard(options = {}) {
    this.container = options.container || null;
    this.mode = options.mode || "mayor"; // "mayor" | "council"
    this.mayorData = null;
    this.councilData = null;
    this.selectedCounty = "";
    this.councilScope = "regional"; // "regional" | "indigenous"
    this.councilSort = "margin"; // "margin" | "swing" | "competition"
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
        item.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        item.classList.remove("active");
      }
    });
  };

  ContestBoard.prototype.render = function () {
    if (!this.container) return;
    this.container.replaceChildren();

    const wrap = document.createElement("div");
    wrap.className = "contest-board-wrap";

    if (this.mode === "mayor") {
      this.renderMayor(wrap);
    } else {
      this.renderCouncil(wrap);
    }

    this.container.appendChild(wrap);
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
      const item = document.createElement("div");
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
      metaRow.appendChild(candSpan);

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
    const scopeTabs = document.createElement("div");
    scopeTabs.className = "contest-tabs";
    const regTab = document.createElement("button");
    regTab.type = "button";
    regTab.className = `contest-tab ${this.councilScope === "regional" ? "active" : ""}`;
    regTab.textContent = "區域議員";
    regTab.addEventListener("click", () => {
      this.councilScope = "regional";
      this.render();
    });
    const indTab = document.createElement("button");
    indTab.type = "button";
    indTab.className = `contest-tab ${this.councilScope === "indigenous" ? "active" : ""}`;
    indTab.textContent = "原住民議員";
    indTab.addEventListener("click", () => {
      this.councilScope = "indigenous";
      this.render();
    });
    scopeTabs.appendChild(regTab);
    scopeTabs.appendChild(indTab);
    controlBar.appendChild(scopeTabs);

    // 排序選單
    const sortSelect = document.createElement("select");
    sortSelect.className = "contest-sort-select";
    sortSelect.setAttribute("aria-label", "議員指標排序");
    const optMargin = document.createElement("option");
    optMargin.value = "margin";
    optMargin.textContent = "末席差距（預設）";
    const optSwing = document.createElement("option");
    optSwing.value = "swing";
    optSwing.textContent = "席次搖擺";
    const optComp = document.createElement("option");
    optComp.value = "competition";
    optComp.textContent = "競爭強度";
    sortSelect.appendChild(optMargin);
    sortSelect.appendChild(optSwing);
    sortSelect.appendChild(optComp);
    sortSelect.value = this.councilSort;
    sortSelect.addEventListener("change", (e) => {
      this.councilSort = e.target.value;
      this.render();
    });
    controlBar.appendChild(sortSelect);

    // 縣市篩選選單
    const countySelect = document.createElement("select");
    countySelect.className = "contest-county-select";
    countySelect.setAttribute("aria-label", "篩選縣市");
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "全國（差距前 20）";
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

    // 篩選與排序
    let districts = this.councilData.districts.filter((d) => {
      const scope = d.office_kind || d.scope || "regional";
      if (this.councilScope === "regional") return scope === "regional";
      return scope === "plain_indigenous" || scope === "plains_indigenous" || scope === "mountain_indigenous";
    });

    if (this.selectedCounty) {
      districts = districts.filter((d) => d.county === this.selectedCounty);
    }

    // 排序邏輯
    if (this.councilSort === "margin") {
      districts.sort((a, b) => {
        const ma = a.margin?.["2022"]?.pct;
        const mb = b.margin?.["2022"]?.pct;
        if (ma == null && mb == null) return 0;
        if (ma == null) return 1;
        if (mb == null) return -1;
        return ma - mb;
      });
    } else if (this.councilSort === "swing") {
      districts.sort((a, b) => {
        const sa = a.seat_swing?.rate ?? -1;
        const sb = b.seat_swing?.rate ?? -1;
        return sb - sa;
      });
    } else if (this.councilSort === "competition") {
      districts.sort((a, b) => {
        const ca = a.competition?.ratio_2026 ?? -1;
        const cb = b.competition?.ratio_2026 ?? -1;
        return cb - ca;
      });
    }

    // 如果沒有選縣市，預設取前 20 名
    const isLimited = !this.selectedCounty && districts.length > 20;
    const displayList = isLimited ? districts.slice(0, 20) : districts;

    const list = document.createElement("div");
    list.className = "contest-list";

    displayList.forEach((d, idx) => {
      const item = document.createElement("div");
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
        badge.textContent = "新選區";
      }
      nameRow.appendChild(badge);

      main.appendChild(nameRow);

      const metaRow = document.createElement("div");
      metaRow.className = "contest-meta-row";

      const seats = d.seats?.["2026"] ?? d.seats_2026 ?? "—";
      const seatSpan = document.createElement("span");
      seatSpan.className = "contest-meta-text";
      seatSpan.textContent = `應選 ${seats} 席`;
      metaRow.appendChild(seatSpan);

      const cands = d.competition?.cands_2026 ?? d.cands_2026 ?? "—";
      const candSpan = document.createElement("span");
      candSpan.className = "contest-meta-text";
      candSpan.textContent = `參選 ${cands} 人`;
      metaRow.appendChild(candSpan);

      if (d.seat_swing?.total != null) {
        const swingSpan = document.createElement("span");
        swingSpan.className = "contest-meta-text";
        swingSpan.textContent = `席次變更 ${d.seat_swing.total} 席`;
        metaRow.appendChild(swingSpan);
      }

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
        valLabel.textContent = "席次搖擺度";
      } else {
        valNum.textContent = d.cands_2026 != null && d.seats?.["2026"] ? `${d.cands_2026} 人搶 ${d.seats["2026"]} 席` : "—";
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
      const tip = document.createElement("div");
      tip.className = "contest-board-tip";
      tip.textContent = "預設顯示全國差距最小前 20 選區，可從上方選單切換至特定縣市查看完整選區。";
      list.appendChild(tip);
    }

    parent.appendChild(list);
  };

  return {
    ContestBoard,
    getPartyColor,
  };
});
