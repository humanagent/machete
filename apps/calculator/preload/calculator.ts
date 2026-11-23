// Exposes the calculator panel's bridge as `window.calculator`.
import { contextBridge, ipcRenderer } from 'electron';
import { Channels } from '../../../core/channels';
import { listen } from '../../../core/preload/listen';
import type { CalculatorBridge, CalculatorState } from '../ipc';

const bridge: CalculatorBridge = {
  onState: listen<CalculatorState>(Channels.calculatorState),
  send: (command) => ipcRenderer.send(Channels.calculatorCommand, command),
};

contextBridge.exposeInMainWorld('calculator', bridge);
