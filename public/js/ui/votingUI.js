const votingArea = document.getElementById('voting-area');
const playerListElement = document.getElementById('player-list'); // Needed to get names

export function displayVotingOptions(drawingsData, myPlayerId) {
    if (!votingArea) return;
    votingArea.innerHTML = '<h3>Vote for the best drawing!</h3>'; // Updated title
    const container = document.createElement('div');
    container.className = 'voting-options-container';

    // Get player names from the current list display
    const players = Array.from(playerListElement?.children || []).reduce((acc, li) => {
        if (li.dataset.playerId) {
            const nameScoreText = li.querySelector('span:not(.player-avatar):not(.host-indicator)')?.textContent || '';
            const nameMatch = nameScoreText.match(/^(.*)\s\(\d+\)$/);
            const name = nameMatch ? nameMatch[1] : nameScoreText;
            acc[li.dataset.playerId] = name;
        }
        return acc;
    }, {});

    const drawingEntries = Object.entries(drawingsData);

    if (drawingEntries.length === 0) {
         container.innerHTML = '<p>No drawings were submitted for voting this round.</p>';
    } else {
        drawingEntries.forEach(([playerId, drawingDataUrl]) => {
            const div = document.createElement('div');
            div.className = 'voting-option';

            const name = document.createElement('p');
            name.textContent = players[playerId] || `Player ${playerId.substring(0,4)}`; // Fallback name

            const img = document.createElement('img');
            img.src = drawingDataUrl;
            img.alt = `Drawing by ${name.textContent}`; // Add alt text
            img.onerror = () => { // Handle broken images
                img.alt = `Error loading drawing by ${name.textContent}`;
                img.style.border = '1px dashed red';
            };

            div.appendChild(name);
            div.appendChild(img);

            // Add vote button only if it's not the player's own drawing
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