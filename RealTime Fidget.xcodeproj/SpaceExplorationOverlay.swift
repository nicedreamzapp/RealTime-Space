import SwiftUI

/// Liquid Glass-inspired overlay for navigation, info, and exploration controls.
/// This view overlays the main 3D scene and provides immersive, modern controls.
struct SpaceExplorationOverlay: View {
    @State private var selectedPlanet: String? = nil
    @State private var showPlanetInfo: Bool = false
    @State private var showEventBanner: Bool = false
    @State private var landingMode: Bool = false
    @State private var cameraTransitioning: Bool = false
    @State private var minigameActive: Bool = false
    
    let planetNames: [String] = [
        "Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"
    ]
    
    var body: some View {
        ZStack {
            // Liquid Glass material overlay (iOS 18+)
            if #available(iOS 18, *) {
                Rectangle()
                    .fill(.liquidGlass)
                    .ignoresSafeArea().blur(radius: 5)
                    .opacity(0.22)
            } else {
                VisualEffectBlur(blurStyle: .systemMaterialDark)
                    .ignoresSafeArea().opacity(0.3)
            }
            
            VStack {
                HStack {
                    Text("🌌 Solar System Explorer")
                        .font(.title2.bold())
                        .padding(.horizontal)
                        .foregroundColor(.white)
                    Spacer()
                }
                Spacer()
                
                // Navigation controls
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 20) {
                        ForEach(planetNames, id: \.self) { name in
                            Button(action: {
                                selectedPlanet = name
                                cameraTransitioning = true
                                // Trigger camera fly-to
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                                    cameraTransitioning = false
                                    showPlanetInfo = true
                                }
                            }) {
                                ZStack {
                                    Circle()
                                        .fill(selectedPlanet == name ? Color.blue.opacity(0.6) : Color.white.opacity(0.12))
                                        .frame(width: 50, height: 50)
                                    Text(name.prefix(2))
                                        .font(.headline.bold())
                                        .foregroundColor(.white)
                                }
                            }
                        }
                    }.padding(.vertical)
                }
                .background(.ultraThinMaterial).cornerRadius(12).padding(.bottom, 18)
                
                // Landing, events, minigames
                HStack(spacing: 20) {
                    if selectedPlanet != nil {
                        Button(action: { landingMode.toggle() }) {
                            Label("Land", systemImage: "arrow.down.circle.fill")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    Button(action: { showEventBanner.toggle() }) {
                        Label("Trigger Event", systemImage: "sparkles")
                    }
                    Button(action: { minigameActive.toggle() }) {
                        Label("Minigame", systemImage: "gamecontroller")
                    }
                }
                .padding(.bottom)
                
                if cameraTransitioning {
                    ProgressView("Navigating to \(selectedPlanet ?? "planet")…")
                        .progressViewStyle(.circular)
                        .padding()
                        .background(.regularMaterial).cornerRadius(16)
                        .transition(.opacity)
                }
            }
            .padding(.top, 32)
            .padding(.horizontal)
            
            // Info sheet for planet
            if showPlanetInfo, let planet = selectedPlanet {
                VStack {
                    Text("\(planet)")
                        .font(.largeTitle.weight(.semibold))
                    Divider().background(.white)
                    Text("Surface features, atmosphere, moons, and more info here.")
                        .font(.body).foregroundColor(.white.opacity(0.86))
                        .padding(.bottom, 10)
                    Button("Close") { showPlanetInfo = false }
                        .padding(.top, 6)
                }
                .padding()
                .frame(maxWidth: 340)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(.liquidGlass, lineWidth: 2).opacity(0.15)
                )
                .shadow(radius: 25)
                .transition(.move(edge: .bottom))
            }
            
            // Event banner
            if showEventBanner {
                VStack {
                    HStack {
                        Image(systemName: "meteor")
                            .foregroundColor(.yellow)
                        Text("Meteor shower event triggered!")
                            .bold().foregroundColor(.white)
                        Spacer()
                        Button(action: { showEventBanner = false }) {
                            Image(systemName: "xmark.circle.fill").font(.title3)
                        }.foregroundColor(.white.opacity(0.6))
                    }
                    .padding()
                }
                .background(.ultraThinMaterial, in: Capsule())
                .shadow(radius: 16)
                .transition(.move(edge: .top))
                .padding(.top, 50)
                .padding(.horizontal)
            }
            
            // Landing/Minigame overlays
            if landingMode {
                VStack(spacing: 18) {
                    Text("Landing on \(selectedPlanet ?? "planet")…")
                        .font(.title.weight(.medium))
                    ProgressView().padding()
                    Button("Abort") { landingMode = false }
                }
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
                .shadow(radius: 15)
            }
            if minigameActive {
                VStack(spacing: 16) {
                    Text("Minigame Placeholder")
                        .font(.title3.bold())
                    Text("(Insert science challenge or discovery game)")
                        .font(.body).padding(.bottom)
                    Button("Close") { minigameActive = false }
                }
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
                .shadow(radius: 15)
            }
        }
        .animation(.easeInOut, value: showPlanetInfo || showEventBanner || landingMode || minigameActive || cameraTransitioning)
    }
}

// Helper for Blur fallback (iOS < 18)
struct VisualEffectBlur: UIViewRepresentable {
    let blurStyle: UIBlurEffect.Style
    func makeUIView(context: Context) -> UIVisualEffectView {
        UIVisualEffectView(effect: UIBlurEffect(style: blurStyle))
    }
    func updateUIView(_ uiView: UIVisualEffectView, context: Context) {}
}

#Preview {
    SpaceExplorationOverlay()
}
