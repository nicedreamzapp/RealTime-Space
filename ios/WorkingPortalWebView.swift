import SwiftUI
import WebKit
import Combine

struct WorkingPortalWebView: UIViewRepresentable {
    
    
    let fileName: String
    
    @ObservedObject var navigationController: SpaceNavigationController
    @ObservedObject var galaxyManager: GalaxyDataManager
    
    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: WorkingPortalWebView
        var bridge: GalaxyBridge?
        var cancellables = Set<AnyCancellable>()
        
        init(_ parent: WorkingPortalWebView) {
            self.parent = parent
            super.init()
            
            // CRITICAL: Use removeDuplicates to only send when value ACTUALLY changes
            parent.navigationController.$isThrusting
                .removeDuplicates()
                .sink { [weak self] isThrusting in
                    print("⚡ IMMEDIATE isThrusting change: \(isThrusting)")
                    self?.sendImmediateUpdate()
                }
                .store(in: &cancellables)
            
            parent.navigationController.$rotation
                .removeDuplicates { old, new in
                    // Only send if values differ by more than 0.001
                    abs(old.x - new.x) < 0.001 && abs(old.y - new.y) < 0.001 && abs(old.z - new.z) < 0.001
                }
                .sink { [weak self] rotation in
                    print("⚡ IMMEDIATE rotation change: x=\(rotation.x) y=\(rotation.y)")
                    self?.sendImmediateUpdate()
                }
                .store(in: &cancellables)
            
            parent.navigationController.$selectedTargetId
                .removeDuplicates()
                .sink { [weak self] _ in
                    self?.sendImmediateUpdate()
                }
                .store(in: &cancellables)
            
            parent.navigationController.$autoAlignToTarget
                .removeDuplicates()
                .sink { [weak self] _ in
                    self?.sendImmediateUpdate()
                }
                .store(in: &cancellables)
            
            parent.navigationController.$autoApproachTarget
                .removeDuplicates()
                .sink { [weak self] _ in
                    self?.sendImmediateUpdate()
                }
                .store(in: &cancellables)
            
            parent.navigationController.$focusTargetId
                .removeDuplicates()
                .sink { [weak self] targetId in
                    if let id = targetId {
                        self?.bridge?.send(type: .focusObject, data: ["objectId": id])
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                            self?.parent.navigationController.focusTargetId = nil // Clear after send
                        }
                    }
                }
                .store(in: &cancellables)
            
            NotificationCenter.default.addObserver(forName: .workingPortalNavUpdate, object: nil, queue: .main) { [weak self] note in
                guard let data = note.userInfo?["data"] as? [String: Any] else { return }
                self?.bridge?.send(type: .navUpdate, data: data)
            }
        }
        
        deinit {
            NotificationCenter.default.removeObserver(self)
        }
        
        func sendImmediateUpdate() {
            let parent = self.parent
            var data: [String: Any] = [
                "rotation": [
                    "x": parent.navigationController.rotation.x,
                    "y": parent.navigationController.rotation.y,
                    "z": parent.navigationController.rotation.z
                ],
                "isThrusting": parent.navigationController.isThrusting,
                "autoAlignToTarget": parent.navigationController.autoAlignToTarget,
                "autoApproachTarget": parent.navigationController.autoApproachTarget
            ]
            if let id = parent.navigationController.selectedTargetId {
                data["selectedTargetId"] = id
            } else {
                data["selectedTargetId"] = NSNull()
            }
            NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": data])
        }
        
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("✅ WebView finished loading")
            let parent = self.parent
            var data: [String: Any] = [
                "rotation": [
                    "x": parent.navigationController.rotation.x,
                    "y": parent.navigationController.rotation.y,
                    "z": parent.navigationController.rotation.z
                ],
                "isThrusting": parent.navigationController.isThrusting,
                "autoAlignToTarget": parent.navigationController.autoAlignToTarget,
                "autoApproachTarget": parent.navigationController.autoApproachTarget
            ]
            if let id = parent.navigationController.selectedTargetId {
                data["selectedTargetId"] = id
            } else {
                data["selectedTargetId"] = NSNull()
            }
            NotificationCenter.default.post(name: .workingPortalNavUpdate, object: nil, userInfo: ["data": data])
        }
        
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "logging" {
                if let dict = message.body as? [String: Any],
                   let level = dict["level"] as? String,
                   let msg = dict["message"] as? String {
                    print("[JS \(level)] \(msg)")
                } else {
                    print("JS LOG: \(message.body)")
                }
            } else {
                self.bridge?.userContentController(userContentController, didReceive: message)
            }
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let userContentController = WKUserContentController()
        
        let consoleScript = """
        (function() {
            const send = (level, message) => {
                try {
                    window.webkit.messageHandlers.logging.postMessage({ level, message });
                } catch (_) {}
            };

            const wrap = (name) => {
                const orig = console[name];
                console[name] = function(...args) {
                    try { send(name, args.map(a => String(a)).join(' ')); } catch(_) {}
                    orig && orig.apply(console, args);
                };
            };

            ['log','info','warn','error','debug'].forEach(wrap);

            window.addEventListener('error', function(e) {
                try {
                    const msg = (e && e.message ? e.message : 'Unknown JS error');
                    const loc = (e && e.filename ? (e.filename + ':' + e.lineno + ':' + e.colno) : '');
                    send('error', msg + (loc ? (' @ ' + loc) : ''));
                } catch(_) {}
            });

            window.addEventListener('unhandledrejection', function(e) {
                try { send('error', 'Unhandled promise rejection: ' + String(e.reason)); } catch(_) {}
            });

            // Optional: mark readiness so Swift can verify Space namespace later
            window.__SPACE_BRIDGE_READY__ = true;
        })();
        """
        let consoleScriptObj = WKUserScript(source: consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        userContentController.addUserScript(consoleScriptObj)
        userContentController.add(context.coordinator, name: "logging")
        
        let config = WKWebViewConfiguration()
        config.userContentController = userContentController
        // Serve bundled web assets (HTML/JS/textures) same-origin so WebGL textures load.
        config.setURLSchemeHandler(AppAssetSchemeHandler(), forURLScheme: AppAssetSchemeHandler.scheme)

        // PURGE stale HTTP cache: responses cached in the old max-age=1yr era keep
        // being served across app updates (we watched a rebuilt JS file run week-old
        // code). localStorage (Field Guide) is deliberately NOT touched.
        WKWebsiteDataStore.default().removeData(
            ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache],
            modifiedSince: .distantPast
        ) { }
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        // Prefer GPU-accelerated rendering for smooth 3D graphics
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        let webView = WKWebView(frame: .zero, configuration: config)
        // Opaque black: the WebView is the bottom layer (controls float above it). With
        // isOpaque=false, iOS can fail to composite the opaque WebGL canvas and show black
        // even though the scene rendered. Opaque makes the canvas present reliably.
        webView.isOpaque = true
        webView.backgroundColor = UIColor.black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = context.coordinator

        // Allow inspecting for development
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        
        // CHANGED: Pass navigationController to bridge
        let bridge = GalaxyBridge(webView: webView, navigationController: navigationController)
        context.coordinator.bridge = bridge
        userContentController.add(bridge, name: "iosHandler")
        
        let htmlFileName = fileName.isEmpty ? "index" : fileName
        loadHTML(webView, fileName: htmlFileName)
        
        navigationController.attachWebView(webView)
        
        return webView
    }
    
    func updateUIView(_ webView: WKWebView, context: Context) {
        // DO NOTHING - Combine publishers handle all updates
    }
    
    private func loadHTML(_ webView: WKWebView, fileName: String) {
        // Load through the appassets:// scheme so the page and all its assets (JS +
        // textures) share one origin — required for WebGL textures to load on device.
        let urlString = "\(AppAssetSchemeHandler.scheme)://app/\(fileName).html"
        guard let url = URL(string: urlString) else {
            print("❌ ERROR: Could not form asset URL \(urlString)")
            return
        }
        print("📄 Loading Galaxy HTML via \(urlString)")
        webView.load(URLRequest(url: url))
    }
    
    func sendNavigationUpdate() {
        var data: [String: Any] = [
            "rotation": [
                "x": navigationController.rotation.x,
                "y": navigationController.rotation.y,
                "z": navigationController.rotation.z
            ],
            "isThrusting": navigationController.isThrusting,
            "autoAlignToTarget": navigationController.autoAlignToTarget,
            "autoApproachTarget": navigationController.autoApproachTarget
        ]
        if let id = navigationController.selectedTargetId {
            data["selectedTargetId"] = id
        } else {
            data["selectedTargetId"] = NSNull()
        }
        NotificationCenter.default.post(name: .workingPortalNavUpdate,
                                        object: nil,
                                        userInfo: ["data": data])
    }
}


private extension Notification.Name {
    static let workingPortalNavUpdate = Notification.Name("WorkingPortalWebView.navUpdate")
}
