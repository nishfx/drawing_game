const ratingGrid = document.getElementById('rating-grid');
const playerListElement = document.getElementById('player-list'); // To get player names

/**
 * Populates the rating grid with drawings and rate buttons.
 * @param {object} drawings - { playerId: drawingDataUrl, ... }
 * @param {object} ratings - { playerId: { score, explanation, error }, ... } Existing ratings
 * @param {string[]} isRatingInProgress - Array of player IDs currently being rated.
 * @param {boolean} isHost - Whether the current client is the host.
 */
export function displayRatingOptions(drawings, ratings = {}, isRatingInProgress = [], isHost) {
    if (!ratingGrid) {
        console.error("Rating grid element not found!");
        return;
    }
    ratingGrid.innerHTML = ''; // Clear previous items

    // Get player names from the player list UI
    const players = Array.from(playerListElement?.children || []).reduce((acc, li) => {
        if (li.dataset.playerId) {
            const nameScoreText = li.querySelector('span:not(.player-avatar):not(.host-indicator)')?.textContent || '';
            const nameMatch = nameScoreText.match(/^(.*)\s\(\d+\)$/);
            const name = nameMatch ? nameMatch[1] : nameScoreText;
            acc[li.dataset.playerId] = name;
        }
        return acc;
    }, {});

    const drawingEntries = Object.entries(drawings || {});

    if (drawingEntries.length === 0) {
        ratingGrid.innerHTML = '<p>No drawings were submitted this round.</p>';
        return;
    }

    drawingEntries.forEach(([playerId, drawingDataUrl]) => {
        const playerName = players[playerId] || `Player ${playerId.substring(0, 4)}`;
        const existingRating = ratings[playerId];
        const ratingCurrentlyInProgress = isRatingInProgress.includes(playerId);

        const item = document.createElement('div');
        item.className = 'rating-item';
        item.id = `rating-item-${playerId}`; // Add ID for easy targeting

        // Player Name
        const nameEl = document.createElement('div');
        nameEl.className = 'player-name';
        nameEl.textContent = playerName;
        item.appendChild(nameEl);

        // Drawing Image
        if (drawingDataUrl) {
            const img = document.createElement('img');
            img.src = drawingDataUrl;
            img.alt = `Drawing by ${playerName}`;
            img.onerror = () => { img.alt = `Error loading drawing`; img.style.border = '1px dashed red'; };
            item.appendChild(img);
        } else {
            // Should not happen if drawingEntries is used, but as fallback:
            const noDrawing = document.createElement('div');
            noDrawing.className = 'no-drawing';
            noDrawing.textContent = 'Drawing not available';
            item.appendChild(noDrawing);
        }

        // Rate Button (Host only, if not already rated or in progress)
        if (isHost) {
            const rateButton = document.createElement('button');
            rateButton.className = 'rate-btn';
            rateButton.dataset.targetPlayerId = playerId;
            rateButton.disabled = !!existingRating || ratingCurrentlyInProgress; // Disable if rated or rating
            rateButton.textContent = existingRating ? 'Rated' : (ratingCurrentlyInProgress ? 'Rating...' : 'Rate with AI');
            item.appendChild(rateButton);
        }

        // Rating Result Text Area
        const resultBox = document.createElement('textarea');
        resultBox.className = 'rating-result-box';
        resultBox.rows = 2; // Keep it small initially
        resultBox.readOnly = true;
        resultBox.placeholder = isHost ? 'Click "Rate" to get AI score...' : 'Waiting for host to rate...';
        resultBox.id = `rating-result-${playerId}`; // ID for updating
        if (existingRating) {
            updateRatingDisplayContent(resultBox, existingRating); // Populate if already rated
        }
        item.appendChild(resultBox);

        // "Rating in Progress" Overlay
        const overlay = document.createElement('div');
        overlay.className = 'rating-in-progress-overlay';
        overlay.id = `rating-overlay-${playerId}`;
        overlay.textContent = 'Rating...';
        overlay.style.display = ratingCurrentlyInProgress ? 'flex' : 'none'; // Show if rating
        item.appendChild(overlay);


        ratingGrid.appendChild(item);
    });
}

/**
 * Updates the display for a single rating item.
 * @param {string} targetPlayerId - The ID of the player whose rating is updated.
 * @param {object} rating - The rating object { score, explanation, error }
 */
export function updateRatingDisplay(targetPlayerId, rating) {
    const resultBox = document.getElementById(`rating-result-${targetPlayerId}`);
    const rateButton = ratingGrid.querySelector(`button.rate-btn[data-target-player-id="${targetPlayerId}"]`);
    const overlay = document.getElementById(`rating-overlay-${targetPlayerId}`);

    if (resultBox) {
        updateRatingDisplayContent(resultBox, rating);
    } else {
        console.warn(`Could not find result box for player ${targetPlayerId}`);
    }

    if (rateButton) {
        rateButton.disabled = true; // Disable button once rated
        rateButton.textContent = 'Rated';
    }
     if (overlay) {
        overlay.style.display = 'none'; // Hide overlay
    }
}

/**
 * Shows or hides the "Rating in Progress" overlay for a specific item.
 * @param {string} targetPlayerId
 * @param {boolean} show
 */
export function showRatingInProgress(targetPlayerId, show) {
     const overlay = document.getElementById(`rating-overlay-${targetPlayerId}`);
     const rateButton = ratingGrid.querySelector(`button.rate-btn[data-target-player-id="${targetPlayerId}"]`);
     if (overlay) {
         overlay.style.display = show ? 'flex' : 'none';
     }
      if (rateButton) {
         rateButton.disabled = show; // Disable button while rating
         if(show) rateButton.textContent = 'Rating...';
     }
}


// Helper to set text area content and style based on rating
function updateRatingDisplayContent(textareaElement, rating) {
     if (!rating) {
         textareaElement.value = '';
         textareaElement.placeholder = 'Waiting for rating...';
         textareaElement.classList.remove('error');
         return;
     }
    if (rating.error) {
        textareaElement.value = `Score: N/A\nError: ${rating.explanation || 'Unknown AI error'}`;
        textareaElement.classList.add('error');
    } else {
        textareaElement.value = `Score: ${rating.score}/10\n${rating.explanation || ''}`;
        textareaElement.classList.remove('error');
    }
    // Adjust height slightly if needed (optional)
    // textareaElement.style.height = 'auto';
    // textareaElement.style.height = textareaElement.scrollHeight + 'px';
}