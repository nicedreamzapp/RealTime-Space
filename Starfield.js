// PHOTOREALISTIC Starfield.js
// True-to-life starfield with 150K+ stars, Milky Way band,
// accurate stellar distribution, and deep-field galaxies

class Starfield {
    constructor(options = {}) {
        this.cfg = Object.assign({
            // High star count for deep space look
            count: 150000,
            radius: 10000,
            colorVariation: true,

            // Subtle twinkling
            twinkleSpeed: 0.8,
            twinkleAmplitude: 0.12,

            // Star appearance
            sizeBase: 0.6,
            sizeVariation: 3.0,
            brightness: 1.6,

            // Distribution
            seed: Math.random() * 1e9,
            galaxies: 40,
            milkyWayDensity: 1.5,

            // Color temperature range (Kelvin)
            minTemp: 2500,
            maxTemp: 35000
        }, options);

        this._rnd = this._mulberry32(this.cfg.seed);
        this.mesh = null;
        this._galaxyPool = [];
        this._build();
    }

    _build() {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(this.cfg.count * 3);
        const col = new Float32Array(this.cfg.count * 3);
        const size = new Float32Array(this.cfg.count);
        const phase = new Float32Array(this.cfg.count);
        const vgrade = new Float32Array(this.cfg.count);

        for (let i = 0; i < this.cfg.count; i++) {
            const theta = 2 * Math.PI * this._rnd();
            const phi = Math.acos(2 * this._rnd() - 1);

            // Create Milky Way band effect
            let r;
            const bandChance = this._rnd();

            if (bandChance < 0.35) {
                // Milky Way band - concentrated along galactic plane
                const galacticLat = (this._rnd() - 0.5) * 0.3; // Narrow band
                const galacticLon = this._rnd() * Math.PI * 2;

                r = this.cfg.radius * (0.6 + this._rnd() * 0.4);
                const x = r * Math.cos(galacticLon);
                const y = r * galacticLat; // Flatten
                const z = r * Math.sin(galacticLon);

                pos[i * 3] = x;
                pos[i * 3 + 1] = y;
                pos[i * 3 + 2] = z;
            } else {
                // Regular spherical distribution
                r = this.cfg.radius * Math.cbrt(this._rnd());
                pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
                pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
                pos[i * 3 + 2] = r * Math.cos(phi);
            }

            // Realistic star size distribution (IMF)
            const sizeRoll = this._rnd();
            if (sizeRoll < 0.75) {
                // 75% dim dwarf stars
                size[i] = this.cfg.sizeBase * (0.3 + this._rnd() * 0.3);
            } else if (sizeRoll < 0.95) {
                // 20% medium stars
                size[i] = this.cfg.sizeBase * (0.6 + this._rnd() * 0.6);
            } else if (sizeRoll < 0.99) {
                // 4% bright stars
                size[i] = this.cfg.sizeBase * (1.2 + this._rnd() * 1.5);
            } else {
                // 1% giant stars
                size[i] = this.cfg.sizeBase * (2.5 + this._rnd() * this.cfg.sizeVariation);
            }

            phase[i] = this._rnd() * Math.PI * 2;
            vgrade[i] = 0.1 + this._rnd() * 0.9;

            // Realistic stellar population
            let temp;
            const tempRoll = this._rnd();
            if (tempRoll < 0.55) {
                // M, K class (cool red/orange)
                temp = this.cfg.minTemp + this._rnd() * 2000;
            } else if (tempRoll < 0.80) {
                // G class (sun-like yellow)
                temp = 4500 + this._rnd() * 1500;
            } else if (tempRoll < 0.92) {
                // F class (yellow-white)
                temp = 6000 + this._rnd() * 1500;
            } else if (tempRoll < 0.97) {
                // A class (white)
                temp = 7500 + this._rnd() * 2500;
            } else {
                // B, O class (blue-white, blue)
                temp = 10000 + this._rnd() * (this.cfg.maxTemp - 10000);
            }

            const rgb = this._accurateBlackbody(temp);
            const brightness = 0.5 + this._rnd() * 0.8;
            col[i * 3] = rgb[0] * brightness;
            col[i * 3 + 1] = rgb[1] * brightness;
            col[i * 3 + 2] = rgb[2] * brightness;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        geo.setAttribute('aVGrade', new THREE.BufferAttribute(vgrade, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTwinkleSpeed: { value: this.cfg.twinkleSpeed },
                uTwinkleAmp: { value: this.cfg.twinkleAmplitude },
                uBrightness: { value: this.cfg.brightness },
                uTime: { value: 0 },
                uCamPos: { value: new THREE.Vector3() },
                uParallaxFactor: { value: 0.0003 }
            },
            vertexShader: `
                attribute vec3 color;
                attribute float aSize;
                attribute float aPhase;
                attribute float aVGrade;

                uniform float uTwinkleSpeed;
                uniform float uTwinkleAmp;
                uniform float uBrightness;
                uniform float uTime;
                uniform vec3 uCamPos;
                uniform float uParallaxFactor;

                varying vec3 vColor;
                varying float vBrightness;

                void main() {
                    // Parallax effect
                    vec3 displaced = position + uCamPos * aVGrade * uParallaxFactor;
                    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);

                    gl_Position = projectionMatrix * mvPosition;

                    // Size attenuation with distance
                    float distanceFactor = 300.0 / -mvPosition.z;
                    gl_PointSize = aSize * distanceFactor;

                    // Atmospheric scintillation (twinkling)
                    float twinkle = 1.0 + sin(uTime * uTwinkleSpeed + aPhase) * uTwinkleAmp;
                    twinkle *= 1.0 + sin(uTime * uTwinkleSpeed * 1.7 + aPhase * 2.3) * uTwinkleAmp * 0.5;

                    vColor = color * twinkle * uBrightness;
                    vBrightness = length(color) * twinkle;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vBrightness;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);

                    if (d > 0.5) discard;

                    // Airy disk-like falloff for realistic star appearance
                    float core = exp(-d * d * 20.0); // Sharp core
                    float halo = exp(-d * d * 5.0) * 0.3; // Soft halo
                    float spikes = 0.0;

                    // Add subtle diffraction spikes for bright stars
                    if (vBrightness > 1.0) {
                        float angle = atan(uv.y, uv.x);
                        spikes = pow(abs(sin(angle * 2.0)), 8.0) * exp(-d * 3.0) * 0.15;
                    }

                    float intensity = core + halo + spikes;
                    vec3 finalColor = vColor * intensity;

                    // Add slight blue halo to bright stars
                    if (vBrightness > 0.8) {
                        finalColor += vec3(0.1, 0.15, 0.3) * halo * 0.5;
                    }

                    gl_FragColor = vec4(finalColor, intensity);
                }
            `,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true
        });

        this.mesh = new THREE.Points(geo, mat);

        // Add Milky Way glow band
        this._createMilkyWayGlow();

        // Add distant galaxies
        this._createGalaxies();
    }

    _createMilkyWayGlow() {
        // Create a subtle glow band for the Milky Way
        const geometry = new THREE.PlaneGeometry(this.cfg.radius * 4, this.cfg.radius * 0.8);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color1: { value: new THREE.Color(0x2a2035) },
                color2: { value: new THREE.Color(0x3d3050) }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 color1;
                uniform vec3 color2;
                varying vec2 vUv;

                float noise(vec2 p) {
                    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
                }

                void main() {
                    // Soft edges
                    float edgeX = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
                    float edgeY = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
                    float edge = edgeX * edgeY;

                    // Dusty texture
                    float n = noise(vUv * 100.0) * 0.3;
                    n += noise(vUv * 50.0) * 0.4;
                    n += noise(vUv * 25.0) * 0.3;

                    vec3 color = mix(color1, color2, n);
                    float alpha = edge * 0.25 * (0.5 + n * 0.5);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.milkyWay = new THREE.Mesh(geometry, material);
        this.milkyWay.rotation.x = Math.PI / 2;
        this.mesh.add(this.milkyWay);
    }

    _createGalaxies() {
        for (let i = 0; i < this.cfg.galaxies; i++) {
            const galaxyType = this._rnd();
            let texture;

            if (galaxyType < 0.6) {
                texture = this._makeSpiralGalaxyTexture();
            } else if (galaxyType < 0.85) {
                texture = this._makeEllipticalGalaxyTexture();
            } else {
                texture = this._makeIrregularGalaxyTexture();
            }

            const spr = new THREE.Sprite(new THREE.SpriteMaterial({
                map: texture,
                blending: THREE.AdditiveBlending,
                transparent: true,
                depthWrite: false,
                opacity: 0.3 + this._rnd() * 0.4
            }));

            const theta = 2 * Math.PI * this._rnd();
            const phi = Math.acos(2 * this._rnd() - 1);
            const r = this.cfg.radius * (1.1 + this._rnd() * 0.5);

            spr.position.setFromSphericalCoords(r, phi, theta);
            spr.scale.setScalar(30 + this._rnd() * 120);

            // Random rotation for variety
            spr.material.rotation = this._rnd() * Math.PI * 2;

            this.mesh.add(spr);
            this._galaxyPool.push({ sprite: spr, texture: texture });
        }
    }

    _makeSpiralGalaxyTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const center = 256;

        ctx.clearRect(0, 0, 512, 512);

        // Central bulge
        const bulge = ctx.createRadialGradient(center, center, 0, center, center, 70);
        bulge.addColorStop(0, 'rgba(255, 248, 230, 1)');
        bulge.addColorStop(0.3, 'rgba(255, 240, 200, 0.8)');
        bulge.addColorStop(0.7, 'rgba(255, 230, 180, 0.3)');
        bulge.addColorStop(1, 'rgba(255, 220, 160, 0)');
        ctx.fillStyle = bulge;
        ctx.fillRect(0, 0, 512, 512);

        // Spiral arms
        ctx.globalCompositeOperation = 'lighter';
        const numArms = 2 + Math.floor(this._rnd() * 2);

        for (let arm = 0; arm < numArms; arm++) {
            const armOffset = (arm / numArms) * Math.PI * 2;

            for (let i = 0; i < 1200; i++) {
                const t = i / 1200;
                const angle = armOffset + t * Math.PI * 4;
                const r = 25 + t * 200;

                const spread = (this._rnd() - 0.5) * 40 * (1 - t * 0.3);
                const x = center + Math.cos(angle) * r + spread * Math.cos(angle + Math.PI/2);
                const y = center + Math.sin(angle) * r + spread * Math.sin(angle + Math.PI/2);

                const brightness = (1 - t * 0.5) * (0.3 + this._rnd() * 0.7);
                const starSize = 0.5 + this._rnd() * 2.5;

                // Star forming regions (blue) vs older stars (yellow)
                const isYoung = t > 0.3 && this._rnd() > 0.6;
                const red = isYoung ? 180 + this._rnd() * 50 : 255;
                const green = 200 + this._rnd() * 55;
                const blue = isYoung ? 220 + this._rnd() * 35 : 180 + this._rnd() * 40;

                ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${brightness * 0.7})`;
                ctx.beginPath();
                ctx.arc(x, y, starSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Outer halo
        ctx.globalCompositeOperation = 'source-over';
        const halo = ctx.createRadialGradient(center, center, 80, center, center, 256);
        halo.addColorStop(0, 'rgba(180, 160, 220, 0.1)');
        halo.addColorStop(0.5, 'rgba(120, 110, 180, 0.05)');
        halo.addColorStop(1, 'rgba(80, 80, 120, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, 512, 512);

        return new THREE.CanvasTexture(canvas);
    }

    _makeEllipticalGalaxyTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const center = 128;

        ctx.clearRect(0, 0, 256, 256);

        // Elliptical galaxies are more uniform
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, 120);
        gradient.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
        gradient.addColorStop(0.2, 'rgba(255, 230, 180, 0.6)');
        gradient.addColorStop(0.5, 'rgba(255, 210, 160, 0.3)');
        gradient.addColorStop(0.8, 'rgba(255, 190, 140, 0.1)');
        gradient.addColorStop(1, 'rgba(255, 180, 130, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(center, center, 120, 80 + this._rnd() * 40, this._rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    _makeIrregularGalaxyTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const center = 128;

        ctx.clearRect(0, 0, 256, 256);
        ctx.globalCompositeOperation = 'lighter';

        // Irregular blob-like structure
        for (let i = 0; i < 500; i++) {
            const angle = this._rnd() * Math.PI * 2;
            const r = this._rnd() * 80 * Math.pow(this._rnd(), 0.5);
            const x = center + Math.cos(angle) * r + (this._rnd() - 0.5) * 40;
            const y = center + Math.sin(angle) * r + (this._rnd() - 0.5) * 40;

            const brightness = 0.3 + this._rnd() * 0.7;
            const size = 1 + this._rnd() * 3;

            // More blue star forming regions
            const blue = 200 + this._rnd() * 55;
            const green = 180 + this._rnd() * 50;
            const red = 180 + this._rnd() * 50;

            ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${brightness * 0.6})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        return new THREE.CanvasTexture(canvas);
    }

    _accurateBlackbody(tempKelvin) {
        const temp = Math.max(1000, Math.min(40000, tempKelvin));
        let r, g, b;

        if (temp <= 6600) {
            r = 1.0;
        } else {
            r = temp / 100 - 60;
            r = 329.698727446 * Math.pow(r, -0.1332047592);
            r = Math.max(0, Math.min(255, r)) / 255;
        }

        if (temp <= 6600) {
            g = temp / 100;
            g = 99.4708025861 * Math.log(g) - 161.1195681661;
            g = Math.max(0, Math.min(255, g)) / 255;
        } else {
            g = temp / 100 - 60;
            g = 288.1221695283 * Math.pow(g, -0.0755148492);
            g = Math.max(0, Math.min(255, g)) / 255;
        }

        if (temp >= 6600) {
            b = 1.0;
        } else if (temp <= 1900) {
            b = 0;
        } else {
            b = temp / 100 - 10;
            b = 138.5177312231 * Math.log(b) - 305.0447927307;
            b = Math.max(0, Math.min(255, b)) / 255;
        }

        // Gamma correction
        const gamma = 0.45;
        r = Math.pow(r, gamma);
        g = Math.pow(g, gamma);
        b = Math.pow(b, gamma);

        return [r, g, b];
    }

    update(camPos, deltaTime) {
        if (!this.mesh) return;

        this.mesh.material.uniforms.uTime.value += deltaTime;
        this.mesh.material.uniforms.uCamPos.value.copy(camPos);

        // Update Milky Way
        if (this.milkyWay && this.milkyWay.material.uniforms) {
            this.milkyWay.material.uniforms.time.value += deltaTime;
        }

        // Fade galaxies based on distance
        this._galaxyPool.forEach(g => {
            const d = g.sprite.position.distanceTo(camPos);
            g.sprite.material.opacity = THREE.MathUtils.clamp(0.1 + (this.cfg.radius / d) * 0.4, 0.08, 0.5);
        });
    }

    getMesh() {
        return this.mesh;
    }

    setTwinkle(speed, amplitude) {
        if (this.mesh?.material?.uniforms) {
            if (speed !== undefined) this.mesh.material.uniforms.uTwinkleSpeed.value = speed;
            if (amplitude !== undefined) this.mesh.material.uniforms.uTwinkleAmp.value = amplitude;
        }
    }

    _mulberry32(seed) {
        return function() {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    dispose() {
        if (this.mesh) {
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
        }
        this._galaxyPool.forEach(({ sprite, texture }) => {
            sprite.material?.map?.dispose();
            sprite.material?.dispose();
        });
        this._galaxyPool.length = 0;
    }
}

if (typeof module !== 'undefined') module.exports = Starfield;
