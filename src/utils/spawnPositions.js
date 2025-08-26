function generatePlayerSpawnPositions(players, arenaWidth, arenaHeight, obstacles) {
    const positions = {};
    const playerCount = players.length;

    // Define spawn positions based on number of players
    if (playerCount === 2) {
        // 1v1 - opposite corners with better separation
        positions[players[0].id] = {
            x: 200,
            y: arenaHeight - 200,
            tankType: players[0].selectedTank || 'purple',
            character: players[0].selectedCharacter || 'jaccelini'
        };
        positions[players[1].id] = {
            x: arenaWidth - 200,
            y: 200,
            tankType: players[1].selectedTank || 'purple',
            character: players[1].selectedCharacter || 'jaccelini'
        };
    } else if (playerCount === 3) {
        // Free-for-all 3 - triangle formation
        const centerX = arenaWidth / 2;
        const centerY = arenaHeight / 2;
        const radius = Math.min(arenaWidth, arenaHeight) * 0.3;

        for (let i = 0; i < 3; i++) {
            const angle = (i * 2 * Math.PI) / 3;
            positions[players[i].id] = {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
                tankType: players[i].selectedTank || 'purple',
                character: players[i].selectedCharacter || 'jaccelini'
            };
        }
    } else if (playerCount === 4) {
        // 2v2 or free-for-all 4 - four corners
        const margin = 200;
        const spawnPoints = [
            { x: margin, y: margin },
            { x: arenaWidth - margin, y: margin },
            { x: arenaWidth - margin, y: arenaHeight - margin },
            { x: margin, y: arenaHeight - margin }
        ];

        for (let i = 0; i < 4; i++) {
            positions[players[i].id] = {
                x: spawnPoints[i].x,
                y: spawnPoints[i].y,
                tankType: players[i].selectedTank || 'purple',
                character: players[i].selectedCharacter || 'jaccelini'
            };
        }
    } else if (playerCount === 6) {
        // 3v3 or free-for-all 6 - hexagon formation
        const centerX = arenaWidth / 2;
        const centerY = arenaHeight / 2;
        const radius = Math.min(arenaWidth, arenaHeight) * 0.35;

        for (let i = 0; i < 6; i++) {
            const angle = (i * 2 * Math.PI) / 6;
            positions[players[i].id] = {
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
                tankType: players[i].selectedTank || 'purple',
                character: players[i].selectedCharacter || 'jaccelini'
            };
        }
    } else {
        // Unlimited mode or larger groups - circular formation
        const centerX = arenaWidth / 2;
        const centerY = arenaHeight / 2;
        const baseRadius = Math.min(arenaWidth, arenaHeight) * 0.25;

        // For more than 8 players, create multiple rings
        const playersPerRing = Math.min(8, playerCount);
        const numRings = Math.ceil(playerCount / playersPerRing);

        let playerIndex = 0;
        for (let ring = 0; ring < numRings && playerIndex < playerCount; ring++) {
            const ringRadius = baseRadius + (ring * 150); // Each ring 150px further
            const playersInThisRing = Math.min(playersPerRing, playerCount - playerIndex);

            for (let i = 0; i < playersInThisRing; i++) {
                const angle = (i * 2 * Math.PI) / playersInThisRing;
                positions[players[playerIndex].id] = {
                    x: centerX + Math.cos(angle) * ringRadius,
                    y: centerY + Math.sin(angle) * ringRadius,
                    tankType: players[playerIndex].selectedTank || 'purple',
                    character: players[playerIndex].selectedCharacter || 'jaccelini'
                };
                playerIndex++;
            }
        }
    }

    return positions;
}

module.exports = {
    generatePlayerSpawnPositions
};
