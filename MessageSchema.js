// MessageSchema.js
// Structured message schema for Swift <-> JavaScript communication

class MessageSchema {
    // Message types
    static MessageTypes = {
        NAVIGATION_UPDATE: "NAVIGATION_UPDATE",
        STATUS: "STATUS",
        ERROR: "ERROR",
        FOCUS_OBJECT: "FOCUS_OBJECT",
        SET_MODE: "SET_MODE",
        CAMERA_STATE: "CAMERA_STATE"
    };

    // Validate navigation update from Swift
    static validateNavigationUpdate(data) {
        if (!data) return false;
        
        const hasRotation = data.rotation &&
            typeof data.rotation.x === 'number' &&
            typeof data.rotation.y === 'number' &&
            typeof data.rotation.z === 'number';
            
        const hasThrust = data.thrust &&
            typeof data.thrust.x === 'number' &&
            typeof data.thrust.y === 'number' &&
            typeof data.thrust.z === 'number';
            
        return hasRotation && hasThrust;
    }

    // Create camera state message for Swift
    static createCameraState(camera, velocity, nearestObject) {
        return {
            type: this.MessageTypes.CAMERA_STATE,
            data: {
                position: {
                    x: camera.position.x,
                    y: camera.position.y,
                    z: camera.position.z
                },
                rotation: {
                    x: camera.rotation.x,
                    y: camera.rotation.y,
                    z: camera.rotation.z
                },
                velocity: velocity || 0,
                nearestObject: nearestObject || "None"
            },
            timestamp: Date.now()
        };
    }

    // Create status message
    static createStatus(status, details = {}) {
        return {
            type: this.MessageTypes.STATUS,
            data: {
                status: status,
                ...details
            },
            timestamp: Date.now()
        };
    }

    // Create error message
    static createError(message, details = {}) {
        return {
            type: this.MessageTypes.ERROR,
            data: {
                message: message,
                ...details
            },
            timestamp: Date.now()
        };
    }

    // Send message to Swift
    static sendToSwift(type, data) {
        if (window.webkit?.messageHandlers?.iosHandler) {
            try {
                window.webkit.messageHandlers.iosHandler.postMessage({
                    type: type,
                    data: data,
                    timestamp: Date.now()
                });
                return true;
            } catch (e) {
                console.error("Failed to send message to Swift:", e);
                return false;
            }
        }
        return false;
    }
}

// Make globally accessible
window.MessageSchema = MessageSchema;
