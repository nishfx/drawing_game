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
        item.dataset.lobbyId = lobby.id; // Store lobby ID on the list item

        // Determine if joinable
        const isFull = lobby.playerCount >= lobby.maxPlayers;
        const isInGame = lobby.gamePhase !== 'LOBBY';
        const isJoinable = !isFull && !isInGame;

        let buttonText = 'Join';
        let buttonDisabled = false;
        if (isFull) {
            buttonText = 'Full';
            buttonDisabled = true;
        } else if (isInGame) {
            buttonText = 'In Game';
            buttonDisabled = true;
        }

        item.innerHTML = `
            <div>
                <span class="lobby-name">Lobby ${lobby.id}</span>
                <span class="lobby-host">(Host: ${lobby.hostName || '...'})</span>
            </div>
            <div>
                <span class="lobby-players">${lobby.playerCount}/${lobby.maxPlayers} Players</span>
                <span class="lobby-phase">[${lobby.gamePhase || 'LOBBY'}]</span>
                <button data-lobby-id="${lobby.id}" class="join-lobby-btn" ${buttonDisabled ? 'disabled' : ''}>${buttonText}</button>
            </div>
        `;
        // Add click listener to the button only if it's joinable
        const joinButton = item.querySelector('.join-lobby-btn');
        if (joinButton && isJoinable) {
            joinButton.addEventListener('click', () => joinClickHandler(lobby.id));
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