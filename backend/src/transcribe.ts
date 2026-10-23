import { Groq, toFile } from 'groq-sdk';
import { ProviderPoolExhaustedError, getProviderPool } from './providerKeyPool.js';
import dotenv from 'dotenv';
dotenv.config();

// Domain priming prompt to bias Whisper toward technical, algorithmic, and programming terms
const CODING_DOMAIN_PROMPT = 
  "Technical coding interview question, campus placement assessment, data structures, algorithms. " +
  "Arrays, strings, linked list, binary tree, graph, dynamic programming, two pointers, greedy, " +
  "time complexity, space complexity, constraints, sample input, sample output, test cases, " +
  "stdin, stdout, modulo 10^9+7, Dijkstra, Kadane, Python, C++, Java.";

export interface TranscriptionResult {
  text: string;
  model: string;
  duration?: number;
}

/**
 * Transcribes audio buffer using Groq's high-speed Whisper Large v3 Turbo model.
 * Falls back to Whisper Large v3 if turbo is unavailable.
 */
export async function transcribeAudio(
  buffer: Buffer, 
  fileName: string = 'recording.webm', 
  mimeType: string = 'audio/webm'
): Promise<TranscriptionResult> {
  const candidateModels = [
    'whisper-large-v3-turbo',
    'whisper-large-v3',
  ];

  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      console.log(`[STT] Sending audio to Groq Whisper model '${model}'... (${(buffer.length / 1024).toFixed(1)} KB)`);
      const startTime = Date.now();

      const response = await getProviderPool('groq-audio').execute(async apiKey => {
        const groq = new Groq({ apiKey, maxRetries: 0 });
        const uploadableFile = await toFile(buffer, fileName, { type: mimeType });
        return groq.audio.transcriptions.create({
          file: uploadableFile,
          model,
          prompt: CODING_DOMAIN_PROMPT,
          response_format: 'json',
          temperature: 0.0,
        });
      }, {
        operation: `transcription:${model}`,
      });

      const elapsed = Date.now() - startTime;
      console.log(`[STT] Transcription completed in ${elapsed}ms using ${model}. Output length: ${response.text.length} chars`);

      return {
        text: response.text.trim(),
        model,
        duration: elapsed,
      };
    } catch (err: any) {
      lastError = err;
      if (err instanceof ProviderPoolExhaustedError) throw err;
      console.warn(`[STT] Model '${model}' failed (${err.status || err.name}: ${err.message}). Trying next candidate...`);
    }
  }

  throw lastError || new Error('All Groq Whisper transcription models failed');
}
