// Nebula.js - PHOTOREALISTIC volumetric nebula with raymarching
// Inspired by Hubble imagery: Pillars of Creation, Carina Nebula, Orion Nebula

class Nebula {
    constructor(options = {}) {
        this.name = options.name || "Unnamed Nebula";
        this.radius = options.radius || 300;
        this.position = options.position || { x: 0, y: 0, z: 0 };
        this.layers = options.layers || 16;

        // Hubble-inspired color palette
        this.nebulaType = options.nebulaType || "emission";
        this.primaryColor = options.primaryColor || this._getDefaultPrimaryColor();
        this.secondaryColor = options.secondaryColor || this._getDefaultSecondaryColor();
        this.tertiaryColor = options.tertiaryColor || this._getDefaultTertiaryColor();

        this.type = "nebula";
        this.time = 0;
        this.seed = options.seed || Math.random() * 10000;
        this._rnd = this._mulberry32(this.seed);

        this.createNebula();
        console.log(`☁️ Created PHOTOREALISTIC ${this.nebulaType} nebula: ${this.name}`);
    }

    _getDefaultPrimaryColor() {
        const colors = {
            emission: 0xff2244,    // H-alpha vivid crimson
            reflection: 0x4488ff,  // Bright blue scattered light
            planetary: 0x44ffbb,   // Vivid green oxygen [OIII]
            dark: 0x331818         // Dark nebula with subtle warmth
        };
        return colors[this.nebulaType] || 0xff5566;
    }

    _getDefaultSecondaryColor() {
        const colors = {
            emission: 0xffbb44,    // Sulfur [SII] bright orange
            reflection: 0x77aaff,  // Rich lighter blue
            planetary: 0x6699ff,   // Vibrant blue outer shell
            dark: 0x180a0a
        };
        return colors[this.nebulaType] || 0xffbb55;
    }

    _getDefaultTertiaryColor() {
        const colors = {
            emission: 0x44aaff,    // Oxygen [OIII] vivid blue-green
            reflection: 0xaaccff,  // Bright pale blue
            planetary: 0xff4499,   // Vivid pink hydrogen
            dark: 0x0a0505
        };
        return colors[this.nebulaType] || 0x55aaff;
    }

    createNebula() {
        this.mesh = new THREE.Group();
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);

        // Volumetric cloud core with raymarching shader
        this._createVolumetricCore();

        // Multi-layer cloud shells for depth
        this._createCloudShells();

        // Dark dust lanes and absorption
        this._createDustLanes();

        // Embedded young stars
        this._createEmbeddedStars();

        // Pillar structures (Pillars of Creation style)
        if (this.nebulaType === "emission") {
            this._createPillars();
        }

        // Outer diffuse halo
        this._createHalo();

        // Particle dust field
        this._createDustParticles();
    }

    _createVolumetricCore() {
        // Raymarched volumetric nebula shader
        const geometry = new THREE.BoxGeometry(this.radius * 2, this.radius * 2, this.radius * 2);

        this.volumeUniforms = {
            time: { value: 0 },
            cameraPos: { value: new THREE.Vector3() },
            primaryColor: { value: new THREE.Color(this.primaryColor) },
            secondaryColor: { value: new THREE.Color(this.secondaryColor) },
            tertiaryColor: { value: new THREE.Color(this.tertiaryColor) },
            nebulaRadius: { value: this.radius },
            density: { value: 0.5 },
            seed: { value: this.seed }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.volumeUniforms,
            vertexShader: `
                varying vec3 vWorldPosition;
                varying vec3 vLocalPosition;

                void main() {
                    vLocalPosition = position;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 cameraPos;
                uniform vec3 primaryColor;
                uniform vec3 secondaryColor;
                uniform vec3 tertiaryColor;
                uniform float nebulaRadius;
                uniform float density;
                uniform float seed;

                varying vec3 vWorldPosition;
                varying vec3 vLocalPosition;

                // 3D Simplex noise
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

                // Fractal Brownian Motion
                float fbm(vec3 p, int octaves) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    float frequency = 1.0;
                    for(int i = 0; i < 6; i++) {
                        if(i >= octaves) break;
                        value += amplitude * snoise(p * frequency);
                        frequency *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                // Sample nebula density at point
                float sampleDensity(vec3 p) {
                    float dist = length(p) / nebulaRadius;
                    if (dist > 1.0) return 0.0;

                    // Base density falloff
                    float baseDensity = 1.0 - dist;
                    baseDensity = pow(baseDensity, 1.5);

                    // Turbulent cloud structure
                    vec3 noisePos = p / nebulaRadius * 3.0 + seed;
                    float turbulence = fbm(noisePos + time * 0.02, 5);

                    // Wispy tendrils
                    float wisps = abs(snoise(noisePos * 2.0 + time * 0.01));
                    wisps = pow(wisps, 0.5) * 0.5;

                    // Final density
                    float d = baseDensity * (0.5 + turbulence * 0.5 + wisps);
                    d *= density;

                    return max(0.0, d);
                }

                // Get nebula color based on position
                vec3 getNebulaColor(vec3 p, float localDensity) {
                    float dist = length(p) / nebulaRadius;
                    vec3 noisePos = p / nebulaRadius * 2.0;

                    // Color variation based on position
                    float colorMix1 = snoise(noisePos + seed) * 0.5 + 0.5;
                    float colorMix2 = snoise(noisePos * 1.5 + seed + 100.0) * 0.5 + 0.5;

                    // Blend between nebula colors
                    vec3 innerColor = mix(primaryColor, secondaryColor, colorMix1);
                    vec3 outerColor = mix(secondaryColor, tertiaryColor, colorMix2);
                    vec3 baseColor = mix(innerColor, outerColor, dist);

                    // Emission intensity based on density
                    float emission = localDensity * 2.0;

                    return baseColor * emission;
                }

                void main() {
                    vec3 rayOrigin = cameraPos;
                    vec3 rayDir = normalize(vWorldPosition - cameraPos);

                    // Raymarching parameters
                    const int MAX_STEPS = 64;
                    float stepSize = nebulaRadius * 2.5 / float(MAX_STEPS);

                    // Find entry point into nebula volume
                    vec3 pos = vWorldPosition;
                    float distToCenter = length(pos);

                    // Accumulated color and opacity
                    vec3 accumColor = vec3(0.0);
                    float accumAlpha = 0.0;

                    // March through volume
                    for(int i = 0; i < MAX_STEPS; i++) {
                        if(accumAlpha > 0.95) break;

                        float d = sampleDensity(pos);

                        if(d > 0.001) {
                            vec3 sampleColor = getNebulaColor(pos, d);

                            // Beer-Lambert absorption
                            float absorption = exp(-d * stepSize * 2.0);
                            float alpha = 1.0 - absorption;

                            // Front-to-back compositing
                            accumColor += sampleColor * alpha * (1.0 - accumAlpha);
                            accumAlpha += alpha * (1.0 - accumAlpha);
                        }

                        pos += rayDir * stepSize;

                        // Exit if too far from center
                        if(length(pos) > nebulaRadius * 1.2) break;
                    }

                    // Apply exposure and tone mapping
                    accumColor = 1.0 - exp(-accumColor * 1.5);

                    gl_FragColor = vec4(accumColor, accumAlpha * 0.8);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.volumeCore = new THREE.Mesh(geometry, material);
        this.mesh.add(this.volumeCore);
    }

    _createCloudShells() {
        this.cloudLayers = [];
        const colors = [
            new THREE.Color(this.primaryColor),
            new THREE.Color(this.secondaryColor),
            new THREE.Color(this.tertiaryColor)
        ];

        for (let i = 0; i < this.layers; i++) {
            const t = i / this.layers;
            const scale = 0.3 + t * 1.2;

            // Create displaced icosahedron for organic cloud shape
            const geometry = new THREE.IcosahedronGeometry(this.radius * scale, 4);
            const positions = geometry.attributes.position;

            // Apply multi-octave noise displacement
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);

                let displacement = 0;
                let amp = 1;
                let freq = 0.01;
                for (let oct = 0; oct < 5; oct++) {
                    displacement += this._noise3D(
                        x * freq + this.seed,
                        y * freq + i * 0.5,
                        z * freq
                    ) * amp;
                    amp *= 0.5;
                    freq *= 2;
                }

                const factor = 1 + displacement * 0.5;
                positions.setXYZ(j, x * factor, y * factor, z * factor);
            }
            geometry.computeVertexNormals();

            // Color gradient through layers
            const colorIndex = Math.floor(t * 2.5) % 3;
            const nextIndex = (colorIndex + 1) % 3;
            const colorT = (t * 2.5) % 1;
            const layerColor = colors[colorIndex].clone().lerp(colors[nextIndex], colorT);

            const material = new THREE.MeshBasicMaterial({
                color: layerColor,
                transparent: true,
                opacity: 0.015 + (1 - t) * 0.025,
                side: i % 2 === 0 ? THREE.FrontSide : THREE.BackSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const cloud = new THREE.Mesh(geometry, material);
            cloud.rotation.set(
                this._rnd() * Math.PI,
                this._rnd() * Math.PI,
                this._rnd() * Math.PI
            );
            cloud.userData.rotationSpeed = {
                x: (this._rnd() - 0.5) * 0.001,
                y: (this._rnd() - 0.5) * 0.002,
                z: (this._rnd() - 0.5) * 0.001
            };

            this.mesh.add(cloud);
            this.cloudLayers.push(cloud);
        }
    }

    _createDustLanes() {
        this.dustLanes = [];
        const laneCount = 4 + Math.floor(this._rnd() * 4);

        for (let i = 0; i < laneCount; i++) {
            // Create complex dust lane geometry
            const laneGeo = new THREE.PlaneGeometry(
                this.radius * (0.6 + this._rnd() * 0.8),
                this.radius * (0.2 + this._rnd() * 0.4),
                32, 16
            );

            // Warp the plane for organic dust shape
            const positions = laneGeo.attributes.position;
            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);
                const z = positions.getZ(j);

                const warp = this._noise3D(x * 0.02 + this.seed, y * 0.02, i) * this.radius * 0.15;
                positions.setZ(j, z + warp);
            }
            laneGeo.computeVertexNormals();

            // Dark absorbing material — kept faint; at full opacity these planes
            // read as solid black blobs instead of dust
            const laneMat = new THREE.MeshBasicMaterial({
                color: 0x050303,
                transparent: true,
                opacity: 0.14 + this._rnd() * 0.12,
                side: THREE.DoubleSide,
                blending: THREE.NormalBlending,
                depthWrite: false
            });

            const lane = new THREE.Mesh(laneGeo, laneMat);
            lane.position.set(
                (this._rnd() - 0.5) * this.radius * 0.6,
                (this._rnd() - 0.5) * this.radius * 0.4,
                (this._rnd() - 0.5) * this.radius * 0.6
            );
            lane.rotation.set(
                this._rnd() * Math.PI,
                this._rnd() * Math.PI,
                this._rnd() * Math.PI
            );

            this.mesh.add(lane);
            this.dustLanes.push(lane);
        }
    }

    _createEmbeddedStars() {
        this.starClusters = [];
        const starCount = 20 + Math.floor(this._rnd() * 30);

        for (let i = 0; i < starCount; i++) {
            const starGroup = new THREE.Group();
            const starSize = 0.3 + this._rnd() * 2;

            // Hot young stars: O, B class (blue-white)
            const temp = 10000 + this._rnd() * 30000;
            const starColor = this._temperatureToColor(temp);

            // Star core
            const coreGeo = new THREE.SphereGeometry(starSize, 16, 16);
            const coreMat = new THREE.MeshBasicMaterial({
                color: starColor.clone().multiplyScalar(1.5)
            });
            const core = new THREE.Mesh(coreGeo, coreMat);
            starGroup.add(core);

            // Multi-layer glow
            const glowSizes = [2.5, 4, 6];
            const glowOpacities = [0.4, 0.2, 0.08];

            glowSizes.forEach((size, j) => {
                const glowGeo = new THREE.SphereGeometry(starSize * size, 16, 16);
                const glowMat = new THREE.MeshBasicMaterial({
                    color: starColor,
                    transparent: true,
                    opacity: glowOpacities[j],
                    blending: THREE.AdditiveBlending,
                    side: THREE.BackSide,
                    depthWrite: false
                });
                const glow = new THREE.Mesh(glowGeo, glowMat);
                starGroup.add(glow);
            });

            // Position within nebula core
            const r = this.radius * 0.5 * Math.cbrt(this._rnd());
            const theta = this._rnd() * Math.PI * 2;
            const phi = Math.acos(2 * this._rnd() - 1);

            starGroup.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );

            starGroup.userData.twinklePhase = this._rnd() * Math.PI * 2;
            starGroup.userData.twinkleSpeed = 2 + this._rnd() * 3;

            this.mesh.add(starGroup);
            this.starClusters.push(starGroup);
        }
    }

    _createPillars() {
        // Iconic pillar structures like Pillars of Creation
        const pillarCount = 2 + Math.floor(this._rnd() * 3);

        for (let i = 0; i < pillarCount; i++) {
            const pillarGroup = new THREE.Group();

            const height = this.radius * (0.5 + this._rnd() * 0.5);
            const baseWidth = this.radius * (0.1 + this._rnd() * 0.08);

            // Main pillar body - multiple layers for depth
            for (let layer = 0; layer < 3; layer++) {
                const pillarGeo = new THREE.CylinderGeometry(
                    baseWidth * (0.2 + layer * 0.1),
                    baseWidth * (1.0 + layer * 0.1),
                    height,
                    16, 12
                );

                // Displace vertices for organic shape
                const positions = pillarGeo.attributes.position;
                for (let j = 0; j < positions.count; j++) {
                    const x = positions.getX(j);
                    const y = positions.getY(j);
                    const z = positions.getZ(j);

                    const noise = this._noise3D(x * 0.03, y * 0.02, z * 0.03 + layer);
                    positions.setX(j, x * (1 + noise * 0.4));
                    positions.setZ(j, z * (1 + noise * 0.4));
                }
                pillarGeo.computeVertexNormals();

                const pillarMat = new THREE.MeshBasicMaterial({
                    color: layer === 0 ? 0x0a0505 : 0x150808,
                    transparent: true,
                    opacity: layer === 0 ? 0.9 : 0.3,
                    side: layer === 0 ? THREE.FrontSide : THREE.BackSide
                });

                const pillar = new THREE.Mesh(pillarGeo, pillarMat);
                pillarGroup.add(pillar);
            }

            // Backlit rim glow
            const rimGeo = new THREE.CylinderGeometry(
                baseWidth * 0.3,
                baseWidth * 1.1,
                height,
                16, 1, true
            );
            const rimMat = new THREE.MeshBasicMaterial({
                color: this.primaryColor,
                transparent: true,
                opacity: 0.2,
                side: THREE.BackSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const rim = new THREE.Mesh(rimGeo, rimMat);
            pillarGroup.add(rim);

            // Position
            pillarGroup.position.set(
                (this._rnd() - 0.5) * this.radius * 0.5,
                -this.radius * 0.2 + this._rnd() * this.radius * 0.2,
                (this._rnd() - 0.5) * this.radius * 0.5
            );
            pillarGroup.rotation.x = (this._rnd() - 0.5) * 0.4;
            pillarGroup.rotation.z = (this._rnd() - 0.5) * 0.4;

            this.mesh.add(pillarGroup);
        }
    }

    _createHalo() {
        // Large outer glow halo
        const haloGeo = new THREE.SphereGeometry(this.radius * 2.5, 48, 48);
        const haloMat = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(this.primaryColor) },
                time: { value: 0 }
            },
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float time;
                varying vec3 vNormal;

                void main() {
                    float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
                    float flicker = 1.0 + sin(time * 0.5) * 0.05;
                    gl_FragColor = vec4(color * intensity * flicker, intensity * 0.15);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.halo = new THREE.Mesh(haloGeo, haloMat);
        this.mesh.add(this.halo);
    }

    _createDustParticles() {
        // Ambient dust particles throughout nebula
        const particleCount = 5000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const color1 = new THREE.Color(this.primaryColor);
        const color2 = new THREE.Color(this.secondaryColor);

        for (let i = 0; i < particleCount; i++) {
            // Distribute in sphere
            const r = this.radius * 1.5 * Math.cbrt(this._rnd());
            const theta = this._rnd() * Math.PI * 2;
            const phi = Math.acos(2 * this._rnd() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7; // Flatten slightly
            positions[i * 3 + 2] = r * Math.cos(phi);

            // Color variation
            const colorMix = this._rnd();
            const particleColor = color1.clone().lerp(color2, colorMix);
            colors[i * 3] = particleColor.r;
            colors[i * 3 + 1] = particleColor.g;
            colors[i * 3 + 2] = particleColor.b;

            sizes[i] = 0.5 + this._rnd() * 2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float time;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif

                    // Subtle drifting motion
                    vec3 pos = position;
                    pos.x += sin(time * 0.1 + position.y * 0.01) * 2.0;
                    pos.y += cos(time * 0.15 + position.x * 0.01) * 1.5;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

                    // Fade with distance
                    float dist = length(mvPosition.xyz);
                    vAlpha = smoothstep(2000.0, 100.0, dist) * 0.6;

                    gl_PointSize = size * (200.0 / -mvPosition.z);
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

        this.dustParticles = new THREE.Points(geometry, material);
        this.mesh.add(this.dustParticles);
    }

    // Perlin-like 3D noise
    _noise3D(x, y, z) {
        const p = x + y * 57 + z * 113;
        const n = Math.sin(p * 12.9898 + 78.233) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }

    _temperatureToColor(temp) {
        temp = Math.max(1000, Math.min(40000, temp));
        let r, g, b;
        if (temp <= 6600) {
            r = 1;
            g = Math.max(0, Math.min(1, (99.47 * Math.log(temp/100) - 161.12) / 255));
            b = temp <= 1900 ? 0 : Math.max(0, Math.min(1, (138.52 * Math.log(temp/100 - 10) - 305.04) / 255));
        } else {
            r = Math.max(0, Math.min(1, (329.70 * Math.pow(temp/100 - 60, -0.133)) / 255));
            g = Math.max(0, Math.min(1, (288.12 * Math.pow(temp/100 - 60, -0.0755)) / 255));
            b = 1;
        }
        return new THREE.Color(r, g, b);
    }

    _mulberry32(seed) {
        return () => {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    update(deltaTime, camera) {
        if (!this.mesh) return;
        this.time += deltaTime;

        // Update volumetric shader
        if (this.volumeUniforms && camera) {
            this.volumeUniforms.time.value = this.time;
            this.volumeUniforms.cameraPos.value.copy(camera.position);
        }

        // Slowly rotate cloud layers
        this.cloudLayers.forEach(cloud => {
            cloud.rotation.x += deltaTime * cloud.userData.rotationSpeed.x;
            cloud.rotation.y += deltaTime * cloud.userData.rotationSpeed.y;
            cloud.rotation.z += deltaTime * cloud.userData.rotationSpeed.z;
        });

        // Update halo
        if (this.halo && this.halo.material.uniforms) {
            this.halo.material.uniforms.time.value = this.time;
        }

        // Twinkle embedded stars
        this.starClusters.forEach(star => {
            const twinkle = 0.8 + Math.sin(this.time * star.userData.twinkleSpeed + star.userData.twinklePhase) * 0.2;
            star.scale.setScalar(twinkle);
        });

        // Update dust particles
        if (this.dustParticles && this.dustParticles.material.uniforms) {
            this.dustParticles.material.uniforms.time.value = this.time;
        }
    }

    dispose() {
        this.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
    }
}
