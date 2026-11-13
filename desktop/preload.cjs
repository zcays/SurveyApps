/* Minimal dashboard-only bridge. No paths, filesystem, shell or generic IPC. */
const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('surveyapps', Object.freeze({
    getStatus: () => ipcRenderer.invoke('surveyapps:status'),
    retryBackend: () => ipcRenderer.invoke('surveyapps:retry'),
    onStatus: callback => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('surveyapps:status', handler);
      return () => ipcRenderer.removeListener('surveyapps:status', handler);
    }
  }));
}
