import { type IpcRendererEvent, ipcRenderer } from 'electron';

/** Subscribes to a channel; the returned function unsubscribes. */
export const listen =
  <A>(channel: string) =>
  (listener: (value: A) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, value: A) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };
