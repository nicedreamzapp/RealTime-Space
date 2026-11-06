package com.nicedreamz.realtimespace

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Flight haptics driven by RTHaptics.js (same JS API as iOS, where Core Haptics plays them):
 *  - rumble 0..1: ship speed (cruise + warp on a log scale + a small thrust push)
 *  - swell 0..1: depth in the nearest star's / black hole's gravity well (1/r potential)
 *  - warpIn / warpOut: one crisp tick each.
 *
 * Android has no continuous player with live intensity, so the rumble is a short repeating
 * waveform (40 ms period) re-issued only when its quantised strength changes. Phones with
 * amplitude control get the real amplitude. On/off motors (no amplitude control) can't play a
 * faint rumble at all: a duty cycle there is a constant 25 Hz buzz. They get nothing below
 * [pulseThreshold] of full rumble, and above it only separate short pulses whose rate rises
 * with strength (one every 600 ms up to one every 200 ms), never a continuous buzz.
 * Deliberately faint: the strongest rumble+swell is 0.45 of full strength, the same gains as
 * the iOS player.
 *
 * Off when the user toggle is off or Battery Saver is on (the continuous buzz is the battery
 * cost; iOS skips it in Low Power Mode the same way). A watchdog stops the rumble if the web
 * layer goes quiet for 1.5 s (paused loop, reload, backgrounded app).
 */
class FlightHaptics(private val context: Context, private val vibrator: Vibrator?) {
    @Volatile var enabled: Boolean = true
        set(v) { field = v; if (!v) main.post { stop() } }

    private val main = Handler(Looper.getMainLooper())
    private val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager

    private val rumbleGain = 0.22f
    private val swellGain = 0.30f
    private val maxIntensity = 0.45f
    private val periodMs = 40L
    private val levels = 16
    /** No-amplitude motors: silent below this fraction of the max rumble (warp or a deep well). */
    private val pulseThreshold = 0.4f

    private var currentLevel = 0
    private var lastUpdate = 0L
    private val watchdog = object : Runnable {
        override fun run() {
            if (currentLevel == 0) return
            if (SystemClock.uptimeMillis() - lastUpdate > 1500) stop() else main.postDelayed(this, 500)
        }
    }

    private val hasAmp: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && vibrator?.hasAmplitudeControl() == true

    private fun powerSave() = power?.isPowerSaveMode == true

    /** Called on the main thread with the latest values from RTHaptics.js. */
    fun setFlight(rumble: Float, swell: Float) {
        val v = vibrator ?: return
        if (!v.hasVibrator() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        lastUpdate = SystemClock.uptimeMillis()
        if (!enabled || powerSave()) { stop(); return }
        val r = rumble.coerceIn(0f, 1f)
        val s = swell.coerceIn(0f, 1f)
        val intensity = minOf(maxIntensity, r * rumbleGain + s * swellGain)
        // Quantise against the max so a slowly changing speed doesn't restart the waveform
        // every update: at most `levels` distinct strengths.
        var level = if (intensity < 0.01f) 0 else ((intensity / maxIntensity) * levels).toInt().coerceIn(1, levels)
        if (!hasAmp && level < levels * pulseThreshold) level = 0
        if (level == currentLevel) return
        if (level == 0) { stop(); return }
        val wasRunning = currentLevel != 0
        currentLevel = level
        val strength = maxIntensity * level / levels   // 0..0.45 of full
        val effect = if (hasAmp) {
            // Constant on with the real amplitude.
            val amp = (strength * 255f).toInt().coerceIn(1, 255)
            VibrationEffect.createWaveform(longArrayOf(periodMs), intArrayOf(amp), 0)
        } else {
            // On/off motor: separate short pulses, never a buzz. 0 at the threshold .. 1 at max.
            val k = ((level.toFloat() / levels - pulseThreshold) / (1f - pulseThreshold)).coerceIn(0f, 1f)
            val on = (8 + 6 * k).toLong()                 // 8..14 ms tap
            val gap = (600 - 400 * k).toLong() - on       // one pulse per 600..200 ms
            VibrationEffect.createWaveform(longArrayOf(0, on, gap), 1)
        }
        play(v, effect)
        if (!wasRunning) { main.removeCallbacks(watchdog); main.postDelayed(watchdog, 500) }
    }

    fun tick(style: String) {
        val v = vibrator ?: return
        if (!enabled || !v.hasVibrator() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val entering = style == "warpIn"
        val effect = if (hasAmp) {
            VibrationEffect.createOneShot(if (entering) 18L else 14L, if (entering) 153 else 115)   // 0.6 / 0.45
        } else {
            VibrationEffect.createOneShot(if (entering) 14L else 10L, VibrationEffect.DEFAULT_AMPLITUDE)
        }
        // A one-shot replaces the running rumble; the next flight update restarts it.
        interrupted()
        play(v, effect)
    }

    /** Any one-shot vibration (a tick here, a UI tap in WebBridge.haptic) cancels the running
     *  waveform. Forget the level so the next flight update re-issues the rumble. Main thread. */
    fun interrupted() {
        main.removeCallbacks(watchdog)
        currentLevel = 0
    }

    fun stop() {
        main.removeCallbacks(watchdog)
        if (currentLevel != 0) {
            currentLevel = 0
            try { vibrator?.cancel() } catch (_: Exception) {}
        }
    }

    private fun play(v: Vibrator, effect: VibrationEffect) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Media usage: follows the user's "media vibration" strength / off setting.
                v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA))
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).build())
            }
        } catch (_: Exception) {}
    }
}
