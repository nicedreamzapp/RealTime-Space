// WarpEffect.js - EPIC Warp Speed / Hyperspace Effect
// Star streaking, tunnel effect, and dimensional distortion

class WarpEffect {
    constructor(config = {}) {
        this.active = false;
        this.intensity = 0;
        this.targetIntensity = 0;
        this.maxIntensity = config.maxIntensity || 1.0;
        this.rampSpeed = config.rampSpeed || 2.0;
        this.streakCount = config.streakCount || 3000;
        this.tunnelEnabled = config.tunnel !== false;

        this.time = 0;
        this.createMesh();

        console.log("🚀 WarpEffect: Hyperspace drive initialized!");
    }

    createMesh() {
        this.mesh = new THREE.Group();
        this.mesh.name = "WarpEffect";

        // Star streaks
        this._createStarStreaks();

        // Hyperspace tunnel
        if (this.tunnelEnabled) {
            this._createHyperspaceTunnel();
        }


        // Speed lines on edges
        this._createSpeedLines();
    }

    _createStarStreaks() {
        const positions = new Float32Array(this.streakCount * 6); // Line segments
        const colors = new Float32Array(this.streakCount * 6);
        const velocities = new Float32Array(this.streakCount * 2);
        const offsets = new Float32Array(this.streakCount);

        for (let i = 0; i < this.streakCount; i++) {
            // Random position in cylinder around camera
            const theta = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 50;
            const z = (Math.random() - 0.5) * 200;

            const x = Math.cos(theta) * radius;
            const y = Math.sin(theta) * radius;

            // Start point
            positions[i * 6] = x;
            positions[i * 6 + 1] = y;
            positions[i * 6 + 2] = z;

            // End point (will be calculated in shader based on velocity)
            positions[i * 6 + 3] = x;
            positions[i * 6 + 4] = y;
            positions[i * 6 + 5] = z - 0.1;

            // Color based on position (creates rainbow spectrum effect at high warp)
            const hue = (theta / (Math.PI * 2) + z / 200 + 0.5) % 1.0;
            const color = new THREE.Color().setHSL(hue, 0.7, 0.8);

            colors[i * 6] = color.r;
            colors[i * 6 + 1] = color.g;
            colors[i * 6 + 2] = color.b;
            colors[i * 6 + 3] = color.r;
            colors[i * 6 + 4] = color.g;
            colors[i * 6 + 5] = color.b;

            velocities[i * 2] = 0.5 + Math.random() * 0.5; // Speed variation
            velocities[i * 2 + 1] = radius; // Store radius for calculations
            offsets[i] = Math.random(); // Phase offset
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // Store original positions for reset
        this._originalPositions = positions.slice();
        this._velocities = velocities;
        this._offsets = offsets;

        this.streakUniforms = {
            time: { value: 0 },
            intensity: { value: 0 },
            streakLength: { value: 0.1 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.streakUniforms,
            vertexShader: `
                varying vec3 vColor;
                varying float vIntensity;
                uniform float intensity;
                uniform float time;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif
                    vIntensity = intensity;

                    vec3 pos = position;

                    // Stretch towards camera based on intensity
                    float stretch = intensity * 10.0;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vIntensity;

                void main() {
                    vec3 color = vColor;

                    // More vibrant at high intensity
                    color = mix(vec3(1.0), color, vIntensity);

                    // Glow effect
                    float glow = 1.3 + vIntensity * 2.0;

                    // More opaque so the streaks read clearly as motion even at low speed.
                    gl_FragColor = vec4(color * glow, min(1.0, 0.35 + vIntensity) * 0.9);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        this.starStreaks = new THREE.LineSegments(geometry, material);
        this.mesh.add(this.starStreaks);
    }

    _createHyperspaceTunnel() {
        // Cylindrical tunnel with flowing energy
        const tunnelLength = 500;
        const tunnelRadius = 80;
        const geometry = new THREE.CylinderGeometry(tunnelRadius, tunnelRadius, tunnelLength, 64, 32, true);

        this.tunnelUniforms = {
            time: { value: 0 },
            intensity: { value: 0 },
            tunnelLength: { value: tunnelLength }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.tunnelUniforms,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPosition;
                varying vec3 vNormal;

                void main() {
                    vUv = uv;
                    vPosition = position;
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform float intensity;
                uniform float tunnelLength;

                varying vec2 vUv;
                varying vec3 vPosition;
                varying vec3 vNormal;

                // Simplex noise
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                                        -0.577350269189626, 0.024390243902439);
                    vec2 i  = floor(v + dot(v, C.yy));
                    vec2 x0 = v - i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;
                    i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                                     + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                                            dot(x12.zw,x12.zw)), 0.0);
                    m = m*m;
                    m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g;
                    g.x = a0.x * x0.x + h.x * x0.y;
                    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }

                void main() {
                    if (intensity < 0.01) discard;

                    // Flowing energy pattern
                    float angle = vUv.x * 6.28318;
                    float flow = vUv.y + time * 2.0;

                    // Multiple layers of energy streams
                    float energy1 = sin(angle * 8.0 + flow * 20.0) * 0.5 + 0.5;
                    float energy2 = sin(angle * 16.0 - flow * 30.0) * 0.5 + 0.5;
                    float energy3 = snoise(vec2(angle * 4.0, flow * 5.0)) * 0.5 + 0.5;

                    float energy = energy1 * 0.4 + energy2 * 0.3 + energy3 * 0.3;
                    energy = pow(energy, 2.0);

                    // Color shifts based on flow
                    vec3 color1 = vec3(0.2, 0.5, 1.0); // Blue
                    vec3 color2 = vec3(0.8, 0.3, 1.0); // Purple
                    vec3 color3 = vec3(1.0, 0.5, 0.3); // Orange

                    float colorMix = sin(flow * 3.0) * 0.5 + 0.5;
                    vec3 baseColor = mix(color1, color2, colorMix);
                    baseColor = mix(baseColor, color3, energy3 * 0.3);

                    // Fresnel for edge glow
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);

                    // Distance fade
                    float distanceFade = 1.0 - abs(vUv.y - 0.5) * 2.0;
                    distanceFade = pow(distanceFade, 0.5);

                    vec3 finalColor = baseColor * energy * 2.0;
                    float alpha = energy * fresnel * intensity * distanceFade * 0.6;

                    gl_FragColor = vec4(finalColor, alpha);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.hyperspaceTunnel = new THREE.Mesh(geometry, material);
        this.hyperspaceTunnel.rotation.x = Math.PI / 2;
        this.mesh.add(this.hyperspaceTunnel);
    }

    _createSpeedLines() {
        // Radial speed lines from center
        const lineCount = 100;
        const positions = new Float32Array(lineCount * 6);
        const opacities = new Float32Array(lineCount * 2);

        for (let i = 0; i < lineCount; i++) {
            const angle = (i / lineCount) * Math.PI * 2;
            const innerRadius = 20;
            const outerRadius = 80;

            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            // Inner point
            positions[i * 6] = cos * innerRadius;
            positions[i * 6 + 1] = sin * innerRadius;
            positions[i * 6 + 2] = 0;

            // Outer point
            positions[i * 6 + 3] = cos * outerRadius;
            positions[i * 6 + 4] = sin * outerRadius;
            positions[i * 6 + 5] = 0;

            opacities[i * 2] = 0.8;
            opacities[i * 2 + 1] = 0.0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

        this.speedLineUniforms = {
            time: { value: 0 },
            intensity: { value: 0 }
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.speedLineUniforms,
            vertexShader: `
                attribute float opacity;
                varying float vOpacity;
                uniform float intensity;

                void main() {
                    vOpacity = opacity * intensity;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying float vOpacity;

                void main() {
                    vec3 color = vec3(0.5, 0.7, 1.0);
                    gl_FragColor = vec4(color, vOpacity * 0.5);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.speedLines = new THREE.LineSegments(geometry, material);
        this.speedLines.position.z = -50;
        this.mesh.add(this.speedLines);
    }

    // Activate warp effect
    engage(intensity = 1.0) {
        this.active = true;
        this.targetIntensity = Math.min(intensity, this.maxIntensity);
        console.log("🚀 WARP ENGAGED!");
    }

    // Deactivate warp effect
    disengage() {
        this.active = false;
        this.targetIntensity = 0;
        console.log("🛑 Warp disengaged");
    }

    // Set intensity directly (for thrust-based control)
    setIntensity(value) {
        this.targetIntensity = Math.max(0, Math.min(this.maxIntensity, value));
        this.active = value > 0;
    }

    update(deltaTime, cameraPosition, cameraDirection) {
        this.time += deltaTime;

        // Smooth intensity transition
        const intensityDiff = this.targetIntensity - this.intensity;
        this.intensity += intensityDiff * Math.min(1, deltaTime * this.rampSpeed);

        // Update all uniforms
        if (this.streakUniforms) {
            this.streakUniforms.time.value = this.time;
            this.streakUniforms.intensity.value = this.intensity;
            this.streakUniforms.streakLength.value = 0.1 + this.intensity * 5.0;
        }

        if (this.tunnelUniforms) {
            this.tunnelUniforms.time.value = this.time;
            this.tunnelUniforms.intensity.value = this.intensity;
        }


        if (this.speedLineUniforms) {
            this.speedLineUniforms.time.value = this.time;
            this.speedLineUniforms.intensity.value = this.intensity;
        }

        // Animate star streaks
        if (this.starStreaks && this.intensity > 0.01) {
            const positions = this.starStreaks.geometry.attributes.position.array;
            const originalPositions = this._originalPositions;
            const velocities = this._velocities;
            const offsets = this._offsets;

            for (let i = 0; i < this.streakCount; i++) {
                // Move stars towards camera (negative Z)
                const speed = velocities[i * 2] * this.intensity * 200 * deltaTime;
                const radius = velocities[i * 2 + 1];

                // Update Z positions
                positions[i * 6 + 2] -= speed;
                positions[i * 6 + 5] -= speed;

                // Reset stars that pass the camera
                if (positions[i * 6 + 2] < -100) {
                    positions[i * 6 + 2] = 100;
                    positions[i * 6 + 5] = 100 - 0.1 - this.intensity * 5;
                }

                // Stretch based on intensity
                const stretch = this.intensity * 10;
                positions[i * 6 + 5] = positions[i * 6 + 2] - 0.1 - stretch;
            }

            this.starStreaks.geometry.attributes.position.needsUpdate = true;
        }

        // Update mesh position to follow camera
        if (cameraPosition) {
            this.mesh.position.copy(cameraPosition);
        }

        // Orient tunnel with camera
        if (cameraDirection && this.hyperspaceTunnel) {
            // Tunnel faces forward
            const lookAt = new THREE.Vector3().copy(cameraPosition).add(cameraDirection);
            this.hyperspaceTunnel.lookAt(lookAt);
        }

        // Hide mesh when not active
        this.mesh.visible = this.intensity > 0.001;
    }

    // Resize handler
    onResize(width, height) {
    }

    dispose() {
        this.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}

if (typeof module !== 'undefined') module.exports = WarpEffect;
