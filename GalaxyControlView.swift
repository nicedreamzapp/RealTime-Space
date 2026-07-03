import SwiftUI

struct GalaxyControlView: View {
    @ObservedObject var navigationController: SpaceNavigationController
    @ObservedObject var galaxyManager: GalaxyDataManager
    
    @State private var joystickOffset = CGSize.zero
    @State private var isJoystickActive = false
    @State private var isThrustButtonPressed = false
    
    let joystickRadius: CGFloat = 80
    let knobRadius: CGFloat = 25
    
    var body: some View {
        ZStack {
            WorkingPortalWebView(
                fileName: "index",
                navigationController: navigationController,
                galaxyManager: galaxyManager
            )
            .ignoresSafeArea()
            
            VStack {
                // TOP BAR
                HStack {
                    Spacer()
                    Button("STOP") {
                        print("🛑 EMERGENCY STOP")
                        navigationController.emergencyStop()
                        joystickOffset = .zero
                        isJoystickActive = false
                        isThrustButtonPressed = false
                    }
                    .font(.caption).bold()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                    .foregroundStyle(.white)
                }
                .padding()
                
                Spacer()
                
                // BOTTOM CONTROLS
                HStack(alignment: .bottom) {
                    // LEFT: JOYSTICK
                    ZStack {
                        Circle()
                            .fill(.ultraThinMaterial)
                            .frame(width: joystickRadius * 2, height: joystickRadius * 2)
                            .overlay(Circle().stroke(Color.cyan, lineWidth: 2))
                        
                        Circle()
                            .fill(LinearGradient(colors: [.cyan, .blue], startPoint: .top, endPoint: .bottom))
                            .frame(width: knobRadius * 2, height: knobRadius * 2)
                            .offset(joystickOffset)
                            .gesture(
                                DragGesture(minimumDistance: 0)
                                    .onChanged { value in
                                        isJoystickActive = true
                                        let dx = value.translation.width
                                        let dy = value.translation.height
                                        let distance = sqrt(dx * dx + dy * dy)
                                        if distance <= joystickRadius {
                                            joystickOffset = value.translation
                                        } else {
                                            let ratio = joystickRadius / distance
                                            joystickOffset = CGSize(width: dx * ratio, height: dy * ratio)
                                        }
                                        
                                        // Normalize to -1 to 1 range for analog sensitivity
                                        let nx = Float(joystickOffset.width / joystickRadius)
                                        let ny = Float(joystickOffset.height / joystickRadius)

                                        // Small deadzone, but preserve analog magnitude for JavaScript
                                        let deadzone: Float = 0.08
                                        let magnitude = sqrt(nx * nx + ny * ny)

                                        if magnitude < deadzone {
                                            navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
                                        } else {
                                            // Send normalized values (-1 to 1) - JS handles analog sensitivity
                                            navigationController.setRotationInput(Vector3D(x: -ny, y: nx, z: 0))
                                        }
                                    }
                                    .onEnded { _ in
                                        isJoystickActive = false
                                        joystickOffset = .zero
                                        navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
                                    }
                            )
                    }
                    .frame(width: 200, height: 200)
                    
                    Spacer()
                    
                    // RIGHT: Controls
                    VStack(alignment: .trailing, spacing: 10) {
                        // Thrust button
                        Button {
                            isThrustButtonPressed.toggle()
                            if isThrustButtonPressed {
                                navigationController.thrustForward()
                            } else {
                                navigationController.stopThrust()
                            }
                        } label: {
                            Text(isThrustButtonPressed ? "THRUSTING" : "THRUST")
                                .font(.caption)
                                .bold()
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(isThrustButtonPressed ? Color.orange : Color.cyan)
                                .foregroundStyle(.white)
                                .cornerRadius(8)
                        }
                        
                        // Target lock
                        Button {
                            if let nearest = galaxyManager.findNearestObject(to: navigationController.position) {
                                navigationController.selectTarget(id: nearest.id)
                                navigationController.autoAlignToTarget = true
                            }
                        } label: {
                            Label("Lock Target", systemImage: "scope")
                                .font(.caption)
                                .bold()
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(navigationController.autoAlignToTarget ? Color.green : Color.gray)
                                .foregroundStyle(.white)
                                .cornerRadius(8)
                        }
                        
                        // Auto-approach
                        Button {
                            navigationController.autoApproachTarget.toggle()
                        } label: {
                            Label("Auto-pilot", systemImage: "location.north.line")
                                .font(.caption)
                                .bold()
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(navigationController.autoApproachTarget ? Color.green : Color.gray)
                                .foregroundStyle(.white)
                                .cornerRadius(8)
                        }
                        
                        // Cancel
                        Button {
                            navigationController.autoAlignToTarget = false
                            navigationController.autoApproachTarget = false
                            navigationController.selectedTargetId = nil
                        } label: {
                            Label("Cancel", systemImage: "xmark.circle")
                                .font(.caption)
                                .bold()
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(.red)
                                .foregroundStyle(.white)
                                .cornerRadius(8)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
            }
            // Hide the native flight controls while a Codex card / Field Guide is open,
            // so nothing floats over the modal. Disable hit-testing too so taps go to the card.
            .opacity(navigationController.hideChrome ? 0 : 1)
            .allowsHitTesting(!navigationController.hideChrome)
            .animation(.easeInOut(duration: 0.2), value: navigationController.hideChrome)
        }
        .onChange(of: isJoystickActive) { oldValue, newValue in
            if !newValue {
                navigationController.setRotationInput(Vector3D(x: 0, y: 0, z: 0))
            }
        }
        .onChange(of: isThrustButtonPressed) { oldValue, newValue in
            if newValue {
                navigationController.thrustForward()
            } else {
                navigationController.stopThrust()
            }
        }
    }
}

#Preview {
    GalaxyControlView(
        navigationController: SpaceNavigationController(),
        galaxyManager: GalaxyDataManager()
    )
}
