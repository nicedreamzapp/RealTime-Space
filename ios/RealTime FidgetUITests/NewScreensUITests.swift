//
//  NewScreensUITests.swift
//  Reviewer path for the screens added in 1.3.8: Missions & Badges and Photo Mode, from a fresh install.
//

import XCTest

final class NewScreensUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = true }

    private func snap(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    private func btnContaining(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    @MainActor
    func testMissionsAndPhotoMode() throws {
        let app = XCUIApplication(); app.launchArguments += ["-silent", "-noRating"]
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 20) { begin.tap() }
        sleep(12); snap("n00-flight")

        let menu = app.buttons["Menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "no menu button")
        menu.tap(); sleep(2)
        let missions = btnContaining(app, "Missions & Badges")
        XCTAssertTrue(missions.waitForExistence(timeout: 5), "Missions & Badges not in the menu")
        missions.tap(); sleep(4); snap("n01-missions")
        let rank = app.staticTexts.matching(NSPredicate(format: "label MATCHES '(Cadet|Ensign|Lieutenant|Commander|Captain)'")).firstMatch
        XCTAssertTrue(rank.waitForExistence(timeout: 8), "no rank shown on the Missions screen")
        app.swipeUp(); sleep(1); snap("n02-missions-scrolled")
        XCTAssertEqual(app.state, .runningForeground)

        // close the missions panel, back to flight
        for label in ["Close", "close", "✕", "Done", "Back"] {
            let b = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            if b.exists && b.isHittable { b.tap(); sleep(1); break }
        }
        sleep(2); snap("n03-after-missions")

        if !menu.isHittable { app.terminate(); app.launch(); sleep(12) }
        menu.tap(); sleep(2)
        let photo = btnContaining(app, "Photo Mode")
        XCTAssertTrue(photo.waitForExistence(timeout: 5), "Photo Mode not in the menu")
        photo.tap(); sleep(3); snap("n04-photo-mode")
        XCTAssertEqual(app.state, .runningForeground)
        sleep(20); XCTAssertEqual(app.state, .runningForeground); snap("n05-photo-mode-later")
    }
}
