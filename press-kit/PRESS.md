# RealTime Space press kit

Draft for review. Every number below comes from this repo (code, docs, git history). Anything that could not be confirmed from the repo is marked **TODO-VERIFY**.

Landing page: [`index.html`](index.html) in this folder.

## Fact sheet

| | |
|---|---|
| **Name** | RealTime Space |
| **Developer** | Matt Macosko / Nice Dreamz (Nice Dreamz LLC) |
| **Platforms** | iPhone and iPad (iOS / iPadOS 26.0 or later), Android 8.0 or later (minSdk 26, targets API 36) |
| **Current versions** | iOS 1.3.2 (build 23), Android 1.5 (versionCode 9) |
| **Price** | Free for 60 days, then a one-time $1.99 "Unlock Forever" purchase. Not a subscription. No ads. **TODO-VERIFY:** non-US prices; the local StoreKit test file still lists 0.99, the shipped copy and code say $1.99. |
| **Category** | Education / simulation **TODO-VERIFY** against the store listings |
| **App Store** | https://apps.apple.com/us/app/realtime-space/id6788646103 |
| **Google Play** | https://play.google.com/store/apps/details?id=com.nicedreamz.realtimespace |
| **Product page** | https://nicedreamzwholesale.com/software/realtime-space/ |
| **Source** | https://github.com/nicedreamzapp/RealTime-Space (MIT) |
| **Contact** | info@nicedreamzwholesale.com |
| **Data collected** | None. No accounts, ads, analytics or sensitive permissions. See [PRIVACY.md](../PRIVACY.md). |
| **Downloads** | **TODO-VERIFY.** The README shows a live badge fed from nicedreamzwholesale.com; no number is stored in the repo. |

### Numbers from the code

- 8,920 real naked-eye stars (HYG v4.1, magnitude 6.5 and brighter), counted from `ios/codex/data/hyg_stars.js`
- 21 real galaxies (`ios/codex/Galaxies.js`)
- 12 confirmed exoplanets (`ios/codex/Exoplanets.js`), plus a predicted planetary system for every other catalog star (`ios/codex/ExoSystems.js`)
- 6 nebulae and 3 globular clusters (`ios/codex/Deepsky.js`)
- 9 constellations drawn in true 3D (`ios/codex/Constellations.js`)
- 7 moons beyond the planets themselves: the Moon, Io, Europa, Ganymede, Callisto, Titan, Enceladus (`ios/Moons.js`, `ios/main.js`)
- 7 missions (`ios/Missions.js`)
- 13 stops on the Grand Tour autopilot, iOS only (`ios/ScenicTour.js`)
- 3 camera views: Helm (cockpit), Visor, Chase
- 100x warp
- About 55,000 points make up the Milky Way band (`ios/codex/MilkyWay.js`)

No performance figures (frame rate, battery, load time) are claimed; there are no benchmarks in the repo. **TODO-VERIFY** if you want to quote any.

### Release history

From git history. There are no git tags or GitHub releases in the repo.

| Date | Event |
|---|---|
| 2025-09-16 | Initial commit (working name "RealTime Fidget") |
| 2026-05-07 | Photoreal solar system and project scaffolding |
| 2026-07-07 | Real-universe overhaul: every star real, named and textured; predicted systems for every star; cockpit and chase views |
| 2026-07-08 | Unlock Forever paywall and 60-day free period; App Store screenshots |
| 2026-07-12 | Android port added; repo split into `ios/` and `android/` |
| 2026-07-15 | iOS 1.0 approved and released on the App Store (per commit feb62f2) |
| 2026-07-24 / 2026-08-04 | Live on Google Play. **TODO-VERIFY** exact date: commit c20744f (07-24) says live, commit 755b581 (08-04) says approved that day |
| 2026-07-29 | Android 1.1: Google Play Billing and the 60-day trial |
| 2026-08-30 | Android 1.4: panel close fix, Unlock Forever available during the trial |
| 2026-09-03 | Android 1.5 (versionCode 8): Play Billing 8, target API 36 |
| 2026-09-12 | iOS 1.3.1 (App Store build 17): Grand Tour, black hole, comet and nebula work |
| 2026-09-16 | iOS 1.3.2 (build 23) and Android 1.5 (versionCode 9): unlock codes typed on the paywall |

### Credits

Written by Matt Macosko at Nice Dreamz, with Anthropic's Claude Code as a coding assistant (many commits are co-authored by Claude). Built on:

- **three.js** (r150) by Ricardo Cabello (mrdoob) and the three.js contributors, for all WebGL rendering
- **NASA** Visible Earth / Blue Marble imagery (public domain)
- **Solar System Scope** textures, CC BY 4.0
- **threex.planets** sphere maps by Jerome Etienne (public domain)
- **HYG v4.1** star database by astronexus.com, CC BY-SA
- **wheretheiss.at** for the live ISS position, **NASA NeoWs** for near-Earth asteroids
- Some art is AI-generated: the cockpit panorama (made with Grok) and the exoplanet and nebula surface textures

## 50-word description

RealTime Space is a 3D solar system you fly yourself, on iPhone, iPad and Android. Planets use NASA imagery, and past them sit 8,920 real stars at their real distances, plus galaxies, nebulae and exoplanets. Scan anything to learn about it. Free for 60 days, then $1.99 once. No ads, no tracking.

## 150-word description

RealTime Space puts a photoreal, real-time 3D solar system on your phone and hands you the controls. Steer with a joystick, hold for 100x warp, and go anywhere: skim the Sun, cross Saturn's rings, follow the real International Space Station around Earth.

Then keep going. Every star in the sky is one of 8,920 real stars from the HYG catalog, placed at its true position and distance, so the constellations come apart as you fly out among them. There are 21 real galaxies built as 3D star clouds, nebulae, globular clusters, 12 confirmed exoplanets, and a predicted planetary system for every other star, clearly labeled as predicted.

Scan what you find for real NASA and JPL figures and fill your Field Guide. On iPhone and iPad, a Grand Tour autopilot flies a 13-stop route for you.

Free for 60 days, then a one-time $1.99. No ads, no accounts, no data collected.

## Five feature bullets

- Fly a photoreal 3D solar system rendered live with NASA imagery
- 8,920 real stars at true positions and distances, plus 21 galaxies and 12 exoplanets
- Scan anything for real data and collect it in your Field Guide
- Live ISS position and today's near-Earth asteroids when you're online
- No ads, no accounts, no data collected, works offline

## Pitch email to app reviewers

Matt's voice. Fill in the name and swap the first line for something about their site if there's a reason to.

> **Subject:** RealTime Space, a 3D solar system you can fly
>
> Hi [name],
>
> I made an app where you fly a ship out past Pluto and the constellations come apart around you, because every star is a real one at its real distance. 8,920 of them, from the HYG catalog.
>
> It's called RealTime Space. The planets are NASA imagery rendered live in 3D, there are 21 real galaxies you can fly into, and you can scan anything for real numbers. It's on iPhone, iPad and Android, free for 60 days and then $1.99 once. No ads and it collects nothing.
>
> App Store: https://apps.apple.com/us/app/realtime-space/id6788646103
> Google Play: https://play.google.com/store/apps/details?id=com.nicedreamz.realtimespace
> Screenshots and press kit: [link to this page]
>
> I can send you an unlock code so you don't have to buy it.
>
> Matt Macosko
> Nice Dreamz
> info@nicedreamzwholesale.com

### Variant for accessibility communities

> **Subject:** RealTime Space and VoiceOver
>
> Hi [name],
>
> The flight controls in RealTime Space on iPhone and iPad have VoiceOver labels and hints, and there's a Grand Tour button that flies the whole solar system for you without steering. I'm writing because I'd like people who use VoiceOver to try it and tell me where it falls short. The 3D view is visual, and I know that's a real limit.
>
> It's a solar system explorer with 8,920 real stars, no ads, and no data collected. I'm happy to send unlock codes to anyone in your community who wants to test it.
>
> App Store: https://apps.apple.com/us/app/realtime-space/id6788646103
>
> Matt Macosko
> Nice Dreamz
> info@nicedreamzwholesale.com

## Assets

All in this repo:

- App icon (1024x1024): `ios/RealTime Fidget/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
- iPhone screenshots (2868x1320, landscape): `ios/AppStore/screenshots/01_cockpit_saturn.png`, `02_cockpit_jupiter.png`, `03_ship_solar_system.png`, `04_ship_mars.png`
- Paywall screenshot (1320x2868, portrait): `ios/AppStore/screenshots/05_paywall.png`
- iPad screenshots (2752x2064): `ios/AppStore/screenshots-ipad/`
- Older portrait screenshots (1206x2622): `ios/docs/screenshots/`
