/**
 * Minimal .zip writer (stored, no compression: JPEGs don't shrink anyway).
 *   HBZip.make([{ name, blob }]) -> Promise<Blob>
 */
var HBZip = (function () {
  'use strict';
  var table = null;
  function crc32(bytes) {
    if (!table) {
      table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function make(files) {
    return Promise.all(files.map(function (f) { return f.blob.arrayBuffer(); })).then(function (bufs) {
      var enc = new TextEncoder();
      var parts = [], central = [], offset = 0;
      var t = dosTime(new Date());
      files.forEach(function (f, i) {
        var data = new Uint8Array(bufs[i]);
        var name = enc.encode(f.name);
        var crc = crc32(data);
        var local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true); // UTF-8 names
        local.setUint16(8, 0, true);
        local.setUint16(10, t.time, true);
        local.setUint16(12, t.date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(local.buffer, name, data);

        var cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, t.time, true);
        cen.setUint16(14, t.date, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, data.length, true);
        cen.setUint32(24, data.length, true);
        cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);
        central.push(cen.buffer, name);
        offset += 30 + name.length + data.length;
      });
      var cenSize = central.reduce(function (s, p) { return s + p.byteLength; }, 0);
      var end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, files.length, true);
      end.setUint16(10, files.length, true);
      end.setUint32(12, cenSize, true);
      end.setUint32(16, offset, true);
      return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
    });
  }

  return { make: make };
})();
