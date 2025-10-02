/**
 * Effects - Shot and hit visual effects
 */

class ShotEffect {
    constructor(x, y, angle) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.life = 10; // frames
        this.maxLife = 10;
    }

    update() {
        this.life--;
    }

    draw() {
        if (this.life <= 0) return;
        
        const opacity = this.life / this.maxLife;
        const size = (1 - opacity) * 20 + 10;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        
        // Muzzle flash
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }

    isDead() {
        return this.life <= 0;
    }
}

class HitEffect {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.life = 15; // frames
        this.maxLife = 15;
        this.particles = [];
        
        // Create small particles for hit effect
        for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 / 8) * i;
            this.particles.push({
                x: 0,
                y: 0,
                vx: Math.cos(angle) * 2,
                vy: Math.sin(angle) * 2,
                size: Math.random() * 3 + 2
            });
        }
    }

    update() {
        this.life--;
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.95;
            p.vy *= 0.95;
        });
    }

    draw() {
        if (this.life <= 0) return;
        
        const opacity = this.life / this.maxLife;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(this.x, this.y);
        
        // Draw impact particles
        this.particles.forEach(p => {
            ctx.fillStyle = '#ff6600';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
        
        ctx.restore();
    }

    isDead() {
        return this.life <= 0;
    }
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShotEffect, HitEffect };
}
