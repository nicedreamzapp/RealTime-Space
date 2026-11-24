# Contributing

Thanks for taking a look. RealTime Space runs on a lot of phones I do not own, so a bug report from
your device is useful even if you never send code.

## Reporting a problem

Open an [issue](https://github.com/nicedreamzapp/RealTime-Space/issues/new/choose). The things that
make it quick to fix:

- iPhone or Android, your phone model and OS version
- the app version (shown in the App Store or Google Play listing on your phone)
- where you were in the app (which planet or moon, Codex, cockpit view, radar, live data)
- what you saw, with a screenshot or screen recording if it is a rendering problem
- for purchase or trial problems, which store and what message you got (no receipts or account details)

## Running it locally

- **iOS:** open `ios/RealTime Fidget.xcodeproj` in Xcode. You need an Xcode with the iOS 26 SDK.
  `ios/Products.storekit` lets you test the unlock locally without App Store Connect.
- **Android:** from `android/`, run `./gradlew assembleDebug` (JDK 17). Release builds need
  `android/keystore.properties`, which is not in the repo, so use debug builds.

There is no build step for the web renderer. The HTML, JS and textures are bundled into each app as
plain files. The iOS copy is in `ios/` and the Android copy is in `android/app/src/main/assets/web/`.
They are kept in step by hand, so if you fix the renderer, say whether you changed one copy or both.

## Tests

There are no meaningful automated tests yet (the Xcode test targets are the default templates).
Check changes by hand on a real device or simulator: fly to a few planets, open the Codex, and
watch for frame rate drops and rendering glitches.

## Pull requests

Small and focused is easiest to review. Say which devices you tested on. For big changes, open an
issue first so we can talk it through.

Please follow the [code of conduct](CODE_OF_CONDUCT.md).
