package com.nicedreamz.realtimespace

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import android.graphics.Paint
import kotlin.math.min

/**
 * Faithful Compose port of the iOS SimpleRadarView (the radar ContentView actually shows;
 * Holographic4DRadarView is dead code). Top-down disc: radial teal->black fill, 2 range rings,
 * a forward ±22 deg cone, "FWD" label, a GREEN center ship dot, and labeled contact blips.
 * Fed by state.radar (RADAR bridge). No sweep animation (iOS SimpleRadar has none).
 */
@Composable
fun RadarView(state: SpaceState, sizeDp: Int = 120) {
    val density = LocalDensity.current
    val frame = sizeDp.dp
    val blips = state.radar

    Box(Modifier.size(frame)) {
        Canvas(Modifier.size(frame)) {
            val c = Offset(size.width / 2f, size.height / 2f)
            val R = min(size.width, size.height) / 2f  // ~55dp disc radius

            // background radial gradient (teal-black -> black)
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color(0xFF001E29).copy(alpha = 0.55f), Color.Black.copy(alpha = 0.35f)),
                    center = c, radius = R
                ),
                radius = R, center = c
            )

            // 2 range rings
            drawCircle(Cyan.copy(alpha = 0.15f), radius = R * 0.5f, center = c, style = Stroke(with(density) { 0.5.dp.toPx() }))
            drawCircle(Cyan.copy(alpha = 0.45f), radius = R, center = c, style = Stroke(with(density) { 1.2.dp.toPx() }))

            // forward cone: filled wedge apex-at-center spanning +/-22 deg around straight up
            val half = Math.toRadians(22.0)
            val cone = Path().apply {
                moveTo(c.x, c.y)
                lineTo(c.x + (R * Math.sin(-half)).toFloat(), c.y - (R * Math.cos(-half)).toFloat())
                lineTo(c.x + (R * Math.sin(half)).toFloat(), c.y - (R * Math.cos(half)).toFloat())
                close()
            }
            drawPath(
                cone,
                brush = Brush.verticalGradient(
                    colors = listOf(Cyan.copy(alpha = 0.18f), Color.Transparent),
                    startY = c.y - R, endY = c.y
                )
            )

            val plotR = R - with(density) { 6.dp.toPx() }
            val namePaint = Paint().apply { isAntiAlias = true; textSize = with(density) { 6.5.dp.toPx() } }
            val distPaint = Paint().apply { isAntiAlias = true; textSize = with(density) { 5.5.dp.toPx() } }

            blips.take(28).forEach { b ->
                val bx = c.x + b.rx.coerceIn(-1f, 1f) * plotR
                val by = c.y - b.ry.coerceIn(-1f, 1f) * plotR
                val col = blipColor(b.type, b.name)
                val big = b.type.equals("planet", true) || b.type.equals("star", true)
                val dotR = with(density) { (if (big) 3f else 2f).dp.toPx() }
                drawCircle(col, radius = dotR, center = Offset(bx, by))
                if (big) {
                    val short = shortName(b.name)
                    val yOff = with(density) { 11.dp.toPx() }
                    namePaint.color = col.toArgb()
                    drawContext.canvas.nativeCanvas.drawText(short, bx - namePaint.measureText(short) / 2f, by + yOff, namePaint)
                    val d = b.dist.toInt()
                    val dTxt = if (d >= 1000) String.format("%.1fk", d / 1000f) else "$d"
                    distPaint.color = col.copy(alpha = 0.6f).toArgb()
                    drawContext.canvas.nativeCanvas.drawText(dTxt, bx - distPaint.measureText(dTxt) / 2f, by + yOff + with(density) { 7.dp.toPx() }, distPaint)
                }
            }

            // center ship marker (GREEN, glow)
            drawCircle(Color(0xFF34C759).copy(alpha = 0.5f), radius = with(density) { 5.dp.toPx() }, center = c)
            drawCircle(Color(0xFF34C759), radius = with(density) { 3.dp.toPx() }, center = c)

            // FWD label at top
            val fwdPaint = Paint().apply {
                isAntiAlias = true
                textSize = with(density) { 7.dp.toPx() }
                color = Cyan.copy(alpha = 0.7f).toArgb()
                typeface = android.graphics.Typeface.create(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD)
            }
            val fwd = "FWD"
            drawContext.canvas.nativeCanvas.drawText(fwd, c.x - fwdPaint.measureText(fwd) / 2f, c.y - R + with(density) { 9.dp.toPx() }, fwdPaint)
        }
    }
}

private fun shortName(name: String): String {
    val n = name.lowercase()
    return when {
        n.startsWith("mercury") -> "MER"; n.startsWith("venus") -> "VEN"
        n.startsWith("earth") -> "EAR"; n.startsWith("mars") -> "MAR"
        n.startsWith("jupiter") -> "JUP"; n.startsWith("saturn") -> "SAT"
        n.startsWith("uranus") -> "URA"; n.startsWith("neptune") -> "NEP"
        n.startsWith("sun") -> "SUN"
        else -> name.take(3).uppercase()
    }
}

private fun blipColor(type: String, name: String): Color = when (type.lowercase()) {
    "star" -> Color(0xFFFFCC00)
    "blackhole", "black_hole" -> Color(0xFFAF52DE)
    "nebula" -> Color(0xFFFF6699)
    "moon" -> Color(0xFF8E8E93)
    "asteroid" -> Color(0xFF998066)
    else -> when {
        name.startsWith("Earth", true) -> Color(0xFF4CA6FF)
        name.startsWith("Mars", true) -> Color(0xFFF26640)
        name.startsWith("Jupiter", true) -> Color(0xFFD9A666)
        name.startsWith("Saturn", true) -> Color(0xFFF2D98C)
        name.startsWith("Venus", true) -> Color(0xFFF2D173)
        name.startsWith("Neptune", true) || name.startsWith("Uranus", true) -> Color(0xFF66B3F2)
        else -> Cyan
    }
}
