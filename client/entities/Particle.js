/**
 * Particle - Visual effects for explosions and impacts
 */

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

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Particle;
}
