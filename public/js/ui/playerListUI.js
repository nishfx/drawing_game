const playerListElement = document.getElementById('player-list');

export function updatePlayerList(players, myPlayerId) {
    if (!playerListElement) {
        console.error("Player list element not found!");
        return;
    }
    playerListElement.innerHTML = ''; // Clear list

    if (!players || players.length === 0) {
        playerListElement.innerHTML = '<li>No players yet.</li>';
        return;
    }

    // Sort players: host first, then alphabetically by name
    players.sort((a, b) => {
        if (a.isHost && !b.isHost) return -1;
        if (!a.isHost && b.isHost) return 1;
        return a.name.localeCompare(b.name);
    });

    players.forEach(player => {
        const item = document.createElement('li');
        item.dataset.playerId = player.id; // Store player ID

        // Avatar (Color Dot)
        const avatar = document.createElement('span');
        avatar.className = 'player-avatar';
        avatar.style.backgroundColor = player.color || '#ccc'; // Use assigned color or default

        // Name and Score
        const nameScore = document.createElement('span');
        const scoreDisplay = ` (${player.score || 0})`; // Always show score structure
        nameScore.textContent = `${player.name}${scoreDisplay}`;

        // Highlight self using style attribute for simplicity here
        if (player.id === myPlayerId) {
            nameScore.style.fontWeight = 'bold';
            nameScore.style.color = '#0056b3'; // Make self name stand out a bit
        }

        item.appendChild(avatar);
        item.appendChild(nameScore);

        // Host Indicator - Use the class defined in style.css
        if (player.isHost) {
            const hostIndicator = document.createElement('span');
            hostIndicator.className = 'host-indicator'; // Use the CSS class
            hostIndicator.textContent = 'HOST';
            item.appendChild(hostIndicator);
        }

        playerListElement.appendChild(item);
    });
}

// Helper function to get player data from the current list (used in lobbyClient)
export function getPlayersFromList() {
    if (!playerListElement) return [];
    return Array.from(playerListElement.children).map(li => {
        const id = li.dataset.playerId;
        if (!id) return null; // Skip if no ID (e.g., "No players yet" message)
        const nameScoreText = li.querySelector('span:not(.player-avatar):not(.host-indicator)')?.textContent || '';
        const nameMatch = nameScoreText.match(/^(.*)\s\(\d+\)$/);
        const name = nameMatch ? nameMatch[1] : nameScoreText; // Extract name before score
        const isHost = li.querySelector('.host-indicator') !== null;
        const color = li.querySelector('.player-avatar')?.style.backgroundColor || '#ccc';
        // Score isn't easily retrievable here without parsing, return 0
        return { id, name, isHost, color, score: 0 };
    }).filter(p => p !== null); // Filter out null entries
}