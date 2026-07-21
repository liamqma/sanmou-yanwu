# 视频分镜模板 (Animated Slide Template)

A lightweight, dependency-free system for building **keypress-stepped, animated
explainer slides** in the browser (HTML + CSS + [GSAP] via CDN). Designed to be
screen-recorded with a voiceover: press <kbd>Space</kbd> to advance each beat,
and scenes crossfade into one another.

```
video/
├── README.md                     ← you are here
├── template/                     ← the generic engine — COPY THIS to start a new video
│   ├── scenes.json               ← single source of truth for scene order + titles
│   ├── index.html                ← launcher (renders one card per scene, data-driven)
│   ├── nav.js                    ← scene navigation + fade-to-paper transitions
│   ├── theme.css                 ← default 宣纸/水墨 palette (re-theme via CSS variables)
│   ├── serve.py                  ← no-cache dev server (so edits show on refresh)
│   ├── scene-template.html       ← blank boilerplate scene (copy per scene)
│   └── assets/                   ← put images/screenshots here
└── projects/
    └── recommendation/           ← a complete worked example (5-scene explainer)
        ├── 文本.md                ← narration script
        ├── scenes.json
        ├── scene1..5.html
        ├── heroes.js             ← project-specific helper (hero → image URL)
        ├── theme.css nav.js serve.py index.html
        └── assets/
```

## Quick start — create a new video

1. **Copy the engine**

   ```bash
   cp -r video/template video/projects/my-new-video
   cd video/projects/my-new-video
   ```

2. **Edit `scenes.json`** — set the deck title and list your scenes:

   ```json
   {
     "title": "My Explainer",
     "subtitle": "点击进入分镜 · 空格 / → 推进，R 重播",
     "scenes": [
       { "file": "scene1.html", "num": "壹", "zh": "开场", "en": "INTRO" },
       { "file": "scene2.html", "num": "贰", "zh": "第二幕", "en": "PART TWO" }
     ]
   }
   ```

   The launcher and `nav.js` both read this file, so **adding / removing /
   reordering scenes is a one-line edit** — there is no "total count" to maintain.

3. **Author each scene** — copy `scene-template.html` to `scene1.html`, `scene2.html`, …
   Each scene:
   - includes `theme.css`, GSAP, and `nav.js`;
   - defines a `beats` array (one function per keypress reveal) and a `reset()`;
   - ends with `SceneNav.init({ beats, reset });`

4. **Serve & record**

   ```bash
   python3 serve.py 8850          # no-cache server
   # open http://localhost:8850/            (launcher)
   # or   http://localhost:8850/scene1.html (start of the deck)
   ```

   Press <kbd>Space</kbd>/<kbd>→</kbd> to advance, <kbd>←</kbd> for the previous
   scene, <kbd>R</kbd> to replay the current scene. Screen-record start to finish.

## The scene pattern

```js
gsap.set("#lead", { opacity: 0 });        // 1. hidden initial state

const beats = [];                         // 2. one function per "beat"
beats.push(() => gsap.to("#title", { opacity: 1, duration: .5 }));
beats.push(() => gsap.to("#lead",  { opacity: 1, duration: .5 }));

function reset() {                         // 3. restore initial state (R / back-nav)
  gsap.set("#title,#lead", { opacity: 0 });
}

SceneNav.init({ beats, reset });          // 4. wire up nav (order comes from scenes.json)
```

- The **first beat auto-runs** on load, so the scene is never blank.
- Advancing past the **last** beat fades to the next scene; pressing <kbd>←</kbd>
  on the **first** beat fades to the previous scene.

## Theming

`theme.css` defines everything through CSS variables in `:root` (the default is
an ink-on-rice-paper 宣纸/水墨 look). To re-theme a video, edit those variables —
you generally don't need to touch the rest of the stylesheet. Shared building
blocks provided out of the box: `.scene-title` + `.seal-badge` (top-left tag),
`.hint` (bottom-left keyboard hint bar), and the `#scene-fade` transition overlay.

## Conventions

- **Keep it dependency-free.** GSAP is loaded from a CDN; there is no build step.
- **One `<style>` per scene** for scene-specific layout; shared styles live in `theme.css`.
- **Assets** go in the project's `assets/` folder and are referenced relatively.
- **Real data.** For data-driven explainers, cite real numbers and note the source.

[GSAP]: https://gsap.com/
