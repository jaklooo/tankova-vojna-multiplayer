const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const { GAME_MODES, getGameModeName, getGameModeDescription } = require('./src/config/gameModes');
const GameRoom = require('./src/models/GameRoom');
const GameStateManager = require('./src/managers/GameStateManager');
const { generatePlayerSpawnPositions } = require('./src/utils/spawnPositions');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Initialize global game state manager
const globalStateManager = new GameStateManager();

// Serve static files
app.use(express.static(path.join(__dirname)));

// Game state
let gameRooms = new Map();
let waitingPlayers = [];

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
            gameMode: playerData.gameMode || 'all-vs-all', // Default to all-vs-all
            team: null // Will be assigned later for team mode
        };

        // Find or create room for specific game mode
        let room = null;
        for (let [roomId, gameRoom] of gameRooms) {
            if (!gameRoom.isFull() && 
                !gameRoom.locked &&
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
                teams: room.teams,
                teamCaptains: room.teamCaptains,
                teamNames: room.teamNames,
                hostCanStart: room.hostCanStart,
                minPlayers: room.minPlayers,
                selectionPhase: room.selectionPhase
            });

            console.log(`Hráč ${player.name} sa pripojil do miestnosti ${room.id} (${room.gameMode})`);

            // Don't start game automatically - wait for players to be ready
            // if (room.isFull()) {
            //     startGame(room);
            // }
        }
    });

    // Team management events
    socket.on('join-team', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        const teamName = data.team; // 'blue' or 'red'
        
        // Remove from previous team and captain role
        if (player.team === 'blue') {
            room.teams.blue = room.teams.blue.filter(id => id !== socket.id);
            if (room.teamCaptains.blue === socket.id) {
                room.teamCaptains.blue = room.teams.blue.length > 0 ? room.teams.blue[0] : null;
            }
        } else if (player.team === 'red') {
            room.teams.red = room.teams.red.filter(id => id !== socket.id);
            if (room.teamCaptains.red === socket.id) {
                room.teamCaptains.red = room.teams.red.length > 0 ? room.teams.red[0] : null;
            }
        }
        
        // Add to new team
        player.team = teamName;
        if (teamName === 'blue') {
            room.teams.blue.push(socket.id);
            // Set as captain if first in team
            if (!room.teamCaptains.blue) {
                room.teamCaptains.blue = socket.id;
            }
        } else if (teamName === 'red') {
            room.teams.red.push(socket.id);
            // Set as captain if first in team
            if (!room.teamCaptains.red) {
                room.teamCaptains.red = socket.id;
            }
        }
        
        // Reset ready status when changing teams
        player.ready = false;
        
        console.log(`Hráč ${player.name} sa pripojil do tímu ${teamName}`);
        
        // Broadcast team update
        io.to(room.id).emit('team-updated', {
            players: room.players,
            teams: room.teams,
            teamCaptains: room.teamCaptains,
            teamNames: room.teamNames,
            hostId: room.hostId
        });
    });

    socket.on('leave-team', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        
        // Remove from current team and update captain
        if (player.team === 'blue') {
            room.teams.blue = room.teams.blue.filter(id => id !== socket.id);
            if (room.teamCaptains.blue === socket.id) {
                room.teamCaptains.blue = room.teams.blue.length > 0 ? room.teams.blue[0] : null;
            }
        } else if (player.team === 'red') {
            room.teams.red = room.teams.red.filter(id => id !== socket.id);
            if (room.teamCaptains.red === socket.id) {
                room.teamCaptains.red = room.teams.red.length > 0 ? room.teams.red[0] : null;
            }
        }
        
        player.team = null;
        player.ready = false;
        
        console.log(`Hráč ${player.name} opustil svoj tím`);
        
        // Broadcast team update
        io.to(room.id).emit('team-updated', {
            players: room.players,
            teams: room.teams,
            teamCaptains: room.teamCaptains,
            teamNames: room.teamNames,
            hostId: room.hostId
        });
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
                    console.log(`Všetci hráči sú pripravení v miestnosti ${room.id}`);
                    
                    // For team mode, need host to start manually after teams are set
                    if (room.gameMode === 'team-vs-team') {
                        // Check if teams are properly set up
                        const teamAPlayers = room.players.filter(p => p.team === 'blue').length;
                        const teamBPlayers = room.players.filter(p => p.team === 'red').length;
                        
                        if (teamAPlayers > 0 && teamBPlayers > 0) {
                            console.log(`Team game ready - Blue: ${teamAPlayers}, Red: ${teamBPlayers}. Waiting for host to start.`);
                            // Just notify that game can be started, don't auto-start
                            io.to(room.id).emit('teams-ready', {
                                message: 'All players ready! Host can start the game.',
                                canStart: true
                            });
                        } else {
                            console.log(`Teams not balanced - Blue: ${teamAPlayers}, Red: ${teamBPlayers}`);
                        }
                    } else {
                        // All-vs-all mode can auto-start
                        console.log(`All-vs-all game starting automatically...`);
                        startGame(room);
                    }
                }
            }
        }
    });

    // Character selection (unified for all modes)
    socket.on('select-character', (characterData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                // For all-vs-all mode, use characterId; for team mode, use characterKey
                const charKey = characterData.characterKey || characterData.characterId;
                player.selectedCharacter = charKey;
                
                if (room.gameMode === 'team-vs-team') {
                    // Team mode - broadcast with team info
                    io.to(room.id).emit('character-selected', {
                        playerId: socket.id,
                        playerName: player.name,
                        team: player.team,
                        characterKey: charKey
                    });
                } else {
                    // All-vs-all mode
                    io.to(room.id).emit('character-selected', {
                        playerId: socket.id,
                        characterId: charKey
                    });
                }
                
                console.log(`Hráč ${socket.id} vybral charaktera ${charKey}`);
            }
        }
    });

    // Host can manually start game (for unlimited mode)
    socket.on('host-start-game', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.hostId === socket.id && room.hostCanStart) {
            // Check if we have minimum players and all are ready
            if (room.players.length >= room.minPlayers) {
                const allReady = room.players.every(p => 
                    p.ready && p.selectedCharacter && p.selectedTank
                );
                
                if (allReady) {
                    console.log(`Host ${socket.id} spúšťa hru v miestnosti ${room.id} s ${room.players.length} hráčmi`);
                    startGame(room);
                } else {
                    // Send error to host - not all players ready
                    socket.emit('start-game-error', {
                        message: 'Nie všetci hráči sú pripravení'
                    });
                }
            } else {
                // Send error to host - not enough players
                socket.emit('start-game-error', {
                    message: `Potrebujete aspoň ${room.minPlayers} hráčov`
                });
            }
        }
    });

    // Host can start selection phase (for team-vs-team mode)
    socket.on('host-start-selection', () => {
        console.log(`Host-start-selection event received from ${socket.id}`);
        const room = gameRooms.get(socket.currentRoom);
        console.log(`Room found: ${room ? 'yes' : 'no'}, Current room: ${socket.currentRoom}`);
        
        if (room && room.hostId === socket.id && room.hostCanStart && !room.selectionPhase) {
            console.log(`Host validation passed for ${socket.id}`);
            
            // For team mode, check team balance
            if (room.gameMode === 'team-vs-team') {
                const blueCount = room.teams.blue.length;
                const redCount = room.teams.red.length;
                
                if (blueCount > 0 && redCount > 0 && (blueCount + redCount) >= 2) {
                    room.selectionPhase = true;
                    
                    console.log(`Host ${socket.id} spúšťa výber v tímovom móde s ${blueCount} modrými a ${redCount} červenými hráčmi`);
                    
                    // Notify all players that selection phase has started
                    io.to(room.id).emit('selection-phase-started', {
                        players: room.players,
                        roomId: room.id,
                        playersCount: room.players.length,
                        maxPlayers: room.maxPlayers,
                        hostId: room.hostId,
                        selectedMap: room.selectedMap,
                        gameMode: room.gameMode,
                        teamMode: room.teamMode,
                        teams: room.teams,
                        hostCanStart: room.hostCanStart,
                        minPlayers: room.minPlayers,
                        selectionPhase: room.selectionPhase
                    });
                } else {
                    socket.emit('selection-start-error', {
                        message: `Potrebujete aspoň 1 hráča v každom tíme`
                    });
                }
            } else {
                // All vs all mode
                if (room.players.length >= room.minPlayers) {
                    room.selectionPhase = true;
                    
                    console.log(`Host ${socket.id} spúšťa výber v all-vs-all móde s ${room.players.length} hráčmi`);
                    
                    io.to(room.id).emit('selection-phase-started', {
                        players: room.players,
                        roomId: room.id,
                        playersCount: room.players.length,
                        maxPlayers: room.maxPlayers,
                        hostId: room.hostId,
                        selectedMap: room.selectedMap,
                        gameMode: room.gameMode,
                        teamMode: room.teamMode,
                        teams: room.teams,
                        hostCanStart: room.hostCanStart,
                        minPlayers: room.minPlayers,
                        selectionPhase: room.selectionPhase
                    });
                } else {
                    socket.emit('selection-start-error', {
                        message: `Potrebujete aspoň ${room.minPlayers} hráčov pre spustenie výberu`
                    });
                }
            }
        }
    });

    // Tank selection
    socket.on('select-tank', (tankData) => {
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                // For all-vs-all mode, use tankId; for team mode, use tankType
                const tankKey = tankData.tankType || tankData.tankId;
                player.selectedTank = tankKey;
                
                if (room.gameMode === 'team-vs-team') {
                    // Team mode - broadcast with team info
                    io.to(room.id).emit('tank-selected', {
                        playerId: socket.id,
                        playerName: player.name,
                        team: player.team,
                        tankType: tankKey
                    });
                } else {
                    // All-vs-all mode
                    io.to(room.id).emit('tank-selected', {
                        playerId: socket.id,
                        tankId: tankKey
                    });
                }
                
                console.log(`Hráč ${socket.id} vybral tank ${tankKey}`);
            }
        }
    });

    // Map voting (unified for all modes)
    socket.on('vote-map', (mapData) => {
        console.log(`Vote-map received from ${socket.id}:`, mapData); // Debug log
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const mapId = mapData.mapId;
            console.log(`Processing vote for map ${mapId}`); // Debug log
            
            // Remove any previous vote by this player
            Object.keys(room.mapVotes).forEach(existingMapId => {
                room.mapVotes[existingMapId] = room.mapVotes[existingMapId].filter(playerId => playerId !== socket.id);
                if (room.mapVotes[existingMapId].length === 0) {
                    delete room.mapVotes[existingMapId];
                }
            });
            
            // Add new vote
            if (!room.mapVotes[mapId]) {
                room.mapVotes[mapId] = [];
            }
            room.mapVotes[mapId].push(socket.id);
            
            console.log(`Updated mapVotes:`, room.mapVotes); // Debug log
            
            if (room.gameMode === 'all-vs-all') {
                // Broadcast map votes to all players
                io.to(room.id).emit('map-votes-updated', {
                    mapVotes: room.mapVotes
                });
            } else if (room.gameMode === 'team-vs-team') {
                // Broadcast vote update for team mode
                io.to(room.id).emit('map-vote-updated', {
                    mapVotes: room.mapVotes,
                    playerVote: { playerId: socket.id, mapId: mapId }
                });
            }
            
            console.log(`Hráč ${socket.id} hlasoval pre mapu ${mapId}`);
        } else {
            console.log(`Vote-map rejected: no room found`); // Debug log
        }
    });

    // Toggle ready state (for both all-vs-all and team-vs-team modes)
    socket.on('toggle-ready', (readyData) => {
        console.log(`Toggle-ready received from ${socket.id}:`, readyData); // Debug log
        const room = gameRooms.get(socket.currentRoom);
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.ready = readyData.ready;
                
                if (readyData.ready) {
                    room.readyPlayers.add(socket.id);
                } else {
                    room.readyPlayers.delete(socket.id);
                }
                
                console.log(`Ready players: ${room.readyPlayers.size}/${room.players.length}`); // Debug log
                
                if (room.gameMode === 'all-vs-all') {
                    // Broadcast ready status to all players for all-vs-all mode
                    io.to(room.id).emit('player-ready-updated', {
                        playerId: socket.id,
                        ready: readyData.ready,
                        readyCount: room.readyPlayers.size,
                        totalPlayers: room.players.length
                    });
                    
                    // Check if all players are ready and can start game
                    if (room.readyPlayers.size >= room.minPlayers && room.readyPlayers.size === room.players.length) {
                        // Select most voted map or random if tie
                        let selectedMapId = '1'; // default
                        let maxVotes = 0;
                        const mapIds = Object.keys(room.mapVotes);
                        
                        if (mapIds.length > 0) {
                            mapIds.forEach(mapId => {
                                if (room.mapVotes[mapId].length > maxVotes) {
                                    maxVotes = room.mapVotes[mapId].length;
                                    selectedMapId = mapId;
                                }
                            });
                            
                            // Check for tie - if so, pick random from tied maps
                            const tiedMaps = mapIds.filter(mapId => room.mapVotes[mapId].length === maxVotes);
                            if (tiedMaps.length > 1) {
                                selectedMapId = tiedMaps[Math.floor(Math.random() * tiedMaps.length)];
                            }
                        }
                        
                        room.selectedMap = selectedMapId;
                        
                        // Start game automatically when all players ready
                        setTimeout(() => {
                            startGame(room);
                        }, 2000); // 2 second delay to show ready status
                    }
                } else if (room.gameMode === 'team-vs-team') {
                    // Broadcast ready status for team mode
                    io.to(room.id).emit('ready-updated', {
                        readyPlayers: Array.from(room.readyPlayers),
                        totalPlayers: room.players.length
                    });
                    
                    // Check if all players are ready (minimum 2 players, at least 1 per team)
                    const blueTeamPlayers = room.players.filter(p => p.team === 'blue');
                    const redTeamPlayers = room.players.filter(p => p.team === 'red');
                    
                    console.log(`Debug team ready check:`, {
                        readyPlayersSize: room.readyPlayers.size,
                        totalPlayers: room.players.length,
                        blueTeamSize: blueTeamPlayers.length,
                        redTeamSize: redTeamPlayers.length,
                        allReady: room.readyPlayers.size === room.players.length,
                        bothTeamsHavePlayers: blueTeamPlayers.length > 0 && redTeamPlayers.length > 0
                    });
                    
                    if (room.readyPlayers.size >= 2 && 
                        room.readyPlayers.size === room.players.length &&
                        blueTeamPlayers.length > 0 && redTeamPlayers.length > 0) {
                        
                        console.log('Všetci hráči pripravení! Prechod do combined selection (ako all-vs-all)');
                        // All players ready, proceed to combined selection like all-vs-all
                        room.currentPhase = 'combined-selection';
                        io.to(room.id).emit('phase-change', { phase: 'combined-selection' });
                    }
                }
                
                console.log(`Hráč ${socket.id} je ${readyData.ready ? 'pripravený' : 'nepripravený'}`);
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

    // Lock room (only host can lock)
    socket.on('lock-room', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.hostId === socket.id) {
            room.locked = true;
            
            // Broadcast to all players that room is locked
            io.to(room.id).emit('room-locked', {
                locked: true,
                hostId: socket.id
            });
            
            console.log(`Miestnosť ${room.id} uzamknutá hostom ${socket.id}`);
        }
    });

    // Unlock room (only host can unlock)
    socket.on('unlock-room', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (room && room.hostId === socket.id) {
            room.locked = false;
            
            // Broadcast to all players that room is unlocked
            io.to(room.id).emit('room-locked', {
                locked: false,
                hostId: socket.id
            });
            
            console.log(`Miestnosť ${room.id} odomknutá hostom ${socket.id}`);
        }
    });

    // Team name update (only team captain can update)
    socket.on('update-team-name', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team') return;
        
        const { team, name } = data;
        
        // Check if player is captain of the team
        if (room.teamCaptains[team] === socket.id) {
            // Validate name length
            if (name && name.trim().length > 0 && name.trim().length <= 20) {
                room.teamNames[team] = name.trim();
                
                // Broadcast team name update to all players
                io.to(room.id).emit('team-name-updated', {
                    team: team,
                    name: room.teamNames[team],
                    captainId: socket.id
                });
                
                console.log(`Kapitán ${socket.id} zmenil názov tímu ${team} na "${room.teamNames[team]}"`);
            }
        }
    });

    // Character selection for team mode
    socket.on('select-character', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            // Support both characterKey and characterId
            const characterKey = data.characterKey || data.characterId;
            player.selectedCharacter = characterKey;
            
            // Broadcast character selection to all players
            io.to(room.id).emit('character-selected', {
                playerId: socket.id,
                playerName: player.name,
                team: player.team,
                characterKey: characterKey
            });
            
            console.log(`Hráč ${player.name} z tímu ${player.team} vybral charakter ${characterKey}`);
        }
    });

    // Tank selection for team mode
    socket.on('select-tank', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            // Support both tankType and tankId
            const tankType = data.tankType || data.tankId;
            player.selectedTank = tankType;
            
            // Broadcast tank selection to all players
            io.to(room.id).emit('tank-selected', {
                playerId: socket.id,
                playerName: player.name,
                team: player.team,
                tankType: tankType
            });
            
            console.log(`Hráč ${player.name} z tímu ${player.team} vybral tank ${tankType}`);
        }
    });

    // Ready state for combined selection (team mode) - similar to all-vs-all
    socket.on('team-ready', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team' || room.currentPhase !== 'combined-selection') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = data.ready;
            
            if (data.ready) {
                room.readyPlayers.add(socket.id);
            } else {
                room.readyPlayers.delete(socket.id);
            }
            
            // Broadcast ready status for team mode
            io.to(room.id).emit('player-ready-updated', {
                playerId: socket.id,
                ready: data.ready,
                readyCount: room.readyPlayers.size,
                totalPlayers: room.players.length
            });
            
            console.log(`Hráč ${player.name} je ${data.ready ? 'pripravený' : 'nepripravený'} v combined selection`);
            
            // Check if all players are ready and have made all selections
            if (room.readyPlayers.size === room.players.length) {
                const allSelected = room.players.every(p => 
                    p.selectedCharacter && p.selectedTank
                );
                
                if (allSelected) {
                    // Select most voted map or default
                    let selectedMapId = '1';
                    let maxVotes = 0;
                    
                    for (let mapId in room.mapVotes) {
                        if (room.mapVotes[mapId].length > maxVotes) {
                            maxVotes = room.mapVotes[mapId].length;
                            selectedMapId = mapId;
                        }
                    }
                    
                    // Handle ties
                    const tiedMaps = Object.keys(room.mapVotes).filter(mapId => room.mapVotes[mapId].length === maxVotes);
                    if (tiedMaps.length > 1) {
                        selectedMapId = tiedMaps[Math.floor(Math.random() * tiedMaps.length)];
                    }
                    
                    room.selectedMap = selectedMapId;
                    
                    console.log('Všetci hráči pripravení a vybrali si! Spúšťam hru...');
                    setTimeout(() => {
                        startGame(room);
                    }, 2000);
                }
            }
        }
    });

    // Game ready state for final game start (team mode combined selection)
    socket.on('game-ready', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameMode !== 'team-vs-team' || room.currentPhase !== 'combined-selection') return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.gameReady = data.ready;
            
            // Initialize gameReadyPlayers if it doesn't exist
            if (!room.gameReadyPlayers) {
                room.gameReadyPlayers = new Set();
            }
            
            if (data.ready) {
                room.gameReadyPlayers.add(socket.id);
            } else {
                room.gameReadyPlayers.delete(socket.id);
            }
            
            // Broadcast game ready status
            io.to(room.id).emit('game-ready-updated', {
                playerId: socket.id,
                ready: data.ready,
                gameReadyCount: room.gameReadyPlayers.size,
                totalPlayers: room.players.length,
                gameReadyPlayers: Array.from(room.gameReadyPlayers),
                allGameReady: room.gameReadyPlayers.size === room.players.length
            });
            
            console.log(`Hráč ${player.name} je ${data.ready ? 'ready na hru' : 'nie je ready na hru'}`);
            
            // Check if all players are game ready and have made all selections
            if (room.gameReadyPlayers.size === room.players.length) {
                console.log('Debug - všetci hráči game ready, kontrolujem selections...');
                
                // Debug log each player's selections
                room.players.forEach(p => {
                    console.log(`Hráč ${p.name}: char=${p.selectedCharacter}, tank=${p.selectedTank}`);
                });
                
                const allSelected = room.players.every(p => 
                    p.selectedCharacter && p.selectedTank
                );
                
                console.log(`All selected: ${allSelected}`);
                
                if (allSelected) {
                    // Select most voted map or default
                    let selectedMapId = '1';
                    let maxVotes = 0;
                    
                    for (let mapId in room.mapVotes) {
                        if (room.mapVotes[mapId].length > maxVotes) {
                            maxVotes = room.mapVotes[mapId].length;
                            selectedMapId = mapId;
                        }
                    }
                    
                    // Handle ties
                    const tiedMaps = Object.keys(room.mapVotes).filter(mapId => room.mapVotes[mapId].length === maxVotes);
                    if (tiedMaps.length > 1) {
                        selectedMapId = tiedMaps[Math.floor(Math.random() * tiedMaps.length)];
                    }
                    
                    room.selectedMap = selectedMapId;
                    
                    console.log('Všetci hráči sú ready na hru a majú všetko vybraté! Spúšťam hru...');
                    setTimeout(() => {
                        startGame(room);
                    }, 2000);
                }
            }
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
            // Reduce logging to prevent spam
            if (Math.random() < 0.001) { // 0.1% chance
                console.log(`📍 Server: Position from ${socket.id}:`, {
                    x: Math.round(positionData.x),
                    y: Math.round(positionData.y)
                });
            }
            
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
        
        console.log('🎯 player-death event received:', {
            playerId: deathData.playerId,
            roomId: socket.currentRoom,
            roomExists: !!room,
            gameState: room?.gameState
        });
        
        if (room && (room.gameState === 'playing' || room.gameState === globalStateManager.gameStates.PLAYING)) {
            const player = room.players.find(p => p.id === deathData.playerId);
            
            console.log('🔍 Checking alive players:', {
                alivePlayers: Array.from(room.alivePlayers),
                deadPlayerId: deathData.playerId,
                isAlive: room.alivePlayers.has(deathData.playerId)
            });
            
            // Broadcast death to all players in room
            io.to(room.id).emit('player-death', {
                playerId: deathData.playerId,
                killerId: socket.id,
                timestamp: Date.now()
            });
            
            // Check if player is already eliminated
            if (room.alivePlayers.has(deathData.playerId)) {
                console.log('Player died, marking as eliminated:', deathData.playerId);
                
                try {
                    // Mark player as eliminated
                    room.eliminatePlayer(deathData.playerId);
                    
                    // Notify all players about elimination
                    io.to(room.id).emit('player-eliminated', {
                        playerId: deathData.playerId,
                        playerName: player?.name || 'Unknown',
                        team: player?.team,
                        eliminationTime: Date.now(),
                        remainingPlayers: room.alivePlayers.size,
                        timestamp: Date.now()
                    });

                    // Check if round/game should end
                    const gameEndResult = globalStateManager.checkEndCondition(room);
                    if (gameEndResult && gameEndResult.shouldEnd) {
                        console.log('Game end condition met after death:', gameEndResult);
                        handleGameEnd(room, gameEndResult);
                    } else {
                        console.log(`Game continues - ${room.alivePlayers.size} players remaining`);
                    }
                } catch (error) {
                    console.error('Error handling player death:', error);
                }
            }
        }
    });

    // --- END GAME EVENTS ---
    
    // Player elimination (when tank is destroyed)
    socket.on('player-eliminated', (data) => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room || room.gameState !== globalStateManager.gameStates.PLAYING) {
            console.warn(`Player elimination ignored - invalid room state: ${room?.gameState}`);
            return;
        }

        console.log('Player eliminated:', socket.id, 'Name:', data.playerName);
        
        // Check if player is already eliminated to prevent duplicates
        if (room.spectators.has(socket.id)) {
            console.warn('Player already eliminated:', socket.id);
            return;
        }
        
        // Validate player exists in room
        const player = room.players.find(p => p.id === socket.id);
        if (!player) {
            console.error('Cannot eliminate player - not found in room:', socket.id);
            return;
        }
        
        try {
            // Mark player as eliminated
            room.eliminatePlayer(socket.id);
            
            // Notify all players about elimination with comprehensive data
            io.to(room.id).emit('player-eliminated', {
                playerId: socket.id,
                playerName: data.playerName || player.name || 'Unknown',
                team: player.team,
                eliminationTime: Date.now(),
                remainingPlayers: room.alivePlayers.size,
                timestamp: data.timestamp || Date.now()
            });

            // Check if round/game should end using the state manager
            const gameEndResult = globalStateManager.checkEndCondition(room);
            if (gameEndResult && gameEndResult.shouldEnd) {
                console.log('Game end condition met:', gameEndResult);
                handleGameEnd(room, gameEndResult);
            } else {
                console.log(`Game continues - ${room.alivePlayers.size} players remaining`);
            }
        } catch (error) {
            console.error('Error handling player elimination:', error);
            // Send error to client
            socket.emit('elimination-error', {
                message: 'Failed to process elimination',
                error: error.message
            });
        }
    });

    // Back to lobby request
    socket.on('back-to-lobby', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room) return;

        // Reset room state to waiting
        room.gameState = 'waiting';
        room.currentPhase = 'team-selection';
        room.currentRound = 1;
        room.roundScores = { blue: 0, red: 0 };
        room.roundWinners = [];
        room.matchEnded = false;
        room.alivePlayers.clear();
        room.spectators.clear();
        room.eliminationOrder = [];

        // Reset player states
        room.players.forEach(player => {
            player.ready = false;
        });

        // Notify all players to return to lobby
        io.to(room.id).emit('back-to-lobby');
    });

    // Play again request
    socket.on('play-again', () => {
        const room = gameRooms.get(socket.currentRoom);
        if (!room) return;

        if (room.hostId !== socket.id) return; // Only host can start

        // Reset game state for new match
        room.gameState = 'waiting';
        room.currentPhase = 'team-selection';
        room.currentRound = 1;
        room.roundScores = { blue: 0, red: 0 };
        room.roundWinners = [];
        room.matchEnded = false;
        room.initializeGame();

        // Reset player ready states
        room.players.forEach(player => {
            player.ready = false;
        });

        // Notify all players to start new game
        io.to(room.id).emit('game-restart');
    });

    // Handle player leaving room voluntarily
    socket.on('leave-room', () => {
        console.log('🚪 Player leaving room:', socket.id);
        
        if (socket.currentRoom) {
            const room = gameRooms.get(socket.currentRoom);
            if (room) {
                const player = room.players.find(p => p.id === socket.id);
                
                // Remove player from room
                room.removePlayer(socket.id);
                
                // Notify others
                io.to(room.id).emit('player-left', {
                    playerId: socket.id,
                    playerName: player?.name || 'Unknown'
                });
                
                // Clean up if room is empty
                if (room.isEmpty()) {
                    console.log('Room empty after leave, deleting:', room.id);
                    gameRooms.delete(room.id);
                }
            }
            
            // Clear current room reference
            socket.currentRoom = null;
            socket.leave(socket.currentRoom);
        }
    });

    // Handle rematch voting for all-vs-all matches
    socket.on('rematch-vote', (data) => {
        console.log('🗳️ Rematch vote received:', socket.id, 'vote:', data.vote);
        
        const room = gameRooms.get(socket.currentRoom);
        if (!room) {
            console.log('Room not found for rematch vote');
            return;
        }
        
        // Initialize rematch voting if not started
        if (!room.rematchVotes) {
            room.rematchVotes = new Map();
            room.rematchVoteStartTime = Date.now();
        }
        
        // Record vote
        room.rematchVotes.set(socket.id, data.vote);
        
        // If anyone votes no, cancel rematch
        if (data.vote === false) {
            console.log('❌ Player declined rematch');
            
            const decliningPlayer = room.players.find(p => p.id === socket.id);
            
            // Notify all players that rematch was declined (popup will show on client)
            io.to(room.id).emit('rematch-declined', {
                playerName: decliningPlayer?.name || 'Niekto'
            });
            
            // Clean up room state immediately
            room.rematchVotes = null;
            room.rematchVoteStartTime = null;
            room.gameState = globalStateManager.gameStates.WAITING;
            
            return;
        }
        
        // Check if all players have voted yes
        const allPlayersVoted = room.players.every(player => 
            room.rematchVotes.has(player.id)
        );
        
        const allVotedYes = room.players.every(player => 
            room.rematchVotes.get(player.id) === true
        );
        
        console.log(`📊 Rematch votes: ${room.rematchVotes.size}/${room.players.length}`);
        
        if (allPlayersVoted && allVotedYes) {
            console.log('✅ All players voted for rematch, restarting match!');
            
            // Reset match state
            room.currentRound = 1; // Start from round 1, not 0
            room.roundWins = {};
            room.players.forEach(player => {
                room.roundWins[player.id] = 0;
            });
            
            // Clean up voting
            room.rematchVotes = null;
            room.rematchVoteStartTime = null;
            
            // Notify players match is restarting
            io.to(room.id).emit('rematch-accepted');
            
            // Start new match after 3 seconds
            setTimeout(() => {
                startGame(room);
            }, 3000);
        } else {
            // Update other players about voting progress
            const votedCount = room.rematchVotes.size;
            const totalCount = room.players.length;
            
            io.to(room.id).emit('rematch-vote-update', {
                voted: votedCount,
                total: totalCount,
                votedPlayers: Array.from(room.rematchVotes.keys()).map(id => {
                    const player = room.players.find(p => p.id === id);
                    return player?.name || 'Unknown';
                })
            });
        }
    });

    // Handle disconnection with improved game state management
    socket.on('disconnect', () => {
        console.log('Hráč sa odpojil:', socket.id);
        
        if (socket.currentRoom) {
            const room = gameRooms.get(socket.currentRoom);
            if (room) {
                const disconnectedPlayer = room.players.find(p => p.id === socket.id);
                const wasHost = room.hostId === socket.id;
                const wasPlaying = room.gameState === globalStateManager.gameStates.PLAYING;
                
                // Handle disconnection during rematch voting
                if (room.rematchVotes) {
                    console.log('❌ Player disconnected during rematch voting');
                    
                    // Notify remaining players (popup will show on client)
                    io.to(room.id).emit('player-left-rematch-vote', {
                        playerName: disconnectedPlayer?.name || 'Niekto'
                    });
                    
                    // Clean up voting state immediately
                    room.rematchVotes = null;
                    room.rematchVoteStartTime = null;
                    room.gameState = globalStateManager.gameStates.WAITING;
                }
                
                // Handle mid-game disconnection
                if (wasPlaying && room.alivePlayers.has(socket.id)) {
                    console.log('Player disconnected during game, eliminating:', socket.id);
                    
                    // Eliminate the disconnected player
                    room.eliminatePlayer(socket.id);
                    
                    // Notify remaining players about disconnection
                    io.to(room.id).emit('player-disconnected', {
                        playerId: socket.id,
                        playerName: disconnectedPlayer?.name || 'Unknown',
                        team: disconnectedPlayer?.team,
                        timestamp: Date.now()
                    });
                    
                    // Check if game should end due to disconnection
                    const gameEndResult = globalStateManager.checkEndCondition(room);
                    if (gameEndResult && gameEndResult.shouldEnd) {
                        console.log('Game ending due to disconnection');
                        handleGameEnd(room, gameEndResult);
                    }
                }
                
                // Remove player from room
                room.removePlayer(socket.id);
                
                // Handle host change
                if (wasHost && room.players.length > 0) {
                    console.log('Host disconnected, assigning new host:', room.hostId);
                    io.to(room.id).emit('host-changed', {
                        newHostId: room.hostId,
                        newHostName: room.players.find(p => p.id === room.hostId)?.name
                    });
                }
                
                // Notify remaining players about player leaving
                io.to(room.id).emit('player-left', {
                    playerId: socket.id,
                    playerName: disconnectedPlayer?.name || 'Unknown',
                    remainingPlayers: room.players,
                    newHostId: room.hostId
                });

                // Remove empty rooms or pause game if too few players
                if (room.isEmpty()) {
                    console.log('Room empty, deleting:', room.id);
                    gameRooms.delete(room.id);
                } else if (wasPlaying && room.players.length < room.minPlayers) {
                    console.log('Too few players remaining, pausing game');
                    room.gameState = globalStateManager.gameStates.WAITING;
                    io.to(room.id).emit('game-paused', {
                        reason: 'Too few players remaining',
                        minPlayers: room.minPlayers,
                        currentPlayers: room.players.length
                    });
                }
            }
        }
    });
});

function startGame(room) {
    room.gameState = 'playing';
    
    // Initialize round tracking if this is the first round
    if (!room.currentRound) {
        room.currentRound = 1;
    }
    if (!room.roundWins) {
        if (room.teamMode) {
            room.roundWins = { blue: 0, red: 0 };
        } else {
            room.roundWins = {};
            room.players.forEach(p => {
                room.roundWins[p.id] = 0;
            });
        }
    }
    
    // Initialize alive players - ALL players start alive
    room.alivePlayers.clear();
    room.players.forEach(player => {
        room.alivePlayers.add(player.id);
    });
    
    console.log('🎮 Game started with alive players:', Array.from(room.alivePlayers));
    
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
    
    console.log(`🎯 SPAWN DEBUG:`);
    console.log(`Arena size: ${arenaWidth}x${arenaHeight}`);
    console.log('Room players:', room.players.map(p => ({ id: p.id, name: p.name })));
    console.log('Generated player positions:', JSON.stringify(playerPositions, null, 2));
    
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

// --- END GAME HELPER FUNCTIONS ---

function handleGameEnd(room, result) {
    const endResult = globalStateManager.checkEndCondition(room);
    
    if (!endResult || !endResult.shouldEnd) {
        console.warn('HandleGameEnd called but no valid end condition found');
        return;
    }
    
    if (room.teamMode) {
        handleTeamGameEnd(room, endResult);
    } else {
        handleAllVsAllEnd(room, endResult);
    }
}

function handleTeamGameEnd(room, endResult) {
    // Track round winner team
    const winnerTeam = endResult.winner; // 'blue' or 'red'
    
    // Initialize round wins tracking if not exists
    if (!room.roundWins) {
        room.roundWins = {
            blue: 0,
            red: 0
        };
    }
    
    // Increment winner team's round count
    if (winnerTeam && (winnerTeam === 'blue' || winnerTeam === 'red')) {
        room.roundWins[winnerTeam]++;
    }
    
    console.log('🏆 Team round ended. Round wins:', room.roundWins);
    
    // Check if a team won 3 rounds (match winner)
    const matchWinnerTeam = room.roundWins.blue >= 3 ? 'blue' : (room.roundWins.red >= 3 ? 'red' : null);
    
    if (matchWinnerTeam) {
        // Match is over - a team won 3 rounds
        room.gameState = globalStateManager.gameStates.ENDED;
        
        const endData = {
            type: 'team-match-end',
            matchWinnerTeam: matchWinnerTeam,
            matchWinnerTeamName: matchWinnerTeam === 'blue' ? 'Modrý tím' : 'Červený tím',
            roundWins: room.roundWins,
            totalRounds: room.currentRound,
            players: room.players.map(p => ({ id: p.id, name: p.name, team: p.team }))
        };
        
        console.log('🎊 Match winner:', matchWinnerTeam, 'team with', room.roundWins[matchWinnerTeam], 'round wins');
        
        setTimeout(() => {
            io.to(room.id).emit('team-match-end', endData);
        }, 2000);
    } else {
        // Round ended, but match continues
        room.gameState = globalStateManager.gameStates.ROUND_END;
        
        const roundEndData = {
            type: 'team-round-end',
            roundWinnerTeam: winnerTeam,
            roundWinnerTeamName: winnerTeam === 'blue' ? 'Modrý tím' : 'Červený tím',
            round: room.currentRound, // Show current round number (1, 2, 3...)
            roundWins: room.roundWins,
            nextRoundIn: 10, // seconds
            players: room.players.map(p => ({ id: p.id, name: p.name, team: p.team }))
        };
        
        console.log('📢 Round', room.currentRound, 'winner:', winnerTeam, 'team');
        
        // Increment AFTER sending data
        room.currentRound++;
        
        io.to(room.id).emit('team-round-end', roundEndData);
        
        // Start next round after 10 seconds
        setTimeout(() => {
            startNextRound(room);
        }, 10000);
    }
}

function handleAllVsAllEnd(room, endResult) {
    // Track round winner
    const winnerId = endResult.winner;
    const winnerPlayer = room.players.find(p => p.id === winnerId);
    
    // Initialize round wins tracking if not exists
    if (!room.roundWins) {
        room.roundWins = {};
        room.players.forEach(p => {
            room.roundWins[p.id] = 0;
        });
    }
    
    // Increment winner's round count
    if (winnerId && room.roundWins[winnerId] !== undefined) {
        room.roundWins[winnerId]++;
    }
    
    console.log('🏆 All-vs-all round ended. Round wins:', room.roundWins);
    
    // Check if someone won 3 rounds (match winner)
    const maxWins = Math.max(...Object.values(room.roundWins));
    const matchWinnerId = Object.keys(room.roundWins).find(id => room.roundWins[id] >= 3);
    
    if (matchWinnerId) {
        // Match is over - someone won 3 rounds
        const matchWinner = room.players.find(p => p.id === matchWinnerId);
        room.gameState = globalStateManager.gameStates.ENDED;
        
        const endData = {
            type: 'all-vs-all-match-end',
            matchWinner: matchWinnerId,
            matchWinnerName: matchWinner?.name,
            roundWins: room.roundWins,
            totalRounds: room.currentRound,
            ranking: endResult.data?.finalRanking || [],
            players: room.players.map(p => ({ id: p.id, name: p.name })) // Add player names
        };
        
        console.log('🎊 Match winner:', matchWinner?.name, 'with', room.roundWins[matchWinnerId], 'round wins');
        
        setTimeout(() => {
            io.to(room.id).emit('all-vs-all-match-end', endData);
        }, 2000);
    } else {
        // Round ended, but match continues
        room.gameState = globalStateManager.gameStates.ROUND_END;
        
        const roundEndData = {
            type: 'all-vs-all-round-end',
            roundWinner: winnerId,
            roundWinnerName: winnerPlayer?.name,
            round: room.currentRound, // Show current round number (1, 2, 3...)
            roundWins: room.roundWins,
            nextRoundIn: 10, // seconds
            players: room.players.map(p => ({ id: p.id, name: p.name })) // Add player names
        };
        
        console.log('📢 Round', room.currentRound, 'winner:', winnerPlayer?.name);
        
        // Increment AFTER sending data
        room.currentRound++;
        
        io.to(room.id).emit('all-vs-all-round-end', roundEndData);
        
        // Start next round after 10 seconds
        setTimeout(() => {
            startNextRound(room);
        }, 10000);
    }
}

function startNextRound(room) {
    console.log('🔄 Starting next round for room:', room.id);
    
    // Validate state transition
    if (!globalStateManager.canTransitionTo(room.gameState, globalStateManager.gameStates.PLAYING)) {
        console.error('Invalid state transition for next round');
        return;
    }
    
    // Reset for next round (this clears alivePlayers and repopulates it)
    room.resetForNextRound();
    
    console.log('🎮 Restarting game for round', room.currentRound);
    
    // Simply call startGame again - it will handle everything
    startGame(room);
}

// Start server
const PORT = process.env.PORT || 3002;

// Get local network IP address (prefer WiFi)
function getLocalIPAddress() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let fallbackIP = null;
    
    // Try to find WiFi or Wireless interface first
    for (const name of Object.keys(interfaces)) {
        if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wireless')) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    }
    
    // Fallback to any non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (!fallbackIP) fallbackIP = iface.address;
            }
        }
    }
    
    return fallbackIP || 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIPAddress();
    console.log(`Server beží na porte ${PORT}`);
    console.log(`Lokálne: http://localhost:${PORT}`);
    console.log(`Sieť: http://${localIP}:${PORT}`);
});
