import * as TimerUI from './ui/timerUI.js';
import * as PlayerListUI from './ui/playerListUI.js';
import * as ChatUI from './ui/chatUI.js';
import * as ResultsUI from './ui/resultsUI.js';
import * as RatingUI from './ui/ratingUI.js'; // Import RatingUI

// --- DOM Elements ---
const gameStatusElement = document.getElementById('game-status');
const wordHintElement = document.getElementById('word-hint');
const readyButton = document.getElementById('ready-button');
const drawingControls = document.getElementById('drawing-controls');
const resultsArea = document.getElementById('results-area');
const resultsTitle = document.getElementById('results-title'); // Title element for results/scoreboard
const evaluationArea = document.getElementById('evaluation-area');
const drawingCanvas = document.getElementById('drawing-canvas');
const manualRatingArea = document.getElementById('manual-rating-area'); // NEW

// --- Export Functions that delegate ---
export const updatePlayerList = PlayerListUI.updatePlayerList;
export const addChatMessage = ChatUI.addChatMessage;
export const startTimer = TimerUI.startTimer;
export const stopTimer = TimerUI.stopTimer;

export function showGamePhaseUI(phase, data = {}) {
    console.log("UIManager: Updating UI for phase:", phase, data);

    // --- Hide all phase-specific sections/elements by default ---
    if (readyButton) readyButton.style.display = 'none';
    ResultsUI.hideResultsArea();
    if (evaluationArea) evaluationArea.style.display = 'none';
    if (manualRatingArea) manualRatingArea.style.display = 'none'; // Hide rating area
    TimerUI.hideTimer();
    if (drawingCanvas) drawingCanvas.style.display = 'none';
    if (drawingControls) drawingControls.style.display = 'none';

    // --- Reset general elements ---
    if (wordHintElement) { wordHintElement.textContent = ''; wordHintElement.classList.remove('is-word'); }
    if (gameStatusElement) gameStatusElement.textContent = '';

    // --- Show elements for the current phase ---
    switch (phase) {
        case 'LOBBY':
            if (gameStatusElement) gameStatusElement.textContent = `Waiting for next round...`;
            if (wordHintElement) wordHintElement.textContent = '--- GAME OVER ---';
            break;

        case 'WAITING':
            if (gameStatusElement) gameStatusElement.textContent = 'Waiting for players...';
             if (wordHintElement) wordHintElement.textContent = '---';
            break;

        case 'DRAWING':
            if (gameStatusElement) gameStatusElement.textContent = `Draw the word! (${data.readyCount || 0}/${data.playerCount || '?'})`;
            if (wordHintElement && data.word) { // Display the single word
                 wordHintElement.textContent = `Your word: ${data.word}`;
                 wordHintElement.classList.add('is-word');
            }
            if (drawingCanvas) drawingCanvas.style.display = 'block';
            if (drawingControls) drawingControls.style.display = 'flex';
            if (readyButton) {
                readyButton.style.display = 'block';
                readyButton.disabled = false;
                readyButton.textContent = "Submit Drawing";
            }
            TimerUI.showTimer();
            break;

        case 'MANUAL_RATING': // NEW Phase UI
             if (gameStatusElement) gameStatusElement.textContent = data.isHost ? 'Rate the drawings below.' : 'Waiting for the host to rate drawings...';
             if (wordHintElement && data.word) wordHintElement.textContent = `Word was: ${data.word}`;
             if (manualRatingArea) manualRatingArea.style.display = 'block';
             // Populate the rating grid
             RatingUI.displayRatingOptions(data.drawings, data.ratings, data.isRatingInProgress, data.isHost);
             TimerUI.showTimer(); // Show timer for rating timeout
             break;

        // Evaluation phase removed, merged into MANUAL_RATING

        case 'RESULTS': // Shows results for the *current* round
            if (gameStatusElement) gameStatusElement.textContent = `Round ${data.currentRound} Results!`;
            if (wordHintElement && data.word) wordHintElement.textContent = `Word was: ${data.word}`;
            if (resultsTitle) resultsTitle.textContent = `Round ${data.currentRound} Results`; // Update title
            if (data.scores && data.drawings && data.ratings) {
                // Use PvP results display, passing ratings instead of evaluations
                ResultsUI.displayPvpResults(data.scores, data.drawings, { [data.word]: data.word }, data.ratings, data.myPlayerId); // Adapt words data if needed
                ResultsUI.showResultsArea();
            } else {
                console.warn("Results phase UI: Missing data.");
                ResultsUI.showResultsArea();
                 const resultsContent = document.getElementById('results-content');
                 if(resultsContent) resultsContent.innerHTML = '<p>Calculating results...</p>';
            }
             TimerUI.showTimer(); // Timer for next round/end
            break;

        case 'FINAL_SCOREBOARD': // NEW Phase UI
             if (gameStatusElement) gameStatusElement.textContent = `Final Results!`;
             if (wordHintElement) wordHintElement.textContent = `--- GAME OVER ---`;
             if (resultsTitle) resultsTitle.textContent = `Final Scoreboard`; // Update title
             if (data.scores) {
                 // Reuse PvP results display logic, but maybe style differently or add winner highlight
                 ResultsUI.displayPvpResults(data.scores, data.drawings || {}, {}, data.ratings || {}, data.myPlayerId, true); // Pass 'true' for final display
                 ResultsUI.showResultsArea();
             } else {
                 console.warn("Final Scoreboard UI: Missing scores.");
                 ResultsUI.showResultsArea();
                 const resultsContent = document.getElementById('results-content');
                 if(resultsContent) resultsContent.innerHTML = '<p>Calculating final scores...</p>';
             }
             TimerUI.showTimer(); // Timer for returning to lobby
             break;


        default:
            if (gameStatusElement) gameStatusElement.textContent = 'Unknown game state';
            if (wordHintElement) wordHintElement.textContent = '---';
    }
}