/**
 * MobileControls.js
 * Handles touch-based controls for mobile devices
 * Provides virtual joystick, fire button, and turret control
 */

class MobileControls {
    constructor() {
        this.isMobile = this.detectMobile();
        this.isActive = false;
        
        // Joystick properties
        this.joystick = {
            container: null,
            base: null,
            stick: null,
            active: false,
            touchId: null,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            maxRadius: this.calculateMaxRadius(), // Dynamicky počítaný radius
            angle: 0,
            distance: 0
        };
        
        // Fire button properties
        this.fireButton = {
            button: null,
            cooldownIndicator: null,
            active: false,
            touchId: null,
            lastFireTime: 0,
            cooldownDuration: 500 // ms
        };
        
        // Turret control properties
        this.turretControl = {
            area: null,
            active: false,
            touchId: null
        };
        
        // Mobile controls container
        this.mobileControlsContainer = null;
        
        // Orientation warning
        this.orientationWarning = null;
        
        this.init();
    }
    
    /**
     * Calculate max radius based on actual joystick container size
     * Uses vmin units with max constraint: min(15vmin, 140px)
     */
    calculateMaxRadius() {
        // Get actual container element to measure real size
        const container = this.joystick.container;
        if (container) {
            const rect = container.getBoundingClientRect();
            const containerSize = rect.width; // Should match height (square)
            const maxRadius = containerSize * 0.35; // 35% of container for smooth control
            return maxRadius;
        }
        
        // Fallback calculation if container not yet available
        const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
        const containerSize = Math.min(15 * vmin, 140); // min(15vmin, 140px)
        const maxRadius = containerSize * 0.35;
        return maxRadius;
    }
    
    /**
     * Detect if device is mobile/touch-enabled
     */
    detectMobile() {
        // Check for forced mobile mode in localStorage
        const forceMobile = localStorage.getItem('forceMobileMode');
        if (forceMobile === 'true') {
            console.log('🔧 FORCED MOBILE MODE ENABLED');
            return true;
        }
        
        // Check for touch support
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        // Check for mobile user agent
        const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Check screen size (less than 1024px width)
        const smallScreen = window.innerWidth < 1024;
        
        return (hasTouch && mobileUA) || (hasTouch && smallScreen);
    }
    
    /**
     * Initialize mobile controls
     */
    init() {
        if (!this.isMobile) {
            console.log('Desktop detected - mobile controls disabled');
            return;
        }
        
        console.log('Mobile device detected - initializing touch controls');
        
        // Get DOM elements
        this.mobileControlsContainer = document.getElementById('mobile-controls');
        this.joystick.container = document.getElementById('joystick-container');
        this.joystick.base = document.getElementById('joystick-base');
        this.joystick.stick = document.getElementById('joystick-stick');
        this.fireButton.button = document.getElementById('fire-button');
        this.fireButton.cooldownIndicator = document.getElementById('fire-cooldown');
        this.turretControl.area = document.getElementById('turret-touch-area');
        this.orientationWarning = document.getElementById('orientation-warning');
        
        // Don't show controls yet - wait for game to start
        // Controls will be shown when gameState.gameStarted === true
        
        // Setup event listeners
        this.setupJoystickListeners();
        this.setupFireButtonListeners();
        // Turret control disabled for mobile
        // this.setupTurretControlListeners();
        this.setupOrientationCheck();
        
        // Prevent default touch behaviors
        this.preventDefaultTouchBehaviors();
        
        this.isActive = true;
        console.log('Mobile controls initialized successfully');
    }
    
    /**
     * Setup joystick touch listeners
     */
    setupJoystickListeners() {
        if (!this.joystick.container) return;
        
        this.joystick.container.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.joystick.active) return; // Already tracking a touch
            
            const touch = e.changedTouches[0];
            this.joystick.touchId = touch.identifier;
            this.joystick.active = true;
            
            // Get container bounds
            const rect = this.joystick.container.getBoundingClientRect();
            this.joystick.startX = rect.left + rect.width / 2;
            this.joystick.startY = rect.top + rect.height / 2;
            
            this.updateJoystick(touch.clientX, touch.clientY);
        }, { passive: false });
        
        this.joystick.container.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!this.joystick.active) return;
            
            // Find our touch
            for (let touch of e.changedTouches) {
                if (touch.identifier === this.joystick.touchId) {
                    this.updateJoystick(touch.clientX, touch.clientY);
                    break;
                }
            }
        }, { passive: false });
        
        this.joystick.container.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            // Find our touch
            for (let touch of e.changedTouches) {
                if (touch.identifier === this.joystick.touchId) {
                    this.resetJoystick();
                    break;
                }
            }
        }, { passive: false });
    }
    
    /**
     * Update joystick position and calculate angle/distance
     */
    updateJoystick(clientX, clientY) {
        const deltaX = clientX - this.joystick.startX;
        const deltaY = clientY - this.joystick.startY;
        
        // Calculate distance from center
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Calculate angle
        const angle = Math.atan2(deltaY, deltaX);
        
        // Clamp distance to max radius
        const clampedDistance = Math.min(distance, this.joystick.maxRadius);
        
        // Calculate stick position
        const stickX = Math.cos(angle) * clampedDistance;
        const stickY = Math.sin(angle) * clampedDistance;
        
        // Update stick visual position
        if (this.joystick.stick) {
            this.joystick.stick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;
        }
        
        // Store values
        this.joystick.angle = angle;
        this.joystick.distance = clampedDistance;
        
        // Update game keys based on joystick direction
        this.updateMovementKeys(angle, clampedDistance);
    }
    
    /**
     * Update movement keys based on joystick input
     * 8-DIRECTIONAL CONTROL - maps joystick to 8 zones (W, WD, D, SD, S, SA, A, WA)
     */
    updateMovementKeys(angle, distance) {
        // Dead zone check (10% of max radius)
        const deadZone = this.joystick.maxRadius * 0.1;
        
        if (!gameState || !gameState.keys) return;
        
        if (distance < deadZone) {
            // In dead zone - no movement
            gameState.keys['w'] = false;
            gameState.keys['s'] = false;
            gameState.keys['a'] = false;
            gameState.keys['d'] = false;
            return;
        }
        
        // Convert angle to degrees for easier calculation
        const degrees = angle * (180 / Math.PI);
        
        // Reset all keys
        gameState.keys['w'] = false;
        gameState.keys['s'] = false;
        gameState.keys['a'] = false;
        gameState.keys['d'] = false;
        
        // 8-directional mapping (each zone is 45° wide)
        // W:   -112.5° to -67.5°   (centrum: -90°)
        // WD:   -67.5° to -22.5°   (centrum: -45°)
        // D:    -22.5° to  22.5°   (centrum:   0°)
        // SD:    22.5° to  67.5°   (centrum:  45°)
        // S:     67.5° to 112.5°   (centrum:  90°)
        // SA:   112.5° to 157.5°   (centrum: 135°)
        // A:   -157.5° to -112.5°  OR  157.5° to 180° (centrum: ±180°)
        // WA:  -157.5° to -112.5°  (centrum: -135°)
        
        if (degrees >= -112.5 && degrees < -67.5) {
            // W - hore
            gameState.keys['w'] = true;
        }
        else if (degrees >= -67.5 && degrees < -22.5) {
            // WD - hore-vpravo
            gameState.keys['w'] = true;
            gameState.keys['d'] = true;
        }
        else if (degrees >= -22.5 && degrees < 22.5) {
            // D - vpravo
            gameState.keys['d'] = true;
        }
        else if (degrees >= 22.5 && degrees < 67.5) {
            // SD - dole-vpravo
            gameState.keys['s'] = true;
            gameState.keys['d'] = true;
        }
        else if (degrees >= 67.5 && degrees < 112.5) {
            // S - dole
            gameState.keys['s'] = true;
        }
        else if (degrees >= 112.5 && degrees < 157.5) {
            // SA - dole-vľavo
            gameState.keys['s'] = true;
            gameState.keys['a'] = true;
        }
        else if ((degrees >= 157.5 && degrees <= 180) || (degrees >= -180 && degrees < -157.5)) {
            // A - vľavo (wrapped around ±180°)
            gameState.keys['a'] = true;
        }
        else if (degrees >= -157.5 && degrees < -112.5) {
            // WA - hore-vľavo
            gameState.keys['w'] = true;
            gameState.keys['a'] = true;
        }
    }
    
    /**
     * Reset joystick to center
     */
    resetJoystick() {
        this.joystick.active = false;
        this.joystick.touchId = null;
        this.joystick.angle = 0;
        this.joystick.distance = 0;
        
        // Reset stick position
        if (this.joystick.stick) {
            this.joystick.stick.style.transform = 'translate(-50%, -50%)';
        }
        
        // Clear all movement keys
        if (gameState && gameState.keys) {
            gameState.keys['w'] = false;
            gameState.keys['a'] = false;
            gameState.keys['s'] = false;
            gameState.keys['d'] = false;
        }
    }
    
    /**
     * Setup fire button listeners
     */
    setupFireButtonListeners() {
        if (!this.fireButton.button) return;
        
        // Touchstart - začiatok stlačenia
        this.fireButton.button.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleFireButton();
        }, { passive: false });
        
        // Click fallback pre testovanie
        this.fireButton.button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleFireButton();
        });
        
        // Touchend - uvoľnenie
        this.fireButton.button.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, { passive: false });
    }
    
    /**
     * Handle fire button press - DIRECT METHOD
     */
    handleFireButton() {
        // Visual debug - zmena farby buttonu
        if (this.fireButton.button) {
            this.fireButton.button.style.background = 'linear-gradient(135deg, #00ff00 0%, #00aa00 100%)';
            setTimeout(() => {
                this.fireButton.button.style.background = 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)';
            }, 100);
        }
        
        // Kontrola či je hra spustená
        if (!gameState || gameState.currentScreen !== 'game' || gameState.roundOver) {
            console.log('🔫 Fire blocked: game not active');
            return;
        }
        
        // Kontrola či existuje hráč
        if (!gameState.player || !gameState.player.shoot) {
            console.log('🔫 Fire blocked: no player');
            return;
        }
        
        // Kontrola vlastného cooldown
        const currentTime = Date.now();
        if (currentTime - this.fireButton.lastFireTime < 200) {
            console.log('🔫 Fire blocked: button cooldown');
            return;
        }
        
        // PRIAME VOLANIE SHOOT - rovnaké ako Space key
        const now = Date.now();
        if (now - gameState.player.lastShotTime > gameState.player.cooldown) {
            console.log('🔫 FIRING!');
            gameState.player.shoot();
            this.fireButton.lastFireTime = currentTime;
            
            // Visual feedback
            this.showFireCooldown();
            
            // Vibrácia
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
        } else {
            console.log('🔫 Fire blocked: tank cooldown');
        }
    }
    
    /**
     * Show cooldown animation on fire button
     */
    showFireCooldown() {
        if (!this.fireButton.button || !this.fireButton.cooldownIndicator) return;
        
        // Add cooldown class
        this.fireButton.button.classList.add('cooldown');
        
        // Animate cooldown indicator
        this.fireButton.cooldownIndicator.style.height = '100%';
        
        setTimeout(() => {
            this.fireButton.cooldownIndicator.style.height = '0%';
            this.fireButton.button.classList.remove('cooldown');
        }, this.fireButton.cooldownDuration);
    }
    
    /**
     * Setup turret control listeners
     */
    setupTurretControlListeners() {
        if (!this.turretControl.area) return;
        
        this.turretControl.area.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (this.turretControl.active) return;
            
            const touch = e.changedTouches[0];
            this.turretControl.touchId = touch.identifier;
            this.turretControl.active = true;
            
            this.updateTurretAngle(touch.clientX, touch.clientY);
        }, { passive: false });
        
        this.turretControl.area.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (!this.turretControl.active) return;
            
            for (let touch of e.changedTouches) {
                if (touch.identifier === this.turretControl.touchId) {
                    this.updateTurretAngle(touch.clientX, touch.clientY);
                    break;
                }
            }
        }, { passive: false });
        
        this.turretControl.area.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            for (let touch of e.changedTouches) {
                if (touch.identifier === this.turretControl.touchId) {
                    this.turretControl.active = false;
                    this.turretControl.touchId = null;
                    break;
                }
            }
        }, { passive: false });
    }
    
    /**
     * Update turret angle based on touch position
     */
    updateTurretAngle(clientX, clientY) {
        if (!gameState || !gameState.player) return;
        
        // Get canvas for coordinate conversion
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        
        // Convert touch position to canvas coordinates
        const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = (clientY - rect.top) * (canvas.height / rect.height);
        
        // Get player position on canvas (accounting for camera offset)
        const playerCanvasX = gameState.player.x - gameState.camera.x + canvas.width / 2;
        const playerCanvasY = gameState.player.y - gameState.camera.y + canvas.height / 2;
        
        // Calculate angle from player to touch point
        const deltaX = canvasX - playerCanvasX;
        const deltaY = canvasY - playerCanvasY;
        const angleToTouch = Math.atan2(deltaY, deltaX);
        
        // Calculate turret offset (difference between touch angle and player angle)
        const turretOffset = angleToTouch - gameState.player.angle;
        
        // Normalize angle to -PI to PI
        let normalizedOffset = turretOffset;
        while (normalizedOffset > Math.PI) normalizedOffset -= 2 * Math.PI;
        while (normalizedOffset < -Math.PI) normalizedOffset += 2 * Math.PI;
        
        // Update turret angle offset
        gameState.player.turretAngleOffset = normalizedOffset;
    }
    
    /**
     * Setup orientation check
     */
    setupOrientationCheck() {
        // Add class to body when game is active
        if (gameState && gameState.gameStarted) {
            document.body.classList.add('game-active');
        }
        
        // Listen for orientation changes
        window.addEventListener('orientationchange', () => {
            this.checkOrientation();
            // Recalculate maxRadius when orientation changes
            this.joystick.maxRadius = this.calculateMaxRadius();
        });
        
        // Listen for window resize (for different screen sizes)
        window.addEventListener('resize', () => {
            this.joystick.maxRadius = this.calculateMaxRadius();
        });
        
        // Initial check
        this.checkOrientation();
    }
    
    /**
     * Check device orientation
     */
    checkOrientation() {
        if (!this.isMobile) return;
        
        const isPortrait = window.innerHeight > window.innerWidth;
        
        if (isPortrait && gameState && gameState.gameStarted) {
            // Show warning in portrait mode during gameplay
            if (this.orientationWarning) {
                this.orientationWarning.style.display = 'flex';
            }
        } else {
            // Hide warning in landscape mode
            if (this.orientationWarning) {
                this.orientationWarning.style.display = 'none';
            }
        }
    }
    
    /**
     * Prevent default touch behaviors
     */
    preventDefaultTouchBehaviors() {
        // Prevent pull-to-refresh only during gameplay
        document.body.addEventListener('touchmove', (e) => {
            if (this.isActive && gameState && gameState.currentScreen === 'game') {
                e.preventDefault();
            }
        }, { passive: false });
        
        // Prevent double-tap zoom only during gameplay
        document.body.addEventListener('touchend', (e) => {
            if (this.isActive && gameState && gameState.currentScreen === 'game' && e.touches.length === 0) {
                e.preventDefault();
            }
        }, { passive: false });
        
        // Prevent context menu on long press only during gameplay
        document.body.addEventListener('contextmenu', (e) => {
            if (this.isActive && gameState && gameState.currentScreen === 'game') {
                e.preventDefault();
            }
        });
    }
    
    /**
     * Update mobile controls state
     */
    update() {
        if (!this.isActive) return;
        
        // Show/hide controls based on game state
        if (gameState && gameState.currentScreen === 'game' && !gameState.roundOver) {
            // Game is running - show controls
            if (this.mobileControlsContainer) {
                this.mobileControlsContainer.style.display = 'block';
            }
            document.body.classList.add('game-active');
            this.checkOrientation();
        } else {
            // In menu - hide controls
            if (this.mobileControlsContainer) {
                this.mobileControlsContainer.style.display = 'none';
            }
            document.body.classList.remove('game-active');
        }
    }
    
    /**
     * Cleanup mobile controls
     */
    destroy() {
        this.resetJoystick();
        this.isActive = false;
        
        if (this.mobileControlsContainer) {
            this.mobileControlsContainer.style.display = 'none';
        }
    }
}

// Initialize mobile controls when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.mobileControls = new MobileControls();
    });
} else {
    window.mobileControls = new MobileControls();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MobileControls;
}
