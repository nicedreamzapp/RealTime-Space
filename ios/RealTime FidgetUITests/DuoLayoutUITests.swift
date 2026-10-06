//
//  DuoLayoutUITests.swift
//  Resizable-layout walk for iPhone Duo prep: the welcome screen, the flight view, the ⋯ menu,
//  the Fly To sheet and the unlock sheet, in one orientation, then a LIVE rotation to the other
//  one so the layout has to re-flow without a relaunch. Records screenshots; the asserts only
//  check that the core controls stay on screen (hittable) after each size change.
//

import XCTest

final class DuoLayoutUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = true }

    private func snap(_ name: String) {
        // XCUIScreen, not app.screenshot(): the app capture comes out rotated and half black in landscape.
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    private func btnContaining(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }
    private func close(_ app: XCUIApplication) {
        for label in ["Close the menu", "Close", "close", "Done", "✕", "Not now", "Maybe later"] {
            let b = app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
            if b.exists && b.isHittable { b.tap(); sleep(1) }
        }
    }
    private func assertChromeOnScreen(_ app: XCUIApplication, _ tag: String) {
        let menu = app.buttons["Menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5) && menu.isHittable, "\(tag): ⋯ menu button not on screen")
        let view = app.buttons["Camera view"]
        XCTAssertTrue(view.exists && view.isHittable, "\(tag): camera view button not on screen")
    }

    private func walk(start: UIDeviceOrientation, then other: UIDeviceOrientation, _ p: String) {
        XCUIDevice.shared.orientation = start
        let app = XCUIApplication()
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        _ = begin.waitForExistence(timeout: 20); sleep(2); snap("\(p)01-welcome")
        XCTAssertTrue(begin.isHittable, "\(p): Begin Exploring not on screen")
        begin.tap()
        sleep(15); snap("\(p)02-flight")
        assertChromeOnScreen(app, p + "flight")

        let menu = app.buttons["Menu"]
        if menu.exists {
            menu.tap(); sleep(2); snap("\(p)03-menu")
            let fly = btnContaining(app, "Fly To Anywhere")
            if fly.exists { fly.tap(); sleep(3); snap("\(p)04-flyto"); close(app) }
            menu.tap(); sleep(2)
            let unlock = btnContaining(app, "Unlock Forever")
            if unlock.exists { unlock.tap(); sleep(3); snap("\(p)05-unlock"); close(app) }
            close(app)
        }

        // Live size change: the window rotates under the running scene.
        XCUIDevice.shared.orientation = other
        sleep(6); snap("\(p)06-rotated-flight")
        assertChromeOnScreen(app, p + "rotated")
        let view = app.buttons["Camera view"]
        if view.exists { view.tap(); sleep(4); snap("\(p)07-rotated-view2"); view.tap(); sleep(3) }
        XCUIDevice.shared.orientation = .portrait
    }

    @MainActor
    func testPortraitThenLandscape() throws { walk(start: .portrait, then: .landscapeLeft, "p") }

    @MainActor
    func testLandscapeThenPortrait() throws { walk(start: .landscapeLeft, then: .portrait, "l") }
}
