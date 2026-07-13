import SwiftUI
import AVFoundation

struct PopItView: View {
    @State private var popped: [Bool] = Array(repeating: false, count: 12)
    @State private var audioPlayer: AVAudioPlayer?
    
    let columns = [GridItem(.adaptive(minimum: 70))]
    
    var body: some View {
        VStack(spacing: 16) {
            Text("🟣 Pop-It Toy")
                .font(.largeTitle.bold())
                .padding(.top)
            
            Text("Tap to pop the bubbles!")
                .foregroundColor(.secondary)
                .padding(.bottom)
            
            LazyVGrid(columns: columns, spacing: 24) {
                ForEach(0..<popped.count, id: \.self) { i in
                    ZStack {
                        Circle()
                            .fill(popped[i] ? Color.purple.opacity(0.2) : Color.purple)
                            .frame(width: 60, height: 60)
                            .shadow(radius: popped[i] ? 0 : 5)
                            .scaleEffect(popped[i] ? 0.85 : 1.0)
                            .animation(.spring(), value: popped[i])
                        Text(popped[i] ? "💨" : "")
                    }
                    .onTapGesture {
                        withAnimation {
                            popped[i].toggle()
                            playPopSound()
                        }
                    }
                }
            }
            .padding()
            
            Button("Reset") {
                withAnimation { popped = Array(repeating: false, count: popped.count) }
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 16)
            Spacer()
        }
    }
    
    func playPopSound() {
        guard let url = Bundle.main.url(forResource: "pop", withExtension: "wav") else { return }
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.play()
        } catch {}
    }
}

#Preview {
    PopItView()
}
