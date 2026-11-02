(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ElectionUIShell = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createBottomSheet(sheetEl, grabberEl, options = {}) {
    if (!sheetEl) return null;
    let currentDetent = options.initialDetent || "peek";
    let isDragging = false;
    let startY = 0;

    function setDetent(detent) {
      currentDetent = detent;
      sheetEl.dataset.detent = detent;
      sheetEl.setAttribute("aria-expanded", String(detent !== "peek"));
      if (typeof options.onDetentChange === "function") {
        options.onDetentChange(detent);
      }
    }

    if (grabberEl) {
      grabberEl.addEventListener("click", () => {
        if (currentDetent === "peek") setDetent("half");
        else if (currentDetent === "half") setDetent("full");
        else setDetent("peek");
      });

      grabberEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        isDragging = true;
        startY = e.clientY;
        try { grabberEl.setPointerCapture(e.pointerId); } catch (_) {}
      });

      const finishDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try { grabberEl.releasePointerCapture(e.pointerId); } catch (_) {}
        const dy = e.clientY - startY;
        if (dy < -40) {
          if (currentDetent === "peek") setDetent("half");
          else if (currentDetent === "half") setDetent("full");
        } else if (dy > 40) {
          if (currentDetent === "full") setDetent("half");
          else if (currentDetent === "half") setDetent("peek");
        }
      };

      grabberEl.addEventListener("pointerup", finishDrag);
      grabberEl.addEventListener("pointercancel", finishDrag);
    }

    setDetent(currentDetent);

    return {
      getDetent: () => currentDetent,
      setDetent,
    };
  }

  function createSpotlight(modalEl, inputEl, resultsEl, getItems, onSelect) {
    if (!modalEl || !inputEl || !resultsEl) return null;
    let activeIndex = -1;
    let filteredItems = [];

    function open() {
      modalEl.classList.remove("hidden");
      inputEl.value = "";
      activeIndex = -1;
      renderResults();
      inputEl.focus();
    }

    function close() {
      modalEl.classList.add("hidden");
      inputEl.value = "";
      activeIndex = -1;
    }

    function renderResults() {
      while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
      const query = (inputEl.value || "").trim().toLowerCase();
      const allItems = typeof getItems === "function" ? getItems() : [];
      filteredItems = query
        ? allItems.filter(item => (item.label && item.label.toLowerCase().includes(query)) || (item.sublabel && item.sublabel.toLowerCase().includes(query)))
        : allItems.slice(0, 20);

      if (!filteredItems.length) {
        const empty = document.createElement("div");
        empty.className = "spotlight-empty";
        empty.textContent = "沒有符合的項目。請輸入其他關鍵字。";
        resultsEl.appendChild(empty);
        return;
      }

      filteredItems.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = `spotlight-item ${index === activeIndex ? "active" : ""}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === activeIndex));

        const icon = document.createElement("span");
        icon.className = "spotlight-badge";
        icon.textContent = item.badge || item.kind;

        const textGroup = document.createElement("div");
        textGroup.className = "spotlight-text-group";

        const label = document.createElement("div");
        label.className = "spotlight-label";
        label.textContent = item.label;

        const sublabel = document.createElement("div");
        sublabel.className = "spotlight-sublabel";
        sublabel.textContent = item.sublabel || "";

        textGroup.appendChild(label);
        if (item.sublabel) textGroup.appendChild(sublabel);

        row.appendChild(icon);
        row.appendChild(textGroup);

        row.addEventListener("click", () => {
          if (typeof onSelect === "function") onSelect(item);
          close();
        });

        resultsEl.appendChild(row);
      });
    }

    inputEl.addEventListener("input", renderResults);

    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredItems.length) {
          activeIndex = (activeIndex + 1) % filteredItems.length;
          renderResults();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredItems.length) {
          activeIndex = (activeIndex - 1 + filteredItems.length) % filteredItems.length;
          renderResults();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filteredItems.length) {
          if (typeof onSelect === "function") onSelect(filteredItems[activeIndex]);
          close();
        }
      }
    });

    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) close();
    });

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
          if (modalEl.classList.contains("hidden")) open();
          else close();
        } else if (e.key === "/" && document.activeElement && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
          e.preventDefault();
          open();
        }
      });
    }

    return { open, close };
  }

  return {
    createBottomSheet,
    createSpotlight,
  };
});
