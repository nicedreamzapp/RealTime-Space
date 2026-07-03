// Star.js - NASA SDO / SOHO / JAMES WEBB quality photorealistic stellar rendering
// True solar physics simulation: coronal mass ejections, solar wind, prominences,
// chromosphere, photosphere granulation, sunspots, faculae, and realistic limb darkening
// Inspired by actual NASA Solar Dynamics Observatory imagery

class Star {
    constructor(config = {}) {
        this.name = config.name || "Star";
        this.radius = config.radius || 5.0;
        this.color = config.color || 0xfff4e6;
        this.luminosity = config.luminosity || 8.0;
        this.temperature = config.temperature || 5778;
        this.prominenceCount = config.prominenceCount || 12;
        this.type = "star";

        // Stellar classification based on temperature
        this.spectralClass = this._getSpectralClass(this.temperature);
        this.actualColor = this._temperatureToColor(this.temperature);

        // Solar activity cycle (11-year cycle simulation)
        this.activityLevel = config.activityLevel || (0.3 + Math.random() * 0.7);
        this.rotationPeriod = config.rotationPeriod || (25 + Math.random() * 10); // days at equator
        this.magneticCyclePhase = config.magneticCyclePhase || Math.random();
        this.differentialRotation = 0.2; // Equator rotates faster than poles

        // Advanced solar phenomena
        this.hasSolarWind = config.hasSolarWind !== false && this.luminosity > 2;
        this.hasCoronalMassEjections = config.hasCoronalMassEjections || (this.activityLevel > 0.5);
        this.hasChromosphere = config.hasChromosphere !== false;
        this.hasSunspots = config.hasSunspots !== false;
        this.hasFaculae = config.hasFaculae !== false;
        this.sunspotCoverage = this.activityLevel * 0.003; // Active region coverage
        this.texturePack = config.texturePack || null;

        this.createMesh();

        // Animation state
        this.time = 0;
        this.rotationSpeed = (2 * Math.PI) / (this.rotationPeriod * 24 * 3600);
        this.cmeEvents = [];
        this.lastCMETime = -100;
        this.solarWindParticles = null;

        console.log(`🌟 Created SDO-QUALITY star: ${this.name} (Class ${this.spectralClass}, ${this.temperature}K, Activity: ${(this.activityLevel * 100).toFixed(0)}%)`);
    }

    _getSpectralClass(temp) {
        if (temp > 30000) return 'O';
        if (temp > 10000) return 'B';
        if (temp > 7500) return 'A';
        if (temp > 6000) return 'F';
        if (temp > 5200) return 'G';
        if (temp > 3700) return 'K';
        return 'M';
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;

        // Layer 1: Photosphere with turbulent plasma, sunspots, and granulation
        this._createPlasmaSurface();

        // Layer 2: Chromosphere (thin red/pink layer)
        if (this.hasChromosphere) {
            this._createChromosphere();
        }

        // Layer 3: Multi-layer corona with magnetic field structure
        this._createRealisticCorona();

        // Layer 4: Solar prominences and filaments
        if (this.luminosity > 3) {
            this._createProminences();
        }

        // Layer 5: Coronal Mass Ejections (dynamic)
        if (this.hasCoronalMassEjections) {
            this._createCMESystem();
        }

        // Layer 6: Solar wind particle stream
        if (this.hasSolarWind) {
            this._createSolarWind();
        }

        // Visual effects: Diffraction spikes (Hubble/JWST style)
        if (this.luminosity > 3) {
            this._createDiffractionSpikes();
        }

        // Lens flare elements
        this._createLensFlare();
    }

    _createChromosphere() {
        // Thin chromosphere layer - visible during eclipses as pink/red ring
        const chromoGeo = new THREE.SphereGeometry(this.radius * 1.005, 96, 96);

        const chromoMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                baseColor: { value: new THREE.Color(0xff4466) }, // H-alpha pink
                temperature: { value: this.temperature }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec2 vUv;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 baseColor;
                uniform float temperature;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec2 vUv;

                float noise(vec3 p) {
                    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
                }

                void main() {
                    // Spicules - jet-like structures
                    float spicule = noise(vPosition * 20.0 + time * 2.0);
                    spicule = pow(spicule, 3.0) * 2.0;

                    // Fresnel for visibility at limb
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 4.0);

                    // Chromospheric network pattern (supergranulation)
                    float network = noise(vPosition * 5.0);
                    network = smoothstep(0.4, 0.6, network);

                    vec3 color = baseColor * (1.0 + spicule * 0.3);
                    float alpha = fresnel * (0.15 + network * 0.1 + spicule * 0.05);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            side: THREE.FrontSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.chromosphere = new THREE.Mesh(chromoGeo, chromoMat);
        this.mesh.add(this.chromosphere);
    }

    _createCMESystem() {
        // Coronal Mass Ejection particle system - massive plasma eruptions
        const cmeCount = 50000;
        const positions = new Float32Array(cmeCount * 3);
        const velocities = new Float32Array(cmeCount * 3);
        const lifetimes = new Float32Array(cmeCount);
        const sizes = new Float32Array(cmeCount);

        // Initialize all particles as inactive
        for (let i = 0; i < cmeCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = 0;
            velocities[i * 3] = 0;
            velocities[i * 3 + 1] = 0;
            velocities[i * 3 + 2] = 0;
            lifetimes[i] = -1; // Inactive
            sizes[i] = 0.02 + Math.random() * 0.05;
        }

        const cmeGeo = new THREE.BufferGeometry();
        cmeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        cmeGeo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        cmeGeo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
        cmeGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const cmeMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                starRadius: { value: this.radius },
                cmeColor: { value: new THREE.Color(0xff6644) }
            },
            vertexShader: `
                attribute float lifetime;
                attribute float size;
                varying float vLifetime;
                varying vec3 vColor;
                uniform float time;
                uniform float starRadius;
                uniform vec3 cmeColor;

                void main() {
                    vLifetime = lifetime;

                    if (lifetime < 0.0) {
                        gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
                        gl_PointSize = 0.0;
                        return;
                    }

                    // Color fades from yellow-white to orange-red as it cools
                    float temp = 1.0 - lifetime * 0.5;
                    vColor = mix(cmeColor, vec3(1.0, 0.9, 0.7), temp);

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    float distanceFactor = 200.0 / -mvPosition.z;
                    float lifeFade = 1.0 - lifetime;
                    gl_PointSize = size * starRadius * distanceFactor * lifeFade;
                }
            `,
            fragmentShader: `
                varying float vLifetime;
                varying vec3 vColor;

                void main() {
                    if (vLifetime < 0.0) discard;

                    float d = length(gl_PointCoord - 0.5);
                    if (d > 0.5) discard;

                    float alpha = smoothstep(0.5, 0.0, d) * (1.0 - vLifetime * 0.8);
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.cmeSystem = new THREE.Points(cmeGeo, cmeMat);
        this.mesh.add(this.cmeSystem);
    }

    _triggerCME() {
        // Trigger a new Coronal Mass Ejection event
        if (!this.cmeSystem) return;

        const positions = this.cmeSystem.geometry.attributes.position.array;
        const velocities = this.cmeSystem.geometry.attributes.velocity.array;
        const lifetimes = this.cmeSystem.geometry.attributes.lifetime.array;

        // Random eruption point on stellar surface
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const eruption = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        );

        // Activate particles for this CME
        const particlesPerCME = 5000;
        let activated = 0;

        for (let i = 0; i < lifetimes.length && activated < particlesPerCME; i++) {
            if (lifetimes[i] < 0) {
                // Position at eruption point
                const spread = 0.3;
                const offset = new THREE.Vector3(
                    (Math.random() - 0.5) * spread,
                    (Math.random() - 0.5) * spread,
                    (Math.random() - 0.5) * spread
                );
                const pos = eruption.clone().add(offset).normalize().multiplyScalar(this.radius * 1.1);

                positions[i * 3] = pos.x;
                positions[i * 3 + 1] = pos.y;
                positions[i * 3 + 2] = pos.z;

                // Velocity outward with some spread
                const speed = 2 + Math.random() * 3;
                const vel = eruption.clone().add(offset.multiplyScalar(0.3)).normalize().multiplyScalar(speed);
                velocities[i * 3] = vel.x;
                velocities[i * 3 + 1] = vel.y;
                velocities[i * 3 + 2] = vel.z;

                lifetimes[i] = 0;
                activated++;
            }
        }

        this.cmeSystem.geometry.attributes.position.needsUpdate = true;
        this.cmeSystem.geometry.attributes.velocity.needsUpdate = true;
        this.cmeSystem.geometry.attributes.lifetime.needsUpdate = true;

        console.log(`💥 CME eruption on ${this.name}!`);
    }

    _createSolarWind() {
        // Continuous solar wind particle stream
        const windCount = 20000;
        const positions = new Float32Array(windCount * 3);
        const velocities = new Float32Array(windCount * 3);
        const phases = new Float32Array(windCount);

        for (let i = 0; i < windCount; i++) {
            // Start from random point on stellar surface
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            const r = this.radius * (1.2 + Math.random() * 10);
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            // Outward velocity
            const speed = 0.5 + Math.random() * 0.5;
            velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
            velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
            velocities[i * 3 + 2] = Math.cos(phi) * speed;

            phases[i] = Math.random() * Math.PI * 2;
        }

        const windGeo = new THREE.BufferGeometry();
        windGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        windGeo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        windGeo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        const windMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                starRadius: { value: this.radius },
                windColor: { value: this.actualColor.clone().multiplyScalar(0.5) }
            },
            vertexShader: `
                attribute vec3 velocity;
                attribute float phase;
                uniform float time;
                uniform float starRadius;
                varying float vAlpha;
                varying vec3 vColor;
                uniform vec3 windColor;

                void main() {
                    // Animate position outward
                    float t = mod(time * 0.5 + phase, 10.0);
                    vec3 pos = position + velocity * t * starRadius;

                    float dist = length(pos) / starRadius;

                    // Fade with distance
                    vAlpha = smoothstep(15.0, 1.5, dist) * 0.3;
                    vColor = windColor;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = max(1.0, 50.0 / -mvPosition.z);
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                varying vec3 vColor;

                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    if (d > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.solarWindParticles = new THREE.Points(windGeo, windMat);
        this.mesh.add(this.solarWindParticles);
    }

    _createPlasmaSurface() {
        const geometry = new THREE.SphereGeometry(this.radius, 128, 128);

        // Optional real NASA sun texture — used as base albedo; the procedural noise
        // animation still rides on top so the surface keeps moving.
        let sunMap = null;
        if (this.texturePack === 'sun') {
            sunMap = new THREE.TextureLoader().load(
                'textures/sun/sun_2k.jpg',
                () => console.log('☀️  Sun texture loaded (Solar System Scope 2K)'),
                undefined,
                (err) => console.warn('Sun texture load failed:', err)
            );
            if (THREE.SRGBColorSpace !== undefined) sunMap.colorSpace = THREE.SRGBColorSpace;
            else if (THREE.sRGBEncoding !== undefined) sunMap.encoding = THREE.sRGBEncoding;
            sunMap.anisotropy = 16;
        }

        // Uniforms for animated plasma shader
        this.surfaceUniforms = {
            time: { value: 0 },
            baseColor: { value: this.actualColor },
            temperature: { value: this.temperature },
            turbulenceScale: { value: 3.0 },
            granulationScale: { value: 15.0 },
            limbDarkening: { value: 0.6 },
            sunMap: { value: sunMap },
            useSunMap: { value: sunMap ? 1.0 : 0.0 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.surfaceUniforms,
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec2 vUv;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 baseColor;
                uniform float temperature;
                uniform float turbulenceScale;
                uniform float granulationScale;
                uniform float limbDarkening;
                uniform sampler2D sunMap;
                uniform float useSunMap;

                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec2 vUv;

                // Simplex noise for turbulent plasma
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

                    vec3 i = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);

                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);

                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;

                    i = mod289(i);
                    vec4 p = permute(permute(permute(
                        i.z + vec4(0.0, i1.z, i2.z, 1.0))
                        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

                    float n_ = 0.142857142857;
                    vec3 ns = n_ * D.wyz - D.xzx;

                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);

                    vec4 x = x_ * ns.x + ns.yyyy;
                    vec4 y = y_ * ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);

                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);

                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));

                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

                    vec3 p0 = vec3(a0.xy, h.x);
                    vec3 p1 = vec3(a0.zw, h.y);
                    vec3 p2 = vec3(a1.xy, h.z);
                    vec3 p3 = vec3(a1.zw, h.w);

                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }

                // Fractal Brownian Motion for detailed turbulence
                float fbm(vec3 p, int octaves) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    float frequency = 1.0;
                    for(int i = 0; i < 8; i++) {
                        if(i >= octaves) break;
                        value += amplitude * snoise(p * frequency);
                        frequency *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                void main() {
                    vec3 pos = normalize(vPosition);

                    // Large-scale convection cells
                    float convection = fbm(pos * turbulenceScale + time * 0.1, 4);

                    // Solar granulation (small convection cells)
                    float granulation = fbm(pos * granulationScale + time * 0.3, 6) * 0.15;

                    // Sunspots (dark, cooler regions)
                    float spotNoise = snoise(pos * 2.0 + vec3(time * 0.02));
                    float spots = smoothstep(0.6, 0.8, spotNoise) * 0.4;

                    // Active regions (brighter, hotter areas)
                    float activeRegion = smoothstep(0.5, 0.9, snoise(pos * 3.0 - time * 0.05)) * 0.2;

                    // Combine effects
                    float brightness = 1.0 + convection * 0.1 + granulation - spots + activeRegion;

                    // Temperature variation affects color
                    float tempVariation = brightness;
                    vec3 hotColor = baseColor * 1.3;
                    vec3 coolColor = baseColor * vec3(1.0, 0.7, 0.5); // Redder for cooler spots

                    vec3 surfaceColor = mix(coolColor, hotColor, tempVariation);

                    // If a real sun texture is provided, blend it in as albedo while keeping
                    // the procedural granulation/spots/active-region animation as modulation.
                    if (useSunMap > 0.5) {
                        vec3 photoSun = texture2D(sunMap, vUv).rgb;
                        // Boost into HDR range so bloom postprocessing takes off
                        photoSun *= 1.6;
                        surfaceColor = photoSun * brightness;
                    }

                    // Limb darkening (edges appear darker)
                    float viewAngle = dot(vNormal, vec3(0.0, 0.0, 1.0));
                    float limb = pow(max(0.0, viewAngle), limbDarkening);

                    // Apply limb darkening with color shift (edges appear redder)
                    vec3 limbColor = mix(surfaceColor * vec3(1.0, 0.85, 0.7), surfaceColor, limb);
                    float finalBrightness = mix(0.4, 1.0, limb);

                    vec3 finalColor = limbColor * finalBrightness * brightness;

                    // HDR boost for bright center
                    finalColor *= 1.0 + (1.0 - limb) * 0.5;

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });

        this.core = new THREE.Mesh(geometry, material);
        this.mesh.add(this.core);
    }

    _createRealisticCorona() {
        this.coronaLayers = [];

        // Inner corona (K-corona - electron scattering)
        const innerCoronaUniforms = {
            time: { value: 0 },
            baseColor: { value: this.actualColor },
            starRadius: { value: this.radius }
        };

        const innerCoronaGeo = new THREE.SphereGeometry(this.radius * 1.5, 64, 64);
        const innerCoronaMat = new THREE.ShaderMaterial({
            uniforms: innerCoronaUniforms,
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying float vDistance;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vDistance = length(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 baseColor;
                uniform float starRadius;

                varying vec3 vNormal;
                varying vec3 vPosition;
                varying float vDistance;

                float snoise(vec3 v) {
                    return fract(sin(dot(v, vec3(12.9898, 78.233, 45.164))) * 43758.5453) * 2.0 - 1.0;
                }

                void main() {
                    float distFromCenter = vDistance / starRadius;

                    // Corona density falls off with distance
                    float density = 1.0 / (distFromCenter * distFromCenter);
                    density = clamp(density, 0.0, 1.0);

                    // Streamer structures in corona
                    vec3 pos = normalize(vPosition);
                    float streamers = abs(snoise(pos * 5.0 + time * 0.1));
                    streamers = pow(streamers, 2.0) * 0.5;

                    // Fresnel for edge visibility
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);

                    float alpha = density * fresnel * (0.5 + streamers);
                    alpha = clamp(alpha, 0.0, 0.6);

                    // Corona is slightly cooler/whiter than photosphere
                    vec3 coronaColor = mix(baseColor, vec3(1.0), 0.3);

                    gl_FragColor = vec4(coronaColor, alpha);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const innerCorona = new THREE.Mesh(innerCoronaGeo, innerCoronaMat);
        this.mesh.add(innerCorona);
        this.coronaLayers.push({ mesh: innerCorona, uniforms: innerCoronaUniforms });

        // Outer glow: smooth radial-gradient sprites instead of nested solid
        // spheres — sphere shells render as visible concentric circles ("onion
        // rings"), a gradient falls off like a real photographed corona.
        const makeGlowTexture = () => {
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const g = c.getContext('2d');
            const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
            grad.addColorStop(0.0, 'rgba(255,255,255,0.9)');
            grad.addColorStop(0.08, 'rgba(255,250,240,0.55)');
            grad.addColorStop(0.25, 'rgba(255,240,220,0.18)');
            grad.addColorStop(0.55, 'rgba(255,230,200,0.05)');
            grad.addColorStop(1.0, 'rgba(255,220,180,0)');
            g.fillStyle = grad;
            g.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(c);
        };
        const glowTex = makeGlowTexture();
        const coronaSizes = [5.0, 11.0];
        const coronaOpacities = [0.55, 0.18];

        coronaSizes.forEach((size, i) => {
            const mat = new THREE.SpriteMaterial({
                map: glowTex,
                color: this.actualColor,
                transparent: true,
                opacity: coronaOpacities[i] * Math.min(1, this.luminosity / 8),
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const corona = new THREE.Sprite(mat);
            corona.scale.setScalar(this.radius * size);
            corona.userData.baseScale = this.radius * size;
            this.mesh.add(corona);
            this.coronaLayers.push({ mesh: corona });
        });
    }

    _createProminences() {
        this.prominences = [];
        this.prominenceParticles = [];

        // Create prominence particle system
        const particleCount = 2000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const lifetimes = new Float32Array(particleCount);

        const baseColor = new THREE.Color(1.0, 0.4, 0.1); // Orange-red

        for (let i = 0; i < particleCount; i++) {
            // Random position on magnetic loop
            const loopIndex = Math.floor(Math.random() * this.prominenceCount);
            const loopAngle = (loopIndex / this.prominenceCount) * Math.PI * 2;
            const t = Math.random();

            // Arch shape
            const archHeight = this.radius * (0.3 + Math.random() * 0.5);
            const archWidth = this.radius * 0.3;
            const x = Math.cos(loopAngle) * (this.radius + Math.sin(t * Math.PI) * archHeight);
            const y = Math.sin(t * Math.PI) * archHeight;
            const z = Math.sin(loopAngle) * (this.radius + Math.sin(t * Math.PI) * archHeight);

            positions[i * 3] = x + (Math.random() - 0.5) * archWidth;
            positions[i * 3 + 1] = y + (Math.random() - 0.5) * archWidth * 0.5;
            positions[i * 3 + 2] = z + (Math.random() - 0.5) * archWidth;

            colors[i * 3] = baseColor.r * (0.8 + Math.random() * 0.4);
            colors[i * 3 + 1] = baseColor.g * (0.8 + Math.random() * 0.4);
            colors[i * 3 + 2] = baseColor.b * (0.8 + Math.random() * 0.4);

            sizes[i] = 0.05 + Math.random() * 0.1;
            lifetimes[i] = Math.random();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const prominenceMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                starRadius: { value: this.radius }
            },
            vertexShader: `
                attribute float size;
                attribute float lifetime;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float time;
                uniform float starRadius;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif

                    // Animate along magnetic field lines
                    float phase = fract(lifetime + time * 0.2);
                    vAlpha = sin(phase * 3.14159) * 0.8;

                    vec3 pos = position;
                    // Subtle motion along the loop
                    pos.y += sin(time * 2.0 + lifetime * 6.28) * 0.1 * starRadius;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * starRadius * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        this.prominenceSystem = new THREE.Points(geometry, prominenceMaterial);
        this.mesh.add(this.prominenceSystem);
    }

    _createDiffractionSpikes() {
        // Hubble-style 4-point diffraction spikes
        const spikeLength = this.radius * 7;
        const spikeGroup = new THREE.Group();

        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;

            // Main spike with gradient
            const spikeCanvas = document.createElement('canvas');
            spikeCanvas.width = 32;
            spikeCanvas.height = 512;
            const ctx = spikeCanvas.getContext('2d');

            // Create gradient along spike length
            const gradient = ctx.createLinearGradient(16, 0, 16, 512);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            gradient.addColorStop(0.1, 'rgba(255, 250, 240, 0.4)');
            gradient.addColorStop(0.5, 'rgba(255, 240, 220, 0.1)');
            gradient.addColorStop(1, 'rgba(255, 230, 200, 0.0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 32, 512);

            const spikeTexture = new THREE.CanvasTexture(spikeCanvas);

            const spikeMat = new THREE.MeshBasicMaterial({
                map: spikeTexture,
                transparent: true,
                opacity: 0.28 * Math.min(1, this.luminosity / 10),
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const spikeGeo = new THREE.PlaneGeometry(this.radius * 0.09, spikeLength);
            const spike = new THREE.Mesh(spikeGeo, spikeMat);
            spike.rotation.z = angle;
            spike.position.z = 0.1;

            spikeGroup.add(spike);
        }

        this.mesh.add(spikeGroup);
        this.diffractionSpikes = spikeGroup;
    }

    _createLensFlare() {
        // Cinematic lens flare with anamorphic streak
        this.flareElements = [];

        const flareColors = [
            { color: 0xffffff, size: 0.6, distance: 0, opacity: 0.45 },
            { color: 0xffffaa, size: 0.25, distance: 0.3, opacity: 0.25 },
            { color: 0xffaa66, size: 0.18, distance: 0.6, opacity: 0.15 },
            { color: 0x6688ff, size: 0.12, distance: 1.0, opacity: 0.1 }
        ];

        flareColors.forEach(flare => {
            const geo = new THREE.CircleGeometry(this.radius * flare.size, 32);
            const mat = new THREE.MeshBasicMaterial({
                color: flare.color,
                transparent: true,
                opacity: flare.opacity * Math.min(1, this.luminosity / 10),
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const flareMesh = new THREE.Mesh(geo, mat);
            flareMesh.position.z = this.radius * flare.distance;
            this.mesh.add(flareMesh);
            this.flareElements.push(flareMesh);
        });

        // ANAMORPHIC LENS STREAK - horizontal blue streak (movie signature look)
        if (this.luminosity > 3) {
            const streakCanvas = document.createElement('canvas');
            streakCanvas.width = 1024;
            streakCanvas.height = 64;
            const ctx = streakCanvas.getContext('2d');

            // Horizontal gradient streak
            const grad = ctx.createLinearGradient(0, 32, 1024, 32);
            grad.addColorStop(0, 'rgba(100, 160, 255, 0)');
            grad.addColorStop(0.2, 'rgba(120, 180, 255, 0.15)');
            grad.addColorStop(0.35, 'rgba(150, 200, 255, 0.4)');
            grad.addColorStop(0.5, 'rgba(200, 230, 255, 0.8)');
            grad.addColorStop(0.65, 'rgba(150, 200, 255, 0.4)');
            grad.addColorStop(0.8, 'rgba(120, 180, 255, 0.15)');
            grad.addColorStop(1, 'rgba(100, 160, 255, 0)');
            ctx.fillStyle = grad;

            // Vertical gaussian falloff
            const vGrad = ctx.createLinearGradient(512, 0, 512, 64);
            vGrad.addColorStop(0, 'rgba(255,255,255,0)');
            vGrad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
            vGrad.addColorStop(0.5, 'rgba(255,255,255,1)');
            vGrad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
            vGrad.addColorStop(1, 'rgba(255,255,255,0)');

            ctx.fillRect(0, 0, 1024, 64);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = vGrad;
            ctx.fillRect(0, 0, 1024, 64);

            const streakTexture = new THREE.CanvasTexture(streakCanvas);
            const streakMat = new THREE.SpriteMaterial({
                map: streakTexture,
                blending: THREE.AdditiveBlending,
                transparent: true,
                opacity: 0.35 * Math.min(1, this.luminosity / 8),
                depthWrite: false
            });

            const streak = new THREE.Sprite(streakMat);
            streak.scale.set(this.radius * 25, this.radius * 1.5, 1);
            this.mesh.add(streak);
            this.anamorphicStreak = streak;
        }
    }

    // Improved blackbody temperature to color
    _temperatureToColor(temp) {
        temp = Math.max(1000, Math.min(40000, temp));
        let r, g, b;

        // More accurate blackbody approximation
        if (temp <= 6600) {
            r = 1.0;
            g = Math.max(0, Math.min(1, 0.39 * Math.log(temp / 100) - 0.634));
            if (temp <= 1900) {
                b = 0;
            } else {
                b = Math.max(0, Math.min(1, 0.543 * Math.log(temp / 100 - 10) - 1.196));
            }
        } else {
            r = Math.max(0, Math.min(1, 1.292 * Math.pow(temp / 100 - 60, -0.133)));
            g = Math.max(0, Math.min(1, 1.130 * Math.pow(temp / 100 - 60, -0.0755)));
            b = 1.0;
        }

        // Apply gamma correction for more natural appearance
        r = Math.pow(r, 0.8);
        g = Math.pow(g, 0.8);
        b = Math.pow(b, 0.8);

        return new THREE.Color(r, g, b);
    }

    update(deltaTime, rendererCore) {
        // Close-range solar weather: prominences, solar wind, and CMEs read as a
        // glittery gold disc from across the system — only show them up close,
        // where they actually look like the SDO footage they're modeled on.
        if (rendererCore?.camera && this.mesh) {
            const camDist = rendererCore.camera.position.distanceTo(this.mesh.position);
            const close = camDist < this.radius * 6;
            if (this.prominenceSystem) this.prominenceSystem.visible = close;
            if (this.solarWindParticles) this.solarWindParticles.visible = close;
            if (this.cmeSystem) this.cmeSystem.visible = close;
        }

        this.time += deltaTime;

        // Rotate core with differential rotation (equator faster than poles)
        if (this.core) {
            this.core.rotation.y += this.rotationSpeed * deltaTime;

            // Update plasma shader
            if (this.surfaceUniforms) {
                this.surfaceUniforms.time.value = this.time;
            }
        }

        // Update chromosphere
        if (this.chromosphere && this.chromosphere.material.uniforms) {
            this.chromosphere.material.uniforms.time.value = this.time;
            this.chromosphere.rotation.y = this.core.rotation.y * 0.98; // Slightly slower
        }

        // Update corona
        this.coronaLayers.forEach((layer, i) => {
            if (layer.uniforms) {
                layer.uniforms.time.value = this.time;
            }
            // Subtle pulsing (sprites carry their size in scale, spheres in geometry)
            const pulse = 1 + Math.sin(this.time * (0.2 + i * 0.1)) * 0.02;
            layer.mesh.scale.setScalar((layer.mesh.userData.baseScale || 1) * pulse);
        });

        // Update prominences
        if (this.prominenceSystem) {
            this.prominenceSystem.material.uniforms.time.value = this.time;
            this.prominenceSystem.rotation.y += deltaTime * 0.01;
        }

        // Update Coronal Mass Ejections
        if (this.cmeSystem) {
            this.cmeSystem.material.uniforms.time.value = this.time;

            // Animate CME particles
            const positions = this.cmeSystem.geometry.attributes.position.array;
            const velocities = this.cmeSystem.geometry.attributes.velocity.array;
            const lifetimes = this.cmeSystem.geometry.attributes.lifetime.array;

            for (let i = 0; i < lifetimes.length; i++) {
                if (lifetimes[i] >= 0 && lifetimes[i] < 1) {
                    // Update position
                    positions[i * 3] += velocities[i * 3] * deltaTime * this.radius;
                    positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime * this.radius;
                    positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime * this.radius;

                    // Age particle
                    lifetimes[i] += deltaTime * 0.1;

                    // Deactivate if too old
                    if (lifetimes[i] >= 1) {
                        lifetimes[i] = -1;
                    }
                }
            }

            this.cmeSystem.geometry.attributes.position.needsUpdate = true;
            this.cmeSystem.geometry.attributes.lifetime.needsUpdate = true;

            // Random CME events based on activity level
            if (this.hasCoronalMassEjections && this.time - this.lastCMETime > 30 / this.activityLevel) {
                if (Math.random() < this.activityLevel * 0.02) {
                    this._triggerCME();
                    this.lastCMETime = this.time;
                }
            }
        }

        // Update solar wind
        if (this.solarWindParticles && this.solarWindParticles.material.uniforms) {
            this.solarWindParticles.material.uniforms.time.value = this.time;
        }

        // Diffraction spikes are a CAMERA artifact, so they must billboard —
        // otherwise the flat planes read as gray bars from oblique angles
        if (this.diffractionSpikes) {
            if (rendererCore?.camera) {
                this.diffractionSpikes.quaternion.copy(rendererCore.camera.quaternion);
            }
        }

        // Animate flare elements
        this.flareElements.forEach((flare, i) => {
            const pulse = 1 + Math.sin(this.time * 3 + i * 2) * 0.1;
            flare.scale.setScalar(pulse);
        });
    }

    dispose() {
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
    }
}
