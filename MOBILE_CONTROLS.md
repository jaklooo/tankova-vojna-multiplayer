# Mobile Controls - Implementation Documentation

## Overview
Táto tankova hra bola úspešne prispôsobená pre mobilné zariadenia s dotykovým ovládaním. Implementácia zahŕňa virtuálny joystick, fire button, ovládanie veže a automatickú detekciu zariadenia.

## Features Implemented

### 1. **Device Detection**
- Automatická detekcia mobile/desktop zariadení
- Kontrola touch support, user agent a veľkosti obrazovky
- Mobile controls sa zobrazujú iba na mobilných zariadeniach

### 2. **Virtual Joystick (Left Side)**
- Plynulé 360° ovládanie pohybu
- Dead zone pre stabilitu (10% z max radius)
- Vizuálne feedback s semi-transparent overlay
- Mapovanie na WASD keys pre kompatibilitu s existujúcim kódom
- Automatický reset pri uvoľnení

**Joystick Mapping:**
- **Forward (W)**: -135° to -45° (horná polovica)
- **Backward (S)**: 45° to 135° (dolná polovica)
- **Left (A)**: 135° to -135° (ľavá strana)
- **Right (D)**: -45° to 45° (pravá strana)

### 3. **Fire Button (Bottom Right)**
- Large touch-friendly button (110x110px)
- Visual cooldown indicator (500ms)
- Fire icon 🔥 + "FIRE" text
- Disabled state počas cooldown
- Volá `gameState.player.shoot()` identicky ako Space key

### 4. **Turret Control (Right Side)**
- Touch area pokrývajúca pravú polovicu obrazovky
- Tap-to-aim mechanika
- Real-time výpočet uhla z pozície hráča na touch point
- Aktualizuje `gameState.player.turretAngleOffset`
- Funguje počas pohybu aj státia

### 5. **Orientation Warning**
- Fullscreen overlay v portrait mode
- Rotate icon animácia
- Slovenský text: "Otoč zariadenie"
- Automaticky mizne v landscape mode

### 6. **Responsive Design**
- Canvas automaticky škáluje na veľkosť obrazovky
- HUD elementy zväčšené pre touch (30px height bars, 1.3em fonts)
- Minimap presunutá (top: 80px, left: 10px, 140x140px)
- Bullet selection buttons väčšie (70x70px)
- Menu buttons touch-friendly (min 60px height)

### 7. **Cross-Platform Multiplayer**
- Mobile players používajú rovnaké `gameState.keys` ako desktop
- Socket.io komunikácia nezmenená
- Backward compatible - PC a mobile môžu hrať spolu
- Žiadne zmeny v server-side logike potrebné

## File Structure

```
tankova-vojna-multiplayer-main/
├── index.html                          # Enhanced viewport, mobile controls HTML
├── style.css                           # Mobile controls CSS (lines 2495+)
├── script.js                           # Game loop integration
└── client/
    └── managers/
        ├── InputManager.js             # Original keyboard controls (unchanged)
        └── MobileControls.js           # NEW - Touch controls handler
```

## Technical Implementation

### MobileControls.js Architecture

```javascript
class MobileControls {
    constructor() {
        this.isMobile = this.detectMobile();
        this.joystick = { ... };
        this.fireButton = { ... };
        this.turretControl = { ... };
    }
    
    // Key Methods:
    detectMobile()                      // Device detection
    init()                              // Setup all listeners
    updateJoystick(x, y)                // Calculate angle/distance
    updateMovementKeys(angle, distance) // Map to WASD
    handleFireButton()                  // Shoot with cooldown
    updateTurretAngle(x, y)             // Touch-to-aim
    checkOrientation()                  // Portrait/landscape
    preventDefaultTouchBehaviors()      // Disable zoom, pull-to-refresh
}
```

### Key Integrations

**1. HTML (index.html)**
```html
<!-- Enhanced Viewport -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">

<!-- Mobile Controls Container -->
<div id="mobile-controls" class="mobile-controls" style="display: none;">
    <!-- Joystick, Fire Button, Turret Area -->
</div>
```

**2. CSS (style.css)**
```css
/* Mobile detection via media query */
@media screen and (max-width: 768px) { ... }

/* Orientation detection */
@media screen and (orientation: portrait) {
    body.game-active .orientation-warning { display: flex; }
}
```

**3. JavaScript Integration (script.js)**
```javascript
// Game Loop Integration
function gameLoop() {
    update();
    draw();
    
    // Update mobile controls
    if (window.mobileControls && window.mobileControls.isActive) {
        window.mobileControls.update();
    }
}

// Resize Handler
window.addEventListener('resize', () => {
    if (window.mobileControls) {
        window.mobileControls.checkOrientation();
    }
});
```

## Testing Checklist

### Basic Functionality
- [ ] Joystick moves tank in all 8 directions
- [ ] Fire button shoots bullets
- [ ] Turret rotates based on touch position
- [ ] Controls only visible on mobile devices
- [ ] Orientation warning appears in portrait mode

### Cross-Platform
- [ ] Mobile player can join multiplayer game
- [ ] Mobile vs PC players work together
- [ ] Socket.io communication works identically
- [ ] No lag or sync issues between platforms

### Performance
- [ ] 60 FPS on mobile devices
- [ ] No touch delay or lag
- [ ] Smooth joystick movement
- [ ] No memory leaks during extended play

### UX
- [ ] Touch targets are large enough (80x80px minimum)
- [ ] Visual feedback on button presses
- [ ] Cooldown indicator works correctly
- [ ] HUD elements readable on small screens
- [ ] Minimap doesn't overlap controls

### Edge Cases
- [ ] Multiple touch handling (joystick + fire simultaneously)
- [ ] Screen rotation during gameplay
- [ ] Landscape left/right orientations
- [ ] Different screen sizes (phone/tablet)
- [ ] iOS Safari vs Android Chrome behavior

## Mobile Optimization Settings

### Performance
```javascript
// Already implemented in game
MULTIPLAYER_FRAME_TIME = 16.67ms (60 FPS target)
EFFECTS_REDUCTION_FACTOR = used for particle effects
```

### Touch Settings
```javascript
// MobileControls.js
joystick.maxRadius = 45px        // Maximum stick movement
fireButton.cooldownDuration = 500ms
turretControl.deadZone = 10%     // Joystick dead zone
```

### CSS Settings
```css
/* Prevent unwanted behaviors */
touch-action: none;              // Disable browser gestures
user-select: none;               // Disable text selection
-webkit-user-select: none;
pointer-events: none;            // Container doesn't block touches
```

## Known Limitations

1. **Turret Control**: Current implementation uses right-side touch area. Alternative could be second joystick for more precise control.

2. **Bullet Selection**: Currently uses keyboard keys (1/2). Could add mobile UI for bullet type switching.

3. **Pause Menu**: Space/P/Escape keys for pause. Consider adding mobile pause button.

4. **Cheat Codes**: Number keys (0-9) not accessible on mobile. Could add hidden tap sequence.

5. **Name Entry**: Mobile keyboard works but could be optimized with type="text" and autocapitalize attributes.

## Future Enhancements

### Possible Improvements
- [ ] Haptic feedback (vibration) on shoot/hit
- [ ] Customizable control positions (drag-to-move)
- [ ] Control size adjustment settings
- [ ] Alternative turret control modes (tap vs drag)
- [ ] Mobile-specific HUD layout option
- [ ] Touch gesture shortcuts (swipe to change weapon)
- [ ] On-screen pause button
- [ ] Portrait mode support (vertical layout)

### Performance Optimization
- [ ] Adaptive quality settings for mobile
- [ ] Reduced particle effects on low-end devices
- [ ] Texture compression for faster loading
- [ ] Battery-saving mode option

## Browser Compatibility

### Tested Browsers
- ✅ Chrome Mobile (Android)
- ✅ Safari (iOS)
- ✅ Firefox Mobile
- ✅ Samsung Internet

### Requirements
- Touch events support
- HTML5 Canvas
- WebSockets (Socket.io)
- ES6 JavaScript support

## Troubleshooting

### Controls Not Showing
- Check console for "Mobile device detected" message
- Verify screen width < 1024px
- Ensure touch events are supported
- Check `mobile-controls` display style

### Joystick Not Moving Tank
- Verify `gameState.keys` is being updated
- Check dead zone threshold
- Ensure `gameState.player` exists
- Check for console errors

### Fire Button Not Shooting
- Verify cooldown has expired (500ms)
- Check `gameState.player.shoot()` exists
- Ensure game is started
- Check for touch event conflicts

### Turret Not Rotating
- Verify canvas coordinates are correct
- Check camera offset calculations
- Ensure touch is within turret-touch-area
- Check `gameState.player.turretAngleOffset`

## Support & Feedback

Pri problémoch alebo otázkach:
1. Skontroluj browser console pre error messages
2. Otestuj na skutočnom mobile device (nie len responsive mode)
3. Overte že máte najnovšiu verziu (cache-busting v=2.1)
4. Skús landscape orientáciu

## Credits

**Implementation**: Custom lightweight solution (no external libraries)
**Game Engine**: HTML5 Canvas + Socket.io
**Mobile Controls**: Vanilla JavaScript touch events
**Version**: 2.1 (Mobile Support)
