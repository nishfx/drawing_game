const resultsArea = document.getElementById('results-area');

export function displayResults(scores, drawings) {
    if (!resultsArea) return;
    resultsArea.innerHTML = '<h3>Round Results</h3>'; // Changed title slightly
    const scoreList = document.createElement('ul');
    scoreList.className = 'results-list'; // Add class

    if (!scores || scores.length === 0) {
        scoreList.innerHTML = '<li>No scores to display.</li>';
    } else {
        // Sort by score descending
        scores.sort((a, b) => (b.score || 0) - (a.score || 0));

        scores.forEach(playerScore => {
            const item = document.createElement('li');
            item.className = 'results-item'; // Add class

            // Player Name and Total Score
            const nameScoreSpan = document.createElement('span');
            nameScoreSpan.innerHTML = `<span class="player-name">${playerScore.name}:</span> <span class="player-score">${playerScore.score || 0} pts</span>`;

            // Votes Received This Round
            const votesSpan = document.createElement('span');
            votesSpan.className = 'player-votes';
            votesSpan.textContent = `(+${playerScore.receivedVotes || 0} votes)`;

            item.appendChild(nameScoreSpan);
            item.appendChild(votesSpan);

            // Drawing Thumbnail
            if (drawings && drawings[playerScore.id]) {
                const img = document.createElement('img');
                img.src = drawings[playerScore.id];
                img.alt = `Drawing by ${playerScore.name}`;
                img.className = 'results-thumbnail'; // Add class
                item.appendChild(img);
            }
            scoreList.appendChild(item);
        });
    }
    resultsArea.appendChild(scoreList);
}

 export function showResultsArea() {
    if(resultsArea) resultsArea.style.display = 'block';
 }

 export function hideResultsArea() {
    if(resultsArea) resultsArea.style.display = 'none';
 }