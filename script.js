// --- OBJECT POOL UTILITY ---
class ObjectPool {
    constructor(createFn, resetFn, initialSize = 10) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.active = new Set();
        this.stats = {
            created: 0,
            reused: 0,
            maxActive: 0
        };
        
        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
            this.stats.created++;
        }
    }

    acquire() {
        let obj;
        if (this.pool.length > 0) {
            obj = this.pool.pop();
            this.stats.reused++;
        } else {
            obj = this.createFn();
            this.stats.created++;
        }
        
        this.active.add(obj);
        this.stats.maxActive = Math.max(this.stats.maxActive, this.active.size);
        return obj;
    }

    release(obj) {
        if (this.active.has(obj)) {
            this.active.delete(obj);
            if (this.resetFn) {
                this.resetFn(obj);
            }
            this.pool.push(obj);
        }
    }

    clear() {
        this.pool = [];
        this.active.clear();
    }

    getStats() {
        return {
            pooled: this.pool.length,
            active: this.active.size,
            created: this.stats.created,
            reused: this.stats.reused,
            maxActive: this.stats.maxActive
        };
    }
}

// --- VIEWPORT CULLING SYSTEM ---
class ViewportCuller {
    constructor() {
        this.margin = 100; // Extra margin around viewport for smooth transitions
        this.stats = {
            totalObjects: 0,
            culledObjects: 0,
            visibleObjects: 0
        };
    }

    // Get current viewport bounds with camera position
    getViewportBounds() {
        return {
            left: gameState.cameraX - this.margin,
            right: gameState.cameraX + canvas.width + this.margin,
            top: gameState.cameraY - this.margin,
            bottom: gameState.cameraY + canvas.height + this.margin
        };
    }

    // Check if object is visible in viewport
    isVisible(obj) {
        if (!obj) return false;
        
        const bounds = this.getViewportBounds();
        
        // Get object bounds
        const objLeft = obj.x || 0;
        const objRight = objLeft + (obj.width || 50);
        const objTop = obj.y || 0;
        const objBottom = objTop + (obj.height || 50);
        
        // Check if object intersects with viewport
        return !(objRight < bounds.left || 
                objLeft > bounds.right || 
                objBottom < bounds.top || 
                objTop > bounds.bottom);
    }

    // Filter array of objects to only visible ones
    filterVisible(objects, label = 'objects') {
        if (!objects || !Array.isArray(objects)) return objects;
        
        const visible = objects.filter(obj => this.isVisible(obj));
        
        // Update stats
        this.stats.totalObjects += objects.length;
        this.stats.visibleObjects += visible.length;
        this.stats.culledObjects += (objects.length - visible.length);
        
        return visible;
    }

    // Get culling statistics
    getStats() {
        const cullRatio = this.stats.totalObjects > 0 ? 
            (this.stats.culledObjects / this.stats.totalObjects * 100).toFixed(1) : 0;
        
        return {
            total: this.stats.totalObjects,
            visible: this.stats.visibleObjects,
            culled: this.stats.culledObjects,
            cullRatio: `${cullRatio}%`
        };
    }

    // Reset stats for next frame
    resetStats() {
        this.stats.totalObjects = 0;
        this.stats.culledObjects = 0;
        this.stats.visibleObjects = 0;
    }

    // Debug visualization
    drawViewportBounds() {
        if (!window.DEBUG_VIEWPORT) return;
        
        const bounds = this.getViewportBounds();
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        // Draw viewport rectangle
        ctx.strokeRect(
            bounds.left - gameState.cameraX,
            bounds.top - gameState.cameraY,
            bounds.right - bounds.left,
            bounds.bottom - bounds.top
        );
        
        ctx.restore();
    }
}

// Initialize global viewport culler
const viewportCuller = new ViewportCuller();

// Debug controls (type in console)
window.DEBUG_VIEWPORT = false; // Toggle viewport visualization
window.toggleViewportDebug = () => {
    window.DEBUG_VIEWPORT = !window.DEBUG_VIEWPORT;
    console.log('🔍 Viewport debug:', window.DEBUG_VIEWPORT ? 'ON' : 'OFF');
};
window.getCullingStats = () => {
    console.log('📊 Current culling stats:', viewportCuller.getStats());
};

// --- MULTIPLAYER VARIABLES ---
let socket = null;
let isMultiplayer = false;
let currentRoom = null;
let otherPlayers = [];
let isHost = false;
let multiplayerTanks = new Map(); // Map to track other players' tanks
let selectedLobbyMap = null; // Selected map in lobby
let selectedLobbyCharacter = null; // Selected character in lobby
let selectedLobbyTank = null; // Selected tank in lobby
let playerName = ''; // Player's chosen name

// --- TEAM MANAGEMENT VARIABLES ---
let selectedGameMode = 'all-vs-all';
let playerTeam = null;
let teamReadyPlayers = new Set();
let gameReadyPlayers = new Set(); // Players ready for final game start in combined selection
let allPlayers = [];
let teamCaptains = { blue: null, red: null };
let teamNames = { blue: 'Modrý tím', red: 'Červený tím' };
let playerIsReady = false;
let currentPhase = 'team-selection'; // track current phase

// --- MULTIPLAYER OPTIMIZATIONS ---
let lastNetworkSync = 0;
const NETWORK_SYNC_INTERVAL = 70; // Optimized to 70ms (~14 FPS) for very smooth movement
const MULTIPLAYER_TARGET_FPS = 60; // Full FPS for smooth multiplayer experience
const MULTIPLAYER_FRAME_TIME = 1000 / MULTIPLAYER_TARGET_FPS;
const EFFECTS_REDUCTION_FACTOR = 0.3; // Reduce visual effects in multiplayer
const MAX_PARTICLES_MULTIPLAYER = 15; // Limit particles in multiplayer
const MAX_TRACKS_MULTIPLAYER = 20; // Limit tank tracks in multiplayer
const VIEWPORT_CULLING_MARGIN = 300; // Extra margin for viewport culling (increased for multiplayer)
let lastFrameTime = 0;

// Initialize performance and networking managers
let performanceManager = null;
let networkManager = null;

// === MULTIPLAYER PERFORMANCE MANAGER ===
class MultiplayerPerformanceManager {
    constructor() {
        // Network throttling settings
        this.POSITION_UPDATE_INTERVAL = 1000 / 20; // 20 Hz updates
        this.POSITION_THRESHOLD = 5; // Min movement distance
        this.ROTATION_THRESHOLD = 0.1; // Min rotation change
        
        // Bandwidth management
        this.VIEWPORT_CULLING_MARGIN = 300;
        this.MAX_PARTICLES_MP = 15;
        this.MAX_TRACKS_MP = 20;
        this.MAX_EFFECTS_MP = 10;
        
        // Performance monitoring
        this.frameMetrics = {
            frameTime: 0,
            networkLatency: 0,
            updateCount: 0,
            droppedUpdates: 0
        };
        
        // Position update cache
        this.lastPositionUpdate = {};
        this.positionUpdateQueue = new Map();
        
        // Performance adaptation
        this.performanceLevel = 'high'; // high, medium, low
        this.adaptationTimer = 0;
        
        console.log('🚀 MultiplayerPerformanceManager initialized');
    }
    
    // === POSITION UPDATE OPTIMIZATION ===
    shouldSendPositionUpdate(playerId, currentPos, lastPos, timestamp) {
        if (!playerId || !currentPos || !lastPos) return false;
        
        const key = playerId;
        const lastUpdate = this.lastPositionUpdate[key] || 0;
        
        // Time-based throttling
        if (timestamp - lastUpdate < this.POSITION_UPDATE_INTERVAL) {
            this.frameMetrics.droppedUpdates++;
            return false;
        }
        
        // Distance-based filtering
        const dx = currentPos.x - lastPos.x;
        const dy = currentPos.y - lastPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const rotationDiff = Math.abs(currentPos.rotation - lastPos.rotation);
        
        // Send update if significant change
        if (distance > this.POSITION_THRESHOLD || rotationDiff > this.ROTATION_THRESHOLD) {
            this.lastPositionUpdate[key] = timestamp;
            this.frameMetrics.updateCount++;
            return true;
        }
        
        return false;
    }
    
    // === EFFECT OPTIMIZATION ===
    optimizeEffects(effects) {
        if (!effects || effects.length <= this.MAX_EFFECTS_MP) return effects;
        
        // Keep most recent effects
        return effects.slice(-this.MAX_EFFECTS_MP);
    }
    
    optimizeTracks(tracks) {
        if (!tracks || tracks.length <= this.MAX_TRACKS_MP) return tracks;
        
        // Keep most recent tracks
        return tracks.slice(-this.MAX_TRACKS_MP);
    }
    
    // === PERFORMANCE MONITORING ===
    updateMetrics(frameTime) {
        this.frameMetrics.frameTime = frameTime;
        
        // Update performance level based on frame time
        if (frameTime > 33) { // < 30 FPS
            this.performanceLevel = 'low';
        } else if (frameTime > 20) { // < 50 FPS
            this.performanceLevel = 'medium';
        } else {
            this.performanceLevel = 'high';
        }
    }
    
    adjustPerformanceSettings() {
        switch (this.performanceLevel) {
            case 'low':
                this.POSITION_UPDATE_INTERVAL = 1000 / 15; // 15 Hz
                this.MAX_PARTICLES_MP = 8;
                this.MAX_TRACKS_MP = 10;
                this.MAX_EFFECTS_MP = 5;
                break;
            case 'medium':
                this.POSITION_UPDATE_INTERVAL = 1000 / 18; // 18 Hz
                this.MAX_PARTICLES_MP = 12;
                this.MAX_TRACKS_MP = 15;
                this.MAX_EFFECTS_MP = 8;
                break;
            case 'high':
                this.POSITION_UPDATE_INTERVAL = 1000 / 20; // 20 Hz
                this.MAX_PARTICLES_MP = 15;
                this.MAX_TRACKS_MP = 20;
                this.MAX_EFFECTS_MP = 10;
                break;
        }
    }
    
    // === VIEWPORT CULLING SUPPORT ===
    _isObjectInViewport(obj, viewport) {
        return obj.x + obj.width >= viewport.left &&
               obj.x <= viewport.right &&
               obj.y + obj.height >= viewport.top &&
               obj.y <= viewport.bottom;
    }
    
    // === PERFORMANCE STATS ===
    getPerformanceStats() {
        const stats = {
            level: this.performanceLevel,
            frameTime: this.frameMetrics.frameTime.toFixed(2),
            updateRate: (this.frameMetrics.updateCount / (this.frameMetrics.updateCount + this.frameMetrics.droppedUpdates) * 100).toFixed(1),
            droppedUpdates: this.frameMetrics.droppedUpdates,
            updateInterval: this.POSITION_UPDATE_INTERVAL
        };
        
        // Reset counters periodically
        if (this.frameMetrics.updateCount > 1000) {
            this.frameMetrics.updateCount = 0;
            this.frameMetrics.droppedUpdates = 0;
        }
        
        return stats;
    }
}

function initializeManagers() {
    performanceManager = new MultiplayerPerformanceManager();
    networkManager = new NetworkingManager();
    predictionManager = new PredictionManager();
    console.log('🔧 All performance managers initialized');
}

// Initialize prediction manager
let predictionManager = null;

// === NETWORKING MANAGER ===
class NetworkingManager {
    constructor() {
        // Event batching
        this.eventBatch = [];
        this.batchTimeout = null;
        this.BATCH_INTERVAL = 50; // 50ms batching
        
        // Connection quality monitoring
        this.connectionQuality = {
            latency: 0,
            packetLoss: 0,
            bandwidth: 'good' // good, fair, poor
        };
        
        // Event prioritization
        this.highPriorityEvents = ['player-hit', 'tank-destroyed', 'bullet-fired'];
        this.mediumPriorityEvents = ['player-move', 'tank-rotation'];
        this.lowPriorityEvents = ['effect-update', 'track-update'];
        
        // Delta compression
        this.lastStates = new Map();
        
        console.log('🌐 NetworkingManager initialized');
    }
    
    // === EVENT BATCHING ===
    batchEvent(eventName, data, priority = 'medium') {
        const event = {
            name: eventName,
            data: data,
            priority: priority,
            timestamp: Date.now()
        };
        
        // High priority events send immediately
        if (this.highPriorityEvents.includes(eventName)) {
            this.sendImmediately(event);
            return;
        }
        
        // Add to batch
        this.eventBatch.push(event);
        
        // Schedule batch send
        if (!this.batchTimeout) {
            this.batchTimeout = setTimeout(() => {
                this.sendBatch();
            }, this.BATCH_INTERVAL);
        }
    }
    
    sendBatch() {
        if (this.eventBatch.length === 0) return;
        
        // Sort by priority
        this.eventBatch.sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });
        
        // Send batched events
        if (socket && socket.connected) {
            socket.emit('batch-events', {
                events: this.eventBatch,
                timestamp: Date.now()
            });
        }
        
        // Clear batch
        this.eventBatch = [];
        this.batchTimeout = null;
    }
    
    sendImmediately(event) {
        if (socket) {
            if (socket.connected || typeof socket.connected === 'undefined') {
                socket.emit(event.name, event.data);
            } else {
                console.log('📡 Socket not connected, queuing event:', event.name);
            }
        } else {
            console.log('📡 No socket available for event:', event.name);
        }
    }
    
    // === DELTA COMPRESSION ===
    createDeltaUpdate(playerId, currentState) {
        const lastState = this.lastStates.get(playerId);
        
        if (!lastState) {
            // First update, send full state
            this.lastStates.set(playerId, { ...currentState });
            return {
                type: 'full',
                state: currentState
            };
        }
        
        // Create delta
        const delta = {};
        let hasChanges = false;
        
        for (const key in currentState) {
            if (currentState[key] !== lastState[key]) {
                delta[key] = currentState[key];
                hasChanges = true;
            }
        }
        
        if (hasChanges) {
            // Update last state
            Object.assign(lastState, delta);
            
            return {
                type: 'delta',
                playerId: playerId,
                changes: delta,
                timestamp: Date.now()
            };
        }
        
        return null; // No changes
    }
    
    // === CONNECTION QUALITY MONITORING ===
    measureLatency() {
        const start = Date.now();
        
        if (socket) {
            if (socket.connected || typeof socket.connected === 'undefined') {
                socket.emit('ping', { timestamp: start });
                
                // For mock socket, simulate pong response
                if (typeof socket.connected === 'undefined') {
                    setTimeout(() => {
                        const simulatedLatency = 20 + Math.random() * 50; // 20-70ms
                        this.connectionQuality.latency = simulatedLatency;
                        this.connectionQuality.bandwidth = simulatedLatency < 50 ? 'good' : 'fair';
                        console.log('🏓 Mock latency:', simulatedLatency.toFixed(0) + 'ms');
                    }, 50);
                } else {
                    socket.once('pong', (data) => {
                        const latency = Date.now() - data.timestamp;
                        this.connectionQuality.latency = latency;
                        
                        // Update bandwidth estimation
                        if (latency < 50) {
                            this.connectionQuality.bandwidth = 'good';
                        } else if (latency < 150) {
                            this.connectionQuality.bandwidth = 'fair';
                        } else {
                            this.connectionQuality.bandwidth = 'poor';
                        }
                    });
                }
            }
        }
    }
    
    // === ADAPTIVE QUALITY ===
    getAdaptiveSettings() {
        const settings = {
            updateRate: 20,
            maxParticles: 15,
            maxTracks: 20,
            compressionLevel: 'medium'
        };
        
        switch (this.connectionQuality.bandwidth) {
            case 'poor':
                settings.updateRate = 10;
                settings.maxParticles = 5;
                settings.maxTracks = 8;
                settings.compressionLevel = 'high';
                break;
            case 'fair':
                settings.updateRate = 15;
                settings.maxParticles = 10;
                settings.maxTracks = 15;
                settings.compressionLevel = 'medium';
                break;
            case 'good':
                settings.updateRate = 20;
                settings.maxParticles = 15;
                settings.maxTracks = 20;
                settings.compressionLevel = 'low';
                break;
        }
        
        return settings;
    }
    
    // === STATS ===
    getNetworkStats() {
        return {
            latency: this.connectionQuality.latency,
            bandwidth: this.connectionQuality.bandwidth,
            batchedEvents: this.eventBatch.length,
            packetLoss: this.connectionQuality.packetLoss
        };
    }
}

// === CLIENT-SIDE PREDICTION MANAGER ===
class PredictionManager {
    constructor() {
        // Prediction buffers
        this.playerStates = new Map(); // playerId -> states[]
        this.predictionBuffer = new Map(); // playerId -> predicted state
        this.interpolationTargets = new Map(); // playerId -> target state
        
        // Timing
        this.SERVER_UPDATE_RATE = 1000 / 20; // 20 Hz from server
        this.INTERPOLATION_DELAY = 100; // 100ms delay for smooth interpolation
        
        // Reconciliation
        this.inputSequence = 0;
        this.pendingInputs = [];
        
        console.log('🎯 PredictionManager initialized');
    }
    
    // === PLAYER STATE PREDICTION ===
    predictPlayerMovement(player, deltaTime) {
        if (!player || !player.id) return player;
        
        const playerId = player.id;
        
        // Store current state
        const currentState = {
            x: player.x,
            y: player.y,
            rotation: player.rotation,
            vx: player.vx || 0,
            vy: player.vy || 0,
            timestamp: Date.now(),
            sequence: this.inputSequence++
        };
        
        // Predict next position based on velocity
        if (player.vx || player.vy) {
            const predictedX = player.x + (player.vx * deltaTime);
            const predictedY = player.y + (player.vy * deltaTime);
            
            // Store prediction
            this.predictionBuffer.set(playerId, {
                x: predictedX,
                y: predictedY,
                rotation: player.rotation,
                timestamp: Date.now(),
                predicted: true
            });
        }
        
        return player;
    }
    
    // === SERVER RECONCILIATION ===
    reconcileWithServer(playerId, serverState) {
        const predicted = this.predictionBuffer.get(playerId);
        
        if (!predicted || !serverState) return serverState;
        
        // Check if prediction was accurate
        const dx = Math.abs(predicted.x - serverState.x);
        const dy = Math.abs(predicted.y - serverState.y);
        const threshold = 10; // 10px tolerance
        
        if (dx > threshold || dy > threshold) {
            // Prediction was wrong, snap to server state
            console.log(`🔄 Reconciling position for ${playerId}: predicted(${predicted.x.toFixed(1)}, ${predicted.y.toFixed(1)}) vs server(${serverState.x.toFixed(1)}, ${serverState.y.toFixed(1)})`);
            
            // Clear prediction
            this.predictionBuffer.delete(playerId);
            
            return serverState;
        }
        
        // Prediction was good, keep it
        return predicted;
    }
    
    // === INTERPOLATION ===
    setupInterpolation(playerId, fromState, toState) {
        this.interpolationTargets.set(playerId, {
            from: { ...fromState },
            to: { ...toState },
            startTime: Date.now(),
            duration: this.INTERPOLATION_DELAY
        });
    }
    
    getInterpolatedPosition(playerId) {
        const target = this.interpolationTargets.get(playerId);
        
        if (!target) return null;
        
        const elapsed = Date.now() - target.startTime;
        const progress = Math.min(elapsed / target.duration, 1);
        
        // Smooth interpolation using easing
        const eased = this.easeOutCubic(progress);
        
        const interpolated = {
            x: target.from.x + (target.to.x - target.from.x) * eased,
            y: target.from.y + (target.to.y - target.from.y) * eased,
            rotation: target.from.rotation + (target.to.rotation - target.from.rotation) * eased
        };
        
        // Remove completed interpolation
        if (progress >= 1) {
            this.interpolationTargets.delete(playerId);
        }
        
        return interpolated;
    }
    
    // === EASING FUNCTIONS ===
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }
    
    // === LAG COMPENSATION ===
    compensateForLatency(position, velocity, latency) {
        if (!velocity || latency <= 0) return position;
        
        const compensationTime = latency / 1000; // Convert to seconds
        
        return {
            x: position.x + (velocity.vx * compensationTime),
            y: position.y + (velocity.vy * compensationTime),
            rotation: position.rotation
        };
    }
    
    // === STATS ===
    getPredictionStats() {
        return {
            activePredictions: this.predictionBuffer.size,
            activeInterpolations: this.interpolationTargets.size,
            pendingInputs: this.pendingInputs.length,
            sequenceNumber: this.inputSequence
        };
    }
}

// === MOCK SOCKET.IO FOR OFFLINE TESTING ===
// Create a mock Socket.IO if not available
if (typeof io === 'undefined') {
    console.log('🔧 Socket.IO not available, creating mock for offline testing');
    
    window.io = function() {
        return {
            connected: false,
            connect: function() { 
                console.log('📡 Mock Socket: Connect called'); 
                this.connected = true;
                return this;
            },
            disconnect: function() { 
                console.log('📡 Mock Socket: Disconnect called'); 
                this.connected = false;
                return this;
            },
            emit: function(event, data) { 
                console.log('📤 Mock Socket Emit:', event, data); 
                return this;
            },
            on: function(event, callback) { 
                console.log('📥 Mock Socket On:', event); 
                return this;
            },
            once: function(event, callback) { 
                console.log('📥 Mock Socket Once:', event); 
                return this;
            }
        };
    };
}

// Initialize multiplayer connection
function initMultiplayer(gameMode = 'all-vs-all') {
    if (socket && socket.connected) {
        socket.disconnect();
    }
    
    socket = io();
    selectedGameMode = gameMode;
    
    socket.on('connect', () => {
        console.log('Pripojený k serveru');
        isMultiplayer = true;
        
        // Request to join a game with specific mode and player name
        socket.emit('join-game', {
            name: playerName || 'Hráč_' + Math.floor(Math.random() * 1000),
            gameMode: gameMode
        });
    });
    
    socket.on('disconnect', () => {
        console.log('Odpojený od servera');
        isMultiplayer = false;
    });
    
    socket.on('map-votes-updated', (data) => {
        console.log('Map votes updated received:', data); // Debug log
        // Update map voting display
        const mapCards = document.querySelectorAll('#lobby-map-cards .lobby-map-card');
        mapCards.forEach(card => {
            const mapId = card.dataset.map;
            const voteCount = data.mapVotes[mapId] ? data.mapVotes[mapId].length : 0;
            
            let voteCounter = card.querySelector('.vote-counter');
            if (!voteCounter) {
                voteCounter = document.createElement('div');
                voteCounter.className = 'vote-counter';
                card.appendChild(voteCounter);
            }
            
            voteCounter.textContent = `${voteCount} ${voteCount === 1 ? 'hlas' : 'hlasov'}`;
        });
    });

    socket.on('player-ready-updated', (data) => {
        // Update ready status display
        if (selectedGameMode === 'all-vs-all') {
            const playersList = document.getElementById('players-list');
            if (playersList) {
                updatePlayersList();
            }
        } else if (selectedGameMode === 'team-vs-team' && currentPhase === 'combined-selection') {
            // Update team ready state for combined selection
            if (data.ready) {
                teamReadyPlayers.add(data.playerId);
            } else {
                teamReadyPlayers.delete(data.playerId);
            }
            
            // Update team ready button text
            const teamReadyBtn = document.getElementById('team-ready-btn');
            if (teamReadyBtn) {
                const isCurrentPlayerReady = teamReadyPlayers.has(socket.id);
                teamReadyBtn.textContent = isCurrentPlayerReady ? 'Zrušiť ready' : 'Som pripravený!';
            }
            
            // Update team displays with ready status
            updateCharacterTeamDisplay();
            updateTankTeamDisplay();
            updateMapTeamDisplay();
            
            console.log(`Ready players: ${data.readyCount}/${data.totalPlayers}`);
        }
    });
    
    // Handle team ready notification
    socket.on('teams-ready', (data) => {
        console.log('Teams ready notification:', data);
        if (data.canStart) {
            // Show notification to host that game can be started
            const hostStartBtn = document.getElementById('host-start-btn');
            if (hostStartBtn) {
                hostStartBtn.style.display = 'block';
                hostStartBtn.textContent = 'Spustiť hru!';
                hostStartBtn.disabled = false;
            }
            
            // Show notification message
            const notificationDiv = document.getElementById('team-notification');
            if (notificationDiv) {
                notificationDiv.textContent = data.message;
                notificationDiv.style.display = 'block';
                notificationDiv.style.color = '#4CAF50'; // Green for success
            }
        }
    });
    
    socket.on('room-locked', (data) => {
        // Update lock button text
        const hostLockBtn = document.getElementById('host-lock-room-btn-main');
        if (hostLockBtn) {
            hostLockBtn.textContent = data.locked ? 'Odomknúť miestnosť' : 'Uzamknúť miestnosť';
        }
        
        // Show notification
        if (data.locked) {
            console.log('Miestnosť je teraz uzamknutá');
        } else {
            console.log('Miestnosť je teraz odomknutá');
        }
    });
    
    socket.on('player-joined', (data) => {
        console.log('Hráč sa pripojil:', data);
        allPlayers = data.players || [];
        otherPlayers = allPlayers.filter(p => p.id !== socket.id);
        
        // Set current room and host status
        currentRoom = data.roomId;
        isHost = data.hostId === socket.id;
        selectedGameMode = data.gameMode;
        
        // Show appropriate lobby sections based on game mode
        updateLobbyDisplay();
        updatePlayersList();
        
        if (selectedGameMode === 'team-vs-team') {
            updateTeamUI();
        }
    });

    socket.on('player-left', (data) => {
        console.log('Hráč odišiel:', data);
        allPlayers = data.players || [];
        otherPlayers = allPlayers.filter(p => p.id !== socket.id);
        
        updatePlayersList();
        
        if (selectedGameMode === 'team-vs-team') {
            updateTeamUI();
        }
    });

    socket.on('team-updated', (data) => {
        // Update player team assignments
        allPlayers = data.players || [];
        otherPlayers = allPlayers.filter(p => p.id !== socket.id);
        
        // Update team captains and names
        teamCaptains = data.teamCaptains || {};
        teamNames = data.teamNames || {};
        
        // Find current player and update team
        const currentPlayer = allPlayers.find(p => p.id === socket.id);
        if (currentPlayer) {
            playerTeam = currentPlayer.team;
        }
        
        // Update team name inputs with current names
        const blueTeamNameInput = document.getElementById('blue-team-name');
        const redTeamNameInput = document.getElementById('red-team-name');
        if (blueTeamNameInput && teamNames.blue) {
            blueTeamNameInput.value = teamNames.blue;
        }
        if (redTeamNameInput && teamNames.red) {
            redTeamNameInput.value = teamNames.red;
        }
        
        updateTeamUI();
        updateJoinButtonsState();
        updateTeamInputStates();
    });

    socket.on('ready-updated', (data) => {
        teamReadyPlayers = new Set(data.readyPlayers || []);
        updateTeamUI();
        
        // Check if all players are ready
        if (data.allReady && allPlayers.length >= 2) {
            // Start character selection
            setTimeout(() => {
                showLobbySection('character');
            }, 1000);
        }
    });

    socket.on('game-ready-updated', (data) => {
        gameReadyPlayers = new Set(data.gameReadyPlayers || []);
        updateGameReadyUI();
        
        console.log(`Game ready players: ${data.gameReadyCount}/${data.totalPlayers}`);
        
        // If all players are game ready, start the game!
        if (data.allGameReady && data.totalPlayers >= 2) {
            console.log('Všetci hráči sú pripravení na hru! Spúšťam hru...');
        }
    });

    socket.on('team-name-updated', (data) => {
        // Update global team names
        teamNames[data.team] = data.name;
        
        // Update input field
        if (data.team === 'blue') {
            const blueInput = document.getElementById('blue-team-name');
            if (blueInput) blueInput.value = data.name;
        } else if (data.team === 'red') {
            const redInput = document.getElementById('red-team-name');
            if (redInput) redInput.value = data.name;
        }
        
        // Update team input states
        updateTeamInputStates();
        
        console.log(`Názov tímu ${data.team} zmenený na: ${data.name}`);
    });

    socket.on('phase-change', (data) => {
        console.log('Fáza sa zmenila na:', data.phase);
        currentPhase = data.phase; // Update current phase tracking
        
        if (data.phase === 'combined-selection') {
            // Hide team selection, show combined selection (like all-vs-all)
            const teamSelection = document.getElementById('lobby-team-selection');
            const playersSection = document.getElementById('lobby-players');
            const characterSelection = document.getElementById('lobby-character-selection');
            const tankSelection = document.getElementById('lobby-tank-selection');
            const mapSelection = document.getElementById('lobby-map-selection');
            const readySection = document.getElementById('lobby-ready-section');
            
            // Hide team selection
            if (teamSelection) teamSelection.style.display = 'none';
            
            // Show all selection sections like in all-vs-all
            if (playersSection) playersSection.style.display = 'block';
            if (characterSelection) characterSelection.style.display = 'block';
            if (tankSelection) tankSelection.style.display = 'block';
            if (mapSelection) mapSelection.style.display = 'block';
            if (readySection) readySection.style.display = 'block';
            
            // Scroll to top to show character selection first (with delay to ensure DOM is updated)
            setTimeout(() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                document.documentElement.scrollTop = 0; // Force immediate scroll as backup
                document.body.scrollTop = 0; // For older browsers
            }, 100);
            
            // Hide team status displays in selection screens
            const teamSelectionStatus = document.getElementById('team-selection-status');
            const teamCharacterStatus = document.getElementById('team-character-status');
            const teamTankStatus = document.getElementById('team-tank-status');
            const teamMapStatus = document.getElementById('team-map-status');
            
            if (teamSelectionStatus) teamSelectionStatus.style.display = 'none';
            if (teamCharacterStatus) teamCharacterStatus.style.display = 'none';
            if (teamTankStatus) teamTankStatus.style.display = 'none';
            if (teamMapStatus) teamMapStatus.style.display = 'none';
            
            // Show game ready button instead of team ready button for final game start
            const teamReadyBtn = document.getElementById('team-ready-btn');
            const allVsAllReadyBtn = document.getElementById('all-vs-all-ready-btn');
            const gameReadyBtn = document.getElementById('game-ready-btn');
            
            // Hide the old ready buttons and show the new game ready button
            if (teamReadyBtn) teamReadyBtn.style.display = 'none';
            if (allVsAllReadyBtn) allVsAllReadyBtn.style.display = 'none';
            if (gameReadyBtn) {
                gameReadyBtn.style.display = 'inline-block';
                gameReadyBtn.disabled = false;
            }
            
            // Update displays
            updatePlayersList(); // Show normal players list
            updateMapVotingDisplay({});
            
            console.log('Prechod do combined selection (ako all-vs-all)');
        } else if (data.phase === 'character-selection') {
            // Hide team selection, show character selection
            const teamSelection = document.getElementById('lobby-team-selection');
            const characterSelection = document.getElementById('lobby-character-selection');
            
            if (teamSelection) teamSelection.style.display = 'none';
            if (characterSelection) characterSelection.style.display = 'block';
            
            console.log('Prechod do výberu charakterov');
        } else if (data.phase === 'tank-selection') {
            // Hide character selection, show tank selection
            const characterSelection = document.getElementById('lobby-character-selection');
            const tankSelection = document.getElementById('lobby-tank-selection');
            
            if (characterSelection) characterSelection.style.display = 'none';
            if (tankSelection) tankSelection.style.display = 'block';
            
            console.log('Prechod do výberu tankov');
        } else if (data.phase === 'map-selection') {
            // Hide tank selection, show map selection
            const tankSelection = document.getElementById('lobby-tank-selection');
            const mapSelection = document.getElementById('lobby-map-selection');
            
            if (tankSelection) tankSelection.style.display = 'none';
            if (mapSelection) mapSelection.style.display = 'block';
            
            console.log('Prechod do výberu máp');
        }
    });

    socket.on('character-selected', (data) => {
        console.log(`Hráč ${data.playerName} z tímu ${data.team} vybral charakter ${data.characterKey}`);
        updateTeamSelectionDisplay();
    });

    socket.on('tank-selected', (data) => {
        console.log(`Hráč ${data.playerName} z tímu ${data.team} vybral tank ${data.tankType}`);
        updateTeamSelectionDisplay();
    });

    socket.on('map-vote-updated', (data) => {
        console.log('Hlasovanie o mape aktualizované:', data);
        updateMapVotingDisplay(data.mapVotes);
    });

// Function to update team selection display for all phases
function updateTeamSelectionDisplay() {
    // Update team displays in all selection phases
    updateCharacterTeamDisplay();
    updateTankTeamDisplay();
    updateMapTeamDisplay();
    
    // Also update the main team UI if visible
    if (document.getElementById('lobby-team-selection').style.display !== 'none') {
        updateTeamUI();
    }
}

function updateCharacterTeamDisplay() {
    const blueTeamPlayers = document.getElementById('blue-team-character-players');
    const redTeamPlayers = document.getElementById('red-team-character-players');
    const blueTeamCount = document.getElementById('blue-team-character-count');
    const redTeamCount = document.getElementById('red-team-character-count');
    const blueTeamTitle = document.getElementById('blue-team-character-title');
    const redTeamTitle = document.getElementById('red-team-character-title');
    
    if (!blueTeamPlayers || !redTeamPlayers) return;
    
    // Update team names
    if (blueTeamTitle) blueTeamTitle.textContent = teamNames.blue || 'Modrý tím';
    if (redTeamTitle) redTeamTitle.textContent = teamNames.red || 'Červený tím';
    
    // Clear and update player lists
    blueTeamPlayers.innerHTML = '';
    redTeamPlayers.innerHTML = '';
    
    let bluePlayers = [];
    let redPlayers = [];
    
    allPlayers.forEach(player => {
        if (player.team === 'blue') {
            bluePlayers.push(player);
        } else if (player.team === 'red') {
            redPlayers.push(player);
        }
    });
    
    // Display blue team players with character selection status
    bluePlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const hasSelectedCharacter = player.selectedCharacter ? '✓' : '⏳';
        const characterInfo = player.selectedCharacter ? 
            `- ${getCharacterName(player.selectedCharacter)}` : '';
            
        playerElement.innerHTML = `
            <span>${player.name} ${characterInfo}</span>
            <span class="selection-status">${hasSelectedCharacter}</span>
        `;
        blueTeamPlayers.appendChild(playerElement);
    });
    
    // Display red team players with character selection status
    redPlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const hasSelectedCharacter = player.selectedCharacter ? '✓' : '⏳';
        const characterInfo = player.selectedCharacter ? 
            `- ${getCharacterName(player.selectedCharacter)}` : '';
            
        playerElement.innerHTML = `
            <span>${player.name} ${characterInfo}</span>
            <span class="selection-status">${hasSelectedCharacter}</span>
        `;
        redTeamPlayers.appendChild(playerElement);
    });
    
    // Update counts
    if (blueTeamCount) blueTeamCount.textContent = `${bluePlayers.length} hráčov`;
    if (redTeamCount) redTeamCount.textContent = `${redPlayers.length} hráčov`;
}

function updateTankTeamDisplay() {
    const blueTeamPlayers = document.getElementById('blue-team-tank-players');
    const redTeamPlayers = document.getElementById('red-team-tank-players');
    const blueTeamCount = document.getElementById('blue-team-tank-count');
    const redTeamCount = document.getElementById('red-team-tank-count');
    const blueTeamTitle = document.getElementById('blue-team-tank-title');
    const redTeamTitle = document.getElementById('red-team-tank-title');
    
    if (!blueTeamPlayers || !redTeamPlayers) return;
    
    // Update team names
    if (blueTeamTitle) blueTeamTitle.textContent = teamNames.blue || 'Modrý tím';
    if (redTeamTitle) redTeamTitle.textContent = teamNames.red || 'Červený tím';
    
    // Clear and update player lists
    blueTeamPlayers.innerHTML = '';
    redTeamPlayers.innerHTML = '';
    
    let bluePlayers = [];
    let redPlayers = [];
    
    allPlayers.forEach(player => {
        if (player.team === 'blue') {
            bluePlayers.push(player);
        } else if (player.team === 'red') {
            redPlayers.push(player);
        }
    });
    
    // Display blue team players with tank selection status
    bluePlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const hasSelectedTank = player.selectedTank ? '✓' : '⏳';
        const tankInfo = player.selectedTank ? 
            `- ${getTankName(player.selectedTank)}` : '';
            
        playerElement.innerHTML = `
            <span>${player.name} ${tankInfo}</span>
            <span class="selection-status">${hasSelectedTank}</span>
        `;
        blueTeamPlayers.appendChild(playerElement);
    });
    
    // Display red team players with tank selection status
    redPlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const hasSelectedTank = player.selectedTank ? '✓' : '⏳';
        const tankInfo = player.selectedTank ? 
            `- ${getTankName(player.selectedTank)}` : '';
            
        playerElement.innerHTML = `
            <span>${player.name} ${tankInfo}</span>
            <span class="selection-status">${hasSelectedTank}</span>
        `;
        redTeamPlayers.appendChild(playerElement);
    });
    
    // Update counts
    if (blueTeamCount) blueTeamCount.textContent = `${bluePlayers.length} hráčov`;
    if (redTeamCount) redTeamCount.textContent = `${redPlayers.length} hráčov`;
}

function updateMapTeamDisplay() {
    const blueTeamPlayers = document.getElementById('blue-team-map-players');
    const redTeamPlayers = document.getElementById('red-team-map-players');
    const blueTeamCount = document.getElementById('blue-team-map-count');
    const redTeamCount = document.getElementById('red-team-map-count');
    const blueTeamTitle = document.getElementById('blue-team-map-title');
    const redTeamTitle = document.getElementById('red-team-map-title');
    
    if (!blueTeamPlayers || !redTeamPlayers) return;
    
    // Update team names
    if (blueTeamTitle) blueTeamTitle.textContent = teamNames.blue || 'Modrý tím';
    if (redTeamTitle) redTeamTitle.textContent = teamNames.red || 'Červený tím';
    
    // Clear and update player lists
    blueTeamPlayers.innerHTML = '';
    redTeamPlayers.innerHTML = '';
    
    let bluePlayers = [];
    let redPlayers = [];
    
    allPlayers.forEach(player => {
        if (player.team === 'blue') {
            bluePlayers.push(player);
        } else if (player.team === 'red') {
            redPlayers.push(player);
        }
    });
    
    // Display blue team players with map voting status
    bluePlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const hasVoted = player.hasVotedMap ? '✓' : '⏳';
        const voteInfo = player.votedMap ? 
            `- Mapa ${player.votedMap}` : '';
            
        playerElement.innerHTML = `
            <span>${player.name} ${voteInfo}</span>
            <span class="selection-status">${hasVoted}</span>
        `;
        blueTeamPlayers.appendChild(playerElement);
    });
    
    // Display red team players with map voting status
    redPlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const hasVoted = player.hasVotedMap ? '✓' : '⏳';
        const voteInfo = player.votedMap ? 
            `- Mapa ${player.votedMap}` : '';
            
        playerElement.innerHTML = `
            <span>${player.name} ${voteInfo}</span>
            <span class="selection-status">${hasVoted}</span>
        `;
        redTeamPlayers.appendChild(playerElement);
    });
    
    // Update counts
    if (blueTeamCount) blueTeamCount.textContent = `${bluePlayers.length} hráčov`;
    if (redTeamCount) redTeamCount.textContent = `${redPlayers.length} hráčov`;
}

// Helper functions to get display names
function getCharacterName(characterKey) {
    const characterNames = {
        'jaccelini': 'M. Jaklović',
        'tvaruzhkyn': 'J. Tvaruzhkyn',
        'kindergarden': 'J. W. Gardens',
        'landmann': 'Herr Landmann',
        // Add more character names as needed
    };
    return characterNames[characterKey] || characterKey;
}

function getTankName(tankType) {
    const tankNames = {
        'purple': 'Obrnený Bojovník',
        'orange': 'Rýchly Útočník',
        'brown': 'Ťažký Moloch'
    };
    return tankNames[tankType] || tankType;
}

// Function to update map voting display for team mode
function updateMapVotingDisplay(mapVotes) {
    const mapCards = document.querySelectorAll('#lobby-map-cards .lobby-map-card');
    
    // Ensure mapVotes is defined
    if (!mapVotes) mapVotes = {};
    
    mapCards.forEach(card => {
        const mapId = card.dataset.map;
        const voteCount = mapVotes[mapId] ? mapVotes[mapId].length : 0;
        
        // Update vote counter
        let voteCounter = card.querySelector('.vote-counter');
        if (!voteCounter) {
            voteCounter = document.createElement('div');
            voteCounter.className = 'vote-counter';
            card.appendChild(voteCounter);
        }
        voteCounter.textContent = `${voteCount} hlasov`;
        
        // Highlight most voted map
        card.classList.remove('most-voted');
        if (voteCount > 0) {
            const maxVotes = Math.max(...Object.values(mapVotes).map(votes => votes ? votes.length : 0));
            if (voteCount === maxVotes) {
                card.classList.add('most-voted');
            }
        }
    });
}
    
    socket.on('room-created', (data) => {
        console.log('Miestnosť vytvorená:', data);
        isHost = data.hostId === socket.id;
        currentRoom = data.roomId; // Set current room ID
        selectedLobbyMap = data.selectedMap;
        updateLobbyUI(data);
    });
    
    socket.on('map-selected', (data) => {
        console.log('Mapa vybraná:', data);
        selectedLobbyMap = data.mapId;
        updateMapSelection(data.mapId);
    });
    
    socket.on('character-selected', (data) => {
        console.log('Charakter vybraný:', data);
        updateCharacterSelection(data.playerId, data.characterId);
    });
    
    socket.on('tank-selected', (data) => {
        console.log('Tank vybraný:', data);
        updateTankSelection(data.playerId, data.tankId);
    });
    
    socket.on('player-ready-update', (data) => {
        console.log('Ready update:', data);
        // Update UI to show which players are ready
        const playerItems = document.querySelectorAll('.player-item');
        playerItems.forEach(item => {
            if (item.dataset && item.dataset.playerId === data.playerId) {
                const statusSpan = item.querySelector('.player-status');
                if (statusSpan) {
                    statusSpan.textContent = data.ready ? 'Pripravený' : 'Čaká';
                    statusSpan.className = data.ready ? 'player-ready' : 'player-waiting';
                }
            }
        });
    });
    
    socket.on('game-start', (data) => {
        console.log('Hra začína:', data);
        startMultiplayerGame(data);
    });
    
    socket.on('host-start-error', (data) => {
        console.log('Host start error:', data.message);
        showLobbyError(data.message);
    });
    
    socket.on('selection-phase-started', (data) => {
        console.log('Selection phase started:', data);
        updateLobbyUI(data);
    });
    
    socket.on('selection-start-error', (data) => {
        console.log('Selection start error:', data.message);
        showLobbyError(data.message);
    });
    
    socket.on('selection-not-ready', (data) => {
        console.log('Selection not ready:', data.message);
        showLobbyError(data.message);
    });

    // Handle position updates from other players
    socket.on('player-position', (data) => {
        const otherTank = multiplayerTanks.get(data.playerId);
        if (otherTank) {
            // Only log occasionally for debugging
            if (Math.random() < 0.001) { // 0.1% chance
                console.log(`📍 Position update for ${data.playerId}:`, {
                    from: { x: Math.round(otherTank.x), y: Math.round(otherTank.y) },
                    to: { x: data.x, y: data.y }
                });
            }
            
            // Store previous position for interpolation
            otherTank.prevX = otherTank.x;
            otherTank.prevY = otherTank.y;
            otherTank.prevAngle = otherTank.angle;
            otherTank.prevTurretAngle = otherTank.turretAbsoluteAngle;
            
            // Store target position
            otherTank.targetX = data.x;
            otherTank.targetY = data.y;
            otherTank.targetAngle = data.angle;
            otherTank.targetTurretAngle = data.turretAngle;
            
            // Reset interpolation timer
            otherTank.interpolationTime = 0;
            otherTank.lastUpdateTime = Date.now();
        } else {
            console.warn(`❌ No tank found for player ${data.playerId} - available tanks:`, Array.from(multiplayerTanks.keys()));
        }
    });

    // Handle shooting from other players
    socket.on('player-shoot', (data) => {
        const otherTank = multiplayerTanks.get(data.playerId);
        if (otherTank) {
            // Create bullet from other player using pooling
            const bullet = bulletManager.createBullet(
                data.x,
                data.y,
                data.angle,
                otherTank.damage * (data.bulletType === 2 ? 2 : 1),
                otherTank,
                data.bulletType || 1
            );
            
            // Add muzzle flash effect
            gameState.shotEffects.push(new ShotEffect(data.x, data.y, data.angle));
            
            // Play shooting sound
            try {
                const audio = new Audio('canonshot.mp3');
                audio.preload = 'auto';
                audio.volume = 0.35;
                audio.currentTime = 0;
                audio.play();
            } catch (e) {}
        }
    });

    // Handle damage from other players
    socket.on('player-damage', (data) => {
        const damagedTank = multiplayerTanks.get(data.playerId);
        if (damagedTank && data.attackerId !== socket.id) {
            // Apply damage without calling takeDamage (to avoid double damage)
            damagedTank.health = Math.max(0, data.newHealth);
            
            // Add visual hit effect
            gameState.hitEffects.push(new HitEffect(damagedTank.x + damagedTank.width / 2, damagedTank.y + damagedTank.height / 2));
            
            // Play sound if this is our tank getting hit
            if (damagedTank === gameState.player) {
                try {
                    const audio = new Audio('hitme.mp3');
                    audio.preload = 'auto';
                    audio.volume = 0.7;
                    audio.currentTime = 0;
                    audio.play();
                } catch (e) {}
            }
        }
    });

    // Handle death from other players
    socket.on('player-death', (data) => {
        const deadTank = multiplayerTanks.get(data.playerId);
        if (deadTank && data.killerId !== socket.id) {
            // Mark tank as dead and create explosion
            deadTank.health = 0;
            deadTank.explode();
        }
    });
    
    // Handle player elimination
    socket.on('player-eliminated', (data) => {
        console.log('Player eliminated:', data);
        
        // Remove tank from game
        if (multiplayerTanks.has(data.playerId)) {
            multiplayerTanks.delete(data.playerId);
        }
        
        // Show elimination message
        showEliminationMessage(data);
        
        // Handle self elimination
        if (data.playerId === socket.id) {
            handleMultiplayerDeath(data.playerId, data.playerName);
        }
    });
    
    // Handle player disconnection during game
    socket.on('player-disconnected', (data) => {
        console.log('Player disconnected:', data);
        
        // Remove tank from game
        if (multiplayerTanks.has(data.playerId)) {
            multiplayerTanks.delete(data.playerId);
        }
        
        // Show disconnection message
        showDisconnectionMessage(data);
    });
    
    // Handle host change
    socket.on('host-changed', (data) => {
        console.log('New host assigned:', data);
        isHost = (data.newHostId === socket.id);
        
        // Update UI to reflect host status
        updateHostUI();
        
        // Show host change notification
        showNotification(`${data.newHostName} is now the host`, 'info');
    });
    
    // Handle game pause due to too few players
    socket.on('game-paused', (data) => {
        console.log('Game paused:', data.reason);
        gameState.roundOver = true;
        
        // Show pause message
        showNotification(`Game paused: ${data.reason}`, 'warning');
        
        // Return to lobby
        setTimeout(() => {
            showScreen('lobby');
        }, 3000);
    });
    
    // Handle elimination errors
    socket.on('elimination-error', (data) => {
        console.error('Elimination error:', data);
        showNotification(`Error: ${data.message}`, 'error');
    });
    
    // Handle ping/pong for latency measurement
    socket.on('pong', (data) => {
        if (networkManager) {
            const latency = Date.now() - data.timestamp;
            networkManager.connectionQuality.latency = latency;
            
            // Update bandwidth estimation
            if (latency < 50) {
                networkManager.connectionQuality.bandwidth = 'good';
            } else if (latency < 150) {
                networkManager.connectionQuality.bandwidth = 'fair';
            } else {
                networkManager.connectionQuality.bandwidth = 'poor';
            }
        }
    });
    
    // Start periodic latency measurement
    if (networkManager) {
        setInterval(() => {
            networkManager.measureLatency();
        }, 5000); // Every 5 seconds
    }
}

// Update lobby UI
function updateLobbyUI(data) {
    const lobbyStatus = document.getElementById('lobby-status');
    
    // Get game mode name
    const gameModeNames = {
        'all-vs-all': 'All vs. All (Každý proti každému)',
        'team-vs-team': 'Team vs. Team (Tímový súboj)'
    };
    const gameModeName = gameModeNames[data.gameMode] || data.gameMode;
    
    lobbyStatus.innerHTML = `
        <p>Pripojený k serveru - Miestnosť: ${data.roomId} ${isHost ? '(Host)' : ''}</p>
        <p>Herný mód: <strong>${gameModeName}</strong></p>
    `;
    
    // Update players list
    allPlayers = data.players || [];
    updateLobbyDisplay();
}

function updateLobbyDisplay() {
    // Show/hide appropriate lobby sections based on game mode
    const teamSelection = document.getElementById('lobby-team-selection');
    const playersSection = document.getElementById('lobby-players');
    const characterSelection = document.getElementById('lobby-character-selection');
    const tankSelection = document.getElementById('lobby-tank-selection');
    const mapSelection = document.getElementById('lobby-map-selection');
    const readySection = document.getElementById('lobby-ready-section');
    const waitingDiv = document.getElementById('lobby-waiting');
    
    // Hide all sections first
    teamSelection.style.display = 'none';
    playersSection.style.display = 'none';
    characterSelection.style.display = 'none';
    tankSelection.style.display = 'none';
    mapSelection.style.display = 'none';
    readySection.style.display = 'none';
    waitingDiv.style.display = 'none';
    
    // Hide all ready buttons
    const teamReadyBtn = document.getElementById('team-ready-btn');
    const allVsAllReadyBtn = document.getElementById('all-vs-all-ready-btn');
    const readyBtn = document.getElementById('ready-btn');
    
    if (teamReadyBtn) teamReadyBtn.style.display = 'none';
    if (allVsAllReadyBtn) allVsAllReadyBtn.style.display = 'none';
    if (readyBtn) readyBtn.style.display = 'none';
    
    if (selectedGameMode === 'team-vs-team') {
        // Show team selection for team mode
        teamSelection.style.display = 'block';
        // Add ready button to team selection area
        if (teamReadyBtn) teamReadyBtn.style.display = 'inline-block';
    } else {
        // Show all sections for all-vs-all mode
        playersSection.style.display = 'block';
        characterSelection.style.display = 'block';
        tankSelection.style.display = 'block';
        mapSelection.style.display = 'block';
        readySection.style.display = 'block';
        
        if (allVsAllReadyBtn) {
            allVsAllReadyBtn.style.display = 'inline-block';
        }
        
        updatePlayersList();
        updateAllVsAllReadyState();
        updateMapVotingDisplay({});
    }
}

function updatePlayersList() {
    const playersList = document.getElementById('players-list');
    
    if (!playersList) return;
    
    playersList.innerHTML = '';
    
    allPlayers.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        
        // Check for game ready status when game-ready-btn is visible
        let isPlayerReady = false;
        let readyText = 'Čaká';
        
        const gameReadyBtn = document.getElementById('game-ready-btn');
        const isGameReadyBtnVisible = gameReadyBtn && gameReadyBtn.style.display !== 'none';
        
        if (isGameReadyBtnVisible && selectedGameMode === 'team-vs-team' && currentPhase === 'combined-selection') {
            // Use game ready status
            isPlayerReady = gameReadyPlayers.has(player.id);
            readyText = isPlayerReady ? 'Ready na hru' : 'Nie je ready na hru';
        } else if (selectedGameMode === 'team-vs-team' && currentPhase === 'combined-selection') {
            // Use team ready status
            isPlayerReady = teamReadyPlayers.has(player.id);
            readyText = isPlayerReady ? 'Pripravený' : 'Čaká';
        } else {
            // Use regular ready status
            isPlayerReady = player.ready;
            readyText = isPlayerReady ? 'Pripravený' : 'Čaká';
        }
        
        const isReady = isPlayerReady ? 'player-ready' : 'player-waiting';
        
        // Show team info for team mode
        let teamInfo = '';
        if (selectedGameMode === 'team-vs-team' && player.team) {
            teamInfo = ` (${player.team === 'blue' ? 'Modrý' : 'Červený'} tím)`;
        }
        
        playerDiv.innerHTML = `
            <span>${player.name}${teamInfo} ${player.id === socket.id ? '(Ty)' : ''}</span>
            <span class="${isReady}">${readyText}</span>
        `;
        
        playersList.appendChild(playerDiv);
    });
    
    // Update host controls visibility - only for all-vs-all mode
    const hostControls = document.getElementById('host-controls');
    if (hostControls) {
        if (isHost && selectedGameMode === 'all-vs-all') {
            hostControls.style.display = 'block';
            console.log('Debug - Host controls shown for all-vs-all'); // Debug log
        } else {
            hostControls.style.display = 'none';
            console.log('Debug - Host controls hidden for team mode or non-host'); // Debug log
        }
    }
}

function showLobbySection(section) {
    const sections = [
        'lobby-team-selection',
        'lobby-players', 
        'lobby-character-selection',
        'lobby-tank-selection',
        'lobby-map-selection',
        'lobby-ready-section',
        'lobby-waiting'
    ];
    
    // Hide all sections
    sections.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
    
    // Show requested section
    const targetElement = document.getElementById(`lobby-${section}-selection`);
    if (targetElement) {
        targetElement.style.display = 'block';
    }
}

// Team management functions

function joinTeam(teamName) {
    if (!socket || !isMultiplayer || selectedGameMode !== 'team-vs-team') return;
    
    // If already on this team, leave it
    if (playerTeam === teamName) {
        playerTeam = null;
        socket.emit('leave-team');
    } else {
        // Join the new team
        playerTeam = teamName;
        socket.emit('join-team', { team: teamName });
    }
}

function togglePlayerReady() {
    if (!socket || !isMultiplayer) return;
    
    socket.emit('toggle-ready');
}

function updateTeamUI() {
    const blueTeamContainer = document.getElementById('blue-team-players');
    const redTeamContainer = document.getElementById('red-team-players');
    
    if (!blueTeamContainer || !redTeamContainer || !allPlayers) return;
    
    // Clear containers
    blueTeamContainer.innerHTML = '';
    redTeamContainer.innerHTML = '';
    
    // Separate players by team
    const blueTeamPlayers = allPlayers.filter(p => p.team === 'blue');
    const redTeamPlayers = allPlayers.filter(p => p.team === 'red');
    
    // Add players to team containers
    blueTeamPlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        playerElement.innerHTML = `
            <span class="player-name">${player.name || 'Player'}</span>
            ${player.id === currentRoom?.hostId ? '<span class="host-badge">HOST</span>' : ''}
            ${player.ready ? '<span class="ready-badge">READY</span>' : ''}
        `;
        blueTeamContainer.appendChild(playerElement);
    });
    
    redTeamPlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        playerElement.innerHTML = `
            <span class="player-name">${player.name || 'Player'}</span>
            ${player.id === currentRoom?.hostId ? '<span class="host-badge">HOST</span>' : ''}
            ${player.ready ? '<span class="ready-badge">READY</span>' : ''}
        `;
        redTeamContainer.appendChild(playerElement);
    });
    
    // Update team counts
    const blueTeamCount = document.getElementById('blue-team-count');
    const redTeamCount = document.getElementById('red-team-count');
    
    if (blueTeamCount) blueTeamCount.textContent = `${blueTeamPlayers.length} hráčov`;
    if (redTeamCount) redTeamCount.textContent = `${redTeamPlayers.length} hráčov`;
    
    updateJoinButtonsState();
}

function updateJoinButtonsState() {
    const joinBlueBtn = document.querySelector('.join-team-btn[data-team="blue"]');
    const joinRedBtn = document.querySelector('.join-team-btn[data-team="red"]');
    const readyBtn = document.getElementById('team-ready-btn');
    
    if (!joinBlueBtn || !joinRedBtn || !readyBtn) return;
    
    // Update join button states
    if (playerTeam === 'blue') {
        joinBlueBtn.textContent = 'OPUSTIŤ TÍM';
        joinBlueBtn.classList.add('selected');
        joinRedBtn.textContent = 'PRIDAŤ SA K ČERVENÉMU TÍMU';
        joinRedBtn.classList.remove('selected');
    } else if (playerTeam === 'red') {
        joinRedBtn.textContent = 'OPUSTIŤ TÍM';
        joinRedBtn.classList.add('selected');
        joinBlueBtn.textContent = 'PRIDAŤ SA K MODRÉMU TÍMU';
        joinBlueBtn.classList.remove('selected');
    } else {
        joinBlueBtn.textContent = 'PRIDAŤ SA K MODRÉMU TÍMU';
        joinBlueBtn.classList.remove('selected');
        joinRedBtn.textContent = 'PRIDAŤ SA K ČERVENÉMU TÍMU';
        joinRedBtn.classList.remove('selected');
    }
    
    // Update ready button state
    const currentPlayer = allPlayers.find(p => p.id === socket.id);
    if (currentPlayer && playerTeam) {
        readyBtn.style.display = 'block';
        readyBtn.disabled = false;
        readyBtn.textContent = currentPlayer.ready ? 'ZRUŠ PRIPRAVENOSŤ' : 'SOM PRIPRAVENÝ';
        readyBtn.classList.toggle('ready', currentPlayer.ready);
    } else {
        readyBtn.style.display = 'none';
    }
    
    // Show host controls for starting selection
    const hostStartSelectionBtn = document.getElementById('host-start-selection-btn');
    const hostStartBtn = document.getElementById('host-start-game-btn');
    const hostLockBtn = document.getElementById('host-lock-room-btn-main');
    
    console.log('Debug - hostLockBtn found:', !!hostLockBtn); // Debug log
    console.log('Debug - isHost:', isHost, 'selectedGameMode:', selectedGameMode); // Debug log
    console.log('Debug - currentRoom:', currentRoom); // Debug log
    
    // Show/hide host controls - only for all-vs-all mode
    const hostControls = document.getElementById('host-controls');
    if (isHost && selectedGameMode === 'all-vs-all') {
        if (hostControls) {
            hostControls.style.display = 'block';
        }
        if (hostLockBtn) {
            console.log('Debug - Setting hostLockBtn to block (host, all-vs-all)'); // Debug log
            hostLockBtn.style.display = 'block';
        }
    } else {
        if (hostControls) {
            hostControls.style.display = 'none';
        }
        if (hostLockBtn) {
            console.log('Debug - Setting hostLockBtn to none (team mode or not host)'); // Debug log
            hostLockBtn.style.display = 'none';
        }
    }
    
    // Host start buttons logic - only for all-vs-all mode
    if (isHost && selectedGameMode === 'all-vs-all') {
        if (hostStartBtn) {
            hostStartBtn.style.display = 'block';
            
            if (allPlayers.length >= 2) {
                hostStartBtn.disabled = false;
                hostStartBtn.textContent = 'SPUSTIŤ HRU';
            } else {
                hostStartBtn.disabled = true;
                hostStartBtn.textContent = `POTREBUJETE ASPOŇ 2 HRÁČOV (${allPlayers.length}/2)`;
            }
        }
        if (hostStartSelectionBtn) {
            hostStartSelectionBtn.style.display = 'none';
        }
    } else {
        // Hide both buttons for team mode or non-hosts
        if (hostStartSelectionBtn) {
            hostStartSelectionBtn.style.display = 'none';
        }
        if (hostStartBtn) {
            hostStartBtn.style.display = 'none';
        }
    }
}

function createPlayerItem(player, hostId) {
    const isPlayerHost = player.id === hostId;
    const playerDiv = document.createElement('div');
    playerDiv.className = 'player-item';
    playerDiv.dataset.playerId = player.id;
    
    // Show character and tank info if selected
    let characterInfo = '';
    let tankInfo = '';
    if (player.selectedCharacter) {
        characterInfo = ` | 👤 ${getCharacterName(player.selectedCharacter)}`;
    }
    if (player.selectedTank) {
        tankInfo = ` | 🚗 ${getTankName(player.selectedTank)}`;
    }
    
    playerDiv.innerHTML = `
        <span>${player.name} ${player.id === socket.id ? '(Ty)' : ''} ${isPlayerHost ? '👑' : ''}${characterInfo}${tankInfo}</span>
        <span class="player-status ${player.ready ? 'player-ready' : 'player-waiting'}">
            ${player.ready ? 'Pripravený' : 'Čaká'}
        </span>
    `;
    
    return playerDiv;
}

function createPlayerItem(player, hostId) {
    const isPlayerHost = player.id === hostId;
    
    const playerDiv = document.createElement('div');
    playerDiv.className = 'team-player-item';
    
    playerDiv.innerHTML = `
        <span class="player-name">${player.name || 'Player'}</span>
        ${isPlayerHost ? '<span class="host-badge">HOST</span>' : ''}
        ${player.ready ? '<span class="ready-badge">READY</span>' : ''}
    `;
    
    return playerDiv;
}

// Show error message in lobby
function showLobbyError(message) {
    let errorDiv = document.querySelector('.lobby-error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.className = 'lobby-error-message';
        const lobbyControls = document.querySelector('.lobby-bottom-controls');
        if (lobbyControls) {
            lobbyControls.parentNode.insertBefore(errorDiv, lobbyControls);
        }
    }
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Hide error after 5 seconds
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Initialize character selection in lobby
function initCharacterSelection() {
    const characterCards = document.querySelectorAll('.lobby-character-card');
    
    characterCards.forEach(card => {
        card.onclick = () => {
            const characterId = card.dataset.character;
            selectLobbyCharacter(characterId);
        };
    });
}

// Select character in lobby
function selectLobbyCharacter(characterId) {
    selectedLobbyCharacter = characterId;
    
    // Send to server - different events for different modes
    if (selectedGameMode === 'team-vs-team') {
        socket.emit('select-character', { characterKey: characterId });
    } else {
        socket.emit('select-character', { characterId: characterId });
    }
    
    // Update UI immediately
    updateCharacterSelectionUI(characterId);
}

// Update character selection UI
function updateCharacterSelectionUI(characterId) {
    const characterCards = document.querySelectorAll('.lobby-character-card');
    const selectedCharacterName = document.getElementById('selected-character-name');
    
    // Update card selection
    characterCards.forEach(card => {
        if (card.dataset.character === characterId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    
    // Update selected character name
    if (selectedCharacterName) {
        selectedCharacterName.textContent = getCharacterName(characterId);
    }
    
    // Check if ready button should be enabled
    updateReadyButtonState();
}

// Initialize tank selection in lobby
function initTankSelection() {
    const tankCards = document.querySelectorAll('.lobby-tank-card');
    
    tankCards.forEach(card => {
        card.onclick = () => {
            const tankId = card.dataset.tank;
            selectLobbyTank(tankId);
        };
        
        // Draw tank preview
        const canvas = card.querySelector('.lobby-tank-preview');
        if (canvas) {
            drawTankPreview(canvas, card.dataset.tank);
        }
    });
}

// Select tank in lobby
function selectLobbyTank(tankId) {
    selectedLobbyTank = tankId;
    
    // Send to server - different events for different modes
    if (selectedGameMode === 'team-vs-team') {
        socket.emit('select-tank', { tankType: tankId });
    } else {
        socket.emit('select-tank', { tankId: tankId });
    }
    
    // Update UI immediately
    updateTankSelectionUI(tankId);
}

// Update tank selection UI
function updateTankSelectionUI(tankId) {
    const tankCards = document.querySelectorAll('.lobby-tank-card');
    const selectedTankName = document.getElementById('selected-tank-name');
    
    // Update card selection
    tankCards.forEach(card => {
        if (card.dataset.tank === tankId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    
    // Update selected tank name
    if (selectedTankName) {
        selectedTankName.textContent = getTankName(tankId);
    }
    
    // Check if ready button should be enabled
    updateReadyButtonState();
}

// Update character selection from other players
function updateCharacterSelection(playerId, characterId) {
    // Find player in the list and update their character info
    const playerItem = document.querySelector(`[data-player-id="${playerId}"]`);
    if (playerItem) {
        // This will be handled in the next updateLobbyUI call
        console.log(`Player ${playerId} selected character ${characterId}`);
    }
}

// Update tank selection from other players
function updateTankSelection(playerId, tankId) {
    // Find player in the list and update their tank info
    const playerItem = document.querySelector(`[data-player-id="${playerId}"]`);
    if (playerItem) {
        // This will be handled in the next updateLobbyUI call
        console.log(`Player ${playerId} selected tank ${tankId}`);
    }
}

// Update ready button state based on selections
function updateReadyButtonState() {
    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn && readyBtn.style.display !== 'none') {
        const hasAllSelections = selectedLobbyCharacter && selectedLobbyTank;
        readyBtn.disabled = !hasAllSelections;
        readyBtn.textContent = hasAllSelections ? 'Som pripravený!' : 'Vyber charakter a tank';
    }
}

function updateAllVsAllReadyState() {
    const allVsAllReadyBtn = document.getElementById('all-vs-all-ready-btn');
    if (allVsAllReadyBtn && allVsAllReadyBtn.style.display !== 'none') {
        const hasCharacter = selectedLobbyCharacter;
        const hasTank = selectedLobbyTank;
        const hasMap = selectedLobbyMap;
        
        if (!hasCharacter) {
            allVsAllReadyBtn.disabled = true;
            allVsAllReadyBtn.textContent = 'Vyber charakter';
        } else if (!hasTank) {
            allVsAllReadyBtn.disabled = true;
            allVsAllReadyBtn.textContent = 'Vyber tank';
        } else if (!hasMap) {
            allVsAllReadyBtn.disabled = true;
            allVsAllReadyBtn.textContent = 'Vyber mapu';
        } else {
            allVsAllReadyBtn.disabled = false;
            allVsAllReadyBtn.textContent = playerIsReady ? 'Pripravený!' : 'Som pripravený!';
        }
    }
}

function updateAllVsAllMapVotingDisplay() {
    // Update map cards to show vote counts for all-vs-all mode
    const mapCards = document.querySelectorAll('#lobby-map-cards .lobby-map-card');
    mapCards.forEach(card => {
        const mapId = card.dataset.map;
        
        // Remove existing vote counter
        const existingCounter = card.querySelector('.vote-counter');
        if (existingCounter) {
            existingCounter.remove();
        }
        
        // Add vote counter
        const voteCounter = document.createElement('div');
        voteCounter.className = 'vote-counter';
        voteCounter.textContent = '0 hlasov';
        card.appendChild(voteCounter);
    });
}

// Lobby selection functions
function selectLobbyCharacter(characterId) {
    selectedLobbyCharacter = characterId;
    
    // Update visual selection
    const characterCards = document.querySelectorAll('#lobby-character-cards .lobby-character-card');
    characterCards.forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.character === characterId) {
            card.classList.add('selected');
        }
    });
    
    // Update selected character info
    const selectedCharacterName = document.getElementById('selected-character-name');
    if (selectedCharacterName && CHARACTERS[characterId]) {
        selectedCharacterName.textContent = CHARACTERS[characterId].name;
    }
    
    // Emit to server
    if (socket && currentRoom) {
        socket.emit('select-character', { characterId });
    }
    
    updateAllVsAllReadyState();
}

function selectLobbyTank(tankId) {
    selectedLobbyTank = tankId;
    
    // Update visual selection
    const tankCards = document.querySelectorAll('#lobby-tank-cards .lobby-tank-card');
    tankCards.forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.tank === tankId) {
            card.classList.add('selected');
        }
    });
    
    // Update selected tank info
    const selectedTankName = document.getElementById('selected-tank-name');
    const tankNames = {
        'purple': 'Obrnený Bojovník',
        'orange': 'Rýchly Útočník',
        'brown': 'Ťažký Moloch'
    };
    if (selectedTankName) {
        selectedTankName.textContent = tankNames[tankId] || tankId;
    }
    
    // Emit to server
    if (socket && currentRoom) {
        socket.emit('select-tank', { tankId });
    }
    
    updateAllVsAllReadyState();
}

function selectLobbyMap(mapId) {
    console.log('selectLobbyMap called with:', mapId); // Debug log
    selectedLobbyMap = mapId;
    
    // Update visual selection
    const mapCards = document.querySelectorAll('#lobby-map-cards .lobby-map-card');
    mapCards.forEach(card => {
        card.classList.remove('selected');
        if (card.dataset.map === mapId) {
            card.classList.add('selected');
        }
    });
    
    // Emit to server based on game mode
    if (socket && currentRoom) {
        if (selectedGameMode === 'all-vs-all') {
            // All vs all - map voting
            console.log('Emitting vote-map:', mapId); // Debug log
            socket.emit('vote-map', { mapId });
        } else if (selectedGameMode === 'team-vs-team') {
            // Team vs team - voting for all players
            console.log('Emitting vote-map for team mode:', mapId); // Debug log
            socket.emit('vote-map', { mapId });
        }
    } else {
        console.log('Socket or currentRoom not available'); // Debug log
    }
    
    updateAllVsAllReadyState();
}

function toggleAllVsAllReady() {
    if (!selectedLobbyCharacter || !selectedLobbyTank || !selectedLobbyMap) {
        return;
    }
    
    playerIsReady = !playerIsReady;
    
    if (socket && currentRoom) {
        socket.emit('toggle-ready', { ready: playerIsReady });
    }
    
    updateAllVsAllReadyState();
}

// Helper functions for names
function getCharacterName(characterId) {
    // Use the full CHARACTERS object for names
    return CHARACTERS[characterId]?.name || characterId;
}

function getTankName(tankId) {
    const tankNames = {
        'purple': 'Obrnený Bojovník',
        'orange': 'Rýchly Útočník',
        'brown': 'Ťažký Moloch'
    };
    return tankNames[tankId] || tankId;
}

// Draw tank preview on canvas
function drawTankPreview(canvas, tankType) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Tank colors
    const colors = {
        'purple': '#9b59b6',
        'orange': '#e67e22',
        'brown': '#8d6e63'
    };
    
    const color = colors[tankType] || '#8e44ad';
    
    // Draw simple tank representation
    ctx.fillStyle = color;
    
    // Tank body
    ctx.fillRect(width/2 - 15, height/2 - 8, 30, 16);
    
    // Tank turret
    ctx.fillRect(width/2 - 8, height/2 - 12, 16, 8);
    
    // Tank cannon
    ctx.fillRect(width/2 + 8, height/2 - 2, 15, 4);
    
    // Tank tracks
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(width/2 - 18, height/2 - 10, 4, 20);
    ctx.fillRect(width/2 + 14, height/2 - 10, 4, 20);
}

// Initialize map selection in lobby
function initMapSelection() {
    const mapCards = document.querySelectorAll('.lobby-map-card');
    
    mapCards.forEach(card => {
        card.onclick = () => {
            if (isHost && !card.classList.contains('disabled')) {
                const mapId = card.dataset.map;
                selectLobbyMap(mapId);
            }
        };
        
        // Enable/disable based on host status
        if (isHost) {
            card.classList.remove('disabled');
            card.style.cursor = 'pointer';
        } else {
            card.classList.add('disabled');
            card.style.cursor = 'not-allowed';
        }
    });
}

// Select map in lobby (host only)
// Update map selection UI
function updateMapSelection(mapId) {
    const mapCards = document.querySelectorAll('.lobby-map-card');
    const selectedMapName = document.getElementById('selected-map-name');
    
    // Update card selection
    mapCards.forEach(card => {
        if (card.dataset.map === mapId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
    
    // Update selected map name
    const mapNames = {
        '1': 'Zelená krajina',
        '2': 'Púšť s ropnými vežami', 
        '3': 'Arktída s iglami'
    };
    
    if (selectedMapName) {
        selectedMapName.textContent = mapNames[mapId] || 'Náhodná';
    }
}

// Start multiplayer game
function startMultiplayerGame(data) {
    console.log('Začínam multiplayer hru:', data);
    
    // Set multiplayer mode
    isMultiplayer = true;
    
    // Use shared game data from server
    gameState.currentMode = '1v1';
    gameState.selectedMap = data.gameData.map || '1';
    gameState.selectedPlayerChar = CHARACTERS.jaccelini; // Default character for now
    
    // Show game screen
    showScreen('game');
    
    // Initialize game state for multiplayer
    gameState.playerScore = 0;
    gameState.enemyScore = 0;
    gameState.playerCoins = 0;
    gameState.isSpectating = false;
    gameState.roundOver = false;
    
    // Set arena size from server data
    gameState.arenaWidth = data.gameData.arenaWidth || 2000;
    gameState.arenaHeight = data.gameData.arenaHeight || 1500;
    
    // Set floor texture based on server map
    const mapId = data.gameData.map || '1';
    if (mapId === '2') {
        gameState.currentFloorTexture = gameState.dessertTexture;
    } else if (mapId === '3') {
        gameState.currentFloorTexture = gameState.iceTexture;
    } else {
        gameState.currentFloorTexture = gameState.grassTexture;
    }
    
    // Create shared obstacles from server data
    createSharedObstacles(data.gameData.obstacles || []);
    
    // Clear existing game objects
    bulletManager.removeAllBullets(); // Use bullet manager cleanup
    particleManager.removeAllParticles(); // Use particle manager cleanup
    gameState.tracks = [];
    gameState.shotEffects = [];
    gameState.hitEffects = [];
    gameState.allies = []; // No allies in multiplayer
    
    // Create tanks for all players using server positions
    const myPlayerId = socket.id;
    const playerPositions = data.gameData.playerPositions || {};
    
    console.log('🚀 GAME START DEBUG:');
    console.log('My socket ID:', socket.id);
    console.log('My player ID:', myPlayerId);
    console.log('Player positions from server:', playerPositions);
    console.log('All players:', data.players.map(p => ({ id: p.id, name: p.name })));
    
    // Clear existing tanks
    multiplayerTanks.clear();
    gameState.enemies = [];
    
    // Create tanks for all players
    data.players.forEach(playerData => {
        const position = playerPositions[playerData.id];
        if (!position) {
            console.warn(`❌ No position found for player ${playerData.id}`);
            return;
        }
        
        const isMyPlayer = playerData.id === myPlayerId;
        const characterKey = position.character || playerData.selectedCharacter || 'jaccelini';
        
        console.log(`🔧 Creating tank for player ${playerData.id}:`, {
            isMyPlayer,
            position: { x: position.x, y: position.y },
            tankType: position.tankType,
            character: characterKey
        });
        
        const tank = new Tank(
            position.x, 
            position.y, 
            position.tankType, 
            isMyPlayer, // isPlayer
            false, // isAlly
            characterKey // character from server position data
        );
        tank.playerId = playerData.id;
        
        if (isMyPlayer) {
            gameState.player = tank;
            // Set player character for UI display
            gameState.selectedPlayerChar = CHARACTERS[characterKey];
        } else {
            tank.isMultiplayerOpponent = true;
            
            // Add interpolation properties for smooth movement
            tank.prevX = tank.x;
            tank.prevY = tank.y;
            tank.prevAngle = tank.angle;
            tank.prevTurretAngle = tank.turretAbsoluteAngle;
            tank.targetX = tank.x;
            tank.targetY = tank.y;
            tank.targetAngle = tank.angle;
            tank.targetTurretAngle = tank.turretAbsoluteAngle;
            tank.interpolationTime = 0;
            tank.lastUpdateTime = Date.now();
            
            gameState.enemies.push(tank);
        }
        
        multiplayerTanks.set(playerData.id, tank);
    });
    
    // Initialize camera to player position
    if (gameState.player) {
        gameState.cameraX = gameState.player.x + gameState.player.width / 2 - canvas.width / 2;
        gameState.cameraY = gameState.player.y + gameState.player.height / 2 - canvas.height / 2;
        
        // Clamp camera to arena boundaries
        gameState.cameraX = Math.max(0, Math.min(gameState.cameraX, gameState.arenaWidth - canvas.width));
        gameState.cameraY = Math.max(0, Math.min(gameState.cameraY, gameState.arenaHeight - canvas.height));
        
        console.log(`🎥 Camera initialized to player position:`, {
            playerPos: { x: gameState.player.x, y: gameState.player.y },
            cameraPos: { x: gameState.cameraX, y: gameState.cameraY }
        });
    }
    
    // Start the game loop
    if(gameState.gameInterval) clearInterval(gameState.gameInterval);
    if(gameState.animationFrameId) cancelAnimationFrame(gameState.animationFrameId);
    gameLoop();
}

// Update shared obstacles from server data
function createSharedObstacles(obstacleData) {
    gameState.obstacles = [];
    
    obstacleData.forEach(obsData => {
        const obstacle = new Obstacle(
            obsData.x, 
            obsData.y, 
            obsData.width, 
            obsData.height, 
            obsData.type,
            obsData.radiusX || 0,
            obsData.radiusY || 0
        );
        
        if (obsData.health !== undefined) {
            obstacle.health = obsData.health;
            obstacle.maxHealth = obsData.maxHealth || obsData.health;
        }
        
        gameState.obstacles.push(obstacle);
    });
}

// --- PAUSE MENU LOGIC ---
const pauseMenu = document.getElementById('pause-menu');
const pauseContinueBtn = document.getElementById('pause-continue-btn');
const pauseExitBtn = document.getElementById('pause-exit-btn');
let isPaused = false;

function showPauseMenu() {
    isPaused = true;
    if (pauseMenu) pauseMenu.style.display = 'flex';
}

function hidePauseMenu() {
    isPaused = false;
    if (pauseMenu) pauseMenu.style.display = 'none';
}

// Pause/resume event listeners
if (pauseContinueBtn) pauseContinueBtn.onclick = () => {
    hidePauseMenu();
    if (!gameState.roundOver && gameState.currentScreen === 'game') {
        requestAnimationFrame(gameLoop);
    }
};
if (pauseExitBtn) pauseExitBtn.onclick = () => {
    returnToMainMenu();
};

window.addEventListener('keydown', (e) => {
    if (gameState.currentScreen === 'game' && e.key.toLowerCase() === 'p' && !gameState.roundOver) {
        if (!isPaused) {
            showPauseMenu();
        } else {
            hidePauseMenu();
            requestAnimationFrame(gameLoop);
        }
    }
});
// --- Load bullet image ---
// Add to loadAssets
// (add after loading tank/char images)
// --- ELIMINATION NOTIFICATION ---
function showEliminationNotification(charKey, teamLeaderKey) {
    const notif = document.getElementById('elimination-notification');
    const img = document.getElementById('elim-char-img');
    const nameDiv = document.getElementById('elim-char-name');
    const teamDiv = document.getElementById('elim-team-leader');
    if (!notif || !img || !nameDiv || !teamDiv) return;
    const char = CHARACTERS[charKey];
    img.src = gameState.charImages[charKey]?.src || '';
    nameDiv.textContent = char?.name || '';
    // Team leader name
    let leaderName = '';
    if (teamLeaderKey && CHARACTERS[teamLeaderKey]) leaderName = CHARACTERS[teamLeaderKey].name;
    teamDiv.textContent = leaderName;
    // Slide in
    notif.style.right = '30px';
    // Hide after 2s
    clearTimeout(notif._elimTimeout);
    notif._elimTimeout = setTimeout(() => {
        notif.style.right = '-400px';
    }, 2000);
}
// --- DOM ELEMENT SELECTION ---
const screens = {
    loadingScreen: document.getElementById('loading-screen'),
    mainMenu: document.getElementById('main-menu'),
    tutorial: document.getElementById('tutorial-screen'),
    modeSelection: document.getElementById('mode-selection'),
    characterSelection: document.getElementById('character-selection'),
    mapSelection: document.getElementById('map-selection'),
    tankSelection: document.getElementById('tank-selection'),
    multiplayerNameEntry: document.getElementById('multiplayer-name-entry'),
    multiplayerModeSelection: document.getElementById('multiplayer-mode-selection'),
    multiplayerLobby: document.getElementById('multiplayer-lobby'),
    game: document.getElementById('game-container'),
    endScreen: document.getElementById('end-screen')
};

const buttons = {
    start: document.getElementById('start-btn'),
    multiplayer: document.getElementById('multiplayer-btn'),
    tutorial: document.getElementById('tutorial-btn'),
    backToMenu: document.querySelectorAll('.back-to-menu')
};

const characterCards = document.querySelectorAll('.character-card');
const tankCards = document.querySelectorAll('.tank-card');
const mapCards = document.querySelectorAll('.map-card');
const modeButtons = document.querySelectorAll('#mode-selection button[data-mode]');
const endMessage = document.getElementById('end-message');
const roundMessage = document.getElementById('round-message');
const hudTimer = document.getElementById('round-timer');
// --- MAPA 2: Oilrig objekty ---
let oilrigImage = null;

// HUD elements for team names and character images
const playerTeamNameDisplay = document.getElementById('player-team-name'); // NOVINKA
const enemyTeamNameDisplay = document.getElementById('enemy-team-name');   // NOVINKA
const playerCharImg = document.getElementById('player-char-img');         // NOVINKA
const enemyCharImg = document.getElementById('enemy-char-img');           // NOVINKA


// HUD elements for tank counts
const alliesAliveDisplay = document.getElementById('allies-alive'); // This will be renamed
const enemiesAliveDisplay = document.getElementById('enemies-alive'); // This will be renamed
// New: Coin display elements
const playerCoinsDisplay = document.getElementById('player-coins');


const appContainer = document.getElementById('app-container');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Minimap elements
let minimapCanvas = null; // Will be created dynamically
let minimapCtx = null;

// --- GAME SETTINGS ---
const BASE_HUD_HEIGHT = 80;
const MINIMAP_SIZE = 180; // Size of the square minimap
const MINIMAP_MARGIN = 10; // Margin from top-left

const ROUNDS_TO_WIN = 3;
const TANK_HEALTH_MULTIPLIER = 5;

// Define game modes - Adjusted arena multipliers for larger maps
const GAME_MODES = {
    '1v1': {
        playerCount: 1,
        allyCount: 0,
        enemyCount: 1,
        arenaWidthMultiplier: 2.5, // Increased
        arenaHeightMultiplier: 2.5, // Increased
        obstacleDensity: 1.5,
        cameraZoom: 1
    },
    '6v6': {
        playerCount: 1,
        allyCount: 5,
        enemyCount: 6,
        arenaWidthMultiplier: 4, // Increased
        arenaHeightMultiplier: 4, // Increased
        obstacleDensity: 2,
        cameraZoom: 1
    },
    '12v12': {
        playerCount: 1,
        allyCount: 11,
        enemyCount: 12,
        arenaWidthMultiplier: 5,
        arenaHeightMultiplier: 5,
        obstacleDensity: 2.5,
        cameraZoom: 1
    },
    '20v20': {
        playerCount: 1,
        allyCount: 19,
        enemyCount: 20,
        arenaWidthMultiplier: 6,
        arenaHeightMultiplier: 6,
        obstacleDensity: 3,
        cameraZoom: 1
    }
};

// --- TANK DEFINITIONS (Rebalanced and with image paths) ---
const TANK_SPECS = {
    purple: { // Obrnený Bojovník (Armored Warrior) - Balanced, durable
        color: '#9b59b6', baseHealth: 120, armor: 60, speed: 1, damage: 70, cooldown: 400,
        tankImage: 'tank1.png', canonImage: 'canon1.png'
    },
    orange: { // Rýchly Útočník (Fast Attacker) - Low health, high speed, high burst
        color: '#e67e22', baseHealth: 90, armor: 90, speed: 1.5, damage: 30, cooldown: 150,
        tankImage: 'tank2.png', canonImage: 'canon2.png'
    },
    brown: { // Ťažký Moloch (Heavy Juggernaut) - High health, high damage, low speed
        color: '#8d6e63', baseHealth: 250, armor: 40, speed: 0.7, damage: 150, cooldown: 1000,
        tankImage: 'tank3.png', canonImage: 'canon3.png'
    }
};

// Apply health multiplier
for (const type in TANK_SPECS) {
    TANK_SPECS[type].health = TANK_SPECS[type].baseHealth * TANK_HEALTH_MULTIPLIER;
}

// --- NOVINKA: CHARAKTERY ---
const CHARACTERS = {
    jaccelini: { name: 'M. Jaklović', country: 'Juhoslávia', image: 'ja.png', flag: 'YUG.png' },
    tvaruzhkyn: { name: 'J. Tvaruzhkyn', country: 'Rusko', image: 'tvaruzek.jpg', flag: 'RUS.png' },
    kindergarden: { name: 'J. W. Gardens', country: 'USA', image: 'zahry.jpg', flag: 'USA.png' },
    landmann: { name: 'Herr Landmann', country: 'Nemecko', image: 'zeman.jpg', flag: 'GER.png' },
    matthews: { name: 'A. Matthews', country: 'Spojené Kráľovstvo', image: 'Matous.jpg', flag: 'GBR.png' },
    Hrebekushi: { name: 'P. Hrebekushi', country: 'Japonsko', image: 'hrebenar.jpg', flag: 'JAP.png' },
    volenec: { name: 'J. Violencini', country: 'Taliansko', image: 'Volenec.JPG', flag: 'ITA.png' },
    vacu: { name: 'J. Ben Vakul', country: 'Izrael', image: 'vacu.png', flag: 'ISR.png' },
    ted: { name: 'T. J. Millner', country: 'Južná Afrika', image: 'ted.jpg', flag: 'RSA.png' },
    svidek: { name: 'J. Svidze', country: 'Gruzínsko', image: 'svidek.JPG', flag: 'GEO.png' },
    simek: { name: 'T. Šimek', country: 'Česko', image: 'simek.PNG', flag: 'CZE.png' },
    rumpik: { name: 'D. Rampeeq', country: 'Pakistan', image: 'rumpik.PNG', flag: 'PAK.png' },
    pilar: { name: 'V. Tamil Pilai', country: 'India', image: 'pilar.PNG', flag: 'IND.png' },
    parusev: { name: 'J. Parushiev', country: 'Bulharsko', image: 'parusev.JPG', flag: 'BUL.png' },
    miki: { name: 'M. Rasgueau', country: 'Francúzsko', image: 'miki.PNG', flag: 'FRA.png' },
    mikes: { name: 'J. M. Cash', country: 'Kanada', image: 'mikes.PNG', flag: 'CAN.png' },
    jirka: { name: 'J. H. Hisca', country: 'Kuba', image: 'jirka.JPG', flag: 'CUB.png' },
    kocvara: { name: 'A. Kochvarsson', country: 'Švédsko', image: 'kocvara.JPG', flag: 'SWE.png' },
    hajek: { name: 'P. Hajdukó', country: 'Maďarsko', image: 'hajek.JPG', flag: 'HUN.png' },
    bonko: { name: 'M. Bon-kong', country: 'Čína', image: 'bonko.JPG', flag: 'PRC.png' },
    ben: { name: 'B. H. Horácio', country: 'Brazília', image: 'Ben.JPG', flag: 'BRA.png' },
    romancov: { name: 'A. P. Ramezanov', country: 'Irán', image: 'romancov.JPG', flag: 'IRN.png' },
    huth: { name: 'O. Hutkowski', country: 'Poľsko', image: 'huth.JPG', flag: 'POL.png' },
    belak: { name: 'F. Bella', country: 'Slovensko', image: 'belak.PNG', flag: 'SVK.png' },
    franko: { name: 'Gen. L. Franco', country: 'Španielsko', image: 'franko.JPG', flag: 'ESP.png' },
    fiedler: { name: 'F. Hiedler', country: 'Švajčiarsko', image: 'fiedler.JPG', flag: 'SUI.png' },
    gaidussen: { name: 'M. Gaidussen', country: 'Nórsko', image: 'gajdos.png', flag: 'NOR.png' },
    gazhi: { name: 'M. Al Gazhí', country: 'Lýbie', image: 'gazo.png', flag: 'LIB.png' },
    katzenstein: { name: 'F. Katzenstein', country: 'Rakúsko', image: 'kocur.png', flag: 'RAK.png' },
    kohenen: { name: 'M. Kohenen', country: 'Fínsko', image: 'kohel.jpg', flag: 'FIN.png' },
    gnatt: { name: 'J. Gnatt', country: 'Austrália', image: 'komar.jpg', flag: 'AUS.png' },
    christensen: { name: 'P. Christensen', country: 'Dánsko', image: 'kristian.jpg', flag: 'DEN.png' },
    alkunzi: { name: 'M. al-Kunzí', country: 'Saudská Arábia', image: 'kunc.jpg', flag: 'KSA.png' },
    khajoo: { name: 'N. Kha-Joo', country: 'Severná Kórea', image: 'novotnyk.jpg', flag: 'NKO.png' },
    thneethom: { name: 'N. W. Thnee-Thom', country: 'Južná Kórea', image: 'novotnyt.png', flag: 'SKO.png' },
    smakhal: { name: 'F. Smakhal', country: 'Turecko', image: 'slipy.png', flag: 'TUR.png' },
    sortuda: { name: 'M. Sortuda', country: 'Portugalsko', image: 'stastna.jpg', flag: 'POR.png' },
    strakadopoulos: { name: 'M. Strakadopoulos', country: 'Grécko', image: 'straka.jpg', flag: 'GRE.png' },
    tumufjik: { name: 'M. Tūmūfjīk', country: 'Egypt', image: 'tomovcik.png', flag: 'EGY.png' },
    womboclaat: { name: 'P. Womboclaat', country: 'Jamajka', image: 'vopat.jpg', flag: 'JAM.jpg' },
    votrubovskij: { name: 'J. Votrubovskij', country: 'Bielorusko', image: 'votruba.png', flag: 'BLR.png' }
};


// --- GAME STATE ---
let gameState = {
    currentScreen: 'loading', // Default screen is now 'loading'
    player: null,
    allies: [],
    enemies: [],
    bullets: [],
    obstacles: [],
    tracks: [],
    particles: [], // For explosions
    shotEffects: [], // For muzzle flashes
    hitEffects: [], // For hit sparks
    chasingSquares: [], // For iglu defense squares
    keys: {},
    playerScore: 0,
    enemyScore: 0,
    playerCoins: 0, // New: Player coins
    gameInterval: null,
    animationFrameId: null,
    roundOver: false,
    currentMode: null,
    arenaWidth: 0,
    arenaHeight: 0,
    cameraX: 0,
    cameraY: 0,
    cameraZoom: 1, // Always 1, camera will follow player on large map
    grassTexture: null,
    mudTexture: null,
    treeTexture: null,
    rockTexture: null, // New: Rock texture
    coinTexture: null, // New: Coin texture
    tankImages: {},
    canonImages: {},
    charImages: {}, // NOVINKA: Načítané obrázky postáv
    teamIndicatorPulse: 0,
    isSpectating: false, // New: Flag for spectator mode
    spectatorSpeed: 5, // New: Speed for camera movement in spectator mode
    selectedPlayerChar: null, // NOVINKA: Vybraná postava hráča
    selectedEnemyChar: null,  // NOVINKA: Náhodne vybraná postava nepriateľa
    lastAiPositionCheck: Date.now(), // NOVINKA: Čas pre kontrolu zaseknutia AI
    selectedBulletType: 1 // 1 = normal, 2 = special
};

// Bullet selection UI
const bulletSelectionUI = document.getElementById('bullet-selection-ui');
const bulletOptions = bulletSelectionUI ? bulletSelectionUI.querySelectorAll('.bullet-option') : [];

// --- IMAGE LOADING ---
const images = {};
function loadImage(name, src) {
    return new Promise((resolve, reject) => {
        if (images[name]) {
            resolve(images[name]);
            return;
        }
        const img = new Image();
        img.onload = () => {
            images[name] = img;
            resolve(img);
        };
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

function assignLoadedAssets() {
    // Assign loaded images to game state
    gameState.grassTexture = images['grass_texture'];
    gameState.mudTexture = images['mud_texture'];
    gameState.treeTexture = images['tree_texture'];
    gameState.rockTexture = images['rock_texture'];
    gameState.coinTexture = images['coin_icon'];
    gameState.dessertTexture = images['dessert_texture'];
    gameState.iceTexture = images['ice_texture'];
    gameState.igluImage = images['iglu'];
    
    // Set background images
    document.getElementById('main-menu').style.backgroundImage = `url(${images['menu_background'].src})`;
    document.getElementById('character-selection').style.backgroundImage = `url(${images['menu_background'].src})`;

    // Assign tank images
    for (const type in TANK_SPECS) {
        gameState.tankImages[type] = images[`tank_${type}`];
        gameState.canonImages[type] = images[`canon_${type}`];
    }

    // Assign character images
    for (const charKey in CHARACTERS) {
        gameState.charImages[charKey] = images[`char_${charKey}`];
    }
}

const loadAssets = async () => {
    try {
        // This function is now just a legacy wrapper
        // The actual loading is done by loadGameWithProgress()
        console.log('Assets loaded successfully!');
    } catch (error) {
        console.error('Failed to load assets:', error);
        alert('Chyba pri načítaní herných súborov! Skontrolujte konzolu pre detaily.');
    }
};


// --- CLASSES (Game Objects) ---
class Tank {
    constructor(x, y, type, isPlayer = false, isAlly = false, characterKey = null) {
        const spec = TANK_SPECS[type];
        
        // Debug log for spawn positions
        if (isPlayer) {
            console.log(`🔧 Creating PLAYER tank at:`, { x, y, type, characterKey });
        } else {
            console.log(`🔧 Creating OPPONENT tank at:`, { x, y, type, characterKey });
        }
        
        this.x = x;
        this.y = y;
        this.width = 50;
        this.height = 40;
        this.color = spec.color;
        this.maxHealth = spec.health;
        this.health = spec.health;
        this.armor = spec.armor;
        this.baseSpeed = spec.speed;
        this.speed = spec.speed;
        this.damage = spec.damage;
        this.cooldown = spec.cooldown;
        this.lastShotTime = 0;
        this.angle = isPlayer ? -Math.PI / 2 : Math.PI / 2; // Initial angle (up/down)
        this.turretAngleOffset = 0; // Relative angle offset for the turret
        this.turretAbsoluteAngle = this.angle + this.turretAngleOffset; // Absolute angle for drawing/shooting
        this.isPlayer = isPlayer;
        this.isAlly = isAlly;
        this.type = type;
        // Directly assign loaded images
        this.tankImage = gameState.tankImages[type];
        this.canonImage = gameState.canonImages[type];

        this.canonWidth = 60;
        this.canonHeight = 15;

        this.lastTrackX = x;
        this.lastTrackY = y;
        this.turnSpeed = 0.04; // How fast the tank body turns
        this.turretTurnSpeed = 0.05; // How fast the turret turns manually
        this.aiState = 'moving'; // 'moving', 'shooting', 'evading'
        this.aiTarget = null;
        this.aiPath = []; // For simple pathfinding
        this.aiWaypoint = null;
        this.obstacleAvoidanceAngle = 0;
        this.aiLastActionTime = Date.now();
        this.aggression = Math.random(); // 0-1, affects AI behavior

        // NOVINKA: Pre zaseknutie AI - vylepšené
        this.positionHistory = [];
        this.stuckStartTime = null;
        this.isStuck = false;
        
        // Unstuck maneuver properties
        this.unstuckStartTime = null;
        this.unstuckDirection = 0;
        this.unstuckPhase = null; // 'reverse', 'turn'
        
        // Waypoint navigation system
        this.currentWaypoint = null; // Current target waypoint {x, y}
        this.waypointQueue = []; // Queue of waypoints to visit in order
        this.waypointRadius = 50; // How close tank needs to be to consider waypoint reached
        this.waypointTimeout = 10000; // Max time (ms) to spend trying to reach a waypoint
        this.waypointStartTime = null; // When tank started moving to current waypoint
        this.finalTarget = null; // The ultimate target (enemy tank)
        this.waypointGenerationCooldown = 0; // Prevent spam generation of waypoints
        
        // Multi-waypoint system enhancements
        this.maxWaypointsInQueue = 3; // Maximum waypoints to keep in queue
        this.waypointPlanningRange = 300; // How far ahead to plan waypoints
        this.lastWaypointReplanTime = 0; // When we last replanned the entire path
        this.waypointReplanInterval = 5000; // Replan entire path every 5 seconds if stuck
        this.progressiveWaypointCooldown = 0; // Cooldown for progressive waypoint generation
        this.waypointReplanCount = 0; // Track how many times we've replanned recently (for dynamic path re-evaluation)

        // --- CHARACTER ASSIGNMENT ---
        this.characterKey = characterKey;
        this.character = characterKey ? CHARACTERS[characterKey] : null;

        // ICE PHYSICS: velocity and angular velocity for sliding
        this.velX = 0;
        this.velY = 0;
        this.velAngle = 0;
    }

    draw(targetCtx = ctx) {
        // Draw tank body
        if (this.tankImage && this.tankImage.complete && this.tankImage.naturalWidth !== 0) {
            targetCtx.save();
            targetCtx.translate(this.x + this.width / 2, this.y + this.height / 2);
            targetCtx.rotate(this.angle);
            targetCtx.drawImage(this.tankImage, -this.width / 2, -this.height / 2, this.width, this.height);
            targetCtx.restore();
        } else {
            // Fallback to drawing a colored rectangle if image fails to load
            targetCtx.save();
            targetCtx.translate(this.x + this.width / 2, this.y + this.height / 2);
            targetCtx.rotate(this.angle);
            targetCtx.fillStyle = this.color;
            targetCtx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
            targetCtx.strokeStyle = 'black';
            targetCtx.lineWidth = 2;
            targetCtx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);
            targetCtx.restore();
        }

        // Draw cannon
        if (this.canonImage && this.canonImage.complete && this.canonImage.naturalWidth !== 0) {
            targetCtx.save();
            targetCtx.translate(this.x + this.width / 2, this.y + this.height / 2);
            targetCtx.rotate(this.turretAbsoluteAngle); // Use absolute angle for drawing
            // Canon image should be drawn from its "pivot" point (base of the canon)
            targetCtx.drawImage(this.canonImage, 0, -this.canonHeight / 2, this.canonWidth, this.canonHeight);
            targetCtx.restore();
        } else {
            // Fallback to drawing a simple cannon if image fails to load
            targetCtx.save();
            targetCtx.translate(this.x + this.width / 2, this.y + this.height / 2);
            targetCtx.rotate(this.turretAbsoluteAngle);
            targetCtx.fillStyle = '#555';
            targetCtx.fillRect(10, -3, 35, 6);
            targetCtx.restore();
        }

        // Draw pulsating team indicator (only for main game, not preview)
        if (targetCtx === ctx) {
            // Draw individual health bar
            const barWidth = this.width * 1.2; // A bit wider than the tank
            const barHeight = 7;
            const barYOffset = -this.height / 2 - 15; // Position above tank
            const currentHealthWidth = (this.health / this.maxHealth) * barWidth;

            ctx.save();
            ctx.translate(this.x + this.width / 2, this.y + this.height / 2);

            // Background of health bar
            ctx.fillStyle = '#555';
            ctx.fillRect(-barWidth / 2, barYOffset, barWidth, barHeight);

            // Actual health
            ctx.fillStyle = this.isAlly || this.isPlayer ? '#2ecc71' : '#e74c3c';
            ctx.fillRect(-barWidth / 2, barYOffset, currentHealthWidth, barHeight);

            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.strokeRect(-barWidth / 2, barYOffset, barWidth, barHeight);

            ctx.restore();

            // --- Draw flag and surname above tank (ALWAYS show flag if file exists) ---
            if (this.character && this.character.flag) {
                // Try to use the same flag path as in the character selection menu (direct file path)
                let flagImg = null;
                // Create a temporary image to test if the file exists and is loadable
                if (!this._flagImg) {
                    this._flagImg = new window.Image();
                    this._flagImg.src = this.character.flag;
                }
                flagImg = this._flagImg;
                if (flagImg && flagImg.complete && flagImg.naturalWidth !== 0) {
                    const flagX = this.x + this.width / 2;
                    const flagY = this.y - this.height / 2 - 38;
                    ctx.drawImage(flagImg, flagX - 14, flagY, 28, 18);
                } else {
                    // Draw a placeholder rectangle if flag not found
                    const flagX = this.x + this.width / 2;
                    const flagY = this.y - this.height / 2 - 38;
                    ctx.save();
                    ctx.fillStyle = '#888';
                    ctx.fillRect(flagX - 14, flagY, 28, 18);
                    ctx.restore();
                }
                // Draw surname below the flag
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.font = 'bold 16px Arial';
                ctx.fillStyle = '#fff';
                ctx.strokeStyle = '#222';
                ctx.lineWidth = 3;
                const surname = this.character.name ? this.character.name.split(' ').slice(-1)[0] : '';
                ctx.translate(this.x + this.width / 2, this.y - this.height / 2 - 10);
                ctx.strokeText(surname, 0, 0);
                ctx.fillText(surname, 0, 0);
                ctx.restore();
            }
        }
    }

    move() {
        this.speed = this.baseSpeed;
        const isIce = gameState.selectedMap === '3';
        // Apply speed modifiers based on terrain
        gameState.obstacles.forEach(obs => {
            const obsBounds = obs.getCollisionBounds();
            if (obsBounds && checkCollision(this, obsBounds)) {
                if (obs.type === 'swamp') {
                    this.speed *= 0.5;
                }
            }
        });

        const prevX = this.x;
        const prevY = this.y;
        const prevAngle = this.angle;

        if (isIce) {
            // --- ICE PHYSICS ---
            // Add acceleration based on input, but movement is by velocity
            const accel = this.speed * 0.18; // acceleration factor (tweak for feel)
            const maxVel = this.speed * 2.2; // max velocity (tweak for feel)
            const friction = 0.90; // less sliding (was 0.97)
            const turnFriction = 0.85; // less sliding for turning (was 0.93)
            // Forward/backward
            if (this.isPlayer) {
                if (gameState.keys['w']) {
                    this.velX += Math.cos(this.angle) * accel;
                    this.velY += Math.sin(this.angle) * accel;
                }
                if (gameState.keys['s']) {
                    this.velX -= Math.cos(this.angle) * accel * 0.7;
                    this.velY -= Math.sin(this.angle) * accel * 0.7;
                }
                // Turning (add angular velocity)
                if (gameState.keys['a']) {
                    this.velAngle -= this.turnSpeed * 0.7;
                }
                if (gameState.keys['d']) {
                    this.velAngle += this.turnSpeed * 0.7;
                }
                // Adjust turret relative angle
                if (gameState.keys['arrowleft']) { this.turretAngleOffset -= this.turretTurnSpeed; }
                if (gameState.keys['arrowright']) { this.turretAngleOffset += this.turretTurnSpeed; }
                this.turretAbsoluteAngle = this.angle + this.turretAngleOffset;
            }
            // Clamp velocity
            const velMag = Math.sqrt(this.velX * this.velX + this.velY * this.velY);
            if (velMag > maxVel) {
                this.velX *= maxVel / velMag;
                this.velY *= maxVel / velMag;
            }
            // Apply velocity
            this.x += this.velX;
            this.y += this.velY;
            this.angle += this.velAngle;
            // Friction
            this.velX *= friction;
            this.velY *= friction;
            this.velAngle *= turnFriction;
        } else {
            // --- NORMAL PHYSICS ---
            const moveX = Math.cos(this.angle) * this.speed * 2;
            const moveY = Math.sin(this.angle) * this.speed * 2;
            if (this.isPlayer) {
                let moved = false;
                if (gameState.keys['w']) { this.y += moveY; this.x += moveX; moved = true; }
                if (gameState.keys['s']) { this.y -= moveY; this.x -= moveX; moved = true; }
                if (gameState.keys['a']) { this.angle -= this.turnSpeed; moved = true; }
                if (gameState.keys['d']) { this.angle += this.turnSpeed; moved = true; }
                if (gameState.keys['arrowleft']) { this.turretAngleOffset -= this.turretTurnSpeed; }
                if (gameState.keys['arrowright']) { this.turretAngleOffset += this.turretTurnSpeed; }
                this.turretAbsoluteAngle = this.angle + this.turretAngleOffset;
            }
        }

        this.checkBoundsAndCollisions(prevX, prevY);

        // Add tank tracks - reduced frequency in multiplayer for performance
        const distanceMoved = Math.sqrt(Math.pow(this.x - this.lastTrackX, 2) + Math.pow(this.y - this.lastTrackY, 2));
        const trackThreshold = isMultiplayer ? 25 : 15; // Increase threshold in multiplayer
        if (distanceMoved > trackThreshold) {
            gameState.tracks.push(new Track(this.x + this.width / 2, this.y + this.height / 2, this.angle, Date.now()));
            this.lastTrackX = this.x;
            this.lastTrackY = this.y;
        }
    }

    checkBoundsAndCollisions(prevX, prevY) {
        let collided = false;
        // Prevent moving off arena bounds
        if (this.x < 0) { this.x = 0; collided = true; }
        if (this.x + this.width > gameState.arenaWidth) { this.x = gameState.arenaWidth - this.width; collided = true; }
        if (this.y < 0) { this.y = 0; collided = true; }
        if (this.y + this.height > gameState.arenaHeight) { this.y = gameState.arenaHeight - this.height; collided = true; }

        // Obstacle collisions
        gameState.obstacles.forEach(obs => {
            const obsBounds = obs.getCollisionBounds && obs.getCollisionBounds(); // Get the actual collision bounds (could be rect or bounding box of circle)
            if (!obsBounds) return; // Skip if no valid bounds

            // Oilrig, rock, tree, iglu: block movement
            if (((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0))) {
                if (checkCollision(this, obsBounds)) {
                    this.x = prevX;
                    this.y = prevY;
                    collided = true;
                }
            }
            // If it's a swamp, it only slows down, no collision prevention
        });

        // Tank-on-tank collision
        const allTanks = [gameState.player, ...gameState.allies, ...gameState.enemies].filter(t => t !== this && t !== null && t.health > 0);
        allTanks.forEach(otherTank => {
            if (checkCollision(this, otherTank)) {
                this.x = prevX;
                this.y = prevY;
                collided = true;
            }
        });

        return collided; // Return true if any collision occurred
    }

    shoot() {
        const now = Date.now();
        if (now - this.lastShotTime > this.cooldown) {
            this.lastShotTime = now;
            // Use turretAbsoluteAngle for bullet direction
            const bulletX = this.x + this.width / 2 + Math.cos(this.turretAbsoluteAngle) * (this.canonWidth - 5);
            const bulletY = this.y + this.width / 2 + Math.sin(this.turretAbsoluteAngle) * (this.canonWidth - 5);

            // Bullet type selection logic
            let bulletType = gameState.selectedBulletType || 1;
            if (this.isPlayer) {
                if (bulletType === 2) {
                    if (gameState.playerCoins >= 30) {
                        gameState.playerCoins -= 30;
                        bulletManager.createBullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage * 2, this, 2);
                    } else {
                        // Not enough coins, fallback to normal bullet
                        bulletManager.createBullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage, this, 1);
                        bulletType = 1; // Update bulletType for multiplayer sync
                    }
                } else {
                    bulletManager.createBullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage, this, 1);
                }
                
                // Send shooting event to other players (multiplayer)
                if (isMultiplayer && socket) {
                    socket.emit('player-shoot', {
                        x: bulletX,
                        y: bulletY,
                        angle: this.turretAbsoluteAngle,
                        bulletType: bulletType
                    });
                }
            } else {
                // AI always uses normal bullet (but skip for multiplayer opponents)
                if (!this.isMultiplayerOpponent) {
                    bulletManager.createBullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage, this, 1);
                }
            }

            // Add muzzle flash effect
            gameState.shotEffects.push(new ShotEffect(bulletX, bulletY, this.turretAbsoluteAngle));

            // Play canon shot sound only if tank is visible (in viewport or player)
            if (typeof document !== 'undefined' && typeof gameState !== 'undefined' && typeof canvas !== 'undefined') {
                let shouldPlay = false;
                if (this.isPlayer) {
                    shouldPlay = true;
                } else {
                    // Check if tank is within visible viewport (with margin)
                    const margin = 80; // px, allow a bit offscreen
                    const tankCenterX = this.x + this.width / 2;
                    const tankCenterY = this.y + this.height / 2;
                    const camX = gameState.cameraX;
                    const camY = gameState.cameraY;
                    const viewW = canvas.width;
                    const viewH = canvas.height;
                    if (
                        tankCenterX > camX - margin &&
                        tankCenterX < camX + viewW + margin &&
                        tankCenterY > camY - margin &&
                        tankCenterY < camY + viewH + margin
                    ) {
                        shouldPlay = true;
                    }
                }
                if (shouldPlay) {
                    try {
                        const src = 'canonshot.mp3';
                        const audio = new Audio(src);
                        audio.preload = 'auto';
                        audio.volume = this.isPlayer ? 0.7 : 0.35;
                        audio.currentTime = 0;
                        audio.play();
                    } catch (e) {}
                }
            }
        }
    }

    takeDamage(incomingDamage, attacker) { // Added attacker parameter
        const damageReduction = Math.min(this.armor / 100, 0.8);
        const actualDamage = incomingDamage * (1 - damageReduction);
        this.health -= actualDamage;
        // Add hit effect at tank's center
        gameState.hitEffects.push(new HitEffect(this.x + this.width / 2, this.y + this.height / 2));

        // Send damage event to other players (multiplayer) - only if this tank is controlled by current player
        if (isMultiplayer && socket && this.playerId && this.playerId === socket.id) {
            socket.emit('player-damage', {
                playerId: this.playerId,
                damage: actualDamage,
                newHealth: this.health
            });
        }

        // Play hit sound effect (always for player getting hit, always for player hitting anyone else)
        if (typeof document !== 'undefined') {
            try {
                if (this.isPlayer && attacker && attacker !== this) {
                    // Player got hit (by anyone, any team)
                    const audio = new Audio('hitme.mp3');
                    audio.preload = 'auto';
                    audio.volume = 0.7;
                    audio.currentTime = 0;
                    audio.play();
                }
                if (attacker === gameState.player && !this.isPlayer) {
                    // Player hit anyone (enemy or ally, not self)
                    const audio = new Audio('hithim.mp3');
                    audio.preload = 'auto';
                    audio.volume = 0.7;
                    audio.currentTime = 0;
                    audio.play();
                }
            } catch (e) {}
        }

        // Only add coins if the attacker is the player and the target is an enemy tank
        if (attacker === gameState.player && !this.isPlayer && !this.isAlly) {
            addCoins(1); // 1 coin for every hit on an enemy tank by player
        }

        if (this.health <= 0) {
            this.health = 0;
            
            // Send death event to other players (multiplayer) - only if this tank is controlled by current player  
            if (isMultiplayer && socket && this.playerId && this.playerId === socket.id) {
                socket.emit('player-death', {
                    playerId: this.playerId
                });
            }
            
            this.explode();
            // Only add coins for destroying an enemy tank
            if (attacker === gameState.player && !this.isPlayer && !this.isAlly) {
                addCoins(30); // 30 coins for destroying an enemy tank
            }

            // --- Elimination notification ---
            let teamLeaderKey = null;
            if (this.isPlayer || this.isAlly) {
                // Player team: leader is player
                teamLeaderKey = gameState.player?.characterKey;
            } else {
                // Enemy team: leader is first enemy
                teamLeaderKey = gameState.enemies.length > 0 ? gameState.enemies[0].characterKey : null;
            }
            showEliminationNotification(this.characterKey, teamLeaderKey);

            // --- New: Player tank death logic ---
            if (this.isPlayer) {
                console.log("Player tank destroyed!");
                gameState.isSpectating = true; // Enter spectator mode
                roundMessage.innerText = "Tvoj tank bol zničený! Sleduješ hru...";
                roundMessage.style.display = 'block';
                // Set the camera to the player's last position before setting player to null
                gameState.cameraX = this.x + this.width / 2 - canvas.width / 2;
                gameState.cameraY = this.y + this.height / 2 - canvas.height / 2;
                gameState.player = null; // Important: remove the player tank itself
            }
        }
    }

    explode() {
        // Reduce particles in multiplayer for better performance
        const numParticles = isMultiplayer ? Math.floor(30 * EFFECTS_REDUCTION_FACTOR) : 30;
        const explosionColor = this.color; // Match tank color
        for (let i = 0; i < numParticles; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 5 + 2; // Random speed
            const size = Math.random() * 5 + 2; // Random size
            const life = Math.random() * 50 + 30; // Random lifespan (frames)
            particleManager.createParticle(
                this.x + this.width / 2,
                this.y + this.height / 2,
                angle,
                speed,
                size,
                explosionColor,
                life
            );
        }
        // Play explosion sound
        if (typeof document !== 'undefined') {
            try {
                const audio = new Audio('explosion.mp3');
                audio.preload = 'auto';
                audio.volume = 0.7;
                audio.currentTime = 0;
                audio.play();
            } catch (e) {}
        }
    }
}

class Bullet {

    constructor(x = 0, y = 0, angle = 0, damage = 10, owner = null, bulletType = 1) {
        this.x = x;
        this.y = y;
        this.radius = 5;
        this.speed = 10;
        this.angle = angle;
        this.damage = damage;
        this.owner = owner;
        this.bulletType = bulletType;
        this.isActive = true; // For pooling
    }

    // Factory function for object pooling
    static create() {
        return new Bullet();
    }

    // Reset method for when bullet is acquired from pool
    reset(x, y, angle, damage, owner, bulletType = 1) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.damage = damage;
        this.owner = owner;
        this.bulletType = bulletType;
        this.isActive = true;
        this.radius = 5;
        this.speed = 10;
        return this;
    }

    // Release method for returning to pool
    release() {
        this.isActive = false;
        this.owner = null;
        return this;
    }

    draw() {
        // Draw bullet image if loaded, else fallback to yellow circle
        let bulletImg = images['bullet'];
        let w = 40, h = 16;
        if (this.bulletType === 2) {
            bulletImg = images['bullet2'];
            w = 44; h = 18;
        } else if (this.bulletType === 3) {
            // Eskimo snowball
            bulletImg = images['snowball'];
            w = 32; h = 32;
        }
        if (bulletImg && bulletImg.complete && bulletImg.naturalWidth !== 0) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.drawImage(bulletImg, -w/2, -h/2, w, h);
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.bulletType === 3 ? 16 : this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.bulletType === 2 ? '#ff4444' : (this.bulletType === 3 ? '#e0f7fa' : '#ffdd00');
            ctx.fill();
        }
    }

    move() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
    }
}

// --- BULLET POOLING SYSTEM ---
class BulletManager {
    constructor() {
        console.log('🔄 Initializing BulletManager...');
        // Add reset function for proper pooling
        const bulletResetFn = (bullet) => {
            bullet.release(); // Call our custom release
        };
        this.bulletPool = new ObjectPool(Bullet.create, bulletResetFn, 50); // Pre-allocate 50 bullets
        this.activeBullets = [];
        console.log('🎯 BulletManager initialized with pool:', this.bulletPool);
    }

    createBullet(x, y, angle, damage, owner, bulletType = 1) {
        const bullet = this.bulletPool.acquire();
        bullet.reset(x, y, angle, damage, owner, bulletType);
        this.activeBullets.push(bullet);
        return bullet;
    }

    removeBullet(index) {
        if (index >= 0 && index < this.activeBullets.length) {
            const bullet = this.activeBullets[index];
            bullet.release();
            this.bulletPool.release(bullet);
            this.activeBullets.splice(index, 1);
        }
    }

    removeAllBullets() {
        this.activeBullets.forEach(bullet => {
            bullet.release();
            this.bulletPool.release(bullet);
        });
        this.activeBullets = [];
    }

    updateBullets() {
        // Update bullet positions and handle collisions
        for (let i = this.activeBullets.length - 1; i >= 0; i--) {
            const bullet = this.activeBullets[i];
            bullet.move();
            
            // Check boundaries
            if (bullet.x < 0 || bullet.x > gameState.arenaWidth || 
                bullet.y < 0 || bullet.y > gameState.arenaHeight) {
                this.removeBullet(i);
                continue;
            }
        }
        
        // Debug: Log pooling stats occasionally  
        if (Math.random() < 0.01) { // 1% chance per frame
            console.log('🎯 Bullet Pool Stats:', this.getStats());
        }
    }

    drawBullets() {
        this.activeBullets.forEach(bullet => bullet.draw());
    }

    drawBulletsWithCulling(culler) {
        const visibleBullets = culler.filterVisible(this.activeBullets, 'bullets');
        visibleBullets.forEach(bullet => bullet.draw());
    }

    getStats() {
        const poolStats = this.bulletPool.getStats();
        return {
            active: this.activeBullets.length,
            pooled: poolStats.pooled,
            created: poolStats.created,
            reused: poolStats.reused,
            poolSize: poolStats.pooled + poolStats.active
        };
    }
}

// Initialize global bullet manager
const bulletManager = new BulletManager();

class Obstacle {
    constructor(x, y, width, height, type, radiusX = 0, radiusY = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type;
        this.color = type === 'tree' ? '#5D4037' : 'rgba(82, 110, 53, 0.7)';
        this.radiusX = radiusX; // For ellipses/circles (center x,y and then radius)
        this.radiusY = radiusY; // For ellipses/circles
        if (type === 'tree') {
            this.maxHealth = 100;
        } else if (type === 'iglu') {
            this.maxHealth = 300;
        } else if (type === 'rock') {
            this.maxHealth = 200; // Rocks are tough but destructible
        } else if (type === 'oilrig') {
            this.maxHealth = 300; // Same as iglu
        } else if (type === 'swamp') {
            this.maxHealth = 0; // Swamps are indestructible, only slow tanks
        } else {
            this.maxHealth = 0; // Other types remain indestructible by default
        }
        this.health = this.maxHealth;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);

        if (this.type === 'tree') {
            // ...existing code for tree...
            const drawX = -this.radiusX;
            const drawY = -this.radiusY;
            const drawWidth = this.radiusX * 2;
            const drawHeight = this.radiusY * 2;
            if (gameState.treeTexture && gameState.treeTexture.complete && gameState.treeTexture.naturalWidth !== 0) {
                ctx.drawImage(gameState.treeTexture, drawX, drawY, drawWidth, drawHeight);
            } else {
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(0, 0, this.radiusX, 0, Math.PI * 2);
                ctx.fill();
            }
            if (this.health < this.maxHealth && this.health > 0) {
                const barWidth = this.width * 0.8;
                const barHeight = 5;
                const currentHealthWidth = (this.health / this.maxHealth) * barWidth;
                ctx.fillStyle = '#555';
                ctx.fillRect(-barWidth / 2, -this.radiusY - 10, barWidth, barHeight);
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(-barWidth / 2, -this.radiusY - 10, currentHealthWidth, barHeight);
            }
        } else if (this.type === 'swamp') {
            // ...existing code for swamp...
            const drawX = -this.radiusX;
            const drawY = -this.radiusY;
            const drawWidth = this.radiusX * 2;
            const drawHeight = this.radiusY * 2;
            if (gameState.mudTexture && gameState.mudTexture.complete && gameState.mudTexture.naturalWidth !== 0) {
                ctx.drawImage(gameState.mudTexture, drawX, drawY, drawWidth, drawHeight);
            } else {
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.ellipse(0, 0, this.radiusX, this.radiusY, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (this.type === 'rock') {
            // Draw rock with texture or fallback color
            if (gameState.rockTexture && gameState.rockTexture.complete && gameState.rockTexture.naturalWidth !== 0) {
                ctx.drawImage(gameState.rockTexture, -this.width / 2, -this.height / 2, this.width, this.height);
            } else {
                ctx.fillStyle = '#7f8c8d';
                ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
            }
            // Health bar for rocks (now destructible)
            if (this.health < this.maxHealth && this.health > 0) {
                const barWidth = this.width * 0.8;
                const barHeight = 8;
                const currentHealthWidth = (this.health / this.maxHealth) * barWidth;
                ctx.fillStyle = '#555';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, barWidth, barHeight);
                ctx.fillStyle = '#e74c3c'; // Red health bar for rocks
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, currentHealthWidth, barHeight);
            }
        } else if (this.type === 'iglu') {
            // Draw iglu.png for iglu obstacles
            if (gameState.igluImage && gameState.igluImage.complete && gameState.igluImage.naturalWidth !== 0) {
                ctx.drawImage(gameState.igluImage, -this.width / 2, -this.height / 2, this.width, this.height);
            } else {
                ctx.fillStyle = '#bfe6ff';
                ctx.beginPath();
                ctx.ellipse(0, 0, this.width/2, this.height/2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            // Health bar for iglu
            if (this.health < this.maxHealth && this.health > 0) {
                const barWidth = this.width * 0.8;
                const barHeight = 8;
                const currentHealthWidth = (this.health / this.maxHealth) * barWidth;
                ctx.fillStyle = '#555';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, barWidth, barHeight);
                ctx.fillStyle = '#3498db';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, currentHealthWidth, barHeight);
            }
        } else if (this.type === 'oilrig') {
            // Draw oilrig.png for oilrig obstacles
            if (images['oilrig'] && images['oilrig'].complete && images['oilrig'].naturalWidth !== 0) {
                ctx.drawImage(images['oilrig'], -this.width / 2, -this.height / 2, this.width, this.height);
            } else {
                ctx.fillStyle = '#34495e';
                ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
            }
            // Health bar for oilrig
            if (this.health < this.maxHealth && this.health > 0) {
                const barWidth = this.width * 0.8;
                const barHeight = 8;
                const currentHealthWidth = (this.health / this.maxHealth) * barWidth;
                ctx.fillStyle = '#555';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, barWidth, barHeight);
                ctx.fillStyle = '#f39c12'; // Orange health bar for oilrigs
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, currentHealthWidth, barHeight);
            }
        } else {
            ctx.fillStyle = this.color;
            ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        }
        ctx.restore();
    }
    // Update checkCollision to handle circular/elliptical obstacles
    getCollisionBounds() {
        if (this.type === 'tree' || this.type === 'swamp') {
            // For collision, treat circles/ellipses as their bounding box for simplicity with AABB tank collision
            return {
                x: this.x - this.radiusX, // x,y is center for these, convert to top-left
                y: this.y - this.radiusY,
                width: this.radiusX * 2,
                height: this.radiusY * 2
            };
        }
        // For iglu, oilrig, rock: use rectangle bounds
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }

    // Check if object is in the current viewport for performance optimization
    isInViewport() {
        const margin = VIEWPORT_CULLING_MARGIN;
        return this.x + this.width > gameState.cameraX - margin &&
               this.x < gameState.cameraX + canvas.width - margin &&
               this.y + this.height > gameState.cameraY - margin &&
               this.y < gameState.cameraY + canvas.height - margin;
    }

    takeDamage(damage, attacker) { // Added attacker parameter
        if (this.type === 'tree') {
            this.health -= damage;
            // Add hit effect at tree's center
            gameState.hitEffects.push(new HitEffect(this.x, this.y));
            if (this.health <= 0) {
                this.health = 0;
                // Remove tree from obstacles
                gameState.obstacles = gameState.obstacles.filter(obs => obs !== this);
                // Optionally add explosion effect for tree
                const numParticles = isMultiplayer ? Math.floor(15 * EFFECTS_REDUCTION_FACTOR) : 15;
                for (let i = 0; i < numParticles; i++) {
                    particleManager.createParticle(this.x, this.y, Math.random() * Math.PI * 2, Math.random() * 3 + 1, Math.random() * 3 + 1, '#5D4037', 30);
                }
            }
        } else if (this.type === 'rock') {
            this.health -= damage;
            // Add hit effect at rock's center
            gameState.hitEffects.push(new HitEffect(this.x + this.width / 2, this.y + this.height / 2));
            if (this.health <= 0) {
                this.health = 0;
                // Remove rock from obstacles
                gameState.obstacles = gameState.obstacles.filter(obs => obs !== this);
                // Add rock destruction particles (gray/brown) - reduced in multiplayer
                const numParticles = isMultiplayer ? Math.floor(20 * EFFECTS_REDUCTION_FACTOR) : 20;
                for (let i = 0; i < numParticles; i++) {
                    const colors = ['#7f8c8d', '#95a5a6', '#6c7b7d'];
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    particleManager.createParticle(
                        this.x + this.width / 2, 
                        this.y + this.height / 2, 
                        Math.random() * Math.PI * 2, 
                        Math.random() * 4 + 2, 
                        Math.random() * 4 + 2, 
                        color, 
                        35
                    );
                }
            }
        } else if (this.type === 'iglu') {
            this.health -= damage;
            // Add hit effect at iglu's center
            gameState.hitEffects.push(new HitEffect(this.x + this.width / 2, this.y + this.height / 2));
            if (this.health <= 0) {
                this.health = 0;
                // Spawn 5 chasing squares from the RIGHT BOTTOM corner of this iglu, targeting attacker
                if (attacker) {
                    setTimeout(() => spawnChasingSquaresFromIglu(this, attacker), 0);
                }
                // Remove iglu from obstacles
                gameState.obstacles = gameState.obstacles.filter(obs => obs !== this);
            }
        } else if (this.type === 'oilrig') {
            this.health -= damage;
            // Add hit effect at oilrig's center
            gameState.hitEffects.push(new HitEffect(this.x + this.width / 2, this.y + this.height / 2));
            if (this.health <= 0) {
                this.health = 0;
                // Remove oilrig from obstacles
                gameState.obstacles = gameState.obstacles.filter(obs => obs !== this);
                // Add oilrig destruction particles (black/gray for oil) - reduced in multiplayer
                const numParticles = isMultiplayer ? Math.floor(25 * EFFECTS_REDUCTION_FACTOR) : 25;
                for (let i = 0; i < numParticles; i++) {
                    const colors = ['#2c3e50', '#34495e', '#1e272e'];
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    particleManager.createParticle(
                        this.x + this.width / 2, 
                        this.y + this.height / 2, 
                        Math.random() * Math.PI * 2, 
                        Math.random() * 5 + 3, 
                        Math.random() * 5 + 3, 
                        color, 
                        40
                    );
                }
            }
        }
    }
}

class Track {
    constructor(x, y, angle, timestamp) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.width = 20;
        this.height = 5;
        this.offset = 15;
        this.timestamp = timestamp;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Sand color for desert map, else default brown
        let sandColor = '#e2c28b'; // Light sand
        let normalColor = '#6B4F4F'; // Brown
        ctx.fillStyle = (typeof gameState !== 'undefined' && gameState.selectedMap === '2') ? sandColor : normalColor;
        ctx.fillRect(-this.width / 2, -this.offset - this.height / 2, this.width, this.height);
        ctx.fillRect(-this.width / 2, this.offset - this.height / 2, this.width, this.height);
        ctx.restore();
    }
}

class Particle {
    constructor(x = 0, y = 0, angle = 0, speed = 0, size = 1, color = '#fff', life = 30) {
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.size = size;
        this.color = color;
        this.life = life; // lifespan in frames
        this.initialLife = life;
        this.alpha = 1;
        this.isActive = true; // For pooling
    }

    // Factory function for object pooling
    static create() {
        return new Particle();
    }

    // Reset method for when particle is acquired from pool
    reset(x, y, angle, speed, size, color, life) {
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.size = size;
        this.color = color;
        this.life = life;
        this.initialLife = life;
        this.alpha = 1;
        this.isActive = true;
        return this;
    }

    // Release method for returning to pool
    release() {
        this.isActive = false;
        this.life = 0;
        return this;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
        // Reduce size and opacity over time
        this.size *= 0.95;
        this.alpha = this.life / this.initialLife;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// --- PARTICLE POOLING SYSTEM ---
class ParticleManager {
    constructor() {
        console.log('💥 Initializing ParticleManager...');
        const particleResetFn = (particle) => {
            particle.release();
        };
        this.particlePool = new ObjectPool(Particle.create, particleResetFn, 100); // Pre-allocate 100 particles
        this.activeParticles = [];
        console.log('💥 ParticleManager initialized with pool size:', 100);
    }

    createParticle(x, y, angle, speed, size, color, life) {
        const particle = this.particlePool.acquire();
        particle.reset(x, y, angle, speed, size, color, life);
        this.activeParticles.push(particle);
        return particle;
    }

    removeParticle(index) {
        if (index >= 0 && index < this.activeParticles.length) {
            const particle = this.activeParticles[index];
            particle.release();
            this.particlePool.release(particle);
            this.activeParticles.splice(index, 1);
        }
    }

    removeAllParticles() {
        this.activeParticles.forEach(particle => {
            particle.release();
            this.particlePool.release(particle);
        });
        this.activeParticles = [];
    }

    updateParticles() {
        // Update particle positions and handle lifetime
        for (let i = this.activeParticles.length - 1; i >= 0; i--) {
            const particle = this.activeParticles[i];
            particle.update();
            
            // Remove dead particles
            if (particle.life <= 0) {
                this.removeParticle(i);
                continue;
            }
        }
        
        // Debug: Log pooling stats occasionally  
        if (Math.random() < 0.01) { // 1% chance per frame
            console.log('💥 Particle Pool Stats:', this.getStats());
        }
    }

    drawParticles() {
        this.activeParticles.forEach(particle => particle.draw());
    }

    drawParticlesWithCulling(culler) {
        const visibleParticles = culler.filterVisible(this.activeParticles, 'particles');
        visibleParticles.forEach(particle => particle.draw());
    }

    getStats() {
        const poolStats = this.particlePool.getStats();
        return {
            active: this.activeParticles.length,
            pooled: poolStats.pooled,
            created: poolStats.created,
            reused: poolStats.reused,
            poolSize: poolStats.pooled + poolStats.active
        };
    }
}

// Initialize global particle manager
const particleManager = new ParticleManager();

function spawnChasingSquaresFromIglu(iglu, target) {
    if (!gameState.chasingSquares) gameState.chasingSquares = [];
    // Spawn from RIGHT bottom corner of the iglu
    const baseX = iglu.x + iglu.width - 24 + 10; // right edge of iglu
    const baseY = iglu.y + iglu.height - 24 + 10; // bottom of iglu
    for (let i = 0; i < 5; i++) {
        // Spread them more vertically (upwards)
        let offsetY = baseY - i * (40); // increased spacing
        gameState.chasingSquares.push(new ChasingSquare(baseX, offsetY, target));
    }
}
// --- Update chasing squares in update() ---
const _originalUpdate = update;
update = function() {
    _originalUpdate();
    if (gameState.chasingSquares) {
        gameState.chasingSquares.forEach(sq => sq.update());
        // Remove dead squares
        gameState.chasingSquares = gameState.chasingSquares.filter(sq => sq.isAlive);
    }
}
// --- Draw chasing squares in draw() ---
const _originalDraw = draw;
draw = function() {
    _originalDraw();
    // Draw chasing squares LAST, so they are always on top
    if (gameState.chasingSquares) {
        ctx.save();
        ctx.translate(-gameState.cameraX, -gameState.cameraY);
        gameState.chasingSquares.forEach(sq => sq.draw());
        ctx.restore();
    }
}
// --- Chasing square bullet collision and tank run-over logic in handleCollisions() ---
const _originalHandleCollisions = handleCollisions;
handleCollisions = function() {
    _originalHandleCollisions();
    if (!gameState.chasingSquares) return;
    // Bullets can hit chasing squares
    const bulletsToRemove = [];
    bulletManager.activeBullets.forEach((bullet, bIdx) => {
        if (bullet.bulletType === 3) return; // Ignore their own bullets
        gameState.chasingSquares.forEach((sq, sIdx) => {
            if (!sq.isAlive) return;
            const b = bullet;
            const bounds = sq.getBounds();
            if (b.x > bounds.x && b.x < bounds.x + bounds.width && b.y > bounds.y && b.y < bounds.y + bounds.height) {
                sq.takeDamage(b.damage);
                bulletsToRemove.push(bIdx);
            }
        });
    });
    // Remove bullets that hit chasing squares
    for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
        bulletManager.removeBullet(bulletsToRemove[i]);
    }
    
    // Tanks can run over chasing squares
    const allTanks = [gameState.player, ...gameState.allies, ...gameState.enemies].filter(t => t && t.health > 0);
    gameState.chasingSquares.forEach(sq => {
        if (!sq.isAlive) return;
        allTanks.forEach(tank => {
            if (checkCollision(tank, sq.getBounds())) {
                sq.isAlive = false;
            }
        });
    });
    
    // Chasing square bullets hit tanks
    const chaseBulletsToRemove = [];
    bulletManager.activeBullets.forEach((bullet, bIdx) => {
        if (bullet.bulletType !== 3) return;
        const allTanks = [gameState.player, ...gameState.allies, ...gameState.enemies].filter(t => t && t.health > 0);
        allTanks.forEach(tank => {
            if (tank !== bullet.owner && checkCollision({x: bullet.x, y: bullet.y, width: 1, height: 1}, tank)) {
                tank.takeDamage(1, bullet.owner);
                chaseBulletsToRemove.push(bIdx);
            }
        });
    });
    // Remove chasing square bullets that hit tanks
    for (let i = chaseBulletsToRemove.length - 1; i >= 0; i--) {
        bulletManager.removeBullet(chaseBulletsToRemove[i]);
    }
};

class ShotEffect {
    constructor(x, y, angle) {
        this.x = x;
        this.y = y;
        this.angle = angle; // Direction of the muzzle flash
        this.life = 10; // frames
        this.color = 'rgba(255, 223, 0, 0.8)'; // Yellowish flash
        this.smokeColor = 'rgba(100, 100, 100, 0.5)'; // Grey smoke
        this.smokeParticles = [];
        // Generate smoke particles around the muzzle flash
        for (let i = 0; i < 5; i++) {
            this.smokeParticles.push({
                x: x + Math.cos(angle) * 10, // Slightly offset from muzzle
                y: y + Math.sin(angle) * 10,
                vx: Math.cos(angle + (Math.random() - 0.5) * 0.5) * (Math.random() * 2 + 1), // Spread out
                vy: Math.sin(angle + (Math.random() - 0.5) * 0.5) * (Math.random() * 2 + 1),
                size: Math.random() * 5 + 3,
                life: Math.random() * 20 + 10,
                initialLife: Math.random() * 20 + 10
            });
        }
    }

    update() {
        this.life--;
        this.smokeParticles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            p.size *= 0.9;
        });
        this.smokeParticles = this.smokeParticles.filter(p => p.life > 0);
    }

    draw() {
        if (this.life > 0) {
            ctx.save();
            ctx.globalAlpha = this.life / 10; // Fade out flash
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x + Math.cos(this.angle) * 5, this.y + Math.sin(this.angle) * 5, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        // Draw smoke particles
        this.smokeParticles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.life / p.initialLife;
            ctx.fillStyle = this.smokeColor;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }
}

class HitEffect {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.particles = [];
        this.life = 15; // frames
        for (let i = 0; i < 8; i++) {
            this.particles.push({
                x: this.x, // Start particles at the hit location
                y: this.y,
                vx: (Math.random() - 0.5) * 6,
                vy: (Math.random() - 0.5) * 6,
                size: Math.random() * 3 + 1,
                color: 'rgba(255, 255, 255, 0.8)' // White sparks
            });
        }
    }

    update() {
        this.life--;
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.size *= 0.9;
        });
    }

    draw() {
        if (this.life > 0) {
            ctx.save();
            ctx.globalAlpha = this.life / 15;
            this.particles.forEach(p => {
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }
    }
}

// --- SCREEN MANAGEMENT ---
function showScreen(screenName) {
    // Hide all screens
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    // Hide the video element if it's currently active
    const introVideo = document.getElementById('intro-video');
    if (introVideo) {
        introVideo.style.display = 'none';
        introVideo.pause(); // Ensure video is paused
        introVideo.currentTime = 0; // Reset video to start
    }

    // Show the requested screen
    if (screens[screenName]) {
        screens[screenName].classList.add('active');
        gameState.currentScreen = screenName;
    } else {
        console.warn('Screen not found:', screenName);
        return;
    }
    
    // Always scroll to top when changing screens
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }, 10);

    // Fire a custom event for menu music control in index.html
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        const evt = new CustomEvent('showScreen', { detail: screenName });
        window.dispatchEvent(evt);
    }

    // Adjust app-container and canvas size for fullscreen
    appContainer.style.width = `${window.innerWidth}px`;
    appContainer.style.height = `${window.innerHeight}px`;

    if (screenName === 'game') {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight - BASE_HUD_HEIGHT;
        canvas.style.top = `${BASE_HUD_HEIGHT}px`;
        canvas.style.display = 'block';

        // Set arena dimensions based on actual canvas size
        if (GAME_MODES[gameState.currentMode]) {
            gameState.arenaWidth = canvas.width * GAME_MODES[gameState.currentMode].arenaWidthMultiplier;
            gameState.arenaHeight = canvas.height * GAME_MODES[gameState.currentMode].arenaHeightMultiplier;
        } else {
            // Fallback na 1v1 ak by currentMode nebol platný
            gameState.arenaWidth = canvas.width * GAME_MODES['1v1'].arenaWidthMultiplier;
            gameState.arenaHeight = canvas.height * GAME_MODES['1v1'].arenaHeightMultiplier;
        }

        // Create minimap canvas if it doesn't exist
        if (!minimapCanvas) {
            minimapCanvas = document.createElement('canvas');
            minimapCanvas.id = 'minimapCanvas';
            minimapCanvas.width = MINIMAP_SIZE;
            minimapCanvas.height = MINIMAP_SIZE;
            // Position minimap relative to app-container
            minimapCanvas.style.top = `${BASE_HUD_HEIGHT + MINIMAP_MARGIN}px`;
            minimapCanvas.style.left = `${MINIMAP_MARGIN}px`;
            appContainer.appendChild(minimapCanvas);
            minimapCtx = minimapCanvas.getContext('2d');
        }
        minimapCanvas.style.display = 'block';

        // Ensure coin display is visible
        document.getElementById('coin-display').style.display = 'flex';

    } else {
        canvas.style.display = 'none'; // Hide canvas on menu screens
        if (minimapCanvas) {
            minimapCanvas.style.display = 'none'; // Hide minimap on menu screens
        }
        document.getElementById('coin-display').style.display = 'none'; // Hide coin display on menu screens
    }

    if (screenName === 'tankSelection') {
        drawTankPreviews(); // Ensure previews are drawn when screen is shown
    }
    
    if (screenName === 'multiplayerNameEntry') {
        // Auto-focus the name input field
        setTimeout(() => {
            const nameInput = document.getElementById('player-name-input');
            if (nameInput) {
                nameInput.focus();
                nameInput.select(); // Select any existing text
            }
        }, 100);
    }
}

// --- LOADING SCREEN LOGIC ---
let loadingProgress = 0;
let loadingSteps = [];
let currentLoadingStep = 0;

function initLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const progressFill = document.getElementById('loading-progress-fill');
    const loadingText = document.getElementById('loading-text');
    const loadingPercentage = document.getElementById('loading-percentage');

    if (!loadingScreen) return;

    // Define loading steps
    loadingSteps = [
        { name: 'Inicializujeme hru...', duration: 500 },
        { name: 'Načítavame textúry...', duration: 1000 },
        { name: 'Načítavame postavy...', duration: 800 },
        { name: 'Načítavame tanky...', duration: 600 },
        { name: 'Načítavame zvuky...', duration: 400 },
        { name: 'Načítavame intro video...', duration: 800 },
        { name: 'Príprava dokončená!', duration: 300 }
    ];

    loadingScreen.classList.add('active');
    return { progressFill, loadingText, loadingPercentage };
}

function updateLoadingProgress(progress, text) {
    const progressFill = document.getElementById('loading-progress-fill');
    const loadingText = document.getElementById('loading-text');
    const loadingPercentage = document.getElementById('loading-percentage');

    if (progressFill) progressFill.style.width = `${progress}%`;
    if (loadingText && text) loadingText.textContent = text;
    if (loadingPercentage) loadingPercentage.textContent = `${Math.round(progress)}%`;
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.remove('active');
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    }
}

async function loadGameWithProgress() {
    const totalSteps = loadingSteps.length;
    
    for (let i = 0; i < totalSteps; i++) {
        const step = loadingSteps[i];
        const progress = (i / totalSteps) * 90; // Reserve 90% for steps, 10% for final video check
        
        updateLoadingProgress(progress, step.name);
        
        // Simulate loading time
        await new Promise(resolve => setTimeout(resolve, step.duration));
        
        // Actually load assets during appropriate steps
        if (i === 1) { // Načítavame textúry
            await loadTextureAssets();
        } else if (i === 2) { // Načítavame postavy
            await loadCharacterAssets();
        } else if (i === 3) { // Načítavame tanky
            await loadTankAssets();
        } else if (i === 4) { // Načítavame zvuky
            await loadAudioAssets();
        } else if (i === 5) { // Načítavame intro video
            await preloadVideo();
        }
    }
    
    // Final loading completion
    updateLoadingProgress(100, 'Hotovo!');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    hideLoadingScreen();
    return true;
}

async function loadTextureAssets() {
    // Load textures
    await loadImage('menu_background', 'menu_background.png');
    await loadImage('grass_texture', 'grass_texture.png');
    await loadImage('mud_texture', 'mud_texture.png');
    await loadImage('tree_texture', 'tree_texture.png');
    await loadImage('rock_texture', 'rock_texture.png');
    await loadImage('coin_icon', 'coin.png');
    await loadImage('dessert_texture', 'dessert.jpg');
    await loadImage('oilrig', 'oilrig.png');
    await loadImage('ice_texture', 'ice.png');
    await loadImage('iglu', 'IGLU.png');
    await loadImage('bullet', 'bullet.png');
    await loadImage('bullet2', 'bullet2.png');
    await loadImage('snowball', 'snehovgula.png');
}

async function loadCharacterAssets() {
    // Load character images
    for (const charKey in CHARACTERS) {
        await loadImage(`char_${charKey}`, CHARACTERS[charKey].image);
    }
}

async function loadTankAssets() {
    // Load tank images
    for (const type in TANK_SPECS) {
        await loadImage(`tank_${type}`, TANK_SPECS[type].tankImage);
        await loadImage(`canon_${type}`, TANK_SPECS[type].canonImage);
    }
}

async function loadAudioAssets() {
    // Audio preloading is handled by HTML preload attribute
    // Just wait a bit for them to load
    return new Promise(resolve => setTimeout(resolve, 200));
}

async function preloadVideo() {
    const introVideo = document.getElementById('intro-video');
    if (introVideo) {
        return new Promise(resolve => {
            if (introVideo.readyState >= 3) {
                // Video is already loaded enough to play
                resolve();
            } else {
                introVideo.addEventListener('canplaythrough', resolve, { once: true });
                introVideo.addEventListener('error', resolve, { once: true }); // Continue even if video fails
                // Fallback timeout
                setTimeout(resolve, 2000);
            }
        });
    }
}

// --- INITIALIZATION AND GAME START ---
function init() {
    // Start loading screen immediately
    initLoadingScreen();
    
    // Bullet selection UI logic
    if (bulletSelectionUI) {
        bulletSelectionUI.addEventListener('click', (e) => {
            const opt = e.target.closest('.bullet-option');
            if (opt) {
                const bulletType = parseInt(opt.getAttribute('data-bullet'));
                if (bulletType === 1 || bulletType === 2) {
                    gameState.selectedBulletType = bulletType;
                    updateBulletSelectionUI();
                }
            }
        });
    }
    // Keyboard: 1,2 and Numpad 1,2
    window.addEventListener('keydown', (e) => {
        if (screens.game.classList.contains('active')) {
            if (e.key === '1' || e.code === 'Numpad1') {
                gameState.selectedBulletType = 1;
                updateBulletSelectionUI();
            } else if (e.key === '2' || e.code === 'Numpad2') {
                gameState.selectedBulletType = 2;
                updateBulletSelectionUI();
            }
        }
    });

    // Load game with progress bar
    loadGameWithProgress().then(() => {
        // Set initial app container size for main menu (fullscreen)
        appContainer.style.width = `${window.innerWidth}px`;
        appContainer.style.height = `${window.innerHeight}px`;

        // Load initial coins from localStorage
        loadCoins();

        // Assign loaded assets to game state
        assignLoadedAssets();

        // --- Handle intro video ---
        const introVideo = document.getElementById('intro-video');
        if (introVideo) {
            // Hide all other screens initially
            Object.values(screens).forEach(screen => screen.classList.remove('active'));
            // Display the video and start playing
            introVideo.style.display = 'block';
            introVideo.play().then(() => {
                console.log("Intro video started.");
            }).catch(error => {
                console.error("Error playing intro video:", error);
                // Fallback: If autoplay is blocked or error, go straight to main menu
                showScreen('mainMenu');
            });

            // When video ends, show main menu
            introVideo.onended = () => {
                console.log("Intro video ended. Showing main menu.");
                showScreen('mainMenu');
            };
        } else {
            // Fallback if video element not found, go straight to main menu
            console.warn("Intro video element not found. Showing main menu directly.");
            showScreen('mainMenu');
        }
    }).catch(error => {
        console.error("Loading failed:", error);
        hideLoadingScreen();
        showScreen('mainMenu');
    });


    // Event Listeners for menu buttons
    buttons.start.addEventListener('click', () => showScreen('modeSelection'));
    buttons.multiplayer.addEventListener('click', () => {
        showScreen('multiplayerNameEntry');
    });
    buttons.tutorial.addEventListener('click', () => showScreen('tutorial'));
    buttons.backToMenu.forEach(btn => btn.addEventListener('click', () => {
        returnToMainMenu();
    }));

    // Event Listeners for game mode selection
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            gameState.currentMode = mode;

            // Go to character selection next
            showScreen('characterSelection'); // NOVINKA
        });
    });


// --- Dynamické pozadie podľa vlajky na hover ---
    // --- NOVÝ FÁZOVÝ VÝBER POSTÁV: najprv veliteľ, potom spolubojovníci ---
    let commanderSelected = false;
    let selectedCommanderKey = null;
    let selectedAllies = [];
    let maxAllies = 0;
    let selectionInProgress = false;

    // Enemy selection variables (predefined for random selection)
    let enemyCommanderSelected = false;
    let enemySelectedCommanderKey = null;
    let enemySelectedAllies = [];
    let enemyMaxAllies = 0;
    let enemySelectionInProgress = false;

    function resetCharacterSelection() {
        commanderSelected = false;
        selectedCommanderKey = null;
        selectedAllies = [];
        maxAllies = 0;
        selectionInProgress = false;
        
        // Reset enemy selection variables
        enemyCommanderSelected = false;
        enemySelectedCommanderKey = null;
        enemySelectedAllies = [];
        enemyMaxAllies = 0;
        enemySelectionInProgress = false;
        
        characterCards.forEach(card => {
            card.classList.remove('commander-selected', 'ally-selected', 'locked', 'dimmed', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
            card.style.filter = '';
            card.style.pointerEvents = '';
        });
        // Hide/protect any custom UI if needed
        const dalejBtn = document.getElementById('character-dalej-btn');
        if (dalejBtn) dalejBtn.disabled = true;
        // Reset counter UI
        updateAllyCounter(0, 0);
    }

    // Add/ensure ally counter exists (right side of character selection)
    let allyCounter = document.getElementById('character-ally-counter');
    if (!allyCounter) {
        allyCounter = document.createElement('div');
        allyCounter.id = 'character-ally-counter';
        allyCounter.style.position = 'absolute';
        allyCounter.style.top = '32px';
        allyCounter.style.right = '38px';
        allyCounter.style.fontSize = '1.25em';
        allyCounter.style.color = '#f1c40f';
        allyCounter.style.background = 'rgba(0,0,0,0.55)';
        allyCounter.style.padding = '8px 18px';
        allyCounter.style.borderRadius = '12px';
        allyCounter.style.boxShadow = '0 2px 8px #000a';
        allyCounter.style.zIndex = '10';
        const charSelScreen = document.getElementById('character-selection');
        charSelScreen.appendChild(allyCounter);
    }
    function updateAllyCounter(selected, max) {
        if (max === 0) {
            allyCounter.textContent = '';
            allyCounter.style.display = 'none';
        } else {
            allyCounter.textContent = `Spolubojovníci: ${selected} / ${max}`;
            allyCounter.style.display = 'block';
        }
    }

    // Add/ensure "Ďalej" button exists
    let dalejBtn = document.getElementById('character-dalej-btn');
    if (!dalejBtn) {
        dalejBtn = document.createElement('button');
        dalejBtn.id = 'character-dalej-btn';
        dalejBtn.textContent = 'Ďalej';
        dalejBtn.disabled = true;
        // Now appended in HTML, so no need to append here
    }

    // Add/ensure "Náhodný výber" button exists
    let nahodnyBtn = document.getElementById('character-nahodny-btn');
    if (!nahodnyBtn) {
        nahodnyBtn = document.createElement('button');
        nahodnyBtn.id = 'character-nahodny-btn';
        nahodnyBtn.textContent = 'Náhodný výber';
        // Now appended in HTML, so no need to append here
    }

    // Náhodný výber handler - inteligentne doplní chýbajúcich hráčov
    nahodnyBtn.onclick = () => {
        if (selectionInProgress && !enemySelectionInProgress) {
            // FÁZA 1: Výber hráčskeho tímu - doplní chýbajúcich spojencov
            const mode = gameState.currentMode || '1v1';
            const allyCount = GAME_MODES[mode]?.allyCount || 0;
            
            // Získaj všetky dostupné postavy (okrem už vybraných)
            const charKeys = Object.keys(CHARACTERS);
            const alreadySelected = selectedCommanderKey ? [selectedCommanderKey, ...selectedAllies] : [...selectedAllies];
            const availableChars = charKeys.filter(k => !alreadySelected.includes(k));
            
            const randomlySelected = []; // Sledovanie náhodne vybraných charakterov
            
            // Ak nie je vybraný commander, vyber ho náhodne
            if (!selectedCommanderKey && availableChars.length > 0) {
                const randomCommanderKey = availableChars[Math.floor(Math.random() * availableChars.length)];
                selectedCommanderKey = randomCommanderKey;
                randomlySelected.push(randomCommanderKey);
                
                // Vizuálne aktualizuj commander selection
                characterCards.forEach(card => {
                    card.classList.remove('selected-commander');
                    if (card.dataset.char === randomCommanderKey) {
                        card.classList.add('selected-commander');
                        card.classList.add('random-selected'); // Označenie ako náhodne vybraný
                        console.log('Added random-selected to commander:', randomCommanderKey, card.classList.toString());
                    }
                });
                
                // Aktualizuj dostupné postavy (odstráň nového commandera)
                const commanderIndex = availableChars.indexOf(randomCommanderKey);
                if (commanderIndex > -1) availableChars.splice(commanderIndex, 1);
            }
            
            // Doplň chýbajúcich spojencov
            const missingAllies = allyCount - selectedAllies.length;
            for (let i = 0; i < missingAllies && availableChars.length > 0; i++) {
                const randomIndex = Math.floor(Math.random() * availableChars.length);
                const randomAlly = availableChars[randomIndex];
                selectedAllies.push(randomAlly);
                randomlySelected.push(randomAlly);
                availableChars.splice(randomIndex, 1);
                
                // Vizuálne aktualizuj ally selection
                characterCards.forEach(card => {
                    if (card.dataset.char === randomAlly) {
                        card.classList.add('selected-ally');
                        card.classList.add('random-selected'); // Označenie ako náhodne vybraný
                        console.log('Added random-selected to ally:', randomAlly, card.classList.toString());
                    }
                });
            }
            
            // Aktualizuj UI
            updateAllyCounter(selectedAllies.length, allyCount);
            if (dalejBtn) {
                dalejBtn.disabled = !selectedCommanderKey || (selectedAllies.length !== allyCount);
            }
            
        } else if (enemySelectionInProgress) {
            // FÁZA 2: Výber nepriateľského tímu - doplní chýbajúcich nepriateľov
            const mode = gameState.currentMode || '1v1';
            const enemyAllyCount = GAME_MODES[mode]?.enemyCount - 1 || 0;
            
            // Získaj všetky dostupné postavy (okrem hráčskeho tímu a už vybraných nepriateľov)
            const charKeys = Object.keys(CHARACTERS);
            const playerTeam = [selectedCommanderKey, ...selectedAllies];
            const alreadySelectedEnemies = enemySelectedCommanderKey ? [enemySelectedCommanderKey, ...enemySelectedAllies] : [...enemySelectedAllies];
            const availableChars = charKeys.filter(k => !playerTeam.includes(k) && !alreadySelectedEnemies.includes(k));
            
            const randomlySelectedEnemies = []; // Sledovanie náhodne vybraných nepriateľov
            
            // Ak nie je vybraný enemy commander, vyber ho náhodne
            if (!enemySelectedCommanderKey && availableChars.length > 0) {
                const randomEnemyCommanderKey = availableChars[Math.floor(Math.random() * availableChars.length)];
                enemySelectedCommanderKey = randomEnemyCommanderKey;
                randomlySelectedEnemies.push(randomEnemyCommanderKey);
                
                // Vizuálne aktualizuj enemy commander selection
                characterCards.forEach(card => {
                    card.classList.remove('selected-enemy-commander');
                    if (card.dataset.char === randomEnemyCommanderKey) {
                        card.classList.add('selected-enemy-commander');
                        card.classList.add('random-selected'); // Označenie ako náhodne vybraný
                        console.log('Added random-selected to enemy commander:', randomEnemyCommanderKey, card.classList.toString());
                    }
                });
                
                // Aktualizuj dostupné postavy (odstráň nového enemy commandera)
                const commanderIndex = availableChars.indexOf(randomEnemyCommanderKey);
                if (commanderIndex > -1) availableChars.splice(commanderIndex, 1);
            }
            
            // Doplň chýbajúcich nepriateľských spojencov
            const missingEnemyAllies = enemyAllyCount - enemySelectedAllies.length;
            for (let i = 0; i < missingEnemyAllies && availableChars.length > 0; i++) {
                const randomIndex = Math.floor(Math.random() * availableChars.length);
                const randomEnemyAlly = availableChars[randomIndex];
                enemySelectedAllies.push(randomEnemyAlly);
                randomlySelectedEnemies.push(randomEnemyAlly);
                availableChars.splice(randomIndex, 1);
                
                // Vizuálne aktualizuj enemy ally selection
                characterCards.forEach(card => {
                    if (card.dataset.char === randomEnemyAlly) {
                        card.classList.add('selected-enemy-ally');
                        card.classList.add('random-selected'); // Označenie ako náhodne vybraný
                        console.log('Added random-selected to enemy ally:', randomEnemyAlly, card.classList.toString());
                    }
                });
            }
            
            // Aktualizuj UI
            updateAllyCounter(enemySelectedAllies.length, enemyAllyCount);
            if (dalejBtn) {
                dalejBtn.disabled = !enemySelectedCommanderKey || (enemySelectedAllies.length !== enemyAllyCount);
            }
        }
    };

    // When entering character selection, reset state
    const origShowScreen = showScreen;
    showScreen = function(screenName) {
        origShowScreen(screenName);
        if (screenName === 'characterSelection') {
            // Reinitialize character selection when showing the screen
            setTimeout(() => {
                reinitializeCharacterSelection();
            }, 100);
        }
    };

    if (characterCards && characterCards.length > 0) {
        characterCards.forEach(card => {
            const charKey = card.dataset.char;
            const char = CHARACTERS[charKey];
            if (char && char.flag) {
                card.addEventListener('mouseenter', () => {
                    card.style.backgroundImage = `url('${char.flag}')`;
                });
                card.addEventListener('mouseleave', () => {
                    card.style.backgroundImage = '';
                });
            }
            
            card.addEventListener('click', () => {
                if (!selectionInProgress) return;
            // 1. Commander selection phase
            if (!commanderSelected) {
                commanderSelected = true;
                selectedCommanderKey = charKey;
                // Ostatné módy: klasický výber spojencov
                characterCards.forEach(c => {
                    c.classList.remove('commander-selected', 'locked', 'dimmed', 'ally-selected', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                    c.style.filter = '';
                    c.style.pointerEvents = '';
                });
                card.classList.add('commander-selected');
                card.classList.add('locked');
                card.style.filter = 'grayscale(0.8) brightness(0.7)';
                card.style.pointerEvents = 'none';
                selectedAllies = [];
                updateAllyCounter(0, maxAllies);
                const heading = document.querySelector('#character-selection h2');
                if (heading) heading.textContent = 'Vyber si svojich spolubojovníkov';
                if (maxAllies === 0) {
                    dalejBtn.disabled = false;
                } else {
                    dalejBtn.disabled = true;
                }
            }
            // 2. Allies selection phase
            else if (commanderSelected && charKey !== selectedCommanderKey) {
                // Toggle selection
                if (!selectedAllies.includes(charKey) && selectedAllies.length < maxAllies) {
                    selectedAllies.push(charKey);
                } else if (selectedAllies.includes(charKey)) {
                    selectedAllies = selectedAllies.filter(k => k !== charKey);
                }
                // Update all card visuals for allies
                characterCards.forEach(c => {
                    const k = c.dataset.char;
                    if (selectedAllies.includes(k)) {
                        c.classList.add('ally-selected', 'dimmed');
                        c.style.filter = 'grayscale(0.7) brightness(0.7)';
                    } else {
                        c.classList.remove('ally-selected', 'dimmed');
                        c.style.filter = '';
                    }
                    // Commander card stays locked
                    if (k === selectedCommanderKey) {
                        c.classList.add('commander-selected', 'locked');
                        c.style.filter = 'grayscale(0.8) brightness(0.7)';
                        c.style.pointerEvents = 'none';
                    } else {
                        c.classList.remove('commander-selected', 'locked');
                        c.style.pointerEvents = '';
                    }
                });
                updateAllyCounter(selectedAllies.length, maxAllies);
                // Enable "Ďalej" only if full team picked
                dalejBtn.disabled = (selectedAllies.length !== maxAllies);
            }
        });
    });

    dalejBtn.onclick = () => {
        if (!commanderSelected) return;
        if (selectedAllies.length !== maxAllies) return;
        // Save player selection
        gameState.selectedPlayerChar = CHARACTERS[selectedCommanderKey];
        gameState.selectedAllies = selectedAllies.slice();

        // --- ENEMY SELECTION PHASE ---
        // Prepare for enemy selection in the same menu, but only with remaining characters
        selectionInProgress = false; // End player selection phase
        enemyCommanderSelected = false;
        enemySelectedCommanderKey = null;
        enemySelectedAllies = [];
        enemyMaxAllies = maxAllies;
        enemySelectionInProgress = true; // Start enemy selection phase

        // Filter out already picked characters
        const exclude = [selectedCommanderKey, ...selectedAllies];
        const availableEnemyChars = Object.keys(CHARACTERS).filter(key => !exclude.includes(key));

        // Hide all character cards, then show only available for enemy selection
        characterCards.forEach(card => {
            const k = card.dataset.char;
            if (availableEnemyChars.includes(k)) {
                card.style.display = '';
                card.classList.remove('commander-selected', 'ally-selected', 'locked', 'dimmed', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                card.style.filter = '';
                card.style.pointerEvents = '';
            } else {
                card.style.display = 'none';
            }
        });

        // Update heading and counter for enemy selection
        const heading = document.querySelector('#character-selection h2');
        if (heading) heading.textContent = 'Vyber nepriateľského veliteľa';
        updateAllyCounter(0, enemyMaxAllies);
        dalejBtn.disabled = true;

        // Remove previous event listeners WITHOUT replacing cards (to preserve CSS classes)
        const enemyCards = document.querySelectorAll('.character-card');
        enemyCards.forEach(card => {
            const charKey = card.dataset.char;
            const char = CHARACTERS[charKey];
            
            // Add hover effects for flags (same as player selection)
            if (char && char.flag) {
                card.addEventListener('mouseenter', () => {
                    card.style.backgroundImage = `url('${char.flag}')`;
                });
                card.addEventListener('mouseleave', () => {
                    card.style.backgroundImage = '';
                });
            }
            
            card.addEventListener('click', () => {
                if (!enemySelectionInProgress) return;
                // 1. Enemy commander selection
                if (!enemyCommanderSelected) {
                    enemyCommanderSelected = true;
                    enemySelectedCommanderKey = charKey;
                    // Visual feedback
                    enemyCards.forEach(c => {
                        c.classList.remove('commander-selected', 'locked', 'dimmed', 'ally-selected', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                        c.style.filter = '';
                        c.style.pointerEvents = '';
                    });
                    card.classList.add('selected-enemy-commander');
                    card.style.filter = 'grayscale(0.8) brightness(0.7)';
                    card.style.pointerEvents = 'none';
                    enemySelectedAllies = [];
                    updateAllyCounter(0, enemyMaxAllies);
                    // Update heading
                    if (heading) heading.textContent = 'Vyber nepriateľských spolubojovníkov';
                    if (enemyMaxAllies === 0) {
                        dalejBtn.disabled = false;
                    } else {
                        dalejBtn.disabled = true;
                    }
                }
                // 2. Enemy allies selection
                else if (enemyCommanderSelected && charKey !== enemySelectedCommanderKey) {
                    if (!enemySelectedAllies.includes(charKey) && enemySelectedAllies.length < enemyMaxAllies) {
                        enemySelectedAllies.push(charKey);
                    } else if (enemySelectedAllies.includes(charKey)) {
                        enemySelectedAllies = enemySelectedAllies.filter(k => k !== charKey);
                    }
                    // Update visuals
                    enemyCards.forEach(c => {
                        const k = c.dataset.char;
                        if (enemySelectedAllies.includes(k)) {
                            c.classList.add('selected-enemy-ally');
                            c.style.filter = 'grayscale(0.7) brightness(0.7)';
                        } else {
                            c.classList.remove('selected-enemy-ally');
                            c.style.filter = '';
                        }
                        if (k === enemySelectedCommanderKey) {
                            c.classList.add('selected-enemy-commander');
                            c.style.filter = 'grayscale(0.8) brightness(0.7)';
                            c.style.pointerEvents = 'none';
                        } else {
                            c.classList.remove('selected-enemy-commander');
                            c.style.pointerEvents = '';
                        }
                    });
                    updateAllyCounter(enemySelectedAllies.length, enemyMaxAllies);
                    dalejBtn.disabled = (enemySelectedAllies.length !== enemyMaxAllies);
                }
            });
        });

        // Change "Ďalej" button to confirm enemy selection and go to map selection
        dalejBtn.onclick = () => {
            if (!enemyCommanderSelected) return;
            if (enemySelectedAllies.length !== enemyMaxAllies) return;
            // Save enemy selection
            gameState.selectedEnemyChar = CHARACTERS[enemySelectedCommanderKey];
            gameState.selectedEnemyAllies = enemySelectedAllies.slice();
            // For 1v1: ensure the selected enemy is actually used as the opponent
            if (gameState.currentMode === '1v1') {
                // Set the only enemy to be the selected enemy commander
                gameState.selectedEnemies = [enemySelectedCommanderKey];
            } else {
                // For other modes, use all selected
                gameState.selectedEnemies = [enemySelectedCommanderKey, ...enemySelectedAllies];
            }
            // Restore all cards for next screens
            characterCards.forEach(card => {
                card.style.display = '';
            });
            // Go to map selection
            showScreen('mapSelection');
        };
    };

    }

    // Map selection logic for offline mode
    if (mapCards && mapCards.length > 0) {
        mapCards.forEach(card => {
            card.addEventListener('click', () => {
                mapCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                gameState.selectedMap = card.dataset.map;
            });
        });
    }

    // Map selection "Ďalej" button
    const mapDalejBtn = document.getElementById('map-dalej-btn');
    if (mapDalejBtn) {
        mapDalejBtn.addEventListener('click', () => {
            if (gameState.selectedMap) {
                showScreen('tankSelection');
            } else {
                alert('Vyber si mapu!');
            }
        });
    }

    // Event Listeners for tank selection
    if (tankCards && tankCards.length > 0) {
        tankCards.forEach(card => {
            card.addEventListener('click', () => {
                const playerTankType = card.dataset.tank;
                startGame(playerTankType);
            });
        });
    }

    // Keyboard event listeners for player control
    window.addEventListener('keydown', (e) => {
        if (e.key) gameState.keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', (e) => {
        if (e.key) gameState.keys[e.key.toLowerCase()] = false;
    });
    window.addEventListener('keydown', (e) => {
        // Allow shooting only if player tank exists and not in spectator mode
        if (e.code === 'Space' && gameState.currentScreen === 'game' && !gameState.roundOver && gameState.player && !gameState.isSpectating) {
            e.preventDefault();
            gameState.player.shoot();
        }
    });

    // Name Entry Event Listeners
    const playerNameInput = document.getElementById('player-name-input');
    const confirmNameBtn = document.getElementById('confirm-name-btn');
    
    if (playerNameInput && confirmNameBtn) {
        // Enable/disable confirm button based on input
        playerNameInput.addEventListener('input', () => {
            const name = playerNameInput.value.trim();
            confirmNameBtn.disabled = name.length < 2;
        });
        
        // Handle enter key in input
        playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !confirmNameBtn.disabled) {
                confirmNameBtn.click();
            }
        });
        
        // Confirm name and proceed to mode selection
        confirmNameBtn.addEventListener('click', () => {
            const name = playerNameInput.value.trim();
            if (name.length >= 2) {
                playerName = name;
                showScreen('multiplayerModeSelection');
            }
        });
    }

    // Handle window resize for fullscreen
    window.addEventListener('resize', () => {
        if (gameState.currentScreen === 'game') {
            showScreen('game'); // Re-adjust canvas and arena size
        } else {
            appContainer.style.width = `${window.innerWidth}px`;
            appContainer.style.height = `${window.innerHeight}px`;
        }
    });

    // Hide timer in HUD as requested
    hudTimer.style.display = 'none';
}
// Remove stray bracket from previous patch

// Function to draw tank previews on their respective canvases
function drawTankPreviews() {
    document.querySelectorAll('.tank-preview-canvas').forEach(previewCanvas => {
        const type = previewCanvas.dataset.tankType;
        const ctxPreview = previewCanvas.getContext('2d');
        const tankWidth = 50;
        const tankHeight = 40;
        const canonWidth = 60;
        const canonHeight = 15;

        // Clear canvas
        ctxPreview.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

        // Check if images are loaded AND complete, otherwise draw simple shapes
        const tankImage = gameState.tankImages[type];
        const canonImage = gameState.canonImages[type];

        if (!tankImage || !tankImage.complete || tankImage.naturalWidth === 0 ||
            !canonImage || !canonImage.complete || canonImage.naturalWidth === 0) {
            
            // Fallback: draw basic colored shapes
            ctxPreview.fillStyle = TANK_SPECS[type].color;
            ctxPreview.fillRect((previewCanvas.width - tankWidth) / 2, (previewCanvas.height - tankHeight) / 2, tankWidth, tankHeight);
            console.warn(`Tank images for type ${type} not loaded or complete for preview. Drawing placeholder.`);
            return;
        }

        ctxPreview.save();
        // Translate to the center of the preview canvas
        ctxPreview.translate(previewCanvas.width / 2, previewCanvas.height / 2);

        // For preview, we want the tanks facing right, so rotate if original image faces up
        ctxPreview.rotate(Math.PI / 2); // Rotates the tank so its front is to the right

        // Draw tank body, centered
        ctxPreview.drawImage(tankImage, -tankWidth / 2, -tankHeight / 2, tankWidth, tankHeight);

        // Draw cannon, centered and aligned with tank body (pointing right)
        ctxPreview.drawImage(canonImage, 0, -canonHeight / 2, canonWidth, canonHeight);

        ctxPreview.restore();
    });
}

function createObstacles(densityMultiplier = 1) {
    gameState.obstacles = [];
    const isDessert = gameState.selectedMap === '2';
    const isIce = gameState.selectedMap === '3';
    if (isIce) {
        // Map 3: Only iglu obstacles, no other obstacles at all
        const igluCount = 12; // Fixed number for visibility
        for (let i = 0; i < igluCount; i++) {
            const x = Math.random() * (gameState.arenaWidth - 120) + 60;
            const y = Math.random() * (gameState.arenaHeight - 120) + 60;
            const width = 90 + Math.random() * 30;
            const height = 90 + Math.random() * 30;
            const iglu = new Obstacle(x, y, width, height, 'iglu');
            iglu.maxHealth = 300;
            iglu.health = iglu.maxHealth;
            gameState.obstacles.push(iglu);
        }
        return;
    }
    // Only rocks for dessert, else all
    const numRocks = Math.floor(5 * densityMultiplier);
    if (!isDessert) {
        const numTrees = Math.floor(20 * densityMultiplier);
        const numSwamps = Math.floor(7 * densityMultiplier);
        for (let i = 0; i < numTrees; i++) {
            const x = Math.random() * gameState.arenaWidth;
            const y = Math.random() * gameState.arenaHeight;
            const radius = (20 + Math.random() * 20);
            gameState.obstacles.push(new Obstacle(x, y, radius * 2, radius * 2, 'tree', radius, radius));
        }
        for (let i = 0; i < numSwamps; i++) {
            const x = Math.random() * gameState.arenaWidth;
            const y = Math.random() * gameState.arenaHeight;
            const radiusX = (30 + Math.random() * 30);
            const radiusY = (20 + Math.random() * 20);
            gameState.obstacles.push(new Obstacle(x, y, radiusX * 2, radiusY * 2, 'swamp', radiusX, radiusY));
        }
    }
    for (let i = 0; i < numRocks; i++) {
        const x = Math.random() * gameState.arenaWidth;
        const y = Math.random() * gameState.arenaHeight;
        const width = 40 + Math.random() * 30;
        const height = 30 + Math.random() * 20;
        const rock = new Obstacle(x, y, width, height, 'rock');
        // Make rocks destructible with high health
        rock.maxHealth = 200; // Rocks have high health (stronger than trees)
        rock.health = rock.maxHealth;
        gameState.obstacles.push(rock);
    }
}

/**
 * Generates a random spawn position that does not collide with existing objects.
 * This version uses a more robust approach: it pre-calculates the grid and tries to find a free cell.
 */
function getRandomSpawnPosition(minX, maxX, minY, maxY, tankWidth, tankHeight) {
    const gridCellSize = Math.max(tankWidth, tankHeight) * 2; // Make cells larger than tanks
    const cellsX = Math.floor((maxX - minX) / gridCellSize);
    const cellsY = Math.floor((maxY - minY) / gridCellSize);

    const availableCells = [];

    for (let i = 0; i < cellsX; i++) {
        for (let j = 0; j < cellsY; j++) {
            const testX = minX + i * gridCellSize + gridCellSize / 2 - tankWidth / 2;
            const testY = minY + j * gridCellSize + gridCellSize / 2 - tankHeight / 2;

            const testRect = { x: testX, y: testY, width: tankWidth, height: tankHeight };
            let collision = false;

            // Check against existing tanks and obstacles
            const allStaticObjects = [...gameState.obstacles];
            
            for (const obj of allStaticObjects) {
                const objBounds = obj.getCollisionBounds ? obj.getCollisionBounds() : obj;
                if (objBounds && checkCollision(testRect, objBounds)) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                availableCells.push({ x: testX, y: testY });
            }
        }
    }

    if (availableCells.length > 0) {
        return availableCells[Math.floor(Math.random() * availableCells.length)];
    } else {
        console.warn("No clear grid cells found for spawning. Spawning randomly, may collide.");
        // Fallback: spawn randomly, might still collide
        return {
            x: minX + Math.random() * (maxX - minX - tankWidth),
            y: minY + Math.random() * (maxY - minY - tankHeight)
        };
    }
}


function startGame(playerTankType) {
    gameState.playerScore = 0;
    gameState.enemyScore = 0;
    gameState.playerTankType = playerTankType;
    gameState.isSpectating = false;

    // Nastav textúru podlahy podľa mapy
    if (gameState.selectedMap === '2') {
        gameState.currentFloorTexture = gameState.dessertTexture;
    } else if (gameState.selectedMap === '3') {
        gameState.currentFloorTexture = gameState.iceTexture;
    } else {
        gameState.currentFloorTexture = gameState.grassTexture;
    }

    showScreen('game');
    createObstacles(GAME_MODES[gameState.currentMode].obstacleDensity);
    if (gameState.selectedMap === '2') {
        createOilrigs();
    }
    if (gameState.selectedMap === '3') {
        createIglus();
    }
    startNewRound();
// Igloo objekty pre mapu 3
function createIglus() {
    if (!gameState.igluImage) return;
    const igluCount = 10 + Math.floor(Math.random() * 6); // 10-15 iglu
    for (let i = 0; i < igluCount; i++) {
        const x = Math.random() * (gameState.arenaWidth - 100) + 50;
        const y = Math.random() * (gameState.arenaHeight - 100) + 50;
        const width = 80 + Math.random() * 40;
        const height = 80 + Math.random() * 40;
        // Iglu je nepriechodný a zničiteľný, 4x HP stromu, ale nevybuchuje
        const iglu = new Obstacle(x, y, width, height, 'iglu');
        iglu.maxHealth = 300;
        iglu.health = iglu.maxHealth;
        iglu.draw = function() {
            ctx.save();
            ctx.translate(this.x + this.width/2, this.y + this.height/2);
            if (gameState.igluImage && gameState.igluImage.complete && gameState.igluImage.naturalWidth !== 0) {
                ctx.drawImage(gameState.igluImage, -this.width/2, -this.height/2, this.width, this.height);
            } else {
                ctx.fillStyle = '#bfe6ff';
                ctx.beginPath();
                ctx.ellipse(0, 0, this.width/2, this.height/2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            // Health bar
            if (this.health < this.maxHealth && this.health > 0) {
                const barWidth = this.width * 0.8;
                const barHeight = 8;
                const currentHealthWidth = (this.health / this.maxHealth) * barWidth;
                ctx.fillStyle = '#555';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, barWidth, barHeight);
                ctx.fillStyle = '#3498db';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, currentHealthWidth, barHeight);
            }
            ctx.restore();
        };
        iglu.getCollisionBounds = function() {
            return { x: this.x, y: this.y, width: this.width, height: this.height };
        };
        iglu.takeDamage = function(damage, attacker) {
            this.health -= damage;
            gameState.hitEffects.push(new HitEffect(this.x + this.width/2, this.y + this.height/2));
            if (this.health <= 0) {
                this.health = 0;
                // Remove iglu from obstacles
                gameState.obstacles = gameState.obstacles.filter(obs => obs !== this);
                // NEVYBUCHUJE, len zmizne
            }
        };
        gameState.obstacles.push(iglu);
    }
}
// Oilrig objekty pre mapu 2
function createOilrigs() {
    if (!oilrigImage) return;
    const oilrigCount = 10 + Math.floor(Math.random() * 6); // 10-15 oilrigov
    for (let i = 0; i < oilrigCount; i++) {
        const x = Math.random() * gameState.arenaWidth;
        const y = Math.random() * gameState.arenaHeight;
        const width = 80 + Math.random() * 40;
        const height = 80 + Math.random() * 40;
        // Oilrig je nepriechodný a zničiteľný, 4x HP stromu
        const oilrig = new Obstacle(x, y, width, height, 'oilrig');
        oilrig.maxHealth = 300; // Oilrig má 300 HP
        oilrig.health = oilrig.maxHealth;
        oilrig.draw = function() {
            ctx.save();
            ctx.translate(this.x + this.width/2, this.y + this.height/2);
            ctx.drawImage(oilrigImage, -this.width/2, -this.height/2, this.width, this.height);
            // Health bar
            if (this.health < this.maxHealth && this.health > 0) {
                const barWidth = this.width * 0.8;
                const barHeight = 8;
                const currentHealthWidth = (this.health / this.maxHealth) * barWidth;
                ctx.fillStyle = '#555';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, barWidth, barHeight);
                ctx.fillStyle = '#e67e22';
                ctx.fillRect(-barWidth / 2, -this.height / 2 - 16, currentHealthWidth, barHeight);
            }
            ctx.restore();
        };
        // Oilrig je nepriechodný ako kameň (pevný objekt, obdĺžnikový collider)
        oilrig.getCollisionBounds = function() {
            return { x: this.x, y: this.y, width: this.width, height: this.height };
        };
        oilrig.takeDamage = function(damage, attacker) {
            this.health -= damage;
            gameState.hitEffects.push(new HitEffect(this.x + this.width/2, this.y + this.height/2));
            if (this.health <= 0) {
                this.health = 0;
                // Remove oilrig from obstacles
                gameState.obstacles = gameState.obstacles.filter(obs => obs !== this);
                // Výbuch: veľa častíc, oranžovo-červené
                const numParticles = 80;
                for (let i = 0; i < numParticles; i++) {
                    const color = Math.random() < 0.5 ? '#e67e22' : '#ff3c00';
                    particleManager.createParticle(
                        this.x + this.width/2,
                        this.y + this.height/2,
                        Math.random() * Math.PI * 2,
                        Math.random() * 8 + 4,
                        Math.random() * 12 + 6,
                        color,
                        80 + Math.random() * 30
                    );
                }
                // Play explosion sound
                if (typeof document !== 'undefined') {
                    try {
                        const audio = new Audio('explosion.mp3');
                        audio.preload = 'auto';
                        audio.volume = 0.7;
                        audio.currentTime = 0;
                        audio.play();
                    } catch (e) {}
                }
                // Poškodenie tankov v rádiuse (dvojnásobný rádius, 150 HP damage)
                const explosionRadius = 360;
                const tanks = [gameState.player, ...gameState.allies, ...gameState.enemies].filter(t => t && t.health > 0);
                tanks.forEach(tank => {
                    const tankCenterX = tank.x + tank.width/2;
                    const tankCenterY = tank.y + tank.height/2;
                    const dist = Math.sqrt(Math.pow(tankCenterX - (this.x + this.width/2), 2) + Math.pow(tankCenterY - (this.y + this.height/2), 2));
                    if (dist <= explosionRadius) {
                        tank.takeDamage(400, null); // 150 HP, attacker null (environment)
                    }
                });
            }
        };
        gameState.obstacles.push(oilrig);
    }
}
}


function startNewRound() {
    gameState.roundOver = false;
    roundMessage.style.display = 'none';
    gameState.isSpectating = false; // Reset spectator mode for new round

    gameState.player = null; // Ensure player is null before creating
    gameState.allies = [];
    gameState.enemies = [];
    bulletManager.removeAllBullets(); // Use bullet manager cleanup
    particleManager.removeAllParticles(); // Use particle manager cleanup
    gameState.tracks = [];
    gameState.shotEffects = [];
    gameState.hitEffects = [];

    const mode = GAME_MODES[gameState.currentMode];
    const tankWidth = 50;
    const tankHeight = 40;

    // --- CHARACTER ASSIGNMENT LOGIC ---
    // Prepare character pools for assignment
    const charKeys = Object.keys(CHARACTERS);
    let usedChars = [];
    // Player
    let playerCharKey = gameState.selectedPlayerChar ? gameState.selectedPlayerChar.key : charKeys[0];
    if (gameState.selectedPlayerChar && gameState.selectedPlayerChar.key) {
        playerCharKey = gameState.selectedPlayerChar.key;
    } else if (gameState.selectedPlayerChar) {
        // Try to find key by name
        playerCharKey = charKeys.find(k => CHARACTERS[k].name === gameState.selectedPlayerChar.name) || charKeys[0];
    }
    usedChars.push(playerCharKey);
    const playerSpawnPos = getRandomSpawnPosition(0, gameState.arenaWidth / 2, 0, gameState.arenaHeight, tankWidth, tankHeight);
    gameState.player = new Tank(playerSpawnPos.x, playerSpawnPos.y, gameState.playerTankType, true, false, playerCharKey);

    const allSpawnedObjects = [gameState.player, ...gameState.obstacles];

    // Allies
    let allyCharKeys = [];
    if (gameState.selectedAllies && Array.isArray(gameState.selectedAllies) && gameState.selectedAllies.length > 0) {
        allyCharKeys = gameState.selectedAllies;
    } else {
        // Fill with randoms (excluding used)
        const available = charKeys.filter(k => !usedChars.includes(k));
        for (let i = 0; i < mode.allyCount; i++) {
            if (available.length > 0) {
                const idx = Math.floor(Math.random() * available.length);
                allyCharKeys.push(available[idx]);
                usedChars.push(available[idx]);
                available.splice(idx, 1);
            }
        }
    }
    for (let i = 0; i < mode.allyCount; i++) {
        const randomType = Object.keys(TANK_SPECS)[Math.floor(Math.random() * Object.keys(TANK_SPECS).length)];
        const charKey = allyCharKeys[i] || charKeys.find(k => !usedChars.includes(k)) || charKeys[0];
        usedChars.push(charKey);
        const spawnPos = getRandomSpawnPosition(0, gameState.arenaWidth / 2, 0, gameState.arenaHeight, tankWidth, tankHeight, allSpawnedObjects);
        const newAlly = new Tank(spawnPos.x, spawnPos.y, randomType, false, true, charKey);
        gameState.allies.push(newAlly);
        allSpawnedObjects.push(newAlly);
    }

    // Enemies
    let enemyCharKeys = [];
    if (gameState.selectedEnemies && Array.isArray(gameState.selectedEnemies) && gameState.selectedEnemies.length > 0) {
        enemyCharKeys = gameState.selectedEnemies;
    } else {
        // Fill with randoms (excluding used)
        const available = charKeys.filter(k => !usedChars.includes(k));
        for (let i = 0; i < mode.enemyCount; i++) {
            if (available.length > 0) {
                const idx = Math.floor(Math.random() * available.length);
                enemyCharKeys.push(available[idx]);
                usedChars.push(available[idx]);
                available.splice(idx, 1);
            }
        }
    }
    // 1v1: always use only the selected enemy as the sole opponent
    if (gameState.currentMode === '1v1' && gameState.selectedEnemies && gameState.selectedEnemies.length === 1) {
        enemyCharKeys = [gameState.selectedEnemies[0]];
    }
    for (let i = 0; i < mode.enemyCount; i++) {
        const randomType = Object.keys(TANK_SPECS)[Math.floor(Math.random() * Object.keys(TANK_SPECS).length)];
        const charKey = enemyCharKeys[i] || charKeys.find(k => !usedChars.includes(k)) || charKeys[0];
        usedChars.push(charKey);
        const spawnPos = getRandomSpawnPosition(gameState.arenaWidth / 2, gameState.arenaWidth, 0, gameState.arenaHeight, tankWidth, tankHeight, allSpawnedObjects);
        const newEnemy = new Tank(spawnPos.x, spawnPos.y, randomType, false, false, charKey);
        gameState.enemies.push(newEnemy);
        allSpawnedObjects.push(newEnemy);
    }

    if(gameState.gameInterval) clearInterval(gameState.gameInterval);
    if(gameState.animationFrameId) cancelAnimationFrame(gameState.animationFrameId);
    gameLoop();
}

function stopGame() {
    if (gameState.gameInterval) clearInterval(gameState.gameInterval);
    if (gameState.animationFrameId) cancelAnimationFrame(gameState.animationFrameId);
    gameState.gameInterval = null;
    gameState.animationFrameId = null;
}

// --- MAIN GAME LOOP ---
function gameLoop() {
    if (isPaused) return;
    
    const frameStartTime = performance.now();
    
    // FPS limiting for multiplayer performance with dynamic adjustment
    if (isMultiplayer && performanceManager) {
        const deltaTime = frameStartTime - lastFrameTime;
        
        if (deltaTime < MULTIPLAYER_FRAME_TIME) {
            // Skip this frame if not enough time has passed
            if (!gameState.roundOver) {
                gameState.animationFrameId = requestAnimationFrame(gameLoop);
            }
            return;
        }
        lastFrameTime = frameStartTime;
    }
    
    update();
    draw();
    drawMinimap(); // Draw minimap in each frame
    
    // Update performance metrics
    if (performanceManager) {
        const frameTime = performance.now() - frameStartTime;
        performanceManager.updateMetrics(frameTime);
        
        // Periodically adjust performance settings
        if (Math.random() < 0.01) { // 1% chance per frame
            performanceManager.adjustPerformanceSettings();
        }
    }
    
    if (!gameState.roundOver) {
        gameState.animationFrameId = requestAnimationFrame(gameLoop);
    }
}

// Helper function to interpolate angles correctly (handles wrap-around)
function interpolateAngle(from, to, progress) {
    // Normalize angles to 0-2π range
    from = ((from % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    to = ((to % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    
    // Calculate the shortest angular distance
    let diff = to - from;
    if (diff > Math.PI) {
        diff -= 2 * Math.PI;
    } else if (diff < -Math.PI) {
        diff += 2 * Math.PI;
    }
    
    return from + diff * progress;
}

// --- UPDATE (Game Logic) ---
function update() {
    if(gameState.roundOver) return;

    // Interpolate multiplayer opponents for smooth movement
    if (isMultiplayer) {
        multiplayerTanks.forEach((tank, playerId) => {
            if (tank.isMultiplayerOpponent && tank.targetX !== undefined) {
                const now = Date.now();
                tank.interpolationTime += 16; // Assume ~60fps (16ms per frame)
                
                // Interpolation progress (0 to 1 over NETWORK_SYNC_INTERVAL)
                let progress = Math.min(tank.interpolationTime / NETWORK_SYNC_INTERVAL, 1);
                
                // If we're past the expected update time, use extrapolation
                if (progress >= 1) {
                    const timeSinceLastUpdate = now - tank.lastUpdateTime;
                    if (timeSinceLastUpdate > NETWORK_SYNC_INTERVAL) {
                        // Gentle extrapolation - continue movement in the same direction
                        const extrapolationFactor = Math.min((timeSinceLastUpdate - NETWORK_SYNC_INTERVAL) / NETWORK_SYNC_INTERVAL, 0.5);
                        const moveX = tank.targetX - tank.prevX;
                        const moveY = tank.targetY - tank.prevY;
                        
                        tank.x = tank.targetX + moveX * extrapolationFactor;
                        tank.y = tank.targetY + moveY * extrapolationFactor;
                        tank.angle = tank.targetAngle;
                        tank.turretAbsoluteAngle = tank.targetTurretAngle;
                    } else {
                        // Just use target position
                        tank.x = tank.targetX;
                        tank.y = tank.targetY;
                        tank.angle = tank.targetAngle;
                        tank.turretAbsoluteAngle = tank.targetTurretAngle;
                    }
                } else {
                    // Smooth interpolation using easing
                    const ease = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
                    
                    // Interpolate position
                    tank.x = tank.prevX + (tank.targetX - tank.prevX) * ease;
                    tank.y = tank.prevY + (tank.targetY - tank.prevY) * ease;
                    
                    // Interpolate angles (handle wrapping)
                    tank.angle = interpolateAngle(tank.prevAngle, tank.targetAngle, ease);
                    tank.turretAbsoluteAngle = interpolateAngle(tank.prevTurretAngle, tank.targetTurretAngle, ease);
                }
            }
        });
    }

    // Player movement (only if player tank exists)
    if (gameState.player) {
        const oldX = gameState.player.x;
        const oldY = gameState.player.y;
        const oldAngle = gameState.player.angle;
        const oldTurretAngle = gameState.player.turretAbsoluteAngle;
        
        gameState.player.move();
        
        // Send position update to other players (multiplayer) with throttling
        const now = Date.now();
        const currentPosition = {
            x: gameState.player.x,
            y: gameState.player.y,
            angle: gameState.player.angle,
            turretAngle: gameState.player.turretAbsoluteAngle
        };
        const lastPosition = {
            x: oldX,
            y: oldY,
            angle: oldAngle,
            turretAngle: oldTurretAngle
        };
        
        // Use performance manager if available for smarter throttling
        const shouldSend = performanceManager ? 
            performanceManager.shouldSendPositionUpdate(socket?.id, currentPosition, lastPosition, now) :
            (now - lastNetworkSync > NETWORK_SYNC_INTERVAL && (
                Math.abs(gameState.player.x - oldX) > 1 || 
                Math.abs(gameState.player.y - oldY) > 1 || 
                Math.abs(gameState.player.angle - oldAngle) > 0.01 ||
                Math.abs(gameState.player.turretAbsoluteAngle - oldTurretAngle) > 0.01
            ));
        
        if (isMultiplayer && socket && shouldSend) {
            if (!performanceManager) {
                lastNetworkSync = now;
            }
            
            // Use NetworkingManager for optimized event batching
            if (networkManager) {
                networkManager.batchEvent('player-position', currentPosition, 'medium');
            } else {
                // Fallback to direct socket
                socket.emit('player-position', currentPosition);
            }
            
            // Client-side prediction for smooth movement
            if (predictionManager) {
                const deltaTime = (Date.now() - (gameState.lastUpdateTime || Date.now())) / 1000;
                predictionManager.predictPlayerMovement(gameState.player, deltaTime);
            }
            
            // Reduce logging to prevent spam
            if (Math.random() < 0.001) { // 0.1% chance
                console.log('📤 Sending position:', {
                    x: Math.round(currentPosition.x), 
                    y: Math.round(currentPosition.y)
                });
            }
        }
    } else if (gameState.isSpectating) { // New: Spectator camera movement
        let moveX = 0;
        let moveY = 0;
        if (gameState.keys['w']) { moveY -= gameState.spectatorSpeed; }
        if (gameState.keys['s']) { moveY += gameState.spectatorSpeed; }
        if (gameState.keys['a']) { moveX -= gameState.spectatorSpeed; }
        if (gameState.keys['d']) { moveX += gameState.spectatorSpeed; }

        gameState.cameraX += moveX;
        gameState.cameraY += moveY;

        // Clamp spectator camera to arena boundaries
        gameState.cameraX = Math.max(0, Math.min(gameState.cameraX, gameState.arenaWidth - canvas.width));
        gameState.cameraY = Math.max(0, Math.min(gameState.cameraY, gameState.arenaHeight - canvas.height));
    }


    // AI movement and actions, including improved stuck detection
    const allAITanks = [...gameState.allies, ...gameState.enemies];
    allAITanks.forEach(tank => {
        // Skip AI for multiplayer tanks controlled by other players
        if (isMultiplayer && (tank.playerId || tank.isMultiplayerOpponent)) {
            return;
        }
        
        // Initialize stuck detection properties if not present
        if (!tank.positionHistory) tank.positionHistory = [];
        if (!tank.stuckStartTime) tank.stuckStartTime = null;
        if (!tank.isStuck) tank.isStuck = false;
        
        // Initialize waypoint properties if not present
        if (!tank.currentWaypoint) tank.currentWaypoint = null;
        if (!tank.waypointQueue) tank.waypointQueue = [];
        if (!tank.waypointStartTime) tank.waypointStartTime = null;
        if (!tank.finalTarget) tank.finalTarget = null;
        if (tank.waypointGenerationCooldown === undefined) tank.waypointGenerationCooldown = 0;
        
        // Initialize multi-waypoint properties if not present
        if (tank.maxWaypointsInQueue === undefined) tank.maxWaypointsInQueue = 3;
        if (tank.waypointPlanningRange === undefined) tank.waypointPlanningRange = 300;
        if (tank.lastWaypointReplanTime === undefined) tank.lastWaypointReplanTime = 0;
        if (tank.waypointReplanInterval === undefined) tank.waypointReplanInterval = 5000;
        if (tank.progressiveWaypointCooldown === undefined) tank.progressiveWaypointCooldown = 0;
        if (tank.waypointReplanCount === undefined) tank.waypointReplanCount = 0;
        
        // Record current position with timestamp
        const now = Date.now();
        tank.positionHistory.push({ x: tank.x, y: tank.y, time: now });
        
        // Keep only last 3 seconds of position history
        tank.positionHistory = tank.positionHistory.filter(pos => now - pos.time < 3000);
        
        // Check if tank is stuck (moved less than 20 pixels in last 2 seconds)
        if (tank.positionHistory.length > 1) {
            const oldestPosition = tank.positionHistory.find(pos => now - pos.time >= 2000);
            if (oldestPosition) {
                const totalDistance = Math.sqrt(
                    Math.pow(tank.x - oldestPosition.x, 2) + 
                    Math.pow(tank.y - oldestPosition.y, 2)
                );
                
                if (totalDistance < 20) {
                    if (!tank.isStuck) {
                        tank.isStuck = true;
                        tank.stuckStartTime = now;
                        console.log(`Tank je zaseknutý! Začínam unstuck manéver.`);
                    }
                } else {
                    tank.isStuck = false;
                    tank.stuckStartTime = null;
                }
            }
        }
        
        const targets = tank.isAlly ? gameState.enemies.filter(e => e.health > 0) : [gameState.player, ...gameState.allies].filter(t => t && t.health > 0);
        enemyAI(tank, targets);
    });


    // Bullet movement and management via pooling system
    bulletManager.updateBullets();

    // Update particles with pooling system
    particleManager.updateParticles();

    // Update shot effects with optimization
    gameState.shotEffects.forEach(s => s.update());
    if (performanceManager && isMultiplayer) {
        gameState.shotEffects = performanceManager.optimizeEffects(gameState.shotEffects);
    } else {
        gameState.shotEffects = gameState.shotEffects.filter(s => s.life > 0 || s.smokeParticles.length > 0);
    }

    // Update hit effects
    gameState.hitEffects.forEach(h => h.update());
    gameState.hitEffects = gameState.hitEffects.filter(h => h.life > 0);
    
    // Optimize tracks with performance manager
    if (performanceManager && isMultiplayer) {
        gameState.tracks = performanceManager.optimizeTracks(gameState.tracks);
    } else {
        // Fallback optimization
        const trackLifetime = isMultiplayer ? 1000 : 2000; // 1s in multiplayer, 2s in singleplayer
        gameState.tracks = gameState.tracks.filter(track => Date.now() - track.timestamp < trackLifetime);
        
        // Limit tracks count in multiplayer for better performance
        if (isMultiplayer && gameState.tracks.length > MAX_TRACKS_MULTIPLAYER) {
            gameState.tracks = gameState.tracks.slice(-MAX_TRACKS_MULTIPLAYER);
        }
    }

    // Collisions
    handleCollisions();

    // Remove bullets outside arena
    gameState.bullets = gameState.bullets.filter(b =>
        b.x > -100 && b.x < gameState.arenaWidth + 100 &&
        b.y > -100 && b.y < gameState.arenaHeight + 100
    );

    // Update pulsating team indicator effect
    gameState.teamIndicatorPulse = (gameState.teamIndicatorPulse + 0.05);

    // Update camera position (only if not in spectator mode, or if player still alive)
    // If in spectator mode, camera position is updated by spectator movement
    if (!gameState.isSpectating && gameState.player) {
         updateCamera();
    }


    // Check round end conditions
    checkRoundEnd();
}

// --- WAYPOINT MANAGEMENT FUNCTIONS ---

function updateTankWaypoints(tank, target) {
    const now = Date.now();
    
    // Decrease cooldowns for waypoint generation
    if (tank.waypointGenerationCooldown > 0) {
        tank.waypointGenerationCooldown -= 16; // Decrease by ~1 frame worth (assuming 60fps)
    }
    if (tank.progressiveWaypointCooldown > 0) {
        tank.progressiveWaypointCooldown -= 16;
    }
    
    // DYNAMIC PATH RE-EVALUATION: Check if current waypoint becomes unreachable
    if (tank.currentWaypoint) {
        const isWaypointUnreachable = checkWaypointUnreachable(tank, tank.currentWaypoint);
        if (isWaypointUnreachable) {
            // Waypoint is blocked, immediately replan path
            tank.currentWaypoint = null;
            tank.waypointQueue = [];
            tank.waypointGenerationCooldown = 0; // Allow immediate replanning
            tank.waypointReplanCount = (tank.waypointReplanCount || 0) + 1;
            
            // If we've replanned too many times recently, add a longer cooldown
            if (tank.waypointReplanCount > 3) {
                tank.waypointGenerationCooldown = 2000; // 2 second cooldown
                tank.waypointReplanCount = 0;
            }
        }
    }
    
    // Check if current waypoint is reached
    if (tank.currentWaypoint) {
        const distanceToWaypoint = Math.sqrt(
            Math.pow(tank.x + tank.width/2 - tank.currentWaypoint.x, 2) + 
            Math.pow(tank.y + tank.height/2 - tank.currentWaypoint.y, 2)
        );
        
        if (distanceToWaypoint <= tank.waypointRadius) {
            // Waypoint reached, move to next one or clear
            tank.currentWaypoint = tank.waypointQueue.shift() || null;
            tank.waypointStartTime = tank.currentWaypoint ? now : null;
            
            // Reset waypoint generation cooldown when reaching a waypoint
            tank.waypointGenerationCooldown = 0;
            tank.waypointReplanCount = 0; // Reset replan counter on successful waypoint
        }
        
        // Check for waypoint timeout
        if (tank.waypointStartTime && now - tank.waypointStartTime > tank.waypointTimeout) {
            // Waypoint timed out, abandon it and try next one
            tank.currentWaypoint = tank.waypointQueue.shift() || null;
            tank.waypointStartTime = tank.currentWaypoint ? now : null;
            
            // Set cooldown to prevent immediate regeneration
            tank.waypointGenerationCooldown = 1000; // 1 second cooldown
        }
    }
    
    // Check if we need to generate waypoints (multi-waypoint planning)
    if (!tank.currentWaypoint && tank.waypointGenerationCooldown <= 0) {
        // Check if direct path to target is clear
        if (hasDirectPathToTarget(tank, target)) {
            // Direct path is clear, no waypoint needed
            tank.currentWaypoint = null;
            tank.waypointQueue = []; // Clear any existing queue
        } else {
            // Direct path is blocked, generate a multi-waypoint path
            const waypointPath = generateMultiWaypointPath(tank, target);
            if (waypointPath && waypointPath.length > 0) {
                // Set first waypoint as current, rest go to queue
                tank.currentWaypoint = waypointPath[0];
                tank.waypointQueue = waypointPath.slice(1); // Add remaining waypoints to queue
                tank.waypointStartTime = now;
                tank.waypointGenerationCooldown = 750; // Slightly longer cooldown for multi-waypoint generation
            } else {
                // Could not generate waypoint path, try again later
                tank.waypointGenerationCooldown = 2000; // 2 second cooldown before retrying
            }
        }
    }
    
    // Progressive waypoint generation - add more waypoints to queue if needed
    if (tank.currentWaypoint && tank.waypointQueue.length < tank.maxWaypointsInQueue && 
        tank.progressiveWaypointCooldown <= 0) {
        const additionalWaypoints = generateProgressiveWaypoints(tank, target);
        if (additionalWaypoints && additionalWaypoints.length > 0) {
            // Add to queue but respect max queue size
            const availableSlots = tank.maxWaypointsInQueue - tank.waypointQueue.length;
            const waypointsToAdd = additionalWaypoints.slice(0, availableSlots);
            tank.waypointQueue.push(...waypointsToAdd);
            tank.progressiveWaypointCooldown = 1500; // Cooldown for progressive generation
        }
    }
    
    // Periodic path replanning for tanks that seem stuck with waypoints
    if (tank.currentWaypoint && now - tank.lastWaypointReplanTime > tank.waypointReplanInterval) {
        // Check if tank is making progress toward its current waypoint
        const distanceToCurrentWaypoint = Math.sqrt(
            Math.pow(tank.x + tank.width/2 - tank.currentWaypoint.x, 2) + 
            Math.pow(tank.y + tank.height/2 - tank.currentWaypoint.y, 2)
        );
        
        // If we're still far from current waypoint after a long time, replan
        if (distanceToCurrentWaypoint > tank.waypointRadius * 1.5) {
            // Clear current path and force regeneration
            tank.currentWaypoint = null;
            tank.waypointQueue = [];
            tank.waypointGenerationCooldown = 0; // Allow immediate replanning
        }
        tank.lastWaypointReplanTime = now;
    }
}

function checkWaypointUnreachable(tank, waypoint) {
    // Check if the current waypoint has become unreachable due to obstacles
    
    // Method 1: Direct path check - see if path to waypoint is now blocked
    const tankCenter = { x: tank.x + tank.width/2, y: tank.y + tank.height/2 };
    const waypointDistance = Math.sqrt(
        Math.pow(tankCenter.x - waypoint.x, 2) + 
        Math.pow(tankCenter.y - waypoint.y, 2)
    );
    
    // Only check if waypoint is reasonably close (not checking very distant waypoints constantly)
    if (waypointDistance > 300) {
        return false; // Don't check very distant waypoints for performance
    }
    
    // Check direct line to waypoint for new obstacles
    const steps = Math.max(10, Math.floor(waypointDistance / 20));
    const dx = (waypoint.x - tankCenter.x) / steps;
    const dy = (waypoint.y - tankCenter.y) / steps;
    
    for (let i = 1; i <= steps; i++) {
        const checkX = tankCenter.x + dx * i;
        const checkY = tankCenter.y + dy * i;
        const checkRect = {
            x: checkX - tank.width/2,
            y: checkY - tank.height/2,
            width: tank.width,
            height: tank.height
        };
        
        // Check collision with obstacles
        for (const obs of gameState.obstacles) {
            const obsBounds = obs.getCollisionBounds();
            if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || obs.type === 'swamp' || 
                (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
                if (checkCollision(checkRect, obsBounds)) {
                    return true; // Path blocked, waypoint unreachable
                }
            }
        }
    }
    
    // Method 2: Check if waypoint itself is now inside an obstacle
    const waypointRect = {
        x: waypoint.x - tank.width/2,
        y: waypoint.y - tank.height/2,
        width: tank.width,
        height: tank.height
    };
    
    for (const obs of gameState.obstacles) {
        const obsBounds = obs.getCollisionBounds();
        if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || obs.type === 'swamp' || 
            (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
            if (checkCollision(waypointRect, obsBounds)) {
                return true; // Waypoint is inside obstacle
            }
        }
    }
    
    // Method 3: Check for new obstacles that weren't there when waypoint was created
    // This is more complex and could be added later for very dynamic environments
    
    return false; // Waypoint appears reachable
}

function hasDirectPathToTarget(tank, target) {
    // Simple line-of-sight check for direct path
    const steps = 20;
    const dx = (target.x - tank.x) / steps;
    const dy = (target.y - tank.y) / steps;
    
    for (let i = 0; i <= steps; i++) {
        const checkX = tank.x + dx * i;
        const checkY = tank.y + dy * i;
        const checkRect = {
            x: checkX - tank.width/2,
            y: checkY - tank.height/2,
            width: tank.width,
            height: tank.height
        };
        
        // Check collision with obstacles
        for (const obs of gameState.obstacles) {
            const obsBounds = obs.getCollisionBounds();
            if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || obs.type === 'swamp' || 
                (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
                if (checkCollision(checkRect, obsBounds)) {
                    return false; // Path blocked
                }
            }
        }
    }
    
    return true; // Direct path clear
}

function generateIntelligentWaypoint(tank, target) {
    // Try multiple strategies for waypoint generation
    
    // Strategy 1: Single obstacle avoidance (original logic, improved)
    let waypoint = generateSingleObstacleWaypoint(tank, target);
    if (waypoint) return waypoint;
    
    // Strategy 2: Multiple obstacle cluster analysis
    waypoint = generateClusterAvoidanceWaypoint(tank, target);
    if (waypoint) return waypoint;
    
    // Strategy 3: Corridor/gap finding
    waypoint = generateGapNavigationWaypoint(tank, target);
    if (waypoint) return waypoint;
    
    // Strategy 4: Fallback - wide detour around obstacle groups
    waypoint = generateWideDetourWaypoint(tank, target);
    if (waypoint) return waypoint;
    
    return null; // All strategies failed
}

function generateMultiWaypointPath(tank, target) {
    // Generate a sequence of waypoints to navigate complex obstacle layouts
    const maxWaypoints = 5; // Maximum waypoints in a single planning phase
    const waypoints = [];
    
    // Method 1: A* style pathfinding for complex scenarios
    const astarPath = generateAStarWaypoints(tank, target, maxWaypoints);
    if (astarPath && astarPath.length > 0) {
        return astarPath;
    }
    
    // Method 2: Sequential obstacle avoidance
    const sequentialPath = generateSequentialWaypoints(tank, target, maxWaypoints);
    if (sequentialPath && sequentialPath.length > 0) {
        return sequentialPath;
    }
    
    // Method 3: Fallback to single intelligent waypoint
    const singleWaypoint = generateIntelligentWaypoint(tank, target);
    if (singleWaypoint) {
        return [singleWaypoint];
    }
    
    return null;
}

function generateAStarWaypoints(tank, target, maxWaypoints) {
    // Simplified A* pathfinding adapted for real-time tank navigation
    const tankCenter = { x: tank.x + tank.width/2, y: tank.y + tank.height/2 };
    const targetCenter = { x: target.x + target.width/2, y: target.y + target.height/2 };
    
    // Create a grid for pathfinding
    const gridSize = Math.max(tank.width, tank.height) * 2;
    const gridWidth = Math.ceil(gameState.arenaWidth / gridSize);
    const gridHeight = Math.ceil(gameState.arenaHeight / gridSize);
    
    // Mark blocked grid cells
    const blockedCells = new Set();
    gameState.obstacles.forEach(obs => {
        if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || 
            (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
            const bounds = obs.getCollisionBounds();
            const margin = Math.max(tank.width, tank.height) + 10;
            
            const minGridX = Math.max(0, Math.floor((bounds.x - margin) / gridSize));
            const maxGridX = Math.min(gridWidth - 1, Math.floor((bounds.x + bounds.width + margin) / gridSize));
            const minGridY = Math.max(0, Math.floor((bounds.y - margin) / gridSize));
            const maxGridY = Math.min(gridHeight - 1, Math.floor((bounds.y + bounds.height + margin) / gridSize));
            
            for (let gx = minGridX; gx <= maxGridX; gx++) {
                for (let gy = minGridY; gy <= maxGridY; gy++) {
                    blockedCells.add(`${gx},${gy}`);
                }
            }
        }
    });
    
    // Convert tank and target positions to grid coordinates
    const startGrid = {
        x: Math.floor(tankCenter.x / gridSize),
        y: Math.floor(tankCenter.y / gridSize)
    };
    const targetGrid = {
        x: Math.floor(targetCenter.x / gridSize),
        y: Math.floor(targetCenter.y / gridSize)
    };
    
    // Simple A* implementation
    const openSet = [{ ...startGrid, g: 0, h: 0, f: 0, parent: null }];
    const closedSet = new Set();
    const came_from = new Map();
    
    while (openSet.length > 0) {
        // Find node with lowest f score
        openSet.sort((a, b) => a.f - b.f);
        const current = openSet.shift();
        const currentKey = `${current.x},${current.y}`;
        
        if (closedSet.has(currentKey)) continue;
        closedSet.add(currentKey);
        
        // Check if we reached the target
        if (current.x === targetGrid.x && current.y === targetGrid.y) {
            // Reconstruct path
            const path = [];
            let node = current;
            while (node && node.parent) {
                path.unshift({
                    x: node.x * gridSize + gridSize / 2,
                    y: node.y * gridSize + gridSize / 2
                });
                node = node.parent;
            }
            
            // Return limited number of waypoints
            return path.slice(0, maxWaypoints);
        }
        
        // Check neighbors
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                
                const neighbor = {
                    x: current.x + dx,
                    y: current.y + dy
                };
                
                // Check bounds
                if (neighbor.x < 0 || neighbor.x >= gridWidth || 
                    neighbor.y < 0 || neighbor.y >= gridHeight) continue;
                
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (closedSet.has(neighborKey) || blockedCells.has(neighborKey)) continue;
                
                const g = current.g + Math.sqrt(dx * dx + dy * dy);
                const h = Math.sqrt(
                    Math.pow(neighbor.x - targetGrid.x, 2) + 
                    Math.pow(neighbor.y - targetGrid.y, 2)
                );
                
                neighbor.g = g;
                neighbor.h = h;
                neighbor.f = g + h;
                neighbor.parent = current;
                
                openSet.push(neighbor);
            }
        }
        
        // Limit search to prevent performance issues
        if (closedSet.size > 200) break;
    }
    
    return null; // No path found
}

function generateSequentialWaypoints(tank, target, maxWaypoints) {
    // Generate waypoints by sequentially avoiding obstacles along the path
    const waypoints = [];
    let currentPos = { x: tank.x + tank.width/2, y: tank.y + tank.height/2 };
    let currentTarget = { x: target.x, y: target.y };
    
    for (let i = 0; i < maxWaypoints; i++) {
        // Create temporary tank object for pathfinding
        const tempTank = {
            x: currentPos.x - tank.width/2,
            y: currentPos.y - tank.height/2,
            width: tank.width,
            height: tank.height,
            speed: tank.speed
        };
        
        // Check if direct path to final target is clear
        if (hasDirectPathToTarget(tempTank, currentTarget)) {
            break; // We can reach the target directly
        }
        
        // Generate next waypoint using intelligent waypoint generation
        const nextWaypoint = generateIntelligentWaypoint(tempTank, currentTarget);
        if (!nextWaypoint) {
            break; // Can't generate more waypoints
        }
        
        waypoints.push(nextWaypoint);
        currentPos = { x: nextWaypoint.x, y: nextWaypoint.y };
        
        // Check if this waypoint gets us closer to target
        const distanceToTarget = Math.sqrt(
            Math.pow(currentPos.x - currentTarget.x, 2) + 
            Math.pow(currentPos.y - currentTarget.y, 2)
        );
        
        // If we're very close to target, we can stop
        if (distanceToTarget < tank.waypointRadius * 2) {
            break;
        }
    }
    
    return waypoints.length > 0 ? waypoints : null;
}

function generateProgressiveWaypoints(tank, target) {
    // Generate additional waypoints when the tank is progressing along its current path
    if (!tank.currentWaypoint) return null;
    
    // Check if we're likely to need more waypoints ahead
    const lookaheadDistance = 200;
    const currentWaypointPos = tank.currentWaypoint;
    
    // Create a virtual position ahead of current waypoint toward target
    const directionToTarget = Math.atan2(
        target.y - currentWaypointPos.y,
        target.x - currentWaypointPos.x
    );
    
    const lookaheadPos = {
        x: currentWaypointPos.x + Math.cos(directionToTarget) * lookaheadDistance,
        y: currentWaypointPos.y + Math.sin(directionToTarget) * lookaheadDistance
    };
    
    // Create temporary tank object for lookahead pathfinding
    const tempTank = {
        x: currentWaypointPos.x - tank.width/2,
        y: currentWaypointPos.y - tank.height/2,
        width: tank.width,
        height: tank.height,
        speed: tank.speed
    };
    
    // Check if path from current waypoint to target area is blocked
    if (!hasDirectPathToTarget(tempTank, lookaheadPos)) {
        // Generate additional waypoints
        const additionalWaypoints = generateSequentialWaypoints(tempTank, target, 2);
        return additionalWaypoints;
    }
    
    return null;
}

function generateSingleObstacleWaypoint(tank, target) {
    // Enhanced version of the original basic waypoint generation
    const blockingObstacle = findBlockingObstacle(tank, target);
    if (!blockingObstacle) {
        return null;
    }
    
    const obsBounds = blockingObstacle.getCollisionBounds();
    const tankCenterX = tank.x + tank.width/2;
    const tankCenterY = tank.y + tank.height/2;
    const targetX = target.x;
    const targetY = target.y;
    
    // Calculate obstacle center
    const obsCenterX = obsBounds.x + obsBounds.width/2;
    const obsCenterY = obsBounds.y + obsBounds.height/2;
    
    // Dynamic safety margin based on tank speed and obstacle size
    const baseMargin = Math.max(tank.width, tank.height) + 15;
    const speedMargin = tank.speed * 10; // More margin for faster tanks
    const obstacleMargin = Math.max(obsBounds.width, obsBounds.height) * 0.2; // Bigger margin for bigger obstacles
    const safetyMargin = baseMargin + speedMargin + obstacleMargin;
    
    const candidates = [];
    const obstacleRadius = Math.max(obsBounds.width, obsBounds.height) / 2 + safetyMargin;
    
    // Enhanced candidate generation - more positions
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) { // 16 positions around obstacle
        const candidateX = obsCenterX + Math.cos(angle) * obstacleRadius;
        const candidateY = obsCenterY + Math.sin(angle) * obstacleRadius;
        candidates.push({ x: candidateX, y: candidateY });
    }
    
    // Filter valid candidates
    const validCandidates = candidates.filter(candidate => 
        isWaypointValid(candidate, tank, target, [blockingObstacle])
    );
    
    if (validCandidates.length === 0) {
        return null;
    }
    
    // Score candidates based on multiple factors
    return selectBestWaypoint(validCandidates, tank, target);
}

function generateClusterAvoidanceWaypoint(tank, target) {
    // Find clusters of obstacles that might block the path
    const tankCenterX = tank.x + tank.width/2;
    const tankCenterY = tank.y + tank.height/2;
    const targetX = target.x;
    const targetY = target.y;
    
    // Find all obstacles near the direct path
    const pathObstacles = findObstaclesNearPath(tank, target, 150); // 150px corridor width
    if (pathObstacles.length === 0) {
        return null;
    }
    
    // Find the bounding box of all blocking obstacles
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pathObstacles.forEach(obs => {
        const bounds = obs.getCollisionBounds();
        minX = Math.min(minX, bounds.x);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        minY = Math.min(minY, bounds.y);
        maxY = Math.max(maxY, bounds.y + bounds.height);
    });
    
    // Calculate cluster center and size
    const clusterCenterX = (minX + maxX) / 2;
    const clusterCenterY = (minY + maxY) / 2;
    const clusterWidth = maxX - minX;
    const clusterHeight = maxY - minY;
    
    // Generate waypoints around the entire cluster
    const clusterMargin = Math.max(tank.width, tank.height) + 40;
    const candidates = [];
    
    // Try going around the cluster from different angles
    const clusterRadius = Math.max(clusterWidth, clusterHeight) / 2 + clusterMargin;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) { // 12 positions
        const candidateX = clusterCenterX + Math.cos(angle) * clusterRadius;
        const candidateY = clusterCenterY + Math.sin(angle) * clusterRadius;
        candidates.push({ x: candidateX, y: candidateY });
    }
    
    // Filter valid candidates
    const validCandidates = candidates.filter(candidate => 
        isWaypointValid(candidate, tank, target, pathObstacles)
    );
    
    if (validCandidates.length === 0) {
        return null;
    }
    
    return selectBestWaypoint(validCandidates, tank, target);
}

function generateGapNavigationWaypoint(tank, target) {
    // Try to find gaps between obstacles that the tank can navigate through
    const pathObstacles = findObstaclesNearPath(tank, target, 200);
    if (pathObstacles.length < 2) {
        return null; // Need at least 2 obstacles to have gaps
    }
    
    const tankSize = Math.max(tank.width, tank.height);
    const requiredGapSize = tankSize + 30; // Minimum gap size needed
    
    // Find gaps between obstacles
    const gaps = [];
    for (let i = 0; i < pathObstacles.length; i++) {
        for (let j = i + 1; j < pathObstacles.length; j++) {
            const obs1 = pathObstacles[i].getCollisionBounds();
            const obs2 = pathObstacles[j].getCollisionBounds();
            
            // Calculate gap between these two obstacles
            const gap = calculateGapBetweenObstacles(obs1, obs2);
            if (gap && gap.width >= requiredGapSize && gap.height >= requiredGapSize) {
                gaps.push(gap);
            }
        }
    }
    
    if (gaps.length === 0) {
        return null;
    }
    
    // Select the best gap (closest to direct path)
    const directPathAngle = Math.atan2(target.y - tank.y, target.x - tank.x);
    let bestGap = null;
    let bestScore = -1;
    
    gaps.forEach(gap => {
        const gapAngle = Math.atan2(gap.centerY - tank.y, gap.centerX - tank.x);
        const angleDiff = Math.abs(normalizeAngle(gapAngle - directPathAngle));
        const score = 1 - (angleDiff / Math.PI); // Prefer gaps aligned with target
        
        if (score > bestScore) {
            bestScore = score;
            bestGap = gap;
        }
    });
    
    if (bestGap) {
        return { x: bestGap.centerX, y: bestGap.centerY };
    }
    
    return null;
}

function generateWideDetourWaypoint(tank, target) {
    // Last resort: make a wide detour around all obstacles
    const tankCenterX = tank.x + tank.width/2;
    const tankCenterY = tank.y + tank.height/2;
    
    // Find all obstacles in a large area around the tank
    const searchRadius = 300;
    const nearbyObstacles = gameState.obstacles.filter(obs => {
        const bounds = obs.getCollisionBounds();
        const obsCenter = {
            x: bounds.x + bounds.width/2,
            y: bounds.y + bounds.height/2
        };
        const distance = Math.sqrt(
            Math.pow(obsCenter.x - tankCenterX, 2) + 
            Math.pow(obsCenter.y - tankCenterY, 2)
        );
        return distance <= searchRadius;
    });
    
    if (nearbyObstacles.length === 0) {
        return null;
    }
    
    // Find bounding box of all nearby obstacles
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nearbyObstacles.forEach(obs => {
        const bounds = obs.getCollisionBounds();
        minX = Math.min(minX, bounds.x);
        maxX = Math.max(maxX, bounds.x + bounds.width);
        minY = Math.min(minY, bounds.y);
        maxY = Math.max(maxY, bounds.y + bounds.height);
    });
    
    // Generate waypoints well outside this bounding box
    const margin = 100;
    const candidates = [
        { x: minX - margin, y: (minY + maxY) / 2 }, // Left side
        { x: maxX + margin, y: (minY + maxY) / 2 }, // Right side
        { x: (minX + maxX) / 2, y: minY - margin }, // Top side
        { x: (minX + maxX) / 2, y: maxY + margin }  // Bottom side
    ];
    
    // Filter valid candidates
    const validCandidates = candidates.filter(candidate => 
        isWaypointValid(candidate, tank, target, nearbyObstacles)
    );
    
    if (validCandidates.length === 0) {
        return null;
    }
    
    return selectBestWaypoint(validCandidates, tank, target);
}

function findBlockingObstacle(tank, target) {
    // Find the first obstacle that blocks the direct path
    const steps = 20;
    const dx = (target.x - tank.x) / steps;
    const dy = (target.y - tank.y) / steps;
    
    for (let i = 0; i <= steps; i++) {
        const checkX = tank.x + dx * i;
        const checkY = tank.y + dy * i;
        const checkRect = {
            x: checkX - tank.width/2,
            y: checkY - tank.height/2,
            width: tank.width,
            height: tank.height
        };
        
        // Check collision with obstacles
        for (const obs of gameState.obstacles) {
            const obsBounds = obs.getCollisionBounds();
            if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || obs.type === 'swamp' || 
                (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
                if (checkCollision(checkRect, obsBounds)) {
                    return obs; // Return the first blocking obstacle
                }
            }
        }
    }
    
    return null; // No blocking obstacle found
}

// Helper functions for intelligent waypoint generation

function findObstaclesNearPath(tank, target, corridorWidth) {
    // Find all obstacles within a corridor between tank and target
    const obstacles = [];
    const tankCenterX = tank.x + tank.width/2;
    const tankCenterY = tank.y + tank.height/2;
    const targetX = target.x;
    const targetY = target.y;
    
    gameState.obstacles.forEach(obs => {
        if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || obs.type === 'swamp' || 
            (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
            const bounds = obs.getCollisionBounds();
            const obsCenter = {
                x: bounds.x + bounds.width/2,
                y: bounds.y + bounds.height/2
            };
            
            // Calculate distance from obstacle to the line between tank and target
            const distanceToLine = distanceFromPointToLine(
                obsCenter, 
                { x: tankCenterX, y: tankCenterY }, 
                { x: targetX, y: targetY }
            );
            
            if (distanceToLine <= corridorWidth / 2) {
                obstacles.push(obs);
            }
        }
    });
    
    return obstacles;
}

function distanceFromPointToLine(point, lineStart, lineEnd) {
    // Calculate perpendicular distance from point to line segment
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    
    if (lenSq === 0) {
        // Line start and end are the same point
        return Math.sqrt(A * A + B * B);
    }
    
    let param = dot / lenSq;
    
    let xx, yy;
    if (param < 0) {
        xx = lineStart.x;
        yy = lineStart.y;
    } else if (param > 1) {
        xx = lineEnd.x;
        yy = lineEnd.y;
    } else {
        xx = lineStart.x + param * C;
        yy = lineStart.y + param * D;
    }
    
    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

function calculateGapBetweenObstacles(obs1, obs2) {
    // Calculate if there's a navigable gap between two obstacles
    const gap = {};
    
    // Find the closest edges
    const leftObs = obs1.x + obs1.width < obs2.x ? obs1 : obs2;
    const rightObs = leftObs === obs1 ? obs2 : obs1;
    const topObs = obs1.y + obs1.height < obs2.y ? obs1 : obs2;
    const bottomObs = topObs === obs1 ? obs2 : obs1;
    
    // Check horizontal gap
    if (leftObs.x + leftObs.width < rightObs.x) {
        gap.width = rightObs.x - (leftObs.x + leftObs.width);
        gap.centerX = (leftObs.x + leftObs.width + rightObs.x) / 2;
        gap.centerY = (Math.max(leftObs.y, rightObs.y) + Math.min(leftObs.y + leftObs.height, rightObs.y + rightObs.height)) / 2;
    } else {
        gap.width = 0;
    }
    
    // Check vertical gap
    if (topObs.y + topObs.height < bottomObs.y) {
        gap.height = bottomObs.y - (topObs.y + topObs.height);
        if (!gap.centerX) { // If no horizontal gap, use vertical gap center
            gap.centerX = (Math.max(topObs.x, bottomObs.x) + Math.min(topObs.x + topObs.width, bottomObs.x + bottomObs.width)) / 2;
            gap.centerY = (topObs.y + topObs.height + bottomObs.y) / 2;
        }
    } else {
        gap.height = gap.height || 0;
    }
    
    // Only return gap if it exists in at least one dimension
    if (gap.width > 0 || gap.height > 0) {
        return gap;
    }
    
    return null;
}

function isWaypointValid(candidate, tank, target, excludeObstacles = []) {
    // Check if a waypoint candidate is valid
    
    // Check map bounds with dynamic arena size
    const mapBounds = {
        minX: tank.width/2,
        maxX: gameState.arenaWidth - tank.width/2,
        minY: tank.height/2,
        maxY: gameState.arenaHeight - tank.height/2
    };
    
    if (candidate.x < mapBounds.minX || candidate.x > mapBounds.maxX ||
        candidate.y < mapBounds.minY || candidate.y > mapBounds.maxY) {
        return false;
    }
    
    // Check if waypoint position is clear of obstacles
    const waypointRect = {
        x: candidate.x - tank.width/2,
        y: candidate.y - tank.height/2,
        width: tank.width,
        height: tank.height
    };
    
    for (const obs of gameState.obstacles) {
        // Skip obstacles we're specifically trying to avoid (they're already accounted for)
        if (excludeObstacles.includes(obs)) continue;
        
        const obsCheckBounds = obs.getCollisionBounds();
        if ((obs.type === 'tree' && obs.health > 0) || (obs.type === 'rock' && obs.health > 0) || obs.type === 'swamp' || 
            (obs.type === 'oilrig' && obs.health > 0) || (obs.type === 'iglu' && obs.health > 0)) {
            if (checkCollision(waypointRect, obsCheckBounds)) {
                return false; // Waypoint position is blocked
            }
        }
    }
    
    return true;
}

function selectBestWaypoint(candidates, tank, target) {
    // Advanced scoring system for waypoint selection
    const tankCenterX = tank.x + tank.width/2;
    const tankCenterY = tank.y + tank.height/2;
    const targetX = target.x;
    const targetY = target.y;
    
    let bestWaypoint = null;
    let bestScore = -Infinity;
    
    candidates.forEach(candidate => {
        let score = 0;
        
        // Factor 1: Total distance (lower is better)
        const distToWaypoint = Math.sqrt(
            Math.pow(tankCenterX - candidate.x, 2) + Math.pow(tankCenterY - candidate.y, 2)
        );
        const distFromWaypoint = Math.sqrt(
            Math.pow(candidate.x - targetX, 2) + Math.pow(candidate.y - targetY, 2)
        );
        const totalDistance = distToWaypoint + distFromWaypoint;
        const distanceScore = 1000 / (totalDistance + 1); // Normalize distance
        
        // Factor 2: Alignment with target direction (prefer waypoints that don't deviate too much)
        const directAngle = Math.atan2(targetY - tankCenterY, targetX - tankCenterX);
        const waypointAngle = Math.atan2(candidate.y - tankCenterY, candidate.x - tankCenterX);
        const angleDiff = Math.abs(normalizeAngle(waypointAngle - directAngle));
        const alignmentScore = (Math.PI - angleDiff) * 50; // Less deviation = higher score
        
        // Factor 3: Safety margin from obstacles
        let safetyScore = 0;
        gameState.obstacles.forEach(obs => {
            const bounds = obs.getCollisionBounds();
            const obsCenter = { x: bounds.x + bounds.width/2, y: bounds.y + bounds.height/2 };
            const distToObs = Math.sqrt(
                Math.pow(candidate.x - obsCenter.x, 2) + Math.pow(candidate.y - obsCenter.y, 2)
            );
            safetyScore += Math.min(distToObs, 100); // Bonus for being far from obstacles
        });
        
        // Factor 4: Progress towards target (prefer waypoints that make progress)
        const currentDistToTarget = Math.sqrt(
            Math.pow(tankCenterX - targetX, 2) + Math.pow(tankCenterY - targetY, 2)
        );
        const progressScore = Math.max(0, currentDistToTarget - distFromWaypoint) * 10;
        
        // Combine all factors
        score = distanceScore + alignmentScore + safetyScore + progressScore;
        
        if (score > bestScore) {
            bestScore = score;
            bestWaypoint = candidate;
        }
    });
    
    return bestWaypoint;
}

function enemyAI(tank, targets) {
    if (!tank || targets.length === 0) return;

    const livingTargets = targets.filter(t => t.health > 0);
    if (livingTargets.length === 0) return;

    let closestTarget = null;
    let minDistance = Infinity;

    livingTargets.forEach(target => {
        const dx = target.x - tank.x;
        const dy = target.y - tank.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
            minDistance = distance;
            closestTarget = target;
        }
    });

    if (!closestTarget) return;

    // Update final target
    tank.finalTarget = closestTarget;
    
    // SIMPLIFIED LOGIC: No waypoints, just direct movement with strategic distance
    tank.currentWaypoint = null;
    tank.waypointQueue = [];
    
    // STRATEGIC DISTANCE MANAGEMENT
    const OPTIMAL_COMBAT_DISTANCE = 180; // Ideal fighting distance
    const MIN_COMBAT_DISTANCE = 120; // Minimum safe distance
    const MAX_COMBAT_DISTANCE = 300; // Maximum effective range
    
    // Calculate desired position - maintain strategic distance
    const dxToTarget = closestTarget.x - tank.x;
    const dyToTarget = closestTarget.y - tank.y;
    const angleToTarget = Math.atan2(dyToTarget, dxToTarget);
    const currentDistance = Math.sqrt(dxToTarget * dxToTarget + dyToTarget * dyToTarget);
    
    // Determine movement behavior based on distance
    let movementTarget;
    let shouldApproach = false;
    let shouldRetreat = false;
    
    if (currentDistance > MAX_COMBAT_DISTANCE) {
        // Too far - approach to optimal range
        shouldApproach = true;
        movementTarget = {
            x: closestTarget.x - Math.cos(angleToTarget) * OPTIMAL_COMBAT_DISTANCE,
            y: closestTarget.y - Math.sin(angleToTarget) * OPTIMAL_COMBAT_DISTANCE
        };
    } else if (currentDistance < MIN_COMBAT_DISTANCE) {
        // Too close - retreat to safe distance
        shouldRetreat = true;
        movementTarget = {
            x: closestTarget.x - Math.cos(angleToTarget) * OPTIMAL_COMBAT_DISTANCE,
            y: closestTarget.y - Math.sin(angleToTarget) * OPTIMAL_COMBAT_DISTANCE
        };
    } else {
        // Within combat range - maintain position with slight adjustments
        const adjustmentAngle = angleToTarget + (Math.random() - 0.5) * 0.3; // Small random adjustment
        movementTarget = {
            x: closestTarget.x - Math.cos(adjustmentAngle) * OPTIMAL_COMBAT_DISTANCE,
            y: closestTarget.y - Math.sin(adjustmentAngle) * OPTIMAL_COMBAT_DISTANCE
        };
    }

    const dxToMovementTarget = movementTarget.x - tank.x;
    const dyToMovementTarget = movementTarget.y - tank.y;
    const angleToMovementTarget = Math.atan2(dyToMovementTarget, dxToMovementTarget);
    const distanceToMovementTarget = Math.sqrt(dxToMovementTarget * dxToMovementTarget + dyToMovementTarget * dyToMovementTarget);

    // Turret aiming: Predict target's future position
    const bulletSpeed = 10;
    const timeToTarget = currentDistance / bulletSpeed;
    const predictedTargetX = closestTarget.x + Math.cos(closestTarget.angle) * closestTarget.speed * timeToTarget * 2;
    const predictedTargetY = closestTarget.y + Math.sin(closestTarget.angle) * closestTarget.speed * timeToTarget * 2;
    const dxToPredictedTarget = predictedTargetX - tank.x;
    const dyToPredictedTarget = predictedTargetY - tank.y;

    // AI directly sets its absolute turret angle
    tank.turretAbsoluteAngle = Math.atan2(dyToPredictedTarget, dxToPredictedTarget);

    // SIMPLE MOVEMENT: Move toward strategic position
    const desiredDirection = angleToMovementTarget;

    // Handle stuck tanks with improved unstuck maneuver
    if (tank.isStuck) {
        if (!tank.unstuckStartTime) {
            // Initialize unstuck maneuver
            tank.unstuckStartTime = Date.now();
            tank.unstuckDirection = Math.random() > 0.5 ? 1 : -1; // Random turn direction
            tank.unstuckPhase = 'reverse'; // Start by reversing
            tank.aiState = 'unstucking';
        }

        const unstuckTime = Date.now() - tank.unstuckStartTime;
        
        if (tank.unstuckPhase === 'reverse' && unstuckTime < 1000) {
            // Phase 1: Reverse for 1 second
            const prevX = tank.x, prevY = tank.y;
            tank.x -= Math.cos(tank.angle) * tank.speed * 0.8;
            tank.y -= Math.sin(tank.angle) * tank.speed * 0.8;
            tank.checkBoundsAndCollisions(prevX, prevY);
        } else if (tank.unstuckPhase === 'reverse') {
            // Switch to turning phase
            tank.unstuckPhase = 'turn';
            tank.unstuckStartTime = Date.now(); // Reset timer for turn phase
        }
        
        if (tank.unstuckPhase === 'turn' && unstuckTime < 1500) {
            // Phase 2: Turn for 1.5 seconds
            tank.angle += tank.turnSpeed * tank.unstuckDirection * 3; // Turn faster when stuck
        } else if (tank.unstuckPhase === 'turn') {
            // Unstuck maneuver complete, reset
            tank.isStuck = false;
            tank.stuckStartTime = null;
            tank.unstuckStartTime = null;
            tank.unstuckDirection = 0;
            tank.unstuckPhase = null;
            tank.aiState = 'moving';
            tank.positionHistory = []; // Clear position history to avoid immediate re-stuck detection
        }

    } else {
        // STRATEGIC MOVEMENT: Move to maintain optimal combat distance
        tank.aiState = 'moving';
        
        // Calculate smooth turn towards desired direction
        const currentAngle = tank.angle;
        let angleDifference = normalizeAngle(desiredDirection - currentAngle);
        
        // FAST TURNING: Turn quickly to face target
        const turnRate = tank.turnSpeed * 2.2;
        
        // Apply smooth turning
        const turnAmount = Math.sign(angleDifference) * Math.min(Math.abs(angleDifference), turnRate);
        tank.angle += turnAmount;
        
        // STRATEGIC MOVEMENT SPEED based on combat situation
        const angleAlignmentThreshold = Math.PI / 3; // 60 degrees
        const isWellAligned = Math.abs(angleDifference) < angleAlignmentThreshold;
        
        let movementSpeed = tank.speed;
        
        if (shouldRetreat) {
            // Retreating - move at full speed away from enemy
            movementSpeed = tank.speed * (isWellAligned ? 1.0 : 0.8);
        } else if (shouldApproach && currentDistance > MAX_COMBAT_DISTANCE) {
            // Approaching from long range - move quickly
            movementSpeed = tank.speed * (isWellAligned ? 0.9 : 0.7);
        } else if (distanceToMovementTarget < 50) {
            // Very close to optimal position - slow down
            movementSpeed = tank.speed * 0.4;
        } else {
            // Normal tactical movement - moderate speed
            movementSpeed = tank.speed * (isWellAligned ? 0.7 : 0.5);
        }
        
        // Apply movement
        const prevX = tank.x, prevY = tank.y;
        tank.x += Math.cos(tank.angle) * movementSpeed;
        tank.y += Math.sin(tank.angle) * movementSpeed;
        tank.checkBoundsAndCollisions(prevX, prevY);
    }

    // AGGRESSIVE SHOOTING LOGIC: Target obstacles blocking path first, then enemy tanks
    const now = Date.now();
    if (now - tank.lastShotTime > tank.cooldown) {
        const tankCenterX = tank.x + tank.width / 2;
        const tankCenterY = tank.y + tank.height / 2;
        const targetCenterX = closestTarget.x + closestTarget.width / 2;
        const targetCenterY = closestTarget.y + closestTarget.height / 2;

        // Find obstacles blocking the direct path to target
        const blockingObstacles = gameState.obstacles.filter(obs => {
            // Only consider destructible obstacles (not swamps)
            if (!((obs.type === 'tree' && obs.health > 0) || 
                  (obs.type === 'rock' && obs.health > 0) || 
                  (obs.type === 'oilrig' && obs.health > 0) || 
                  (obs.type === 'iglu' && obs.health > 0))) {
                return false;
            }

            const obsBounds = obs.getCollisionBounds();
            const lineX1 = tankCenterX;
            const lineY1 = tankCenterY;
            const lineX2 = targetCenterX;
            const lineY2 = targetCenterY;

            const rectX = obsBounds.x;
            const rectY = obsBounds.y;
            const rectW = obsBounds.width;
            const rectH = obsBounds.height;

            // Check if line from tank to target intersects this obstacle
            const intersectRect = (x1, y1, x2, y2, rx, ry, rw, rh) => {
                const left = rx;
                const right = rx + rw;
                const top = ry;
                const bottom = ry + rh;

                if ((x1 > left && x1 < right && y1 > top && y1 < bottom) ||
                    (x2 > left && x2 < right && y2 > top && y2 < bottom)) {
                    return true;
                }

                const lineLineIntersection = (x1, y1, x2, y2, x3, y3, x4, y4) => {
                    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
                    if (den === 0) return false;
                    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
                    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
                    return t > 0 && t < 1 && u > 0 && u < 1;
                };

                if (lineLineIntersection(x1, y1, x2, y2, left, top, right, top)) return true;
                if (lineLineIntersection(x1, y1, x2, y2, left, bottom, right, bottom)) return true;
                if (lineLineIntersection(x1, y1, x2, y2, left, top, left, bottom)) return true;
                if (lineLineIntersection(x1, y1, x2, y2, right, top, right, bottom)) return true;

                return false;
            };

            return intersectRect(lineX1, lineY1, lineX2, lineY2, rectX, rectY, rectW, rectH);
        });

        // Priority 1: Shoot at closest blocking obstacle
        if (blockingObstacles.length > 0) {
            // Find closest blocking obstacle
            let closestObstacle = null;
            let closestObstacleDistance = Infinity;

            blockingObstacles.forEach(obs => {
                const obsBounds = obs.getCollisionBounds();
                const obsCenterX = obsBounds.x + obsBounds.width / 2;
                const obsCenterY = obsBounds.y + obsBounds.height / 2;
                const distToObstacle = Math.sqrt(
                    Math.pow(obsCenterX - tankCenterX, 2) + 
                    Math.pow(obsCenterY - tankCenterY, 2)
                );
                
                if (distToObstacle < closestObstacleDistance) {
                    closestObstacleDistance = distToObstacle;
                    closestObstacle = obs;
                }
            });

            if (closestObstacle && closestObstacleDistance < 600) { // Only shoot if obstacle is within range
                const obsBounds = closestObstacle.getCollisionBounds();
                const obsCenterX = obsBounds.x + obsBounds.width / 2;
                const obsCenterY = obsBounds.y + obsBounds.height / 2;
                
                // Aim turret at the obstacle
                tank.turretAbsoluteAngle = Math.atan2(obsCenterY - tankCenterY, obsCenterX - tankCenterX);
                
                // Shoot more aggressively at obstacles
                const obstacleAngleDiff = Math.abs(normalizeAngle(tank.turretAbsoluteAngle) - 
                    normalizeAngle(Math.atan2(obsCenterY - tankCenterY, obsCenterX - tankCenterX)));
                const obstacleAccuracy = Math.min(1, 1 - (obstacleAngleDiff / Math.PI));
                
                // Very aggressive shooting at obstacles - low accuracy threshold, high chance
                if (obstacleAccuracy > 0.4 && Math.random() < 0.20) { // Even more aggressive
                    tank.shoot();
                    return; // Skip enemy shooting this frame
                }
            }
        }

        // Priority 2: Shoot at enemy tank (enhanced for strategic combat)
        const lineOfSightClear = blockingObstacles.length === 0;
        const angleDifference = Math.abs(normalizeAngle(tank.turretAbsoluteAngle) - normalizeAngle(angleToTarget));
        const turretAccuracy = Math.min(1, 1 - (angleDifference / Math.PI));

        // Enhanced shooting for strategic combat distance
        const isInOptimalRange = currentDistance >= MIN_COMBAT_DISTANCE && currentDistance <= MAX_COMBAT_DISTANCE;
        let minAccuracyThreshold = 0.8 - tank.aggression * 0.3;
        let randomShotChance = 0.02 + tank.aggression * 0.03;
        
        // Boost shooting when in optimal combat range
        if (isInOptimalRange && lineOfSightClear) {
            minAccuracyThreshold -= 0.2; // Lower accuracy requirement
            randomShotChance += 0.04; // Higher shooting frequency
        }
        
        if (currentDistance < 1000 && turretAccuracy > minAccuracyThreshold && lineOfSightClear && Math.random() < randomShotChance) {
            tank.shoot();
        }
    }
}

// Helper to normalize angles to -PI to PI
function normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}


// --- COLLISION DETECTION ---
function checkCollision(rect1, rect2) {
    // This is an Axis-Aligned Bounding Box (AABB) collision check
    // Ensure rect1 and rect2 have x, y, width, height properties
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

// --- VIEWPORT CULLING (Performance optimization for multiplayer) ---
function isInViewport(obj) {
    // Skip culling in single player or for player tank
    if (!isMultiplayer || obj.isPlayer) return true;
    
    // Use performance manager if available for more sophisticated culling
    if (performanceManager) {
        const camera = {
            x: gameState.cameraX,
            y: gameState.cameraY
        };
        const canvasSize = {
            width: canvas.width,
            height: canvas.height
        };
        
        // Use performance manager's viewport culling
        return performanceManager._isObjectInViewport(obj, {
            left: camera.x - performanceManager.VIEWPORT_CULLING_MARGIN,
            right: camera.x + canvasSize.width + performanceManager.VIEWPORT_CULLING_MARGIN,
            top: camera.y - performanceManager.VIEWPORT_CULLING_MARGIN,
            bottom: camera.y + canvasSize.height + performanceManager.VIEWPORT_CULLING_MARGIN
        });
    }
    
    // Fallback to original implementation
    const viewportX = gameState.cameraX;
    const viewportY = gameState.cameraY;
    const viewportW = canvas.width;
    const viewportH = canvas.height;
    
    // Check if object is within viewport bounds + margin
    return obj.x + (obj.width || 32) > viewportX - VIEWPORT_CULLING_MARGIN &&
           obj.x < viewportX + viewportW + VIEWPORT_CULLING_MARGIN &&
           obj.y + (obj.height || 32) > viewportY - VIEWPORT_CULLING_MARGIN &&
           obj.y < viewportY + viewportH + VIEWPORT_CULLING_MARGIN;
}

function handleCollisions() {
    const bulletsToRemove = [];

    bulletManager.activeBullets.forEach((bullet, index) => {
        let hit = false;

        // Filter out tanks that are already dead to prevent ghost collisions
        const livingPlayer = gameState.player && gameState.player.health > 0 ? gameState.player : null;
        const livingAllies = gameState.allies.filter(ally => ally.health > 0);
        const livingEnemies = gameState.enemies.filter(enemy => enemy.health > 0);

        // Check collision with player (only if player tank exists)
        if (livingPlayer && bullet.owner !== livingPlayer && checkCollision({x: bullet.x, y: bullet.y, width: 1, height: 1}, livingPlayer)) {
            livingPlayer.takeDamage(bullet.damage, bullet.owner); // Pass attacker
            hit = true;
        }

        // Check collision with allies
        livingAllies.forEach(ally => {
            if (bullet.owner !== ally && checkCollision({x: bullet.x, y: bullet.y, width: 1, height: 1}, ally)) {
                ally.takeDamage(bullet.damage, bullet.owner); // Pass attacker
                hit = true;
            }
        });

        // Check collision with enemies
        livingEnemies.forEach(enemy => {
            if (bullet.owner !== enemy && checkCollision({x: bullet.x, y: bullet.y, width: 1, height: 1}, enemy)) {
                enemy.takeDamage(bullet.damage, bullet.owner); // Pass attacker
                hit = true;
            }
        });

        // Check collision with obstacles (trees, rocks, oilrigs, iglu)
        gameState.obstacles.forEach(obs => {
            const obsBounds = obs.getCollisionBounds();
            if (!obsBounds) return; // Skip if no valid bounds

            if (checkCollision({x: bullet.x, y: bullet.y, width: 1, height: 1}, obsBounds)) {
                if (obs.type === 'tree' && obs.health > 0) { // Only hit if tree is alive
                    obs.takeDamage(bullet.damage, bullet.owner); // Pass attacker to obstacle
                    hit = true;
                } else if (obs.type === 'oilrig' && obs.health > 0) { // Oilrig is destructible
                    obs.takeDamage(bullet.damage, bullet.owner);
                    hit = true;
                } else if (obs.type === 'iglu' && obs.health > 0) { // Iglu is destructible
                    obs.takeDamage(bullet.damage, bullet.owner);
                    hit = true;
                } else if (obs.type === 'rock' && obs.health > 0) { // Rocks are now destructible
                    obs.takeDamage(bullet.damage, bullet.owner);
                    hit = true;
                }
            }
        });

        if (hit) {
            bulletsToRemove.push(index);
        }
    });

    // Remove bullets from manager in reverse order to maintain indices
    for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
        bulletManager.removeBullet(bulletsToRemove[i]);
    }

    // Remove dead tanks
    gameState.allies = gameState.allies.filter(ally => ally.health > 0);
    gameState.enemies = gameState.enemies.filter(enemy => enemy.health > 0);
    // Remove destroyed trees (already handled in Obstacle.takeDamage, but filter just in case)
    gameState.obstacles = gameState.obstacles.filter(obs => obs.type !== 'tree' || obs.health > 0);
}

// --- CAMERA CONTROL ---
function updateCamera() {
    if (gameState.isSpectating) {
        // Camera movement is handled in the update() function directly when in spectator mode
        return;
    }
    
    if (!gameState.player) return; // If player tank is destroyed, don't follow it

    // Camera will follow the player directly
    const targetX = gameState.player.x + gameState.player.width / 2;
    const targetY = gameState.player.y + gameState.player.height / 2;

    // The camera will always display the same size viewport (canvas.width, canvas.height)
    // The player should be in the center of this viewport
    let newCameraX = targetX - canvas.width / 2;
    let newCameraY = targetY - canvas.height / 2;

    // Clamp camera to arena boundaries
    // Make sure camera doesn't show outside the arena
    newCameraX = Math.max(0, Math.min(newCameraX, gameState.arenaWidth - canvas.width));
    newCameraY = Math.max(0, Math.min(newCameraY, gameState.arenaHeight - canvas.height));

    // Smooth camera movement (optional, but makes it less jarring)
    const smoothFactor = 0.05;
    gameState.cameraX += (newCameraX - gameState.cameraX) * smoothFactor;
    gameState.cameraY += (newCameraY - gameState.cameraY) * smoothFactor;

    // Ensure camera stays within arena bounds after smoothing
    gameState.cameraX = Math.max(0, Math.min(gameState.cameraX, gameState.arenaWidth - canvas.width));
    gameState.cameraY = Math.max(0, Math.min(gameState.cameraY, gameState.arenaHeight - canvas.height));
}


// --- DRAWING (Rendering) ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // No camera zoom here, it's fixed at 1
    ctx.translate(-gameState.cameraX, -gameState.cameraY);

    // Reset viewport culling stats for this frame
    viewportCuller.resetStats();

    // Draw background texture (grass or dessert)
    if (gameState.currentFloorTexture && gameState.currentFloorTexture.complete && gameState.currentFloorTexture.naturalWidth !== 0) {
        const pattern = ctx.createPattern(gameState.currentFloorTexture, 'repeat');
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, gameState.arenaWidth, gameState.arenaHeight);
    } else {
        ctx.fillStyle = gameState.selectedMap === '2' ? '#e2c28b' : '#3c523c';
        ctx.fillRect(0, 0, gameState.arenaWidth, gameState.arenaHeight);
    }

    // Use our enhanced viewport culling system
    const visibleTracks = viewportCuller.filterVisible(gameState.tracks, 'tracks');
    const visibleShotEffects = viewportCuller.filterVisible(gameState.shotEffects, 'shotEffects');
    const visibleHitEffects = viewportCuller.filterVisible(gameState.hitEffects, 'hitEffects');
    
    // Obstacles need special handling due to different types
    const visibleObstacles = gameState.obstacles.filter(obs => viewportCuller.isVisible(obs));
    
    // Draw culled objects
    visibleTracks.forEach(track => track.draw());
    
    // Draw terrain obstacles (swamp, rock, oilrig) with culling
    visibleObstacles.forEach(obs => {
        if (obs.type === 'swamp' || obs.type === 'rock' || obs.type === 'oilrig') {
            obs.draw();
        }
    });
    
    // Draw igloos above the floor (for Map 3) with culling
    visibleObstacles.forEach(obs => {
        if (obs.type === 'iglu') {
            obs.draw();
        }
    });

    // Draw tanks (always visible for gameplay, but we can still cull distant ones)
    const allTanks = [gameState.player, ...gameState.allies, ...gameState.enemies].filter(t => t);
    const visibleTanks = viewportCuller.filterVisible(allTanks, 'tanks');
    
    visibleTanks.forEach(tank => {
        if (tank === gameState.player) {
            tank.draw(); // Always draw player
        } else if (viewportCuller.isVisible(tank)) {
            tank.draw();
        }
    });

    // Draw bullets via pooling system with enhanced culling
    bulletManager.drawBulletsWithCulling(viewportCuller);

    // Draw trees (on top of tanks) with culling
    visibleObstacles.forEach(obs => {
        if (obs.type === 'tree') {
            obs.draw();
        }
    });

    // Draw culled effects
    particleManager.drawParticlesWithCulling(viewportCuller);
    visibleShotEffects.forEach(s => s.draw());
    visibleHitEffects.forEach(h => h.draw());

    // Debug viewport bounds if enabled
    viewportCuller.drawViewportBounds();

    ctx.restore();

    // Update HUD (drawn without camera transformation)
    updateHUD();
    
    // Draw Performance Dashboard for multiplayer
    if (isMultiplayer && performanceManager && networkManager && predictionManager) {
        drawPerformanceDashboard();
    }
    
    // Log culling stats occasionally
    if (Math.random() < 0.02) { // 2% chance per frame
        const stats = viewportCuller.getStats();
        console.log('🔍 Viewport Culling Stats:', stats);
    }
}

// === PERFORMANCE DASHBOARD ===
let performanceDashboardVisible = false;

function drawPerformanceDashboard() {
    if (!performanceDashboardVisible) return;
    
    const dashboard = document.getElementById('performance-dashboard');
    
    if (!dashboard) {
        createPerformanceDashboard();
        return;
    }
    
    // Get all stats
    const perfStats = performanceManager.getPerformanceStats();
    const networkStats = networkManager.getNetworkStats();
    const predictionStats = predictionManager.getPredictionStats();
    const poolStats = {
        bullets: bulletManager.getStats(),
        particles: particleManager.getStats()
    };
    
    // Update dashboard content
    dashboard.innerHTML = `
        <div class="perf-section">
            <h3>🚀 Performance</h3>
            <div>Level: <span class="perf-${perfStats.level}">${perfStats.level.toUpperCase()}</span></div>
            <div>Frame Time: ${perfStats.frameTime}ms</div>
            <div>Update Rate: ${perfStats.updateRate}%</div>
        </div>
        
        <div class="perf-section">
            <h3>🌐 Network</h3>
            <div>Latency: ${networkStats.latency}ms</div>
            <div>Bandwidth: <span class="perf-${networkStats.bandwidth}">${networkStats.bandwidth.toUpperCase()}</span></div>
            <div>Batched Events: ${networkStats.batchedEvents}</div>
        </div>
        
        <div class="perf-section">
            <h3>🎯 Prediction</h3>
            <div>Active: ${predictionStats.activePredictions}</div>
            <div>Interpolations: ${predictionStats.activeInterpolations}</div>
            <div>Sequence: ${predictionStats.sequenceNumber}</div>
        </div>
        
        <div class="perf-section">
            <h3>🔄 Pooling</h3>
            <div>Bullets: ${poolStats.bullets.reused}/${poolStats.bullets.created} (${((poolStats.bullets.reused / Math.max(poolStats.bullets.created, 1)) * 100).toFixed(1)}%)</div>
            <div>Particles: ${poolStats.particles.reused}/${poolStats.particles.created} (${((poolStats.particles.reused / Math.max(poolStats.particles.created, 1)) * 100).toFixed(1)}%)</div>
        </div>
    `;
}

function createPerformanceDashboard() {
    const dashboard = document.createElement('div');
    dashboard.id = 'performance-dashboard';
    dashboard.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 15px;
        border-radius: 8px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        min-width: 200px;
        z-index: 1000;
        border: 2px solid #333;
        backdrop-filter: blur(5px);
    `;
    
    // Add CSS for performance levels
    const style = document.createElement('style');
    style.textContent = `
        .perf-section {
            margin-bottom: 10px;
            border-bottom: 1px solid #444;
            padding-bottom: 5px;
        }
        .perf-section h3 {
            margin: 0 0 5px 0;
            color: #4CAF50;
            font-size: 13px;
        }
        .perf-section div {
            margin: 2px 0;
            font-size: 11px;
        }
        .perf-high { color: #4CAF50; }
        .perf-medium { color: #FF9800; }
        .perf-low { color: #F44336; }
        .perf-good { color: #4CAF50; }
        .perf-fair { color: #FF9800; }
        .perf-poor { color: #F44336; }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(dashboard);
}

// Toggle performance dashboard with F3 key
function togglePerformanceDashboard() {
    performanceDashboardVisible = !performanceDashboardVisible;
    
    const dashboard = document.getElementById('performance-dashboard');
    if (dashboard) {
        dashboard.style.display = performanceDashboardVisible ? 'block' : 'none';
    }
    
    console.log('🎛️ Performance Dashboard:', performanceDashboardVisible ? 'ON' : 'OFF');
}

// Add F3 key listener for performance dashboard
document.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
        e.preventDefault();
        togglePerformanceDashboard();
    }
});

function updateHUD() {
    updateBulletSelectionUI();
// Update bullet selection UI highlight
function updateBulletSelectionUI() {
    if (!bulletSelectionUI) return;
    bulletOptions.forEach(opt => {
        const bulletType = parseInt(opt.getAttribute('data-bullet'));
        if (bulletType === gameState.selectedBulletType) {
            opt.classList.add('selected');
        } else {
            opt.classList.remove('selected');
        }
        // Show/hide coin cost visually if not enough coins
        if (bulletType === 2) {
            const costDiv = opt.querySelector('.bullet-cost');
            if (costDiv) {
                if (gameState.playerCoins < 30) {
                    costDiv.style.color = '#e74c3c';
                } else {
                    costDiv.style.color = '#f1c40f';
                }
            }
        }
    });
}
    // Update alive tank counts
    const livingAlliesCount = gameState.allies.filter(ally => ally.health > 0).length + (gameState.player && gameState.player.health > 0 ? 1 : 0);
    const livingEnemiesCount = gameState.enemies.filter(enemy => enemy.health > 0).length;

    // --- Aktualizácia mien a fotiek tímov ---
    // Player team
    if (gameState.player && gameState.player.character) {
        playerTeamNameDisplay.innerText = `${gameState.player.character.name}: ${livingAlliesCount}`;
        playerCharImg.src = gameState.charImages[gameState.player.characterKey]?.src || '';
    } else {
        playerTeamNameDisplay.innerText = `Tím A: ${livingAlliesCount}`;
        playerCharImg.src = '';
    }
    // Enemy team
    if (gameState.enemies.length > 0 && gameState.enemies[0].character) {
        enemyTeamNameDisplay.innerText = `${gameState.enemies[0].character.name}: ${livingEnemiesCount}`;
        enemyCharImg.src = gameState.charImages[gameState.enemies[0].characterKey]?.src || '';
    } else {
        enemyTeamNameDisplay.innerText = `Tím B: ${livingEnemiesCount}`;
        enemyCharImg.src = '';
    }

    // --- Render team heads ---
    const playerTeamHeads = document.getElementById('player-team-heads');
    const enemyTeamHeads = document.getElementById('enemy-team-heads');
    if (playerTeamHeads) {
        playerTeamHeads.innerHTML = '';
        // Player first
        if (gameState.player && gameState.player.characterKey) {
            const img = document.createElement('img');
            img.src = gameState.charImages[gameState.player.characterKey]?.src || '';
            img.className = 'mini-head';
            img.title = gameState.player.character?.name || '';
            playerTeamHeads.appendChild(img);
        }
        // Allies
        gameState.allies.forEach(ally => {
            if (ally.characterKey) {
                const img = document.createElement('img');
                img.src = gameState.charImages[ally.characterKey]?.src || '';
                img.className = 'mini-head';
                img.title = ally.character?.name || '';
                playerTeamHeads.appendChild(img);
            }
        });
    }
    if (enemyTeamHeads) {
        enemyTeamHeads.innerHTML = '';
        gameState.enemies.forEach(enemy => {
            if (enemy.characterKey) {
                const img = document.createElement('img');
                img.src = gameState.charImages[enemy.characterKey]?.src || '';
                img.className = 'mini-head';
                img.title = enemy.character?.name || '';
                enemyTeamHeads.appendChild(img);
            }
        });
    }

    // Update player coin display
    playerCoinsDisplay.innerText = gameState.playerCoins;
}

// --- MINIMAP DRAWING ---
function drawMinimap() {
    if (!minimapCtx) return; // No need for player check, just draw map

    minimapCtx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.5)'; // Dark translucent background
    minimapCtx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    minimapCtx.strokeStyle = '#555';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Calculate scaling factor for minimap
    const scaleX = MINIMAP_SIZE / gameState.arenaWidth;
    const scaleY = MINIMAP_SIZE / gameState.arenaHeight;

    // Draw obstacles on minimap (simplified)
    gameState.obstacles.forEach(obs => {
        let color = '#7f8c8d'; // Default for rocks
        if (obs.type === 'tree') color = '#27ae60';
        else if (obs.type === 'swamp') color = '#526e35';

        minimapCtx.fillStyle = color;
        // For obstacles, draw them based on their actual type
        if (obs.type === 'tree' || obs.type === 'swamp') {
            minimapCtx.beginPath();
            minimapCtx.arc(
                obs.x * scaleX,
                obs.y * scaleY,
                obs.radiusX * scaleX, // Use radius for circle
                0, Math.PI * 2
            );
            minimapCtx.fill();
        } else {
            minimapCtx.fillRect(
                obs.x * scaleX,
                obs.y * scaleY,
                obs.width * scaleX,
                obs.height * scaleY
            );
        }
    });


    // Draw tanks on minimap
    const drawTankOnMinimap = (tank, color) => {
        if (tank.health <= 0) return; // Don't draw dead tanks
        const tankCenterX = tank.x + tank.width / 2;
        const tankCenterY = tank.y + tank.height / 2;

        minimapCtx.beginPath();
        minimapCtx.arc(tankCenterX * scaleX, tankCenterY * scaleY, 4, 0, Math.PI * 2); // Small circle
        minimapCtx.fillStyle = color;
        minimapCtx.fill();
        minimapCtx.strokeStyle = 'black';
        minimapCtx.lineWidth = 0.5;
        minimapCtx.stroke();
    };

    // Player (Yellow) - Only draw if player tank exists
    if (gameState.player && gameState.player.health > 0) {
        drawTankOnMinimap(gameState.player, '#FFFF00'); // Yellow
    }

    // Allies (Blue)
    gameState.allies.forEach(ally => {
        drawTankOnMinimap(ally, '#87CEEB'); // Light Blue
    });

    // Enemies (Red)
    gameState.enemies.forEach(enemy => {
        drawTankOnMinimap(enemy, '#FF6347'); // Tomato Red
    });

    // Draw camera viewport on minimap (rectangle)
    minimapCtx.strokeStyle = 'white';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(
        gameState.cameraX * scaleX,
        gameState.cameraY * scaleY,
        canvas.width * scaleX,
        canvas.height * scaleY
    );
}

// --- ROUND AND GAME LOGIC ---
function checkRoundEnd() {
    if (gameState.roundOver) return;

    // Handle multiplayer differently from single player
    if (isMultiplayer) {
        // In multiplayer, the server handles game ending
        // Client just handles local UI state when notified
        return;
    }

    // Single player logic remains the same
    let winner = null;
    // Check for alive tanks in player's team (player OR allies)
    const playerTeamAlive = (gameState.player && gameState.player.health > 0) || gameState.allies.some(ally => ally.health > 0);
    // Check for alive tanks in enemy team
    const enemyTeamAlive = gameState.enemies.some(enemy => enemy.health > 0);

    if (!playerTeamAlive) {
        winner = 'enemy';
    } else if (!enemyTeamAlive) {
        winner = 'player';
    }

    if (winner) {
        endRound(winner);
    }
}

// Handle multiplayer player elimination
function handlePlayerElimination(playerName) {
    if (!isMultiplayer || !socket) return;
    
    try {
        // Emit elimination event to server with error handling
        socket.emit('player-eliminated', {
            playerName: playerName || 'Unknown Player',
            timestamp: Date.now()
        });
        
        console.log(`Player ${playerName} eliminated and reported to server`);
    } catch (error) {
        console.error('Failed to report player elimination:', error);
    }
}

// Enhanced multiplayer death handling
function handleMultiplayerDeath(playerId, killedPlayerName) {
    if (!isMultiplayer) return;
    
    try {
        // Check if the dead player is the current player
        if (playerId === socket?.id) {
            // Current player died
            gameState.player = null;
            gameState.isSpectating = true;
            
            // Report elimination
            handlePlayerElimination(killedPlayerName);
            
            // Update UI to spectator mode
            showSpectatorMessage();
        } else {
            // Another player died, remove from multiplayer tanks
            if (multiplayerTanks.has(playerId)) {
                multiplayerTanks.delete(playerId);
            }
        }
    } catch (error) {
        console.error('Error handling multiplayer death:', error);
    }
}

function showSpectatorMessage() {
    // Show spectator UI if available
    const spectatorUI = document.getElementById('spectator-ui');
    if (spectatorUI) {
        spectatorUI.style.display = 'block';
    }
    
    // Add spectator message to game area
    const gameArea = document.getElementById('gameArea');
    if (gameArea) {
        let spectatorMsg = document.getElementById('spectator-message');
        if (!spectatorMsg) {
            spectatorMsg = document.createElement('div');
            spectatorMsg.id = 'spectator-message';
            spectatorMsg.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px;
                border-radius: 10px;
                text-align: center;
                z-index: 1000;
                font-size: 18px;
            `;
            spectatorMsg.innerHTML = `
                <h3>Ste eliminovaný!</h3>
                <p>Sledujete hru ako divák.</p>
                <p>Pohyb: WASD</p>
            `;
            gameArea.appendChild(spectatorMsg);
        }
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (spectatorMsg) {
                spectatorMsg.style.opacity = '0.5';
            }
        }, 5000);
    }
}

function showEliminationMessage(data) {
    const message = data.playerId === socket?.id ? 
        'Boli ste eliminovaný!' : 
        `${data.playerName} bol eliminovaný!`;
    
    showNotification(message, 'info', 3000);
}

function showDisconnectionMessage(data) {
    const message = `${data.playerName} sa odpojil zo hry`;
    showNotification(message, 'warning', 3000);
}

function updateHostUI() {
    // Update host indicators in UI
    const hostIndicators = document.querySelectorAll('.host-indicator');
    hostIndicators.forEach(indicator => {
        indicator.style.display = isHost ? 'block' : 'none';
    });
    
    // Update buttons that only host can use
    const hostOnlyButtons = document.querySelectorAll('.host-only');
    hostOnlyButtons.forEach(button => {
        button.disabled = !isHost;
        if (isHost) {
            button.classList.remove('disabled');
        } else {
            button.classList.add('disabled');
        }
    });
}

function showNotification(message, type = 'info', duration = 3000) {
    // Create notification element if it doesn't exist
    let notificationContainer = document.getElementById('notification-container');
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        notificationContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            max-width: 300px;
        `;
        document.body.appendChild(notificationContainer);
    }
    
    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        background: ${type === 'error' ? '#f44336' : type === 'warning' ? '#ff9800' : '#4caf50'};
        color: white;
        padding: 12px 16px;
        border-radius: 4px;
        margin-bottom: 10px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease-out;
        opacity: 1;
        transition: opacity 0.3s ease;
    `;
    notification.textContent = message;
    
    // Add animation styles if not already added
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    notificationContainer.appendChild(notification);
    
    // Auto remove
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, duration);
}

function endRound(winner) {
    gameState.roundOver = true;
    clearInterval(gameState.gameInterval);

    let message = "Remíza!";
    if (winner === 'player') {
        gameState.playerScore++;
        message = "Vyhral si kolo!";
    } else if (winner === 'enemy') {
        gameState.enemyScore++;
        message = "Prehral si kolo!";
    }

    roundMessage.innerText = message;
    roundMessage.style.display = 'block';

    // Show round result card with captains and score
    showRoundResultCard();
    // Delay before starting a new round or ending the game completely
    setTimeout(() => {
        hideRoundResultCard();
        if (gameState.playerScore >= ROUNDS_TO_WIN) {
            endGame(true);
        } else if (gameState.enemyScore >= ROUNDS_TO_WIN) {
            endGame(false);
        } else {
            // Re-create obstacles for the new round to have a fresh map
            createObstacles(GAME_MODES[gameState.currentMode].obstacleDensity);
            if (gameState.selectedMap === '3' && typeof createIglus === 'function') {
                createIglus();
            }
            startNewRound();
        }
    }, 3000);
}
// --- ROUND RESULT CARD LOGIC ---

function showRoundResultCard() {
    const card = document.getElementById('round-result-card');
    if (!card) return;
    // Player captain
    const playerImg = document.getElementById('round-result-player-img');
    const playerName = document.getElementById('round-result-player-name');
    let playerCharKey = null;
    if (gameState.selectedPlayerChar && gameState.selectedPlayerChar.key) {
        playerCharKey = gameState.selectedPlayerChar.key;
    } else if (gameState.selectedPlayerChar) {
        // Try to find key by name
        const charKeys = Object.keys(CHARACTERS);
        playerCharKey = charKeys.find(k => CHARACTERS[k].name === gameState.selectedPlayerChar.name) || charKeys[0];
    }
    playerImg.src = (gameState.charImages && playerCharKey && gameState.charImages[playerCharKey]) ? gameState.charImages[playerCharKey].src : '';
    playerName.textContent = (gameState.selectedPlayerChar && gameState.selectedPlayerChar.name) ? gameState.selectedPlayerChar.name : '';
    // Enemy captain
    const enemyImg = document.getElementById('round-result-enemy-img');
    const enemyName = document.getElementById('round-result-enemy-name');
    let enemyCharKey = null;
    if (gameState.selectedEnemyChar && gameState.selectedEnemyChar.key) {
        enemyCharKey = gameState.selectedEnemyChar.key;
    } else if (gameState.selectedEnemyChar) {
        const charKeys = Object.keys(CHARACTERS);
        enemyCharKey = charKeys.find(k => CHARACTERS[k].name === gameState.selectedEnemyChar.name) || charKeys[0];
    }
    enemyImg.src = (gameState.charImages && enemyCharKey && gameState.charImages[enemyCharKey]) ? gameState.charImages[enemyCharKey].src : '';
    enemyName.textContent = (gameState.selectedEnemyChar && gameState.selectedEnemyChar.name) ? gameState.selectedEnemyChar.name : '';
    // Score
    const score = document.getElementById('round-result-score');
    score.textContent = `${gameState.playerScore} : ${gameState.enemyScore}`;
    card.style.display = 'flex';
}

function hideRoundResultCard() {
    const card = document.getElementById('round-result-card');
    if (card) card.style.display = 'none';
}

function endGame(playerWon) {
    stopGame();
    endMessage.innerText = playerWon ? "Vyhral si vojnu!" : "Prehral si...";
    showScreen('endScreen');

    // Set background image if player won
    const endScreen = document.getElementById('end-screen');
    if (endScreen) {
        if (playerWon) {
            endScreen.style.background = 'url("Win_image.png") center center / cover no-repeat';
        } else {
            endScreen.style.background = '';
        }
    }
}

// --- COIN SYSTEM FUNCTIONS ---

// Function to add coins to the player's total
function addCoins(amount) {
    if (gameState.playerCoins === undefined) {
        gameState.playerCoins = 0; // Initialize if somehow not set
    }
    gameState.playerCoins += amount;
    saveCoins(); // Save coins to localStorage
    updateHUD(); // Update display immediately
}

// Function to save coins to localStorage
function saveCoins() {
    try {
        localStorage.setItem('playerCoins', gameState.playerCoins.toString());
    } catch (e) {
        console.error("Error saving coins to localStorage:", e);
    }
}

// Function to load coins from localStorage
function loadCoins() {
    try {
        const storedCoins = localStorage.getItem('playerCoins');
        if (storedCoins !== null) {
            gameState.playerCoins = parseInt(storedCoins, 10);
            if (isNaN(gameState.playerCoins)) {
                gameState.playerCoins = 0; // Fallback if parsing fails
            }
        } else {
            gameState.playerCoins = 0; // Default if no coins saved yet
        }
    } catch (e) {
        console.error("Error loading coins from localStorage:", e);
        gameState.playerCoins = 0; // Default in case of error
    }
    updateHUD(); // Update display with loaded coins
}

// --- START UP ---
// --- CHARACTER SELECTION KEYBOARD SCROLLING ---
function enableCharacterCardKeyboardScroll() {
    const container = document.querySelector('.character-cards');
    if (!container) return;
    let focusedIndex = 0;
    const cards = Array.from(container.querySelectorAll('.character-card'));
    if (cards.length === 0) return;

    // Helper to focus a card visually
    function focusCard(idx) {
        cards.forEach(card => card.classList.remove('focused'));
        cards[idx].classList.add('focused');
        // Scroll into view if needed
        cards[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Initial focus
    focusCard(focusedIndex);

    container.tabIndex = 0; // Make container focusable
    container.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            // Move down by 4 (one row)
            focusedIndex = Math.min(focusedIndex + 4, cards.length - 1);
            focusCard(focusedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusedIndex = Math.max(focusedIndex - 4, 0);
            focusCard(focusedIndex);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            focusedIndex = Math.min(focusedIndex + 1, cards.length - 1);
            focusCard(focusedIndex);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            focusedIndex = Math.max(focusedIndex - 1, 0);
            focusCard(focusedIndex);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cards[focusedIndex].click();
        }
    });

    // Mouse click also sets focus
    cards.forEach((card, idx) => {
        card.addEventListener('mousedown', () => {
            focusedIndex = idx;
            focusCard(focusedIndex);
        });
    });
}

// Add focus style for focused card
const style = document.createElement('style');
style.innerHTML = `.character-card.focused { outline: 3px solid #f1c40f; z-index: 2; }`;
document.head.appendChild(style);

// Call after DOM is ready
setTimeout(enableCharacterCardKeyboardScroll, 0);

// --- MULTIPLAYER GAME MODE SELECTION ---

function initMultiplayerModeSelection() {
    const gameModeCards = document.querySelectorAll('.game-mode-card');
    
    gameModeCards.forEach(card => {
        card.addEventListener('click', () => {
            selectedGameMode = card.dataset.mode;
            
            // Remove previous selection
            gameModeCards.forEach(c => c.classList.remove('selected'));
            
            // Add selection to clicked card
            card.classList.add('selected');
            
            // Start multiplayer with selected mode
            setTimeout(() => {
                initMultiplayer(selectedGameMode);
                showScreen('multiplayerLobby');
                // Scroll to top when entering lobby
                setTimeout(() => {
                    window.scrollTo({ top: 0, behavior: 'instant' });
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                }, 50);
            }, 300);
        });
    });
}

// Function to update team input states based on captain status
function updateTeamInputStates() {
    const blueTeamNameInput = document.getElementById('blue-team-name');
    const redTeamNameInput = document.getElementById('red-team-name');
    
    if (blueTeamNameInput && redTeamNameInput) {
        const isBlueTeamCaptain = playerTeam === 'blue' && teamCaptains.blue === socket.id;
        const isRedTeamCaptain = playerTeam === 'red' && teamCaptains.red === socket.id;
        
        // Update blue team input
        blueTeamNameInput.disabled = !isBlueTeamCaptain;
        blueTeamNameInput.placeholder = isBlueTeamCaptain ? "Zadaj názov tímu..." : (teamNames.blue || "Názov tímu...");
        blueTeamNameInput.style.cursor = isBlueTeamCaptain ? "text" : "default";
        blueTeamNameInput.style.opacity = isBlueTeamCaptain ? "1" : "0.7";
        
        // Update red team input
        redTeamNameInput.disabled = !isRedTeamCaptain;
        redTeamNameInput.placeholder = isRedTeamCaptain ? "Zadaj názov tímu..." : (teamNames.red || "Názov tímu...");
        redTeamNameInput.style.cursor = isRedTeamCaptain ? "text" : "default";
        redTeamNameInput.style.opacity = isRedTeamCaptain ? "1" : "0.7";
        
        // Add visual indicators for captains
        const blueTeamHeader = blueTeamNameInput.closest('.team-header');
        const redTeamHeader = redTeamNameInput.closest('.team-header');
        
        if (blueTeamHeader) {
            blueTeamHeader.classList.toggle('captain-editable', isBlueTeamCaptain);
        }
        if (redTeamHeader) {
            redTeamHeader.classList.toggle('captain-editable', isRedTeamCaptain);
        }
    }
}

function joinTeam(team) {
    if (socket && socket.connected) {
        playerTeam = team;
        socket.emit('join-team', { team: team, playerName: playerName });
        
        // Update UI
        updateTeamUI();
        updateJoinButtonsState();
        updateTeamInputStates();
    }
}

function togglePlayerReady() {
    if (socket && socket.connected) {
        // In combined-selection phase, allow ready without team check (players should already have teams)
        if (currentPhase === 'combined-selection' || playerTeam) {
            const isReady = teamReadyPlayers.has(socket.id);
            
            if (currentPhase === 'combined-selection') {
                // Use team-ready event for combined selection
                socket.emit('team-ready', { ready: !isReady });
            } else {
                // Use toggle-ready event for team selection phase
                socket.emit('toggle-ready', { ready: !isReady });
            }
        }
    }
}

function toggleGameReady() {
    if (socket && socket.connected && currentPhase === 'combined-selection') {
        const isGameReady = gameReadyPlayers && gameReadyPlayers.has(socket.id);
        socket.emit('game-ready', { ready: !isGameReady });
    }
}

function updateGameReadyUI() {
    const gameReadyBtn = document.getElementById('game-ready-btn');
    if (gameReadyBtn && currentPhase === 'combined-selection') {
        const isCurrentPlayerGameReady = gameReadyPlayers.has(socket.id);
        gameReadyBtn.textContent = isCurrentPlayerGameReady ? 'Zrušiť ready na hru' : 'Ready na hru!';
        
        // Update player list to show game ready status
        updatePlayersList();
    }
}

function updateTeamUI() {
    const blueTeamPlayers = document.getElementById('blue-team-players');
    const redTeamPlayers = document.getElementById('red-team-players');
    const blueTeamCount = document.getElementById('blue-team-count');
    const redTeamCount = document.getElementById('red-team-count');
    const readyPlayersCount = document.getElementById('ready-players-count');
    const totalPlayersCount = document.getElementById('total-players-count');
    const teamReadyBtn = document.getElementById('team-ready-btn');

    // Clear team displays
    blueTeamPlayers.innerHTML = '';
    redTeamPlayers.innerHTML = '';

    let bluePlayers = [];
    let redPlayers = [];

    // Sort players into teams
    allPlayers.forEach(player => {
        if (player.team === 'blue') {
            bluePlayers.push(player);
        } else if (player.team === 'red') {
            redPlayers.push(player);
        }
    });

    // Display blue team players
    bluePlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const isReady = teamReadyPlayers.has(player.id);
        const readyIndicator = isReady ? 
            '<span class="player-ready-indicator">Ready</span>' : 
            '<span class="player-not-ready-indicator">Not Ready</span>';
        
        playerElement.innerHTML = `
            <span>${player.name}</span>
            ${readyIndicator}
        `;
        blueTeamPlayers.appendChild(playerElement);
    });

    // Display red team players
    redPlayers.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.className = 'team-player-item';
        
        const isReady = teamReadyPlayers.has(player.id);
        const readyIndicator = isReady ? 
            '<span class="player-ready-indicator">Ready</span>' : 
            '<span class="player-not-ready-indicator">Not Ready</span>';
        
        playerElement.innerHTML = `
            <span>${player.name}</span>
            ${readyIndicator}
        `;
        redTeamPlayers.appendChild(playerElement);
    });

    // Update counts
    blueTeamCount.textContent = `${bluePlayers.length} hráčov`;
    redTeamCount.textContent = `${redPlayers.length} hráčov`;
    readyPlayersCount.textContent = teamReadyPlayers.size;
    totalPlayersCount.textContent = allPlayers.length;

    // Update ready button state
    const currentPlayerReady = teamReadyPlayers.has(socket.id);
    teamReadyBtn.textContent = currentPlayerReady ? 'Zrušiť ready' : 'Som pripravený!';
    
    // In combined-selection phase, keep button enabled even without team
    if (currentPhase === 'combined-selection') {
        teamReadyBtn.disabled = false;
    } else {
        teamReadyBtn.disabled = !playerTeam;
    }
}

function updateJoinButtonsState() {
    const joinButtons = document.querySelectorAll('.join-team-btn');
    
    joinButtons.forEach(btn => {
        const btnTeam = btn.dataset.team;
        if (playerTeam === btnTeam) {
            btn.textContent = `V ${btnTeam === 'blue' ? 'modrom' : 'červenom'} tíme`;
            btn.disabled = true;
        } else {
            btn.textContent = `Pridať sa k ${btnTeam === 'blue' ? 'modrému' : 'červenému'} tímu`;
            btn.disabled = false;
        }
    });
}

// --- SOFT RESET SYSTEM ---
function resetGameState() {
    // Preserve coins
    const savedCoins = gameState.playerCoins;
    
    // Reset all game variables except coins
    gameState.player = null;
    gameState.allies = [];
    gameState.enemies = [];
    bulletManager.removeAllBullets(); // Use bullet manager cleanup
    particleManager.removeAllParticles(); // Use particle manager cleanup
    gameState.obstacles = [];
    gameState.tracks = [];
    gameState.shotEffects = [];
    gameState.hitEffects = [];
    gameState.chasingSquares = [];
    gameState.keys = {};
    gameState.playerScore = 0;
    gameState.enemyScore = 0;
    gameState.roundOver = false;
    gameState.currentMode = null;
    gameState.arenaWidth = 0;
    gameState.arenaHeight = 0;
    gameState.cameraX = 0;
    gameState.cameraY = 0;
    gameState.cameraZoom = 1;
    gameState.teamIndicatorPulse = 0;
    gameState.isSpectating = false;
    gameState.selectedPlayerChar = null;
    gameState.selectedEnemyChar = null;
    gameState.lastAiPositionCheck = Date.now();
    gameState.selectedBulletType = 1;
    
    // Restore coins
    gameState.playerCoins = savedCoins;
    
    // Clear any intervals/animations
    if (gameState.gameInterval) {
        clearInterval(gameState.gameInterval);
        gameState.gameInterval = null;
    }
    if (gameState.animationFrameId) {
        cancelAnimationFrame(gameState.animationFrameId);
        gameState.animationFrameId = null;
    }
    
    // Reset multiplayer state
    isMultiplayer = false;
    currentRoom = null;
    otherPlayers = [];
    isHost = false;
    multiplayerTanks.clear();
    selectedLobbyMap = null;
    selectedLobbyCharacter = null;
    selectedLobbyTank = null;
    playerName = '';
    
    // Disconnect socket if connected
    if (socket && socket.connected) {
        socket.disconnect();
        socket = null;
    }
    
    // Hide pause menu if visible
    if (pauseMenu) pauseMenu.style.display = 'none';
    isPaused = false;
    
    // Save coins to localStorage
    saveCoins();
    
    console.log('Game state reset, coins preserved:', savedCoins);
}

function returnToMainMenu() {
    // Reset game state
    resetGameState();
    
    // Show main menu
    showScreen('mainMenu');
    
    // Update app container for menu
    appContainer.style.width = `${window.innerWidth}px`;
    appContainer.style.height = `${window.innerHeight}px`;
    
    // Hide canvas
    if (canvas) {
        canvas.style.display = 'none';
    }
    
    console.log('Returned to main menu');
}

function reinitializeCharacterSelection() {
    // Get ally counter element and define update function early
    const allyCounter = document.getElementById('character-ally-counter');
    function updateAllyCounter(selected, max) {
        if (!allyCounter) return;
        if (max === 0) {
            allyCounter.textContent = '';
            allyCounter.style.display = 'none';
        } else {
            allyCounter.textContent = `Spolubojovníci: ${selected} / ${max}`;
            allyCounter.style.display = 'block';
        }
    }
    
    // Reset all character selection state directly (since resetCharacterSelection is local to init())
    let commanderSelected = false;
    let selectedCommanderKey = null;
    let selectedAllies = [];
    let maxAllies = 0;
    let selectionInProgress = false;
    
    // Reset enemy selection variables
    let enemyCommanderSelected = false;
    let enemySelectedCommanderKey = null;
    let enemySelectedAllies = [];
    let enemyMaxAllies = 0;
    let enemySelectionInProgress = false;
    
    // Clear all character cards
    const characterCards = document.querySelectorAll('.character-card');
    characterCards.forEach(card => {
        card.classList.remove('commander-selected', 'ally-selected', 'locked', 'dimmed', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
        card.style.filter = '';
        card.style.pointerEvents = '';
        card.style.display = ''; // Make sure all cards are visible
    });
    
    // Set maxAllies based on current mode
    const mode = gameState.currentMode || '1v1';
    maxAllies = GAME_MODES[mode]?.allyCount || 0;
    selectionInProgress = true;
    
    // Update ally counter and initialize
    if (allyCounter) {
        updateAllyCounter(0, maxAllies);
    }
    
    // Reset heading
    const heading = document.querySelector('#character-selection h2');
    if (heading) heading.textContent = 'Vyber Si Svojho Veliteľa';
    
    // Re-get references to elements
    const dalejBtn = document.getElementById('character-dalej-btn');
    
    if (!characterCards.length || !dalejBtn) {
        console.warn('Character selection elements not found during reinitialization');
        return;
    }
    
    // Enable dalej button initially if no allies needed
    if (maxAllies === 0) {
        dalejBtn.disabled = false;
    } else {
        dalejBtn.disabled = true;
    }
    
    // Clear any existing event listeners by cloning and replacing the button
    const newDalejBtn = dalejBtn.cloneNode(true);
    dalejBtn.parentNode.replaceChild(newDalejBtn, dalejBtn);
    
    // Clone and replace character cards to remove old event listeners
    const newCharacterCards = [];
    characterCards.forEach(card => {
        const newCard = card.cloneNode(true);
        card.parentNode.replaceChild(newCard, card);
        newCharacterCards.push(newCard);
    });

    // Set up "Náhodný výber" button
    const nahodnyBtn = document.getElementById('character-nahodny-btn');
    if (nahodnyBtn) {
        const newNahodnyBtn = nahodnyBtn.cloneNode(true);
        nahodnyBtn.parentNode.replaceChild(newNahodnyBtn, nahodnyBtn);
        
        newNahodnyBtn.onclick = () => {
            if (selectionInProgress && !enemySelectionInProgress) {
                // Player team selection - fill missing allies
                const mode = gameState.currentMode || '1v1';
                const allyCount = GAME_MODES[mode]?.allyCount || 0;
                
                // Get all available characters (excluding already selected)
                const charKeys = Object.keys(CHARACTERS);
                const alreadySelected = selectedCommanderKey ? [selectedCommanderKey, ...selectedAllies] : [...selectedAllies];
                const availableChars = charKeys.filter(k => !alreadySelected.includes(k));
                
                // If no commander selected, pick one randomly
                if (!selectedCommanderKey && availableChars.length > 0) {
                    commanderSelected = true;
                    selectedCommanderKey = availableChars[Math.floor(Math.random() * availableChars.length)];
                    selectedAllies = [];
                    
                    // Update visuals
                    newCharacterCards.forEach(card => {
                        card.classList.remove('commander-selected', 'locked', 'dimmed', 'ally-selected', 'random-selected');
                        card.style.filter = '';
                        card.style.pointerEvents = '';
                        
                        if (card.dataset.char === selectedCommanderKey) {
                            card.classList.add('commander-selected', 'locked', 'random-selected');
                            card.style.filter = 'grayscale(0.8) brightness(0.7)';
                            card.style.pointerEvents = 'none';
                        }
                    });
                    
                    const heading = document.querySelector('#character-selection h2');
                    if (heading) heading.textContent = 'Vyber si svojich spolubojovníkov';
                }
                
                // Fill missing allies randomly
                const availableForAllies = charKeys.filter(k => k !== selectedCommanderKey && !selectedAllies.includes(k));
                const neededAllies = allyCount - selectedAllies.length;
                
                for (let i = 0; i < neededAllies && availableForAllies.length > 0; i++) {
                    const randomIndex = Math.floor(Math.random() * availableForAllies.length);
                    const randomAlly = availableForAllies.splice(randomIndex, 1)[0];
                    selectedAllies.push(randomAlly);
                }
                
                // Update all visuals
                newCharacterCards.forEach(card => {
                    const k = card.dataset.char;
                    card.classList.remove('ally-selected', 'dimmed', 'random-selected');
                    
                    if (selectedAllies.includes(k)) {
                        card.classList.add('ally-selected', 'dimmed', 'random-selected');
                        card.style.filter = 'grayscale(0.7) brightness(0.7)';
                    } else if (k !== selectedCommanderKey) {
                        card.style.filter = '';
                        card.style.pointerEvents = '';
                    }
                });
                
                updateAllyCounter(selectedAllies.length, allyCount);
                newDalejBtn.disabled = (selectedAllies.length !== allyCount);
            }
        };
    }
    
    // Set up fresh event listeners
    newCharacterCards.forEach(card => {
        const charKey = card.dataset.char;
        const char = CHARACTERS[charKey];
        
        // Add hover effects for flags
        if (char && char.flag) {
            card.addEventListener('mouseenter', () => {
                card.style.backgroundImage = `url('${char.flag}')`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.backgroundImage = '';
            });
        }
        
        // Add click handler for character selection
        card.addEventListener('click', () => {
            if (!selectionInProgress) return;
            
            // 1. Commander selection phase
            if (!commanderSelected) {
                commanderSelected = true;
                selectedCommanderKey = charKey;
                
                // Clear all cards
                newCharacterCards.forEach(c => {
                    c.classList.remove('commander-selected', 'locked', 'dimmed', 'ally-selected', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                    c.style.filter = '';
                    c.style.pointerEvents = '';
                });
                
                // Mark selected commander
                card.classList.add('commander-selected');
                card.classList.add('locked');
                card.style.filter = 'grayscale(0.8) brightness(0.7)';
                card.style.pointerEvents = 'none';
                
                selectedAllies = [];
                updateAllyCounter(0, maxAllies);
                
                const heading = document.querySelector('#character-selection h2');
                if (heading) heading.textContent = 'Vyber si svojich spolubojovníkov';
                
                if (maxAllies === 0) {
                    newDalejBtn.disabled = false;
                } else {
                    newDalejBtn.disabled = true;
                }
            }
            // 2. Allies selection phase
            else if (commanderSelected && charKey !== selectedCommanderKey) {
                // Toggle selection
                if (!selectedAllies.includes(charKey) && selectedAllies.length < maxAllies) {
                    selectedAllies.push(charKey);
                } else if (selectedAllies.includes(charKey)) {
                    selectedAllies = selectedAllies.filter(k => k !== charKey);
                }
                
                // Update all card visuals for allies
                newCharacterCards.forEach(c => {
                    const k = c.dataset.char;
                    if (selectedAllies.includes(k)) {
                        c.classList.add('ally-selected', 'dimmed');
                        c.style.filter = 'grayscale(0.7) brightness(0.7)';
                    } else {
                        c.classList.remove('ally-selected', 'dimmed');
                        c.style.filter = '';
                    }
                    // Commander card stays locked
                    if (k === selectedCommanderKey) {
                        c.classList.add('commander-selected', 'locked');
                        c.style.filter = 'grayscale(0.8) brightness(0.7)';
                        c.style.pointerEvents = 'none';
                    } else {
                        c.classList.remove('commander-selected', 'locked');
                        c.style.pointerEvents = '';
                    }
                });
                
                updateAllyCounter(selectedAllies.length, maxAllies);
                newDalejBtn.disabled = (selectedAllies.length !== maxAllies);
            }
        });
    });
    
    // Set up "Ďalej" button click handler
    newDalejBtn.onclick = () => {
        if (!commanderSelected) return;
        if (selectedAllies.length !== maxAllies) return;
        
        // Save player selection
        gameState.selectedPlayerChar = CHARACTERS[selectedCommanderKey];
        gameState.selectedAllies = selectedAllies.slice();

        // Start enemy selection phase
        selectionInProgress = false;
        enemyCommanderSelected = false;
        enemySelectedCommanderKey = null;
        enemySelectedAllies = [];
        enemyMaxAllies = maxAllies;
        enemySelectionInProgress = true;

        // Filter out already picked characters
        const exclude = [selectedCommanderKey, ...selectedAllies];
        const availableEnemyChars = Object.keys(CHARACTERS).filter(key => !exclude.includes(key));

        // Show only available characters for enemy selection
        newCharacterCards.forEach(card => {
            const k = card.dataset.char;
            if (availableEnemyChars.includes(k)) {
                card.style.display = '';
                card.classList.remove('commander-selected', 'ally-selected', 'locked', 'dimmed', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                card.style.filter = '';
                card.style.pointerEvents = '';
            } else {
                card.style.display = 'none';
            }
        });

        // Update heading and counter for enemy selection
        const heading = document.querySelector('#character-selection h2');
        if (heading) heading.textContent = 'Vyber nepriateľského veliteľa';
        updateAllyCounter(0, enemyMaxAllies);
        newDalejBtn.disabled = true;

        // Set up enemy selection event listeners
        const enemyCards = [];
        newCharacterCards.forEach(card => {
            const charKey = card.dataset.char;
            const char = CHARACTERS[charKey];
            
            // Clone and replace to remove old listeners
            const newCard = card.cloneNode(true);
            if (card.parentNode) {
                card.parentNode.replaceChild(newCard, card);
                enemyCards.push(newCard);
            }
            
            // Add hover effects
            if (char && char.flag) {
                newCard.addEventListener('mouseenter', () => {
                    newCard.style.backgroundImage = `url('${char.flag}')`;
                });
                newCard.addEventListener('mouseleave', () => {
                    newCard.style.backgroundImage = '';
                });
            }
            
            // Add enemy selection click handler
            newCard.addEventListener('click', () => {
                if (!enemySelectionInProgress) return;
                
                // Enemy commander selection
                if (!enemyCommanderSelected) {
                    enemyCommanderSelected = true;
                    enemySelectedCommanderKey = charKey;
                    
                    // Update all enemy cards
                    enemyCards.forEach(c => {
                        c.classList.remove('commander-selected', 'locked', 'dimmed', 'ally-selected', 'selected-commander', 'selected-ally', 'selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                        c.style.filter = '';
                        c.style.pointerEvents = '';
                    });
                    
                    newCard.classList.add('selected-enemy-commander');
                    newCard.style.filter = 'grayscale(0.8) brightness(0.7)';
                    newCard.style.pointerEvents = 'none';
                    
                    enemySelectedAllies = [];
                    updateAllyCounter(0, enemyMaxAllies);
                    
                    if (heading) heading.textContent = 'Vyber nepriateľských spolubojovníkov';
                    if (enemyMaxAllies === 0) {
                        // Update the actual button reference
                        const currentDalejBtn = document.getElementById('character-dalej-btn');
                        if (currentDalejBtn) currentDalejBtn.disabled = false;
                    } else {
                        const currentDalejBtn = document.getElementById('character-dalej-btn');
                        if (currentDalejBtn) currentDalejBtn.disabled = true;
                    }
                }
                // Enemy allies selection
                else if (enemyCommanderSelected && charKey !== enemySelectedCommanderKey) {
                    if (!enemySelectedAllies.includes(charKey) && enemySelectedAllies.length < enemyMaxAllies) {
                        enemySelectedAllies.push(charKey);
                    } else if (enemySelectedAllies.includes(charKey)) {
                        enemySelectedAllies = enemySelectedAllies.filter(k => k !== charKey);
                    }
                    
                    // Update visuals
                    enemyCards.forEach(c => {
                        const k = c.dataset.char;
                        if (enemySelectedAllies.includes(k)) {
                            c.classList.add('selected-enemy-ally');
                            c.style.filter = 'grayscale(0.7) brightness(0.7)';
                        } else {
                            c.classList.remove('selected-enemy-ally');
                            c.style.filter = '';
                        }
                        if (k === enemySelectedCommanderKey) {
                            c.classList.add('selected-enemy-commander');
                            c.style.filter = 'grayscale(0.8) brightness(0.7)';
                            c.style.pointerEvents = 'none';
                        } else {
                            c.classList.remove('selected-enemy-commander');
                            c.style.pointerEvents = '';
                        }
                    });
                    
                    updateAllyCounter(enemySelectedAllies.length, enemyMaxAllies);
                    // Update the actual button reference
                    const currentDalejBtn = document.getElementById('character-dalej-btn');
                    if (currentDalejBtn) currentDalejBtn.disabled = (enemySelectedAllies.length !== enemyMaxAllies);
                }
            });
        });

        // Reinitialize "Náhodný výber" button for enemy phase
        const currentNahodnyBtn = document.getElementById('character-nahodny-btn');
        if (currentNahodnyBtn) {
            const newEnemyNahodnyBtn = currentNahodnyBtn.cloneNode(true);
            currentNahodnyBtn.parentNode.replaceChild(newEnemyNahodnyBtn, currentNahodnyBtn);
            
            newEnemyNahodnyBtn.onclick = () => {
                if (enemySelectionInProgress) {
                    // Enemy selection random fill
                    const mode = gameState.currentMode || '1v1';
                    const enemyAllyCount = GAME_MODES[mode]?.allyCount || 0;
                    
                    // Get available enemy characters (excluding player selections)
                    const charKeys = Object.keys(CHARACTERS);
                    const playerSelections = [selectedCommanderKey, ...selectedAllies];
                    const alreadySelectedEnemies = enemySelectedCommanderKey ? [enemySelectedCommanderKey, ...enemySelectedAllies] : [...enemySelectedAllies];
                    const availableEnemyChars = charKeys.filter(k => !playerSelections.includes(k) && !alreadySelectedEnemies.includes(k));
                    
                    // If no enemy commander selected, pick one randomly
                    if (!enemySelectedCommanderKey && availableEnemyChars.length > 0) {
                        enemyCommanderSelected = true;
                        enemySelectedCommanderKey = availableEnemyChars[Math.floor(Math.random() * availableEnemyChars.length)];
                        enemySelectedAllies = [];
                        
                        const heading = document.querySelector('#character-selection h2');
                        if (heading) heading.textContent = 'Vyber nepriateľských spolubojovníkov';
                    }
                    
                    // Fill missing enemy allies randomly
                    const availableForEnemyAllies = charKeys.filter(k => !playerSelections.includes(k) && k !== enemySelectedCommanderKey && !enemySelectedAllies.includes(k));
                    const neededEnemyAllies = enemyAllyCount - enemySelectedAllies.length;
                    
                    for (let i = 0; i < neededEnemyAllies && availableForEnemyAllies.length > 0; i++) {
                        const randomIndex = Math.floor(Math.random() * availableForEnemyAllies.length);
                        const randomEnemyAlly = availableForEnemyAllies.splice(randomIndex, 1)[0];
                        enemySelectedAllies.push(randomEnemyAlly);
                    }
                    
                    // Update all enemy visuals
                    enemyCards.forEach(card => {
                        const k = card.dataset.char;
                        card.classList.remove('selected-enemy-commander', 'selected-enemy-ally', 'random-selected');
                        card.style.filter = '';
                        card.style.pointerEvents = '';
                        
                        if (k === enemySelectedCommanderKey) {
                            card.classList.add('selected-enemy-commander', 'random-selected');
                            card.style.filter = 'grayscale(0.8) brightness(0.7)';
                            card.style.pointerEvents = 'none';
                        } else if (enemySelectedAllies.includes(k)) {
                            card.classList.add('selected-enemy-ally', 'random-selected');
                            card.style.filter = 'grayscale(0.7) brightness(0.7)';
                        }
                    });
                    
                    updateAllyCounter(enemySelectedAllies.length, enemyAllyCount);
                    const finalDalejBtn = document.getElementById('character-dalej-btn');
                    if (finalDalejBtn) finalDalejBtn.disabled = (enemySelectedAllies.length !== enemyAllyCount);
                }
            };
        }

        // Update "Ďalej" button for enemy confirmation - IMPORTANT: Do this at the end
        const currentFinalDalejBtn = document.getElementById('character-dalej-btn');
        const newFinalDalejBtn = currentFinalDalejBtn.cloneNode(true);
        currentFinalDalejBtn.parentNode.replaceChild(newFinalDalejBtn, currentFinalDalejBtn);
        
        newFinalDalejBtn.onclick = () => {
            if (!enemyCommanderSelected) return;
            if (enemySelectedAllies.length !== enemyMaxAllies) return;
            
            // Save enemy selection
            gameState.selectedEnemyChar = CHARACTERS[enemySelectedCommanderKey];
            gameState.selectedEnemyAllies = enemySelectedAllies.slice();
            
            if (gameState.currentMode === '1v1') {
                gameState.selectedEnemies = [enemySelectedCommanderKey];
            } else {
                gameState.selectedEnemies = [enemySelectedCommanderKey, ...enemySelectedAllies];
            }
            
            // Restore all cards for next screens
            const allCards = document.querySelectorAll('.character-card');
            allCards.forEach(card => {
                card.style.display = '';
            });
            
            // Go to map selection
            showScreen('mapSelection');
        };
    };
    
    console.log('Character selection reinitialized');
}

// Initialize multiplayer mode selection when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Initialize managers first
    initializeManagers();
    
    initMultiplayerModeSelection();
    initTeamSelectionListeners();
    initLobbySelectionListeners();
    
    // Show optimization info after short delay
    setTimeout(() => {
        console.log(`
🚀 MULTIPLAYER OPTIMIZATIONS ACTIVE!
====================================
✅ Object Pooling (Bullets & Particles)
✅ Viewport Culling (Smart Rendering)  
✅ Network Optimization (Event Batching)
✅ Client-side Prediction (Smooth Movement)
✅ Performance Dashboard (Press F3 to toggle)

🎯 Performance Features:
- Adaptive Quality Based on FPS
- Position Update Throttling
- Delta Compression
- Lag Compensation
- Real-time Performance Metrics

🎮 Ready for optimal multiplayer experience!
`);
        
        // Show brief notification to user
        if (typeof showNotification === 'function') {
            showNotification('🚀 Multiplayer optimizations loaded! Press F3 for performance stats.', 'success', 4000);
        }
    }, 2000);
});

function initLobbySelectionListeners() {
    // Character selection in lobby
    const lobbyCharacterCards = document.querySelectorAll('#lobby-character-cards .lobby-character-card');
    lobbyCharacterCards.forEach(card => {
        card.addEventListener('click', () => {
            const characterId = card.dataset.character;
            selectLobbyCharacter(characterId);
        });
    });
    
    // Tank selection in lobby  
    const lobbyTankCards = document.querySelectorAll('#lobby-tank-cards .lobby-tank-card');
    lobbyTankCards.forEach(card => {
        card.addEventListener('click', () => {
            const tankId = card.dataset.tank;
            selectLobbyTank(tankId);
        });
    });
    
    // Map selection in lobby - use event delegation to catch dynamically added elements
    const lobbyMapCardsContainer = document.getElementById('lobby-map-cards');
    if (lobbyMapCardsContainer) {
        lobbyMapCardsContainer.addEventListener('click', (event) => {
            const mapCard = event.target.closest('.lobby-map-card');
            if (mapCard) {
                const mapId = mapCard.dataset.map;
                console.log('Map clicked:', mapId); // Debug log
                selectLobbyMap(mapId);
            }
        });
    }
    
    // All vs All ready button
    const allVsAllReadyBtn = document.getElementById('all-vs-all-ready-btn');
    if (allVsAllReadyBtn) {
        allVsAllReadyBtn.addEventListener('click', () => {
            toggleAllVsAllReady();
        });
    }
}

function initTeamSelectionListeners() {
    // Join team buttons
    const joinTeamButtons = document.querySelectorAll('.join-team-btn');
    joinTeamButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const team = btn.dataset.team;
            joinTeam(team);
        });
    });
    
    // Ready button
    const teamReadyBtn = document.getElementById('team-ready-btn');
    if (teamReadyBtn) {
        teamReadyBtn.addEventListener('click', () => {
            togglePlayerReady();
        });
    }

    // Game ready button (for combined selection final game start)
    const gameReadyBtn = document.getElementById('game-ready-btn');
    if (gameReadyBtn) {
        gameReadyBtn.addEventListener('click', () => {
            toggleGameReady();
        });
    }

    // Team name inputs (only for team captains)
    const blueTeamNameInput = document.getElementById('blue-team-name');
    const redTeamNameInput = document.getElementById('red-team-name');

    if (blueTeamNameInput && redTeamNameInput) {
        blueTeamNameInput.addEventListener('input', (e) => {
            const isCaptain = teamCaptains.blue === socket.id;
            if (playerTeam === 'blue' && isCaptain) {
                socket.emit('update-team-name', { team: 'blue', name: e.target.value });
            }
        });

        blueTeamNameInput.addEventListener('focus', (e) => {
            const isCaptain = teamCaptains.blue === socket.id;
            if (playerTeam !== 'blue' || !isCaptain) {
                e.target.blur(); // Remove focus if not captain
            }
        });

        redTeamNameInput.addEventListener('input', (e) => {
            const isCaptain = teamCaptains.red === socket.id;
            if (playerTeam === 'red' && isCaptain) {
                socket.emit('update-team-name', { team: 'red', name: e.target.value });
            }
        });

        redTeamNameInput.addEventListener('focus', (e) => {
            const isCaptain = teamCaptains.red === socket.id;
            if (playerTeam !== 'red' || !isCaptain) {
                e.target.blur(); // Remove focus if not captain
            }
        });

        // Make team name inputs more interactive - click anywhere to focus if captain
        const blueTeamHeader = blueTeamNameInput.closest('.team-header');
        const redTeamHeader = redTeamNameInput.closest('.team-header');

        if (blueTeamHeader) {
            blueTeamHeader.addEventListener('click', () => {
                const isCaptain = teamCaptains.blue === socket.id;
                if (playerTeam === 'blue' && isCaptain) {
                    blueTeamNameInput.focus();
                }
            });
        }

        if (redTeamHeader) {
            redTeamHeader.addEventListener('click', () => {
                const isCaptain = teamCaptains.red === socket.id;
                if (playerTeam === 'red' && isCaptain) {
                    redTeamNameInput.focus();
                }
            });
        }

        // Update team input states when captain status changes
        updateTeamInputStates();
    }
    
    // Host start selection button
    const hostStartSelectionBtn = document.getElementById('host-start-selection-btn');
    if (hostStartSelectionBtn) {
        hostStartSelectionBtn.addEventListener('click', () => {
            if (socket && currentRoom && selectedGameMode === 'team-vs-team') {
                socket.emit('host-start-selection');
            }
        });
    }
    
    // Host start game button  
    const hostStartGameBtn = document.getElementById('host-start-game-btn');
    if (hostStartGameBtn) {
        hostStartGameBtn.addEventListener('click', () => {
            if (socket && currentRoom) {
                socket.emit('host-start-game');
            }
        });
    }
    
    // Host lock room button
    const hostLockRoomBtn = document.getElementById('host-lock-room-btn-main');
    if (hostLockRoomBtn) {
        hostLockRoomBtn.addEventListener('click', () => {
            console.log('Host clicked lock room button');
            if (socket && currentRoom) {
                const isCurrentlyLocked = hostLockRoomBtn.textContent.includes('Odomknúť');
                
                if (isCurrentlyLocked) {
                    // Room is locked, unlock it
                    socket.emit('unlock-room', { roomId: currentRoom });
                    console.log('Unlocking room:', currentRoom);
                } else {
                    // Room is unlocked, lock it
                    socket.emit('lock-room', { roomId: currentRoom });
                    console.log('Locking room:', currentRoom);
                }
            }
        });
    }
}

init();
