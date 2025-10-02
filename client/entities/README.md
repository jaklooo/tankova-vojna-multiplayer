# Client Entities - Herné objekty

Tento priečinok obsahuje herné entity rozdelené do samostatných modulov.

## ✅ Hotové moduly

### Track.js
- Stopy za tankmi
- Automatické vyprchávanie po 5 sekundách
- Opacity efekt podľa veku

### Particle.js
- Častice pre explózie a efekty
- Gravit ácia a spomalenie
- Konfigurovateľná životnosť

### Effects.js
- **ShotEffect**: Muzzle flash pri strieľaní
- **HitEffect**: Iskry pri zásahu
- Časovo obmedzené efekty

## ⏳ TODO - Veľké triedy (ostávajú v script.js)

### Tank.js (515 riadkov)
- Najkomplexnejšia trieda
- Obsahuje AI, fyziku, kolízie
- **Odporúčanie**: Rozdeliť na:
  - `Tank.js` - základná trieda
  - `TankAI.js` - AI logika
  - `TankPhysics.js` - fyzika a pohyb

### Bullet.js (48 riadkov)
- Jednoduchá trieda pre projektily
- Rôzne typy striel (normal, special, snowball)
- **TODO**: Presunúť do samostatného modulu

### Obstacle.js (240 riadkov)
- Rôzne typy prekážok (tree, rock, iglu, oilrig, swamp)
- Health system pre deštruktívne objekty
- **TODO**: Presunúť do samostatného modulu

## 📦 Použitie

Moduly sú načítavané v `index.html` pred `script.js`:

```html
<!-- Entity modules -->
<script src="client/entities/Track.js"></script>
<script src="client/entities/Particle.js"></script>
<script src="client/entities/Effects.js"></script>
<!-- Main script -->
<script src="script.js"></script>
```

## 🔄 Kompatibilita

Všetky moduly sú backwards compatible - používajú globálne objekty ako `ctx`, `gameState`, `images` ktoré sú definované v `script.js`.

## 🚀 Budúce vylepšenia

1. Presunúť Tank, Bullet, Obstacle do modulov
2. Vytvoriť ES6 moduly namiesto globálnych tried  
3. Implementovať dependency injection pre lepšiu testovateltnosť
4. Použiť TypeScript pre type safety
