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

// --- DEBUG & DEVELOPMENT ---
const DEBUG_MODE = false; // Set to true to enable AI debugging logs

// --- CHEAT CODE SYSTEM ---
let cheatCodeBuffer = '';
const CHEAT_CODE = '090599';
let cheatModeActive = false;

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

// --- AUDIO MANAGER CLASS ---
/**
 * AudioManager - Moved to client/audio/AudioManager.js
 * Import it in index.html before this script
 */

// Global audio manager variable
let audioManager = null;

// Global input manager variable
let inputManager = null;

// Global renderer variable
let renderer = null;

// --- MULTIPLAYER OPTIMIZATIONS & GAME SETTINGS ---
// Constants moved to client/utils/Constants.js
if (typeof GameConstants === 'undefined') {
    throw new Error('GameConstants is not defined! Make sure Constants.js is loaded before script.js');
}

const { 
    // Multiplayer optimizations
    NETWORK_SYNC_INTERVAL, 
    MULTIPLAYER_TARGET_FPS, 
    MULTIPLAYER_FRAME_TIME,
    EFFECTS_REDUCTION_FACTOR,
    MAX_PARTICLES_MULTIPLAYER,
    MAX_TRACKS_MULTIPLAYER,
    VIEWPORT_CULLING_MARGIN,
    // UI & Game settings
    BASE_HUD_HEIGHT, 
    MINIMAP_SIZE, 
    MINIMAP_MARGIN,
    ROUNDS_TO_WIN,
    TANK_HEALTH_MULTIPLIER,
    GAME_MODES
} = GameConstants;

let lastNetworkSync = 0;
let lastFrameTime = 0;

// Initialize performance and networking managers
let performanceManager = null;
let networkManager = null;

function initializeManagers() {
    if (typeof MultiplayerPerformanceManager !== 'undefined') {
        performanceManager = new MultiplayerPerformanceManager();
    }
    if (typeof NetworkingManager !== 'undefined') {
        networkManager = new NetworkingManager();
    }
}

// Initialize multiplayer connection
function initMultiplayer(gameMode = 'all-vs-all') {
    // Check if Socket.IO is available
    if (typeof io === 'undefined') {
        console.warn('Socket.IO not available - multiplayer functionality disabled');
        alert('Multiplayer funkcionalita nie je dostupná. Spustite server alebo si vyberte offline hru.');
        showScreen('mainMenu');
        return;
    }
    
    if (socket && socket.connected) {
        socket.disconnect();
    }
    
    try {
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
        
        // Update lobby UI with game mode
        updateLobbyUI(data);
        
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
            
            // Hide team status displays for all-vs-all mode
            if (selectedGameMode === 'all-vs-all') {
                const teamCharacterStatus = document.getElementById('team-character-status');
                if (teamCharacterStatus) teamCharacterStatus.style.display = 'none';
            }
            
            console.log('Prechod do výberu charakterov');
        } else if (data.phase === 'tank-selection') {
            // Hide character selection, show tank selection
            const characterSelection = document.getElementById('lobby-character-selection');
            const tankSelection = document.getElementById('lobby-tank-selection');
            
            if (characterSelection) characterSelection.style.display = 'none';
            if (tankSelection) tankSelection.style.display = 'block';
            
            // Hide team status displays for all-vs-all mode
            if (selectedGameMode === 'all-vs-all') {
                const teamTankStatus = document.getElementById('team-tank-status');
                if (teamTankStatus) teamTankStatus.style.display = 'none';
            }
            
            console.log('Prechod do výberu tankov');
        } else if (data.phase === 'map-selection') {
            // Hide tank selection, show map selection
            const tankSelection = document.getElementById('lobby-tank-selection');
            const mapSelection = document.getElementById('lobby-map-selection');
            
            if (tankSelection) tankSelection.style.display = 'none';
            if (mapSelection) mapSelection.style.display = 'block';
            
            // Hide team status displays for all-vs-all mode
            if (selectedGameMode === 'all-vs-all') {
                const teamMapStatus = document.getElementById('team-map-status');
                if (teamMapStatus) teamMapStatus.style.display = 'none';
            }
            
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

// Note: getCharacterName and getTankName functions moved to line ~1739 (better versions using CHARACTERS object)

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
            
            // Play shooting sound using AudioManager
            try {
                if (window.audioManager) {
                    audioManager.play('canon-shot-sound', 0.35);
                } else {
                    // Fallback for backward compatibility
                    const audio = new Audio('assets/sounds/canonshot.mp3');
                    audio.preload = 'auto';
                    audio.volume = 0.35;
                    audio.currentTime = 0;
                    audio.play();
                }
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
                    const audio = new Audio('assets/sounds/hitme.mp3');
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
    
    // Handle all-vs-all game ending
    socket.on('all-vs-all-end', (data) => {
        console.log('All-vs-all game ended:', data);
        handleMultiplayerGameEnd(data);
    });
    
    // Handle team match ending
    socket.on('team-match-end', (data) => {
        console.log('Team match ended:', data);
        handleMultiplayerGameEnd(data);
    });
    
    // Handle team round ending
    socket.on('team-round-end', (data) => {
        console.log('Team round ended:', data);
        handleMultiplayerRoundEnd(data);
    });
    
    // Handle all-vs-all round ending (not match end, just round end)
    socket.on('all-vs-all-round-end', (data) => {
        console.log('All-vs-all round ended:', data);
        handleAllVsAllRoundEnd(data);
    });
    
    // Handle all-vs-all match ending (someone won 3 rounds)
    socket.on('all-vs-all-match-end', (data) => {
        console.log('All-vs-all match ended:', data);
        handleAllVsAllMatchEnd(data);
    });
    
    // Handle next round starting
    socket.on('next-round-starting', (data) => {
        console.log('Next round starting:', data);
        handleNextRoundStarting(data);
    });
    
    // Handle rematch accepted (all players voted yes)
    socket.on('rematch-accepted', () => {
        console.log('✅ Rematch accepted by all players');
        const matchScreen = document.getElementById('all-vs-all-match-screen');
        if (matchScreen) {
            matchScreen.remove();
        }
        showNotification('Všetci hráči súhlasili s odvetou! Začíname nový match...', 'success', 3000);
    });
    
    // Handle rematch declined (someone voted no)
    socket.on('rematch-declined', (data) => {
        console.log('❌ Rematch declined by', data.playerName);
        
        // Show popup with return button
        showRematchDeclinedPopup(data.playerName, 'odmietol odvetu');
    });
    
    // Handle player leaving during rematch vote
    socket.on('player-left-rematch-vote', (data) => {
        console.log('❌ Player left during rematch vote:', data.playerName);
        
        // Show popup with return button
        showRematchDeclinedPopup(data.playerName, 'sa odpojil');
    });
    
    // Handle rematch vote update (show progress)
    socket.on('rematch-vote-update', (data) => {
        console.log('📊 Rematch vote update:', data);
        const statusEl = document.getElementById('rematch-status');
        if (statusEl) {
            statusEl.innerHTML = `Hlasovanie: ${data.voted}/${data.total} hráčov hlasovalo<br>
                <small>Hlasovali: ${data.votedPlayers.join(', ')}</small>`;
            statusEl.style.color = '#3498db';
        }
    });
    
    // Handle forced return to lobby - just close any popups
    socket.on('force-return-to-lobby', () => {
        console.log('🔙 Server requested return to lobby');
        // Popup is already shown, server just confirms
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
        
    } catch (error) {
        console.error('Failed to initialize multiplayer:', error);
        alert('Nepodarilo sa pripojiť k serveru. Skúste neskôr alebo si vyberte offline hru.');
        showScreen('mainMenu');
    }
}

// Update lobby UI
function updateLobbyUI(data) {
    const lobbyStatus = document.getElementById('lobby-status');
    
    // Update selected game mode from server data
    if (data.gameMode) {
        selectedGameMode = data.gameMode;
        console.log('Updated selectedGameMode from server:', selectedGameMode);
    }
    
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
    console.log('updateLobbyDisplay called, selectedGameMode:', selectedGameMode);
    
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
        console.log('Showing team selection for team-vs-team mode');
        // Show team selection for team mode
        teamSelection.style.display = 'block';
        // Add ready button to team selection area
        if (teamReadyBtn) teamReadyBtn.style.display = 'inline-block';
    } else {
        console.log('Showing all sections for all-vs-all mode');
        // Show all sections for all-vs-all mode
        playersSection.style.display = 'block';
        characterSelection.style.display = 'block';
        tankSelection.style.display = 'block';
        mapSelection.style.display = 'block';
        readySection.style.display = 'block';
        
        if (allVsAllReadyBtn) {
            allVsAllReadyBtn.style.display = 'inline-block';
        }
        
        // Hide team status displays in all sections for all-vs-all mode
        const teamSelectionStatus = document.getElementById('team-selection-status');
        const teamCharacterStatus = document.getElementById('team-character-status');
        const teamTankStatus = document.getElementById('team-tank-status');
        const teamMapStatus = document.getElementById('team-map-status');
        
        if (teamSelectionStatus) teamSelectionStatus.style.display = 'none';
        if (teamCharacterStatus) teamCharacterStatus.style.display = 'none';
        if (teamTankStatus) teamTankStatus.style.display = 'none';
        if (teamMapStatus) teamMapStatus.style.display = 'none';
        
        updatePlayersList();
        updateAllVsAllReadyState();
        if (typeof updateMapVotingDisplay === 'function') {
            updateMapVotingDisplay({});
        }
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

// Note: createPlayerItem function moved here - single version handles both team and all-vs-all modes

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

// Note: selectLobbyCharacter moved to line ~1636 (unified version for all game modes)

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

// Note: selectLobbyTank moved to line ~1615 (unified version for all game modes)

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
    
    // Hide any round end screens from previous round
    const roundScreen = document.getElementById('all-vs-all-round-screen');
    if (roundScreen) {
        roundScreen.remove();
    }
    
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

// Register pause button handlers with traditional event listeners
document.querySelectorAll('.pause-continue-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        hidePauseMenu();
        if (!gameState.roundOver && gameState.currentScreen === 'game') {
            requestAnimationFrame(gameLoop);
        }
    });
});

document.querySelectorAll('.pause-exit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        returnToMainMenu();
    });
});

// --- CHEAT CODE LISTENER ---
document.addEventListener('keydown', (event) => {
    // Only listen during gameplay
    if (gameState && gameState.currentScreen === 'game' && !gameState.roundOver) {
        // Add digit to buffer
        if (event.key >= '0' && event.key <= '9') {
            cheatCodeBuffer += event.key;
            
            // Keep only last 6 characters
            if (cheatCodeBuffer.length > 6) {
                cheatCodeBuffer = cheatCodeBuffer.slice(-6);
            }
            
            // Check if cheat code matches
            if (cheatCodeBuffer === CHEAT_CODE) {
                cheatModeActive = !cheatModeActive; // Toggle cheat mode
                cheatCodeBuffer = ''; // Reset buffer
                
                // Show notification
                if (cheatModeActive) {
                    console.log('🔥 CHEAT MODE ACTIVATED - ONE HIT KILL! 🔥');
                    showNotification('🔥 CHEAT MODE: ONE HIT KILL ACTIVE! 🔥', 'success', 3000);
                    
                    // Add visual indicator
                    const indicator = document.createElement('div');
                    indicator.id = 'cheat-indicator';
                    indicator.style.cssText = `
                        position: fixed;
                        top: 10px;
                        right: 10px;
                        background: rgba(255, 0, 0, 0.8);
                        color: white;
                        padding: 10px 20px;
                        border-radius: 5px;
                        font-family: 'Press Start 2P', monospace;
                        font-size: 0.8em;
                        z-index: 10000;
                        animation: pulse 1s infinite;
                    `;
                    indicator.textContent = '🔥 CHEAT ACTIVE 🔥';
                    document.body.appendChild(indicator);
                } else {
                    console.log('❌ CHEAT MODE DEACTIVATED');
                    showNotification('Cheat mode deactivated', 'info', 2000);
                    
                    // Remove visual indicator
                    const indicator = document.getElementById('cheat-indicator');
                    if (indicator) {
                        indicator.remove();
                    }
                }
            }
        }
    }
});

// Pause key handling (P key and Escape)
document.addEventListener('keydown', (event) => {
    if ((event.key.toLowerCase() === 'p' || event.key === 'Escape') && 
        gameState && gameState.currentScreen === 'game' && !gameState.roundOver) {
        event.preventDefault();
        if (!isPaused) {
            if (window.showPauseMenu) showPauseMenu();
        } else {
            if (window.hidePauseMenu) hidePauseMenu();
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

// --- TANK DEFINITIONS (Rebalanced and with image paths) ---
const TANK_SPECS = {
    purple: { // Obrnený Bojovník (Armored Warrior) - Balanced, durable
        color: '#9b59b6', baseHealth: 120, armor: 60, speed: 1, damage: 70, cooldown: 400,
        tankImage: 'assets/images/tank1.png', canonImage: 'assets/images/canon1.png'
    },
    orange: { // Rýchly Útočník (Fast Attacker) - Low health, high speed, high burst
        color: '#e67e22', baseHealth: 90, armor: 90, speed: 1.5, damage: 30, cooldown: 150,
        tankImage: 'assets/images/tank2.png', canonImage: 'assets/images/canon2.png'
    },
    brown: { // Ťažký Moloch (Heavy Juggernaut) - High health, high damage, low speed
        color: '#8d6e63', baseHealth: 250, armor: 40, speed: 0.7, damage: 150, cooldown: 1000,
        tankImage: 'assets/images/tank3.png', canonImage: 'assets/images/canon3.png'
    }
};

// Apply health multiplier
for (const type in TANK_SPECS) {
    TANK_SPECS[type].health = TANK_SPECS[type].baseHealth * TANK_HEALTH_MULTIPLIER;
}

// --- NOVINKA: CHARAKTERY ---
const CHARACTERS = {
    jaccelini: { name: 'M. Jaklović', country: 'Juhoslávia', image: 'assets/images/ja.png', flag: 'assets/images/YUG.png' },
    tvaruzhkyn: { name: 'J. Tvaruzhkyn', country: 'Rusko', image: 'assets/images/tvaruzek.jpg', flag: 'assets/images/RUS.png' },
    kindergarden: { name: 'J. W. Gardens', country: 'USA', image: 'assets/images/zahry.jpg', flag: 'assets/images/USA.png' },
    landmann: { name: 'Herr Landmann', country: 'Nemecko', image: 'assets/images/zeman.jpg', flag: 'assets/images/GER.png' },
    matthews: { name: 'A. Matthews', country: 'Spojené Kráľovstvo', image: 'assets/images/Matous.jpg', flag: 'assets/images/GBR.png' },
    Hrebekushi: { name: 'P. Hrebekushi', country: 'Japonsko', image: 'assets/images/hrebenar.jpg', flag: 'assets/images/JAP.png' },
    volenec: { name: 'J. Violencini', country: 'Taliansko', image: 'assets/images/Volenec.JPG', flag: 'assets/images/ITA.png' },
    vacu: { name: 'J. Ben Vakul', country: 'Izrael', image: 'assets/images/vacu.png', flag: 'assets/images/ISR.png' },
    ted: { name: 'T. J. Millner', country: 'Južná Afrika', image: 'assets/images/ted.jpg', flag: 'assets/images/RSA.png' },
    svidek: { name: 'J. Svidze', country: 'Gruzínsko', image: 'assets/images/svidek.JPG', flag: 'assets/images/GEO.png' },
    simek: { name: 'T. Šimek', country: 'Česko', image: 'assets/images/simek.PNG', flag: 'assets/images/CZE.png' },
    rumpik: { name: 'D. Rampeeq', country: 'Pakistan', image: 'assets/images/rumpik.PNG', flag: 'assets/images/PAK.png' },
    pilar: { name: 'V. Tamil Pilai', country: 'India', image: 'assets/images/pilar.PNG', flag: 'assets/images/IND.png' },
    parusev: { name: 'J. Parushiev', country: 'Bulharsko', image: 'assets/images/parusev.JPG', flag: 'assets/images/BUL.png' },
    miki: { name: 'M. Rasgueau', country: 'Francúzsko', image: 'assets/images/miki.PNG', flag: 'assets/images/FRA.png' },
    mikes: { name: 'J. M. Cash', country: 'Kanada', image: 'assets/images/mikes.PNG', flag: 'assets/images/CAN.png' },
    jirka: { name: 'J. H. Hisca', country: 'Kuba', image: 'assets/images/jirka.JPG', flag: 'assets/images/CUB.png' },
    kocvara: { name: 'A. Kochvarsson', country: 'Švédsko', image: 'assets/images/kocvara.JPG', flag: 'assets/images/SWE.png' },
    hajek: { name: 'P. Hajdukó', country: 'Maďarsko', image: 'assets/images/hajek.JPG', flag: 'assets/images/HUN.png' },
    bonko: { name: 'M. Bon-kong', country: 'Čína', image: 'assets/images/bonko.JPG', flag: 'assets/images/PRC.png' },
    ben: { name: 'B. H. Horácio', country: 'Brazília', image: 'assets/images/Ben.JPG', flag: 'assets/images/BRA.png' },
    romancov: { name: 'A. P. Ramezanov', country: 'Irán', image: 'assets/images/romancov.JPG', flag: 'assets/images/IRN.png' },
    huth: { name: 'O. Hutkowski', country: 'Poľsko', image: 'assets/images/huth.JPG', flag: 'assets/images/POL.png' },
    belak: { name: 'F. Bella', country: 'Slovensko', image: 'assets/images/belak.PNG', flag: 'assets/images/SVK.png' },
    franko: { name: 'Gen. L. Franco', country: 'Španielsko', image: 'assets/images/franko.JPG', flag: 'assets/images/ESP.png' },
    fiedler: { name: 'F. Hiedler', country: 'Švajčiarsko', image: 'assets/images/fiedler.JPG', flag: 'assets/images/SUI.png' },
    gaidussen: { name: 'M. Gaidussen', country: 'Nórsko', image: 'assets/images/gajdos.png', flag: 'assets/images/NOR.png' },
    gazhi: { name: 'M. Al Gazhí', country: 'Lýbie', image: 'assets/images/gazo.png', flag: 'assets/images/LIB.png' },
    katzenstein: { name: 'F. Katzenstein', country: 'Rakúsko', image: 'assets/images/kocur.png', flag: 'assets/images/RAK.png' },
    kohenen: { name: 'M. Kohenen', country: 'Fínsko', image: 'assets/images/kohel.jpg', flag: 'assets/images/FIN.png' },
    gnatt: { name: 'J. Gnatt', country: 'Austrália', image: 'assets/images/komar.jpg', flag: 'assets/images/AUS.png' },
    christensen: { name: 'P. Christensen', country: 'Dánsko', image: 'assets/images/kristian.jpg', flag: 'assets/images/DEN.png' },
    alkunzi: { name: 'M. al-Kunzí', country: 'Saudská Arábia', image: 'assets/images/kunc.jpg', flag: 'assets/images/KSA.png' },
    khajoo: { name: 'N. Kha-Joo', country: 'Severná Kórea', image: 'assets/images/novotnyk.jpg', flag: 'assets/images/NKO.png' },
    thneethom: { name: 'N. W. Thnee-Thom', country: 'Južná Kórea', image: 'assets/images/novotnyt.png', flag: 'assets/images/SKO.png' },
    smakhal: { name: 'F. Smakhal', country: 'Turecko', image: 'assets/images/slipy.png', flag: 'assets/images/TUR.png' },
    sortuda: { name: 'M. Sortuda', country: 'Portugalsko', image: 'assets/images/stastna.jpg', flag: 'assets/images/POR.png' },
    strakadopoulos: { name: 'M. Strakadopoulos', country: 'Grécko', image: 'assets/images/straka.jpg', flag: 'assets/images/GRE.png' },
    tumufjik: { name: 'M. Tūmūfjīk', country: 'Egypt', image: 'assets/images/tomovcik.png', flag: 'assets/images/EGY.png' },
    womboclaat: { name: 'P. Womboclaat', country: 'Jamajka', image: 'assets/images/vopat.jpg', flag: 'assets/images/JAM.jpg' },
    votrubovskij: { name: 'J. Votrubovskij', country: 'Bielorusko', image: 'assets/images/votruba.png', flag: 'assets/images/BLR.png' }
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
    selectedPlayerAllies: [], // NOVINKA: Vybraní spojenci hráča
    selectedEnemyAllies: [], // NOVINKA: Vybraní spojenci nepriateľa
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
                        if (window.audioManager) {
                            audioManager.play('canon-shot-sound', this.isPlayer ? 0.7 : 0.35);
                        } else {
                            // Fallback for backward compatibility
                            const src = 'canonshot.mp3';
                            const audio = new Audio(src);
                            audio.preload = 'auto';
                            audio.volume = this.isPlayer ? 0.7 : 0.35;
                            audio.currentTime = 0;
                            audio.play();
                        }
                    } catch (e) {}
                }
            }
        }
    }

    takeDamage(incomingDamage, attacker) { // Added attacker parameter
        // CHEAT MODE: One-hit-kill if attacker is player and cheat is active
        let actualDamage;
        if (cheatModeActive && attacker === gameState.player) {
            actualDamage = this.health; // Kill instantly
            console.log('🔥 CHEAT KILL:', this.playerId || 'enemy');
        } else {
            const damageReduction = Math.min(this.armor / 100, 0.8);
            actualDamage = incomingDamage * (1 - damageReduction);
        }
        
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
                    const audio = new Audio('assets/sounds/hitme.mp3');
                    audio.preload = 'auto';
                    audio.volume = 0.7;
                    audio.currentTime = 0;
                    audio.play();
                }
                if (attacker === gameState.player && !this.isPlayer) {
                    // Player hit anyone (enemy or ally, not self)
                    const audio = new Audio('assets/sounds/hithim.mp3');
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
            
            // Send death event to server in multiplayer mode for ANY player death
            if (isMultiplayer && socket && this.playerId) {
                console.log(`💀 Sending player-death for ${this.playerId}`);
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
                const audio = new Audio('assets/sounds/explosion.mp3');
                audio.preload = 'auto';
                audio.volume = 0.7;
                audio.currentTime = 0;
                audio.play();
            } catch (e) {}
        }
    }
}

// Bullet class moved to client/entities/Bullet.js

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

// --- Track class moved to client/entities/Track.js ---

// --- Particle class moved to client/entities/Particle.js ---

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

// --- ShotEffect and HitEffect classes moved to client/entities/Effects.js ---

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

    // Handle menu music based on screen
    if (screenName === 'game') {
        // Stop menu music when entering game
        if (window.audioManager) {
            audioManager.fadeOut('menuMusic', 500);
        }
    } else {
        // Play menu music on all other screens
        if (window.audioManager) {
            audioManager.playLoop('menuMusic', 0.5);
        }
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
    await loadImage('menu_background', 'assets/images/menu_background.png');
    await loadImage('grass_texture', 'assets/images/grass_texture.png');
    await loadImage('mud_texture', 'assets/images/mud_texture.png');
    await loadImage('tree_texture', 'assets/images/tree_texture.png');
    await loadImage('rock_texture', 'assets/images/rock_texture.png');
    await loadImage('coin_icon', 'assets/images/coin.png');
    await loadImage('dessert_texture', 'assets/images/dessert.jpg');
    await loadImage('oilrig', 'assets/images/oilrig.png');
    await loadImage('ice_texture', 'assets/images/ice.png');
    await loadImage('iglu', 'assets/images/IGLU.png');
    await loadImage('bullet', 'assets/images/bullet.png');
    await loadImage('bullet2', 'assets/images/bullet2.png');
    await loadImage('snowball', 'assets/images/snehovgula.png');
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
    // Skip video preloading since intro video is disabled
    return Promise.resolve();
}

// --- INITIALIZATION AND GAME START ---
function init() {
    // Initialize audio manager first
    audioManager = new AudioManager();
    window.audioManager = audioManager;
    
    // Initialize input manager for game controls
    inputManager = new InputManager();
    window.inputManager = inputManager;
    
    // Start loading screen immediately
    initLoadingScreen();
    
    // Register bullet selection UI handler with traditional event listeners
    document.querySelectorAll('.bullet-option').forEach(element => {
        element.addEventListener('click', () => {
            const bulletType = parseInt(element.getAttribute('data-bullet'));
            if (bulletType === 1 || bulletType === 2) {
                gameState.selectedBulletType = bulletType;
                updateBulletSelectionUI();
            }
        });
    });
    
    // Register keyboard shortcuts with traditional event listeners
    document.addEventListener('keydown', (event) => {
        if (event.key === '1' && screens.game.classList.contains('active')) {
            gameState.selectedBulletType = 1;
            updateBulletSelectionUI();
        } else if (event.key === '2' && screens.game.classList.contains('active')) {
            gameState.selectedBulletType = 2;
            updateBulletSelectionUI();
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
        
        // Initialize renderer after assets are loaded
        renderer = new Renderer(canvas, ctx);
        window.renderer = renderer;

        // --- Handle intro video ---
        const introVideo = document.getElementById('intro-video');
        if (introVideo) {
            // Skip intro video and go straight to main menu
            console.log("Skipping intro video. Showing main menu directly.");
            showScreen('mainMenu');
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


    // Register menu button handlers with traditional event listeners
    document.getElementById('start-btn').addEventListener('click', () => showScreen('modeSelection'));
    
    document.getElementById('multiplayer-btn').addEventListener('click', () => {
        showScreen('multiplayerNameEntry');
    });
    
    document.getElementById('tutorial-btn').addEventListener('click', () => showScreen('tutorial'));
    
    document.querySelectorAll('.back-to-menu').forEach(btn => {
        btn.addEventListener('click', () => {
            returnToMainMenu();
        });
    });

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
        gameState.selectedPlayerAllies = selectedAllies.slice();

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

    // Keyboard event listeners moved to InputManager.js
    // InputManager handles: keydown/keyup for movement, Space for shooting

    // Name Entry Event Listeners
    const playerNameInput = document.getElementById('player-name-input');
    const confirmNameBtn = document.getElementById('confirm-name-btn');
    
    // Register player name input handlers with traditional event listeners
    if (playerNameInput) {
        playerNameInput.addEventListener('input', () => {
            const confirmNameBtn = document.getElementById('confirm-name-btn');
            if (confirmNameBtn) {
                const name = playerNameInput.value.trim();
                confirmNameBtn.disabled = name.length < 2;
            }
        });
        
        // Handle enter key in name input
        playerNameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const confirmNameBtn = document.getElementById('confirm-name-btn');
                if (confirmNameBtn && !confirmNameBtn.disabled) {
                    confirmNameBtn.click();
                }
            }
        });
    }
    
    // Confirm name and proceed to mode selection
    if (confirmNameBtn) {
        confirmNameBtn.addEventListener('click', () => {
            const playerNameInput = document.getElementById('player-name-input');
            if (playerNameInput) {
                const name = playerNameInput.value.trim();
                if (name.length >= 2) {
                    playerName = name;
                    showScreen('multiplayerModeSelection');
                }
            }
        });
    }

    // Register window resize handler
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
                        const audio = new Audio('assets/sounds/explosion.mp3');
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
    if (gameState.selectedPlayerAllies && Array.isArray(gameState.selectedPlayerAllies) && gameState.selectedPlayerAllies.length > 0) {
        allyCharKeys = gameState.selectedPlayerAllies;
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

    // Sync input manager keys to gameState for compatibility
    if (inputManager) {
        inputManager.syncKeysToGameState();
    }

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
            
            // For now, use direct socket instead of network manager
            // to avoid conflicts with global socket instance
            // TODO: Integrate NetworkingManager properly with global socket
            
            // Reduce logging to prevent spam
            if (Math.random() < 0.001) { // 0.1% chance
                console.log('📤 Sending position:', {
                    x: Math.round(currentPosition.x), 
                    y: Math.round(currentPosition.y)
                });
            }
            socket.emit('player-position', currentPosition);
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
                    // Only log once when first stuck, not every frame
                    if (!tank.isStuck) {
                        tank.isStuck = true;
                        tank.stuckStartTime = now;
                        if (DEBUG_MODE) {
                            console.log(`AI Tank stuck detected, starting unstuck maneuver`);
                        }
                    }
                } else {
                    // Reset stuck state when tank moves again
                    if (tank.isStuck && DEBUG_MODE) {
                        console.log(`AI Tank unstuck successful`);
                    }
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

    // Update particles with performance optimization
    gameState.particles.forEach(p => p.update());
    if (performanceManager && isMultiplayer) {
        gameState.particles = performanceManager.optimizeParticles(gameState.particles);
    } else {
        gameState.particles = gameState.particles.filter(p => p.life > 0);
        
        // Fallback limit for non-manager case
        if (isMultiplayer && gameState.particles.length > MAX_PARTICLES_MULTIPLAYER) {
            gameState.particles = gameState.particles.slice(-MAX_PARTICLES_MULTIPLAYER);
        }
    }

    // Update shot effects with optimization
    gameState.shotEffects.forEach(s => s.update());
    if (performanceManager && isMultiplayer) {
        gameState.shotEffects = performanceManager.optimizeEffects(gameState.shotEffects);
    } else {
        gameState.shotEffects = gameState.shotEffects.filter(s => s.life > 0);
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

    // Optimize drawing with batch culling if performance manager is available
    if (performanceManager && isMultiplayer) {
        const camera = { x: gameState.cameraX, y: gameState.cameraY };
        const canvasSize = { width: canvas.width, height: canvas.height };
        
        // Batch cull all drawable objects
        const visibleTracks = performanceManager.cullObjects(gameState.tracks, camera, canvasSize);
        const visibleParticles = performanceManager.cullObjects(gameState.particles, camera, canvasSize);
        const visibleShotEffects = performanceManager.cullObjects(gameState.shotEffects, camera, canvasSize);
        const visibleHitEffects = performanceManager.cullObjects(gameState.hitEffects, camera, canvasSize);
        
        // Draw culled objects
        visibleTracks.forEach(track => track.draw());
        
        // Draw obstacles (always visible for gameplay reasons)
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

        // Draw tanks (always visible for gameplay)
        if (gameState.player) gameState.player.draw();
        gameState.allies.forEach(ally => ally.draw());
        gameState.enemies.forEach(enemy => enemy.draw());

        // Draw bullets (always visible for gameplay)
        gameState.bullets.forEach(b => b.draw());

        // Draw trees (on top of tanks)
        gameState.obstacles.forEach(obs => {
            if (obs.type === 'tree') {
                obs.draw();
            }
        });

        // Draw culled effects
        visibleParticles.forEach(p => p.draw());
        visibleShotEffects.forEach(s => s.draw());
        visibleHitEffects.forEach(h => h.draw());
        
    } else {
        // Fallback to original drawing with individual culling
        
        // Draw tracks first, so tanks are on top (with viewport culling)
        gameState.tracks.forEach(track => {
            if (isInViewport({ x: track.x, y: track.y, width: 8, height: 8 })) {
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

        // Draw tanks
        if (gameState.player) gameState.player.draw();
        gameState.allies.forEach(ally => ally.draw());
        gameState.enemies.forEach(enemy => enemy.draw());

        // Draw bullets
        gameState.bullets.forEach(b => b.draw());

        // Draw trees (on top of tanks)
        gameState.obstacles.forEach(obs => {
            if (obs.type === 'tree') {
                obs.draw();
            }
        });

        // Draw particles (explosions) with viewport culling
        gameState.particles.forEach(p => {
            if (isInViewport({ x: p.x, y: p.y, width: p.size * 2, height: p.size * 2 })) {
                p.draw();
            }
        });

        // Draw shot effects (muzzle flashes and smoke) with viewport culling
        gameState.shotEffects.forEach(s => {
            if (isInViewport({ x: s.x, y: s.y, width: 30, height: 30 })) {
                s.draw();
            }
        });

        // Draw hit effects (sparks) with viewport culling
        gameState.hitEffects.forEach(h => {
            if (isInViewport({ x: h.x, y: h.y, width: 20, height: 20 })) {
                h.draw();
            }
        });
    }

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

// Handle multiplayer game ending
function handleMultiplayerGameEnd(data) {
    console.log('Handling multiplayer game end:', data);
    
    // Stop game loop
    gameState.roundOver = true;
    
    // Determine winner message
    let winnerMessage = '';
    let isPlayerWinner = false;
    
    if (data.winner) {
        if (data.winner === 'player' || data.winner === socket?.id) {
            winnerMessage = '🎉 VÍŤAZSTVO! 🎉';
            isPlayerWinner = true;
        } else if (data.winner.team) {
            // Team mode
            const playerTeam = gameState.player?.team;
            if (playerTeam && data.winner.team === playerTeam) {
                winnerMessage = `🎉 VÍŤAZSTVO TÍM ${data.winner.team.toUpperCase()}! 🎉`;
                isPlayerWinner = true;
            } else {
                winnerMessage = `PREHRA - Vyhral tím ${data.winner.team.toUpperCase()}`;
            }
        } else if (data.winnerName) {
            winnerMessage = `${data.winnerName} VYHRAL!`;
            isPlayerWinner = (data.winner === socket?.id);
        } else {
            winnerMessage = 'HRA SKONČILA';
        }
    } else {
        winnerMessage = 'REMÍZA';
    }
    
    // Show end game screen
    showMultiplayerEndScreen(winnerMessage, isPlayerWinner, data);
}

// Handle multiplayer round ending (for team mode)
function handleMultiplayerRoundEnd(data) {
    console.log('Handling multiplayer round end:', data);
    
    // Pause game temporarily
    gameState.roundOver = true;
    
    // Show round result
    const roundMessage = `KONIEC KOLA ${data.round}\\n${data.winnerTeam.toUpperCase()} VYHRAL!\\nSkóre: Modrý ${data.scores.blue} - ${data.scores.red} Červený`;
    
    showNotification(roundMessage, 'info', 5000);
    
    if (data.matchEnd) {
        // Match is over, show final results
        setTimeout(() => {
            // Will receive 'team-match-end' event
        }, 3000);
    } else {
        // Next round will start automatically
        showNotification('Ďalšie kolo začne o chvíľu...', 'info', 3000);
    }
}

// Handle all-vs-all round ending (not match, just round)
function handleAllVsAllRoundEnd(data) {
    console.log('Handling all-vs-all round end:', data);
    
    // Stop game
    gameState.roundOver = true;
    
    // Determine if current player won this round
    const isRoundWinner = data.roundWinner === socket?.id;
    const roundWinnerName = data.roundWinnerName || 'Niekto';
    
    // Show round end screen with score
    showAllVsAllRoundEndScreen(isRoundWinner, roundWinnerName, data);
}

// Handle all-vs-all match ending (someone won 3 rounds)
function handleAllVsAllMatchEnd(data) {
    console.log('Handling all-vs-all match end:', data);
    
    // Stop game
    gameState.gameOver = true;
    
    // Determine if current player won the match
    const isMatchWinner = data.matchWinner === socket?.id;
    const matchWinnerName = data.matchWinnerName || 'Niekto';
    
    // Show match end screen with rematch option
    showAllVsAllMatchEndScreen(isMatchWinner, matchWinnerName, data);
}

// Handle next round starting notification
function handleNextRoundStarting(data) {
    console.log('🔄 Next round starting:', data);
    
    // Hide round end screen
    const roundScreen = document.getElementById('all-vs-all-round-screen');
    if (roundScreen) {
        roundScreen.style.display = 'none';
    }
    
    // Reset flags - startMultiplayerGame will be called by game-start event
    gameState.roundOver = false;
    gameState.gameOver = false;
}

// Show multiplayer end game screen
function showMultiplayerEndScreen(message, isWinner, data) {
    // Create end screen overlay
    let endScreen = document.getElementById('multiplayer-end-screen');
    if (!endScreen) {
        endScreen = document.createElement('div');
        endScreen.id = 'multiplayer-end-screen';
        endScreen.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
            font-family: 'Roboto', 'Arial', sans-serif;
        `;
        document.body.appendChild(endScreen);
    }
    
    // Build end screen content
    endScreen.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <h1 style="font-family: 'Press Start 2P', 'Courier New', monospace; font-size: 2.5em; margin-bottom: 40px; color: ${isWinner ? '#27ae60' : '#e74c3c'}; line-height: 1.4;">
                ${message}
            </h1>
            
            ${data.stats ? `
                <div style="font-family: 'Roboto', 'Arial', sans-serif; font-size: 1.3em; margin-bottom: 30px; line-height: 1.8;">
                    <p style="margin: 10px 0;">Kills: ${data.stats.kills || 0}</p>
                    <p style="margin: 10px 0;">Deaths: ${data.stats.deaths || 0}</p>
                    <p style="margin: 10px 0;">Damage: ${data.stats.damage || 0}</p>
                </div>
            ` : ''}
            
            <div style="margin-top: 50px;">
                <button onclick="handlePlayAgain()" style="
                    font-family: 'Roboto', 'Arial', sans-serif;
                    font-size: 1.1em;
                    font-weight: 600;
                    padding: 15px 30px;
                    margin: 10px;
                    background: #27ae60;
                    color: white;
                    border: none;
                    cursor: pointer;
                    border-radius: 10px;
                ">
                    HRAŤ ZNOVA
                </button>
                <button onclick="handleBackToLobby()" style="
                    font-family: 'Roboto', 'Arial', sans-serif;
                    font-size: 1.1em;
                    font-weight: 600;
                    padding: 15px 30px;
                    margin: 10px;
                    background: #e67e22;
                    color: white;
                    border: none;
                    cursor: pointer;
                    border-radius: 10px;
                ">
                    SPÄŤ DO LOBBY
                </button>
            </div>
        </div>
    `;
    
    endScreen.style.display = 'flex';
}

// Handle play again button
function handlePlayAgain() {
    if (socket) {
        socket.emit('play-again');
    }
    const endScreen = document.getElementById('multiplayer-end-screen');
    if (endScreen) {
        endScreen.style.display = 'none';
    }
}

// Handle back to lobby button
function handleBackToLobby() {
    if (socket) {
        socket.emit('back-to-lobby');
    }
    const endScreen = document.getElementById('multiplayer-end-screen');
    if (endScreen) {
        endScreen.style.display = 'none';
    }
    showScreen('lobby');
}

// Show all-vs-all round end screen
function showAllVsAllRoundEndScreen(isWinner, winnerName, data) {
    let roundScreen = document.getElementById('all-vs-all-round-screen');
    if (!roundScreen) {
        roundScreen = document.createElement('div');
        roundScreen.id = 'all-vs-all-round-screen';
        roundScreen.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
            font-family: 'Roboto', 'Arial', sans-serif;
        `;
        document.body.appendChild(roundScreen);
    }
    
    // Build round end content with scores
    let scoresHTML = '<div style="margin: 30px 0; font-size: 1.2em;">';
    scoresHTML += '<h3 style="font-family: \'Press Start 2P\', monospace; margin-bottom: 20px; font-size: 1em;">SKÓRE KÔL:</h3>';
    for (const [playerId, wins] of Object.entries(data.roundWins)) {
        // Use player list from server data
        const player = data.players?.find(p => p.id === playerId);
        const playerName = player?.name || 'Unknown';
        const isCurrentPlayer = playerId === socket?.id;
        scoresHTML += `<p style="margin: 8px 0; ${isCurrentPlayer ? 'color: #f1c40f; font-weight: bold;' : ''}">
            ${playerName}: ${wins} ${wins === 1 ? 'kolo' : wins < 5 ? 'kolá' : 'kôl'}
        </p>`;
    }
    scoresHTML += '</div>';
    
    roundScreen.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <h1 style="font-family: 'Press Start 2P', 'Courier New', monospace; font-size: 2.5em; margin-bottom: 20px; color: ${isWinner ? '#27ae60' : '#e74c3c'}; line-height: 1.6;">
                ${isWinner ? '🎉 VYHRAL SI KOLO ' + data.round + '! 🎉' : '💔 PREHRAL SI KOLO ' + data.round}
            </h1>
            <p style="font-size: 1.5em; margin-bottom: 20px;">
                Víťaz kola: <span style="color: #f1c40f; font-weight: bold;">${winnerName}</span>
            </p>
            
            ${scoresHTML}
            
            <div id="round-countdown" style="margin-top: 40px; font-size: 2em; color: #3498db; font-family: 'Press Start 2P', monospace;">
                Ďalšie kolo o <span id="countdown-number" style="color: #f1c40f;">10</span> sekúnd
            </div>
        </div>
    `;
    
    // Countdown timer
    let countdown = 10;
    const countdownEl = document.getElementById('countdown-number');
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownEl) {
            countdownEl.textContent = countdown;
        }
        if (countdown <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);
    
    roundScreen.style.display = 'flex';
}

// Show all-vs-all match end screen (with rematch option)
function showAllVsAllMatchEndScreen(isWinner, winnerName, data) {
    let matchScreen = document.getElementById('all-vs-all-match-screen');
    if (!matchScreen) {
        matchScreen = document.createElement('div');
        matchScreen.id = 'all-vs-all-match-screen';
        matchScreen.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
            font-family: 'Roboto', 'Arial', sans-serif;
        `;
        document.body.appendChild(matchScreen);
    }
    
    // Build final scores
    let finalScoresHTML = '<div style="margin: 30px 0; font-size: 1.2em;">';
    finalScoresHTML += '<h3 style="font-family: \'Press Start 2P\', monospace; margin-bottom: 20px; font-size: 1em;">FINÁLNE SKÓRE:</h3>';
    for (const [playerId, wins] of Object.entries(data.roundWins)) {
        // Use player list from server data
        const player = data.players?.find(p => p.id === playerId);
        const playerName = player?.name || 'Unknown';
        const isCurrentPlayer = playerId === socket?.id;
        const isMatchWinner = playerId === data.matchWinner;
        finalScoresHTML += `<p style="margin: 8px 0; ${isMatchWinner ? 'color: #27ae60; font-weight: bold; font-size: 1.3em;' : isCurrentPlayer ? 'color: #f1c40f; font-weight: bold;' : ''}">
            ${isMatchWinner ? '👑 ' : ''}${playerName}: ${wins} ${wins === 1 ? 'kolo' : wins < 5 ? 'kolá' : 'kôl'}
        </p>`;
    }
    finalScoresHTML += '</div>';
    
    matchScreen.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <h1 style="font-family: 'Press Start 2P', 'Courier New', monospace; font-size: 3em; margin-bottom: 30px; color: ${isWinner ? '#27ae60' : '#e74c3c'}; line-height: 1.6;">
                ${isWinner ? '🏆 VYHRAL SI MATCH! 🏆' : '😢 PREHRAL SI MATCH'}
            </h1>
            <p style="font-size: 1.8em; margin-bottom: 20px; color: #f1c40f;">
                Celkový víťaz: <span style="font-weight: bold;">${winnerName}</span>
            </p>
            <p style="font-size: 1.2em; margin-bottom: 20px; color: #bbb;">
                Po ${data.totalRounds} kolách
            </p>
            
            ${finalScoresHTML}
            
            <div id="rematch-status" style="margin-top: 40px; font-size: 1.1em; color: #3498db;">
                Čaká sa na rozhodnutie ostatných hráčov...
            </div>
            
            <div style="margin-top: 30px;">
                <button onclick="handleRematch()" id="rematch-btn" style="
                    font-family: 'Roboto', 'Arial', sans-serif;
                    font-size: 1.2em;
                    font-weight: 600;
                    padding: 18px 35px;
                    margin: 10px;
                    background: #27ae60;
                    color: white;
                    border: none;
                    cursor: pointer;
                    border-radius: 10px;
                ">
                    ODVETA
                </button>
                <button onclick="handleDeclineRematch()" id="decline-rematch-btn" style="
                    font-family: 'Roboto', 'Arial', sans-serif;
                    font-size: 1.2em;
                    font-weight: 600;
                    padding: 18px 35px;
                    margin: 10px;
                    background: #e74c3c;
                    color: white;
                    border: none;
                    cursor: pointer;
                    border-radius: 10px;
                ">
                    SPÄŤ DO MENU
                </button>
            </div>
        </div>
    `;
    
    matchScreen.style.display = 'flex';
}

// Handle rematch button
function handleRematch() {
    if (socket) {
        socket.emit('rematch-vote', { vote: true });
    }
    document.getElementById('rematch-btn').disabled = true;
    document.getElementById('decline-rematch-btn').disabled = true;
    document.getElementById('rematch-status').textContent = 'Čakáš na ostatných hráčov...';
}

// Handle decline rematch button
function handleDeclineRematch() {
    if (socket) {
        socket.emit('rematch-vote', { vote: false });
    }
    document.getElementById('rematch-btn').disabled = true;
    document.getElementById('decline-rematch-btn').disabled = true;
    document.getElementById('rematch-status').textContent = 'Odmietol si odvetu, vraciame sa do menu...';
}

// Show popup when rematch is declined or player leaves
function showRematchDeclinedPopup(playerName, reason) {
    // Hide match screen
    const matchScreen = document.getElementById('all-vs-all-match-screen');
    if (matchScreen) {
        matchScreen.remove();
    }
    
    // Create popup overlay
    let popup = document.getElementById('rematch-declined-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'rematch-declined-popup';
        popup.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10001;
        `;
        document.body.appendChild(popup);
    }
    
    popup.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            padding: 50px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            border: 2px solid #e74c3c;
        ">
            <h1 style="
                font-family: 'Press Start 2P', monospace;
                color: #e74c3c;
                font-size: 2em;
                margin-bottom: 30px;
                line-height: 1.5;
            ">
                ❌ ODVETA ZRUŠENÁ
            </h1>
            <p style="
                font-family: 'Roboto', Arial, sans-serif;
                color: white;
                font-size: 1.5em;
                margin-bottom: 40px;
            ">
                Hráč <strong style="color: #f1c40f;">${playerName}</strong> ${reason}
            </p>
            <button id="return-to-menu-btn" style="
                font-family: 'Roboto', Arial, sans-serif;
                font-size: 1.3em;
                font-weight: 600;
                padding: 20px 40px;
                background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
                color: white;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(231, 76, 60, 0.4);
                transition: all 0.3s ease;
            ">
                NÁVRAT DO MENU
            </button>
        </div>
    `;
    
    popup.style.display = 'flex';
    
    // Add click event listener to button
    setTimeout(() => {
        const btn = document.getElementById('return-to-menu-btn');
        if (btn) {
            btn.addEventListener('click', returnToMenuFromPopup);
            btn.addEventListener('mouseover', function() {
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 6px 20px rgba(231, 76, 60, 0.6)';
            });
            btn.addEventListener('mouseout', function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 4px 15px rgba(231, 76, 60, 0.4)';
            });
        }
    }, 0);
}

// Function to return to menu from popup
function returnToMenuFromPopup() {
    console.log('🔙 Returning to main menu from popup...');
    
    // Remove popup
    const popup = document.getElementById('rematch-declined-popup');
    if (popup) {
        popup.remove();
        console.log('✅ Popup removed');
    }
    
    // Remove any other game screens
    const roundScreen = document.getElementById('all-vs-all-round-screen');
    if (roundScreen) {
        roundScreen.remove();
    }
    const matchScreen = document.getElementById('all-vs-all-match-screen');
    if (matchScreen) {
        matchScreen.remove();
    }
    
    // Stop game loop
    if (typeof isPaused !== 'undefined') {
        isPaused = true;
    }
    
    // Clear game state
    gameState.isMultiplayer = false;
    gameState.gameOver = true;
    gameState.roundOver = true;
    gameState.currentScreen = 'mainMenu';
    
    // Clear tanks
    multiplayerTanks.clear();
    
    // Leave room
    if (socket) {
        socket.emit('leave-room');
        console.log('📤 Left room');
    }
    
    // Return to menu
    console.log('📺 Showing menu screen...');
    showScreen('mainMenu');
    showNotification('Vrátenie do hlavného menu', 'info', 2000);
    console.log('✅ Menu should be visible now');
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
    // Note: Continuation is now handled by the "Pokračuj" button in the card
}
// --- ROUND RESULT CARD LOGIC ---

function showRoundResultCard() {
    const card = document.getElementById('round-result-card');
    if (!card) return;
    
    // Player captain
    const playerImg = document.getElementById('round-result-player-img');
    const playerName = document.getElementById('round-result-player-name');
    const playerAlliesDiv = document.getElementById('round-result-player-allies');
    
    let playerCharKey = null;
    if (gameState.selectedPlayerChar && gameState.selectedPlayerChar.key) {
        playerCharKey = gameState.selectedPlayerChar.key;
    } else if (gameState.selectedPlayerChar) {
        const charKeys = Object.keys(CHARACTERS);
        playerCharKey = charKeys.find(k => CHARACTERS[k].name === gameState.selectedPlayerChar.name) || charKeys[0];
    }
    
    playerImg.src = (gameState.charImages && playerCharKey && gameState.charImages[playerCharKey]) ? gameState.charImages[playerCharKey].src : '';
    if (playerName) {
        playerName.textContent = (gameState.selectedPlayerChar && gameState.selectedPlayerChar.name) ? gameState.selectedPlayerChar.name : '';
    }
    
    // Player allies
    if (playerAlliesDiv && gameState.selectedPlayerAllies) {
        playerAlliesDiv.innerHTML = '';
        gameState.selectedPlayerAllies.forEach(allyKey => {
            const ally = CHARACTERS[allyKey];
            if (ally && gameState.charImages && gameState.charImages[allyKey]) {
                const allyImg = document.createElement('img');
                allyImg.src = gameState.charImages[allyKey].src;
                allyImg.alt = ally.name;
                allyImg.style.width = '60px';
                allyImg.style.height = '60px';
                allyImg.style.borderRadius = '50%';
                allyImg.style.border = '3px solid #27ae60';
                allyImg.style.boxShadow = '0 0 10px rgba(39, 174, 96, 0.3)';
                allyImg.title = ally.name; // Tooltip with name
                playerAlliesDiv.appendChild(allyImg);
            }
        });
    }
    
    // Enemy captain
    const enemyImg = document.getElementById('round-result-enemy-img');
    const enemyName = document.getElementById('round-result-enemy-name');
    const enemyAlliesDiv = document.getElementById('round-result-enemy-allies');
    
    let enemyCharKey = null;
    if (gameState.selectedEnemyChar && gameState.selectedEnemyChar.key) {
        enemyCharKey = gameState.selectedEnemyChar.key;
    } else if (gameState.selectedEnemyChar) {
        const charKeys = Object.keys(CHARACTERS);
        enemyCharKey = charKeys.find(k => CHARACTERS[k].name === gameState.selectedEnemyChar.name) || charKeys[0];
    }
    
    enemyImg.src = (gameState.charImages && enemyCharKey && gameState.charImages[enemyCharKey]) ? gameState.charImages[enemyCharKey].src : '';
    if (enemyName) {
        enemyName.textContent = (gameState.selectedEnemyChar && gameState.selectedEnemyChar.name) ? gameState.selectedEnemyChar.name : '';
    }
    
    // Enemy allies
    if (enemyAlliesDiv && gameState.selectedEnemyAllies) {
        enemyAlliesDiv.innerHTML = '';
        gameState.selectedEnemyAllies.forEach(allyKey => {
            const ally = CHARACTERS[allyKey];
            if (ally && gameState.charImages && gameState.charImages[allyKey]) {
                const allyImg = document.createElement('img');
                allyImg.src = gameState.charImages[allyKey].src;
                allyImg.alt = ally.name;
                allyImg.style.width = '60px';
                allyImg.style.height = '60px';
                allyImg.style.borderRadius = '50%';
                allyImg.style.border = '3px solid #e74c3c';
                allyImg.style.boxShadow = '0 0 10px rgba(231, 76, 60, 0.3)';
                allyImg.title = ally.name; // Tooltip with name
                enemyAlliesDiv.appendChild(allyImg);
            }
        });
    }
    
    // Score
    const score = document.getElementById('round-result-score');
    score.textContent = `${gameState.playerScore} : ${gameState.enemyScore}`;
    
    // Add event listener for continue button
    const continueBtn = document.getElementById('round-continue-btn');
    if (continueBtn) {
        continueBtn.onclick = () => {
            hideRoundResultCard();
            if (gameState.playerScore >= 3) {
                endGame(true);
            } else if (gameState.enemyScore >= 3) {
                endGame(false);
            } else {
                // Re-create obstacles for the new round
                createObstacles(GAME_MODES[gameState.currentMode].obstacleDensity);
                if (gameState.selectedMap === '3' && typeof createIglus === 'function') {
                    createIglus();
                }
                startNewRound();
            }
        };
    }
    
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
    
    // Reset cheat mode
    cheatModeActive = false;
    cheatCodeBuffer = '';
    const indicator = document.getElementById('cheat-indicator');
    if (indicator) {
        indicator.remove();
    }
    
    // Reset all game variables except coins
    gameState.player = null;
    gameState.allies = [];
    gameState.enemies = [];
    gameState.bullets = [];
    gameState.obstacles = [];
    gameState.tracks = [];
    gameState.particles = [];
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
        gameState.selectedPlayerAllies = selectedAllies.slice();

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
