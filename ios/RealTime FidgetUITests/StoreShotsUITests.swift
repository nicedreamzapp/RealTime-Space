//
//  StoreShotsUITests.swift
//  App Store screenshots (landscape, written to /tmp/rts-shots on the host) and the rating
//  request walk (3 arrivals on a 2nd launch must bring up Apple's rating sheet).
//

import XCTest

final class StoreShotsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = true }

    private let outDir = "/tmp/rts-shots"

    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        try? shot.pngRepresentation.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
        let a = XCTAttachment(screenshot: shot); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func shoot(_ name: String, _ args: [String], wait: UInt32 = 34) {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = args
        app.launch()
        sleep(wait)
        save(name)
        app.terminate()
    }

    @MainActor
    func testStoreShots() throws {
        let list: [(String, [String])] = [
            ("saturn_visor_keep", ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Saturn"]),
            ("saturn_helm_keep",  ["-shot", "-keepUI", "-shotView", "helm",  "-shotTarget", "Saturn"]),
            ("saturn_chase_keep", ["-shot", "-keepUI", "-shotView", "chase", "-shotTarget", "Saturn"]),
            ("saturn_visor_clean",["-shot", "-shotView", "visor", "-shotTarget", "Saturn"]),
            ("jupiter_visor_keep",["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Jupiter"]),
            ("jupiter_chase_keep",["-shot", "-keepUI", "-shotView", "chase", "-shotTarget", "Jupiter"]),
            ("earth_visor_keep",  ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Earth"]),
            ("moon_visor_keep",   ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Moon"]),
            ("mars_visor_keep",   ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Mars"]),
            ("uranus_visor_keep", ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Uranus"]),
            ("sun_visor_keep",    ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Sun"]),
            ("titan_visor_keep",  ["-shot", "-keepUI", "-shotView", "visor", "-shotTarget", "Titan"]),
        ]
        let only = ProcessInfo.processInfo.environment["SHOTS_ONLY"].flatMap { $0.isEmpty ? nil : $0 }
        for (name, args) in list where only == nil || name.contains(only!) {
            shoot(name, args)
        }
    }

    @MainActor
    func testRatingAfterThirdArrival() throws {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        // Launch 1: never asks (first launch).
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 25) { begin.tap() }
        sleep(12)
        let near = app.buttons["Fly to the nearest planet"]
        XCTAssertTrue(near.waitForExistence(timeout: 10))
        near.tap(); sleep(10)
        save("rate-01-first-launch-arrival1")
        app.terminate()
        // Launch 2: arrivals 2 and 3; the 3rd must bring up the rating sheet.
        app.launch()
        if begin.waitForExistence(timeout: 25) { begin.tap() }
        sleep(12)
        near.tap(); sleep(10)
        save("rate-02-arrival2-no-sheet")
        near.tap(); sleep(6)
        save("rate-03-arrival3-sheet")
        sleep(4)
        save("rate-04-arrival3-later")
        let attachment = XCTAttachment(string: XCUIApplication(bundleIdentifier: "com.apple.springboard").debugDescription + "\n----\n" + app.debugDescription)
        attachment.name = "rate-tree.txt"; attachment.lifetime = .keepAlways; add(attachment)
    }
}
