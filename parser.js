/**
 * parser.js
 * Extracts menu items and prices from Tesseract.js OCR results.
 * Works entirely client-side.
 */

class MenuParser {
    constructor() {
        // Regex patterns for detecting prices
        this.pricePatterns = [
            // 1. Korean Won with comma and optional '원': e.g., 12,000원, 7,500
            /\b\d{1,3},\d{3}\s*원?\b/,
            // 2. Korean Won without comma but with '원': e.g., 12000원, 7500원
            /\b\d{3,6}\s*원\b/,
            // 3. Decimal prices (cafe-style, e.g., 12.0, 6.5, 5.0)
            /\b\d{1,2}\.\d\b/,
            // 4. Dollar prices: e.g., $12.00, $5.99, $15
            /\$\s*\d+(?:\.\d{2})?\b/,
            // 5. Standard integer prices that look like Korean Won (e.g., 12000, 7500, 150000)
            // Typically 4 to 6 digits, or 3 digits if it's high enough or in context (we check 1000 to 999999 and 300 to 999)
            /\b(?:[1-9]\d{3,5}|[3-9]\d{2})\b/
        ];
    }

    /**
     * Parse raw Tesseract OCR output (structured result)
     * @param {Object} ocrResult - Tesseract.js recognition result (result.data)
     * @returns {Array} List of { name: string, price: string, originalPrice: number, confidence: number }
     */
    parse(ocrResult) {
        if (!ocrResult || !ocrResult.lines) {
            return [];
        }

        const parsedItems = [];
        const unmatchedNames = [];
        const unmatchedPrices = [];

        // 1. Process line by line first (Tesseract usually groups horizontally aligned text into a line)
        ocrResult.lines.forEach(line => {
            const text = line.text.trim();
            if (!text || text.length < 2) return;

            // Try to extract price and name from the same line
            const matchInfo = this.extractPriceFromText(text);

            if (matchInfo) {
                // If we found a price, the rest of the text on this line is likely the menu item name
                let name = matchInfo.remainingText;
                
                // Clean up the name (remove dots, dashes, special characters, stray numbers)
                name = this.cleanItemName(name);

                if (name && name.length >= 2) {
                    parsedItems.push({
                        name: name,
                        price: matchInfo.formattedPrice,
                        rawPrice: matchInfo.rawPrice,
                        confidence: Math.round(line.confidence),
                        bbox: line.bbox
                    });
                    return; // Successfully parsed this line
                }
            }

            // If no match, check if this line is purely a price or purely text
            const cleanText = text.replace(/[\s\.\-\~·]+/g, '');
            const isPurePrice = this.isLinePurePrice(cleanText);

            if (isPurePrice) {
                const priceInfo = this.parsePriceValue(cleanText);
                if (priceInfo) {
                    unmatchedPrices.push({
                        text: text,
                        price: priceInfo.formattedPrice,
                        rawPrice: priceInfo.rawPrice,
                        bbox: line.bbox,
                        confidence: line.confidence
                    });
                }
            } else {
                // It's likely a menu item name on its own (if it contains Korean/English characters and is not noise)
                if (this.isValidNameCandidate(text)) {
                    unmatchedNames.push({
                        text: this.cleanItemName(text),
                        bbox: line.bbox,
                        confidence: line.confidence
                    });
                }
            }
        });

        // 2. Spatial Clustering: Align unmatched names with unmatched prices
        // Since menus often have items on the left and prices on the right, they might be read as separate lines,
        // but they will share similar vertical (y-axis) coordinates.
        const pairedFromSpatial = [];
        
        unmatchedNames.forEach(nameObj => {
            const nameY = (nameObj.bbox.y0 + nameObj.bbox.y1) / 2;
            const nameHeight = nameObj.bbox.y1 - nameObj.bbox.y0;
            
            // Find the best matching price on the same horizontal line
            let bestPriceObj = null;
            let minDistanceY = Infinity;
            // Tolerance: Allow vertical difference up to 1.2 times the line height
            const toleranceY = nameHeight * 1.2;

            unmatchedPrices.forEach(priceObj => {
                const priceY = (priceObj.bbox.y0 + priceObj.bbox.y1) / 2;
                const diffY = Math.abs(nameY - priceY);

                if (diffY < toleranceY && diffY < minDistanceY) {
                    // Also check if the price is horizontally to the right of the name (typical menu layout)
                    // or nearby. In most cases, price is to the right: nameObj.bbox.x0 < priceObj.bbox.x0
                    // We allow some flexibility but prefer price to the right or close.
                    minDistanceY = diffY;
                    bestPriceObj = priceObj;
                }
            });

            if (bestPriceObj) {
                pairedFromSpatial.push({
                    name: nameObj.text,
                    price: bestPriceObj.price,
                    rawPrice: bestPriceObj.rawPrice,
                    confidence: Math.round((nameObj.confidence + bestPriceObj.confidence) / 2),
                    bbox: {
                        x0: Math.min(nameObj.bbox.x0, bestPriceObj.bbox.x0),
                        y0: Math.min(nameObj.bbox.y0, bestPriceObj.bbox.y0),
                        x1: Math.max(nameObj.bbox.x1, bestPriceObj.bbox.x1),
                        y1: Math.max(nameObj.bbox.y1, bestPriceObj.bbox.y1)
                    }
                });

                // Remove this price from unmatched list so it's not reused
                const idx = unmatchedPrices.indexOf(bestPriceObj);
                if (idx > -1) {
                    unmatchedPrices.splice(idx, 1);
                }
            }
        });

        // Combine direct matches and paired matches
        const allItems = [...parsedItems, ...pairedFromSpatial];

        // Deduplicate or sort by vertical position (y0) to match visual reading order (top to bottom)
        allItems.sort((a, b) => a.bbox.y0 - b.bbox.y0);

        return allItems;
    }

    /**
     * Checks if a text line contains a price and extracts it.
     */
    extractPriceFromText(text) {
        let bestMatch = null;
        let matchedPatternIndex = -1;

        // Search through patterns
        for (let i = 0; i < this.pricePatterns.length; i++) {
            const pattern = this.pricePatterns[i];
            const match = text.match(pattern);
            if (match) {
                // Prefer matches that are longer or occur at the end of the line
                // Usually, the price is at the end of the string
                const matchedStr = match[0];
                const index = match.index;
                
                if (!bestMatch || index > bestMatch.index) {
                    bestMatch = {
                        matchedStr: matchedStr,
                        index: index,
                        length: matchedStr.length
                    };
                    matchedPatternIndex = i;
                }
            }
        }

        if (bestMatch) {
            const rawText = bestMatch.matchedStr;
            const priceInfo = this.parsePriceValue(rawText);
            
            if (priceInfo) {
                // The remaining text before or after the price is the item name
                let remainingText = '';
                if (bestMatch.index > 2) {
                    // Extract text before price
                    remainingText = text.substring(0, bestMatch.index);
                } else {
                    // Extract text after price
                    remainingText = text.substring(bestMatch.index + bestMatch.length);
                }

                return {
                    remainingText: remainingText,
                    formattedPrice: priceInfo.formattedPrice,
                    rawPrice: priceInfo.rawPrice
                };
            }
        }

        return null;
    }

    /**
     * Clean up raw text to isolate the menu item name
     */
    cleanItemName(name) {
        if (!name) return '';
        
        return name
            // Remove leading/trailing punctuation and spaces
            .replace(/^[\s\.\-\~\:\·\+\=\*\_\|\/]+|[\s\.\-\~\:\·\+\=\*\_\|\/]+$/g, '')
            // Remove dots and lines connecting name to price (e.g. "김치찌개..........")
            .replace(/\.{2,}/g, '')
            .replace(/\-{2,}/g, '')
            .replace(/\_{2,}/g, '')
            .replace(/·{2,}/g, '')
            // Remove common OCR artifacts (e.g. lone characters like "i", "l", "o" at the end)
            .replace(/\s+[a-zA-Z]$/g, '')
            .trim();
    }

    /**
     * Checks if a line is likely just a price
     */
    isLinePurePrice(text) {
        // e.g. "12,000", "7,500원", "15.0", "$8.99", "5000"
        const clean = text.trim().replace(/[\,\.]/g, '');
        
        // If it starts with currency or ends with '원'
        if (text.startsWith('$') || text.endsWith('원')) {
            return true;
        }
        
        // If it's just numbers
        if (/^\d+$/.test(clean)) {
            const val = parseInt(clean, 10);
            // Ignore small numbers (which might be menu numbers like "01", "02")
            return val >= 100 && val <= 999999;
        }

        // Cafe decimal format: e.g. "5.0", "12.5"
        if (/^\d{1,2}\.\d$/.test(text)) {
            return true;
        }

        return false;
    }

    /**
     * Parse a price string into a standard format and numerical value
     */
    parsePriceValue(priceStr) {
        // Remove spaces
        let cleanStr = priceStr.trim().replace(/\s+/g, '');

        let numericValue = 0;
        let formatted = '';

        // Check for USD / Dollar
        if (cleanStr.includes('$') || /^\d+\.\d{2}$/.test(cleanStr)) {
            const val = parseFloat(cleanStr.replace(/[^0-9\.]/g, ''));
            if (!isNaN(val)) {
                numericValue = val;
                formatted = `$${val.toFixed(2)}`;
                return { rawPrice: numericValue, formattedPrice: formatted };
            }
        }

        // Check for Cafe-style decimal (e.g., 5.0, 12.5) -> typically translates to thousands (5,000, 12,500)
        // If we are in a Korean environment (which is typical for this request)
        if (/^\d{1,2}\.\d$/.test(cleanStr)) {
            const val = parseFloat(cleanStr);
            if (!isNaN(val)) {
                // If it's less than 100, multiply by 1000 to get KRW
                numericValue = val * 1000;
                formatted = `${numericValue.toLocaleString()}원`;
                return { rawPrice: numericValue, formattedPrice: formatted };
            }
        }

        // Standard integer / KRW price
        const numbersOnly = cleanStr.replace(/[^0-9]/g, '');
        const val = parseInt(numbersOnly, 10);
        
        if (!isNaN(val)) {
            numericValue = val;
            
            // Heuristic: If price is like 5.0 but OCR read it as "50" or "500" or something,
            // we should make sure it fits a reasonable range. But generally, we just format it as Won.
            formatted = `${numericValue.toLocaleString()}원`;
            return { rawPrice: numericValue, formattedPrice: formatted };
        }

        return null;
    }

    /**
     * Determines if a text block is a valid menu item name (not just noise)
     */
    isValidNameCandidate(text) {
        if (!text) return false;
        const clean = text.trim();
        if (clean.length < 2) return false;

        // Must contain at least some Korean or English characters (not just symbols or numbers)
        const hasLetters = /[a-zA-Zㄱ-ㅎㅏ-ㅣ가-힣]/.test(clean);
        
        // Filter out lines that are just symbols
        const isSymbols = /^[^a-zA-Z0-9ㄱ-ㅎㅏ-ㅣ가-힣]+$/.test(clean);

        // Filter out standard page headers, footers or common menu noise if we can
        const lowercase = clean.toLowerCase();
        const noiseWords = ['menu', '메뉴판', '메뉴', 'bill', 'receipt', '주문서', 'table', '테이블'];
        const isNoise = noiseWords.some(word => lowercase.includes(word)) && clean.length < 5;

        return hasLetters && !isSymbols && !isNoise;
    }
}
