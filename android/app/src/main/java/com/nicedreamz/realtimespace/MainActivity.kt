package com.nicedreamz.realtimespace

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibratorManager
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

private const val TAG = "RTSpace"
private const val MAX_RENDERER_DEATHS = 3
const val ASSET_BASE = "https://appassets.androidplatform.net/assets/web/"

class MainActivity : ComponentActivity() {

    private val state = SpaceState()
    private lateinit var bridge: WebBridge
    private lateinit var store: StoreManager
    private var webView: WebView? = null
    private var webContainer: android.widget.FrameLayout? = null
    private lateinit var assetLoader: WebViewAssetLoader
    /** Renderer-process deaths in this activity session. Each rebuilt WebView starts one
     *  quality tier lower (?rtdrop=N, read by RTQuality.js), waits longer before rebuilding
     *  (exponential backoff), and after MAX_RENDERER_DEATHS the app shows a plain message
     *  instead of rebuilding into another black screen. */
    private var rendererDeaths = 0
    /** Latest system-bar + cutout insets in dp (= CSS px): top, right, bottom, left. */
    private var webInsets = floatArrayOf(0f, 0f, 0f, 0f)

    @Suppress("DEPRECATION")
    private fun vibrator() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
        getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge-to-edge WITHOUT androidx enableEdgeToEdge(): that helper calls
        // Window.setStatusBarColor / setNavigationBarColor and sets
        // LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES, all deprecated in Android 15 and flagged
        // by Play. Targeting 36, Android 15+ is edge-to-edge already; below that this call plus
        // the transparent bars in themes.xml (and cutout "always" in values-v30) do the same job.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false      // light icons over black space
            isAppearanceLightNavigationBars = false
        }

        if (savedInstanceState == null) RatingPrompt.noteLaunch(this)
        if (savedInstanceState == null) handleDeepLink(intent)
        val prefs = getSharedPreferences("settings", MODE_PRIVATE)
        state.ambientHum = prefs.getBoolean("ambient_hum", false)
        state.haptics = prefs.getBoolean("haptics", true)
        val vib = vibrator()
        val flight = FlightHaptics(this, vib).also { it.enabled = state.haptics }
        bridge = WebBridge(vib, state, onReady = { onEngineReady() }, onArrived = { onArrivedAtWorld() },
            deviceInfoJson = deviceInfoJson(),
            onAmbientHumChanged = { on -> prefs.edit().putBoolean("ambient_hum", on).apply() },
            flight = flight,
            onHapticsChanged = { on -> prefs.edit().putBoolean("haptics", on).apply() })
        store = StoreManager(this)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        setContent {
          // Unlock screen opened early from the ⋯ panel (dismissable); auto-closes on purchase.
          var showUnlock by remember { mutableStateOf(false) }
          LaunchedEffect(store.isUnlocked) { if (store.isUnlocked) showUnlock = false }
          LaunchedEffect(showUnlock) { paywallOpen = showUnlock }
          // The WebView reports env(safe-area-inset-*) = 0, so the web HUD would sit under the
          // status bar / nav bar / cutout. Hand it the real insets (re-sent on every change,
          // including a 180-degree flip that moves the cutout to the other side).
          val dens = LocalDensity.current
          val dir = LocalLayoutDirection.current
          val ins = WindowInsets.systemBars.union(WindowInsets.displayCutout)
          val iT = ins.getTop(dens); val iR = ins.getRight(dens, dir)
          val iB = ins.getBottom(dens); val iL = ins.getLeft(dens, dir)
          LaunchedEffect(iT, iR, iB, iL) {
              val d = dens.density
              webInsets = floatArrayOf(iT / d, iR / d, iB / d, iL / d)
              pushInsets()
          }
          androidx.compose.foundation.layout.Box(Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                // A plain container holds the WebView so a dead renderer process can be
                // swapped for a fresh WebView in place (onRenderProcessGone).
                factory = { ctx ->
                    android.widget.FrameLayout(ctx).apply {
                        setBackgroundColor(0xFF000005.toInt())
                        webContainer = this
                        addView(createWebView(ctx))
                    }
                }
            )
            // Native flight chrome overlays the WebView (Tier 3)
            SpaceChrome(state, bridge, store, onUnlock = { showUnlock = true })
            // Hard gate after the 60-day free voyage (mirrors iOS StoreManager), or the
            // same screen opened early + dismissable from "Unlock Forever" in the panel.
            PaywallOverlay(store, visible = showUnlock || store.locked, onClose = { showUnlock = false })
          }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(ctx: Context): WebView = WebView(ctx).apply {
        layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setBackgroundColor(0xFF000005.toInt())

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        }
        WebView.setWebContentsDebuggingEnabled(true)

        // JS -> native bridge object (index.html shim forwards iosHandler here)
        addJavascriptInterface(bridge, "AndroidBridge")
        bridge.webView = this
        webView = this

        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String?) {
                pushInsets()
            }

            // The renderer process died (GPU driver crash, or the system killed it for memory).
            // Without this override the whole app is killed with it; returning true keeps the
            // app alive, and a fresh WebView reloads the engine in the same spot.
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail?): Boolean {
                Log.w(TAG, "WebView renderer gone (crashed=${detail?.didCrash()}), rebuilding the WebView")
                replaceDeadWebView(view)
                return true
            }
        }

        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                Log.d("RTSpaceJS", "${cm.messageLevel()} ${cm.message()} @${cm.sourceId()}:${cm.lineNumber()}")
                return true
            }
        }

        loadUrl(ASSET_BASE + "index.html" + if (rendererDeaths > 0) "?rtdrop=$rendererDeaths" else "")
    }

    /** Swap a WebView whose renderer died for a new one in the same container, one tier lower
     *  each time. Backoff doubles per death (0 s, 2 s, ...); the third death in a session shows
     *  a plain message with a retry instead of looping on a GPU that can't hold the scene. */
    private fun replaceDeadWebView(dead: WebView) {
        val container = webContainer ?: return
        if (this::bridge.isInitialized) {
            bridge.flight?.stop()
            if (bridge.webView === dead) bridge.webView = null
        }
        if (webView === dead) webView = null
        state.engineReady = false
        container.removeView(dead)
        try { dead.destroy() } catch (_: Exception) {}
        rendererDeaths++
        if (rendererDeaths >= MAX_RENDERER_DEATHS) {
            Log.w(TAG, "renderer died $rendererDeaths times, showing the stop message")
            showRendererStoppedMessage(container)
            return
        }
        val delay = if (rendererDeaths <= 1) 0L else 1_000L shl (rendererDeaths - 1)   // 0, 2 s, 4 s ...
        Handler(Looper.getMainLooper()).postDelayed({
            if (isFinishing || isDestroyed || webView != null) return@postDelayed
            container.addView(createWebView(this))
        }, delay)
    }

    private fun showRendererStoppedMessage(container: android.widget.FrameLayout) {
        val msg = android.widget.TextView(this).apply {
            text = "The 3D view stopped because this phone's graphics kept crashing.\n\nTap to try again with lighter graphics."
            setTextColor(0xFFE6E9F0.toInt())
            textSize = 17f
            gravity = android.view.Gravity.CENTER
            val p = (32 * resources.displayMetrics.density).toInt()
            setPadding(p, p, p, p)
            layoutParams = android.widget.FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            isClickable = true
            setOnClickListener {
                container.removeView(this)
                // one more try, at the lowest tier (rtdrop stays >= 2 so RTQuality starts low)
                rendererDeaths = MAX_RENDERER_DEATHS - 1
                if (webView == null) container.addView(createWebView(this@MainActivity))
            }
        }
        container.addView(msg)
    }

    override fun onPause() {
        super.onPause()
        if (this::bridge.isInitialized) bridge.flight?.stop()
    }

    override fun onResume() {
        super.onResume()
        if (this::store.isInitialized) store.refreshTrial()
    }

    /** index.html turns these into --sai-top/right/bottom/left, used wherever iOS uses env(). */
    private fun pushInsets() {
        val (t, r, b, l) = webInsets.toList()
        webView?.evaluateJavascript("window.__rtsSetInsets&&window.__rtsSetInsets($t,$r,$b,$l)", null)
    }

    /** READY handshake from the web engine: sync persisted settings + resend current nav state. */
    /** Paywall sheet opened from the menu (the trial-over gate is store.locked). */
    private var paywallOpen = false

    /** Rating request: only right after a completed flight to a planet or moon, never over
     *  the paywall. RatingPrompt enforces 3+ arrivals, not the first launch, 60 days apart. */
    private fun onArrivedAtWorld() {
        RatingPrompt.recordArrival(this)
        if (paywallOpen || store.locked) return
        if (!RatingPrompt.claimAskIfDue(this)) return
        Handler(Looper.getMainLooper()).postDelayed({ RatingPrompt.launchReview(this) }, 1500)
    }

    /** Memory facts for the web texture budget: low-RAM flag, per-app heap class, total RAM. */
    private fun deviceInfoJson(): String {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val mi = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        // model/manufacturer/haptics feed RTQuality.js (start tier) and RTHaptics.js through the
        // index.html shim's window.__RT_DEVICE, the same object the iOS app injects.
        val q = { t: String -> "\"" + t.replace("\\", "").replace("\"", "") + "\"" }
        val haptics = getSharedPreferences("settings", MODE_PRIVATE).getBoolean("haptics", true)
        val json = "{\"lowRam\":${am.isLowRamDevice},\"memClassMB\":${am.memoryClass},\"totalMB\":${mi.totalMem / (1024 * 1024)}," +
            "\"model\":${q(Build.MODEL ?: "")},\"manufacturer\":${q(Build.MANUFACTURER ?: "")},\"sdk\":${Build.VERSION.SDK_INT}," +
            "\"haptics\":$haptics}"
        Log.i(TAG, "device info: $json")
        return json
    }

    /** JS queued by a deep link that arrived before the web engine was ready. */
    private var pendingDeepLinkJs: String? = null

    /** rtspace:// links (store event cards). rtspace://event/geminids flies toward Gemini (Pollux);
     *  any other rtspace:// link just opens the app. Same behaviour as iOS. */
    private fun handleDeepLink(i: android.content.Intent?) {
        val uri = i?.data ?: return
        if (uri.scheme?.lowercase() != "rtspace") return
        val route = ((uri.host ?: "") + (uri.path ?: "")).lowercase()
        if (route != "event/geminids") return
        val js = """(function(){var n=0;var iv=setInterval(function(){n++;var ge=window.galaxyExplorer;var u=window.__universe||[];if(ge&&ge.flyToByName&&u.some(function(o){return o&&o.name==='Pollux';})){clearInterval(iv);ge.flyToByName('Pollux');}else if(n>60){clearInterval(iv);}},500);})()"""
        if (state.engineReady) bridge.runJs(js) else pendingDeepLinkJs = js
        Log.i(TAG, "deep link: $uri (engine ready=${state.engineReady})")
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    private fun onEngineReady() {
        state.engineReady = true
        pendingDeepLinkJs?.let { bridge.runJs(it); pendingDeepLinkJs = null }
        bridge.syncInitialSettings()
        pushInsets()
        bridge.sendNavUpdate() // resend current (held) input so boot-time state isn't lost
        Log.i(TAG, "engine ready — settings synced")
    }
}
