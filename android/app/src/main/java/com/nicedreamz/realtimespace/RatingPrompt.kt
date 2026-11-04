package com.nicedreamz.realtimespace

import android.app.Activity
import android.content.Context
import android.util.Log
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * When to ask for a Play rating (matches iOS RatingPrompt.swift): only after a completed
 * flight to a planet or moon, never on the first launch, not before the 3rd arrival, at most
 * once every 60 days per device. Google decides whether the review card actually shows.
 */
object RatingPrompt {
    private const val PREFS = "rating_prompt"
    private const val K_ARRIVALS = "arrivals"
    private const val K_LAUNCHES = "launches"
    private const val K_LAST = "last_asked_ms"
    private const val MIN_ARRIVALS = 3
    private const val MIN_DAYS_BETWEEN = 60L

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun noteLaunch(c: Context) {
        val p = prefs(c); p.edit().putInt(K_LAUNCHES, p.getInt(K_LAUNCHES, 0) + 1).apply()
    }

    fun recordArrival(c: Context) {
        val p = prefs(c); p.edit().putInt(K_ARRIVALS, p.getInt(K_ARRIVALS, 0) + 1).apply()
    }

    /** True (and stamps the time) when this arrival is a moment to ask. */
    fun claimAskIfDue(c: Context, now: Long = System.currentTimeMillis()): Boolean {
        val p = prefs(c)
        if (p.getInt(K_ARRIVALS, 0) < MIN_ARRIVALS || p.getInt(K_LAUNCHES, 0) < 2) return false
        val last = p.getLong(K_LAST, 0L)
        if (last > 0 && now - last < MIN_DAYS_BETWEEN * 86_400_000L) return false
        p.edit().putLong(K_LAST, now).apply()
        return true
    }

    fun launchReview(activity: Activity) {
        if (activity.isFinishing || activity.isDestroyed) return
        val manager = ReviewManagerFactory.create(activity)
        manager.requestReviewFlow().addOnCompleteListener { req ->
            if (req.isSuccessful) {
                manager.launchReviewFlow(activity, req.result)
                Log.i("RTSpace", "rating: review flow launched")
            } else {
                Log.w("RTSpace", "rating: requestReviewFlow failed: ${req.exception?.message}")
            }
        }
    }
}
