/**
 * Handout renderer. Draws handouts on a <canvas> in page points
 * (1pt = 1/72 inch), so the same code makes small previews and the
 * 300 dpi JPEG files. Has no app state: everything comes in through `d`.
 *
 *   HBR.render(kind, d, dpi) -> canvas      kind: 'full' | 'half' | 'online'
 *   HBR.toJpeg(canvas, dpi)  -> Promise<Blob>
 *
 * Paper d: { dateLine, takingLine, titleLine, body: Image, rotateRight }
 * Online d: { name, type, sport, date, colors: {primary, secondary, accent},
 *             logo: Image|null, mirrorLogo }
 */
var HBR = (function () {
  'use strict';

  var SIZES = { full: [612, 792], half: [792, 612], online: [612, 792] };
  var SANS = 'Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif';
  var SLAB = '"Alfa Slab One", Rockwell, Georgia, serif';
  var GEO = 'Montserrat, "Helvetica Neue", Arial, sans-serif';
  var COND = 'Oswald, "Arial Narrow", Arial, sans-serif';
  var NO_RED = '#D21F2B';

  var fontsReady = null;
  function ensureFonts() {
    if (!fontsReady) {
      var specs = ['italic 700 40px Arimo', '400 24px Arimo', '700 36px Arimo',
        '400 40px "Alfa Slab One"', '700 40px Montserrat', '800 40px Montserrat',
        '900 40px Montserrat', '600 40px Oswald'];
      var loadAll = function () {
        return Promise.all(specs.map(function (s) {
          return document.fonts.load(s, 'AB12').catch(function () { return null; });
        }));
      };
      fontsReady = (document.fonts ? document.fonts.ready : Promise.resolve())
        .then(loadAll)
        .then(function () {
          // The Google Fonts stylesheet may still be arriving: wait once more.
          if (specs.every(function (s) { return document.fonts.check(s); })) return;
          return new Promise(function (r) { setTimeout(r, 800); }).then(loadAll);
        });
    }
    return fontsReady;
  }

  // ------------------------------------------------------------ helpers

  function fitSize(ctx, text, fontFn, maxW, size, min, spacing) {
    for (var s = size; s > min; s -= 0.5) {
      ctx.font = fontFn(s);
      if (textWidth(ctx, text, spacing ? spacing * s : 0) <= maxW) return s;
    }
    ctx.font = fontFn(min);
    return min;
  }

  function textWidth(ctx, text, spacing) {
    if (!spacing) return ctx.measureText(text).width;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width;
    return w + spacing * Math.max(0, text.length - 1);
  }

  /** Centered text with optional letter spacing (in points). */
  function drawCentered(ctx, text, cx, y, spacing) {
    if (!spacing) {
      ctx.textAlign = 'center';
      ctx.fillText(text, cx, y);
      return;
    }
    ctx.textAlign = 'left';
    var x = cx - textWidth(ctx, text, spacing) / 2;
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text[i], x, y);
      x += ctx.measureText(text[i]).width + spacing;
    }
  }

  /** Height of capital letters for the current font. */
  function capHeight(ctx) {
    var m = ctx.measureText('H');
    return m.actualBoundingBoxAscent || parseFloat(ctx.font.match(/([\d.]+)px/)[1]) * 0.72;
  }

  function isLight(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
  }

  // ------------------------------------------------------------ paper

  /**
   * Full sheet, matching the sample PDF: the price image at x=27.04pt,
   * y=41.94pt, 552.82×691.03pt, and three lines centered on x=309.74pt.
   */
  function drawPaper(ctx, d) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 612, 792);
    if (d.body) ctx.drawImage(d.body, 27.04, 41.94, 552.82, 691.03);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    var cx = 309.74, maxW = 524.78;
    var lines = [
      { text: d.dateLine, font: function (s) { return 'italic 700 ' + s + 'px ' + SANS; }, size: 40, y: 100.91 },
      { text: d.takingLine, font: function (s) { return '400 ' + s + 'px ' + SANS; }, size: 24, y: 133.97 },
      { text: d.titleLine, font: function (s) { return '700 ' + s + 'px ' + SANS; }, size: 36, y: 174.90 }
    ];
    lines.forEach(function (l) {
      var t = String(l.text || '');
      if (!t) return;
      fitSize(ctx, t, l.font, maxW, l.size, 12);
      drawCentered(ctx, t, cx, l.y);
    });
  }

  /** Half-sheet file: two copies of the full sheet at 396/612 scale, side by side. */
  function drawHalf(ctx, d) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 792, 612);
    var s = 396 / 612;
    var top = (612 - 792 * s) / 2;
    for (var i = 0; i < 2; i++) {
      ctx.save();
      ctx.translate(i * 396, top);
      if (i === 1 && d.rotateRight) {
        ctx.translate(198, 792 * s / 2);
        ctx.rotate(Math.PI);
        ctx.translate(-198, -792 * s / 2);
      }
      ctx.scale(s, s);
      drawPaper(ctx, d);
      ctx.restore();
    }
    // Light cut guide down the middle, outside the printed content.
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    [[0, 18], [594, 612]].forEach(function (seg) {
      ctx.beginPath(); ctx.moveTo(396, seg[0]); ctx.lineTo(396, seg[1]); ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // ------------------------------------------------------------ online

  function drawLogo(ctx, img, x, y, size, mirror) {
    var r = Math.min(size / img.width, size / img.height);
    var w = img.width * r, h = img.height * r;
    ctx.save();
    if (mirror) {
      ctx.translate(x + size, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, (size - w) / 2, y + (size - h) / 2, w, h);
    } else {
      ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    }
    ctx.restore();
  }

  /** Splits a name onto two lines at the space nearest the middle. */
  function splitTwo(text) {
    var words = text.split(/\s+/);
    if (words.length < 2) return [text];
    var best = null;
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      var diff = Math.abs(a.length - b.length);
      if (!best || diff < best.diff) best = { diff: diff, lines: [a, b] };
    }
    return best.lines;
  }

  /** Word-wraps colored runs: runs = [{text, color}]. Returns lines of [{text,color}]. */
  function wrapRuns(ctx, runs, maxW) {
    var words = [];
    runs.forEach(function (r) {
      r.text.split(/\s+/).filter(Boolean).forEach(function (w) { words.push({ text: w, color: r.color }); });
    });
    var space = ctx.measureText(' ').width;
    var lines = [], line = [], width = 0;
    words.forEach(function (w) {
      var ww = ctx.measureText(w.text).width;
      var add = line.length ? space + ww : ww;
      if (line.length && width + add > maxW) { lines.push(line); line = []; width = 0; add = ww; }
      line.push(w); width += add;
    });
    if (line.length) lines.push(line);
    return lines;
  }

  /** Fits wrapped colored text into a box, left aligned and vertically centered. */
  function drawTextBox(ctx, runs, x, y, w, h, fontFn, maxSize, minSize) {
    var size = maxSize, lines, lh;
    for (; size >= minSize; size -= 0.5) {
      ctx.font = fontFn(size);
      lines = wrapRuns(ctx, runs, w);
      lh = size * 1.12;
      var tooWide = lines.some(function (l) {
        return ctx.measureText(l.map(function (x) { return x.text; }).join(' ')).width > w;
      });
      if (!tooWide && lines.length * lh <= h) break;
    }
    var cap = capHeight(ctx);
    var blockH = (lines.length - 1) * lh + cap;
    var base = y + (h - blockH) / 2 + cap;
    var space = ctx.measureText(' ').width;
    ctx.textAlign = 'left';
    lines.forEach(function (line, i) {
      var cx = x;
      line.forEach(function (word) {
        ctx.fillStyle = word.color;
        ctx.fillText(word.text, cx, base + i * lh);
        cx += ctx.measureText(word.text).width + space;
      });
    });
  }

  /** Red prohibition sign over a pair of flip-flops. */
  function drawNoSandals(ctx, cx, cy, r, ink) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    function flipflop(x, y, angle, scale) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(scale, scale);
      ctx.beginPath();
      // sole: wide toe, narrow waist, round heel
      ctx.moveTo(0, -30);
      ctx.bezierCurveTo(14, -30, 15, -12, 10, 2);
      ctx.bezierCurveTo(7, 10, 11, 20, 9, 27);
      ctx.bezierCurveTo(7, 34, -7, 34, -9, 27);
      ctx.bezierCurveTo(-11, 20, -7, 10, -10, 2);
      ctx.bezierCurveTo(-15, -12, -14, -30, 0, -30);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = ink;
      ctx.stroke();
      // V strap
      ctx.beginPath();
      ctx.moveTo(-10, 4); ctx.lineTo(0, -20); ctx.lineTo(10, 4);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -20, 2.4, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
      ctx.restore();
    }
    var k = r / 50;
    flipflop(cx - 13 * k, cy + 2 * k, -0.35, k * 0.95);
    flipflop(cx + 14 * k, cy - 2 * k, 0.3, k * 0.95);
    ctx.strokeStyle = NO_RED;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    var a = Math.PI / 4, rr = r - ctx.lineWidth / 2;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * rr, cy - Math.sin(a) * rr);
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.restore();
  }

  /** Envelope with a portrait photo card coming out of it. */
  function drawEnvelope(ctx, cx, cy, size, ink) {
    var w = size, h = size * 0.62;
    var x = cx - w / 2, y = cy - h / 2 + size * 0.14;
    var lw = size * 0.045;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    // back flap (open)
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(cx, y - h * 0.42); ctx.lineTo(x + w, y);
    ctx.stroke();
    // photo card
    var cw = w * 0.62, ch = h * 1.05, cxl = cx - cw / 2, cyt = y - h * 0.55;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cxl, cyt, cw, ch);
    ctx.strokeRect(cxl, cyt, cw, ch);
    var px = cxl + cw * 0.1, py = cyt + cw * 0.1, pw = cw * 0.8, ph = ch * 0.66;
    ctx.fillStyle = ink;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, py + ph * 0.36, pw * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, py + ph, pw * 0.34, ph * 0.38, 0, Math.PI, 0); ctx.fill();
    // envelope front (covers the bottom of the card)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(cx, y + h * 0.55); ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fill();
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(cx, y + h * 0.55); ctx.lineTo(x + w, y);
    ctx.moveTo(x, y + h); ctx.lineTo(cx - w * 0.12, y + h * 0.5);
    ctx.moveTo(x + w, y + h); ctx.lineTo(cx + w * 0.12, y + h * 0.5);
    ctx.stroke();
    ctx.restore();
  }

  /** Online picture-day notice on a letter page (layout after the Bedford reference). */
  function drawOnline(ctx, d) {
    var c = d.colors || {};
    var primary = c.primary || '#B3121F', secondary = c.secondary || '#0B2A5B', accent = c.accent || primary;
    // Small text in a light color (gold, silver) is hard to read on white:
    // use the darker school color for it, and keep the light one for bands.
    var ink2 = !isLight(secondary) ? secondary : !isLight(primary) ? primary : '#222222';
    var ink1 = !isLight(primary) ? primary : ink2;
    var inkAccent = !isLight(accent) ? accent : ink1;
    var M = 36, W = 612;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 612, 792);
    ctx.textBaseline = 'alphabetic';

    // 1–3: logos, school name, school type
    var L = 118;
    var hasLogo = !!d.logo;
    var textW = hasLogo ? W - 2 * M - 2 * L - 24 : W - 2 * M - 20;
    var name = String(d.name || '').toUpperCase().trim();
    var slab = function (s) { return '400 ' + s + 'px ' + SLAB; };
    var nameLines = [name], nameSize = fitSize(ctx, name, slab, textW, 86, 20);
    if (nameSize < 54 && name.indexOf(' ') > 0) {
      var two = splitTwo(name);
      var twoSize = Math.min.apply(null, two.map(function (t) { return fitSize(ctx, t, slab, textW, 66, 20); }));
      if (twoSize > nameSize) { nameLines = two; nameSize = twoSize; }
    }
    ctx.font = slab(nameSize);
    var nameCap = capHeight(ctx);
    var nameGap = nameSize * 0.24;
    var type = String(d.type || '').toUpperCase().trim();
    var typeFont = function (s) { return '800 ' + s + 'px ' + GEO; };
    var typeSize = type ? fitSize(ctx, type, typeFont, textW, 27, 10, 0.16) : 0;
    ctx.font = typeFont(typeSize || 27);
    var typeCap = type ? capHeight(ctx) : 0;
    var typeGap = type ? Math.max(14, nameSize * 0.2) : 0;
    var blockH = nameLines.length * nameCap + (nameLines.length - 1) * nameGap + typeGap + typeCap;
    var headTop = 44, headH = 150;
    var y = headTop + (headH - blockH) / 2;
    ctx.fillStyle = ink1;
    ctx.font = slab(nameSize);
    nameLines.forEach(function (t, i) {
      drawCentered(ctx, t, W / 2, y + nameCap + i * (nameCap + nameGap));
    });
    y += nameLines.length * nameCap + (nameLines.length - 1) * nameGap;
    if (type) {
      ctx.fillStyle = ink2;
      ctx.font = typeFont(typeSize);
      drawCentered(ctx, type, W / 2, y + typeGap + typeCap, typeSize * 0.16);
    }
    if (hasLogo) {
      var ly = headTop + (headH - L) / 2;
      drawLogo(ctx, d.logo, M, ly, L, false);
      drawLogo(ctx, d.logo, W - M - L, ly, L, !!d.mirrorLogo);
    }

    // 4: rule
    ctx.fillStyle = primary;
    ctx.fillRect(66, 208, W - 132, 4);

    // 5: sport band
    var bandY = 232, bandH = 104;
    ctx.fillStyle = secondary;
    ctx.fillRect(M, bandY, W - 2 * M, bandH);
    var sport = String(d.sport || '').toUpperCase().trim();
    if (sport) {
      var sportFont = function (s) { return '900 ' + s + 'px ' + GEO; };
      var ss = fitSize(ctx, sport, sportFont, W - 2 * M - 48, 74, 16, 0.02);
      ctx.fillStyle = isLight(secondary) ? '#111' : '#fff';
      var sc = capHeight(ctx);
      drawCentered(ctx, sport, W / 2, bandY + (bandH + sc) / 2, ss * 0.02);
    }

    // 6: PICTURE DAY
    var pdFont = function (s) { return '700 ' + s + 'px ' + GEO; };
    var pdSize = fitSize(ctx, 'PICTURE DAY', pdFont, W - 2 * M - 40, 44, 12, 0.3);
    ctx.fillStyle = ink2;
    drawCentered(ctx, 'PICTURE DAY', W / 2, 388 + capHeight(ctx) / 2, pdSize * 0.3);

    // 7: date
    var date = String(d.date || '').toUpperCase().trim();
    if (date) {
      var dateFont = function (s) { return '900 ' + s + 'px ' + GEO; };
      fitSize(ctx, date, dateFont, W - 2 * M - 20, 110, 16);
      ctx.fillStyle = inkAccent;
      drawCentered(ctx, date, W / 2, 470 + capHeight(ctx) / 2);
    }

    // 8: rule
    ctx.fillStyle = secondary;
    ctx.fillRect(M, 538, W - 2 * M, 3);

    // 9: info panels
    var panelY = 562, panelH = 150, divX = 252;
    ctx.fillStyle = secondary;
    ctx.fillRect(divX, panelY + 6, 3, panelH - 12);
    drawNoSandals(ctx, M + 46, panelY + panelH / 2, 46, ink2);
    var cond = function (s) { return '600 ' + s + 'px ' + COND; };
    drawTextBox(ctx, [{ text: 'NO SANDALS, CROCS, OR FLIPFLOPS', color: ink2 }],
      M + 104, panelY, divX - (M + 104) - 10, panelH, cond, 26, 10);
    drawEnvelope(ctx, divX + 66, panelY + panelH / 2, 92, ink2);
    drawTextBox(ctx, [
      { text: 'EMAIL SAMPLES WILL BE SENT DIRECTLY TO PARENTS WITH OPTIONS TO PURCHASE', color: ink2 },
      { text: 'PRINTS OR DIGITAL FILES.', color: inkAccent }
    ], divX + 126, panelY, W - M - (divX + 126), panelH, cond, 25, 10);

    // 10: stripes
    ctx.fillStyle = primary;
    ctx.fillRect(0, 734, W, 9);
    ctx.fillStyle = secondary;
    ctx.fillRect(0, 751, W, 20);
  }

  // ------------------------------------------------------------ output

  function render(kind, d, dpi) {
    var size = SIZES[kind];
    var k = (dpi || 72) / 72;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(size[0] * k);
    canvas.height = Math.round(size[1] * k);
    var ctx = canvas.getContext('2d');
    ctx.scale(k, k);
    ctx.imageSmoothingQuality = 'high';
    if (kind === 'full') drawPaper(ctx, d);
    else if (kind === 'half') drawHalf(ctx, d);
    else drawOnline(ctx, d);
    return canvas;
  }

  /** JPEG blob with the resolution set in its header, so it prints at the right size. */
  function toJpeg(canvas, dpi, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) return reject(new Error('Could not make the JPEG (out of memory?)'));
        blob.arrayBuffer().then(function (buf) {
          resolve(new Blob([setJpegDpi(new Uint8Array(buf), dpi || 300)], { type: 'image/jpeg' }));
        }, reject);
      }, 'image/jpeg', quality || 0.92);
    });
  }

  function setJpegDpi(bytes, dpi) {
    var isJfif = bytes[2] === 0xFF && bytes[3] === 0xE0 &&
      bytes[6] === 0x4A && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46;
    if (isJfif) {
      bytes[13] = 1;
      bytes[14] = dpi >> 8; bytes[15] = dpi & 255;
      bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
      return bytes;
    }
    var app0 = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1,
      dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0, 0]);
    var out = new Uint8Array(bytes.length + app0.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(app0, 2);
    out.set(bytes.subarray(2), 2 + app0.length);
    return out;
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not load an image')); };
      img.src = src;
    });
  }

  /**
   * Suggests { primary, secondary, accent } from a logo: the most common
   * strong colors, ignoring transparent, white and gray pixels.
   */
  function suggestColors(img) {
    var size = 96;
    var c = document.createElement('canvas');
    var r = Math.min(size / img.width, size / img.height, 1);
    c.width = Math.max(1, Math.round(img.width * r));
    c.height = Math.max(1, Math.round(img.height * r));
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var px = ctx.getImageData(0, 0, c.width, c.height).data;
    var buckets = {};
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 160) continue;
      var R = px[i], G = px[i + 1], B = px[i + 2];
      var max = Math.max(R, G, B), min = Math.min(R, G, B);
      if (max > 235 && min > 225) continue;              // white
      var dark = max < 45;
      if (!dark && (max - min) < 28) continue;          // gray
      var key = dark ? 'k' : (R >> 5) + ',' + (G >> 5) + ',' + (B >> 5);
      var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      b.n++; b.r += R; b.g += G; b.b += B;
    }
    var list = Object.keys(buckets).map(function (k) {
      var b = buckets[k];
      return { n: b.n, r: b.r / b.n, g: b.g / b.n, b: b.b / b.n };
    }).sort(function (a, b) { return b.n - a.n; });
    var picked = [];
    list.forEach(function (col) {
      if (picked.length >= 3) return;
      var far = picked.every(function (p) {
        return Math.abs(p.r - col.r) + Math.abs(p.g - col.g) + Math.abs(p.b - col.b) > 110;
      });
      if (far) picked.push(col);
    });
    var hex = function (col) {
      return '#' + [col.r, col.g, col.b].map(function (v) {
        return ('0' + Math.round(v).toString(16)).slice(-2);
      }).join('').toUpperCase();
    };
    if (!picked.length) return null;
    var primary = hex(picked[0]);
    var secondary = picked[1] ? hex(picked[1]) : '#1A1A1A';
    return { primary: primary, secondary: secondary, accent: primary };
  }

  return {
    SIZES: SIZES, ensureFonts: ensureFonts, render: render, toJpeg: toJpeg,
    loadImage: loadImage, suggestColors: suggestColors, isLight: isLight
  };
})();
