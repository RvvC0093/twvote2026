(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ElectionUIShell = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createBottomSheet(sheetEl, grabberEl, options = {}) {
    if (!sheetEl) return null;
    let currentDetent = options.initialDetent || "summary";
    let isDragging = false;
    let startY = 0;
    let suppressClick = false;

    function setDetent(detent) {
      detent = ["summary","peek"].includes(detent) ? "summary" : "expanded";
      currentDetent = detent;
      sheetEl.dataset.detent = detent;
      sheetEl.setAttribute("aria-expanded", String(detent === "expanded"));
      if (typeof options.onDetentChange === "function") {
        options.onDetentChange(detent);
      }
    }

    if (grabberEl) {
      grabberEl.addEventListener("click", () => {
        if (suppressClick) { suppressClick = false; return; }
        setDetent(currentDetent === "summary" ? "expanded" : "summary");
      });

      grabberEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        isDragging = true;
        startY = e.clientY;
        suppressClick = false;
        try { grabberEl.setPointerCapture(e.pointerId); } catch (_) {}
      });

      const finishDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try { grabberEl.releasePointerCapture(e.pointerId); } catch (_) {}
        const dy = e.clientY - startY;
        suppressClick = Math.abs(dy) > 8;
        if (dy < -40) setDetent("expanded");
        else if (dy > 40) setDetent("summary");
      };

      grabberEl.addEventListener("pointerup", finishDrag);
      grabberEl.addEventListener("pointercancel", () => { isDragging = false; suppressClick = true; });
    }

    setDetent(currentDetent);

    return {
      getDetent: () => currentDetent,
      setDetent,
    };
  }

  function createSpotlight(modalEl, inputEl, resultsEl, getItems, onSelect) {
    if (!modalEl || !inputEl || !resultsEl) return null;
    let items = [], filtered = [], active = -1, generation = 0, opener = null, limit = 20, timer = null;
    const kind = modalEl.querySelector("#search-kind");
    const actions = document.createElement("div"); actions.className="search-actions"; resultsEl.after(actions);
    inputEl.setAttribute("role", "combobox");
    inputEl.setAttribute("aria-controls", resultsEl.id);
    inputEl.setAttribute("aria-autocomplete", "list");
    const normalize = value => String(value || "").normalize("NFKC").replace(/台/g, "臺").toLowerCase();
    function select(item) { close(); onSelect?.(item); }
    function highlight() {
      [...resultsEl.querySelectorAll("[role=option]")].forEach((row, i) => {
        row.classList.toggle("active", i === active);
        row.setAttribute("aria-selected", String(i === active));
      });
      if (active >= 0) {
        inputEl.setAttribute("aria-activedescendant", `search-result-${active}`);
        resultsEl.children[active]?.scrollIntoView({block:"nearest"});
      } else inputEl.removeAttribute("aria-activedescendant");
    }
    function render() {
      if (resultsEl.getAttribute("aria-busy") === "true") return;
      const started = performance.now();
      try {
      active = -1;
      resultsEl.replaceChildren(); actions.replaceChildren();
      const query = normalize(inputEl.value.trim());
      const matching = items.filter(item => item.searchText.includes(query));
      const score = item => item.normalizedLabel === query ? 0 : item.normalizedLabel.startsWith(query) ? 1 : 2;
      // IDs are ASCII source keys, so locale collation adds cost without useful ordering.
      matching.sort((a,b)=>score(a)-score(b)||(a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      filtered = matching.slice(0,limit);
      inputEl.removeAttribute("aria-activedescendant");
      if (!filtered.length) { resultsEl.textContent = "沒有符合的項目。"; return; }
      filtered.forEach((item, i) => {
        const row = document.createElement("div");
        row.id = `search-result-${i}`;
        row.className = "spotlight-item";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        const label = document.createElement("div"); label.className = "spotlight-label"; label.textContent = item.label;
        const sub = document.createElement("div"); sub.className = "spotlight-sublabel"; sub.textContent = item.sublabel || "";
        row.append(label, sub); row.addEventListener("click", () => select(item)); resultsEl.appendChild(row);
      });
      if (matching.length > limit) {
        const more = document.createElement("button"); more.type = "button"; more.textContent = `載入更多（已顯示 ${limit}／${matching.length}）`;
        more.addEventListener("click", () => { limit += 20; render(); }); actions.appendChild(more);
      }
      } finally { performance.measure("search-query", {start:started,end:performance.now()}); }
    }
    async function load() {
      const token = ++generation;
      items = []; filtered = []; active = -1; actions.replaceChildren();
      inputEl.placeholder = kind?.value === "candidates" ? "輸入候選人姓名" : "輸入全國地區或選區";
      resultsEl.textContent = "正在載入搜尋索引…";
      resultsEl.setAttribute("aria-busy", "true");
      try {
        const data = await getItems(kind?.value || "places");
        if (token !== generation || !modalEl.open) return;
        const prepared=[];
        for(let offset=0;offset<data.length;offset+=1000) {
          if(token!==generation || !modalEl.open)return;
          prepared.push(...data.slice(offset,offset+1000).map(item=>({...item,normalizedLabel:normalize(item.label),searchText:normalize(`${item.label} ${item.sublabel || ""} ${(item.aliases || []).join(" ")}`)})));
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(token!==generation || !modalEl.open)return;
        items=prepared; resultsEl.removeAttribute("aria-busy"); render();
      } catch (error) {
        if (token !== generation || !modalEl.open) return;
        resultsEl.textContent = "搜尋索引載入失敗。";
        const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "重試";
        retry.addEventListener("click", load); actions.appendChild(retry);
      } finally { if (token === generation) resultsEl.removeAttribute("aria-busy"); }
    }
    kind?.addEventListener("change", () => { clearTimeout(timer); limit=20; load(); inputEl.focus(); });
    function open() {
      if (modalEl.open) return;
      opener = document.activeElement;
      modalEl.classList.remove("hidden"); modalEl.showModal();
      inputEl.value = ""; limit = 20; inputEl.setAttribute("aria-expanded", "true"); inputEl.focus(); load();
    }
    function close() { modalEl.close(); }
    modalEl.addEventListener("close", () => {
      generation++; clearTimeout(timer); modalEl.classList.add("hidden"); inputEl.setAttribute("aria-expanded", "false");
      inputEl.removeAttribute("aria-activedescendant"); opener?.focus();
    });
    modalEl.querySelector("[data-search-close]")?.addEventListener("click", close);
    function schedule() { clearTimeout(timer); limit = 20; timer = setTimeout(render,150); }
    inputEl.addEventListener("input", e => { if (!e.isComposing) schedule(); });
    inputEl.addEventListener("compositionend", schedule);
    inputEl.addEventListener("keydown", e => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!filtered.length) return;
        active = active < 0 ? (e.key === "ArrowDown" ? 0 : filtered.length - 1) : (active + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length; highlight();
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); select(filtered[active]); }
    });
    modalEl.addEventListener("click", e => { if (e.target === modalEl) close(); });
    window.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); modalEl.open ? close() : open(); }
      else if (e.key === "/" && !modalEl.open && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) { e.preventDefault(); open(); }
    });
    return {open, close};
  }

  return {
    createBottomSheet,
    createSpotlight,
  };
});
