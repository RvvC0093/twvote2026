(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ElectionMapEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCameraAnimator(onFrame) {
    let currentAnim = null;

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function animate({ fromBounds, toBounds, fromZoom, toZoom, fromPan, toPan, duration = 240, onComplete }) {
      if (currentAnim) {
        if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(currentAnim);
        currentAnim = null;
      }

      const prefersReduced = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (prefersReduced || typeof requestAnimationFrame === "undefined" || duration <= 0) {
        if (typeof onFrame === "function") onFrame({ bounds: toBounds, zoom: toZoom, pan: [...toPan], progress: 1 });
        if (typeof onComplete === "function") onComplete();
        return;
      }

      const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const t = easeOutCubic(progress);

        const currentBounds = [
          fromBounds[0] + (toBounds[0] - fromBounds[0]) * t,
          fromBounds[1] + (toBounds[1] - fromBounds[1]) * t,
          fromBounds[2] + (toBounds[2] - fromBounds[2]) * t,
          fromBounds[3] + (toBounds[3] - fromBounds[3]) * t,
        ];
        const currentZoom = fromZoom + (toZoom - fromZoom) * t;
        const currentPan = [
          fromPan[0] + (toPan[0] - fromPan[0]) * t,
          fromPan[1] + (toPan[1] - fromPan[1]) * t,
        ];

        if (typeof onFrame === "function") {
          onFrame({ bounds: currentBounds, zoom: currentZoom, pan: currentPan, progress });
        }

        if (progress < 1) {
          currentAnim = requestAnimationFrame(step);
        } else {
          currentAnim = null;
          if (typeof onComplete === "function") onComplete();
        }
      }

      currentAnim = requestAnimationFrame(step);
    }

    function cancel() {
      if (currentAnim) {
        if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(currentAnim);
        currentAnim = null;
      }
    }

    return { animate, cancel };
  }

  function computeOpticalPadding(viewportWidth, viewportHeight, isInspectorOpen) {
    if (viewportWidth > 960) {
      if (isInspectorOpen) {
        return {
          offsetX: -Math.min(210, Math.round(viewportWidth * 0.15)),
          offsetY: 18,
          padX: Math.min(260, Math.round(viewportWidth * 0.22)),
          padY: Math.min(110, Math.round(viewportHeight * 0.14)),
        };
      }
      return {
        offsetX: 0,
        offsetY: 16,
        padX: 84,
        padY: Math.min(100, Math.round(viewportHeight * 0.13)),
      };
    }
    if (isInspectorOpen) {
      return {
        offsetX: 0,
        offsetY: -Math.min(110, Math.round(viewportHeight * 0.14)),
        padX: 36,
        padY: Math.min(140, Math.round(viewportHeight * 0.18)),
      };
    }
    return { offsetX: 0, offsetY: 0, padX: 32, padY: 72 };
  }

  function positionMapTooltip(tooltipEl, clientX, clientY, containerRect) {
    if (!tooltipEl || !containerRect) return;
    const tooltipWidth = tooltipEl.offsetWidth || 180;
    const tooltipHeight = tooltipEl.offsetHeight || 64;
    const padding = 16;

    let x = clientX - containerRect.left + 16;
    let y = clientY - containerRect.top + 16;

    if (x + tooltipWidth > containerRect.width - padding) {
      x = clientX - containerRect.left - tooltipWidth - 16;
    }
    if (y + tooltipHeight > containerRect.height - padding) {
      y = clientY - containerRect.top - tooltipHeight - 16;
    }

    x = Math.max(padding, Math.min(containerRect.width - tooltipWidth - padding, x));
    y = Math.max(padding, Math.min(containerRect.height - tooltipHeight - padding, y));

    tooltipEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  return {
    createCameraAnimator,
    computeOpticalPadding,
    positionMapTooltip,
  };
});
