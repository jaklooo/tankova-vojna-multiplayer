const { GAME_MODES } = require('../config/gameModes');
const GameStateManager = require('../managers/GameStateManager');

class GameRoom {
    constructor(id, gameMode = 'all-vs-all') {
        this.id = id;
        this.players = [];
        this.gameMode = gameMode;
        this.maxPlayers = GAME_MODES[gameMode].maxPlayers;
        this.minPlayers = GAME_MODES[gameMode].minPlayers || GAME_MODES[gameMode].maxPlayers;
        this.teamMode = GAME_MODES[gameMode].teamMode;
        this.hostCanStart = GAME_MODES[gameMode].hostCanStart || false;
        this.gameState = 'waiting'; // waiting, selecting, playing, ended
        this.currentPhase = 'team-selection'; // team-selection, character-selection, tank-selection, map-selection
        this.gameData = null;
        this.selectionPhase = false; // Host can start selection phase in team mode
        this.selectedMap = null; // Selected map by host
        this.hostId = null; // First player becomes host
        this.teams = { blue: [], red: [] }; // For team-based modes
        this.teamNames = { blue: 'Modrý tím', red: 'Červený tím' }; // Default team names
        this.teamCaptains = { blue: null, red: null }; // First player in each team becomes captain
        this.mapVotes = {}; // Map voting for all-vs-all mode
        this.readyPlayers = new Set(); // Ready players for all-vs-all mode
        this.gameReadyPlayers = new Set(); // Players ready for final game start in combined selection
        this.locked = false; // Host can lock room to prevent new players
        
        // End game system properties
        this.currentRound = 1;
        this.maxRounds = 3; // Best-of-3 for team vs team
        this.roundScores = { blue: 0, red: 0 }; // Team scores
        this.eliminationOrder = []; // For all-vs-all ranking
        this.roundWinners = []; // Track round winners for team mode
        this.matchEnded = false;
        this.alivePlayers = new Set(); // Track alive players
        this.spectators = new Set(); // Track spectating players
        
        // Initialize game state manager
        this.stateManager = new GameStateManager();
    }

    addPlayer(player) {
        if (this.players.length < this.maxPlayers) {
            // First player becomes host
            if (this.players.length === 0) {
                this.hostId = player.id;
                player.isHost = true;
            }

            // For team mode, players join teams manually
            // For all-vs-all mode, no team assignment
            player.team = null;

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
            if (removedPlayer.team === 'blue') {
                this.teams.blue = this.teams.blue.filter(id => id !== playerId);
            } else if (removedPlayer.team === 'red') {
                this.teams.red = this.teams.red.filter(id => id !== playerId);
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

    // --- END GAME METHODS ---
    initializeGame() {
        // Initialize game state for alive players
        this.alivePlayers.clear();
        this.spectators.clear();
        this.eliminationOrder = [];
        
        this.players.forEach(player => {
            this.alivePlayers.add(player.id);
        });
    }

    eliminatePlayer(playerId) {
        this.spectators.add(playerId);
        this.alivePlayers.delete(playerId);
        
        // Add to elimination order for all-vs-all mode
        if (!this.teamMode) {
            this.eliminationOrder.push({
                playerId: playerId,
                eliminationTime: Date.now(),
                eliminationOrder: this.eliminationOrder.length + 1
            });
        }
    }

    checkGameEnd() {
        return this.stateManager.checkEndCondition(this);
    }

    handleRoundWin(winner) {
        const endResult = { winner, gameEnd: true };
        return this.stateManager.handleRoundEnd(this, endResult);
    }

    getTeamEndData() {
        const endResult = { winner: null, gameEnd: true };
        const roundResult = { isMatchEnd: true };
        return this.stateManager.getEndGameData(this, endResult, roundResult);
    }

    getAllVsAllEndData() {
        const endResult = { 
            winner: this.alivePlayers.size === 1 ? Array.from(this.alivePlayers)[0] : null,
            gameEnd: true 
        };
        return this.stateManager.getEndGameData(this, endResult);
    }

    resetForNextRound() {
        // Reset alive players and spectators for next round
        this.alivePlayers.clear();
        this.spectators.clear();
        
        // Add all players back to alive
        this.players.forEach(player => {
            this.alivePlayers.add(player.id);
        });
    }
}

module.exports = GameRoom;
