/* AhaKudos — decorative SVG illustrations (V23, "Playful & Engaging").
   ⚠️ PLACEHOLDER ARTWORK: the reference uses 3D renders (nhân vật Ahamover, hộp quà,
   hoa, bóng bay, bánh sinh nhật 3D). Những asset đó KHÔNG có trong ZIP. Đây là minh
   họa SVG vector tạm — phong phú và phân biệt được theo chủ đề, nhưng KHÔNG phải 3D.
   Cách thay bằng render thật: đặt file vào assets/illustrations/<key>.png và trỏ
   AHAKUDOS_ART.useImage(key,'assets/illustrations/<key>.png') — code sẽ dùng ảnh thay SVG.
   Chữ giao diện KHÔNG dùng trong artwork; toàn bộ chữ UI vẫn là Lexend. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AHAKUDOS_ART = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var imageOverrides = {}; // key -> url (drop-in real render)

  // Theme backdrop colors per background id (also used as email gradient anchors).
  var THEME = {
    warm:      ['#FFF3E6', '#FFE0CC', '#FF7F32'],
    team:      ['#EAF3FB', '#D6E7FA', '#2F80D8'],
    inspire:   ['#F1ECFF', '#E4DAFF', '#8B65D7'],
    celebrate: ['#FFF0E6', '#FFDCC4', '#FF7F32'],
    minimal:   ['#FFF6EC', '#FDEFE0', '#E79A5B'],
    birthday:  ['#FFEFF4', '#FFD9E7', '#F0629A']
  };

  function g(id, c1, c2, x1, y1, x2, y2) {
    return '<linearGradient id="' + id + '" x1="' + (x1 || 0) + '" y1="' + (y1 || 0) + '" x2="' + (x2 || 0) + '" y2="' + (y2 || 1) + '">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient>';
  }
  function backdrop(u, t) {
    return '<defs>' + g('bg' + u, t[0], t[1]) + '</defs>' +
      '<rect x="0" y="0" width="128" height="128" rx="18" fill="url(#bg' + u + ')"/>' +
      '<ellipse cx="64" cy="104" rx="40" ry="8" fill="#0b2f5a" opacity=".07"/>';
  }
  function sparkle(x, y, s, c) {
    c = c || '#fff';
    return '<path d="M' + x + ' ' + (y - s) + ' Q' + x + ' ' + y + ' ' + (x + s) + ' ' + y + ' Q' + x + ' ' + y + ' ' + x + ' ' + (y + s) + ' Q' + x + ' ' + y + ' ' + (x - s) + ' ' + y + ' Q' + x + ' ' + y + ' ' + x + ' ' + (y - s) + 'Z" fill="' + c + '" opacity=".9"/>';
  }

  // ---- 6 distinct scenes ----------------------------------------------------
  var SCENES = {
    // warm → trái tim (lời cảm ơn ấm áp)
    warm: function (u) {
      return backdrop(u, THEME.warm) +
        '<defs>' + g('h' + u, '#FF9A5A', '#FF6B2C') + g('h2' + u, '#FFB07A', '#FF8347') + '</defs>' +
        '<path d="M64 92C40 76 30 62 30 50c0-11 8-18 17-18 6 0 12 3 17 10 5-7 11-10 17-10 9 0 17 7 17 18 0 12-10 26-34 42Z" fill="url(#h' + u + ')"/>' +
        '<path d="M52 40c-4 0-7 3-7 8 0 6 4 12 12 19-9-6-19-14-19-24 0-6 5-10 10-10 1 0 3 3 4 7Z" fill="#fff" opacity=".35"/>' +
        '<path d="M92 52c-3 10-11 20-24 30" fill="none"/>' +
        sparkle(98, 34, 6, '#FFD9A8') + sparkle(30, 30, 5, '#FFC98A') + sparkle(104, 74, 4, '#FFE0BE');
    },
    // team → hộp quà (ghi nhận đồng đội)
    team: function (u) {
      return backdrop(u, THEME.team) +
        '<defs>' + g('gb' + u, '#5AA0EC', '#2F73CF') + g('gl' + u, '#7DB6F2', '#4C93E4') + '</defs>' +
        '<rect x="38" y="58" width="52" height="40" rx="6" fill="url(#gb' + u + ')"/>' +
        '<rect x="34" y="48" width="60" height="16" rx="6" fill="url(#gl' + u + ')"/>' +
        '<rect x="59" y="48" width="10" height="50" fill="#EAF3FB" opacity=".85"/>' +
        '<path d="M64 48c-6-12-24-10-18 0Zm0 0c6-12 24-10 18 0Z" fill="#FF7F32"/>' +
        '<circle cx="64" cy="47" r="5" fill="#FF9A5A"/>' +
        sparkle(100, 40, 5, '#BFDcFb') + sparkle(30, 66, 4, '#CFE4Fb');
    },
    // inspire → ngôi sao / lan tỏa cảm hứng
    inspire: function (u) {
      return backdrop(u, THEME.inspire) +
        '<defs>' + g('st' + u, '#B79BF0', '#8B65D7') + '</defs>' +
        '<path d="M64 34l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3Z" fill="url(#st' + u + ')"/>' +
        '<path d="M64 44l5 11 12 2-9 8 2 12-10-6-10 6 2-12-9-8 12-2Z" fill="#fff" opacity=".28"/>' +
        sparkle(98, 40, 6, '#D9CCF7') + sparkle(30, 44, 5, '#CDBcF3') + sparkle(96, 86, 4, '#E1D6F9');
    },
    // celebrate → pháo giấy / chúc mừng
    celebrate: function (u) {
      return backdrop(u, THEME.celebrate) +
        '<defs>' + g('cp' + u, '#FF8E4E', '#FF6B22') + '</defs>' +
        '<path d="M30 100 58 64l14 12Z" fill="url(#cp' + u + ')"/>' +
        '<path d="M34 96 52 72l8 7Z" fill="#fff" opacity=".25"/>' +
        '<circle cx="82" cy="44" r="4.5" fill="#2F80D8"/>' +
        '<circle cx="96" cy="58" r="4" fill="#F0629A"/>' +
        '<circle cx="74" cy="60" r="3.5" fill="#39A06A"/>' +
        '<rect x="88" y="36" width="6" height="6" rx="1.5" fill="#FF7F32" transform="rotate(20 91 39)"/>' +
        '<rect x="98" y="74" width="6" height="6" rx="1.5" fill="#8B65D7" transform="rotate(-15 101 77)"/>' +
        sparkle(66, 40, 5, '#FFD3AE');
    },
    // minimal → hoa (nhẹ nhàng, tối giản)
    minimal: function (u) {
      var petal = function (rot) { return '<ellipse cx="64" cy="46" rx="9" ry="16" fill="url(#fl' + u + ')" transform="rotate(' + rot + ' 64 62)"/>'; };
      return backdrop(u, THEME.minimal) +
        '<defs>' + g('fl' + u, '#FFCF9E', '#F2A45E') + '</defs>' +
        '<path d="M64 66c-2 12-3 22-3 30" stroke="#6FA98A" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<path d="M64 78c-8-3-14-2-18 2" stroke="#6FA98A" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
        petal(0) + petal(72) + petal(144) + petal(216) + petal(288) +
        '<circle cx="64" cy="62" r="8" fill="#FFF3E0"/><circle cx="64" cy="62" r="4.5" fill="#E79A5B"/>' +
        sparkle(98, 44, 4, '#F7CFA6') + sparkle(32, 50, 4, '#F5C89A');
    },
    // birthday → bánh sinh nhật
    birthday: function (u) {
      return backdrop(u, THEME.birthday) +
        '<defs>' + g('bk' + u, '#FFB3CE', '#F87CA8') + g('cr' + u, '#FFF3F7', '#FFE0EC') + '</defs>' +
        '<rect x="40" y="66" width="48" height="26" rx="6" fill="url(#bk' + u + ')"/>' +
        '<path d="M40 72c6 6 10 6 16 0s10 6 16 0 10 6 16 0v-6H40Z" fill="url(#cr' + u + ')"/>' +
        '<rect x="61" y="46" width="6" height="16" rx="2" fill="#FF7F32"/>' +
        '<path d="M64 36c3 3 3 6 0 8-3-2-3-5 0-8Z" fill="#FFD24D"/>' +
        sparkle(98, 46, 5, '#FFCADF') + sparkle(30, 52, 4, '#FFBFD6');
    }
  };

  function scene(key, uid) {
    var k = SCENES[key] ? key : 'warm';
    if (imageOverrides[k]) {
      return '<img class="art-img" src="' + imageOverrides[k] + '" alt="" aria-hidden="true">';
    }
    var u = (uid || '') + Math.random().toString(36).slice(2, 6);
    return '<svg class="art-svg" viewBox="0 0 128 128" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' + SCENES[k](u) + '</svg>';
  }

  // Hero character placeholder: friendly Ahamover holding a recognition card.
  // (Không sao chép mascot cụ thể; là placeholder — thay bằng render 3D thật khi có.)
  function heroCharacter() {
    if (imageOverrides.hero) return '<img class="hero-art-img" src="' + imageOverrides.hero + '" alt="">';
    var u = 'H';
    return '<svg class="hero-art" viewBox="0 0 220 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
      '<defs>' +
        g('shirt' + u, '#FF9A5A', '#FF6B2C') + g('card' + u, '#FFFFFF', '#F3F8FF', 0, 0, 1, 1) +
        g('heart' + u, '#FF8E52', '#FF5F27') + g('cap' + u, '#12406F', '#0B2F58') +
      '</defs>' +
      '<ellipse cx="110" cy="176" rx="70" ry="12" fill="#0b2f5a" opacity=".18"/>' +
      // hearts + sparkles floating
      '<path d="M164 44c8-6 18 2 12 10-3 4-8 7-12 10-4-3-9-6-12-10-6-8 4-16 12-10Z" fill="url(#heart' + u + ')" opacity=".9"/>' +
      sparkle(48, 42, 8, '#FFD7A6') + sparkle(182, 96, 6, '#FFE0BE') + sparkle(40, 104, 5, '#FFCF9A') +
      // body / shirt
      '<path d="M74 196c0-30 16-46 36-46s36 16 36 46Z" fill="url(#shirt' + u + ')"/>' +
      '<path d="M96 156h28v14a14 14 0 0 1-28 0Z" fill="#F1B48A"/>' +
      // head
      '<circle cx="110" cy="120" r="34" fill="#F6C39B"/>' +
      '<path d="M78 116c0-20 14-34 32-34s32 14 32 34c-6-8-16-12-22-8-6-10-30-12-42 8Z" fill="url(#cap' + u + ')"/>' +
      '<circle cx="99" cy="120" r="3.4" fill="#3A2A20"/><circle cx="123" cy="120" r="3.4" fill="#3A2A20"/>' +
      '<path d="M102 132c5 5 13 5 18 0" stroke="#C97A4E" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<circle cx="92" cy="128" r="4" fill="#FF9B6B" opacity=".5"/><circle cx="130" cy="128" r="4" fill="#FF9B6B" opacity=".5"/>' +
      // arm + recognition card
      '<rect x="120" y="150" width="70" height="48" rx="10" fill="url(#card' + u + ')" transform="rotate(-9 155 174)" stroke="#E7EEF7"/>' +
      '<path d="M150 168c5-5 13 1 8 7-2 3-6 5-8 7-3-2-6-4-8-7-5-6 3-12 8-7Z" fill="url(#heart' + u + ')" transform="rotate(-9 155 174)"/>' +
      '<path d="M120 176c14 6 26 4 34-4" stroke="#F1B48A" stroke-width="14" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }

  function useImage(key, url) { imageOverrides[key] = url; }
  function themeColor(key) { return (THEME[key] || THEME.warm)[2]; }

  // Small transparent badge illustrations for the first-KUDOS cards.
  function party() {
    var u = 'P' + Math.random().toString(36).slice(2, 6);
    return '<svg class="fk-svg" viewBox="0 0 80 80" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
      '<defs>' + g('cone' + u, '#FF9A4E', '#FF6A1E') + '</defs>' +
      '<path d="M8 72 L40 45 L53 57 Z" fill="url(#cone' + u + ')"/>' +
      '<path d="M8 72 L20 61 L27 67 Z" fill="#ffffff" opacity=".22"/>' +
      '<path d="M40 45 L53 57" stroke="#E85D14" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M44 44 q7 -11 17 -13" stroke="#FFB27A" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M50 52 q11 -3 19 3" stroke="#7FB8F0" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<circle cx="53" cy="24" r="4" fill="#2F80D8"/>' +
      '<circle cx="67" cy="35" r="3.5" fill="#F0629A"/>' +
      '<circle cx="45" cy="31" r="3" fill="#39A06A"/>' +
      '<rect x="60" y="15" width="6" height="6" rx="1.5" fill="#FF7F32" transform="rotate(20 63 18)"/>' +
      '<rect x="70" y="48" width="6" height="6" rx="1.5" fill="#8B65D7" transform="rotate(-15 73 51)"/>' +
      '<rect x="47" y="46" width="5" height="5" rx="1.2" fill="#FFC94D" transform="rotate(25 49 48)"/>' +
      '<path d="M30 12 l2.4 5 5.4 .7 -3.9 3.7 1 5.3 -4.9 -2.7 -4.9 2.7 1 -5.3 -3.9 -3.7 5.4 -.7Z" fill="#FFD24D"/>' +
      '</svg>';
  }
  function gift() {
    var u = 'G' + Math.random().toString(36).slice(2, 6);
    return '<svg class="fk-svg" viewBox="0 0 80 80" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
      '<defs>' + g('box' + u, '#FF8080', '#EE555A') + g('lid' + u, '#FF9C9C', '#F26E72') + g('rib' + u, '#FFC94D', '#FF9A2E') + '</defs>' +
      '<ellipse cx="40" cy="70" rx="26" ry="4" fill="#0b2f5a" opacity=".08"/>' +
      '<rect x="21" y="37" width="38" height="29" rx="4" fill="url(#box' + u + ')"/>' +
      '<rect x="16" y="28" width="48" height="13" rx="4" fill="url(#lid' + u + ')"/>' +
      '<rect x="36" y="28" width="8" height="38" fill="url(#rib' + u + ')"/>' +
      '<rect x="24" y="39" width="5" height="25" rx="2" fill="#ffffff" opacity=".18"/>' +
      '<path d="M40 29 C29 16 15 23 26 31 C31 34 36 32 40 29Z" fill="url(#rib' + u + ')"/>' +
      '<path d="M40 29 C51 16 65 23 54 31 C49 34 44 32 40 29Z" fill="url(#rib' + u + ')"/>' +
      '<circle cx="40" cy="29" r="4.6" fill="#FFB84D"/>' +
      '<path d="M64 18 l1.6 3.5 3.6 .5 -2.6 2.5 .6 3.5 -3.2 -1.7 -3.2 1.7 .6 -3.5 -2.6 -2.5 3.6 -.5Z" fill="#FFD24D"/>' +
      '</svg>';
  }

  return { scene: scene, heroCharacter: heroCharacter, party: party, gift: gift, useImage: useImage, THEME: THEME, themeColor: themeColor, keys: Object.keys(SCENES) };
}));
