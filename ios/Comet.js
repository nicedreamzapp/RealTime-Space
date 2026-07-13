// Comet.js - HUBBLE-QUALITY comet with realistic dual-tail physics
// Features: Ion tail (blue), Dust tail (yellow), coma jets, outgassing particles

class Comet {
    constructor(options = {}) {
        this.name = options.name || "Unnamed Comet";
        this.radius = options.radius || 0.8;
        this.color = options.color || 0xaaddff;
        this.orbitalData = options.orbitalData || null;

        this.type = "comet";
        this.angle = options.startAngle || 0;
        this.time = 0;

        // Distance from sun affects tail brightness
        this.distanceFromSun = 100;
        this.perihelion = options.perihelion || 30;  // Closest approach
        this.aphelion = options.aphelion || 150;      // Furthest point

        this.createComet();
        console.log(`☄️ Created HUBBLE-QUALITY comet: ${this.name}`);
    }

    createComet() {
        this.mesh = new THREE.Group();

        // Create nucleus with irregular shape
        this._createNucleus();

        // Create coma (glowing gas cloud)
        this._createComa();

        // Create dual tail system
        this._createIonTail();
        this._createDustTail();

        // Create particle jets
        this._createParticleJets();

        // Create outgassing effect
        this._createOutgassing();
    }

    _createNucleus() {
        // Irregular potato-shaped nucleus
        const geometry = new THREE.IcosahedronGeometry(this.radius, 2);
        const positions = geometry.attributes.position;

        // Deform for irregular comet shape
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);

            // Multi-octave noise for realistic surface
            let noise = 0;
            noise += Math.sin(x * 5 + y * 3) * 0.15;
            noise += Math.sin(y * 7 - z * 4) * 0.1;
            noise += Math.sin(z * 6 + x * 2) * 0.08;

            const scale = 0.7 + Math.random() * 0.4 + noise;
            positions.setXYZ(i, x * scale, y * scale * 0.8, z * scale);
        }
        geometry.computeVertexNormals();

        // Dark, icy material with subtle blue tint
        const material = new THREE.MeshStandardMaterial({
            color: 0x1a1a22,
            roughness: 0.95,
            metalness: 0.05,
            emissive: 0x0a0a15,
            emissiveIntensity: 0.1
        });

        this.nucleus = new THREE.Mesh(geometry, material);
        this.nucleus.castShadow = true;
        this.mesh.add(this.nucleus);

        // Ice patches on nucleus
        this._addIcePatches();
    }

    _addIcePatches() {
        const patchCount = 8;
        for (let i = 0; i < patchCount; i++) {
            const patchGeo = new THREE.SphereGeometry(this.radius * 0.15, 8, 8);
            const patchMat = new THREE.MeshStandardMaterial({
                color: 0x88aacc,
                roughness: 0.3,
                metalness: 0.1,
                emissive: 0x224466,
                emissiveIntensity: 0.3
            });

            const patch = new THREE.Mesh(patchGeo, patchMat);

            // Random position on surface
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = this.radius * 0.85;

            patch.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi)
            );

            this.nucleus.add(patch);
        }
    }

    _createComa() {
        this.comaLayers = [];

        // Multiple coma layers for depth
        const layers = [
            { scale: 3, opacity: 0.25, color: 0xccddff },
            { scale: 5, opacity: 0.15, color: 0xaaccff },
            { scale: 8, opacity: 0.08, color: 0x88bbff },
            { scale: 12, opacity: 0.04, color: 0x6699ff }
        ];

        layers.forEach(layer => {
            const geometry = new THREE.SphereGeometry(this.radius * layer.scale, 24, 24);
            const material = new THREE.MeshBasicMaterial({
                color: layer.color,
                transparent: true,
                opacity: layer.opacity,
                side: THREE.BackSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const coma = new THREE.Mesh(geometry, material);
            this.mesh.add(coma);
            this.comaLayers.push(coma);
        });

        // Central bright glow
        const glowGeo = new THREE.SphereGeometry(this.radius * 2, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.centralGlow = new THREE.Mesh(glowGeo, glowMat);
        this.mesh.add(this.centralGlow);
    }

    _createIonTail() {
        // Ion tail - straight, blue, points directly away from sun
        const tailLength = this.radius * 80;
        const particleCount = 3000;

        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const baseColor = new THREE.Color(0x4488ff);

        for (let i = 0; i < particleCount; i++) {
            // Particles stream in narrow cone
            const t = Math.pow(Math.random(), 0.5);  // Concentration near nucleus
            const distance = t * tailLength;

            const spread = 0.5 + t * 2;  // Expands as it goes
            const x = (Math.random() - 0.5) * spread;
            const y = (Math.random() - 0.5) * spread;
            const z = distance;  // Away from sun

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            // Color fades from bright to dim
            const brightness = 1 - t * 0.7;
            colors[i * 3] = baseColor.r * brightness;
            colors[i * 3 + 1] = baseColor.g * brightness;
            colors[i * 3 + 2] = baseColor.b * brightness;

            sizes[i] = (0.1 + Math.random() * 0.2) * (1 - t * 0.5);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.3,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });

        this.ionTail = new THREE.Points(geometry, material);
        this.mesh.add(this.ionTail);
    }

    _createDustTail() {
        // Dust tail - curved, yellowish, follows orbital path
        const tailLength = this.radius * 60;
        const particleCount = 2500;

        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const baseColor = new THREE.Color(0xffddaa);

        for (let i = 0; i < particleCount; i++) {
            const t = Math.pow(Math.random(), 0.4);
            const distance = t * tailLength;

            // Curved path - dust lags behind orbital motion
            const curve = t * t * 15;  // Quadratic curve
            const spread = 1 + t * 4;

            const x = (Math.random() - 0.5) * spread + curve * 0.3;
            const y = (Math.random() - 0.5) * spread;
            const z = distance * 0.8;  // Slightly angled

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            const brightness = 1 - t * 0.6;
            colors[i * 3] = baseColor.r * brightness;
            colors[i * 3 + 1] = baseColor.g * brightness;
            colors[i * 3 + 2] = baseColor.b * brightness;

            sizes[i] = (0.15 + Math.random() * 0.25) * (1 - t * 0.4);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.4,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });

        this.dustTail = new THREE.Points(geometry, material);
        // Rotate dust tail to curve away from orbital direction
        this.dustTail.rotation.y = 0.3;
        this.mesh.add(this.dustTail);
    }

    _createParticleJets() {
        // Active jets from nucleus surface
        const jetCount = 800;
        const positions = new Float32Array(jetCount * 3);
        const velocities = new Float32Array(jetCount * 3);
        const lifetimes = new Float32Array(jetCount);

        for (let i = 0; i < jetCount; i++) {
            this._resetJetParticle(positions, velocities, lifetimes, i);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xccddff,
            size: 0.08,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.jets = new THREE.Points(geometry, material);
        this.jetVelocities = velocities;
        this.jetLifetimes = lifetimes;
        this.mesh.add(this.jets);
    }

    _resetJetParticle(positions, velocities, lifetimes, i) {
        // Start near nucleus surface
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;

        const r = this.radius * 1.1;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Velocity mostly outward + some toward tail
        const speed = 2 + Math.random() * 3;
        velocities[i * 3] = x / r * speed * 0.3;
        velocities[i * 3 + 1] = y / r * speed * 0.3;
        velocities[i * 3 + 2] = z / r * speed * 0.3 + speed * 0.7;

        lifetimes[i] = Math.random() * 2;
    }

    _createOutgassing() {
        // Subtle gas wisps around coma
        const wispCount = 500;
        const positions = new Float32Array(wispCount * 3);

        for (let i = 0; i < wispCount; i++) {
            const r = this.radius * (2 + Math.random() * 6);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x88aaff,
            size: 0.15,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.outgassing = new THREE.Points(geometry, material);
        this.mesh.add(this.outgassing);
    }

    update(deltaTime, rendererCore) {
        if (!this.mesh) return;

        this.time += deltaTime;

        // Update orbital position if orbital data exists
        if (this.orbitalData) {
            this.angle += deltaTime * (2 * Math.PI / this.orbitalData.orbitalPeriod);

            // Elliptical orbit
            const e = this.orbitalData.eccentricity || 0.5;
            const a = this.orbitalData.semiMajorAxis || 80;
            const r = a * (1 - e * e) / (1 + e * Math.cos(this.angle));

            this.mesh.position.x = r * Math.cos(this.angle);
            this.mesh.position.z = r * Math.sin(this.angle);

            this.distanceFromSun = r;
        }

        // Point tail away from sun
        const sunDir = this.mesh.position.clone().normalize();
        this.mesh.lookAt(this.mesh.position.clone().add(sunDir));

        // Tail brightness based on distance from sun
        const tailIntensity = Math.min(1, 50 / this.distanceFromSun);

        // Animate coma layers
        this.comaLayers.forEach((coma, i) => {
            coma.material.opacity = (0.04 + i * 0.07) * tailIntensity;
            const pulse = 1 + Math.sin(this.time * 2 + i) * 0.1;
            coma.scale.setScalar(pulse);
        });

        // Animate central glow
        if (this.centralGlow) {
            const glowPulse = 0.3 + Math.sin(this.time * 4) * 0.1;
            this.centralGlow.material.opacity = glowPulse * tailIntensity;
        }

        // Update ion tail particles
        this._updateIonTail(deltaTime, tailIntensity);

        // Update dust tail
        this._updateDustTail(deltaTime, tailIntensity);

        // Update jets
        this._updateJets(deltaTime, tailIntensity);

        // Rotate nucleus slowly
        this.nucleus.rotation.x += deltaTime * 0.1;
        this.nucleus.rotation.y += deltaTime * 0.15;

        // Rotate outgassing
        if (this.outgassing) {
            this.outgassing.rotation.y += deltaTime * 0.05;
        }
    }

    _updateIonTail(deltaTime, intensity) {
        if (!this.ionTail) return;

        const positions = this.ionTail.geometry.attributes.position.array;
        const particleCount = positions.length / 3;

        for (let i = 0; i < particleCount; i++) {
            // Stream particles away from sun
            positions[i * 3 + 2] += deltaTime * 20;

            // Add slight wave motion
            positions[i * 3] += Math.sin(this.time * 3 + i * 0.1) * deltaTime * 0.5;

            // Reset far particles
            if (positions[i * 3 + 2] > this.radius * 80) {
                positions[i * 3 + 2] = 0;
                positions[i * 3] = (Math.random() - 0.5) * 0.5;
                positions[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
            }
        }

        this.ionTail.geometry.attributes.position.needsUpdate = true;
        this.ionTail.material.opacity = 0.8 * intensity;
    }

    _updateDustTail(deltaTime, intensity) {
        if (!this.dustTail) return;

        const positions = this.dustTail.geometry.attributes.position.array;
        const particleCount = positions.length / 3;

        for (let i = 0; i < particleCount; i++) {
            // Dust moves slower and curves
            positions[i * 3 + 2] += deltaTime * 8;
            positions[i * 3] += deltaTime * 2;  // Lateral drift

            // Reset far particles
            if (positions[i * 3 + 2] > this.radius * 60) {
                positions[i * 3 + 2] = 0;
                positions[i * 3] = (Math.random() - 0.5);
                positions[i * 3 + 1] = (Math.random() - 0.5);
            }
        }

        this.dustTail.geometry.attributes.position.needsUpdate = true;
        this.dustTail.material.opacity = 0.6 * intensity;
    }

    _updateJets(deltaTime, intensity) {
        if (!this.jets) return;

        const positions = this.jets.geometry.attributes.position.array;
        const velocities = this.jetVelocities;
        const lifetimes = this.jetLifetimes;
        const particleCount = positions.length / 3;

        for (let i = 0; i < particleCount; i++) {
            lifetimes[i] -= deltaTime;

            if (lifetimes[i] <= 0) {
                this._resetJetParticle(positions, velocities, lifetimes, i);
            } else {
                positions[i * 3] += velocities[i * 3] * deltaTime;
                positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
                positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;
            }
        }

        this.jets.geometry.attributes.position.needsUpdate = true;
        this.jets.material.opacity = 0.7 * intensity;
    }

    dispose() {
        this.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}
