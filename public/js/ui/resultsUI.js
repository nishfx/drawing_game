// public/js/ui/resultsUI.js
const resultsArea = document.getElementById('results-area');

export function displayResults(scores, drawings) {
    if (!resultsArea) return;
    resultsArea.innerHTML = '<h3>Results</h3>';
    const scoreList = document.createElement('ul');
    scoreList.className = 'results-list'; // Add class

    if (!scores || scores.length === 0) {
        scoreList.innerHTML = '<li>No scores to display.</li>';
    } else {
        scores.sort((a, b) => (b.score || 0) - (a.score || 0));
        scores.forEach(playerScore => {
            const item = document.createElement('li');
            item.className = 'results-item'; // Add class
            item.innerHTML = `
                <span class="player-name">${playerScore.name}:</span>
                <span class="player-score">${playerScore.score || 0} points</span>
                <span class="player-votes">(+${playerScore.receivedVotes || 0} votes)</span>
            `;
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