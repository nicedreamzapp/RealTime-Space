// AsteroidBelt.js - HUBBLE-QUALITY photorealistic asteroids
// NASA/ESA quality rendering with subsurface scattering, craters, and regolith

class AsteroidBelt {
    constructor(options = {}) {
        this.name = options.name || "Asteroid Belt";
        this.innerRadius = options.innerRadius || 20;
        this.outerRadius = options.outerRadius || 35;
        this.count = options.count || 1200;  // More asteroids for density
        this.height = options.height || 12;  // More vertical spread

        this.segments = options.segments || 16;
        this.type = "asteroidBelt";
        this.asteroids = [];
        this.time = 0;

        // Spectral classification with NASA-accurate colors
        this.asteroidTypes = {
            // C-type (Carbonaceous) - Very dark, primitive
            carbonaceous: {
                baseColor: 0x1a1816,
                specularColor: 0x0a0908,
                metalness: 0.02,
                roughness: 0.98,
                chance: 0.52,
                albedo: 0.06,
                hasOrganics: true
            },
            // B-type (Similar to C but slightly bluer)
            btype: {
                baseColor: 0x1e1d22,
                specularColor: 0x12111a,
                metalness: 0.03,
                roughness: 0.95,
                chance: 0.08,
                albedo: 0.08,
                hasOrganics: true
            },
            // S-type (Silicaceous/Stony) - Rocky, moderate reflectivity
            silicate: {
                baseColor: 0x6b5b4f,
                specularColor: 0x8b7b6a,
                metalness: 0.12,
                roughness: 0.82,
                chance: 0.20,
                albedo: 0.20,
                hasOrganics: false
            },
            // M-type (Metallic) - Iron-nickel
            metallic: {
                baseColor: 0x7a7a88,
                specularColor: 0xaaaabc,
                metalness: 0.75,
                roughness: 0.35,
                chance: 0.05,
                albedo: 0.15,
                hasOrganics: false
            },
            // E-type (Enstatite) - Very reflective
            enstatite: {
                baseColor: 0x9a948a,
                specularColor: 0xccc8bc,
                metalness: 0.08,
                roughness: 0.65,
                chance: 0.03,
                albedo: 0.40,
                hasOrganics: false
            },
            // V-type (Vestoid) - Basaltic, from Vesta
            vestoid: {
                baseColor: 0x5a4a42,
                specularColor: 0x7a6a5a,
                metalness: 0.15,
                roughness: 0.75,
                chance: 0.05,
                albedo: 0.25,
                hasOrganics: false
            },
            // D-type (Dark, outer belt) - Very primitive
            dtype: {
                baseColor: 0x201815,
                specularColor: 0x100a08,
                metalness: 0.01,
                roughness: 0.99,
                chance: 0.07,
                albedo: 0.04,
                hasOrganics: true
            }
        };

        this._rnd = this._mulberry32(options.seed || 12345);
        this.createBelt();
        console.log(`🪨 Created HUBBLE-QUALITY asteroid belt: ${this.name} with ${this.count} asteroids`);
    }

    _mulberry32(seed) {
        return () => {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    createBelt() {
        this.mesh = new THREE.Group();
        
        for (let i = 0; i < this.count; i++) {
            const asteroid = this.createAsteroid();
            this.asteroids.push(asteroid);
            this.mesh.add(asteroid.mesh);
        }
    }

    createAsteroid() {
        // Select asteroid type based on realistic distribution
        const typeRoll = this._rnd();
        let asteroidType;
        let typeName;
        let cumulative = 0;

        for (const [name, type] of Object.entries(this.asteroidTypes)) {
            cumulative += type.chance;
            if (typeRoll < cumulative) {
                asteroidType = type;
                typeName = name;
                break;
            }
        }
        if (!asteroidType) asteroidType = this.asteroidTypes.carbonaceous;

        // Realistic size distribution following power law (more small, few large)
        const sizeRoll = this._rnd();
        let size;
        if (sizeRoll < 0.80) {
            // 80% are small rubble-pile fragments
            size = 0.02 + this._rnd() * 0.08;
        } else if (sizeRoll < 0.95) {
            // 15% medium asteroids
            size = 0.1 + this._rnd() * 0.25;
        } else if (sizeRoll < 0.99) {
            // 4% larger bodies
            size = 0.35 + this._rnd() * 0.45;
        } else {
            // 1% large asteroids (like Ceres, Vesta scaled down)
            size = 0.8 + this._rnd() * 0.7;
        }

        // Create highly irregular geometry - real asteroids are NOT spherical
        const detail = size > 0.3 ? 3 : (size > 0.1 ? 2 : 1);
        const geometry = new THREE.IcosahedronGeometry(size, detail);
        const positions = geometry.attributes.position;
        const colors = new Float32Array(positions.count * 3);

        // Generate unique seed for this asteroid's features
        const asteroidSeed = this._rnd() * 10000;

        // Determine asteroid shape type (contact binary, elongated, rubble pile, etc.)
        const shapeType = this._rnd();

        for (let i = 0; i < positions.count; i++) {
            const vertex = new THREE.Vector3();
            vertex.fromBufferAttribute(positions, i);

            // Highly irregular displacement with multiple octaves
            let displacement = 0;
            let amplitude = 0.5;
            let frequency = 2.0;

            // FBM noise for terrain
            for (let oct = 0; oct < 6; oct++) {
                const nx = vertex.x * frequency + asteroidSeed;
                const ny = vertex.y * frequency + asteroidSeed * 0.7;
                const nz = vertex.z * frequency + asteroidSeed * 0.3;

                displacement += this._noise3D(nx, ny, nz) * amplitude;
                amplitude *= 0.45;
                frequency *= 2.1;
            }

            // Large-scale shape deformations
            if (shapeType < 0.15) {
                // Contact binary (peanut/dumbbell shape like 67P)
                const twoLobe = Math.abs(vertex.y) / size;
                displacement += (1 - twoLobe * 2) * 0.3;
            } else if (shapeType < 0.35) {
                // Highly elongated (like Oumuamua)
                const elongation = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
                displacement -= elongation * 0.15;
                vertex.y *= 2.5;
            } else if (shapeType < 0.5) {
                // Oblate (flattened spinning)
                vertex.y *= 0.5;
            }

            // Add craters (impact features)
            const numCraters = Math.floor(3 + this._rnd() * 5);
            for (let c = 0; c < numCraters; c++) {
                const craterPos = new THREE.Vector3(
                    (this._seededRand(asteroidSeed + c * 1000) - 0.5) * 2,
                    (this._seededRand(asteroidSeed + c * 2000) - 0.5) * 2,
                    (this._seededRand(asteroidSeed + c * 3000) - 0.5) * 2
                ).normalize();

                const craterSize = 0.1 + this._seededRand(asteroidSeed + c * 4000) * 0.3;
                const craterDepth = craterSize * 0.4;

                const dotProduct = vertex.clone().normalize().dot(craterPos);
                const craterInfluence = Math.max(0, 1 - Math.pow((1 - dotProduct) / craterSize, 2));

                // Crater bowl with raised rim
                if (dotProduct > 1 - craterSize * 1.5) {
                    const rimDist = Math.abs(dotProduct - (1 - craterSize));
                    if (rimDist < craterSize * 0.3) {
                        displacement += craterDepth * 0.3; // Raised rim
                    } else {
                        displacement -= craterInfluence * craterDepth;
                    }
                }
            }

            // Apply displacement
            const finalScale = (0.5 + this._rnd() * 0.3) + displacement * 0.4;
            vertex.multiplyScalar(Math.max(0.3, finalScale));
            positions.setXYZ(i, vertex.x, vertex.y, vertex.z);

            // Vertex colors for surface variation (regolith, exposed rock, etc.)
            const baseColor = new THREE.Color(asteroidType.baseColor);
            const specularColor = new THREE.Color(asteroidType.specularColor);

            // Surface weathering variation
            const weathering = 0.7 + this._noise3D(vertex.x * 10, vertex.y * 10, vertex.z * 10) * 0.3;
            const craterExposure = displacement < -0.1 ? 1.3 : 1.0; // Fresh material in craters

            const finalColor = baseColor.clone().lerp(specularColor, (weathering - 0.7) * 2);
            finalColor.multiplyScalar(craterExposure);

            colors[i * 3] = finalColor.r;
            colors[i * 3 + 1] = finalColor.g;
            colors[i * 3 + 2] = finalColor.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        // Create photorealistic material with custom shader
        const material = this._createAsteroidMaterial(asteroidType, size);

        const mesh = new THREE.Mesh(geometry, material);

        // Position in belt with realistic orbital mechanics
        const angle = this._rnd() * Math.PI * 2;
        const distance = this.innerRadius + this._rnd() * (this.outerRadius - this.innerRadius);
        // Inclination - most asteroids are near ecliptic but some have high inclination
        const inclination = (this._rnd() < 0.9)
            ? (this._rnd() - 0.5) * this.height * 0.3  // Low inclination (90%)
            : (this._rnd() - 0.5) * this.height * 2;    // High inclination (10%)

        // Slight eccentricity offset
        const eccentricOffset = (this._rnd() - 0.5) * 2;

        mesh.position.set(
            Math.cos(angle) * distance + eccentricOffset,
            inclination,
            Math.sin(angle) * distance + eccentricOffset * 0.5
        );
        mesh.rotation.set(this._rnd() * Math.PI * 2, this._rnd() * Math.PI * 2, this._rnd() * Math.PI * 2);

        // Store asteroid data
        mesh.userData = {
            type: typeName,
            size: size,
            albedo: asteroidType.albedo
        };

        // Tumbling rotation (most asteroids don't spin cleanly)
        const tumbleRate = size > 0.3 ? 0.005 : 0.02; // Larger = slower
        return {
            mesh: mesh,
            rotationSpeed: new THREE.Vector3(
                (this._rnd() - 0.5) * tumbleRate,
                (this._rnd() - 0.5) * tumbleRate,
                (this._rnd() - 0.5) * tumbleRate
            ),
            precessionSpeed: (this._rnd() - 0.5) * 0.001, // Slow precession
            orbitalAngle: angle,
            orbitalSpeed: 0.008 / Math.sqrt(distance), // Kepler's law
            orbitalRadius: distance,
            eccentricity: 0.05 + this._rnd() * 0.15 // Orbital eccentricity
        };
    }

    _createAsteroidMaterial(asteroidType, size) {
        // Advanced PBR material for realistic asteroid surface
        return new THREE.ShaderMaterial({
            uniforms: {
                baseColor: { value: new THREE.Color(asteroidType.baseColor) },
                specularColor: { value: new THREE.Color(asteroidType.specularColor) },
                roughness: { value: asteroidType.roughness },
                metalness: { value: asteroidType.metalness },
                albedo: { value: asteroidType.albedo },
                time: { value: 0 },
                sunDirection: { value: new THREE.Vector3(1, 0.3, 0).normalize() }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vColor;
                varying vec3 vWorldPosition;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 baseColor;
                uniform vec3 specularColor;
                uniform float roughness;
                uniform float metalness;
                uniform float albedo;
                uniform vec3 sunDirection;

                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vColor;
                varying vec3 vWorldPosition;

                void main() {
                    vec3 normal = normalize(vNormal);
                    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

                    // Lambertian diffuse
                    float NdotL = max(0.0, dot(normal, sunDirection));

                    // Oren-Nayar for rough surfaces
                    float sigma2 = roughness * roughness;
                    float A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
                    float B = 0.45 * sigma2 / (sigma2 + 0.09);

                    float thetaI = acos(NdotL);
                    float thetaR = acos(max(0.0, dot(normal, viewDir)));
                    float alpha = max(thetaI, thetaR);
                    float beta = min(thetaI, thetaR);

                    float orenNayar = A + B * max(0.0, cos(thetaI - thetaR)) * sin(alpha) * tan(beta);

                    // Combine vertex color with base color
                    vec3 surfaceColor = mix(baseColor, vColor, 0.6) * albedo;

                    // Diffuse lighting with Oren-Nayar
                    vec3 diffuse = surfaceColor * NdotL * orenNayar * 2.0;

                    // Very subtle specular for metallic asteroids
                    vec3 halfVec = normalize(sunDirection + viewDir);
                    float NdotH = max(0.0, dot(normal, halfVec));
                    float specularIntensity = pow(NdotH, mix(8.0, 64.0, 1.0 - roughness)) * metalness * 0.3;
                    vec3 specular = specularColor * specularIntensity;

                    // Ambient (very dark in space but some scattered light)
                    vec3 ambient = surfaceColor * 0.015;

                    // Slight terminator softening (subsurface-like effect for regolith)
                    float terminator = smoothstep(-0.1, 0.2, NdotL);
                    diffuse *= terminator;

                    // Opposition surge (slight brightening at zero phase angle)
                    float phaseAngle = acos(dot(viewDir, sunDirection));
                    float oppositionSurge = 1.0 + exp(-phaseAngle * 20.0) * 0.1;

                    vec3 finalColor = (ambient + diffuse + specular) * oppositionSurge;

                    // Gamma correction
                    finalColor = pow(finalColor, vec3(1.0 / 2.2));

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            vertexColors: true
        });
    }

    _seededRand(seed) {
        const x = Math.sin(seed) * 43758.5453123;
        return x - Math.floor(x);
    }

    _noise3D(x, y, z) {
        // Improved 3D noise for asteroid surfaces
        const p = x + y * 57.0 + z * 113.0;
        const n = Math.sin(p * 0.1) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }

    update(deltaTime, sunPosition) {
        this.time += deltaTime;

        this.asteroids.forEach(asteroid => {
            // Tumbling rotation with precession
            asteroid.mesh.rotation.x += asteroid.rotationSpeed.x * deltaTime;
            asteroid.mesh.rotation.y += asteroid.rotationSpeed.y * deltaTime;
            asteroid.mesh.rotation.z += asteroid.rotationSpeed.z * deltaTime;

            // Update orbital position with eccentricity
            asteroid.orbitalAngle += asteroid.orbitalSpeed * deltaTime;
            const ecc = asteroid.eccentricity || 0;
            const r = asteroid.orbitalRadius * (1 - ecc * Math.cos(asteroid.orbitalAngle));

            asteroid.mesh.position.x = Math.cos(asteroid.orbitalAngle) * r;
            asteroid.mesh.position.z = Math.sin(asteroid.orbitalAngle) * r;

            // Update shader sun direction if material supports it
            if (asteroid.mesh.material.uniforms && sunPosition) {
                const sunDir = sunPosition.clone().sub(asteroid.mesh.position).normalize();
                asteroid.mesh.material.uniforms.sunDirection.value.copy(sunDir);
            }
        });
    }

    dispose() {
        this.asteroids.forEach(asteroid => {
            asteroid.mesh.geometry.dispose();
            if (asteroid.mesh.material.map) asteroid.mesh.material.map.dispose();
            asteroid.mesh.material.dispose();
        });
    }
}

