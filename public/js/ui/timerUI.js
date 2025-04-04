// public/js/ui/timerUI.js
const timerContainer = document.getElementById('timer-container');
const timerBar = document.getElementById('timer-bar');
const timerText = document.getElementById('timer-text');

let timerInterval = null;
let timerEndTime = 0;
let timerDuration = 0;

export function startTimer(durationSeconds) {
    if (!timerContainer || !timerBar || !timerText) { console.warn("Timer elements not found."); return; }
    stopTimer();
    timerDuration = durationSeconds * 1000;
    if (timerDuration <= 0 || isNaN(timerDuration)) { console.warn(`Invalid timer duration.`); return; }
    timerEndTime = Date.now() + timerDuration;
    timerContainer.style.display = 'block';
    updateTimerDisplay(); // Initial display
    timerInterval = setInterval(updateTimerDisplay, 100);
}

export function stopTimer() {
    if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

export function hideTimer() {
     if (timerContainer) timerContainer.style.display = 'none';
     stopTimer(); // Ensure interval is stopped when hidden
}

 export function showTimer() {
     if (timerContainer) timerContainer.style.display = 'block';
     // Note: Doesn't restart timer, just makes container visible
}


function updateTimerDisplay() {
    if (!timerBar || !timerText) { stopTimer(); return; }
    const now = Date.now();
    const timeRemaining = Math.max(0, timerEndTime - now);
    const percentageRemaining = timerDuration > 0 ? Math.max(0, (timeRemaining / timerDuration) * 100) : 0;
    const secondsRemaining = Math.ceil(timeRemaining / 1000);

    try {
        timerBar.style.width = `${percentageRemaining}%`;
        timerText.textContent = `${secondsRemaining}s`;
        if (percentageRemaining < 25) { timerBar.style.backgroundColor = '#f44336'; }
        else if (percentageRemaining < 50) { timerBar.style.backgroundColor = '#ff9800'; }
        else { timerBar.style.backgroundColor = '#4caf50'; }
    } catch (error) { console.error("Error updating timer display:", error); stopTimer(); return; }

    if (timeRemaining <= 0 && timerInterval !== null) { stopTimer(); }
}