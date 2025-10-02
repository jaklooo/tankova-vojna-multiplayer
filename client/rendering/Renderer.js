/**
 * Renderer.js
 * 
 * Handles game rendering and drawing operations.
 * Encapsulates rendering logic for better organization and performance.
 * 
 * Dependencies:
 * - Global ctx (canvas context)
 * - Global canvas
 * - Global gameState object
 * - Global performanceManager
 * - Global isMultiplayer flag
 */

class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    /**
     * Clear the canvas
     */
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Draw background/floor texture
     */
    drawBackground() {
        if (gameState.currentFloorTexture && 
            gameState.currentFloorTexture.complete && 
            gameState.currentFloorTexture.naturalWidth !== 0) {
            const pattern = this.ctx.createPattern(gameState.currentFloorTexture, 'repeat');
            this.ctx.fillStyle = pattern;
            this.ctx.fillRect(0, 0, gameState.arenaWidth, gameState.arenaHeight);
        } else {
            this.ctx.fillStyle = gameState.selectedMap === '2' ? '#e2c28b' : '#3c523c';
            this.ctx.fillRect(0, 0, gameState.arenaWidth, gameState.arenaHeight);
        }
    }

    /**
     * Setup camera transformation
     */
    setupCamera() {
        this.ctx.save();
        this.ctx.translate(-gameState.cameraX, -gameState.cameraY);
    }

    /**
     * Reset camera transformation
     */
    resetCamera() {
        this.ctx.restore();
    }

    /**
     * Draw tracks with optional culling
     */
    drawTracks() {
        if (performanceManager && isMultiplayer) {
            const camera = { x: gameState.cameraX, y: gameState.cameraY };
            const canvasSize = { width: this.canvas.width, height: this.canvas.height };
            const visibleTracks = performanceManager.cullObjects(gameState.tracks, camera, canvasSize);
            visibleTracks.forEach(track => track.draw());
        } else {
            gameState.tracks.forEach(track => track.draw());
        }
    }

    /**
     * Draw particles with optional culling
     */
    drawParticles() {
        if (performanceManager && isMultiplayer) {
            const camera = { x: gameState.cameraX, y: gameState.cameraY };
            const canvasSize = { width: this.canvas.width, height: this.canvas.height };
            const visibleParticles = performanceManager.cullObjects(gameState.particles, camera, canvasSize);
            visibleParticles.forEach(particle => particle.draw());
        } else {
            gameState.particles.forEach(particle => particle.draw());
        }
    }

    /**
     * Draw shot effects with optional culling
     */
    drawShotEffects() {
        if (performanceManager && isMultiplayer) {
            const camera = { x: gameState.cameraX, y: gameState.cameraY };
            const canvasSize = { width: this.canvas.width, height: this.canvas.height };
            const visibleShotEffects = performanceManager.cullObjects(gameState.shotEffects, camera, canvasSize);
            visibleShotEffects.forEach(effect => effect.draw());
        } else {
            gameState.shotEffects.forEach(effect => effect.draw());
        }
    }

    /**
     * Draw hit effects with optional culling
     */
    drawHitEffects() {
        if (performanceManager && isMultiplayer) {
            const camera = { x: gameState.cameraX, y: gameState.cameraY };
            const canvasSize = { width: this.canvas.width, height: this.canvas.height };
            const visibleHitEffects = performanceManager.cullObjects(gameState.hitEffects, camera, canvasSize);
            visibleHitEffects.forEach(effect => effect.draw());
        } else {
            gameState.hitEffects.forEach(effect => effect.draw());
        }
    }

    /**
     * Draw obstacles
     */
    drawObstacles() {
        // Draw swamps, rocks, oilrigs first (ground level)
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
        
        // Draw trees last (above everything)
        gameState.obstacles.forEach(obs => {
            if (obs.type === 'tree') {
                obs.draw();
            }
        });
    }

    /**
     * Draw bullets
     */
    drawBullets() {
        gameState.bullets.forEach(bullet => bullet.draw());
    }

    /**
     * Draw all tanks (allies and enemies)
     */
    drawTanks() {
        // Draw allies
        gameState.allies.forEach(ally => {
            if (ally.health > 0) ally.draw();
        });
        
        // Draw enemies
        gameState.enemies.forEach(enemy => {
            if (enemy.health > 0) enemy.draw();
        });
        
        // Draw player last (on top)
        if (gameState.player && gameState.player.health > 0) {
            gameState.player.draw();
        }
    }

    /**
     * Draw multiplayer tanks
     */
    drawMultiplayerTanks() {
        if (isMultiplayer && multiplayerTanks) {
            multiplayerTanks.forEach((tank, playerId) => {
                if (tank.health > 0) {
                    tank.draw();
                }
            });
        }
    }
}

// Export to global scope for script tag import
if (typeof window !== 'undefined') {
    window.Renderer = Renderer;
}
