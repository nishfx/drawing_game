const resultsArea = document.getElementById('results-area');
const resultsContent = document.getElementById('results-content');

// --- Updated Function for Artist PvP Results & Final Scoreboard ---
/**
 * Displays results for PvP mode (round or final).
 * @param {Array} scores - Sorted array of player scores { id, name, score }.
 * @param {object} drawings - { playerId: drawingDataUrl, ... }
 * @param {object} words - { playerId: word, ... } (May be empty for final scoreboard)
 * @param {object} ratings - { playerId: { score, explanation, error }, ... } (May be empty for final scoreboard)
 * @param {string} myPlayerId - ID of the current player.
 * @param {boolean} isFinal - If true, display as final scoreboard.
 */
export function displayPvpResults(scores, drawings = {}, words = {}, ratings = {}, myPlayerId, isFinal = false) {
    if (!resultsContent) {
        console.error("Results content area not found!");
        return;
    }
    resultsContent.innerHTML = ''; // Clear previous results

    if (!scores || scores.length === 0) {
        resultsContent.innerHTML = '<p>No results to display.</p>';
        return;
    }

    // scores should already be sorted by the server
    const winnerScore = scores[0]?.score || 0; // Score of the top player

    const resultsContainer = document.createElement('div');
    resultsContainer.className = 'pvp-results-container';
    if (isFinal) {
        resultsContainer.classList.add('final-scoreboard'); // Add class for potential styling differences
    }

    scores.forEach((playerScore, index) => {
        const playerId = playerScore.id;
        const drawingUrl = drawings[playerId];
        // Use the single word if available (relevant for round results)
        const word = Object.values(words)[0] || null; // Get the single word if words object isn't empty
        const rating = ratings[playerId]; // Rating might be undefined for final scoreboard

        const resultItem = document.createElement('div');
        resultItem.className = 'pvp-result-item';
        if (playerId === myPlayerId) resultItem.classList.add('my-result');
        // Highlight winner(s) on final scoreboard
        if (isFinal && playerScore.score === winnerScore && winnerScore > 0) {
             resultItem.classList.add('winner');
             // Add a crown or similar indicator
             const winnerIndicator = document.createElement('span');
             winnerIndicator.textContent = '🏆';
             winnerIndicator.className = 'winner-indicator';
             resultItem.appendChild(winnerIndicator); // Add to top corner maybe? Style with CSS.
        }


        // Player Info (Rank, Name, Overall Score)
        const playerInfo = document.createElement('div');
        playerInfo.className = 'pvp-player-info';
        playerInfo.innerHTML = `
            <span class="player-rank">#${index + 1}</span>
            <span class="player-name">${playerScore.name}</span>
            <span class="player-total-score">${playerScore.score || 0} pts</span>
        `;
        resultItem.appendChild(playerInfo);

        // Drawing Thumbnail (Show even on final scoreboard)
        if (drawingUrl) {
            const img = document.createElement('img');
            img.src = drawingUrl;
            img.alt = `Drawing by ${playerScore.name}`;
            img.className = 'pvp-drawing-thumbnail';
            resultItem.appendChild(img);
        } else if (!isFinal) { // Only show "no drawing" for round results
             const noDrawing = document.createElement('div');
             noDrawing.className = 'pvp-no-drawing';
             noDrawing.textContent = 'No drawing submitted';
             resultItem.appendChild(noDrawing);
        }

        // Word and AI Evaluation (Show only for round results, not final)
        if (!isFinal) {
            const evalInfo = document.createElement('div');
            evalInfo.className = 'pvp-evaluation-info';
            let ratingContent = 'N/A';
            let explanationContent = 'No rating available.';
            let isError = true;

            if (rating) {
                isError = rating.error;
                ratingContent = rating.error ? 'N/A' : `${rating.score}/10`;
                explanationContent = rating.explanation || (rating.error ? 'AI Error' : 'No explanation.');
            }

            evalInfo.innerHTML = `
                <p class="pvp-word">Word: <strong>${word || 'N/A'}</strong></p>
                <p class="pvp-ai-score ${isError ? 'error' : ''}">
                    AI Score: ${ratingContent}
                </p>
                <p class="pvp-ai-explanation ${isError ? 'error' : ''}">
                    <em>${explanationContent}</em>
                </p>
            `;
             if (isError) evalInfo.classList.add('error');
            resultItem.appendChild(evalInfo);
        }

        resultsContainer.appendChild(resultItem);
    });

    resultsContent.appendChild(resultsContainer);
}


 export function showResultsArea() {
    if(resultsArea) resultsArea.style.display = 'block';
 }

 export function hideResultsArea() {
    if(resultsArea) {
        resultsArea.style.display = 'none';
        if (resultsContent) resultsContent.innerHTML = '';
    }
 }