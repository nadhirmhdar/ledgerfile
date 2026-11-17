/** A byte array as a ReadableStream of fixed-size chunks, so a large file is sent as a streamed response body rather than one buffer. */
export const STREAM_CHUNK_BYTES = 256 * 1024;

export function streamBytes(data: Uint8Array, chunk = STREAM_CHUNK_BYTES): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(data.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}
