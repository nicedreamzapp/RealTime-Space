# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub: go to the **Security** tab of this repo and click **Report a vulnerability** ([direct link](https://github.com/nicedreamzapp/RealTime-Space/security/advisories/new)). Only the maintainer sees the report.

Helpful details: what you found, how to reproduce it, the app version and store (App Store or Google Play) or the commit, and your phone model and OS version.

I aim to reply within 3 days and to ship a fix or a clear plan within 30 days, depending on severity. You will be credited in the advisory unless you ask not to be.

## Supported versions

Fixes go into the latest App Store and Google Play builds, made from `main`. Please update the app before reporting if you are on an older version.

## What matters most here

The parts where a mistake could hurt someone:

- the paywall and gift code checks in `ios/RealTime Fidget/StoreManager.swift` and `android/app/src/main/java/com/nicedreamz/realtimespace/StoreManager.kt`
- the bridges between the web view and native code: `ios/GalaxyBridge.swift`, `ios/WorkingPortalWebView.swift`, the `appassets://` scheme in `ios/RealTime Fidget/AppAssetSchemeHandler.swift`, and `WebBridge.kt` on Android
- the live-data requests in `ios/codex/LiveData.js` (and its Android copy), which fetch from wheretheiss.at and the NASA API
- the Android release signing setup in `android/app/build.gradle.kts`, which reads keys from `android/keystore.properties`
