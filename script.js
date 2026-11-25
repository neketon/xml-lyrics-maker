'use strict';

const $ = (id) => document.getElementById(id);
let generatedBlob = null;

$('generateBtn').addEventListener('click', generate);
$('downloadBtn').addEventListener('click', download);

// ------------------------------------------------------------------
// Главная функция
// ------------------------------------------------------------------
async function generate() {
  const status = $('status');
  status.textContent = '';
  status.className = 'status';
  generatedBlob = null;
  $('downloadBtn').disabled = true;

  try {
    // --- 1. Читаем входные данные ---
    const fileInput = $('xmlFile');
    if (!fileInput.files.length) throw new Error('Загрузите XML-шаблон');

    const xmlText = await fileInput.files[0].text();
    const lyricsText = $('lyrics').value.trim();
    if (!lyricsText) throw new Error('Введите текст песни');

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

    const fps = parseInt(scene.getAttribute('fps'), 10) || 30;
    const frameMs = 1000 / fps;
    const chunkMs = frameMs * framesPerChunk;

    // --- 3. Находим слой-образец ---
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

    // --- 5. Генерируем описание слоёв ---
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

    // --- 6. Собираем новый XML ---
    // Удаляем все старые <text>-слои
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

    // Обновляем длительность сцены
    const totalTime = layers.length ? layers[layers.length - 1].endTime + 1 : 0;
    scene.setAttribute('totalTime', String(totalTime));

    // Синхронизируем audio.endTime (если он есть)
    const audio = scene.querySelector('audio');
    if (audio) {
      const audioEnd = parseInt(audio.getAttribute('endTime'), 10) || totalTime;
      audio.setAttribute('endTime', String(Math.min(audioEnd, totalTime)));
    }

    // --- 7. Сериализация ---
    const serializer = new XMLSerializer();
    let out = serializer.serializeToString(xmlDoc);
    if (!/^<\?xml/.test(out)) {
      out = "<?xml version='1.0' encoding='UTF-8' ?>\n" + out;
    }
    generatedBlob = new Blob([out], { type: 'application/xml' });

    // --- 8. UI ---
    renderPreview(layers);
    $('previewCard').hidden = false;
    $('downloadBtn').disabled = false;

    status.textContent = `Готово: ${layers.length} слоёв, длительность ${(totalTime / 1000).toFixed(2)} с.`;
    status.className = 'status success';
  } catch (err) {
    console.error(err);
    status.textContent = 'Ошибка: ' + err.message;
    status.className = 'status error';
  }
}

// ------------------------------------------------------------------
// Разбиение слов на чанки: короткое слово + следующее за ним
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
  // Если последний чанк — одинокое короткое слово, склеиваем с предыдущим
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

// ------------------------------------------------------------------
// Предпросмотр (упрощённый, без реального fps)
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
  const url = URL.createObjectURL(generatedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lyrics_animation.xml';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
