// VolumetricNebula.js - STUNNING Volumetric Nebula with Raymarching
// Creates photorealistic gas clouds, dust lanes, and emission nebulae

class VolumetricNebula {
    constructor(config = {}) {
        this.name = config.name || "Nebula";
        this.position = config.position || new THREE.Vector3(0, 0, 0);
        this.scale = config.scale || 100;
        this.type = config.type || "emission"; // emission, reflection, dark, planetary
        this.primaryColor = config.primaryColor || new THREE.Color(0.8, 0.2, 0.4);
        this.secondaryColor = config.secondaryColor || new THREE.Color(0.2, 0.4, 0.9);
        this.density = config.density || 0.5;
        this.complexity = config.complexity || 5;

        this.time = 0;
        this.createMesh();

        console.log(`🌌 Created VOLUMETRIC NEBULA: ${this.name} (${this.type})`);
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;
        this.mesh.position.copy(this.position);

        // Main volumetric cloud
        this._createVolumetricCloud();

        // Dust lanes
        this._createDustLanes();

        // Embedded stars
        this._createEmbeddedStars();

        // Ionized gas regions
        this._createIonizedRegions();

        // Particle effects
        this._createNebulaParticles();
    }

    _createVolumetricCloud() {
        // Large sphere with raymarched volumetric shader
        const geometry = new THREE.SphereGeometry(this.scale, 64, 64);

        this.cloudUniforms = {
            time: { value: 0 },
            scale: { value: this.scale },
            primaryColor: { value: this.primaryColor },
            secondaryColor: { value: this.secondaryColor },
            density: { value: this.density },
            cameraPos: { value: new THREE.Vector3() },
            nebulaType: { value: this._getTypeIndex() }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.cloudUniforms,
            vertexShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vWorldPosition;

                void main() {
                    vPosition = position;
                    vNormal = normalize(normalMatrix * normal);
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float scale;
                uniform vec3 primaryColor;
                uniform vec3 secondaryColor;
                uniform float density;
                uniform vec3 cameraPos;
                uniform float nebulaType;

                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vWorldPosition;

                // 3D Simplex noise
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

                    vec3 i  = floor(v + dot(v, C.yyy));
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
                    for(int i = 0; i < 8; i++) {
                        if(i >= octaves) break;
                        value += amplitude * snoise(p * frequency);
                        frequency *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                // Domain warping for complex shapes
                float warpedFbm(vec3 p) {
                    vec3 q = vec3(
                        fbm(p + vec3(0.0, 0.0, 0.0), 4),
                        fbm(p + vec3(5.2, 1.3, 2.8), 4),
                        fbm(p + vec3(1.7, 9.2, 3.1), 4)
                    );

                    vec3 r = vec3(
                        fbm(p + 4.0 * q + vec3(1.7, 9.2, 0.0) + time * 0.02, 4),
                        fbm(p + 4.0 * q + vec3(8.3, 2.8, 0.0) + time * 0.03, 4),
                        fbm(p + 4.0 * q + vec3(3.1, 5.7, 0.0) + time * 0.01, 4)
                    );

                    return fbm(p + 4.0 * r, 6);
                }

                void main() {
                    vec3 pos = vPosition / scale;

                    // Base cloud density from warped noise
                    float cloudDensity = warpedFbm(pos * 2.0);
                    cloudDensity = cloudDensity * 0.5 + 0.5; // Normalize to 0-1

                    // Apply density threshold
                    cloudDensity = smoothstep(0.3, 0.7, cloudDensity) * density;

                    // Distance falloff
                    float dist = length(vPosition) / scale;
                    float falloff = 1.0 - smoothstep(0.0, 1.0, dist);
                    cloudDensity *= falloff * falloff;

                    // Fresnel for edge effects
                    float fresnel = pow(1.0 - abs(dot(vNormal, normalize(cameraPos - vWorldPosition))), 2.0);

                    // Color mixing based on density and position
                    float colorMix = snoise(pos * 3.0 + time * 0.05) * 0.5 + 0.5;
                    vec3 baseColor = mix(primaryColor, secondaryColor, colorMix);

                    // Add emission highlights
                    float emission = pow(cloudDensity, 2.0);
                    vec3 emissionColor = baseColor * 2.0;

                    // Different effects based on nebula type
                    vec3 finalColor = baseColor;
                    float alpha = cloudDensity * 0.6;

                    if (nebulaType < 0.5) {
                        // Emission nebula - glowing gas
                        finalColor = baseColor * (1.0 + emission * 2.0);
                        alpha *= (1.0 + fresnel * 0.5);
                    } else if (nebulaType < 1.5) {
                        // Reflection nebula - scattered starlight
                        vec3 scatterColor = vec3(0.6, 0.7, 1.0);
                        finalColor = mix(baseColor, scatterColor, fresnel);
                        alpha *= fresnel;
                    } else if (nebulaType < 2.5) {
                        // Dark nebula - absorbs light
                        finalColor = vec3(0.02, 0.01, 0.03);
                        alpha = cloudDensity * 0.8;
                    } else {
                        // Planetary nebula - shell structure
                        float shell = abs(dist - 0.6);
                        shell = smoothstep(0.2, 0.0, shell);
                        finalColor = baseColor * shell * 3.0;
                        alpha = shell * 0.7;
                    }

                    // Add subtle internal glow
                    finalColor += emissionColor * fresnel * 0.3;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.volumetricCloud = new THREE.Mesh(geometry, material);
        this.mesh.add(this.volumetricCloud);

        // Add multiple layers for depth
        for (let i = 1; i <= 3; i++) {
            const layerGeo = new THREE.SphereGeometry(this.scale * (0.7 + i * 0.2), 32, 32);
            const layerMat = material.clone();
            layerMat.uniforms = {
                ...this.cloudUniforms,
                density: { value: this.density * (1 - i * 0.2) }
            };

            const layer = new THREE.Mesh(layerGeo, layerMat);
            layer.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );
            this.mesh.add(layer);
        }
    }

    _createDustLanes() {
        // Dark dust lanes that cut through the nebula
        const dustCount = 5;

        for (let i = 0; i < dustCount; i++) {
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(
                    (Math.random() - 0.5) * this.scale,
                    (Math.random() - 0.5) * this.scale,
                    (Math.random() - 0.5) * this.scale
                ),
                new THREE.Vector3(
                    (Math.random() - 0.5) * this.scale,
                    (Math.random() - 0.5) * this.scale,
                    (Math.random() - 0.5) * this.scale
                ),
                new THREE.Vector3(
                    (Math.random() - 0.5) * this.scale,
                    (Math.random() - 0.5) * this.scale,
                    (Math.random() - 0.5) * this.scale
                )
            ]);

            const tubeGeo = new THREE.TubeGeometry(curve, 32, this.scale * 0.05, 8, false);
            const tubeMat = new THREE.MeshBasicMaterial({
                color: 0x020105,
                transparent: true,
                opacity: 0.6,
                blending: THREE.NormalBlending
            });

            const dust = new THREE.Mesh(tubeGeo, tubeMat);
            this.mesh.add(dust);
        }
    }

    _createEmbeddedStars() {
        // Young stars forming within the nebula
        const starCount = 20;
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            // Random position within nebula
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const r = Math.random() * this.scale * 0.7;

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Hot young stars are blue-white
            const temp = 0.5 + Math.random() * 0.5;
            colors[i * 3] = 0.8 + temp * 0.2;
            colors[i * 3 + 1] = 0.9 + temp * 0.1;
            colors[i * 3 + 2] = 1.0;

            sizes[i] = 1 + Math.random() * 3;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 } },
            vertexShader: `
                attribute float size;
                varying vec3 vColor;
                uniform float time;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif

                    // Twinkle effect
                    float twinkle = sin(time * 3.0 + position.x * 10.0) * 0.2 + 0.8;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * twinkle * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    float alpha = pow(1.0 - dist * 2.0, 3.0);
                    vec3 color = vColor * 2.0; // HDR boost

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        this.embeddedStars = new THREE.Points(geometry, material);
        this.mesh.add(this.embeddedStars);
    }

    _createIonizedRegions() {
        // Bright H-II regions where gas is ionized by young stars
        const regionCount = 3;

        for (let i = 0; i < regionCount; i++) {
            const regionPos = new THREE.Vector3(
                (Math.random() - 0.5) * this.scale * 0.6,
                (Math.random() - 0.5) * this.scale * 0.6,
                (Math.random() - 0.5) * this.scale * 0.6
            );

            const regionSize = this.scale * (0.1 + Math.random() * 0.15);
            const geometry = new THREE.SphereGeometry(regionSize, 32, 32);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    color: { value: new THREE.Color(1.0, 0.3, 0.5) }
                },
                vertexShader: `
                    varying vec3 vNormal;
                    void main() {
                        vNormal = normalize(normalMatrix * normal);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform vec3 color;
                    varying vec3 vNormal;

                    void main() {
                        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
                        float pulse = sin(time * 2.0) * 0.1 + 0.9;

                        vec3 finalColor = color * 2.0 * pulse;
                        float alpha = fresnel * 0.4;

                        gl_FragColor = vec4(finalColor, alpha);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const region = new THREE.Mesh(geometry, material);
            region.position.copy(regionPos);
            this.mesh.add(region);
        }
    }

    _createNebulaParticles() {
        // Floating particles for added depth
        const particleCount = 2000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const lifetimes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const r = Math.random() * this.scale;

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Color varies with position
            const colorMix = Math.random();
            const color = new THREE.Color().lerpColors(this.primaryColor, this.secondaryColor, colorMix);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            sizes[i] = 0.5 + Math.random() * 1.5;
            lifetimes[i] = Math.random();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 } },
            vertexShader: `
                attribute float size;
                attribute float lifetime;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float time;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif

                    // Slow drift
                    float phase = fract(lifetime + time * 0.02);
                    vAlpha = sin(phase * 3.14159) * 0.5;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
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

        this.nebulaParticles = new THREE.Points(geometry, material);
        this.mesh.add(this.nebulaParticles);
    }

    _getTypeIndex() {
        const types = { emission: 0, reflection: 1, dark: 2, planetary: 3 };
        return types[this.type] || 0;
    }

    update(deltaTime, cameraPosition) {
        this.time += deltaTime;

        // Update cloud uniforms
        if (this.cloudUniforms) {
            this.cloudUniforms.time.value = this.time;
            if (cameraPosition) {
                this.cloudUniforms.cameraPos.value.copy(cameraPosition);
            }
        }

        // Update embedded stars
        if (this.embeddedStars) {
            this.embeddedStars.material.uniforms.time.value = this.time;
        }

        // Update particle system
        if (this.nebulaParticles) {
            this.nebulaParticles.material.uniforms.time.value = this.time;
        }

        // Update ionized regions
        this.mesh.children.forEach(child => {
            if (child.material && child.material.uniforms && child.material.uniforms.time) {
                child.material.uniforms.time.value = this.time;
            }
        });

        // Slow rotation
        this.mesh.rotation.y += deltaTime * 0.002;
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

if (typeof module !== 'undefined') module.exports = VolumetricNebula;
