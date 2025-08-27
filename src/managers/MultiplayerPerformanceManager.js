/**
 * MultiplayerPerformanceManager - Handles multiplayer-specific optimizations
 * Manages culling, throttling, and performance-critical multiplayer features
 */
class MultiplayerPerformanceManager {
    constructor() {
        // Performance constants
        this.NETWORK_SYNC_INTERVAL = 70; // 70ms for smooth movement
        this.VIEWPORT_CULLING_MARGIN = 300;
        this.MAX_PARTICLES_MULTIPLAYER = 15;
        this.MAX_TRACKS_MULTIPLAYER = 20;
        this.MAX_EFFECTS_MULTIPLAYER = 10;
        
        // Throttling state
        this.lastNetworkSync = 0;
        this.throttleCounters = new Map();
        
        // Performance metrics
        this.metrics = {
            frameTime: 0,
            networkLatency: 0,
            droppedFrames: 0,
            culledObjects: 0
        };
    }
    
    /**
     * Check if position update should be sent to network
     */
    shouldSendPositionUpdate(playerId, currentPosition, lastPosition, timestamp) {
        const timeSinceLastSync = timestamp - this.lastNetworkSync;
        
        if (timeSinceLastSync < this.NETWORK_SYNC_INTERVAL) {
            return false;
        }
        
        // Check if position changed significantly
        const positionThreshold = 1; // 1 pixel
        const angleThreshold = 0.02; // ~1 degree
        
        if (lastPosition) {
            const positionChanged = 
                Math.abs(currentPosition.x - lastPosition.x) > positionThreshold ||
                Math.abs(currentPosition.y - lastPosition.y) > positionThreshold ||
                Math.abs(currentPosition.angle - lastPosition.angle) > angleThreshold ||
                Math.abs(currentPosition.turretAngle - lastPosition.turretAngle) > angleThreshold;
                
            if (!positionChanged) {
                return false;
            }
        }
        
        this.lastNetworkSync = timestamp;
        return true;
    }
    
    /**
     * Perform viewport culling for objects
     */
    cullObjects(objects, camera, canvasSize) {
        const visibleObjects = [];
        const culledCount = objects.length;
        
        const viewportBounds = {
            left: camera.x - this.VIEWPORT_CULLING_MARGIN,
            right: camera.x + canvasSize.width + this.VIEWPORT_CULLING_MARGIN,
            top: camera.y - this.VIEWPORT_CULLING_MARGIN,
            bottom: camera.y + canvasSize.height + this.VIEWPORT_CULLING_MARGIN
        };
        
        for (const obj of objects) {
            if (this._isObjectInViewport(obj, viewportBounds)) {
                visibleObjects.push(obj);
            }
        }
        
        this.metrics.culledObjects = culledCount - visibleObjects.length;
        return visibleObjects;
    }
    
    /**
     * Check if object is within viewport bounds
     */
    _isObjectInViewport(obj, bounds) {
        // Skip culling for player objects or critical objects
        if (obj.isPlayer || obj.isImportant) {
            return true;
        }
        
        const objBounds = {
            left: obj.x,
            right: obj.x + (obj.width || obj.size || 32),
            top: obj.y,
            bottom: obj.y + (obj.height || obj.size || 32)
        };
        
        return !(objBounds.right < bounds.left || 
                 objBounds.left > bounds.right ||
                 objBounds.bottom < bounds.top ||
                 objBounds.top > bounds.bottom);
    }
    
    /**
     * Limit array size for performance (particles, tracks, etc.)
     */
    limitArraySize(array, maxSize, removeOldest = true) {
        if (array.length <= maxSize) {
            return array;
        }
        
        if (removeOldest) {
            return array.slice(-maxSize); // Keep newest elements
        } else {
            return array.slice(0, maxSize); // Keep oldest elements
        }
    }
    
    /**
     * Optimize particles for multiplayer
     */
    optimizeParticles(particles) {
        // Filter out dead particles
        let filtered = particles.filter(p => p.life > 0);
        
        // Limit count
        filtered = this.limitArraySize(filtered, this.MAX_PARTICLES_MULTIPLAYER);
        
        return filtered;
    }
    
    /**
     * Optimize tracks for multiplayer
     */
    optimizeTracks(tracks) {
        const now = Date.now();
        const trackLifetime = 1000; // 1 second in multiplayer
        
        // Filter by lifetime
        let filtered = tracks.filter(track => now - track.timestamp < trackLifetime);
        
        // Limit count
        filtered = this.limitArraySize(filtered, this.MAX_TRACKS_MULTIPLAYER);
        
        return filtered;
    }
    
    /**
     * Optimize visual effects for multiplayer
     */
    optimizeEffects(effects) {
        // Filter out dead effects
        let filtered = effects.filter(effect => 
            effect.life > 0 || (effect.smokeParticles && effect.smokeParticles.length > 0)
        );
        
        // Limit count
        filtered = this.limitArraySize(filtered, this.MAX_EFFECTS_MULTIPLAYER);
        
        return filtered;
    }
    
    /**
     * Throttle function calls per client
     */
    throttle(key, interval, callback) {
        const now = Date.now();
        const lastCall = this.throttleCounters.get(key) || 0;
        
        if (now - lastCall >= interval) {
            this.throttleCounters.set(key, now);
            return callback();
        }
        
        return null;
    }
    
    /**
     * Interpolate between two angles handling wrapping
     */
    interpolateAngle(fromAngle, toAngle, progress) {
        // Normalize angles to [0, 2π]
        fromAngle = fromAngle % (2 * Math.PI);
        toAngle = toAngle % (2 * Math.PI);
        
        // Find shortest path
        let delta = toAngle - fromAngle;
        if (Math.abs(delta) > Math.PI) {
            if (delta > 0) {
                delta -= 2 * Math.PI;
            } else {
                delta += 2 * Math.PI;
            }
        }
        
        return fromAngle + delta * progress;
    }
    
    /**
     * Smooth interpolation with easing
     */
    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }
    
    /**
     * Update performance metrics
     */
    updateMetrics(frameTime, networkLatency = null) {
        this.metrics.frameTime = frameTime;
        if (networkLatency !== null) {
            this.metrics.networkLatency = networkLatency;
        }
        
        // Detect dropped frames (assuming 60 FPS target)
        if (frameTime > 16.67 * 1.5) { // 50% over target frame time
            this.metrics.droppedFrames++;
        }
    }
    
    /**
     * Get performance metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }
    
    /**
     * Reset performance counters
     */
    resetMetrics() {
        this.metrics.droppedFrames = 0;
        this.metrics.culledObjects = 0;
    }
    
    /**
     * Adjust performance settings based on metrics
     */
    adjustPerformanceSettings() {
        const avgFrameTime = this.metrics.frameTime;
        
        // If performance is poor, reduce limits
        if (avgFrameTime > 20) { // Over 20ms per frame
            this.MAX_PARTICLES_MULTIPLAYER = Math.max(5, this.MAX_PARTICLES_MULTIPLAYER - 2);
            this.MAX_TRACKS_MULTIPLAYER = Math.max(10, this.MAX_TRACKS_MULTIPLAYER - 5);
            this.NETWORK_SYNC_INTERVAL = Math.min(100, this.NETWORK_SYNC_INTERVAL + 10);
        }
        // If performance is good, allow more effects
        else if (avgFrameTime < 12) { // Under 12ms per frame
            this.MAX_PARTICLES_MULTIPLAYER = Math.min(25, this.MAX_PARTICLES_MULTIPLAYER + 1);
            this.MAX_TRACKS_MULTIPLAYER = Math.min(30, this.MAX_TRACKS_MULTIPLAYER + 2);
            this.NETWORK_SYNC_INTERVAL = Math.max(50, this.NETWORK_SYNC_INTERVAL - 5);
        }
    }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MultiplayerPerformanceManager;
} else if (typeof window !== 'undefined') {
    window.MultiplayerPerformanceManager = MultiplayerPerformanceManager;
}