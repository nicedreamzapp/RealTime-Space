// PHOTOREALISTIC PostProcessing.js
// Cinematic post-processing pipeline for true NASA/Hubble quality space imagery
// HDR bloom, color grading, lens effects, and film aesthetics

class PostProcessing {
    constructor(renderer, scene, camera, options = {}) {
        console.log("✨ PostProcessing: Initializing CINEMATIC pipeline...");

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;

        // VIBRANT CINEMATIC settings - rich color, visible bloom, lifelike depth
        this.cfg = Object.assign({
            // HDR Bloom - visible glow that makes stars and nebulae pop
            bloomStrength: 0.55,      // Noticeable glow on bright objects
            bloomRadius: 0.55,        // Soft, wide glow
            bloomThreshold: 0.72,     // More objects get bloom treatment

            // Lens effects - subtle but present for cinematic feel
            chromaticAberration: 0.0012, // Slight color fringing at edges
            lensDistortion: 0.008,       // Mild barrel distortion
            anamorphicFlare: 0.15,       // Visible flares near bright stars

            // Film look - polished cinematic aesthetic
            vignetteStrength: 0.22,    // Noticeable framing
            vignetteSoftness: 0.65,    // Clean falloff
            grainIntensity: 0.004,     // Very fine grain for texture
            grainSize: 1.0,

            // Color grading - vibrant and rich
            saturation: 1.2,           // Vivid colors
            contrast: 1.15,            // Strong contrast for depth
            brightness: 1.05,          // Slightly lifted
            gamma: 1.08,              // Lifted midtones for cleaner shadows

            // Tone mapping
            exposure: 1.05,            // Bright, punchy exposure
            whitePoint: 1.3,           // Clean highlights

            // Ambient effects
            godRaysEnabled: true,
            motionBlurEnabled: false
        }, options);

        this.glowSprites = new Map();
        this._composer = null;
        this._time = 0;

        this._setupPipeline();
    }

    _setupPipeline() {
        try {
            if (THREE.EffectComposer && THREE.RenderPass && this.renderer) {
                this._setupComposer();
                console.log("✅ PostProcessing: Full EffectComposer pipeline active");
            } else {
                this._setupFallback();
                console.log("✅ PostProcessing: Enhanced fallback pipeline active");
            }
        } catch (e) {
            console.warn("⚠️ PostProcessing: Using fallback", e);
            this._setupFallback();
        }
    }

    _setupComposer() {
        const size = this.renderer.getSize(new THREE.Vector2());
        const pixelRatio = this.renderer.getPixelRatio();

        this._composer = new THREE.EffectComposer(this.renderer);
        this._composer.setSize(size.x, size.y);
        this._composer.setPixelRatio(pixelRatio);

        // Base render
        const renderPass = new THREE.RenderPass(this.scene, this.camera);
        this._composer.addPass(renderPass);

        // HDR Bloom
        if (THREE.UnrealBloomPass) {
            const bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(size.x, size.y),
                this.cfg.bloomStrength,
                this.cfg.bloomRadius,
                this.cfg.bloomThreshold
            );
            this._composer.addPass(bloomPass);
            this._bloomPass = bloomPass;
        }

        // Chromatic Aberration + Lens Distortion
        const lensShader = {
            uniforms: {
                tDiffuse: { value: null },
                chromaticAberration: { value: this.cfg.chromaticAberration },
                distortion: { value: this.cfg.lensDistortion },
                resolution: { value: new THREE.Vector2(size.x, size.y) }
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
                uniform float chromaticAberration;
                uniform float distortion;
                uniform vec2 resolution;
                varying vec2 vUv;

                vec2 distort(vec2 uv) {
                    vec2 center = uv - 0.5;
                    float d = length(center);
                    float k = 1.0 + d * d * distortion;
                    return center * k + 0.5;
                }

                void main() {
                    vec2 uv = distort(vUv);
                    vec2 dir = (vUv - 0.5) * chromaticAberration;

                    float r = texture2D(tDiffuse, uv + dir).r;
                    float g = texture2D(tDiffuse, uv).g;
                    float b = texture2D(tDiffuse, uv - dir).b;

                    gl_FragColor = vec4(r, g, b, 1.0);
                }
            `
        };
        if (THREE.ShaderPass) {
            const lensPass = new THREE.ShaderPass(lensShader);
            this._composer.addPass(lensPass);
        }

        // Color Grading + Tone Mapping
        const colorGradeShader = {
            uniforms: {
                tDiffuse: { value: null },
                saturation: { value: this.cfg.saturation },
                contrast: { value: this.cfg.contrast },
                brightness: { value: this.cfg.brightness },
                gamma: { value: this.cfg.gamma },
                exposure: { value: this.cfg.exposure }
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
                uniform float saturation;
                uniform float contrast;
                uniform float brightness;
                uniform float gamma;
                uniform float exposure;
                varying vec2 vUv;

                vec3 adjustSaturation(vec3 color, float sat) {
                    float luma = dot(color, vec3(0.299, 0.587, 0.114));
                    return mix(vec3(luma), color, sat);
                }

                // ACES Filmic Tone Mapping
                vec3 ACESFilm(vec3 x) {
                    float a = 2.51;
                    float b = 0.03;
                    float c = 2.43;
                    float d = 0.59;
                    float e = 0.14;
                    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
                }

                // Filmic shadow/highlight color split (Hollywood orange & teal)
                vec3 filmicColorGrade(vec3 color) {
                    float luma = dot(color, vec3(0.299, 0.587, 0.114));
                    // Shadows push toward deep blue/teal
                    vec3 shadowTint = vec3(0.05, 0.12, 0.18);
                    // Highlights push toward warm gold
                    vec3 highlightTint = vec3(0.15, 0.10, 0.02);
                    // Midtones stay neutral
                    float shadowWeight = smoothstep(0.0, 0.35, 1.0 - luma) * 0.25;
                    float highlightWeight = smoothstep(0.5, 1.0, luma) * 0.2;
                    color += shadowTint * shadowWeight;
                    color += highlightTint * highlightWeight;
                    return color;
                }

                void main() {
                    vec3 color = texture2D(tDiffuse, vUv).rgb;

                    // Exposure
                    color *= exposure;

                    // Tone mapping
                    color = ACESFilm(color);

                    // Contrast (S-curve around mid-gray)
                    color = (color - 0.5) * contrast + 0.5;

                    // Brightness
                    color *= brightness;

                    // Filmic color grading (cinematic orange/teal split toning)
                    color = filmicColorGrade(color);

                    // Saturation
                    color = adjustSaturation(color, saturation);

                    // Gamma correction
                    color = pow(max(color, vec3(0.0)), vec3(1.0 / gamma));

                    gl_FragColor = vec4(color, 1.0);
                }
            `
        };
        if (THREE.ShaderPass) {
            const colorPass = new THREE.ShaderPass(colorGradeShader);
            this._composer.addPass(colorPass);
            this._colorPass = colorPass;
        }

        // Vignette
        const vignetteShader = {
            uniforms: {
                tDiffuse: { value: null },
                strength: { value: this.cfg.vignetteStrength },
                softness: { value: this.cfg.vignetteSoftness }
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
                uniform float strength;
                uniform float softness;
                varying vec2 vUv;

                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);
                    vec2 center = vUv - 0.5;
                    float dist = length(center) * 2.0;

                    // Cinematic vignette with anamorphic oval shape
                    vec2 anamorphicCenter = center * vec2(1.0, 1.3); // Wider horizontal
                    float anamorphicDist = length(anamorphicCenter) * 2.0;
                    float vignette = 1.0 - smoothstep(softness, 1.2, anamorphicDist * strength);

                    // Warm vignette edges (deep amber/brown like real lens falloff)
                    vec3 vignetteColor = mix(color.rgb * vec3(0.85, 0.78, 0.88), color.rgb, vignette);

                    // Subtle edge blur simulation (soft focus at edges)
                    float edgeBlur = smoothstep(0.6, 1.0, dist);
                    vec2 blurOffset = center * edgeBlur * 0.002;
                    vec3 blurred = texture2D(tDiffuse, vUv + blurOffset).rgb;
                    vignetteColor = mix(vignetteColor, blurred, edgeBlur * 0.3);

                    gl_FragColor = vec4(vignetteColor, color.a);
                }
            `
        };
        if (THREE.ShaderPass) {
            const vignettePass = new THREE.ShaderPass(vignetteShader);
            this._composer.addPass(vignettePass);
        }

        // Film Grain
        const grainShader = {
            uniforms: {
                tDiffuse: { value: null },
                intensity: { value: this.cfg.grainIntensity },
                size: { value: this.cfg.grainSize },
                time: { value: 0 }
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
                uniform float intensity;
                uniform float size;
                uniform float time;
                varying vec2 vUv;

                float random(vec2 co) {
                    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main() {
                    vec4 color = texture2D(tDiffuse, vUv);

                    // Animated grain
                    vec2 grainUv = vUv * size + time;
                    float grain = random(grainUv) * 2.0 - 1.0;

                    // Apply grain more to darker areas (photorealistic)
                    float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
                    float grainAmount = intensity * (1.0 - luminance * 0.5);

                    color.rgb += grain * grainAmount;

                    gl_FragColor = color;
                }
            `
        };
        if (THREE.ShaderPass) {
            this._grainPass = new THREE.ShaderPass(grainShader);
            this._composer.addPass(this._grainPass);
        }

        window.addEventListener('resize', this._onResize.bind(this));
    }

    _setupFallback() {
        // Enhanced sprite-based bloom for environments without EffectComposer
        this._setupSpriteBloom();
    }

    _setupSpriteBloom() {
        // Find bright objects and add glow
        this.scene.traverse(obj => {
            if (obj.type === 'star' || (obj.material && obj.material.emissive)) {
                this._addGlowToObject(obj);
            }
        });
    }

    _addGlowToObject(obj) {
        const color = obj.material?.emissive || obj.material?.color || new THREE.Color(0xffffff);
        const scale = obj.scale?.x || 1;

        // Multi-layer glow for HDR effect
        const glowConfig = [
            { size: 2.5, opacity: 0.5 },
            { size: 4.0, opacity: 0.25 },
            { size: 7.0, opacity: 0.1 },
            { size: 12.0, opacity: 0.04 }
        ];

        const glows = [];
        glowConfig.forEach(cfg => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this._createGlowTexture(),
                color: color,
                blending: THREE.AdditiveBlending,
                transparent: true,
                opacity: cfg.opacity,
                depthWrite: false
            }));
            sprite.scale.setScalar(scale * cfg.size);
            obj.add(sprite);
            glows.push(sprite);
        });

        this.glowSprites.set(obj, glows);
    }

    _createGlowTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const center = 256;

        // Gaussian-like falloff
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.25, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(0.75, 'rgba(255, 255, 255, 0.05)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);

        return new THREE.CanvasTexture(canvas);
    }

    _onResize() {
        if (this._composer) {
            const size = this.renderer.getSize(new THREE.Vector2());
            this._composer.setSize(size.x, size.y);
        }
    }

    render() {
        if (this._composer) {
            this._composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    update(deltaTime) {
        this._time += deltaTime;

        // Update grain animation
        if (this._grainPass) {
            this._grainPass.uniforms.time.value = this._time * 10;
        }

        // Subtle glow pulsing
        this.glowSprites.forEach((glows, obj) => {
            glows.forEach((glow, i) => {
                const pulse = 1.0 + Math.sin(this._time * 2 + i * 0.5) * 0.03;
                glow.scale.multiplyScalar(pulse);
            });
        });
    }

    // API for adjusting settings at runtime
    setBloom(strength, radius, threshold) {
        if (this._bloomPass) {
            if (strength !== undefined) this._bloomPass.strength = strength;
            if (radius !== undefined) this._bloomPass.radius = radius;
            if (threshold !== undefined) this._bloomPass.threshold = threshold;
        }
    }

    setExposure(exposure) {
        if (this._colorPass) {
            this._colorPass.uniforms.exposure.value = exposure;
        }
    }

    setSaturation(saturation) {
        if (this._colorPass) {
            this._colorPass.uniforms.saturation.value = saturation;
        }
    }

    setContrast(contrast) {
        if (this._colorPass) {
            this._colorPass.uniforms.contrast.value = contrast;
        }
    }

    // Add glow to any object
    addGlow(obj, color = 0xffffff, intensity = 1.0) {
        const glowConfig = [
            { size: 2.0 * intensity, opacity: 0.4 },
            { size: 3.5 * intensity, opacity: 0.2 },
            { size: 6.0 * intensity, opacity: 0.08 }
        ];

        const glows = [];
        glowConfig.forEach(cfg => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this._createGlowTexture(),
                color: color,
                blending: THREE.AdditiveBlending,
                transparent: true,
                opacity: cfg.opacity,
                depthWrite: false
            }));
            sprite.scale.setScalar(cfg.size);
            obj.add(sprite);
            glows.push(sprite);
        });

        this.glowSprites.set(obj, glows);
    }

    dispose() {
        if (this._composer) {
            window.removeEventListener('resize', this._onResize);
            this._composer.passes?.forEach(p => p.dispose?.());
            this._composer = null;
        }

        this.glowSprites.forEach((glows, obj) => {
            glows.forEach(glow => {
                obj.remove(glow);
                glow.material.map?.dispose();
                glow.material.dispose();
            });
        });
        this.glowSprites.clear();

        console.log('🧹 PostProcessing disposed');
    }
}

if (typeof module !== 'undefined') module.exports = PostProcessing;
