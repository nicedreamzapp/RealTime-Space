import SwiftUI

/// Heading-up navigation radar. Forward (where you're pointed) is the TOP of the disc,
/// so a blip at the top is dead ahead, left means turn left. Fed live by the 3D engine
/// via `navigationController.radarContacts` (camera-relative bearings). Tap a blip to fly.
struct SimpleRadarView: View {
    @ObservedObject var galaxyManager: GalaxyDataManager
    @ObservedObject var navigationController: SpaceNavigationController

    private let radius: CGFloat = 55

    var body: some View {
        GeometryReader { geo in
            let center = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)

            ZStack {
                // Disc
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color(red: 0, green: 0.12, blue: 0.16).opacity(0.55),
                                     Color.black.opacity(0.35)],
                            center: .center, startRadius: 0, endRadius: radius)
                    )
                    .frame(width: radius * 2, height: radius * 2)

                // Range rings + rim
                ForEach([0.5, 1.0], id: \.self) { s in
                    Circle()
                        .stroke(Color.cyan.opacity(s == 1.0 ? 0.45 : 0.15),
                                lineWidth: s == 1.0 ? 1.2 : 0.5)
                        .frame(width: radius * 2 * s, height: radius * 2 * s)
                }

                // Forward cone — shows the slice of space straight ahead of you
                ForwardCone(radius: radius)
                    .fill(LinearGradient(colors: [Color.cyan.opacity(0.18), .clear],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(width: radius * 2, height: radius * 2)

                // "FWD" marker at the top
                Text("FWD")
                    .font(.system(size: 7, weight: .heavy, design: .monospaced))
                    .foregroundColor(.cyan.opacity(0.7))
                    .position(x: center.x, y: center.y - radius + 7)

                // Contacts (already heading-relative from the engine)
                ForEach(navigationController.radarContacts) { c in
                    let pos = CGPoint(x: center.x + c.rx * (radius - 6),
                                      y: center.y - c.ry * (radius - 6))
                    ContactBlip(
                        contact: c,
                        color: color(for: c),
                        isSelected: navigationController.selectedTargetId == c.id
                    )
                    .position(pos)
                    .onTapGesture {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        navigationController.flyToPlanet(named: c.name)
                    }
                }

                // You — center
                Circle()
                    .fill(Color.green)
                    .frame(width: 6, height: 6)
                    .shadow(color: .green.opacity(0.9), radius: 3)
            }
            .frame(width: radius * 2, height: radius * 2)
            .position(center)
        }
    }

    private func color(for c: SpaceNavigationController.RadarContact) -> Color {
        switch c.type.lowercased() {
        case "star": return .yellow
        case "blackhole", "black_hole": return .purple
        case "nebula": return Color(red: 1, green: 0.4, blue: 0.6)
        case "moon": return .gray
        case "asteroid": return Color(red: 0.6, green: 0.5, blue: 0.4)
        default:
            switch c.name.lowercased() {
            case "earth": return Color(red: 0.3, green: 0.65, blue: 1.0)
            case "mars": return Color(red: 0.95, green: 0.4, blue: 0.25)
            case "jupiter": return Color(red: 0.85, green: 0.65, blue: 0.4)
            case "saturn": return Color(red: 0.95, green: 0.85, blue: 0.55)
            case "venus": return Color(red: 0.95, green: 0.82, blue: 0.45)
            case "neptune", "uranus": return Color(red: 0.4, green: 0.7, blue: 0.95)
            default: return .cyan
            }
        }
    }
}

/// A blip: dot + (for big bodies) a short name and live distance.
private struct ContactBlip: View {
    let contact: SpaceNavigationController.RadarContact
    let color: Color
    let isSelected: Bool

    var body: some View {
        let big = contact.type.lowercased() == "planet" || contact.type.lowercased() == "star"
        ZStack {
            if isSelected {
                Circle().stroke(Color.white.opacity(0.8), lineWidth: 1)
                    .frame(width: 14, height: 14)
            }
            Circle()
                .fill(color)
                .frame(width: big ? 6 : 4, height: big ? 6 : 4)
                .shadow(color: color.opacity(0.9), radius: 2)

            if big {
                VStack(spacing: 0) {
                    Text(shortName(contact.name))
                        .font(.system(size: 6.5, weight: .bold, design: .monospaced))
                        .foregroundColor(color)
                    Text(formatDist(contact.dist))
                        .font(.system(size: 5.5, weight: .medium, design: .monospaced))
                        .foregroundColor(color.opacity(0.6))
                }
                .offset(y: 11)
                .fixedSize()
            }
        }
    }

    private func formatDist(_ d: Int) -> String {
        d >= 1000 ? String(format: "%.1fk", Double(d) / 1000.0) : "\(d)"
    }

    private func shortName(_ name: String) -> String {
        let map = ["mercury": "MER", "venus": "VEN", "earth": "EAR", "mars": "MAR",
                   "jupiter": "JUP", "saturn": "SAT", "uranus": "URA", "neptune": "NEP",
                   "sun": "SUN"]
        return map[name.lowercased()] ?? String(name.prefix(3)).uppercased()
    }
}

/// Triangular "straight ahead" cone from center toward the top of the disc.
private struct ForwardCone: Shape {
    let radius: CGFloat
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        var p = Path()
        p.move(to: c)
        p.addArc(center: c, radius: radius,
                 startAngle: .degrees(-90 - 22), endAngle: .degrees(-90 + 22), clockwise: false)
        p.closeSubpath()
        return p
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
    SimpleRadarView(galaxyManager: GalaxyDataManager(),
                    navigationController: SpaceNavigationController())
    .frame(width: 120, height: 120)
    .background(.black)
}
