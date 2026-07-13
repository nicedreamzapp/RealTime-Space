package com.nicedreamz.realtimespace

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import android.content.res.Configuration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.hypot
import kotlin.math.roundToInt

private val Mono = FontFamily.Monospace

@Composable
fun SpaceChrome(state: SpaceState, bridge: WebBridge) {
    var showPanel by remember { mutableStateOf(false) }
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    AnimatedVisibility(visible = !state.chromeHidden, enter = fadeIn(), exit = fadeOut()) {
        // safeDrawingPadding keeps every control clear of the status bar, nav bar AND display
        // cutout on all four edges — critical in landscape where the nav bar / notch is on a side.
        Box(Modifier.fillMaxSize().safeDrawingPadding()) {

            // ---------- TOP-RIGHT RAIL: radar, menu, view-mode ----------
            Column(
                Modifier.align(Alignment.TopEnd).padding(horizontal = 12.dp).padding(top = 8.dp),
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                RadarView(state, sizeDp = if (landscape) 92 else 120)
                MenuButton(showPanel) { showPanel = !showPanel }
                ViewModeButton(bridge)
            }

            // ---------- NAVIGATE / SETTINGS PANEL ----------
            AnimatedVisibility(
                visible = showPanel,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = if (landscape) 8.dp else 70.dp, end = 12.dp, bottom = if (landscape) 8.dp else 140.dp),
                enter = slideInHorizontally { it } + fadeIn(),
                exit = slideOutHorizontally { it } + fadeOut()
            ) { NavigatePanel(state, bridge) }

            // ---------- BOTTOM CONSOLE ----------
            Row(
                Modifier.align(Alignment.BottomStart).fillMaxWidth()
                    .padding(horizontal = 12.dp).padding(bottom = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                if (landscape) {
                    // iOS landscape: joystick · speed pill · Spacer · thrust cluster (all bottom)
                    Joystick(state, bridge)
                    Spacer(Modifier.width(12.dp))
                    SpeedPill(state, bridge)
                    Spacer(Modifier.weight(1f))
                    ThrustCluster(state, bridge)
                } else {
                    // iOS portrait: [speed pill / joystick] left · Spacer · thrust cluster right
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.Start) {
                        SpeedPill(state, bridge)
                        Joystick(state, bridge)
                    }
                    Spacer(Modifier.weight(1f))
                    ThrustCluster(state, bridge)
                }
            }
        }
    }
}

@Composable
private fun MenuButton(open: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(PanelBg)
            .border(1.dp, CyanBorder, RoundedCornerShape(10.dp))
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) { Text(if (open) "✕" else "⋯", color = Cyan, fontSize = 20.sp, fontWeight = FontWeight.Medium) }
}

@Composable
private fun ThrustCluster(state: SpaceState, bridge: WebBridge) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
        // Column A: LOCK, STOP
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.width(40.dp).height(34.dp).clip(RoundedCornerShape(12.dp))
                    .background(SpaceGreen.copy(alpha = 0.12f))
                    .border(1.dp, SpaceGreen.copy(alpha = 0.55f), RoundedCornerShape(12.dp))
                    .clickable { bridge.flyToNearestPlanet(); bridge.haptic("light") },
                contentAlignment = Alignment.Center
            ) { Text("➤", color = SpaceGreen, fontSize = 15.sp, modifier = Modifier.rotate(-45f)) }
            Box(
                Modifier.width(40.dp).height(26.dp).clip(RoundedCornerShape(8.dp))
                    .background(SpaceRed.copy(alpha = 0.10f))
                    .border(1.dp, SpaceRed.copy(alpha = 0.55f), RoundedCornerShape(8.dp))
                    .clickable {
                        state.rotX = 0f; state.rotY = 0f; state.isThrusting = false
                        bridge.sendNavUpdate(); bridge.haptic("heavy")
                    },
                contentAlignment = Alignment.Center
            ) { Text("STOP", color = SpaceRed.copy(alpha = 0.9f), fontSize = 9.sp, fontWeight = FontWeight.Bold, fontFamily = Mono) }
        }
        // Column B: WARP, THRUST
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            WarpButton(state, bridge)
            ThrustButton(state, bridge)
        }
    }
}

@Composable
private fun ViewModeButton(bridge: WebBridge) {
    // Match iOS nextViewMode(): landscape offers helm (cockpit) → visor → chase;
    // portrait skips helm (the cockpit art can't show in portrait).
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val modes = if (landscape) listOf("helm", "visor", "chase") else listOf("visor", "chase")
    var idx by remember(landscape) { mutableStateOf(0) }
    val next = modes[(idx + 1) % modes.size]
    val icon = when (next) { "chase" -> "✈"; "visor" -> "👁"; else -> "🧑" }
    Box(
        Modifier.width(50.dp).height(40.dp).clip(RoundedCornerShape(10.dp)).background(PanelBg)
            .border(1.dp, CyanBorder, RoundedCornerShape(10.dp))
            .clickable {
                idx = (idx + 1) % modes.size
                bridge.setViewMode(modes[idx]); bridge.haptic("light")
            },
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(icon, fontSize = 15.sp)
            Text("→ ${next.uppercase()}", color = Cyan, fontSize = 7.sp, fontWeight = FontWeight.Bold, fontFamily = Mono)
        }
    }
}

@Composable
private fun WarpButton(state: SpaceState, bridge: WebBridge) {
    var warping by remember { mutableStateOf(false) }
    Box(
        Modifier.width(68.dp).height(28.dp).clip(RoundedCornerShape(9.dp))
            .background(if (warping) WarpPurple.copy(alpha = 0.9f) else WarpPurpleFill)
            .border(1.dp, WarpPurple.copy(alpha = if (warping) 0.9f else 0.5f), RoundedCornerShape(9.dp))
            .holdGesture(
                onPress = { warping = true; state.isThrusting = true; bridge.setWarpDrive(true); bridge.sendNavUpdate(); bridge.haptic("heavy") },
                onRelease = { warping = false; state.isThrusting = false; bridge.setWarpDrive(false); bridge.sendNavUpdate() }
            ),
        contentAlignment = Alignment.Center
    ) { Text("⚡ 100×", color = if (warping) Color.Black else WarpPurple, fontSize = 11.sp, fontWeight = FontWeight.Black, fontFamily = Mono) }
}

@Composable
private fun ThrustButton(state: SpaceState, bridge: WebBridge) {
    var pressed by remember { mutableStateOf(false) }
    val accent = if (pressed) ThrustOrange else Cyan
    Box(
        Modifier.size(68.dp).clip(RoundedCornerShape(18.dp))
            .background(PanelBg)
            .border(1.dp, accent.copy(alpha = if (pressed) 0.9f else 0.5f), RoundedCornerShape(18.dp))
            .holdGesture(
                onPress = { pressed = true; state.isThrusting = true; bridge.sendNavUpdate(); bridge.haptic("light") },
                onRelease = { pressed = false; state.isThrusting = false; bridge.sendNavUpdate() }
            ),
        contentAlignment = Alignment.Center
    ) {
        Box(Modifier.fillMaxSize().background(accent.copy(alpha = 0.12f), RoundedCornerShape(18.dp)))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(if (pressed) "🔥" else "⬆", color = accent, fontSize = 22.sp)
            Text("THRUST", color = accent, fontSize = 8.sp, fontWeight = FontWeight.Bold, fontFamily = Mono, letterSpacing = 1.sp)
        }
    }
}

/** Circular flight joystick (84dp). rotation.x = -ny, rotation.y = -nx, deadzone 0.08. */
@Composable
private fun Joystick(state: SpaceState, bridge: WebBridge) {
    val density = LocalDensity.current
    val padDp = 84.dp
    val radius = with(density) { padDp.toPx() } / 2f
    var knob by remember { mutableStateOf(Offset.Zero) }

    Box(
        Modifier.size(padDp).clip(CircleShape).background(JoystickBg)
            .border(1.dp, CyanBorder, CircleShape)
            .pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown()
                    fun apply(p: Offset) {
                        val dx = p.x - radius; val dy = p.y - radius
                        var nx = (dx / radius).coerceIn(-1f, 1f); var ny = (dy / radius).coerceIn(-1f, 1f)
                        val mag = hypot(nx, ny)
                        if (mag < 0.08f) { nx = 0f; ny = 0f }
                        state.rotX = -ny; state.rotY = -nx
                        bridge.sendNavUpdate()
                        val clamp = if (mag > 1f) 1f / mag else 1f
                        knob = Offset(nx * clamp * radius, ny * clamp * radius)
                    }
                    apply(down.position)
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull() ?: break
                        if (!ch.pressed) break
                        apply(ch.position); ch.consume()
                    }
                    state.rotX = 0f; state.rotY = 0f; bridge.sendNavUpdate(); knob = Offset.Zero
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(CyanFaint, radius = size.minDimension / 2f * 0.55f, style = Stroke(1f))
        }
        Box(
            Modifier.offset { IntOffset(knob.x.roundToInt(), knob.y.roundToInt()) }
                .size(34.dp).clip(CircleShape)
                .background(Cyan.copy(alpha = 0.85f))
                .border(0.5.dp, Color.White.copy(alpha = 0.6f), CircleShape)
        )
    }
}

@Composable
private fun SpeedPill(state: SpaceState, bridge: WebBridge) {
    Row(
        Modifier.width(160.dp).clip(RoundedCornerShape(11.dp)).background(Color.Black.copy(alpha = 0.6f))
            .border(1.dp, CyanBorder, RoundedCornerShape(11.dp)).padding(horizontal = 10.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("🐢", fontSize = 13.sp)
        Slider(
            value = state.maxSpeed,
            onValueChange = { state.maxSpeed = ((it / 5f).roundToInt() * 5f).coerceIn(15f, 250f) },
            onValueChangeFinished = { bridge.setMaxSpeed(state.maxSpeed.toInt()) },
            valueRange = 15f..250f,
            colors = SliderDefaults.colors(thumbColor = Cyan, activeTrackColor = Cyan, inactiveTrackColor = CyanFaint),
            modifier = Modifier.weight(1f).padding(horizontal = 6.dp)
        )
        Text("${state.maxSpeed.toInt()}", color = Cyan.copy(alpha = 0.85f), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, fontFamily = Mono)
    }
}

@Composable
private fun NavigatePanel(state: SpaceState, bridge: WebBridge) {
    Column(
        Modifier.width(210.dp).clip(RoundedCornerShape(14.dp)).background(PanelFill)
            .border(1.dp, CyanBorder, RoundedCornerShape(14.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp)
    ) {
        SectionHeader("DISPLAY")
        ToggleRow("Orbit Lines", state.orbitLines) { state.orbitLines = it; bridge.setOrbitLinesVisible(it) }
        ToggleRow("Labels", state.planetLabels) { state.planetLabels = it; bridge.setPlanetLabelsVisible(it) }
        ToggleRow("Cinematic", state.cinematic) { state.cinematic = it; bridge.setCinematicMode(it) }
        ToggleRow("Filmic LUT", state.lutEnabled) { state.lutEnabled = it; bridge.setLUTEnabled(it) }
        Text("LUT Intensity", color = Cyan.copy(alpha = 0.85f), fontSize = 11.sp, fontFamily = Mono)
        Slider(
            value = state.lutIntensity, onValueChange = { state.lutIntensity = it },
            onValueChangeFinished = { bridge.setLUTIntensity(state.lutIntensity) }, valueRange = 0f..1f,
            colors = SliderDefaults.colors(thumbColor = Cyan, activeTrackColor = Cyan, inactiveTrackColor = CyanFaint)
        )
        Spacer(Modifier.height(2.dp))
        SectionHeader("FLY TO")
        listOf("Sun", "Earth", "Mars", "Jupiter", "Saturn", "ISS", "Sirius").forEach { name ->
            Text(
                "→  $name", color = Cyan.copy(alpha = 0.9f), fontSize = 11.sp, fontFamily = Mono, fontWeight = FontWeight.Medium,
                modifier = Modifier.fillMaxWidth().clickable { bridge.flyToByName(name); bridge.haptic("light") }.padding(vertical = 4.dp)
            )
        }
    }
}

@Composable
private fun SectionHeader(t: String) =
    Text(t, color = Cyan.copy(alpha = 0.85f), fontSize = 9.sp, fontWeight = FontWeight.Bold, fontFamily = Mono, letterSpacing = 1.5.sp)

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Cyan.copy(alpha = 0.85f), fontSize = 11.sp, fontFamily = Mono, modifier = Modifier.weight(1f))
        Switch(
            checked = checked, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedThumbColor = Color.Black, checkedTrackColor = Cyan, uncheckedTrackColor = PanelBg)
        )
    }
}

// Hold-to-press gesture: onPress on down, onRelease on up/cancel.
private fun Modifier.holdGesture(onPress: () -> Unit, onRelease: () -> Unit): Modifier =
    this.pointerInput(Unit) {
        awaitEachGesture {
            awaitFirstDown(); onPress()
            while (true) { val ev = awaitPointerEvent(); if (ev.changes.none { it.pressed }) break }
            onRelease()
        }
    }
