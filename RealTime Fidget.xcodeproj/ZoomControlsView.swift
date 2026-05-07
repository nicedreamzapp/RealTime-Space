import SwiftUI

struct ZoomControlsView: View {
    @Binding var zoomLevel: CGFloat
    let minZoom: CGFloat
    let maxZoom: CGFloat
    let step: CGFloat

    var body: some View {
        HStack(spacing: 16) {
            Button(action: {
                if zoomLevel > minZoom {
                    zoomLevel = max(zoomLevel - step, minZoom)
                }
            }) {
                Image(systemName: "minus.magnifyingglass")
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color(.systemGray6)))
            }
            .accessibilityLabel("Zoom Out")

            Button(action: {
                if zoomLevel < maxZoom {
                    zoomLevel = min(zoomLevel + step, maxZoom)
                }
            }) {
                Image(systemName: "plus.magnifyingglass")
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color(.systemGray6)))
            }
            .accessibilityLabel("Zoom In")
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.systemBackground).opacity(0.8))
                .shadow(radius: 4)
        )
    }
}

#Preview {
    StatefulPreviewWrapper(CGFloat(1.0)) { ZoomControlsView(zoomLevel: $0, minZoom: 0.5, maxZoom: 2.0, step: 0.1) }
}

// Helper for SwiftUI preview
struct StatefulPreviewWrapper<Value>: View {
    @State private var value: Value
    var content: (Binding<Value>) -> AnyView
    init(_ value: Value, content: @escaping (Binding<Value>) -> AnyView) {
        _value = State(initialValue: value)
        self.content = content
    }
    var body: some View {
        content($value)
    }
}

extension StatefulPreviewWrapper where Value == CGFloat {
    init(_ value: CGFloat, content: @escaping (Binding<CGFloat>) -> ZoomControlsView) {
        _value = State(initialValue: value)
        self.content = { binding in AnyView(content(binding)) }
    }
}
