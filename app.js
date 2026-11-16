/* PartyGround — логика приложения (работает с сервером в Yandex Cloud) */
(function () {
'use strict';

// ===== НАСТРОЙКИ =====
var API = 'https://d5djhv475n138aegoga9.xxg4zr82.apigw.yandexcloud.net/api';
var APP_LINK = 'https://t.me/PartyHubbBot/party';
var BOT_LINK = 'https://t.me/PartyHubbBot';
var EMOJIS = ['🎉','🍕','🎲','🎤','🍻','🏀','🎬','🎮','💃','🌃','🏕️','☕'];
var TYPES = ['Домашняя вечеринка','Бар','Настолки','Караоке','Спорт','Прогулка','Кино','Игры','Другое'];
var INTERESTS = ['Настолки','Караоке','Бары','Кино','Спорт','Музыка','Танцы','Прогулки','Видеоигры','Путешествия','Стендап','Кулинария'];
var MSK = [55.7558, 37.6173];
var TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
var TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// ===== Telegram =====
var W = window.Telegram && window.Telegram.WebApp;
var tg = W && W.initData ? W : null;
function haptic(s) { try { tg && tg.HapticFeedback.impactOccurred(s || 'light'); } catch (e) {} }
function vibe(t) { try { tg && tg.HapticFeedback.notificationOccurred(t || 'success'); } catch (e) {} }

// ===== Помощники =====
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function fmt(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
function initials(name) {
  return (name || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase() || '?';
}
function plural(n, a, b, c) {
  var m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c);
}
var toastTimer;
function toast(msg) {
  var t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
}
function colorFor(id) {
  var c = ['#ff7a59', '#5c8bff', '#22b573', '#b45cff', '#ff3d7f', '#f5a524', '#14b8c4'];
  return c[Math.abs(parseInt(String(id).slice(-4), 16) || 0) % c.length];
}

// ===== Сервер =====
function api(action, data) {
  data = data || {};
  data.action = action;
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': tg ? tg.initData : '' },
    body: JSON.stringify(data)
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error || 'Сервер недоступен, попробуй ещё раз');
      return j;
    });
  }, function () { throw new Error('Нет связи с сервером'); });
}
function busy(btn, on) { if (btn) btn.disabled = !!on; }

// ===== Состояние =====
var me = { name: '', age: '', district: '', about: '', interests: [], photo: '', username: '' };
var parties = [];
var invites = [];
var current = 'create';

function refreshParties() {
  return api('list').then(function (r) {
    parties = r.parties || [];
    if (current === 'map') renderMap();
    if (current === 'profile') renderProfile();
    if (current === 'search') renderSearch();
  }).catch(function (e) { toast(e.message); });
}
function refreshInvites() {
  return api('invites').then(function (r) {
    invites = r.invites || [];
    updateBadge();
    if (current === 'invites') renderInvites();
  }).catch(function (e) { toast(e.message); });
}
function refreshAll() { return Promise.all([refreshParties(), refreshInvites()]); }

// ===== Навигация =====
function show(name) {
  current = name;
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 's-' + name); });
  var tabName = name === 'created' ? 'create' : name;
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.go === tabName); });
  window.scrollTo(0, 0);
  if (name === 'invites') { renderInvites(); refreshInvites(); }
  if (name === 'profile') { renderProfile(); refreshParties(); }
  if (name === 'map') { initBigMap(); refreshParties(); }
  if (name === 'create') initPickMap();
  if (name === 'search') { renderSearchFilters(); renderSearch(); refreshParties(); }
}
document.querySelectorAll('.tab').forEach(function (t) {
  t.addEventListener('click', function () { haptic(t.dataset.go === 'create' ? 'medium' : 'light'); show(t.dataset.go); });
});

// ===== Карточки =====
function metaHtml(p) {
  return '📅 ' + esc(fmt(p.when)) + '<br>📍 ' + esc(p.place);
}
function tagsHtml(p) {
  var s = '';
  if (p.type) s += '<span class="tag">' + esc(p.type) + '</span>';
  s += '<span class="tag">' + p.going + ' из ' + p.max + '</span>';
  if (p.private) s += '<span class="tag">🔒 по приглашениям</span>';
  if (p.adult) s += '<span class="tag">18+</span>';
  if (p.joined && !p.mine) s += '<span class="tag going">✓ Ты идёшь</span>';
  return s;
}
function partyCard(p, extra) {
  return '<div class="card" data-open="' + esc(p.id) + '">' +
    '<div class="card-top"><div class="cover">' + esc(p.emoji) + '</div>' +
    '<div style="flex:1;min-width:0"><div class="title">' + esc(p.title) + '</div>' +
    '<div class="meta">' + metaHtml(p) + '</div>' + tagsHtml(p) + '</div></div>' + (extra || '') + '</div>';
}
function barHtml(p) {
  var pct = Math.min(100, Math.round(p.going / Math.max(1, p.max) * 100));
  return '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="bar-txt">Идут ' + p.going + ' из ' + p.max + '</div>';
}

// ===== Поделиться =====
function partyLink(p) { return APP_LINK + '?startapp=p_' + p.id; }
function shareParty(p) {
  var text = p.emoji + ' ' + p.title + '\n📅 ' + fmt(p.when) + '\n📍 ' + p.place + '\n\nЗову тебя на тусовку! Жми на ссылку, чтобы записаться 👇';
  var url = 'https://t.me/share/url?url=' + encodeURIComponent(partyLink(p)) + '&text=' + encodeURIComponent(text);
  haptic();
  if (tg) tg.openTelegramLink(url); else window.open(url, '_blank');
}

// ===== Создание тусовки =====
var form = { emoji: EMOJIS[0], type: '', max: 6 };
function buildCreateForm() {
  $('emojiPicker').innerHTML = EMOJIS.map(function (e) {
    return '<button type="button" class="emo' + (e === form.emoji ? ' on' : '') + '" data-e="' + e + '">' + e + '</button>';
  }).join('');
  $('typeChips').innerHTML = TYPES.map(function (t) {
    return '<button type="button" class="chip' + (t === form.type ? ' on' : '') + '" data-t="' + esc(t) + '">' + esc(t) + '</button>';
  }).join('');
  $('maxVal').textContent = form.max;
  if (pickMarker) pickMarker.setIcon(pinIcon({ emoji: form.emoji, mine: true }, false));
  var now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  $('fWhen').min = now.toISOString().slice(0, 16);
}
$('emojiPicker').addEventListener('click', function (e) {
  var b = e.target.closest('.emo'); if (!b) return;
  form.emoji = b.dataset.e; haptic(); buildCreateForm();
});
$('typeChips').addEventListener('click', function (e) {
  var b = e.target.closest('.chip'); if (!b) return;
  form.type = form.type === b.dataset.t ? '' : b.dataset.t; haptic(); buildCreateForm();
});
$('maxMinus').onclick = function () { if (form.max > 2) { form.max--; haptic(); $('maxVal').textContent = form.max; } };
$('maxPlus').onclick = function () { if (form.max < 50) { form.max++; haptic(); $('maxVal').textContent = form.max; } };
['fTitle', 'fWhen', 'fPlace'].forEach(function (id) { $(id).addEventListener('input', function () { $(id).classList.remove('err'); }); });

var lastCreated = null;
$('createBtn').onclick = function () {
  var title = $('fTitle').value.trim(), when = $('fWhen').value, place = $('fPlace').value.trim();
  var bad = null;
  if (!place) bad = 'fPlace';
  if (!when || new Date(when) < new Date()) bad = 'fWhen';
  if (!title) bad = 'fTitle';
  if (bad) {
    $(bad).classList.add('err'); $(bad).focus(); vibe('error');
    toast(bad === 'fWhen' && when ? 'Дата должна быть в будущем' : 'Заполни поля со звёздочкой');
    return;
  }
  var btn = $('createBtn'); busy(btn, true); btn.textContent = 'Создаём…';
  api('create', {
    emoji: form.emoji, title: title, type: form.type, when: new Date(when).toISOString(), place: place,
    lat: pick.lat, lng: pick.lng, max: form.max, private: $('fPrivate').checked, adult: $('fAdult').checked,
    desc: $('fDesc').value.trim()
  }).then(function (r) {
    ['fTitle', 'fWhen', 'fPlace', 'fDesc'].forEach(function (id) { $(id).value = ''; });
    $('fPrivate').checked = false; $('fAdult').checked = false;
    form.emoji = EMOJIS[0]; form.type = ''; form.max = 6; resetPick(); buildCreateForm();
    vibe('success');
    lastCreated = r.party;
    $('createdCard').innerHTML = partyCard(r.party);
    show('created');
    refreshParties();
  }).catch(function (e) { vibe('error'); toast(e.message); })
    .then(function () { busy(btn, false); btn.textContent = '🎉 Создать тусовку'; });
};
$('shareBtn').onclick = function () { if (lastCreated) shareParty(lastCreated); };
$('doneBtn').onclick = function () { haptic(); show('profile'); };
$('createdCard').addEventListener('click', function () { if (lastCreated) openParty(lastCreated.id); });

// ===== Окно тусовки =====
var opened = null;
function openParty(id) {
  $('partyModal').classList.remove('hidden');
  $('partyModalBody').innerHTML = '<div class="empty"><div class="big">⏳</div>Загружаем тусовку…</div>';
  api('get', { id: id }).then(function (r) { opened = r.party; renderPartyModal(); })
    .catch(function (e) { $('partyModalBody').innerHTML = '<div class="empty"><div class="big">😕</div>' + esc(e.message) + '</div><button class="btn ghost" data-close="1">Закрыть</button>'; });
}
function closeParty() { $('partyModal').classList.add('hidden'); opened = null; }
function renderPartyModal() {
  var p = opened; if (!p) return;
  var people = (p.people || []).map(function (u) {
    return '<span class="person"><span class="ava" style="background:' + colorFor(u.id) + '">' + esc(initials(u.name)) + '</span>' + esc(u.name || 'Гость') + '</span>';
  }).join('');
  var actions = '';
  if (p.mine) {
    actions = '<button class="btn" data-act="share">📨 Позвать друзей</button>';
  } else if (p.joined) {
    actions = '<button class="btn" data-act="share">📨 Позвать друзей</button><button class="btn ghost" data-act="leave">Передумал, не пойду</button>';
  } else {
    actions = p.going >= p.max ? '<button class="btn ghost" disabled>Мест нет 😔</button>' : '<button class="btn" data-act="join">Пойду! 🙌</button>';
  }
  var invite = (p.mine || p.joined) ?
    '<div class="section-title">Позвать по нику</div><div class="inv-row"><input class="input" id="invUser" placeholder="@username друга" autocapitalize="off"><button class="btn" data-act="invite">Позвать</button></div>' +
    '<div class="picker-hint">Работает, если друг уже открывал PartyGround. Иначе отправь ссылку кнопкой выше.</div>' : '';
  var extra = '';
  if (p.lat != null) extra += '<button class="btn ghost" data-act="map">🗺 Показать на карте</button>';
  if (p.mine) extra += '<button class="btn ghost" data-act="delete" style="color:#ff6b8f">Удалить тусовку</button>';
  $('partyModalBody').innerHTML =
    '<div class="modal-head"><span class="tag">' + (p.mine ? 'Твоя тусовка' : 'Зовёт ' + esc(p.host || '')) + '</span><button class="x" data-close="1">×</button></div>' +
    '<div class="card-top"><div class="cover">' + esc(p.emoji) + '</div><div style="flex:1;min-width:0"><div class="title" style="font-size:19px">' + esc(p.title) + '</div>' +
    '<div class="meta">' + metaHtml(p) + '</div>' + tagsHtml(p) + '</div></div>' +
    (p.desc ? '<div class="desc">' + esc(p.desc) + '</div>' : '') + barHtml(p) +
    (people ? '<div class="section-title">Кто идёт</div><div class="people">' + people + '</div>' : '') +
    '<div style="margin-top:18px">' + actions + '</div>' + invite +
    (extra ? '<div style="margin-top:14px">' + extra + '</div>' : '');
}
$('partyModal').addEventListener('click', function (e) {
  if (e.target === $('partyModal') || e.target.closest('[data-close]')) { haptic(); closeParty(); return; }
  var b = e.target.closest('[data-act]'); if (!b || !opened) return;
  var p = opened, act = b.dataset.act;
  if (act === 'share') { shareParty(p); return; }
  if (act === 'map') { closeParty(); openOnMap(p); return; }
  if (act === 'join' || act === 'leave') {
    busy(b, true);
    api(act, { id: p.id }).then(function (r) {
      opened = r.party; renderPartyModal();
      vibe(act === 'join' ? 'success' : 'warning');
      toast(act === 'join' ? 'Супер, ты в деле! 🎉' : 'Окей, отменили');
      refreshAll();
    }).catch(function (e) { vibe('error'); toast(e.message); busy(b, false); });
    return;
  }
  if (act === 'invite') {
    var un = ($('invUser').value || '').trim();
    if (!un) { toast('Впиши @username друга'); return; }
    busy(b, true);
    api('inviteUser', { id: p.id, username: un }).then(function () {
      vibe('success'); toast('Приглашение отправлено 💌'); $('invUser').value = '';
    }).catch(function (e) { vibe('error'); toast(e.message); }).then(function () { busy(b, false); });
    return;
  }
  if (act === 'delete') {
    var go = function () {
      api('delete', { id: p.id }).then(function () { toast('Тусовка удалена'); closeParty(); refreshAll(); })
        .catch(function (e) { toast(e.message); });
    };
    if (tg && tg.showConfirm) tg.showConfirm('Удалить тусовку «' + p.title + '»?', function (ok) { if (ok) go(); });
    else if (window.confirm('Удалить тусовку?')) go();
  }
});

// ===== Приглашения =====
function renderInvites() {
  var fresh = invites.filter(function (i) { return !i.joined; });
  var going = invites.filter(function (i) { return i.joined; });
  var row = function (i) {
    var btns = i.joined ? '' :
      '<div class="row"><button class="btn ghost" data-ans="no" data-id="' + esc(i.id) + '">Не смогу</button>' +
      '<button class="btn" data-ans="yes" data-id="' + esc(i.id) + '">Пойду! 🙌</button></div>';
    var from = '<div class="from"><span class="ava" style="background:' + colorFor(i.id) + '">' + esc(initials(i.from)) + '</span><span><b>' + esc(i.from) + '</b> зовёт тебя</span></div>';
    return partyCard(i, barHtml(i) + btns).replace('<div class="card-top">', from + '<div class="card-top">');
  };
  var html = '';
  if (fresh.length) html += '<div class="section-title">Новые</div>' + fresh.map(row).join('');
  if (going.length) html += '<div class="section-title">Я иду</div>' + going.map(row).join('');
  if (!html) html = '<div class="empty"><div class="big">📭</div>Приглашений пока нет.<br>Когда друг позовёт тебя по нику, приглашение появится здесь.</div>';
  $('invitesList').innerHTML = html;
  updateBadge();
}
$('invitesList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-ans]');
  if (b) {
    e.stopPropagation(); busy(b, true);
    var yes = b.dataset.ans === 'yes';
    api('answer', { id: b.dataset.id, yes: yes }).then(function (r) {
      invites = r.invites || []; renderInvites(); vibe(yes ? 'success' : 'warning');
      toast(yes ? 'Супер, ты в деле! 🎉' : 'Приглашение отклонено'); refreshParties();
    }).catch(function (er) { vibe('error'); toast(er.message); busy(b, false); });
    return;
  }
  var c = e.target.closest('[data-open]'); if (c) { haptic(); openParty(c.dataset.open); }
});
function updateBadge() {
  var n = invites.filter(function (i) { return !i.joined; }).length;
  $('badge').textContent = n ? n : '';
}

// ===== Профиль =====
function paintAvatar() {
  var a = $('avatar');
  if (me.photo) { a.style.backgroundImage = 'url("' + me.photo + '")'; a.textContent = ''; }
  else { a.style.backgroundImage = ''; a.textContent = initials(me.name); }
}
function renderInterestChips() {
  $('interestChips').innerHTML = INTERESTS.map(function (t) {
    return '<button type="button" class="chip' + (me.interests.indexOf(t) >= 0 ? ' on' : '') + '" data-i="' + esc(t) + '">' + esc(t) + '</button>';
  }).join('');
}
function fillProfileForm() {
  $('pName').value = me.name || ''; $('pAge').value = me.age || '';
  $('pDistrict').value = me.district || ''; $('pAbout').value = me.about || '';
  renderInterestChips();
}
function renderProfile() {
  paintAvatar();
  $('profName').textContent = me.name || 'Твоё имя';
  $('profUser').textContent = me.username ? '@' + me.username : '';
  var mine = parties.filter(function (p) { return p.mine; });
  var going = parties.filter(function (p) { return p.joined && !p.mine; });
  $('stCreated').textContent = mine.length;
  $('stGoing').textContent = going.length;
  $('myParties').innerHTML = mine.length ? mine.map(function (p) { return partyCard(p); }).join('') :
    '<div class="empty"><div class="big">🪩</div>Ты ещё не создал ни одной тусовки.<br>Жми на «+» внизу!</div>';
  $('goingParties').innerHTML = going.length ? going.map(function (p) { return partyCard(p); }).join('') :
    '<div class="empty" style="padding:16px">Пока никуда не записан — загляни на карту 🗺</div>';
}
['myParties', 'goingParties'].forEach(function (id) {
  $(id).addEventListener('click', function (e) { var c = e.target.closest('[data-open]'); if (c) { haptic(); openParty(c.dataset.open); } });
});
$('interestChips').addEventListener('click', function (e) {
  var b = e.target.closest('.chip'); if (!b) return;
  var t = b.dataset.i;
  me.interests = me.interests.indexOf(t) >= 0 ? me.interests.filter(function (x) { return x !== t; }) : me.interests.concat([t]);
  haptic(); renderInterestChips();
});
function saveProfile(msg) {
  return api('saveProfile', { name: me.name, age: me.age, district: me.district, about: me.about, interests: me.interests, photo: me.photo })
    .then(function () { vibe('success'); toast(msg || 'Профиль сохранён ✓'); })
    .catch(function (e) { vibe('error'); toast(e.message); });
}
$('saveProfile').onclick = function () {
  me.name = $('pName').value.trim(); me.age = $('pAge').value.trim();
  me.district = $('pDistrict').value.trim(); me.about = $('pAbout').value.trim();
  var b = $('saveProfile'); busy(b, true);
  saveProfile().then(function () { busy(b, false); renderProfile(); });
};
$('camBtn').onclick = function () { $('photoInput').click(); };
$('photoInput').onchange = function (e) {
  var f = e.target.files && e.target.files[0]; if (!f) return;
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      var size = 320, m = Math.min(img.width, img.height);
      var c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      me.photo = c.toDataURL('image/jpeg', 0.82);
      paintAvatar(); saveProfile('Фото обновлено 📸');
    };
    img.onerror = function () { toast('Не получилось открыть это фото'); };
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
  e.target.value = '';
};

// ===== Карта =====
var hasLeaflet = function () { return typeof window.L !== 'undefined'; };
function pinIcon(p, sel) {
  return L.divIcon({ className: '', html: '<div class="pin' + (p.mine ? ' mine' : '') + (sel ? ' sel' : '') + '"><span>' + esc(p.emoji) + '</span></div>', iconSize: [42, 42], iconAnchor: [21, 51] });
}
function addTiles(map) {
  L.tileLayer(TILE, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
}
var bigMap = null, mapLayer = null, meMarker = null, mapFilter = '', selectedId = null;
function mapParties() {
  return parties.filter(function (p) { return p.lat != null && (!mapFilter || p.type === mapFilter); });
}
function initBigMap() {
  if (!hasLeaflet()) { $('bigMap').innerHTML = '<div class="empty" style="padding-top:140px"><div class="big">🗺️</div>Карта не загрузилась.<br>Проверь интернет и открой приложение заново.</div>'; return; }
  if (bigMap) { bigMap.invalidateSize(); renderMap(); return; }
  bigMap = L.map('bigMap', { zoomControl: false }).setView(MSK, 12);
  addTiles(bigMap);
  mapLayer = L.layerGroup().addTo(bigMap);
  bigMap.on('click', function () { selectParty(null); });
  setTimeout(function () { bigMap.invalidateSize(); }, 300);
  renderMapFilters(); renderMap();
}
function renderMapFilters() {
  $('mapFilters').innerHTML = [''].concat(TYPES).map(function (t) {
    return '<button type="button" class="chip' + (t === mapFilter ? ' on' : '') + '" data-f="' + esc(t) + '">' + (t ? esc(t) : 'Все') + '</button>';
  }).join('');
}
function renderMap() {
  if (!bigMap) return;
  mapLayer.clearLayers();
  var list = mapParties();
  list.forEach(function (p) {
    var m = L.marker([p.lat, p.lng], { icon: pinIcon(p, p.id === selectedId), zIndexOffset: p.id === selectedId ? 1000 : 0 });
    m.on('click', function (ev) { L.DomEvent.stopPropagation(ev); selectParty(p.id); });
    m.addTo(mapLayer);
  });
  var n = list.length;
  $('mapCount').textContent = n ? n + ' ' + plural(n, 'тусовка', 'тусовки', 'тусовок') + ' на карте' : 'Здесь пока пусто — создай первую тусовку!';
  if (selectedId && !list.some(function (p) { return p.id === selectedId; })) selectParty(null);
}
function selectParty(id) {
  selectedId = id;
  renderMap();
  var sheet = $('mapSheet');
  var p = id ? parties.filter(function (x) { return x.id === id; })[0] : null;
  if (!p) { sheet.classList.add('hidden'); $('locateBtn').style.display = ''; return; }
  $('locateBtn').style.display = 'none';
  haptic();
  sheet.innerHTML = '<div class="card" style="margin:0">' +
    '<div class="card-top"><div class="cover">' + esc(p.emoji) + '</div><div style="flex:1;min-width:0"><div class="title">' + esc(p.title) + '</div>' +
    '<div class="meta">' + metaHtml(p) + '<br>👤 ' + (p.mine ? 'Твоя тусовка' : 'Зовёт ' + esc(p.host || '')) + '</div>' + tagsHtml(p) + '</div>' +
    '<button class="x" data-mclose="1">×</button></div>' + barHtml(p) +
    '<div class="row"><button class="btn" data-mopen="' + esc(p.id) + '">' + (p.mine || p.joined ? 'Открыть' : 'Подробнее и записаться') + '</button></div></div>';
  sheet.classList.remove('hidden');
}
$('mapFilters').addEventListener('click', function (e) {
  var b = e.target.closest('.chip'); if (!b) return;
  mapFilter = b.dataset.f; haptic(); renderMapFilters(); selectParty(null);
});
$('mapSheet').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mopen) openParty(b.dataset.mopen); else { haptic(); selectParty(null); }
});
function openOnMap(p) {
  mapFilter = ''; show('map');
  if (!bigMap) return;
  renderMapFilters(); bigMap.setView([p.lat, p.lng], 15); selectParty(p.id);
}
function getMyLocation(cb) {
  var viaBrowser = function () {
    if (!navigator.geolocation) return cb(null);
    navigator.geolocation.getCurrentPosition(function (pos) { cb([pos.coords.latitude, pos.coords.longitude]); }, function () { cb(null); }, { enableHighAccuracy: true, timeout: 10000 });
  };
  var lm = tg && tg.LocationManager;
  if (!lm || !lm.init) return viaBrowser();
  var run = function () {
    if (!lm.isLocationAvailable) return viaBrowser();
    lm.getLocation(function (d) { cb(d ? [d.latitude, d.longitude] : null); });
  };
  try { if (lm.isInited) run(); else lm.init(run); } catch (e) { viaBrowser(); }
}
$('locateBtn').onclick = function () {
  haptic(); toast('Ищем тебя…');
  getMyLocation(function (ll) {
    if (!ll) { toast('Не получилось — разреши доступ к геопозиции'); return; }
    if (!bigMap) return;
    var icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    if (meMarker) meMarker.setLatLng(ll); else meMarker = L.marker(ll, { icon: icon, interactive: false }).addTo(bigMap);
    bigMap.setView(ll, 14);
  });
};
window.addEventListener('resize', function () { if (bigMap) bigMap.invalidateSize(); if (pickMap) pickMap.invalidateSize(); });

// ===== Метка места при создании =====
var pickMap = null, pickMarker = null, pick = { lat: null, lng: null };
var PICK_HINT = 'Нажми на карту, чтобы поставить метку — так тусовку найдут люди поблизости';
function initPickMap() {
  if (!hasLeaflet()) {
    $('pickMap').style.display = 'none'; $('pickBtns').style.display = 'none';
    $('pickHint').textContent = 'Карта не загрузилась — тусовка будет без метки';
    return;
  }
  if (pickMap) { pickMap.invalidateSize(); return; }
  pickMap = L.map('pickMap', { zoomControl: false }).setView(MSK, 11);
  addTiles(pickMap);
  pickMap.on('click', function (e) { setPick(e.latlng.lat, e.latlng.lng, true); });
  setTimeout(function () { pickMap.invalidateSize(); }, 300);
}
function setPick(lat, lng, fillAddress) {
  pick.lat = lat; pick.lng = lng;
  var icon = pinIcon({ emoji: form.emoji, mine: true }, false);
  if (pickMarker) { pickMarker.setLatLng([lat, lng]); pickMarker.setIcon(icon); }
  else pickMarker = L.marker([lat, lng], { icon: icon }).addTo(pickMap);
  $('pickHint').textContent = '✓ Метка стоит — тусовку будет видно на карте';
  $('pickHint').classList.add('ok');
  haptic();
  if (fillAddress && !$('fPlace').value.trim()) reverseGeocode(lat, lng);
}
function resetPick() {
  pick.lat = pick.lng = null;
  if (pickMarker) { pickMarker.remove(); pickMarker = null; }
  $('pickHint').textContent = PICK_HINT; $('pickHint').classList.remove('ok');
}
function geocode(q) {
  var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&viewbox=37.3,55.95,37.95,55.55&q=' + encodeURIComponent(q);
  return fetch(url).then(function (r) { return r.json(); }).then(function (j) { return j && j[0] ? [+j[0].lat, +j[0].lon] : null; });
}
function reverseGeocode(lat, lng) {
  fetch('https://nominatim.openstreetmap.org/reverse?format=json&accept-language=ru&zoom=18&lat=' + lat + '&lon=' + lng)
    .then(function (r) { return r.json(); }).then(function (j) {
      var a = j.address || {};
      var street = [a.road || a.pedestrian || a.square, a.house_number].filter(Boolean).join(', ');
      var label = [j.name, street].filter(Boolean).join(', ') || a.suburb || '';
      if (label && !$('fPlace').value.trim()) $('fPlace').value = label;
    }).catch(function () {});
}
$('findAddr').onclick = function () {
  var q = $('fPlace').value.trim();
  if (!q) { $('fPlace').classList.add('err'); $('fPlace').focus(); toast('Сначала впиши адрес или место'); return; }
  if (!pickMap) return;
  haptic(); toast('Ищем на карте…');
  geocode(q).then(function (ll) {
    if (ll) { setPick(ll[0], ll[1], false); pickMap.setView(ll, 15); toast('Нашли! Если метка не там — нажми на карту'); }
    else toast('Не нашли — поставь метку вручную');
  }).catch(function () { toast('Поиск не сработал — поставь метку вручную'); });
};
$('pickMe').onclick = function () {
  if (!pickMap) return;
  haptic(); toast('Ищем тебя…');
  getMyLocation(function (ll) {
    if (!ll) { toast('Не получилось — разреши доступ к геопозиции'); return; }
    setPick(ll[0], ll[1], true); pickMap.setView(ll, 15);
  });
};

// ===== Поиск =====
var sf = { q: '', when: 'all', types: [], free: false, near: false, radius: 5, sort: 'date' };
var myPos = null;
var WHEN = [['all', 'Любое время'], ['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['weekend', 'Выходные'], ['week', '7 дней']];
var SORTS = [['date', 'Скоро'], ['near', 'Ближе ко мне'], ['popular', 'Популярные']];
var RADII = [1, 3, 5, 10, 25];
function km(a, b) {
  var toR = Math.PI / 180, dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function fmtKm(d) { return d < 1 ? Math.max(50, Math.round(d * 20) * 50) + ' м' : String(Math.round(d * 10) / 10).replace('.', ',') + ' км'; }
function whenRange(key) {
  var now = new Date(), day = 86400000;
  var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (key === 'today') return [d0, d0 + day];
  if (key === 'tomorrow') return [d0 + day, d0 + 2 * day];
  if (key === 'week') return [now.getTime() - 6 * 3600000, now.getTime() + 7 * day];
  if (key === 'weekend') { var wd = now.getDay(); var sat = wd === 0 ? d0 - day : d0 + (6 - wd) * day; return [sat, sat + 2 * day]; }
  return null;
}
function sChips(items, isOn, attr) {
  return items.map(function (it) {
    return '<button type="button" class="chip' + (isOn(it[0]) ? ' on' : '') + '" data-' + attr + '="' + esc(it[0]) + '">' + esc(it[1]) + '</button>';
  }).join('');
}
function renderSearchFilters() {
  $('sWhen').innerHTML = sChips(WHEN, function (k) { return sf.when === k; }, 'when');
  $('sTypes').innerHTML = sChips(TYPES.map(function (t) { return [t, t]; }), function (k) { return sf.types.indexOf(k) >= 0; }, 'type');
  $('sSort').innerHTML = sChips(SORTS, function (k) { return sf.sort === k; }, 'sort');
  $('sRadius').innerHTML = sChips(RADII.map(function (r) { return [String(r), 'до ' + r + ' км']; }), function (k) { return String(sf.radius) === k; }, 'radius');
  $('sRadiusWrap').style.display = sf.near ? '' : 'none';
  $('sQuery').value = sf.q; $('sFree').checked = sf.free; $('sNear').checked = sf.near;
}
function searchResults() {
  var q = sf.q.trim().toLowerCase(), range = whenRange(sf.when);
  var list = parties.filter(function (p) {
    if (q && [p.title, p.place, p.desc, p.type, p.host].join(' ').toLowerCase().indexOf(q) < 0) return false;
    if (sf.types.length && sf.types.indexOf(p.type) < 0) return false;
    if (sf.free && !p.joined && p.going >= p.max) return false;
    if (range) { var t = new Date(p.when).getTime(); if (t < range[0] || t >= range[1]) return false; }
    if (sf.near && (!myPos || p.lat == null || km(myPos, [p.lat, p.lng]) > sf.radius)) return false;
    return true;
  });
  list.forEach(function (p) { p._km = myPos && p.lat != null ? km(myPos, [p.lat, p.lng]) : null; });
  list.sort(function (a, b) {
    if (sf.sort === 'near') return (a._km == null ? 1e9 : a._km) - (b._km == null ? 1e9 : b._km);
    if (sf.sort === 'popular') return b.going - a.going;
    return new Date(a.when) - new Date(b.when);
  });
  return list;
}
function renderSearch() {
  var list = searchResults(), n = list.length;
  $('sCount').textContent = n ? 'Найдено: ' + n + ' ' + plural(n, 'тусовка', 'тусовки', 'тусовок') : '';
  $('sResults').innerHTML = n ? list.map(function (p) {
    return partyCard(p, p._km != null ? '<div class="bar-txt" style="margin-top:10px">🧭 ' + fmtKm(p._km) + ' от тебя</div>' : '');
  }).join('') : '<div class="empty"><div class="big">🔍</div>' +
    (parties.length ? 'Ничего не нашлось.<br>Попробуй ослабить фильтры.' : 'Пока тусовок нет.<br>Создай первую — жми «+» внизу!') + '</div>';
}
function needPos(cb) {
  if (myPos) return cb(true);
  toast('Определяем, где ты…');
  getMyLocation(function (ll) {
    if (ll) { myPos = ll; cb(true); } else { toast('Не получилось — разреши доступ к геопозиции'); cb(false); }
  });
}
$('s-search').addEventListener('click', function (e) {
  var b = e.target.closest('[data-when],[data-type],[data-sort],[data-radius]');
  if (b) {
    haptic();
    var d = b.dataset;
    if (d.when) sf.when = d.when;
    if (d.type) sf.types = sf.types.indexOf(d.type) >= 0 ? sf.types.filter(function (x) { return x !== d.type; }) : sf.types.concat([d.type]);
    if (d.radius) sf.radius = +d.radius;
    if (d.sort === 'near') { needPos(function (ok) { if (ok) { sf.sort = 'near'; renderSearchFilters(); renderSearch(); } }); return; }
    if (d.sort) sf.sort = d.sort;
    renderSearchFilters(); renderSearch(); return;
  }
  var c = e.target.closest('[data-open]'); if (c) { haptic(); openParty(c.dataset.open); }
});
$('sQuery').addEventListener('input', function () { sf.q = this.value; renderSearch(); });
$('sFree').addEventListener('change', function () { sf.free = this.checked; haptic(); renderSearch(); });
$('sNear').addEventListener('change', function () {
  haptic();
  if (!this.checked) { sf.near = false; renderSearchFilters(); renderSearch(); return; }
  needPos(function (ok) { sf.near = ok; renderSearchFilters(); renderSearch(); });
});
$('sReset').onclick = function () {
  sf = { q: '', when: 'all', types: [], free: false, near: false, radius: 5, sort: 'date' };
  haptic(); renderSearchFilters(); renderSearch();
};

// ===== Старт =====
function boot() {
  buildCreateForm();
  if (!tg) { $('gate').classList.remove('hidden'); return; }
  tg.ready(); tg.expand();
  try { tg.setHeaderColor('#0e0e13'); tg.setBackgroundColor('#0e0e13'); if (tg.setBottomBarColor) tg.setBottomBarColor('#101016'); } catch (e) {}
  try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
  show('create');
  api('me').then(function (r) {
    me = r.profile || me; me.interests = me.interests || [];
    fillProfileForm(); renderProfile();
    if (r.new) toast('Добро пожаловать в PartyGround! 🎉');
  }).catch(function (e) { toast(e.message); });
  refreshAll();
  var sp = (tg.initDataUnsafe && tg.initDataUnsafe.start_param) || new URLSearchParams(location.search).get('party') || '';
  sp = sp.replace(/^p_/, '');
  if (/^[a-f0-9]{6,20}$/.test(sp)) openParty(sp);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshAll(); });
}
boot();
})();
