/**
 * app.js - Orquestador del flujo, lógica de estados y UI
 * Maneja los eventos de botones, transiciones de pantalla y bucles de detección de tono.
 */

// Estado global accesible por sketch.js
window.appState = {
  currentScreen: 'welcome', // welcome, mic-error, calibration, voice-results, pitch-challenge, final-results
  detectedHz: 0,
  detectedNote: '--',
  volume: 0,
  centsDeviation: 0,
  isInTune: false,
  
  // Datos del Estadio 1 (Calibración)
  calibration: {
    step: 'low', // 'low' (grave), 'high' (agudo), 'done'
    lowHz: 0,
    lowNote: '--',
    highHz: 0,
    highNote: '--',
    isStable: false,
    stableTimer: 0, // Tiempo acumulado cantando nota estable
  },
  
  // Datos del Estadio 2 (Desafío de Escalas)
  challenge: {
    voiceType: 'Bajo', // Bajo, Tenor, Alto, Soprano (determinado o manual)
    scaleNotes: [], // Lista de notas MIDI
    currentStepIndex: 0, // 0 a 4 (5 notas)
    state: 'idle', // 'idle', 'listen', 'sing', 'scoring', 'done'
    targetMidi: 0,
    targetHz: 0,
    targetNoteName: '--',
    holdProgress: 0, // 0 a 100 (cuánto tiempo ha mantenido afinado)
    score: 0,
    centsAcc: 0, // Acumulador de cents para promedio
    centsCount: 0, // Contador de muestras de cents válidas
    allNotesResults: [] // Resultados por nota para el reporte final
  },
  
  vocalProfile: {
    type: '--',
    rangeStr: '--',
    hzRangeStr: '--',
    octaves: 0
  }
};

// Rangos de voz coral estándar
const VOICE_RANGES = {
  'Soprano': { min: 240, max: 1100, label: 'Soprano', desc: 'Voz femenina aguda. Destaca por su brillantez, agilidad y capacidad para cantar melodías celestiales en los registros más altos.' },
  'Alto': { min: 170, max: 700, label: 'Alto / Contralto', desc: 'Voz femenina grave. Aporta calidez, cuerpo y riqueza armónica fundamental en las secciones medias del coro.' },
  'Tenor': { min: 120, max: 460, label: 'Tenor', desc: 'Voz masculina aguda. Caracterizada por su potencia en el registro de pecho y cabeza, liderando habitualmente las melodías masculinas.' },
  'Bajo': { min: 60, max: 360, label: 'Bajo / Barítono', desc: 'Voz masculina grave. Proporciona la base armónica, cimientos profundos y resonancias majestuosas del ensamble.' }
};

// Escalas musicales para entrenamiento (5 notas - escala pentatónica o mayor inicial)
// Se definen en números de nota MIDI
const SCALES_BY_VOICE = {
  'Bajo': [48, 50, 52, 53, 55],       // C3, D3, E3, F3, G3
  'Tenor': [55, 57, 59, 60, 62],      // G3, A3, B3, C4, D4
  'Alto': [60, 62, 64, 65, 67],       // C4, D4, E4, F4, G4
  'Soprano': [67, 69, 71, 72, 74]     // G4, A4, B4, C5, D5
};

// Elementos del DOM
const screens = {
  'welcome': document.getElementById('screen-welcome'),
  'mic-error': document.getElementById('screen-mic-error'),
  'calibration': document.getElementById('screen-calibration'),
  'voice-results': document.getElementById('screen-voice-results'),
  'pitch-challenge': document.getElementById('screen-pitch-challenge'),
  'final-results': document.getElementById('screen-final-results')
};

// Inicialización de Lucide Icons al cargar
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  setupEventListeners();
  setupTheme();
});

// Configuración del Tema
function setupTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  
  // Guardar preferencia de tema
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  
  themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

// Navegación entre pantallas
function showScreen(screenId) {
  Object.keys(screens).forEach(key => {
    if (screens[key]) {
      screens[key].classList.remove('active');
    }
  });
  
  const target = screens[screenId];
  if (target) {
    target.classList.add('active');
    window.appState.currentScreen = screenId;
  }
}

// Controlar errores de inicialización del micrófono de forma detallada
function handleMicError(err) {
  console.error("Error detallado del micrófono:", err);
  const detailsEl = document.getElementById('mic-error-details');
  if (detailsEl) {
    let msg = err.message || err.toString();
    if (msg.includes("SecureContextError")) {
      msg = "⚠️ Error de Seguridad: El navegador requiere una conexión segura (HTTPS o localhost) para permitir el uso del micrófono. Por favor accede mediante http://localhost:5173 en lugar de la dirección IP 127.0.0.1.";
    } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = "⚠️ Permiso Denegado: Has bloqueado o cancelado el acceso al micrófono. Habilítalo en la configuración de tu navegador (haz clic en el icono del micrófono/candado a la izquierda de la barra de direcciones) y pulsa Reintentar.";
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = "⚠️ Dispositivo no encontrado: No se detectó ningún micrófono físico o canal de entrada activo en tu sistema.";
    } else {
      msg = `⚠️ Error de sistema: ${msg}`;
    }
    detailsEl.innerText = msg;
    detailsEl.style.display = 'block';
  }
  showScreen('mic-error');
}

// Configurar los eventos de botones y controles
function setupEventListeners() {
  // Pantalla de Bienvenida -> Iniciar Audio y Calibración
  document.getElementById('btn-start').addEventListener('click', async () => {
    try {
      await audioManager.init();
      startCalibrationStage();
    } catch (err) {
      handleMicError(err);
    }
  });

  // Pantalla de error -> Reintentar
  document.getElementById('btn-retry-mic').addEventListener('click', async () => {
    try {
      await audioManager.init();
      startCalibrationStage();
    } catch (err) {
      handleMicError(err);
    }
  });

  // Botón Siguiente en Calibración (Estadio 1)
  document.getElementById('btn-next-calib').addEventListener('click', () => {
    if (window.appState.calibration.step === 'low') {
      // Pasar a calibración de agudos
      window.appState.calibration.step = 'high';
      window.appState.calibration.isStable = false;
      window.appState.calibration.stableTimer = 0;
      
      document.getElementById('calib-instruction-title').innerText = "Canta tu nota más AGUDA";
      document.getElementById('calib-instruction-desc').innerText = "Haz un tono cómodo tan alto como puedas y sostenlo por 2 segundos.";
      document.getElementById('calibration-progress').style.width = "50%";
      document.getElementById('btn-next-calib').disabled = true;
    } else if (window.appState.calibration.step === 'high') {
      // Procesar resultados de voz
      window.appState.calibration.step = 'done';
      calculateVoiceTypeResults();
    }
  });

  // Botón Continuar al Desafío de Afinación (Estadio 2)
  document.getElementById('btn-proceed-scale').addEventListener('click', () => {
    startPitchChallengeStage();
  });

  // Botón Escuchar Nota del desafío
  document.getElementById('btn-hear-note').addEventListener('click', () => {
    if (window.appState.challenge.state === 'idle' || window.appState.challenge.state === 'sing') {
      playCurrentChallengeNote();
    }
  });

  // Botón Iniciar Canto en el desafío
  document.getElementById('btn-start-singing').addEventListener('click', () => {
    startSingingPhase();
  });

  // Reiniciar Prueba
  document.getElementById('btn-restart').addEventListener('click', () => {
    resetApp();
    showScreen('welcome');
  });

  // Botón Compartir (Simulación premium)
  document.getElementById('btn-share').addEventListener('click', () => {
    const text = `¡Acabo de probar mi voz en CoralTester! Soy cuerda ${window.appState.vocalProfile.type} con una afinación del ${window.appState.challenge.score}%. ¡Pruébalo tú también!`;
    if (navigator.share) {
      navigator.share({
        title: 'CoralTester Result',
        text: text,
        url: window.location.href,
      }).catch(console.error);
    } else {
      // Fallback: copiar al portapapeles
      navigator.clipboard.writeText(text);
      alert("¡Resultado copiado al portapapeles para compartir!");
    }
  });
}

// Bucle principal de análisis de Pitch (corre continuamente si el audio está activo)
let analysisLoopId = null;

function startAnalysisLoop() {
  if (analysisLoopId) return;
  
  function analyze() {
    if (!audioManager.isInitialized) {
      analysisLoopId = null;
      return;
    }

    const buffer = audioManager.getAudioData();
    if (buffer) {
      const sampleRate = audioManager.getSampleRate();
      const freq = autoCorrelate(buffer, sampleRate);
      
      // Medir volumen aproximado (RMS)
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sum / buffer.length);
      window.appState.volume = rms;

      if (freq > 0) {
        const midi = frequencyToMidi(freq);
        const noteName = midiToNoteName(midi);
        
        window.appState.detectedHz = freq;
        window.appState.detectedNote = noteName;

        // Procesar según pantalla actual
        if (window.appState.currentScreen === 'calibration') {
          processCalibrationPitch(freq, noteName);
        } else if (window.appState.currentScreen === 'pitch-challenge' && window.appState.challenge.state === 'sing') {
          processChallengePitch(freq, midi);
        }
      } else {
        // No hay voz detectada o volumen bajo
        window.appState.detectedHz = 0;
        window.appState.detectedNote = '--';
        window.appState.centsDeviation = 0;
        window.appState.isInTune = false;
        
        if (window.appState.currentScreen === 'calibration') {
          document.getElementById('calib-status-text').innerText = "Esperando voz...";
          document.getElementById('calib-volume-bar').style.width = `${Math.min(rms * 300, 100)}%`;
        }
      }
    }
    
    analysisLoopId = requestAnimationFrame(analyze);
  }
  
  analyze();
}

function stopAnalysisLoop() {
  if (analysisLoopId) {
    cancelAnimationFrame(analysisLoopId);
    analysisLoopId = null;
  }
}

// ==========================================
// ESTADIO 1: LÓGICA DE CALIBRACIÓN
// ==========================================

function startCalibrationStage() {
  showScreen('calibration');
  window.appState.calibration.step = 'low';
  window.appState.calibration.lowHz = 0;
  window.appState.calibration.lowNote = '--';
  window.appState.calibration.highHz = 0;
  window.appState.calibration.highNote = '--';
  window.appState.calibration.isStable = false;
  window.appState.calibration.stableTimer = 0;
  
  document.getElementById('calib-instruction-title').innerText = "Canta tu nota más GRAVE";
  document.getElementById('calib-instruction-desc').innerText = "Haz un sonido cómodo tan bajo como puedas y sostenlo por 2 segundos.";
  document.getElementById('calibration-progress').style.width = "10%";
  document.getElementById('btn-next-calib').disabled = true;
  
  // Limpiar DOM de calibración
  document.getElementById('val-low-note').innerText = "--";
  document.getElementById('val-low-hz').innerText = "0 Hz";
  document.getElementById('val-high-note').innerText = "--";
  document.getElementById('val-high-hz').innerText = "0 Hz";
  
  startAnalysisLoop();
}

/**
 * Procesa la afinación en tiempo real durante la calibración de graves/agudos.
 * Requiere que el tono se mantenga estable por unos momentos.
 */
let lastStableFreq = 0;
let stableCount = 0;

function processCalibrationPitch(freq, noteName) {
  const rms = window.appState.volume;
  
  // Actualizar UI
  document.getElementById('calib-note').innerText = noteName;
  document.getElementById('calib-hz').innerText = `${freq.toFixed(1)} Hz`;
  document.getElementById('calib-volume-bar').style.width = `${Math.min(rms * 300, 100)}%`;

  // Comprobar estabilidad de frecuencia basada en semitonos (permite vibrato natural)
  const currentMidi = frequencyToMidi(freq);
  const lastMidi = frequencyToMidi(lastStableFreq);
  if (Math.abs(currentMidi - lastMidi) < 0.8) { // Diferencia menor a 80 cents (menos de un semitono)
    stableCount++;
  } else {
    stableCount = 0;
    lastStableFreq = freq;
  }

  const currentStep = window.appState.calibration.step;

  if (stableCount > 10) { // Cerca de 200ms de estabilidad
    document.getElementById('calib-status-text').innerText = "¡Manteniendo nota estable!";
    
    // Acumular tiempo de estabilidad
    window.appState.calibration.stableTimer += 1;
    
    // Completar el paso si se mantiene ~1.5 segundos (aprox 45 frames a 30fps)
    if (window.appState.calibration.stableTimer > 40) {
      if (currentStep === 'low') {
        window.appState.calibration.lowHz = freq;
        window.appState.calibration.lowNote = noteName;
        document.getElementById('val-low-note').innerText = noteName;
        document.getElementById('val-low-hz').innerText = `${freq.toFixed(1)} Hz`;
        document.getElementById('btn-next-calib').disabled = false;
        document.getElementById('calib-status-text').innerText = "¡Nota baja capturada! Presiona Siguiente.";
      } else if (currentStep === 'high') {
        // Para agudo, asegurar que sea más alta que la baja capturada
        if (freq > window.appState.calibration.lowHz * 1.2) {
          window.appState.calibration.highHz = freq;
          window.appState.calibration.highNote = noteName;
          document.getElementById('val-high-note').innerText = noteName;
          document.getElementById('val-high-hz').innerText = `${freq.toFixed(1)} Hz`;
          document.getElementById('btn-next-calib').disabled = false;
          document.getElementById('calib-status-text').innerText = "¡Nota alta capturada! Presiona Siguiente.";
        } else {
          document.getElementById('calib-status-text').innerText = "Canta una nota más AGUDA que la anterior.";
        }
      }
    }
  } else {
    document.getElementById('calib-status-text').innerText = "Analizando tono... Sostén la nota.";
  }
}

/**
 * Clasifica la voz comparando el rango calibrado con los registros corales estándar.
 */
function calculateVoiceTypeResults() {
  const lowHz = window.appState.calibration.lowHz;
  const highHz = window.appState.calibration.highHz;
  
  // Calcular octavas: log2(f_alta / f_baja)
  const octaves = Math.log2(highHz / lowHz);
  
  // Frecuencia media de su rango para ubicar el centro de gravedad vocal
  const centerHz = Math.sqrt(lowHz * highHz);
  
  // Clasificación por centro de frecuencia
  let classification = 'Tenor';
  if (centerHz < 140) {
    classification = 'Bajo';
  } else if (centerHz >= 140 && centerHz < 220) {
    classification = 'Tenor';
  } else if (centerHz >= 220 && centerHz < 340) {
    classification = 'Alto';
  } else {
    classification = 'Soprano';
  }

  const voiceInfo = VOICE_RANGES[classification];
  
  // Guardar en estado
  window.appState.vocalProfile = {
    type: voiceInfo.label,
    rangeStr: `${window.appState.calibration.lowNote} - ${window.appState.calibration.highNote}`,
    hzRangeStr: `${lowHz.toFixed(0)} Hz - ${highHz.toFixed(0)} Hz`,
    octaves: octaves.toFixed(1)
  };
  
  window.appState.challenge.voiceType = classification;

  // Actualizar UI de resultados
  document.getElementById('voice-type-title').innerText = voiceInfo.label;
  document.getElementById('voice-type-desc').innerText = voiceInfo.desc;
  document.getElementById('res-vocal-range').innerText = window.appState.vocalProfile.rangeStr;
  document.getElementById('res-hz-range').innerText = window.appState.vocalProfile.hzRangeStr;
  document.getElementById('res-octaves').innerText = `${window.appState.vocalProfile.octaves} octavas`;

  // Resaltar en la tabla comparativa de forma defensiva
  const chartItems = ['chart-soprano', 'chart-alto', 'chart-tenor', 'chart-bass'];
  chartItems.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active-voice');
  });
  
  const activeChartId = classification === 'Bajo' ? 'chart-bass' :
                        classification === 'Tenor' ? 'chart-tenor' :
                        classification === 'Alto' ? 'chart-alto' : 'chart-soprano';
  const activeEl = document.getElementById(activeChartId);
  if (activeEl) {
    activeEl.classList.add('active-voice');
  }

  showScreen('voice-results');
}

// ==========================================
// ESTADIO 2: DESAFÍO DE AFINACIÓN (ESCALAS)
// ==========================================

/**
 * Baraja (shuffle) un array usando el algoritmo Fisher-Yates.
 * Retorna un nuevo array con los mismos elementos en orden aleatorio.
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function startPitchChallengeStage() {
  showScreen('pitch-challenge');
  startAnalysisLoop(); // Asegurar que el bucle de análisis de frecuencia esté activo
  
  const voiceType = window.appState.challenge.voiceType;
  const midiScale = SCALES_BY_VOICE[voiceType];
  
  // Barajar las notas para que no siempre aparezcan en orden ascendente
  window.appState.challenge.scaleNotes = shuffleArray(midiScale);
  window.appState.challenge.currentStepIndex = 0;
  window.appState.challenge.score = 0;
  window.appState.challenge.allNotesResults = [];
  window.appState.challenge.state = 'idle';
  
  updateChallengeUI();
  prepareNextChallengeNote();
}

function updateChallengeUI() {
  const chall = window.appState.challenge;
  document.getElementById('challenge-score').innerText = Math.round(chall.score);
  document.getElementById('challenge-step').innerText = chall.currentStepIndex + 1;
  document.getElementById('hold-progress-bar').style.width = '0%';
  document.getElementById('gauge-needle').style.left = '50%';
  document.getElementById('cents-diff').innerText = '-';
  document.getElementById('cents-diff').className = 'cents-diff-display';
  
  document.getElementById('challenge-user-note').innerText = '--';
  document.getElementById('challenge-user-hz').innerText = '0.0 Hz';
}

function prepareNextChallengeNote() {
  const chall = window.appState.challenge;
  const noteIndex = chall.currentStepIndex;
  
  if (noteIndex >= chall.scaleNotes.length) {
    // Reto completado! Calcular puntajes finales
    finishPitchChallenge();
    return;
  }
  
  const midi = chall.scaleNotes[noteIndex];
  const hz = midiToPerfectFrequency(midi);
  const name = midiToNoteName(midi);
  
  chall.targetMidi = midi;
  chall.targetHz = hz;
  chall.targetNoteName = name;
  chall.state = 'idle';
  chall.holdProgress = 0;
  chall.centsAcc = 0;
  chall.centsCount = 0;
  
  document.getElementById('target-note-name').innerText = name;
  document.getElementById('target-note-frequency').innerText = `${hz.toFixed(1)} Hz`;
  
  document.getElementById('challenge-instruction-text').innerText = "Escucha la nota de referencia haciendo clic abajo...";
  document.getElementById('btn-start-singing').disabled = true;
  document.getElementById('playback-status').innerText = "Presiona para escuchar";
  
  updateChallengeUI();
}

/**
 * Reproduce el tono de referencia con el sintetizador.
 */
function playCurrentChallengeNote() {
  const chall = window.appState.challenge;
  chall.state = 'listen';
  
  document.getElementById('playback-status').innerText = "Reproduciendo nota...";
  document.getElementById('challenge-instruction-text').innerText = "Escucha atentamente el tono...";
  
  audioManager.playReferenceTone(chall.targetHz, 1.8);
  
  setTimeout(() => {
    chall.state = 'idle';
    document.getElementById('playback-status').innerText = "Escuchada";
    document.getElementById('challenge-instruction-text').innerText = "¡Listo! Presiona 'Cantar nota' e imítala.";
    document.getElementById('btn-start-singing').disabled = false;
  }, 1800);
}

function startSingingPhase() {
  const chall = window.appState.challenge;
  chall.state = 'sing';
  chall.holdProgress = 0;
  chall.centsAcc = 0;
  chall.centsCount = 0;
  
  document.getElementById('challenge-instruction-text').innerText = "¡Canta! Mantén el tono afinado.";
  document.getElementById('btn-start-singing').disabled = true;
  
  // Limitar la fase de canto a un máximo de 5 segundos
  // Si en 5 segundos no logra sostener la nota afinada por el tiempo requerido, se califica con lo obtenido
  let singingTimeLimit = setTimeout(() => {
    if (chall.state === 'sing') {
      evaluateAndAdvanceNote();
    }
  }, 5500);
  
  chall.timeLimitTimer = singingTimeLimit;
}

/**
 * Procesa la afinación en tiempo real cuando el usuario canta durante el reto.
 */
function processChallengePitch(freq, currentMidi) {
  const chall = window.appState.challenge;
  
  // Actualizar displays
  document.getElementById('challenge-user-note').innerText = midiToNoteName(currentMidi);
  document.getElementById('challenge-user-hz').innerText = `${freq.toFixed(1)} Hz`;

  // Calcular la desviación en cents respecto a la nota objetivo (targetMidi)
  const cents = getCentsDifference(freq, chall.targetMidi);
  window.appState.centsDeviation = cents;
  
  // Actualizar dial de agudo/grave
  // Mapeamos cents [-50, 50] a left [0%, 100%]
  const gaugePercent = ((cents + 50) / 100) * 100;
  const needle = document.getElementById('gauge-needle');
  needle.style.left = `${Math.max(0, Math.min(100, gaugePercent))}%`;
  
  const centsText = document.getElementById('cents-diff');
  
  // Se considera afinado si está dentro de +-25 cents (el sweet spot musical estándar)
  const isInTune = Math.abs(cents) <= 22;
  window.appState.isInTune = isInTune;
  
  if (isInTune) {
    needle.className = 'gauge-indicator in-tune';
    centsText.className = 'cents-diff-display in-tune';
    centsText.innerText = cents > 0 ? `+${Math.round(cents)} cents` : `${Math.round(cents)} cents`;
    
    // Incrementar barra de "Mantenla afinada" (holdProgress)
    chall.holdProgress += 2.5; // Necesita unos ~40 frames (~1.3s) de afinación acumulada
    document.getElementById('hold-progress-bar').style.width = `${Math.min(100, chall.holdProgress)}%`;
    
    // Acumular desviación para estadística
    chall.centsAcc += Math.abs(cents);
    chall.centsCount++;
    
    // Si llena la barra de afinación, avanza con éxito
    if (chall.holdProgress >= 100) {
      clearTimeout(chall.timeLimitTimer);
      evaluateAndAdvanceNote();
    }
  } else {
    needle.className = 'gauge-indicator';
    centsText.className = 'cents-diff-display';
    centsText.innerText = cents > 0 ? `+${Math.round(cents)} cents (Muy agudo)` : `${Math.round(cents)} cents (Muy grave)`;
  }
}

/**
 * Evalúa los cents acumulados de la nota, calcula el puntaje individual y pasa a la siguiente.
 */
function evaluateAndAdvanceNote() {
  const chall = window.appState.challenge;
  chall.state = 'scoring';
  
  audioManager.stopReferenceTone();
  
  // Calcular puntaje para esta nota
  // Si holdProgress no llegó a 100, penalizar. 
  // Si llegó a 100, calificar basado en el promedio de desviación
  let noteScore = 0;
  let avgCents = 50;
  
  if (chall.centsCount > 0) {
    avgCents = chall.centsAcc / chall.centsCount;
    // Puntaje: 100 en 0 cents, decae linealmente hasta 0 en 25 cents.
    const precisionScore = Math.max(0, 100 - (avgCents * 4)); 
    // Multiplicar por la fracción del progreso completado
    noteScore = precisionScore * (Math.min(100, chall.holdProgress) / 100);
  }
  
  chall.allNotesResults.push({
    noteName: chall.targetNoteName,
    score: noteScore,
    avgCents: chall.centsCount > 0 ? avgCents : 50
  });
  
  // Acumular puntaje general (promedio ponderado sobre 5 notas)
  chall.score += noteScore / 5;
  
  document.getElementById('challenge-score').innerText = Math.round(chall.score);
  document.getElementById('challenge-instruction-text').innerText = `Nota evaluada: ¡${Math.round(noteScore)} pts!`;
  
  // Pequeña pausa para feedback visual antes de pasar a la siguiente nota
  setTimeout(() => {
    chall.currentStepIndex++;
    prepareNextChallengeNote();
  }, 1500);
}

/**
 * Procesa la finalización del desafío y muestra el puntaje acumulado y diagnóstico.
 */
function finishPitchChallenge() {
  stopAnalysisLoop();
  showScreen('final-results');
  
  const chall = window.appState.challenge;
  const scorePercent = Math.round(chall.score);
  
  document.getElementById('final-score-percent').innerText = `${scorePercent}%`;
  document.getElementById('final-voice-type').innerText = window.appState.vocalProfile.type;
  document.getElementById('final-range').innerText = window.appState.vocalProfile.rangeStr;
  
  // Calcular promedio total de desviación en cents
  let totalCents = 0;
  let notesEvaluated = 0;
  chall.allNotesResults.forEach(r => {
    if (r.avgCents < 50) {
      totalCents += r.avgCents;
      notesEvaluated++;
    }
  });
  const overallAvgCents = notesEvaluated > 0 ? (totalCents / notesEvaluated) : 50;
  document.getElementById('final-avg-cents').innerText = `±${overallAvgCents.toFixed(1)} cents`;

  // Dar rango y feedback divertido/profesional
  let rankTitle = 'Oído de Madera';
  let rankDesc = 'Necesitas practicar tu afinación e imitación. A veces es difícil coordinar la voz con el oído. ¡No te rindas y vuelve a intentarlo!';
  
  if (scorePercent >= 90) {
    rankTitle = 'Oído Absoluto / Director Coral';
    rankDesc = '¡Asombroso! Tu precisión es prácticamente impecable. Posees un control afinadísimo de tus cuerdas vocales, digno de un solista o director coral.';
  } else if (scorePercent >= 75) {
    rankTitle = 'Oído de Oro / Cantante Profesional';
    rankDesc = '¡Excelente trabajo! Tienes una gran afinación y cantas con estabilidad. Encajas perfectamente en cualquier grupo coral destacado.';
  } else if (scorePercent >= 50) {
    rankTitle = 'Cantante Afinado / Coreuta Promesa';
    rankDesc = '¡Buen nivel! Consigues imitar los tonos de forma efectiva. Con un poco de práctica técnica y respiración lograrás una estabilidad soberbia.';
  } else if (scorePercent >= 30) {
    rankTitle = 'Principiante Entusiasta';
    rankDesc = 'Estás en camino. Tu afinación fluctúa un poco, pero con calentamiento y práctica auditiva diaria subirás de rango rápidamente.';
  }
  
  document.getElementById('tuning-rank-title').innerText = rankTitle;
  document.getElementById('tuning-rank-desc').innerText = rankDesc;
}

// Limpieza general de la app para reiniciar
function resetApp() {
  stopAnalysisLoop();
  audioManager.stopReferenceTone();
  if (audioManager.micStream) {
    audioManager.stopMic();
  }
  
  // Ocultar error de micrófono
  const detailsEl = document.getElementById('mic-error-details');
  if (detailsEl) {
    detailsEl.style.display = 'none';
    detailsEl.innerText = '';
  }
  
  // Reiniciar estado
  window.appState.detectedHz = 0;
  window.appState.detectedNote = '--';
  window.appState.volume = 0;
  window.appState.centsDeviation = 0;
  window.appState.isInTune = false;
  
  window.appState.calibration.step = 'low';
  window.appState.calibration.lowHz = 0;
  window.appState.calibration.lowNote = '--';
  window.appState.calibration.highHz = 0;
  window.appState.calibration.highNote = '--';
  window.appState.calibration.isStable = false;
  window.appState.calibration.stableTimer = 0;
  
  window.appState.challenge.currentStepIndex = 0;
  window.appState.challenge.score = 0;
  window.appState.challenge.holdProgress = 0;
  window.appState.challenge.state = 'idle';
  window.appState.challenge.allNotesResults = [];
}
