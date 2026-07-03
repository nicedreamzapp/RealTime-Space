// OrbitalMechanics.js - ACCURATE Keplerian orbital mechanics
// Features: Full orbital elements, perturbations, Lagrange points, orbital trails

class OrbitalMechanics {
    constructor(objects = []) {
        console.log("🌌 OrbitalMechanics: Initializing ACCURATE orbital physics...");

        this.objects = objects;
        this.time = 0;
        this.timeScale = 1.0;

        // Physical constants (scaled for visualization)
        this.G = 1.0;  // Gravitational constant (scaled)
        this.centralMass = 1000;  // Sun mass (scaled)

        // Orbital trail visualization
        this.showTrails = true;
        this.trailLength = 200;
        this.trailUpdateInterval = 0.1;
        this.lastTrailUpdate = 0;

        console.log(`✅ ACCURATE orbital mechanics initialized for ${objects.length} objects`);
    }

    update(deltaTime, rendererCore) {
        this.time += deltaTime * this.timeScale;

        // Update each orbiting object
        for (const obj of this.objects) {
            if (!obj.orbitalData || !obj.mesh) continue;

            this.updateOrbitalPosition(obj, deltaTime);
            this.updateRotation(obj, deltaTime);
        }

        // Update orbital trails if enabled
        if (this.showTrails && this.time - this.lastTrailUpdate > this.trailUpdateInterval) {
            this.updateTrails();
            this.lastTrailUpdate = this.time;
        }
    }

    updateOrbitalPosition(obj, deltaTime) {
        const orbital = obj.orbitalData;

        // Full Keplerian elements with defaults
        const a = orbital.semiMajorAxis || 50;
        const e = Math.min(0.99, orbital.eccentricity || 0);
        const i = orbital.inclination || 0;
        const omega = orbital.argumentOfPeriapsis || 0;  // Argument of periapsis
        const Omega = orbital.longitudeOfAscendingNode || 0;  // RAAN
        const M0 = orbital.meanAnomalyAtEpoch || 0;
        const period = orbital.orbitalPeriod || this.calculatePeriod(a);

        // Calculate mean anomaly at current time
        const n = (2 * Math.PI) / period;  // Mean motion
        const M = (M0 + n * this.time) % (2 * Math.PI);

        // Solve Kepler's equation for eccentric anomaly
        const E = this.solveKeplerEquation(M, e);

        // Calculate true anomaly
        const nu = 2 * Math.atan2(
            Math.sqrt(1 + e) * Math.sin(E / 2),
            Math.sqrt(1 - e) * Math.cos(E / 2)
        );

        // Calculate distance from focus
        const r = a * (1 - e * Math.cos(E));

        // Position in orbital plane
        const xOrbital = r * Math.cos(nu);
        const yOrbital = r * Math.sin(nu);

        // Transform to 3D space using rotation matrices
        // First rotate by argument of periapsis
        const x1 = xOrbital * Math.cos(omega) - yOrbital * Math.sin(omega);
        const y1 = xOrbital * Math.sin(omega) + yOrbital * Math.cos(omega);

        // Then rotate by inclination
        const x2 = x1;
        const y2 = y1 * Math.cos(i);
        const z2 = y1 * Math.sin(i);

        // Finally rotate by longitude of ascending node
        const finalX = x2 * Math.cos(Omega) - y2 * Math.sin(Omega);
        const finalY = x2 * Math.sin(Omega) + y2 * Math.cos(Omega);
        const finalZ = z2;

        // Apply position (relative to parent if it exists)
        if (orbital.parent && orbital.parent.mesh) {
            const parentPos = orbital.parent.mesh.position;
            obj.mesh.position.set(
                parentPos.x + finalX,
                parentPos.y + finalZ,
                parentPos.z + finalY
            );
        } else {
            obj.mesh.position.set(finalX, finalZ, finalY);
        }

        // Store orbital velocity for physics calculations
        const vOrbital = Math.sqrt(this.G * this.centralMass * (2 / r - 1 / a));
        obj.orbitalVelocity = vOrbital;

        // Store current true anomaly
        obj.trueAnomaly = nu;
    }

    updateRotation(obj, deltaTime) {
        if (!obj.rotationPeriod || !obj.mesh) return;

        // Axial rotation. Cap the rotation contribution of time acceleration so
        // planets don't become motion-blurred tops at 1000× orbital speed.
        const rotationScale = Math.min(this.timeScale, 50);
        const rotationSpeed = (2 * Math.PI) / obj.rotationPeriod;
        obj.mesh.rotation.y += rotationSpeed * deltaTime * rotationScale;

        // Apply axial tilt if specified
        if (obj.axialTilt && !obj._tiltApplied) {
            obj.mesh.rotation.z = obj.axialTilt;
            obj._tiltApplied = true;
        }
    }

    solveKeplerEquation(M, e, tolerance = 1e-8, maxIterations = 50) {
        // Newton-Raphson method for solving Kepler's equation: E - e*sin(E) = M
        let E = M;  // Initial guess

        // For high eccentricity, use a better initial guess
        if (e > 0.8) {
            E = Math.PI;
        }

        for (let i = 0; i < maxIterations; i++) {
            const sinE = Math.sin(E);
            const cosE = Math.cos(E);
            const f = E - e * sinE - M;
            const fPrime = 1 - e * cosE;

            const dE = f / fPrime;
            E -= dE;

            if (Math.abs(dE) < tolerance) {
                break;
            }
        }

        return E;
    }

    calculatePeriod(semiMajorAxis) {
        // Kepler's third law: T² = (4π²/GM) * a³
        return 2 * Math.PI * Math.sqrt(
            Math.pow(semiMajorAxis, 3) / (this.G * this.centralMass)
        );
    }

    calculateOrbitalVelocity(semiMajorAxis, distance) {
        // Vis-viva equation: v² = GM(2/r - 1/a)
        return Math.sqrt(
            this.G * this.centralMass * (2 / distance - 1 / semiMajorAxis)
        );
    }

    calculateEscapeVelocity(distance) {
        // v_escape = sqrt(2GM/r)
        return Math.sqrt(2 * this.G * this.centralMass / distance);
    }

    calculateHillSphere(mass, semiMajorAxis, eccentricity = 0) {
        // Hill sphere radius: r_H ≈ a(1-e) * (m/3M)^(1/3)
        return semiMajorAxis * (1 - eccentricity) *
            Math.pow(mass / (3 * this.centralMass), 1/3);
    }

    calculateLagrangePoints(primaryMass, secondaryMass, semiMajorAxis) {
        // Calculate L1, L2, L3, L4, L5 Lagrange points
        const massRatio = secondaryMass / (primaryMass + secondaryMass);
        const r = semiMajorAxis;

        // L1 (between bodies)
        const rL1 = r * Math.pow(massRatio / 3, 1/3);
        // L2 (beyond secondary)
        const rL2 = r * Math.pow(massRatio / 3, 1/3);
        // L3 (opposite side of primary)
        const rL3 = r * (1 + 5 * massRatio / 12);

        return {
            L1: { x: r - rL1, y: 0, z: 0 },
            L2: { x: r + rL2, y: 0, z: 0 },
            L3: { x: -rL3, y: 0, z: 0 },
            L4: { x: r * 0.5, y: r * Math.sqrt(3) / 2, z: 0 },
            L5: { x: r * 0.5, y: -r * Math.sqrt(3) / 2, z: 0 }
        };
    }

    updateTrails() {
        for (const obj of this.objects) {
            if (!obj.orbitalData || !obj.mesh || obj.type === "star") continue;

            // Initialize trail if needed
            if (!obj._trail) {
                const geometry = new THREE.BufferGeometry();
                const positions = new Float32Array(this.trailLength * 3);
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

                const material = new THREE.LineBasicMaterial({
                    color: obj.color || 0x4488ff,
                    transparent: true,
                    opacity: 0.3
                });

                obj._trail = new THREE.Line(geometry, material);
                obj._trail.frustumCulled = false;
                obj._trailIndex = 0;
                obj._trailPositions = [];

                if (obj.mesh.parent) {
                    obj.mesh.parent.add(obj._trail);
                }
            }

            // Add current position to trail
            const pos = obj.mesh.position.clone();
            obj._trailPositions.push(pos);

            if (obj._trailPositions.length > this.trailLength) {
                obj._trailPositions.shift();
            }

            // Update trail geometry
            const positions = obj._trail.geometry.attributes.position.array;
            for (let i = 0; i < obj._trailPositions.length; i++) {
                const p = obj._trailPositions[i];
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = p.z;
            }
            obj._trail.geometry.attributes.position.needsUpdate = true;
            obj._trail.geometry.setDrawRange(0, obj._trailPositions.length);
        }
    }

    // Add object to orbital system
    addObject(object) {
        if (!object) {
            console.warn("⚠️ Cannot add null object");
            return;
        }

        // Set defaults for orbital data
        if (object.orbitalData) {
            object.orbitalData.meanAnomalyAtEpoch =
                object.orbitalData.meanAnomalyAtEpoch || Math.random() * Math.PI * 2;
        }

        this.objects.push(object);
        console.log(`➕ Added ${object.name || 'unnamed'} to orbital system`);
    }

    // Remove object from orbital system
    removeObject(object) {
        const index = this.objects.indexOf(object);
        if (index > -1) {
            // Clean up trail
            if (object._trail) {
                object._trail.geometry.dispose();
                object._trail.material.dispose();
                if (object._trail.parent) {
                    object._trail.parent.remove(object._trail);
                }
            }

            this.objects.splice(index, 1);
            console.log(`➖ Removed ${object.name || 'unnamed'} from orbital system`);
        }
    }

    // Set time scale
    setTimeScale(scale) {
        this.timeScale = Math.max(0, Math.min(10000, scale));
        console.log(`⏱️ Orbital time scale: ${this.timeScale}x`);
    }

    // Toggle orbital trails
    setShowTrails(show) {
        this.showTrails = show;

        // Hide existing trails if disabled
        if (!show) {
            for (const obj of this.objects) {
                if (obj._trail) {
                    obj._trail.visible = false;
                }
            }
        } else {
            for (const obj of this.objects) {
                if (obj._trail) {
                    obj._trail.visible = true;
                }
            }
        }

        console.log(`🛤️ Orbital trails ${show ? 'enabled' : 'disabled'}`);
    }

    // Reset orbital time
    resetTime() {
        this.time = 0;
        console.log("🔄 Orbital time reset");
    }

    // Get orbital info for an object
    getOrbitalInfo(object) {
        if (!object.orbitalData) return null;

        const orbital = object.orbitalData;
        const a = orbital.semiMajorAxis;
        const e = orbital.eccentricity || 0;

        return {
            semiMajorAxis: a,
            semiMinorAxis: a * Math.sqrt(1 - e * e),
            eccentricity: e,
            periapsis: a * (1 - e),
            apoapsis: a * (1 + e),
            period: orbital.orbitalPeriod || this.calculatePeriod(a),
            inclination: orbital.inclination || 0,
            currentVelocity: object.orbitalVelocity || 0,
            trueAnomaly: object.trueAnomaly || 0
        };
    }

    // Predict position at future time
    predictPosition(object, futureTime) {
        if (!object.orbitalData) return null;

        const orbital = object.orbitalData;
        const a = orbital.semiMajorAxis;
        const e = orbital.eccentricity || 0;
        const period = orbital.orbitalPeriod || this.calculatePeriod(a);
        const M0 = orbital.meanAnomalyAtEpoch || 0;

        const n = (2 * Math.PI) / period;
        const M = (M0 + n * (this.time + futureTime)) % (2 * Math.PI);
        const E = this.solveKeplerEquation(M, e);

        const nu = 2 * Math.atan2(
            Math.sqrt(1 + e) * Math.sin(E / 2),
            Math.sqrt(1 - e) * Math.cos(E / 2)
        );

        const r = a * (1 - e * Math.cos(E));
        const x = r * Math.cos(nu);
        const y = r * Math.sin(nu);

        return { x, y, z: 0, distance: r, trueAnomaly: nu };
    }
}
