package com.nicedreamz.realtimespace

import android.app.Activity
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
 * from first launch, then the one-time $0.99 non-consumable
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
    var price by mutableStateOf("$0.99")
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    private var billingReady = false
    private var details: ProductDetails? = null

    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK ->
                purchases?.forEach { handlePurchase(it) }
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> grantUnlock()
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
        billing.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                billingReady = result.responseCode == BillingClient.BillingResponseCode.OK
                if (billingReady) {
                    refreshEntitlement()
                    loadProduct()
                }
            }
            override fun onBillingServiceDisconnected() { billingReady = false }
        })
    }

    /** Call at launch and on every foreground return — the day can roll over. */
    fun refreshTrial() {
        val first = prefs.getLong(KEY_FIRST_LAUNCH, System.currentTimeMillis())
        val elapsedDays = ((System.currentTimeMillis() - first) / 86_400_000L).toInt()
        daysRemaining = (TRIAL_DAYS - elapsedDays).coerceAtLeast(0)
        locked = !isUnlocked && daysRemaining <= 0
    }

    private fun refreshEntitlement() {
        billing.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build()
        ) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return@queryPurchasesAsync
            purchases.filter {
                it.products.contains(PRODUCT_ID) &&
                    it.purchaseState == Purchase.PurchaseState.PURCHASED
            }.forEach { handlePurchase(it) }
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
                details = list.firstOrNull()
                details?.oneTimePurchaseOfferDetails?.formattedPrice?.let { price = it }
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (!purchase.products.contains(PRODUCT_ID)) return
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (!purchase.isAcknowledged) {
            billing.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.purchaseToken).build()
            ) { _ -> }
        }
        grantUnlock()
    }

    private fun grantUnlock() {
        prefs.edit().putBoolean(KEY_UNLOCKED, true).apply()
        isUnlocked = true
        locked = false
    }

    fun buy() {
        errorMessage = null
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
        if (!billingReady) { connect(); return }
        refreshEntitlement()
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
        if (dismissable) {
            TextButton(onClick = { onClose?.invoke() }) {
                Text("Not now — keep exploring free", color = Color(0xFF8FA3C8))
            }
        }
        store.errorMessage?.let {
            Text(it, color = Color(0xFFFF7A7A), fontSize = 13.sp, textAlign = TextAlign.Center,
                 modifier = Modifier.padding(top = 10.dp))
        }
    }
}
