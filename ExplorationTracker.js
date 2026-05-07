// ExplorationTracker.js - Exploration system with leaderboard UI
// Tracks discovered and explored objects, shows progress

class ExplorationTracker {
    constructor(catalog, camera) {
        this.catalog = catalog;
        this.camera = camera;

        // Exploration thresholds
        this.discoveryRange = 500;  // Distance to "discover" an object
        this.explorationRange = 20; // Distance to "explore" an object

        // Current target
        this.currentTarget = null;
        this.autoTargetEnabled = true;

        // UI container
        this.container = null;

        // Animation
        this.time = 0;

        // Startup grace period - don't trigger discoveries immediately
        this.startupGracePeriod = 5.0; // seconds before discoveries can trigger
        this.timeSinceStart = 0;
        this.gracePeriodActive = true;

        // Notification queue system - prevent cluttered notifications
        this.notificationQueue = [];
        this.isShowingNotification = false;
        this.notificationDelay = 2.5; // seconds between notifications
        this.lastNotificationTime = 0;

        // Sidebar visibility - hidden by default
        this.sidebarVisible = false;
        this.sidebarAutoShowThreshold = 3; // Show after N discoveries (no longer used for auto-show)

        this.createUI();
        this.startUpdateLoop();

        console.log("🔭 ExplorationTracker initialized (sidebar hidden, grace period active)");
    }

    createUI() {
        // Create sidebar container
        this.container = document.createElement('div');
        this.container.id = 'exploration-sidebar';
        this.container.innerHTML = `
            <div class="exploration-header">
                <div class="exploration-title">
                    <span class="title-icon">🔭</span>
                    <span class="title-text">EXPLORER</span>
                </div>
                <div class="exploration-stats">
                    <div class="stat-item">
                        <span class="stat-value" id="explored-count">0</span>
                        <span class="stat-label">EXPLORED</span>
                    </div>
                    <div class="stat-divider">/</div>
                    <div class="stat-item">
                        <span class="stat-value" id="total-count">0</span>
                        <span class="stat-label">TOTAL</span>
                    </div>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="exploration-progress"></div>
                </div>
                <button id="exploration-toggle-btn" style="
                    margin-top: 10px;
                    width: 100%;
                    padding: 8px 0;
                    background: rgba(0,255,255,0.2);
                    border: none;
                    border-radius: 6px;
                    color: #00ffff;
                    font-weight: 600;
                    cursor: pointer;
                    user-select: none;
                ">Toggle Sidebar</button>
            </div>

            <div class="current-target" id="current-target">
                <div class="target-header">
                    <span class="target-label">NEXT TARGET</span>
                    <span class="target-distance" id="target-distance">---</span>
                </div>
                <div class="target-name" id="target-name">Scanning...</div>
                <div class="target-type" id="target-type"></div>
                <div class="target-hint" id="target-hint">
                    <span class="arrow-hint">Follow the arrows</span>
                </div>
            </div>

            <div class="object-categories" id="object-categories">
                <!-- Categories will be populated dynamically -->
            </div>

            <div class="object-list" id="object-list">
                <!-- Objects will be populated dynamically -->
            </div>
        `;

        this.injectStyles();
        document.body.appendChild(this.container);

        // Cache elements
        this.exploredCountEl = document.getElementById('explored-count');
        this.totalCountEl = document.getElementById('total-count');
        this.progressEl = document.getElementById('exploration-progress');
        this.targetNameEl = document.getElementById('target-name');
        this.targetTypeEl = document.getElementById('target-type');
        this.targetDistanceEl = document.getElementById('target-distance');
        this.targetHintEl = document.getElementById('target-hint');
        this.categoriesEl = document.getElementById('object-categories');
        this.objectListEl = document.getElementById('object-list');

        // Button to toggle sidebar visibility manually
        const toggleBtn = document.getElementById('exploration-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggle();
            });
        }
    }

    injectStyles() {
        if (document.getElementById('exploration-styles')) return;

        const style = document.createElement('style');
        style.id = 'exploration-styles';
        style.textContent = `
            #exploration-sidebar {
                position: fixed;
                top: 0;
                right: 0;
                width: 280px;
                height: 100vh;
                background: rgba(0, 20, 40, 0.04);
                border-left: 1px solid rgba(0, 255, 255, 0.15);
                font-family: 'SF Pro Display', -apple-system, sans-serif;
                color: #fff;
                z-index: 1000;
                display: none;
                flex-direction: column;
                overflow: hidden;
                transform: translateX(100%);
                transition: transform 0.4s ease-out, opacity 0.3s ease-out;
                opacity: 0;
            }

            #exploration-sidebar.visible {
                display: flex;
                transform: translateX(0);
                opacity: 1;
            }

            .exploration-header {
                padding: 20px;
                border-bottom: 1px solid rgba(0, 255, 255, 0.1);
                background: rgba(0, 255, 255, 0.02);
            }

            .exploration-title {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 15px;
            }

            .title-icon {
                font-size: 24px;
            }

            .title-text {
                font-size: 18px;
                font-weight: 600;
                letter-spacing: 3px;
                color: #00ffff;
                text-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
            }

            .exploration-stats {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                margin-bottom: 12px;
            }

            .stat-item {
                text-align: center;
            }

            .stat-value {
                font-size: 28px;
                font-weight: 700;
                color: #00ff88;
                text-shadow: 0 0 15px rgba(0, 255, 136, 0.5);
                display: block;
            }

            .stat-label {
                font-size: 9px;
                letter-spacing: 2px;
                opacity: 0.6;
            }

            .stat-divider {
                font-size: 24px;
                opacity: 0.3;
            }

            .progress-bar {
                height: 4px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                overflow: hidden;
            }

            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #00ffff, #00ff88);
                border-radius: 2px;
                transition: width 0.5s ease-out;
                box-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
            }

            .current-target {
                padding: 15px 20px;
                background: rgba(0, 255, 255, 0.02);
                border-bottom: 1px solid rgba(0, 255, 255, 0.1);
            }

            .target-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
            }

            .target-label {
                font-size: 10px;
                letter-spacing: 2px;
                opacity: 0.6;
            }

            .target-distance {
                font-size: 12px;
                color: #ffaa00;
                font-weight: 600;
            }

            .target-name {
                font-size: 18px;
                font-weight: 600;
                color: #fff;
                margin-bottom: 4px;
            }

            .target-type {
                font-size: 11px;
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .target-hint {
                margin-top: 10px;
                padding: 8px 12px;
                background: rgba(0, 255, 255, 0.04);
                border: 1px solid rgba(0, 255, 255, 0.15);
                border-radius: 6px;
                text-align: center;
            }

            .arrow-hint {
                font-size: 11px;
                color: #00ffff;
                animation: pulse 2s ease-in-out infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }

            .object-categories {
                padding: 15px 20px;
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                border-bottom: 1px solid rgba(0, 255, 255, 0.1);
            }

            .category-chip {
                padding: 6px 10px;
                background: rgba(0, 255, 255, 0.02);
                border: 1px solid rgba(0, 255, 255, 0.15);
                border-radius: 20px;
                font-size: 10px;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .category-chip:hover {
                background: rgba(0, 255, 255, 0.06);
                border-color: rgba(0, 255, 255, 0.25);
            }

            .category-chip.active {
                background: rgba(0, 255, 255, 0.08);
                border-color: rgba(0, 255, 255, 0.4);
                color: #00ffff;
            }

            .category-count {
                background: rgba(0, 255, 255, 0.04);
                padding: 2px 6px;
                border-radius: 10px;
                font-size: 9px;
            }

            .object-list {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
            }

            .object-list::-webkit-scrollbar {
                width: 4px;
            }

            .object-list::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
            }

            .object-list::-webkit-scrollbar-thumb {
                background: rgba(0, 255, 255, 0.3);
                border-radius: 2px;
            }

            .object-item {
                display: flex;
                align-items: center;
                padding: 12px;
                margin-bottom: 6px;
                background: rgba(0, 255, 255, 0.02);
                border: 1px solid rgba(0, 255, 255, 0.1);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .object-item:hover {
                background: rgba(0, 255, 255, 0.05);
                border-color: rgba(0, 255, 255, 0.2);
                transform: translateX(-4px);
            }

            .object-item.explored {
                border-left: 3px solid rgba(0, 255, 136, 0.6);
            }

            .object-item.discovered {
                border-left: 3px solid rgba(255, 170, 0, 0.6);
            }

            .object-item.undiscovered {
                opacity: 0.5;
            }

            .object-item.current-target {
                background: rgba(0, 255, 255, 0.06);
                border-color: rgba(0, 255, 255, 0.3);
            }

            .object-icon {
                font-size: 20px;
                margin-right: 12px;
                width: 28px;
                text-align: center;
            }

            .object-info {
                flex: 1;
                min-width: 0;
            }

            .object-name {
                font-size: 13px;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .object-type-label {
                font-size: 10px;
                opacity: 0.6;
                margin-top: 2px;
            }

            .object-distance {
                font-size: 11px;
                color: #888;
                text-align: right;
            }

            .object-status {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                margin-left: 10px;
            }

            .status-explored {
                background: #00ff88;
                box-shadow: 0 0 8px #00ff88;
            }

            .status-discovered {
                background: #ffaa00;
                box-shadow: 0 0 8px #ffaa00;
            }

            .status-unknown {
                background: rgba(255, 255, 255, 0.2);
            }

            /* Discovery notification */
            .discovery-notification {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 40, 60, 0.15);
                border: 1px solid rgba(0, 255, 255, 0.3);
                border-radius: 16px;
                padding: 30px 50px;
                text-align: center;
                z-index: 2000;
                animation: notificationPop 0.5s ease-out;
            }

            @keyframes notificationPop {
                0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }

            .discovery-icon {
                font-size: 48px;
                margin-bottom: 15px;
            }

            .discovery-label {
                font-size: 12px;
                letter-spacing: 4px;
                color: #00ffff;
                margin-bottom: 10px;
            }

            .discovery-name {
                font-size: 28px;
                font-weight: 700;
                color: #fff;
                text-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
            }
        `;
        document.head.appendChild(style);
    }

    startUpdateLoop() {
        const update = () => {
            const dt = 0.016;
            this.time += dt;
            this.timeSinceStart += dt;

            // Check if grace period is over
            if (this.gracePeriodActive && this.timeSinceStart >= this.startupGracePeriod) {
                this.gracePeriodActive = false;
                console.log("🔭 Grace period ended - discoveries now active");
            }

            // Only check proximity after grace period
            if (!this.gracePeriodActive) {
                this.checkProximity();
            }

            // Process notification queue
            this.processNotificationQueue();

            this.updateUI();
            requestAnimationFrame(update);
        };
        update();
    }

    processNotificationQueue() {
        // Don't process if currently showing a notification
        if (this.isShowingNotification) return;

        // Check if enough time has passed since last notification
        const now = this.time;
        if (now - this.lastNotificationTime < this.notificationDelay) return;

        // Get next notification from queue
        if (this.notificationQueue.length > 0) {
            const next = this.notificationQueue.shift();
            this.displayNotification(next.obj, next.type);
            this.lastNotificationTime = now;
        }
    }

    queueNotification(obj, type) {
        // Add to queue (avoid duplicates)
        const exists = this.notificationQueue.some(n => n.obj.name === obj.name && n.type === type);
        if (!exists) {
            this.notificationQueue.push({ obj, type });
        }

        // Removed auto-show sidebar on discoveries; sidebar only shows on explicit user/bridge action
        // const stats = this.catalog?.getStats();
        // if (stats && stats.discovered >= this.sidebarAutoShowThreshold && !this.sidebarVisible) {
        //     this.showSidebar();
        // }
    }

    checkProximity() {
        if (!this.camera || !this.catalog) return;

        const cameraPos = this.camera.position;

        // Limit discoveries per frame to prevent overwhelming
        let discoveriesThisFrame = 0;
        const maxDiscoveriesPerFrame = 1;

        this.catalog.objects.forEach(obj => {
            if (!obj.mesh?.position) return;
            if (discoveriesThisFrame >= maxDiscoveriesPerFrame) return;

            const distance = cameraPos.distanceTo(obj.mesh.position);

            // Check for discovery
            if (!obj.discovered && distance < this.discoveryRange) {
                const result = this.catalog.discoverObject(obj.name);
                if (result.newDiscovery) {
                    this.queueNotification(obj, 'DISCOVERED');
                    discoveriesThisFrame++;
                }
            }

            // Check for exploration (only if already discovered to avoid double-notifications)
            if (obj.discovered && !obj.explored && distance < this.explorationRange * (obj.radius || 1)) {
                const result = this.catalog.exploreObject(obj.name);
                if (result.firstExploration) {
                    this.queueNotification(obj, 'EXPLORED');
                    discoveriesThisFrame++;
                }
            }
        });

        // Auto-select next target
        if (this.autoTargetEnabled) {
            const nearest = this.catalog.getNearestUnexplored(cameraPos);
            if (nearest && (!this.currentTarget || this.currentTarget.name !== nearest.name)) {
                this.setTarget(nearest);
            }
        }
    }

    setTarget(obj) {
        this.currentTarget = obj;

        // Emit event for navigation arrows
        window.dispatchEvent(new CustomEvent('targetChanged', {
            detail: { target: obj }
        }));
    }

    displayNotification(obj, type) {
        this.isShowingNotification = true;
        const categoryInfo = this.catalog.getCategoryInfo(obj.type);

        const notification = document.createElement('div');
        notification.className = 'discovery-notification';
        notification.innerHTML = `
            <div class="discovery-icon">${categoryInfo.icon}</div>
            <div class="discovery-label">${type}</div>
            <div class="discovery-name">${obj.name}</div>
        `;
        document.body.appendChild(notification);

        // Play sound effect via iOS bridge if available
        try {
            if (window.webkit?.messageHandlers?.iosHandler) {
                window.webkit.messageHandlers.iosHandler.postMessage({
                    type: 'AUDIO',
                    action: 'play',
                    name: type === 'EXPLORED' ? 'explore_complete' : 'discovery',
                    volume: 0.5
                });
            }
        } catch (e) {}

        // Show notification for 2 seconds then fade out
        setTimeout(() => {
            notification.style.transition = 'all 0.5s ease-out';
            notification.style.opacity = '0';
            notification.style.transform = 'translate(-50%, -50%) scale(1.2)';
            setTimeout(() => {
                notification.remove();
                this.isShowingNotification = false;
            }, 500);
        }, 2000);
    }

    showSidebar() {
        if (this.sidebarVisible) return;
        this.sidebarVisible = true;
        this.container.style.display = 'flex';
        // Trigger reflow to enable transition
        this.container.offsetHeight;
        this.container.classList.add('visible');
        console.log("🔭 Exploration sidebar shown");
    }

    hideSidebar() {
        if (!this.sidebarVisible) return;
        this.sidebarVisible = false;
        this.container.classList.remove('visible');
        setTimeout(() => {
            if (!this.sidebarVisible) {
                this.container.style.display = 'none';
            }
        }, 400);
        console.log("🔭 Exploration sidebar hidden");
    }

    updateUI() {
        if (!this.catalog) return;

        const stats = this.catalog.getStats();

        // Update counts
        if (this.exploredCountEl) {
            this.exploredCountEl.textContent = stats.explored;
        }
        if (this.totalCountEl) {
            this.totalCountEl.textContent = stats.total;
        }
        if (this.progressEl) {
            this.progressEl.style.width = `${stats.percentExplored}%`;
        }

        // Update current target
        if (this.currentTarget && this.camera) {
            const distance = this.camera.position.distanceTo(
                this.currentTarget.mesh?.position || new THREE.Vector3()
            );
            const categoryInfo = this.catalog.getCategoryInfo(this.currentTarget.type);

            if (this.targetNameEl) {
                this.targetNameEl.textContent = this.currentTarget.name;
            }
            if (this.targetTypeEl) {
                this.targetTypeEl.innerHTML = `${categoryInfo.icon} ${this.currentTarget.type.replace('_', ' ')}`;
            }
            if (this.targetDistanceEl) {
                this.targetDistanceEl.textContent = this.formatDistance(distance);
            }

            // Update hint based on distance
            if (this.targetHintEl) {
                if (distance < this.explorationRange * 2) {
                    this.targetHintEl.innerHTML = '<span style="color:#00ff88">Almost there! Get closer to explore</span>';
                } else {
                    this.targetHintEl.innerHTML = '<span class="arrow-hint">Follow the arrows →</span>';
                }
            }
        }

        // Update object list (throttled)
        if (Math.floor(this.time * 2) % 2 === 0) {
            this.updateObjectList();
        }
    }

    updateObjectList() {
        if (!this.objectListEl || !this.camera) return;

        const objects = this.catalog.getAllByDistance(this.camera.position);
        const html = objects.slice(0, 30).map(obj => {
            const categoryInfo = this.catalog.getCategoryInfo(obj.type);
            const statusClass = obj.explored ? 'explored' : (obj.discovered ? 'discovered' : 'undiscovered');
            const statusDot = obj.explored ? 'status-explored' : (obj.discovered ? 'status-discovered' : 'status-unknown');
            const isTarget = this.currentTarget?.name === obj.name;

            return `
                <div class="object-item ${statusClass} ${isTarget ? 'current-target' : ''}"
                     onclick="explorationTracker.setTargetByName('${obj.name}')">
                    <span class="object-icon">${categoryInfo.icon}</span>
                    <div class="object-info">
                        <div class="object-name">${obj.name}</div>
                        <div class="object-type-label">${obj.type.replace('_', ' ')}</div>
                    </div>
                    <div class="object-distance">${this.formatDistance(obj.distance)}</div>
                    <div class="object-status ${statusDot}"></div>
                </div>
            `;
        }).join('');

        this.objectListEl.innerHTML = html;
    }

    setTargetByName(name) {
        const obj = this.catalog.getByName(name);
        if (obj) {
            this.setTarget(obj);
        }
    }

    formatDistance(distance) {
        if (distance >= 1000) {
            return `${(distance / 1000).toFixed(1)}k`;
        }
        return `${Math.round(distance)}`;
    }

    // Get current target for navigation
    getCurrentTarget() {
        return this.currentTarget;
    }

    // Get target position
    getTargetPosition() {
        return this.currentTarget?.mesh?.position || null;
    }

    // Toggle sidebar visibility
    toggle() {
        if (this.sidebarVisible) {
            this.hideSidebar();
        } else {
            this.showSidebar();
        }
    }

    hide() {
        this.hideSidebar();
    }

    show() {
        this.showSidebar();
    }

    // Check if sidebar is visible
    isVisible() {
        return this.sidebarVisible;
    }
}

// Global reference for onclick handlers
window.explorationTracker = null;

// Add global pause/resume functions for Swift to call
window.pauseExploration = function() {
    if (window.explorationTracker) {
        window.explorationTracker.hideSidebar();
        // Additional pause logic can be added here if needed
    }
};

window.resumeExploration = function() {
    // Currently no special resume logic needed; placeholder for future
    // For example, if you want to show sidebar or re-enable something, do it here
};

if (typeof module !== 'undefined') module.exports = ExplorationTracker;
