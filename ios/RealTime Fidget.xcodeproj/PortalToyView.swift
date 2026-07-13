import SwiftUI

struct PortalToyView: View {
    @State private var portalOffset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var portalScale: CGFloat = 1.0
    @State private var colorFilter: Double = 0
    
    var body: some View {
        VStack(spacing: 18) {
            Text("🌀 Portal Explorer")
                .font(.title.bold())
                .padding(.top)
            
            Text("Drag, zoom, and play with the portal!")
                .foregroundColor(.secondary)
            
            ZStack {
                Color.black.opacity(0.12)
                    .ignoresSafeArea()
                
                PortalWebView(fileName: "portal")
                    .frame(width: 260 * portalScale, height: 260 * portalScale)
                    .clipShape(RoundedRectangle(cornerRadius: 28))
                    .overlay(
                        RoundedRectangle(cornerRadius: 28)
                            .stroke(Color.blue.opacity(0.8), lineWidth: 4)
                            .shadow(color: .blue.opacity(0.25), radius: 8, x: 0, y: 6)
                    )
                    .colorMultiply(Color(hue: colorFilter, saturation: 0.17, brightness: 1))
                    .offset(portalOffset)
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                portalOffset = CGSize(width: lastOffset.width + value.translation.width, height: lastOffset.height + value.translation.height)
                            }
                            .onEnded { _ in lastOffset = portalOffset }
                    )
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                portalScale = min(max(value, 0.5), 2.2)
                            }
                    )
            }
            .frame(height: 320)
            
            HStack(spacing: 16) {
                Text("Color filter")
                Slider(value: $colorFilter, in: 0...1)
            }
            .padding(.horizontal, 20)
            
            Spacer()
        }
        .background(Color(.systemBackground))
    }
}

#Preview {
    PortalToyView()
}
