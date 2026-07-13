// HUD.js - CINEMATIC sci-fi heads-up display
// Sleek holographic design with smooth animations

class HUD {
    constructor(containerId) {
        console.log("📊 HUD: Initializing CINEMATIC display...");

        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error("❌ HUD: Container not found:", containerId);
            return;
        }

        // Data cache for smooth interpolation
        this.cache = {
            position: { x: 0, y: 0, z: 0 },
            speed: 0,
            altitude: 0,
            nearestObject: "None",
            nearestDistance: 0,
            fps: 60,
            heading: 0,
            pitch: 0
        };

        this.smoothingFactor = 0.12;
        this.time = 0;

        this.createHUDElements();
        this.cacheElements();
        this.startAnimationLoop();

        console.log("✅ CINEMATIC HUD initialized");
    }

    createHUDElements() {
        this.container.innerHTML = `
            <div class="hud-wrapper">
                <!-- Speed gauge -->
                <div class="hud-gauge speed-gauge">
                    <svg viewBox="0 0 100 100" class="gauge-ring">
                        <circle class="gauge-bg" cx="50" cy="50" r="45" />
                        <circle class="gauge-fill speed-fill" cx="50" cy="50" r="45" />
                    </svg>
                    <div class="gauge-value">
                        <span class="gauge-number" id="hud-speed">0</span>
                        <span class="gauge-unit">m/s</span>
                    </div>
                    <div class="gauge-label">VELOCITY</div>
                </div>

                <!-- Main data panel -->
                <div class="hud-data-panel">
                    <div class="hud-row">
                        <span class="hud-icon">◈</span>
                        <span class="hud-label">X</span>
                        <span class="hud-value" id="hud-x">0</span>
                    </div>
                    <div class="hud-row">
                        <span class="hud-icon">◈</span>
                        <span class="hud-label">Y</span>
                        <span class="hud-value" id="hud-y">0</span>
                    </div>
                    <div class="hud-row">
                        <span class="hud-icon">◈</span>
                        <span class="hud-label">Z</span>
                        <span class="hud-value" id="hud-z">0</span>
                    </div>
                    <div class="hud-divider"></div>
                    <div class="hud-row">
                        <span class="hud-icon">⊕</span>
                        <span class="hud-label">ALT</span>
                        <span class="hud-value" id="hud-alt">0</span>
                    </div>
                    <div class="hud-row">
                        <span class="hud-icon">⌖</span>
                        <span class="hud-label">TGT</span>
                        <span class="hud-value target-name" id="hud-target">None</span>
                    </div>
                </div>

                <!-- Compass ring -->
                <div class="hud-compass">
                    <div class="compass-ring" id="compass-ring">
                        <span class="compass-marker n">N</span>
                        <span class="compass-marker e">E</span>
                        <span class="compass-marker s">S</span>
                        <span class="compass-marker w">W</span>
                    </div>
                    <div class="compass-heading" id="compass-heading">000°</div>
                </div>

                <!-- Status indicators -->
                <div class="hud-status">
                    <div class="status-item" id="thrust-status">
                        <span class="status-dot"></span>
                        <span class="status-label">THRUST</span>
                    </div>
                    <div class="status-item" id="boost-status">
                        <span class="status-dot"></span>
                        <span class="status-label">BOOST</span>
                    </div>
                </div>

                <!-- FPS counter -->
                <div class="hud-fps">
                    <span id="hud-fps">60</span> FPS
                </div>
            </div>
        `;

        // Inject styles
        this.injectStyles();
    }

    injectStyles() {
        if (document.getElementById('hud-cinematic-styles')) return;

        const style = document.createElement('style');
        style.id = 'hud-cinematic-styles';
        style.textContent = `
            .hud-wrapper {
                font-family: 'Courier New', monospace;
                color: #00ffff;
                text-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
                pointer-events: none;
            }

            .hud-gauge {
                position: absolute;
                width: 80px;
                height: 80px;
            }

            .speed-gauge {
                bottom: 20px;
                left: 20px;
            }

            .gauge-ring {
                width: 100%;
                height: 100%;
                transform: rotate(-90deg);
            }

            .gauge-bg {
                fill: none;
                stroke: rgba(0, 255, 255, 0.1);
                stroke-width: 4;
            }

            .gauge-fill {
                fill: none;
                stroke: #00ffff;
                stroke-width: 4;
                stroke-linecap: round;
                stroke-dasharray: 283;
                stroke-dashoffset: 283;
                transition: stroke-dashoffset 0.3s ease-out;
                filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.8));
            }

            .gauge-value {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
            }

            .gauge-number {
                font-size: 16px;
                font-weight: bold;
                display: block;
            }

            .gauge-unit {
                font-size: 8px;
                opacity: 0.7;
            }

            .gauge-label {
                position: absolute;
                bottom: -16px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 8px;
                letter-spacing: 2px;
                opacity: 0.7;
            }

            .hud-data-panel {
                position: absolute;
                top: 20px;
                left: 20px;
                background: rgba(0, 255, 255, 0.04);
                border: 1px solid rgba(0, 255, 255, 0.15);
                border-radius: 8px;
                padding: 12px 16px;
                min-width: 140px;
            }

            .hud-row {
                display: flex;
                align-items: center;
                gap: 8px;
                margin: 6px 0;
                font-size: 11px;
            }

            .hud-icon {
                font-size: 10px;
                opacity: 0.6;
            }

            .hud-label {
                flex: 0 0 30px;
                opacity: 0.7;
                letter-spacing: 1px;
            }

            .hud-value {
                flex: 1;
                text-align: right;
                font-weight: bold;
                font-size: 12px;
            }

            .hud-divider {
                height: 1px;
                background: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.3), transparent);
                margin: 8px 0;
            }

            .target-name {
                color: #ffaa00;
                text-shadow: 0 0 8px rgba(255, 170, 0, 0.5);
            }

            .hud-compass {
                position: absolute;
                top: 20px;
                right: 20px;
                width: 60px;
                height: 60px;
            }

            .compass-ring {
                width: 100%;
                height: 100%;
                border: 2px solid rgba(0, 255, 255, 0.3);
                border-radius: 50%;
                position: relative;
                transition: transform 0.2s ease-out;
            }

            .compass-marker {
                position: absolute;
                font-size: 8px;
                font-weight: bold;
            }

            .compass-marker.n { top: 4px; left: 50%; transform: translateX(-50%); color: #ff4444; }
            .compass-marker.e { right: 4px; top: 50%; transform: translateY(-50%); }
            .compass-marker.s { bottom: 4px; left: 50%; transform: translateX(-50%); }
            .compass-marker.w { left: 4px; top: 50%; transform: translateY(-50%); }

            .compass-heading {
                position: absolute;
                bottom: -18px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 10px;
                font-weight: bold;
            }

            .hud-status {
                position: absolute;
                bottom: 20px;
                right: 20px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .status-item {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 10px;
                opacity: 0.5;
                transition: opacity 0.2s;
            }

            .status-item.active {
                opacity: 1;
            }

            .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(0, 255, 255, 0.3);
                transition: all 0.2s;
            }

            .status-item.active .status-dot {
                background: #00ff88;
                box-shadow: 0 0 10px #00ff88;
            }

            .status-label {
                letter-spacing: 1px;
            }

            .hud-fps {
                position: absolute;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 10px;
                opacity: 0.5;
            }

            /* Scanning line animation - subtle */
            .hud-data-panel::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 1px;
                background: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.2), transparent);
                animation: scanLine 3s linear infinite;
            }

            @keyframes scanLine {
                0% { top: 0; opacity: 0; }
                10% { opacity: 0.5; }
                90% { opacity: 0.5; }
                100% { top: 100%; opacity: 0; }
            }

            /* Warning pulse */
            .hud-warning {
                animation: warningPulse 0.5s ease-in-out infinite;
            }

            @keyframes warningPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }

    cacheElements() {
        this.speedEl = document.getElementById('hud-speed');
        this.altEl = document.getElementById('hud-alt');
        this.xEl = document.getElementById('hud-x');
        this.yEl = document.getElementById('hud-y');
        this.zEl = document.getElementById('hud-z');
        this.targetEl = document.getElementById('hud-target');
        this.fpsEl = document.getElementById('hud-fps');
        this.compassRing = document.getElementById('compass-ring');
        this.compassHeading = document.getElementById('compass-heading');
        this.thrustStatus = document.getElementById('thrust-status');
        this.boostStatus = document.getElementById('boost-status');
        this.speedFill = this.container.querySelector('.speed-fill');

        // External elements that may exist
        this.velocityBar = document.getElementById('velocity-bar');
        this.velocityValue = document.getElementById('velocity-value');
        this.targetName = document.getElementById('target-name');
        this.targetDistance = document.getElementById('target-distance');
        this.thrustIndicator = document.getElementById('thrust-indicator');
    }

    startAnimationLoop() {
        const animate = () => {
            this.time += 0.016;
            requestAnimationFrame(animate);
        };
        animate();
    }

    update(data) {
        if (!data) return;

        // Smooth interpolation for all values
        this.cache.position.x = this.lerp(this.cache.position.x, data.position?.x || 0, this.smoothingFactor);
        this.cache.position.y = this.lerp(this.cache.position.y, data.position?.y || 0, this.smoothingFactor);
        this.cache.position.z = this.lerp(this.cache.position.z, data.position?.z || 0, this.smoothingFactor);
        this.cache.speed = this.lerp(this.cache.speed, data.speed || 0, this.smoothingFactor);
        this.cache.altitude = this.lerp(this.cache.altitude, data.altitude || 0, this.smoothingFactor);

        // Update position display
        if (this.xEl) this.xEl.textContent = this.formatNumber(this.cache.position.x);
        if (this.yEl) this.yEl.textContent = this.formatNumber(this.cache.position.y);
        if (this.zEl) this.zEl.textContent = this.formatNumber(this.cache.position.z);

        // Update speed
        if (this.speedEl) this.speedEl.textContent = Math.round(this.cache.speed);

        // Update speed gauge fill
        if (this.speedFill) {
            const maxSpeed = 200;
            const percentage = Math.min(this.cache.speed / maxSpeed, 1);
            const offset = 283 * (1 - percentage);
            this.speedFill.style.strokeDashoffset = offset;

            // Color based on speed
            if (percentage > 0.8) {
                this.speedFill.style.stroke = '#ff4444';
            } else if (percentage > 0.5) {
                this.speedFill.style.stroke = '#ffaa00';
            } else {
                this.speedFill.style.stroke = '#00ffff';
            }
        }

        // Update altitude
        if (this.altEl) this.altEl.textContent = this.formatNumber(this.cache.altitude);

        // Update target
        if (data.nearestObject && data.nearestObject !== this.cache.nearestObject) {
            this.cache.nearestObject = data.nearestObject;
            if (this.targetEl) {
                this.targetEl.textContent = data.nearestObject.toUpperCase();
            }
        }

        // Update FPS
        if (data.fps && this.fpsEl) {
            this.fpsEl.textContent = data.fps;
        }

        // Update compass heading
        if (data.heading !== undefined && this.compassRing) {
            this.cache.heading = this.lerpAngle(this.cache.heading, data.heading, this.smoothingFactor);
            this.compassRing.style.transform = `rotate(${-this.cache.heading}deg)`;
            if (this.compassHeading) {
                this.compassHeading.textContent = `${Math.round((this.cache.heading + 360) % 360).toString().padStart(3, '0')}°`;
            }
        }

        // Update thrust status
        if (this.thrustStatus) {
            if (data.isThrusting) {
                this.thrustStatus.classList.add('active');
            } else {
                this.thrustStatus.classList.remove('active');
            }
        }

        // Update boost status
        if (this.boostStatus) {
            if (data.isBoosting) {
                this.boostStatus.classList.add('active');
            } else {
                this.boostStatus.classList.remove('active');
            }
        }

        // Legacy element updates
        if (this.velocityBar) {
            const maxSpeed = 150;
            const percentage = Math.min((this.cache.speed / maxSpeed) * 100, 100);
            this.velocityBar.style.width = percentage + '%';
        }

        if (this.velocityValue) {
            this.velocityValue.textContent = Math.round(this.cache.speed) + ' m/s';
        }

        if (this.targetName && data.nearestObject) {
            this.targetName.textContent = data.nearestObject.toUpperCase();
        }

        if (this.targetDistance) {
            this.targetDistance.textContent = Math.round(this.cache.altitude) + ' units';
        }

        if (this.thrustIndicator) {
            if (data.isThrusting) {
                this.thrustIndicator.classList.add('active');
            } else {
                this.thrustIndicator.classList.remove('active');
            }
        }
    }

    formatNumber(num) {
        const absNum = Math.abs(num);
        if (absNum >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (absNum >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return Math.round(num).toString();
    }

    lerp(start, end, factor) {
        return start + (end - start) * factor;
    }

    lerpAngle(start, end, factor) {
        let diff = end - start;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        return start + diff * factor;
    }

    showWarning(message, duration = 3000) {
        const warning = document.createElement('div');
        warning.className = 'hud-notification warning';
        warning.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 68, 68, 0.15);
            color: #ff6666;
            padding: 16px 32px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            z-index: 1000;
            border: 1px solid rgba(255, 68, 68, 0.3);
            text-shadow: 0 0 10px rgba(255, 0, 0, 0.3);
            animation: warningPulse 0.5s ease-in-out infinite;
        `;
        warning.textContent = message;
        document.body.appendChild(warning);

        setTimeout(() => {
            warning.style.transition = 'opacity 0.3s';
            warning.style.opacity = '0';
            setTimeout(() => warning.remove(), 300);
        }, duration);
    }

    showInfo(message, duration = 2000) {
        const info = document.createElement('div');
        info.className = 'hud-notification info';
        info.style.cssText = `
            position: fixed;
            bottom: 150px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 255, 255, 0.08);
            color: #00ffff;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 12px;
            z-index: 1000;
            border: 1px solid rgba(0, 255, 255, 0.2);
            text-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
        `;
        info.textContent = message;
        document.body.appendChild(info);

        setTimeout(() => {
            info.style.transition = 'opacity 0.3s, transform 0.3s';
            info.style.opacity = '0';
            info.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => info.remove(), 300);
        }, duration);
    }

    showTargetLock(targetName) {
        const lock = document.createElement('div');
        lock.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80px;
            height: 80px;
            border: 2px solid #ffaa00;
            border-radius: 50%;
            animation: targetLock 0.5s ease-out forwards;
            pointer-events: none;
            z-index: 1000;
        `;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes targetLock {
                0% { width: 200px; height: 200px; opacity: 0; }
                100% { width: 80px; height: 80px; opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(lock);

        this.showInfo(`TARGET LOCKED: ${targetName.toUpperCase()}`, 2000);

        setTimeout(() => {
            lock.style.transition = 'opacity 0.3s';
            lock.style.opacity = '0';
            setTimeout(() => lock.remove(), 300);
        }, 2000);
    }

    showPlanetToast(name) {
        this.showInfo("NAV: " + name.toUpperCase());
    }

    hide() {
        if (this.container) this.container.style.display = 'none';
    }

    show() {
        if (this.container) this.container.style.display = 'block';
    }
}

