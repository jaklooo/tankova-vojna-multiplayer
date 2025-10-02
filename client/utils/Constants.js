/**
 * Constants.js - Centralized configuration and constants
 * All game constants, settings, and configuration values in one place
 */

// Export constants to global scope (using IIFE to avoid polluting global namespace)
(function() {
    window.GameConstants = {
        // ===== MULTIPLAYER OPTIMIZATIONS =====
        NETWORK_SYNC_INTERVAL: 70, // Optimized to 70ms (~14 FPS) for very smooth movement
        MULTIPLAYER_TARGET_FPS: 60, // Full FPS for smooth multiplayer experience
        MULTIPLAYER_FRAME_TIME: 1000 / 60, // Calculated from target FPS
        EFFECTS_REDUCTION_FACTOR: 0.3, // Reduce visual effects in multiplayer
        MAX_PARTICLES_MULTIPLAYER: 15, // Limit particles in multiplayer
        MAX_TRACKS_MULTIPLAYER: 20, // Limit tank tracks in multiplayer
        VIEWPORT_CULLING_MARGIN: 300, // Extra margin for viewport culling (increased for multiplayer)
        
        // ===== UI CONSTANTS =====
        BASE_HUD_HEIGHT: 80,
        MINIMAP_SIZE: 180, // Size of the square minimap
        MINIMAP_MARGIN: 10, // Margin from top-left
        
        // ===== GAME SETTINGS =====
        ROUNDS_TO_WIN: 3,
        TANK_HEALTH_MULTIPLIER: 5,
        
        // ===== GAME MODES =====
        // Adjusted arena multipliers for larger maps
        GAME_MODES: {
            '1v1': {
                playerCount: 1,
                allyCount: 0,
                enemyCount: 1,
                arenaWidthMultiplier: 2.5,
                arenaHeightMultiplier: 2.5,
                obstacleDensity: 1.5,
                cameraZoom: 1
            },
            '6v6': {
                playerCount: 1,
                allyCount: 5,
                enemyCount: 6,
                arenaWidthMultiplier: 4,
                arenaHeightMultiplier: 4,
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
                cameraZoom: 0.8
            }
        }
    };
})();
