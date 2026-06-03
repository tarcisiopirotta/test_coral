/**
 * pitch.js - Algoritmo de Autocorrelación para Detección de Tono
 * Optimizado para voces cantarinas monofónicas en tiempo real.
 */

// Configuración del detector
const MIN_RMS = 0.005; // Umbral de volumen mínimo para iniciar detección (más sensible)
const MAX_CENTS_DEV = 50; // Desviación máxima tolerada antes de considerarse otra nota

/**
 * Realiza la detección de tono mediante autocorrelación en el dominio del tiempo.
 * Incluye interpolación parabólica para obtener precisión sub-sample.
 * 
 * @param {Float32Array} buffer - Datos de audio crudos en el rango [-1, 1].
 * @param {number} sampleRate - Tasa de muestreo en Hz (ej. 44100 o 48000).
 * @returns {number} Frecuencia fundamental detectada en Hz, o -1 si no se detecta tono estable.
 */
function autoCorrelate(buffer, sampleRate) {
  const size = buffer.length;
  
  // 1. Calcular el RMS (Root Mean Square) para verificar si hay suficiente volumen
  let rms = 0;
  for (let i = 0; i < size; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / size);
  
  // Si la señal es muy débil, no procesamos (evita analizar ruido de fondo)
  if (rms < MIN_RMS) {
    return -1;
  }

  // 2. Usar todo el buffer sin recortes por amplitud.
  // El recorte por amplitud descartaba voces suaves e impedía detectar la afinación.
  const len = size;
  const clippedBuffer = buffer;

  // 3. Autocorrelación
  const r = new Float32Array(len);
  for (let lag = 0; lag < len; lag++) {
    let sum = 0;
    for (let i = 0; i < len - lag; i++) {
      sum += clippedBuffer[i] * clippedBuffer[i + lag];
    }
    r[lag] = sum;
  }

  // 4. Buscar el primer pico significativo después del lag cero
  // Encontramos el punto donde la autocorrelación empieza a decaer
  let d = 0;
  while (d < len - 1 && r[d] > r[d + 1]) {
    d++;
  }
  
  // Buscamos el pico máximo después del decaimiento inicial
  let maxVal = -1;
  let maxLag = -1;
  for (let i = d; i < len; i++) {
    if (r[i] > maxVal) {
      maxVal = r[i];
      maxLag = i;
    }
  }

  // Si encontramos un lag de pico razonable
  if (maxLag > -1) {
    // Para mayor precisión, realizamos una interpolación parabólica (sub-sample resolution)
    // usando el pico y sus vecinos adyacentes
    let x1 = r[maxLag - 1];
    let x2 = r[maxLag];
    let x3 = r[maxLag + 1];
    
    // Evitar desbordamientos o divisiones por cero si estamos en los extremos
    if (maxLag > 0 && maxLag < len - 1 && (2 * x2 - x1 - x3) !== 0) {
      const a = (x1 + x3 - 2 * x2) / 2;
      const b = (x3 - x1) / 2;
      // Posición del pico real interpolado relativo a maxLag
      const peakCorrection = -b / (2 * a);
      const preciseLag = maxLag + peakCorrection;
      
      // La frecuencia es la tasa de muestreo dividida por el lag preciso en muestras
      const freq = sampleRate / preciseLag;
      
      // Filtrar frecuencias fuera del rango de la voz humana (aprox 50Hz - 2000Hz)
      if (freq >= 50 && freq <= 2000) {
        return freq;
      }
    } else {
      // Retorno sin interpolar si no se dan las condiciones
      const freq = sampleRate / maxLag;
      if (freq >= 50 && freq <= 2000) {
        return freq;
      }
    }
  }
  
  return -1;
}

/**
 * Convierte una frecuencia en Hertz al número de nota MIDI correspondiente.
 */
function frequencyToMidi(frequency) {
  if (frequency <= 0) return 0;
  return 12 * Math.log2(frequency / 440) + 69;
}

/**
 * Convierte un número de nota MIDI a su nombre musical estándar (ej. "C4", "A#3").
 */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midiToNoteName(midiNumber) {
  const roundedMidi = Math.round(midiNumber);
  const noteIndex = roundedMidi % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  return NOTE_NAMES[noteIndex] + octave;
}

/**
 * Convierte una nota MIDI al valor exacto de su frecuencia temperada (en Hz).
 */
function midiToPerfectFrequency(midiNumber) {
  return 440 * Math.pow(2, (midiNumber - 69) / 12);
}

/**
 * Calcula la desviación en cents (centésimas de semitono) entre la frecuencia detectada
 * y la frecuencia perfecta de la nota MIDI más cercana.
 * Rango retornado: [-50, 50].
 * Un semitono tiene 100 cents.
 * 
 * @param {number} frequency - Frecuencia cantada real.
 * @param {number} midiNumber - Nota MIDI objetivo o más cercana.
 * @returns {number} Desviación en cents.
 */
function getCentsDifference(frequency, midiNumber) {
  if (frequency <= 0) return 0;
  const perfectFreq = midiToPerfectFrequency(midiNumber);
  // Fórmula de cents: 1200 * log2(f / f_perfect)
  return 1200 * Math.log2(frequency / perfectFreq);
}
