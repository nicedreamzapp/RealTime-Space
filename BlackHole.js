// BlackHole.js - EPIC Black Hole with Gravitational Lensing, Accretion Disk, and Event Horizon
// Shader-based relativistic effects for jaw-dropping visuals

class BlackHole {
    constructor(config = {}) {
        this.name = config.name || "BlackHole";
        this.radius = config.radius || 3.0; // Schwarzschild radius
        this.mass = config.mass || 10.0;
        this.spinRate = config.spinRate || 0.5; // Kerr parameter
        this.accretionDiskEnabled = config.accretionDisk !== false;
        this.type = "blackhole";

        this.time = 0;
        this.createMesh();

        console.log(`🕳️ Created BLACK HOLE: ${this.name} with gravitational lensing`);
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = this.name;

        // Event horizon (the black sphere)
        this._createEventHorizon();

        // Photon sphere (where light orbits)
        this._createPhotonSphere();

        // Accretion disk with relativistic effects
        if (this.accretionDiskEnabled) {
            this._createAccretionDisk();
        }

        // Gravitational lensing effect
        this._createLensingEffect();

        // Jets (polar outflows)
        this._createRelativisticJets();

        // Hawking radiation particles
        this._createHawkingRadiation();
    }

    _createEventHorizon() {
        // The event horizon appears as absolute black
        const geometry = new THREE.SphereGeometry(this.radius, 64, 64);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                radius: { value: this.radius }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float radius;
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    // Absolute black with subtle edge glow
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 4.0);

                    // Extremely subtle purple/blue Hawking glow at edge
                    vec3 edgeGlow = vec3(0.1, 0.05, 0.2) * fresnel * 0.3;

                    // Core is pure black (absorbs all light)
                    vec3 color = edgeGlow;

                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });

        this.eventHorizon = new THREE.Mesh(geometry, material);
        this.mesh.add(this.eventHorizon);
    }

    _createPhotonSphere() {
        // Ring where light orbits at 1.5x Schwarzschild radius
        const photonRadius = this.radius * 1.5;
        const geometry = new THREE.TorusGeometry(photonRadius, 0.02, 16, 100);

        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });

        this.photonSphere = new THREE.Mesh(geometry, material);
        this.photonSphere.rotation.x = Math.PI / 2;
        this.mesh.add(this.photonSphere);
    }

    _createAccretionDisk() {
        // Epic accretion disk with Doppler beaming and gravitational redshift
        const innerRadius = this.radius * 2.5;
        const outerRadius = this.radius * 12;

        // Disk geometry
        const diskGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 256, 64);

        this.diskUniforms = {
            time: { value: 0 },
            innerRadius: { value: innerRadius },
            outerRadius: { value: outerRadius },
            schwarzschildRadius: { value: this.radius },
            spinRate: { value: this.spinRate }
        };

        const diskMaterial = new THREE.ShaderMaterial({
            uniforms: this.diskUniforms,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPosition;
                varying float vRadius;

                void main() {
                    vUv = uv;
                    vPosition = position;
                    vRadius = length(position.xy);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float innerRadius;
                uniform float outerRadius;
                uniform float schwarzschildRadius;
                uniform float spinRate;

                varying vec2 vUv;
                varying vec3 vPosition;
                varying float vRadius;

                // Noise for turbulence
                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }

                float noise(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);

                    float a = hash(i);
                    float b = hash(i + vec2(1.0, 0.0));
                    float c = hash(i + vec2(0.0, 1.0));
                    float d = hash(i + vec2(1.0, 1.0));

                    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
                }

                float fbm(vec2 p) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    for(int i = 0; i < 6; i++) {
                        value += amplitude * noise(p);
                        p *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                void main() {
                    // Orbital coordinates
                    float angle = atan(vPosition.y, vPosition.x);
                    float radius = vRadius;
                    float normalizedRadius = (radius - innerRadius) / (outerRadius - innerRadius);

                    // Keplerian orbital velocity (faster near black hole)
                    float orbitalSpeed = 2.0 / pow(radius / schwarzschildRadius, 1.5);
                    float rotatedAngle = angle - time * orbitalSpeed * spinRate;

                    // Spiral arm structure
                    float spiralArms = 4.0;
                    float spiral = sin(spiralArms * rotatedAngle + normalizedRadius * 20.0);

                    // Turbulence in the disk
                    vec2 turbUv = vec2(rotatedAngle * 3.0, normalizedRadius * 10.0);
                    float turbulence = fbm(turbUv + time * 0.5);

                    // Density variations
                    float density = 0.5 + 0.3 * spiral + 0.2 * turbulence;
                    density *= smoothstep(0.0, 0.2, normalizedRadius); // Fade near inner edge
                    density *= smoothstep(1.0, 0.7, normalizedRadius); // Fade near outer edge

                    // Temperature gradient (hotter near black hole)
                    float temperature = 1.0 / (normalizedRadius + 0.1);
                    temperature = clamp(temperature, 0.3, 3.0);

                    // Color from temperature (blackbody-ish)
                    vec3 hotColor = vec3(1.0, 0.9, 0.7);   // White-yellow
                    vec3 warmColor = vec3(1.0, 0.5, 0.1);  // Orange
                    vec3 coolColor = vec3(0.8, 0.2, 0.1);  // Red
                    vec3 coldColor = vec3(0.3, 0.1, 0.2);  // Dark red/purple

                    vec3 diskColor;
                    if (temperature > 2.0) {
                        diskColor = mix(warmColor, hotColor, (temperature - 2.0));
                    } else if (temperature > 1.0) {
                        diskColor = mix(coolColor, warmColor, temperature - 1.0);
                    } else {
                        diskColor = mix(coldColor, coolColor, temperature);
                    }

                    // Doppler beaming (approaching side brighter, receding dimmer)
                    float dopplerAngle = angle - time * spinRate;
                    float doppler = 1.0 + 0.5 * sin(dopplerAngle);

                    // Gravitational redshift (light loses energy escaping)
                    float redshift = 1.0 - schwarzschildRadius / (radius * 2.0);
                    redshift = max(0.2, redshift);

                    // Final color
                    vec3 finalColor = diskColor * density * doppler * temperature;
                    finalColor *= redshift;

                    // HDR boost for hot regions
                    finalColor *= 1.0 + max(0.0, temperature - 1.5) * 2.0;

                    // Alpha based on density
                    float alpha = density * 0.8;
                    alpha *= smoothstep(innerRadius, innerRadius * 1.2, radius);

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.accretionDisk = new THREE.Mesh(diskGeometry, diskMaterial);
        this.accretionDisk.rotation.x = -Math.PI / 2 + 0.3; // Slight tilt
        this.mesh.add(this.accretionDisk);

        // Add particle effects to the disk
        this._createDiskParticles(innerRadius, outerRadius);
    }

    _createDiskParticles(innerRadius, outerRadius) {
        const particleCount = 5000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
            const angle = Math.random() * Math.PI * 2;
            const height = (Math.random() - 0.5) * 0.5;

            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = height;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            // Hotter colors near center
            const temp = 1.0 - (radius - innerRadius) / (outerRadius - innerRadius);
            colors[i * 3] = 1.0;
            colors[i * 3 + 1] = 0.3 + temp * 0.6;
            colors[i * 3 + 2] = temp * 0.5;

            sizes[i] = 0.05 + Math.random() * 0.15;
            velocities[i] = 1.0 / Math.sqrt(radius); // Keplerian
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));

        this.particleUniforms = {
            time: { value: 0 },
            spinRate: { value: this.spinRate }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.particleUniforms,
            vertexShader: `
                attribute float size;
                attribute float velocity;
                varying vec3 vColor;
                uniform float time;
                uniform float spinRate;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif

                    vec3 pos = position;
                    float radius = length(pos.xz);
                    float angle = atan(pos.z, pos.x);
                    float newAngle = angle + time * velocity * spinRate;

                    pos.x = cos(newAngle) * radius;
                    pos.z = sin(newAngle) * radius;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (200.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    float alpha = smoothstep(0.5, 0.0, dist);
                    gl_FragColor = vec4(vColor * 2.0, alpha * 0.6);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        this.diskParticles = new THREE.Points(geometry, material);
        this.diskParticles.rotation.x = -Math.PI / 2 + 0.3;
        this.mesh.add(this.diskParticles);
    }

    _createLensingEffect() {
        // Gravitational lensing distortion sphere
        const lensRadius = this.radius * 8;
        const geometry = new THREE.SphereGeometry(lensRadius, 64, 64);

        this.lensingUniforms = {
            time: { value: 0 },
            schwarzschildRadius: { value: this.radius },
            lensRadius: { value: lensRadius },
            distortionStrength: { value: 2.0 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.lensingUniforms,
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float schwarzschildRadius;
                uniform float lensRadius;
                uniform float distortionStrength;

                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vWorldPosition;

                void main() {
                    float dist = length(vPosition);
                    float normalizedDist = dist / lensRadius;

                    // Einstein ring effect
                    float ringRadius = schwarzschildRadius * 2.6;
                    float ringDist = abs(dist - ringRadius);
                    float ring = exp(-ringDist * ringDist * 2.0) * 0.3;

                    // Fresnel for edge visibility
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);

                    // Lensing distortion visualization
                    float distortion = (1.0 - normalizedDist) * distortionStrength;
                    distortion = max(0.0, distortion);

                    // Subtle purple/blue glow
                    vec3 lensColor = vec3(0.3, 0.2, 0.5) * fresnel * 0.2;

                    // Einstein ring glow
                    vec3 ringColor = vec3(0.8, 0.9, 1.0) * ring;

                    vec3 finalColor = lensColor + ringColor;
                    float alpha = fresnel * 0.15 + ring * 0.5;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.lensingMesh = new THREE.Mesh(geometry, material);
        this.mesh.add(this.lensingMesh);
    }

    _createRelativisticJets() {
        // Bipolar relativistic jets
        const jetLength = this.radius * 30;
        const jetRadius = this.radius * 0.5;

        for (let direction of [1, -1]) {
            const jetGeometry = new THREE.ConeGeometry(jetRadius, jetLength, 32, 1, true);

            const jetMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    jetLength: { value: jetLength }
                },
                vertexShader: `
                    varying vec3 vPosition;
                    varying float vHeight;

                    void main() {
                        vPosition = position;
                        vHeight = (position.y + 0.5);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform float jetLength;
                    varying vec3 vPosition;
                    varying float vHeight;

                    void main() {
                        // Plasma color gradient
                        vec3 coreColor = vec3(0.6, 0.8, 1.0);
                        vec3 outerColor = vec3(0.2, 0.3, 0.8);

                        float radialDist = length(vPosition.xz);
                        vec3 jetColor = mix(coreColor, outerColor, radialDist * 5.0);

                        // Intensity falls off with distance
                        float intensity = exp(-vHeight * 3.0);

                        // Plasma turbulence
                        float turbulence = sin(vHeight * 20.0 + time * 5.0) * 0.2 + 0.8;

                        float alpha = intensity * turbulence * 0.5;

                        gl_FragColor = vec4(jetColor * 2.0, alpha);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const jet = new THREE.Mesh(jetGeometry, jetMaterial);
            jet.position.y = direction * jetLength / 2;
            if (direction < 0) jet.rotation.z = Math.PI;

            this.mesh.add(jet);
        }

        // Jet particles
        this._createJetParticles();
    }

    _createJetParticles() {
        const particleCount = 2000;
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const lifetimes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const direction = Math.random() > 0.5 ? 1 : -1;
            const height = Math.random() * this.radius * 30 * direction;
            const spread = Math.abs(height) * 0.05;

            positions[i * 3] = (Math.random() - 0.5) * spread;
            positions[i * 3 + 1] = height;
            positions[i * 3 + 2] = (Math.random() - 0.5) * spread;

            velocities[i * 3] = (Math.random() - 0.5) * 0.1;
            velocities[i * 3 + 1] = direction * (0.5 + Math.random() * 0.5);
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1;

            lifetimes[i] = Math.random();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { time: { value: 0 } },
            vertexShader: `
                attribute vec3 velocity;
                attribute float lifetime;
                varying float vAlpha;
                uniform float time;

                void main() {
                    float t = fract(lifetime + time * 0.2);
                    vec3 pos = position + velocity * t * 50.0;

                    vAlpha = sin(t * 3.14159) * 0.5;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = 3.0 * (100.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    vec3 color = vec3(0.5, 0.7, 1.0);
                    float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;

                    gl_FragColor = vec4(color * 2.0, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.jetParticles = new THREE.Points(geometry, material);
        this.mesh.add(this.jetParticles);
    }

    _createHawkingRadiation() {
        // Subtle quantum particles near event horizon
        const particleCount = 500;
        const positions = new Float32Array(particleCount * 3);
        const lifetimes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            const r = this.radius * (1.05 + Math.random() * 0.3);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            lifetimes[i] = Math.random();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                radius: { value: this.radius }
            },
            vertexShader: `
                attribute float lifetime;
                varying float vAlpha;
                uniform float time;
                uniform float radius;

                void main() {
                    float t = fract(lifetime + time * 0.5);

                    // Particles escape or fall in randomly
                    float escape = step(0.5, fract(lifetime * 12.34));
                    vec3 direction = normalize(position);
                    float displacement = (escape * 2.0 - 1.0) * t * radius * 0.5;

                    vec3 pos = position + direction * displacement;

                    vAlpha = sin(t * 3.14159) * 0.3;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = 2.0 * (50.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    // Quantum particles are white/purple
                    vec3 color = vec3(0.8, 0.7, 1.0);
                    float alpha = smoothstep(0.5, 0.0, dist) * vAlpha;

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.hawkingParticles = new THREE.Points(geometry, material);
        this.mesh.add(this.hawkingParticles);
    }

    update(deltaTime) {
        this.time += deltaTime;

        // Update all uniforms
        if (this.eventHorizon) {
            this.eventHorizon.material.uniforms.time.value = this.time;
        }

        if (this.diskUniforms) {
            this.diskUniforms.time.value = this.time;
        }

        if (this.particleUniforms) {
            this.particleUniforms.time.value = this.time;
        }

        if (this.lensingUniforms) {
            this.lensingUniforms.time.value = this.time;
        }

        if (this.jetParticles) {
            this.jetParticles.material.uniforms.time.value = this.time;
        }

        if (this.hawkingParticles) {
            this.hawkingParticles.material.uniforms.time.value = this.time;
        }

        // Rotate photon sphere
        if (this.photonSphere) {
            this.photonSphere.rotation.z += deltaTime * 0.5;
        }

        // Update jet materials
        this.mesh.children.forEach(child => {
            if (child.material && child.material.uniforms && child.material.uniforms.time) {
                child.material.uniforms.time.value = this.time;
            }
        });
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

if (typeof module !== 'undefined') module.exports = BlackHole;
