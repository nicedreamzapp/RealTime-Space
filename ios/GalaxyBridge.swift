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
    
    // Coalescing state for high-frequency nav updates: keep only ONE evaluateJavaScript
    // in flight at a time and always send the latest payload. The joystick can fire 60+
    // updates/sec; without this, the backlog of cross-process JS calls starves the WebGL
    // render loop down to a few fps (the "goes black when I fly" bug).
    private var navInFlight = false
    private var pendingNavJSON: String?

    func send(type: GalaxyMessageType, data: [String: Any]) {
        guard webView != nil else { return }

        let cleanData = cleanForJSON(data)

        guard JSONSerialization.isValidJSONObject(cleanData),
              let jsonData = try? JSONSerialization.data(withJSONObject: cleanData, options: []),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            print("❌ GalaxyBridge: Invalid JSON")
            return
        }

        // Nav updates are coalesced (latest-wins, one-in-flight). Everything else sends now.
        if type == .navUpdate {
            pendingNavJSON = jsonString
            if !navInFlight { flushNav() }
            return
        }

        evaluate(jsonString: jsonString)
    }

    private func flushNav() {
        guard let webView = webView, let json = pendingNavJSON else { return }
        pendingNavJSON = nil
        navInFlight = true

        messageCount += 1
        if messageCount % 60 == 0 {
            print("📤 GalaxyBridge nav #\(messageCount)")
        }

        let jsCommand = navScript(json)
        DispatchQueue.main.async {
            webView.evaluateJavaScript(jsCommand) { [weak self] _, _ in
                guard let self = self else { return }
                self.navInFlight = false
                // If more arrived while we were mid-flight, send the latest one now.
                if self.pendingNavJSON != nil { self.flushNav() }
            }
        }
    }

    // Push the current navigation state to JS (used for the READY handshake so held
    // thrust/rotation survives the web engine's boot window).
    func resendNavState() {
        guard let nav = navigationController else { return }
        var data: [String: Any] = [
            "rotation": ["x": nav.rotation.x, "y": nav.rotation.y, "z": nav.rotation.z],
            "isThrusting": nav.isThrusting,
            "autoAlignToTarget": nav.autoAlignToTarget,
            "autoApproachTarget": nav.autoApproachTarget
        ]
        if let id = nav.selectedTargetId {
            data["selectedTargetId"] = id
        } else {
            data["selectedTargetId"] = NSNull()
        }
        send(type: .navUpdate, data: data)
    }

    private func evaluate(jsonString: String) {
        guard let webView = webView else { return }
        let jsCommand = navScript(jsonString)
        DispatchQueue.main.async {
            webView.evaluateJavaScript(jsCommand, completionHandler: nil)
        }
    }

    // Trailing `void 0;` guarantees the evaluated script resolves to a serializable
    // (undefined) result, avoiding WebKit's "unsupported type" completion errors.
    private func navScript(_ jsonString: String) -> String {
        return """
        (function(){
          try {
            if (window.galaxyExplorer && typeof window.galaxyExplorer.receiveNavigationUpdate === 'function') {
              window.galaxyExplorer.receiveNavigationUpdate(\(jsonString));
            }
          } catch (e) {
            console.error('bridge error:', e);
          }
        })(); void 0;
        """
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

        // The web engine finished booting and its nav handler is live. Because we only push
        // nav updates on CHANGE (removeDuplicates), any input the user made during the boot
        // — e.g. holding the thruster — was dropped before the handler existed. Re-send the
        // CURRENT state now so the controls are responsive from the first frame.
        if typeString == "READY" {
            DispatchQueue.main.async { [weak self] in
                self?.resendNavState()
            }
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
        
        if typeString == "RADAR", let blips = body["blips"] as? [[String: Any]] {
            let contacts: [SpaceNavigationController.RadarContact] = blips.compactMap { b in
                guard let name = b["name"] as? String else { return nil }
                func num(_ k: String) -> Double {
                    if let d = b[k] as? Double { return d }
                    if let i = b[k] as? Int { return Double(i) }
                    return 0
                }
                return SpaceNavigationController.RadarContact(
                    id: name,
                    name: name,
                    type: (b["type"] as? String) ?? "object",
                    rx: CGFloat(num("rx")),
                    ry: CGFloat(num("ry")),
                    dist: Int(num("dist"))
                )
            }
            DispatchQueue.main.async {
                self.navigationController?.radarContacts = contacts
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
        
        // Codex opens/closes a discovery card or Field Guide: hide/show native flight controls.
        if typeString == "CHROME" {
            // JS booleans bridge as NSNumber; accept either to be safe.
            let hidden = (body["hidden"] as? Bool) ?? ((body["hidden"] as? NSNumber)?.boolValue ?? false)
            DispatchQueue.main.async {
                self.navigationController?.hideChrome = hidden
            }
            return
        }

        // Native-side HTTP proxy for the LiveData panel. The web view is served from a custom
        // URL scheme, so cross-origin fetch() is blocked by CORS — so JS asks us to fetch and
        // we hand the JSON back (base64'd to dodge escaping) via window.liveData._onFetch.
        if typeString == "FETCH",
           let urlStr = body["url"] as? String,
           let reqId = body["reqId"] as? String,
           let url = URL(string: urlStr) {
            var req = URLRequest(url: url)
            req.timeoutInterval = 12
            req.cachePolicy = .reloadIgnoringLocalCacheData
            URLSession.shared.dataTask(with: req) { [weak self] data, resp, err in
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let ok = err == nil && status >= 200 && status < 300 && data != nil
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                let b64 = Data(text.utf8).base64EncodedString()
                DispatchQueue.main.async {
                    let js = "window.liveData && window.liveData._onFetch('\(reqId)', \(ok ? "true" : "false"), \(status), '\(b64)')"
                    self?.webView?.evaluateJavaScript(js, completionHandler: nil)
                }
            }.resume()
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

