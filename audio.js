/**
 * audio.js - Administrador del Contexto de Audio, Micrófono y Sintetizador
 * Maneja la captura del micrófono en tiempo real y la síntesis de tonos de referencia.
 */

class CoralAudioManager {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.micStream = null;
    this.sourceNode = null;
    this.currentOscillator = null;
    this.currentGainNode = null;
    
    // Buffer para extraer muestras de tiempo-dominio
    this.fftSize = 2048; // Tamaño óptimo para capturar frecuencias graves (>50Hz) a 44.1kHz/48kHz
    this.audioBuffer = new Float32Array(this.fftSize);
    
    this.isInitialized = false;
  }

  /**
   * Inicializa el contexto de audio y solicita permisos para el micrófono.
   * Debe ejecutarse como respuesta a un gesto del usuario (click).
   */
  async init() {
    if (this.isInitialized) return true;

    try {
      // 1. Verificar contexto seguro y soporte de API de micrófono
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!window.isSecureContext) {
          throw new Error("SecureContextError: El navegador bloquea el micrófono por seguridad al no usar HTTPS o localhost.");
        } else {
          throw new Error("NotSupportedError: Este navegador no tiene soporte para capturar audio.");
        }
      }

      // 2. Crear el AudioContext
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      
      // Asegurarse de que esté activo (algunos navegadores lo inicializan suspendido)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // 3. Solicitar acceso al micrófono del usuario
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      // 3. Crear el AnalyserNode
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;

      // 4. Conectar el micrófono al AnalyserNode
      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.analyser);

      this.isInitialized = true;
      console.log("Audio de CoralTester inicializado con éxito.");
      return true;
    } catch (error) {
      console.error("Error al inicializar el hardware de audio:", error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Obtiene los datos de onda de audio actuales del analizador.
   * @returns {Float32Array} Buffer con las muestras de audio en el dominio del tiempo.
   */
  getAudioData() {
    if (!this.isInitialized || !this.analyser) {
      return null;
    }
    
    // Si el navegador soporta getFloat32TimeDomainData de forma nativa
    if (this.analyser.getFloat32TimeDomainData) {
      this.analyser.getFloat32TimeDomainData(this.audioBuffer);
    } else {
      // Fallback para navegadores antiguos u otras implementaciones (ej. Safari antiguo)
      // Mapeamos los datos de 8 bits sin signo [0, 255] a floats de 32 bits [-1.0, 1.0]
      const byteBuffer = new Uint8Array(this.fftSize);
      this.analyser.getByteTimeDomainData(byteBuffer);
      for (let i = 0; i < this.fftSize; i++) {
        this.audioBuffer[i] = (byteBuffer[i] - 128) / 128;
      }
    }
    
    return this.audioBuffer;
  }

  /**
   * Obtiene la tasa de muestreo actual del contexto de audio.
   */
  getSampleRate() {
    return this.audioContext ? this.audioContext.sampleRate : 44100;
  }

  /**
   * Detiene el flujo de audio del micrófono.
   */
  stopMic() {
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    this.isInitialized = false;
  }

  /**
   * Reproduce un tono puro sintetizado para la nota de referencia usando un oscilador.
   * Utiliza una envolvente suave para evitar chasquidos de audio (clicks).
   * 
   * @param {number} frequency - Frecuencia en Hz del tono a reproducir.
   * @param {number} duration - Duración en segundos (ej. 1.2).
   */
  playReferenceTone(frequency, duration = 1.2) {
    if (!this.audioContext) return;
    
    // Reanudar si está suspendido
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Detener cualquier tono activo primero
    this.stopReferenceTone();

    const osc = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    // Usamos una onda triangular que es más suave al oído y fácil de imitar
    osc.type = 'triangle'; 
    osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

    // Configurar envolvente de volumen (ADSR simplificado para evitar chasquidos)
    const now = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    // Ataque suave
    gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1); 
    // Sostenido
    gainNode.gain.setValueAtTime(0.3, now + duration - 0.2);
    // Decaimiento suave hasta cero
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // Conexiones: Oscilador -> Control de Volumen -> Salida de Audio
    osc.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    osc.start(now);
    osc.stop(now + duration);

    this.currentOscillator = osc;
    this.currentGainNode = gainNode;
  }

  /**
   * Detiene inmediatamente la nota que se esté reproduciendo con un fade-out rápido.
   */
  stopReferenceTone() {
    if (this.currentOscillator && this.currentGainNode) {
      try {
        const now = this.audioContext.currentTime;
        // Fade-out ultrarrápido para silenciar de inmediato
        this.currentGainNode.gain.cancelScheduledValues(now);
        this.currentGainNode.gain.setValueAtTime(this.currentGainNode.gain.value, now);
        this.currentGainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        
        const osc = this.currentOscillator;
        setTimeout(() => {
          try { osc.stop(); } catch(e) {}
        }, 50);
      } catch (e) {
        // Ignorar si ya se había detenido
      }
    }
    this.currentOscillator = null;
    this.currentGainNode = null;
  }
}

// Exportar una instancia global
const audioManager = new CoralAudioManager();
