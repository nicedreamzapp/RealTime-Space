import Foundation
import WebKit
import UIKit
import AVFoundation
import CoreHaptics

enum GalaxyMessageType: String {
    case navUpdate = "NAV_UPDATE"
    case setMode = "SET_MODE"
    case objectSelect = "OBJECT_SELECT"
    case status = "STATUS"
    case error = "ERROR"
    case focusObject = "FOCUS_OBJECT"
    case positionUpdate = "POSITION_UPDATE"
}

final class GalaxyBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    weak var navigationController: SpaceNavigationController?
    private var messageCount = 0
    
    // MARK: - CoreHaptics helper
    
    private static let hapticEngineHelper = HapticEngineHelper()
    
    private class HapticEngineHelper {
        private var engine: CHHapticEngine?
        private var supportsHaptics: Bool
        
        init() {
            var supports = false
            if CHHapticEngine.capabilitiesForHardware().supportsHaptics {
                supports = true
                do {
                    engine = try CHHapticEngine()
                    try engine?.start()
                } catch {
                    engine = nil
                    supports = false
                }
            }
            supportsHaptics = supports
        }
        
        func playPattern(for style: String) {
            guard supportsHaptics, let engine = engine else {
                return
            }

            let pattern: CHHapticPattern?
            switch style {
            case "success":
                // Double-tap arrival feel (like landing)
                pattern = try? CHHapticPattern(events: [
                    CHHapticEvent(eventType: .hapticTransient,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.6),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5)],
                                  relativeTime: 0),
                    CHHapticEvent(eventType: .hapticTransient,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.8)],
                                  relativeTime: 0.1)
                ], parameters: [])
            case "light":
                // Soft tap for UI interactions
                pattern = try? CHHapticPattern(events: [
                    CHHapticEvent(eventType: .hapticTransient,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.35),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.4)],
                                  relativeTime: 0)
                ], parameters: [])
            case "heavy":
                // Strong thrust/warp rumble
                pattern = try? CHHapticPattern(events: [
                    CHHapticEvent(eventType: .hapticContinuous,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.8),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.3)],
                                  relativeTime: 0,
                                  duration: 0.15),
                    CHHapticEvent(eventType: .hapticTransient,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 1.0)],
                                  relativeTime: 0.15)
                ], parameters: [])
            case "warp":
                // Escalating rumble for warp engage
                pattern = try? CHHapticPattern(events: [
                    CHHapticEvent(eventType: .hapticContinuous,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.3),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.2)],
                                  relativeTime: 0,
                                  duration: 0.3),
                    CHHapticEvent(eventType: .hapticContinuous,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.7),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5)],
                                  relativeTime: 0.2,
                                  duration: 0.2),
                    CHHapticEvent(eventType: .hapticTransient,
                                  parameters: [CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0),
                                               CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.9)],
                                  relativeTime: 0.4)
                ], parameters: [])
            default:
                pattern = nil
            }
            
            guard let p = pattern else { return }
            
            do {
                let player = try engine.makePlayer(with: p)
                try player.start(atTime: 0)
            } catch {
                // fallback silently
            }
        }
    }
    
    init(webView: WKWebView, navigationController: SpaceNavigationController? = nil) {
        self.webView = webView
        self.navigationController = navigationController
    }
    
    func send(type: GalaxyMessageType, data: [String: Any]) {
        guard let webView = webView else { return }
        
        let cleanData = cleanForJSON(data)
        
        guard JSONSerialization.isValidJSONObject(cleanData),
              let jsonData = try? JSONSerialization.data(withJSONObject: cleanData, options: []),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            print("❌ GalaxyBridge: Invalid JSON")
            return
        }

        let jsCommand = """
        (function(){
          try {
            if (window.galaxyExplorer && typeof window.galaxyExplorer.receiveNavigationUpdate === 'function') {
              window.galaxyExplorer.receiveNavigationUpdate(\(jsonString));
            }
          } catch (e) {
            console.error('bridge error:', e);
          }
        })();
        """

        messageCount += 1
        if messageCount % 30 == 0 {
            print("📤 GalaxyBridge #\(messageCount): \(type.rawValue)")
        }

        DispatchQueue.main.async {
            webView.evaluateJavaScript(jsCommand) { result, error in
                if let error = error {
                    print("❌ Bridge error: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func cleanForJSON(_ dict: [String: Any]) -> [String: Any] {
        var cleaned = [String: Any]()
        for (key, value) in dict {
            if value is NSNull {
                cleaned[key] = NSNull()
            } else if let v = value as? String {
                cleaned[key] = v
            } else if let v = value as? NSNumber {
                cleaned[key] = v
            } else if let v = value as? Bool {
                cleaned[key] = v
            } else if let v = value as? [String: Any] {
                cleaned[key] = cleanForJSON(v)
            } else if let v = value as? [Any] {
                cleaned[key] = v
            } else {
                cleaned[key] = String(describing: value)
            }
        }
        return cleaned
    }
    
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let typeString = body["type"] as? String else {
            return
        }
        
        if typeString == "HAPTIC",
           let style = body["style"] as? String {
            DispatchQueue.main.async {
                if CHHapticEngine.capabilitiesForHardware().supportsHaptics {
                    GalaxyBridge.hapticEngineHelper.playPattern(for: style)
                } else {
                    switch style {
                    case "success":
                        let generator = UINotificationFeedbackGenerator()
                        generator.notificationOccurred(.success)
                    case "light":
                        let generator = UIImpactFeedbackGenerator(style: .light)
                        generator.impactOccurred()
                    case "heavy":
                        let generator = UIImpactFeedbackGenerator(style: .heavy)
                        generator.impactOccurred()
                    default:
                        break
                    }
                }
            }
            return
        }
        
        if typeString == "POSITION_UPDATE",
           let posDict = body["position"] as? [String: Any],
           let x = posDict["x"] as? Double,
           let y = posDict["y"] as? Double,
           let z = posDict["z"] as? Double {
            DispatchQueue.main.async {
                self.navigationController?.position = Vector3D(x: Float(x), y: Float(y), z: Float(z))
            }
            return
        }
        
        if typeString == "AUDIO",
           let action = body["action"] as? String {
            DispatchQueue.main.async {
                switch action {
                case "play":
                    if let name = body["name"] as? String {
                        // name: warp, lock, arrive
                        AudioManager.shared.playSFX(named: name)
                    }
                case "ambient":
                    if let name = body["name"] as? String {
                        // name: space_ambience
                        // volume: 0.0 to 1.0
                        if name == "space_ambience" {
                            let volume: Float = {
                                if let v = body["volume"] as? Double { return Float(v) }
                                if let s = body["volume"] as? String, let v = Float(s) { return v }
                                return 1.0
                            }()
                            AudioManager.shared.setAmbientVolume(volume)
                        }
                    }
                case "playAt":
                    if let name = body["name"] as? String,
                       let posDict = body["position"] as? [String: Any],
                       let x = posDict["x"] as? Double,
                       let y = posDict["y"] as? Double,
                       let z = posDict["z"] as? Double {
                        let gain: Float = {
                            if let g = body["gain"] as? Double { return Float(g) }
                            if let s = body["gain"] as? String, let g = Float(s) { return g }
                            return 1.0
                        }()
                        AudioManager.shared.playSFX(named: name, at: SIMD3<Float>(Float(x), Float(y), Float(z)), gain: gain)
                    }
                case "listener":
                    if let posDict = body["position"] as? [String: Any],
                       let x = posDict["x"] as? Double,
                       let y = posDict["y"] as? Double,
                       let z = posDict["z"] as? Double {
                        AudioManager.shared.setListenerPosition(x: Float(x), y: Float(y), z: Float(z))
                    }
                default:
                    break
                }
            }
            return
        }
        
        if typeString == "PHOTO",
           let dataURL = body["dataURL"] as? String {
            DispatchQueue.main.async {
                self.handlePhotoDataURL(dataURL)
            }
            return
        }
        
        guard let type = GalaxyMessageType(rawValue: typeString) else {
            return
        }
        
        print("📥 Received: \(type.rawValue)")
    }
    
    private func handlePhotoDataURL(_ dataURL: String) {
        // Example dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
        let prefix = "data:image/png;base64,"
        guard dataURL.hasPrefix(prefix) else { return }
        let base64String = String(dataURL.dropFirst(prefix.count))
        guard let imageData = Data(base64Encoded: base64String),
              let image = UIImage(data: imageData) else {
            return
        }
        presentShareSheet(image: image)
    }
    
    private func presentShareSheet(image: UIImage) {
        DispatchQueue.main.async {
            guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let rootVC = windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
                return
            }
            
            var presenter = rootVC
            while let presented = presenter.presentedViewController {
                presenter = presented
            }
            
            let activityVC = UIActivityViewController(activityItems: [image], applicationActivities: nil)
            activityVC.popoverPresentationController?.sourceView = presenter.view
            presenter.present(activityVC, animated: true, completion: nil)
        }
    }
}

