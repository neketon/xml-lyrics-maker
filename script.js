'use strict';

const $ = (id) => document.getElementById(id);
let generatedBlob = null;
let lastXmlDoc = null;   // последний собранный XML-документ (для «Применить имя»)

// ------------------------------------------------------------------
// Встроенный шаблон по умолчанию
// ------------------------------------------------------------------
const DEFAULT_TEMPLATE = `<?xml version='1.0' encoding='UTF-8' ?>
<!--
Created by Alight Motion (http://alightmotion.com)
Exported: 2026-11-25 11:25 PM
6.2.61 (871)
-->
<scene title="Шаблон" width="1440" height="1080" exportWidth="1920" exportHeight="1080" bgcolor="#FF000000" totalTime="14233" fps="30" modifiedTime="1795638324506" amver="871" ffver="107" am="com.alightcreative.motion/6.2.61" amplatform="ios" precompose="dynamicResolution" retime="freeze">
  <media uri="am-internal:///32FAA49D17E945F64998CA7EE36570884FCC9BD2.MP4" type="video/mp4" duration="18273" size="743292" fps="30" infoUpdated="1795269468790" width="768" height="576"/>
  <audio id="1" startTime="0" endTime="14233" src="am-internal:///32FAA49D17E945F64998CA7EE36570884FCC9BD2.MP4"/>
  <text id="2" label="Слой текста" startTime="0" endTime="14233" fillType="color" size="24.000000" font="imported?name=arialnarrow.ttf" wrapWidth="1182" align="center">
    <transform>
      <location value="718.173706,533.973694,0.000000"/>
      <scale value="0.612521,0.662536"/>
    </transform>
    <effect id="com.alightcreative.effects.textspacing" locallyApplied="true">
      <property name="linespacing" type="float" value="0.950000"/>
    </effect>
    <effect id="com.alightcreative.effects.pinchbulge2" locallyApplied="true">
      <property name="radius" type="float" value="2.500000"/>
      <property name="strength" type="float" value="0.350000"/>
    </effect>
    <effect id="com.alightcreative.effects.stretch2" locallyApplied="true">
      <property name="scale" type="float" value="0.970000"/>
    </effect>
    <effect id="com.alightcreative.effects.stretch2" locallyApplied="true">
      <property name="angle" type="float" value="90.000000"/>
      <property name="scale" type="float" value="0.910000"/>
    </effect>
    <path-stroke direction="centered" end-size="1.5">
      <color value="#FFFFFFFF"/>
      <size value="0.000000"/>
    </path-stroke>
    <shadow direction="outside">
      <opacity value="0.800000"/>
      <size value="1.000000"/>
      <hardness value="1.000000"/>
      <offset value="-3.000000,-3.000000"/>
    </shadow>
    <content>мы</content>
  </text>
</scene>`;

// ------------------------------------------------------------------
// Подписки на события
// ------------------------------------------------------------------
$('generateBtn').addEventListener('click', generate);
$('downloadBtn').addEventListener('click', download);
$('lowercaseBtn').addEventListener('click', toLowercase);
$('downloadTemplateBtn').addEventListener('click', downloadTemplate);
$('applyNameBtn').addEventListener('click', applyProjectName);
$('xmlFile').addEventListener('change', handleTemplateChange);

// ------------------------------------------------------------------
// Загрузка шаблона → подставляем title в поле
// ------------------------------------------------------------------
async function handleTemplateChange() {
  const fi = $('xmlFile');
  try {
    if (!fi.files.length) {
      const doc = new DOMParser().parseFromString(DEFAULT_TEMPLATE, 'application/xml');
      const t = doc.querySelector('scene')?.getAttribute('title') || 'Шаблон';
      $('projectName').value = t;
      return;
    }
    const text = await fi.files[0].text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const t = doc.querySelector('scene')?.getAttribute('title');
    if (t) $('projectName').value = t;
  } catch (_) {
    // Тихо игнорируем — если файл битый, генерация всё равно покажет ошибку
  }
}

// ------------------------------------------------------------------
// Кнопка: убрать заглавные буквы
// ------------------------------------------------------------------
function toLowercase() {
  const ta = $('lyrics');
  if (!ta.value) return;
  ta.value = ta.value.toLowerCase();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ------------------------------------------------------------------
// Кнопка: скачать встроенный шаблон
// ------------------------------------------------------------------
function downloadTemplate() {
  const blob = new Blob([DEFAULT_TEMPLATE], { type: 'application/xml' });
  triggerDownload(blob, 'template-default.xml');
}

// ------------------------------------------------------------------
// Кнопка: применить имя к уже сгенерированному XML
// ------------------------------------------------------------------
function applyProjectName() {
  const name = ($('projectName').value || '').trim();
  if (!name) return showStatus('Введите имя проекта', 'error');
  if (!lastXmlDoc) return showStatus('Сначала сгенерируйте XML — имя подставится автоматически', 'info');
  const scene = lastXmlDoc.querySelector('scene');
  if (!scene) return showStatus('В документе нет <scene>', 'error');

  scene.setAttribute('title', name);
  generatedBlob = serializeToBlob(lastXmlDoc);
  $('downloadBtn').disabled = false;
  showStatus(`Имя проекта изменено на «${name}»`, 'success');
}

// ------------------------------------------------------------------
// Главная функция генерации
// ------------------------------------------------------------------
async function generate() {
  generatedBlob = null;
  lastXmlDoc = null;
  $('downloadBtn').disabled = true;

  try {
    // --- 1. Входные данные ---
    const fileInput = $('xmlFile');
    const xmlText = fileInput.files.length
      ? await fileInput.files[0].text()
      : DEFAULT_TEMPLATE;

    const lyricsText = $('lyrics').value.trim();
    if (!lyricsText) throw new Error('Введите текст песни');

    const projectName = ($('projectName').value || '').trim() || 'Lyrics Animation';
    const framesPerChunk = clampInt($('framesPerWord').value, 1, 120, 10);
    const shortWords = $('shortWords').value
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // --- 2. Парсим XML ---
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    const parseErr = xmlDoc.querySelector('parsererror');
    if (parseErr) throw new Error('Ошибка парсинга XML: ' + parseErr.textContent.slice(0, 200));

    const scene = xmlDoc.querySelector('scene');
    if (!scene) throw new Error('Не найден элемент <scene>');

    // Имя проекта применяем сразу при сборке
    scene.setAttribute('title', projectName);

    const fps = parseInt(scene.getAttribute('fps'), 10) || 30;
    const frameMs = 1000 / fps;
    const chunkMs = frameMs * framesPerChunk;

    // --- 3. Слой-образец ---
    const templateLayer = scene.querySelector('text');
    if (!templateLayer) throw new Error('В шаблоне нет <text>-слоя');
    if (!templateLayer.querySelector('content'))
      throw new Error('В текстовом слое нет <content>');

    // --- 4. Разбиваем текст на чанки ---
    const lines = lyricsText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Текст пуст');

    const plan = lines.map(line => {
      const words = line.split(/\s+/).filter(Boolean);
      return splitIntoChunks(words, shortWords);
    });

    // --- 5. План слоёв ---
    const layers = [];
    let currentMs = 0;
    let layerId = nextLayerId(scene);

    for (const chunks of plan) {
      let accumulated = '';
      for (const chunk of chunks) {
        accumulated = accumulated ? accumulated + ' ' + chunk : chunk;
        const startTime = Math.round(currentMs);
        currentMs += chunkMs;
        const endTime = Math.round(currentMs) - 1;
        layers.push({ id: layerId++, text: accumulated, startTime, endTime });
      }
    }

    // --- 6. Собираем XML ---
    scene.querySelectorAll('text').forEach(t => t.remove());

    for (const layer of layers) {
      const node = templateLayer.cloneNode(true);
      node.setAttribute('id', String(layer.id));
      node.setAttribute('startTime', String(layer.startTime));
      node.setAttribute('endTime', String(layer.endTime));
      node.setAttribute('label', layer.text.length > 60 ? layer.text.slice(0, 60) + '…' : layer.text);
      node.querySelector('content').textContent = layer.text;
      scene.appendChild(node);
    }

    const totalTime = layers.length ? layers[layers.length - 1].endTime + 1 : 0;
    scene.setAttribute('totalTime', String(totalTime));

    const audio = scene.querySelector('audio');
    if (audio) {
      const audioEnd = parseInt(audio.getAttribute('endTime'), 10) || totalTime;
      audio.setAttribute('endTime', String(Math.min(audioEnd, totalTime)));
    }

    // --- 7. Сериализация ---
    generatedBlob = serializeToBlob(xmlDoc);
    lastXmlDoc = xmlDoc;

    // --- 8. UI ---
    renderPreview(layers);
    $('previewCard').hidden = false;
    $('downloadBtn').disabled = false;

    const usedDefault = !fileInput.files.length;
    showStatus(
      `Готово: ${layers.length} слоёв, ${(totalTime / 1000).toFixed(2)} с. Проект: «${projectName}».` +
      (usedDefault ? ' (встроенный шаблон)' : ''),
      'success'
    );
  } catch (err) {
    console.error(err);
    showStatus('Ошибка: ' + err.message, 'error');
  }
}

// ------------------------------------------------------------------
// Разбиение слов на чанки
// ------------------------------------------------------------------
function splitIntoChunks(words, shortWords) {
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (isShort(w, shortWords) && i + 1 < words.length) {
      chunks.push(w + ' ' + words[i + 1]);
      i += 2;
    } else {
      chunks.push(w);
      i += 1;
    }
  }
  if (chunks.length > 1 && isShort(chunks[chunks.length - 1], shortWords)) {
    const last = chunks.pop();
    chunks[chunks.length - 1] += ' ' + last;
  }
  return chunks;
}

function isShort(word, shortWords) {
  const clean = word.toLowerCase().replace(/[^а-яёa-z0-9]/g, '');
  return clean.length > 0 && shortWords.includes(clean);
}

// ------------------------------------------------------------------
// Утилиты
// ------------------------------------------------------------------
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nextLayerId(scene) {
  let maxId = 0;
  scene.querySelectorAll('[id]').forEach(el => {
    const n = parseInt(el.getAttribute('id'), 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  });
  return maxId + 1;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function serializeToBlob(doc) {
  const serializer = new XMLSerializer();
  let out = serializer.serializeToString(doc);
  if (!/^<\?xml/.test(out)) {
    out = "<?xml version='1.0' encoding='UTF-8' ?>\n" + out;
  }
  return new Blob([out], { type: 'application/xml' });
}

function showStatus(msg, type = 'info') {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status ' + type;
}

// ------------------------------------------------------------------
// Предпросмотр
// ------------------------------------------------------------------
function renderPreview(layers) {
  const box = $('preview');
  let i = 0;
  const tick = () => {
    if (i >= layers.length) {
      box.innerHTML = '<span style="color:#555;font-size:0.9rem">— конец предпросмотра —</span>';
      return;
    }
    const l = layers[i++];
    const dur = l.endTime - l.startTime + 1;
    box.innerHTML = `
      <div>
        <div class="layer-text">${escapeHtml(l.text)}</div>
        <div class="layer-meta">id=${l.id} · ${l.startTime}–${l.endTime} мс (${dur} мс)</div>
      </div>`;
    setTimeout(tick, Math.min(dur, 600));
  };
  tick();
}

// ------------------------------------------------------------------
// Скачивание
// ------------------------------------------------------------------
function download() {
  if (!generatedBlob) return;
  triggerDownload(generatedBlob, 'lyrics_animation.xml');
}
