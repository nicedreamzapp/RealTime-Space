//
//  TourBuilderUITests.swift
//  Walks "Make your tour" end to end on real WebKit: TOUR button, picking (including a
//  pick that needs the list scrolled), every stop's card, and the finish screen.
//

import XCTest

final class TourBuilderUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func webButton(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func webText(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    @MainActor
    func testMakeYourTour() throws {
        let app = XCUIApplication()
        app.launch()
        snap(app, "01-launch")
        let begin = app.buttons["Begin Exploring"]  // first-launch welcome screen
        if begin.waitForExistence(timeout: 20) { begin.tap() }
        sleep(20)                                   // engine + textures

        let tour = app.buttons["Make your tour"]    // native TOUR button
        XCTAssertTrue(tour.waitForExistence(timeout: 30), "TOUR button missing")
        tour.tap()
        XCTAssertTrue(webText(app, containing: "Make your tour").waitForExistence(timeout: 15), "picker did not open")
        snap(app, "02-picker")

        webButton(app, containing: "Saturn").tap()
        webButton(app, containing: "Orion").tap()

        // Southern Cross sits below the fold on a phone: the list itself must scroll.
        let cross = webButton(app, containing: "Southern Cross")
        var tries = 0
        while !cross.isHittable && tries < 8 {
            app.webViews.firstMatch.swipeUp(velocity: .default)
            tries += 1
        }
        XCTAssertTrue(cross.isHittable, "picker list did not scroll to Southern Cross")
        cross.tap()
        snap(app, "03-picked")

        let start = webButton(app, containing: "Start my tour")
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertTrue(start.label.contains("3"), "start button should count 3 stops: \(start.label)")
        start.tap()

        // Saturn, Orion (Earth view + side view), Southern Cross (two views) = 5 cards.
        // The card element is reused, so wait for it to be ON screen with this stop's words.
        let expect = [("STOP 1", "Saturn"), ("STOP 2", "Seen from Earth"), ("STOP 2", "from the side"),
                      ("STOP 3", "Seen from Earth"), ("STOP 3", "from the side")]
        for (i, (stopWord, word)) in expect.enumerated() {
            let card = app.webViews.buttons.matching(NSPredicate(
                format: "label CONTAINS[c] %@ AND label CONTAINS %@ AND label CONTAINS 'Tap to'", stopWord, word)).firstMatch
            let onScreen = expectation(for: NSPredicate(format: "exists == true AND hittable == true"), evaluatedWith: card)
            wait(for: [onScreen], timeout: 40)
            sleep(1)
            snap(app, "04-card-\(i + 1)")
            card.tap()
        }

        XCTAssertTrue(webText(app, containing: "That was your tour").waitForExistence(timeout: 30), "finish screen missing")
        snap(app, "05-done")
        webButton(app, containing: "Fly on my own").tap()
        sleep(2)
        XCTAssertTrue(tour.waitForExistence(timeout: 10), "flight controls did not come back")
        snap(app, "06-back-to-flying")
    }
}
