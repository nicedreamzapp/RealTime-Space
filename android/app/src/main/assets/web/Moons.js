// Moons.js - Real moons of the solar system beyond Luna
// Io, Europa, Ganymede, Callisto (Jupiter) + Titan, Enceladus (Saturn).
// Each gets a hand-tuned procedural surface in its real palette, Titan gets its
// orange haze atmosphere, Enceladus gets south-pole geyser plumes. All moons share
// the eclipse-shadow injection from Planet.js so they darken inside their parent's
// shadow, and the parents receive them as occluders (Galilean transit shadows).

class Moons {
    // Build one moon. cfg: { name, style, radius, distance, period, parent }
    // parent is the Planet instance whose mesh the moon orbits.
    static create(cfg) {
        const seed = Moons._hash(cfg.name);
        const rnd = Moons._mulberry32(seed);

        const { texture, bumpTexture } = Moons._makeSurface(cfg.style, rnd);

        const geo = new THREE.SphereGeometry(cfg.radius, 96, 48);
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            bumpMap: bumpTexture,
            bumpScale: cfg.style === 'titan' ? 0.0 : 0.03,
            roughness: cfg.style === 'europa' || cfg.style === 'enceladus' ? 0.55 : 0.92,
            metalness: 0.0,
            envMapIntensity: 0.35
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cfg.distance, 0, 0);
        cfg.parent.mesh.add(mesh);

        const moon = {
            name: cfg.name,
            mesh: mesh,
            radius: cfg.radius,
            type: "moon",
            color: cfg.color || 0xbbbbbb,
            parentPlanet: cfg.parent,
            orbitDistance: cfg.distance,
            orbitPeriod: cfg.period,
            angle: rnd() * Math.PI * 2,
            _shadowUniforms: {
                uSunPos: { value: new THREE.Vector3() },
                uSunRadius: { value: 15.0 },
                uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
                uOccluderCount: { value: 0 }
            },
            _occluders: [],
            setOccluders(list) { this._occluders = (list || []).slice(0, 4); },
            update(deltaTime) {
                this.angle += (deltaTime * 2 * Math.PI) / this.orbitPeriod;
                this.mesh.position.x = Math.cos(this.angle) * this.orbitDistance;
                this.mesh.position.z = Math.sin(this.angle) * this.orbitDistance;
                // Tidally locked: keep the same face toward the parent
                this.mesh.rotation.y = -this.angle;

                const su = this._shadowUniforms;
                let n = 0;
                for (let i = 0; i < this._occluders.length && n < 4; i++) {
                    const occ = this._occluders[i];
                    const m = occ.mesh || occ;
                    if (!m || !m.getWorldPosition) continue;
                    m.getWorldPosition(Moons._tmpVec);
                    su.uOccluders.value[n].set(Moons._tmpVec.x, Moons._tmpVec.y, Moons._tmpVec.z, occ.radius || 1);
                    n++;
                }
                su.uOccluderCount.value = n;

                if (this._geysers) Moons._updateGeysers(this, deltaTime);
            }
        };

        Moons._injectEclipseShadow(mat, moon._shadowUniforms);

        if (cfg.style === 'titan') Moons._addTitanHaze(moon);
        if (cfg.style === 'enceladus') Moons._addGeysers(moon, rnd);

        return moon;
    }

    // Same onBeforeCompile pattern as Planet._injectShadows (shares the GLSL
    // constant defined in Planet.js, which loads before this file).
    static _injectEclipseShadow(material, shadowUniforms) {
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, shadowUniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vEclipseWorldPos;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEclipseWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vEclipseWorldPos;\n' + ECLIPSE_SHADOW_GLSL)
                .replace('#include <output_fragment>',
                    'outgoingLight *= mix(0.04, 1.0, eclipseShadow(vEclipseWorldPos));\n#include <output_fragment>');
        };
        material.customProgramCacheKey = () => 'moon-eclipse-shadow';
    }

    // ---------- Surfaces ----------

    static _makeSurface(style, rnd) {
        const W = 1024, H = 512;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        const painters = {
            io: () => {
                // Sulfur world: yellows and burnt oranges, volcanic pocks
                Moons._noiseFill(ctx, W, H, rnd, [222, 196, 92], [188, 142, 58], 5);
                for (let i = 0; i < 90; i++) {
                    const x = rnd() * W, y = H * (0.12 + rnd() * 0.76), r = 3 + rnd() * 22;
                    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                    const dark = rnd() > 0.45;
                    g.addColorStop(0, dark ? 'rgba(60,30,12,0.9)' : 'rgba(245,240,225,0.85)');
                    g.addColorStop(0.45, dark ? 'rgba(150,70,20,0.55)' : 'rgba(230,190,110,0.4)');
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
                }
                // dark volcanic dots
                for (let i = 0; i < 60; i++) {
                    ctx.fillStyle = `rgba(40,22,10,${0.5 + rnd() * 0.4})`;
                    ctx.beginPath();
                    ctx.arc(rnd() * W, H * (0.15 + rnd() * 0.7), 1 + rnd() * 3.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            },
            europa: () => {
                // Cream ice shell crossed by reddish-brown lineae
                Moons._noiseFill(ctx, W, H, rnd, [228, 222, 206], [200, 192, 172], 8);
                ctx.lineCap = 'round';
                for (let i = 0; i < 46; i++) {
                    ctx.strokeStyle = `rgba(${150 + (rnd() * 40) | 0},${80 + (rnd() * 30) | 0},${50 + (rnd() * 25) | 0},${0.25 + rnd() * 0.35})`;
                    ctx.lineWidth = 0.6 + rnd() * 2.2;
                    ctx.beginPath();
                    let x = rnd() * W, y = rnd() * H;
                    ctx.moveTo(x, y);
                    const dx = (rnd() - 0.5) * 60, dy = (rnd() - 0.5) * 24;
                    for (let s = 0; s < 16; s++) {
                        x += dx + (rnd() - 0.5) * 30;
                        y += dy + (rnd() - 0.5) * 14;
                        ctx.lineTo(((x % W) + W) % W, Math.max(2, Math.min(H - 2, y)));
                    }
                    ctx.stroke();
                }
            },
            ganymede: () => {
                // Two-tone: dark ancient terrain patches over lighter grooved ice
                Moons._noiseFill(ctx, W, H, rnd, [150, 142, 128], [108, 100, 90], 4);
                for (let i = 0; i < 26; i++) {
                    const x = rnd() * W, y = rnd() * H, r = 30 + rnd() * 110;
                    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                    g.addColorStop(0, 'rgba(70,62,52,0.55)');
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
                }
                Moons._craters(ctx, W, H, rnd, 70, [235, 232, 225]);
            },
            callisto: () => {
                // Darkest, most cratered body in the system: brown-grey + bright pocks
                Moons._noiseFill(ctx, W, H, rnd, [96, 84, 72], [60, 52, 44], 6);
                Moons._craters(ctx, W, H, rnd, 220, [200, 195, 185]);
            },
            titan: () => {
                // Featureless orange smog ball — the haze IS the surface from orbit
                Moons._noiseFill(ctx, W, H, rnd, [212, 150, 62], [186, 122, 44], 2);
                const g = ctx.createLinearGradient(0, 0, 0, H);
                g.addColorStop(0, 'rgba(255,220,160,0.18)');
                g.addColorStop(0.5, 'rgba(0,0,0,0)');
                g.addColorStop(1, 'rgba(140,80,30,0.22)');
                ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
            },
            enceladus: () => {
                // Brightest body in the solar system: near-white ice + blue-green
                // "tiger stripe" fractures near the south pole
                Moons._noiseFill(ctx, W, H, rnd, [240, 244, 248], [216, 224, 232], 9);
                ctx.lineCap = 'round';
                for (let i = 0; i < 7; i++) {
                    ctx.strokeStyle = `rgba(110,170,170,${0.3 + rnd() * 0.3})`;
                    ctx.lineWidth = 1.5 + rnd() * 2.5;
                    ctx.beginPath();
                    let x = rnd() * W, y = H * (0.8 + rnd() * 0.12);
                    ctx.moveTo(x, y);
                    for (let s = 0; s < 8; s++) {
                        x += 30 + rnd() * 40; y += (rnd() - 0.5) * 18;
                        ctx.lineTo(x, Math.min(H - 2, Math.max(H * 0.72, y)));
                    }
                    ctx.stroke();
                }
            }
        };

        (painters[style] || painters.ganymede)();

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        if (THREE.SRGBColorSpace !== undefined) texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;

        // Grey copy of the same canvas works as a cheap bump map
        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = W; bumpCanvas.height = H;
        const bctx = bumpCanvas.getContext('2d');
        bctx.filter = 'grayscale(1) contrast(1.4)';
        bctx.drawImage(canvas, 0, 0);
        const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
        bumpTexture.wrapS = THREE.RepeatWrapping;

        return { texture, bumpTexture };
    }

    static _noiseFill(ctx, W, H, rnd, c1, c2, scale) {
        ctx.fillStyle = `rgb(${c1[0]},${c1[1]},${c1[2]})`;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 2200; i++) {
            const t = rnd();
            const r = (c1[0] * (1 - t) + c2[0] * t) | 0;
            const g = (c1[1] * (1 - t) + c2[1] * t) | 0;
            const b = (c1[2] * (1 - t) + c2[2] * t) | 0;
            ctx.fillStyle = `rgba(${r},${g},${b},${0.12 + rnd() * 0.25})`;
            const size = (2 + rnd() * 14) * scale * 0.4;
            ctx.beginPath();
            ctx.ellipse(rnd() * W, rnd() * H, size, size * (0.4 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    static _craters(ctx, W, H, rnd, count, rimColor) {
        for (let i = 0; i < count; i++) {
            const x = rnd() * W, y = H * (0.06 + rnd() * 0.88), r = 1.5 + rnd() * rnd() * 14;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(30,26,22,0.55)');
            g.addColorStop(0.7, 'rgba(40,35,30,0.25)');
            g.addColorStop(0.85, `rgba(${rimColor[0]},${rimColor[1]},${rimColor[2]},0.5)`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
    }

    // ---------- Titan haze ----------

    static _addTitanHaze(moon) {
        const hazeGeo = new THREE.SphereGeometry(moon.radius * 1.12, 48, 24);
        const hazeMat = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: new THREE.Color(0xe8a04a) } },
            vertexShader: `
                varying vec3 vNormalW;
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vNormalW = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying vec3 vNormalW;
                varying vec3 vWorldPos;
                void main() {
                    vec3 V = normalize(cameraPosition - vWorldPos);
                    float fresnel = pow(1.0 - abs(dot(V, normalize(vNormalW))), 2.2);
                    gl_FragColor = vec4(uColor, fresnel * 0.55);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        moon.mesh.add(new THREE.Mesh(hazeGeo, hazeMat));
    }

    // ---------- Enceladus geysers ----------

    static _addGeysers(moon, rnd) {
        const COUNT = 260;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(COUNT * 3);
        const life = new Float32Array(COUNT);
        const vel = [];
        for (let i = 0; i < COUNT; i++) {
            life[i] = rnd();
            vel.push(Moons._geyserVelocity(moon.radius, rnd));
            positions[i * 3 + 1] = -moon.radius; // start at the south pole
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: 0xdef2ff,
            size: 0.12,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true
        });

        const points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        moon.mesh.add(points);
        moon._geysers = { points, life, vel, rnd };
    }

    static _geyserVelocity(radius, rnd) {
        // Up-and-out cone from the south pole (in the moon's local frame)
        const spread = 0.35;
        return new THREE.Vector3(
            (rnd() - 0.5) * spread,
            -(0.7 + rnd() * 0.9),
            (rnd() - 0.5) * spread
        ).multiplyScalar(radius * 1.6);
    }

    static _updateGeysers(moon, dt) {
        const g = moon._geysers;
        const pos = g.points.geometry.attributes.position.array;
        for (let i = 0; i < g.life.length; i++) {
            g.life[i] += dt * 0.5;
            if (g.life[i] > 1) {
                g.life[i] = 0;
                g.vel[i] = Moons._geyserVelocity(moon.radius, g.rnd);
                pos[i * 3] = 0; pos[i * 3 + 1] = -moon.radius; pos[i * 3 + 2] = 0;
            } else {
                pos[i * 3]     += g.vel[i].x * dt;
                pos[i * 3 + 1] += g.vel[i].y * dt;
                pos[i * 3 + 2] += g.vel[i].z * dt;
            }
        }
        g.points.geometry.attributes.position.needsUpdate = true;
        g.points.material.opacity = 0.55 + Math.sin(performance.now() * 0.001) * 0.1;
    }

    // ---------- Utilities ----------

    static _hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    static _mulberry32(seed) {
        return function() {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
}

Moons._tmpVec = new THREE.Vector3();
