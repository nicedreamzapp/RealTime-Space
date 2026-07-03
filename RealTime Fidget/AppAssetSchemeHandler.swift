import Foundation
import WebKit

/// Serves the bundled web assets (index.html, the JS engine, and the texture pack)
/// through a custom `appassets://` URL scheme instead of `file://`.
///
/// Why: when the page is loaded from `file://`, WebKit treats every texture file as a
/// separate (cross-origin) origin, so Three.js image loads fail outright and — even if
/// they loaded — WebGL would reject them as cross-origin "tainted" textures. Serving
/// everything from one custom scheme makes it all same-origin, so textures load and
/// upload to WebGL cleanly. It also sidesteps the space in the ".app" bundle name.
final class AppAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "appassets"

    private let ioQueue = DispatchQueue(label: "appassets.io", qos: .userInitiated, attributes: .concurrent)
    private let lock = NSLock()
    private var stoppedTasks = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask)
        lock.lock(); stoppedTasks.remove(taskID); lock.unlock()

        guard let url = urlSchemeTask.request.url, let base = Bundle.main.resourceURL else {
            fail(urlSchemeTask, taskID: taskID, error: URLError(.badURL))
            return
        }

        // Map appassets://app/<path> → <bundle>/<path>; default to index.html.
        var relativePath = url.path
        if relativePath.hasPrefix("/") { relativePath.removeFirst() }
        if relativePath.isEmpty { relativePath = "index.html" }

        let baseStd = base.standardizedFileURL
        let fileURL = baseStd.appendingPathComponent(relativePath).standardizedFileURL

        // Refuse anything that escapes the bundle (path-traversal guard).
        guard fileURL.path.hasPrefix(baseStd.path) else {
            fail(urlSchemeTask, taskID: taskID, error: URLError(.noPermissionsToReadFile))
            return
        }

        ioQueue.async { [weak self] in
            guard let self else { return }
            do {
                let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": Self.mimeType(forExtension: fileURL.pathExtension),
                        "Content-Length": String(data.count),
                        "Access-Control-Allow-Origin": "*",
                        // no-store: always serve the freshly bundled asset. The old
                        // max-age=1yr made WKWebView cache JS/HTML and run STALE code
                        // after every rebuild — the source of the intermittent behavior.
                        "Cache-Control": "no-store, no-cache, must-revalidate",
                    ]
                )!
                self.deliver(urlSchemeTask, taskID: taskID, response: response, data: data)
            } catch {
                self.fail(urlSchemeTask, taskID: taskID, error: error)
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask)
        lock.lock(); stoppedTasks.insert(taskID); lock.unlock()
    }

    // MARK: - Helpers

    private func isStopped(_ taskID: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return stoppedTasks.contains(taskID)
    }

    /// All task callbacks happen on the main thread, where `stop` is also delivered, so
    /// once we've checked the flag the three calls run without interleaving a stop.
    private func deliver(_ task: WKURLSchemeTask, taskID: ObjectIdentifier, response: URLResponse, data: Data) {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isStopped(taskID) else { return }
            task.didReceive(response)
            task.didReceive(data)
            task.didFinish()
        }
    }

    private func fail(_ task: WKURLSchemeTask, taskID: ObjectIdentifier, error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.isStopped(taskID) else { return }
            task.didFailWithError(error)
        }
    }

    static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "webp": return "image/webp"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "wasm": return "application/wasm"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "m4a", "aac": return "audio/mp4"
        default: return "application/octet-stream"
        }
    }
}
