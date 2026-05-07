import SwiftUI

struct ContentView: View {
    @StateObject private var navigationController = SpaceNavigationController()
    @StateObject private var galaxyManager = GalaxyDataManager()
    
    @State private var joystickOffset = CGSize.zero
    @State private var isThrustButtonPressed = false
    @State private var showPlanetPicker = false
    @State private var showOrbitLines = UserDefaults.standard.object(forKey: "showOrbitLines") as? Bool ?? true
    @State private var showLabels = UserDefaults.standard.object(forKey: "showLabels") as? Bool ?? true
    @State private var cinematicMode = UserDefaults.standard.object(forKey: "cinematicMode") as? Bool ?? false
    @State private var lutEnabled = UserDefaults.standard.object(forKey: "lutEnabled") as? Bool ?? false
    @State private var lutIntensity = UserDefaults.standard.object(forKey: "lutIntensity") as? Double ?? 0.5
    @State private var spatialAudioEnabled = UserDefaults.standard.object(forKey: "spatialAudioEnabled") as? Bool ?? true
    @State private var uiHidden = false
    @State private var showNavigateMenu = false
    @State private var isPaused = false

    let joystickRadius: CGFloat = 60
    
    var body: some View {
        GeometryReader { geo in
            ZStack {
                // GALAXY VIEW - Using WebView for enhanced JavaScript visuals
                WorkingPortalWebView(
                    fileName: "index",
                    navigationController: navigationController,
                    galaxyManager: galaxyManager
                )
                .ignoresSafeArea()
                
                // TOP BAR
                VStack {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("EXPLORER")
                                .font(.system(size: 10, weight: .bold, design: .monospaced))
                                .foregroundColor(.cyan)
                                .tracking(1.5)
                            Text(navigationController.isThrusting ? "THRUST: ACTIVE" : "THRUST: IDLE")
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundColor(navigationController.isThrusting ? .orange : .gray.opacity(0.7))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(.ultraThinMaterial.opacity(0.6))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cyan.opacity(0.25), lineWidth: 0.5))
                        .cornerRadius(8)
                        
                        Spacer()
                        
                        // RADAR
                        SimpleRadarView(
                            galaxyManager: galaxyManager,
                            navigationController: navigationController
                        )
                        .frame(width: 120, height: 120)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    
                    Spacer()
                }
                .opacity(uiHidden ? 0 : 1)
                
                // PAUSE BUTTON - top right above joystick/thrust controls
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button(action: {
                            isPaused = true
                            showPlanetPicker = true
                            navigationController.pauseGame()
                        }) {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                                .font(.system(size: 24, weight: .medium))
                                .foregroundColor(.cyan.opacity(0.8))
                                .frame(width: 44, height: 44)
                                .background(.ultraThinMaterial.opacity(0.4))
                                .clipShape(Circle())
                                .overlay(Circle().stroke(Color.cyan.opacity(0.2), lineWidth: 0.5))
                        }
                        .padding([.trailing, .bottom], 18)
                    }
                }
                .ignoresSafeArea()
                
                VStack {
                    Spacer()
                    
                    HStack(alignment: .bottom) {
                        // LEFT: JOYSTICK
                        ZStack {
                            Circle()
                                .fill(.ultraThinMaterial.opacity(0.4))
                                .frame(width: 120, height: 120)
                                .overlay(Circle().stroke(Color.cyan.opacity(0.3), lineWidth: 0.5))

                            Circle()
                                .fill(Color.cyan.opacity(0.3))
                                .frame(width: 38, height: 38)
                                .overlay(Circle().stroke(Color.cyan.opacity(0.6), lineWidth: 0.5))
                                .offset(joystickOffset)
                                .gesture(
                                    DragGesture(minimumDistance: 0)
                                        .onChanged { value in
                                            guard !isPaused else { return }
                                            let distance = sqrt(value.translation.width * value.translation.width + value.translation.height * value.translation.height)
                                            if distance <= joystickRadius {
                                                joystickOffset = value.translation
                                            } else {
                                                let ratio = joystickRadius / distance
                                                joystickOffset = CGSize(width: value.translation.width * ratio, height: value.translation.height * ratio)
                                            }
                                            // Normalize to -1 to 1 range for analog sensitivity
                                            let nx = Float(joystickOffset.width / joystickRadius)
                                            let ny = Float(joystickOffset.height / joystickRadius)

                                            // Small deadzone
                                            let deadzone: Float = 0.08
                                            let magnitude = sqrt(nx * nx + ny * ny)

                                            if magnitude < deadzone {
                                                navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
                                            } else {
                                                // Send normalized values (-1 to 1) - JS handles analog sensitivity
                                                // Invert both axes for natural feel: left=left, up=up
                                                navigationController.setRotationInput(Vector3D(x: ny, y: -nx, z: 0))
                                            }
                                        }
                                        .onEnded { _ in
                                            guard !isPaused else { return }
                                            joystickOffset = .zero
                                            navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
                                        }
                                )
                        }
                        .frame(width: 120, height: 120)
                        
                        Spacer()
                        
                        // CENTER: LOCK + STOP
                        VStack(spacing: 12) {
                            Button {
                                guard !isPaused else { return }
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                // Fly directly to nearest planet - one tap navigation
                                navigationController.evaluateJavaScript("window.galaxyExplorer?.flyToNearestPlanet?.()")
                                AudioManager.shared.playSFX(named: "lock")
                            } label: {
                                Image(systemName: "location.fill")
                                    .font(.system(size: 22, weight: .medium))
                                    .frame(width: 56, height: 56)
                                    .background(Color.green.opacity(0.12))
                                    .background(.ultraThinMaterial.opacity(0.3))
                                    .foregroundColor(.green)
                                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.green.opacity(0.3), lineWidth: 0.5))
                                    .cornerRadius(14)
                            }
                            .disabled(isPaused)

                            Button {
                                guard !isPaused else { return }
                                navigationController.emergencyStop()
                                joystickOffset = .zero
                                isThrustButtonPressed = false
                            } label: {
                                Text("STOP")
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .frame(width: 56, height: 36)
                                    .background(Color.red.opacity(0.1))
                                    .background(.ultraThinMaterial.opacity(0.3))
                                    .foregroundColor(.red.opacity(0.9))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.red.opacity(0.3), lineWidth: 0.5))
                                    .cornerRadius(8)
                            }
                            .disabled(isPaused)
                        }
                        
                        Spacer()
                        
                        // RIGHT: THRUST
                        Button {} label: {
                            VStack(spacing: 3) {
                                Image(systemName: isThrustButtonPressed ? "flame.fill" : "arrow.up.circle")
                                    .font(.system(size: 28, weight: .medium))
                                Text("THRUST")
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .tracking(1)
                            }
                            .frame(width: 90, height: 90)
                            .background((isThrustButtonPressed ? Color.orange : Color.cyan).opacity(0.12))
                            .background(.ultraThinMaterial.opacity(0.4))
                            .foregroundColor(isThrustButtonPressed ? .orange : .cyan)
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke((isThrustButtonPressed ? Color.orange : Color.cyan).opacity(0.3), lineWidth: 0.5))
                            .cornerRadius(18)
                        }
                        .simultaneousGesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { _ in
                                    guard !isPaused else { return }
                                    if !isThrustButtonPressed {
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
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                    .opacity(isPaused ? 0.5 : 1)
                    .disabled(isPaused)
                }
                .opacity(uiHidden ? 0 : 1)
                
                // Navigate button - toggles transparent panel
                VStack {
                    HStack {
                        Spacer()
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                showNavigateMenu.toggle()
                            }
                        } label: {
                            Image(systemName: showNavigateMenu ? "xmark" : "ellipsis.circle")
                                .font(.system(size: 20, weight: .medium))
                                .foregroundColor(.cyan.opacity(0.8))
                                .frame(width: 40, height: 40)
                                .background(.ultraThinMaterial.opacity(0.4))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cyan.opacity(0.2), lineWidth: 0.5))
                                .cornerRadius(10)
                        }
                        .padding([.top, .trailing], 16)
                    }
                    Spacer()
                }
                .opacity(uiHidden ? 0 : 1)

                // TRANSPARENT NAVIGATE PANEL
                if showNavigateMenu {
                    HStack {
                        Spacer()
                        ScrollView {
                            VStack(alignment: .leading, spacing: 12) {
                                // FLY TO
                                Text("FLY TO")
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .foregroundColor(.cyan.opacity(0.5))
                                    .tracking(1.5)
                                    .padding(.top, 8)

                                navButton("Nearest Planet") {
                                    navigationController.evaluateJavaScript("window.galaxyExplorer?.flyToNearestPlanet?.()")
                                    AudioManager.shared.playSFX(named: "lock")
                                }
                                HStack(spacing: 6) {
                                    navButton("Sun") {
                                        navigationController.evaluateJavaScript("window.galaxyExplorer?.centerOnSun?.()")
                                        AudioManager.shared.playSFX(named: "lock")
                                    }
                                    navButton("Earth") {
                                        navigationController.flyToPlanet(named: "Earth")
                                        AudioManager.shared.playSFX(named: "lock")
                                    }
                                }
                                HStack(spacing: 6) {
                                    navButton("Mars") {
                                        navigationController.flyToPlanet(named: "Mars")
                                        AudioManager.shared.playSFX(named: "lock")
                                    }
                                    navButton("Jupiter") {
                                        navigationController.flyToPlanet(named: "Jupiter")
                                        AudioManager.shared.playSFX(named: "lock")
                                    }
                                }
                                HStack(spacing: 6) {
                                    navButton("Saturn") {
                                        navigationController.flyToPlanet(named: "Saturn")
                                        AudioManager.shared.playSFX(named: "lock")
                                    }
                                    navButton("Neptune") {
                                        navigationController.flyToPlanet(named: "Neptune")
                                        AudioManager.shared.playSFX(named: "lock")
                                    }
                                }
                                navButton("All Planets...") {
                                    showPlanetPicker = true
                                }

                                Divider().background(Color.cyan.opacity(0.2))

                                // CAPTURE
                                Text("CAPTURE")
                                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                                    .foregroundColor(.cyan.opacity(0.5))
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
                                    .foregroundColor(.cyan.opacity(0.5))
                                    .tracking(1.5)

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
                                        AudioManager.shared.setAmbientVolume(newValue ? 0.35 : 0.0)
                                    }
                            }
                            .padding(16)
                        }
                        .frame(width: 200)
                        .background(.ultraThinMaterial.opacity(0.6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.cyan.opacity(0.15), lineWidth: 0.5)
                        )
                        .cornerRadius(14)
                        .padding(.top, 70)
                        .padding(.trailing, 12)
                        .padding(.bottom, 140)
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                    .opacity(uiHidden ? 0 : 1)
                }
            }
            .onAppear {
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

                // Set ambient volume depending on spatialAudioEnabled
                let ambientVolume = spatialAudioEnabled ? 0.35 : 0.0
                AudioManager.shared.setAmbientVolume(Float(ambientVolume))

                // AUDIO: Initialize Audio Engine and preload sounds
                AudioManager.shared.start()
                AudioManager.shared.preloadCommonSFX()
                AudioManager.shared.loadAmbient(named: "space_ambience")
            }
        }
        .sheet(isPresented: $showPlanetPicker, onDismiss: {
            isPaused = false
            navigationController.resumeGame()
        }) {
            NavigationView {
                List {
                    ForEach(["Sun","Mercury","Venus","Earth","Mars","Jupiter","Saturn","Uranus","Neptune"], id: \.self) { planet in
                        Button(planet) {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            navigationController.flyToPlanet(named: planet)
                            AudioManager.shared.playSFX(named: "lock")
                            showPlanetPicker = false
                        }
                    }
                }
                .navigationTitle("Select Planet")
                .navigationBarTitleDisplayMode(.inline)
                .scrollContentBackground(.hidden)
                .background(Color(red: 0.02, green: 0.04, blue: 0.08))
            }
            .presentationBackground(.ultraThinMaterial)
        }
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
                .background(Color.cyan.opacity(0.06))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.cyan.opacity(0.15), lineWidth: 0.5))
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
