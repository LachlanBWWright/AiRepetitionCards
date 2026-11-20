/** Encode a selected range as portable 16-bit PCM WAV without changing source samples. */
export function encodeWave(
  channels: readonly Float32Array[],
  sampleRate: number,
  startFrame: number,
  endFrame: number,
): Uint8Array {
  const frameCount = endFrame - startFrame;
  const dataLength = frameCount * channels.length * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);
  for (let frame = 0; frame < frameCount; frame++) {
    channels.forEach((channel, index) => {
      const sample = Math.max(-1, Math.min(1, channel[startFrame + frame] ?? 0));
      view.setInt16(
        44 + (frame * channels.length + index) * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
    });
  }
  return bytes;
}
