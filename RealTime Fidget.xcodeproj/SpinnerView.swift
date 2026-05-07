import SwiftUI

struct SpinnerView: View {
    @State private var angle: Double = 0
    @State private var spinning = false
    @State private var velocity: Double = 0
    
    var body: some View {
        VStack(spacing: 40) {
            Text("🌀 Spinner")
                .font(.largeTitle.bold())
                .padding(.top)
            
            Text("Swipe or tap to spin!")
                .foregroundColor(.secondary)
            
            ZStack {
                Circle()
                    .fill(AngularGradient(
                        gradient: Gradient(colors: [.cyan, .blue, .purple, .pink, .cyan]),
                        center: .center))
                    .frame(width: 180, height: 180)
                    .shadow(radius: 12)
                Image(systemName: "circle.fill")
                    .resizable()
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
            }
            .rotationEffect(.degrees(angle))
            .gesture(
                DragGesture()
                    .onEnded { value in
                        let drag = value.predictedEndTranslation.width
                        velocity = min(max(Double(drag) / 2, -1500), 1500)
                        spinning = true
                    }
            )
            .onTapGesture {
                velocity = Double.random(in: 500...1200) * (Bool.random() ? 1 : -1)
                spinning = true
            }
            .onChange(of: spinning) { new in
                if new { spin() }
            }
            .padding()
            
            Spacer()
        }
    }
    
    func spin() {
        guard spinning else { return }
        Task {
            while abs(velocity) > 0.5 {
                try? await Task.sleep(nanoseconds: 16_000_000) // ~60 FPS
                angle += velocity / 60.0
                angle.formTruncatingRemainder(dividingBy: 360)
                velocity *= 0.982 // friction
            }
            spinning = false
        }
    }
}

#Preview {
    SpinnerView()
}
