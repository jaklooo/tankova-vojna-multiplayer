/**
 * Bullet.js
 * 
 * Represents a bullet/projectile fired by tanks.
 * Handles bullet rendering and movement.
 * 
 * Dependencies:
 * - Global ctx (canvas context)
 * - Global images object
 */

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

// Export to global scope for script tag import
if (typeof window !== 'undefined') {
    window.Bullet = Bullet;
}
