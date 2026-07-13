// NavigationPhysics.js
// CINEMATIC spacecraft physics with buttery-smooth controls and momentum

class NavigationPhysics {
    constructor(camera) {
        console.log("🚀 NavigationPhysics: Initializing CINEMATIC controls...");

        if (!camera) {
            console.error("❌ NavigationPhysics: Camera is required");
            return;
        }

        this.camera = camera;

        // Velocity with momentum (persists when not thrusting)
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.targetVelocity = new THREE.Vector3(0, 0, 0);

        // Rotation with analog sensitivity - SMOOTHER
        // Base rotation speed: 360° in 12 seconds at full joystick deflection
        this.maxRotationSpeed = (Math.PI * 2) / 12; // Slightly faster response
        this.currentRotationInput = new THREE.Vector3(0, 0, 0);
        this.smoothedRotationInput = new THREE.Vector3(0, 0, 0);

        // Angular velocity with momentum - SMOOTHER
        this.angularVelocity = new THREE.Vector3(0, 0, 0);
        this.angularDamping = 2.5; // Slightly less damping for smoother stops

        // Thrust settings - gentle by default; the in-app SPEED slider adjusts these live.
        this.thrustPower = 180; // Softer acceleration (was 400)
        this.isThrusting = false;
        this.thrustRampUp = 0; // For smooth thrust engagement

        // Physics settings - calmer cruise so you can actually look around
        this.linearDrag = 0.06; // A bit more drag
        this.maxSpeed = 120; // Default cruise (slider can raise/lower this)
        this.brakePower = 150; // Strong brakes to stop quickly

        // Smoothing factors - responsive but smooth
        this.rotationSmoothing = 0.15; // Faster rotation response
        this.velocitySmoothing = 0.95; // Eases to a stop when you release thrust (was 0.99)

        // Proximity settings
        this.proximityThreshold = 20;
        this.slowModeMultiplier = 0.15;
        this.isNearObject = false;

        // Boost mode - WARP SPEED for crossing large distances
        // Boost gives 6x speed: 250 -> 1500 u/s (reaches Neptune fast)
        this.boostMultiplier = 6.0;
        this.isBoosting = false;

        // Analog input magnitude (0-1) for sensitivity
        this.inputMagnitude = 0;

        // Camera shake for cinematic effect
        this.cameraShake = 0;
        this.shakeDecay = 0.95;

        // Frame counter for logging
        this.frameCount = 0;

        console.log("✅ NavigationPhysics initialized with CINEMATIC physics");
        console.log("  - Max rotation speed:", this.maxRotationSpeed.toFixed(3), "rad/s");
        console.log("  - Thrust power:", this.thrustPower);
        console.log("  - Linear drag:", this.linearDrag);
        console.log("  - Max speed:", this.maxSpeed);
        console.log("  - Rotation smoothing:", this.rotationSmoothing);
    }

    // Set rotation input with analog sensitivity
    // vector.x, y, z should be normalized (-1 to 1) joystick values
    setRotationInput(vector) {
        if (!vector) {
            this.currentRotationInput.set(0, 0, 0);
            this.inputMagnitude = 0;
            return;
        }

        const x = vector.x || 0;
        const y = vector.y || 0;
        const z = vector.z || 0;

        // Calculate input magnitude for analog sensitivity
        this.inputMagnitude = Math.min(1.0, Math.sqrt(x * x + y * y + z * z));

        // Apply dead zone
        const deadzone = 0.05;
        if (this.inputMagnitude < deadzone) {
            this.currentRotationInput.set(0, 0, 0);
            this.inputMagnitude = 0;
            return;
        }

        // Normalize and store input
        this.currentRotationInput.set(x, y, z);

        // Log significant input changes
        if (this.frameCount % 30 === 0 && this.inputMagnitude > 0.1) {
            console.log("🕹️ Rotation input:", {
                x: x.toFixed(3),
                y: y.toFixed(3),
                magnitude: this.inputMagnitude.toFixed(3)
            });
        }
    }

    setThrust(isThrustActive) {
        if (!this.camera) return;

        const wasThrusting = this.isThrusting;
        this.isThrusting = isThrustActive;

        if (this.isThrusting !== wasThrusting) {
            if (this.isThrusting) {
                // Make thrust feel INSTANT and responsive. Two levers on engage:
                // (1) full thrust from frame one — no ramp-in lag (was ramping from 0, which
                //     made a press feel delayed); (2) a firm one-shot forward impulse so even
                //     a quick tap produces an immediate, unmistakable nudge (~30% of top
                //     speed). Holding then keeps accelerating on top. Tune IMPULSE_FRAC (tap
                //     punch) and thrust scaling in main.js setMaxSpeed if it's too much/little.
                const IMPULSE_FRAC = 0.30;
                this.thrustRampUp = 1.0;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                this.velocity.add(forward.multiplyScalar(this.maxSpeed * IMPULSE_FRAC));
            }
            console.log("🚀 Thrust:", this.isThrusting ? "ENGAGED" : "DISENGAGED", "| speed:", this.getSpeed().toFixed(1));
        }
    }

    setBoost(isBoostActive) {
        this.isBoosting = isBoostActive;
    }

    update(deltaTime) {
        if (!this.camera) return;

        const shouldLog = this.frameCount % 120 === 0; // Log every 2 seconds at 60 FPS
        this.frameCount++;

        // Clamp deltaTime to prevent physics explosions
        deltaTime = Math.min(deltaTime, 0.1);

        // Check proximity to objects
        this.checkProximity();

        // Update rotation with analog sensitivity and momentum
        this.updateRotation(deltaTime, shouldLog);

        // Update position with momentum-based physics
        this.updatePosition(deltaTime, shouldLog);
    }

    updateRotation(deltaTime, shouldLog) {
        // SMOOTH the input first (prevents jitter)
        this.smoothedRotationInput.lerp(this.currentRotationInput, this.rotationSmoothing);

        const inputMag = this.smoothedRotationInput.length();

        if (inputMag > 0.03) {
            // S-curve for even finer control at low inputs, faster at high
            // This gives precise small movements but responsive large movements
            const sensitivityCurve = this._smoothstep(0, 1, inputMag) * inputMag;
            const targetRotSpeed = this.maxRotationSpeed * sensitivityCurve;

            // Target angular velocity
            const targetAngularVel = this.smoothedRotationInput.clone()
                .normalize()
                .multiplyScalar(targetRotSpeed);

            // VERY smooth acceleration toward target (cinematic feel)
            const angularAccel = 6.0;
            this.angularVelocity.lerp(targetAngularVel, angularAccel * deltaTime);
        } else {
            // No input - apply smooth angular damping
            const dampFactor = Math.exp(-this.angularDamping * deltaTime);
            this.angularVelocity.multiplyScalar(dampFactor);

            // Smooth stop (not abrupt)
            if (this.angularVelocity.length() < 0.0005) {
                this.angularVelocity.set(0, 0, 0);
            }
        }

        // Apply angular velocity to camera rotation
        if (this.angularVelocity.length() > 0.00005) {
            // Use quaternion-based rotation for smoother interpolation
            const rotX = this.angularVelocity.x * deltaTime;
            const rotY = this.angularVelocity.y * deltaTime;
            const rotZ = this.angularVelocity.z * deltaTime;

            this.camera.rotateX(rotX);
            this.camera.rotateY(rotY);
            this.camera.rotateZ(rotZ);

            if (shouldLog && this.angularVelocity.length() > 0.01) {
                console.log("🔄 Angular vel:", this.angularVelocity.length().toFixed(3), "rad/s");
            }
        }
    }

    // Smoothstep function for natural-feeling curves
    _smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    updatePosition(deltaTime, shouldLog) {
        // Calculate forward direction
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(this.camera.quaternion);

        // Apply proximity slow-down with smooth transition
        const targetProximityMult = this.isNearObject ? this.slowModeMultiplier : 1.0;
        const boostMult = this.isBoosting ? this.boostMultiplier : 1.0;

        if (this.isThrusting) {
            // FAST thrust ramp-up - feel it immediately
            this.thrustRampUp = Math.min(1.0, this.thrustRampUp + deltaTime * 8.0);

            // Calculate thrust force with ramp-up
            const effectiveThrust = this.thrustPower * this.thrustRampUp * targetProximityMult * boostMult;
            const thrustForce = forward.clone().multiplyScalar(effectiveThrust * deltaTime);

            // Add thrust to velocity (acceleration)
            this.velocity.add(thrustForce);

            // Soft clamp to max speed (gradual slowdown at limit, not hard cap)
            const speed = this.velocity.length();
            const maxEffectiveSpeed = this.maxSpeed * targetProximityMult * boostMult;
            if (speed > maxEffectiveSpeed) {
                const overSpeed = speed / maxEffectiveSpeed;
                const softClamp = 1.0 / (1.0 + (overSpeed - 1.0) * 2.0);
                this.velocity.multiplyScalar(softClamp);
            }

            // Add subtle camera shake at high speed
            if (speed > this.maxSpeed * 0.8) {
                this.cameraShake = Math.min(0.003, (speed / this.maxSpeed - 0.8) * 0.01);
            }

            if (shouldLog) {
                console.log("🚀 Thrusting - Speed:", this.getSpeed().toFixed(1), "units/s");
            }
        } else {
            // Smooth thrust ramp-down
            this.thrustRampUp = Math.max(0, this.thrustRampUp - deltaTime * 2.0);

            // Not thrusting - apply smooth drag
            // Use velocity smoothing for momentum feel
            const dragFactor = Math.pow(this.velocitySmoothing, deltaTime * 60);
            this.velocity.multiplyScalar(dragFactor);

            // Very gradual stop
            if (this.velocity.length() < 0.05) {
                this.velocity.multiplyScalar(0.9); // Fade out instead of hard stop
                if (this.velocity.length() < 0.01) {
                    this.velocity.set(0, 0, 0);
                }
            }
        }

        // Apply camera shake (decays over time)
        if (this.cameraShake > 0.0001) {
            const shakeX = (Math.random() - 0.5) * this.cameraShake;
            const shakeY = (Math.random() - 0.5) * this.cameraShake;
            this.camera.rotation.x += shakeX;
            this.camera.rotation.y += shakeY;
            this.cameraShake *= this.shakeDecay;
        }

        // Apply velocity to position with smooth interpolation
        if (this.velocity.length() > 0.005) {
            const movement = this.velocity.clone().multiplyScalar(deltaTime);
            this.camera.position.add(movement);
        }

        if (shouldLog && this.velocity.length() > 1) {
            console.log("📍 Position:", {
                x: this.camera.position.x.toFixed(1),
                y: this.camera.position.y.toFixed(1),
                z: this.camera.position.z.toFixed(1)
            }, "Speed:", this.getSpeed().toFixed(1));
        }
    }

    checkProximity() {
        this.isNearObject = false;

        if (typeof objects === 'undefined' || !objects || objects.length === 0) return;

        const cameraPos = this.camera.position;
        for (const obj of objects) {
            if (obj.mesh && obj.radius) {
                const dist = cameraPos.distanceTo(obj.mesh.position);
                if (dist - obj.radius < this.proximityThreshold) {
                    this.isNearObject = true;
                    break;
                }
            }
        }
    }

    // Brake - actively slow down
    brake(deltaTime) {
        if (this.velocity.length() < 0.5) {
            this.velocity.set(0, 0, 0);
            return;
        }

        const brakeForce = this.velocity.clone().normalize().multiplyScalar(-this.brakePower * deltaTime);
        this.velocity.add(brakeForce);

        // Don't reverse
        if (this.velocity.length() < 0.5) {
            this.velocity.set(0, 0, 0);
        }
    }

    emergencyStop() {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.currentRotationInput.set(0, 0, 0);
        this.isThrusting = false;
        this.inputMagnitude = 0;
        console.log("🛑 Emergency stop - all momentum cleared");
    }

    getSpeed() {
        return this.velocity.length();
    }

    getVelocity() {
        return this.velocity.clone();
    }

    getAngularSpeed() {
        return this.angularVelocity.length();
    }

    reset() {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.currentRotationInput.set(0, 0, 0);
        this.isThrusting = false;
        this.isBoosting = false;
        this.inputMagnitude = 0;
        console.log("🔄 Navigation physics reset");
    }

    getState() {
        return {
            velocity: this.velocity.clone(),
            speed: this.getSpeed(),
            angularVelocity: this.angularVelocity.clone(),
            angularSpeed: this.getAngularSpeed(),
            isThrusting: this.isThrusting,
            isBoosting: this.isBoosting,
            isNearObject: this.isNearObject,
            inputMagnitude: this.inputMagnitude
        };
    }

    // Configuration methods
    setDrag(drag) {
        this.linearDrag = Math.max(0, Math.min(1, drag));
    }

    setMaxSpeed(speed) {
        this.maxSpeed = Math.max(10, speed);
    }

    setAngularDamping(damping) {
        this.angularDamping = Math.max(0, damping);
    }
}
