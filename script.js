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

// --- MULTIPLAYER OPTIMIZATIONS ---
let lastNetworkSync = 0;
const NETWORK_SYNC_INTERVAL = 150; // Send position updates every 150ms for better performance (6.7 FPS)
const MULTIPLAYER_TARGET_FPS = 60; // Full FPS for smooth multiplayer experience
const MULTIPLAYER_FRAME_TIME = 1000 / MULTIPLAYER_TARGET_FPS;
const EFFECTS_REDUCTION_FACTOR = 0.3; // Reduce visual effects in multiplayer
const MAX_PARTICLES_MULTIPLAYER = 15; // Limit particles in multiplayer
const MAX_TRACKS_MULTIPLAYER = 20; // Limit tank tracks in multiplayer
const VIEWPORT_CULLING_MARGIN = 300; // Extra margin for viewport culling (increased for multiplayer)
let lastFrameTime = 0;

// Initialize multiplayer connection
function initMultiplayer(gameMode = '1v1') {
    if (socket && socket.connected) {
        socket.disconnect();
    }
    
    socket = io();
    
    socket.on('connect', () => {
        console.log('Pripojený k serveru');
        isMultiplayer = true;
        
        // Request to join a game with specific mode
        socket.emit('join-game', {
            name: 'Hráč_' + Math.floor(Math.random() * 1000),
            gameMode: gameMode
        });
    });
    
    socket.on('disconnect', () => {
        console.log('Odpojený od servera');
        isMultiplayer = false;
    });
    
    socket.on('player-joined', (data) => {
        console.log('Hráč sa pripojil:', data);
        otherPlayers = data.players.filter(p => p.id !== socket.id);
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
            otherTank.x = data.x;
            otherTank.y = data.y;
            otherTank.angle = data.angle;
            otherTank.turretAbsoluteAngle = data.turretAngle;
        }
    });

    // Handle shooting from other players
    socket.on('player-shoot', (data) => {
        const otherTank = multiplayerTanks.get(data.playerId);
        if (otherTank) {
            // Create bullet from other player
            const bullet = new Bullet(
                data.x,
                data.y,
                data.angle,
                otherTank.damage * (data.bulletType === 2 ? 2 : 1),
                otherTank,
                data.bulletType || 1
            );
            gameState.bullets.push(bullet);
            
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
}

// Update lobby UI
function updateLobbyUI(data) {
    const lobbyStatus = document.getElementById('lobby-status');
    const lobbyPlayers = document.getElementById('lobby-players');
    const playersList = document.getElementById('players-list');
    const readyBtn = document.getElementById('ready-btn');
    const readySection = document.getElementById('lobby-ready-section');
    const waitingDiv = document.getElementById('lobby-waiting');
    const mapSelection = document.getElementById('lobby-map-selection');
    const characterSelection = document.getElementById('lobby-character-selection');
    const tankSelection = document.getElementById('lobby-tank-selection');
    
    // Get game mode name
    const gameModeNames = {
        '1v1': '1 vs 1',
        '2v2': '2 vs 2 (Tímy)',
        '3v3': '3 vs 3 (Tímy)',
        'free-for-all-3': 'Voľný súboj (3 hráči)',
        'free-for-all-4': 'Voľný súboj (4 hráči)',
        'free-for-all-6': 'Voľný súboj (6 hráčov)',
        'unlimited': 'Neobmedzený (2-16 hráčov)'
    };
    const gameModeName = gameModeNames[data.gameMode] || data.gameMode;
    
    lobbyStatus.innerHTML = `
        <p>Pripojený k serveru - Miestnosť: ${data.roomId} ${isHost ? '(Host)' : ''}</p>
        <p>Herný mód: <strong>${gameModeName}</strong></p>
        ${data.teamMode ? '<p style="color: #3498db;">🛡️ Tímový režim</p>' : '<p style="color: #e67e22;">⚔️ Každý proti každému</p>'}
    `;
    
    // Show players section
    lobbyPlayers.style.display = 'block';
    
    // Update players list
    playersList.innerHTML = '';
    
    if (data.teamMode && data.teams) {
        // Show teams separately
        const team1Players = data.players.filter(p => p.team === 'team1');
        const team2Players = data.players.filter(p => p.team === 'team2');
        
        // Team 1
        if (team1Players.length > 0) {
            const team1Header = document.createElement('div');
            team1Header.className = 'team-header team1';
            team1Header.innerHTML = '<h4>🔵 Tím 1</h4>';
            playersList.appendChild(team1Header);
            
            team1Players.forEach(player => {
                const playerDiv = createPlayerItem(player, data.hostId);
                playerDiv.classList.add('team1-player');
                playersList.appendChild(playerDiv);
            });
        }
        
        // Team 2
        if (team2Players.length > 0) {
            const team2Header = document.createElement('div');
            team2Header.className = 'team-header team2';
            team2Header.innerHTML = '<h4>🔴 Tím 2</h4>';
            playersList.appendChild(team2Header);
            
            team2Players.forEach(player => {
                const playerDiv = createPlayerItem(player, data.hostId);
                playerDiv.classList.add('team2-player');
                playersList.appendChild(playerDiv);
            });
        }
    } else {
        // Show players without teams
        data.players.forEach(player => {
            const playerDiv = createPlayerItem(player, data.hostId);
            playersList.appendChild(playerDiv);
        });
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
    
    // Show selection sections based on game mode and phase
    const canShowSelections = data.gameMode === 'unlimited' ? 
        data.selectionPhase : 
        (data.playersCount >= data.maxPlayers);
    
    if (canShowSelections) {
        characterSelection.style.display = 'block';
        tankSelection.style.display = 'block';
        mapSelection.style.display = 'block';
        initCharacterSelection();
        initTankSelection();
        initMapSelection();
        updateMapSelection(selectedLobbyMap);
        readySection.style.display = 'block';
        waitingDiv.style.display = 'none';
    } else {
        characterSelection.style.display = 'none';
        tankSelection.style.display = 'none';
        mapSelection.style.display = 'none';
        readySection.style.display = 'none';
        waitingDiv.style.display = 'block';
        
        if (data.gameMode === 'unlimited' && !data.selectionPhase) {
            waitingDiv.innerHTML = `<p>Čakám na spustenie výberu od hosta... (${data.playersCount} hráčov pripojených)</p><div id="waiting-dots">●●●</div>`;
        } else {
            waitingDiv.innerHTML = `<p>Čakám na ďalších hráčov... (${data.playersCount}/${data.maxPlayers})</p><div id="waiting-dots">●●●</div>`;
        }
    }
    
    // Show ready button if not ready yet and all selections made
    const myPlayer = data.players.find(p => p.id === socket.id);
    if (myPlayer && !myPlayer.ready && data.playersCount >= data.maxPlayers) {
        const hasSelections = selectedLobbyCharacter && selectedLobbyTank;
        if (hasSelections) {
            readyBtn.style.display = 'block';
            readyBtn.onclick = () => {
                socket.emit('player-ready');
                readyBtn.style.display = 'none';
            };
        } else {
            readyBtn.style.display = 'none';
        }
    } else {
        readyBtn.style.display = 'none';
    }
    
    // Handle host buttons for unlimited mode
    const hostStartSelectionBtn = document.getElementById('host-start-selection-btn');
    const hostStartBtn = document.getElementById('host-start-game-btn');
    
    console.log('UpdateLobbyUI - Unlimited mode check:', data.gameMode === 'unlimited');
    console.log('UpdateLobbyUI - Is host:', isHost);
    console.log('UpdateLobbyUI - Selection phase:', data.selectionPhase);
    console.log('UpdateLobbyUI - Selection button found:', !!hostStartSelectionBtn);
    
    if (isHost && data.gameMode === 'unlimited') {
        if (!data.selectionPhase) {
            // Show selection start button
            if (hostStartSelectionBtn) {
                console.log('Setting up selection start button');
                hostStartSelectionBtn.style.display = 'block';
                hostStartSelectionBtn.onclick = () => {
                    console.log('Selection button clicked, sending event');
                    console.log('Socket connected:', socket && socket.connected);
                    console.log('Current room:', currentRoom);
                    if (socket && currentRoom) {
                        console.log('Emitting host-start-selection event');
                        socket.emit('host-start-selection');
                        console.log('Event emitted');
                    } else {
                        console.log('Socket or currentRoom not available:', { socket: !!socket, currentRoom });
                    }
                };
                
                if (data.players.length >= data.minPlayers) {
                    hostStartSelectionBtn.disabled = false;
                    hostStartSelectionBtn.textContent = `Spustiť výber (${data.players.length} hráčov)`;
                } else {
                    hostStartSelectionBtn.disabled = true;
                    hostStartSelectionBtn.textContent = `Potrebujete minimálne ${data.minPlayers} hráčov`;
                }
            }
            
            if (hostStartBtn) {
                hostStartBtn.style.display = 'none';
            }
        } else {
            // Selection phase is active, show game start button
            if (hostStartSelectionBtn) {
                hostStartSelectionBtn.style.display = 'none';
            }
            
            if (hostStartBtn) {
                hostStartBtn.style.display = 'block';
                hostStartBtn.onclick = () => {
                    if (socket && currentRoom) {
                        socket.emit('host-start-game');
                    }
                };
                
                const readyCount = data.players.filter(p => p.ready).length;
                const minPlayers = data.minPlayers || 2;
                
                if (readyCount >= minPlayers) {
                    hostStartBtn.disabled = false;
                    hostStartBtn.textContent = `Spustiť hru (${readyCount}/${data.players.length} pripravených)`;
                } else {
                    hostStartBtn.disabled = true;
                    hostStartBtn.textContent = `Potrebujete minimálne ${minPlayers} pripravených hráčov`;
                }
            }
        }
    } else {
        // Hide both buttons for non-hosts or other game modes
        if (hostStartSelectionBtn) {
            hostStartSelectionBtn.style.display = 'none';
        }
        if (hostStartBtn) {
            hostStartBtn.style.display = 'none';
        }
    }
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
    
    // Send to server
    socket.emit('select-character', { characterId: characterId });
    
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
    
    // Send to server
    socket.emit('select-tank', { tankId: tankId });
    
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
function selectLobbyMap(mapId) {
    if (!isHost) return;
    
    selectedLobbyMap = mapId;
    
    // Send to server
    socket.emit('select-map', { mapId: mapId });
    
    // Update UI immediately
    updateMapSelection(mapId);
}

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
    gameState.bullets = [];
    gameState.tracks = [];
    gameState.particles = [];
    gameState.shotEffects = [];
    gameState.hitEffects = [];
    gameState.allies = []; // No allies in multiplayer
    
    // Create tanks for all players using server positions
    const myPlayerId = socket.id;
    const playerPositions = data.gameData.playerPositions || {};
    
    // Clear existing tanks
    multiplayerTanks.clear();
    gameState.enemies = [];
    
    // Create tanks for all players
    data.players.forEach(playerData => {
        const position = playerPositions[playerData.id];
        if (!position) return;
        
        const isMyPlayer = playerData.id === myPlayerId;
        const characterKey = position.character || playerData.selectedCharacter || 'jaccelini';
        
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
            gameState.enemies.push(tank);
        }
        
        multiplayerTanks.set(playerData.id, tank);
    });
    
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
    // Full reload to reset the game as if freshly opened
    window.location.reload();
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
    mainMenu: document.getElementById('main-menu'),
    tutorial: document.getElementById('tutorial-screen'),
    modeSelection: document.getElementById('mode-selection'),
    characterSelection: document.getElementById('character-selection'),
    mapSelection: document.getElementById('map-selection'),
    tankSelection: document.getElementById('tank-selection'),
    multiplayerModeSelection: document.getElementById('multiplayer-mode-selection'),
    multiplayerLobby: document.getElementById('multiplayer-lobby'),
    game: document.getElementById('game-container'),
    endScreen: document.getElementById('end-screen')
};

const buttons = {
    start: document.getElementById('start-btn'),
    multiplayer: document.getElementById('multiplayer-btn'),
    tutorial: document.getElementById('tutorial-btn'),
    end: document.getElementById('end-btn'),
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
    kushi: { name: 'P. Kushi', country: 'Japonsko', image: 'hrebenar.jpg', flag: 'JAP.png' },
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
    currentScreen: 'intro', // Default screen is now 'intro'
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

const loadAssets = async () => {
    try {
        // Load background texture
        await loadImage('menu_background', 'menu_background.png');

        // Map 1 assets
        await loadImage('grass_texture', 'grass_texture.png');
        await loadImage('mud_texture', 'mud_texture.png');
        await loadImage('tree_texture', 'tree_texture.png');
        await loadImage('rock_texture', 'rock_texture.png');
        await loadImage('coin_icon', 'coin.png');

        // Map 2 assets
        await loadImage('dessert_texture', 'dessert.jpg');
        await loadImage('oilrig', 'oilrig.png');

        // Map 3 assets
        await loadImage('ice_texture', 'ice.png');
        await loadImage('iglu', 'IGLU.png');

        // Load bullet image
        await loadImage('bullet', 'bullet.png');
        await loadImage('bullet2', 'bullet2.png');

        // Load snowball image for eskimo bullets
        await loadImage('snowball', 'snehovgula.png');

        // Load tank images
        for (const type in TANK_SPECS) {
            await loadImage(`tank_${type}`, TANK_SPECS[type].tankImage);
            await loadImage(`canon_${type}`, TANK_SPECS[type].canonImage);
        }

        // NOVINKA: Load character images
        for (const charKey in CHARACTERS) {
            await loadImage(`char_${charKey}`, CHARACTERS[charKey].image);
        }

        gameState.grassTexture = images['grass_texture'];
        gameState.mudTexture = images['mud_texture'];
        gameState.treeTexture = images['tree_texture'];
        gameState.rockTexture = images['rock_texture'];
        gameState.coinTexture = images['coin_icon'];
        gameState.dessertTexture = images['dessert_texture'];
        gameState.iceTexture = images['ice_texture'];
        gameState.igluImage = images['iglu'];
        document.getElementById('main-menu').style.backgroundImage = `url(${images['menu_background'].src})`;
        document.getElementById('character-selection').style.backgroundImage = `url(${images['menu_background'].src})`;

        for (const type in TANK_SPECS) {
            gameState.tankImages[type] = images[`tank_${type}`];
            gameState.canonImages[type] = images[`canon_${type}`];
        }

        // Assign loaded character images
        for (const charKey in CHARACTERS) {
            gameState.charImages[charKey] = images[`char_${charKey}`];
        }

        console.log('Assets loaded successfully!');
    } catch (error) {
        console.error('Failed to load assets:', error);
        alert('Chyba pri načítaní herných súborov! Skontrolujte konzolu pre detaily.'); // User friendly message
    }
};


// --- CLASSES (Game Objects) ---
class Tank {
    constructor(x, y, type, isPlayer = false, isAlly = false, characterKey = null) {
        const spec = TANK_SPECS[type];
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
                        gameState.bullets.push(new Bullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage * 2, this, 2));
                    } else {
                        // Not enough coins, fallback to normal bullet
                        gameState.bullets.push(new Bullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage, this, 1));
                        bulletType = 1; // Update bulletType for multiplayer sync
                    }
                } else {
                    gameState.bullets.push(new Bullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage, this, 1));
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
                    gameState.bullets.push(new Bullet(bulletX, bulletY, this.turretAbsoluteAngle, this.damage, this, 1));
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
            gameState.particles.push(new Particle(
                this.x + this.width / 2,
                this.y + this.height / 2,
                angle,
                speed,
                size,
                explosionColor,
                life
            ));
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

    constructor(x, y, angle, damage, owner, bulletType = 1) {
        this.x = x;
        this.y = y;
        this.radius = 5;
        this.speed = 10;
        this.angle = angle;
        this.damage = damage;
        this.owner = owner;
        this.bulletType = bulletType;
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
                    gameState.particles.push(new Particle(this.x, this.y, Math.random() * Math.PI * 2, Math.random() * 3 + 1, Math.random() * 3 + 1, '#5D4037', 30));
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
                    gameState.particles.push(new Particle(
                        this.x + this.width / 2, 
                        this.y + this.height / 2, 
                        Math.random() * Math.PI * 2, 
                        Math.random() * 4 + 2, 
                        Math.random() * 4 + 2, 
                        color, 
                        35
                    ));
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
                    gameState.particles.push(new Particle(
                        this.x + this.width / 2, 
                        this.y + this.height / 2, 
                        Math.random() * Math.PI * 2, 
                        Math.random() * 5 + 3, 
                        Math.random() * 5 + 3, 
                        color, 
                        40
                    ));
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
    constructor(x, y, angle, speed, size, color, life) {
        this.x = x;
        this.y = y;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.size = size;
        this.color = color;
        this.life = life; // lifespan in frames
        this.initialLife = life;
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
    gameState.bullets.forEach((bullet, bIdx) => {
        if (bullet.bulletType === 3) return; // Ignore their own bullets
        gameState.chasingSquares.forEach((sq, sIdx) => {
            if (!sq.isAlive) return;
            const b = bullet;
            const bounds = sq.getBounds();
            if (b.x > bounds.x && b.x < bounds.x + bounds.width && b.y > bounds.y && b.y < bounds.y + bounds.height) {
                sq.takeDamage(b.damage);
                gameState.bullets.splice(bIdx, 1);
            }
        });
    });
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
    gameState.bullets.forEach((bullet, bIdx) => {
        if (bullet.bulletType !== 3) return;
        const allTanks = [gameState.player, ...gameState.allies, ...gameState.enemies].filter(t => t && t.health > 0);
        allTanks.forEach(tank => {
            if (tank !== bullet.owner && checkCollision({x: bullet.x, y: bullet.y, width: 1, height: 1}, tank)) {
                tank.takeDamage(1, bullet.owner);
                gameState.bullets.splice(bIdx, 1);
            }
        });
});
}

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
    screens[screenName].classList.add('active');
    gameState.currentScreen = screenName;

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
}

// --- INITIALIZATION AND GAME START ---
function init() {
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
    loadAssets().then(() => {
        // Set initial app container size for main menu (fullscreen)
        appContainer.style.width = `${window.innerWidth}px`;
        appContainer.style.height = `${window.innerHeight}px`;

        // Load initial coins from localStorage
        loadCoins();

        // --- NEW: Handle intro video ---
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
    });


    // Event Listeners for menu buttons
    buttons.start.addEventListener('click', () => showScreen('modeSelection'));
    buttons.multiplayer.addEventListener('click', () => {
        showScreen('multiplayerModeSelection');
    });
    buttons.tutorial.addEventListener('click', () => showScreen('tutorial'));
    buttons.end.addEventListener('click', () => window.close());
    buttons.backToMenu.forEach(btn => btn.addEventListener('click', () => {
        // Full reload to reset the game as if freshly opened
        window.location.reload();
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
            resetCharacterSelection();
            // Set maxAllies based on mode
            const mode = gameState.currentMode || '1v1';
            maxAllies = GAME_MODES[mode]?.allyCount || 0;
            selectionInProgress = true;
            updateAllyCounter(0, maxAllies);
            // Reset heading
            const heading = document.querySelector('#character-selection h2');
            if (heading) heading.textContent = 'Vyber Si Svojho Veliteľa';
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

    // Map selection logic
    if (mapCards && mapCards.length > 0) {
        mapCards.forEach(card => {
            card.addEventListener('click', () => {
                mapCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                gameState.selectedMap = card.dataset.map;
                setTimeout(() => showScreen('tankSelection'), 200);
            });
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
    window.addEventListener('keydown', (e) => gameState.keys[e.key.toLowerCase()] = true);
    window.addEventListener('keyup', (e) => gameState.keys[e.key.toLowerCase()] = false);
    window.addEventListener('keydown', (e) => {
        // Allow shooting only if player tank exists and not in spectator mode
        if (e.code === 'Space' && gameState.currentScreen === 'game' && !gameState.roundOver && gameState.player && !gameState.isSpectating) {
            e.preventDefault();
            gameState.player.shoot();
        }
    });

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
                    gameState.particles.push(new Particle(
                        this.x + this.width/2,
                        this.y + this.height/2,
                        Math.random() * Math.PI * 2,
                        Math.random() * 8 + 4,
                        Math.random() * 12 + 6,
                        color,
                        80 + Math.random() * 30
                    ));
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
    gameState.bullets = [];
    gameState.tracks = [];
    gameState.particles = [];
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
    
    // FPS limiting for multiplayer performance (50 FPS)
    if (isMultiplayer) {
        const now = performance.now();
        const deltaTime = now - lastFrameTime;
        
        if (deltaTime < MULTIPLAYER_FRAME_TIME) {
            // Skip this frame if not enough time has passed
            if (!gameState.roundOver) {
                gameState.animationFrameId = requestAnimationFrame(gameLoop);
            }
            return;
        }
        lastFrameTime = now;
    }
    
    update();
    draw();
    drawMinimap(); // Draw minimap in each frame
    if (!gameState.roundOver) {
        gameState.animationFrameId = requestAnimationFrame(gameLoop);
    }
}

// --- UPDATE (Game Logic) ---
function update() {
    if(gameState.roundOver) return;

    // Player movement (only if player tank exists)
    if (gameState.player) {
        const oldX = gameState.player.x;
        const oldY = gameState.player.y;
        const oldAngle = gameState.player.angle;
        const oldTurretAngle = gameState.player.turretAbsoluteAngle;
        
        gameState.player.move();
        
        // Send position update to other players (multiplayer) with throttling
        const now = Date.now();
        if (isMultiplayer && socket && now - lastNetworkSync > NETWORK_SYNC_INTERVAL && (
            Math.abs(gameState.player.x - oldX) > 1 || 
            Math.abs(gameState.player.y - oldY) > 1 || 
            Math.abs(gameState.player.angle - oldAngle) > 0.01 ||
            Math.abs(gameState.player.turretAbsoluteAngle - oldTurretAngle) > 0.01
        )) {
            lastNetworkSync = now;
            socket.emit('player-position', {
                x: gameState.player.x,
                y: gameState.player.y,
                angle: gameState.player.angle,
                turretAngle: gameState.player.turretAbsoluteAngle
            });
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


    // Bullet movement
    gameState.bullets.forEach(b => b.move());

    // Update particles
    gameState.particles.forEach(p => p.update());
    gameState.particles = gameState.particles.filter(p => p.life > 0);
    
    // Limit particles in multiplayer for performance
    if (isMultiplayer && gameState.particles.length > MAX_PARTICLES_MULTIPLAYER) {
        gameState.particles = gameState.particles.slice(-MAX_PARTICLES_MULTIPLAYER);
    }

    // Update shot effects
    gameState.shotEffects.forEach(s => s.update());
    gameState.shotEffects = gameState.shotEffects.filter(s => s.life > 0 || s.smokeParticles.length > 0);

    // Update hit effects
    gameState.hitEffects.forEach(h => h.update());
    gameState.hitEffects = gameState.hitEffects.filter(h => h.life > 0);
    
    // Limit tracks in multiplayer for performance
    if (isMultiplayer && gameState.tracks.length > MAX_TRACKS_MULTIPLAYER) {
        gameState.tracks = gameState.tracks.slice(-MAX_TRACKS_MULTIPLAYER);
    }

    // Collisions
    handleCollisions();

    // Remove bullets outside arena
    gameState.bullets = gameState.bullets.filter(b =>
        b.x > -100 && b.x < gameState.arenaWidth + 100 &&
        b.y > -100 && b.y < gameState.arenaHeight + 100
    );

    // Remove old tracks (shorter lifetime in multiplayer)
    const trackLifetime = isMultiplayer ? 1000 : 2000; // 1s in multiplayer, 2s in singleplayer
    gameState.tracks = gameState.tracks.filter(track => Date.now() - track.timestamp < trackLifetime);
    
    // Limit tracks count in multiplayer for better performance
    if (isMultiplayer && gameState.tracks.length > MAX_TRACKS_MULTIPLAYER) {
        gameState.tracks = gameState.tracks.slice(-MAX_TRACKS_MULTIPLAYER);
    }

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
    
    const viewportX = gameState.cameraX;
    const viewportY = gameState.cameraY;
    const viewportW = canvas.width;
    const viewportH = canvas.height;
    
    // Check if object is within viewport bounds + margin
    return obj.x + obj.width > viewportX - VIEWPORT_CULLING_MARGIN &&
           obj.x < viewportX + viewportW + VIEWPORT_CULLING_MARGIN &&
           obj.y + obj.height > viewportY - VIEWPORT_CULLING_MARGIN &&
           obj.y < viewportY + viewportH + VIEWPORT_CULLING_MARGIN;
}

function handleCollisions() {
    const bulletsToRemove = new Set();

    gameState.bullets.forEach((bullet, index) => {
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
            bulletsToRemove.add(index);
        }
    });

    gameState.bullets = gameState.bullets.filter((_, index) => !bulletsToRemove.has(index));

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

    // Draw background texture (grass or dessert)
    if (gameState.currentFloorTexture && gameState.currentFloorTexture.complete && gameState.currentFloorTexture.naturalWidth !== 0) {
        const pattern = ctx.createPattern(gameState.currentFloorTexture, 'repeat');
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, gameState.arenaWidth, gameState.arenaHeight);
    } else {
        ctx.fillStyle = gameState.selectedMap === '2' ? '#e2c28b' : '#3c523c';
        ctx.fillRect(0, 0, gameState.arenaWidth, gameState.arenaHeight);
    }

    // Draw tracks first, so tanks are on top (with viewport culling)
    gameState.tracks.forEach(track => {
        if (isInViewport(track.x, track.y, 8, 8)) {
            track.draw();
        }
    });

    // Draw terrain obstacles (swamp, rock, oilrig)
    gameState.obstacles.forEach(obs => {
        if (obs.type === 'swamp' || obs.type === 'rock' || obs.type === 'oilrig') {
            obs.draw();
        }
    });
    // Draw igloos above the floor (for Map 3)
    gameState.obstacles.forEach(obs => {
        if (obs.type === 'iglu') {
            obs.draw();
        }
    });
    // No need to draw rivers or bridges anymore

    // Draw tanks
    if (gameState.player) gameState.player.draw(); // Only draw player if it exists (always render)
    gameState.allies.forEach(ally => {
        // Temporarily disable culling for allies
        ally.draw();
    });
    gameState.enemies.forEach(enemy => {
        // Temporarily disable culling for enemies
        enemy.draw();
    });

    // Draw bullets
    gameState.bullets.forEach(b => b.draw());

    // Draw trees (on top of tanks sometimes if they are behind)
    gameState.obstacles.forEach(obs => {
        if (obs.type === 'tree') {
            obs.draw();
        }
    });

    // Draw particles (explosions) with viewport culling
    gameState.particles.forEach(p => {
        if (isInViewport(p.x, p.y, p.size * 2, p.size * 2)) {
            p.draw();
        }
    });

    // Draw shot effects (muzzle flashes and smoke) with viewport culling
    gameState.shotEffects.forEach(s => {
        if (isInViewport(s.x, s.y, 30, 30)) {
            s.draw();
        }
    });

    // Draw hit effects (sparks) with viewport culling
    gameState.hitEffects.forEach(h => {
        if (isInViewport(h.x, h.y, 20, 20)) {
            h.draw();
        }
    });


    ctx.restore();

    // Update HUD (drawn without camera transformation)
    updateHUD();
}

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
            const selectedMode = card.dataset.mode;
            
            // Remove previous selection
            gameModeCards.forEach(c => c.classList.remove('selected'));
            
            // Add selection to clicked card
            card.classList.add('selected');
            
            // Start multiplayer with selected mode
            setTimeout(() => {
                initMultiplayer(selectedMode);
                showScreen('multiplayerLobby');
            }, 300);
        });
    });
}

// Initialize multiplayer mode selection when page loads
document.addEventListener('DOMContentLoaded', () => {
    initMultiplayerModeSelection();
});

init();
