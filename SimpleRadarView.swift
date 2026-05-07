import SwiftUI

struct SimpleRadarView: View {
    @ObservedObject var galaxyManager: GalaxyDataManager
    @ObservedObject var navigationController: SpaceNavigationController

    let radarRadius: CGFloat = 55
    let scanRange: CGFloat = 800.0

    @State private var sweepAngle: Double = 0
    @State private var pulseScale: CGFloat = 1.0
    @State private var glowOpacity: Double = 0.6

    var body: some View {
        GeometryReader { geometry in
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)

            ZStack {
                // 3D-style background with gradient depth
                Ellipse()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0, green: 0.15, blue: 0.2).opacity(0.5),
                                Color(red: 0, green: 0.08, blue: 0.12).opacity(0.3),
                                Color.black.opacity(0.2)
                            ],
                            center: .center,
                            startRadius: 0,
                            endRadius: radarRadius
                        )
                    )
                    .frame(width: radarRadius * 2, height: radarRadius * 2)

                // Outer ring with glow
                Circle()
                    .stroke(Color.cyan.opacity(0.5), lineWidth: 1.5)
                    .frame(width: radarRadius * 2, height: radarRadius * 2)
                    .shadow(color: .cyan.opacity(0.3), radius: 4)

                // 3D perspective grid rings (slightly elliptical for depth)
                ForEach([0.25, 0.5, 0.75], id: \.self) { scale in
                    Ellipse()
                        .stroke(Color.cyan.opacity(0.15), lineWidth: 0.5)
                        .frame(
                            width: radarRadius * 2 * scale,
                            height: radarRadius * 2 * scale * 0.85 // Slight perspective squash
                        )
                        .offset(y: radarRadius * scale * 0.05) // Slight downward offset for 3D
                }

                // Subtle crosshair lines
                Path { path in
                    path.move(to: CGPoint(x: center.x, y: center.y - radarRadius + 8))
                    path.addLine(to: CGPoint(x: center.x, y: center.y + radarRadius - 8))
                }
                .stroke(Color.cyan.opacity(0.12), lineWidth: 0.5)

                Path { path in
                    path.move(to: CGPoint(x: center.x - radarRadius + 8, y: center.y))
                    path.addLine(to: CGPoint(x: center.x + radarRadius - 8, y: center.y))
                }
                .stroke(Color.cyan.opacity(0.12), lineWidth: 0.5)

                // Sweep beam with gradient trail
                SweepBeamShape(angle: sweepAngle, radius: radarRadius)
                    .fill(
                        AngularGradient(
                            colors: [
                                .cyan.opacity(0.5),
                                .cyan.opacity(0.3),
                                .cyan.opacity(0.1),
                                .clear
                            ],
                            center: .center,
                            startAngle: .radians(sweepAngle - 0.5),
                            endAngle: .radians(sweepAngle)
                        )
                    )
                    .frame(width: radarRadius * 2, height: radarRadius * 2)
                    .clipShape(Circle())

                // Sweep line
                Path { path in
                    path.move(to: center)
                    path.addLine(to: CGPoint(
                        x: center.x + cos(sweepAngle) * radarRadius,
                        y: center.y + sin(sweepAngle) * radarRadius
                    ))
                }
                .stroke(Color.cyan.opacity(0.7), lineWidth: 1)

                // Objects on radar
                ForEach(getNearbyObjects(), id: \.id) { object in
                    let radarPos = calculateRadarPosition(for: object, center: center)
                    let isInBounds = isPositionInBounds(radarPos, center: center)

                    if isInBounds {
                        RadarBlip(
                            object: object,
                            position: radarPos,
                            color: getObjectColor(for: object),
                            size: getObjectSize(for: object),
                            isSelected: navigationController.selectedTargetId == object.id,
                            onTap: {
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                navigationController.flyToPlanet(named: object.name)
                            }
                        )
                    }
                }

                // Center dot (you) with pulse
                Circle()
                    .fill(Color.green)
                    .frame(width: 5, height: 5)
                    .shadow(color: .green.opacity(0.8), radius: 3)
                    .overlay(
                        Circle()
                            .stroke(Color.green.opacity(0.3), lineWidth: 0.5)
                            .frame(width: 12, height: 12)
                            .scaleEffect(pulseScale)
                            .opacity(2 - pulseScale)
                    )

                // Range label
                Text("\(Int(scanRange))")
                    .font(.system(size: 7, weight: .medium, design: .monospaced))
                    .foregroundColor(.cyan.opacity(0.35))
                    .position(x: center.x + radarRadius - 14, y: center.y + radarRadius - 6)
            }
            .frame(width: radarRadius * 2, height: radarRadius * 2)
        }
        .onAppear {
            startAnimations()
        }
    }

    // MARK: - Data

    private func getNearbyObjects() -> [CelestialObject] {
        return galaxyManager.getObjectsInRange(
            from: navigationController.position,
            range: Float(scanRange)
        )
    }

    private func calculateRadarPosition(for object: CelestialObject, center: CGPoint) -> CGPoint {
        let playerPos = navigationController.position
        let relativePos = object.position - playerPos

        let distance = CGFloat(relativePos.magnitude())
        // Non-linear mapping: closer objects spread out more, far objects compress
        let normalizedDist = min(pow(distance / scanRange, 0.7), 1.0)

        let angle = CGFloat(atan2(relativePos.x, relativePos.z))

        let x = center.x + cos(angle) * normalizedDist * (radarRadius - 4)
        let y = center.y + sin(angle) * normalizedDist * (radarRadius - 4)

        return CGPoint(x: x, y: y)
    }

    private func isPositionInBounds(_ pos: CGPoint, center: CGPoint) -> Bool {
        let dx = pos.x - center.x
        let dy = pos.y - center.y
        return sqrt(dx * dx + dy * dy) < radarRadius - 2
    }

    private func getObjectColor(for object: CelestialObject) -> Color {
        switch object.type {
        case .star:
            return .yellow
        case .planet:
            // Use distinct colors per planet name for easy identification
            switch object.name.lowercased() {
            case "mercury": return Color(red: 0.6, green: 0.5, blue: 0.4)
            case "venus": return Color(red: 0.9, green: 0.8, blue: 0.4)
            case "earth": return Color(red: 0.2, green: 0.6, blue: 1.0)
            case "mars": return Color(red: 0.9, green: 0.35, blue: 0.2)
            case "jupiter": return Color(red: 0.85, green: 0.65, blue: 0.4)
            case "saturn": return Color(red: 0.95, green: 0.85, blue: 0.5)
            case "uranus": return Color(red: 0.5, green: 0.8, blue: 0.9)
            case "neptune": return Color(red: 0.25, green: 0.35, blue: 0.9)
            default: return Color(hex: object.color) ?? .cyan
            }
        case .moon:
            return .gray
        case .asteroid:
            return Color(red: 0.5, green: 0.4, blue: 0.3)
        case .blackHole:
            return .purple
        case .nebula:
            return Color(red: 1, green: 0.3, blue: 0.5)
        case .galaxy:
            return .white
        case .neutronStar:
            return Color(red: 0.4, green: 0.6, blue: 1.0)
        default:
            return .cyan
        }
    }

    private func getObjectSize(for object: CelestialObject) -> CGFloat {
        switch object.type {
        case .star: return 7
        case .planet:
            // Size relative to actual planet size
            let baseSize: CGFloat = 4
            return min(baseSize + CGFloat(object.radius) * 0.3, 8)
        case .moon: return 3
        case .blackHole: return 8
        default: return 4
        }
    }

    // MARK: - Animations

    private func startAnimations() {
        // Sweep rotation
        withAnimation(.linear(duration: 3.0).repeatForever(autoreverses: false)) {
            sweepAngle = .pi * 2
        }
        // Center pulse
        withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: false)) {
            pulseScale = 2.0
        }
    }
}

// MARK: - Sweep Beam Shape

struct SweepBeamShape: Shape {
    var angle: Double
    var radius: CGFloat

    var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        var path = Path()

        // Draw a pie slice trailing behind the sweep line
        let trailAngle = 0.4 // radians of trail
        path.move(to: center)
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .radians(angle - trailAngle),
            endAngle: .radians(angle),
            clockwise: false
        )
        path.closeSubpath()

        return path
    }
}

// MARK: - Radar Blip

struct RadarBlip: View {
    let object: CelestialObject
    let position: CGPoint
    let color: Color
    let size: CGFloat
    let isSelected: Bool
    let onTap: () -> Void

    @State private var blipPulse: CGFloat = 1.0

    var body: some View {
        ZStack {
            // Outer glow
            Circle()
                .fill(color.opacity(0.25))
                .frame(width: size * 2.5, height: size * 2.5)
                .scaleEffect(blipPulse)

            // Core dot
            Circle()
                .fill(color)
                .frame(width: size, height: size)
                .shadow(color: color.opacity(0.8), radius: 3)

            // Selection ring
            if isSelected {
                Circle()
                    .stroke(Color.white.opacity(0.7), lineWidth: 1)
                    .frame(width: size + 6, height: size + 6)
            }

            // Label for planets and stars
            if object.type == .star || object.type == .planet {
                Text(shortName(object.name))
                    .font(.system(size: 6, weight: .bold, design: .monospaced))
                    .foregroundColor(color.opacity(0.8))
                    .offset(y: size + 5)
            }
        }
        .position(position)
        .onTapGesture { onTap() }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                blipPulse = 1.3
            }
        }
    }

    private func shortName(_ name: String) -> String {
        // Abbreviate long names
        switch name.lowercased() {
        case "mercury": return "MER"
        case "venus": return "VEN"
        case "earth": return "EAR"
        case "mars": return "MAR"
        case "jupiter": return "JUP"
        case "saturn": return "SAT"
        case "uranus": return "URA"
        case "neptune": return "NEP"
        case "sun": return "SUN"
        default:
            return String(name.prefix(3)).uppercased()
        }
    }
}

// Helper for hex color conversion
extension Color {
    init?(hex: Int, alpha: Double = 1.0) {
        let red = Double((hex >> 16) & 0xFF) / 255.0
        let green = Double((hex >> 8) & 0xFF) / 255.0
        let blue = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

#Preview {
    SimpleRadarView(
        galaxyManager: GalaxyDataManager(),
        navigationController: SpaceNavigationController()
    )
    .frame(width: 120, height: 120)
    .background(.black)
}
