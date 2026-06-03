/**
 * sketch.js - Lienzo de p5.js y Visualizaciones Creativas
 * Dibuja animaciones interactivas basadas en el estado actual de la aplicación.
 */

let ambientWaves = [];
let confettiParticles = [];
let scrollingPitchHistory = [];
const MAX_HISTORY_POINTS = 120;

function setup() {
  const container = document.getElementById('canvas-container');
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent(container);
  
  // Inicializar ondas de ambiente para la pantalla de bienvenida
  for (let i = 0; i < 3; i++) {
    ambientWaves.push({
      yOffset: random(1000),
      speed: 0.005 + i * 0.002,
      amplitude: 40 + i * 15,
      frequency: 0.003 - i * 0.0005,
      color: i === 0 ? [16, 185, 129] : (i === 1 ? [6, 182, 212] : [52, 211, 153]) // Emerald, Cyan, Mint
    });
  }

  // Ajustar framerate para suavidad
  frameRate(60);
  
  // Configurar renderizado suavizado
  smooth();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  // Limpiar lienzo manteniendo la transparencia para ver el fondo CSS
  clear();
  
  // Obtener estado actual
  const state = window.appState;
  if (!state) return;
  
  // Adaptar visualización según la pantalla activa
  switch (state.currentScreen) {
    case 'welcome':
    case 'mic-error':
      drawAmbientWaves();
      break;
      
    case 'calibration':
      drawCalibrationVisuals(state);
      break;
      
    case 'pitch-challenge':
      drawChallengeVisuals(state);
      break;
      
    case 'final-results':
      drawFinalResultsVisuals();
      break;
  }
}

// ==========================================
// PANTALLA 1: ONDAS AMBIENTALES
// ==========================================
function drawAmbientWaves() {
  noFill();
  strokeWeight(2.5);
  
  // Conseguir el tema actual para contrastar el color de las ondas
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const alpha = isDark ? 40 : 60;

  for (let i = 0; i < ambientWaves.length; i++) {
    const wave = ambientWaves[i];
    
    // Configurar sombra brillante de neon si es tema oscuro
    if (isDark) {
      drawingContext.shadowBlur = 15;
      drawingContext.shadowColor = `rgba(${wave.color[0]}, ${wave.color[1]}, ${wave.color[2]}, 0.4)`;
    } else {
      drawingContext.shadowBlur = 0;
    }
    
    stroke(wave.color[0], wave.color[1], wave.color[2], alpha);
    
    beginShape();
    for (let x = 0; x < width; x += 10) {
      // Usar perlin noise para crear ondas naturales flotantes
      const yNoise = noise(wave.yOffset + x * wave.frequency);
      const y = height * 0.7 + (yNoise - 0.5) * wave.amplitude * 2;
      vertex(x, y);
    }
    endShape();
    
    // Avanzar la onda en el tiempo
    wave.yOffset += wave.speed;
  }
  
  // Desactivar sombras de neon para otros elementos
  drawingContext.shadowBlur = 0;
}

// ==========================================
// PANTALLA 2: CALIBRACIÓN (ORBE Y ONDAS POLARES)
// ==========================================
let orbRotation = 0;
function drawCalibrationVisuals(state) {
  const calib = state.calibration;
  const volume = state.volume || 0;
  
  // Centro de pantalla
  const cx = width / 2;
  const cy = height * 0.4; // Ligeramente arriba para no tapar los textos de la tarjeta
  
  // Detectar tema
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  
  // 1. Dibujar onda de fondo (pulso sutil)
  noFill();
  const pulseSize = 120 + volume * 400;
  stroke(isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(5, 150, 105, 0.1)');
  strokeWeight(2);
  circle(cx, cy, pulseSize * 1.3);
  circle(cx, cy, pulseSize * 1.6);
  
  // 2. Dibujar orbe central interactivo
  const baseRadius = 80;
  const targetRadius = baseRadius + volume * 350;
  
  // Relleno degradado sutil en el orbe
  if (isDark) {
    drawingContext.shadowBlur = 25;
    drawingContext.shadowColor = calib.step === 'low' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(6, 182, 212, 0.5)';
  }
  
  const orbColor = calib.step === 'low' ? color(16, 185, 129, 180) : color(6, 182, 212, 180);
  fill(orbColor);
  noStroke();
  circle(cx, cy, targetRadius);
  
  // Desactivar sombra
  drawingContext.shadowBlur = 0;
  
  // 3. Dibujar ondas polares alrededor si el usuario está cantando
  if (state.detectedHz > 0) {
    stroke(255, 200);
    strokeWeight(1.5);
    noFill();
    
    beginShape();
    const numPoints = 100;
    for (let i = 0; i < numPoints; i++) {
      const angle = map(i, 0, numPoints, 0, TWO_PI);
      // Ruido modulado por el volumen para simular vibración vocal
      const offset = map(noise(i * 0.15 + orbRotation), 0, 1, -15, 15) * (volume * 10);
      const r = (targetRadius / 2) + 15 + offset;
      
      const x = cx + r * cos(angle);
      const y = cy + r * sin(angle);
      vertex(x, y);
    }
    endShape(CLOSE);
    orbRotation += 0.05;
  }
  
  // 4. Dibujar arco de progreso de estabilidad
  if (calib.stableTimer > 0) {
    noFill();
    stroke(34, 211, 238); // Cyan
    strokeWeight(5);
    const progressAngle = map(Math.min(40, calib.stableTimer), 0, 40, -HALF_PI, TWO_PI - HALF_PI);
    arc(cx, cy, targetRadius + 25, targetRadius + 25, -HALF_PI, progressAngle);
  }
}

// ==========================================
// PANTALLA 3: RETO DE AFINACIÓN (TRACK SCROLL)
// ==========================================
function drawChallengeVisuals(state) {
  const chall = state.challenge;
  
  // Solo dibujar si estamos en fase activa de canto
  if (chall.state !== 'sing' && chall.state !== 'scoring') {
    scrollingPitchHistory = [];
    return;
  }
  
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  
  // Zona de renderizado horizontal (mitad de la pantalla)
  const graphY = height * 0.5;
  const corridorHeight = 80;
  
  // 1. Dibujar pasillo/guía de afinación perfecta
  fill(isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)');
  noStroke();
  rect(0, graphY - corridorHeight/2, width, corridorHeight);
  
  // Línea central (afinación perfecta targetHz)
  stroke(isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)');
  strokeWeight(2);
  // Línea de trazos
  drawingContext.setLineDash([8, 8]);
  line(0, graphY, width, graphY);
  drawingContext.setLineDash([]); // Reset
  
  // Texto guía a la derecha
  fill(isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.4)');
  noStroke();
  textSize(12);
  textAlign(RIGHT);
  text(`Objetivo: ${chall.targetNoteName}`, width - 20, graphY - 10);
  
  // 2. Registrar tono actual del usuario en la cola de historial
  if (chall.state === 'sing') {
    let currentPoint = null;
    
    if (state.detectedHz > 0) {
      // Mapear desviación en cents [-50, 50] a coordenadas Y relativa a la línea central
      // Un desvío de 50 cents hacia arriba sube la y; hacia abajo la baja
      // Factor de escala: 1 cent = 1.2 pixeles (para que se note pero quepa en el pasillo)
      const yOffset = -state.centsDeviation * 1.4; 
      
      currentPoint = {
        y: graphY + yOffset,
        inTune: state.isInTune,
        active: true
      };
    } else {
      currentPoint = {
        y: graphY,
        inTune: false,
        active: false // No cantando
      };
    }
    
    scrollingPitchHistory.push(currentPoint);
    if (scrollingPitchHistory.length > MAX_HISTORY_POINTS) {
      scrollingPitchHistory.shift();
    }
  }

  // 3. Renderizar historial de afinación (se desplaza de derecha a izquierda)
  noFill();
  strokeWeight(4);
  
  // Dibujar como línea continua o conjunto de puntos conectados
  for (let i = 1; i < scrollingPitchHistory.length; i++) {
    const p1 = scrollingPitchHistory[i - 1];
    const p2 = scrollingPitchHistory[i];
    
    // Mapear posición X basado en el índice
    const x1 = map(i - 1, 0, MAX_HISTORY_POINTS, 20, width - 20);
    const x2 = map(i, 0, MAX_HISTORY_POINTS, 20, width - 20);
    
    if (p1.active && p2.active) {
      // Color según afinación (Verde afinado, Naranja/Rojo desafinado)
      if (p2.inTune) {
        stroke(52, 211, 153); // Emerald/Success
      } else {
        stroke(248, 113, 113); // Rose/Red
      }
      
      line(x1, p1.y, x2, p2.y);
    }
  }
}

// ==========================================
// PANTALLA 4: RESULTADOS FINALES (CONFETTI)
// ==========================================
function drawFinalResultsVisuals() {
  // Crear partículas nuevas gradualmente
  if (confettiParticles.length < 80 && random(1) < 0.1) {
    confettiParticles.push({
      x: random(width),
      y: -20,
      size: random(8, 14),
      speedY: random(1.5, 3.5),
      speedX: random(-1, 1),
      angle: random(TWO_PI),
      spinSpeed: random(-0.08, 0.08),
      color: color(random([
        [16, 185, 129],  // Emerald Green
        [6, 182, 212],   // Cyan
        [52, 211, 153],  // Mint
        [251, 191, 36]   // Amber/Gold
      ]))
    });
  }
  
  // Dibujar y actualizar partículas
  noStroke();
  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    const p = confettiParticles[i];
    
    // Actualizar posición
    p.y += p.speedY;
    p.x += p.speedX + sin(frameCount * 0.02 + p.size) * 0.5; // balanceo sutil
    p.angle += p.spinSpeed;
    
    // Dibujar confetti rotante
    fill(p.color);
    push();
    translate(p.x, p.y);
    rotate(p.angle);
    rectMode(CENTER);
    rect(0, 0, p.size, p.size / 2);
    pop();
    
    // Eliminar si sale de pantalla
    if (p.y > height + 20) {
      confettiParticles.splice(i, 1);
    }
  }
}
