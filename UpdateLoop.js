// UpdateLoop.js - CINEMATIC game loop with smooth timing and performance monitoring
// Features: Frame pacing, adaptive quality, comprehensive stats

class UpdateLoop {
    constructor(rendererCore, hud = null, radar = null, systems = []) {
        console.log("⏳ UpdateLoop: Initializing CINEMATIC animation system...");

        this.rendererCore = rendererCore;
        this.hud = hud;
        this.radar = radar;
        this.systems = systems;

        // Timing - high precision
        this.lastTime = 0;
        this.deltaTime = 0;
        this.frameCount = 0;
        this.totalTime = 0;

        // FPS tracking with history - target 120Hz for ProMotion displays
        this.fps = 60;
        this.fpsHistory = [];
        this.fpsHistorySize = 120;  // Track last 120 frames
        this.targetFPS = 120;  // Target ProMotion 120Hz on supported devices

        // State
        this.isRunning = false;
        this.isPaused = false;

        // Performance monitoring
        this.performanceStats = {
            averageDelta: 0,
            worstDelta: 0,
            bestDelta: Infinity,
            frameTimeSum: 0,
            frameTimeCount: 0,
            jank: 0,  // Frames that took too long
            smoothness: 100  // Percentage of smooth frames
        };

        // Frame timing for smooth animation (target 120fps on ProMotion)
        this.frameBudget = 1000 / 120;  // ~8.33ms for 120fps
        this.lastFrameTimes = [];
        this.maxFrameTimeHistory = 10;

        // Adaptive quality
        this.qualityLevel = 1.0;  // 0.5 to 1.0
        this.autoQuality = true;

        console.log("✅ CINEMATIC UpdateLoop ready with", systems.length, "systems");
    }

    start() {
        if (this.isRunning) {
            console.warn("⚠️ UpdateLoop already running");
            return;
        }

        this.isRunning = true;
        this.isPaused = false;
        this.lastTime = performance.now();
        this.frameCount = 0;
        this.totalTime = 0;

        // Reset performance stats
        this.performanceStats = {
            averageDelta: 0,
            worstDelta: 0,
            bestDelta: Infinity,
            frameTimeSum: 0,
            frameTimeCount: 0,
            jank: 0,
            smoothness: 100
        };

        console.log("▶️ UpdateLoop started");
        requestAnimationFrame(this.loop);
    }

    stop() {
        this.isRunning = false;
        console.log("⏹️ UpdateLoop stopped");
        this.logFinalStats();
    }

    pause() {
        this.isPaused = true;
        console.log("⏸️ UpdateLoop paused");
    }

    resume() {
        if (this.isPaused) {
            this.isPaused = false;
            this.lastTime = performance.now();
            console.log("▶️ UpdateLoop resumed");
        }
    }

    loop = (currentTime) => {
        if (!this.isRunning) return;

        try {
            // Check for WebGL context loss
            const gl = this.rendererCore?.renderer?.getContext?.();
            if (gl && gl.isContextLost && gl.isContextLost()) {
                console.error("❌ WebGL context lost!");
                return;
            }

            // Calculate delta time with high precision
            if (this.lastTime === 0) this.lastTime = currentTime;
            const rawDelta = currentTime - this.lastTime;
            this.lastTime = currentTime;

            // Convert to seconds and clamp
            this.deltaTime = Math.min(rawDelta / 1000, 0.1);

            // Track frame time for smoothness analysis
            this.lastFrameTimes.push(rawDelta);
            if (this.lastFrameTimes.length > this.maxFrameTimeHistory) {
                this.lastFrameTimes.shift();
            }

            // Update performance stats
            this.updatePerformanceStats(rawDelta);

            if (!this.isPaused) {
                this.totalTime += this.deltaTime;
                this.frameCount++;

                // Update all systems
                this.updateSystems();

                // Render
                this.render();

                // Update UI elements
                this.updateUI();

                // Adaptive quality adjustment
                if (this.autoQuality && this.frameCount % 60 === 0) {
                    this.adjustQuality();
                }
            }
        } catch (e) {
            console.error("❌ Loop error:", e.message || e);
        }

        requestAnimationFrame(this.loop);
    }

    updateSystems() {
        const systemCount = this.systems.length;

        for (let i = 0; i < systemCount; i++) {
            const system = this.systems[i];
            if (system && system.update) {
                try {
                    system.update(this.deltaTime, this.rendererCore);
                } catch (e) {
                    const name = system.name || system.constructor?.name || 'Unknown';
                    console.error(`❌ System update error [${name}]:`, e);
                }
            }
        }
    }

    render() {
        if (!this.rendererCore?.renderer || !this.rendererCore?.scene || !this.rendererCore?.camera) {
            return;
        }

        try {
            // Always render - composer (if enabled) runs in updateSystems via ComposerRender system
            // and will overwrite this frame. If no composer, this is the only render.
            this.rendererCore.renderer.render(
                this.rendererCore.scene,
                this.rendererCore.camera
            );
        } catch (e) {
            console.error("❌ Render error:", e);
        }
    }

    updateUI() {
        // Update HUD
        if (this.hud) {
            const cameraPos = this.rendererCore?.camera?.position?.clone();
            if (cameraPos) {
                const nearest = this.getNearestObject(cameraPos);

                // Calculate heading from camera rotation
                let heading = 0;
                if (this.rendererCore?.camera) {
                    const dir = new THREE.Vector3(0, 0, -1);
                    dir.applyQuaternion(this.rendererCore.camera.quaternion);
                    heading = Math.atan2(dir.x, dir.z) * (180 / Math.PI);
                }

                this.hud.update({
                    position: cameraPos,
                    speed: typeof navPhysics !== 'undefined' ? navPhysics.getSpeed() : 0,
                    velocity: typeof navPhysics !== 'undefined' ? navPhysics.velocity?.length() : 0,
                    altitude: nearest ? cameraPos.distanceTo(nearest.mesh.position) - (nearest.radius || 0) : 0,
                    nearestObject: nearest ? nearest.name : "Deep Space",
                    fps: this.fps,
                    heading: heading,
                    isThrusting: typeof navPhysics !== 'undefined' ? navPhysics.isThrusting : false,
                    isBoosting: typeof navPhysics !== 'undefined' ? navPhysics.isBoosting : false
                });
            }
        }

        // Update radar
        if (this.radar && typeof objects !== 'undefined') {
            const radarObjects = objects.filter(o =>
                o.type === "planet" ||
                o.type === "star" ||
                o.type === "moon" ||
                o.type === "comet" ||
                o.type === "nebula"
            );

            if (this.rendererCore?.camera) {
                this.radar.update(
                    this.rendererCore.camera.position,
                    radarObjects,
                    this.rendererCore.camera.rotation
                );
            }
        }
    }

    updatePerformanceStats(rawDelta) {
        this.performanceStats.frameTimeSum += rawDelta;
        this.performanceStats.frameTimeCount++;

        // Track worst/best frame times
        if (rawDelta > this.performanceStats.worstDelta) {
            this.performanceStats.worstDelta = rawDelta;
        }
        if (rawDelta < this.performanceStats.bestDelta) {
            this.performanceStats.bestDelta = rawDelta;
        }

        // Track jank (frames > 2x budget)
        if (rawDelta > this.frameBudget * 2) {
            this.performanceStats.jank++;
        }

        // Calculate FPS from history
        this.fpsHistory.push(rawDelta);
        if (this.fpsHistory.length > this.fpsHistorySize) {
            this.fpsHistory.shift();
        }

        // Update FPS every 10 frames
        if (this.frameCount % 10 === 0 && this.fpsHistory.length > 0) {
            const avgFrameTime = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
            this.fps = Math.round(1000 / avgFrameTime);

            // Calculate smoothness
            const smoothFrames = this.fpsHistory.filter(ft => ft < this.frameBudget * 1.5).length;
            this.performanceStats.smoothness = Math.round((smoothFrames / this.fpsHistory.length) * 100);

            // Calculate average delta
            this.performanceStats.averageDelta = avgFrameTime;
        }
    }

    adjustQuality() {
        if (!this.autoQuality) return;

        const targetFrameTime = 1000 / this.targetFPS;

        if (this.performanceStats.averageDelta > targetFrameTime * 1.5) {
            // Performance is poor, reduce quality
            this.qualityLevel = Math.max(0.5, this.qualityLevel - 0.1);
            console.log(`📉 Quality reduced to ${(this.qualityLevel * 100).toFixed(0)}%`);
        } else if (this.performanceStats.averageDelta < targetFrameTime * 0.8 && this.qualityLevel < 1.0) {
            // Performance is good, increase quality
            this.qualityLevel = Math.min(1.0, this.qualityLevel + 0.05);
            console.log(`📈 Quality increased to ${(this.qualityLevel * 100).toFixed(0)}%`);
        }
    }

    getNearestObject(position) {
        if (typeof objects === 'undefined' || !objects) return null;

        let minDist = Infinity;
        let nearest = null;

        for (const obj of objects) {
            if (obj.mesh && obj.mesh.position) {
                const dist = position.distanceTo(obj.mesh.position);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = obj;
                }
            }
        }

        return nearest;
    }

    addSystem(system) {
        if (!system) {
            console.warn("⚠️ Attempted to add null system");
            return;
        }

        this.systems.push(system);
        const systemName = system.name || system.constructor?.name || 'Anonymous';
        console.log(`➕ Added system: ${systemName}`);
    }

    removeSystem(system) {
        const index = this.systems.indexOf(system);
        if (index > -1) {
            this.systems.splice(index, 1);
            const systemName = system.name || system.constructor?.name || 'Anonymous';
            console.log(`➖ Removed system: ${systemName}`);
        }
    }

    // Public getters
    getFPS() {
        return this.fps;
    }

    getDeltaTime() {
        return this.deltaTime;
    }

    getTotalTime() {
        return this.totalTime;
    }

    getFrameCount() {
        return this.frameCount;
    }

    getQualityLevel() {
        return this.qualityLevel;
    }

    getPerformanceStats() {
        return {
            fps: this.fps,
            averageDelta: this.performanceStats.averageDelta,
            worstDelta: this.performanceStats.worstDelta,
            bestDelta: this.performanceStats.bestDelta,
            frameCount: this.frameCount,
            jank: this.performanceStats.jank,
            smoothness: this.performanceStats.smoothness,
            qualityLevel: this.qualityLevel,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            systemCount: this.systems.length
        };
    }

    logPerformance() {
        const stats = this.getPerformanceStats();
        const info = this.rendererCore?.getInfo?.();

        console.log(
            `🎮 Frame ${this.frameCount} | ` +
            `FPS: ${stats.fps} | ` +
            `Delta: ${stats.averageDelta.toFixed(1)}ms | ` +
            `Smoothness: ${stats.smoothness}% | ` +
            `Quality: ${(stats.qualityLevel * 100).toFixed(0)}%` +
            (info ? ` | Tris: ${info.triangles?.toLocaleString()}` : '')
        );
    }

    logFinalStats() {
        const stats = this.getPerformanceStats();
        console.log("📊 Final Performance Report:");
        console.log(`   Total frames: ${stats.frameCount}`);
        console.log(`   Average FPS: ${stats.fps}`);
        console.log(`   Best frame: ${stats.bestDelta.toFixed(1)}ms`);
        console.log(`   Worst frame: ${stats.worstDelta.toFixed(1)}ms`);
        console.log(`   Jank frames: ${stats.jank}`);
        console.log(`   Smoothness: ${stats.smoothness}%`);
    }

    // Configuration
    setTargetFPS(fps) {
        this.targetFPS = Math.max(30, Math.min(120, fps));
        this.frameBudget = 1000 / this.targetFPS;
        console.log(`🎯 Target FPS set to ${this.targetFPS}`);
    }

    setAutoQuality(enabled) {
        this.autoQuality = enabled;
        console.log(`🔧 Auto quality ${enabled ? 'enabled' : 'disabled'}`);
    }

    setQualityLevel(level) {
        this.qualityLevel = Math.max(0.5, Math.min(1.0, level));
        console.log(`🎨 Quality level set to ${(this.qualityLevel * 100).toFixed(0)}%`);
    }
}
