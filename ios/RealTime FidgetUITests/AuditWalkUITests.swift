//
//  AuditWalkUITests.swift
//  Screenshot walk of every screen a person can reach, for a design/usability pass.
//

import XCTest

final class AuditWalkUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = true }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    private func dump(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(string: app.debugDescription); a.name = name + ".txt"; a.lifetime = .keepAlways; add(a)
    }

    @MainActor
    func testWalkPortrait() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launch()
        sleep(3); snap(app, "p00-launch")
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 20) { begin.tap() }
        sleep(15); snap(app, "p01-main"); dump(app, "p01-main")
        let menu = app.buttons["Menu"]
        if menu.waitForExistence(timeout: 5) {
            menu.tap(); sleep(2); snap(app, "p02-menu-open"); dump(app, "p02-menu-open")
            // try to close by tapping empty sky on the left
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.55)).tap(); sleep(2); snap(app, "p03-after-tap-outside")
            let fly = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Fly To'")).firstMatch
            XCTAssertFalse(fly.exists, "menu still open after tapping outside it")
            // open again and close with the ✕ (the same button, now reading Close the menu)
            menu.tap(); sleep(2)
            let x = app.buttons.matching(NSPredicate(format: "label == 'Close the menu'")).allElementsBoundByIndex.last!
            XCTAssertTrue(x.isHittable, "✕ not tappable while the menu is open")
            snap(app, "p04-menu-open-again")
            app.buttons["Close the menu"].firstMatch.tap(); sleep(2)
            XCTAssertFalse(fly.exists, "menu still open after tapping ✕")
            snap(app, "p05-after-x")
        }
    }

    @MainActor
    func testWalkLandscape() throws {
        let app = XCUIApplication()
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 20) { begin.tap() }
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(15); snap(app, "l01-main"); dump(app, "l01-main")
        let menu = app.buttons["Menu"]
        if menu.waitForExistence(timeout: 5) { menu.tap(); sleep(2); snap(app, "l02-menu-open") }
        XCUIDevice.shared.orientation = .portrait
    }
}
