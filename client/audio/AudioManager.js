/**
 * AudioManager - Centralized audio management system
 * Provides audio playback, volume control, fade effects, and autoplay handling
 */

class AudioManager {
    constructor() {
        this.elements = {
            menuMusic: document.getElementById('menu-music'),
            canonShot: document.getElementById('canon-shot-sound'),
            hitMe: document.getElementById('hitme-sound'),
            hitHim: document.getElementById('hithim-sound'),
            explosion: document.getElementById('explosion-sound')
        };
        this.volume = 1.0;
        this.muted = false;
        this.fadeIntervals = new Map();
        this.initialize();
    }
    
    initialize() {
        // Set initial volumes for all audio elements
        Object.values(this.elements).forEach(element => {
            if (element) {
                element.volume = this.volume;
                element.preload = 'auto';
            }
        });
        
        // Debug log to check if menu music element is found
        if (this.elements.menuMusic) {
            console.log('Menu music element found:', this.elements.menuMusic.src);
        } else {
            console.warn('Menu music element not found! Trying to find it again...');
            this.elements.menuMusic = document.getElementById('menu-music');
            if (this.elements.menuMusic) {
                console.log('Menu music element found on retry:', this.elements.menuMusic.src);
                this.elements.menuMusic.volume = this.volume;
                this.elements.menuMusic.preload = 'auto';
            }
        }
        
        console.log('AudioManager initialized with centralized audio control');
    }
    
    /**
     * Play an audio file once
     * @param {string} audioId - ID of the audio element or key in this.elements
     * @param {number|null} volume - Optional volume override (0-1)
     */
    play(audioId, volume = null) {
        const element = this.elements[audioId] || document.getElementById(audioId);
        if (element && !this.muted) {
            try {
                element.currentTime = 0;
                if (volume !== null) element.volume = volume;
                element.play().catch(e => console.warn('Audio play failed:', e));
            } catch (e) {
                console.warn('Audio play error:', e);
            }
        }
    }
    
    /**
     * Play an audio file in loop
     * @param {string} audioId - ID of the audio element or key in this.elements
     * @param {number|null} volume - Optional volume override (0-1)
     */
    playLoop(audioId, volume = null) {
        const element = this.elements[audioId] || document.getElementById(audioId);
        if (element && !this.muted) {
            try {
                element.loop = true;
                element.currentTime = 0;
                if (volume !== null) element.volume = volume;
                
                // Handle autoplay restrictions with user gesture
                const playPromise = element.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        if (e.name === 'NotAllowedError') {
                            console.log('Audio autoplay blocked. Will play on first user interaction.');
                            // Set up one-time click listener to start audio
                            const startAudioOnClick = () => {
                                element.play().catch(err => console.warn('Audio play failed:', err));
                                document.removeEventListener('click', startAudioOnClick);
                            };
                            document.addEventListener('click', startAudioOnClick);
                        } else {
                            console.warn('Audio loop play failed:', e);
                        }
                    });
                }
            } catch (e) {
                console.warn('Audio loop play error:', e);
            }
        }
    }
    
    /**
     * Stop an audio file
     * @param {string} audioId - ID of the audio element or key in this.elements
     */
    stop(audioId) {
        const element = this.elements[audioId] || document.getElementById(audioId);
        if (element) {
            element.pause();
            element.currentTime = 0;
        }
    }
    
    /**
     * Fade in an audio file
     * @param {string} audioId - ID of the audio element
     * @param {number} duration - Duration of fade in milliseconds
     * @param {number} targetVolume - Target volume (0-1)
     */
    fadeIn(audioId, duration = 1000, targetVolume = this.volume) {
        const element = this.elements[audioId] || document.getElementById(audioId);
        if (!element || this.muted) return;
        
        element.volume = 0;
        element.play().catch(e => console.warn('Audio play failed during fadeIn:', e));
        
        const fadeInterval = setInterval(() => {
            if (element.volume < targetVolume) {
                element.volume = Math.min(element.volume + 0.02, targetVolume);
            } else {
                clearInterval(fadeInterval);
                this.fadeIntervals.delete(audioId);
            }
        }, duration / 50);
        
        this.fadeIntervals.set(audioId, fadeInterval);
    }
    
    /**
     * Fade out an audio file
     * @param {string} audioId - ID of the audio element
     * @param {number} duration - Duration of fade in milliseconds
     */
    fadeOut(audioId, duration = 1000) {
        const element = this.elements[audioId] || document.getElementById(audioId);
        if (!element) return;
        
        const fadeInterval = setInterval(() => {
            if (element.volume > 0) {
                element.volume = Math.max(element.volume - 0.02, 0);
            } else {
                element.pause();
                clearInterval(fadeInterval);
                this.fadeIntervals.delete(audioId);
            }
        }, duration / 50);
        
        this.fadeIntervals.set(audioId, fadeInterval);
    }
    
    /**
     * Set global volume
     * @param {number} volume - Volume level (0-1)
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        Object.values(this.elements).forEach(element => {
            if (element) element.volume = this.volume;
        });
    }
    
    /**
     * Mute all audio
     */
    mute() {
        this.muted = true;
        Object.values(this.elements).forEach(element => {
            if (element) element.muted = true;
        });
    }
    
    /**
     * Unmute all audio
     */
    unmute() {
        this.muted = false;
        Object.values(this.elements).forEach(element => {
            if (element) element.muted = false;
        });
    }
    
    /**
     * Clean up all intervals and resources
     */
    cleanup() {
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals.clear();
        console.log('AudioManager cleaned up');
    }
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioManager;
}
