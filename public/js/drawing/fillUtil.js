// public/js/drawing/fillUtil.js

import { hexToRgba, colorsMatch } from '../canvas/canvasUtils.js'; // Import color utils

/**
 * Gets the color [r, g, b, a] of a specific pixel on the canvas.
 * @param {CanvasRenderingContext2D} ctx - The canvas context.
 * @param {number} x - The x-coordinate.
 * @param {number} y - The y-coordinate.
 * @returns {Uint8ClampedArray|null} An array [r, g, b, a] or null if coords are invalid.
 */
export function getPixelColor(ctx, x, y) {
    if (!ctx || x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height) {
        return null; // Invalid coordinates
    }
    try {
        const intX = Math.floor(x);
        const intY = Math.floor(y);
        const pixelData = ctx.getImageData(intX, intY, 1, 1).data;
        return pixelData;
    } catch (e) {
        console.error("Error getting pixel data (maybe tainted canvas?):", e);
        return null;
    }
}

/**
 * Performs a flood fill operation on the canvas.
 * Uses a non-recursive queue-based approach to avoid stack overflow.
 * @param {CanvasRenderingContext2D} ctx - The canvas context.
 * @param {number} startX - The starting x-coordinate.
 * @param {number} startY - The starting y-coordinate.
 * @param {string} fillColorHex - The hex color string (#RRGGBB) to fill with.
 */
export function floodFill(ctx, startX, startY, fillColorHex) {
    if (!ctx || !fillColorHex) return;

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    startX = Math.round(startX);
    startY = Math.round(startY);

    // 1. Get target color data
    const fillColorRgba = hexToRgba(fillColorHex);

    // 2. Get start color data
    const startColorRgba = getPixelColor(ctx, startX, startY);

    // 3. Check if start color is same as fill color or invalid
    if (!startColorRgba) {
        console.warn("Flood fill: Start coordinates out of bounds or failed to get color.");
        return;
    }
    // Use a small tolerance for this initial check
    if (colorsMatch(startColorRgba, fillColorRgba, 2)) {
        console.log("Flood fill: Start color is already the fill color.");
        return;
    }

    // 4. Get image data for the entire canvas
    let imageData;
    try {
        imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    } catch (e) {
        console.error("Flood fill: Could not get ImageData (tainted canvas?):", e);
        alert("Could not perform fill operation. Canvas might be tainted by external images.");
        return;
    }
    const data = imageData.data;
    const visited = new Uint8Array(canvasWidth * canvasHeight);

    // 5. Initialize queue with start pixel
    const pixelQueue = [[startX, startY]];
    const startIndex = (startY * canvasWidth + startX);
    visited[startIndex] = 1;

    const getIndex = (x, y) => (y * canvasWidth + x) * 4;
    const getVisitedIndex = (x, y) => y * canvasWidth + x;

    let iterations = 0;
    const maxIterations = canvasWidth * canvasHeight * 2; // Safety break

    // *** INCREASED TOLERANCE for neighbor check ***
    const neighborTolerance = 30; // Adjust this value as needed (20-40 often works)

    // 6. Process the queue
    while (pixelQueue.length > 0) {
        iterations++;
        if (iterations > maxIterations) {
            console.error("Flood fill exceeded max iterations. Stopping.");
            break;
        }

        const [x, y] = pixelQueue.shift();

        // Color the current pixel
        const currentIndex = getIndex(x, y);
        data[currentIndex] = fillColorRgba[0];
        data[currentIndex + 1] = fillColorRgba[1];
        data[currentIndex + 2] = fillColorRgba[2];
        data[currentIndex + 3] = fillColorRgba[3];

        // Check neighbors
        const neighbors = [ [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1] ];

        for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < canvasWidth && ny >= 0 && ny < canvasHeight) {
                const visitedIndex = getVisitedIndex(nx, ny);
                if (visited[visitedIndex] === 0) {
                    visited[visitedIndex] = 1;
                    const neighborIndex = getIndex(nx, ny);
                    const neighborColor = [
                        data[neighborIndex],
                        data[neighborIndex + 1],
                        data[neighborIndex + 2],
                        data[neighborIndex + 3]
                    ];
                    // *** Use INCREASED tolerance when checking neighbors ***
                    if (colorsMatch(neighborColor, startColorRgba, neighborTolerance)) {
                        pixelQueue.push([nx, ny]);
                    }
                }
            }
        }
    }

    // 7. Put the modified image data back onto the canvas
    ctx.putImageData(imageData, 0, 0);
    console.log("Flood fill complete.");
}