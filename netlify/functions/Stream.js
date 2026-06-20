#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
//  Live Life — Stream para YouTube 24/7  (v2 — conexão única)
//  Autor: gerado por Claude para Fran
//  Uso: node stream.js
//
//  DIFERENÇA DA V1: agora mantém UMA conexão RTMP aberta
//  continuamente (como o YouTube exige), alimentada por uma
//  playlist que vai sendo atualizada conforme novas cenas
//  chegam. Antes, cada cena abria/fechava uma conexão nova
//  e o YouTube não reconhecia como stream ao vivo contínuo.
// ═══════════════════════════════════════════════════════

const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────────────
//  ⚙️  CONFIGURAÇÃO
// ──────────────────────────────────────────────────────
const CONFIG = {
  youtubeStreamKey: '6t3h-dfex-jj5y-sbzt-22jh',
  videosDir: path.join(process.env.HOME, 'Desktop', 'livelife-videos'),
  queueFile: path.join(process.env.HOME, 'Desktop', 'livelife-queue.json'),
  playlistFile: path.join(process.env.HOME, 'Desktop', 'livelife-playlist.txt'),
  fallbackVideo: path.join(process.env.HOME, 'Desktop', 'livelife-espera.mp4'),
  rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
  resolution: '1280x720',
  fps: 30,
  videoBitrate: '2500k',
  audioBitrate: '128k',
  // Quanto tempo (ms) esperar checando por cenas novas
  checkIntervalMs: 5000,
};

// ──────────────────────────────────────────────────────
//  📁  Setup inicial
// ──────────────────────────────────────────────────────
if (!fs.existsSync(CONFIG.videosDir)) {
  fs.mkdirSync(CONFIG.videosDir, { recursive: true });
  console.log(`📁 Pasta criada: ${CONFIG.videosDir}`);
}

// ──────────────────────────────────────────────────────
//  📥  Download de vídeo
// ──────────────────────────────────────────────────────
function downloadVideo(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        https.get(response.headers.location, (r2) => {
          r2.pipe(file);
          file.on('finish', () => { file.close(); resolve(destPath); });
        }).on('error', reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ──────────────────────────────────────────────────────
//  📋  Gerencia a playlist (arquivo texto que o FFmpeg lê)
// ──────────────────────────────────────────────────────
let knownFiles = [];
let processedIds = new Set();

function writePlaylist() {
  // Formato exigido pelo concat demuxer do FFmpeg:
  // file '/caminho/absoluto/video.mp4'
  const lines = knownFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(CONFIG.playlistFile, lines.join('\n') + '\n', 'utf8');
}

async function checkNewScenes() {
  if (!fs.existsSync(CONFIG.queueFile)) return false;
  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(CONFIG.queueFile, 'utf8'));
  } catch (e) {
    return false;
  }

  const novas = queue.filter(s => s.status === 'done' && s.videoUrl && !processedIds.has(s.id));
  if (!novas.length) return false;

  let added = false;
  for (const scene of novas) {
    const filename = `scene_${scene.id}.mp4`;
    const destPath = path.join(CONFIG.videosDir, filename);
    try {
      if (!fs.existsSync(destPath)) {
        console.log(`⬇️  Baixando: ${scene.freeText || scene.id}`);
        await downloadVideo(scene.videoUrl, destPath);
        console.log(`✅ Download OK: ${filename}`);
      }
      knownFiles.push(destPath);
      processedIds.add(scene.id);
      added = true;
    } catch (err) {
      console.error(`❌ Erro baixando cena ${scene.id}:`, err.message);
      processedIds.add(scene.id);
    }
  }

  if (added) writePlaylist();
  return added;
}

// ──────────────────────────────────────────────────────
//  🎬  Inicia o FFmpeg com UMA conexão RTMP contínua,
//      lendo da playlist via concat demuxer.
//      -stream_loop -1 repete a playlist indefinidamente,
//      então o stream NUNCA cai mesmo com fila pequena.
// ──────────────────────────────────────────────────────
let ffmpegProcess = null;

function startFfmpeg() {
  const rtmp = `${CONFIG.rtmpUrl}/${CONFIG.youtubeStreamKey}`;
  const args = [
    '-stream_loop', '-1',
    '-f', 'concat',
    '-safe', '0',
    '-i', CONFIG.playlistFile,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', CONFIG.videoBitrate,
    '-maxrate', CONFIG.videoBitrate,
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', String(CONFIG.fps * 2),
    '-r', String(CONFIG.fps),
    '-s', CONFIG.resolution,
    '-c:a', 'aac',
    '-b:a', CONFIG.audioBitrate,
    '-ar', '44100',
    '-re',
    '-f', 'flv',
    rtmp
  ];

  console.log('📡 Iniciando conexão RTMP contínua com o YouTube...');
  ffmpegProcess = spawn('ffmpeg', args);

  ffmpegProcess.stderr.on('data', (data) => {
    const txt = data.toString();
    if (txt.includes('frame=')) {
      process.stdout.write('\r📡 Transmitindo... ' + (txt.match(/frame=\s*\d+/)?.[0] || ''));
    } else if (/error/i.test(txt)) {
      console.log('\n⚠️  FFmpeg:', txt.trim());
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`\n🔴 FFmpeg encerrou (código ${code}). Reiniciando em 5s...`);
    ffmpegProcess = null;
    setTimeout(startFfmpeg, 5000);
  });

  ffmpegProcess.on('error', (err) => {
    console.error('💥 Erro no FFmpeg:', err.message);
  });
}

// ──────────────────────────────────────────────────────
//  🔄  Loop de monitoramento — atualiza a playlist e
//      reinicia o FFmpeg quando novas cenas chegam.
// ──────────────────────────────────────────────────────
async function monitorLoop() {
  while (true) {
    const added = await checkNewScenes();

    if (added && ffmpegProcess) {
      console.log('\n🔄 Nova(s) cena(s) detectada(s) — atualizando stream...');
      ffmpegProcess.kill('SIGTERM');
      // o 'close' handler reinicia automaticamente
    }

    await new Promise(r => setTimeout(r, CONFIG.checkIntervalMs));
  }
}

// ──────────────────────────────────────────────────────
//  🚀  Inicialização
// ──────────────────────────────────────────────────────
async function main() {
  if (CONFIG.youtubeStreamKey.includes('COLE_SUA')) {
    console.error('❌ Configure a Stream Key do YouTube no arquivo stream.js!');
    process.exit(1);
  }

  console.log('🎬 Live Life Stream v2 — conexão contínua');
  console.log(`📁 Monitorando fila: ${CONFIG.queueFile}`);
  console.log(`📡 RTMP: ${CONFIG.rtmpUrl}`);
  console.log('─────────────────────────────────────');

  console.log('⏳ Aguardando a primeira cena ficar pronta...');
  let hasContent = false;
  while (!hasContent) {
    hasContent = await checkNewScenes();
    if (!hasContent) {
      if (fs.existsSync(CONFIG.fallbackVideo)) {
        knownFiles.push(CONFIG.fallbackVideo);
        writePlaylist();
        hasContent = true;
        console.log('🎞  Usando vídeo de espera para abrir o stream.');
      } else {
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  console.log('\n✅ Playlist pronta! Conectando ao YouTube...\n');
  startFfmpeg();
  monitorLoop();
}

main().catch(err => {
  console.error('💥 Erro fatal:', err);
  process.exit(1);
});
