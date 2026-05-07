import SwiftUI
import Foundation
import Combine
import WebKit

class SpaceNavigationController: ObservableObject {
    weak var webView: WKWebView?

    @Published var position = Vector3D(x: 0, y: 0, z: 25)
    @Published var velocity = Vector3D(x: 0, y: 0, z: 0)
    @Published var rotation = Vector3D(x: 0, y: 0, z: 0)
    
    @Published var currentMode: NavigationMode = .cruise
    @Published var isThrusting = false
    @Published var targetObject: SpaceObject? = nil
    @Published var selectedTargetId: String? = nil
    @Published var autoAlignToTarget: Bool = false
    @Published var autoApproachTarget: Bool = false
    @Published var focusTargetId: String? = nil
    
    var thrustVector = Vector3D(x: 0, y: 0, z: 0)
    
    // Build a JSON-safe navigation payload for the JS bridge
    private func cleanNavPayload() -> [String: Any] {
        var payload: [String: Any] = [
            "position": ["x": position.x, "y": position.y, "z": position.z],
            "velocity": ["x": velocity.x, "y": velocity.y, "z": velocity.z],
            "rotation": ["x": rotation.x, "y": rotation.y, "z": rotation.z],
            "isThrusting": isThrusting,
            "autoAlignToTarget": autoAlignToTarget,
            "autoApproachTarget": autoApproachTarget
        ]
        if let selectedTargetId {
            payload["selectedTargetId"] = selectedTargetId
        } else {
            payload["selectedTargetId"] = NSNull()
        }
        return payload
    }

    // Optional: Serialize payload to JSON for debugging or bridge consumption
    private func jsonString(from dict: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(dict) else {
            print("GalaxyBridge: Payload is not a valid JSON object")
            return nil
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: dict, options: [])
            return String(data: data, encoding: .utf8)
        } catch {
            print("GalaxyBridge: Failed to serialize JSON - \(error)")
            return nil
        }
    }
    
    var navStatePayload: [String: Any] {
        return [
            "position": ["x": position.x, "y": position.y, "z": position.z],
            "velocity": ["x": velocity.x, "y": velocity.y, "z": velocity.z],
            "rotation": ["x": rotation.x, "y": rotation.y, "z": rotation.z],
            "isThrusting": isThrusting,
            "selectedTargetId": selectedTargetId as Any,
            "autoAlignToTarget": autoAlignToTarget,
            "autoApproachTarget": autoApproachTarget
        ]
    }
    
    init() {
        print("SpaceNavigationController created - camera-based mode")
    }
    
    enum NavigationMode: CaseIterable {
        case freeFloat, cruise, orbital, hyperspace, directDrive
        
        var displayName: String {
            switch self {
            case .freeFloat: return "FREE"
            case .cruise: return "CRUISE"
            case .orbital: return "ORBITAL"
            case .hyperspace: return "HYPER"
            case .directDrive: return "DIRECT"
            }
        }
    }
    
    func update(deltaTime: Float) {
        // JavaScript handles all physics
    }
    
    func setThrustVector(_ vector: Vector3D) {
        thrustVector = vector
        isThrusting = vector.magnitude() > 0.01
    }
    
    func setRotationInput(_ rot: Vector3D) {
        // CRITICAL FIX: Update the @Published rotation property!
        self.rotation = rot
        
        NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": cleanNavPayload()])
    }
    
    func setNavigationMode(_ mode: NavigationMode) {
        currentMode = mode
    }
    
    func setTarget(_ object: SpaceObject?) {
        targetObject = object
        selectedTargetId = object?.name
        if object != nil {
            currentMode = .orbital
        }
    }
    
    func selectTarget(id: String?) {
        self.selectedTargetId = id
        NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": cleanNavPayload()])
    }
    
    func focusOnSelectedTarget() {
        // Trigger a one-shot focus request that the WebView bridge will consume
        self.focusTargetId = self.selectedTargetId
    }
    
    func thrustForward() {
        isThrusting = true
        thrustVector = Vector3D(x: 0, y: 0, z: -1)
        NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": cleanNavPayload()])
    }
    
    func thrustBackward() {
        isThrusting = true
        thrustVector = Vector3D(x: 0, y: 0, z: 1)
    }
    
    func stopThrust() {
        thrustVector = Vector3D(x: 0, y: 0, z: 0)
        isThrusting = false
        NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": cleanNavPayload()])
    }
    
    func emergencyStop() {
        stopThrust()
        rotation = Vector3D(x: 0, y: 0, z: 0)
        NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": cleanNavPayload()])
    }
    
    func turnAround() {
        rotation.y += .pi
        NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": cleanNavPayload()])
    }
    
    public func attachWebView(_ webView: WKWebView) {
        self.webView = webView
    }
    
    public func evaluateJavaScript(_ script: String) {
        DispatchQueue.main.async {
            if let webView = self.webView {
                webView.evaluateJavaScript(script, completionHandler: nil)
            } else {
                print("Warning: No WKWebView attached to SpaceNavigationController")
            }
        }
    }
    
    public func pauseGame() {
        evaluateJavaScript("window.pauseExploration && window.pauseExploration();")
        // Optionally: set an internal state for paused logic.
    }
    
    public func resumeGame() {
        evaluateJavaScript("window.resumeExploration && window.resumeExploration();")
        // Optionally: clear paused state.
    }
}

struct SpaceObject {
    let id: String
    let name: String
    let position: Vector3D
    let mass: Float
    let radius: Float
    let type: ObjectType
    
    enum ObjectType {
        case star, planet, moon, asteroid, blackHole, nebula, galaxy, exoplanet
    }
}

private extension Notification.Name {
    static let workingPortalNavUpdate = Notification.Name("WorkingPortalWebView.navUpdate")
}
