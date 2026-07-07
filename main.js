// main.js - HUBBLE-QUALITY Galaxy Explorer
// Cinematic space exploration with photorealistic visuals

// Global error handler for debugging
window.onerror = function(msg, url, line, col, error) {
    console.error("❌ GLOBAL ERROR:", msg, "at", url, "line", line, "col", col);
    if (error && error.stack) console.error("Stack:", error.stack);
    return false;
};

window.addEventListener('unhandledrejection', function(event) {
    console.error("❌ UNHANDLED PROMISE:", event.reason);
});

console.log("✅ main.js loaded - HUBBLE-QUALITY Edition");

let rendererCore, lighting, navPhysics, orbitalMechanics, loop, starfield, hygStarfield;
let hud, radar;
let asteroidBelt, comets, nebulae, ambientParticles;
let objects = [];
let floatingDebris = [];

// Exploration system
let celestialCatalog, explorationTracker, navigationArrows;

// Sound + missions
let audioEngine = null;
let missionSystem = null;

// EPIC EFFECTS
let blackHoles = [];
let warpEffect;
let volumetricNebulae = [];

let planetHighlights = [];
let activeFly = null;

let showPlanetLabels = true;

// LUT-related globals
let lutEnabled = false;
let lutIntensity = 0.7;
let lutTexture = null;

// Cinematic mode state
let cinematicMode = false;
let __prevLabels = true;

function setCinematicMode(on) {
    cinematicMode = on;

    // Persist cinematic mode to localStorage
    try {
        localStorage.setItem('cinematicMode', on ? 'true' : 'false');
    } catch (e) {
        // Ignore
    }

    // Adjust bloom pass - cinematic mode gets extra bloom punch
    if (rendererCore?.composer && rendererCore.bloomPass) {
        if (on) {
            rendererCore.bloomPass.strength = 0.5;    // Cinematic glow (still tamer than old default)
            rendererCore.bloomPass.threshold = 0.8;
        } else {
            rendererCore.bloomPass.strength = 0.32;
            rendererCore.bloomPass.threshold = 0.9;
        }
    }

    // Adjust vignette or warp effect if available
    if (warpEffect && typeof warpEffect.setVignetteStrength === 'function') {
        warpEffect.setVignetteStrength(on ? 0.25 : 0.15);
    }

    // Adjust planet labels visibility
    if (on) {
        __prevLabels = showPlanetLabels;
        setPlanetLabelsVisible(false);
    } else {
        setPlanetLabelsVisible(__prevLabels);
    }

    // Show cinematic mode toggle info on HUD if available
    if (hud && typeof hud.showInfo === 'function') {
        hud.showInfo(on ? 'CINEMATIC MODE ON' : 'CINEMATIC MODE OFF', 1500);
    }
}

function getCinematicMode() {
    return cinematicMode;
}

function initGalaxy() {
    console.log("🚀 Initializing HUBBLE-QUALITY Galaxy Explorer");

    if (typeof THREE === 'undefined') {
        console.error("❌ THREE.js not loaded");
        setTimeout(initGalaxy, 100);
        return;
    }

    try {
        // Core rendering systems
        rendererCore = new RendererCore("galaxyCanvas");

        // Enable physically correct lighting and tone mapping for photorealistic visuals
        if (rendererCore && rendererCore.renderer && typeof THREE !== 'undefined') {
            rendererCore.renderer.physicallyCorrectLights = true;
            // ACES Filmic tone mapping for vibrant, cinematic HDR colors
            rendererCore.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            rendererCore.renderer.toneMappingExposure = 1.15; // crisper: deeper blacks, less white wash
            rendererCore.renderer.outputColorSpace = THREE.SRGBColorSpace;
            rendererCore.renderer.shadowMap.enabled = true;
            rendererCore.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

            // Attempt to load LUT texture before composer creation
            lutTexture = null;
            try {
                const loader = new THREE.TextureLoader();
                lutTexture = loader.load(
                    'FilmLUT.png',
                    function(texture) {
                        texture.encoding = THREE.SRGBColorSpace;
                        lutTexture = texture;
                        console.log("🎨 LUT texture loaded");
                    },
                    undefined,
                    function(err) {
                        // failed to load LUT texture - silently ignore
                        lutTexture = null;
                        //console.log("⚠️ LUT texture not found or failed to load");
                    }
                );
            } catch (e) {
                lutTexture = null;
            }

            // Setup post-processing composer if available
            if (typeof THREE.EffectComposer !== 'undefined') {
                const { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass } = THREE;

                // iOS WKWebView renders the composer BLACK when it uses half-float render
                // targets (the old bug). Force a plain 8-bit UnsignedByte target, which every
                // iOS WebGL context supports, so the pipeline actually produces pixels.
                const _dbs = rendererCore.renderer.getDrawingBufferSize(new THREE.Vector2());
                const _iosRT = new THREE.WebGLRenderTarget(_dbs.x, _dbs.y, {
                    type: THREE.UnsignedByteType,
                    format: THREE.RGBAFormat,
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter
                });
                const composer = new EffectComposer(rendererCore.renderer, _iosRT);
                const renderPass = new RenderPass(rendererCore.scene, rendererCore.camera);
                composer.addPass(renderPass);

                // Add bloom pass if available - subtle, realistic bloom for stars
                if (typeof UnrealBloomPass !== 'undefined') {
                    const bloomPass = new UnrealBloomPass(
                        new THREE.Vector2(window.innerWidth, window.innerHeight),
                        0.32,  // Strength — cut from 0.55: bloom was white-washing the sun
                               // disk and planet highlights into glare
                        0.5,   // Radius
                        0.9    // Threshold — only truly blown pixels bloom now
                    );
                    composer.addPass(bloomPass);
                    rendererCore.bloomPass = bloomPass;

                    // UnrealBloomPass allocates its OWN half-float targets internally, which
                    // are the most likely thing to render black on iOS. Force them to 8-bit
                    // and re-allocate at the current size. Wrapped defensively — if the
                    // internals differ across THREE versions, the black-frame guard still
                    // catches any failure.
                    try {
                        const byte = THREE.UnsignedByteType;
                        const rts = [].concat(
                            bloomPass.renderTargetsHorizontal || [],
                            bloomPass.renderTargetsVertical || [],
                            bloomPass.renderTargetBright ? [bloomPass.renderTargetBright] : []
                        );
                        rts.forEach(rt => { if (rt && rt.texture) rt.texture.type = byte; });
                        bloomPass.setSize(window.innerWidth, window.innerHeight);
                    } catch (e) { console.warn("bloom target coercion skipped:", e); }
                }

                // God rays: screen-space radial light shafts from the sun. Samples the
                // frame along the ray toward the sun's screen position, so planets and
                // rings crossing the sun carve real crepuscular shadows into the shafts.
                if (ShaderPass) {
                    const godRaysShader = {
                        uniforms: {
                            tDiffuse: { value: null },
                            uLightPos: { value: new THREE.Vector2(0.5, 0.5) },
                            uIntensity: { value: 0.0 },
                            uDecay: { value: 0.94 },
                            uDensity: { value: 0.9 },
                            uWeight: { value: 0.065 }
                        },
                        vertexShader: `
                            varying vec2 vUv;
                            void main() {
                                vUv = uv;
                                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                            }
                        `,
                        fragmentShader: `
                            uniform sampler2D tDiffuse;
                            uniform vec2 uLightPos;
                            uniform float uIntensity;
                            uniform float uDecay;
                            uniform float uDensity;
                            uniform float uWeight;
                            varying vec2 vUv;

                            void main() {
                                vec3 base = texture2D(tDiffuse, vUv).rgb;
                                vec3 rays = vec3(0.0);
                                if (uIntensity > 0.001) {
                                    vec2 delta = (uLightPos - vUv) * uDensity / 32.0;
                                    vec2 coord = vUv;
                                    float illum = 1.0;
                                    for (int i = 0; i < 32; i++) {
                                        coord += delta;
                                        vec3 s = texture2D(tDiffuse, coord).rgb;
                                        float lum = dot(s, vec3(0.299, 0.587, 0.114));
                                        s *= smoothstep(0.8, 1.25, lum); // only near-blown pixels (the sun core) shaft — star sprites/labels no longer smear into white rays
                                        rays += s * illum * uWeight;
                                        illum *= uDecay;
                                    }
                                }
                                gl_FragColor = vec4(base + rays * uIntensity, 1.0);
                            }
                        `
                    };
                    const godRaysPass = new ShaderPass(godRaysShader);
                    composer.addPass(godRaysPass);
                    rendererCore.godRaysPass = godRaysPass;
                }

                // Add LUT shader pass if LUT texture is loaded
                let lutPass = null;
                if (lutTexture) {
                    // Custom LUT ShaderPass for 3D LUT stored as 32x1024 strip (32 slices, each 32x32)
                    // Note: This shader assumes the LUT texture is a 1024x32 image with 32 vertical slices of 32x32 pixels
                    const lutShader = {
                        uniforms: {
                            tDiffuse: { value: null },
                            lutMap: { value: lutTexture },
                            intensity: { value: lutIntensity }
                        },
                        vertexShader: `
                            varying vec2 vUv;
                            void main() {
                                vUv = uv;
                                gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                            }
                        `,
                        fragmentShader: `
                            precision highp float;
                            uniform sampler2D tDiffuse;
                            uniform sampler2D lutMap;
                            uniform float intensity;
                            varying vec2 vUv;

                            // LUT info constants
                            const float size = 32.0; // LUT dimension (32x32x32)
                            const float sliceSize = 1.0 / size;
                            const float slicePixelSize = sliceSize / size;
                            
                            vec3 sampleAs3DLUT(sampler2D lut, vec3 color) {
                                // Clamp input color
                                color = clamp(color, 0.0, 1.0);

                                // Get the index of the slice
                                float blueIndex = color.b * (size - 1.0);
                                float sliceLow = floor(blueIndex);
                                float sliceHigh = min(size - 1.0, sliceLow + 1.0);
                                float sliceFrac = fract(blueIndex);

                                // Compute UV for low slice
                                float xOffsetLow = sliceLow * sliceSize;
                                vec2 uvLow = vec2(xOffsetLow + color.r * sliceSize + slicePixelSize * 0.5,
                                                  color.g * size * slicePixelSize + slicePixelSize * 0.5);
                                // Compute UV for high slice
                                float xOffsetHigh = sliceHigh * sliceSize;
                                vec2 uvHigh = vec2(xOffsetHigh + color.r * sliceSize + slicePixelSize * 0.5,
                                                  color.g * size * slicePixelSize + slicePixelSize * 0.5);

                                // Sample color from both slices
                                vec3 sliceColorLow = texture2D(lut, uvLow).rgb;
                                vec3 sliceColorHigh = texture2D(lut, uvHigh).rgb;

                                // Interpolate between slices
                                return mix(sliceColorLow, sliceColorHigh, sliceFrac);
                            }

                            void main() {
                                vec4 original = texture2D(tDiffuse, vUv);
                                vec3 lutColor = sampleAs3DLUT(lutMap, original.rgb);

                                // Mix original and LUT color by intensity
                                vec3 finalColor = mix(original.rgb, lutColor, intensity);

                                gl_FragColor = vec4(finalColor, original.a);
                            }
                        `
                    };
                    if (ShaderPass) {
                        lutPass = new ShaderPass(lutShader);
                        lutPass.enabled = lutEnabled;
                        composer.addPass(lutPass);
                        rendererCore.lutPass = lutPass;
                    }
                } else if (ShaderPass) {
                    // Fallback color correction shader if no LUT loaded
                    const colorCorrectionShader = {
                        uniforms: {
                            tDiffuse: { value: null },
                            lift: { value: 0.03 },
                            gamma: { value: 0.92 },
                            gain: { value: 1.12 }
                        },
                        vertexShader: `
                            varying vec2 vUv;
                            void main() {
                                vUv = uv;
                                gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                            }
                        `,
                        fragmentShader: `
                            uniform sampler2D tDiffuse;
                            uniform float lift;
                            uniform float gamma;
                            uniform float gain;
                            varying vec2 vUv;

                            vec3 applyLiftGammaGain(vec3 color, float lift, float gamma, float gain) {
                                color = color + lift;
                                color = pow(color, vec3(gamma));
                                color = color * gain;
                                return color;
                            }

                            void main() {
                                vec4 tex = texture2D(tDiffuse, vUv);
                                vec3 corrected = applyLiftGammaGain(tex.rgb, lift, gamma, gain);
                                gl_FragColor = vec4(corrected, tex.a);
                            }
                        `
                    };
                    const lutPassFallback = new ShaderPass(colorCorrectionShader);
                    composer.addPass(lutPassFallback);
                    rendererCore.lutPass = lutPassFallback;
                    lutPass = lutPassFallback;
                    lutPass.enabled = lutEnabled;
                }

                // Final linear→sRGB conversion. Composer render targets are linear in
                // r150, so without this the whole frame displays too dark.
                if (ShaderPass && THREE.GammaCorrectionShader) {
                    composer.addPass(new ShaderPass(THREE.GammaCorrectionShader));
                }

                rendererCore.composer = composer;
                rendererCore.useComposer = true;
                // TEMP: force direct rendering (bypass composer) for black-screen isolation.
                if (window.__FORCE_DIRECT__) rendererCore.useComposer = false;

                // Restore LUT settings from localStorage
                try {
                    const storedLUTEnabled = localStorage.getItem('lutEnabled');
                    if (storedLUTEnabled !== null) {
                        lutEnabled = (storedLUTEnabled === 'true');
                    }
                    const storedLUTIntensity = localStorage.getItem('lutIntensity');
                    if (storedLUTIntensity !== null) {
                        const val = parseFloat(storedLUTIntensity);
                        if (!isNaN(val)) lutIntensity = val;
                    }
                    if (rendererCore.lutPass) {
                        rendererCore.lutPass.enabled = lutEnabled;
                        if (rendererCore.lutPass.uniforms.intensity) {
                            rendererCore.lutPass.uniforms.intensity.value = lutIntensity;
                        }
                    }
                } catch(e) {
                    // ignore localStorage errors
                }
            } else {
                rendererCore.useComposer = false;
            }
        }

        lighting = new LightingSystem(rendererCore.scene);
        // Low fill: in real space the night side of a planet is nearly black.
        // The sun (point light) does the real work; ambient is just starlight.
        lighting.setOverallIntensity(1.2);
        navPhysics = new NavigationPhysics(rendererCore.camera);

        // Set camera starting position - near Earth orbit for good view of inner solar system
        rendererCore.camera.position.set(200, 80, 280);
        rendererCore.camera.lookAt(0, 0, 0);

        // Restore orbit lines visibility from localStorage if saved
        const savedOrbitLines = localStorage.getItem('orbitLinesVisible');
        if (savedOrbitLines !== null) {
            setOrbitLinesVisible(savedOrbitLines === 'true');
        }

        // Restore planet label visibility from localStorage if saved
        const savedLabels = localStorage.getItem('planetLabelsVisible');
        if (savedLabels !== null) {
            showPlanetLabels = (savedLabels === 'true');
        }

        // Restore cinematic mode from localStorage and apply
        const savedCinematic = localStorage.getItem('cinematicMode');
        if (savedCinematic !== null) {
            setCinematicMode(savedCinematic === 'true');
        }

        // Create rich solar system
        createSolarSystem();
        createPlanetHighlights();

        // Enhanced starfield with accurate colors
        createStarfield();

        // Main asteroid belt with varied types
        createAsteroidBelt();

        // Floating debris near player
        createNearbyDebris();

        // Multiple comets with dual tails
        createComets();

        // Distant nebulae - Hubble-inspired
        createNebulae();

        // Ambient space "dust" — DISABLED. A 1,500-particle cloud that followed the camera
        // made it feel like flying through fog (you're inside the solar system, not a dust
        // storm) and added to the hazy, un-sharp look. Removed for clean, crisp space.
        // createAmbientParticles();

        // EPIC EFFECTS - Black holes, warp, volumetric nebulae
        createBlackHoles();
        // createWarpEffect();  // DISABLED — "light-speed" star streaks on thrust/warp made
        // no sense (stars materializing and flying past you); motion reads through real
        // parallax of the starfield and planets instead. All warpEffect uses are guarded.
        createVolumetricNebulae();

        // Initialize orbital mechanics
        orbitalMechanics = new OrbitalMechanics(objects);
        orbitalMechanics.setTimeScale(1.0);

        // Initialize UI systems
        initHUD();
        initRadar();

        // Initialize exploration system
        initExplorationSystem();
        exposeFlyToAPI();

        // Procedural soundscape (starts on first touch — autoplay policy)
        if (typeof AudioEngine !== 'undefined') {
            audioEngine = new AudioEngine();
        }

        // Missions / challenges
        if (typeof Missions !== 'undefined') {
            missionSystem = new Missions();
            window.missionSystem = missionSystem;
        }

        // Time acceleration control (pill button + JS API)
        createTimeControl();

        // Create update systems
        const systems = createUpdateSystems();

        // Create main update loop
        loop = new UpdateLoop(rendererCore, hud, radar, systems);

        // Add all celestial objects with update methods
        objects.forEach(obj => {
            if (obj.update) loop.addSystem(obj);
        });

        loop.start();

        // Setup iOS bridge for Swift communication
        setupIOSBridge();

        console.log("✅ HUBBLE-QUALITY Galaxy loaded:");
        console.log(`   🌟 ${objects.length} celestial objects`);
        console.log(`   🪨 ${floatingDebris.length} debris particles`);
        console.log(`   ☄️ ${comets.length} comets`);
        console.log(`   ☁️ ${nebulae.length} nebulae`);
        console.log(`   🕳️ ${blackHoles.length} black holes`);
        console.log(`   🌌 ${volumetricNebulae.length} volumetric nebulae`);
        console.log(`   🚀 Warp drive: ${warpEffect ? 'READY' : 'OFFLINE'}`);

    } catch (e) {
        console.error("❌ Initialization error:", e);
    }
}

// RendererExposure helper to manage auto-exposure adjustment
class RendererExposure {
    constructor(renderer, lightingSystem, camera) {
        this.renderer = renderer;
        this.lighting = lightingSystem;
        this.camera = camera;
        this.currentExposure = renderer.toneMappingExposure || 1.0;
        this.targetExposure = 1.0;
        this.lerpSpeed = 0.5; // How fast exposure adapts per second
    }

    update(dt) {
        if (!this.lighting || !this.camera) return;

        // Sample approximate scene luminance from sun and camera distance to sun
        // Using the sun intensity and distance to sun (assumed at origin)
        const sunIntensity = this.lighting.getSunIntensity ? this.lighting.getSunIntensity() : 25.0;
        const camPos = this.camera.position;
        const sunPos = new THREE.Vector3(0, 0, 0);
        const distToSun = camPos.distanceTo(sunPos);

        // Compute exposure target: closer to sun => lower exposure, deep space => higher
        // Clamp distance for exposure calculation (e.g. 50 to 2500)
        const clampedDist = Math.min(Math.max(distToSun, 50), 2500);
        const lerpFactor = (clampedDist - 50) / (2500 - 50);
        // Exposure from 1.0 near sun to 1.4 far away (brighter overall)
        this.targetExposure = 1.0 + lerpFactor * (1.4 - 1.0);

        // Smoothly interpolate current exposure toward target exposure
        const diff = this.targetExposure - this.currentExposure;
        const change = diff * Math.min(dt * this.lerpSpeed, 1);
        this.currentExposure += change;

        // Apply exposure to renderer
        this.renderer.toneMappingExposure = this.currentExposure;
    }
}

let rendererExposure = null;

// One-time guard against the iOS "composer renders black" bug. Reads a wide central band
// of the just-composed frame; if every sampled pixel is black, the post-processing pipeline
// failed on this device and we must fall back to direct rendering. The scene always has a
// Milky-Way background, so a WORKING frame is never all-black here — only the bug is.
function composerFrameIsBlack(renderer) {
    try {
        const gl = renderer.getContext();
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        if (!w || !h) return false;
        const rh = Math.min(h, 512);
        const y0 = Math.floor((h - rh) / 2);
        const buf = new Uint8Array(w * rh * 4);
        gl.readPixels(0, y0, w, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        for (let i = 0; i < buf.length; i += 4) {
            if (buf[i] > 10 || buf[i + 1] > 10 || buf[i + 2] > 10) return false; // real content
        }
        return true; // nothing but black → the bug
    } catch (e) {
        return false; // can't tell → assume OK, don't disable
    }
}

function createUpdateSystems() {
    // Last comet audio play timestamp to avoid spamming audio
    let lastCometAudioTime = 0;
    const cometAudioInterval = 5000; // 5 seconds

    return [
        navPhysics,
        orbitalMechanics,
        {
            name: "Starfield",
            update: (dt, rc) => {
                if (starfield && rc?.camera) {
                    starfield.update(rc.camera.position, dt);
                }
                // Keep the real-sky shell centered on the camera so its stars stay at infinity.
                if (hygStarfield && rc?.camera) {
                    hygStarfield.update(rc.camera.position);
                }
            }
        },
        {
            name: "AsteroidBelt",
            update: (dt) => asteroidBelt?.update(dt)
        },
        {
            name: "NearbyDebris",
            update: (dt) => {
                floatingDebris.forEach(d => {
                    d.mesh.rotation.x += d.rotSpeed.x * dt;
                    d.mesh.rotation.y += d.rotSpeed.y * dt;
                    d.mesh.rotation.z += d.rotSpeed.z * dt;
                    d.mesh.position.add(d.drift.clone().multiplyScalar(dt));
                });
            }
        },
        {
            name: "Comets",
            update: (dt) => comets?.forEach(c => c.update(dt, rendererCore))
        },
        {
            name: "Nebulae",
            update: (dt) => nebulae?.forEach(n => n.update(dt))
        },
        {
            name: "Particles",
            update: (dt) => {
                if (ambientParticles?.points && rendererCore?.camera) {
                    ambientParticles.update(dt);
                    // Keep particles following camera smoothly
                    ambientParticles.points.position.lerp(
                        rendererCore.camera.position.clone(),
                        0.015
                    );
                }
            }
        },
        // Auto-exposure system update
        {
            name: "AutoExposure",
            update: (dt) => {
                if (rendererExposure) {
                    rendererExposure.update(dt);
                }
            }
        },
        // God rays: track the sun's screen position, fade by view angle so the
        // shafts only appear when the sun is actually in (or near) frame
        {
            name: "GodRays",
            update: (dt, rc) => {
                const pass = rendererCore?.godRaysPass;
                if (!pass || !rc?.camera) return;

                const sunNdc = new THREE.Vector3(0, 0, 0).project(rc.camera);
                const onScreenX = sunNdc.x * 0.5 + 0.5;
                const onScreenY = sunNdc.y * 0.5 + 0.5;
                pass.uniforms.uLightPos.value.set(onScreenX, onScreenY);

                const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rc.camera.quaternion);
                const toSun = rc.camera.position.clone().negate().normalize(); // sun at origin
                const facing = Math.max(0, camDir.dot(toSun));

                // Fade out as the sun leaves the frame, kill when behind camera
                const offCenter = Math.hypot(onScreenX - 0.5, onScreenY - 0.5);
                const screenFade = THREE.MathUtils.clamp(1.4 - offCenter, 0, 1);
                const behind = sunNdc.z > 1 ? 0 : 1;

                // 0.35 (was 0.6): full-strength shafts smeared labels/stars radially and
                // washed the whole frame white whenever the sun was in view. The auto-lens
                // solar filter (Star.js) dims the shafts further as it darkens.
                const lens = 1 - 0.8 * (window.__sunFilter || 0);
                pass.uniforms.uIntensity.value = 0.35 * facing * facing * screenFade * behind * lens;
            }
        },
        // Procedural soundscape follows flight state and proximity to bodies
        {
            name: "Audio",
            update: (dt, rc) => {
                if (!audioEngine || !rc?.camera || !navPhysics) return;
                const camPos = rc.camera.position;
                let bhDist = Infinity;
                blackHoles.forEach(bh => {
                    bhDist = Math.min(bhDist, camPos.distanceTo(bh.mesh.position));
                });
                audioEngine.update(dt, {
                    speed: navPhysics.getSpeed(),
                    thrusting: navPhysics.isThrusting,
                    boosting: navPhysics.isBoosting,
                    sunDistance: camPos.length(),
                    blackHoleDistance: bhDist
                });
            }
        },
        // Mission checks (4x per second is plenty)
        {
            name: "Missions",
            update: (() => {
                let frame = 0;
                return (dt, rc) => {
                    if (!missionSystem || !rc?.camera) return;
                    if (++frame % 15 !== 0) return;
                    const camPos = rc.camera.position;
                    let bhDist = Infinity;
                    blackHoles.forEach(bh => {
                        bhDist = Math.min(bhDist, camPos.distanceTo(bh.mesh.position));
                    });
                    missionSystem.update({
                        camPos: camPos,
                        sunDistance: camPos.length(),
                        blackHoleDistance: bhDist,
                        planets: objects.filter(o => o.type === 'planet'),
                        moons: objects.filter(o => o.type === 'moon'),
                        comets: comets || [],
                        saturn: objects.find(o => o.name === 'Saturn')
                    });
                };
            })()
        },
        // Codex: arms the SCAN button when a catalogued body is in range
        {
            name: "Codex",
            update: (dt) => { if (window.codex) window.codex.update(dt); }
        },
        // Planet detail LOD: swap in true high-res textures only when close, free them when
        // far. Earth → 8K day+night; Jupiter/Saturn → real 4K photo. Hysteresis avoids thrash.
        {
            name: "PlanetLOD",
            update: (() => {
                let frame = 0;
                const apply = (body, setter) => {
                    if (!body || !body[setter]) return;
                    const d = rendererCore.camera.position.distanceTo(body.mesh.position);
                    const r = body.radius || 1;
                    if (d < r * 7) body[setter](true);
                    else if (d > r * 11) body[setter](false);
                };
                return (dt, rc) => {
                    if (++frame % 20 !== 0 || !rc?.camera) return;
                    apply(objects.find(o => o.name === 'Earth'), 'setEarthDetail');
                    apply(objects.find(o => o.name === 'Jupiter'), 'setTexturedDetail');
                    apply(objects.find(o => o.name === 'Saturn'), 'setTexturedDetail');
                };
            })()
        },
        {
            name: "UIUpdater",
            update: (dt, rc) => updateUI(rc)
        },
        {
            name: "NavigationArrows",
            update: (dt) => {
                if (navigationArrows) {
                    navigationArrows.update(dt);
                }
            }
        },
        // EPIC EFFECTS UPDATES
        {
            name: "BlackHoles",
            update: (dt) => {
                blackHoles?.forEach(bh => bh.update(dt));
            }
        },
        {
            name: "WarpEffect",
            update: (dt, rc) => {
                if (warpEffect && rc?.camera && navPhysics) {
                    // Star-streak "traveling" cue, driven by real speed: subtle streaks the
                    // moment you thrust, building as you go faster, full hyperspace on boost.
                    // (Was threshold 30 u/s, so normal thrust showed nothing — felt static.)
                    const speed = navPhysics.getSpeed();
                    const warpThreshold = 8;    // streaks begin almost as soon as you move
                    const maxWarpSpeed = 120;   // cruise-speed streak ceiling

                    if (navPhysics.isBoosting) {
                        warpEffect.setIntensity(1.0);           // full hyperspace on boost / 100× warp
                    } else if (speed > warpThreshold) {
                        const t = Math.min(1.0, (speed - warpThreshold) / (maxWarpSpeed - warpThreshold));
                        warpEffect.setIntensity(t * 0.6);       // visible "traveling" streaks while cruising
                    } else {
                        warpEffect.setIntensity(0);
                    }

                    // Update with camera info
                    const cameraDirection = new THREE.Vector3(0, 0, -1);
                    cameraDirection.applyQuaternion(rc.camera.quaternion);
                    warpEffect.update(dt, rc.camera.position, cameraDirection);
                }
            }
        },
        {
            name: "VolumetricNebulae",
            update: (dt, rc) => {
                volumetricNebulae?.forEach(n => {
                    n.update(dt, rc?.camera?.position);
                });
            }
        },
        {
            name: "PlanetHighlights",
            update: (dt, rc) => {
                if (!rc?.camera) return;

                planetHighlights.forEach(ph => {
                    // Always face camera
                    ph.label.quaternion.copy(rc.camera.quaternion);

                    // Compute distance from camera to planet center
                    const dist = rc.camera.position.distanceTo(ph.planet.mesh.getWorldPosition(new THREE.Vector3()));

                    // Label opacity fades from 1 at 600 units to 0 at 1200 units
                    let opacity = 0;
                    if (dist <= 600) opacity = 1;
                    else if (dist < 1200) opacity = 1 - (dist - 600) / 600;
                    opacity = Math.min(Math.max(opacity, 0), 1);

                    ph.label.material.opacity = opacity;

                    if (!ph.glow) return;
                    // Gentle pulse. The ring geometry is already sized to the planet's
                    // radius — scaling by radius again blew the Sun's ring up to ~900
                    // units and draped giant teal sheets across the whole sky.
                    const time = performance.now() * 0.001;
                    const s = 1.0 + 0.06 * Math.sin(time * 3);
                    ph.glow.scale.set(s, s, 1);
                });
            }
        },
        {
            name: "FlyTo",
            update: (dt) => {
                if (!activeFly) return;

                const now = performance.now();
                const elapsed = (now - activeFly.startTime) / 1200;
                const t = Math.min(elapsed, 1);

                // easeInOutCubic
                const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

                // Lerp position
                rendererCore.camera.position.lerpVectors(activeFly.startPos, activeFly.endPos, easeT);

                // Slerp quaternion to lookAt target
                const targetQuat = new THREE.Quaternion();
                const direction = new THREE.Vector3().subVectors(activeFly.endLookAt, rendererCore.camera.position).normalize();
                const up = new THREE.Vector3(0, 1, 0);
                const m = new THREE.Matrix4().lookAt(rendererCore.camera.position, activeFly.endLookAt, up);
                targetQuat.setFromRotationMatrix(m);

                rendererCore.camera.quaternion.slerpQuaternions(activeFly.startQuat, targetQuat, easeT);

                if (t >= 1) {
                    activeFly = null;
                    // Send haptic feedback to iOS on flyTo completion
                    if (window.webkit?.messageHandlers?.iosHandler) {
                        try {
                            window.webkit.messageHandlers.iosHandler.postMessage({
                                type: 'HAPTIC',
                                style: 'success'
                            });
                        } catch (e) {
                            // Ignore postMessage errors
                        }
                    }
                }
            }
        },
        // Comet spatial audio updater - periodic soft positional hiss
        {
            name: "CometAudio",
            update: (dt, rc) => {
                if (!rc?.camera || !comets || comets.length === 0) return;
                const now = performance.now();
                if (now - lastCometAudioTime > cometAudioInterval) {
                    lastCometAudioTime = now;
                    // Find nearest visible comet to camera
                    let nearestComet = null;
                    let minDist = Infinity;
                    comets.forEach(c => {
                        if (!c.mesh) return;
                        const dist = rc.camera.position.distanceTo(c.mesh.position);
                        if (dist < minDist) {
                            minDist = dist;
                            nearestComet = c;
                        }
                    });
                    if (nearestComet && nearestComet.mesh) {
                        postAudioAt('comet_hiss', nearestComet.mesh.position.toArray(), 0.4);
                    }
                }
            }
        },
        // ComposerRender system to handle post-processing rendering if composer is used
        {
            name: "ComposerRender",
            update: (dt, rc) => {
                if (rendererCore?.useComposer && rendererCore?.composer) {
                    rendererCore.composer.render();
                    // iOS SAFETY NET: after a few warmup frames, verify the composer isn't
                    // producing a black screen; if it is, permanently fall back to direct
                    // rendering so bloom can never leave the user staring at black.
                    if (!rendererCore._bloomChecked) {
                        rendererCore._bloomWarm = (rendererCore._bloomWarm || 0) + 1;
                        if (rendererCore._bloomWarm >= 6) {
                            rendererCore._bloomChecked = true;
                            if (composerFrameIsBlack(rendererCore.renderer)) {
                                rendererCore.useComposer = false;
                                console.warn("⚠️ Post-processing produced a BLACK frame on this device — auto-falling back to direct rendering (bloom off, no black screen).");
                            } else {
                                console.log("✅ Post-processing validated — cinematic bloom is ACTIVE.");
                            }
                        }
                    }
                }
                // If no composer, rely on UpdateLoop default rendering
            }
        }
    ];
}

function initHUD() {
    if (typeof HUD !== 'undefined') {
        hud = new HUD('hud-container');
    }
}

// ========== TIME ACCELERATION ==========
const TIME_SCALES = [
    { scale: 1,    label: 'TIME 1×' },
    { scale: 10,   label: 'TIME 10×' },
    { scale: 100,  label: 'TIME 100×' },
    { scale: 1000, label: 'TIME 1000×' },
    { scale: 0,    label: 'TIME ⏸' }
];
let timeScaleIndex = 0;
let timePillEl = null;

function createTimeControl() {
    timePillEl = document.createElement('div');
    timePillEl.id = 'time-pill';
    timePillEl.textContent = TIME_SCALES[0].label;
    timePillEl.style.cssText = `
        position: absolute; top: max(18px, env(safe-area-inset-top)); left: max(18px, env(safe-area-inset-left)); z-index: 120;
        padding: 6px 13px; border-radius: 14px;
        background: rgba(12, 16, 28, 0.55);
        border: 1px solid rgba(140, 200, 255, 0.22);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        color: rgba(150, 220, 255, 0.85);
        font-family: 'SF Mono', 'Menlo', monospace; font-size: 11px;
        letter-spacing: 1.5px; user-select: none; -webkit-user-select: none;
        cursor: pointer;
    `;
    timePillEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        cycleTimeScale();
    });
    document.body.appendChild(timePillEl);
}

function cycleTimeScale() {
    timeScaleIndex = (timeScaleIndex + 1) % TIME_SCALES.length;
    const entry = TIME_SCALES[timeScaleIndex];
    if (orbitalMechanics) orbitalMechanics.setTimeScale(entry.scale);
    if (timePillEl) timePillEl.textContent = entry.label;
    if (hud && typeof hud.showInfo === 'function') {
        hud.showInfo(entry.scale === 0 ? 'ORBITS PAUSED' : `ORBITAL TIME ${entry.scale}×`, 1200);
    }
    return entry.scale;
}

function initRadar() {
    if (typeof SphereRadar !== 'undefined') {
        radar = new SphereRadar('radar-container');
    }
}

function initExplorationSystem() {
    console.log("🔭 Initializing exploration system...");

    // Create celestial catalog
    if (typeof CelestialCatalog !== 'undefined') {
        celestialCatalog = new CelestialCatalog();

        // Register all objects in the catalog
        objects.forEach(obj => {
            celestialCatalog.registerObject(obj);
        });

        // Register nebulae
        if (nebulae) {
            nebulae.forEach(n => celestialCatalog.registerObject(n));
        }

        // Register asteroid belt as a single object
        if (asteroidBelt) {
            celestialCatalog.registerObject({
                name: "Main Asteroid Belt",
                type: "asteroid_belt",
                mesh: asteroidBelt.mesh,
                radius: 50
            });
        }

        console.log(`📚 Catalog populated with ${celestialCatalog.objects.length} objects`);
        window.celestialCatalog = celestialCatalog; // exposed for Codex / Field Guide
    }

    // Create exploration tracker
    if (typeof ExplorationTracker !== 'undefined' && celestialCatalog) {
        explorationTracker = new ExplorationTracker(celestialCatalog, rendererCore.camera);
        window.explorationTracker = explorationTracker;
        console.log("✅ ExplorationTracker initialized");
    }

    // Create navigation arrows
    if (typeof NavigationArrows !== 'undefined') {
        navigationArrows = new NavigationArrows(rendererCore.scene, rendererCore.camera);
        console.log("✅ NavigationArrows initialized");
    }
}

function updateUI(rc) {
    if (!rc?.camera || !navPhysics) return;

    const thrustIndicator = document.getElementById('thrust-indicator');
    if (thrustIndicator) {
        thrustIndicator.classList.toggle('active', navPhysics.isThrusting);
    }

    // Update compass
    const compass = document.getElementById('compass');
    if (compass && rc.camera) {
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyQuaternion(rc.camera.quaternion);
        const heading = Math.atan2(dir.x, dir.z) * (180 / Math.PI);
        const normalizedHeading = ((heading + 360) % 360).toFixed(0).padStart(3, '0');
        compass.textContent = `${normalizedHeading}°`;
    }
}

function setupIOSBridge() {
    let lastLogTime = 0;

    window.galaxyExplorer = window.galaxyExplorer || {};

    window.galaxyExplorer.receiveNavigationUpdate = function(data) {
        if (!data) return;
        // If the engine isn't built yet, stash the latest state instead of dropping it —
        // Swift only sends nav updates on CHANGE, so a thrust held during boot would
        // otherwise be lost until the user released and pressed again.
        if (!navPhysics) { window.__pendingNav = data; return; }

        if (data.rotation) {
            let rx, ry, rz;

            if (Array.isArray(data.rotation)) {
                rx = data.rotation[0] || 0;
                ry = data.rotation[1] || 0;
                rz = data.rotation[2] || 0;
            } else {
                rx = data.rotation.x || 0;
                ry = data.rotation.y || 0;
                rz = data.rotation.z || 0;
            }

            // Normalize values
            const maxVal = Math.max(Math.abs(rx), Math.abs(ry), Math.abs(rz), 1);
            if (maxVal > 1.5) {
                rx /= maxVal;
                ry /= maxVal;
                rz /= maxVal;
            }

            // Debug logging
            const now = Date.now();
            if (now - lastLogTime > 500 && (Math.abs(rx) > 0.1 || Math.abs(ry) > 0.1)) {
                console.log("🕹️ Rotation:", { rx: rx.toFixed(2), ry: ry.toFixed(2) });
                lastLogTime = now;
            }

            navPhysics.setRotationInput(new THREE.Vector3(rx, ry, rz));
        }

        if (data.isThrusting !== undefined) {
            navPhysics.setThrust(data.isThrusting);
        }

        if (data.isBoosting !== undefined) {
            navPhysics.setBoost(data.isBoosting);
        }
    };

    window.galaxyExplorer.getCameraPosition = function() {
        if (!rendererCore?.camera) return { x: 0, y: 0, z: 0 };
        const pos = rendererCore.camera.position;
        return { x: pos.x, y: pos.y, z: pos.z };
    };

    window.galaxyExplorer.getSpeed = function() {
        return navPhysics?.getSpeed() || 0;
    };

    window.galaxyExplorer.getPerformanceStats = function() {
        return loop?.getPerformanceStats() || {};
    };

    window.galaxyExplorer.setTimeScale = function(scale) {
        if (orbitalMechanics) {
            orbitalMechanics.setTimeScale(scale);
        }
    };

    window.galaxyExplorer.toggleTrails = function(show) {
        if (orbitalMechanics) {
            orbitalMechanics.setShowTrails(show);
        }
    };

    // EPIC EFFECTS CONTROLS
    window.galaxyExplorer.engageWarp = function(intensity = 1.0) {
        if (warpEffect) {
            // Use warpEffect's engage if present
            if (typeof warpEffect.engage === 'function') {
                warpEffect.engage(intensity);
            }
            // Send AUDIO play message for warp
            try {
                window.webkit?.messageHandlers?.iosHandler?.postMessage({
                    type: 'AUDIO',
                    action: 'play',
                    name: 'warp',
                    volume: 1.0
                });
            } catch (e) {}
            console.log("🚀 WARP ENGAGED!");
        }
    };

    window.galaxyExplorer.disengageWarp = function() {
        if (warpEffect) {
            // Use warpEffect's disengage if present
            if (typeof warpEffect.disengage === 'function') {
                warpEffect.disengage();
            }
            // Send AUDIO play message for arrival
            try {
                window.webkit?.messageHandlers?.iosHandler?.postMessage({
                    type: 'AUDIO',
                    action: 'play',
                    name: 'arrive',
                    volume: 1.0
                });
            } catch (e) {}
            console.log("🛑 Warp disengaged");
        }
    };

    window.galaxyExplorer.setWarpIntensity = function(intensity) {
        if (warpEffect) {
            warpEffect.setIntensity(intensity);
        }
    };

    // ULTRA WARP: hold to multiply thrust/top-speed ~100x and fire the warp visuals.
    // Forward thrust itself is driven by the normal thrust path (Swift calls
    // thrustForward); this just supercharges the multiplier + effect while held.
    window.galaxyExplorer.setWarpDrive = function(on) {
        if (!navPhysics) return;
        if (on) {
            if (navPhysics._preWarpMult == null) navPhysics._preWarpMult = navPhysics.boostMultiplier;
            navPhysics.boostMultiplier = 100;   // 100× ultra thrust
            navPhysics.isBoosting = true;
            window.galaxyExplorer.engageWarp(1.0);
            console.log("⚡ ULTRA WARP ×100 engaged");
        } else {
            navPhysics.isBoosting = false;
            if (navPhysics._preWarpMult != null) {
                navPhysics.boostMultiplier = navPhysics._preWarpMult;
                navPhysics._preWarpMult = null;
            }
            window.galaxyExplorer.disengageWarp();
        }
    };

    window.galaxyExplorer.getBlackHoleInfo = function() {
        return blackHoles.map(bh => ({
            name: bh.name,
            position: bh.mesh.position.toArray(),
            radius: bh.radius
        }));
    };

    window.galaxyExplorer.getNearestBlackHole = function() {
        if (!rendererCore?.camera || blackHoles.length === 0) return null;

        let nearest = null;
        let minDist = Infinity;

        blackHoles.forEach(bh => {
            const dist = rendererCore.camera.position.distanceTo(bh.mesh.position);
            if (dist < minDist) {
                minDist = dist;
                nearest = { name: bh.name, distance: dist };
            }
        });

        return nearest;
    };

    console.log("📱 iOS bridge initialized");

    // Apply any input that arrived before the engine was ready (belt-and-suspenders with
    // the READY handshake below).
    if (window.__pendingNav) {
        const pending = window.__pendingNav;
        window.__pendingNav = null;
        window.galaxyExplorer.receiveNavigationUpdate(pending);
    }

    // READY handshake: tell Swift the engine is live so it re-sends the CURRENT nav state.
    // Swift pushes thrust/rotation on-change only, so anything the user did during the
    // multi-second boot (e.g. holding the thruster) would be stuck until toggled again.
    // This makes the controls responsive from the very first frame.
    try {
        window.webkit?.messageHandlers?.iosHandler?.postMessage({ type: 'READY' });
        console.log("🤝 Sent READY handshake to native (requesting current nav state)");
    } catch (e) {}

    // Send initial ambient audio setup to iOS
    try {
        window.webkit?.messageHandlers?.iosHandler?.postMessage({
            type: 'AUDIO',
            action: 'setAmbient',
            name: 'space_ambience',
            volume: 0.35
        });
    } catch (e) {}

    // Send listener position regularly to iOS
    let lastListenerPost = 0;
    const listenerPostInterval = 100; // 100 ms

    function postListenerPosition() {
        if (!rendererCore?.camera) return;
        const now = performance.now();
        if (now - lastListenerPost < listenerPostInterval) return;
        lastListenerPost = now;

        const pos = rendererCore.camera.position;
        try {
            window.webkit?.messageHandlers?.iosHandler?.postMessage({
                type: 'AUDIO',
                action: 'listener',
                position: { x: pos.x, y: pos.y, z: pos.z }
            });
        } catch (e) {
            // Ignore errors
        }
    }

    // ---- Heading-up radar feed --------------------------------------------
    // Project nearby objects into the CAMERA'S local frame so the radar can show
    // "what's ahead vs behind/left/right" relative to where you're actually looking.
    // forward = -z, right = +x in camera space. We send plot-ready coords in [-1,1]
    // with a sqrt falloff so near objects spread out and far ones compress to the rim.
    let lastRadarPost = 0;
    const radarPostInterval = 150; // ms
    const RADAR_RANGE = 6000;      // world units shown edge-to-edge
    const _radarTmp = new THREE.Vector3();
    function postRadarState() {
        if (!rendererCore?.camera || !Array.isArray(objects)) return;
        const now = performance.now();
        if (now - lastRadarPost < radarPostInterval) return;
        lastRadarPost = now;

        const cam = rendererCore.camera;
        const camPos = cam.position;
        const blips = [];
        for (const obj of objects) {
            if (!obj || !obj.name) continue;
            let wx, wy, wz;
            if (obj.mesh && obj.mesh.getWorldPosition) {
                obj.mesh.getWorldPosition(_radarTmp);
                wx = _radarTmp.x; wy = _radarTmp.y; wz = _radarTmp.z;
            } else if (obj.position) {
                wx = obj.position.x; wy = obj.position.y; wz = obj.position.z;
            } else continue;

            const ddx = wx - camPos.x, ddy = wy - camPos.y, ddz = wz - camPos.z;
            const dist = Math.sqrt(ddx*ddx + ddy*ddy + ddz*ddz);
            if (dist > RADAR_RANGE) continue;

            // World point -> camera-local (forward = -z, right = +x).
            const local = cam.worldToLocal(_radarTmp.set(wx, wy, wz));
            const right = local.x;
            const fwd = -local.z;
            const mag = Math.hypot(right, fwd) || 0.0001;
            const ang = Math.atan2(right, fwd);          // 0 = straight ahead
            const r2 = Math.pow(Math.min(dist / RADAR_RANGE, 1), 0.6);
            blips.push({
                name: obj.name,
                type: obj.type || 'object',
                rx: Math.sin(ang) * r2,                  // +1 = right
                ry: Math.cos(ang) * r2,                  // +1 = ahead (top)
                dist: Math.round(dist)
            });
        }
        blips.sort((a, b) => a.dist - b.dist);
        try {
            window.webkit?.messageHandlers?.iosHandler?.postMessage({
                type: 'RADAR', blips: blips.slice(0, 12)
            });
        } catch (e) { /* ignore */ }
    }

    // Hook into animation frame loop to send listener position + radar feed
    function listenerPositionLoop() {
        postListenerPosition();
        postRadarState();
        requestAnimationFrame(listenerPositionLoop);
    }
    listenerPositionLoop();
}

// Helper to post positional audio to iOS bridge
function postAudioAt(name, position, gain = 1.0) {
    if (!Array.isArray(position) || position.length !== 3) return;
    try {
        window.webkit?.messageHandlers?.iosHandler?.postMessage({
            type: 'AUDIO',
            action: 'playAt',
            name: name,
            position: { x: position[0], y: position[1], z: position[2] },
            gain: gain
        });
    } catch(e) {
        // Ignore errors
    }
}

// New flyTo helper functions and API exposure

function flyToObject(obj, distanceMultiplier = 3) {
    if (!rendererCore || !rendererCore.camera || !obj) return;

    const camera = rendererCore.camera;
    const objPos = obj.mesh ? obj.mesh.getWorldPosition(new THREE.Vector3()) : (obj.position || new THREE.Vector3(0,0,0));
    const camPos = camera.position.clone();

    // Direction from camera to object
    const dir = new THREE.Vector3().subVectors(camPos, objPos).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);

    // Desired distance to stay from object
    const dist = (obj.radius || 10) * distanceMultiplier;

    // Target camera position offset back along direction
    const targetPos = objPos.clone().add(dir.multiplyScalar(dist));

    activeFly = {
        startTime: performance.now(),
        startPos: camPos.clone(),
        startQuat: camera.quaternion.clone(),
        endPos: targetPos,
        endLookAt: objPos
    };
}

function flyToByName(name, distanceMultiplier = 3) {
    if (!name) return;
    const nameLower = name.toLowerCase();
    // Search every flyable collection, not just planets/moons — comets, nebulae and the
    // black hole live in their own arrays. This powers the Destinations menu.
    const pools = [objects, comets, nebulae, blackHoles];
    for (const pool of pools) {
        if (!pool) continue;
        const found = pool.find(o => o && o.name && o.name.toLowerCase() === nameLower);
        if (found) { flyToObject(found, distanceMultiplier); return; }
    }
    if (asteroidBelt && /asteroid|belt/.test(nameLower)) {
        flyToObject({ mesh: asteroidBelt.mesh, radius: 50 }, distanceMultiplier);
        return;
    }
    // Interstellar / exoplanet / galaxy layer registers its objects here (kept out of the
    // catalog so it can't affect the Space Map, but still flyable).
    const uni = window.__universe || [];
    const star = uni.find(o => o && o.name && o.name.toLowerCase() === nameLower);
    if (star && star.mesh) { flyToObject({ mesh: star.mesh, radius: star.radius || 20 }, distanceMultiplier); return; }
    console.warn(`flyToByName: No object found with name "${name}"`);
}

function flyToNearestPlanet() {
    if (!rendererCore || !rendererCore.camera) return;

    const camPos = rendererCore.camera.position;
    let nearest = null;
    let minDist = Infinity;

    objects.forEach(obj => {
        if (obj.type === 'planet' || (obj.name && ["mercury","venus","earth","mars","jupiter","saturn","uranus","neptune"].includes(obj.name.toLowerCase()))) {
            const objPos = obj.mesh ? obj.mesh.getWorldPosition(new THREE.Vector3()) : (obj.position || new THREE.Vector3(0,0,0));
            const dist = camPos.distanceTo(objPos);
            if (dist < minDist) {
                minDist = dist;
                nearest = obj;
            }
        }
    });

    if (nearest) {
        flyToObject(nearest);
    }
}

function createPlanetRings(planet, planetRadius) {
    const innerRadius = planetRadius * 1.3;
    const outerRadius = planetRadius * 2.3;

    // Multiple ring layers for realistic look
    const ringColors = [0xc4a86a, 0xb8956a, 0xa88855, 0xc9b98a];
    const ringOpacities = [0.6, 0.4, 0.5, 0.3];

    ringColors.forEach((color, i) => {
        const inner = innerRadius + (outerRadius - innerRadius) * (i / ringColors.length);
        const outer = innerRadius + (outerRadius - innerRadius) * ((i + 1) / ringColors.length);

        const ringGeo = new THREE.RingGeometry(inner, outer, 64);
        const ringMat = new THREE.MeshBasicMaterial({
            color: color,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: ringOpacities[i],
            blending: THREE.AdditiveBlending
        });

        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.rotation.y = 0.4;  // Tilt
        planet.mesh.add(ring);
    });

    console.log("💫 Created multi-layer rings for", planet.name);
}

function createMoon(moonData, parentPlanet) {
    const moonGeo = new THREE.SphereGeometry(moonData.radius, 64, 32);
    const loader = new THREE.TextureLoader();
    const moonColor = loader.load('textures/moon/moon_color_1k.jpg',
        () => console.log('🌑 Moon texture loaded'),
        undefined,
        (err) => console.warn('Moon texture failed:', err));
    const moonBump = loader.load('textures/moon/moon_bump_1k.jpg');
    if (THREE.SRGBColorSpace !== undefined) moonColor.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) moonColor.encoding = THREE.sRGBEncoding;
    moonColor.anisotropy = 16;
    moonBump.anisotropy = 16;

    const moonMat = new THREE.MeshStandardMaterial({
        map: moonColor,
        bumpMap: moonBump,
        bumpScale: 0.04,
        roughness: 0.95,
        metalness: 0.0
    });

    const moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonMesh.position.set(moonData.distance, 0, 0);
    parentPlanet.mesh.add(moonMesh);

    const moon = {
        name: moonData.name,
        mesh: moonMesh,
        radius: moonData.radius,
        type: "moon",
        color: moonData.color,
        parentPlanet: parentPlanet,
        orbitDistance: moonData.distance,
        orbitPeriod: moonData.period,
        angle: Math.random() * Math.PI * 2,
        _shadowUniforms: {
            uSunPos: { value: new THREE.Vector3() },
            uSunRadius: { value: 15.0 },
            uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
            uOccluderCount: { value: 0 }
        },
        _occluders: [],
        setOccluders: function(list) { this._occluders = (list || []).slice(0, 4); },
        update: function(deltaTime) {
            this.angle += (deltaTime * 2 * Math.PI) / this.orbitPeriod;
            this.mesh.position.x = Math.cos(this.angle) * this.orbitDistance;
            this.mesh.position.z = Math.sin(this.angle) * this.orbitDistance;
            this.mesh.rotation.y += deltaTime * 0.5;

            const su = this._shadowUniforms;
            let n = 0;
            const tmp = new THREE.Vector3();
            for (let i = 0; i < this._occluders.length && n < 4; i++) {
                const occ = this._occluders[i];
                const m = occ.mesh || occ;
                if (!m || !m.getWorldPosition) continue;
                m.getWorldPosition(tmp);
                su.uOccluders.value[n].set(tmp.x, tmp.y, tmp.z, occ.radius || 1);
                n++;
            }
            su.uOccluderCount.value = n;
        }
    };

    // Earth's shadow falling on the Moon = lunar eclipses
    if (typeof Moons !== 'undefined') {
        Moons._injectEclipseShadow(moonMat, moon._shadowUniforms);
    }

    return moon;
}

// J2000 mean longitude (degrees) and daily motion (degrees/day) per planet.
// Lets each planet start at its real heliocentric direction for today's date —
// the actual arrangement of the solar system right now.
const PLANET_EPHEMERIS = {
    Mercury: [252.25084, 4.09233445],
    Venus:   [181.97973, 1.60213034],
    Earth:   [100.46435, 0.98560910],
    Mars:    [355.45332, 0.52402068],
    Jupiter: [ 34.40438, 0.08308529],
    Saturn:  [ 49.94432, 0.03344414],
    Uranus:  [313.23218, 0.01172834],
    Neptune: [304.88003, 0.00598103]
};

function currentMeanLongitude(name) {
    const e = PLANET_EPHEMERIS[name];
    if (!e) return Math.random() * Math.PI * 2;
    const daysSinceJ2000 = Date.now() / 86400000 - 10957.5;
    let deg = (e[0] + e[1] * daysSinceJ2000) % 360;
    if (deg < 0) deg += 360;
    return deg * Math.PI / 180;
}

// ========== SOLAR SYSTEM ==========
function createSolarSystem() {
    console.log("🌍 Creating solar system...");

    // Create the Sun
    const sun = new Star({
        name: "Sun",
        radius: 15,
        color: 0xfff4e6,
        luminosity: 10,
        temperature: 5778,
        texturePack: "sun"
    });
    sun.mesh.position.set(0, 0, 0);
    rendererCore.scene.add(sun.mesh);
    objects.push(sun);

    // THE missing piece: actually light the solar system from the sun.
    // (addStarLight existed but was never called — every PBR planet was
    // running on ambient fill only, with no day/night side at all.)
    if (lighting && typeof lighting.addStarLight === 'function') {
        lighting.addStarLight(sun);
    }

    // Planet data (semi-realistic orbital distances scaled down)
    const planetData = [
        { name: "Mercury", radius: 0.8, color: 0x9a8560, distance: 40, period: 88, planetType: "rocky", hasAtmosphere: false, texturePack: "mercury" },
        { name: "Venus", radius: 1.5, color: 0xf0d080, distance: 60, period: 225, planetType: "rocky", atmosphereColor: 0xffdd99, atmosphereDensity: 2.0, texturePack: "venus" },
        { name: "Earth", radius: 1.6, color: 0x3388ee, distance: 85, period: 365, planetType: "rocky", atmosphereColor: 0x66bbff, hasClouds: true, texturePack: "earth" },
        { name: "Mars", radius: 1.1, color: 0xd06040, distance: 115, period: 687, planetType: "rocky", atmosphereColor: 0xffbb99, atmosphereDensity: 0.3, texturePack: "mars" },
        { name: "Jupiter", radius: 8, color: 0xe0b080, distance: 200, period: 4333, planetType: "gas", hasAtmosphere: true, texturePack: "jupiter" },
        { name: "Saturn", radius: 7, color: 0xf8e0a0, distance: 320, period: 10759, planetType: "gas", hasRings: true, texturePack: "saturn" },
        { name: "Uranus", radius: 4, color: 0x70ccee, distance: 450, period: 30687, planetType: "ice", hasRings: true, texturePack: "uranus" },
        { name: "Neptune", radius: 3.8, color: 0x3355ee, distance: 550, period: 60190, planetType: "ice", texturePack: "neptune" }
    ];

    planetData.forEach(data => {
        const planet = new Planet({
            name: data.name,
            radius: data.radius,
            color: data.color,
            position: { x: data.distance, y: 0, z: 0 },
            planetType: data.planetType,
            hasAtmosphere: data.hasAtmosphere !== false,
            atmosphereColor: data.atmosphereColor || 0x88ccff,
            atmosphereDensity: data.atmosphereDensity || 1.0,
            hasRings: data.hasRings || false,
            hasClouds: data.hasClouds || false,
            texturePack: data.texturePack || null,
            orbitalData: {
                semiMajorAxis: data.distance,
                period: data.period,
                eccentricity: 0.02,
                // Real ephemeris: start where the planet actually is today
                meanAnomalyAtEpoch: currentMeanLongitude(data.name)
            }
        });

        rendererCore.scene.add(planet.mesh);
        objects.push(planet);

        // Create orbit line
        createOrbitLine(data.distance);
    });

    // Add Earth's moon — and wire eclipse shadows both ways
    const earth = objects.find(o => o.name === "Earth");
    if (earth) {
        const moon = createMoon({ name: "Moon", radius: 0.4, color: 0xaaaaaa, distance: 5, period: 27 }, earth);
        objects.push(moon);
        moon.setOccluders([{ mesh: earth.mesh, radius: earth.radius }]);   // lunar eclipses
        if (earth.setOccluders) {
            earth.setOccluders([{ mesh: moon.mesh, radius: moon.radius }]); // solar eclipse spot
        }
    }

    // Galilean moons of Jupiter: volcanic Io, ice-cracked Europa, Ganymede, Callisto.
    // Distances/periods compressed for the fidget scale but in real proportion.
    const jupiter = objects.find(o => o.name === "Jupiter");
    if (jupiter && typeof Moons !== 'undefined') {
        const galilean = [
            Moons.create({ name: "Io",       style: "io",       radius: 0.45, distance: 12.0, period: 18,  parent: jupiter, color: 0xd8c43a }),
            Moons.create({ name: "Europa",   style: "europa",   radius: 0.40, distance: 15.5, period: 36,  parent: jupiter, color: 0xcfc5b5 }),
            Moons.create({ name: "Ganymede", style: "ganymede", radius: 0.66, distance: 20.0, period: 72,  parent: jupiter, color: 0x968e80 }),
            Moons.create({ name: "Callisto", style: "callisto", radius: 0.60, distance: 26.0, period: 168, parent: jupiter, color: 0x60544a })
        ];
        galilean.forEach(m => {
            m.setOccluders([{ mesh: jupiter.mesh, radius: jupiter.radius }]); // moons darken in Jupiter's shadow
            objects.push(m);
        });
        if (jupiter.setOccluders) {
            // Galilean transit shadows — little black dots crossing Jupiter's clouds
            jupiter.setOccluders(galilean.map(m => ({ mesh: m.mesh, radius: m.radius })));
        }
    }

    // Saturn's headliners: hazy orange Titan + geysering Enceladus
    const saturn = objects.find(o => o.name === "Saturn");
    if (saturn && typeof Moons !== 'undefined') {
        const saturnMoons = [
            Moons.create({ name: "Titan",     style: "titan",     radius: 0.65, distance: 26.0, period: 110, parent: saturn, color: 0xe8a04a }),
            Moons.create({ name: "Enceladus", style: "enceladus", radius: 0.25, distance: 18.5, period: 24,  parent: saturn, color: 0xf0f4f8 })
        ];
        saturnMoons.forEach(m => {
            m.setOccluders([{ mesh: saturn.mesh, radius: saturn.radius }]);
            objects.push(m);
        });
    }

    console.log(`✅ Solar system created with ${objects.length} objects`);
}

let orbitLines = [];

function createOrbitLine(radius) {
    const segments = 128;
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: 0x334455,
        transparent: true,
        opacity: 0.3
    });
    const line = new THREE.Line(geometry, material);
    rendererCore.scene.add(line);
    orbitLines.push(line);
}

function setOrbitLinesVisible(visible) {
    orbitLines.forEach(line => {
        line.visible = visible;
    });
    try {
        localStorage.setItem('orbitLinesVisible', visible ? 'true' : 'false');
    } catch (e) {}
}

// ========== STARFIELD ==========
function createStarfield() {
    console.log("🌟 Creating starfield...");
    // Procedural field = faint deep-space "dust" for depth. Dimmed from brightness 2.0 so
    // it no longer drowns out the real named stars layered on top of it.
    // Procedural filler field REMOVED (was 22k random decorative dots — Matt: "what do
    // they even represent?"). The sky is now ONLY the ~8,900 real HYG stars below, each
    // at its true 3D position, so every visible star is a real object you can fly to.

    // Real sky: ~8,700 true-position HYG stars → actual constellations (Orion, the Big
    // Dipper, Cassiopeia) sit where they really are. Layered additively over the dust.
    if (typeof HYGStarfield !== 'undefined' && window.HYG_STARS) {
        hygStarfield = new HYGStarfield({ radius: 8500 });
        const mesh = hygStarfield.getMesh();
        if (mesh) {
            rendererCore.scene.add(mesh);
            console.log(`✨ Real HYG sky: ${hygStarfield.starCount} stars at true positions`);
        }
    } else {
        console.warn("HYG real sky unavailable (HYGStarfield class or window.HYG_STARS not loaded)");
    }
}

// ========== ASTEROID BELT ==========
function createAsteroidBelt() {
    console.log("🪨 Creating asteroid belt...");
    asteroidBelt = new AsteroidBelt({
        innerRadius: 140,
        outerRadius: 180,
        count: 600,
        height: 10
    });
    rendererCore.scene.add(asteroidBelt.mesh);
}

// ========== NEARBY DEBRIS ==========
function createNearbyDebris() {
    console.log("🗿 Creating nearby debris...");
    const debrisCount = 8;   // was 50 — fewer bits drifting past so it's not a swarm

    for (let i = 0; i < debrisCount; i++) {
        const size = 0.02 + Math.random() * 0.08;
        const geometry = new THREE.IcosahedronGeometry(size, 0);
        const material = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.9,
            metalness: 0.1
        });
        const mesh = new THREE.Mesh(geometry, material);

        // Position around starting camera position
        mesh.position.set(
            200 + (Math.random() - 0.5) * 100,
            (Math.random() - 0.5) * 50,
            280 + (Math.random() - 0.5) * 100
        );

        rendererCore.scene.add(mesh);

        floatingDebris.push({
            mesh: mesh,
            rotSpeed: new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            ),
            drift: new THREE.Vector3(
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1
            )
        });
    }
}

// ========== COMETS ==========
comets = [];

function createComets() {
    console.log("☄️ Creating comets...");
    const cometConfigs = [
        { name: "Halley", radius: 1.2, perihelion: 50, aphelion: 600, startAngle: 0.3 },
        { name: "Swift-Tuttle", radius: 0.9, perihelion: 80, aphelion: 800, startAngle: 1.5 },
        { name: "Hale-Bopp", radius: 1.5, perihelion: 60, aphelion: 700, startAngle: 2.8 }
    ];

    cometConfigs.forEach(config => {
        const comet = new Comet(config);
        // Position based on orbit
        const distance = (config.perihelion + config.aphelion) / 2;
        comet.mesh.position.set(
            Math.cos(config.startAngle) * distance,
            (Math.random() - 0.5) * 50,
            Math.sin(config.startAngle) * distance
        );
        rendererCore.scene.add(comet.mesh);
        comets.push(comet);
        objects.push(comet);
    });
}

// ========== NEBULAE ==========
nebulae = [];

function createNebulae() {
    console.log("☁️ Creating nebulae...");
    // Deep-sky distances: real nebulae span a degree or two of sky, not half the
    // viewport. 4x farther keeps them as faint background watercolors.
    const nebulaConfigs = [
        { name: "Orion Nebula", position: { x: 8000, y: 1200, z: -6000 }, radius: 400, nebulaType: "emission" },
        { name: "Carina Nebula", position: { x: -10000, y: -800, z: 7200 }, radius: 500, nebulaType: "emission" },
        { name: "Horsehead Nebula", position: { x: 6000, y: 2000, z: 8800 }, radius: 300, nebulaType: "dark" }
    ];

    nebulaConfigs.forEach(config => {
        const nebula = new Nebula(config);
        rendererCore.scene.add(nebula.mesh);
        nebulae.push(nebula);
    });
}

// ========== AMBIENT PARTICLES ==========
function createAmbientParticles() {
    console.log("✨ Creating ambient particles...");
    ambientParticles = new ParticleSystem({
        count: 1500,
        color: 0x8888aa,
        secondaryColor: 0xaaaacc,
        size: 0.5,
        area: 300,
        systemType: "ambient"
    });
    rendererCore.scene.add(ambientParticles.points);
}

// ========== BLACK HOLES ==========
function createBlackHoles() {
    console.log("🕳️ Creating black holes...");
    const bhConfig = {
        name: "Sagittarius A*",
        radius: 8,
        mass: 50,
        spinRate: 0.7
    };

    const blackHole = new BlackHole(bhConfig);
    blackHole.mesh.position.set(-800, 100, -1200);
    rendererCore.scene.add(blackHole.mesh);
    blackHoles.push(blackHole);
}

// ========== WARP EFFECT ==========
function createWarpEffect() {
    console.log("🚀 Creating warp effect...");
    warpEffect = new WarpEffect({
        streakCount: 2000,
        tunnel: true
    });
    rendererCore.scene.add(warpEffect.mesh);
}

// ========== VOLUMETRIC NEBULAE ==========
function createVolumetricNebulae() {
    console.log("🌌 Creating volumetric nebulae...");
    const volNebulaConfigs = [
        { name: "Eagle Nebula", position: new THREE.Vector3(9500, 2500, -7500), scale: 150, type: "emission", primaryColor: new THREE.Color(0.9, 0.3, 0.5) },
        { name: "Lagoon Nebula", position: new THREE.Vector3(-8400, -2000, 8200), scale: 200, type: "emission", primaryColor: new THREE.Color(0.8, 0.2, 0.4) }
    ];

    volNebulaConfigs.forEach(config => {
        const vn = new VolumetricNebula(config);
        rendererCore.scene.add(vn.mesh);
        volumetricNebulae.push(vn);
    });
}

// ========== PLANET HIGHLIGHTS / LABELS ==========
function createPlanetHighlights() {
    console.log("🏷️ Creating planet labels...");

    objects.forEach(obj => {
        if (obj.type !== "planet" && obj.type !== "star") return;

        // Create label sprite — 3x canvas so planet names render CRISP, not fuzzy
        const canvas = document.createElement('canvas');
        canvas.width = 768;
        canvas.height = 192;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 768, 192);

        ctx.font = 'bold 96px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(obj.name, 384, 96);

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = 4;
        const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.8,
            // Respect depth so a planet's label is HIDDEN behind a nearer planet. With
            // depthTest off, a far planet's label (e.g. Jupiter, behind Mars) drew right
            // over the nearer planet and read as if Mars were called "Jupiter".
            depthTest: true,
            depthWrite: false
        });

        const label = new THREE.Sprite(spriteMat);
        label.scale.set(obj.radius * 4, obj.radius, 1);
        label.position.set(0, obj.radius * 1.8, 0);
        obj.mesh.add(label);

        // Create glow ring — kept extremely faint so it reads as a UI hint,
        // not a video-game halo (realism goal: no glowing hoops in photos).
        // The Sun gets no ring: its corona already marks it, and a star-sized
        // ring is large enough to wash across the entire sky.
        let glow = null;
        if (obj.type !== "star") {
            const glowGeo = new THREE.RingGeometry(obj.radius * 1.2, obj.radius * 1.5, 32);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0x66ccff,
                transparent: true,
                opacity: 0.05,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
            glow = new THREE.Mesh(glowGeo, glowMat);
            glow.rotation.x = Math.PI / 2;
            obj.mesh.add(glow);
        }

        planetHighlights.push({
            planet: obj,
            label: label,
            glow: glow
        });
    });
}

function setPlanetLabelsVisible(visible) {
    showPlanetLabels = visible;
    planetHighlights.forEach(ph => {
        ph.label.visible = visible;
        if (ph.glow) ph.glow.visible = visible; // hide the hint rings too for clean photos
    });
    try {
        localStorage.setItem('planetLabelsVisible', visible ? 'true' : 'false');
    } catch (e) {}
}

// Capture high-res screenshot helper
async function captureHighResScreenshot(scale = 1.5) {
    if (!rendererCore || !rendererCore.renderer) return null;

    const renderer = rendererCore.renderer;
    const composer = rendererCore.composer;
    const useComposer = rendererCore.useComposer;

    // Safety check for scale, max ~3 to avoid huge renders
    const clampedScale = Math.min(Math.max(scale, 1), 3);

    // Store original pixel ratio or render target size
    const originalPixelRatio = renderer.getPixelRatio();
    const originalSize = new THREE.Vector2();
    renderer.getSize(originalSize);

    // Setup high-res rendering
    try {
        if (useComposer && composer) {
            // For composer, adjust renderer pixel ratio and composer size

            renderer.setPixelRatio(originalPixelRatio * clampedScale);
            composer.setSize(originalSize.x * clampedScale, originalSize.y * clampedScale);
            renderer.setSize(originalSize.x * clampedScale, originalSize.y * clampedScale);

            // Render a frame with composer
            composer.render();

            // Grab data URL from renderer canvas
            const dataURL = renderer.domElement.toDataURL('image/png');

            // Restore
            composer.setSize(originalSize.x, originalSize.y);
            renderer.setPixelRatio(originalPixelRatio);
            renderer.setSize(originalSize.x, originalSize.y);

            return dataURL;
        } else {
            // No composer, just renderer render

            renderer.setPixelRatio(originalPixelRatio * clampedScale);
            renderer.setSize(originalSize.x * clampedScale, originalSize.y * clampedScale);

            renderer.render(rendererCore.scene, rendererCore.camera);

            const dataURL = renderer.domElement.toDataURL('image/png');

            // Restore
            renderer.setPixelRatio(originalPixelRatio);
            renderer.setSize(originalSize.x, originalSize.y);

            return dataURL;
        }
    } catch (e) {
        console.error("Error capturing high-res screenshot:", e);
        // Restore on error
        renderer.setPixelRatio(originalPixelRatio);
        renderer.setSize(originalSize.x, originalSize.y);
        return null;
    }
}

// Expose flyTo API and convenience methods
function exposeFlyToAPI() {
    if (!window.galaxyExplorer) window.galaxyExplorer = {};

    window.galaxyExplorer.flyToByName = flyToByName;
    window.galaxyExplorer.flyToNearestPlanet = flyToNearestPlanet;

    // Live speed control from the SwiftUI SPEED slider.
    window.galaxyExplorer.setMaxSpeed = function(v) {
        if (!navPhysics) return;
        const speed = Math.max(5, Math.min(400, Number(v) || 0));
        navPhysics.maxSpeed = speed;
        navPhysics.thrustPower = speed * 2.4; // snappier acceleration (was 1.6) so a held thrust reaches speed fast
        console.log(`⚙️ Max speed set to ${speed}`);
    };

    window.galaxyExplorer.centerOnEarth = function() {
        flyToByName('Earth', 3.5);
    };

    window.galaxyExplorer.centerOnJupiter = function() {
        flyToByName('Jupiter', 4.5);
    };

    window.galaxyExplorer.centerOnSun = function() {
        flyToByName('Sun', 6);
    };

    window.galaxyExplorer.setOrbitLinesVisible = function(visible) {
        setOrbitLinesVisible(visible);
    };

    window.galaxyExplorer.setPlanetLabelsVisible = function(visible) {
        setPlanetLabelsVisible(visible);
    };

    window.galaxyExplorer.setCinematicMode = setCinematicMode;
    window.galaxyExplorer.getCinematicMode = getCinematicMode;

    // Time acceleration (also driveable from Swift)
    window.galaxyExplorer.cycleTimeScale = cycleTimeScale;

    // Procedural audio toggle
    window.galaxyExplorer.setAudioEnabled = function(on) {
        if (audioEngine) audioEngine.setEnabled(on);
    };

    // Mission progress for native UI
    window.galaxyExplorer.getMissions = function() {
        return missionSystem ? missionSystem.getMissions() : [];
    };

    // LUT control methods
    window.galaxyExplorer.setLUTEnabled = function(on) {
        lutEnabled = !!on;
        if (rendererCore?.lutPass) {
            rendererCore.lutPass.enabled = lutEnabled;
        }
        try {
            localStorage.setItem('lutEnabled', lutEnabled ? 'true' : 'false');
        } catch(e) {}
    };

    window.galaxyExplorer.setLUTIntensity = function(val) {
        const intensity = Math.min(Math.max(parseFloat(val), 0), 1);
        lutIntensity = intensity;
        if (rendererCore?.lutPass && rendererCore.lutPass.uniforms.intensity) {
            rendererCore.lutPass.uniforms.intensity.value = lutIntensity;
        }
        try {
            localStorage.setItem('lutIntensity', lutIntensity.toString());
        } catch(e) {}
    };

    // Capture photo and post to iOS via webkit message handler
    window.galaxyExplorer.capturePhoto = async function(scale = 1.5) {
        const dataURL = await captureHighResScreenshot(scale);
        if (dataURL && window.webkit?.messageHandlers?.iosHandler) {
            try {
                window.webkit.messageHandlers.iosHandler.postMessage({
                    type: 'PHOTO',
                    dataURL: dataURL
                });
            } catch (e) {
                // Ignore errors
            }
        }
        return dataURL;
    };
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        try {
            initGalaxy();
            // Create RendererExposure instance after initGalaxy sets rendererCore and lighting
            if (rendererCore && lighting && rendererCore.renderer && rendererCore.camera) {
                rendererExposure = new RendererExposure(rendererCore.renderer, lighting, rendererCore.camera);
            }
        } catch (e) {
            console.error("❌ Post-init error:", e);
        }
    });
} else {
    try {
        initGalaxy();
        if (rendererCore && lighting && rendererCore.renderer && rendererCore.camera) {
            rendererExposure = new RendererExposure(rendererCore.renderer, lighting, rendererCore.camera);
        }
    } catch (e) {
        console.error("❌ Post-init error:", e);
    }
}


