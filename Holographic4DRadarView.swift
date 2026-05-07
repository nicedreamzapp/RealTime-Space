import SwiftUI

// MARK: - Epic 4D Holographic Radar
// Shows the depth and scale of the universe with multiple distance layers
// "4D" = 3D space + time/depth visualization

struct Holographic4DRadarView: View {
    @ObservedObject var galaxyManager: GalaxyDataManager
    @ObservedObject var navigationController: SpaceNavigationController

    // Radar configuration
    let radarSize: CGFloat = 180
    let maxRange: Float = 2000.0  // Total scan range

    // Distance zones (in units)
    let zones: [(name: String, range: Float, color: Color)] = [
        ("NEAR", 100, .green),
        ("MID", 400, .cyan),
        ("FAR", 1000, .blue),
        ("DEEP", 2000, .purple)
    ]

    // Animation states
    @State private var scanAngle: Double = 0
    @State private var pulseScale: CGFloat = 1.0
    @State private var depthOffset: CGFloat = 0
    @State private var selectedZone: Int = 0
    @State private var showingDepthView: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            // Main radar display
            ZStack {
                // Background with depth gradient
                RadialGradient(
                    gradient: Gradient(colors: [
                        Color.black.opacity(0.9),
                        Color(red: 0.02, green: 0.05, blue: 0.1).opacity(0.95),
                        Color.black.opacity(0.98)
                    ]),
                    center: .center,
                    startRadius: 0,
                    endRadius: radarSize / 2
                )
                .clipShape(Circle())

                // Outer glow ring
                Circle()
                    .stroke(
                        AngularGradient(
                            gradient: Gradient(colors: [
                                .cyan.opacity(0.6),
                                .blue.opacity(0.3),
                                .purple.opacity(0.4),
                                .cyan.opacity(0.6)
                            ]),
                            center: .center
                        ),
                        lineWidth: 3
                    )
                    .shadow(color: .cyan.opacity(0.5), radius: 10)

                // Distance zone rings with labels
                ForEach(Array(zones.enumerated()), id: \.offset) { index, zone in
                    let scale = CGFloat(zone.range) / CGFloat(maxRange)

                    Circle()
                        .stroke(
                            zone.color.opacity(selectedZone == index ? 0.6 : 0.2),
                            lineWidth: selectedZone == index ? 2 : 1
                        )
                        .frame(width: radarSize * scale, height: radarSize * scale)

                    // Zone label
                    Text(zone.name)
                        .font(.system(size: 7, weight: .bold, design: .monospaced))
                        .foregroundColor(zone.color.opacity(0.6))
                        .offset(x: radarSize * scale / 2 - 20, y: -radarSize * scale / 2 + 8)
                }

                // Grid lines for depth perception
                ForEach(0..<8) { i in
                    let angle = Double(i) * .pi / 4
                    Path { path in
                        path.move(to: CGPoint(x: radarSize / 2, y: radarSize / 2))
                        path.addLine(to: CGPoint(
                            x: radarSize / 2 + cos(angle) * radarSize / 2,
                            y: radarSize / 2 + sin(angle) * radarSize / 2
                        ))
                    }
                    .stroke(Color.cyan.opacity(0.1), lineWidth: 1)
                }

                // Scanning beam with trail
                ScanBeamView(angle: scanAngle, size: radarSize)

                // Celestial objects with depth-based rendering
                ForEach(getObjectsInRange(), id: \.id) { object in
                    ObjectMarker4D(
                        object: object,
                        playerPosition: navigationController.position,
                        radarSize: radarSize,
                        maxRange: maxRange,
                        isSelected: navigationController.selectedTargetId == object.id
                    )
                    .onTapGesture {
                        navigationController.selectTarget(id: object.id)
                    }
                }

                // Player indicator (center) with pulse
                ZStack {
                    // Pulse ring
                    Circle()
                        .stroke(Color.green.opacity(0.3), lineWidth: 2)
                        .frame(width: 20 * pulseScale, height: 20 * pulseScale)

                    // Direction indicator (arrow shape)
                    PlayerDirectionIndicator(heading: navigationController.heading)
                        .fill(Color.green)
                        .frame(width: 12, height: 12)
                        .shadow(color: .green, radius: 5)
                }

                // Depth slice indicator (shows current "Z layer" being viewed)
                VStack {
                    Spacer()
                    DepthSliceIndicator(currentDepth: depthOffset, zones: zones)
                        .frame(height: 20)
                        .padding(.bottom, 5)
                }
            }
            .frame(width: radarSize, height: radarSize)

            // Depth control slider
            HStack(spacing: 8) {
                Image(systemName: "arrow.down.to.line")
                    .font(.system(size: 10))
                    .foregroundColor(.cyan.opacity(0.6))

                // Depth layer buttons
                ForEach(0..<zones.count, id: \.self) { index in
                    Button(action: {
                        withAnimation(.spring(response: 0.3)) {
                            selectedZone = index
                        }
                    }) {
                        Text(zones[index].name.prefix(1))
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .foregroundColor(selectedZone == index ? .white : zones[index].color)
                            .frame(width: 20, height: 16)
                            .background(
                                RoundedRectangle(cornerRadius: 3)
                                    .fill(selectedZone == index ? zones[index].color : Color.clear)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 3)
                                            .stroke(zones[index].color.opacity(0.5), lineWidth: 1)
                                    )
                            )
                    }
                }

                Image(systemName: "arrow.up.to.line")
                    .font(.system(size: 10))
                    .foregroundColor(.purple.opacity(0.6))
            }
            .padding(.top, 8)

            // Stats display
            HStack(spacing: 16) {
                StatLabel(icon: "scope", value: "\(getObjectsInRange().count)", label: "OBJ")
                StatLabel(icon: "ruler", value: formatDistance(getNearestDistance()), label: "NEAR")
            }
            .padding(.top, 6)
        }
        .onAppear {
            startAnimations()
        }
    }

    // MARK: - Helper Functions

    private func getObjectsInRange() -> [CelestialObject] {
        return galaxyManager.getObjectsInRange(
            from: navigationController.position,
            range: maxRange
        )
    }

    private func getNearestDistance() -> Float {
        let objects = getObjectsInRange()
        guard !objects.isEmpty else { return 0 }

        return objects.map { obj in
            (obj.position - navigationController.position).magnitude()
        }.min() ?? 0
    }

    private func formatDistance(_ distance: Float) -> String {
        if distance < 10 {
            return String(format: "%.1f", distance)
        } else if distance < 1000 {
            return "\(Int(distance))"
        } else {
            return String(format: "%.1fK", distance / 1000)
        }
    }

    private func startAnimations() {
        // Continuous scan rotation
        withAnimation(.linear(duration: 4).repeatForever(autoreverses: false)) {
            scanAngle = .pi * 2
        }

        // Pulse animation
        withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: true)) {
            pulseScale = 1.3
        }
    }
}

// MARK: - Scan Beam with Trail Effect

struct ScanBeamView: View {
    let angle: Double
    let size: CGFloat

    var body: some View {
        ZStack {
            // Trail (fading arc behind the beam)
            ForEach(0..<12) { i in
                let trailAngle = angle - Double(i) * 0.05
                let opacity = 0.3 - Double(i) * 0.025

                Path { path in
                    path.move(to: CGPoint(x: size / 2, y: size / 2))
                    path.addLine(to: CGPoint(
                        x: size / 2 + cos(trailAngle) * size / 2,
                        y: size / 2 + sin(trailAngle) * size / 2
                    ))
                }
                .stroke(Color.cyan.opacity(max(0, opacity)), lineWidth: 2 - CGFloat(i) * 0.15)
            }

            // Main beam
            Path { path in
                path.move(to: CGPoint(x: size / 2, y: size / 2))
                path.addLine(to: CGPoint(
                    x: size / 2 + cos(angle) * size / 2,
                    y: size / 2 + sin(angle) * size / 2
                ))
            }
            .stroke(
                LinearGradient(
                    colors: [.cyan, .cyan.opacity(0)],
                    startPoint: .center,
                    endPoint: .trailing
                ),
                lineWidth: 2
            )
            .shadow(color: .cyan, radius: 3)
        }
    }
}

// MARK: - 4D Object Marker (shows depth through visual effects)

struct ObjectMarker4D: View {
    let object: CelestialObject
    let playerPosition: SIMD3<Float>
    let radarSize: CGFloat
    let maxRange: Float
    let isSelected: Bool

    var body: some View {
        let relativePos = object.position - playerPosition
        let distance = relativePos.magnitude()
        let normalizedDist = min(CGFloat(distance / maxRange), 1.0)

        // Calculate radar position
        let angle = atan2(relativePos.x, relativePos.z)
        let radarX = CGFloat(cos(Double(angle))) * normalizedDist * radarSize / 2
        let radarY = CGFloat(sin(Double(angle))) * normalizedDist * radarSize / 2

        // Depth affects size and opacity (further = smaller, dimmer)
        let depthFactor = 1.0 - normalizedDist * 0.7
        let baseSize = getBaseSize() * depthFactor

        ZStack {
            // Outer glow (stronger when selected)
            Circle()
                .fill(getColor().opacity(isSelected ? 0.4 : 0.15))
                .frame(width: baseSize * 2.5, height: baseSize * 2.5)
                .blur(radius: 3)

            // Main marker with depth ring
            Circle()
                .stroke(getColor().opacity(0.6), lineWidth: isSelected ? 2 : 1)
                .frame(width: baseSize * 1.5, height: baseSize * 1.5)

            // Core
            Circle()
                .fill(getColor())
                .frame(width: baseSize, height: baseSize)

            // Distance indicator (small number)
            if distance > 50 {
                Text(formatDist(distance))
                    .font(.system(size: 6, weight: .bold, design: .monospaced))
                    .foregroundColor(getColor().opacity(0.8))
                    .offset(y: baseSize + 6)
            }

            // Selection ring
            if isSelected {
                Circle()
                    .stroke(Color.white, lineWidth: 1.5)
                    .frame(width: baseSize * 2, height: baseSize * 2)

                // Name label
                Text(object.name)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(.white)
                    .offset(y: -baseSize - 10)
            }
        }
        .position(x: radarSize / 2 + radarX, y: radarSize / 2 + radarY)
    }

    private func getBaseSize() -> CGFloat {
        switch object.type {
        case .star: return 14
        case .planet: return 10
        case .blackHole: return 12
        case .moon: return 6
        case .nebula: return 8
        default: return 5
        }
    }

    private func getColor() -> Color {
        switch object.type {
        case .star: return .yellow
        case .planet: return Color(hex: object.color) ?? .cyan
        case .blackHole: return .purple
        case .moon: return .gray
        case .nebula: return .pink
        case .asteroid: return .orange
        default: return .cyan
        }
    }

    private func formatDist(_ d: Float) -> String {
        if d < 100 { return "\(Int(d))" }
        return "\(Int(d/100))c"
    }
}

// MARK: - Player Direction Indicator

struct PlayerDirectionIndicator: Shape {
    let heading: Float

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let size = min(rect.width, rect.height) / 2

        // Arrow pointing up (forward direction)
        path.move(to: CGPoint(x: center.x, y: center.y - size))
        path.addLine(to: CGPoint(x: center.x - size * 0.6, y: center.y + size * 0.5))
        path.addLine(to: CGPoint(x: center.x, y: center.y + size * 0.1))
        path.addLine(to: CGPoint(x: center.x + size * 0.6, y: center.y + size * 0.5))
        path.closeSubpath()

        return path
    }
}

// MARK: - Depth Slice Indicator

struct DepthSliceIndicator: View {
    let currentDepth: CGFloat
    let zones: [(name: String, range: Float, color: Color)]

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                // Background track
                Capsule()
                    .fill(Color.black.opacity(0.5))
                    .frame(height: 6)

                // Zone colors
                HStack(spacing: 0) {
                    ForEach(Array(zones.enumerated()), id: \.offset) { index, zone in
                        Rectangle()
                            .fill(zone.color.opacity(0.4))
                            .frame(width: geo.size.width / CGFloat(zones.count))
                    }
                }
                .frame(height: 6)
                .clipShape(Capsule())

                // Current depth indicator
                Circle()
                    .fill(Color.white)
                    .frame(width: 10, height: 10)
                    .shadow(color: .cyan, radius: 3)
                    .offset(x: currentDepth * geo.size.width - 5)
            }
        }
    }
}

// MARK: - Stat Label

struct StatLabel: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 8))
                .foregroundColor(.cyan.opacity(0.6))

            Text(value)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(.white)

            Text(label)
                .font(.system(size: 7, weight: .medium))
                .foregroundColor(.cyan.opacity(0.5))
        }
    }
}

// MARK: - Preview

#Preview {
    Holographic4DRadarView(
        galaxyManager: GalaxyDataManager(),
        navigationController: SpaceNavigationController()
    )
    .frame(width: 200, height: 260)
    .background(Color.black)
}
