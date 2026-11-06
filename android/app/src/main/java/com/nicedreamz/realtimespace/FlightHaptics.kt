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
 * amplitude control get the real amplitude; the rest get the same energy as a duty cycle
 * (longer on-time per period). Deliberately faint: the strongest rumble+swell is 0.45 of
 * full strength, the same gains as the iOS player.
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
        val level = if (intensity < 0.01f) 0 else ((intensity / maxIntensity) * levels).toInt().coerceIn(1, levels)
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
            // On/off motor: carry the same strength as a duty cycle, at least 4 ms on.
            val on = (periodMs * strength).toLong().coerceIn(4L, periodMs - 4L)
            VibrationEffect.createWaveform(longArrayOf(0, on, periodMs - on), 1)
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
        currentLevel = 0
        play(v, effect)
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
