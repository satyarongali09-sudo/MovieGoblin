// ─────────────────────────────────────────────────────────────────────────────
// MOVIEGOBLIN - Retro Collector Score Card Showcase Image Generator
// Generates the authentic 1080x1080 Retro Starfield Duo Card Showcase (Image 2)
// Featuring both Side A (Front Rank Badge) and Side B (Back Specification Ledger with Poster)
// ─────────────────────────────────────────────────────────────────────────────

import type { RevealedAnswer } from "./client";
import { findLocalPoster } from "./local-search";

export interface CardImageOptions {
  breakdown: {
    baseScore: number;
    efficiencyBonus: number;
    noCaseFileBonus: number;
    noClueBonus: number;
    total: number;
    rank: string;
    rankTitle: string;
    guessCount: number;
    cluesUsed: number;
    usedCaseFile?: boolean;
  };
  answer?: RevealedAnswer;
  dateLabel: string;
  flipped?: boolean;
  solved: boolean;
}

// Pseudo-random deterministic number generator seeded by string
function pseudoRandom(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

// Safely loads poster image without tainting the canvas
async function getSafePosterImage(url?: string): Promise<CanvasImageSource | null> {
  if (!url || typeof window === "undefined") return null;

  // 1. Try DOM element if already present and complete
  if (typeof document !== "undefined") {
    const domImg = document.querySelector(".mg-sc-portrait-img") as HTMLImageElement | null;
    if (domImg && domImg.complete && domImg.naturalWidth > 0) {
      try {
        // Test if domImg is clean by drawing to a 1x1 test canvas
        const testCanvas = document.createElement("canvas");
        testCanvas.width = 1;
        testCanvas.height = 1;
        const testCtx = testCanvas.getContext("2d");
        if (testCtx) {
          testCtx.drawImage(domImg, 0, 0, 1, 1);
          testCanvas.toDataURL(); // Throws if tainted
          return domImg;
        }
      } catch {
        // tainted, fall through to fetch blob
      }
    }
  }

  // 2. Try fetching as blob to create safe same-origin ObjectURL
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = blobUrl;
      });
      return img;
    }
  } catch {
    // CORS fetch failed, fall through to Image crossOrigin
  }

  // 3. Fallback standard Image crossOrigin loader
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 2500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
  }
  ctx.closePath();
}

/**
 * Draws the Starfield Cosmic Retro CRT Background
 */
function drawCosmicStarfield(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string) {
  // Deep black void
  ctx.fillStyle = "#020202";
  ctx.fillRect(0, 0, w, h);

  const rand = pseudoRandom(seed || "moviegoblin");

  // Scatter ~140 pixel stars
  for (let i = 0; i < 140; i++) {
    const sx = Math.floor(rand() * w);
    const sy = Math.floor(rand() * h);
    const alpha = 0.35 + rand() * 0.6;
    const size = rand() > 0.85 ? 3 : rand() > 0.5 ? 2 : 1;

    ctx.fillStyle = rand() > 0.8 ? `rgba(255, 230, 200, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(sx, sy, size, size);

    // Cross twinkle on rare stars
    if (rand() > 0.94) {
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.75})`;
      ctx.fillRect(sx - 3, sy + 1, 7, 1);
      ctx.fillRect(sx + 1, sy - 3, 1, 7);
    }
  }
}

/**
 * Generates the 1080x1080 Retro Starfield Duo Showcase (Matching Image 2)
 */
export async function generateCollectorShowcaseBlob(opts: CardImageOptions): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Canvas generation requires browser environment");
  }

  // Ensure fonts are ready
  if (typeof document !== "undefined" && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }

  // Resolve poster URL
  const posterUrl =
    opts.answer?.poster_url ||
    (opts.answer ? findLocalPoster(opts.answer.title, opts.answer.year) : undefined);
  const posterImg = await getSafePosterImage(posterUrl);

  const canvas = document.createElement("canvas");
  const W = 1080;
  const H = 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  const { breakdown, answer, dateLabel, solved } = opts;
  const INK = "#000000";
  const ORANGE = "#FF5500";
  const PIXEL_FONT = '"Press Start 2P", monospace, system-ui';
  const SANS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // ── 1. Cosmic Pixel Starfield Background ──
  drawCosmicStarfield(ctx, W, H, `${answer?.title ?? "movie"}-${dateLabel}`);

  // ── 2. Top Card: Side A (Front Rank Badge) ──
  const cardW = 860;
  const topCardH = 360;
  const cardX = (W - cardW) / 2; // 110px
  const topCardY = 70;

  // Solid black drop shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, cardX + 6, topCardY + 6, cardW, topCardH, 16);
  ctx.fill();

  // Card surface gradient
  const topGrad = ctx.createLinearGradient(cardX, topCardY, cardX + cardW, topCardY + topCardH);
  topGrad.addColorStop(0, "#FFF6ED");
  topGrad.addColorStop(0.45, "#FCD7B7");
  topGrad.addColorStop(1, "#EBB48A");
  ctx.fillStyle = topGrad;
  drawRoundedRect(ctx, cardX, topCardY, cardW, topCardH, 16);
  ctx.fill();

  // Border
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, cardX, topCardY, cardW, topCardH, 16);
  ctx.stroke();

  // Top Card Header
  ctx.fillStyle = INK;
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN · COLLECTOR ID", cardX + 28, topCardY + 36);

  ctx.textAlign = "right";
  ctx.fillText(dateLabel, cardX + cardW - 28, topCardY + 36);

  // Top Dashed Divider
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cardX + 26, topCardY + 54);
  ctx.lineTo(cardX + cardW - 26, topCardY + 54);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center Hero Wordmark
  const topCenterY = topCardY + 185;

  // Line 1: RANK <X>® (Chunky Orange Pixel with Black 3D Extrusion)
  const rankText = `RANK ${breakdown.rank}®`;
  ctx.font = `bold 48px ${PIXEL_FONT}`;
  ctx.textAlign = "center";

  // Black 3D Shadow
  ctx.fillStyle = INK;
  ctx.fillText(rankText, cardX + cardW / 2 + 5, topCenterY - 22 + 5);
  // Orange Fill
  ctx.fillStyle = ORANGE;
  ctx.fillText(rankText, cardX + cardW / 2, topCenterY - 22);
  // Black Stroke
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.strokeText(rankText, cardX + cardW / 2, topCenterY - 22);

  // Line 2: <TOTAL> PTS (Crisp White Pixel with Black 3D Shadow)
  const ptsText = `${breakdown.total} PTS`;
  ctx.font = `bold 38px ${PIXEL_FONT}`;

  // Black 3D Shadow
  ctx.fillStyle = INK;
  ctx.fillText(ptsText, cardX + cardW / 2 + 4, topCenterY + 40 + 4);
  // White Fill
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(ptsText, cardX + cardW / 2, topCenterY + 40);
  // Black Stroke
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.strokeText(ptsText, cardX + cardW / 2, topCenterY + 40);

  // Bottom Dashed Divider
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cardX + 26, topCardY + topCardH - 58);
  ctx.lineTo(cardX + cardW - 26, topCardY + topCardH - 58);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bottom Card Meta
  ctx.fillStyle = INK;
  ctx.font = `italic 900 17px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), cardX + 28, topCardY + topCardH - 24);

  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.guessCount} GUESSES`, cardX + cardW - 28, topCardY + topCardH - 24);

  // ── 3. Bottom Card: Side B (Back Specification Ledger with Poster) ──
  const botCardH = 550;
  const botCardY = 465;

  // Solid black drop shadow
  ctx.fillStyle = INK;
  drawRoundedRect(ctx, cardX + 6, botCardY + 6, cardW, botCardH, 16);
  ctx.fill();

  // Card surface gradient
  const botGrad = ctx.createLinearGradient(cardX, botCardY, cardX + cardW, botCardY + botCardH);
  botGrad.addColorStop(0, "#FFF6ED");
  botGrad.addColorStop(0.45, "#FCD7B7");
  botGrad.addColorStop(1, "#EBB48A");
  ctx.fillStyle = botGrad;
  drawRoundedRect(ctx, cardX, botCardY, cardW, botCardH, 16);
  ctx.fill();

  // Outer Border
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, cardX, botCardY, cardW, botCardH, 16);
  ctx.stroke();

  // Inner Framed Box
  const framePad = 12;
  const frameX = cardX + framePad;
  const frameY = botCardY + framePad;
  const frameW = cardW - framePad * 2; // 836px
  const frameH = botCardH - framePad * 2; // 526px

  ctx.fillStyle = "rgba(255, 248, 240, 0.88)";
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 10);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 10);
  ctx.stroke();

  // Clip content inside inner frame
  ctx.save();
  drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 10);
  ctx.clip();

  // Frame layout: Top section (Portrait + Ledger) & Bottom Tagline bar
  const taglineH = 54;
  const topH = frameH - taglineH;
  const portraitW = 290;
  const ledgerW = frameW - portraitW;

  // Left Portrait Box
  ctx.fillStyle = "#0B0B0B";
  ctx.fillRect(frameX, frameY, portraitW, topH);

  if (posterImg) {
    const pW = (posterImg as HTMLImageElement).naturalWidth || (posterImg as HTMLCanvasElement).width || 300;
    const pH = (posterImg as HTMLImageElement).naturalHeight || (posterImg as HTMLCanvasElement).height || 450;
    const imgAspect = pW / pH;
    const boxAspect = portraitW / topH;
    let sW, sH, sX, sY;

    if (imgAspect > boxAspect) {
      sH = pH;
      sW = sH * boxAspect;
      sX = (pW - sW) / 2;
      sY = 0;
    } else {
      sW = pW;
      sH = sW / boxAspect;
      sX = 0;
      sY = (pH - sH) / 2;
    }
    try {
      ctx.drawImage(posterImg, sX, sY, sW, sH, frameX, frameY, portraitW, topH);
    } catch {
      // fallback
    }
  }

  // Portrait bottom pill badge: RANK <X>
  const pillW = 124;
  const pillH = 30;
  const pillX = frameX + (portraitW - pillW) / 2;
  const pillY = frameY + topH - 42;

  ctx.fillStyle = "rgba(11, 11, 11, 0.95)";
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ORANGE;
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 6);
  ctx.stroke();

  ctx.fillStyle = ORANGE;
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`RANK ${breakdown.rank}`, pillX + pillW / 2, pillY + 19);

  // Vertical divider between portrait and ledger
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX + portraitW, frameY);
  ctx.lineTo(frameX + portraitW, frameY + topH);
  ctx.stroke();

  // Right Specification Ledger
  const ledgerX = frameX + portraitW;
  const rowH = Math.round(topH / 5.8);

  // Row 1: MOVIEGOBLIN ®
  ctx.fillStyle = "rgba(11, 11, 11, 0.05)";
  ctx.fillRect(ledgerX, frameY, ledgerW, rowH);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(ledgerX, frameY + rowH);
  ctx.lineTo(ledgerX + ledgerW, frameY + rowH);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `bold 15px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("MOVIEGOBLIN ®", ledgerX + 16, frameY + rowH / 2 + 5);

  // Row 2: APEX ORACLE
  const r2Y = frameY + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r2Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r2Y + rowH);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `italic 900 15px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(breakdown.rankTitle.toUpperCase(), ledgerX + 16, r2Y + rowH / 2 + 5);

  // Row 3: Base Solve +500
  const r3Y = r2Y + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r3Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r3Y + rowH);
  ctx.stroke();

  ctx.font = `italic 700 16px ${SANS_FONT}`;
  ctx.fillText("Base Solve", ledgerX + 16, r3Y + rowH / 2 + 6);
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.baseScore}`, ledgerX + ledgerW - 16, r3Y + rowH / 2 + 5);

  // Row 4: Efficiency (1g) +500
  const r4Y = r3Y + rowH;
  ctx.beginPath();
  ctx.moveTo(ledgerX, r4Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r4Y + rowH);
  ctx.stroke();

  ctx.font = `italic 700 16px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(`Efficiency (${breakdown.guessCount}g)`, ledgerX + 16, r4Y + rowH / 2 + 6);
  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.efficiencyBonus}`, ledgerX + ledgerW - 16, r4Y + rowH / 2 + 5);

  // Row 5: 🔒 Case File +300 ★ (SOLID BLACK BAR WITH ORANGE TEXT WHEN BONUS!)
  const r5Y = r4Y + rowH;
  const isCaseBonus = breakdown.noCaseFileBonus > 0;

  if (isCaseBonus) {
    ctx.fillStyle = INK;
    ctx.fillRect(ledgerX, r5Y, ledgerW, rowH);
  }
  ctx.beginPath();
  ctx.moveTo(ledgerX, r5Y + rowH);
  ctx.lineTo(ledgerX + ledgerW, r5Y + rowH);
  ctx.stroke();

  ctx.fillStyle = isCaseBonus ? ORANGE : INK;
  ctx.font = `italic 700 16px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("🔒 Case File", ledgerX + 16, r5Y + rowH / 2 + 6);

  ctx.font = `bold 12px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  const caseVal = isCaseBonus ? `+${breakdown.noCaseFileBonus} ★` : solved ? "+0 (Open)" : "+0";
  ctx.fillText(caseVal, ledgerX + ledgerW - 16, r5Y + rowH / 2 + 5);

  // Row 6: Split Bottom (Left: No-Clue + Total; Right: Circular Guess Badge)
  const splitY = r5Y + rowH;
  const stampBoxW = 92;
  const splitLeftW = ledgerW - stampBoxW;
  const splitH = topH - (splitY - frameY);
  const halfSplitH = Math.round(splitH / 2);

  // Vertical border separating circular guess badge
  ctx.beginPath();
  ctx.moveTo(ledgerX + splitLeftW, splitY);
  ctx.lineTo(ledgerX + splitLeftW, frameY + topH);
  ctx.stroke();

  // Sub-row A: No-Clue Bonus
  ctx.fillStyle = INK;
  ctx.font = `italic 700 15px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("No-Clue Bonus", ledgerX + 16, splitY + halfSplitH / 2 + 5);
  ctx.font = `bold 11px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`+${breakdown.noClueBonus}`, ledgerX + splitLeftW - 14, splitY + halfSplitH / 2 + 4);

  // Divider between sub-row A and sub-row B
  ctx.beginPath();
  ctx.moveTo(ledgerX, splitY + halfSplitH);
  ctx.lineTo(ledgerX + splitLeftW, splitY + halfSplitH);
  ctx.stroke();

  // Sub-row B: Total Score (Bold)
  ctx.font = `italic 900 16px ${SANS_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("Total Score", ledgerX + 16, splitY + halfSplitH + halfSplitH / 2 + 5);
  ctx.font = `bold 13px ${PIXEL_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${breakdown.total} PTS`, ledgerX + splitLeftW - 14, splitY + halfSplitH + halfSplitH / 2 + 4);

  // Circular Guess Stamp Badge
  const stampCX = ledgerX + splitLeftW + stampBoxW / 2;
  const stampCY = splitY + splitH / 2;
  const sRadius = 26;

  ctx.fillStyle = "rgba(255, 248, 240, 1)";
  ctx.beginPath();
  ctx.arc(stampCX, stampCY, sRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(stampCX, stampCY, sRadius - 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `bold 14px ${PIXEL_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(String(breakdown.guessCount).padStart(2, "0"), stampCX, stampCY + 5);

  // ── Bottom Full-Width Tagline Bar ──
  const tagY = frameY + topH;
  ctx.fillStyle = "rgba(253, 227, 207, 0.7)";
  ctx.fillRect(frameX, tagY, frameW, taglineH);

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(frameX, tagY);
  ctx.lineTo(frameX + frameW, tagY);
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = `italic 700 14px ${SANS_FONT}`;
  ctx.textAlign = "center";
  const tagline = solved
    ? `Solved in ${breakdown.guessCount} ${breakdown.guessCount === 1 ? "guess" : "guesses"} with sharp cinema instinct!`
    : "Signal lost today — come back tomorrow for a new film!";
  ctx.fillText(`“${tagline}”`, frameX + frameW / 2, tagY + taglineH / 2 + 5);

  ctx.restore();

  // Convert to Blob
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export canvas to PNG blob"));
    }, "image/png");
  });
}

/**
 * Downloads a card Blob as a PNG file.
 */
export function downloadCardImage(blob: Blob, filename = "MovieGoblin-Card.png") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Copies the card PNG image directly to system clipboard.
 */
export async function copyCardImageToClipboard(opts: CardImageOptions): Promise<boolean> {
  try {
    const blob = await generateCollectorShowcaseBlob(opts);
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      downloadCardImage(blob, `MovieGoblin-${opts.dateLabel}-Showcase.png`);
      return false;
    }
    const item = new ClipboardItem({ "image/png": blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch (err) {
    console.warn("Clipboard image write failed:", err);
    return false;
  }
}

/**
 * Opens Native OS Share Sheet with the 1080x1080 Retro Starfield Showcase image.
 */
export async function shareCardImage(
  opts: CardImageOptions
): Promise<"shared" | "copied" | "downloaded"> {
  const blob = await generateCollectorShowcaseBlob(opts);
  const fileName = `MovieGoblin-${opts.dateLabel}-Showcase.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  const shareData = {
    files: [file],
    title: "MovieGoblin Collector Card",
    text: `I solved today's MovieGoblin in ${opts.breakdown.guessCount} ${
      opts.breakdown.guessCount === 1 ? "guess" : "guesses"
    }! [Rank ${opts.breakdown.rank} · ${opts.breakdown.total} PTS] 🎬`,
  };

  if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        return "shared";
      }
    }
  }

  // Fallback 1: Try copying image to clipboard
  const copied = await copyCardImageToClipboard(opts);
  if (copied) return "copied";

  // Fallback 2: Download PNG directly
  downloadCardImage(blob, fileName);
  return "downloaded";
}
