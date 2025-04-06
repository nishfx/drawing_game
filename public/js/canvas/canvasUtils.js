/* public/js/canvas/canvasUtils.js */
// Utility functions for canvas operations (coordinates, IDs, colors).

import { getCanvas } from './canvasCore.js';
import { getPlayerId } from './canvasCore.js';

// -------------------------------------------------------------------
// ID Helpers
// -------------------------------------------------------------------
export function generateStrokeId() {
    const playerId = getPlayerId() || 'unknown';
    return `${playerId}-stroke-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}
export function generateCommandId() {
    const playerId = getPlayerId() || 'unknown';
    return `${playerId}-cmd-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// -------------------------------------------------------------------
// Coordinate Calculation
// -------------------------------------------------------------------
/**
 * Calculates the canvas-internal coordinates (x, y) from a mouse or touch event.
 * Accounts for canvas scaling and position relative to the viewport.
 * @param {MouseEvent|TouchEvent} e - The event object.
 * @returns {{x: number, y: number}} Canvas coordinates.
 */
export function getEventCoords(e) {
    const canvas = getCanvas();
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect(); // Gets position and size relative to viewport

    let clientX, clientY;
    // Check if it's a touch event
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        // Prevent default touch actions like scrolling when drawing on canvas
        e.preventDefault();
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        // Handle touchend/touchcancel
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        // Assume mouse event
        clientX = e.clientX;
        clientY = e.clientY;
    }

    // Calculate position relative to the canvas element's top-left corner
    const xRel = clientX - rect.left;
    const yRel = clientY - rect.top;

    // Calculate scaling factor between display size and internal resolution
    // rect.width is the CSS display width, canvas.width is the internal drawing width
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Apply scaling to get coordinates within the canvas's internal system
    const canvasX = xRel * scaleX;
    const canvasY = yRel * scaleY;

    // Clamp coordinates to be within the canvas bounds
    const clampedX = Math.max(0, Math.min(canvasX, canvas.width));
    const clampedY = Math.max(0, Math.min(canvasY, canvas.height));

    return { x: clampedX, y: clampedY };
}

// -------------------------------------------------------------------
// Color Helpers (Moved from fillUtil for broader use if needed)
// -------------------------------------------------------------------
/**
 * Converts a hex color string (#RRGGBB or #RGB) to an RGBA array [r, g, b, a].
 * @param {string} hex - The hex color string.
 * @returns {number[]} An array [r, g, b, 255].
 */
export function hexToRgba(hex) {
    if (hex.length === 4) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (hex.length !== 7 || hex[0] !== '#') {
        console.warn(`Invalid hex color format: ${hex}. Defaulting to black.`);
        return [0, 0, 0, 255];
    }
    try {
        const bigint = parseInt(hex.slice(1), 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return [r, g, b, 255];
    } catch (e) {
        console.error(`Error parsing hex color: ${hex}`, e);
        return [0, 0, 0, 255];
    }
}

/**
 * Compares two color arrays [r, g, b, a] within a tolerance.
 * @param {Uint8ClampedArray|number[]} color1
 * @param {Uint8ClampedArray|number[]} color2
 * @param {number} tolerance - Max difference allowed for R, G, B values.
 * @returns {boolean} True if colors are similar within tolerance.
 */
export function colorsMatch(color1, color2, tolerance = 2) { // Default tolerance low
    if (!color1 || !color2) return false;
    const rDiff = Math.abs(color1[0] - color2[0]);
    const gDiff = Math.abs(color1[1] - color2[1]);
    const bDiff = Math.abs(color1[2] - color2[2]);
    // Check alpha difference as well, especially against fully transparent
    const aDiff = Math.abs(color1[3] - color2[3]);
    // If target is transparent, only fill transparent
    if (color2[3] === 0) {
        return aDiff === 0;
    }
    // Otherwise, compare RGB within tolerance and ensure alpha is reasonably similar
    return rDiff <= tolerance && gDiff <= tolerance && bDiff <= tolerance && aDiff <= tolerance;
}