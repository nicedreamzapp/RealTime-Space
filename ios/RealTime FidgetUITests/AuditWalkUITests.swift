//
//  AuditWalkUITests.swift
//  Screenshot walk of every screen a person can reach, for a design/usability pass.
//  Nothing here asserts looks; it records them. The menu-closing checks do assert.
//

import XCTest

final class AuditWalkUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = true }

    private func snap(_ app: XCUIApplication, _ name: String) {
        // XCUIScreen, not app.screenshot(): the app capture comes out rotated and half black in landscape.
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    private func dump(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(string: app.debugDescription); a.name = name + ".txt"; a.lifetime = .keepAlways; add(a)
    }
    private func btn(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }
    private func btnContaining(_ app: XCUIApplication, _ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }
    /// Get back to the plain flying view: close whatever sheet/card/menu is up.
    private func home(_ app: XCUIApplication) {
        for label in ["Close the menu", "Close", "close", "Done", "✕", "Close guide", "Back"] {
            let b = btn(app, label)
            if b.exists && b.isHittable { b.tap(); sleep(1) }
        }
    }
    private func launch(_ app: XCUIApplication) {
        app.launch()
        sleep(2); snap(app, "00-welcome"); dump(app, "00-welcome")
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 20) { begin.tap() }
        sleep(15)
    }

    @MainActor
    func testWalkPortrait() throws {
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        launch(app)
        snap(app, "p01-main"); dump(app, "p01-main")

        // ⋯ menu: open, close by tapping outside, open, close with ✕
        let menu = app.buttons["Menu"]
        if menu.waitForExistence(timeout: 5) {
            menu.tap(); sleep(2); snap(app, "p02-menu-open"); dump(app, "p02-menu-open")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.55)).tap(); sleep(2)
            let fly = btnContaining(app, "Fly To Anywhere")
            XCTAssertFalse(fly.exists, "menu still open after tapping outside it")
            menu.tap(); sleep(2)
            btn(app, "Close the menu").tap(); sleep(2)
            XCTAssertFalse(fly.exists, "menu still open after tapping ✕")

            // each menu entry
            for (entry, tag) in [("Fly To Anywhere", "p03-flyto"), ("How to Play", "p04-howto"), ("Credits", "p05-credits"), ("Unlock Forever", "p06-unlock")] {
                menu.tap(); sleep(2)
                let b = btnContaining(app, entry)
                if b.exists { b.tap(); sleep(3); snap(app, tag); dump(app, tag)
                    // scroll long sheets once to see the bottom
                    app.swipeUp(); sleep(1); snap(app, tag + "-scrolled")
                }
                home(app); sleep(1)
                let begin = app.buttons["Begin Exploring"]      // How to Play reopens the welcome
                if begin.exists { begin.tap(); sleep(2) }
                snap(app, tag + "-after-close")
            }
        }

        // the icon dock and the other on-screen controls, one by one
        for (label, tag) in [("🗺️", "p10-map"), ("🛰️", "p11-satellite"), ("📖", "p12-guide"), ("🔇", "p13-sound"),
                             ("SCAN", "p15-scan"), ("Camera view", "p16-view"),
                             ("Fly to the nearest planet", "p17-nearest")] {
            let b = btnContaining(app, label)
            if b.exists && b.isHittable {
                b.tap(); sleep(4); snap(app, tag); dump(app, tag)
                home(app); sleep(1); snap(app, tag + "-after")
            } else {
                snap(app, tag + "-NOT-FOUND")
            }
        }

        // the tour picker, plus a card
        let tour = app.buttons["Make your tour"]
        if tour.exists { tour.tap(); sleep(2); snap(app, "p20-tour-picker")
            btnContaining(app, "Mars").tap(); btnContaining(app, "Start my tour").tap()
            let card = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS 'Tap to'")).firstMatch
            _ = card.waitForExistence(timeout: 40); sleep(2); snap(app, "p21-tour-card")
            if card.exists { card.tap() }
            sleep(3); snap(app, "p22-tour-done")
            let free = btnContaining(app, "Fly on my own"); if free.exists { free.tap() }
        }
    }

    @MainActor
    func testWalkLandscape() throws {
        let app = XCUIApplication()
        launch(app)
        XCUIDevice.shared.orientation = .landscapeLeft
        sleep(10); snap(app, "l01-main"); dump(app, "l01-main")
        let menu = app.buttons["Menu"]
        if menu.waitForExistence(timeout: 5) {
            menu.tap(); sleep(2); snap(app, "l02-menu-open")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.6)).tap(); sleep(2); snap(app, "l03-menu-after-outside-tap")
        }
        let view = btn(app, "Camera view")
        if view.exists { view.tap(); sleep(4); snap(app, "l04-view2"); view.tap(); sleep(4); snap(app, "l05-view3") }
        let tour = app.buttons["Make your tour"]
        if tour.exists { tour.tap(); sleep(2); snap(app, "l06-tour-picker") }
        XCUIDevice.shared.orientation = .portrait
    }
}
