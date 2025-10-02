/**
 * InputManager.js
 * 
 * Manages keyboard and mouse input for player tank control.
 * Handles game controls separately from UI event listeners.
 * 
 * Dependencies:
 * - Global gameState object
 */

class InputManager {
    constructor() {
        this.keys = {};
        this.setupEventListeners();
    }

    /**
     * Initialize keyboard event listeners for player control
     */
    setupEventListeners() {
        // Track key states for movement
        window.addEventListener('keydown', (e) => {
            if (e.key) {
                this.keys[e.key.toLowerCase()] = true;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.key) {
                this.keys[e.key.toLowerCase()] = false;
            }
        });

        // Shooting control (Space bar)
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && this.canShoot()) {
                e.preventDefault();
                if (gameState.player) {
                    gameState.player.shoot();
                }
            }
        });
    }

    /**
     * Check if player can currently shoot
     */
    canShoot() {
        return gameState.currentScreen === 'game' && 
               !gameState.roundOver && 
               gameState.player && 
               !gameState.isSpectating;
    }

    /**
     * Get current state of a key
     * @param {string} key - Key to check
     * @returns {boolean} True if key is pressed
     */
    isKeyPressed(key) {
        return this.keys[key.toLowerCase()] || false;
    }

    /**
     * Update gameState.keys with current key states
     * This maintains compatibility with existing code
     */
    syncKeysToGameState() {
        if (gameState && gameState.keys) {
            Object.assign(gameState.keys, this.keys);
        }
    }

    /**
     * Reset all key states
     */
    reset() {
        this.keys = {};
        if (gameState && gameState.keys) {
            gameState.keys = {};
        }
    }
}

// Export to global scope for script tag import
if (typeof window !== 'undefined') {
    window.InputManager = InputManager;
}
