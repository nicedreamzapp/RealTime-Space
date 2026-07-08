import SwiftUI

struct ContentView: View {
    @StateObject private var navigationController = SpaceNavigationController()
    @StateObject private var galaxyManager = GalaxyDataManager()
    @StateObject private var store = StoreManager()
    @Environment(\.scenePhase) private var scenePhase
    
    @State private var joystickOffset = CGSize.zero
    @State private var isThrustButtonPressed = false
    @State private var maxSpeed = UserDefaults.standard.object(forKey: "maxSpeed") as? Double ?? 120
    @State private var showPlanetPicker = false
    @State private var showOrbitLines = UserDefaults.standard.object(forKey: "showOrbitLines") as? Bool ?? true
    @State private var showLabels = UserDefaults.standard.object(forKey: "showLabels") as? Bool ?? true
    @State private var cinematicMode = UserDefaults.standard.object(forKey: "cinematicMode") as? Bool ?? false
    @State private var lutEnabled = UserDefaults.standard.object(forKey: "lutEnabled") as? Bool ?? false
    @State private var lutIntensity = UserDefaults.standard.object(forKey: "lutIntensity") as? Double ?? 0.5
    @State private var spatialAudioEnabled = UserDefaults.standard.object(forKey: "spatialAudioEnabled") as? Bool ?? false
    @State private var cockpitOn = UserDefaults.standard.object(forKey: "cockpitOn") as? Bool ?? true
    @State private var uiHidden = false
    @State private var showNavigateMenu = false
    @State private var isPaused = false
    @State private var isWarping = false
    @State private var showSplash = true
    @State private var showCredits = false
    // Paywall opened early from the ⋯ menu. "-showUnlock" launch arg forces it at boot
    // (used to capture the App Review screenshot of the purchase screen).
    @State private var showUnlock = ProcessInfo.processInfo.arguments.contains("-showUnlock")
    @State private var viewMode = "helm"   // helm (cockpit, default) | visor (clean) | chase

    let joystickRadius: CGFloat = 60

    // True when native chrome should be hidden: Photo Mode (uiHidden) OR a Codex
    // discovery card / Field Guide is open in the webview (navigationController.hideChrome,
    // set from a "CHROME" bridge message). When hidden we also drop hit-testing so taps
    // reach the card underneath instead of the invisible native controls.
    // Splash/credits count as chrome-hidden too: in landscape especially, the splash art
    // doesn't cover the whole screen and the THRUST/joystick controls bled through it.
    private var chromeHidden: Bool { uiHidden || navigationController.hideChrome || showSplash || showCredits || showUnlock || store.locked }

    // Every place you can autopilot to, grouped. `fly` is the engine object name passed to
    // flyToByName (which now reaches planets, moons, comets, nebulae and the black hole).
    private var flyDestinations: [FlySection] {
        [
            FlySection(title: "The Star", items: [ FlyItem("☀️", "The Sun", "Sun") ]),
            FlySection(title: "Planets", items: [
                FlyItem("🌑", "Mercury", "Mercury"), FlyItem("🟡", "Venus", "Venus"),
                FlyItem("🌍", "Earth", "Earth"), FlyItem("🔴", "Mars", "Mars"),
                FlyItem("🟠", "Jupiter", "Jupiter"), FlyItem("🪐", "Saturn", "Saturn"),
                FlyItem("🔵", "Uranus", "Uranus"), FlyItem("🔵", "Neptune", "Neptune") ]),
            FlySection(title: "Moons", items: [
                FlyItem("🌕", "The Moon", "Moon"), FlyItem("🌋", "Io", "Io"),
                FlyItem("🧊", "Europa", "Europa"), FlyItem("🌑", "Ganymede", "Ganymede"),
                FlyItem("⚪", "Callisto", "Callisto"), FlyItem("🟠", "Titan", "Titan"),
                FlyItem("❄️", "Enceladus", "Enceladus") ]),
            FlySection(title: "Stations", items: [ FlyItem("🛰️", "ISS · orbiting Earth", "Earth") ]),
            FlySection(title: "Comets", items: [
                FlyItem("☄️", "Halley", "Halley"), FlyItem("☄️", "Swift-Tuttle", "Swift-Tuttle"),
                FlyItem("☄️", "Hale-Bopp", "Hale-Bopp") ]),
            FlySection(title: "Deep Space", items: [
                FlyItem("☁️", "Orion Nebula", "Orion Nebula"), FlyItem("☁️", "Carina Nebula", "Carina Nebula"),
                FlyItem("🐴", "Horsehead Nebula", "Horsehead Nebula"),
                FlyItem("🕳️", "Sagittarius A* · black hole", "Sagittarius A*") ]),
            FlySection(title: "The Belt", items: [ FlyItem("🪨", "Main Asteroid Belt", "Main Asteroid Belt") ]),
            FlySection(title: "Nearby Stars", items: [
                FlyItem("⭐️", "Alpha Centauri", "Alpha Centauri"), FlyItem("🔴", "Proxima Centauri", "Proxima Centauri"),
                FlyItem("💎", "Sirius", "Sirius"), FlyItem("🔷", "Vega", "Vega"),
                FlyItem("🟥", "Betelgeuse", "Betelgeuse"), FlyItem("🔵", "Rigel", "Rigel"),
                FlyItem("🟠", "Arcturus", "Arcturus"), FlyItem("✴️", "Polaris (North Star)", "Polaris") ]),
            FlySection(title: "Exoplanets", items: [
                FlyItem("🌎", "Proxima b", "Proxima b"), FlyItem("🪐", "TRAPPIST-1 e", "TRAPPIST-1 e"),
                FlyItem("🔥", "51 Pegasi b", "51 Pegasi b"), FlyItem("💠", "55 Cancri e", "55 Cancri e"),
                FlyItem("🌊", "Kepler-442b", "Kepler-442b") ]),
            FlySection(title: "Galaxies", items: [
                FlyItem("🌌", "Andromeda (M31)", "Andromeda (M31)"), FlyItem("☁️", "Large Magellanic Cloud", "Large Magellanic Cloud"),
                FlyItem("🌀", "Whirlpool (M51)", "Whirlpool (M51)"), FlyItem("👒", "Sombrero (M104)", "Sombrero (M104)"),
                FlyItem("💫", "Centaurus A", "Centaurus A") ]),
            FlySection(title: "Nebulae & Clusters", items: [
                FlyItem("🦅", "Eagle Nebula (Pillars)", "Eagle Nebula"), FlyItem("🦀", "Crab Nebula", "Crab Nebula"),
                FlyItem("💍", "Ring Nebula", "Ring Nebula"), FlyItem("👁️", "Helix Nebula", "Helix Nebula"),
                FlyItem("🌸", "Lagoon Nebula", "Lagoon Nebula"), FlyItem("✨", "Hercules Cluster (M13)", "Hercules Cluster (M13)"),
                FlyItem("🔆", "Omega Centauri", "Omega Centauri") ])
        ]
    }

    var body: some View {
        GeometryReader { geo in
            // Landscape gets its own layout: smaller radar, gamepad-style bottom row.
            let isLandscape = geo.size.width > geo.size.height
            ZStack {
                // GALAXY VIEW - Using WebView for enhanced JavaScript visuals
                WorkingPortalWebView(
                    fileName: "index",
                    navigationController: navigationController,
                    galaxyManager: galaxyManager
                )
                .ignoresSafeArea()

                // TOP BAR — status badge, ⋯ menu button, radar. The ⋯ button lives IN this
                // bar (trailing, before the radar) so it can't overlap the radar the way the
                // old separately-pinned button did.
                VStack {
                    if isLandscape {
                        // LANDSCAPE top bar, left→right: [TIME pill zone (web)] · radar ·
                        // [codex icon row (web, centered)] ······ ⋯ menu at far right.
                        // Radar no longer kisses the screen edge or the ⋯ bubble.
                        // Matt's spec: radar sits BETWEEN the sound icon (right end of the
                        // centered web icon row) and the ⋯ button, and rides a bit lower.
                        HStack(alignment: .top) {
                            Spacer()
                            SimpleRadarView(
                                galaxyManager: galaxyManager,
                                navigationController: navigationController
                            )
                            .frame(width: 80, height: 80)
                            .padding(.top, 24)
                            Spacer().frame(width: 44)
                            VStack(spacing: 8) {
                                menuButton
                                viewModeButton
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 6)
                    } else {
                        // PORTRAIT: radar top-right with the ⋯ tucked beneath it.
                        HStack(alignment: .top) {
                            Spacer()
                            VStack(alignment: .trailing, spacing: 8) {
                                SimpleRadarView(
                                    galaxyManager: galaxyManager,
                                    navigationController: navigationController
                                )
                                .frame(width: 120, height: 120)
                                menuButton
                                viewModeButton
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                    }

                    Spacer()
                }
                .opacity(chromeHidden ? 0 : 1)
                .allowsHitTesting(!chromeHidden)
                
                // (Removed the redundant bottom three-lines button — the "Fly To" sheet
                //  is reachable from the ⋯ menu → "Fly To Anywhere…".)

                // BOTTOM CONSOLE — the controls ARE the cockpit dash. Joystick + speed
                // under the left thumb, warp/THRUST cluster under the right, all sitting
                // on one dark dash panel that runs off the bottom of the screen.
                VStack(spacing: 0) {
                    Spacer()

                    // No panel behind the controls (the dark "dash block" read as a big
                    // blue slab) — small translucent controls float straight on the view.
                    HStack(alignment: .bottom) {
                        if isLandscape {
                            joystickPad(diameter: 88)
                            speedPill.frame(width: 190).padding(.bottom, 28).padding(.leading, 10)
                            Spacer(minLength: 12)
                            thrustCluster
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                speedPill.frame(width: 160)
                                joystickPad(diameter: 84)
                            }
                            Spacer(minLength: 12)
                            thrustCluster
                        }
                    }
                    .padding(.horizontal, isLandscape ? 16 : 12)
                    .padding(.bottom, isLandscape ? 6 : 8)
                    .opacity(isPaused ? 0.5 : 1)
                    .disabled(isPaused)
                }
                .opacity(chromeHidden ? 0 : 1)
                .allowsHitTesting(!chromeHidden)

                // TRANSPARENT NAVIGATE PANEL
                if showNavigateMenu {
                    HStack {
                        Spacer()
                        ScrollView {
                            VStack(alignment: .leading, spacing: 12) {
                                // NAVIGATE — the full destination list lives in the Fly To sheet now,
                                // so this is just the single entry point (no duplicate planet buttons).
                                Text("NAVIGATE")
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .foregroundColor(.cyan.opacity(0.85))
                                    .tracking(1.5)
                                    .padding(.top, 8)

                                navButton("🚀  Fly To Anywhere...") {
                                    showNavigateMenu = false
                                    showPlanetPicker = true
                                }
                                navButton("❓  How to Play") {
                                    showNavigateMenu = false
                                    withAnimation(.easeInOut(duration: 0.3)) { showSplash = true }
                                }
                                navButton("ℹ️  Credits") {
                                    showNavigateMenu = false
                                    withAnimation(.easeInOut(duration: 0.3)) { showCredits = true }
                                }
                                // Purchase point reachable from day one (App Review needs to
                                // find the IAP; eager buyers shouldn't have to wait 60 days).
                                if !store.isUnlocked {
                                    navButton("✨  Unlock Forever · $0.99") {
                                        showNavigateMenu = false
                                        withAnimation(.easeInOut(duration: 0.3)) { showUnlock = true }
                                    }
                                }

                                Divider().background(Color.cyan.opacity(0.2))

                                // CAPTURE
                                Text("CAPTURE")
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .foregroundColor(.cyan.opacity(0.85))
                                    .tracking(1.5)

                                navButton("📷 Photo Mode") {
                                    uiHidden = true
                                    showNavigateMenu = false
                                    navigationController.evaluateJavaScript("window.galaxyExplorer?.capturePhoto?.(1.5)")
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                                        uiHidden = false
                                    }
                                }

                                Divider().background(Color.cyan.opacity(0.2))

                                // DISPLAY
                                Text("DISPLAY")
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .foregroundColor(.cyan.opacity(0.85))
                                    .tracking(1.5)

                                // (Cockpit toggle removed — the art cockpit is always on in
                                //  landscape, managed entirely by the web layer.)
                                toggleRow("Orbit Lines", isOn: $showOrbitLines)
                                    .onChange(of: showOrbitLines) { _, newValue in
                                        UserDefaults.standard.set(newValue, forKey: "showOrbitLines")
                                        navigationController.evaluateJavaScript("window.galaxyExplorer?.setOrbitLinesVisible?.(\(newValue))")
                                    }

                                toggleRow("Labels", isOn: $showLabels)
                                    .onChange(of: showLabels) { _, newValue in
                                        UserDefaults.standard.set(newValue, forKey: "showLabels")
                                        navigationController.evaluateJavaScript("window.galaxyExplorer?.setPlanetLabelsVisible?.(\(newValue))")
                                    }

                                toggleRow("Cinematic", isOn: $cinematicMode)
                                    .onChange(of: cinematicMode) { _, newValue in
                                        UserDefaults.standard.set(newValue, forKey: "cinematicMode")
                                        navigationController.evaluateJavaScript("window.galaxyExplorer?.setCinematicMode?.(\(newValue))")
                                        if newValue { AudioManager.shared.playSFX(named: "warp") }
                                    }

                                toggleRow("Filmic LUT", isOn: $lutEnabled)
                                    .onChange(of: lutEnabled) { _, newValue in
                                        UserDefaults.standard.set(newValue, forKey: "lutEnabled")
                                        navigationController.evaluateJavaScript("window.galaxyExplorer?.setLUTEnabled?.(\(newValue))")
                                    }

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("LUT Intensity")
                                        .font(.caption)
                                        .foregroundColor(.cyan.opacity(0.8))
                                    Slider(value: $lutIntensity, in: 0...1)
                                        .accentColor(.cyan)
                                        .onChange(of: lutIntensity) { _, newValue in
                                            UserDefaults.standard.set(newValue, forKey: "lutIntensity")
                                            navigationController.evaluateJavaScript("window.galaxyExplorer?.setLUTIntensity?.(\(newValue))")
                                        }
                                }

                                toggleRow("Spatial Audio", isOn: $spatialAudioEnabled)
                                    .onChange(of: spatialAudioEnabled) { _, newValue in
                                        UserDefaults.standard.set(newValue, forKey: "spatialAudioEnabled")
                                        AudioManager.shared.soundEnabled = newValue
                                        if newValue {
                                            AudioManager.shared.loadAmbient(named: "space_ambience")
                                            AudioManager.shared.setAmbientVolume(0.35)
                                        } else {
                                            AudioManager.shared.setAmbientVolume(0.0)
                                        }
                                    }
                            }
                            .padding(16)
                        }
                        .frame(width: 210)
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color(red: 0.03, green: 0.06, blue: 0.11).opacity(0.97))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.cyan.opacity(0.55), lineWidth: 1)
                        )
                        .cornerRadius(14)
                        .shadow(color: .black.opacity(0.5), radius: 16, y: 6)
                        .padding(.top, isLandscape ? 52 : 70)
                        .padding(.trailing, 12)
                        .padding(.bottom, isLandscape ? 16 : 140)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                    .opacity(chromeHidden ? 0 : 1)
                .allowsHitTesting(!chromeHidden)
                }

                // Build/version stamp at the bottom so we can tell builds apart at a glance.
                VStack {
                    Spacer()
                    Text(appBuildString())
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                        .foregroundColor(.cyan.opacity(0.4))
                        .padding(.bottom, 2)
                }
                .allowsHitTesting(false)
                .opacity(chromeHidden ? 0 : 1)

                // First-launch splash + How to Play (reopenable from the ⋯ menu).
                if showSplash {
                    SplashView(onBegin: { withAnimation(.easeInOut(duration: 0.4)) { showSplash = false } })
                        .ignoresSafeArea()   // fill the REAL screen — in landscape the safe
                                             // area stops short of the notch side and the
                                             // live scene peeked out along the right edge
                        .transition(.opacity)
                        .zIndex(100)
                }

                // Credits / attributions (licensing) — opened from the ⋯ menu.
                if showCredits {
                    CreditsView(onClose: { withAnimation(.easeInOut(duration: 0.3)) { showCredits = false } })
                        .transition(.opacity)
                        .zIndex(101)
                }

                // Unlock Forever — opened early from the ⋯ menu (dismissable), or forced
                // as a hard gate once the 60-day free voyage ends (no close button).
                if showUnlock || store.locked {
                    UnlockView(store: store, onClose: store.locked ? nil : {
                        withAnimation(.easeInOut(duration: 0.3)) { showUnlock = false }
                    })
                    .ignoresSafeArea()
                    .transition(.opacity)
                    .zIndex(200)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { store.refreshTrial() }
            }
            .onChange(of: store.isUnlocked) { _, unlocked in
                if unlocked { showUnlock = false }
            }
            .onAppear {
                // Send saved cruise speed to JS (best-effort; JS guards if not ready yet)
                navigationController.evaluateJavaScript("window.galaxyExplorer?.setMaxSpeed?.(\(Int(maxSpeed)))")

                // (Cockpit visibility is owned entirely by the web layer now.)

                // Send initial JS for orbit lines state
                let orbitVisibility = showOrbitLines ? "true" : "false"
                navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setOrbitLinesVisible && window.galaxyExplorer.setOrbitLinesVisible(\(orbitVisibility))")

                // Send initial JS for labels state
                let labelsVisibility = showLabels ? "true" : "false"
                navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setPlanetLabelsVisible && window.galaxyExplorer.setPlanetLabelsVisible(\(labelsVisibility))")

                // Send initial JS for cinematic mode state
                let cinematicVisibility = cinematicMode ? "true" : "false"
                navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setCinematicMode && window.galaxyExplorer.setCinematicMode(\(cinematicVisibility))")

                // Send initial JS for LUT enabled state
                let lutEnabledStr = lutEnabled ? "true" : "false"
                navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setLUTEnabled && window.galaxyExplorer.setLUTEnabled(\(lutEnabledStr))")

                // Send initial JS for LUT intensity state
                navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setLUTIntensity && window.galaxyExplorer.setLUTIntensity(\(lutIntensity))")

                // AUDIO: the continuous "space_ambience" loop was the ringing drone — it is
                // OFF by default now and not even loaded unless the user opts into Spatial Audio.
                AudioManager.shared.soundEnabled = spatialAudioEnabled
                AudioManager.shared.setAmbientVolume(0.0)
                AudioManager.shared.start()
                AudioManager.shared.preloadCommonSFX()
                if spatialAudioEnabled {
                    AudioManager.shared.loadAmbient(named: "space_ambience")
                    AudioManager.shared.setAmbientVolume(0.35)
                }
            }
        }
        .sheet(isPresented: $showPlanetPicker, onDismiss: {
            isPaused = false
            navigationController.resumeGame()
        }) {
            flyToSheet
        }
    }

    // The "Fly To" destination picker — extracted from `body` so the type-checker
    // doesn't choke on one giant expression.
    @ViewBuilder
    private var flyToSheet: some View {
        NavigationView {
            List {
                ForEach(flyDestinations, id: \.title) { section in
                    Section(section.title) {
                        ForEach(section.items, id: \.label) { item in
                            Button {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                navigationController.flyToPlanet(named: item.fly)
                                AudioManager.shared.playSFX(named: "lock")
                                showPlanetPicker = false
                            } label: {
                                HStack(spacing: 12) {
                                    Text(item.icon).font(.system(size: 20))
                                    Text(item.label).foregroundColor(.cyan)
                                    Spacer()
                                    Image(systemName: "location.fill")
                                        .font(.caption2).foregroundColor(.cyan.opacity(0.45))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Fly To")
            .navigationBarTitleDisplayMode(.inline)
            .scrollContentBackground(.hidden)
            .background(Color(red: 0.02, green: 0.04, blue: 0.08))
        }
        .presentationBackground(.ultraThinMaterial)
    }

    // MARK: - Top bar pieces

    // View switcher: HELM (in-cockpit art) → VISOR (clean glass) → CHASE (behind ship).
    // The button PREVIEWS the view you'll get ("→ CHASE"), and HELM is skipped in
    // portrait where the cockpit art can't show — no dead taps either way.
    private func nextViewMode() -> String {
        let landscape = UIScreen.main.bounds.width > UIScreen.main.bounds.height
        let order = landscape ? ["helm", "visor", "chase"] : ["visor", "chase"]
        guard let i = order.firstIndex(of: viewMode) else { return order[0] }
        return order[(i + 1) % order.count]
    }

    private func viewModeIcon(_ mode: String) -> String {
        mode == "chase" ? "airplane" : (mode == "visor" ? "eye" : "person.crop.rectangle")
    }

    private var viewModeButton: some View {
        let next = nextViewMode()
        return Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            viewMode = next
            navigationController.evaluateJavaScript("window.galaxyExplorer?.setViewMode?.('\(next)')")
        } label: {
            VStack(spacing: 1) {
                Image(systemName: viewModeIcon(next))
                    .font(.system(size: 15, weight: .medium))
                Text("→ " + next.uppercased())
                    .font(.system(size: 7, weight: .bold, design: .monospaced))
            }
            .foregroundColor(.cyan.opacity(0.85))
            .frame(width: 50, height: 40)
            .background(Color.black.opacity(0.55))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cyan.opacity(0.5), lineWidth: 1))
            .cornerRadius(10)
        }
    }

    private var menuButton: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                showNavigateMenu.toggle()
            }
        } label: {
            Image(systemName: showNavigateMenu ? "xmark" : "ellipsis.circle")
                .font(.system(size: 20, weight: .medium))
                .foregroundColor(.cyan.opacity(0.8))
                .frame(width: 40, height: 40)
                .background(Color.black.opacity(0.55))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cyan.opacity(0.5), lineWidth: 1))
                .cornerRadius(10)
        }
    }

    // MARK: - Bottom control pieces

    // SPEED control — drag to set how fast thrust flies you. Lives on the left, above
    // the joystick, deliberately far from every action button so it can't misfire them.
    private var speedPill: some View {
        HStack(spacing: 8) {
            Image(systemName: "tortoise.fill")
                .font(.system(size: 11))
                .foregroundColor(.cyan.opacity(0.7))
            Slider(value: $maxSpeed, in: 15...250, step: 5)
                .tint(.cyan)
                .onChange(of: maxSpeed) { newValue in
                    UserDefaults.standard.set(newValue, forKey: "maxSpeed")
                    navigationController.evaluateJavaScript("window.galaxyExplorer?.setMaxSpeed?.(\(Int(newValue)))")
                }
            Text("\(Int(maxSpeed))")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundColor(.cyan.opacity(0.85))
                .frame(width: 28, alignment: .trailing)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.6))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Color.cyan.opacity(0.5), lineWidth: 1))
        .cornerRadius(11)
    }

    // ULTRA WARP — hold to punch 100× toward whatever's ahead. Sits directly above
    // THRUST in the right-thumb cluster. Plain view + direct press gesture (NOT a
    // Button): a Button wrapper's tap recognizer swallowed quick presses so warp
    // only engaged after a long hold.
    private var warpButton: some View {
        HStack(spacing: 3) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 12, weight: .heavy))
            Text("100×")
                .font(.system(size: 11, weight: .heavy, design: .monospaced))
        }
        .foregroundColor(isWarping ? .white : Color(red: 0.7, green: 0.5, blue: 1.0))
        .frame(width: 68, height: 28)
        .background((isWarping ? Color.purple : Color.purple.opacity(0.18)))
        .background(Color.black.opacity(0.55))
        .overlay(RoundedRectangle(cornerRadius: 9)
            .stroke(Color.purple.opacity(isWarping ? 0.9 : 0.5), lineWidth: 1))
        .cornerRadius(9)
        .shadow(color: isWarping ? .purple.opacity(0.7) : .clear, radius: 6)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !isPaused else { return }
                    if !isWarping {
                        isWarping = true
                        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                        navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setWarpDrive && window.galaxyExplorer.setWarpDrive(true)")
                        navigationController.thrustForward()
                        AudioManager.shared.playSFX(named: "warp")
                    }
                }
                .onEnded { _ in
                    isWarping = false
                    navigationController.evaluateJavaScript("window.galaxyExplorer && window.galaxyExplorer.setWarpDrive && window.galaxyExplorer.setWarpDrive(false)")
                    navigationController.stopThrust()
                }
        )
        .disabled(isPaused)
    }

    // JOYSTICK — the WHOLE pad is touchable (gesture on the pad, not the knob): the
    // stick jumps to wherever your thumb lands, so you never have to grab the little
    // knob first. Position is measured from the pad center in local coordinates.
    private func joystickPad(diameter: CGFloat) -> some View {
        let radius = diameter / 2
        return ZStack {
            Circle()
                .fill(Color.black.opacity(0.5))
                .overlay(Circle().stroke(Color.cyan.opacity(0.55), lineWidth: 1))

            Circle()
                .fill(Color.cyan.opacity(0.3))
                .frame(width: diameter * 0.32, height: diameter * 0.32)
                .overlay(Circle().stroke(Color.cyan.opacity(0.6), lineWidth: 0.5))
                .offset(joystickOffset)
        }
        .frame(width: diameter, height: diameter)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { value in
                    guard !isPaused else { return }
                    // Offset of the touch from the pad center
                    let dx = value.location.x - radius
                    let dy = value.location.y - radius
                    let distance = sqrt(dx * dx + dy * dy)
                    if distance <= radius {
                        joystickOffset = CGSize(width: dx, height: dy)
                    } else {
                        let ratio = radius / distance
                        joystickOffset = CGSize(width: dx * ratio, height: dy * ratio)
                    }
                    // Normalize to -1 to 1 range for analog sensitivity
                    let nx = Float(joystickOffset.width / radius)
                    let ny = Float(joystickOffset.height / radius)

                    // Small deadzone
                    let deadzone: Float = 0.08
                    let magnitude = sqrt(nx * nx + ny * ny)

                    if magnitude < deadzone {
                        navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
                    } else {
                        // Send normalized values (-1 to 1) - JS handles analog sensitivity
                        // x = pitch (up on stick = look up), y = yaw (right = look right)
                        navigationController.setRotationInput(Vector3D(x: -ny, y: -nx, z: 0))
                    }
                }
                .onEnded { _ in
                    guard !isPaused else { return }
                    joystickOffset = .zero
                    navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
                }
        )
    }

    // LOCK + STOP stacked beside THRUST — one right-thumb cluster instead of the old
    // layout that floated LOCK/STOP in the middle of the screen.
    private var thrustCluster: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(spacing: 8) {
                Button {
                    guard !isPaused else { return }
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    // Fly directly to nearest planet - one tap navigation
                    navigationController.evaluateJavaScript("window.galaxyExplorer?.flyToNearestPlanet?.()")
                    AudioManager.shared.playSFX(named: "lock")
                } label: {
                    Image(systemName: "location.fill")
                        .font(.system(size: 15, weight: .medium))
                        .frame(width: 40, height: 34)
                        .background(Color.green.opacity(0.12))
                        .background(Color.black.opacity(0.55))
                        .foregroundColor(.green)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.green.opacity(0.55), lineWidth: 1))
                        .cornerRadius(12)
                }
                .disabled(isPaused)

                Button {
                    guard !isPaused else { return }
                    navigationController.emergencyStop()
                    joystickOffset = .zero
                    isThrustButtonPressed = false
                } label: {
                    Text("STOP")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .frame(width: 40, height: 26)
                        .background(Color.red.opacity(0.1))
                        .background(Color.black.opacity(0.55))
                        .foregroundColor(.red.opacity(0.9))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.red.opacity(0.55), lineWidth: 1))
                        .cornerRadius(8)
                }
                .disabled(isPaused)
            }

            VStack(spacing: 8) {
                warpButton

                thrustButton
            }
        }
    }

    private var thrustButton: some View {
            // THRUST — plain view + direct press gesture (NOT a Button).
            // A `Button {} label:` wrapper here fought the .simultaneousGesture:
            // the button's own tap recognizer swallowed quick taps, so thrust only
            // engaged after a long (~2s) hold. Attaching the DragGesture straight to
            // the view — with contentShape so the whole frame is hittable —
            // makes touch-DOWN fire thrust instantly.
            VStack(spacing: 2) {
                Image(systemName: isThrustButtonPressed ? "flame.fill" : "arrow.up.circle")
                    .font(.system(size: 22, weight: .medium))
                Text("THRUST")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .tracking(1)
            }
            .frame(width: 68, height: 68)
            .background((isThrustButtonPressed ? Color.orange : Color.cyan).opacity(0.12))
            .background(Color.black.opacity(0.55))
            .foregroundColor(isThrustButtonPressed ? .orange : .cyan)
            .overlay(RoundedRectangle(cornerRadius: 18).stroke((isThrustButtonPressed ? Color.orange : Color.cyan).opacity(0.6), lineWidth: 1))
            .cornerRadius(18)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !isPaused else { return }
                        if !isThrustButtonPressed {
                            print("👆 THRUST touch-down → thrustForward()")
                            isThrustButtonPressed = true
                            navigationController.thrustForward()
                        }
                    }
                    .onEnded { _ in
                        guard !isPaused else { return }
                        isThrustButtonPressed = false
                        navigationController.stopThrust()
                    }
            )
            .disabled(isPaused)
    }

    // MARK: - Transparent UI Helpers
    @ViewBuilder
    private func navButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            action()
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.cyan.opacity(0.9))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity)
                .background(Color.cyan.opacity(0.14))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.cyan.opacity(0.55), lineWidth: 1))
                .cornerRadius(7)
        }
    }

    @ViewBuilder
    private func toggleRow(_ title: String, isOn: Binding<Bool>) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(.cyan.opacity(0.85))
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .tint(.cyan)
        }
        .padding(.vertical, 1)
    }
}

// Version + build stamp. The project's version (1.0) and build (10) settings don't
// auto-increment, so they'd read the same forever — we append the actual BUILD TIME, taken
// from the app bundle's Info.plist modification date (rewritten on every build), so every
// build on the phone is uniquely identifiable at a glance.
func appBuildString() -> String {
    let info = Bundle.main.infoDictionary
    let v = info?["CFBundleShortVersionString"] as? String ?? "?"
    let b = info?["CFBundleVersion"] as? String ?? "?"
    var stamp = "v\(v)  ·  build \(b)"
    // The app binary is re-linked/re-signed on EVERY build (Info.plist is not, so its date
    // goes stale), making the executable's modification date a reliable build timestamp.
    if let exe = Bundle.main.executableURL,
       let attrs = try? FileManager.default.attributesOfItem(atPath: exe.path),
       let built = attrs[.modificationDate] as? Date {
        let df = DateFormatter()
        df.dateFormat = "MMM d · h:mma"
        stamp += "  ·  \(df.string(from: built))"
    }
    return stamp
}

struct FlyItem {
    let icon: String
    let label: String
    let fly: String
    init(_ icon: String, _ label: String, _ fly: String) { self.icon = icon; self.label = label; self.fly = fly }
}

struct FlySection {
    let title: String
    let items: [FlyItem]
}

// Launch splash + How-to-Play. Shown over the live scene on launch; "Begin Exploring"
// fades it out. Reopenable from the ⋯ menu. Its own struct so the type-checker stays happy.
struct SplashView: View {
    let onBegin: () -> Void

    private let steps: [(String, String)] = [
        ("dpad.fill", "Drag the joystick to look around"),
        ("flame.fill", "Hold THRUST to fly forward"),
        ("dot.viewfinder", "SCAN nearby worlds for real NASA data"),
        ("book.fill", "Fill your Field Guide — discover the solar system & beyond"),
        ("paperplane.fill", "⋯ menu → Fly To Anywhere to jump instantly"),
        ("antenna.radiowaves.left.and.right", "Tap 🛰️ for the live ISS & today's asteroids")
    ]

    private var titleBlock: some View {
        VStack(spacing: 6) {
            Text("RealTime Space")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .shadow(color: .black.opacity(0.6), radius: 8)
            Text("Explore the real solar system")
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundColor(.cyan.opacity(0.9))
        }
    }

    private func howToCard(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 14) {
            Text("HOW TO PLAY")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .tracking(2)
                .foregroundColor(.cyan.opacity(0.7))
            ForEach(steps, id: \.1) { step in
                HStack(spacing: 13) {
                    Image(systemName: step.0)
                        .font(.system(size: compact ? 14 : 16))
                        .foregroundColor(.cyan)
                        .frame(width: 26)
                    Text(step.1)
                        .font(.system(size: compact ? 13 : 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.95))
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(compact ? 14 : 18)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(Color(red: 0.03, green: 0.06, blue: 0.12).opacity(0.82))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.cyan.opacity(0.5), lineWidth: 1))
        )
    }

    private var beginButton: some View {
        Button(action: onBegin) {
            Text("Begin Exploring")
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(
                    LinearGradient(colors: [.cyan, Color(red: 0.4, green: 0.8, blue: 1.0)],
                                   startPoint: .leading, endPoint: .trailing),
                    in: Capsule())
                .shadow(color: .cyan.opacity(0.4), radius: 12)
        }
    }

    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width > geo.size.height
            ZStack {
                // Opaque backing: nothing from the live scene may show through the art.
                Color.black
                Image("SplashArt")
                    .resizable()
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                LinearGradient(colors: [.black.opacity(0.55), .black.opacity(0.15), .black.opacity(0.9)],
                               startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()

                if isLandscape {
                    // Landscape: title + button on the left, How-to-Play card on the right —
                    // the portrait stack doesn't fit a short screen.
                    HStack(spacing: 24) {
                        VStack(spacing: 0) {
                            Spacer()
                            titleBlock
                            Spacer()
                            beginButton
                            Text(appBuildString())
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundColor(.white.opacity(0.5))
                                .padding(.top, 10)
                            Spacer().frame(height: 16)
                        }
                        .frame(maxWidth: .infinity)

                        ScrollView {
                            howToCard(compact: true)
                        }
                        .frame(maxWidth: geo.size.width * 0.46)
                        .padding(.vertical, 20)
                    }
                    .padding(.horizontal, 28)
                } else {
                    VStack(spacing: 0) {
                        titleBlock
                            .padding(.top, 60)

                        Spacer()

                        howToCard(compact: false)
                            .padding(.horizontal, 22)

                        beginButton
                            .padding(.horizontal, 22)
                            .padding(.top, 18)
                            .padding(.bottom, 10)

                        Text(appBuildString())
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundColor(.white.opacity(0.5))
                            .padding(.bottom, 28)
                    }
                }
            }
        }
    }
}

// Credits / attribution screen — satisfies the CC-BY requirement for the bundled imagery
// and the MIT notice for Three.js. Opened from the ⋯ menu.
struct CreditsView: View {
    let onClose: () -> Void

    private func entry(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
            Text(detail).font(.system(size: 12)).foregroundColor(.cyan.opacity(0.75))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    var body: some View {
        ZStack {
            Color(red: 0.01, green: 0.02, blue: 0.05).opacity(0.97).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Text("Credits").font(.system(size: 24, weight: .bold, design: .rounded)).foregroundColor(.white)
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 26)).foregroundColor(.cyan.opacity(0.7))
                    }
                }
                .padding(.horizontal, 22).padding(.top, 20).padding(.bottom, 8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("RealTime Space is a real-time solar-system explorer. It is built on freely-licensed astronomical imagery and open data, with gratitude to:")
                            .font(.system(size: 13)).foregroundColor(.white.opacity(0.8))
                            .padding(.bottom, 4)

                        Text("IMAGERY").font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2).foregroundColor(.cyan.opacity(0.6))
                        entry("NASA — Visible Earth", "Blue Marble, Black Marble city lights, MODIS clouds & elevation. Public domain.")
                        entry("Solar System Scope", "Planet, Sun & 8K Milky Way textures, and Saturn's rings.\nsolarsystemscope.com · licensed CC-BY 4.0.")
                        entry("threex.planets", "Planet sphere & bump maps (Mercury, Venus, Mars, Moon, Pluto, ice giants).")

                        Text("LIVE DATA").font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2).foregroundColor(.cyan.opacity(0.6)).padding(.top, 6)
                        entry("NASA NeoWs", "Near-Earth object (asteroid) feed. api.nasa.gov.")
                        entry("Where the ISS at?", "Live International Space Station position. wheretheiss.at.")

                        Text("SOFTWARE").font(.system(size: 11, weight: .bold, design: .monospaced)).tracking(2).foregroundColor(.cyan.opacity(0.6)).padding(.top, 6)
                        entry("Three.js", "WebGL 3D engine by mrdoob & contributors. MIT License.")

                        Text("Astronomical imagery is used for educational and entertainment purposes. NASA does not endorse this app.")
                            .font(.system(size: 11)).foregroundColor(.white.opacity(0.45)).padding(.top, 10)
                    }
                    .padding(.horizontal, 22).padding(.bottom, 40)
                }
            }
        }
    }
}

extension SpaceNavigationController {
    func flyToPlanet(named name: String) {
        // Bridge via WebKit if available
        // Attempt to call into JS
        let script = "window.galaxyExplorer && (window.galaxyExplorer.flyToByName && window.galaxyExplorer.flyToByName('\(name)'))"
        self.evaluateJavaScript(script)
    }
    // Note: evaluateJavaScript(_:) must be implemented in SpaceNavigationController
    // to forward the script into the embedded WebView.
}
