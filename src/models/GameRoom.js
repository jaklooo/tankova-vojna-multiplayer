const { GAME_MODES } = require('../config/gameModes');

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
        if (this.gameState !== 'playing') return null;
        
        if (this.teamMode) {
            // Team vs team: check if one team has no alive players
            const blueAlive = this.teams.blue.filter(id => this.alivePlayers.has(id));
            const redAlive = this.teams.red.filter(id => this.alivePlayers.has(id));
            
            if (blueAlive.length === 0 && redAlive.length > 0) {
                return { winner: 'red', gameEnd: true };
            } else if (redAlive.length === 0 && blueAlive.length > 0) {
                return { winner: 'blue', gameEnd: true };
            }
        } else {
            // All vs all: check if only one player is alive
            if (this.alivePlayers.size <= 1) {
                const winnerId = this.alivePlayers.size === 1 ? 
                    Array.from(this.alivePlayers)[0] : null;
                return { winner: winnerId, gameEnd: true };
            }
        }
        
        return null;
    }

    handleRoundWin(winner) {
        if (!this.teamMode) return { matchEnd: true };
        
        this.roundWinners.push(winner);
        this.roundScores[winner]++;
        this.currentRound++;
        
        // Check if match is over (best of 3)
        const matchEnd = this.roundScores[winner] >= Math.ceil(this.maxRounds / 2);
        
        return { matchEnd, winner };
    }

    getTeamEndData() {
        return {
            matchWinner: this.roundScores.blue > this.roundScores.red ? 'blue' : 'red',
            scores: this.roundScores,
            teams: {
                blue: this.players.filter(p => p.team === 'blue'),
                red: this.players.filter(p => p.team === 'red')
            },
            rounds: this.roundWinners
        };
    }

    getAllVsAllEndData() {
        const ranking = this.players.map(player => {
            const elimination = this.eliminationOrder.find(e => e.playerId === player.id);
            return {
                name: player.name,
                playerId: player.id,
                eliminationOrder: elimination ? elimination.eliminationOrder : 0
            };
        }).sort((a, b) => {
            // Winner (not eliminated) first, then by elimination order
            if (a.eliminationOrder === 0) return -1;
            if (b.eliminationOrder === 0) return 1;
            return a.eliminationOrder - b.eliminationOrder;
        });

        return { ranking };
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
