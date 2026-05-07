<div align="center">

# RealTime Fidget

### A photoreal real-time solar system explorer for iOS.

Fly through the entire solar system on your phone — every planet, moon, ring system, and the Sun rendered with real NASA imagery, true-3D atmospheric scattering, and cinematic post-processing.

![Hero — solar system view](docs/screenshots/01_boot.png)

[![iOS](https://img.shields.io/badge/iOS-26.0%2B-000000?style=flat-square&logo=apple)]()
[![Swift](https://img.shields.io/badge/Swift-5.0-FA7343?style=flat-square&logo=swift)]()
[![Three.js](https://img.shields.io/badge/Three.js-r150-049EF4?style=flat-square&logo=three.js&logoColor=white)]()
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)]()

</div>

---

## What it is

A SwiftUI iOS app wrapping a Three.js + WebGL galaxy renderer in a `WKWebView`. The Swift side handles touch (joystick, thrust, picker), the JavaScript side renders the entire solar system to your screen at 60 fps with real planet textures, real day/night terminators, real ring systems, and an HDR pipeline that bloom-floods the Sun like staring through a telescope.

## Features

- 🌍 **Photoreal Earth** — NASA Blue Marble (8K daymap) + Black Marble (city lights at night) blended through a custom shader with sunset terminator glow, ocean specular highlights, and a real MODIS cloud composite layer
- ☀️ **Living Sun** — Solar System Scope albedo modulated by procedural FBM convection, granulation, sunspots, and active regions, all HDR-boosted so ACES tonemapping bloom hits hard
- 🪐 **Real planet textures** — every body in the catalog: Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, the Moon, and Pluto, with bump maps where they help
- 💍 **Textured ring systems** on Saturn and Uranus with proper alpha-masked gaps
- 🌌 **Galaxy IBL environment** — Milky Way panorama → PMREMGenerator → image-based lighting picks up subtle reflections off every metal/rough surface
- 🎬 **Cinematic pipeline** — ACES Filmic tonemapping, physically-correct lights, sRGB color management, custom Rayleigh-Mie atmospheric scattering, optional LUT grading
- 🚀 **Direct touch flight** — analog joystick + thrust trigger, or one-tap fly-to-nearest-planet
- 📷 **Photo Mode** — instant UI hide for clean cinematic captures

## Screenshots

<table>
<tr>
  <td><img src="docs/screenshots/01_boot.png" width="100%" /></td>
  <td><img src="docs/screenshots/02_earth.png" width="100%" /></td>
</tr>
<tr>
  <td align="center"><sub>Initial view — Earth front of frame, Saturn's ring crossing the sky</sub></td>
  <td align="center"><sub>Sun bloom drowning the viewport, Saturn ringline overhead</sub></td>
</tr>
<tr>
  <td><img src="docs/screenshots/03_sun.png" width="100%" /></td>
  <td><img src="docs/screenshots/04_saturn.png" width="100%" /></td>
</tr>
<tr>
  <td align="center"><sub>Mid-orbit — Saturn's rings cutting through the sun's halo</sub></td>
  <td align="center"><sub>Cinematic wide — Jupiter (labeled) and the inner system</sub></td>
</tr>
</table>

## Tech stack

| Layer | What |
|------|------|
| App shell | SwiftUI + `WKWebView` |
| Renderer | Three.js r150 (WebGL2) |
| Materials | `MeshStandardMaterial` + custom `ShaderMaterial` for Earth/Sun |
| Color pipeline | Linear-sRGB workflow, ACES Filmic tonemapping, exposure 1.4 |
| Lighting | Physically-correct lights, PMREM-prefiltered galaxy IBL |
| Bridge | `WKScriptMessageHandler` + `evaluateJavaScript` two-way nav |

## Build & run

Requires Xcode 26+ and an iOS 26 device or simulator.

```bash
git clone https://github.com/nicedreamzapp/RealTime-Fidget.git
cd "RealTime-Fidget"
open "RealTime Fidget.xcodeproj"
```

Hit ⌘R. The texture pack ships in `textures/` (~18 MB) and is bundled automatically via a folder reference — no manual Xcode import required.

## Project layout

```
RealTime Fidget/                      # SwiftUI app shell (joystick, picker, audio)
  ContentView.swift
  WorkingPortalWebView.swift
  SpaceNavigationController.swift
  ...

main.js                               # Three.js scene, planet wiring, fly-to logic
Planet.js                             # Planet rendering (procedural + photoreal paths)
Star.js                               # Sun rendering (corona, prominences, CMEs, photoreal)
RendererCore.js                       # WebGL renderer, ACES, IBL setup
Starfield.js / Nebula.js / BlackHole.js / Comet.js / ...

textures/                             # NASA + Solar System Scope bundle
  earth/  sun/  mercury/  venus/  mars/
  jupiter/  saturn/  uranus/  neptune/
  moon/  pluto/  starfield/
```

## Credits & attributions

This project bundles freely-licensed astronomical imagery from:

- **NASA Visible Earth** ([visibleearth.nasa.gov](https://visibleearth.nasa.gov)) — Blue Marble Next Generation, Black Marble city lights, MODIS cloud composite. Public domain.
- **Solar System Scope** ([solarsystemscope.com/textures](https://www.solarsystemscope.com/textures)) — Sun surface albedo. CC-BY 4.0.
- **threex.planets** ([github.com/jeromeetienne/threex.planets](https://github.com/jeromeetienne/threex.planets)) — Mercury, Venus, Mars, Jupiter, Saturn (+ rings), Uranus (+ rings), Neptune, Moon, Pluto sphere maps and bump maps. Public domain.

Built on [Three.js](https://threejs.org/) by [@mrdoob](https://github.com/mrdoob) and contributors.

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
<sub>Made with WebGL, real photons, and a lot of Cmd-R</sub>
</div>
