const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Game state
let gameRooms = new Map();
let waitingPlayers = [];

// Game modes configuration
const GAME_MODES = {
    '1v1': { maxPlayers: 2, teamMode: false },
    '2v2': { maxPlayers: 4, teamMode: true },
    '3v3': { maxPlayers: 6, teamMode: true },
    'free-for-all-3': { maxPlayers: 3, teamMode: false },
    'free-for-all-4': { maxPlayers: 4, teamMode: false },
    'free-for-all-6': { maxPlayers: 6, teamMode: false }
};

// Room structure
class GameRoom {
    constructor(id, gameMode = '1v1') {
        this.id = id;
        this.players = [];
        this.gameMode = gameMode;
        this.maxPlayers = GAME_MODES[gameMode].maxPlayers;
        this.teamMode = GAME_MODES[gameMode].teamMode;
        this.gameState = 'waiting'; // waiting, playing, ended
        this.gameData = null;
        this.selectedMap = null; // Selected map by host
        this.hostId = null; // First player becomes host
        this.teams = { team1: [], team2: [] }; // For team-based modes
    }

    addPlayer(player) {
        if (this.players.length < this.maxPlayers) {
            // First player becomes host
            if (this.players.length === 0) {
                this.hostId = player.id;
                player.isHost = true;
            }
            
            // Auto-assign teams for team-based modes
            if (this.teamMode) {
                if (this.teams.team1.length <= this.teams.team2.length) {
                    this.teams.team1.push(player.id);
                    player.team = 'team1';
                } else {
                    this.teams.team2.push(player.id);
                    player.team = 'team2';
                }
            } else {
                player.team = null; // No teams in free-for-all
            }
            
            this.players.push(player);
            return true;
        }
        return false;
    }

    removePlayer(playerId) {
        const removedPlayer = this.players.find(p => p.id === playerId);
        this.players = this.players.filter(p => p.id !== playerId);
        
        // Remove from teams if team mode
        if (this.teamMode && removedPlayer) {
            if (removedPlayer.team === 'team1') {
                this.teams.team1 = this.teams.team1.filter(id => id !== playerId);
            } else if (removedPlayer.team === 'team2') {
                this.teams.team2 = this.teams.team2.filter(id => id !== playerId);
            }
        }
        
        // If host leaves, assign new host
        if (this.hostId === playerId && this.players.length > 0) {
            this.hostId = this.players[0].id;
            this.players[0].isHost = true;
        }
    }

    isFull() {
        return this.players.length >= this.maxPlayers;
    }

    isEmpty() {
        return this.players.length === 0;
    }
}

// Socket connection handling
io.on('connection', (socket) => {
    console.log('Hráč sa pripojil:', socket.id);

    // Player wants to join game with specific mode
    socket.on('join-game', (playerData) => {
        const player = {
            id: socket.id,
            name: playerData.name || 'Neznámy hráč',
            selectedCharacter: null, // Will be selected in lobby
            selectedTank: null, // Will be selected in lobby
            ready: false,
            gameMode: playerData.gameMode || '1v1' // Default to 1v1
        };

        // Find or create room for specific game mode
        let room = null;
        for (let [roomId, gameRoom] of gameRooms) {
            if (!gameRoom.isFull() && 
                gameRoom.gameState === 'waiting' && 
                gameRoom.gameMode === player.gameMode) {
                room = gameRoom;
                break;
            }
        }

        if (!room) {
            // Create new room with specified game mode
            const roomId = 'room_' + Date.now();
            room = new GameRoom(roomId, player.gameMode);
            gameRooms.set(roomId, room);
        }

        // Add player to room
        if (room.addPlayer(player)) {
            socket.join(room.id);
            socket.currentRoom = room.id;

            // Notify all players in room
            io.to(room.id).emit('player-joined', {
                players: room.players,
                roomId: room.id,
                playersCount: room.players.length,
                maxPlayers: room.maxPlayers,
                hostId: room.hostId,
                selectedMap: room.selectedMap,
                gameMode: room.gameMode,
                teamMode: room.teamMode,
                teams: room.teams
            });

            console.log(`Hráč ${player.name} sa pripojil do miestnosti ${room.id} (${room.gameMode})`);

            // Don't start game automatically - wait for players to be ready
            // if (room.isFull()) {
            //     startGame(room);
            // }
        }
    });

    // Player ready status
    socket.on('player-ready', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                // Check if player has made all selections
                if (!player.selectedCharacter || !player.selectedTank) {
                    console.log(`Hráč ${socket.id} sa pokúša byť ready bez kompletných výberov`);
                    return;
                }
                
                player.ready = true;
                io.to(room.id).emit('player-ready-update', {
                    playerId: socket.id,
                    ready: true
                });

                // Check if all players are ready and have made all selections
                const allReady = room.players.every(p => 
                    p.ready && p.selectedCharacter && p.selectedTank
                );
                
                if (allReady) {
                    console.log(`Všetci hráči sú pripravení v miestnosti ${room.id}, spúšťam hru...`);
                    startGame(room);
                }
            }
        }
    });

    // Character selection
    socket.on('select-character', (characterData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.selectedCharacter = characterData.characterId;
                
                // Broadcast character selection to all players in room
                io.to(room.id).emit('character-selected', {
                    playerId: socket.id,
                    characterId: characterData.characterId
                });
                
                // Update lobby UI for all players
                io.to(room.id).emit('player-joined', {
                    players: room.players,
                    roomId: room.id,
                    playersCount: room.players.length,
                    maxPlayers: room.maxPlayers,
                    hostId: room.hostId,
                    selectedMap: room.selectedMap
                });
                
                console.log(`Hráč ${socket.id} vybral charaktera ${characterData.characterId}`);
            }
        }
    });

    // Tank selection
    socket.on('select-tank', (tankData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.selectedTank = tankData.tankId;
                
                // Broadcast tank selection to all players in room
                io.to(room.id).emit('tank-selected', {
                    playerId: socket.id,
                    tankId: tankData.tankId
                });
                
                // Update lobby UI for all players
                io.to(room.id).emit('player-joined', {
                    players: room.players,
                    roomId: room.id,
                    playersCount: room.players.length,
                    maxPlayers: room.maxPlayers,
                    hostId: room.hostId,
                    selectedMap: room.selectedMap
                });
                
                console.log(`Hráč ${socket.id} vybral tank ${tankData.tankId}`);
            }
        }
    });

    // Map selection (only host can change map)
    socket.on('select-map', (mapData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.hostId === socket.id) {
            room.selectedMap = mapData.mapId;
            
            // Broadcast map selection to all players in room
            io.to(room.id).emit('map-selected', {
                mapId: mapData.mapId,
                hostId: socket.id
            });
            
            console.log(`Mapa ${mapData.mapId} vybraná hostom ${socket.id} v miestnosti ${room.id}`);
        }
    });

    // Handle game actions
    socket.on('player-action', (action) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.gameState === 'playing') {
            // Broadcast action to all players in room except sender
            socket.to(room.id).emit('player-action', {
                playerId: socket.id,
                action: action
            });
        }
    });

    // Handle player position updates
    socket.on('player-position', (positionData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.gameState === 'playing') {
            // Broadcast position to all players in room except sender
            socket.to(room.id).emit('player-position', {
                playerId: socket.id,
                x: positionData.x,
                y: positionData.y,
                angle: positionData.angle,
                turretAngle: positionData.turretAngle,
                timestamp: Date.now()
            });
        }
    });

    // Handle player shooting
    socket.on('player-shoot', (shootData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.gameState === 'playing') {
            // Broadcast shooting to all players in room except sender
            socket.to(room.id).emit('player-shoot', {
                playerId: socket.id,
                x: shootData.x,
                y: shootData.y,
                angle: shootData.angle,
                bulletType: shootData.bulletType,
                timestamp: Date.now()
            });
        }
    });

    // Handle player damage
    socket.on('player-damage', (damageData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.gameState === 'playing') {
            // Broadcast damage to all players in room
            io.to(room.id).emit('player-damage', {
                playerId: damageData.playerId,
                damage: damageData.damage,
                newHealth: damageData.newHealth,
                attackerId: socket.id,
                timestamp: Date.now()
            });
        }
    });

    // Handle player death
    socket.on('player-death', (deathData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.gameState === 'playing') {
            // Broadcast death to all players in room
            io.to(room.id).emit('player-death', {
                playerId: deathData.playerId,
                killerId: socket.id,
                timestamp: Date.now()
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Hráč sa odpojil:', socket.id);
        
        if (socket.currentRoom) {
            const room = gameRooms.get(socket.currentRoom);
            if (room) {
                room.removePlayer(socket.id);
                
                // Notify remaining players
                io.to(room.id).emit('player-left', {
                    playerId: socket.id,
                    remainingPlayers: room.players
                });

                // Remove empty rooms
                if (room.isEmpty()) {
                    gameRooms.delete(room.id);
                }
            }
        }
    });
});

function startGame(room) {
    room.gameState = 'playing';
    
    // Generate shared game data for all players
    const sharedGameData = generateSharedGameData(room);
    
    // Initialize game data
    room.gameData = {
        startTime: Date.now(),
        roundNumber: 1,
        playerTeamScore: 0,
        enemyTeamScore: 0,
        map: sharedGameData.map,
        obstacles: sharedGameData.obstacles,
        playerPositions: sharedGameData.playerPositions
    };

    // Send game start signal to all players with shared data
    io.to(room.id).emit('game-start', {
        players: room.players,
        gameData: room.gameData
    });

    console.log(`Hra začína v miestnosti ${room.id}`);
}

function generateSharedGameData(room) {
    // Use selected map or default to map 1
    const mapId = room.selectedMap || '1';
    
    const arenaWidth = 2000; // Fixed arena size
    const arenaHeight = 1500;
    
    // Generate obstacles deterministically
    const obstacles = generateObstacles(mapId, arenaWidth, arenaHeight);
    
    // Generate player spawn positions
    const playerPositions = generatePlayerSpawnPositions(room.players, arenaWidth, arenaHeight, obstacles);
    
    return {
        map: mapId,
        obstacles: obstacles,
        playerPositions: playerPositions,
        arenaWidth: arenaWidth,
        arenaHeight: arenaHeight
    };
}

function generateObstacles(mapId, arenaWidth, arenaHeight) {
    const obstacles = [];
    
    // Use deterministic random seed for consistent obstacle generation
    let seed = 12345; // Fixed seed for reproducible results
    function seededRandom() {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    }
    
    if (mapId === '1') {
        // Green map - trees, swamps, rocks
        const numTrees = 20;
        const numSwamps = 7;
        const numRocks = 5;
        
        // Generate trees
        for (let i = 0; i < numTrees; i++) {
            const x = seededRandom() * arenaWidth;
            const y = seededRandom() * arenaHeight;
            const radius = 20 + seededRandom() * 20;
            obstacles.push({
                type: 'tree',
                x: x,
                y: y,
                width: radius * 2,
                height: radius * 2,
                radiusX: radius,
                radiusY: radius,
                health: 100,
                maxHealth: 100
            });
        }
        
        // Generate swamps
        for (let i = 0; i < numSwamps; i++) {
            const x = seededRandom() * arenaWidth;
            const y = seededRandom() * arenaHeight;
            const radiusX = 30 + seededRandom() * 30;
            const radiusY = 20 + seededRandom() * 20;
            obstacles.push({
                type: 'swamp',
                x: x,
                y: y,
                width: radiusX * 2,
                height: radiusY * 2,
                radiusX: radiusX,
                radiusY: radiusY
            });
        }
        
        // Generate rocks
        for (let i = 0; i < numRocks; i++) {
            const x = seededRandom() * arenaWidth;
            const y = seededRandom() * arenaHeight;
            const width = 40 + seededRandom() * 30;
            const height = 30 + seededRandom() * 20;
            obstacles.push({
                type: 'rock',
                x: x,
                y: y,
                width: width,
                height: height,
                health: 200,
                maxHealth: 200
            });
        }
    } else if (mapId === '2') {
        // Desert map - only rocks and oilrigs
        const numRocks = 8;
        const numOilrigs = 6;
        
        // Generate rocks
        for (let i = 0; i < numRocks; i++) {
            const x = seededRandom() * arenaWidth;
            const y = seededRandom() * arenaHeight;
            const width = 40 + seededRandom() * 30;
            const height = 30 + seededRandom() * 20;
            obstacles.push({
                type: 'rock',
                x: x,
                y: y,
                width: width,
                height: height,
                health: 200,
                maxHealth: 200
            });
        }
        
        // Generate oilrigs
        for (let i = 0; i < numOilrigs; i++) {
            const x = seededRandom() * arenaWidth;
            const y = seededRandom() * arenaHeight;
            const width = 90 + seededRandom() * 30;
            const height = 90 + seededRandom() * 30;
            obstacles.push({
                type: 'oilrig',
                x: x,
                y: y,
                width: width,
                height: height,
                health: 300,
                maxHealth: 300
            });
        }
    } else if (mapId === '3') {
        // Ice map - only iglus
        const numIglus = 12;
        
        for (let i = 0; i < numIglus; i++) {
            const x = seededRandom() * (arenaWidth - 120) + 60;
            const y = seededRandom() * (arenaHeight - 120) + 60;
            const width = 90 + seededRandom() * 30;
            const height = 90 + seededRandom() * 30;
            obstacles.push({
                type: 'iglu',
                x: x,
                y: y,
                width: width,
                height: height,
                health: 300,
                maxHealth: 300
            });
        }
    }
    
    return obstacles;
}

function generatePlayerSpawnPositions(players, arenaWidth, arenaHeight, obstacles) {
    const positions = {};
    const playerCount = players.length;
    
    // Define spawn positions based on number of players
    if (playerCount === 2) {
        // 1v1 - opposite corners
        positions[players[0].id] = {
            x: 300,
            y: arenaHeight - 200,
            tankType: players[0].selectedTank || 'purple',
            character: players[0].selectedCharacter || 'jaccelini'
        };
        positions[players[1].id] = {
            x: 300,
            y: 200,
            tankType: players[1].selectedTank || 'purple',
            character: players[1].selectedCharacter || 'jaccelini'
        };
    } else if (playerCount === 3) {
        // Free-for-all 3 - triangle formation
        const centerX = arenaWidth / 2;
        const centerY = arenaHeight / 2;
        const radius = Math.min(arenaWidth, arenaHeight) * 0.3;
        
        for (let i = 0; i < 3; i++) {
            const angle = (i * 2 * Math.PI) / 3;
            positions[players[i].id] = {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
                tankType: players[i].selectedTank || 'purple',
                character: players[i].selectedCharacter || 'jaccelini'
            };
        }
    } else if (playerCount === 4) {
        // 2v2 or free-for-all 4 - four corners
        const margin = 200;
        const spawnPoints = [
            { x: margin, y: margin },
            { x: arenaWidth - margin, y: margin },
            { x: arenaWidth - margin, y: arenaHeight - margin },
            { x: margin, y: arenaHeight - margin }
        ];
        
        for (let i = 0; i < 4; i++) {
            positions[players[i].id] = {
                x: spawnPoints[i].x,
                y: spawnPoints[i].y,
                tankType: players[i].selectedTank || 'purple',
                character: players[i].selectedCharacter || 'jaccelini'
            };
        }
    } else if (playerCount === 6) {
        // 3v3 or free-for-all 6 - hexagon formation
        const centerX = arenaWidth / 2;
        const centerY = arenaHeight / 2;
        const radius = Math.min(arenaWidth, arenaHeight) * 0.35;
        
        for (let i = 0; i < 6; i++) {
            const angle = (i * 2 * Math.PI) / 6;
            positions[players[i].id] = {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
                tankType: players[i].selectedTank || 'purple',
                character: players[i].selectedCharacter || 'jaccelini'
            };
        }
    }
    
    return positions;
}

// API endpoint to get available game modes
app.get('/api/game-modes', (req, res) => {
    const modes = Object.keys(GAME_MODES).map(mode => ({
        id: mode,
        name: getGameModeName(mode),
        maxPlayers: GAME_MODES[mode].maxPlayers,
        teamMode: GAME_MODES[mode].teamMode,
        description: getGameModeDescription(mode)
    }));
    
    res.json({ gameModes: modes });
});

function getGameModeName(mode) {
    const names = {
        '1v1': '1 vs 1',
        '2v2': '2 vs 2 (Tímy)',
        '3v3': '3 vs 3 (Tímy)',
        'free-for-all-3': 'Voľný súboj (3 hráči)',
        'free-for-all-4': 'Voľný súboj (4 hráči)',
        'free-for-all-6': 'Voľný súboj (6 hráčov)'
    };
    return names[mode] || mode;
}

function getGameModeDescription(mode) {
    const descriptions = {
        '1v1': 'Klasický súboj jeden na jeden',
        '2v2': 'Tímový súboj dva proti dvom',
        '3v3': 'Tímový súboj tri proti trom',
        'free-for-all-3': 'Každý proti každému - 3 hráči',
        'free-for-all-4': 'Každý proti každému - 4 hráči',
        'free-for-all-6': 'Každý proti každému - 6 hráčov'
    };
    return descriptions[mode] || 'Popis nie je dostupný';
}

// Debug endpoint for file diagnostics
app.get('/debug/files', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    try {
        const files = fs.readdirSync('./');
        const images = files.filter(f => f.match(/\.(png|jpg|gif|jpeg)$/i));
        
        // Skontrolujte aj konkrétne súbory ktoré potrebujeme
        const testFiles = [
            'ja.png', 'JA.png', 'bullet.png', 'bullet2.png', 
            'tank1.png', 'tank2.png', 'tank3.png',
            'canon1.png', 'canon2.png', 'canon3.png',
            'grass_texture.png', 'menu_background.png',
            'tvaruzek.jpg', 'zahry.jpg', 'zeman.jpg',
            'rumpik.PNG', 'simek.PNG', 'PK.png',
            'dessert.jpg', 'ice.png', 'IGLU.png'
        ];
        
        const fileStatus = {};
        testFiles.forEach(file => {
            fileStatus[file] = fs.existsSync(file);
        });
        
        res.json({ 
            message: 'Debug info for Tank War Multiplayer',
            allFiles: files.slice(0, 100), // Prvých 100 súborov
            imageFiles: images,
            totalFiles: files.length,
            totalImages: images.length,
            currentDir: process.cwd(),
            nodeEnv: process.env.NODE_ENV,
            testFiles: fileStatus,
            // Zoznam chýbajúcich testovacích súborov
            missingFiles: testFiles.filter(file => !fs.existsSync(file))
        });
    } catch (err) {
        res.json({ 
            error: err.message,
            stack: err.stack 
        });
    }
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server beží na porte ${PORT}`);
});
