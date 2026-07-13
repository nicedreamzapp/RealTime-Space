// Planet.js - HUBBLE/JAMES WEBB quality photorealistic planet rendering
// Implements true NASA/ESA imaging quality with auroras, volcanic activity, ice caps,
// realistic atmospheric scattering, and procedural terrain generation

// Shared GLSL: soft eclipse shadows cast by spherical occluders (moons/planets) and
// ring-plane shadows (Saturn's rings on the planet). The penumbra is approximated by
// comparing the angular radii of the sun and occluder discs as seen from the fragment.
const ECLIPSE_SHADOW_GLSL = `
    uniform vec3 uSunPos;
    uniform float uSunRadius;
    uniform vec4 uOccluders[4];
    uniform int uOccluderCount;

    float occluderShadow(vec3 P, vec4 occ) {
        vec3 toSun = uSunPos - P;
        float dSun = length(toSun);
        vec3 L = toSun / dSun;
        vec3 toOcc = occ.xyz - P;
        float dOcc = length(toOcc);
        if (dOcc > dSun) return 1.0;        // occluder is farther than the sun
        if (dOcc < occ.w * 1.05) return 1.0; // fragment is on/in the occluder itself
        float aSun = asin(clamp(uSunRadius / dSun, 0.0, 1.0));
        float aOcc = asin(clamp(occ.w / dOcc, 0.0, 1.0));
        float sep  = acos(clamp(dot(L, toOcc / dOcc), -1.0, 1.0));
        float f = clamp((aOcc + aSun - sep) / max(2.0 * aSun, 1e-4), 0.0, 1.0);
        f = f * f * (3.0 - 2.0 * f);
        return 1.0 - f;
    }

    float eclipseShadow(vec3 P) {
        float s = 1.0;
        for (int i = 0; i < 4; i++) {
            if (i >= uOccluderCount) break;
            s *= occluderShadow(P, uOccluders[i]);
        }
        return s;
    }
`;

const RING_SHADOW_GLSL = `
    uniform sampler2D uRingMap;
    uniform vec3 uRingCenter;
    uniform vec3 uRingNormal;
    uniform vec2 uRingRadii; // x: inner, y: outer (world units)

    float ringShadow(vec3 P) {
        vec3 L = normalize(uSunPos - P);
        float denom = dot(L, uRingNormal);
        if (abs(denom) < 1e-4) return 1.0;
        float t = dot(uRingCenter - P, uRingNormal) / denom;
        if (t <= 0.0) return 1.0; // sun ray doesn't cross the ring plane
        vec3 hit = P + L * t;
        float r = length(hit - uRingCenter);
        if (r < uRingRadii.x || r > uRingRadii.y) return 1.0;
        float u = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
        float a = texture2D(uRingMap, vec2(u, 0.5)).a;
        return 1.0 - a * 0.88;
    }
`;

const _planetTmpVec = new THREE.Vector3();
const _planetTmpQuat = new THREE.Quaternion();
const _planetSunOrigin = new THREE.Vector3(0, 0, 0);

class Planet {
    constructor(config = {}) {
        this.name = config.name || "Planet";
        this.radius = config.radius || 1.0;
        this.color = config.color || 0x4a90e2;
        this.position = config.position || { x: 0, y: 0, z: 0 };
        this.hasAtmosphere = config.hasAtmosphere !== false;
        this.atmosphereColor = config.atmosphereColor || 0x88ccff;
        this.atmosphereDensity = config.atmosphereDensity || 1.0;
        this.orbitalData = config.orbitalData || null;
        this.rotationPeriod = config.rotationPeriod || 24;
        this.type = "planet";
        this.planetType = config.planetType || "rocky";
        this.hasRings = config.hasRings || false;
        this.hasClouds = config.hasClouds || (this.planetType === "rocky" && this.hasAtmosphere);
        this.seed = config.seed || Math.random() * 10000;

        // New advanced features
        this.hasAurora = config.hasAurora || false; // opt-in only: the torus auroras read as green donuts on real planets
        this.hasVolcanicActivity = config.hasVolcanicActivity || (this.planetType === "rocky" && Math.random() > 0.7);
        this.hasIceCaps = config.hasIceCaps || (this.planetType === "rocky" && Math.random() > 0.4);
        this.hasCities = config.hasCities || false; // Night-side city lights
        this.oceanLevel = config.oceanLevel || 0.4;
        this.axialTilt = config.axialTilt || Math.random() * 0.5; // Radians
        this.magneticFieldStrength = config.magneticFieldStrength || (this.hasAurora ? 0.5 + Math.random() * 0.5 : 0);
        this.texturePack = config.texturePack || null;

        // Terrain features
        this.terrainConfig = {
            mountainHeight: 0.15 + Math.random() * 0.2,
            craterDensity: this.planetType === "rocky" ? 0.1 + Math.random() * 0.3 : 0,
            continentalDrift: Math.random(),
            vegetationLevel: this.hasAtmosphere ? 0.3 + Math.random() * 0.5 : 0,
            desertLevel: 0.1 + Math.random() * 0.3
        };

        this.time = 0;
        this.uniforms = {};

        // Eclipse-shadow state: occluders are other bodies ({mesh, radius}) that can
        // pass between this planet and the sun. Uniforms are shared by reference with
        // every shader this planet owns (surface, Earth shader, rings).
        this._occluders = [];
        this._shadowUniforms = {
            uSunPos: { value: new THREE.Vector3(0, 0, 0) },
            uSunRadius: { value: 15.0 },
            uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
            uOccluderCount: { value: 0 }
        };

        this.createMesh();

        console.log(`🌍 Created HUBBLE-QUALITY planet: ${this.name} (${this.planetType})`);
    }

    // Bodies that can cast shadows onto this planet (e.g. its moons, or its parent).
    setOccluders(list) {
        this._occluders = (list || []).slice(0, 4);
    }

    // Wires soft eclipse shadows (and optionally ring shadows) into a built-in
    // material (MeshStandardMaterial etc.) via onBeforeCompile injection.
    _injectShadows(material, opts = {}) {
        const shadowUniforms = this._shadowUniforms;
        const ringUniforms = opts.ringUniforms || null;

        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, shadowUniforms);
            let head = ECLIPSE_SHADOW_GLSL;
            let apply = 'float planetShadow = eclipseShadow(vEclipseWorldPos);\n';
            if (ringUniforms) {
                Object.assign(shader.uniforms, ringUniforms);
                head += RING_SHADOW_GLSL;
                apply += 'planetShadow *= ringShadow(vEclipseWorldPos);\n';
            }
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vEclipseWorldPos;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEclipseWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vEclipseWorldPos;\n' + head)
                .replace('#include <output_fragment>', apply + 'outgoingLight *= mix(0.04, 1.0, planetShadow);\n#include <output_fragment>');
        };
        material.customProgramCacheKey = () => 'planet-shadow' + (ringUniforms ? '-ring' : '');
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        const segments = this.texturePack ? 256 : (this.radius > 2 ? 128 : 64);

        if (this.texturePack === "earth") {
            this._createPhotorealEarth(segments);
        } else if (this.texturePack) {
            // Generic photoreal path: real color map, optional bump, MeshStandardMaterial.
            // Gas/ice giants get matching texture pack (Jupiter bands, Saturn, etc).
            this._createTexturedPlanet(segments);
        } else if (this.planetType === "gas") {
            this._createGasGiant(segments);
        } else if (this.planetType === "ice") {
            this._createIcePlanet(segments);
        } else {
            this._createRockyPlanet(segments);
        }

        if (this.hasAtmosphere) {
            this._createRealisticAtmosphere();
        }

        if (this.hasClouds && this.planetType === "rocky") {
            this._createCloudLayer();
        }

        if (this.hasRings) {
            this._createRings();
        }

        // Aurora effects for magnetic planets
        if (this.hasAurora && this.hasAtmosphere) {
            this._createAurora();
        }

        // Night-side city lights (for advanced civilizations)
        if (this.hasCities) {
            this._createCityLights();
        }
    }

    _createAurora() {
        // Northern and Southern aurora borealis/australis
        const auroraColors = [
            new THREE.Color(0x00ff66), // Green oxygen
            new THREE.Color(0xff3366), // Red oxygen
            new THREE.Color(0x6666ff), // Blue nitrogen
            new THREE.Color(0xff66ff)  // Purple nitrogen
        ];

        ['north', 'south'].forEach((pole, poleIndex) => {
            const auroraGeo = new THREE.TorusGeometry(
                this.radius * 0.3,  // Ring radius at pole
                this.radius * 0.15, // Tube radius
                16, 64
            );

            const auroraMat = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    color1: { value: auroraColors[0] },
                    color2: { value: auroraColors[2] },
                    intensity: { value: this.magneticFieldStrength }
                },
                vertexShader: `
                    varying vec3 vPosition;
                    varying vec3 vNormal;
                    varying vec2 vUv;
                    uniform float time;

                    void main() {
                        vPosition = position;
                        vNormal = normal;
                        vUv = uv;

                        // Wavy curtain motion
                        vec3 pos = position;
                        float wave = sin(pos.x * 5.0 + time * 2.0) * 0.05;
                        wave += sin(pos.z * 3.0 + time * 1.5) * 0.03;
                        pos.y += wave;

                        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform vec3 color1;
                    uniform vec3 color2;
                    uniform float intensity;
                    varying vec3 vPosition;
                    varying vec3 vNormal;
                    varying vec2 vUv;

                    float noise(vec2 p) {
                        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
                    }

                    void main() {
                        // Curtain-like vertical stripes
                        float curtain = sin(vUv.x * 30.0 + time) * 0.5 + 0.5;
                        curtain *= sin(vUv.x * 60.0 - time * 0.5) * 0.5 + 0.5;

                        // Flickering noise
                        float flicker = noise(vUv * 10.0 + time * 0.1);
                        flicker = pow(flicker, 2.0);

                        // Vertical fade (stronger at bottom of curtain)
                        float verticalFade = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.5, vUv.y);

                        // Color mixing with shimmer
                        vec3 auroraColor = mix(color1, color2, curtain + flicker * 0.3);

                        // Shimmer effect
                        float shimmer = sin(time * 10.0 + vUv.x * 100.0) * 0.1 + 0.9;

                        float alpha = curtain * verticalFade * intensity * shimmer * 0.6;
                        alpha *= (0.5 + flicker * 0.5);

                        gl_FragColor = vec4(auroraColor * 1.5, alpha);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const aurora = new THREE.Mesh(auroraGeo, auroraMat);

            // Position at poles
            aurora.rotation.x = Math.PI / 2;
            aurora.position.y = (poleIndex === 0 ? 1 : -1) * this.radius * 0.85;

            // Apply axial tilt
            aurora.rotation.z = this.axialTilt;

            aurora.userData.isAurora = true;
            this.mesh.add(aurora);
        });

        // Store reference for animation
        this.auroras = this.mesh.children.filter(c => c.userData.isAurora);
    }

    _createCityLights() {
        // Procedural city lights visible on night side
        const cityGeo = new THREE.SphereGeometry(this.radius * 1.002, 128, 64);

        // Generate city light texture
        const canvas = document.createElement('canvas');
        canvas.width = 2048;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');

        // Dark background
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 2048, 1024);

        // Generate city clusters on landmasses
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * 2048;
            const y = Math.random() * 1024;

            // Avoid oceans (rough approximation using noise)
            const u = x / 2048;
            const v = y / 1024;
            const isLand = this._noise2D(u * 10 + this.seed, v * 10) > -0.2;

            if (isLand) {
                // City cluster
                const clusterSize = 5 + Math.random() * 20;
                const brightness = 150 + Math.random() * 105;

                ctx.fillStyle = `rgba(255, ${brightness + 50}, ${brightness - 30}, 1)`;
                ctx.beginPath();
                ctx.arc(x, y, clusterSize, 0, Math.PI * 2);
                ctx.fill();

                // Smaller surrounding lights
                for (let j = 0; j < 10; j++) {
                    const ox = x + (Math.random() - 0.5) * clusterSize * 4;
                    const oy = y + (Math.random() - 0.5) * clusterSize * 4;
                    ctx.fillStyle = `rgba(255, ${brightness}, ${brightness - 50}, ${0.3 + Math.random() * 0.7})`;
                    ctx.beginPath();
                    ctx.arc(ox, oy, 1 + Math.random() * 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        const cityTexture = new THREE.CanvasTexture(canvas);
        cityTexture.wrapS = THREE.RepeatWrapping;

        const cityMat = new THREE.ShaderMaterial({
            uniforms: {
                cityMap: { value: cityTexture },
                sunDirection: { value: new THREE.Vector3(1, 0, 0) }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;

                void main() {
                    vUv = uv;
                    vNormal = normal;
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D cityMap;
                uniform vec3 sunDirection;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;

                void main() {
                    vec4 cityLight = texture2D(cityMap, vUv);

                    // Only visible on night side
                    float daylight = dot(vWorldNormal, sunDirection);
                    float nightFactor = smoothstep(-0.2, -0.4, daylight);

                    // Twinkle effect
                    float twinkle = 0.8 + sin(vUv.x * 1000.0) * 0.2;

                    vec3 finalColor = cityLight.rgb * nightFactor * twinkle * 2.0;
                    float alpha = cityLight.r * nightFactor * 0.8;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.cityLights = new THREE.Mesh(cityGeo, cityMat);
        this.mesh.add(this.cityLights);
    }

    // Generate procedural terrain texture
    _generateTerrainTexture(size = 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size / 2;
        const ctx = canvas.getContext('2d');

        // Base color from planet config
        const baseColor = new THREE.Color(this.color);
        const r = Math.floor(baseColor.r * 255);
        const g = Math.floor(baseColor.g * 255);
        const b = Math.floor(baseColor.b * 255);

        // Generate terrain using multiple noise octaves
        const imageData = ctx.createImageData(size, size / 2);
        const data = imageData.data;

        for (let y = 0; y < size / 2; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;

                // Spherical coordinates for seamless wrapping
                const u = x / size;
                const v = y / (size / 2);
                const theta = u * Math.PI * 2;
                const phi = v * Math.PI;

                // 3D position on sphere for noise
                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.sin(phi) * Math.sin(theta);
                const nz = Math.cos(phi);

                // Multi-octave noise for terrain
                let elevation = 0;
                let amplitude = 1;
                let frequency = 2;
                let maxValue = 0;

                for (let oct = 0; oct < 8; oct++) {
                    elevation += this._noise3D(
                        nx * frequency + this.seed,
                        ny * frequency + this.seed * 0.7,
                        nz * frequency + this.seed * 0.3
                    ) * amplitude;
                    maxValue += amplitude;
                    amplitude *= 0.5;
                    frequency *= 2.1;
                }
                elevation /= maxValue;
                elevation = (elevation + 1) / 2; // Normalize to 0-1

                // Color variation based on elevation
                let cr, cg, cb;

                if (this.planetType === "rocky") {
                    // Earth-like coloring - vibrant, lifelike palette
                    if (elevation < 0.35) {
                        // Deep ocean - rich deep blue
                        cr = r * 0.1; cg = g * 0.2; cb = b * 0.85;
                    } else if (elevation < 0.4) {
                        // Shallow water - turquoise tint
                        cr = r * 0.25; cg = g * 0.55; cb = b * 1.0;
                    } else if (elevation < 0.45) {
                        // Beach/coast - warm sand
                        cr = 230; cg = 210; cb = 155;
                    } else if (elevation < 0.6) {
                        // Lowlands/grass - lush green
                        cr = r * 0.5; cg = g * 1.3; cb = b * 0.35;
                    } else if (elevation < 0.75) {
                        // Hills/forest - deep green
                        cr = r * 0.3; cg = g * 0.8; cb = b * 0.25;
                    } else if (elevation < 0.85) {
                        // Mountains - warm grey-brown
                        cr = 130; cg = 115; cb = 95;
                    } else {
                        // Snow caps - bright white
                        cr = 255; cg = 255; cb = 255;
                    }
                } else {
                    // Mars-like / barren
                    const variation = elevation * 0.4 + 0.6;
                    cr = r * variation;
                    cg = g * variation * 0.9;
                    cb = b * variation * 0.8;
                }

                // Add detail noise for surface texture
                const detail = this._noise3D(
                    nx * 50 + this.seed * 2,
                    ny * 50,
                    nz * 50
                ) * 15;

                data[i] = Math.max(0, Math.min(255, cr + detail));
                data[i + 1] = Math.max(0, Math.min(255, cg + detail));
                data[i + 2] = Math.max(0, Math.min(255, cb + detail));
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = 16;
        return texture;
    }

    // Generate normal map from terrain
    _generateNormalMap(size = 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size / 2;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(size, size / 2);
        const data = imageData.data;

        const strength = 2.0;

        for (let y = 0; y < size / 2; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;

                const u = x / size;
                const v = y / (size / 2);
                const theta = u * Math.PI * 2;
                const phi = v * Math.PI;

                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.sin(phi) * Math.sin(theta);
                const nz = Math.cos(phi);

                // Sample heights for normal calculation
                const delta = 0.01;
                const h = this._getHeight(nx, ny, nz);
                const hx = this._getHeight(nx + delta, ny, nz);
                const hy = this._getHeight(nx, ny + delta, nz);

                // Calculate normal from height differences
                const dx = (hx - h) * strength;
                const dy = (hy - h) * strength;

                // Encode normal in RGB
                data[i] = Math.floor((dx + 1) * 0.5 * 255);
                data[i + 1] = Math.floor((dy + 1) * 0.5 * 255);
                data[i + 2] = 255; // Z always up
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        return texture;
    }

    _getHeight(x, y, z) {
        let h = 0;
        let amp = 1;
        let freq = 2;
        for (let i = 0; i < 6; i++) {
            h += this._noise3D(x * freq + this.seed, y * freq, z * freq) * amp;
            amp *= 0.5;
            freq *= 2;
        }
        return h;
    }

    // Generate roughness map
    _generateRoughnessMap(size = 512) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size / 2;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(size, size / 2);
        const data = imageData.data;

        for (let y = 0; y < size / 2; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const u = x / size;
                const v = y / (size / 2);

                // Variation in roughness
                const noise = this._noise2D(u * 20 + this.seed, v * 20) * 0.3 + 0.7;
                const value = Math.floor(noise * 255);

                data[i] = value;
                data[i + 1] = value;
                data[i + 2] = value;
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        return texture;
    }

    // Real-texture registry. Paths are relative to index.html in the app bundle.
    static get TEXTURE_REGISTRY() {
        return {
            mercury: { color: 'textures/mercury/mercury_color.jpg',  bump: 'textures/mercury/mercury_bump.jpg',  bumpScale: 0.05, roughness: 0.95, metalness: 0.0 },
            venus:   { color: 'textures/venus/venus_color.jpg',      bump: 'textures/venus/venus_bump.jpg',      bumpScale: 0.04, roughness: 0.85, metalness: 0.0 },
            mars:    { color: 'textures/mars/mars_color_1k.jpg',     bump: 'textures/mars/mars_bump_1k.jpg',     bumpScale: 0.06, roughness: 0.92, metalness: 0.0 },
            jupiter: { color: 'textures/jupiter/jupiter_4k.jpg',     bump: null,                                  bumpScale: 0,    roughness: 0.6,  metalness: 0.0 },
            saturn:  { color: 'textures/saturn/saturn_4k.jpg',       bump: null,                                  bumpScale: 0,    roughness: 0.6,  metalness: 0.0,
                       ringColor: 'textures/saturn/saturn_ring_alpha.png', ringPattern: null,
                       ringInner: 1.24, ringOuter: 2.27, ringShadow: true },
            uranus:  { color: 'textures/uranus/uranus_2k.jpg',       bump: null,                                  bumpScale: 0,    roughness: 0.5,  metalness: 0.0,
                       ringColor: 'textures/uranus/uranus_ring_color.jpg', ringPattern: 'textures/uranus/uranus_ring_trans.gif',
                       ringInner: 1.6, ringOuter: 2.0 },
            neptune: { color: 'textures/neptune/neptune_2k.jpg',     bump: null,                                  bumpScale: 0,    roughness: 0.5,  metalness: 0.0 },
            moon:    { color: 'textures/moon/moon_color_1k.jpg',     bump: 'textures/moon/moon_bump_1k.jpg',     bumpScale: 0.06, roughness: 0.95, metalness: 0.0 },
            pluto:   { color: 'textures/pluto/pluto_color_1k.jpg',   bump: 'textures/pluto/pluto_bump_1k.jpg',   bumpScale: 0.04, roughness: 0.9,  metalness: 0.0 }
        };
    }

    _createTexturedPlanet(segments) {
        const reg = Planet.TEXTURE_REGISTRY[this.texturePack];
        if (!reg) {
            console.warn(`Unknown texturePack '${this.texturePack}', falling back to procedural`);
            this._createRockyPlanet(segments);
            return;
        }

        const geometry = new THREE.SphereGeometry(this.radius, segments, Math.max(64, segments / 2));
        const loader = new THREE.TextureLoader();

        const colorMap = loader.load(reg.color,
            () => console.log(`🪐 ${this.name} color loaded`),
            undefined,
            (err) => console.warn(`${this.name} color load failed:`, err));
        if (THREE.SRGBColorSpace !== undefined) colorMap.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding !== undefined) colorMap.encoding = THREE.sRGBEncoding;
        colorMap.anisotropy = 16;

        const matOptions = {
            map: colorMap,
            roughness: reg.roughness,
            metalness: reg.metalness,
            envMapIntensity: 0.5
        };

        if (reg.bump) {
            const bumpMap = loader.load(reg.bump);
            bumpMap.anisotropy = 16;
            matOptions.bumpMap = bumpMap;
            matOptions.bumpScale = reg.bumpScale;
        }

        const material = new THREE.MeshStandardMaterial(matOptions);

        // Eclipse shadows from moons/parents; Saturn additionally gets its rings'
        // shadow band projected onto the cloud tops.
        let ringShadowUniforms = null;
        if (reg.ringShadow && reg.ringColor) {
            const ringTex = new THREE.TextureLoader().load(reg.ringColor);
            ringTex.anisotropy = 16;
            ringShadowUniforms = {
                uRingMap: { value: ringTex },
                uRingCenter: { value: new THREE.Vector3() },
                uRingNormal: { value: new THREE.Vector3(0, 1, 0) },
                uRingRadii: { value: new THREE.Vector2(this.radius * (reg.ringInner || 1.4), this.radius * (reg.ringOuter || 2.5)) }
            };
            this._ringShadowUniforms = ringShadowUniforms;
        }
        this._injectShadows(material, { ringUniforms: ringShadowUniforms });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);

        // Progressive detail (Jupiter/Saturn): swap the color map to a real 4K photo when
        // close, dispose it when far — same anti-jetsam approach as Earth.
        this._texMaterial = material;
        this._texLowColor = colorMap;
        this._texHiColor = null;
        this._texDetail = 'low';
        this._texHiLoading = false;

        // Override hasRings flag with the texture-based ring renderer
        if (reg.ringColor) {
            this._createTexturedRings(reg);
            this.hasRings = false; // Suppress procedural rings later in createMesh
        }
    }

    // Physically-lit ring system: sunlit face, translucent backlighting, and the
    // planet's own shadow sweeping across the ring plane. Replaces the old unlit
    // MeshBasicMaterial rings that looked pasted-on.
    _createTexturedRings(reg) {
        const innerRadius = this.radius * (reg.ringInner || 1.4);
        const outerRadius = this.radius * (reg.ringOuter || 2.5);
        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 256, 8);

        // Remap UVs so the ring texture is sampled radially (1D gradient across the ring's width)
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i);
            const r = Math.sqrt(x * x + y * y);
            const t = (r - innerRadius) / (outerRadius - innerRadius);
            uv.setXY(i, t, 0.5);
        }
        uv.needsUpdate = true;

        const loader = new THREE.TextureLoader();
        const ringColor = loader.load(reg.ringColor);
        if (THREE.SRGBColorSpace !== undefined) ringColor.colorSpace = THREE.SRGBColorSpace;
        else if (THREE.sRGBEncoding !== undefined) ringColor.encoding = THREE.sRGBEncoding;
        ringColor.anisotropy = 16;

        const ringUniforms = {
            uMap: { value: ringColor },
            uAlphaMap: { value: null },
            uUseAlphaMap: { value: 0.0 },
            uSunPos: this._shadowUniforms.uSunPos,
            uSunRadius: this._shadowUniforms.uSunRadius,
            uPlanetCenter: { value: new THREE.Vector3() },
            uPlanetRadius: { value: this.radius },
            uOpacity: { value: 1.0 }
        };

        // Optional separate alpha pattern (Uranus uses a transparency gif; the new
        // Saturn ring PNG carries its own alpha channel)
        if (reg.ringPattern) {
            const ringPattern = loader.load(reg.ringPattern);
            ringUniforms.uAlphaMap.value = ringPattern;
            ringUniforms.uUseAlphaMap.value = 1.0;
        }

        const ringMat = new THREE.ShaderMaterial({
            uniforms: ringUniforms,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;
                void main() {
                    vUv = uv;
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform sampler2D uMap;
                uniform sampler2D uAlphaMap;
                uniform float uUseAlphaMap;
                uniform vec3 uSunPos;
                uniform float uSunRadius;
                uniform vec3 uPlanetCenter;
                uniform float uPlanetRadius;
                uniform float uOpacity;
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vWorldNormal;

                // Soft shadow of the planet's disc on the ring plane
                float planetShadow(vec3 P) {
                    vec3 toSun = uSunPos - P;
                    float dSun = length(toSun);
                    vec3 L = toSun / dSun;
                    vec3 toOcc = uPlanetCenter - P;
                    float dOcc = length(toOcc);
                    if (dOcc > dSun) return 1.0;
                    float aSun = asin(clamp(uSunRadius / dSun, 0.0, 1.0));
                    float aOcc = asin(clamp(uPlanetRadius / dOcc, 0.0, 1.0));
                    float sep  = acos(clamp(dot(L, toOcc / dOcc), -1.0, 1.0));
                    float f = clamp((aOcc + aSun - sep) / max(2.0 * aSun, 1e-4), 0.0, 1.0);
                    f = f * f * (3.0 - 2.0 * f);
                    return 1.0 - f * 0.97;
                }

                void main() {
                    vec4 c = texture2D(uMap, vUv);
                    float alpha = c.a;
                    if (uUseAlphaMap > 0.5) {
                        alpha = texture2D(uAlphaMap, vUv).g;
                    }
                    if (alpha < 0.003) discard;

                    vec3 N = normalize(vWorldNormal);
                    vec3 toSun = uSunPos - vWorldPos;
                    vec3 L = normalize(toSun);
                    vec3 V = normalize(cameraPosition - vWorldPos);

                    float ndl = dot(N, L);
                    float lit = clamp(ndl, 0.0, 1.0) + clamp(-ndl, 0.0, 1.0); // |ndl|
                    bool viewingLitFace = (dot(N, V) * ndl) > 0.0;

                    // Lit face: full diffuse. Unlit face: dimmer, mostly light
                    // filtering through the ring particles (translucency).
                    float light = viewingLitFace ? (0.05 + lit * 1.05)
                                                 : (0.05 + lit * 0.45);

                    float sh = planetShadow(vWorldPos);
                    vec3 color = c.rgb * light * sh;

                    gl_FragColor = vec4(color, alpha * uOpacity);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.rings = new THREE.Mesh(ringGeo, ringMat);
        this.rings.rotation.x = Math.PI / 2 + 0.4; // Tilted rings (Saturn)
        this._ringLightUniforms = ringUniforms;
        this.mesh.add(this.rings);
    }

    // PHOTOREAL EARTH - real NASA Blue Marble (daymap) + Black Marble (city lights)
    // Custom shader handles day/night terminator, sunset rim, and water specular highlight.
    _createPhotorealEarth(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, Math.max(64, segments / 2));
        const loader = new THREE.TextureLoader();

        const dayMap = loader.load(
            'textures/earth/earth_daymap_8k.jpg',
            () => console.log('🌍 Earth daymap loaded (8K NASA Blue Marble)'),
            undefined,
            (err) => console.warn('Earth daymap load failed:', err)
        );
        const nightMap = loader.load(
            'textures/earth/earth_nightmap_8k.jpg',
            () => console.log('🌃 Earth nightmap loaded (8K NASA Black Marble)'),
            undefined,
            (err) => console.warn('Earth nightmap load failed:', err)
        );

        const elevMap = loader.load(
            'textures/earth/earth_elevation_8k.png',
            () => console.log('⛰️ Earth elevation loaded (8K) — terrain relief active'),
            undefined,
            (err) => console.warn('Earth elevation load failed:', err)
        );

        if (THREE.SRGBColorSpace !== undefined) {
            dayMap.colorSpace = THREE.SRGBColorSpace;
            nightMap.colorSpace = THREE.SRGBColorSpace;
        } else if (THREE.sRGBEncoding !== undefined) {
            dayMap.encoding = THREE.sRGBEncoding;
            nightMap.encoding = THREE.sRGBEncoding;
        }
        dayMap.anisotropy = 16;
        nightMap.anisotropy = 16;
        elevMap.anisotropy = 16;

        this.uniforms.earth = {
            dayMap: { value: dayMap },
            nightMap: { value: nightMap },
            elevMap: { value: elevMap },
            elevTexel: { value: new THREE.Vector2(1 / 8192, 1 / 4096) },
            bumpStrength: { value: 14.0 },
            sunDirection: { value: new THREE.Vector3(1, 0, 0) },
            // shared eclipse-shadow uniforms (moon transits → solar eclipse spot)
            uSunPos: this._shadowUniforms.uSunPos,
            uSunRadius: this._shadowUniforms.uSunRadius,
            uOccluders: this._shadowUniforms.uOccluders,
            uOccluderCount: this._shadowUniforms.uOccluderCount
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms.earth,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormalWorld;
                varying vec3 vTangentWorld;
                varying vec3 vBitangentWorld;
                varying vec3 vWorldPosition;
                void main() {
                    vUv = uv;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vNormalWorld = normalize(mat3(modelMatrix) * normal);
                    // Sphere tangent frame: tangent points east (+lon), bitangent north
                    vec3 objTangent = normalize(vec3(-position.z, 0.0, position.x));
                    vTangentWorld = normalize(mat3(modelMatrix) * objTangent);
                    vBitangentWorld = normalize(cross(vNormalWorld, vTangentWorld));
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform sampler2D dayMap;
                uniform sampler2D nightMap;
                uniform sampler2D elevMap;
                uniform vec2 elevTexel;
                uniform float bumpStrength;
                uniform vec3 sunDirection;
                varying vec2 vUv;
                varying vec3 vNormalWorld;
                varying vec3 vTangentWorld;
                varying vec3 vBitangentWorld;
                varying vec3 vWorldPosition;

                ${ECLIPSE_SHADOW_GLSL}

                void main() {
                    vec3 dayColor   = texture2D(dayMap, vUv).rgb;
                    vec3 nightColor = texture2D(nightMap, vUv).rgb;

                    // Perturb the normal with the NASA elevation map so mountain
                    // ranges throw relief shadows along the terminator
                    float h  = texture2D(elevMap, vUv).r;
                    float hU = texture2D(elevMap, vUv + vec2(elevTexel.x, 0.0)).r;
                    float hV = texture2D(elevMap, vUv + vec2(0.0, elevTexel.y)).r;
                    vec3 N = normalize(
                        normalize(vNormalWorld)
                        + vTangentWorld   * (h - hU) * bumpStrength
                        + vBitangentWorld * (h - hV) * bumpStrength
                    );

                    vec3 L = normalize(sunDirection);
                    float NdotL = dot(N, L);
                    float NdotLgeo = dot(normalize(vNormalWorld), L);

                    // Smooth terminator over a thin band (real Earth band ~2-3 degrees)
                    float dayMix = smoothstep(-0.15, 0.15, NdotLgeo);

                    // Moon shadow (solar eclipse spot crawling across the surface)
                    float eclipse = eclipseShadow(vWorldPosition);

                    // Day side - lit hemisphere with a tiny ambient floor
                    float diffuse = clamp(NdotL, 0.0, 1.0) * eclipse;
                    vec3 dayLit = dayColor * (0.08 + 0.95 * diffuse);

                    // Night side city lights (only on dark hemisphere)
                    vec3 night = nightColor * 1.6 * (1.0 - dayMix);

                    // Sunset/sunrise rim glow at the terminator
                    float terminator = exp(-pow(NdotLgeo * 7.0, 2.0));
                    vec3 sunsetGlow = vec3(1.0, 0.55, 0.22) * terminator * 0.20 * eclipse;

                    // Water specular - daymap blue channel highlights oceans
                    float blueLead = dayColor.b - max(dayColor.r, dayColor.g) * 0.75;
                    float waterMask = smoothstep(0.0, 0.18, blueLead);
                    vec3 V = normalize(cameraPosition - vWorldPosition);
                    vec3 H = normalize(L + V);
                    float spec = pow(max(dot(N, H), 0.0), 90.0) * waterMask * diffuse * dayMix;
                    vec3 specColor = vec3(0.85, 0.92, 1.0) * spec * 1.4;

                    vec3 finalColor = dayLit * dayMix + night + sunsetGlow + specColor;
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = false;
        this.mesh.add(this.surface);

        // Progressive detail: keep the bundled low-res daymap as the safe default and
        // only swap in the true 8K NASA Blue Marble when the camera is close, disposing
        // it again when you leave — so the heavy texture is never resident at distance
        // (this is what prevents the 8K-memory jetsam the project hit before).
        this._earthLowDay = dayMap;
        this._earthLowNight = nightMap;
        this._earthHiDay = null;
        this._earthHiNight = null;
        this._earthDetail = 'low';
        this._earthHiLoading = false;
    }

    // Swap Earth's day + night maps between bundled low-res and true 8K (NASA Blue Marble +
    // Black Marble city lights). Safe to call every frame; only acts on transitions and never
    // holds the heavy textures while far away — both are disposed when you leave.
    setEarthDetail(high) {
        if (!this.uniforms || !this.uniforms.earth) return;
        this._earthWantsHigh = high;
        const dayU = this.uniforms.earth.dayMap;
        const nightU = this.uniforms.earth.nightMap;
        const setSRGB = (tex) => {
            if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
            else if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = 16;
        };
        if (high) {
            if (this._earthDetail === 'high' || this._earthHiLoading) return;
            this._earthHiLoading = true;
            const loader = new THREE.TextureLoader();
            let pending = 2, bailed = false;
            const done = () => { if (--pending === 0) { this._earthHiLoading = false;
                if (!bailed) { this._earthDetail = 'high'; console.log('🌍 Earth → 8K day + night city lights (up close)'); } } };
            const loadInto = (path, uniform, store) => loader.load(path, (tex) => {
                // camera may have already left while loading — bail and dispose
                if (!this._earthWantsHigh) { tex.dispose(); bailed = true; done(); return; }
                setSRGB(tex); this[store] = tex; uniform.value = tex; done();
            }, undefined, () => { bailed = true; done(); });
            loadInto('textures/earth/earth_daymap_hi.jpg', dayU, '_earthHiDay');
            loadInto('textures/earth/earth_nightmap_hi.jpg', nightU, '_earthHiNight');
        } else {
            if (this._earthDetail === 'low') return;
            dayU.value = this._earthLowDay;
            nightU.value = this._earthLowNight;
            this._earthDetail = 'low';
            if (this._earthHiDay) { this._earthHiDay.dispose(); this._earthHiDay = null; }
            if (this._earthHiNight) { this._earthHiNight.dispose(); this._earthHiNight = null; }
            console.log('🌍 Earth → low-res (far away, 8K freed)');
        }
    }

    // Swap a textured planet's (Jupiter/Saturn) color map between bundled low-res and the
    // real 4K photo. Same safe transition pattern as Earth — only acts on change, frees hi when far.
    setTexturedDetail(high) {
        if (!this._texMaterial) return;
        const HI = {
            jupiter: 'textures/jupiter/jupiter_hi.jpg',
            saturn:  'textures/saturn/saturn_hi.jpg'
        };
        const hiPath = HI[this.texturePack];
        if (!hiPath) return; // only the bodies we shipped a hi-res for
        this._texWantsHigh = high;
        if (high) {
            if (this._texDetail === 'high' || this._texHiLoading) return;
            this._texHiLoading = true;
            new THREE.TextureLoader().load(hiPath, (tex) => {
                if (!this._texWantsHigh) { tex.dispose(); this._texHiLoading = false; return; }
                if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
                else if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
                tex.anisotropy = 16;
                this._texHiColor = tex;
                this._texMaterial.map = tex;
                this._texMaterial.needsUpdate = true;
                this._texDetail = 'high';
                this._texHiLoading = false;
                console.log(`🪐 ${this.name} → 4K real texture (up close)`);
            }, undefined, () => { this._texHiLoading = false; });
        } else {
            if (this._texDetail === 'low') return;
            this._texMaterial.map = this._texLowColor;
            this._texMaterial.needsUpdate = true;
            this._texDetail = 'low';
            if (this._texHiColor) { this._texHiColor.dispose(); this._texHiColor = null; }
            console.log(`🪐 ${this.name} → low-res (far away, freed)`);
        }
    }

    _createRockyPlanet(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, segments);

        // Generate procedural textures
        const diffuseMap = this._generateTerrainTexture(1024);
        const normalMap = this._generateNormalMap(1024);
        const roughnessMap = this._generateRoughnessMap(512);

        const material = new THREE.MeshStandardMaterial({
            map: diffuseMap,
            normalMap: normalMap,
            normalScale: new THREE.Vector2(1.5, 1.5),
            roughnessMap: roughnessMap,
            roughness: 0.8,
            metalness: 0.1,
            envMapIntensity: 0.4
        });
        this._injectShadows(material);

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);
    }

    _createGasGiant(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, segments);

        // Custom shader for gas giant bands
        this.uniforms.gasGiant = {
            time: { value: 0 },
            baseColor: { value: new THREE.Color(this.color) },
            bandCount: { value: 12 + Math.random() * 8 },
            stormIntensity: { value: 0.3 + Math.random() * 0.4 },
            seed: { value: this.seed }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms.gasGiant,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 baseColor;
                uniform float bandCount;
                uniform float stormIntensity;
                uniform float seed;

                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vPosition;

                // Simplex noise functions
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

                    vec4 x = x_ *ns.x + ns.yyyy;
                    vec4 y = y_ *ns.x + ns.yyyy;
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
                    p0 *= norm.x;
                    p1 *= norm.y;
                    p2 *= norm.z;
                    p3 *= norm.w;

                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }

                void main() {
                    vec3 pos = normalize(vPosition);
                    float lat = asin(pos.y) / 3.14159 + 0.5;
                    float lon = atan(pos.z, pos.x) / 6.28318 + 0.5;

                    // Atmospheric bands
                    float bandBase = sin(lat * bandCount * 3.14159) * 0.5 + 0.5;

                    // Add turbulence to bands
                    float turbulence = snoise(vec3(lon * 8.0 + time * 0.02, lat * 4.0, seed)) * 0.15;
                    turbulence += snoise(vec3(lon * 16.0 + time * 0.04, lat * 8.0, seed * 1.3)) * 0.08;

                    float bands = bandBase + turbulence;

                    // Storm systems (Great Red Spot style)
                    float stormX = lon * 6.28318 - time * 0.01;
                    float stormY = (lat - 0.35) * 12.0;
                    float storm = exp(-(stormX * stormX + stormY * stormY) * 2.0) * stormIntensity;

                    // Color palette for gas giant - rich, vibrant bands
                    vec3 lightBand = baseColor * 1.5;
                    vec3 darkBand = baseColor * 0.5;
                    vec3 stormColor = vec3(0.9, 0.45, 0.2);

                    vec3 bandColor = mix(darkBand, lightBand, bands);
                    vec3 finalColor = mix(bandColor, stormColor, storm);

                    // Limb darkening
                    float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 1.5);
                    finalColor *= 1.0 - fresnel * 0.4;

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);
    }

    _createIcePlanet(segments) {
        const geometry = new THREE.SphereGeometry(this.radius, segments, segments);

        // Ice planet with frozen surface
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(1024, 512);
        const data = imageData.data;

        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 1024; x++) {
                const i = (y * 1024 + x) * 4;
                const u = x / 1024;
                const v = y / 512;

                // Ice cracks and surface variation
                const noise1 = this._noise2D(u * 30 + this.seed, v * 30) * 0.5 + 0.5;
                const noise2 = this._noise2D(u * 100 + this.seed * 2, v * 100) * 0.5 + 0.5;
                const cracks = Math.abs(this._noise2D(u * 50, v * 50)) < 0.1 ? 0.3 : 1.0;

                const brightness = noise1 * 0.3 + noise2 * 0.2 + 0.5;
                const iceColor = brightness * cracks;

                // Pale blue-white ice color
                data[i] = Math.floor(180 + iceColor * 60);
                data[i + 1] = Math.floor(200 + iceColor * 50);
                data[i + 2] = Math.floor(220 + iceColor * 35);
                data[i + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.2,
            metalness: 0.1,
            envMapIntensity: 1.2
        });

        this.surface = new THREE.Mesh(geometry, material);
        this.surface.castShadow = true;
        this.surface.receiveShadow = true;
        this.mesh.add(this.surface);
    }

    _createRealisticAtmosphere() {
        // Atmospheric scattering shader (Rayleigh + Mie)
        this.uniforms.atmosphere = {
            sunPosition: { value: new THREE.Vector3(100, 0, 0) },
            planetRadius: { value: this.radius },
            atmosphereRadius: { value: this.radius * 1.22 },
            rayleighCoeff: { value: new THREE.Vector3(5.5, 13.0, 22.4) }, // Blue scattering
            mieCoeff: { value: 21.0 },
            mieG: { value: 0.76 }, // Mie phase asymmetry
            sunIntensity: { value: 35.0 },
            atmosphereColor: { value: new THREE.Color(this.atmosphereColor) }
        };

        const atmosphereGeometry = new THREE.SphereGeometry(this.radius * 1.22, 64, 64);
        const atmosphereMaterial = new THREE.ShaderMaterial({
            uniforms: this.uniforms.atmosphere,
            vertexShader: `
                varying vec3 vWorldPosition;
                varying vec3 vNormal;

                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform vec3 sunPosition;
                uniform float planetRadius;
                uniform float atmosphereRadius;
                uniform vec3 rayleighCoeff;
                uniform float mieCoeff;
                uniform float mieG;
                uniform float sunIntensity;
                uniform vec3 atmosphereColor;

                varying vec3 vWorldPosition;
                varying vec3 vNormal;

                const float PI = 3.14159265359;
                const int NUM_SAMPLES = 8;
                const int NUM_SAMPLES_LIGHT = 4;

                float rayleighPhase(float cosTheta) {
                    return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
                }

                float miePhase(float cosTheta, float g) {
                    float g2 = g * g;
                    return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + cosTheta * cosTheta)) /
                           (pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5) * (2.0 + g2));
                }

                void main() {
                    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
                    vec3 sunDir = normalize(sunPosition);

                    // Fresnel-like effect for atmosphere edge
                    // Wider, softer rim (lower power = the glow reaches further in from the edge).
                    float fresnel = pow(1.0 - max(0.0, dot(viewDir, vNormal)), 2.3);

                    // Scattering calculation
                    float cosTheta = dot(viewDir, sunDir);
                    float rayleigh = rayleighPhase(cosTheta);
                    float mie = miePhase(cosTheta, mieG);

                    // Atmospheric density at this point
                    float altitude = (length(vWorldPosition) - planetRadius) / (atmosphereRadius - planetRadius);
                    float density = exp(-altitude * 4.0) * atmosphereRadius;

                    // Final color
                    vec3 rayleighColor = atmosphereColor * rayleighCoeff / 22.4 * rayleigh;
                    vec3 mieColor = vec3(1.0) * mie * 0.1;

                    vec3 scatter = (rayleighColor + mieColor) * sunIntensity * density * 0.015;

                    float alpha = fresnel * 1.0 * density;
                    alpha = clamp(alpha, 0.0, 0.75);

                    gl_FragColor = vec4(scatter + atmosphereColor * fresnel * 0.95, alpha);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
        this.mesh.add(this.atmosphere);

        // Add subtle inner glow
        const innerGlowGeo = new THREE.SphereGeometry(this.radius * 1.02, 48, 48);
        const innerGlowMat = new THREE.MeshBasicMaterial({
            color: this.atmosphereColor,
            transparent: true,
            opacity: 0.05 * this.atmosphereDensity,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.innerGlow = new THREE.Mesh(innerGlowGeo, innerGlowMat);
        this.mesh.add(this.innerGlow);
    }

    _createCloudLayer() {
        const cloudGeo = new THREE.SphereGeometry(this.radius * 1.015, 128, 64);

        // Real NASA MODIS cloud composite for Earth, procedural for everything else.
        if (this.texturePack === 'earth') {
            const loader = new THREE.TextureLoader();
            const cloudColor = loader.load(
                'textures/earth/earth_clouds_2k.jpg',
                () => console.log('☁️  Earth cloud composite loaded (NASA MODIS 2K)'),
                undefined,
                (err) => console.warn('Earth cloud load failed:', err)
            );
            const cloudAlpha = loader.load('textures/earth/earth_clouds_alpha.jpg');
            if (THREE.SRGBColorSpace !== undefined) cloudColor.colorSpace = THREE.SRGBColorSpace;
            cloudColor.anisotropy = 16;
            cloudAlpha.anisotropy = 16;

            const cloudMat = new THREE.MeshLambertMaterial({
                map: cloudColor,
                alphaMap: cloudAlpha,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
                side: THREE.FrontSide
            });

            this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
            this.mesh.add(this.clouds);
            return;
        }

        // Procedural cloud texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(1024, 512);
        const data = imageData.data;

        for (let y = 0; y < 512; y++) {
            for (let x = 0; x < 1024; x++) {
                const i = (y * 1024 + x) * 4;
                const u = x / 1024;
                const v = y / 512;
                const theta = u * Math.PI * 2;
                const phi = v * Math.PI;

                const nx = Math.sin(phi) * Math.cos(theta);
                const ny = Math.sin(phi) * Math.sin(theta);
                const nz = Math.cos(phi);

                // Multi-octave cloud noise
                let cloud = 0;
                let amp = 1;
                let freq = 3;
                for (let oct = 0; oct < 6; oct++) {
                    cloud += this._noise3D(nx * freq + this.seed * 3, ny * freq, nz * freq) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }
                cloud = (cloud + 1) / 2;
                cloud = Math.pow(cloud, 1.5); // Sharpen clouds

                // More clouds at equator, less at poles
                const latFactor = 1.0 - Math.abs(v - 0.5) * 1.5;
                cloud *= Math.max(0.3, latFactor);

                const alpha = cloud > 0.4 ? (cloud - 0.4) * 2.5 : 0;

                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
                data[i + 3] = Math.floor(alpha * 200);
            }
        }

        ctx.putImageData(imageData, 0, 0);
        const cloudTexture = new THREE.CanvasTexture(canvas);
        cloudTexture.wrapS = THREE.RepeatWrapping;

        this.cloudUniforms = {
            cloudMap: { value: cloudTexture },
            time: { value: 0 }
        };

        const cloudMat = new THREE.MeshBasicMaterial({
            map: cloudTexture,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            blending: THREE.NormalBlending
        });

        this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
        this.mesh.add(this.clouds);
    }

    _createRings() {
        const innerRadius = this.radius * 1.4;
        const outerRadius = this.radius * 2.5;

        const ringGeo = new THREE.RingGeometry(innerRadius, outerRadius, 128, 8);

        // Generate ring texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Ring bands with gaps
        for (let x = 0; x < 1024; x++) {
            const t = x / 1024;
            const noise = this._noise2D(t * 50 + this.seed, 0) * 0.5 + 0.5;
            const gap = Math.sin(t * 80) > 0.8 ? 0.2 : 1.0;
            const density = noise * gap;

            const baseColor = new THREE.Color(this.color);
            const r = Math.floor(baseColor.r * 255 * density * 0.8);
            const g = Math.floor(baseColor.g * 255 * density * 0.75);
            const b = Math.floor(baseColor.b * 255 * density * 0.7);

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${density * 0.8})`;
            ctx.fillRect(x, 0, 1, 64);
        }

        const ringTexture = new THREE.CanvasTexture(canvas);
        ringTexture.wrapS = THREE.ClampToEdgeWrapping;

        const ringMat = new THREE.MeshBasicMaterial({
            map: ringTexture,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.rings = new THREE.Mesh(ringGeo, ringMat);
        this.rings.rotation.x = Math.PI / 2 + 0.4; // Tilted rings
        this.mesh.add(this.rings);
    }

    // Improved 3D noise
    _noise3D(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);

        const u = this._fade(x);
        const v = this._fade(y);
        const w = this._fade(z);

        const A = this._p[X] + Y;
        const AA = this._p[A] + Z;
        const AB = this._p[A + 1] + Z;
        const B = this._p[X + 1] + Y;
        const BA = this._p[B] + Z;
        const BB = this._p[B + 1] + Z;

        return this._lerp(w,
            this._lerp(v,
                this._lerp(u, this._grad(this._p[AA], x, y, z), this._grad(this._p[BA], x - 1, y, z)),
                this._lerp(u, this._grad(this._p[AB], x, y - 1, z), this._grad(this._p[BB], x - 1, y - 1, z))),
            this._lerp(v,
                this._lerp(u, this._grad(this._p[AA + 1], x, y, z - 1), this._grad(this._p[BA + 1], x - 1, y, z - 1)),
                this._lerp(u, this._grad(this._p[AB + 1], x, y - 1, z - 1), this._grad(this._p[BB + 1], x - 1, y - 1, z - 1))));
    }

    _noise2D(x, y) {
        return this._noise3D(x, y, 0);
    }

    _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    _lerp(t, a, b) { return a + t * (b - a); }
    _grad(hash, x, y, z) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    // Permutation table for noise
    get _p() {
        if (!this._perm) {
            const p = [];
            for (let i = 0; i < 256; i++) p[i] = Math.floor(Math.random() * 256);
            this._perm = new Array(512);
            for (let i = 0; i < 512; i++) this._perm[i] = p[i & 255];
        }
        return this._perm;
    }

    update(deltaTime, sunPosition) {
        this.time += deltaTime;

        // Rotate surface
        if (this.surface) {
            const rotationSpeed = (Math.PI * 2) / (this.rotationPeriod * 3600);
            this.surface.rotation.y += rotationSpeed * deltaTime * 1000;
        }

        // Rotate clouds slightly faster
        if (this.clouds) {
            const cloudSpeed = (Math.PI * 2) / (this.rotationPeriod * 3600) * 1.1;
            this.clouds.rotation.y += cloudSpeed * deltaTime * 1000;
        }

        // Update gas giant shader
        if (this.uniforms.gasGiant) {
            this.uniforms.gasGiant.time.value = this.time;
        }

        // Update sun position for all shaders. The update loop passes rendererCore
        // as the second arg (not a position), so validate before using — the sun
        // lives at the origin in this scene.
        let sunPos = sunPosition;
        if (!sunPos || typeof sunPos.x !== 'number' || !isFinite(sunPos.x)) {
            sunPos = _planetSunOrigin;
        }

        // Update atmosphere sun position
        if (this.uniforms.atmosphere) {
            this.uniforms.atmosphere.sunPosition.value.copy(sunPos);
        }

        // Refresh shared eclipse/ring shadow uniforms
        if (this._shadowUniforms) {
            this._shadowUniforms.uSunPos.value.set(sunPos.x, sunPos.y, sunPos.z);
            let n = 0;
            for (let i = 0; i < this._occluders.length && n < 4; i++) {
                const occ = this._occluders[i];
                const m = occ.mesh || occ;
                if (!m || !m.getWorldPosition) continue;
                m.getWorldPosition(_planetTmpVec);
                this._shadowUniforms.uOccluders.value[n].set(
                    _planetTmpVec.x, _planetTmpVec.y, _planetTmpVec.z, occ.radius || 1
                );
                n++;
            }
            this._shadowUniforms.uOccluderCount.value = n;
        }
        if (this._ringShadowUniforms && this.rings) {
            this.mesh.getWorldPosition(this._ringShadowUniforms.uRingCenter.value);
            this.rings.getWorldQuaternion(_planetTmpQuat);
            this._ringShadowUniforms.uRingNormal.value.set(0, 0, 1).applyQuaternion(_planetTmpQuat);
        }
        if (this._ringLightUniforms) {
            this.mesh.getWorldPosition(this._ringLightUniforms.uPlanetCenter.value);
        }

        // Update photoreal Earth sun direction (world-space direction from planet to sun).
        // sunPos may be a plain {x,y,z} object, not a Vector3 — read components directly.
        if (this.uniforms.earth) {
            const dir = this.uniforms.earth.sunDirection.value;
            dir.set(
                sunPos.x - this.mesh.position.x,
                sunPos.y - this.mesh.position.y,
                sunPos.z - this.mesh.position.z
            ).normalize();
        }

        // Animate auroras
        if (this.auroras && this.auroras.length > 0) {
            this.auroras.forEach(aurora => {
                if (aurora.material.uniforms) {
                    aurora.material.uniforms.time.value = this.time;
                }
                // Slow rotation of aurora oval
                aurora.rotation.y += deltaTime * 0.05;
            });
        }

        // Update city lights sun direction
        if (this.cityLights && this.cityLights.material.uniforms) {
            const sunDir = sunPos.clone().sub(this.mesh.position).normalize();
            this.cityLights.material.uniforms.sunDirection.value.copy(sunDir);
        }

        // Rotate rings slowly
        if (this.rings) {
            this.rings.rotation.z += deltaTime * 0.001;
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    if (child.material.normalMap) child.material.normalMap.dispose();
                    if (child.material.roughnessMap) child.material.roughnessMap.dispose();
                    child.material.dispose();
                }
            });
        }
    }
}
