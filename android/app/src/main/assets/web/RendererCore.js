// RendererCore.js
// HUBBLE-QUALITY Three.js renderer with HDR, cinematic tone mapping, and film-like rendering

class RendererCore {
    constructor(canvasId = "galaxyCanvas") {
        console.log("🔧 RendererCore: Initializing HUBBLE-QUALITY renderer...");

        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error("❌ Canvas not found:", canvasId);
            throw new Error("Canvas element not found");
        }

        // Detect device capabilities
        this.isMobile = window.innerWidth < 768;
        this.isHighEnd = window.devicePixelRatio >= 3; // iPhone Pro/Pro Max
        // Cap at 2x: on a ~460ppi phone display 2x is already retina-sharp, while 3x
        // pushes ~2.25x the pixels through the multi-pass cinematic pipeline for no
        // visible gain — the single biggest framerate cost on Pro Max.
        // ANDROID PORT: entry-level mobile GPUs (e.g. PowerVR GE8320) hang when pushing
        // the full cinematic pipeline at native DPR. Cap at 1x here.
        this.maxPixelRatio = 1;
        this.pixelRatio = Math.min(window.devicePixelRatio, this.maxPixelRatio);

        this.initScene();
        this.initCamera();
        this.initRenderer();
        this.initEnvironmentMap();
        this.initPostProcessing();
        this.setupResizeHandler();

        console.log("✅ RendererCore initialized with HUBBLE-QUALITY settings");
    }

    initScene() {
        this.scene = new THREE.Scene();

        // Deep space with very subtle blue-purple richness (like JWST imagery)
        this.scene.background = new THREE.Color(0x010108);

        // Very subtle fog for atmospheric depth. MUST be pure black: the renderer
        // gamma-lifts these values (0x020210 displayed ≈ 0x151546), and with no skybox
        // any tint here paints the whole sky navy-blue.
        this.scene.fog = new THREE.FogExp2(0x000000, 0.0000012);

        console.log("✅ Scene created with true deep space atmosphere");
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            68,  // Slightly narrower for more cinematic framing
            window.innerWidth / window.innerHeight,
            0.01,  // Closer near plane for detail
            2000000  // Much farther far plane for vast distances
        );

        // START CLOSE - can see planets clearly
        this.camera.position.set(0, 5, 25);
        this.camera.lookAt(0, 0, 0);

        console.log("✅ Camera configured for cinematic space views");
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: false,  // ANDROID PORT: MSAA too costly on entry-level mobile GPUs
            alpha: false,
            powerPreference: "high-performance",
            stencil: true,  // Enable for post-processing effects
            depth: true,
            preserveDrawingBuffer: true,  // iOS WKWebView: needed so the drawing buffer
                                          // actually composites to screen (otherwise the
                                          // frame renders but the layer shows black)
            logarithmicDepthBuffer: true  // Better depth precision for vast scales
        });

        // Size and quality - push it higher
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.pixelRatio);

        // Enhanced shadows — DISABLED on Android port (PCFSoft shadow passes hang
        // entry-level mobile GPUs like the PowerVR GE8320).
        this.renderer.shadowMap.enabled = false;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = false;

        // HDR-like output with cinematic tone mapping
        // Use outputColorSpace for Three.js r152+ (fallback to outputEncoding for older)
        if (this.renderer.outputColorSpace !== undefined) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        } else if (THREE.sRGBEncoding !== undefined) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;  // pulled down from 1.4 — deeper blacks, crisper contrast

        // Physically correct lighting (useLegacyLights replaces physicallyCorrectLights in r150+)
        this.renderer.useLegacyLights = false;

        // True space black — 0x000003 was gamma-lifted to a visible navy (0x00001c)
        // once the skybox stopped covering empty pixels.
        this.renderer.setClearColor(0x000000, 1.0);

        // Enable color management
        if (THREE.ColorManagement) {
            THREE.ColorManagement.enabled = true;
        }

        console.log("✅ Renderer configured with HDR cinematic settings");
    }

    initEnvironmentMap() {
        // Real 8K Milky Way panorama (Solar System Scope, CC BY 4.0) — now used ONLY for
        // PMREM image-based lighting. It is no longer the visible sky (see below).
        const loader = new THREE.TextureLoader();
        loader.load(
            'textures/starfield/milky_way_8k.jpg',
            (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;
                if (THREE.SRGBColorSpace !== undefined) {
                    texture.colorSpace = THREE.SRGBColorSpace;
                }
                texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy?.() || 8);

                // The panorama is NOT used as the visible sky anymore — its painted
                // stars/clouds sat at infinity like a canvas and never got closer, which
                // broke the "really in space" illusion. The sky is now true black + only
                // real 3D stars (procedural depth-tiered field + HYG real positions).
                // The photo still drives image-based lighting below, so planets keep
                // their soft Milky Way ambience.
                this.scene.background = null;

                const pmrem = new THREE.PMREMGenerator(this.renderer);
                pmrem.compileEquirectangularShader();
                const envMap = pmrem.fromEquirectangular(texture).texture;
                this.scene.environment = envMap;
                pmrem.dispose();
                texture.dispose(); // no longer the background — free the ~130MB 8K texture

                console.log("✨ Milky Way IBL ready (panorama lights the scene, sky is real stars only)");
            },
            undefined,
            (err) => console.warn("Milky Way skybox load failed:", err)
        );
    }

    initPostProcessing() {
        // Bloom effect for stars and sun
        this.bloomEnabled = true;
        
        // Store render stats
        this.renderStats = {
            fps: 0,
            frameTime: 0,
            triangles: 0,
            drawCalls: 0
        };
        
        console.log("✅ Post-processing initialized");
    }

    setupResizeHandler() {
        window.addEventListener("resize", () => this.onResize());
    }

    onResize() {
        if (!this.camera || !this.renderer) return;
        
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
        if (this.composer) {
            this.composer.setSize(width, height);
        }

        console.log(`📐 Resized to ${width}x${height}`);
    }

    // Add object to scene (supports both mesh and group)
    add(obj) {
        if (!obj) {
            console.warn("⚠️ Attempted to add null object");
            return;
        }
        
        if (!this.scene) {
            console.error("❌ Scene not initialized");
            return;
        }
        
        this.scene.add(obj);
        
        const name = obj.name || obj.type || obj.constructor.name;
        console.log(`➕ Added ${name} to scene`);
    }

    // Legacy compatibility
    addObject(obj) {
        this.add(obj);
    }

    // Remove object from scene
    remove(obj) {
        if (obj && this.scene) {
            this.scene.remove(obj);
            console.log("➖ Removed object from scene");
        }
    }

    removeObject(obj) {
        this.remove(obj);
    }

    // Main render function
    render() {
        if (!this.renderer || !this.scene || !this.camera) {
            console.error("❌ Cannot render: missing renderer, scene, or camera");
            return;
        }

        try {
            this.renderer.render(this.scene, this.camera);
        } catch (e) {
            console.error("❌ Render failed:", e);
        }
    }

    // Get renderer info for debugging
    getInfo() {
        if (!this.renderer) return null;
        
        const info = this.renderer.info;
        return {
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            calls: info.render.calls,
            triangles: info.render.triangles,
            points: info.render.points,
            lines: info.render.lines
        };
    }

    // Update fog based on camera distance (for depth effect)
    updateFog(distance) {
        if (this.scene.fog) {
            // Fog density decreases as you move further into space
            const baseDensity = 0.000008;
            const maxDensity = 0.00002;
            const fogDensity = Math.max(
                baseDensity,
                maxDensity / (distance + 1)
            );
            this.scene.fog.density = fogDensity;
        }
    }

    // Enable/disable shadows (for performance tuning)
    setShadowsEnabled(enabled) {
        this.renderer.shadowMap.enabled = enabled;
        console.log(`🌓 Shadows ${enabled ? 'enabled' : 'disabled'}`);
    }

    // Adjust exposure for different space regions
    setExposure(exposure) {
        this.renderer.toneMappingExposure = exposure;
        console.log(`☀️ Exposure set to ${exposure}`);
    }

    // Cleanup method
    dispose() {
        if (this.renderer) {
            this.renderer.dispose();
        }
        console.log("🧹 RendererCore disposed");
    }
}
