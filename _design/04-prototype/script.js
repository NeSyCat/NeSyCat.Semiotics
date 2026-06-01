// 04 — Prototype · interactive editor logic.
//
// Single source of truth: `state`. Every event handler mutates state, then
// calls `render()` which re-projects state onto the DOM. One-way data flow.

// ─── State ────────────────────────────────────────────────────────────

const state = {
  weight: 0.36,                  // 0..1  → inner-poly scale
  direction: "Center",           // enum  → Spine glyph + rail .is-active
  rotation: 0.25,                // 0..1  → CSS rotate(value × 360deg)
  scale: 0.50,                   // 0..1  → CSS scale(0.3 + value × 0.7)
  location: { x: 0, y: 0 },      // px    → CSS translate
  number: 5,                     // discrete → Spine label + rail + badge
  color: "#0080ff",              // hex   → poly fill + Spine sw-face
  shape: "Hexagon",              // enum  → polygon points + Spine glyph
  name: "X",                     // str   → centre label + name-bar input
  openPopover: null,             // null | "weight" | "direction" | ... | "shape"
};

// ─── Static lookup tables ─────────────────────────────────────────────

// Map state.direction → which SVG sprite the Spine button shows.
const DIRECTION_ICONS = {
  Inside:  "#ic-direction-in",
  Outside: "#ic-direction-out",
  Center:  "#ic-direction-center",
  South:   "#ic-chevron-double-down",
  North:   "#ic-chevron-double-up",
  Left:    "#ic-chevron-double-left",
  Right:   "#ic-chevron-double-right",
};

// Map state.shape → which SVG sprite the Spine button shows.
const SHAPE_ICONS = {
  Circle:   "#kind-circle",
  Point:    "#kind-point",
  Line:     "#kind-line",
  Triangle: "#kind-triangle",
  Rhombus:  "#kind-rhombus",
  Pentagon: "#kind-pentagon",
  Hexagon:  "#kind-hexagon",
  Square:   "#kind-rectangle",
};

// Per-shape SVG rendering: each entry is an object with a `polyOuter(stroke)`
// function returning the OUTER stroke-only element and an `polyInner(color, scale)`
// function returning the INNER fill element scaled around (50, 50). Both are
// in viewBox 0 0 100 100 with circumradius ~45 from centre (50, 50).
const SHAPE_RENDERERS = {
  Circle: {
    outer: () =>
      `<circle cx="50" cy="50" r="45" fill="none" stroke="#111827" stroke-width="2.2" />`,
    inner: (color, s) => {
      const r = 45 * s;
      return `<circle cx="50" cy="50" r="${r}" fill="${color}" />`;
    },
  },
  Point: {
    outer: () =>
      `<circle cx="50" cy="50" r="14" fill="none" stroke="#111827" stroke-width="2.2" />`,
    inner: (color, s) => {
      const r = 14 * s;
      return `<circle cx="50" cy="50" r="${r}" fill="${color}" />`;
    },
  },
  Line: {
    outer: () =>
      `<line x1="5" y1="50" x2="95" y2="50" stroke="#111827" stroke-width="6" stroke-linecap="round" />`,
    inner: (color, s) => {
      const w = 90 * s;
      const x1 = 50 - w / 2;
      const x2 = 50 + w / 2;
      return `<line x1="${x1}" y1="50" x2="${x2}" y2="50" stroke="${color}" stroke-width="6" stroke-linecap="round" />`;
    },
  },
  Triangle: {
    points: "50,5 89,73 11,73",
  },
  Rhombus: {
    points: "50,5 95,50 50,95 5,50",
  },
  Pentagon: {
    points: "50,5 93,36 76,86 24,86 7,36",
  },
  Hexagon: {
    points: "50,5 91,28 91,72 50,95 9,72 9,28",
  },
  Square: {
    points: "5,5 95,5 95,95 5,95",
  },
};

// Build a polygon-shape's outer / inner SVG from its `points` string.
function buildPolygonSvg(shape, color, weight) {
  const def = SHAPE_RENDERERS[shape];
  // Shapes with custom renderers (non-polygon): Circle, Point, Line.
  if (def.outer) {
    return `${def.inner(color, weight)}${def.outer()}`;
  }
  // Polygon-based shapes.
  const innerTransform = `translate(50 50) scale(${weight}) translate(-50 -50)`;
  return (
    `<g transform="${innerTransform}">` +
    `<polygon points="${def.points}" fill="${color}" stroke="none" />` +
    `</g>` +
    `<polygon points="${def.points}" fill="none" stroke="#111827" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`
  );
}

// ─── DOM refs ─────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const refs = {
  spineButtons: $$("[data-tool]"),
  spineDirection: $("[data-spine-direction]"),
  spineNumber: $("[data-spine-number]"),
  spineColor: $("[data-spine-color]"),
  spineShape: $("[data-spine-shape]"),
  form: $("[data-form]"),
  formSvg: $("[data-form-svg]"),
  formLabel: $("[data-form-label]"),
  formBadge: $("[data-form-badge]"),
  nameInput: $("[data-name-input]"),
  popovers: $$("[data-popover]"),
  directionCells: $$("[data-direction]"),
  numberCells: $$("[data-number]"),
  colorCells: $$("[data-color]"),
  shapeCells: $$("[data-shape]"),
  xyX: $("[data-xy-x]"),
  xyY: $("[data-xy-y]"),
  xyReset: $("[data-xy-reset]"),
};

// ─── Render ───────────────────────────────────────────────────────────

function render() {
  renderSpine();
  renderForm();
  renderNameBar();
  renderPopovers();
}

function renderSpine() {
  // Mark the active tool (one or none).
  refs.spineButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tool === state.openPopover);
  });
  // Direction Spine glyph follows state.direction.
  const useEl = refs.spineDirection.querySelector("use");
  useEl.setAttribute("href", DIRECTION_ICONS[state.direction]);
  // Number Spine label follows state.number.
  refs.spineNumber.textContent = String(state.number);
  // Color Spine disk follows state.color.
  refs.spineColor.style.background = state.color;
  // Shape Spine glyph follows state.shape.
  const shapeUse = refs.spineShape.querySelector("use");
  shapeUse.setAttribute("href", SHAPE_ICONS[state.shape]);
}

function renderForm() {
  // SVG body — rebuilt whenever shape / weight / color changes.
  refs.formSvg.innerHTML = buildPolygonSvg(state.shape, state.color, state.weight);

  // Container transforms: rotation (× 360°), scale (0.3..1.0 range), location.
  const rotDeg = state.rotation * 360;
  const scl = 0.3 + state.scale * 0.7;
  const { x, y } = state.location;
  refs.form.style.setProperty(
    "--shape-transform",
    `translate(${x}px, ${y}px) rotate(${rotDeg}deg) scale(${scl})`
  );

  // Label — counter-rotate so it stays upright.
  refs.formLabel.textContent = state.name;
  refs.formLabel.style.transform = `translate(-50%, -50%) rotate(${-rotDeg}deg)`;

  // Number badge — counter-rotate / counter-scale so it stays upright + readable.
  refs.formBadge.textContent = String(state.number);
  refs.formBadge.style.transform = `rotate(${-rotDeg}deg) scale(${1 / scl})`;
  refs.formBadge.style.transformOrigin = "center";
}

function renderNameBar() {
  if (document.activeElement !== refs.nameInput) {
    refs.nameInput.value = state.name;
  }
}

function renderPopovers() {
  refs.popovers.forEach((pop) => {
    const isOpen = pop.dataset.popover === state.openPopover;
    pop.classList.toggle("is-open", isOpen);
    if (!isOpen) return;

    // Per-popover dynamic content:
    const key = pop.dataset.popover;
    if (key === "weight" || key === "rotation" || key === "scale") {
      renderSliderPopover(pop, key);
    } else if (key === "direction") {
      renderActiveCell(refs.directionCells, "direction", state.direction);
    } else if (key === "number") {
      renderActiveCell(refs.numberCells, "number", String(state.number));
    } else if (key === "color") {
      renderActiveCell(refs.colorCells, "color", state.color);
    } else if (key === "shape") {
      renderActiveCell(refs.shapeCells, "shape", state.shape);
    } else if (key === "location") {
      renderXYPopover();
    }
  });
}

function renderSliderPopover(pop, key) {
  const value = state[key];
  const thumb = pop.querySelector("[data-slider-thumb]");
  const input = pop.querySelector("[data-slider-input]");
  thumb.style.left = `${value * 100}%`;
  if (document.activeElement !== input) {
    input.value = formatSliderValue(value);
  }
}

function formatSliderValue(v) {
  // Display 2 decimals; trim trailing zeros except keep ".5" → "0.50" style.
  return v.toFixed(2);
}

function renderActiveCell(cells, attr, currentValue) {
  cells.forEach((cell) => {
    const cellValue = cell.dataset[attr];
    const match = cellValue.toLowerCase() === String(currentValue).toLowerCase();
    cell.classList.toggle("is-active", match);
  });
}

function renderXYPopover() {
  if (document.activeElement !== refs.xyX) refs.xyX.value = String(state.location.x);
  if (document.activeElement !== refs.xyY) refs.xyY.value = String(state.location.y);
}

// ─── Event wiring ─────────────────────────────────────────────────────

function attachListeners() {
  // Spine — click to toggle the corresponding popover.
  refs.spineButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tool = btn.dataset.tool;
      state.openPopover = state.openPopover === tool ? null : tool;
      render();
    });
  });

  // Direction rail — set value, keep popover open so user can pick another.
  refs.directionCells.forEach((cell) => {
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      state.direction = cell.dataset.direction;
      render();
    });
  });

  // Number rail.
  refs.numberCells.forEach((cell) => {
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      state.number = parseInt(cell.dataset.number, 10);
      render();
    });
  });

  // Color rail.
  refs.colorCells.forEach((cell) => {
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      state.color = cell.dataset.color;
      render();
    });
  });

  // Shape rail.
  refs.shapeCells.forEach((cell) => {
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      state.shape = cell.dataset.shape;
      render();
    });
  });

  // Bounds sliders — click track to set, drag thumb to refine, type field to edit.
  $$("[data-popover='weight'], [data-popover='rotation'], [data-popover='scale']").forEach(
    (pop) => {
      const key = pop.dataset.popover;
      const track = pop.querySelector("[data-slider-track]");
      const thumb = pop.querySelector("[data-slider-thumb]");
      const input = pop.querySelector("[data-slider-input]");
      const reset = pop.querySelector("[data-slider-reset]");

      function setFromClientX(clientX) {
        const rect = track.getBoundingClientRect();
        const pct = (clientX - rect.left) / rect.width;
        state[key] = Math.max(0, Math.min(1, pct));
        render();
      }

      let dragging = false;
      track.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        dragging = true;
        track.setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
      });
      track.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        setFromClientX(e.clientX);
      });
      track.addEventListener("pointerup", (e) => {
        dragging = false;
        track.releasePointerCapture(e.pointerId);
      });
      track.addEventListener("pointercancel", () => {
        dragging = false;
      });

      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) {
          state[key] = Math.max(0, Math.min(1, v));
          renderSpine();
          renderForm();
          // Skip touching the input itself while user is typing — just move thumb.
          thumb.style.left = `${state[key] * 100}%`;
        }
      });

      reset.addEventListener("click", (e) => {
        e.stopPropagation();
        state[key] = 0;
        render();
      });
    }
  );

  // XY popover — type to translate.
  refs.xyX.addEventListener("input", () => {
    const v = parseFloat(refs.xyX.value);
    if (Number.isFinite(v)) {
      state.location.x = v;
      renderForm();
    }
  });
  refs.xyY.addEventListener("input", () => {
    const v = parseFloat(refs.xyY.value);
    if (Number.isFinite(v)) {
      state.location.y = v;
      renderForm();
    }
  });
  refs.xyReset.addEventListener("click", (e) => {
    e.stopPropagation();
    state.location = { x: 0, y: 0 };
    render();
  });

  // Name bar — live edit the form's centre glyph.
  refs.nameInput.addEventListener("input", () => {
    state.name = refs.nameInput.value;
    refs.formLabel.textContent = state.name;
  });

  // Click inside an open popover should not close it.
  refs.popovers.forEach((pop) => {
    pop.addEventListener("click", (e) => e.stopPropagation());
  });

  // Click anywhere else (canvas dot-grid, headings, frame) → close popover.
  document.addEventListener("click", () => {
    if (state.openPopover !== null) {
      state.openPopover = null;
      render();
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  attachListeners();
  render();
});
