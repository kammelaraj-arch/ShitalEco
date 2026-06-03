const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kioskAPI', {
  printReceipt: (content) => ipcRenderer.invoke('print-receipt', content),
  platform: process.platform,
})
