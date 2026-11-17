/** Runs once when the server starts. In development it refuses a database that is not on this machine (see assertDevSafe). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertDevSafe } = await import("./server/config");
    assertDevSafe();
  }
}
