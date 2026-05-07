// ParticleSystem.js - CINEMATIC particle effects with GPU optimization
// Supports: ambient dust, engine exhaust, explosions, nebula clouds, warp trails

class ParticleSystem {
    constructor(options = {}) {
        this.name = options.name || "ParticleSystem";
        this.type = "particles";

        // Configuration
        this.count = options.count || 2000;
        this.color = options.color || 0xffffff;
        this.secondaryColor = options.secondaryColor || this.color;
        this.size = options.size || 1;
        this.area = options.area || 500;
        this.systemType = options.systemType || "ambient";
        this.velocity = options.velocity || { x: 0, y: 0, z: 0 };
        this.spread = options.spread || 10;
        this.lifetime = options.lifetime || 5;
        this.fadeOut = options.fadeOut !== undefined ? options.fadeOut : true;
        this.emissive = options.emissive || false;
        this.turbulence = options.turbulence || 0;

        this.time = 0;
        this.particles = [];

        this.createParticles();
        console.log(`✨ Created CINEMATIC ${this.systemType} particle system (${this.count} particles)`);
    }

    createParticles() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.count * 3);
        const colors = new Float32Array(this.count * 3);
        const sizes = new Float32Array(this.count);
        const lifetimes = new Float32Array(this.count);
        const randomSeeds = new Float32Array(this.count);
        const velocities = [];

        const baseColor = new THREE.Color(this.color);
        const secondColor = new THREE.Color(this.secondaryColor);

        for (let i = 0; i < this.count; i++) {
            // Position based on system type
            const pos = this._getInitialPosition(i);
            positions[i * 3] = pos.x;
            positions[i * 3 + 1] = pos.y;
            positions[i * 3 + 2] = pos.z;

            // Color with gradient between primary and secondary
            const colorMix = Math.random();
            const particleColor = baseColor.clone().lerp(secondColor, colorMix);
            // Add slight HSL variation for organic look
            particleColor.offsetHSL(
                (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.15
            );

            colors[i * 3] = particleColor.r;
            colors[i * 3 + 1] = particleColor.g;
            colors[i * 3 + 2] = particleColor.b;

            // Size variation based on type
            sizes[i] = this._getParticleSize(i);

            // Random lifetime offset for staggered animation
            lifetimes[i] = Math.random() * this.lifetime;

            // Random seed for shader noise
            randomSeeds[i] = Math.random();

            // Velocity
            velocities.push(this._getInitialVelocity(i, pos));
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
        geometry.setAttribute('randomSeed', new THREE.BufferAttribute(randomSeeds, 1));

        this.velocities = velocities;
        this.lifetimes = lifetimes;

        // Create procedural texture
        const texture = this._createParticleTexture();

        // Enhanced shader material for cinematic effects
        const material = new THREE.ShaderMaterial({
            uniforms: {
                pointTexture: { value: texture },
                time: { value: 0 },
                opacity: { value: 1.0 },
                emissiveStrength: { value: this.emissive ? 0.5 : 0.0 }
            },
            vertexShader: `
                attribute vec3 color;
                attribute float size;
                attribute float lifetime;
                attribute float randomSeed;

                varying vec3 vColor;
                varying float vLifetime;
                varying float vRandomSeed;
                varying float vDistance;

                uniform float time;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif
                    vLifetime = lifetime;
                    vRandomSeed = randomSeed;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vDistance = -mvPosition.z;

                    // Pulsing size based on time and random seed
                    float pulse = 1.0 + sin(time * 2.0 + randomSeed * 6.28) * 0.15;
                    float finalSize = size * pulse;

                    // Size attenuation
                    gl_PointSize = finalSize * (400.0 / -mvPosition.z);
                    gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D pointTexture;
                uniform float time;
                uniform float opacity;
                uniform float emissiveStrength;

                varying vec3 vColor;
                varying float vLifetime;
                varying float vRandomSeed;
                varying float vDistance;

                void main() {
                    vec4 tex = texture2D(pointTexture, gl_PointCoord);
                    if (tex.a < 0.05) discard;

                    // Distance-based fog (fade far particles)
                    float fog = 1.0 - smoothstep(100.0, 500.0, vDistance);

                    // Twinkle effect
                    float twinkle = 0.8 + 0.2 * sin(time * 4.0 + vRandomSeed * 10.0);

                    // Final color with emissive glow
                    vec3 finalColor = vColor * (1.0 + emissiveStrength);
                    float finalAlpha = tex.a * opacity * fog * twinkle;

                    gl_FragColor = vec4(finalColor, finalAlpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: true
        });

        this.points = new THREE.Points(geometry, material);
    }

    _getInitialPosition(index) {
        let x, y, z;

        switch (this.systemType) {
            case "ambient":
                // Scattered through cube
                x = (Math.random() - 0.5) * this.area;
                y = (Math.random() - 0.5) * this.area;
                z = (Math.random() - 0.5) * this.area;
                break;

            case "trail":
            case "exhaust":
                // Cone behind emitter
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * this.spread * 0.5;
                x = Math.cos(angle) * radius;
                y = Math.sin(angle) * radius;
                z = -Math.random() * this.spread * 2;
                break;

            case "explosion":
                // Spherical burst
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = Math.pow(Math.random(), 0.33) * this.spread;
                x = r * Math.sin(phi) * Math.cos(theta);
                y = r * Math.sin(phi) * Math.sin(theta);
                z = r * Math.cos(phi);
                break;

            case "nebula":
                // Clustered cloud with wisps
                const nebulaR = Math.pow(Math.random(), 0.5) * this.area * 0.5;
                const nebulaTheta = Math.random() * Math.PI * 2;
                const nebulaPhi = Math.acos(2 * Math.random() - 1);
                x = nebulaR * Math.sin(nebulaPhi) * Math.cos(nebulaTheta);
                y = nebulaR * Math.sin(nebulaPhi) * Math.sin(nebulaTheta) * 0.6; // Flatten
                z = nebulaR * Math.cos(nebulaPhi);
                break;

            case "warp":
                // Streaking lines
                x = (Math.random() - 0.5) * this.area * 0.3;
                y = (Math.random() - 0.5) * this.area * 0.3;
                z = (Math.random() - 0.5) * this.area;
                break;

            case "ring":
                // Orbital ring
                const ringAngle = Math.random() * Math.PI * 2;
                const ringRadius = this.spread + (Math.random() - 0.5) * this.spread * 0.3;
                x = Math.cos(ringAngle) * ringRadius;
                y = (Math.random() - 0.5) * this.spread * 0.1;
                z = Math.sin(ringAngle) * ringRadius;
                break;

            default:
                x = (Math.random() - 0.5) * this.area;
                y = (Math.random() - 0.5) * this.area;
                z = (Math.random() - 0.5) * this.area;
        }

        return { x, y, z };
    }

    _getInitialVelocity(index, position) {
        let vx, vy, vz;

        switch (this.systemType) {
            case "ambient":
                vx = (Math.random() - 0.5) * 0.5;
                vy = (Math.random() - 0.5) * 0.5;
                vz = (Math.random() - 0.5) * 0.5;
                break;

            case "trail":
            case "exhaust":
                vx = this.velocity.x + (Math.random() - 0.5) * this.spread * 0.1;
                vy = this.velocity.y + (Math.random() - 0.5) * this.spread * 0.1;
                vz = this.velocity.z - Math.random() * this.spread * 2;
                break;

            case "explosion":
                const speed = 20 + Math.random() * 30;
                const dir = new THREE.Vector3(position.x, position.y, position.z).normalize();
                vx = dir.x * speed;
                vy = dir.y * speed;
                vz = dir.z * speed;
                break;

            case "nebula":
                vx = (Math.random() - 0.5) * 0.2;
                vy = (Math.random() - 0.5) * 0.2;
                vz = (Math.random() - 0.5) * 0.2;
                break;

            case "warp":
                vx = 0;
                vy = 0;
                vz = -50 - Math.random() * 100;
                break;

            case "ring":
                // Orbital velocity
                const orbitSpeed = 2;
                const angle = Math.atan2(position.z, position.x);
                vx = -Math.sin(angle) * orbitSpeed;
                vy = (Math.random() - 0.5) * 0.1;
                vz = Math.cos(angle) * orbitSpeed;
                break;

            default:
                vx = this.velocity.x + (Math.random() - 0.5) * this.spread * 0.1;
                vy = this.velocity.y + (Math.random() - 0.5) * this.spread * 0.1;
                vz = this.velocity.z + (Math.random() - 0.5) * this.spread * 0.1;
        }

        return new THREE.Vector3(vx, vy, vz);
    }

    _getParticleSize(index) {
        let baseSize = this.size;

        switch (this.systemType) {
            case "ambient":
                return baseSize * (0.3 + Math.random() * 0.7);
            case "exhaust":
                return baseSize * (0.5 + Math.random() * 1.5);
            case "explosion":
                return baseSize * (0.8 + Math.random() * 1.2);
            case "nebula":
                return baseSize * (0.5 + Math.random() * 2);
            case "warp":
                return baseSize * (0.2 + Math.random() * 0.3);
            case "ring":
                return baseSize * (0.4 + Math.random() * 0.6);
            default:
                return baseSize * (0.5 + Math.random());
        }
    }

    _createParticleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Create soft, glowing particle
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.1, 'rgba(255, 255, 255, 0.9)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.05)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    update(deltaTime) {
        if (!this.points) return;

        this.time += deltaTime;
        this.points.material.uniforms.time.value = this.time;

        const positions = this.points.geometry.attributes.position.array;
        const sizes = this.points.geometry.attributes.size.array;
        const lifetimes = this.points.geometry.attributes.lifetime.array;

        for (let i = 0; i < this.count; i++) {
            const lifetimeProgress = (this.time - lifetimes[i]) / this.lifetime;

            if (lifetimeProgress >= 1 || lifetimeProgress < 0) {
                // Reset particle
                lifetimes[i] = this.time;
                const newPos = this._getInitialPosition(i);
                positions[i * 3] = newPos.x;
                positions[i * 3 + 1] = newPos.y;
                positions[i * 3 + 2] = newPos.z;
                this.velocities[i] = this._getInitialVelocity(i, newPos);
                sizes[i] = this._getParticleSize(i);
            } else {
                // Update position
                positions[i * 3] += this.velocities[i].x * deltaTime;
                positions[i * 3 + 1] += this.velocities[i].y * deltaTime;
                positions[i * 3 + 2] += this.velocities[i].z * deltaTime;

                // Apply turbulence
                if (this.turbulence > 0) {
                    const turbX = Math.sin(this.time * 2 + i * 0.1) * this.turbulence * deltaTime;
                    const turbY = Math.cos(this.time * 1.5 + i * 0.15) * this.turbulence * deltaTime;
                    const turbZ = Math.sin(this.time * 1.8 + i * 0.12) * this.turbulence * deltaTime;
                    positions[i * 3] += turbX;
                    positions[i * 3 + 1] += turbY;
                    positions[i * 3 + 2] += turbZ;
                }

                // Size fade for certain types
                if (this.fadeOut && this.systemType !== "ambient") {
                    const fadeStart = 0.6;
                    if (lifetimeProgress > fadeStart) {
                        const fadeProgress = (lifetimeProgress - fadeStart) / (1 - fadeStart);
                        sizes[i] = this._getParticleSize(i) * (1 - fadeProgress);
                    }
                }

                // Type-specific updates
                if (this.systemType === "explosion") {
                    // Slow down explosions
                    this.velocities[i].multiplyScalar(0.98);
                }
            }
        }

        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.size.needsUpdate = true;
        this.points.geometry.attributes.lifetime.needsUpdate = true;
    }

    setPosition(x, y, z) {
        if (this.points) {
            this.points.position.set(x, y, z);
        }
    }

    setVelocity(x, y, z) {
        this.velocity = { x, y, z };
    }

    setOpacity(opacity) {
        if (this.points && this.points.material.uniforms) {
            this.points.material.uniforms.opacity.value = opacity;
        }
    }

    burst() {
        // Trigger explosion effect
        const positions = this.points.geometry.attributes.position.array;

        for (let i = 0; i < this.count; i++) {
            const pos = { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] };
            const dir = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
            const speed = 30 + Math.random() * 50;
            this.velocities[i].copy(dir.multiplyScalar(speed));
            this.lifetimes[i] = this.time;
        }

        this.points.geometry.attributes.lifetime.needsUpdate = true;
    }

    getMesh() {
        return this.points;
    }

    dispose() {
        if (this.points) {
            this.points.geometry.dispose();
            this.points.material.dispose();
            if (this.points.material.uniforms.pointTexture.value) {
                this.points.material.uniforms.pointTexture.value.dispose();
            }
        }
    }
}
