package com.nicedreamz.realtimespace

import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val TAG = "RTSpaceBridge"

/**
 * Native side of the bridge.
 *  - JS -> native: exposed to the page as window.AndroidBridge (@JavascriptInterface).
 *    The index.html shim routes window.webkit.messageHandlers.iosHandler.postMessage here.
 *  - native -> JS: coalesced NAV_UPDATE (latest-wins, single in-flight) delivered via
 *    window.galaxyExplorer.receiveNavigationUpdate(<object literal>), plus galaxyExplorer.* setters.
 */
class WebBridge(
    private val vibrator: Vibrator?,
    private val state: SpaceState,
    private val onReady: () -> Unit,
    /** A user flight ended at a planet or moon (main.js flyTo completion). */
    private val onArrived: () -> Unit = {},
    /** {"lowRam":bool,"memClassMB":n,"totalMB":n} for the web texture budget (Planet.js rtsTexBudget). */
    private val deviceInfoJson: String = "null",
    /** Persist the Ambient hum choice natively (MainActivity prefs). */
    private val onAmbientHumChanged: (Boolean) -> Unit = {},
    /** Flight rumble / gravity swell / warp ticks from RTHaptics.js; its .enabled is the Haptics toggle. */
    val flight: FlightHaptics? = null,
    /** Persist the Haptics choice natively (MainActivity prefs). */
    private val onHapticsChanged: (Boolean) -> Unit = {}
) {
    @JavascriptInterface
    fun deviceInfo(): String = deviceInfoJson

    @Volatile var webView: WebView? = null
    private val main = Handler(Looper.getMainLooper())
    private val http by lazy {
        OkHttpClient.Builder()
            .callTimeout(12, TimeUnit.SECONDS)
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .build()
    }

    // ===================== JS -> native =====================
    @JavascriptInterface
    fun postMessage(json: String) {
        try {
            val o = JSONObject(json)
            when (o.optString("type")) {
                "READY" -> {
                    Log.i(TAG, "READY handshake received from web engine")
                    main.post { onReady() }
                }
                "HAPTIC" -> {
                    val style = o.optString("style")
                    if (style == "warpIn" || style == "warpOut") main.post { flight?.tick(style) }
                    else haptic(style)
                }
                "HAPTIC_FLIGHT" -> {
                    val r = o.optDouble("rumble", 0.0).toFloat()
                    val sw = o.optDouble("swell", 0.0).toFloat()
                    main.post { flight?.setFlight(r, sw) }
                }
                "ARRIVED" -> main.post { onArrived() }
                "RADAR" -> parseRadar(o)
                "POSITION_UPDATE" -> {
                    o.optJSONObject("position")?.let { p ->
                        state.position = Triple(p.optDouble("x"), p.optDouble("y"), p.optDouble("z"))
                    }
                }
                "CHROME" -> {
                    val hidden = o.optBoolean("hidden")
                    main.post { state.chromeHidden = hidden }
                    Log.d(TAG, "CHROME hidden=$hidden")
                }
                "QUALITY" -> {
                    val low = o.optBoolean("low")
                    main.post { state.lowGpu = low }
                }
                "FETCH" -> doFetch(o.optString("url"), o.optString("reqId"))
                "PHOTO" -> sharePhoto(o.optString("dataURL"))
                "AUDIO" -> { /* Web Audio is procedural on the web side; native no-op */ }
                else -> { /* logged/unknown */ }
            }
        } catch (e: Exception) {
            Log.w(TAG, "postMessage parse error: ${e.message}")
        }
    }

    /** Photo Mode: the web layer sends the watermarked frame as a data URL. Decode it off the
     *  main thread, keep a copy in the app cache (shared through FileProvider, no storage
     *  permission), save it to Pictures/RealTime Space on Android 10+ (MediaStore needs no
     *  permission there), then open the share sheet. */
    private fun sharePhoto(dataURL: String) {
        val ctx = webView?.context ?: return
        val comma = dataURL.indexOf(',')
        if (!dataURL.startsWith("data:image/") || comma < 0) return
        val jpeg = dataURL.startsWith("data:image/jpeg")
        val ext = if (jpeg) "jpg" else "png"
        val mime = if (jpeg) "image/jpeg" else "image/png"
        Thread {
            try {
                val bytes = Base64.decode(dataURL.substring(comma + 1), Base64.DEFAULT)
                val dir = File(ctx.cacheDir, "photos").apply { mkdirs() }
                // Keep the cache small: only the last few shots stay.
                dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(4)?.forEach { it.delete() }
                val name = "RealTimeSpace-${System.currentTimeMillis()}.$ext"
                val file = File(dir, name)
                file.writeBytes(bytes)

                var saved = false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        val values = ContentValues().apply {
                            put(MediaStore.Images.Media.DISPLAY_NAME, name)
                            put(MediaStore.Images.Media.MIME_TYPE, mime)
                            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/RealTime Space")
                            put(MediaStore.Images.Media.IS_PENDING, 1)
                        }
                        val cr = ctx.contentResolver
                        val uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                        if (uri != null) {
                            cr.openOutputStream(uri)?.use { it.write(bytes) }
                            values.clear()
                            values.put(MediaStore.Images.Media.IS_PENDING, 0)
                            cr.update(uri, values, null, null)
                            saved = true
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "PHOTO save to Pictures failed: ${e.message}")
                    }
                }

                val shareUri = FileProvider.getUriForFile(ctx, ctx.packageName + ".photos", file)
                main.post {
                    try {
                        if (saved) Toast.makeText(ctx, "Saved to Pictures", Toast.LENGTH_SHORT).show()
                        val send = Intent(Intent.ACTION_SEND).apply {
                            type = mime
                            putExtra(Intent.EXTRA_STREAM, shareUri)
                            clipData = ClipData.newRawUri("", shareUri)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        val chooser = Intent.createChooser(send, "Share your shot").apply {
                            if (ctx !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        ctx.startActivity(chooser)
                    } catch (e: Exception) {
                        Log.w(TAG, "PHOTO share failed: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "PHOTO decode failed: ${e.message}")
            }
        }.start()
    }

    @JavascriptInterface
    fun log(msg: String) {
        Log.d("RTSpaceWeb", msg)
    }

    fun haptic(style: String) {
        if (flight?.enabled == false) return   // Haptics toggle off: no taps either (same as iOS)
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val pattern = when (style) {
            "success" -> longArrayOf(0, 18, 55, 28)
            "heavy"   -> longArrayOf(0, 45)
            "warp"    -> longArrayOf(0, 14, 18, 14, 18, 45)
            else      -> longArrayOf(0, 14) // light
        }
        // On the main thread with the flight rumble: the one-shot cancels the running rumble
        // waveform, so reset its level too or the rumble would never be re-issued.
        main.post {
            flight?.interrupted()
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, -1))
                } else {
                    @Suppress("DEPRECATION") v.vibrate(pattern, -1)
                }
            } catch (_: Exception) {}
        }
    }

    private fun parseRadar(o: JSONObject) {
        val arr = o.optJSONArray("blips") ?: return
        val list = ArrayList<RadarBlip>(arr.length())
        for (i in 0 until arr.length()) {
            val b = arr.optJSONObject(i) ?: continue
            list.add(
                RadarBlip(
                    name = b.optString("name"),
                    type = b.optString("type", "object"),
                    rx = b.optDouble("rx").toFloat(),
                    ry = b.optDouble("ry").toFloat(),
                    dist = b.optDouble("dist").toFloat()
                )
            )
        }
        main.post { state.radar = list }
    }

    /** Native HTTP proxy (like iOS) so the app-scheme page can fetch live data without CORS. */
    private fun doFetch(url: String, reqId: String) {
        Thread {
            var ok = false
            var status = 0
            var b64 = ""
            try {
                http.newCall(Request.Builder().url(url).build()).execute().use { resp ->
                    status = resp.code
                    val body = resp.body?.string() ?: ""
                    ok = resp.isSuccessful && body.isNotEmpty()
                    if (body.isNotEmpty()) {
                        b64 = Base64.encodeToString(body.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "FETCH $url failed: ${e.message}")
            }
            val js = "window.liveData && window.liveData._onFetch('$reqId', $ok, $status, '$b64')"
            main.post { webView?.evaluateJavascript(js, null) }
        }.start()
    }

    // ===================== native -> JS =====================

    // ---- NAV_UPDATE coalescer: latest-wins, one evaluateJavascript in flight ----
    private val lock = Any()
    private var pendingNav: String? = null
    private var navInFlight = false

    /** Push the current flight state. `json` is a JSON object literal (valid JS). */
    fun sendNavUpdate() {
        val json = "{\"rotation\":{\"x\":${state.rotX},\"y\":${state.rotY},\"z\":0}," +
            "\"isThrusting\":${state.isThrusting}}"
        synchronized(lock) {
            pendingNav = json
            if (navInFlight) return
            navInFlight = true
        }
        flushNav()
    }

    private fun flushNav() {
        val js: String
        synchronized(lock) {
            val p = pendingNav
            if (p == null) { navInFlight = false; return }
            pendingNav = null
            js = "try{if(window.galaxyExplorer&&typeof window.galaxyExplorer.receiveNavigationUpdate==='function')" +
                "{window.galaxyExplorer.receiveNavigationUpdate($p);}}catch(e){}"
        }
        main.post {
            val wv = webView
            if (wv == null) { synchronized(lock) { navInFlight = false }; return@post }
            wv.evaluateJavascript(js) { flushNav() }  // re-flush newest on completion
        }
    }

    fun runJs(js: String) = call(js)

    private fun call(js: String) {
        main.post { webView?.evaluateJavascript(js, null) }
    }

    // ---- galaxyExplorer.* command setters (exact names/signatures from iOS) ----
    fun setOrbitLinesVisible(b: Boolean) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setOrbitLinesVisible&&window.galaxyExplorer.setOrbitLinesVisible($b)")
    fun setPlanetLabelsVisible(b: Boolean) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setPlanetLabelsVisible&&window.galaxyExplorer.setPlanetLabelsVisible($b)")
    fun setCinematicMode(b: Boolean) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setCinematicMode&&window.galaxyExplorer.setCinematicMode($b)")
    fun setLUTEnabled(b: Boolean) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setLUTEnabled&&window.galaxyExplorer.setLUTEnabled($b)")
    fun setLUTIntensity(v: Float) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setLUTIntensity&&window.galaxyExplorer.setLUTIntensity($v)")
    fun setMaxSpeed(v: Int) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setMaxSpeed&&window.galaxyExplorer.setMaxSpeed($v)")
    fun setViewMode(mode: String) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setViewMode&&window.galaxyExplorer.setViewMode('$mode')")
    fun openTour() =
        call("window.galaxyExplorer&&window.galaxyExplorer.toggleScenicTour&&window.galaxyExplorer.toggleScenicTour()")
    fun flyToByName(name: String) =
        call("window.galaxyExplorer&&window.galaxyExplorer.flyToByName&&window.galaxyExplorer.flyToByName('${name.replace("'", "\\'")}')")
    fun flyToNearestPlanet() =
        call("window.galaxyExplorer&&window.galaxyExplorer.flyToNearestPlanet&&window.galaxyExplorer.flyToNearestPlanet()")
    fun setWarpDrive(b: Boolean) =
        call("window.galaxyExplorer&&window.galaxyExplorer.setWarpDrive&&window.galaxyExplorer.setWarpDrive($b)")
    fun showMissions() =
        call("window.galaxyExplorer&&window.galaxyExplorer.showMissions&&window.galaxyExplorer.showMissions()")
    fun capturePhoto(scale: Float = 1.5f) =
        call("window.galaxyExplorer&&window.galaxyExplorer.capturePhoto&&window.galaxyExplorer.capturePhoto($scale)")
    /** Hold or release the web 3D loop for one reason (UpdateLoop.hold): no updates, draws or
     *  texture uploads while any hold is on. Posted to the main thread like every call. */
    fun holdLoop(reason: String, on: Boolean) =
        call("window.rtsHold&&window.rtsHold('$reason',$on)")
    fun pauseExploration() = call("window.pauseExploration&&window.pauseExploration()")
    fun resumeExploration() = call("window.resumeExploration&&window.resumeExploration()")

    /** Push all persisted display settings to the engine (mirrors iOS onAppear sync). */
    fun syncInitialSettings() {
        setMaxSpeed(state.maxSpeed.toInt())
        setOrbitLinesVisible(state.orbitLines)
        setPlanetLabelsVisible(state.planetLabels)
        setCinematicMode(state.cinematic)
        setLUTEnabled(state.lutEnabled)
        setLUTIntensity(state.lutIntensity)
        setAmbientHum(state.ambientHum)
        setHaptics(state.haptics)
    }

    fun setHaptics(on: Boolean) {
        onHapticsChanged(on)
        flight?.enabled = on
        call("window.RTHaptics&&window.RTHaptics.setEnabled&&window.RTHaptics.setEnabled($on)")
    }

    fun setAmbientHum(on: Boolean) {
        onAmbientHumChanged(on)
        call("window.galaxyExplorer&&window.galaxyExplorer.setAmbientHum&&window.galaxyExplorer.setAmbientHum($on)")
    }
}
