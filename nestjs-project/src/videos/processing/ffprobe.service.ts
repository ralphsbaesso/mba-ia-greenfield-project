import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  FFPROBE_MAX_BUFFER_BYTES,
  FFPROBE_TIMEOUT_MS,
} from './ffprobe.constants';

const execFileAsync = promisify(execFile);

/** The subset of `ffprobe -print_format json` this phase consumes. */
export interface FfprobeOutput {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }[];
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
  };
}

/**
 * Deliberately carries no size: the storage object is authoritative for
 * `size_bytes` and ffprobe's `format.size` is only a cross-check
 * (video-authorization-and-metadata/TD-04). Leaving it out of the shape makes the
 * two impossible to confuse.
 */
export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  containerFormat: string;
  bitrateBps: number | null;
}

/**
 * ffprobe's own verdict that the input has no decodable video stream. Permanent by
 * nature, so SI-03.12 fails fast on it instead of consuming retries
 * (phase-03-videos/TD-13).
 */
export class NoDecodableVideoStreamError extends Error {
  constructor(reason: string) {
    super(`Input has no decodable video stream: ${reason}`);
    this.name = 'NoDecodableVideoStreamError';
  }
}

/** The probe hit its wall-clock bound and the subprocess was killed. */
export class FfprobeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`ffprobe exceeded its ${timeoutMs}ms timeout and was killed`);
    this.name = 'FfprobeTimeoutError';
  }
}

export function mapFfprobeOutput(output: FfprobeOutput): VideoProbe {
  const streams = output.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  if (!video?.width || !video.height || !video.codec_name) {
    throw new NoDecodableVideoStreamError('no video stream in ffprobe output');
  }

  const duration = Number(output.format?.duration);
  if (!Number.isFinite(duration)) {
    throw new NoDecodableVideoStreamError('ffprobe reported no duration');
  }

  const bitrate = Number(output.format?.bit_rate);

  return {
    // Fractional on purpose — the column is numeric(10,3), not an integer.
    durationSeconds: duration,
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name,
    // A file with no audio track is valid input, not a failure.
    audioCodec: audio?.codec_name ?? null,
    containerFormat: output.format?.format_name ?? 'unknown',
    // Some containers simply do not carry an overall bitrate.
    bitrateBps: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
  };
}

@Injectable()
export class FfprobeService {
  /** Overridable so a test can exercise the "binary is missing" path. */
  protected readonly binary: string = 'ffprobe';

  async probe(
    filePath: string,
    timeoutMs: number = FFPROBE_TIMEOUT_MS,
  ): Promise<VideoProbe> {
    const stdout = await this.runFfprobe(filePath, timeoutMs);

    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      throw new NoDecodableVideoStreamError('ffprobe emitted no valid JSON');
    }

    return mapFfprobeOutput(parsed);
  }

  private async runFfprobe(
    filePath: string,
    timeoutMs: number,
  ): Promise<string> {
    try {
      // Argument array, never a shell string: the path derives from user input
      // (phase-03-videos/TD-07).
      const { stdout } = await execFileAsync(
        this.binary,
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          filePath,
        ],
        { timeout: timeoutMs, maxBuffer: FFPROBE_MAX_BUFFER_BYTES },
      );
      return stdout;
    } catch (error) {
      // `killed` is how Node reports that the timeout fired, and it must not be
      // confused with ffprobe rejecting the input.
      if ((error as { killed?: boolean }).killed) {
        throw new FfprobeTimeoutError(timeoutMs);
      }
      // A missing binary is a broken image, not a verdict about the video. Left
      // unclassified it would mark every input permanently failed — the loudest
      // possible symptom reported as the quietest.
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new Error(
          `ffprobe binary not found (${this.binary}) — is this running in the worker image?`,
        );
      }
      throw new NoDecodableVideoStreamError(
        (error as Error).message || 'ffprobe exited with an error',
      );
    }
  }
}
