/*
 * Shared scene navigation + fade-to-paper transitions (data-driven).
 *
 * The scene order is defined ONCE in scenes.json — nav.js fetches it, so you
 * never hardcode the scene list or a "total" count in individual scenes.
 *
 * Each scene defines a global `beats` array and a `reset()` function, then calls:
 *
 *     SceneNav.init({ beats, reset });
 *
 * The current scene's position is auto-detected from its filename (e.g.
 * "scene3.html") against scenes.json.
 *
 * Behaviour:
 *   - On load: fade IN from the paper-colored overlay.
 *   - Space / -> / Enter: advance a beat; on the last beat, fade OUT and go to
 *     the next scene (which fades in). On the final scene it just stops.
 *   - <- / Backspace: on the FIRST beat, go to the previous scene; otherwise
 *     replay the current scene from the start.
 *   - R: reset/replay current scene.
 *
 * scenes.json shape:
 *   { "scenes": [ { "file": "scene1.html", ... }, ... ] }
 */
const SceneNav = (() => {
  const FADE = 0.6; // seconds
  const CONFIG_URL = "scenes.json";

  function makeOverlay() {
    const el = document.createElement("div");
    el.id = "scene-fade";
    document.body.appendChild(el);
    return el;
  }

  function currentFile() {
    const path = window.location.pathname;
    return path.substring(path.lastIndexOf("/") + 1) || "index.html";
  }

  function goTo(file, overlay) {
    if (!file) return;
    gsap.to(overlay, {
      opacity: 1, duration: FADE, ease: "power2.inOut",
      onComplete: () => { window.location.href = file; },
    });
  }

  async function loadOrder() {
    try {
      const res = await fetch(CONFIG_URL, { cache: "no-store" });
      const cfg = await res.json();
      return (cfg.scenes || []).map((s) => s.file);
    } catch (e) {
      console.warn("[nav] could not load scenes.json; scene transitions disabled", e);
      return [];
    }
  }

  async function init({ beats, reset }) {
    const overlay = makeOverlay();
    const order = await loadOrder();
    const here = currentFile();
    const pos = order.indexOf(here);              // -1 if not listed
    const nextFile = pos >= 0 ? order[pos + 1] : null;
    const prevFile = pos >= 0 ? order[pos - 1] : null;

    // fade in from paper
    gsap.set(overlay, { opacity: 1 });
    gsap.to(overlay, { opacity: 0, duration: FADE, ease: "power2.inOut" });

    let i = 0;
    if (beats.length) { beats[0](); i = 1; }      // run first beat so nothing is blank

    function advance() {
      if (i < beats.length) { beats[i](); i++; }
      else { goTo(nextFile, overlay); }
    }
    function back() {
      if (i <= 1) { goTo(prevFile, overlay); }
      else { doReset(); }
    }
    function doReset() { i = 0; reset(); if (beats.length) { beats[0](); i = 1; } }

    window.addEventListener("keydown", (e) => {
      if (["Space", "ArrowRight", "Enter"].includes(e.code)) { e.preventDefault(); advance(); }
      else if (["ArrowLeft", "Backspace"].includes(e.code)) { e.preventDefault(); back(); }
      else if (e.code === "KeyR") { e.preventDefault(); doReset(); }
    });
  }

  return { init };
})();
