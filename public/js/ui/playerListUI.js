// public/js/ui/playerListUI.js
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

    // Sort players: host first, then alphabetically
    players.sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0) || a.name.localeCompare(b.name));

    players.forEach(player => {
        const item = document.createElement('li');
        item.dataset.playerId = player.id;

        // Avatar (Color Dot)
        const avatar = document.createElement('span');
        avatar.className = 'player-avatar';
        avatar.style.backgroundColor = player.color || '#ccc'; // Use assigned color or default

        // Name and Score
        const nameScore = document.createElement('span');
        // Display score only if it's not 0 or undefined? Optional.
        const scoreDisplay = (player.score && player.score !== 0) ? ` (${player.score})` : ' (0)'; // Always show score structure
        nameScore.textContent = `${player.name}${scoreDisplay}`; // Show score if available

        if (player.id === myPlayerId) {
            nameScore.style.fontWeight = 'bold'; // Highlight self
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