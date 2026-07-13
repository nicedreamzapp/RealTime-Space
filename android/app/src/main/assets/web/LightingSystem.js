// LightingSystem.js - HUBBLE-QUALITY physically accurate lighting
class LightingSystem {
    constructor(scene) {
        console.log("💡 LightingSystem: Initializing HUBBLE-QUALITY lighting...");

        this.scene = scene;
        this.lights = [];
        this.starLights = new Map();
        this.time = 0;

        // Ambient fill - enough to see detail in shadows without washing out
        this.ambientLight = new THREE.AmbientLight(0x0c0c1a, 0.25);
        this.scene.add(this.ambientLight);
        this.lights.push(this.ambientLight);

        // Hemisphere light for richer color variation (blue cosmos, warm stellar glow)
        this.hemisphereLight = new THREE.HemisphereLight(
            0x2a2a55,  // Sky color (richer deep blue)
            0x100a08,  // Ground color (warm dark)
            0.35
        );
        this.scene.add(this.hemisphereLight);
        this.lights.push(this.hemisphereLight);

        // No directional light - in space, light comes from point sources (stars)

        console.log("✅ LightingSystem initialized with realistic space lighting");
    }

    addStarLight(star) {
        if (!star || !star.mesh) return;

        // Calculate realistic light properties based on star temperature
        const temp = star.temperature || 5778;
        const luminosity = star.luminosity || 1.0;

        // Convert temperature to color
        const color = this._temperatureToColor(temp);

        // Zero decay / unlimited range: a camera in space auto-exposes, so every
        // planet reads as fully sunlit regardless of orbit distance. Physical
        // falloff (decay 1.5–2) leaves the outer planets pitch black at this
        // scene's scale; day/night contrast still comes from surface orientation.
        const light = new THREE.PointLight(
            color,
            luminosity * 0.26,
            0,   // no distance cutoff
            0    // no decay
        );

        light.position.copy(star.mesh.position);

        // Shadow maps stay off: planet/moon/ring shadows are computed analytically
        // in the planet shaders (sharper + far cheaper than cube shadow maps).
        light.castShadow = false;

        this.scene.add(light);
        this.lights.push(light);
        this.starLights.set(star, light);

        // (The old geometric "volumetric light" planes are gone — the real
        // screen-space god rays pass in main.js replaces them.)

        console.log(`⭐ Added physically-based light for star (${temp}K)`);
    }

    // Add volumetric/god ray effect
    _addVolumetricLight(star, color, luminosity) {
        if (luminosity < 5) return;  // Only for bright stars

        // Create a cone of light sprites for volumetric effect
        const coneGroup = new THREE.Group();
        const rayCount = 6;

        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2;
            const rayGeo = new THREE.PlaneGeometry(2, 50);
            const rayMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.03,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const ray = new THREE.Mesh(rayGeo, rayMat);
            ray.rotation.y = angle;
            ray.position.y = 25;
            coneGroup.add(ray);
        }

        coneGroup.position.copy(star.mesh.position);
        coneGroup.userData.isVolumetric = true;
        coneGroup.userData.baseRotation = 0;
        this.scene.add(coneGroup);
    }

    // Convert temperature to RGB color (blackbody approximation)
    _temperatureToColor(tempKelvin) {
        const temp = Math.max(1000, Math.min(40000, tempKelvin));
        let r, g, b;

        if (temp <= 6600) {
            r = 255;
            g = Math.max(0, Math.min(255, 99.4708 * Math.log(temp/100) - 161.1196));
            b = temp <= 1900 ? 0 : Math.max(0, Math.min(255, 138.5177 * Math.log(temp/100 - 10) - 305.0448));
        } else {
            r = Math.max(0, Math.min(255, 329.6987 * Math.pow(temp/100 - 60, -0.1332)));
            g = Math.max(0, Math.min(255, 288.1222 * Math.pow(temp/100 - 60, -0.0755)));
            b = 255;
        }

        return new THREE.Color(r/255, g/255, b/255);
    }

    setOverallIntensity(multiplier) {
        if (this.ambientLight) this.ambientLight.intensity = 0.15 * multiplier;
        if (this.hemisphereLight) this.hemisphereLight.intensity = 0.2 * multiplier;

        this.starLights.forEach((light, star) => {
            const baseLuminosity = star.luminosity || 1.0;
            // keeps the sun at ~2.6 with the default 1.2 multiplier (matches addStarLight)
            light.intensity = baseLuminosity * 0.22 * multiplier;
        });
    }

    // Update lights (for animated effects)
    update(deltaTime, cameraPosition) {
        this.time += deltaTime;

        // Animate volumetric light cones
        this.scene.traverse(obj => {
            if (obj.userData && obj.userData.isVolumetric) {
                obj.rotation.y = this.time * 0.1;
                obj.userData.baseRotation += deltaTime * 0.05;
            }
        });

        // Update star light positions if stars move
        this.starLights.forEach((light, star) => {
            if (star.mesh) {
                light.position.copy(star.mesh.position);
            }
        });
    }

    // Remove light for a star
    removeStarLight(star) {
        const light = this.starLights.get(star);
        if (light) {
            this.scene.remove(light);
            this.lights = this.lights.filter(l => l !== light);
            this.starLights.delete(star);
        }
    }

    dispose() {
        this.lights.forEach(light => {
            this.scene.remove(light);
            if (light.dispose) light.dispose();
        });
        this.lights = [];
        this.starLights.clear();
    }
}
