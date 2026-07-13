// NavigationArrows.js - 3D navigation arrows and on-screen indicators
// Shows easy-to-follow arrows pointing to the next exploration target

class NavigationArrows {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        // Current target
        this.target = null;
        this.targetPosition = new THREE.Vector3();

        // Arrow configuration
        this.arrowCount = 5;
        this.arrows = [];
        this.arrowSpacing = 15;
        this.arrowSpeed = 2;

        // Screen indicator
        this.indicator = null;

        // Animation
        this.time = 0;

        this.createArrows();
        this.createScreenIndicator();
        this.setupEventListeners();

        console.log("🧭 NavigationArrows initialized");
    }

    createArrows() {
        // Create 3D arrow trail pointing to target
        for (let i = 0; i < this.arrowCount; i++) {
            const arrow = this.createSingleArrow(i);
            this.arrows.push(arrow);
            this.scene.add(arrow.group);
        }
    }

    createSingleArrow(index) {
        const group = new THREE.Group();

        // Arrow head (cone)
        const headGeometry = new THREE.ConeGeometry(0.5, 1.5, 8);
        const headMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.8 - (index * 0.12),
            blending: THREE.AdditiveBlending
        });
        const head = new THREE.Mesh(headGeometry, headMaterial);
        head.rotation.x = Math.PI / 2;
        group.add(head);

        // Arrow shaft
        const shaftGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 8);
        const shaftMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.5 - (index * 0.08),
            blending: THREE.AdditiveBlending
        });
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        shaft.rotation.x = Math.PI / 2;
        shaft.position.z = 1.2;
        group.add(shaft);

        // Glow ring
        const ringGeometry = new THREE.RingGeometry(0.6, 0.8, 16);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.3 - (index * 0.05),
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.z = -0.3;
        group.add(ring);

        group.visible = false;

        return {
            group,
            head,
            shaft,
            ring,
            index,
            offset: index * this.arrowSpacing
        };
    }

    createScreenIndicator() {
        // Create on-screen indicator for when target is off-screen
        this.indicator = document.createElement('div');
        this.indicator.id = 'nav-indicator';
        this.indicator.innerHTML = `
            <div class="indicator-arrow">
                <svg viewBox="0 0 60 60" width="60" height="60">
                    <defs>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                            <feMerge>
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                    </defs>
                    <polygon points="30,5 55,50 30,40 5,50" fill="#00ffff" filter="url(#glow)"/>
                </svg>
            </div>
            <div class="indicator-distance" id="indicator-distance">---</div>
            <div class="indicator-name" id="indicator-name"></div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #nav-indicator {
                position: fixed;
                pointer-events: none;
                z-index: 500;
                display: none;
                flex-direction: column;
                align-items: center;
                transform: translate(-50%, -50%);
            }

            .indicator-arrow {
                animation: indicatorPulse 1.5s ease-in-out infinite;
            }

            @keyframes indicatorPulse {
                0%, 100% { transform: scale(1); opacity: 0.9; }
                50% { transform: scale(1.1); opacity: 1; }
            }

            .indicator-distance {
                font-family: 'SF Pro Display', -apple-system, sans-serif;
                font-size: 14px;
                font-weight: 600;
                color: #00ffff;
                text-shadow: 0 0 10px rgba(0, 255, 255, 0.8);
                margin-top: 5px;
            }

            .indicator-name {
                font-family: 'SF Pro Display', -apple-system, sans-serif;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.8);
                text-shadow: 0 0 8px rgba(0, 0, 0, 0.8);
                margin-top: 2px;
            }

            /* Direction prompts */
            .direction-prompt {
                position: fixed;
                font-family: 'SF Pro Display', -apple-system, sans-serif;
                font-size: 16px;
                color: #00ffff;
                text-shadow: 0 0 15px rgba(0, 255, 255, 0.8);
                pointer-events: none;
                z-index: 501;
                animation: promptFade 2s ease-in-out infinite;
            }

            @keyframes promptFade {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }

            .prompt-left { left: 80px; top: 50%; transform: translateY(-50%); }
            .prompt-right { right: 360px; top: 50%; transform: translateY(-50%); }
            .prompt-up { top: 80px; left: 50%; transform: translateX(-50%); }
            .prompt-down { bottom: 80px; left: 50%; transform: translateX(-50%); }

            /* Target bracket (when visible) */
            .target-bracket {
                position: fixed;
                pointer-events: none;
                z-index: 499;
                transform: translate(-50%, -50%);
            }

            .bracket-corner {
                position: absolute;
                width: 20px;
                height: 20px;
                border: 2px solid #00ffff;
            }

            .bracket-tl { top: 0; left: 0; border-right: none; border-bottom: none; }
            .bracket-tr { top: 0; right: 0; border-left: none; border-bottom: none; }
            .bracket-bl { bottom: 0; left: 0; border-right: none; border-top: none; }
            .bracket-br { bottom: 0; right: 0; border-left: none; border-top: none; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.indicator);

        // Create direction prompts
        this.prompts = {};
        ['left', 'right', 'up', 'down'].forEach(dir => {
            const prompt = document.createElement('div');
            prompt.className = `direction-prompt prompt-${dir}`;
            prompt.style.display = 'none';
            document.body.appendChild(prompt);
            this.prompts[dir] = prompt;
        });

        // Create target bracket
        this.bracket = document.createElement('div');
        this.bracket.className = 'target-bracket';
        this.bracket.innerHTML = `
            <div class="bracket-corner bracket-tl"></div>
            <div class="bracket-corner bracket-tr"></div>
            <div class="bracket-corner bracket-bl"></div>
            <div class="bracket-corner bracket-br"></div>
        `;
        this.bracket.style.display = 'none';
        document.body.appendChild(this.bracket);

        this.indicatorDistanceEl = document.getElementById('indicator-distance');
        this.indicatorNameEl = document.getElementById('indicator-name');
    }

    setupEventListeners() {
        window.addEventListener('targetChanged', (e) => {
            if (e.detail?.target) {
                this.setTarget(e.detail.target);
            }
        });
    }

    setTarget(target) {
        this.target = target;
        if (target?.mesh?.position) {
            this.targetPosition.copy(target.mesh.position);
        }

        // Show arrows
        this.arrows.forEach(arrow => {
            arrow.group.visible = !!target;
        });
    }

    update(deltaTime) {
        this.time += deltaTime;

        if (!this.target || !this.camera) {
            this.hideIndicators();
            return;
        }

        // Update target position (in case it's moving)
        if (this.target.mesh?.position) {
            this.targetPosition.copy(this.target.mesh.position);
        }

        const cameraPos = this.camera.position;
        const distance = cameraPos.distanceTo(this.targetPosition);

        // Direction to target
        const direction = this.targetPosition.clone().sub(cameraPos).normalize();

        // Update 3D arrows
        this.updateArrows(direction, distance);

        // Update screen indicator
        this.updateScreenIndicator(distance);
    }

    updateArrows(direction, distance) {
        const cameraPos = this.camera.position;

        // Hide arrows if too close
        if (distance < 30) {
            this.arrows.forEach(a => a.group.visible = false);
            return;
        }

        this.arrows.forEach((arrow, i) => {
            // Calculate arrow position along path to target
            const waveOffset = Math.sin(this.time * this.arrowSpeed + i * 0.8) * 2;
            const baseOffset = 10 + i * this.arrowSpacing + waveOffset;

            // Position arrow in front of camera toward target
            const arrowPos = cameraPos.clone().add(direction.clone().multiplyScalar(baseOffset));
            arrow.group.position.copy(arrowPos);

            // Point arrow toward target
            arrow.group.lookAt(this.targetPosition);

            // Animate scale for pulsing effect
            const pulse = 1 + Math.sin(this.time * 3 + i) * 0.15;
            arrow.group.scale.setScalar(pulse);

            // Animate ring rotation
            arrow.ring.rotation.z = this.time * 2;

            arrow.group.visible = true;
        });
    }

    updateScreenIndicator(distance) {
        // Project target position to screen
        const targetScreen = this.targetPosition.clone().project(this.camera);

        const halfWidth = window.innerWidth / 2;
        const halfHeight = window.innerHeight / 2;
        const screenX = (targetScreen.x * halfWidth) + halfWidth;
        const screenY = -(targetScreen.y * halfHeight) + halfHeight;

        // Check if target is on screen and in front of camera
        const onScreen = targetScreen.z < 1 &&
                        screenX > 100 && screenX < window.innerWidth - 380 &&
                        screenY > 100 && screenY < window.innerHeight - 100;

        // Update indicator name
        if (this.indicatorNameEl && this.target) {
            this.indicatorNameEl.textContent = this.target.name;
        }

        if (onScreen) {
            // Hide edge indicator, show bracket
            this.indicator.style.display = 'none';
            this.hidePrompts();

            // Show bracket around target
            if (distance < 200) {
                const bracketSize = Math.max(40, Math.min(120, 3000 / distance));
                this.bracket.style.display = 'block';
                this.bracket.style.left = `${screenX}px`;
                this.bracket.style.top = `${screenY}px`;
                this.bracket.style.width = `${bracketSize}px`;
                this.bracket.style.height = `${bracketSize}px`;

                // Pulse animation
                const pulse = 1 + Math.sin(this.time * 3) * 0.1;
                this.bracket.style.transform = `translate(-50%, -50%) scale(${pulse})`;
            } else {
                this.bracket.style.display = 'none';
            }
        } else {
            // Target is off screen - show edge indicator
            this.bracket.style.display = 'none';

            // Calculate edge position
            let edgeX, edgeY;
            const padding = 80;

            if (targetScreen.z > 1) {
                // Behind camera - point opposite direction
                edgeX = window.innerWidth / 2 - (screenX - window.innerWidth / 2);
                edgeY = window.innerHeight / 2 - (screenY - window.innerHeight / 2);
            } else {
                edgeX = screenX;
                edgeY = screenY;
            }

            // Clamp to screen edges — the bottom ~28% is the native control zone
            // (joystick / speed / THRUST cluster), so the arrow may never enter it
            // or it covers the buttons.
            edgeX = Math.max(padding, Math.min(window.innerWidth - 380, edgeX));
            edgeY = Math.max(padding, Math.min(window.innerHeight * 0.72 - padding, edgeY));

            // Position indicator
            this.indicator.style.display = 'flex';
            this.indicator.style.left = `${edgeX}px`;
            this.indicator.style.top = `${edgeY}px`;

            // Rotate arrow to point toward target
            const angle = Math.atan2(screenY - edgeY, screenX - edgeX) * (180 / Math.PI) + 90;
            this.indicator.querySelector('.indicator-arrow').style.transform = `rotate(${angle}deg)`;

            // Update distance
            if (this.indicatorDistanceEl) {
                this.indicatorDistanceEl.textContent = this.formatDistance(distance);
            }

            // Show direction prompts
            this.updatePrompts(screenX, screenY);
        }
    }

    updatePrompts(targetX, targetY) {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        // Hide all first
        Object.values(this.prompts).forEach(p => p.style.display = 'none');

        // Determine primary direction
        const dx = targetX - centerX;
        const dy = targetY - centerY;

        if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal is primary
            if (dx < -100) {
                this.prompts.left.textContent = '← TURN LEFT';
                this.prompts.left.style.display = 'block';
            } else if (dx > 100) {
                this.prompts.right.textContent = 'TURN RIGHT →';
                this.prompts.right.style.display = 'block';
            }
        } else {
            // Vertical is primary
            if (dy < -100) {
                this.prompts.up.textContent = '↑ LOOK UP';
                this.prompts.up.style.display = 'block';
            } else if (dy > 100) {
                this.prompts.down.textContent = '↓ LOOK DOWN';
                this.prompts.down.style.display = 'block';
            }
        }
    }

    hidePrompts() {
        Object.values(this.prompts).forEach(p => p.style.display = 'none');
    }

    hideIndicators() {
        this.indicator.style.display = 'none';
        this.bracket.style.display = 'none';
        this.hidePrompts();
        this.arrows.forEach(a => a.group.visible = false);
    }

    formatDistance(distance) {
        if (distance >= 1000) {
            return `${(distance / 1000).toFixed(1)}k`;
        }
        return `${Math.round(distance)}m`;
    }

    // Change arrow color
    setColor(color) {
        const col = new THREE.Color(color);
        this.arrows.forEach(arrow => {
            arrow.head.material.color = col;
            arrow.shaft.material.color = col;
            arrow.ring.material.color = col;
        });
    }

    dispose() {
        this.arrows.forEach(arrow => {
            this.scene.remove(arrow.group);
            arrow.group.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });
        this.arrows = [];

        if (this.indicator) this.indicator.remove();
        if (this.bracket) this.bracket.remove();
        Object.values(this.prompts).forEach(p => p.remove());
    }
}

if (typeof module !== 'undefined') module.exports = NavigationArrows;
