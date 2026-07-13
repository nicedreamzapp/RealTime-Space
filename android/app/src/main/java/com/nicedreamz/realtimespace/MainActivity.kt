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
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader

private const val TAG = "RTSpace"
const val ASSET_BASE = "https://appassets.androidplatform.net/assets/web/"

class MainActivity : ComponentActivity() {

    private val state = SpaceState()
    private lateinit var bridge: WebBridge

    @Suppress("DEPRECATION")
    private fun vibrator() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
        getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        bridge = WebBridge(vibrator(), state, onReady = { onEngineReady() })

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        setContent {
          androidx.compose.foundation.layout.Box(Modifier.fillMaxSize()) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
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

                        webViewClient = object : WebViewClient() {
                            override fun shouldInterceptRequest(
                                view: WebView,
                                request: WebResourceRequest
                            ): WebResourceResponse? =
                                assetLoader.shouldInterceptRequest(request.url)
                        }

                        webChromeClient = object : WebChromeClient() {
                            override fun onConsoleMessage(cm: ConsoleMessage): Boolean {
                                Log.d("RTSpaceJS", "${cm.messageLevel()} ${cm.message()} @${cm.sourceId()}:${cm.lineNumber()}")
                                return true
                            }
                        }

                        loadUrl(ASSET_BASE + "index.html")
                    }
                }
            )
            // Native flight chrome overlays the WebView (Tier 3)
            SpaceChrome(state, bridge)
          }
        }
    }

    /** READY handshake from the web engine: sync persisted settings + resend current nav state. */
    private fun onEngineReady() {
        state.engineReady = true
        bridge.syncInitialSettings()
        bridge.sendNavUpdate() // resend current (held) input so boot-time state isn't lost
        Log.i(TAG, "engine ready — settings synced")
    }
}
