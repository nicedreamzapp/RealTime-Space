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

let rendererCore, lighting, navPhysics, orbitalMechanics, loop, starfield;
let hud, radar;
let asteroidBelt, comets, nebulae, ambientParticles;
let objects = [];
let floatingDebris = [];

// Exploration system
let celestialCatalog, explorationTracker, navigationArrows;

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
            rendererCore.bloomPass.strength = 0.7;    // Rich cinematic glow
            rendererCore.bloomPass.threshold = 0.65;   // More objects bloom in cinematic
        } else {
            rendererCore.bloomPass.strength = 0.55;
            rendererCore.bloomPass.threshold = 0.72;
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
            rendererCore.renderer.toneMappingExposure = 1.3; // Brighter, punchier exposure
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

                const composer = new EffectComposer(rendererCore.renderer);
                const renderPass = new RenderPass(rendererCore.scene, rendererCore.camera);
                composer.addPass(renderPass);

                // Add bloom pass if available - subtle, realistic bloom for stars
                if (typeof UnrealBloomPass !== 'undefined') {
                    const bloomPass = new UnrealBloomPass(
                        new THREE.Vector2(window.innerWidth, window.innerHeight),
                        0.55,  // Strength - visible glow on stars and bright objects
                        0.6,   // Radius - soft, wide glow
                        0.72   // Threshold - bloom on stars, nebulae, and bright surfaces
                    );
                    composer.addPass(bloomPass);
                    rendererCore.bloomPass = bloomPass;
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

                rendererCore.composer = composer;
                rendererCore.useComposer = true;

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
        lighting.setOverallIntensity(3.5);  // Brighter lighting for vibrant, lifelike visuals
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

        // Ambient space dust particles
        createAmbientParticles();

        // EPIC EFFECTS - Black holes, warp, volumetric nebulae
        createBlackHoles();
        createWarpEffect();
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
                    // Warp intensity based on speed - kicks in at higher speeds
                    const speed = navPhysics.getSpeed();
                    const warpThreshold = 30; // Start showing warp lines at 30 u/s
                    const maxWarpSpeed = 150; // Full warp effect at 150 u/s

                    // Enable warp when moving fast
                    if (navPhysics.isBoosting && speed > 20) {
                        // Full warp during boost
                        warpEffect.setIntensity(1.0);
                    } else if (speed > warpThreshold) {
                        // Gradual warp based on speed
                        const warpIntensity = Math.min(1.0, (speed - warpThreshold) / (maxWarpSpeed - warpThreshold));
                        warpEffect.setIntensity(warpIntensity * 0.7);
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

                    // Glow scaling based on planet size and scale by 1.0 to 1.2 oscillation
                    const time = performance.now() * 0.001;
                    const scaleFactor = ph.planet.radius * (1.0 + 0.2 * Math.sin(time * 3));
                    ph.glow.scale.set(scaleFactor * 3, scaleFactor * 3, 1);
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
        if (!data || !navPhysics) return;

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

    // Hook into animation frame loop to send listener position
    function listenerPositionLoop() {
        postListenerPosition();
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
    const found = objects.find(obj => obj.name && obj.name.toLowerCase() === nameLower);
    if (found) {
        flyToObject(found, distanceMultiplier);
    } else {
        console.warn(`flyToByName: No object found with name "${name}"`);
    }
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

    return {
        name: moonData.name,
        mesh: moonMesh,
        radius: moonData.radius,
        type: "moon",
        color: moonData.color,
        parentPlanet: parentPlanet,
        orbitDistance: moonData.distance,
        orbitPeriod: moonData.period,
        angle: Math.random() * Math.PI * 2,
        update: function(deltaTime) {
            this.angle += (deltaTime * 2 * Math.PI) / this.orbitPeriod;
            this.mesh.position.x = Math.cos(this.angle) * this.orbitDistance;
            this.mesh.position.z = Math.sin(this.angle) * this.orbitDistance;
            this.mesh.rotation.y += deltaTime * 0.5;
        }
    };
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
                eccentricity: 0.02
            }
        });

        rendererCore.scene.add(planet.mesh);
        objects.push(planet);

        // Create orbit line
        createOrbitLine(data.distance);
    });

    // Add Earth's moon
    const earth = objects.find(o => o.name === "Earth");
    if (earth) {
        const moon = createMoon({ name: "Moon", radius: 0.4, color: 0xaaaaaa, distance: 5, period: 27 }, earth);
        objects.push(moon);
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
    starfield = new Starfield({
        count: 150000,
        radius: 9000,
        brightness: 2.0,
        sizeBase: 0.8,
        twinkleAmplitude: 0.15
    });
    rendererCore.scene.add(starfield.getMesh());
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
    const debrisCount = 50;

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
    const nebulaConfigs = [
        { name: "Orion Nebula", position: { x: 2000, y: 300, z: -1500 }, radius: 400, nebulaType: "emission" },
        { name: "Carina Nebula", position: { x: -2500, y: -200, z: 1800 }, radius: 500, nebulaType: "emission" },
        { name: "Horsehead Nebula", position: { x: 1500, y: 500, z: 2200 }, radius: 300, nebulaType: "dark" }
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
        { name: "Eagle Nebula", position: new THREE.Vector3(3000, 400, -2000), scale: 150, type: "emission", primaryColor: new THREE.Color(0.9, 0.3, 0.5) },
        { name: "Lagoon Nebula", position: new THREE.Vector3(-2800, -300, 2500), scale: 200, type: "emission", primaryColor: new THREE.Color(0.8, 0.2, 0.4) }
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

        // Create label sprite
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 256, 64);

        ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(obj.name, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.8,
            depthTest: false
        });

        const label = new THREE.Sprite(spriteMat);
        label.scale.set(obj.radius * 4, obj.radius, 1);
        label.position.set(0, obj.radius * 1.8, 0);
        obj.mesh.add(label);

        // Create glow ring
        const glowGeo = new THREE.RingGeometry(obj.radius * 1.2, obj.radius * 1.5, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.x = Math.PI / 2;
        obj.mesh.add(glow);

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

