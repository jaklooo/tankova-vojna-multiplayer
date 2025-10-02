/**
 * Track - Tank track marks left behind when tanks move
 */

class Track {
    constructor(x, y, angle, timestamp) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.width = 20;
        this.height = 5;
        this.offset = 15;
        this.timestamp = timestamp;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Sand color for desert map, else default brown
        let sandColor = '#e2c28b'; // Light sand
        let normalColor = '#6B4F4F'; // Brown
        ctx.fillStyle = (typeof gameState !== 'undefined' && gameState.selectedMap === '2') ? sandColor : normalColor;
        ctx.fillRect(-this.width / 2, -this.offset - this.height / 2, this.width, this.height);
        ctx.fillRect(-this.width / 2, this.offset - this.height / 2, this.width, this.height);
        ctx.restore();
    }
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Track;
}
