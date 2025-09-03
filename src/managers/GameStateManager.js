/**
 * GameStateManager - Centralized game state management
 * Handles game phases, ending conditions, and state transitions
 */
class GameStateManager {
    constructor() {
        this.gameStates = {
            WAITING: 'waiting',
            LOBBY: 'lobby', 
            PLAYING: 'playing',
            ROUND_END: 'round-end',
            GAME_END: 'game-end',
            ENDED: 'ended'
        };
        
        this.gamePhases = {
            TEAM_SELECTION: 'team-selection',
            CHARACTER_SELECTION: 'character-selection', 
            TANK_SELECTION: 'tank-selection',
            MAP_SELECTION: 'map-selection',
            COMBINED_SELECTION: 'combined-selection'
        };
        
        this.endConditions = {
            LAST_PLAYER_STANDING: 'last-player-standing',
            TEAM_ELIMINATED: 'team-eliminated',
            TIME_LIMIT: 'time-limit',
            DISCONNECT: 'disconnect'
        };
    }
    
    /**
     * Check if game should end based on alive players and game mode
     */
    checkEndCondition(room) {
        if (room.gameState !== this.gameStates.PLAYING) return null;
        
        const endResult = {
            shouldEnd: false,
            condition: null,
            winner: null,
            data: null
        };
        
        if (room.teamMode) {
            return this._checkTeamEndCondition(room, endResult);
        } else {
            return this._checkAllVsAllEndCondition(room, endResult);
        }
    }
    
    /**
     * Check end conditions for team-based games
     */
    _checkTeamEndCondition(room, endResult) {
        const blueAlive = room.teams.blue.filter(id => room.alivePlayers.has(id));
        const redAlive = room.teams.red.filter(id => room.alivePlayers.has(id));
        
        if (blueAlive.length === 0 && redAlive.length > 0) {
            endResult.shouldEnd = true;
            endResult.condition = this.endConditions.TEAM_ELIMINATED;
            endResult.winner = 'red';
            endResult.data = { eliminatedTeam: 'blue', survivors: redAlive };
        } else if (redAlive.length === 0 && blueAlive.length > 0) {
            endResult.shouldEnd = true;
            endResult.condition = this.endConditions.TEAM_ELIMINATED;
            endResult.winner = 'blue';
            endResult.data = { eliminatedTeam: 'red', survivors: blueAlive };
        } else if (blueAlive.length === 0 && redAlive.length === 0) {
            // Draw scenario
            endResult.shouldEnd = true;
            endResult.condition = this.endConditions.TEAM_ELIMINATED;
            endResult.winner = null;
            endResult.data = { draw: true };
        }
        
        return endResult;
    }
    
    /**
     * Check end conditions for all-vs-all games
     */
    _checkAllVsAllEndCondition(room, endResult) {
        if (room.alivePlayers.size <= 1) {
            endResult.shouldEnd = true;
            endResult.condition = this.endConditions.LAST_PLAYER_STANDING;
            endResult.winner = room.alivePlayers.size === 1 ? 
                Array.from(room.alivePlayers)[0] : null;
            endResult.data = { 
                finalRanking: this._generateFinalRanking(room),
                winner: endResult.winner
            };
        }
        
        return endResult;
    }
    
    /**
     * Generate final ranking for all-vs-all mode
     */
    _generateFinalRanking(room) {
        return room.players.map(player => {
            const elimination = room.eliminationOrder.find(e => e.playerId === player.id);
            return {
                name: player.name,
                playerId: player.id,
                selectedCharacter: player.selectedCharacter || null,
                eliminationOrder: elimination ? elimination.eliminationOrder : 0,
                isWinner: room.alivePlayers.has(player.id)
            };
        }).sort((a, b) => {
            // Winner (not eliminated) first, then by elimination order (latest elimination = better rank)
            if (a.eliminationOrder === 0) return -1;
            if (b.eliminationOrder === 0) return 1;
            return b.eliminationOrder - a.eliminationOrder; // Reverse order - later elimination = better rank
        });
    }
    
    /**
     * Handle round ending for team games
     */
    handleRoundEnd(room, endResult) {
        if (!room.teamMode) {
            return { isMatchEnd: true, matchWinner: endResult.winner };
        }
        
        // Add round winner
        room.roundWinners.push(endResult.winner);
        if (endResult.winner) {
            room.roundScores[endResult.winner]++;
        }
        room.currentRound++;
        
        // Check if match is over (best of X rounds)
        const maxScore = Math.max(room.roundScores.blue, room.roundScores.red);
        const isMatchEnd = maxScore >= Math.ceil(room.maxRounds / 2);
        
        const matchWinner = isMatchEnd ? 
            (room.roundScores.blue > room.roundScores.red ? 'blue' : 'red') : null;
            
        return {
            isMatchEnd,
            matchWinner,
            roundWinner: endResult.winner,
            currentScore: { ...room.roundScores },
            round: room.currentRound - 1
        };
    }
    
    /**
     * Get comprehensive end game data
     */
    getEndGameData(room, endResult, roundResult = null) {
        const baseData = {
            gameMode: room.gameMode,
            teamMode: room.teamMode,
            endCondition: endResult.condition,
            timestamp: Date.now()
        };
        
        if (room.teamMode) {
            return {
                ...baseData,
                type: 'team-end',
                matchWinner: roundResult?.matchWinner,
                roundWinner: endResult.winner,
                scores: room.roundScores,
                teams: {
                    blue: room.players.filter(p => p.team === 'blue'),
                    red: room.players.filter(p => p.team === 'red')
                },
                rounds: room.roundWinners,
                isMatchEnd: roundResult?.isMatchEnd || false
            };
        } else {
            return {
                ...baseData,
                type: 'all-vs-all-end',
                winner: endResult.winner,
                ranking: endResult.data?.finalRanking || []
            };
        }
    }
    
    /**
     * Validate game state transition
     */
    canTransitionTo(currentState, newState) {
        const validTransitions = {
            [this.gameStates.WAITING]: [this.gameStates.LOBBY, this.gameStates.PLAYING],
            [this.gameStates.LOBBY]: [this.gameStates.PLAYING, this.gameStates.WAITING],
            [this.gameStates.PLAYING]: [this.gameStates.ROUND_END, this.gameStates.GAME_END],
            [this.gameStates.ROUND_END]: [this.gameStates.PLAYING, this.gameStates.GAME_END],
            [this.gameStates.GAME_END]: [this.gameStates.ENDED, this.gameStates.WAITING],
            [this.gameStates.ENDED]: [this.gameStates.WAITING]
        };
        
        return validTransitions[currentState]?.includes(newState) || false;
    }
}

module.exports = GameStateManager;