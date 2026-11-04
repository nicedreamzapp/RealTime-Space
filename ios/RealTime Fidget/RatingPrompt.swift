//
//  RatingPrompt.swift
//  When to ask for an App Store rating. The request itself is SwiftUI's requestReview
//  action in ContentView; Apple decides whether the sheet actually shows.
//
//  Rules (same on Android): only after a completed flight to a planet or moon, never on the
//  first launch, not before the 3rd arrival, at most once every 60 days per device.
//

import Foundation

extension Notification.Name {
    static let rtsArrivedAtWorld = Notification.Name("rtsArrivedAtWorld")
}

enum RatingPrompt {
    static let minArrivals = 3
    static let minDaysBetween: Double = 60

    private static let defaults = UserDefaults.standard
    private static let kArrivals = "rating.arrivals"
    private static let kLaunches = "rating.launches"
    private static let kLastAsked = "rating.lastAsked"

    /// Capture and test launches never ask.
    private static var suppressed: Bool {
        let args = ProcessInfo.processInfo.arguments
        return args.contains("-shot") || args.contains("-noRating")
    }

    static func noteLaunch() {
        defaults.set(defaults.integer(forKey: kLaunches) + 1, forKey: kLaunches)
    }

    static func recordArrival() {
        defaults.set(defaults.integer(forKey: kArrivals) + 1, forKey: kArrivals)
    }

    /// True (and stamps the date) when this arrival is a moment to ask.
    static func claimAskIfDue(now: Date = Date()) -> Bool {
        guard !suppressed,
              defaults.integer(forKey: kArrivals) >= minArrivals,
              defaults.integer(forKey: kLaunches) >= 2 else { return false }
        if let last = defaults.object(forKey: kLastAsked) as? Date,
           now.timeIntervalSince(last) < minDaysBetween * 86_400 { return false }
        defaults.set(now, forKey: kLastAsked)
        return true
    }
}
