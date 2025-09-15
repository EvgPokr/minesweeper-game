// Минималистичная реализация Сапёра: генерация поля, открытие, флаги, таймер, победа/поражение

(function () {
  'use strict';

  const boardEl = document.getElementById('board');
  const restartBtn = document.getElementById('restart');
  const sizeSelect = document.getElementById('size');
  const statusEl = document.getElementById('status');
  const timerEl = document.getElementById('timer');
  const flagsLeftEl = document.getElementById('flagsLeft');
  const bannerEl = document.getElementById('banner');
  const toggleAudioBtn = document.getElementById('toggleAudio');
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const helpClose = document.getElementById('helpClose');

  /** @typedef {{row:number,col:number,isMine:boolean,isOpen:boolean,isFlag:boolean,adjacent:number,el:HTMLElement|null}} Cell */

  let rows = 8;
  let cols = 8;
  let mines = 10;
  /** @type {Cell[][]} */
  let grid = [];
  let gameOver = false;
  let firstClickDone = false;
  let flagsLeft = mines;
  let openedSafeCells = 0;
  let totalSafeCells = rows * cols - mines;
  let timerId = null;
  let startedAt = null;

  // Web Audio API
  /** @type {AudioContext|null} */
  let audioCtx = null;
  let audioUnlocked = false;
  let audioEnabled = true;
  let bgIntervalId = null;
  let bgActive = false;

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    audioUnlocked = !!audioCtx;
  }

  function playTone(frequency, durationMs, type = 'sine', gainValue = 0.06) {
    if (!audioEnabled) return;
    if (!audioUnlocked || !audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = /** @type {OscillatorType} */(type);
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000);
  }

  function sfxOpen() {
    playTone(540, 80, 'triangle', 0.05);
  }

  function sfxFlag() {
    playTone(880, 60, 'square', 0.04);
  }

  function sfxWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => setTimeout(() => playTone(f, 120, 'sine', 0.06), i * 120));
  }

  function sfxLose() {
    // Взрыв: короткий шумовой импульс с фильтром и быстрым релизом
    if (!audioEnabled || !audioUnlocked || !audioCtx) return;
    const duration = 0.5;
    const sr = audioCtx.sampleRate;
    const buffer = audioCtx.createBuffer(1, sr * duration, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // белый шум с экспоненциальным затуханием
      const t = i / sr;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-6 * t);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, audioCtx.currentTime);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    src.connect(filter).connect(gain).connect(audioCtx.destination);
    src.start();
  }

  function bgStart() {
    if (!audioEnabled) return;
    ensureAudio();
    if (!audioUnlocked || !audioCtx) return;
    if (bgActive) return;
    bgActive = true;
    // Простой мягкий луп: арпеджио на синусе с тихой громкостью
    const patternHz = [220, 277, 330, 440]; // A, C#, E, A
    let step = 0;
    const playStep = () => {
      if (!bgActive) return;
      const f = patternHz[step % patternHz.length];
      playTone(f, 240, 'sine', 0.02);
      step++;
    };
    playStep();
    bgIntervalId = setInterval(playStep, 260);
  }

  function bgStop() {
    bgActive = false;
    if (bgIntervalId) {
      clearInterval(bgIntervalId);
      bgIntervalId = null;
    }
  }

  function updateAudioButton() {
    if (!toggleAudioBtn) return;
    if (audioEnabled) {
      toggleAudioBtn.textContent = '🔊';
      toggleAudioBtn.setAttribute('aria-label', 'Звук включен');
      toggleAudioBtn.title = 'Звук: вкл';
    } else {
      toggleAudioBtn.textContent = '🔇';
      toggleAudioBtn.setAttribute('aria-label', 'Звук выключен');
      toggleAudioBtn.title = 'Звук: выкл';
    }
  }

  function parseSizeValue(value) {
    const [r, c, m] = value.split('x').map(Number);
    return { r, c, m };
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function resetTimer() {
    stopTimer();
    startedAt = null;
    timerEl.textContent = '0';
  }

  function startTimer() {
    if (timerId) return;
    startedAt = Date.now();
    timerId = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      timerEl.textContent = String(seconds);
    }, 300);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function createEmptyGrid() {
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({ row: r, col: c, isMine: false, isOpen: false, isFlag: false, adjacent: 0, el: null });
      }
      grid.push(row);
    }
  }

  function forEachNeighbor(r, c, cb) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) cb(grid[nr][nc]);
      }
    }
  }

  function placeMinesAvoiding(firstR, firstC) {
    // Гарантируем первый клик безопасным: избегаем ячейку и её соседей
    const forbidden = new Set();
    forbidden.add(`${firstR}:${firstC}`);
    forEachNeighbor(firstR, firstC, (cell) => forbidden.add(`${cell.row}:${cell.col}`));

    const positions = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${r}:${c}`;
        if (!forbidden.has(key)) positions.push([r, c]);
      }
    }
    shuffleInPlace(positions);
    const toPlace = Math.min(mines, positions.length);
    for (let i = 0; i < toPlace; i++) {
      const [r, c] = positions[i];
      grid[r][c].isMine = true;
    }

    // Подсчитать числа
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c].isMine) continue;
        let count = 0;
        forEachNeighbor(r, c, (n) => { if (n.isMine) count++; });
        grid[r][c].adjacent = count;
      }
    }
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = `repeat(${cols}, 34px)`;
    boardEl.style.gridTemplateRows = `repeat(${rows}, 34px)`;
    boardEl.setAttribute('aria-rowcount', String(rows));
    boardEl.setAttribute('aria-colcount', String(cols));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        const el = document.createElement('button');
        el.className = 'cell closed';
        el.setAttribute('role', 'gridcell');
        el.setAttribute('data-r', String(r));
        el.setAttribute('data-c', String(c));
        el.setAttribute('aria-label', `y:${r + 1} x:${c + 1}`);
        cell.el = el;
        attachCellEvents(el, cell);
        boardEl.appendChild(el);
      }
    }
  }

  function updateFlagsLeft() {
    flagsLeftEl.textContent = String(flagsLeft);
  }

  function restart(fromSelectChange = false) {
    // Обновить размеры из селекта при необходимости
    const { r, c, m } = parseSizeValue(sizeSelect.value);
    rows = r; cols = c; mines = m;
    totalSafeCells = rows * cols - mines;
    firstClickDone = false;
    gameOver = false;
    flagsLeft = mines;
    openedSafeCells = 0;
    resetTimer();
    setStatus('');
    if (bannerEl) { bannerEl.style.display = 'none'; bannerEl.innerHTML = ''; }
    createEmptyGrid();
    renderBoard();
    updateFlagsLeft();
    if (!fromSelectChange) boardEl.focus();
  }

  function attachCellEvents(el, cell) {
    // ЛКМ — открыть
    el.addEventListener('click', (e) => {
      e.preventDefault();
      onOpen(cell);
    });

    // ПКМ — флаг
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onToggleFlag(cell);
    });

    // Долгое нажатие для тач — флаг
    let touchTimer = null;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length > 1) return; // игнор мультитач
      touchTimer = setTimeout(() => onToggleFlag(cell), 450);
    });
    ['touchend', 'touchcancel', 'touchmove'].forEach((evt) =>
      el.addEventListener(evt, () => {
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
      })
    );
  }

  function onOpen(cell) {
    if (gameOver || cell.isOpen || cell.isFlag) return;

    if (!firstClickDone) {
      firstClickDone = true;
      placeMinesAvoiding(cell.row, cell.col);
      startTimer();
      ensureAudio();
      bgStart();
    }

    if (cell.isMine) {
      revealMine(cell, true);
      endGame(false);
      return;
    }

    floodOpen(cell);
    sfxOpen();
    checkWin();
  }

  function floodOpen(startCell) {
    const stack = [startCell];
    while (stack.length) {
      const cell = stack.pop();
      if (cell.isOpen || cell.isFlag) continue;
      cell.isOpen = true;
      cell.el.classList.remove('closed');
      cell.el.classList.add('open');
      cell.el.setAttribute('aria-disabled', 'true');
      openedSafeCells++;

      if (cell.adjacent > 0) {
        cell.el.textContent = String(cell.adjacent);
        cell.el.classList.add(`n${cell.adjacent}`);
      } else {
        cell.el.textContent = '';
        // распространить на соседей только если 0
        forEachNeighbor(cell.row, cell.col, (n) => {
          if (!n.isOpen && !n.isMine) stack.push(n);
        });
      }
    }
  }

  function onToggleFlag(cell) {
    if (gameOver || cell.isOpen) return;
    if (!firstClickDone) {
      // Разрешаем ставить флаги до первого открытия — без таймера
    }
    if (cell.isFlag) {
      cell.isFlag = false;
      cell.el.classList.remove('flag');
      cell.el.innerHTML = '';
      cell.el.setAttribute('aria-label', `y:${cell.row + 1} x:${cell.col + 1}`);
      flagsLeft++;
    } else {
      if (flagsLeft <= 0) return;
      cell.isFlag = true;
      cell.el.classList.add('flag');
      // Псевдоэлемент ::after отрисует флаг
      cell.el.innerHTML = '';
      cell.el.setAttribute('aria-label', `Флаг y:${cell.row + 1} x:${cell.col + 1}`);
      flagsLeft--;
    }
    updateFlagsLeft();
    ensureAudio();
    sfxFlag();
  }

  function revealMine(cell, exploded) {
    cell.el.classList.remove('closed');
    cell.el.classList.add('mine');
    if (exploded) cell.el.classList.add('exploded');
    // Псевдоэлемент ::after отрисует мину
    cell.el.innerHTML = '';
  }

  function revealAllMines() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.isMine && !cell.isOpen) revealMine(cell, false);
      }
    }
  }

  function endGame(won) {
    gameOver = true;
    stopTimer();
    const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
    if (!won) revealAllMines();
    setStatus(''); // Убираем отображение статуса в верхнем меню
    if (bannerEl) {
      bannerEl.style.display = 'inline-flex';
      bannerEl.innerHTML = `${won ? 'Победа!' : 'Вы проиграли.'} Время: ${elapsed}s <button id="playAgain">Сыграть снова</button>`;
      const btn = document.getElementById('playAgain');
      if (btn) btn.addEventListener('click', () => restart());
    }
    try { restartBtn.focus(); } catch (_) {}
    ensureAudio();
    won ? sfxWin() : sfxLose();
    bgStop();
  }

  function checkWin() {
    if (openedSafeCells >= totalSafeCells) {
      endGame(true);
    }
  }

  // Контролы
  restartBtn.addEventListener('click', () => restart());
  sizeSelect.addEventListener('change', () => restart(true));
  if (toggleAudioBtn) {
    toggleAudioBtn.addEventListener('click', () => {
      ensureAudio();
      audioEnabled = !audioEnabled;
      updateAudioButton();
      if (!audioEnabled) {
        bgStop();
      } else if (!gameOver && firstClickDone) {
        bgStart();
      }
    });
    updateAudioButton();
  }

  // Помощь (модалка)
  function openHelp() {
    if (!helpModal) return;
    helpModal.style.display = 'grid';
    helpModal.setAttribute('aria-hidden', 'false');
  }
  function closeHelp() {
    if (!helpModal) return;
    helpModal.setAttribute('aria-hidden', 'true');
    helpModal.style.display = 'none';
  }
  if (helpBtn) helpBtn.addEventListener('click', openHelp);
  if (helpClose) helpClose.addEventListener('click', closeHelp);
  if (helpModal) helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(); });

  // Инициализация
  restart();
})();






