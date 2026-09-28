//
//  RedeemCodeUITests.swift
//  A fresh (locked) install must reach Apple's code sheet the way App Review will:
//  ⋯ menu → Unlock Forever → Redeem a Code. The old typed code box must be gone.
//

import XCTest

final class RedeemCodeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    @MainActor
    func testRedeemCodeReachableWhenLocked() throws {
        let app = XCUIApplication()
        app.launch()
        let begin = app.buttons["Begin Exploring"]
        if begin.waitForExistence(timeout: 20) { begin.tap() }
        sleep(15)
        let menu = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'menu' OR label CONTAINS[c] 'more' OR identifier CONTAINS[c] 'ellipsis'")).firstMatch
        if !menu.exists { snap(app, "no-menu"); print(app.debugDescription) }
        XCTAssertTrue(menu.waitForExistence(timeout: 10), "⋯ menu button not found")
        menu.tap()
        let unlock = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Unlock Forever'")).firstMatch
        XCTAssertTrue(unlock.waitForExistence(timeout: 5), "Unlock Forever row missing on a locked install")
        snap(app, "menu")
        unlock.tap()
        let redeem = app.buttons["Redeem an App Store code"]
        XCTAssertTrue(redeem.waitForExistence(timeout: 5), "Redeem a Code missing on the purchase screen")
        XCTAssertFalse(app.buttons["Enter an unlock code"].exists, "old typed code button still there")
        snap(app, "paywall")
        redeem.tap()
        sleep(4)
        snap(app, "after-redeem-tap")
    }
}
