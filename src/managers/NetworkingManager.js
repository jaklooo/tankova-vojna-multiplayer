/**
 * NetworkingManager - Handles client-side networking and communication
 * Separates networking logic from game logic for better architecture
 */
class NetworkingManager {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.eventHandlers = new Map();
        this.messageQueue = [];
        this.connectionState = 'disconnected'; // disconnected, connecting, connected
        
        // Network statistics
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            bytesSent: 0,
            bytesReceived: 0,
            pingTime: 0,
            lastPingTime: Date.now()
        };
        
        // Reliable message system
        this.reliableMessages = new Map();
        this.messageId = 0;
    }
    
    /**
     * Initialize connection to server
     */
    connect(serverUrl = null) {
        if (this.isConnected) {
            this.disconnect();
        }
        
        this.connectionState = 'connecting';
        this.socket = io(serverUrl);
        
        this._setupBaseEventHandlers();
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 10000);
            
            this.socket.on('connect', () => {
                clearTimeout(timeout);
                this.isConnected = true;
                this.connectionState = 'connected';
                this._startPingMonitoring();
                resolve();
            });
            
            this.socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                this.connectionState = 'disconnected';
                reject(error);
            });
        });
    }
    
    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.connectionState = 'disconnected';
        this._stopPingMonitoring();
    }
    
    /**
     * Setup base event handlers
     */
    _setupBaseEventHandlers() {
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.connectionState = 'connected';
            this._flushMessageQueue();
        });
        
        this.socket.on('disconnect', () => {
            this.isConnected = false;
            this.connectionState = 'disconnected';
        });
        
        this.socket.on('pong', (timestamp) => {
            this.stats.pingTime = Date.now() - timestamp;
        });
        
        // Handle reliable message acknowledgments
        this.socket.on('message-ack', (messageId) => {
            this.reliableMessages.delete(messageId);
        });
    }
    
    /**
     * Register event handler
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
        
        if (this.socket) {
            this.socket.on(event, (data) => {
                this.stats.messagesReceived++;
                this.stats.bytesReceived += JSON.stringify(data).length;
                handler(data);
            });
        }
    }
    
    /**
     * Remove event handler
     */
    off(event, handler) {
        if (this.eventHandlers.has(event)) {
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
        
        if (this.socket) {
            this.socket.off(event, handler);
        }
    }
    
    /**
     * Send message to server
     */
    emit(event, data = null, reliable = false) {
        const message = {
            event,
            data,
            timestamp: Date.now(),
            reliable
        };
        
        if (!this.isConnected) {
            this.messageQueue.push(message);
            return;
        }
        
        if (reliable) {
            message.id = this.messageId++;
            this.reliableMessages.set(message.id, message);
            
            // Retry mechanism for reliable messages
            setTimeout(() => {
                if (this.reliableMessages.has(message.id)) {
                    this.emit(event, data, false); // Retry without reliable flag
                }
            }, 5000);
        }
        
        this.socket.emit(event, message.data);
        this.stats.messagesSent++;
        this.stats.bytesSent += JSON.stringify(message.data || {}).length;
    }
    
    /**
     * Send player position update (optimized)
     */
    sendPositionUpdate(positionData) {
        this.emit('player-position', {
            x: Math.round(positionData.x),
            y: Math.round(positionData.y),
            angle: Math.round(positionData.angle * 1000) / 1000, // 3 decimal places
            turretAngle: Math.round(positionData.turretAngle * 1000) / 1000,
            timestamp: Date.now()
        });
    }
    
    /**
     * Send shooting event
     */
    sendShootEvent(shootData) {
        this.emit('player-shoot', {
            x: Math.round(shootData.x),
            y: Math.round(shootData.y),
            angle: Math.round(shootData.angle * 1000) / 1000,
            bulletType: shootData.bulletType || 1,
            timestamp: Date.now()
        }, true); // Reliable for important events
    }
    
    /**
     * Send damage event
     */
    sendDamageEvent(damageData) {
        this.emit('player-damage', {
            playerId: damageData.playerId,
            damage: damageData.damage,
            newHealth: damageData.newHealth,
            timestamp: Date.now()
        }, true); // Reliable for critical events
    }
    
    /**
     * Send player elimination
     */
    sendPlayerElimination(eliminationData) {
        this.emit('player-eliminated', {
            playerName: eliminationData.playerName,
            timestamp: Date.now()
        }, true); // Reliable for critical events
    }
    
    /**
     * Flush queued messages when connection is restored
     */
    _flushMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.emit(message.event, message.data, message.reliable);
        }
    }
    
    /**
     * Start ping monitoring
     */
    _startPingMonitoring() {
        this.pingInterval = setInterval(() => {
            if (this.isConnected) {
                this.stats.lastPingTime = Date.now();
                this.socket.emit('ping', this.stats.lastPingTime);
            }
        }, 5000); // Ping every 5 seconds
    }
    
    /**
     * Stop ping monitoring
     */
    _stopPingMonitoring() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    
    /**
     * Get connection statistics
     */
    getStats() {
        return { ...this.stats };
    }
    
    /**
     * Get connection state
     */
    getConnectionState() {
        return this.connectionState;
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats.messagesSent = 0;
        this.stats.messagesReceived = 0;
        this.stats.bytesSent = 0;
        this.stats.bytesReceived = 0;
    }
    
    /**
     * Check if connection is healthy
     */
    isConnectionHealthy() {
        return this.isConnected && 
               this.stats.pingTime < 500 && // Less than 500ms ping
               (Date.now() - this.stats.lastPingTime) < 10000; // Ping within last 10 seconds
    }
    
    /**
     * Get network quality assessment
     */
    getNetworkQuality() {
        if (!this.isConnected) return 'disconnected';
        
        const ping = this.stats.pingTime;
        if (ping < 50) return 'excellent';
        if (ping < 100) return 'good';
        if (ping < 200) return 'fair';
        if (ping < 500) return 'poor';
        return 'very-poor';
    }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkingManager;
} else if (typeof window !== 'undefined') {
    window.NetworkingManager = NetworkingManager;
}