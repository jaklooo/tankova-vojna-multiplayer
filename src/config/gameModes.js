const GAME_MODES = {
    'all-vs-all': { maxPlayers: 16, minPlayers: 2, teamMode: false, hostCanStart: true },
    'team-vs-team': { maxPlayers: 16, minPlayers: 2, teamMode: true, hostCanStart: true }
};

function getGameModeName(mode) {
    const names = {
        'all-vs-all': 'All vs. All (Každý proti každému)',
        'team-vs-team': 'Team vs. Team (Tímový súboj)'
    };
    return names[mode] || mode;
}

function getGameModeDescription(mode) {
    const descriptions = {
        'all-vs-all': 'Každý proti každému - bez tímov (2-16 hráčov)',
        'team-vs-team': 'Tímový súboj - vytvor si svoj tím (2-16 hráčov)'
    };
    return descriptions[mode] || 'Popis nie je dostupný';
}

module.exports = {
    GAME_MODES,
    getGameModeName,
    getGameModeDescription
};
