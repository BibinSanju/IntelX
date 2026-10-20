import { transcribeAudio } from './transcribe.js';

// Create a minimal 1-second 8kHz mono 16-bit PCM WAV buffer (silence)
function createSilentWavBuffer(): Buffer {
  const sampleRate = 8000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate; // 1 second
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // silence remains 0s

  return buffer;
}

async function runTest() {
  console.log('[Test] Running STT Whisper transcription test on Groq...');
  try {
    const wav = createSilentWavBuffer();
    const result = await transcribeAudio(wav, 'silence_test.wav', 'audio/wav');
    console.log('[Test] STT Result:', result);
    console.log('[Test] Model used:', result.model);
    console.log('[Test] Duration:', result.duration, 'ms');
    console.log('[Test] PASSED: Groq Whisper API transcribed audio successfully!');
  } catch (err: any) {
    console.error('[Test] FAILED:', err.message);
    process.exit(1);
  }
}

runTest();
