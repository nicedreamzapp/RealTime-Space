package com.nicedreamz.realtimespace

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.security.MessageDigest
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * Free-voyage model, mirroring iOS StoreManager: everything free for 60 days
 * from first launch, then the one-time $1.99 non-consumable
 * "com.nicedreamz.realtimespace.unlock" hard-gates the app. NOT a subscription.
 * First-launch date persists in SharedPreferences (iOS uses the Keychain).
 */
class StoreManager(private val activity: Activity) {

    companion object {
        const val PRODUCT_ID = "com.nicedreamz.realtimespace.unlock"
        const val TRIAL_DAYS = 60
        private const val PREFS = "rtspace_store"
        private const val KEY_FIRST_LAUNCH = "first_launch_ms"
        private const val KEY_UNLOCKED = "unlocked_forever"
    }

    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var isUnlocked by mutableStateOf(prefs.getBoolean(KEY_UNLOCKED, false))
        private set
    var locked by mutableStateOf(false)
        private set
    var daysRemaining by mutableStateOf(TRIAL_DAYS)
        private set
    var price by mutableStateOf("$1.99")
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set
    /** Neutral status line on the unlock screen (restore result, pending purchase). */
    var infoMessage by mutableStateOf<String?>(null)
        private set

    private var billingReady = false
    private var connecting = false
    private var details: ProductDetails? = null
    private val main = Handler(Looper.getMainLooper())
    /** Reconnect backoff after Play's billing service drops: 1, 2, 4 ... 30 s. */
    private var reconnectDelayMs = 1_000L
    /** A restore tapped while billing was down: run it (and report) once connected. */
    private var restoreWhenReady = false

    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK ->
                purchases?.forEach { handlePurchase(it) }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                grantUnlock()
                refreshEntitlement()   // picks up and acknowledges the owned purchase
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> { /* their call */ }
            else -> errorMessage = "Purchase didn't complete — you were not charged."
        }
    }

    private val billing: BillingClient = BillingClient.newBuilder(activity)
        .setListener(purchasesUpdated)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .build()

    init {
        if (!prefs.contains(KEY_FIRST_LAUNCH)) {
            prefs.edit().putLong(KEY_FIRST_LAUNCH, System.currentTimeMillis()).apply()
        }
        refreshTrial()
        connect()
    }

    private fun connect() {
        if (billingReady || connecting) return
        connecting = true
        billing.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                main.post {
                    connecting = false
                    billingReady = result.responseCode == BillingClient.BillingResponseCode.OK
                    if (billingReady) {
                        reconnectDelayMs = 1_000L
                        if (restoreWhenReady) { restoreWhenReady = false; refreshEntitlement(report = true) }
                        else refreshEntitlement()
                        loadProduct()
                    } else if (restoreWhenReady) {
                        restoreWhenReady = false
                        infoMessage = null
                        errorMessage = "Google Play isn't connected right now. Check your connection and try again."
                    }
                }
            }
            override fun onBillingServiceDisconnected() {
                // Play's service dropped (Play Store updated, killed, or offline): reconnect
                // with backoff so a purchase finished in the meantime still gets granted.
                main.post {
                    connecting = false
                    billingReady = false
                    val wait = reconnectDelayMs
                    reconnectDelayMs = (reconnectDelayMs * 2).coerceAtMost(30_000L)
                    main.postDelayed({ if (!activity.isFinishing && !activity.isDestroyed) connect() }, wait)
                }
            }
        })
    }

    /** Foreground return: roll the trial day and re-check Play for purchases that finished
     *  while we were away (pending ones that cleared, a purchase made on another screen). */
    fun onResume() {
        refreshTrial()
        if (billingReady) refreshEntitlement() else connect()
    }

    /** Call at launch and on every foreground return — the day can roll over. */
    fun refreshTrial() {
        val first = prefs.getLong(KEY_FIRST_LAUNCH, System.currentTimeMillis())
        val elapsedDays = ((System.currentTimeMillis() - first) / 86_400_000L).toInt()
        daysRemaining = (TRIAL_DAYS - elapsedDays).coerceAtLeast(0)
        locked = !isUnlocked && daysRemaining <= 0
    }

    /** Ask Play what this account owns. With report = true (Restore), always leave a message:
     *  restored, still pending, nothing found, or Play didn't answer. */
    private fun refreshEntitlement(report: Boolean = false) {
        billing.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build()
        ) { result, purchases ->
            main.post {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    if (report) { infoMessage = null; errorMessage = "Google Play didn't answer. Check your connection and try again." }
                    return@post
                }
                val ours = purchases.filter { it.products.contains(PRODUCT_ID) }
                ours.forEach { handlePurchase(it) }
                if (!report) return@post
                when {
                    ours.any { it.purchaseState == Purchase.PurchaseState.PURCHASED } ->
                        infoMessage = "Purchase restored. Thanks for supporting RealTime Space!"
                    ours.any { it.purchaseState == Purchase.PurchaseState.PENDING } ->
                        infoMessage = "Your purchase is still pending with Google Play. It unlocks as soon as it clears."
                    else -> {
                        infoMessage = null
                        errorMessage = "No previous purchase found for this Google account."
                    }
                }
            }
        }
    }

    private fun loadProduct() {
        billing.queryProductDetailsAsync(
            QueryProductDetailsParams.newBuilder().setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                )
            ).build()
        ) { result, list ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                details = list.productDetailsList.firstOrNull()
                details?.oneTimePurchaseOfferDetails?.formattedPrice?.let { price = it }
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (!purchase.products.contains(PRODUCT_ID)) return
        if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
            // Cash / slow payment methods: Play confirms later. onResume and the listener
            // pick it up when it clears; nothing is granted until then.
            main.post { infoMessage = "Your purchase is pending with Google Play. It unlocks as soon as it clears." }
            return
        }
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        // Grant first, then acknowledge. An acknowledge that fails is retried on the next
        // refresh (launch, resume, restore): Play refunds purchases left unacknowledged for
        // 3 days, so every refresh re-sends it until it sticks.
        main.post { grantUnlock() }
        if (!purchase.isAcknowledged) {
            billing.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.purchaseToken).build()
            ) { _ -> }
        }
    }

    private fun grantUnlock() {
        prefs.edit().putBoolean(KEY_UNLOCKED, true).apply()
        isUnlocked = true
        locked = false
        errorMessage = null
    }

    /**
     * Gift codes. These are Matt's OWN codes, not Google Play promo codes: Play's are
     * unchoosable strings, limited in number, and only redeem inside the Play app, which is
     * no use for handing someone a free copy. These are short words, checked here, offline.
     *
     * Stored as SHA-256, and the words themselves are deliberately NOT in this repo - a hash
     * is one-way, a comment naming the code is not. To mint one:
     *   echo -n YOURCODE | shasum -a 256
     * The digests match the iPhone build exactly, so one word works on both platforms.
     */
    private val codeHashes = setOf(
        "53edfbd29c8559f897047209b58a90e30fae91759a46ec020274001ccd582bcf",  // gift code 1
        "2f48d108f49087a665c016d1006b60a588fa321fa4e5ef8643b1c4957f199d39",  // gift code 2
        "c8c8f7fe625a1a98824e4fc4887ca38b8caeb22ad91c4f40d500c3378549597e",  // owner
    )

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
            .joinToString("") { "%02x".format(it) }

    /** Returns true and unlocks if the typed code matches; sets errorMessage otherwise. */
    fun applyUnlockCode(raw: String): Boolean {
        val cleaned = raw.uppercase().filter { !it.isWhitespace() && it != '-' }
        if (cleaned.isEmpty()) return false
        if (sha256(cleaned) !in codeHashes) {
            errorMessage = "That code didn't match. Check it and try again."
            return false
        }
        errorMessage = null
        grantUnlock()
        return true
    }

    fun buy() {
        errorMessage = null
        infoMessage = null
        val pd = details
        if (!billingReady || pd == null) {
            errorMessage = "Can't reach Google Play — check your connection and try again."
            if (!billingReady) connect() else loadProduct()
            return
        }
        billing.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder().setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(pd).build()
                )
            ).build()
        )
    }

    fun restore() {
        errorMessage = null
        infoMessage = "Checking Google Play…"
        if (!billingReady) {
            restoreWhenReady = true
            connect()
            // Still not connected after 8 s: say so instead of leaving the button silent.
            main.postDelayed({
                if (restoreWhenReady && !billingReady) {
                    restoreWhenReady = false
                    infoMessage = null
                    errorMessage = "Google Play isn't connected right now. Check your connection and try again."
                }
            }, 8_000L)
            return
        }
        refreshEntitlement(report = true)
    }

    /** Last 10 days of the free voyage (day 50 on), not owned: the small notice is due. */
    val trialEndingSoon: Boolean
        get() = !isUnlocked && !locked && daysRemaining in 1..10

    /** At most once per calendar day. */
    fun claimTrialNotice(): Boolean {
        if (!trialEndingSoon) return false
        val today = System.currentTimeMillis() / 86_400_000L
        if (prefs.getLong("trial_notice_day", -1L) == today) return false
        prefs.edit().putLong("trial_notice_day", today).apply()
        return true
    }
}

/**
 * Unlock screen. Hard gate when the 60-day voyage is over and the unlock isn't owned
 * (onClose == null); dismissable when opened early from the ⋯ panel's "Unlock Forever".
 */
@Composable
fun PaywallOverlay(store: StoreManager, visible: Boolean = store.locked, onClose: (() -> Unit)? = null) {
    if (!visible && !store.locked) return
    val dismissable = !store.locked && onClose != null
    if (dismissable) BackHandler { onClose?.invoke() }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xF2000005))
            .safeDrawingPadding()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("RealTime Space", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text(
            if (store.locked)
                "Your free 60-day voyage has ended.\nUnlock the whole galaxy forever — one time, no subscription."
            else
                "${store.daysRemaining} days left on your free voyage.\nSkip the wait and own the whole galaxy forever — one time, no subscription.",
            color = Color(0xFFB8C2D9), fontSize = 16.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 14.dp, bottom = 26.dp)
        )
        Button(
            onClick = { store.buy() },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3D6BFF))
        ) {
            Text("✨  Unlock Forever · ${store.price}", fontSize = 17.sp,
                 modifier = Modifier.padding(vertical = 6.dp))
        }
        TextButton(onClick = { store.restore() }) {
            Text("Restore purchase", color = Color(0xFF8FA3C8))
        }
        // Code entry opens on this screen rather than sending anyone to the Play app.
        var showCode by remember { mutableStateOf(false) }
        var code by remember { mutableStateOf("") }
        if (!showCode) {
            TextButton(onClick = { showCode = true }) {
                Text("Enter a code", color = Color(0xFF8FA3C8))
            }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    singleLine = true,
                    placeholder = { Text("Your code", color = Color(0xFF6E7B94)) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = {
                        if (store.applyUnlockCode(code)) onClose?.invoke()
                    }),
                    modifier = Modifier.weight(1f)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Button(
                    onClick = { if (store.applyUnlockCode(code)) onClose?.invoke() },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3D6BFF))
                ) { Text("Unlock") }
            }
        }
        if (dismissable) {
            TextButton(onClick = { onClose?.invoke() }) {
                Text("Not now — keep exploring free", color = Color(0xFF8FA3C8))
            }
        }
        store.infoMessage?.let {
            Text(it, color = Color(0xFF9FE3FF), fontSize = 13.sp, textAlign = TextAlign.Center,
                 modifier = Modifier.padding(top = 10.dp))
        }
        store.errorMessage?.let {
            Text(it, color = Color(0xFFFF7A7A), fontSize = 13.sp, textAlign = TextAlign.Center,
                 modifier = Modifier.padding(top = 10.dp))
        }
    }
}
