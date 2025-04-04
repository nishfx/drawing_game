// public/js/ui/lobbyListUI.js
const lobbyListUl = document.getElementById('lobby-list');
const lobbyListSection = document.getElementById('lobby-list-section'); // Container

export function updateLobbyList(lobbies, joinClickHandler) {
    if (!lobbyListUl) return;
    lobbyListUl.innerHTML = ''; // Clear previous list

    if (!lobbies || lobbies.length === 0) {
        lobbyListUl.innerHTML = '<li>No available lobbies. Try creating one!</li>';
        return;
    }

    lobbies.forEach(lobby => {
        const item = document.createElement('li');
        item.innerHTML = `
            <div>
                <span class="lobby-name">Lobby ${lobby.id}</span>
                <span class="lobby-host">(Host: ${lobby.hostName || '...'})</span>
            </div>
            <div>
                <span class="lobby-players">${lobby.playerCount}/${lobby.maxPlayers} Players</span>
                <span class="lobby-phase">[${lobby.gamePhase || 'LOBBY'}]</span>
                <button data-lobby-id="${lobby.id}" class="join-lobby-btn">Join</button>
            </div>
        `;
        // Add click listener to the button
        const joinButton = item.querySelector('.join-lobby-btn');
        if (joinButton) {
            // Disable button if lobby is full or in game?
            if (lobby.playerCount >= lobby.maxPlayers || lobby.gamePhase !== 'LOBBY') {
                 joinButton.disabled = true;
                 joinButton.textContent = (lobby.playerCount >= lobby.maxPlayers) ? 'Full' : 'In Game';
            } else {
                joinButton.addEventListener('click', () => joinClickHandler(lobby.id));
            }
        }
        lobbyListUl.appendChild(item);
    });
}

export function showLoading() {
     if (!lobbyListUl) return;
     lobbyListUl.innerHTML = '<li>Loading lobbies...</li>';
}

export function showError(message) {
     if (!lobbyListUl) return;
     lobbyListUl.innerHTML = `<li style="color: red;">Error: ${message}</li>`;
}