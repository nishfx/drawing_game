/* public/js/canvas/dataExporter.js */
// Handles exporting canvas content.

import { getCanvas } from './canvasCore.js';

/**
 * Gets the current canvas content as a PNG data URL.
 * @returns {string|null} Base64 encoded PNG data URL or null on error.
 */
export function getDrawingDataURL() {
    const canvas = getCanvas();
    if (!canvas) return null;
    try {
        // Ensure background is white before exporting if needed (redraw does this)
        // redrawCanvasFromHistory(); // Optional: Force redraw if state might be inconsistent
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Error getting canvas data URL:", e);
        // Could be due to tainted canvas if external images were drawn (not applicable here)
        return null;
    }
}