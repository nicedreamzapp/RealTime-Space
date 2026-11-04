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
        app.launchArguments = args + ["-silent"]
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
        app.launchArguments = ["-silent"]
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
    /// Real user path: Begin, pick the camera view, Menu > Fly To Anywhere > target, wait, shoot.
    private func flyShot(_ name: String, target: String, viewTaps: Int, settle: UInt32 = 3) {
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-noRating", "-silent"]
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 25) { begin.tap() }
        sleep(10)
        let cam = app.buttons["Camera view"]
        for _ in 0..<viewTaps where cam.exists { cam.tap(); sleep(2) }
        let menu = app.buttons["Menu"]
        if menu.waitForExistence(timeout: 5) { menu.tap(); sleep(2) }
        let fly = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Fly To Anywhere")).firstMatch
        if fly.exists { fly.tap(); sleep(2) }
        let item = app.buttons.matching(NSPredicate(format: "label ENDSWITH[c] %@", target)).firstMatch
        _ = app.buttons["Done"].waitForExistence(timeout: 8)
        sleep(1)
        let list = app.collectionViews.firstMatch
        var tries = 0
        while !(item.exists && item.isHittable) && tries < 12 {
            let from = list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            from.press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)))
            sleep(1); tries += 1
        }
        if item.exists && item.isHittable { item.tap() } else {
            let a = XCTAttachment(string: app.debugDescription); a.name = name + "-tree.txt"; a.lifetime = .keepAlways; add(a)
            XCTFail("no \(target) in Fly To")
        }
        sleep(settle)
        save(name)
        app.terminate()
    }

    @MainActor
    func testStoreShotsUI() throws {
        let list: [(String, String, Int)] = [
            ("ui_saturn_visor", "Saturn", 1), ("ui_saturn_helm", "Saturn", 0), ("ui_jupiter_visor", "Jupiter", 1),
            ("ui_jupiter_helm", "Jupiter", 0), ("ui_earth_visor", "Earth", 1), ("ui_uranus_visor", "Uranus", 1),
            ("ui_mars_visor", "Mars", 1), ("ui_sun_visor", "The Sun", 1), ("ui_moon_visor", "The Moon", 1),
            ("ui_titan_visor", "Titan", 1),
        ]
        let only = ProcessInfo.processInfo.environment["SHOTS_ONLY"].flatMap { $0.isEmpty ? nil : $0 }
        for (name, target, taps) in list where only == nil || name.contains(only!) {
            flyShot(name, target: target, viewTaps: taps)
        }
    }

    /// Fly To proof: frames after arriving at Earth (fastest-moving big target), at 1x for 65 s,
    /// then at 1000x for 65 s. FOLLOW_TAG names the files (before/after).
    @MainActor
    func testFollowAfterFlyTo() throws {
        let tag = ProcessInfo.processInfo.environment["FOLLOW_TAG"].flatMap { $0.isEmpty ? nil : $0 } ?? "run"
        let target = ProcessInfo.processInfo.environment["FOLLOW_TARGET"].flatMap { $0.isEmpty ? nil : $0 } ?? "Earth"
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-noRating", "-silent"]
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 25) { begin.tap() }
        sleep(10)
        let cam = app.buttons["Camera view"]; if cam.exists { cam.tap(); sleep(2) }      // visor
        let menu = app.buttons["Menu"]; if menu.waitForExistence(timeout: 5) { menu.tap(); sleep(2) }
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Fly To Anywhere")).firstMatch.tap(); sleep(2)
        let item = app.buttons.matching(NSPredicate(format: "label ENDSWITH[c] %@", target)).firstMatch
        _ = app.buttons["Done"].waitForExistence(timeout: 8); sleep(1)
        let list = app.collectionViews.firstMatch; var tries = 0
        while !(item.exists && item.isHittable) && tries < 12 {
            list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).press(forDuration: 0.05, thenDragTo: list.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45)))
            sleep(1); tries += 1
        }
        XCTAssertTrue(item.isHittable, "no \(target)"); item.tap()
        var t: UInt32 = 0
        for mark: UInt32 in [3, 20, 40, 65] { sleep(mark - t); t = mark; save("follow_\(tag)_1x_\(String(format: "%02d", mark))s") }
        let time = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Time speed")).firstMatch
        for _ in 0..<3 { if time.exists { time.tap(); sleep(1) } }                            // 10x, 100x, 1000x
        t = 0
        for mark: UInt32 in [5, 20, 40, 65] { sleep(mark - t); t = mark; save("follow_\(tag)_1000x_\(String(format: "%02d", mark))s") }
        app.terminate()
    }

}
