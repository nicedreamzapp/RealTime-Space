// SphereRadar.js - CINEMATIC 3D HOLOGRAPHIC TACTICAL DISPLAY
// Film-quality volumetric radar with true depth perception, particle effects,
// and intuitive navigation inspired by Star Wars, The Expanse, and Elite Dangerous

class SphereRadar {
    constructor(containerId) {
        console.log("🎯 SphereRadar: Initializing CINEMATIC holographic display...");

        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error("❌ SphereRadar: Container not found");
            return;
        }

        this.width = 180;
        this.height = 180;
        this.time = 0;
        this.planetMarkers = [];
        this.markerPool = [];
        this.selectedTarget = null;
        this._highlightTimeoutIds = new Map();

        // Depth visualization layers
        this.depthLayers = [
            { range: 100, color: 0x00ff88, name: 'PROX', glow: 0x00ff44 },
            { range: 500, color: 0x00ddff, name: 'NEAR', glow: 0x0088ff },
            { range: 1000, color: 0x4488ff, name: 'MID', glow: 0x2244aa },
            { range: 2000, color: 0x8844ff, name: 'FAR', glow: 0x4422aa }
        ];

        // Visual effects settings
        this.bloomEnabled = true;
        this.particleDensity = 200;
        this.scanSpeed = 1.2;
        this.hologramFlicker = true;

        this.initRadarScene();
        this.createCinematicElements();
        this.animate();

        console.log("✅ CINEMATIC holographic display ready");
    }

    initRadarScene() {
        this.scene = new THREE.Scene();
        // Darker, more dramatic background
        this.scene.background = new THREE.Color(0x000408);

        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        this.camera.position.set(0, 70, 100);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000408, 0.9);

        this.container.innerHTML = '';
        this.container.appendChild(this.renderer.domElement);
        this.renderer.domElement.style.borderRadius = '50%';
    }

    createCinematicElements() {
        // Create layered holographic display
        this._createVolumetricSphere();
        this._createDepthGrids();
        this._createHolographicPlanes();
        this._createShipIndicator();
        this._createScanningBeam();
        this._createVolumetricParticles();
        this._createDataStreams();
        this._createDistanceMarkers();
    }

    _createVolumetricSphere() {
        // Multi-layered holographic sphere with depth
        const sphereGroup = new THREE.Group();

        // Outer shell - fine wireframe
        const outerGeo = new THREE.IcosahedronGeometry(50, 4);
        const outerMat = new THREE.MeshBasicMaterial({
            color: 0x00aaff,
            wireframe: true,
            transparent: true,
            opacity: 0.04
        });
        this.outerSphere = new THREE.Mesh(outerGeo, outerMat);
        sphereGroup.add(this.outerSphere);

        // Middle shell with shader for hologram effect
        const midGeo = new THREE.SphereGeometry(48, 64, 64);
        const midMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(0x00ccff) }
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
                uniform vec3 color;
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    // Holographic scan lines
                    float scanLine = sin(vPosition.y * 30.0 + time * 5.0) * 0.5 + 0.5;
                    scanLine = pow(scanLine, 8.0);

                    // Fresnel edge glow
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);

                    // Hologram flicker
                    float flicker = 0.9 + sin(time * 30.0) * 0.05 + sin(time * 47.0) * 0.03;

                    // Hex grid pattern
                    float hex = sin(vPosition.x * 20.0) * sin(vPosition.z * 20.0);
                    hex = step(0.9, hex) * 0.3;

                    float alpha = (fresnel * 0.15 + scanLine * 0.05 + hex) * flicker;

                    gl_FragColor = vec4(color * (1.0 + scanLine * 0.5), alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.midSphere = new THREE.Mesh(midGeo, midMat);
        sphereGroup.add(this.midSphere);

        // Inner glow core
        const coreGeo = new THREE.SphereGeometry(5, 32, 32);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        this.core = new THREE.Mesh(coreGeo, coreMat);
        sphereGroup.add(this.core);

        this.radarSphere = sphereGroup;
        this.scene.add(sphereGroup);
    }

    _createDepthGrids() {
        // Horizontal grid planes at different depths for spatial reference
        this.gridPlanes = [];

        const gridMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                gridColor: { value: new THREE.Color(0x00aaff) },
                fadeRadius: { value: 45.0 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPosition;
                void main() {
                    vUv = uv;
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 gridColor;
                uniform float fadeRadius;
                varying vec2 vUv;
                varying vec3 vPosition;

                void main() {
                    // Create grid pattern
                    vec2 grid = abs(fract(vPosition.xz * 0.1) - 0.5);
                    float line = min(grid.x, grid.y);
                    float gridLine = 1.0 - smoothstep(0.0, 0.05, line);

                    // Fine sub-grid
                    vec2 fineGrid = abs(fract(vPosition.xz * 0.5) - 0.5);
                    float fineLine = min(fineGrid.x, fineGrid.y);
                    float fineGridLine = 1.0 - smoothstep(0.0, 0.02, fineLine);

                    // Radial fade
                    float dist = length(vPosition.xz);
                    float fade = smoothstep(fadeRadius, fadeRadius * 0.3, dist);

                    // Scanning pulse
                    float scanPulse = sin(dist * 0.5 - time * 3.0);
                    scanPulse = step(0.95, scanPulse) * 0.5;

                    float alpha = (gridLine * 0.3 + fineGridLine * 0.1 + scanPulse) * fade;

                    gl_FragColor = vec4(gridColor, alpha * 0.5);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Main horizontal grid
        const gridGeo = new THREE.PlaneGeometry(100, 100, 50, 50);
        const mainGrid = new THREE.Mesh(gridGeo, gridMaterial);
        mainGrid.rotation.x = -Math.PI / 2;
        this.scene.add(mainGrid);
        this.gridPlanes.push(mainGrid);

        // Upper and lower reference planes (faint)
        [-25, 25].forEach(y => {
            const refGrid = mainGrid.clone();
            refGrid.position.y = y;
            refGrid.material = gridMaterial.clone();
            refGrid.material.uniforms.gridColor.value = new THREE.Color(0x4466aa);
            this.scene.add(refGrid);
            this.gridPlanes.push(refGrid);
        });
    }

    _createHolographicPlanes() {
        // Vertical holographic data panels
        this.dataPanels = [];

        const panelPositions = [
            { x: -55, z: 0, rot: Math.PI / 2 },
            { x: 55, z: 0, rot: -Math.PI / 2 },
            { x: 0, z: -55, rot: 0 },
            { x: 0, z: 55, rot: Math.PI }
        ];

        panelPositions.forEach((pos, i) => {
            const panelGeo = new THREE.PlaneGeometry(30, 50);
            const panelMat = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    panelIndex: { value: i }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform float panelIndex;
                    varying vec2 vUv;

                    float random(vec2 st) {
                        return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
                    }

                    void main() {
                        // Edge fade
                        float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
                        edge *= smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);

                        // Data lines animation
                        float dataLine = step(0.98, sin(vUv.y * 50.0 + time * 5.0 + panelIndex));

                        // Scanline effect
                        float scanY = fract(time * 0.5 + panelIndex * 0.25);
                        float scanLine = 1.0 - smoothstep(0.0, 0.02, abs(vUv.y - scanY));

                        // Random data noise
                        float noise = random(floor(vUv * vec2(20.0, 100.0)) + time) * 0.1;

                        float alpha = (edge * 0.05 + dataLine * 0.3 + scanLine * 0.2 + noise) * edge;

                        gl_FragColor = vec4(0.0, 0.8, 1.0, alpha);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const panel = new THREE.Mesh(panelGeo, panelMat);
            panel.position.set(pos.x, 0, pos.z);
            panel.rotation.y = pos.rot;
            this.scene.add(panel);
            this.dataPanels.push(panel);
        });
    }

    _createRangeRings() {
        // Multiple depth layers for the larger universe scale
        // Near (green), Mid (cyan), Far (blue), Deep (purple)
        const ringRadii = [10, 20, 32, 45];
        const ringColors = [0x00ff88, 0x00ffff, 0x4488ff, 0x8844ff];
        const ringLabels = ["100", "500", "1K", "2K"];

        ringRadii.forEach((r, i) => {
            // Horizontal ring
            const points = [];
            const segments = 64;
            for (let j = 0; j <= segments; j++) {
                const angle = (j / segments) * Math.PI * 2;
                points.push(new THREE.Vector3(
                    Math.cos(angle) * r,
                    0,
                    Math.sin(angle) * r
                ));
            }

            const ringGeo = new THREE.BufferGeometry().setFromPoints(points);
            const ringMat = new THREE.LineBasicMaterial({
                color: ringColors[i],
                transparent: true,
                opacity: 0.2 + (i * 0.05)
            });
            const ring = new THREE.Line(ringGeo, ringMat);
            this.scene.add(ring);

            // Vertical arc for 3D depth
            const arcPoints = [];
            for (let j = 0; j <= segments / 2; j++) {
                const angle = (j / (segments / 2)) * Math.PI;
                arcPoints.push(new THREE.Vector3(
                    Math.sin(angle) * r,
                    Math.cos(angle) * r,
                    0
                ));
            }
            const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
            const arcMat = new THREE.LineBasicMaterial({
                color: ringColors[i],
                transparent: true,
                opacity: 0.1
            });
            const arc = new THREE.Line(arcGeo, arcMat);
            this.scene.add(arc);
        });
    }

    _createAxisLines() {
        const axisMat = new THREE.LineBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.15
        });

        // Cardinal directions
        const directions = [
            [[-50, 0, 0], [50, 0, 0]],
            [[0, 0, -50], [0, 0, 50]],
            [[0, -50, 0], [0, 50, 0]]
        ];

        directions.forEach(dir => {
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(...dir[0]),
                new THREE.Vector3(...dir[1])
            ]);
            const line = new THREE.Line(geo, axisMat);
            this.scene.add(line);
        });
    }

    _createShipIndicator() {
        // Player ship - sleek arrow design
        const shipGroup = new THREE.Group();

        // Main body
        const bodyGeo = new THREE.ConeGeometry(2.5, 8, 6);
        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.rotation.x = Math.PI / 2;
        shipGroup.add(body);

        // Glow aura
        const glowGeo = new THREE.SphereGeometry(5, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.2,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        shipGroup.add(glow);

        // Outer pulse ring
        const pulseGeo = new THREE.RingGeometry(6, 7, 32);
        const pulseMat = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        this.pulseRing = new THREE.Mesh(pulseGeo, pulseMat);
        this.pulseRing.rotation.x = -Math.PI / 2;
        shipGroup.add(this.pulseRing);

        this.ship = shipGroup;
        this.scene.add(this.ship);
    }

    _createScanningBeam() {
        // Volumetric scanning beam with trailing effect
        const beamGroup = new THREE.Group();

        // Main scanning plane
        const beamGeo = new THREE.PlaneGeometry(50, 100, 1, 50);
        const beamMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPosition;
                void main() {
                    vUv = uv;
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float time;
                varying vec2 vUv;
                varying vec3 vPosition;

                void main() {
                    // Horizontal fade from center
                    float xFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
                    xFade = pow(xFade, 0.5);

                    // Vertical gradient
                    float yFade = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);

                    // Scan line intensity
                    float scanIntensity = pow(vUv.x, 3.0);

                    // Data noise
                    float noise = fract(sin(vPosition.y * 100.0 + time * 10.0) * 10000.0) * 0.3;

                    float alpha = xFade * yFade * (0.1 + scanIntensity * 0.4 + noise * 0.1);

                    vec3 color = mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 0.8), scanIntensity);

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.scanBeam = new THREE.Mesh(beamGeo, beamMat);
        this.scanBeam.rotation.x = Math.PI / 2;
        beamGroup.add(this.scanBeam);

        // Trailing scan lines
        for (let i = 1; i <= 8; i++) {
            const trailGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, -45, 0),
                new THREE.Vector3(0, 45, 0)
            ]);
            const trailMat = new THREE.LineBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.3 / i
            });
            const trail = new THREE.Line(trailGeo, trailMat);
            trail.position.x = 45;
            trail.rotation.y = -i * 0.08;
            beamGroup.add(trail);
        }

        this.scanGroup = beamGroup;
        this.scene.add(beamGroup);
    }

    _createVolumetricParticles() {
        // Dense volumetric particle field for holographic atmosphere
        const particleCount = this.particleDensity;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            const r = 5 + Math.random() * 40;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            // Color based on distance (depth visualization)
            const normalizedR = r / 45;
            colors[i * 3] = 0.0;
            colors[i * 3 + 1] = 0.6 + normalizedR * 0.4;
            colors[i * 3 + 2] = 1.0 - normalizedR * 0.3;

            sizes[i] = 0.5 + Math.random() * 1.5;

            velocities[i * 3] = (Math.random() - 0.5) * 0.02;
            velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
        }

        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        particleGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        particleGeo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

        const particleMat = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 velocity;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float time;

                void main() {
                    #ifdef USE_COLOR
                        vColor = color;
                    #else
                        vColor = vec3(1.0);
                    #endif

                    // Gentle floating motion
                    vec3 pos = position;
                    pos += velocity * sin(time + position.x * 10.0) * 5.0;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (100.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;

                    // Fade with distance from center
                    float dist = length(position) / 45.0;
                    vAlpha = (1.0 - dist * 0.5) * 0.4;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;

                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    if (d > 0.5) discard;

                    float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            vertexColors: true
        });

        this.particles = new THREE.Points(particleGeo, particleMat);
        this.scene.add(this.particles);
    }

    _createDataStreams() {
        // Animated data streams flowing through the display
        const streamCount = 12;
        this.dataStreams = [];

        for (let i = 0; i < streamCount; i++) {
            const angle = (i / streamCount) * Math.PI * 2;
            const radius = 35 + Math.random() * 10;

            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(0, -40, 0),
                new THREE.Vector3(Math.cos(angle) * radius * 0.3, -20, Math.sin(angle) * radius * 0.3),
                new THREE.Vector3(Math.cos(angle) * radius * 0.6, 0, Math.sin(angle) * radius * 0.6),
                new THREE.Vector3(Math.cos(angle) * radius, 20, Math.sin(angle) * radius),
                new THREE.Vector3(Math.cos(angle) * radius * 0.5, 40, Math.sin(angle) * radius * 0.5)
            ]);

            const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.3, 8, false);
            const tubeMat = new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 },
                    streamIndex: { value: i }
                },
                vertexShader: `
                    varying float vProgress;
                    varying vec3 vPosition;

                    void main() {
                        vPosition = position;
                        vProgress = (position.y + 40.0) / 80.0;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    uniform float streamIndex;
                    varying float vProgress;
                    varying vec3 vPosition;

                    void main() {
                        // Animated flow
                        float flow = fract(vProgress - time * 0.5 - streamIndex * 0.1);
                        float pulse = smoothstep(0.0, 0.1, flow) * smoothstep(0.3, 0.2, flow);

                        // Fade at ends
                        float fade = smoothstep(0.0, 0.1, vProgress) * smoothstep(1.0, 0.9, vProgress);

                        float alpha = pulse * fade * 0.4;

                        vec3 color = mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 0.5), vProgress);

                        gl_FragColor = vec4(color * 2.0, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const stream = new THREE.Mesh(tubeGeo, tubeMat);
            this.scene.add(stream);
            this.dataStreams.push(stream);
        }
    }

    _createDistanceMarkers() {
        // 3D distance markers at key ranges
        this.distanceMarkers = [];

        this.depthLayers.forEach((layer, i) => {
            const markerRadius = (layer.range / 2000) * 45;

            // Ring at this distance
            const ringGeo = new THREE.TorusGeometry(markerRadius, 0.15, 8, 64);
            const ringMat = new THREE.MeshBasicMaterial({
                color: layer.color,
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2;
            this.scene.add(ring);
            this.distanceMarkers.push(ring);

            // Vertical ring for 3D perception
            const vRingGeo = new THREE.TorusGeometry(markerRadius, 0.1, 8, 64);
            const vRingMat = new THREE.MeshBasicMaterial({
                color: layer.color,
                transparent: true,
                opacity: 0.15,
                blending: THREE.AdditiveBlending
            });
            const vRing = new THREE.Mesh(vRingGeo, vRingMat);
            this.scene.add(vRing);
            this.distanceMarkers.push(vRing);
        });
    }

    update(cameraPosition, planets, cameraRotation) {
        if (!this.scene) return;

        // Smooth time update
        this.time += 0.016;

        // Remove these two lines:
        // this.scanCone.rotation.y = scanAngle;
        // this.scanLine.rotation.y = scanAngle;

        // Instead rotate scanGroup and scanBeam if present
        const scanAngle = this.time * 0.8;
        if (this.scanGroup) this.scanGroup.rotation.y = scanAngle;
        if (this.scanBeam) this.scanBeam.rotation.y = scanAngle;

        // Pulse ship glow
        if (this.pulseRing) {
            const pulse = 1 + Math.sin(this.time * 4) * 0.3;
            this.pulseRing.scale.setScalar(pulse);
            this.pulseRing.material.opacity = 0.3 - Math.sin(this.time * 4) * 0.15;
        }

        // Rotate ambient particles
        if (this.particles) {
            this.particles.rotation.y += 0.001;
        }

        // Clear old markers
        this.planetMarkers.forEach(m => {
            this.scene.remove(m);
            // Return to pool for reuse
            this.markerPool.push(m);
        });
        this.planetMarkers = [];

        if (!planets || !cameraPosition) return;

        // Add planet markers with smooth positioning
        // Extended range to show entire solar system with new scale
        const radarRange = 2000;  // Full solar system range
        const scaleFactor = 45 / radarRange;

        planets.forEach(planet => {
            if (!planet.mesh) return;

            const worldPos = planet.mesh.position.clone();
            const relativePos = worldPos.sub(cameraPosition);
            const distance = relativePos.length();

            if (distance > radarRange) return;

            const radarPos = relativePos.clone().multiplyScalar(scaleFactor);

            // Clamp to radar sphere
            if (radarPos.length() > 43) {
                radarPos.normalize().multiplyScalar(43);
            }

            // Get or create marker
            const marker = this._getMarker(planet);
            marker.position.copy(radarPos);

            this.scene.add(marker);
            this.planetMarkers.push(marker);
        });
    }

    _getMarker(planet) {
        // Object pooling for performance
        let marker = this.markerPool.pop();

        const markerSize = this._getMarkerSize(planet.type);
        const markerColor = this._getMarkerColor(planet);

        if (!marker) {
            const markerGeo = new THREE.SphereGeometry(1, 12, 12);
            const markerMat = new THREE.MeshBasicMaterial({
                color: markerColor,
                transparent: true,
                opacity: 0.9
            });
            marker = new THREE.Mesh(markerGeo, markerMat);

            // Inner glow
            const glowGeo = new THREE.SphereGeometry(1.8, 8, 8);
            const glowMat = new THREE.MeshBasicMaterial({
                color: markerColor,
                transparent: true,
                opacity: 0.3,
                blending: THREE.AdditiveBlending
            });
            marker.add(new THREE.Mesh(glowGeo, glowMat));
        }

        // Update marker properties
        marker.scale.setScalar(markerSize);
        marker.material.color.setHex(markerColor);
        if (marker.children[0]) {
            marker.children[0].material.color.setHex(markerColor);
        }

        // Assign userData.name for highlightTargetByName
        marker.userData = marker.userData || {};
        marker.userData.name = (planet.name && typeof planet.name === 'string') ? planet.name : planet.type;

        return marker;
    }

    _getMarkerSize(type) {
        const sizes = {
            star: 5,
            planet: 3,
            moon: 1.8,
            comet: 2.2,
            nebula: 3.5,
            asteroid: 1.2,
            blackhole: 4
        };
        return sizes[type] || 2;
    }

    _getMarkerColor(planet) {
        if (planet.type === "star") return 0xffcc00;
        if (planet.type === "blackhole") return 0x8844ff;  // Purple for black holes
        if (planet.type === "planet") return planet.color || 0x4488ff;
        if (planet.type === "moon") return 0xaaaacc;
        if (planet.type === "comet") return 0x88ddff;
        if (planet.type === "nebula") return 0xff66aa;
        return 0x00ffff;
    }

    setSelectedTarget(targetId) {
        this.selectedTarget = targetId;
    }

    highlightTargetByName(name) {
        if (!name || !this.planetMarkers.length) return;
        const targetName = name.toLowerCase();

        this.planetMarkers.forEach(marker => {
            if (marker.userData && marker.userData.name && marker.userData.name.toLowerCase() === targetName) {
                // If there's an existing timeout for this marker, clear it
                if (this._highlightTimeoutIds.has(marker)) {
                    clearTimeout(this._highlightTimeoutIds.get(marker));
                    this._highlightTimeoutIds.delete(marker);
                }

                // Store original scale and opacity
                const originalScale = marker.scale.clone();
                const originalOpacity = marker.material.opacity;

                // Apply highlight
                marker.scale.multiplyScalar(1.6);
                marker.material.opacity = 1.0;

                // Setup timer to revert
                const timeoutId = setTimeout(() => {
                    marker.scale.copy(originalScale);
                    marker.material.opacity = originalOpacity;
                    this._highlightTimeoutIds.delete(marker);
                }, 2000);

                this._highlightTimeoutIds.set(marker, timeoutId);
            }
        });
    }

    animate() {
        if (!this.renderer) return;

        requestAnimationFrame(() => this.animate());

        // Cinematic camera orbit with smooth motion
        const orbitSpeed = 0.03;
        const breathe = Math.sin(this.time * 0.2) * 5;
        this.camera.position.x = Math.sin(this.time * orbitSpeed) * 30;
        this.camera.position.z = 100 + Math.cos(this.time * orbitSpeed) * 25 + breathe;
        this.camera.position.y = 70 + Math.sin(this.time * orbitSpeed * 0.7) * 15;
        this.camera.lookAt(0, 0, 0);

        // Animate holographic sphere
        if (this.radarSphere) {
            this.radarSphere.rotation.y += 0.0008;
            this.radarSphere.rotation.x += 0.0003;
        }

        // Update volumetric sphere shader
        if (this.midSphere && this.midSphere.material.uniforms) {
            this.midSphere.material.uniforms.time.value = this.time;
        }

        // Rotate scanning beam
        if (this.scanGroup) {
            this.scanGroup.rotation.y += this.scanSpeed * 0.016;

            // Update scan beam shader
            if (this.scanBeam && this.scanBeam.material.uniforms) {
                this.scanBeam.material.uniforms.time.value = this.time;
            }
        }

        // Animate grid planes
        if (this.gridPlanes) {
            this.gridPlanes.forEach(grid => {
                if (grid.material.uniforms) {
                    grid.material.uniforms.time.value = this.time;
                }
            });
        }

        // Animate data panels
        if (this.dataPanels) {
            this.dataPanels.forEach(panel => {
                if (panel.material.uniforms) {
                    panel.material.uniforms.time.value = this.time;
                }
            });
        }

        // Animate particles
        if (this.particles && this.particles.material.uniforms) {
            this.particles.material.uniforms.time.value = this.time;
        }

        // Animate data streams
        if (this.dataStreams) {
            this.dataStreams.forEach(stream => {
                if (stream.material.uniforms) {
                    stream.material.uniforms.time.value = this.time;
                }
            });
        }

        // Pulse distance markers
        if (this.distanceMarkers) {
            this.distanceMarkers.forEach((marker, i) => {
                const pulse = 1 + Math.sin(this.time * 2 + i * 0.5) * 0.05;
                marker.scale.setScalar(pulse);
            });
        }

        // Pulse ship indicator
        if (this.pulseRing) {
            const pulse = 1 + Math.sin(this.time * 4) * 0.3;
            this.pulseRing.scale.setScalar(pulse);
            this.pulseRing.material.opacity = 0.3 - Math.sin(this.time * 4) * 0.15;
        }

        // Pulse core
        if (this.core) {
            const corePulse = 1 + Math.sin(this.time * 3) * 0.1;
            this.core.scale.setScalar(corePulse);
        }

        try {
            this.renderer.render(this.scene, this.camera);
        } catch (e) {
            console.error("Radar render error:", e);
        }
    }

    dispose() {
        if (this.renderer) {
            this.renderer.dispose();
        }
        this.scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
    }
}

