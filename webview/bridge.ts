type Listener = (msg: unknown) => void;

interface VsCodeApi {
  postMessage: (msg: unknown) => void;
}

let api: VsCodeApi | null = null;
try {
  const acquire = (window as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi;
  api = acquire ? acquire() : null;
} catch {
  api = null;
}

export function postToExtension(msg: unknown): void {
  api?.postMessage(msg);
}

export function onExtensionMessage(cb: Listener): () => void {
  const handler = (event: MessageEvent) => cb(event.data);
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}