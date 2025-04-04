// public/js/ui/votingUI.js
const votingArea = document.getElementById('voting-area');
const playerListElement = document.getElementById('player-list'); // Needed to get names

export function displayVotingOptions(drawingsData, myPlayerId) {
    if (!votingArea) return;
    votingArea.innerHTML = '<h3>Vote!</h3>';
    const container = document.createElement('div');
    container.className = 'voting-options-container';

    // Get player names from the current list display
    const players = Array.from(playerListElement?.children || []).reduce((acc, li) => {
        if (li.dataset.playerId) { acc[li.dataset.playerId] = li.textContent.split(' (')[0]; }
        return acc;
    }, {});

    if (Object.keys(drawingsData).length === 0) {
         container.innerHTML = '<p>No drawings were submitted for voting.</p>';
    } else {
        Object.entries(drawingsData).forEach(([playerId, drawingDataUrl]) => {
            const div = document.createElement('div');
            div.className = 'voting-option';
            const name = document.createElement('p');
            name.textContent = players[playerId] || `Player ${playerId.substring(0,4)}`;
            const img = document.createElement('img');
            img.src = drawingDataUrl;
            img.alt = `Drawing by ${name.textContent}`; // Add alt text
            div.appendChild(name);
            div.appendChild(img);
            if (playerId !== myPlayerId) {
                const voteButton = document.createElement('button');
                voteButton.textContent = 'Vote';
                voteButton.dataset.voteFor = playerId;
                voteButton.className = 'vote-button';
                div.appendChild(voteButton);
            } else {
                const ownDrawingText = document.createElement('p');
                ownDrawingText.textContent = "(Your Drawing)";
                ownDrawingText.className = 'own-drawing-text'; // Add class for styling
                div.appendChild(ownDrawingText);
            }
            container.appendChild(div);
        });
    }
    votingArea.appendChild(container);
}

 export function showVotingArea() {
    if(votingArea) votingArea.style.display = 'block';
 }

 export function hideVotingArea() {
    if(votingArea) votingArea.style.display = 'none';
 }

 export function disableVotingButtons() {
     if(votingArea) {
         votingArea.querySelectorAll('button.vote-button').forEach(button => button.disabled = true);
     }
 }
  export function enableVotingButtons() {
     if(votingArea) {
         votingArea.querySelectorAll('button.vote-button').forEach(button => button.disabled = false);
     }
 }