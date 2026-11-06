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
let cameraOptics = null;   // CameraOptics.js: auto-exposure, JWST spikes, sun flare, CA, grain
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
// After a Fly To lands on a planet or moon the camera rides along with it (planets orbit the Sun
// in a few minutes at 1x, so a fixed camera lost Earth within seconds). Cleared by thrust, warp,
// a tour, or the next Fly To. { mesh, last: Vector3 }
let followTarget = null;
let scenicTour = null;

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

    // Adjust bloom pass - cinematic mode gets extra bloom punch.
    // Desktop browser runs HDR half-float bloom, which reads slightly flatter at the
    // same strength — give it a small lift so both platforms match visually.
    if (rendererCore?.composer && rendererCore.bloomPass) {
        const deskBoost = rendererCore.isNativeApp === false ? 0.1 : 0;
        if (on) {
            rendererCore.bloomPass.strength = 0.5 + deskBoost;    // Cinematic glow (still tamer than old default)
            rendererCore.bloomPass.threshold = 0.8;
        } else {
            rendererCore.bloomPass.strength = 0.32 + deskBoost;
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
                        // LUT is DATA, not an image: no mipmaps (they smear the 32-row
                        // table into black), no sRGB decode (raw lookup values), plain
                        // linear filtering for smooth interpolation between entries.
                        texture.generateMipmaps = false;
                        texture.minFilter = THREE.LinearFilter;
                        texture.magFilter = THREE.LinearFilter;
                        if (THREE.NoColorSpace !== undefined) texture.colorSpace = THREE.NoColorSpace;
                        texture.needsUpdate = true;
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
                // Desktop browsers get true half-float HDR targets — smoother bloom
                // falloff, no gradient banding. The black-frame guard still covers both.
                //
                // 2026-09-12: I briefly switched iOS to half-float here, reading the soft
                // patches around the Sun in Matt's screenshots as an 8-bit banding artifact.
                // They are not — he confirmed the phone looks right. The phone keeps 8-bit.
                // The wedge Matt is chasing is on the DESKTOP build, not here.
                //
                // 2026-11-06: the 8-bit phone target clipped the scene at 1.0 BEFORE the
                // auto-exposure pass, so the Sun's photosphere (radiance well above 1) reached
                // the exposure gain as a flat clipped yellow disk: no limb darkening, no
                // texture, nothing for the meter to tame. The phone now gets the same
                // half-float HDR targets as desktop whenever the context can actually render
                // to RGBA16F (WebGL2 + EXT_color_buffer_float/half_float, framebuffer
                // complete). Contexts that can't keep 8-bit, and the black-frame guard drops
                // an HDR composer back to 8-bit before it would give up on post entirely.
                const _hdrOK = THREE.HalfFloatType !== undefined &&
                    (!rendererCore.isNativeApp || halfFloatRenderable(rendererCore.renderer));
                window.__rtHDR = _hdrOK;
                const _isDesktop = !rendererCore.isNativeApp;
                const _dbs = rendererCore.renderer.getDrawingBufferSize(new THREE.Vector2());
                const _iosRT = new THREE.WebGLRenderTarget(_dbs.x, _dbs.y, {
                    type: _hdrOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
                    format: THREE.RGBAFormat,
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter
                });
                const composer = new EffectComposer(rendererCore.renderer, _iosRT);
                const renderPass = new RenderPass(rendererCore.scene, rendererCore.camera);
                composer.addPass(renderPass);

                // POST CHAIN ORDER (light path from the scene to the screen):
                //  1. scene render (linear HDR radiance)
                //  2. auto-exposure: a scalar gain on radiance, metered on the unbent frame. It
                //     commutes with lensing (a pure remap), so putting it first only changes what
                //     the meter sees, and it lets bloom see the stopped-down signal like a sensor.
                //  3. black hole lensing: bends the light BEFORE it reaches any optics, so bloom,
                //     shafts and flare are built from the lensed image (the photon ring blooms).
                //  4. bloom: scatter inside the optics of the (exposed, lensed) image.
                //  5. god rays: screen-space shafts toward the Sun (NaN guard kept).
                //  6. visor glass (Visor.js self-inserts here): the helmet/canopy sits in front of
                //     the lens, so it filters the light before the camera's own lens artefacts.
                //  7. camera lens: diffraction spikes, flare ghosts, chromatic aberration, sensor
                //     grain (CameraOptics); grain is sensor noise, so it goes last before grading.
                //  8. LUT / film grade, 9. linear -> sRGB gamma (display encoding is always last).

                // Spacecraft camera optics (CameraOptics.js). The exposure pass sits right
                // after the scene render, before bloom, so a stopped-down camera also
                // blooms less, exactly like a real sensor.
                if (typeof CameraOptics !== 'undefined' && ShaderPass) {
                    try {
                        cameraOptics = new CameraOptics(rendererCore);
                        composer.addPass(cameraOptics.createExposurePass());
                        window.cameraFX = cameraOptics;
                    } catch (e) {
                        console.warn("CameraOptics exposure pass skipped:", e);
                        cameraOptics = null;
                    }
                }

                // Black hole gravitational lensing: bends the rendered scene (before bloom)
                // around Sagittarius A*. Idle (disabled) unless the hole is on screen.
                if (typeof BlackHole !== 'undefined' && BlackHole.createLensPass) {
                    const lensPass = BlackHole.createLensPass();
                    if (lensPass) composer.addPass(lensPass);
                }

                // Add bloom pass if available - subtle, realistic bloom for stars
                if (typeof UnrealBloomPass !== 'undefined') {
                    const bloomPass = new UnrealBloomPass(
                        new THREE.Vector2(window.innerWidth, window.innerHeight),
                        _isDesktop ? 0.42 : 0.32,  // Strength — cut from 0.55: bloom was white-washing
                               // the sun disk and planet highlights into glare.
                               // Desktop HDR pipeline reads flatter → slight lift.
                        _isDesktop ? 0.6 : 0.5,   // Radius — wider soft halo on desktop
                        0.9    // Threshold — only truly blown pixels bloom now
                    );
                    composer.addPass(bloomPass);
                    rendererCore.bloomPass = bloomPass;

                    // UnrealBloomPass allocates its OWN half-float targets internally, which
                    // are the most likely thing to render black on iOS. Force them to 8-bit
                    // and re-allocate at the current size. Wrapped defensively — if the
                    // internals differ across THREE versions, the black-frame guard still
                    // catches any failure. Desktop keeps the half-float targets (HDR bloom).
                    // r150's UnrealBloomPass actually allocates 8-bit targets by default. With an HDR
                    // composer that quantises the dim outer halo of a large bright source (black
                    // hole disk, Sun) into 1/255 plateaus that the blur mips turn into blocky
                    // octagonal steps. On HDR-capable devices give the blur chain half-float
                    // targets; elsewhere keep 8-bit (iOS black-frame guard).
                    if (_hdrOK) try {
                        const half = THREE.HalfFloatType;
                        [].concat(bloomPass.renderTargetsHorizontal || [], bloomPass.renderTargetsVertical || [],
                                  bloomPass.renderTargetBright ? [bloomPass.renderTargetBright] : [])
                          .forEach(rt => { if (rt && rt.texture && rt.texture.type !== half) { rt.texture.type = half; rt.dispose(); } });
                    } catch (e) { console.warn("bloom half-float targets skipped:", e); }
                    // Bright-pass cap: with 8-bit targets the bloom input was clipped at 1.0, which is
                    // the look the strength/radius were tuned to. Half-float keeps the halo smooth
                    // but would let a single huge texel (a galaxy core where thousands of additive
                    // stars stack, a NaN/Inf from a degenerate shader) bloom into a big square
                    // plateau. Cap the bloom source at white and drop NaN/Inf texels (a 2x cap let
                    // the truncated tails of the widest blur mip show as grey squares around
                    // bright galaxy cores).
                    try {
                        const m = bloomPass.materialHighPassFilter;
                        const src = 'gl_FragColor = mix( outputColor, texel, alpha );';
                        if (m && m.fragmentShader.indexOf(src) >= 0) {
                            m.fragmentShader = m.fragmentShader.replace(src,
                                'vec4 bp = mix( outputColor, texel, alpha );' +
                                ' float bl = bp.r + bp.g + bp.b;' +
                                ' if (!(bl == bl) || bl > 1.0e4) bp = vec4(0.0);' +
                                ' gl_FragColor = vec4(min(bp.rgb, vec3(1.0)), bp.a);');
                            m.needsUpdate = true;
                        }
                    } catch (e) { console.warn("bloom bright-pass cap skipped:", e); }
                    try {
                        if (_hdrOK) throw 'hdr-targets'; // half-float set above
                        const byte = THREE.UnsignedByteType;
                        const rts = [].concat(
                            bloomPass.renderTargetsHorizontal || [],
                            bloomPass.renderTargetsVertical || [],
                            bloomPass.renderTargetBright ? [bloomPass.renderTargetBright] : []
                        );
                        rts.forEach(rt => { if (rt && rt.texture) rt.texture.type = byte; });
                        bloomPass.setSize(window.innerWidth, window.innerHeight);
                    } catch (e) { if (e !== 'hdr-targets') console.warn("bloom target coercion skipped:", e); }
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
                            uWeight: { value: 0.065 },
                            uSrcR: { value: 0.05 },     // Sun's apparent radius (UV of height)
                            uAspect: { value: 1.0 }
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
                            uniform float uSrcR;
                            uniform float uAspect;
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
                                        if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) break;
                                        vec3 s = texture2D(tDiffuse, coord).rgb;
                                        float lum = dot(s, vec3(0.299, 0.587, 0.114));
                                        // Half-float scene targets can hold NaN/Inf texels (sun core, far
                                        // geometry). One bad texel smeared along 32 ray steps became the
                                        // black vertical bars ("black wedge", Sept 2026). NaN fails every
                                        // comparison, so this skips NaN and Inf alike.
                                        if (!(lum >= 0.0 && lum < 64.0)) { illum *= uDecay; continue; }
                                        s *= smoothstep(0.8, 1.25, lum); // only near-blown pixels (the sun core) shaft — star sprites/labels no longer smear into white rays
                                        // Shafts are sunlight: only texels on/around the Sun's disk feed them.
                                        // Blown galaxy cores and stars elsewhere used to smear into dotted
                                        // radial streaks aimed at an off-screen Sun.
                                        vec2 dq = (coord - uLightPos) * vec2(uAspect, 1.0);
                                        s *= 1.0 - smoothstep(uSrcR * 1.15, uSrcR * 1.6 + 0.01, length(dq));
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

                // Sun spikes + lens-flare ghosts (occlusion-tested), edge chromatic
                // aberration and sensor grain: one pass, after the light shafts and before
                // the film grade.
                if (cameraOptics) {
                    try { composer.addPass(cameraOptics.createLensPass()); }
                    catch (e) { console.warn("CameraOptics lens pass skipped:", e); }
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
                            
                            vec3 filmGrade(vec3 c) {
                                // Procedural film look — replaces the 3D-LUT texture
                                // lookup, whose strip sampling proved unreliable across
                                // GPUs. Same recipe: gentle saturation, soft S-curve,
                                // warm highlights / teal shadows. All terms clamped.
                                c = clamp(c, 0.0, 1.0);
                                float lum = dot(c, vec3(0.299, 0.587, 0.114));
                                c = lum + (c - lum) * 1.12;                  // saturation
                                c = clamp(c, 0.0, 1.0);
                                vec3 sc = c * c * (3.0 - 2.0 * c);           // S-curve
                                c = mix(c, sc, 0.55);
                                float w = smoothstep(0.5, 1.0, lum);         // highlights
                                float d = 1.0 - smoothstep(0.0, 0.5, lum);   // shadows
                                c.r *= (1.0 + 0.06 * w) * (1.0 - 0.03 * d);
                                c.b *= (1.0 - 0.05 * w) * (1.0 + 0.06 * d);
                                c.g *= 1.0 + 0.01 * w;
                                return clamp(c, 0.0, 1.0);
                            }

                            void main() {
                                vec4 original = texture2D(tDiffuse, vUv);
                                
                                vec3 lutColor = filmGrade(original.rgb);

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
                try { if (window.Visor) window.Visor.attach(composer, rendererCore); } catch (e) { console.warn('Visor attach failed:', e); } // [unreal/visor] canopy glass pass, self-inserts before gamma
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

// ---- Planet name labels: screen-space layout ------------------------------------------
// The name labels are world-space sprites (a planet-radius tall, 1.8 R above the centre),
// so near a planet the name grew to fill the top of the screen: on the folded iPhone Duo
// "Earth" ran under the radar and the menu buttons, and from the helm "Sun" was cut off by
// the top edge. Each frame the label is now laid out in screen space: its height is capped,
// it sits just above the planet's limb, inside the safe area, and it is moved (then shrunk,
// then hidden) until it clears every HUD control. The native SwiftUI controls (radar,
// menu / view / TOUR column, bottom console) are not in the DOM, so their frames are
// mirrored from ContentView.swift; the web controls are measured.
const _lbl = { v: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Vector3(), s: new THREE.Vector3(),
               rects: [], safe: { t: 0, r: 0, b: 0, l: 0 }, at: -1e9, w: 0, h: 0 };

function _labelSafeInsets() {
    let el = document.getElementById('rt-safe-probe');
    if (!el) {
        el = document.createElement('div');
        el.id = 'rt-safe-probe';
        el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
            'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
        document.body.appendChild(el);
    }
    const cs = getComputedStyle(el);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
             b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

// HUD rectangles (CSS px, {x0,y0,x1,y1}) the labels must stay clear of; refreshed twice a second.
function _labelExclusions() {
    const now = performance.now(), W = window.innerWidth, H = window.innerHeight;
    if (now - _lbl.at < 500 && _lbl.w === W && _lbl.h === H) return _lbl.rects;
    _lbl.at = now; _lbl.w = W; _lbl.h = H;
    const S = _lbl.safe = _labelSafeInsets();
    const rects = [];
    const add = (x, y, w, h, pad) => { pad = pad == null ? 6 : pad; rects.push({ x0: x - pad, y0: y - pad, x1: x + w + pad, y1: y + h + pad }); };
    const native = !!(rendererCore && rendererCore.isNativeApp);
    if (native) {
        // Mirrors ContentView.swift's top bar and bottom console (points == CSS px here).
        const land = W > H, roomy = Math.min(W, H) >= 600;
        const right = W - S.r - 16;
        if (land) {
            const rw = roomy ? 120 : 80;
            add(right - 50, S.t + 6, 50, 40 * 3 + 8 * 2);                       // ⋯ / view / TOUR
            add(right - 50 - 44 - rw, S.t + 6 + (roomy ? 12 : 24), rw, rw);     // radar
            add(0, H - S.b - 6 - 112, W, 112 + S.b + 6, 0);                     // joystick / speed / thrust row
        } else {
            add(right - 120, S.t + 8, 120, 120 + 8 + 40 * 3 + 8 * 2);           // radar + button column
            add(0, H - S.b - 8 - 150, W, 150 + S.b + 8, 0);                     // speed pill, joystick, thrust
        }
    }
    // Web HUD controls, measured.
    const sel = '#time-pill, #cxScan, .cx-controls, #compass, #exploration-toggle-btn, #exploration-sidebar, #target-info, #boost-status';
    document.querySelectorAll(sel).forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        add(r.left, r.top, r.width, r.height);
    });
    // Landscape helm: the cockpit art (codex/Cockpit.js, drawn 106% at -3%) is opaque outside
    // its windshield, so a label must stay inside the main windshield opening, measured from
    // the PNG's alpha: x 0.254-0.739, y 0.249-0.700 of the art, centre console from y 0.62.
    _lbl.win = null;
    const art = document.getElementById('cockpit-art');
    if (art && art.style.display !== 'none') {
        const ax = f => -0.03 * W + f * 1.06 * W, ay = f => -0.03 * H + f * 1.06 * H;
        _lbl.win = { l: ax(0.254), r: ax(0.739), t: ay(0.249), b: ay(0.700) };
        add(ax(0.455), ay(0.615), ax(0.545) - ax(0.455), ay(0.700) - ay(0.615), 4);
    }
    _lbl.rects = rects;
    return rects;
}

function _hitsAny(b, rects) {
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0) return true;
    }
    return false;
}

function layoutPlanetLabel(ph, camera, opacity) {
    const label = ph.label, planet = ph.planet;
    if (!label.visible || opacity <= 0.001 || !planet.mesh) return;
    const W = window.innerWidth, H = window.innerHeight;
    const C = planet.mesh.getWorldPosition(_lbl.c);
    const toC = _lbl.v.copy(C).sub(camera.position);
    const d = toC.length();
    const R = planet.radius || 1;
    const fwd = _lbl.q.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const depth = toC.dot(fwd);
    if (depth <= R * 0.2 || d <= R * 1.01) { label.material.opacity = 0; return; }

    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    const pxPerWorld = H / (2 * depth * tanH);              // CSS px per world unit at the planet
    const ndc = _lbl.s.copy(C).project(camera);
    const cx = (ndc.x * 0.5 + 0.5) * W, cy = (1 - (ndc.y * 0.5 + 0.5)) * H;
    const rs = Math.tan(Math.asin(Math.min(1, R / d))) / tanH * 0.5 * H;   // limb radius, px
    // planet entirely off screen (or behind the cockpit frame): its name must not be
    // dragged in to the edge
    const rects = _labelExclusions(), win = _lbl.win;
    const vl = win ? win.l : 0, vr = win ? win.r : W, vt = win ? win.t : 0, vb = win ? win.b : H;
    if (cx + rs < vl || cx - rs > vr || cy + rs < vt || cy - rs > vb) { label.material.opacity = 0; ph._box = null; return; }

    // Natural size = the old world-space size; capped so a near planet's name stays a title,
    // not a wall of text (the canvas text is half the sprite's height).
    const S = _lbl.safe;
    const natural = R * pxPerWorld;                          // sprite height in px (scale.y = R)
    const cap = Math.max(26, Math.min(72, Math.min(W, H) * 0.14));
    let h = Math.min(natural, cap);
    const minH = Math.min(natural, 22);

    let top = S.t + 4, bottom = H - S.b - 4, left = S.l + 4, right = W - S.r - 4;
    if (win) { top = Math.max(top, win.t + 4); bottom = Math.min(bottom, win.b - 4); left = Math.max(left, win.l + 4); right = Math.min(right, win.r - 4); }
    const textBox = (x, y, hh) => {                         // the glyphs' box, not the sprite's
        const tw = 4 * hh * ph.textFrac, th = hh * 0.62;
        return { x0: x - tw / 2, y0: y - th / 2, x1: x + tw / 2, y1: y + th / 2, tw: tw, th: th };
    };
    const fits = (x, y, hh) => {
        const b = textBox(x, y, hh);
        return b.x0 >= left && b.x1 <= right && b.y0 >= top && b.y1 <= bottom && !_hitsAny(b, rects);
    };
    const clampX = (x, hh) => { const tw = 4 * hh * ph.textFrac; return Math.min(Math.max(x, left + tw / 2), right - tw / 2); };
    const clampY = (y, hh) => { const th = hh * 0.62; return Math.min(Math.max(y, top + th / 2), bottom - th / 2); };

    let px = null, py = null;
    for (let tries = 0; tries < 4 && px === null; tries++) {
        const gap = h * 0.2;
        const x = clampX(cx, h);
        // candidates: above the limb (the old spot), slid down toward the centre, below the limb
        const above = cy - rs - gap - h * 0.31;
        const cands = [above];
        for (let k = 1; k <= 6; k++) cands.push(above + k * (rs + gap) / 3);
        cands.push(cy + rs + gap + h * 0.31);
        for (let i = 0; i < cands.length; i++) {
            const y = clampY(cands[i], h);
            if (fits(x, y, h)) { px = x; py = y; break; }
            // sideways nudge: away from whatever HUD column is on that side
            const tw = 4 * h * ph.textFrac;
            for (const dx of [-tw * 0.5, tw * 0.5, -tw, tw]) {
                const x2 = clampX(x + dx, h);
                if (fits(x2, y, h)) { px = x2; py = y; break; }
            }
            if (px !== null) break;
        }
        if (px === null) { if (h <= minH) break; h = Math.max(minH, h * 0.75); }
    }
    if (px === null) { label.material.opacity = 0; ph._box = null; return; }   // nowhere clear: no label
    ph._box = textBox(px, py, h);

    // Back to the world: a point on the ray through (px, py), just in front of the planet so
    // the planet's own surface never hides the label it carries.
    const dist = Math.max(depth - R * 1.05, depth * 0.5);
    const ndcX = px / W * 2 - 1, ndcY = 1 - py / H * 2;
    const p = _lbl.v.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const along = dist / Math.max(1e-6, p.dot(fwd));
    const world = p.multiplyScalar(along).add(camera.position);
    const k = h * 2 * dist * tanH / H;                       // sprite height in world units
    const ws = planet.mesh.getWorldScale(_lbl.s);
    planet.mesh.worldToLocal(world);
    label.position.copy(world);
    label.scale.set(4 * k / (ws.x || 1), k / (ws.y || 1), 1);
}

// True when this WebGL context can render into RGBA16F targets (what THREE.HalfFloatType
// render targets become on WebGL2). Tested with a real framebuffer, not just the extension
// list, because a context can expose the extension and still refuse the attachment.
function halfFloatRenderable(renderer) {
    try {
        const gl = renderer.getContext();
        if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return false;
        if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return false;
        const tex = gl.createTexture(), fb = gl.createFramebuffer();
        const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
        return ok;
    } catch (e) { return false; }
}

// Drop an HDR composer to 8-bit targets (the black-frame guard's first fallback). The Sun
// reads window.__rtHDR and switches to its no-headroom output.
function composerToLDR(rc) {
    const byte = THREE.UnsignedByteType, c = rc.composer, bp = rc.bloomPass;
    [].concat(c ? [c.renderTarget1, c.renderTarget2] : [],
              bp ? [].concat(bp.renderTargetsHorizontal || [], bp.renderTargetsVertical || [],
                             bp.renderTargetBright ? [bp.renderTargetBright] : []) : [])
      .forEach(rt => { if (rt && rt.texture && rt.texture.type !== byte) { rt.texture.type = byte; rt.dispose(); } });
    window.__rtHDR = false;
}

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
            update: (dt, rc) => nebulae?.forEach(n => n.update(dt, rc?.camera))
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
        // Clean frame (?clean=1): re-sweep about once a second for labels created later
        {
            name: "CleanFrame",
            update: (dt) => {
                if (!cleanFrame) return;
                cleanSweepT += dt;
                if (cleanSweepT > 1) { cleanSweepT = 0; applyCleanFrame(); }
            }
        },
        // Auto-exposure system update
        {
            name: "AutoExposure",
            update: (dt, rc) => {
                // With post-processing live the camera meters the real frame
                // (CameraOptics); the old distance heuristic only runs on the
                // direct-render fallback, where there is no frame to meter.
                if (cameraOptics && rendererCore?.useComposer) {
                    cameraOptics.update(dt, rc?.camera || rendererCore.camera);
                } else if (rendererExposure) {
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
                // apparent solar radius in UV-of-height units, for the source mask
                const sd = Math.max(rc.camera.position.length(), 1e-3);
                const sunR = (objects.find(o => o.type === 'star') || {}).radius || 15;
                const halfFov = THREE.MathUtils.degToRad(rc.camera.fov || 60) * 0.5;
                pass.uniforms.uSrcR.value = Math.tan(Math.asin(Math.min(1, sunR / sd))) / Math.tan(halfFov) * 0.5;
                pass.uniforms.uAspect.value = rc.camera.aspect || 1;
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
        // far. Earth → 8K day+night; Jupiter/Saturn → real 4K photo; Mars/Moon → real 8K on
        // HIGH tier only. Hysteresis avoids thrash.
        {
            name: "PlanetLOD",
            update: (() => {
                let frame = 0;
                const wp = new THREE.Vector3();
                const apply = (body, setter) => {
                    if (!body || !body[setter]) return;
                    // world position: the Moon is parented to Earth, so .position is local
                    const d = rendererCore.camera.position.distanceTo(body.mesh.getWorldPosition(wp));
                    const r = body.radius || 1;
                    if (d < r * 7) body[setter](true);
                    else if (d > r * 11) body[setter](false);
                };
                // A drop out of HIGH frees the 8K Mars/Moon at once, whatever the camera
                // distance (the 7r..11r hysteresis band would otherwise keep them resident).
                window.addEventListener('rtquality', (e) => {
                    if (!e.detail || e.detail.prev !== 'high' || e.detail.tier === 'high') return;
                    const mars = objects.find(o => o.name === 'Mars');
                    const moon = objects.find(o => o.name === 'Moon');
                    if (mars && mars.setTexturedDetail) mars.setTexturedDetail(false);
                    if (moon && moon.setDetail) moon.setDetail(false);
                });
                return (dt, rc) => {
                    if (++frame % 20 !== 0 || !rc?.camera) return;
                    apply(objects.find(o => o.name === 'Earth'), 'setEarthDetail');
                    apply(objects.find(o => o.name === 'Jupiter'), 'setTexturedDetail');
                    apply(objects.find(o => o.name === 'Saturn'), 'setTexturedDetail');
                    // 8K Mars / Moon: setters themselves refuse unless RTQuality.tier is HIGH, and
                    // free a resident 8K when the tier drops (this tick re-reads it every 20 frames)
                    apply(objects.find(o => o.name === 'Mars'), 'setTexturedDetail');
                    apply(objects.find(o => o.name === 'Moon'), 'setDetail');
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
                blackHoles?.forEach(bh => bh.update(dt, rendererCore?.camera, rendererCore));
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
                    layoutPlanetLabel(ph, rc.camera, opacity);

                    if (!ph.glow) return;
                    // Gentle pulse. The ring geometry is already sized to the planet's
                    // radius — scaling by radius again blew the Sun's ring up to ~900
                    // units and draped giant teal sheets across the whole sky.
                    const time = performance.now() * 0.001;
                    const s = 1.0 + 0.06 * Math.sin(time * 3);
                    ph.glow.scale.set(s, s, 1);

                    // The ring is a FINDER — it earns its keep at a distance and gets
                    // out of the photo up close. Fade fully out inside 12 planet radii
                    // (you can obviously see the planet), full hint strength beyond 40.
                    const r = ph.planet.radius || 2;
                    const near = 12 * r, far = 40 * r;
                    let ringFade = (dist - near) / (far - near);
                    ringFade = Math.min(Math.max(ringFade, 0), 1);
                    ph.glow.material.opacity = 0.05 * ringFade;
                });
            }
        },
        {
            name: "FlyTo",
            update: (dt) => {
                // Ride along with the planet/moon we arrived at: move the camera by the target's
                // own motion this frame, so it stays where it was framed (looking around still works).
                if (!activeFly && followTarget) {
                    const np = navPhysics;
                    if (np && (np.isThrusting || np.isBoosting || (np.velocity && np.velocity.length() > 0.5))) {
                        followTarget = null;
                    } else if (followTarget.mesh) {
                        const cur = followTarget.mesh.getWorldPosition(new THREE.Vector3());
                        rendererCore.camera.position.add(cur.clone().sub(followTarget.last));
                        followTarget.last.copy(cur);
                    }
                }
                if (!activeFly) return;

                const now = performance.now();
                const elapsed = (now - activeFly.startTime) / 1200;
                // Moving target: aim at where it is NOW, not where it was when the flight began.
                if (activeFly.target && activeFly.target.mesh) {
                    const tp = activeFly.target.mesh.getWorldPosition(new THREE.Vector3());
                    activeFly.endLookAt = tp;
                    activeFly.endPos = tp.clone().add(activeFly.offset);
                }
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
                    const arrived = activeFly;
                    activeFly = null;
                    if (arrived.target && arrived.target.mesh) {
                        followTarget = { mesh: arrived.target.mesh,
                                         last: arrived.target.mesh.getWorldPosition(new THREE.Vector3()) };
                    }
                    // A flight that ends at a planet or moon is the app's success moment:
                    // native counts these for the occasional store rating request.
                    if (arrived && (arrived.kind === 'planet' || arrived.kind === 'moon')) {
                        try {
                            window.webkit?.messageHandlers?.iosHandler?.postMessage({
                                type: 'ARRIVED', kind: arrived.kind, name: arrived.name || ''
                            });
                        } catch (e) {}
                    }
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
        // Grand Tour autopilot — cinematic multi-stop scenic route
        {
            name: "ScenicTour",
            update: (dt) => {
                if (scenicTour) scenicTour.update(dt);
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
                            if (window.__rtHDR && rendererCore.isNativeApp && composerFrameIsBlack(rendererCore.renderer)) {
                                // HDR targets came out black on this phone: retry the same
                                // post chain on 8-bit targets before giving up on post.
                                composerToLDR(rendererCore);
                                rendererCore._bloomChecked = false; rendererCore._bloomWarm = 0;
                                console.warn("⚠️ Half-float post produced a BLACK frame — retrying on 8-bit targets.");
                            } else if (composerFrameIsBlack(rendererCore.renderer)) {
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
// The planets, Moon and spacecraft run on a real-date clock (Ephemeris.clock):
// 1 = LIVE (real time, tonight's real sky), then whole days per simulated second.
// `scale` still drives planet spin (capped in OrbitalMechanics) and Ephemeris.rateFor.
const TIME_SCALES = [
    { scale: 1,    label: 'LIVE',        speech: 'live, real time' },
    { scale: 10,   label: '1 DAY/S',     speech: '1 day per second' },
    { scale: 100,  label: '10 DAYS/S',   speech: '10 days per second' },
    { scale: 1000, label: '100 DAYS/S',  speech: '100 days per second' },
    { scale: 0,    label: 'TIME ⏸',      speech: 'paused' }
];

// Pill text = speed + the simulated date whenever it isn't live, so nobody mistakes a
// fast-forwarded sky for tonight's.
function timePillText(entry) {
    if (typeof Ephemeris === 'undefined' || entry.scale === 1) return entry.label;
    const d = Ephemeris.clock.date();
    const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
    return entry.label + ' · ' + M + ' ' + d.getDate() + ' ' + d.getFullYear();
}
let timeScaleIndex = 0;
let timePillEl = null;

// The pill entry for any clock scale: the table row when it is one, otherwise a label made
// from the real rate (scale 10 = 1 day per second, below 1 = slower than real time).
function timeEntryForScale(scale) {
    const hit = TIME_SCALES.find(e => e.scale === scale);
    if (hit) return hit;
    let label;
    if (!(scale > 0)) label = 'TIME ⏸';
    else if (scale < 1) label = scale.toFixed(2).replace(/0+$/, '') + 'X REAL';
    else if (scale < 10) label = (+scale.toFixed(1)) + 'X REAL';
    else { const days = scale / 10; label = (+days.toFixed(days < 10 ? 1 : 0)) + (days === 1 ? ' DAY/S' : ' DAYS/S'); }
    return { scale, label, speech: label.toLowerCase() };
}

function createTimeControl() {
    timePillEl = document.createElement('div');
    timePillEl.id = 'time-pill';
    timePillEl.textContent = TIME_SCALES[0].label;
    // A div, so VoiceOver/TalkBack read it as text; say what it is and that it can be tapped.
    timePillEl.setAttribute('role', 'button');
    timePillEl.setAttribute('aria-label', 'Time: live, real time. Tap to speed up time');
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
    // keep the pill on the REAL clock scale (set by the pill, the JS API, a tour...) and the
    // simulated date current while time runs fast
    setInterval(() => {
        if (!timePillEl) return;
        const entry = timeEntryForScale(orbitalMechanics ? orbitalMechanics.timeScale : TIME_SCALES[timeScaleIndex].scale);
        const text = timePillText(entry);
        if (timePillEl.textContent !== text) timePillEl.textContent = text;
    }, 250);
}

function cycleTimeScale() {
    timeScaleIndex = (timeScaleIndex + 1) % TIME_SCALES.length;
    const entry = TIME_SCALES[timeScaleIndex];
    if (orbitalMechanics) orbitalMechanics.setTimeScale(entry.scale);
    if (timePillEl) {
        timePillEl.textContent = timePillText(entry);
        timePillEl.setAttribute('aria-label', 'Time: ' + entry.speech + '. Tap to change it');
    }
    if (hud && typeof hud.showInfo === 'function') {
        hud.showInfo(entry.scale === 0 ? 'ORBITS PAUSED' : entry.scale === 1 ? 'LIVE: TONIGHT\'S REAL SKY' : `ORBITAL TIME ${entry.label}`, 1200);
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
        // keep the pill honest when time is set from outside (it shows LIVE vs a sim date)
        const i = TIME_SCALES.findIndex(t => t.scale === scale);
        if (i >= 0) timeScaleIndex = i;
        if (timePillEl) timePillEl.textContent = i >= 0 ? timePillText(TIME_SCALES[i]) : 'TIME ' + scale + '×';
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
    // Black holes carry their own arrival distance (radius is rs; 3 rs would park inside the disk).
    const dist = obj.flyDistance || (obj.radius || 10) * distanceMultiplier;

    // Target camera position offset back along direction
    const targetPos = objPos.clone().add(dir.multiplyScalar(dist));

    activeFly = {
        startTime: performance.now(),
        startPos: camPos.clone(),
        startQuat: camera.quaternion.clone(),
        endPos: targetPos,
        endLookAt: objPos,
        // Remembered so arrival at a planet or moon can count as a completed flight.
        kind: obj.type || null,
        name: obj.name || null,
        target: obj.mesh ? obj : null,                      // tracked while flying, followed after
        offset: targetPos.clone().sub(objPos)
    };
    followTarget = null;
    // Leftover drift from before the jump would carry the camera off the target on arrival.
    if (navPhysics?.velocity?.set) navPhysics.velocity.set(0, 0, 0);
    if (navPhysics?.angularVelocity?.set) navPhysics.angularVelocity.set(0, 0, 0);
}

// The belt's own mesh is centred on the Sun, so flying "to the belt" used to fly to the Sun
// and show no rocks (Matt, 2026-09-28). Aim at a spot inside the ring instead (radius 140-180),
// parented to the belt so it moves with it; radius 8 keeps the camera in among the rocks.
function beltSpot() {
    if (!asteroidBelt.__spot) {
        const spot = new THREE.Object3D();
        spot.position.set(160, 1.5, 0);
        asteroidBelt.mesh.add(spot);
        asteroidBelt.__spot = spot;
    }
    return { name: "Main Asteroid Belt", mesh: asteroidBelt.__spot, radius: 8 };
}

// Resolve any flyable object by name — same search order as flyToByName, but
// returns the live object (mesh + radius) so the Grand Tour can track it.
function findFlyableByName(name) {
    if (!name) return null;
    const nameLower = name.toLowerCase();
    const pools = [objects, comets, nebulae, blackHoles];
    for (const pool of pools) {
        if (!pool) continue;
        const found = pool.find(o => o && o.name && o.name.toLowerCase() === nameLower);
        if (found && found.mesh) return found;
    }
    if (asteroidBelt && /asteroid|belt/.test(nameLower)) return beltSpot();
    const uni = window.__universe || [];
    const star = uni.find(o => o && o.name && o.name.toLowerCase() === nameLower);
    if (star && star.mesh) return { name: star.name, mesh: star.mesh, radius: star.radius || 20 };
    return null;
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
        // Arrive just outside and above the ring, looking along it, so the band of rocks
        // curves away across the screen (same view as the tour's belt stop).
        const spot = beltSpot().mesh.getWorldPosition(new THREE.Vector3());
        const out = spot.clone().setY(0).normalize();
        const tangent = new THREE.Vector3(-out.z, 0, out.x);
        const endPos = spot.clone().add(out.multiplyScalar(48)).add(new THREE.Vector3(0, 20, 0)).add(tangent.multiplyScalar(-38));
        const cam = rendererCore.camera;
        activeFly = { startTime: performance.now(), startPos: cam.position.clone(), startQuat: cam.quaternion.clone(),
                      endPos, endLookAt: spot };
        followTarget = null;
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
                depthWrite: false, // transparent overlay must not stamp the depth buffer
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

// Render-quality tier: always the global RTQuality tier (single source of truth).
function rtTier() {
    return (window.RTQuality && window.RTQuality.tier) || 'medium';
}

function createMoon(moonData, parentPlanet) {
    const moonGeo = new THREE.SphereGeometry(moonData.radius, 64, 32);
    const loader = new THREE.TextureLoader();
    // Low tier keeps the 1K map resident; medium/high the 4K. The real 8K (Solar System
    // Scope, CC BY 4.0) only streams in on HIGH tier when the camera is close (setDetail).
    const moonBase = rtTier() === 'low' ? 'textures/moon/moon_color_1k.jpg' : 'textures/moon/moon_4k.jpg';
    const moonColor = loader.load(moonBase,
        () => console.log('🌑 Moon texture loaded'),
        undefined,
        (err) => console.warn('Moon texture failed:', err));
    const moonBump = loader.load('textures/moon/moon_bump_1k.jpg');
    markSRGB(moonColor);
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
        _tmpA: new THREE.Vector3(), _tmpB: new THREE.Vector3(), _tmpC: new THREE.Vector3(),
        _ax: new THREE.Vector3(), _ay: new THREE.Vector3(), _az: new THREE.Vector3(),
        _basis: new THREE.Matrix4(), _q: new THREE.Quaternion(), _pq: new THREE.Quaternion(),
        _hiTex: null, _loTex: moonColor, _wantHi: false, _hiLoading: false,
        _shadowUniforms: {
            uSunPos: { value: new THREE.Vector3() },
            uSunRadius: { value: 15.0 },
            uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
            uOccluderCount: { value: 0 }
        },
        _occluders: [],
        setOccluders: function(list) { this._occluders = (list || []).slice(0, 4); this._allOccluders = this._occluders; },
        // 8K Moon only on HIGH tier and only while close; freed again on the way out.
        setDetail: function(high) {
            high = high && rtTier() === 'high';
            this._wantHi = high;
            if (high) {
                if (this._hiTex || this._hiLoading) return;
                this._hiLoading = true;
                new THREE.TextureLoader().load('textures/moon/moon_8k.jpg', (tex) => {
                    this._hiLoading = false;
                    if (!this._wantHi) { tex.dispose(); return; }
                    markSRGB(tex);
                    tex.anisotropy = 16;
                    this._hiTex = tex; moonMat.map = tex; moonMat.needsUpdate = true;
                    console.log('🌑 Moon → 8K (up close)');
                }, undefined, () => { this._hiLoading = false; });
            } else if (this._hiTex) {
                moonMat.map = this._loTex; moonMat.needsUpdate = true;
                this._hiTex.dispose(); this._hiTex = null;
                console.log('🌑 Moon → base texture (far away, 8K freed)');
            }
        },
        _eclipseLink: null,   // { earth, moonAsOccluder, on } set by createSolarSystem
        // In the compressed scene the Moon sits only ~3 Earth radii out and is ~10x too big
        // for its distance, so the scene geometry alone would eclipse it at almost every full
        // and new moon. Real eclipses need the Moon within ~1.5 degrees of the anti-sun point
        // (lunar) or of the Sun (solar) as seen from Earth, so the shadows are switched on
        // only then; when on, the existing shadow shaders draw them.
        _gateEclipses: function(moonGeoAU, earthHelioAU) {
            const m = moonGeoAU, e = earthHelioAU;
            const cosA = (m[0] * e[0] + m[1] * e[1] + m[2] * e[2]) / (Math.hypot(m[0], m[1], m[2]) * Math.hypot(e[0], e[1], e[2]));
            const fromAntiSun = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
            // Earth's penumbra radius at the Moon (~1.28 deg) + the Moon's own radius (0.26)
            this.lunarEclipse = fromAntiSun < 1.54;
            // Moon + Sun radii (0.26 + 0.27) + Earth's radius as seen from the Moon (0.95)
            this.solarEclipse = (180 - fromAntiSun) < 1.48;
            this._occluders = this.lunarEclipse ? (this._allOccluders || []) : [];
            const link = this._eclipseLink;
            if (link && link.earth.setOccluders && link.on !== this.solarEclipse) {
                link.earth.setOccluders(this.solarEclipse ? [link.moonAsOccluder] : []);
                link.on = this.solarEclipse;
            }
        },
        update: function(deltaTime) {
            // Real Moon: geocentric position for the sim date (Astronomical Almanac / Meeus
            // low-precision series, Ephemeris.moonGeo), so the phase lit by the Sun at the
            // origin is tonight's real phase. Distance on the linear Earth-neighbourhood scale.
            const parent = this.parentPlanet.mesh;
            parent.updateWorldMatrix(true, false);
            const earthW = this._tmpA.setFromMatrixPosition(parent.matrixWorld);
            let off;
            if (typeof Ephemeris !== 'undefined') {
                const jd = Ephemeris.clock.jd();
                const mg = Ephemeris.moonGeo(jd);
                off = Ephemeris.geoToScene(mg);
                this._gateEclipses(mg, Ephemeris.planetHelio('Earth', jd));
            } else {
                off = [this.orbitDistance, 0, 0];
            }
            const moonW = this._tmpB.set(earthW.x + off[0], earthW.y + off[1], earthW.z + off[2]);
            // Parent spins and is tilted: convert the world position into its local frame.
            this.mesh.position.copy(parent.worldToLocal(this._tmpC.copy(moonW)));

            // Tidally locked: the near side (texture longitude 0 = local +X) faces Earth,
            // lunar north roughly along ecliptic north.
            const xAxis = this._ax.subVectors(earthW, moonW).normalize();
            const zAxis = this._az.crossVectors(xAxis, THREE.Object3D.DEFAULT_UP).normalize();
            const yAxis = this._ay.crossVectors(zAxis, xAxis);
            this._basis.makeBasis(xAxis, yAxis, zAxis);
            this._q.setFromRotationMatrix(this._basis);
            parent.getWorldQuaternion(this._pq);
            this.mesh.quaternion.copy(this._pq.invert().multiply(this._q));

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
    if (cameraOptics) cameraOptics.setSun(sun);

    // THE missing piece: actually light the solar system from the sun.
    // (addStarLight existed but was never called — every PBR planet was
    // running on ambient fill only, with no day/night side at all.)
    if (lighting && typeof lighting.addStarLight === 'function') {
        lighting.addStarLight(sun);
    }

    // Planet data. `distance` = the scene radius of the planet's MEAN distance (the anchors of
    // Ephemeris.mapRadius); the actual position each frame is the real one for the sim date.
    const planetData = [
        // axialTilt = real values in radians (Earth 23.4°, Saturn 26.7°, Uranus
        // famously sideways at ~98°). Without these, every planet rolled a RANDOM
        // tilt each launch — Saturn's rings sat at a different angle every time.
        { name: "Mercury", radius: 0.8, color: 0x9a8560, distance: 40, period: 88, planetType: "rocky", hasAtmosphere: false, axialTilt: 0.001, texturePack: "mercury" },
        { name: "Venus", radius: 1.5, color: 0xf0d080, distance: 60, period: 225, planetType: "rocky", atmosphereColor: 0xffdd99, atmosphereDensity: 2.0, axialTilt: 0.05, texturePack: "venus" },
        { name: "Earth", radius: 1.6, color: 0x3388ee, distance: 85, period: 365, planetType: "rocky", atmosphereColor: 0x66bbff, hasClouds: true, axialTilt: 0.409, poleTowardEclipticLon90: true, texturePack: "earth" },
        { name: "Mars", radius: 1.1, color: 0xd06040, distance: 115, period: 687, planetType: "rocky", atmosphereColor: 0xffbb99, atmosphereDensity: 0.3, axialTilt: 0.439, texturePack: "mars" },
        { name: "Jupiter", radius: 8, color: 0xe0b080, distance: 200, period: 4333, planetType: "gas", hasAtmosphere: true, atmosphereColor: 0xe8d0a8, axialTilt: 0.055, texturePack: "jupiter" },
        { name: "Saturn", radius: 7, color: 0xf8e0a0, distance: 320, period: 10759, planetType: "gas", hasRings: true, atmosphereColor: 0xf0e0b8, axialTilt: 0.466, texturePack: "saturn" },
        { name: "Uranus", radius: 4, color: 0x70ccee, distance: 450, period: 30687, planetType: "ice", hasRings: true, axialTilt: 1.706, texturePack: "uranus" },
        { name: "Neptune", radius: 3.8, color: 0x3355ee, distance: 550, period: 60190, planetType: "ice", axialTilt: 0.494, texturePack: "neptune" },
        // Pluto — demoted on paper, not in here. Real eccentric, tilted orbit
        // (e=0.25, i=17°) from the JPL elements: it swings inside Neptune's distance
        // and rides above the ecliptic, and its drawn orbit path shows that.
        { name: "Pluto", radius: 0.45, color: 0xc9b29b, distance: 650, period: 90560, planetType: "rocky", hasAtmosphere: false, axialTilt: 2.14, texturePack: "pluto", eccentricity: 0.25, inclination: 0.30, noOrbitLine: true }
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
            axialTilt: data.axialTilt,
            poleTowardEclipticLon90: !!data.poleTowardEclipticLon90,
            orbitalData: {
                semiMajorAxis: data.distance,
                period: data.period,
                eccentricity: data.eccentricity ?? 0.02,
                inclination: data.inclination || 0,
                // Real ephemeris (Ephemeris.js, JPL Keplerian elements): OrbitalMechanics
                // places the planet at its true heliocentric position for the sim date.
                ephemeris: data.name
            }
        });

        rendererCore.scene.add(planet.mesh);
        objects.push(planet);

        // True orbit path (real eccentricity, tilt and orientation, same radius mapping
        // as the planet itself). Falls back to the old circle if Ephemeris is missing.
        if (typeof Ephemeris !== 'undefined') createEphemerisOrbitLine(data.name);
        else if (!data.noOrbitLine) createOrbitLine(data.distance);
    });

    // Add Earth's moon — and wire eclipse shadows both ways
    const earth = objects.find(o => o.name === "Earth");
    // Camera spike reach is scaled by the Sun's apparent brightness relative to Earth's distance.
    if (earth && cameraOptics) cameraOptics.setReferenceDistance(earth.mesh.position.length());
    if (earth) {
        const moon = createMoon({ name: "Moon", radius: 0.4, color: 0xaaaaaa, distance: 5, period: 27 }, earth);
        objects.push(moon);
        moon.setOccluders([{ mesh: earth.mesh, radius: earth.radius }]);   // lunar eclipses
        if (earth.setOccluders) {
            earth.setOccluders([{ mesh: moon.mesh, radius: moon.radius }]); // solar eclipse spot
            // both get gated every frame to real eclipse dates (moon._gateEclipses)
            moon._eclipseLink = { earth, moonAsOccluder: { mesh: moon.mesh, radius: moon.radius }, on: true };
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
                depthWrite: false, // transparent overlay must not stamp the depth buffer
        color: 0x334455,
        transparent: true,
        opacity: 0.3
    });
    const line = new THREE.Line(geometry, material);
    line.userData.annotation = true;   // overlay, hidden by the clean frame
    rendererCore.scene.add(line);
    orbitLines.push(line);
}

function createEphemerisOrbitLine(name) {
    const pts = Ephemeris.orbitPath(name, Ephemeris.clock.jd(), 256);
    if (!pts.length) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const material = new THREE.LineBasicMaterial({
        depthWrite: false, // transparent overlay must not stamp the depth buffer
        color: 0x334455,
        transparent: true,
        opacity: 0.3
    });
    const line = new THREE.Line(geometry, material);
    line.userData.annotation = true;   // overlay, hidden by the clean frame
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
            if (cameraOptics) cameraOptics.setStarfield(hygStarfield);
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

// Position + radius for a deep-sky object: RA (h) / Dec (deg) direction in the same frame
// as codex/Deepsky.js, distance sqrt(ly) * 150, radius = half its true apparent diameter.
function deepSkyPlacement(cfg, raH, decDeg, ly, arcmin) {
    const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
    const r = Math.sqrt(ly) * 150;
    const d = new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra));
    const radius = r * Math.tan((arcmin / 60) * Math.PI / 360);
    return Object.assign(cfg, { position: d.multiplyScalar(r), radius, scale: radius });
}

function createNebulae() {
    console.log("☁️ Creating nebulae...");
    // Real sky directions, distances on the same sqrt(ly) * 150 scale as the stars and the
    // codex deep-sky layer, and a radius that spans each nebula's true angle from home
    // (Orion ~65', Carina ~120', the Horsehead's dark cloud with its glowing IC 434 edge ~20').
    const nebulaConfigs = [
        deepSkyPlacement({ name: "Orion Nebula", nebulaType: "emission" }, 5.588, -5.39, 1344, 65),
        deepSkyPlacement({ name: "Carina Nebula", nebulaType: "emission" }, 10.75, -59.87, 8500, 120),
        deepSkyPlacement({ name: "Horsehead Nebula", nebulaType: "dark" }, 5.683, -2.46, 1375, 20)
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
    // Where the real one is (Matt, 2026-09-27: "accurate, but more accessible"): toward
    // Sagittarius (RA 17h45m40s, Dec -29.0 deg), 26,670 light-years out, on the same
    // compressed sqrt scale the nearby stars use (codex/Interstellar.js gameRadius), so it
    // sits beyond every star instead of beside the Sun. Still one tap away in the fly-to list.
    // It used to be parked at (-800, 100, -1200), roughly Neptune's distance from the Sun.
    {
        const raH = 17 + 45 / 60 + 40 / 3600, decDeg = -29.0078, ly = 26670;
        const ra = raH * 15 * Math.PI / 180, dec = decDeg * Math.PI / 180;
        const r = Math.sqrt(ly) * 150;
        blackHole.mesh.position.set(Math.cos(dec) * Math.cos(ra) * r, Math.sin(dec) * r, -Math.cos(dec) * Math.sin(ra) * r);
    }
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
        // same real places and true sizes as the codex deep-sky entries (Eagle ~70', Lagoon ~90')
        deepSkyPlacement({ name: "Eagle Nebula", type: "emission", primaryColor: new THREE.Color(0.9, 0.3, 0.5) }, 18.313, -13.79, 7000, 70),
        deepSkyPlacement({ name: "Lagoon Nebula", type: "emission", primaryColor: new THREE.Color(0.8, 0.2, 0.4) }, 18.061, -24.38, 4100, 90)
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
        const textFrac = Math.min(1, ctx.measureText(obj.name).width / 768);

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
                blending: THREE.AdditiveBlending,
                depthWrite: false   // MUST be off: the ring is nearly invisible, but with
                                    // depthWrite on it stamped the depth buffer and erased
                                    // every star behind it — the "black donut around Earth"
            });
            glow = new THREE.Mesh(glowGeo, glowMat);
            glow.rotation.x = Math.PI / 2;
            obj.mesh.add(glow);
        }

        planetHighlights.push({
            planet: obj,
            label: label,
            glow: glow,
            textFrac: textFrac,
            baseScale: label.scale.clone(),
            basePos: label.position.clone()
        });
    });
}

// Clean frame: hides every annotation drawn into the 3D scene (name labels, orbit /
// constellation / trail lines, the faint label hint rings) so a capture shows only the sky.
// Lines are opt-in (userData.annotation), so visual line effects such as the warp streaks stay.
// Debug and trailer use only: URL ?clean=1 or galaxyExplorer.setCleanFrame(true); nothing in
// the app UI reaches it. Annotations move to layer 31, which the camera never renders, so
// modules that toggle .visible on their labels every frame can't bring them back.
let cleanFrame = (() => { try { return new URLSearchParams(location.search).get('clean') === '1'; } catch (e) { return false; } })();
let cleanSweepT = 1;   // first sweep on the first frame
const CLEAN_LAYER = 31;
function _isAnnotation(o) {
    if (o.isLine) return !!o.userData.annotation;   // only lines tagged as overlays
    const m = o.material;
    if (o.isSprite && m && m.map && m.map.isCanvasTexture && m.blending === THREE.NormalBlending) return true;
    return false;
}
function applyCleanFrame() {
    if (!rendererCore || !rendererCore.scene) return;
    const hide = new Set(planetHighlights.map(ph => ph.glow).filter(Boolean));
    rendererCore.scene.traverse(o => {
        if (!(hide.has(o) || _isAnnotation(o))) return;
        if (cleanFrame) { o.layers.set(CLEAN_LAYER); o.userData.__clean = true; }
        else if (o.userData.__clean) { o.layers.set(0); delete o.userData.__clean; }
    });
}
function setCleanFrame(on) {
    cleanFrame = !!on;
    applyCleanFrame();
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

    // Camera optics toggles: name = autoExposure | spikes | flare | ca | grain
    window.galaxyExplorer.setCameraEffect = function(name, on) {
        return cameraOptics ? cameraOptics.set(name, on) : false;
    };
    window.galaxyExplorer.setCameraQuality = function(tier) {   // 'high' | 'medium' | 'low' | 'auto'
        if (cameraOptics) cameraOptics.setTier(tier);
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

    window.galaxyExplorer.setCleanFrame = setCleanFrame;

    window.galaxyExplorer.setCinematicMode = setCinematicMode;
    window.galaxyExplorer.getCinematicMode = getCinematicMode;

    // Grand Tour autopilot — scenic multi-stop cinematic route
    const ensureScenicTour = function() {
        if (typeof ScenicTour === 'undefined' || !rendererCore?.camera) return null;
        if (!scenicTour) {
            scenicTour = new ScenicTour({
                camera: rendererCore.camera,
                findByName: findFlyableByName,
                onStart: () => {
                    activeFly = null;                       // a queued fly-to would fight the tour
                    followTarget = null;
                    if (navPhysics?.velocity?.set) navPhysics.velocity.set(0, 0, 0);
                },
                onStop: () => {
                    if (navPhysics?.velocity?.set) navPhysics.velocity.set(0, 0, 0);
                }
            });
        }
        return scenicTour;
    };
    window.galaxyExplorer.startScenicTour = function() {
        if (ensureScenicTour()) scenicTour.start();
    };
    window.galaxyExplorer.stopScenicTour = function() {
        if (scenicTour) scenicTour.stop('user');
    };
    window.galaxyExplorer.skipScenicTour = function() {
        if (scenicTour) scenicTour.skip();
    };
    window.galaxyExplorer.isScenicTourActive = function() {
        return !!(scenicTour && scenicTour.active);
    };
    // A tour the kid built in TourBuilder.js: same autopilot, their stops.
    window.galaxyExplorer.startCustomTour = function(custom) {
        if (ensureScenicTour()) scenicTour.start(custom);
    };
    window.galaxyExplorer.findFlyableByName = findFlyableByName;
    window.galaxyExplorer.getCamera = function() { return rendererCore?.camera || null; };
    // Native TOUR button: opens "Make your tour" (the Grand Tour is one tap inside it).
    // Tapping it during any tour ends that tour. State lives here in JS, so a tour that
    // ends on its own can't leave the button stale.
    window.galaxyExplorer.toggleScenicTour = function() {
        if (scenicTour && scenicTour.active) { scenicTour.stop('user'); return; }
        if (window.tourBuilder) { window.tourBuilder.open(); return; }
        window.galaxyExplorer.startScenicTour();
    };

    // Time acceleration (also driveable from Swift)
    window.galaxyExplorer.cycleTimeScale = cycleTimeScale;

    // Procedural audio toggle
    window.galaxyExplorer.setAudioEnabled = function(on) {
        if (audioEngine) audioEngine.setEnabled(on);
    };
    // "Ambient hum" toggle (off by default; native settings call this)
    window.galaxyExplorer.setAmbientHum = function(on) {
        if (audioEngine) audioEngine.setAmbientHum(on);
        else { try { localStorage.setItem('rts_ambient_hum', on ? '1' : '0'); } catch (e) {} }
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


