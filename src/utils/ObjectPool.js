/**
 * Universal Object Pool for performance optimization
 * Reduces garbage collection by reusing objects
 */
window.ObjectPool = class ObjectPool {
    constructor(createFn, resetFn, initialSize = 10) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.active = new Set();
        this.stats = {
            created: 0,
            reused: 0,
            maxActive: 0
        };
        
        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
            this.stats.created++;
        }
    }
    
    /**
     * Get an object from the pool
     */
    acquire() {
        let obj;
        
        if (this.pool.length > 0) {
            obj = this.pool.pop();
            this.stats.reused++;
        } else {
            obj = this.createFn();
            this.stats.created++;
        }
        
        this.active.add(obj);
        this.stats.maxActive = Math.max(this.stats.maxActive, this.active.size);
        
        return obj;
    }
    
    /**
     * Return an object to the pool
     */
    release(obj) {
        if (this.active.has(obj)) {
            this.active.delete(obj);
            this.resetFn(obj);
            this.pool.push(obj);
            return true;
        }
        return false;
    }
    
    /**
     * Get pool statistics for debugging
     */
    getStats() {
        return {
            ...this.stats,
            poolSize: this.pool.length,
            activeCount: this.active.size,
            reuseRatio: this.stats.reused / (this.stats.created + this.stats.reused)
        };
    }
    
    /**
     * Clear all objects from pool
     */
    clear() {
        this.pool.length = 0;
        this.active.clear();
    }
};

// Export for browser global access
if (typeof window !== 'undefined') {
    window.ObjectPool = window.ObjectPool || ObjectPool;
}
