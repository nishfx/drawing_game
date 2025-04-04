// server/utils.js

// Simple list of distinct colors
const playerColors = [
    "#FF5733", // Orange Red
    "#33FF57", // Lime Green
    "#3357FF", // Strong Blue
    "#FF33A1", // Hot Pink
    "#F1C40F", // Yellow
    "#8E44AD", // Purple
    "#1ABC9C", // Turquoise
    "#E67E22", // Orange
    "#3498DB", // Light Blue
    "#E74C3C", // Red
    "#2ECC71", // Emerald Green
    "#9B59B6", // Amethyst
];
let colorIndex = 0;

export function getRandomColor() {
    // Cycle through colors for better distinction initially
    const color = playerColors[colorIndex % playerColors.length];
    colorIndex++;
    return color;
    // Or truly random: return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
}