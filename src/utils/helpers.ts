export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);

  if (maxLen === 0) return 1;

  const dp: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    const row: number[] = [];
    for (let j = 0; j <= len2; j++) {
      row[j] = 0;
    }
    dp[i] = row;
  }

  for (let i = 0; i <= len1; i++) {
    const row = dp[i];
    if (row) row[0] = i;
  }
  for (let j = 0; j <= len2; j++) {
    const row = dp[0];
    if (row) row[j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const currentRow = dp[i];
      const prevRow = dp[i - 1];
      if (!currentRow || !prevRow) continue;

      const char1 = str1[i - 1];
      const char2 = str2[j - 1];
      if (!char1 || !char2) continue;

      if (char1 === char2) {
        currentRow[j] = prevRow[j - 1] ?? 0;
      } else {
        currentRow[j] = Math.min(
          (prevRow[j] ?? 0) + 1,
          (currentRow[j - 1] ?? 0) + 1,
          (prevRow[j - 1] ?? 0) + 1
        );
      }
    }
  }

  const distance = dp[len1]?.[len2] ?? maxLen;
  return 1 - distance / maxLen;
}

export function extractContextByPosition(fullText: string, startIndex: number, textLength: number, contextLength: number): { before: string; after: string } {
  const before = fullText.substring(Math.max(0, startIndex - contextLength), startIndex);
  const after = fullText.substring(startIndex + textLength, startIndex + textLength + contextLength);

  return { before, after };
}

export function calculateRangeOffsetInElement(
  range: Range,
  element: HTMLElement
): { start: number; end: number } | null {
  let start = 0;
  let end = 0;
  let foundStart = false;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const nodeLength = textNode.textContent?.length || 0;

    if (!foundStart) {
      if (textNode === range.startContainer) {
        start += range.startOffset;
        foundStart = true;

        if (range.endContainer === textNode) {
          end = start + (range.endOffset - range.startOffset);
          return { start, end };
        }
      } else if (textNode === range.endContainer) {
        end = start + range.endOffset;
        return { start: 0, end };
      } else {
        start += nodeLength;
      }
    } else {
      if (textNode === range.endContainer) {
        end = start + range.endOffset;
        return { start, end };
      } else {
        start += nodeLength;
      }
    }

    node = walker.nextNode();
  }

  return null;
}
