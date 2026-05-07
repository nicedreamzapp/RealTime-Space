//
//  FidgetPlaygroundApp.swift
//  Fidget Playground
//
//  Created by matthew macosko on 9/16/25.
//

import SwiftUI
import UIKit

@main
struct FidgetPlaygroundApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .persistentSystemOverlays(.hidden)
                .statusBarHidden(true)
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Keep screen on during use
        UIApplication.shared.isIdleTimerDisabled = true
        return true
    }
}

