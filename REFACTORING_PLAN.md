# 🎮 Plán refaktorizácie a optimalizácie - PK TANKY

## 📊 Súčasný stav kódu

### Štatistiky
- **script.js**: ~7545 riadkov
- **server.js**: ~1316 riadkov
- **index.html**: ~902 riadkov
- **Počet funkcií**: 100+
- **Počet tried**: 6 (AudioManager, Tank, Bullet, Obstacle, Track, Particle, ShotEffect, HitEffect)

### Hlavné problémy identifikované

#### 🔴 KRITICKÉ PROBLÉMY

1. **Monolitický script.js**
   - Jeden súbor s 7500+ riadkami kódu
   - Nízka čitateľnosť a údržba
   - Ťažko sa hľadajú chyby
   - Všetky funkcie v globálnom scope

2. **Duplicitné funkcie**
   - `createPlayerItem` - definovaná 2x (riadok 1394 a 1420)
   - `selectLobbyCharacter` - definovaná 2x (riadok 1469 a 1636)
   - `selectLobbyTank` - definovaná 2x (riadok 1525 a 1662)
   - `getCharacterName` - definovaná 2x (riadok 769 a 1739)
   - `getTankName` - definovaná 2x (riadok 780 a 1744)

3. **Globálne premenné**
   - 50+ globálnych premenných
   - Ťažko sledovať závislosti
   - Riziko konfliktov a vedľajších efektov

4. **Absence modularity**
   - Všetok kód v jednom súbore
   - Zmiešaná logika (UI, herná mechanika, networking, AI)

#### 🟡 VÝKONNOSTNÉ PROBLÉMY

1. **Neoptimalizované vykresľovanie**
   - Vykreslenie všetkých objektov každý frame
   - Chýba viewport culling pre niektoré objekty
   - Neefektívne aktualizácie canvas

2. **AI výpočty**
   - Komplexná AI pathfinding každý frame
   - 8 rôznych funkcií na generovanie waypoints
   - Žiadne cache pre AI rozhodnutia

3. **Networking**
   - Synchronizácia každých 70ms môže byť stále príliš častá
   - Posielanie celých objektov namiesto deltaov
   - Chýba interpolácia pre plynulé pohyby

#### 🟢 ARCHITEKTÚRNE PROBLÉMY

1. **Zmiešané zodpovednosti**
   - UI logika s hernou logikou
   - Rendering s business logikou
   - Networking s game state

2. **Slabá separácia klient/server**
   - Server obsahuje príliš veľa logiky
   - Klient robí rozhodnutia, ktoré by mal robiť server

3. **Chýbajúce designové vzory**
   - Žiadny State pattern pre herné stavy
   - Žiadny Observer pattern pre eventy
   - Žiadny Factory pattern pre vytváranie objektov

---

## 🎯 PLÁN REFAKTORIZÁCIE (FÁZA 1 - ZÁKLADNÁ ŠTRUKTÚRA)

### 1. Rozdelenie script.js do modulov

```
src/
├── client/
│   ├── core/
│   │   ├── Game.js              // Hlavná herná trieda
│   │   ├── GameLoop.js          // RequestAnimationFrame loop
│   │   └── StateManager.js      // Správa herných stavov
│   │
│   ├── entities/
│   │   ├── Tank.js              // Tank trieda (už existuje)
│   │   ├── Bullet.js            // Bullet trieda (už existuje)
│   │   ├── Obstacle.js          // Obstacle trieda (už existuje)
│   │   ├── Particle.js          // Particle a Track (už existujú)
│   │   └── Effects.js           // ShotEffect, HitEffect
│   │
│   ├── systems/
│   │   ├── AISystem.js          // Celá AI logika
│   │   ├── CollisionSystem.js   // Detekcia kolízií
│   │   ├── PhysicsSystem.js     // Fyzika pohybu
│   │   ├── RenderSystem.js      // Vykresľovanie
│   │   └── InputSystem.js       // Spracovanie vstupov
│   │
│   ├── ui/
│   │   ├── UIManager.js         // Hlavný UI manažér
│   │   ├── MenuUI.js            // Menu screens
│   │   ├── LobbyUI.js           // Lobby interface
│   │   ├── GameUI.js            // In-game HUD, minimap
│   │   └── CharacterSelection.js // Character/Tank/Map selection
│   │
│   ├── networking/
│   │   ├── NetworkClient.js     // Socket.io wrapper
│   │   ├── NetworkSync.js       // Synchronizácia stavu
│   │   └── NetworkInterpolation.js // Interpolácia pohybov
│   │
│   ├── audio/
│   │   └── AudioManager.js      // Už existuje, presunúť
│   │
│   └── utils/
│       ├── AssetLoader.js       // Načítavanie obrázkov/zvukov
│       ├── MathUtils.js         // Matematické funkcie
│       ├── Constants.js         // Všetky konštanty
│       └── Helpers.js           // Helper funkcie
│
├── server/
│   ├── core/
│   │   └── GameServer.js        // Hlavný server objekt
│   │
│   ├── systems/
│   │   ├── RoomManager.js       // Správa miestností
│   │   ├── GameLogic.js         // Server-side game logic
│   │   └── ValidationSystem.js  // Validácia akcií
│   │
│   └── networking/
│       └── SocketHandlers.js    // Socket event handlers
│
└── shared/
    ├── Constants.js             // Konštanty zdieľané medzi klientom/serverom
    ├── GameModes.js             // Už existuje v src/config/
    └── Validators.js            // Validačné funkcie
```

### 2. Odstránenie duplicít

#### Krok 1: Identifikácia a zjednotenie duplicitných funkcií
```javascript
// Zlúčiť do jednej verzie každej funkcie:
- selectLobbyCharacter (2 verzie)
- selectLobbyTank (2 verzie)
- createPlayerItem (2 verzie)
- getCharacterName (2 verzie)
- getTankName (2 verzie)
```

### 3. Refaktorizácia globálnych premenných

#### Vytvoriť GameState objekt:
```javascript
class GameState {
    constructor() {
        this.multiplayer = {
            socket: null,
            isActive: false,
            currentRoom: null,
            otherPlayers: [],
            isHost: false,
            tanks: new Map()
        };
        
        this.lobby = {
            selectedMap: null,
            selectedCharacter: null,
            selectedTank: null,
            playerName: '',
            gameMode: 'all-vs-all',
            playerTeam: null,
            allPlayers: [],
            readyPlayers: new Set()
        };
        
        this.game = {
            player: null,
            enemies: [],
            obstacles: [],
            bullets: [],
            particles: [],
            tracks: [],
            effects: [],
            camera: { x: 0, y: 0 },
            isPaused: false
        };
    }
}
```

---

## 🚀 PLÁN OPTIMALIZÁCIE (FÁZA 2 - VÝKON)

### 1. Optimalizácia vykresľovania

#### A. Implementovať object pooling
```javascript
class ObjectPool {
    constructor(factory, initialSize = 50) {
        this.factory = factory;
        this.available = [];
        this.inUse = [];
        
        // Pre-alokuj objekty
        for (let i = 0; i < initialSize; i++) {
            this.available.push(factory());
        }
    }
    
    acquire() {
        if (this.available.length === 0) {
            return this.factory();
        }
        const obj = this.available.pop();
        this.inUse.push(obj);
        return obj;
    }
    
    release(obj) {
        const index = this.inUse.indexOf(obj);
        if (index > -1) {
            this.inUse.splice(index, 1);
            obj.reset();
            this.available.push(obj);
        }
    }
}

// Použitie:
const bulletPool = new ObjectPool(() => new Bullet(), 100);
const particlePool = new ObjectPool(() => new Particle(), 200);
```

#### B. Vylepšiť viewport culling
```javascript
class RenderSystem {
    shouldRender(object, viewport) {
        // Rozšírený viewport s marginom
        const margin = VIEWPORT_CULLING_MARGIN;
        return object.x + object.width >= viewport.x - margin &&
               object.x <= viewport.x + viewport.width + margin &&
               object.y + object.height >= viewport.y - margin &&
               object.y <= viewport.y + viewport.height + margin;
    }
    
    render(objects, viewport) {
        const visibleObjects = objects.filter(obj => 
            this.shouldRender(obj, viewport)
        );
        
        // Renderuj len viditeľné objekty
        visibleObjects.forEach(obj => obj.draw());
    }
}
```

#### C. Batch rendering pre podobné objekty
```javascript
class BatchRenderer {
    drawObstacles(obstacles) {
        // Zoskup podľa typu textúry
        const byTexture = this.groupByTexture(obstacles);
        
        for (let [texture, group] of byTexture) {
            ctx.save();
            // Naraz nastav textúru
            // Vykresli všetky objekty s touto textúrou
            group.forEach(obs => this.drawSingle(obs));
            ctx.restore();
        }
    }
}
```

### 2. Optimalizácia AI

#### A. Cache AI rozhodnutia
```javascript
class AICache {
    constructor(ttl = 500) { // 500ms cache
        this.cache = new Map();
        this.ttl = ttl;
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.value;
    }
    
    set(key, value) {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }
}

// V AI systéme:
const aiCache = new AICache(500);

function enemyAI(tank, targets) {
    const cacheKey = `${tank.id}_${targets.map(t => t.id).join(',')}`;
    let decision = aiCache.get(cacheKey);
    
    if (!decision) {
        decision = computeAIDecision(tank, targets);
        aiCache.set(cacheKey, decision);
    }
    
    applyAIDecision(tank, decision);
}
```

#### B. Rozložiť AI výpočty v čase
```javascript
class AIScheduler {
    constructor() {
        this.tanks = [];
        this.currentIndex = 0;
        this.tanksPerFrame = 2; // Aktualizuj len 2 tanky za frame
    }
    
    update() {
        const count = Math.min(this.tanksPerFrame, this.tanks.length);
        
        for (let i = 0; i < count; i++) {
            const tank = this.tanks[this.currentIndex];
            if (tank.isAlive) {
                updateAI(tank);
            }
            
            this.currentIndex = (this.currentIndex + 1) % this.tanks.length;
        }
    }
}
```

### 3. Optimalizácia networkingu

#### A. Delta compression
```javascript
class NetworkSync {
    lastSentState = {};
    
    sendUpdate(currentState) {
        const delta = this.computeDelta(this.lastSentState, currentState);
        
        if (Object.keys(delta).length > 0) {
            socket.emit('player-update', delta);
            this.lastSentState = currentState;
        }
    }
    
    computeDelta(oldState, newState) {
        const delta = {};
        
        for (let key in newState) {
            if (newState[key] !== oldState[key]) {
                delta[key] = newState[key];
            }
        }
        
        return delta;
    }
}
```

#### B. Interpolácia pohybov
```javascript
class NetworkInterpolation {
    constructor() {
        this.snapshots = new Map(); // tankId -> [snapshot1, snapshot2, ...]
        this.renderDelay = 100; // 100ms delay pre plynulosť
    }
    
    addSnapshot(tankId, snapshot) {
        if (!this.snapshots.has(tankId)) {
            this.snapshots.set(tankId, []);
        }
        
        const snapshots = this.snapshots.get(tankId);
        snapshots.push({ ...snapshot, timestamp: Date.now() });
        
        // Drž len posledné 3 snapshots
        if (snapshots.length > 3) {
            snapshots.shift();
        }
    }
    
    interpolate(tankId, currentTime) {
        const snapshots = this.snapshots.get(tankId);
        if (!snapshots || snapshots.length < 2) return null;
        
        const renderTime = currentTime - this.renderDelay;
        
        // Nájdi 2 snapshots medzi ktorými interpolovať
        let before = null;
        let after = null;
        
        for (let i = 0; i < snapshots.length - 1; i++) {
            if (snapshots[i].timestamp <= renderTime && 
                snapshots[i + 1].timestamp >= renderTime) {
                before = snapshots[i];
                after = snapshots[i + 1];
                break;
            }
        }
        
        if (!before || !after) return snapshots[snapshots.length - 1];
        
        const t = (renderTime - before.timestamp) / 
                  (after.timestamp - before.timestamp);
        
        return {
            x: lerp(before.x, after.x, t),
            y: lerp(before.y, after.y, t),
            angle: lerpAngle(before.angle, after.angle, t),
            cannonAngle: lerpAngle(before.cannonAngle, after.cannonAngle, t)
        };
    }
}
```

---

## 🏗️ ARCHITEKTÚRNE VYLEPŠENIA (FÁZA 3)

### 1. State Pattern pre herné stavy

```javascript
class GameStateManager {
    constructor() {
        this.states = {
            menu: new MenuState(),
            lobby: new LobbyState(),
            playing: new PlayingState(),
            paused: new PausedState(),
            gameOver: new GameOverState()
        };
        this.currentState = this.states.menu;
    }
    
    changeState(stateName) {
        this.currentState.exit();
        this.currentState = this.states[stateName];
        this.currentState.enter();
    }
    
    update(deltaTime) {
        this.currentState.update(deltaTime);
    }
    
    render() {
        this.currentState.render();
    }
}

class GameState {
    enter() { /* Inicializácia stavu */ }
    exit() { /* Cleanup */ }
    update(deltaTime) { /* Aktualizácia logiky */ }
    render() { /* Vykresľovanie */ }
}
```

### 2. Event System

```javascript
class EventBus {
    constructor() {
        this.listeners = new Map();
    }
    
    on(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);
    }
    
    off(eventName, callback) {
        if (!this.listeners.has(eventName)) return;
        const callbacks = this.listeners.get(eventName);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }
    
    emit(eventName, data) {
        if (!this.listeners.has(eventName)) return;
        this.listeners.get(eventName).forEach(callback => {
            callback(data);
        });
    }
}

// Použitie:
eventBus.on('player-hit', (data) => {
    console.log(`Hráč ${data.playerId} bol zasiahnutý!`);
    audioManager.play('hitme');
});

eventBus.emit('player-hit', { playerId: 'player1' });
```

### 3. Entity Component System (ECS) - pokročilé

```javascript
class Entity {
    constructor(id) {
        this.id = id;
        this.components = new Map();
    }
    
    addComponent(component) {
        this.components.set(component.constructor.name, component);
        return this;
    }
    
    getComponent(componentClass) {
        return this.components.get(componentClass.name);
    }
    
    hasComponent(componentClass) {
        return this.components.has(componentClass.name);
    }
}

// Komponenty
class PositionComponent {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}

class VelocityComponent {
    constructor(vx, vy) {
        this.vx = vx;
        this.vy = vy;
    }
}

class RenderComponent {
    constructor(sprite) {
        this.sprite = sprite;
    }
}

// Systémy
class MovementSystem {
    update(entities, deltaTime) {
        entities.forEach(entity => {
            if (entity.hasComponent(PositionComponent) && 
                entity.hasComponent(VelocityComponent)) {
                const pos = entity.getComponent(PositionComponent);
                const vel = entity.getComponent(VelocityComponent);
                
                pos.x += vel.vx * deltaTime;
                pos.y += vel.vy * deltaTime;
            }
        });
    }
}
```

---

## 📋 PRIORITIZÁCIA A ČASOVÝ PLÁN

### FÁZA 1 (1-2 týždne): Základná refaktorizácia
- [x] Vytvorenie štruktúry priečinkov
- [ ] Odstránenie duplicitných funkcií
- [ ] Rozdelenie script.js na moduly (postupne)
  - [ ] Presun tried (Tank, Bullet, atď.) do entities/
  - [ ] Presun AI do systems/AISystem.js
  - [ ] Presun UI funkcií do ui/
  - [ ] Presun networking do networking/
- [ ] Vytvorenie GameState objektu
- [ ] Základné testovanie po každom kroku

### FÁZA 2 (1 týždeň): Výkonnostné optimalizácie
- [ ] Implementácia object poolingu
- [ ] Vylepšenie viewport cullingu
- [ ] AI cache a scheduling
- [ ] Delta compression pre networking
- [ ] Interpolácia pohybov

### FÁZA 3 (1 týždeň): Architektúrne vylepšenia
- [ ] State Pattern pre herné stavy
- [ ] Event Bus systém
- [ ] Factory Pattern pre vytváranie objektov
- [ ] Dokumentácia nového kódu

### FÁZA 4 (priebežne): Testovanie a ladenie
- [ ] Unit testy pre kritické funkcie
- [ ] Testovanie výkonu
- [ ] Testovanie multiplayeru
- [ ] Hľadanie memory leaks

---

## 🎯 OČAKÁVANÉ VÝSLEDKY

### Čitateľnosť a údržba
- ✅ Jasná štruktúra súborov
- ✅ Každý modul má jednu zodpovednosť
- ✅ Ľahšie pridávanie nových funkcií
- ✅ Jednoduchšie hľadanie a oprava chýb

### Výkon
- ⚡ 20-30% zlepšenie FPS (object pooling, culling)
- ⚡ 40-50% redukcia AI výpočtov (cache, scheduling)
- ⚡ 30-40% redukcia network traffic (delta compression)
- ⚡ Plynulejšie pohyby (interpolácia)

### Rozšíriteľnosť
- 🔧 Ľahké pridávanie nových typov tankov
- 🔧 Jednoduché pridávanie nových herných módov
- 🔧 Modulárny systém efektov a schopností
- 🔧 Flexibilný event systém

---

## ⚠️ RIZIKÁ A POZNÁMKY

### Rizíká
1. **Breaking changes** - refaktorizácia môže dočasne zlomiť funkcie
2. **Časová náročnosť** - 3-4 týždne práce
3. **Nutnosť dôkladného testovania** - každá zmena musí byť testovaná

### Odporúčania
1. **Postupnosť** - refaktorovať po častiach, nie všetko naraz
2. **Git branches** - používať feature branches pre každú zmenu
3. **Testovanie** - testovať po každej väčšej zmene
4. **Backup** - mať zálohu pôvodného kódu
5. **Dokumentácia** - dokumentovať nový kód priebežne

### Zachovanie funkcií
- ✅ Všetky herné featury ostanú zachované
- ✅ Žiadne vizuálne zmeny pre používateľov
- ✅ Spätná kompatibilita s existujúcimi save states
- ✅ Multiplayer bude fungovať rovnako (alebo lepšie)

---

## 🚀 ZAČÍNAME?

Navrhujem začať s **FÁZOU 1** a postupne rozdeliť script.js. Začneme s najjednoduchšími krokmi:

1. Vytvorenie štruktúry priečinkov
2. Odstránenie duplicitných funkcií
3. Presun AudioManager do samostatného súboru
4. Presun tried (Tank, Bullet, atď.) do entities/

Chceš začať refaktorizáciu? Môžem začať s prvými krokmi.
