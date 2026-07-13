package com.nicedreamz.realtimespace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** A radar contact pushed from the web engine via the RADAR bridge message. */
data class RadarBlip(
    val name: String,
    val type: String,
    val rx: Float,   // -1 (left) .. +1 (right)
    val ry: Float,   // -1 (behind) .. +1 (ahead)
    val dist: Float  // world units
)

/**
 * Shared observable state between the native Compose chrome (Tier 3) and the web bridge.
 * Web -> native pushes land here; native chrome reads these + writes the nav-input fields
 * which the bridge forwards back to the web engine as NAV_UPDATE.
 */
class SpaceState {
    // ---- TIER 5 / IAP (STUB) ----
    // iOS gates some features behind StoreKit IAP "com.nicedreamz.realtimespace.unlock"
    // ($0.99 Unlock Forever) and hides chrome when store.locked. On Android this is STUBBED as
    // permanently unlocked so nothing is blocked.
    // TODO(billing): integrate Google Play Billing (com.android.billingclient) for the same
    // product id, restore purchases, and gate the paywall/locked overlay on the real entitlement.
    val unlocked: Boolean = true

    // ---- Web -> native ----
    var radar by mutableStateOf<List<RadarBlip>>(emptyList())
    var chromeHidden by mutableStateOf(false)
    var position: Triple<Double, Double, Double> = Triple(0.0, 0.0, 0.0)
    var engineReady by mutableStateOf(false)

    // ---- Native -> web (flight input, driven by Tier 3 UI) ----
    var rotX = 0f   // pitch  (-1..1)
    var rotY = 0f   // yaw    (-1..1)
    var isThrusting = false

    // ---- Persisted-ish display settings (defaults match iOS ContentView) ----
    var maxSpeed by mutableStateOf(120f)      // 15..250
    var lutIntensity by mutableStateOf(0.5f)  // 0..1
    var orbitLines by mutableStateOf(true)
    var planetLabels by mutableStateOf(true)
    var cinematic by mutableStateOf(false)
    var lutEnabled by mutableStateOf(false)
}
